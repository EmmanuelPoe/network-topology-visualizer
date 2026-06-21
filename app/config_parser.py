import re
import ipaddress
import zipfile
import io
import logging
from pathlib import Path
from typing import Dict, List, Any

logger = logging.getLogger(__name__)


class ConfigTopologyParser:
    """
    Parses directory or ZIP of network configurations to reconstruct the topology.
    """

    def __init__(self):
        self.devices = {}
        self.links = []

    def parse_zip(self, zip_bytes: bytes) -> Dict[str, List[Any]]:
        """Reads a zip archive of configuration files and returns a parsed topology dict."""
        configs = {}
        try:
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
                for filename in z.namelist():
                    # Skip directories or macOS metadata
                    if (
                        filename.endswith("/")
                        or "__MACOSX" in filename
                        or filename.startswith(".")
                    ):
                        continue
                    try:
                        with z.open(filename) as f:
                            configs[filename] = f.read().decode(
                                "utf-8", errors="ignore"
                            )
                    except Exception as e:
                        logger.warning(f"Failed to read file {filename} from zip: {e}")
        except Exception as e:
            logger.error(f"Failed to open zip archive: {e}")
            return {"devices": [], "links": []}

        return self.parse_configs(configs)

    def _guess_device_type(self, hostname: str, config_text: str) -> str:
        h = hostname.lower()
        if "ap" in h or "wireless" in h or "wlan" in h:
            return "wireless"
        if "fw" in h or "firewall" in h or "asa" in h or "palo" in h:
            return "firewall"
        if "rt" in h or "router" in h or "rtr" in h or "gw" in h:
            return "router"
        if "sw" in h or "switch" in h or "cat" in h or "dist" in h or "acc" in h:
            return "switch"

        # Look for keywords in config
        if "switchport" in config_text or "spanning-tree" in config_text:
            return "switch"
        if (
            "router ospf" in config_text
            or "router bgp" in config_text
            or "ip routing" in config_text
        ):
            return "router"

        return "switch"

    def _guess_device_layer(self, hostname: str) -> str:
        h = hostname.lower()
        if "core" in h or "csr" in h:
            return "core"
        if "dist" in h or "dsw" in h:
            return "distribution"
        if "acc" in h or "asw" in h:
            return "access"
        if "edge" in h or "gw" in h or "fw" in h:
            return "edge"
        if "inet" in h or "internet" in h or "cloud" in h:
            return "internet"
        return "access"

    def parse_configs(self, configs: Dict[str, str]) -> Dict[str, List[Any]]:
        parsed_devices = {}

        # Regex patterns
        hostname_re = re.compile(r"^\s*hostname\s+(\S+)", re.IGNORECASE | re.MULTILINE)
        interface_re = re.compile(r"^\s*interface\s+(\S+)", re.IGNORECASE)
        ip_re = re.compile(r"^\s*ip\s+address\s+(\S+)\s+(\S+)", re.IGNORECASE)
        ip_cidr_re = re.compile(r"^\s*ip\s+address\s+(\S+/\d+)", re.IGNORECASE)
        desc_re = re.compile(r"^\s*description\s+(.+)", re.IGNORECASE)
        vlan_access_re = re.compile(
            r"^\s*switchport\s+access\s+vlan\s+(\d+)", re.IGNORECASE
        )
        vlan_trunk_re = re.compile(
            r"^\s*switchport\s+trunk\s+allowed\s+vlan\s+(\S+)", re.IGNORECASE
        )

        for filename, text in configs.items():
            # Find hostname
            hostname_match = hostname_re.search(text)
            if hostname_match:
                hostname = hostname_match.group(1).strip()
            else:
                # Fallback to filename without extension
                hostname = Path(filename).stem

            # Clean hostname (remove trailing semicolons, configs quotes, etc.)
            hostname = hostname.replace('"', "").replace("'", "").strip()

            device_info = {
                "id": hostname,
                "label": hostname,
                "type": self._guess_device_type(hostname, text),
                "layer": self._guess_device_layer(hostname),
                "ip": None,
                "platform": None,
                "config": text,
                "interfaces": {},
            }

            # Parse interfaces
            lines = text.splitlines()
            current_iface = None

            for line in lines:
                iface_match = interface_re.match(line)
                if iface_match:
                    current_iface = iface_match.group(1).strip()
                    device_info["interfaces"][current_iface] = {
                        "name": current_iface,
                        "ip": None,
                        "mask": None,
                        "desc": "",
                        "vlan_access": None,
                        "vlan_trunk": None,
                    }
                    continue

                if current_iface:
                    # Check if interface block ends (any line starting with no whitespace and not being interface/! etc.)
                    # Typically interface block is indented, but we check if we hit another top-level command
                    if line.startswith("!") or (
                        len(line) > 0
                        and not line[0].isspace()
                        and not line.startswith("interface")
                    ):
                        # Some configurations don't indent commands under interface blocks.
                        # But standard Cisco/Arista does.
                        # To be safe, if a line starts with a non-whitespace character and is not an interface,
                        # we close the interface context EXCEPT if it's one of the commands inside.
                        # Let's check for standard keywords first.
                        pass

                    # Parse IP Address (DDN format: ip address 10.0.0.1 255.255.255.252)
                    ip_match = ip_re.match(line)
                    if ip_match:
                        device_info["interfaces"][current_iface]["ip"] = ip_match.group(
                            1
                        ).strip()
                        device_info["interfaces"][current_iface]["mask"] = (
                            ip_match.group(2).strip()
                        )
                        if not device_info["ip"] or current_iface.lower().startswith(
                            "loopback"
                        ):
                            device_info["ip"] = ip_match.group(1).strip()
                        continue

                    # Parse IP Address (CIDR format: ip address 10.0.0.1/30)
                    ip_cidr_match = ip_cidr_re.match(line)
                    if ip_cidr_match:
                        try:
                            iface_ip = ipaddress.IPv4Interface(
                                ip_cidr_match.group(1).strip()
                            )
                            device_info["interfaces"][current_iface]["ip"] = str(
                                iface_ip.ip
                            )
                            device_info["interfaces"][current_iface]["mask"] = str(
                                iface_ip.netmask
                            )
                            if not device_info[
                                "ip"
                            ] or current_iface.lower().startswith("loopback"):
                                device_info["ip"] = str(iface_ip.ip)
                        except Exception:
                            pass
                        continue

                    # Parse Description
                    desc_match = desc_re.match(line)
                    if desc_match:
                        device_info["interfaces"][current_iface]["desc"] = (
                            desc_match.group(1).strip()
                        )
                        continue

                    # Parse VLAN access
                    vlan_acc_match = vlan_access_re.match(line)
                    if vlan_acc_match:
                        device_info["interfaces"][current_iface]["vlan_access"] = (
                            vlan_acc_match.group(1).strip()
                        )
                        continue

                    # Parse VLAN trunk
                    vlan_tr_match = vlan_trunk_re.match(line)
                    if vlan_tr_match:
                        device_info["interfaces"][current_iface]["vlan_trunk"] = (
                            vlan_tr_match.group(1).strip()
                        )
                        continue

            parsed_devices[hostname] = device_info

        # Reconstruct links via Subnet Correlation and Description Correlation
        discovered_links = []
        visited_pairs = set()

        hostnames = list(parsed_devices.keys())
        for i in range(len(hostnames)):
            for j in range(i + 1, len(hostnames)):
                host_a = hostnames[i]
                host_b = hostnames[j]

                dev_a = parsed_devices[host_a]
                dev_b = parsed_devices[host_b]

                # Check for shared subnets
                for if_a_name, if_a in dev_a["interfaces"].items():
                    # Skip loopbacks
                    if (
                        if_a_name.lower().startswith("loopback")
                        or not if_a["ip"]
                        or not if_a["mask"]
                    ):
                        continue

                    for if_b_name, if_b in dev_b["interfaces"].items():
                        if (
                            if_b_name.lower().startswith("loopback")
                            or not if_b["ip"]
                            or not if_b["mask"]
                        ):
                            continue

                        # Compare subnets
                        try:
                            net_a = ipaddress.IPv4Interface(
                                f"{if_a['ip']}/{if_a['mask']}"
                            )
                            net_b = ipaddress.IPv4Interface(
                                f"{if_b['ip']}/{if_b['mask']}"
                            )

                            # If they belong to the same subnet (and are not the same IP address)
                            # Exclude typical /24 management subnets or standard large networks to prevent linking everything
                            # Typically /30 or /31 are point-to-point links.
                            # We allow subnet masks smaller than 24 (e.g. prefix length >= 24) but exclude loops.
                            prefix_len = net_a.network.prefixlen
                            if (
                                prefix_len >= 24
                                and net_a.network == net_b.network
                                and net_a.ip != net_b.ip
                            ):
                                link_key = tuple(
                                    sorted(
                                        [
                                            f"{host_a}:{if_a_name}",
                                            f"{host_b}:{if_b_name}",
                                        ]
                                    )
                                )
                                if link_key not in visited_pairs:
                                    visited_pairs.add(link_key)
                                    discovered_links.append(
                                        {
                                            "source": host_a,
                                            "target": host_b,
                                            "src_iface": if_a_name,
                                            "dst_iface": if_b_name,
                                            "protocol": "OSPF"
                                            if "ospf" in dev_a["config"].lower()
                                            else "Subnet",
                                            "bandwidth": "1G",
                                        }
                                    )
                        except Exception:
                            pass

                # Check for description correlation if no subnet link was found
                # e.g., description "Link to dist-1 Gig1/0/1"
                for if_a_name, if_a in dev_a["interfaces"].items():
                    desc_a = if_a["desc"].lower()
                    if not desc_a:
                        continue
                    if host_b.lower() in desc_a:
                        # Extract port from description if possible
                        # e.g., GigabitEthernet1/0/1 or Gi1/0/1
                        port_match = re.search(
                            r"(gi\S+|fa\S+|te\S+|eth\S+|xe\S+|ge\S+|gigabitethernet\S+|ethernet\S+)",
                            desc_a,
                        )
                        matched_b_port = port_match.group(1) if port_match else None

                        if matched_b_port:
                            # Verify if host_b has an interface matching this
                            for if_b_name in dev_b["interfaces"].keys():
                                # Simple matching: e.g. "Gi1/0/1" in "GigabitEthernet1/0/1" or vice-versa
                                norm_a = (
                                    matched_b_port.replace("ethernet", "")
                                    .replace("gigabit", "")
                                    .replace("gi", "")
                                    .replace("eth", "")
                                )
                                norm_b = (
                                    if_b_name.lower()
                                    .replace("ethernet", "")
                                    .replace("gigabit", "")
                                    .replace("gi", "")
                                    .replace("eth", "")
                                )
                                if (
                                    norm_a == norm_b
                                    or norm_a in norm_b
                                    or norm_b in norm_a
                                ):
                                    link_key = tuple(
                                        sorted(
                                            [
                                                f"{host_a}:{if_a_name}",
                                                f"{host_b}:{if_b_name}",
                                            ]
                                        )
                                    )
                                    if link_key not in visited_pairs:
                                        visited_pairs.add(link_key)
                                        discovered_links.append(
                                            {
                                                "source": host_a,
                                                "target": host_b,
                                                "src_iface": if_a_name,
                                                "dst_iface": if_b_name,
                                                "protocol": "Static",
                                                "bandwidth": "1G",
                                            }
                                        )

        # Format output
        devices_out = []
        for hostname, dev in parsed_devices.items():
            devices_out.append(
                {
                    "id": dev["id"],
                    "label": dev["label"],
                    "type": dev["type"],
                    "layer": dev["layer"],
                    "ip": dev["ip"],
                    "platform": "Cisco IOS",  # Default parsed platform
                    "config": dev["config"],
                }
            )

        return {"devices": devices_out, "links": discovered_links}
