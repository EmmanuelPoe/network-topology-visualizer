import re
import logging
import asyncio
from typing import List, Dict, Any, Optional

try:
    from netmiko import ConnectHandler

    NETMIKO_AVAILABLE = True
except ImportError:
    NETMIKO_AVAILABLE = False

logger = logging.getLogger(__name__)


def find_link(
    links: List[Dict[str, Any]], node_a: str, node_b: str
) -> Optional[Dict[str, Any]]:
    for link in links:
        s, t = link.get("source"), link.get("target")
        if (s == node_a and t == node_b) or (s == node_b and t == node_a):
            return link
    return None


def get_interfaces_between(
    links: List[Dict[str, Any]], node_from: str, node_to: str
) -> tuple[Optional[str], Optional[str]]:
    link = find_link(links, node_from, node_to)
    if not link:
        return None, None
    if link.get("source") == node_from:
        return link.get("src_iface"), link.get("dst_iface")
    else:
        return link.get("dst_iface"), link.get("src_iface")


def find_shortest_path_nodes(
    devices: List[Dict[str, Any]], links: List[Dict[str, Any]], start: str, end: str
) -> Optional[List[str]]:
    adj = {d["id"]: [] for d in devices}
    for link in links:
        s, t = link.get("source"), link.get("target")
        if s in adj and t in adj:
            adj[s].append(t)
            adj[t].append(s)

    if start not in adj or end not in adj:
        return None

    queue = [[start]]
    visited = {start}
    while queue:
        path = queue.pop(0)
        node = path[-1]
        if node == end:
            return path
        for neighbor in adj.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(path + [neighbor])
    return None


async def trace_path(
    topology_data: dict,
    source_id: str,
    dest_ip: str,
    username: Optional[str] = None,
    password: Optional[str] = None,
    mock_mode: bool = True,
) -> List[Dict[str, Any]]:
    devices = topology_data.get("devices", [])
    links = topology_data.get("links", [])

    # 1. Resolve destination IP to a device ID
    dest_device = None
    for d in devices:
        if (
            d.get("ip") == dest_ip
            or d.get("id") == dest_ip
            or d.get("label", "").lower() == dest_ip.lower()
        ):
            dest_device = d
            break

    if not dest_device:
        # Try a partial/default route match: find internet gateway or any node containing external/internet/cloud
        dest_device = next(
            (
                d
                for d in devices
                if "internet" in d.get("id", "").lower()
                or "cloud" in d.get("type", "").lower()
            ),
            None,
        )

    if not dest_device:
        raise ValueError(f"Could not resolve destination IP/host: {dest_ip}")

    dest_id = dest_device["id"]

    if mock_mode:
        # Simulate route trace via BFS
        path_nodes = find_shortest_path_nodes(devices, links, source_id, dest_id)
        if not path_nodes:
            raise ValueError(f"No path found in topology from {source_id} to {dest_id}")

        hops = []
        for i, node_id in enumerate(path_nodes):
            device = next(d for d in devices if d["id"] == node_id)
            ingress_iface = None
            egress_iface = None

            if i > 0:
                # Ingress interface is the interface on this node connecting from the previous node
                _, ingress_iface = get_interfaces_between(
                    links, path_nodes[i - 1], node_id
                )
            if i < len(path_nodes) - 1:
                # Egress interface is the interface on this node connecting to the next node
                egress_iface, _ = get_interfaces_between(
                    links, node_id, path_nodes[i + 1]
                )

            hops.append(
                {
                    "device_id": node_id,
                    "label": device.get("label", node_id),
                    "ip": device.get("ip", "N/A"),
                    "type": device.get("type", "switch"),
                    "ingress_interface": ingress_iface or "Gi0/1",
                    "egress_interface": egress_iface or "Gi0/1",
                }
            )
        return hops

    # Real L3 route tracing via Netmiko SSH queries
    if not NETMIKO_AVAILABLE:
        raise ImportError("Netmiko library is not installed.")

    hops = []
    current_id = source_id
    visited = set()

    while current_id and current_id != dest_id and current_id not in visited:
        visited.add(current_id)
        current_device = next((d for d in devices if d["id"] == current_id), None)
        if not current_device:
            break

        ip = current_device.get("ip")
        platform = current_device.get("platform") or "cisco_ios"

        if not ip:
            raise ValueError(
                f"IP address missing on device {current_id} to continue SSH trace."
            )

        # Log in and check route
        ssh_host = ip
        ssh_port = 22
        if ":" in ip:
            try:
                ssh_host, port_str = ip.split(":", 1)
                ssh_port = int(port_str)
            except ValueError:
                pass

        conn_params = {
            "device_type": platform,
            "host": ssh_host,
            "port": ssh_port,
            "username": username or "admin",
            "password": password or "",
            "conn_timeout": 5,
        }

        loop = asyncio.get_running_loop()
        try:
            output = await loop.run_in_executor(
                None, lambda: _get_route_output(conn_params, dest_ip)
            )
            next_hop_ip, egress_iface = _parse_cisco_route(output)
        except Exception as e:
            logger.error(f"SSH route lookup failed on {current_id}: {e}")
            break

        # Add current hop
        ingress_iface = None
        if len(hops) > 0:
            _, ingress_iface = get_interfaces_between(
                links, hops[-1]["device_id"], current_id
            )

        hops.append(
            {
                "device_id": current_id,
                "label": current_device.get("label", current_id),
                "ip": ip,
                "type": current_device.get("type", "switch"),
                "ingress_interface": ingress_iface or "Gi0/1",
                "egress_interface": egress_iface or "Gi0/1",
            }
        )

        # Resolve next hop device ID
        next_device = None
        if next_hop_ip:
            next_device = next((d for d in devices if d.get("ip") == next_hop_ip), None)

        if not next_device and egress_iface:
            # Try to resolve by checking links connected to this device's egress interface
            for link in links:
                if (
                    link.get("source") == current_id
                    and link.get("src_iface") == egress_iface
                ):
                    next_device = next(
                        (d for d in devices if d["id"] == link.get("target")), None
                    )
                    break
                elif (
                    link.get("target") == current_id
                    and link.get("dst_iface") == egress_iface
                ):
                    next_device = next(
                        (d for d in devices if d["id"] == link.get("source")), None
                    )
                    break

        if next_device:
            current_id = next_device["id"]
        else:
            current_id = None

    # Add final destination node to path if we resolved it
    if current_id == dest_id:
        dest_device = next(d for d in devices if d["id"] == dest_id)
        _, ingress_iface = get_interfaces_between(links, hops[-1]["device_id"], dest_id)
        hops.append(
            {
                "device_id": dest_id,
                "label": dest_device.get("label", dest_id),
                "ip": dest_device.get("ip", "N/A"),
                "type": dest_device.get("type", "switch"),
                "ingress_interface": ingress_iface or "Gi0/1",
                "egress_interface": "Gi0/1",
            }
        )

    return hops


def _get_route_output(conn_params: dict, dest_ip: str) -> str:
    with ConnectHandler(**conn_params) as net_connect:
        return net_connect.send_command(f"show ip route {dest_ip}")


def _parse_cisco_route(output: str) -> tuple[Optional[str], Optional[str]]:
    # Simple regex parsing for next hop IP and interface
    # Example: "Routing Descriptor Blocks:\n  * 10.0.12.2, from 10.0.12.2, ... via GigabitEthernet1/0/1"
    # or "Routing entry for 10.0.3.0/24... via 10.0.12.2"
    next_hop = None
    iface = None

    # Try finding next hop IP
    ip_match = re.search(r"\*?\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", output)
    if ip_match:
        next_hop = ip_match.group(1)

    # Try finding interface
    iface_match = re.search(r"via\s+([A-Za-z0-9/.-]+)", output)
    if iface_match:
        matched = iface_match.group(1).strip()
        if not re.match(r"^\d", matched):  # Verify it's an interface name and not an IP
            iface = matched

    return next_hop, iface
