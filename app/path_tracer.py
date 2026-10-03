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


def parse_bandwidth_bps(bw_str: Optional[str]) -> int:
    """
    Parses human-readable bandwidth strings (e.g. 10G, 1G, 100M, 10M) to bits per second.
    """
    if not bw_str:
        return 1_000_000_000  # Default 1 Gbps
    s = str(bw_str).strip().upper()
    if s.endswith("G") or s.endswith("GBPS"):
        val = re.sub(r"[^\d.]", "", s)
        return int(float(val or 1) * 1_000_000_000)
    elif s.endswith("M") or s.endswith("MBPS"):
        val = re.sub(r"[^\d.]", "", s)
        return int(float(val or 1) * 1_000_000)
    elif s.endswith("K") or s.endswith("KBPS"):
        val = re.sub(r"[^\d.]", "", s)
        return int(float(val or 1) * 1_000)
    return 1_000_000_000


def find_shortest_path_nodes(
    devices: List[Dict[str, Any]], links: List[Dict[str, Any]], start: str, end: str
) -> Optional[List[str]]:
    paths = find_all_shortest_paths(devices, links, start, end)
    return paths[0] if paths else None


def find_all_shortest_paths(
    devices: List[Dict[str, Any]], links: List[Dict[str, Any]], start: str, end: str
) -> List[List[str]]:
    """
    Finds all equal-cost shortest paths (ECMP routes) between start and end nodes.
    """
    adj: Dict[str, List[str]] = {d["id"]: [] for d in devices}
    for link in links:
        s, t = link.get("source"), link.get("target")
        if s in adj and t in adj:
            adj[s].append(t)
            adj[t].append(s)

    if start not in adj or end not in adj:
        return []

    queue = [[start]]
    visited_depth = {start: 0}
    shortest_paths = []
    min_dist = None

    while queue:
        path = queue.pop(0)
        curr = path[-1]
        dist = len(path) - 1

        if min_dist is not None and dist > min_dist:
            break

        if curr == end:
            if min_dist is None:
                min_dist = dist
            shortest_paths.append(path)
            continue

        for neighbor in adj.get(curr, []):
            if neighbor not in visited_depth or visited_depth[neighbor] >= dist + 1:
                visited_depth[neighbor] = dist + 1
                queue.append(path + [neighbor])

    return shortest_paths


def _get_interface_meta(device: Dict[str, Any], iface_name: Optional[str]) -> Dict[str, Any]:
    """
    Extracts configured MTU, speed, and mode for a specific interface on a device.
    """
    default_meta = {
        "mtu": 1500,
        "speed": "auto",
        "mode": "routed",
        "vlan_access": 1,
        "vlan_native": 1,
    }
    if not iface_name or "interfaces" not in device:
        return default_meta

    for iface in device.get("interfaces", []):
        if iface.get("name") == iface_name:
            return {
                "mtu": int(iface.get("mtu") or 1500),
                "speed": iface.get("speed") or "auto",
                "mode": iface.get("mode") or "routed",
                "vlan_access": iface.get("vlan_access") or 1,
                "vlan_native": iface.get("vlan_native") or 1,
            }
    return default_meta


def build_path_hops_and_diagnostics(
    path_nodes: List[str],
    devices: List[Dict[str, Any]],
    links: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Builds comprehensive hop-by-hop telemetry and performs automated diagnostics
    such as MTU mismatch, bandwidth bottleneck detection, and latency calculation.
    """
    dev_map = {d["id"]: d for d in devices}
    hops = []
    diagnostics = []
    bottleneck_link = None
    min_bandwidth_bps = float("inf")
    min_mtu = 9216
    cumulative_latency = 0.0

    for i, node_id in enumerate(path_nodes):
        device = dev_map.get(node_id, {"id": node_id, "label": node_id, "type": "switch"})
        is_first = (i == 0)
        is_last = (i == len(path_nodes) - 1)

        ingress_iface = None
        egress_iface = None
        current_link = None

        if not is_first:
            prev_node = path_nodes[i - 1]
            current_link = find_link(links, prev_node, node_id)
            _, ingress_iface = get_interfaces_between(links, prev_node, node_id)

        if not is_last:
            next_node = path_nodes[i + 1]
            out_link = find_link(links, node_id, next_node)
            egress_iface, _ = get_interfaces_between(links, node_id, next_node)
            if out_link:
                bw_str = out_link.get("bandwidth", "1G")
                bw_bps = parse_bandwidth_bps(bw_str)
                if bw_bps < min_bandwidth_bps:
                    min_bandwidth_bps = bw_bps
                    bottleneck_link = {
                        "source": node_id,
                        "source_label": device.get("label", node_id),
                        "target": next_node,
                        "target_label": dev_map.get(next_node, {}).get("label", next_node),
                        "bandwidth": bw_str,
                        "bandwidth_bps": bw_bps,
                        "protocol": out_link.get("protocol", "UP"),
                    }

        # Determine interface metadata & MTU
        in_meta = _get_interface_meta(device, ingress_iface)
        out_meta = _get_interface_meta(device, egress_iface)

        hop_mtu = min(in_meta["mtu"], out_meta["mtu"])
        if hop_mtu < min_mtu:
            min_mtu = hop_mtu

        # Hop latency estimation
        layer = (device.get("layer") or "access").lower()
        if layer in ("core", "internet"):
            hop_latency = 1.2
        elif layer == "distribution":
            hop_latency = 4.5
        else:
            hop_latency = 12.4
        cumulative_latency += hop_latency

        # Check for MTU mismatch with previous hop
        hop_issues = []
        if not is_first:
            prev_node_id = path_nodes[i - 1]
            prev_dev = dev_map.get(prev_node_id, {})
            prev_egress_iface, _ = get_interfaces_between(links, prev_node_id, node_id)
            prev_out_meta = _get_interface_meta(prev_dev, prev_egress_iface)

            if prev_out_meta["mtu"] != in_meta["mtu"]:
                msg = (
                    f"MTU mismatch on link between {prev_dev.get('label', prev_node_id)} "
                    f"({prev_egress_iface}: MTU {prev_out_meta['mtu']}) and {device.get('label', node_id)} "
                    f"({ingress_iface}: MTU {in_meta['mtu']}). Packets larger than "
                    f"{min(prev_out_meta['mtu'], in_meta['mtu'])}B will fragment or drop."
                )
                diagnostics.append({
                    "type": "mtu_mismatch",
                    "severity": "warning",
                    "hop_index": i,
                    "message": msg,
                })
                hop_issues.append(f"Ingress MTU ({in_meta['mtu']}) mismatches peer ({prev_out_meta['mtu']})")

        # Check if node has offline or degraded status
        if device.get("status") == "offline":
            diagnostics.append({
                "type": "node_offline",
                "severity": "critical",
                "hop_index": i,
                "device_id": node_id,
                "message": f"Device {device.get('label', node_id)} is marked OFFLINE in network state.",
            })
            hop_issues.append("Device is offline")

        hop_status = "critical" if any("offline" in is_str.lower() for is_str in hop_issues) else (
            "warning" if hop_issues else "nominal"
        )

        hops.append({
            "device_id": node_id,
            "label": device.get("label", node_id),
            "ip": device.get("ip", "N/A"),
            "type": device.get("type", "switch"),
            "layer": device.get("layer", "access"),
            "ingress_interface": ingress_iface or ("Gi0/1" if not is_first else None),
            "egress_interface": egress_iface or ("Gi0/1" if not is_last else "Gi0/1"),
            "ingress_mtu": in_meta["mtu"],
            "egress_mtu": out_meta["mtu"],
            "link_bandwidth": current_link.get("bandwidth", "1G") if current_link else "N/A",
            "hop_latency_ms": hop_latency,
            "status": hop_status,
            "issues": hop_issues,
        })

    return {
        "hops": hops,
        "diagnostics": diagnostics,
        "bottleneck": bottleneck_link,
        "cumulative_latency_ms": round(cumulative_latency, 1),
        "path_mtu": min_mtu if min_mtu != 9216 else 1500,
        "total_hops": len(hops),
    }


async def trace_path(
    topology_data: dict,
    source_id: str,
    dest_ip: str,
    username: Optional[str] = None,
    password: Optional[str] = None,
    mock_mode: bool = True,
) -> Dict[str, Any]:
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
        # Find all equal-cost shortest paths (ECMP)
        all_paths = find_all_shortest_paths(devices, links, source_id, dest_id)
        if not all_paths:
            raise ValueError(f"No path found in topology from {source_id} to {dest_id}")

        primary_path = all_paths[0]
        primary_result = build_path_hops_and_diagnostics(primary_path, devices, links)

        # Build alternate paths for ECMP routes if multiple exist
        alternate_paths = []
        for alt_idx, alt_path in enumerate(all_paths[1:], start=1):
            alt_res = build_path_hops_and_diagnostics(alt_path, devices, links)
            alternate_paths.append({
                "path_index": alt_idx,
                "hops": alt_res["hops"],
                "bottleneck": alt_res["bottleneck"],
                "cumulative_latency_ms": alt_res["cumulative_latency_ms"],
                "path_mtu": alt_res["path_mtu"],
            })

        primary_result["alternate_paths"] = alternate_paths
        return primary_result

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

        next_device = None
        if next_hop_ip:
            next_device = next((d for d in devices if d.get("ip") == next_hop_ip), None)

        if not next_device and egress_iface:
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

    if current_id == dest_id:
        dest_device = next(d for d in devices if d["id"] == dest_id)
        ingress_iface = None
        if hops:
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

    # Wrap hops in diagnostic structure
    path_node_ids = [h["device_id"] for h in hops]
    diag_res = build_path_hops_and_diagnostics(path_node_ids, devices, links)
    diag_res["alternate_paths"] = []
    return diag_res


def _get_route_output(conn_params: dict, dest_ip: str) -> str:
    with ConnectHandler(**conn_params) as net_connect:
        return net_connect.send_command(f"show ip route {dest_ip}")


def _parse_cisco_route(output: str) -> tuple[Optional[str], Optional[str]]:
    next_hop = None
    iface = None

    ip_match = re.search(r"\*?\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", output)
    if ip_match:
        next_hop = ip_match.group(1)

    iface_match = re.search(r"via\s+([A-Za-z0-9/.-]+)", output)
    if iface_match:
        matched = iface_match.group(1).strip()
        if not re.match(r"^\d", matched):
            iface = matched

    return next_hop, iface
