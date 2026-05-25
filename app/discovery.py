import time
import logging
from typing import Dict, List, Any

# Set up simple logging
logger = logging.getLogger(__name__)


class DiscoveryEngine:
    def __init__(
        self, seed_ip: str, username: str, password: str, platform: str, max_depth: int
    ):
        self.seed_ip = seed_ip
        self.username = username
        self.password = password
        self.platform = platform
        self.max_depth = max_depth
        self.devices = {}
        self.links = []

    def discover(self) -> Dict[str, List[Any]]:
        """Override this method to implement discovery."""
        raise NotImplementedError


class MockDiscoveryEngine(DiscoveryEngine):
    """
    Simulates a discovery process without needing a real network lab.
    It builds a fake tree of devices starting from the seed IP.
    """

    def discover(self) -> Dict[str, List[Any]]:
        # Simulate network delay
        time.sleep(2)

        # Hardcoded mock topology
        # Assuming seed_ip is the core switch
        core_id = f"core-{self.seed_ip.replace('.', '-')}"

        self.devices[core_id] = {
            "id": core_id,
            "label": f"Core Switch ({self.seed_ip})",
            "type": "switch",
            "layer": "core",
            "ip": self.seed_ip,
            "platform": self.platform,
        }

        if self.max_depth > 0:
            # Add distribution switches
            for i in range(1, 3):
                dist_id = f"dist-{i}"
                self.devices[dist_id] = {
                    "id": dist_id,
                    "label": f"Distribution {i}",
                    "type": "switch",
                    "layer": "distribution",
                    "platform": self.platform,
                }
                self.links.append(
                    {
                        "source": core_id,
                        "target": dist_id,
                        "src_iface": f"TenGig1/0/{i}",
                        "dst_iface": "TenGig1/0/1",
                        "protocol": "LLDP",
                    }
                )

                if self.max_depth > 1:
                    # Add access switches
                    for j in range(1, 4):
                        access_id = f"access-{i}-{j}"
                        self.devices[access_id] = {
                            "id": access_id,
                            "label": f"Access {i}-{j}",
                            "type": "switch",
                            "layer": "access",
                            "platform": self.platform,
                        }
                        self.links.append(
                            {
                                "source": dist_id,
                                "target": access_id,
                                "src_iface": f"Gig1/0/{j}",
                                "dst_iface": "Gig1/0/1",
                                "protocol": "LLDP",
                            }
                        )

        return {"devices": list(self.devices.values()), "links": self.links}


class NetmikoDiscoveryEngine(DiscoveryEngine):
    """
    Real discovery using Netmiko.
    """

    def _parse_address(self, addr: str) -> tuple[str, int | None]:
        if not addr:
            return "", None
        addr = addr.strip()
        if ":" in addr:
            parts = addr.split(":")
            host = parts[0]
            try:
                port = int(parts[1])
                return host, port
            except ValueError:
                return host, None
        return addr, None

    def _guess_device_type(self, hostname: str, capabilities: str) -> str:
        h = hostname.lower()
        caps = capabilities.lower() if capabilities else ""
        if "ap" in h or "wireless" in h or "wlan" in h or "w" in caps:
            return "wireless"
        if "fw" in h or "firewall" in h or "asa" in h:
            return "firewall"
        if "rt" in h or "router" in h or "rtr" in h or "gw" in h or "r" in caps:
            return "router"
        if (
            "sw" in h
            or "switch" in h
            or "cat" in h
            or "bridge" in h
            or "s" in caps
            or "b" in caps
        ):
            return "switch"
        return "switch"

    def _guess_device_layer(self, hostname: str, depth: int) -> str:
        h = hostname.lower()
        if "core" in h or "csr" in h:
            return "core"
        if "dist" in h or "dsw" in h:
            return "distribution"
        if "acc" in h or "asw" in h:
            return "access"
        if "edge" in h or "gw" in h:
            return "edge"
        if "inet" in h or "internet" in h or "cloud" in h:
            return "internet"

        # Fallback based on depth
        if depth == 0:
            return "core"
        elif depth == 1:
            return "distribution"
        else:
            return "access"

    def discover(self) -> Dict[str, List[Any]]:
        try:
            from netmiko import ConnectHandler
        except ImportError:
            logger.error("Netmiko is not installed.")
            return {"devices": [], "links": []}

        import re

        queue = [(self.seed_ip, 0)]
        visited_connections = set()
        visited_hostnames = set()

        while queue:
            ip_str, depth = queue.pop(0)
            host, port = self._parse_address(ip_str)
            if not host:
                continue

            conn_key = (host, port)
            if conn_key in visited_connections:
                continue
            visited_connections.add(conn_key)

            logger.info(f"Connecting to {host}:{port or 22} at depth {depth}")
            device_params = {
                "device_type": self.platform,
                "host": host,
                "username": self.username,
                "password": self.password,
            }
            if port is not None:
                device_params["port"] = port

            net_connect = None
            try:
                net_connect = ConnectHandler(**device_params)
                prompt = net_connect.find_prompt()

                # Sanitize prompt to extract hostname
                hostname = re.sub(r"\(config\)?$", "", prompt.strip())
                hostname = hostname.rstrip(">#").strip()
                if not hostname:
                    hostname = host

                logger.info(f"Connected to device. Sanitize hostname: {hostname}")

                # Check if this hostname was already visited
                if hostname in visited_hostnames:
                    logger.info(
                        f"Hostname {hostname} already visited, skipping neighbors."
                    )
                    net_connect.disconnect()
                    continue
                visited_hostnames.add(hostname)

                # Guess type and layer
                dev_type = self._guess_device_type(hostname, "")
                dev_layer = self._guess_device_layer(hostname, depth)

                # Add current device
                self.devices[hostname] = {
                    "id": hostname,
                    "label": hostname,
                    "type": dev_type,
                    "layer": dev_layer,
                    "ip": host,
                    "platform": self.platform,
                }

                # Define vendor-specific commands
                platform_cmds = {
                    "cisco_ios": {
                        "lldp": "show lldp neighbors detail",
                        "cdp": "show cdp neighbors detail",
                    },
                    "cisco_nxos": {
                        "lldp": "show lldp neighbors detail",
                        "cdp": "show cdp neighbors detail",
                    },
                    "arista_eos": {
                        "lldp": "show lldp neighbors detail",
                        "cdp": "show cdp neighbors detail",
                    },
                    "juniper_junos": {
                        "lldp": "show lldp neighbors detail",
                        "cdp": "show cdp neighbors detail",
                    },
                }

                plat_cmds = platform_cmds.get(self.platform, platform_cmds["cisco_ios"])
                lldp_cmd = plat_cmds.get("lldp", "show lldp neighbors detail")
                cdp_cmd = plat_cmds.get("cdp", "show cdp neighbors detail")

                # Try LLDP neighbors first
                neighbors = []
                proto = "LLDP"
                try:
                    logger.info(f"Retrieving LLDP neighbors via command: {lldp_cmd}...")
                    lldp_out = net_connect.send_command(lldp_cmd, use_textfsm=True)
                    if isinstance(lldp_out, list) and len(lldp_out) > 0:
                        neighbors = lldp_out
                except Exception as e:
                    logger.warning(f"Failed to get LLDP neighbors: {e}")

                # Fallback to CDP neighbors
                if not neighbors:
                    try:
                        logger.info(
                            f"Retrieving CDP neighbors via command: {cdp_cmd}..."
                        )
                        cdp_out = net_connect.send_command(cdp_cmd, use_textfsm=True)
                        if isinstance(cdp_out, list) and len(cdp_out) > 0:
                            neighbors = cdp_out
                            proto = "CDP"
                    except Exception as e:
                        logger.warning(f"Failed to get CDP neighbors: {e}")

                logger.info(f"Found {len(neighbors)} neighbors via {proto}")

                for neigh in neighbors:
                    # Normalize neighbor name across multiple vendor TextFSM templates
                    neigh_name = (
                        neigh.get("neighbor_name")
                        or neigh.get("system_name")
                        or neigh.get("remote_system_name")
                        or neigh.get("dest_host")
                        or neigh.get("device_id")
                        or ""
                    )
                    # Remove domain suffix if present
                    neigh_name = neigh_name.split(".")[0].strip()
                    if not neigh_name:
                        continue

                    # Normalize management IP address
                    neigh_ip = (
                        neigh.get("mgmt_address")
                        or neigh.get("management_address")
                        or neigh.get("remote_management_address")
                        or neigh.get("mgmt_ip")
                        or neigh.get("ip_address")
                        or ""
                    )
                    if isinstance(neigh_ip, list):
                        neigh_ip = neigh_ip[0] if len(neigh_ip) > 0 else ""
                    neigh_ip = neigh_ip.strip()

                    # Guess neighbor attributes
                    neigh_caps = (
                        neigh.get("capabilities")
                        or neigh.get("enabled_capabilities")
                        or neigh.get("remote_capabilities")
                        or ""
                    )
                    if isinstance(neigh_caps, list):
                        neigh_caps = " ".join(neigh_caps)
                    neigh_type = self._guess_device_type(neigh_name, neigh_caps)
                    neigh_layer = self._guess_device_layer(neigh_name, depth + 1)

                    # Add neighbor device if not already present
                    if neigh_name not in self.devices:
                        self.devices[neigh_name] = {
                            "id": neigh_name,
                            "label": neigh_name,
                            "type": neigh_type,
                            "layer": neigh_layer,
                            "ip": neigh_ip.split(":")[0] if neigh_ip else None,
                            "platform": None,
                        }

                    # Normalize local/neighbor interfaces
                    local_iface = (
                        neigh.get("local_interface")
                        or neigh.get("local_port")
                        or neigh.get("parent_interface")
                        or neigh.get("interface")
                        or ""
                    )
                    neigh_iface = (
                        neigh.get("neighbor_interface")
                        or neigh.get("port_id")
                        or neigh.get("neighbor_port_id")
                        or neigh.get("remote_port_id")
                        or neigh.get("port_info")
                        or ""
                    )

                    # Deduplicate links
                    link_exists = False
                    for lnk in self.links:
                        if (
                            lnk["source"] == hostname and lnk["target"] == neigh_name
                        ) or (
                            lnk["source"] == neigh_name and lnk["target"] == hostname
                        ):
                            link_exists = True
                            break
                    if not link_exists:
                        self.links.append(
                            {
                                "source": hostname,
                                "target": neigh_name,
                                "src_iface": local_iface,
                                "dst_iface": neigh_iface,
                                "protocol": proto,
                            }
                        )

                    # Enqueue neighbor if within max_depth
                    if depth < self.max_depth and neigh_ip:
                        n_host, n_port = self._parse_address(neigh_ip)
                        if (n_host, n_port) not in visited_connections:
                            queue.append((neigh_ip, depth + 1))

                net_connect.disconnect()

            except Exception as e:
                logger.error(f"Failed to discover device at {host}:{port or 22}: {e}")
                if net_connect:
                    try:
                        net_connect.disconnect()
                    except Exception:
                        pass

        return {"devices": list(self.devices.values()), "links": self.links}
