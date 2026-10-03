import re
import ipaddress
import logging
from datetime import datetime, timezone
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Regex patterns for Cisco/multi-vendor configs
interface_re = re.compile(r"^\s*interface\s+(\S+)", re.IGNORECASE)
ip_re = re.compile(r"^\s*ip\s+address\s+(\S+)\s+(\S+)", re.IGNORECASE)
ip_cidr_re = re.compile(r"^\s*ip\s+address\s+(\S+/\d+)", re.IGNORECASE)
desc_re = re.compile(r"^\s*description\s+(.+)", re.IGNORECASE)
vlan_access_re = re.compile(r"^\s*switchport\s+access\s+vlan\s+(\d+)", re.IGNORECASE)
vlan_trunk_re = re.compile(
    r"^\s*switchport\s+trunk\s+allowed\s+vlan\s+(\S+)", re.IGNORECASE
)
vlan_native_re = re.compile(
    r"^\s*switchport\s+trunk\s+native\s+vlan\s+(\d+)", re.IGNORECASE
)
switchport_mode_re = re.compile(r"^\s*switchport\s+mode\s+(\S+)", re.IGNORECASE)
mtu_re = re.compile(r"^\s*(?:ip\s+)?mtu\s+(\d+)", re.IGNORECASE)
speed_re = re.compile(r"^\s*speed\s+(\S+)", re.IGNORECASE)
duplex_re = re.compile(r"^\s*duplex\s+(\S+)", re.IGNORECASE)


def parse_device_interfaces(config_text: str) -> Dict[str, Dict[str, Any]]:
    """
    Parses interface blocks from Cisco-style configurations.
    Returns a dict of interface configurations.
    """
    interfaces = {}
    if not config_text:
        return interfaces

    current_iface = None
    lines = config_text.splitlines()

    for line in lines:
        iface_match = interface_re.match(line)
        if iface_match:
            current_iface = iface_match.group(1).strip()
            interfaces[current_iface] = {
                "name": current_iface,
                "ip": None,
                "mask": None,
                "desc": "",
                "vlan_access": None,
                "vlan_trunk": None,
                "vlan_native": None,
                "mtu": None,
                "speed": None,
                "duplex": None,
                "mode": None,
            }
            continue

        if current_iface:
            # Check for commands inside interface context
            # IP Address
            ip_match = ip_re.match(line)
            if ip_match:
                interfaces[current_iface]["ip"] = ip_match.group(1).strip()
                interfaces[current_iface]["mask"] = ip_match.group(2).strip()
                continue

            ip_cidr_match = ip_cidr_re.match(line)
            if ip_cidr_match:
                try:
                    iface_ip = ipaddress.IPv4Interface(ip_cidr_match.group(1).strip())
                    interfaces[current_iface]["ip"] = str(iface_ip.ip)
                    interfaces[current_iface]["mask"] = str(iface_ip.netmask)
                except Exception:
                    pass
                continue

            # Description
            desc_match = desc_re.match(line)
            if desc_match:
                interfaces[current_iface]["desc"] = desc_match.group(1).strip()
                continue

            # VLAN Access
            vlan_acc_match = vlan_access_re.match(line)
            if vlan_acc_match:
                interfaces[current_iface]["vlan_access"] = int(
                    vlan_acc_match.group(1).strip()
                )
                interfaces[current_iface]["mode"] = "access"
                continue

            # VLAN Trunk
            vlan_tr_match = vlan_trunk_re.match(line)
            if vlan_tr_match:
                interfaces[current_iface]["vlan_trunk"] = vlan_tr_match.group(1).strip()
                interfaces[current_iface]["mode"] = "trunk"
                continue

            # VLAN Native
            vlan_nat_match = vlan_native_re.match(line)
            if vlan_nat_match:
                interfaces[current_iface]["vlan_native"] = int(
                    vlan_nat_match.group(1).strip()
                )
                continue

            # Switchport Mode
            mode_match = switchport_mode_re.match(line)
            if mode_match:
                interfaces[current_iface]["mode"] = mode_match.group(1).strip().lower()
                continue

            # MTU
            mtu_match = mtu_re.match(line)
            if mtu_match:
                interfaces[current_iface]["mtu"] = int(mtu_match.group(1).strip())
                continue

            # Speed
            speed_match = speed_re.match(line)
            if speed_match:
                interfaces[current_iface]["speed"] = (
                    speed_match.group(1).strip().lower()
                )
                continue

            # Duplex
            duplex_match = duplex_re.match(line)
            if duplex_match:
                interfaces[current_iface]["duplex"] = (
                    duplex_match.group(1).strip().lower()
                )
                continue

    # Set default native VLAN 1 for trunk interfaces if not explicitly configured
    for iface_name, iface in interfaces.items():
        if iface["mode"] == "trunk" or iface["vlan_trunk"] is not None:
            if iface["vlan_native"] is None:
                iface["vlan_native"] = 1

    return interfaces


def get_mock_interfaces_for_demo(device_id: str) -> Dict[str, Dict[str, Any]]:
    """
    Returns pre-configured interface properties to showcase protocol auditing mismatches
    in the default sample topology layout (where configs are null).
    """
    interfaces = {}

    # Define standard interfaces for each device
    # core-01
    if device_id == "core-01":
        interfaces["Gi1/0/1"] = {
            "name": "Gi1/0/1",
            "ip": "10.0.10.2",
            "mask": "255.255.255.252",
            "mtu": 1500,
            "speed": "auto",
            "mode": "routed",
        }
        interfaces["Gi1/0/2"] = {
            "name": "Gi1/0/2",
            "ip": "10.0.20.2",
            "mask": "255.255.255.252",
            "mtu": 1500,
            "speed": "auto",
            "mode": "routed",
        }
        interfaces["Gi2/0/1"] = {
            # Core link to core-02 (subnet match)
            "name": "Gi2/0/1",
            "ip": "10.0.0.1",
            "mask": "255.255.255.252",
            "mtu": 9000,
            "speed": "10g",
            "mode": "routed",
        }
        interfaces["Gi1/1/1"] = {
            # Trunk link to dist-01 (native VLAN mismatch & MTU/speed mismatch)
            "name": "Gi1/1/1",
            "ip": "10.1.1.1",
            "mask": "255.255.255.0",
            "vlan_native": 10,
            "mtu": 1500,
            "speed": "1000",
            "mode": "trunk",
        }

    # core-02
    elif device_id == "core-02":
        interfaces["Gi2/0/1"] = {
            # Subnet match on point-to-point link to core-01
            "name": "Gi2/0/1",
            "ip": "10.0.0.2",
            "mask": "255.255.255.252",
            "mtu": 9000,
            "speed": "10g",
            "mode": "routed",
        }
        interfaces["Gi1/1/1"] = {
            "name": "Gi1/1/1",
            "ip": "10.1.2.1",
            "mask": "255.255.255.0",
            "vlan_native": 1,
            "mtu": 1500,
            "speed": "10000",
            "mode": "trunk",
        }

    # fw-01
    elif device_id == "fw-01":
        interfaces["Eth1/1"] = {
            # Subnet mismatch on Palo Alto FW-01 Eth1/1 (10.0.10.5/30) ↔ Core-SW-01 Gi1/0/1 (10.0.10.2/30)
            "name": "Eth1/1",
            "ip": "10.0.10.5",
            "mask": "255.255.255.252",
            "mtu": 1500,
            "speed": "auto",
            "mode": "routed",
        }

    # dist-01
    elif device_id == "dist-01":
        interfaces["Gi1/0/24"] = {
            # Trunk link to core-01 (native VLAN mismatch: 20 vs 10, MTU mismatch: 9000 vs 1500, Speed mismatch: 10g vs 1g)
            "name": "Gi1/0/24",
            "ip": "10.1.1.2",
            "mask": "255.255.255.0",
            "vlan_native": 20,
            "mtu": 9000,
            "speed": "10000",
            "mode": "trunk",
        }
        interfaces["Gi1/0/1"] = {
            "name": "Gi1/0/1",
            "vlan_native": 1,
            "mtu": 1500,
            "speed": "1000",
            "mode": "trunk",
        }
        interfaces["Gi1/0/2"] = {
            "name": "Gi1/0/2",
            "vlan_native": 1,
            "mtu": 1500,
            "speed": "1000",
            "mode": "trunk",
        }

    # dist-02
    elif device_id == "dist-02":
        interfaces["Gi1/0/24"] = {
            "name": "Gi1/0/24",
            "ip": "10.1.2.2",
            "mask": "255.255.255.0",
            "vlan_native": 1,
            "mtu": 1500,
            "speed": "10000",
            "mode": "trunk",
        }
        interfaces["Gi1/0/1"] = {
            # Link to acc-03 (MTU mismatch: 1500 vs 9000)
            "name": "Gi1/0/1",
            "vlan_native": 1,
            "mtu": 1500,
            "speed": "1000",
            "mode": "trunk",
        }
        interfaces["Gi1/0/3"] = {
            "name": "Gi1/0/3",
            "vlan_native": 1,
            "mtu": 1500,
            "speed": "1000",
            "mode": "trunk",
        }

    # acc-03
    elif device_id == "acc-03":
        interfaces["Gi0/1"] = {
            # Link to dist-02 (MTU mismatch: 9000 vs 1500)
            "name": "Gi0/1",
            "vlan_native": 1,
            "mtu": 9000,
            "speed": "1000",
            "mode": "trunk",
        }

    # default fallback - generate standard settings based on interface name
    return interfaces


def audit_topology(topology: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyzes the topology and adds validation flags and detailed mismatch warnings
    to links.
    Returns the enriched topology dict.
    """
    devices = topology.get("devices", [])
    links = topology.get("links", [])

    # Map device ID to its human-readable label
    device_labels = {dev.get("id"): dev.get("label", dev.get("id")) for dev in devices}

    # Step 1: Gather interface parameters for all devices
    device_interfaces = {}
    for dev in devices:
        dev_id = dev.get("id")
        config_text = dev.get("config")
        explicit_interfaces = dev.get("interfaces")

        # Config compliance and security audit
        if config_text:
            dev["audit_findings"] = audit_device_config(config_text)
        else:
            # Generate mock findings to demonstrate the compliance tool on default layouts
            if dev_id == "core-01":
                dev["audit_findings"] = [
                    {
                        "category": "Security",
                        "severity": "CRITICAL",
                        "title": "Insecure Management Protocol (Telnet) Allowed",
                        "description": "Telnet is enabled on VTY lines 0-15. Replace with SSH ('transport input ssh').",
                        "cis_rule_id": "CIS-Cisco-2.1.1",
                        "framework": "CIS Controls / NIST AC-17",
                        "remediation_cli": "line vty 0 15\n transport input ssh\n login local",
                    },
                    {
                        "category": "Security",
                        "severity": "HIGH",
                        "title": "Weak SNMP Community String (public)",
                        "description": "Default SNMP read-only community string 'public' is active.",
                        "cis_rule_id": "CIS-Cisco-3.2.1",
                        "framework": "CIS Controls / NIST IA-2",
                        "remediation_cli": "no snmp-server community public\nsnmp-server group SECGROUP v3 priv\nsnmp-server user SECUSER SECGROUP v3 auth sha StrongAuthKey priv aes 128 StrongPrivKey",
                    },
                    {
                        "category": "Best Practice",
                        "severity": "INFO",
                        "title": "Syslog Logging Disabled",
                        "description": "No external syslog logging destination is configured.",
                        "cis_rule_id": "CIS-Cisco-4.1.1",
                        "framework": "CIS Controls / NIST AU-6",
                        "remediation_cli": "logging host 10.0.0.50\nlogging trap informational\nservice timestamps log datetime msec",
                    },
                ]
            elif dev_id == "fw-01":
                dev["audit_findings"] = [
                    {
                        "category": "Security",
                        "severity": "HIGH",
                        "title": "Password Encryption Disabled",
                        "description": "Global cleartext password encryption is not configured.",
                        "cis_rule_id": "CIS-Cisco-1.1.4",
                        "framework": "CIS Controls / NIST IA-5",
                        "remediation_cli": "service password-encryption",
                    },
                    {
                        "category": "Best Practice",
                        "severity": "INFO",
                        "title": "Missing Login Banner (MOTD)",
                        "description": "No message of the day login banner configured.",
                        "cis_rule_id": "CIS-Cisco-1.3.1",
                        "framework": "CIS Controls / NIST AC-8",
                        "remediation_cli": "banner motd ^C\n=======================================================\nAUTHORIZED ENTERPRISE ACCESS ONLY - ALL ACTIVITIES MONITORED\n=======================================================^C",
                    },
                ]
            else:
                dev["audit_findings"] = []

        if explicit_interfaces:
            iface_dict = {}
            for iface in explicit_interfaces:
                if isinstance(iface, dict):
                    iface_data = iface
                else:
                    iface_data = (
                        iface.model_dump()
                        if hasattr(iface, "model_dump")
                        else iface.dict()
                    )
                name = iface_data.get("name")
                if name:
                    iface_dict[name.lower().strip()] = iface_data

            # Set default native VLAN 1 for trunk interfaces if not explicitly configured
            for iface_name, iface in iface_dict.items():
                if iface.get("mode") == "trunk" and iface.get("vlan_native") is None:
                    iface["vlan_native"] = 1

            device_interfaces[dev_id] = iface_dict
        elif config_text:
            device_interfaces[dev_id] = parse_device_interfaces(config_text)
        else:
            device_interfaces[dev_id] = get_mock_interfaces_for_demo(dev_id)

    # Step 2: Audit each link
    for link in links:
        src_id = link.get("source")
        dst_id = link.get("target")
        src_iface_name = link.get("src_iface")
        dst_iface_name = link.get("dst_iface")

        link["vlan_mismatch"] = False
        link["subnet_mismatch"] = False
        link["mtu_mismatch"] = False
        link["speed_mismatch"] = False
        link["warnings"] = []

        if not src_iface_name or not dst_iface_name:
            continue

        src_label = device_labels.get(src_id, src_id)
        dst_label = device_labels.get(dst_id, dst_id)

        src_ifaces = device_interfaces.get(src_id, {})
        dst_ifaces = device_interfaces.get(dst_id, {})

        # Normalize interface name lookup (e.g. GigabitEthernet1/0/1 vs Gi1/0/1)
        def find_iface(iface_name, iface_dict):
            if not iface_name:
                return None
            name_clean = iface_name.lower().strip()
            # Direct match
            if name_clean in iface_dict:
                return iface_dict[name_clean]
            # Key starts with or contains
            for k, v in iface_dict.items():
                k_clean = k.lower().strip()
                # strip non-alphanumeric to compare, e.g. gigabitethernet101 vs gi101
                k_norm = (
                    re.sub(r"[^a-z0-9]", "", k_clean)
                    .replace("ethernet", "")
                    .replace("gigabit", "")
                    .replace("fast", "")
                    .replace("gi", "")
                    .replace("fa", "")
                    .replace("eth", "")
                )
                name_norm = (
                    re.sub(r"[^a-z0-9]", "", name_clean)
                    .replace("ethernet", "")
                    .replace("gigabit", "")
                    .replace("fast", "")
                    .replace("gi", "")
                    .replace("fa", "")
                    .replace("eth", "")
                )
                if k_norm == name_norm and k_norm != "":
                    return v
            # Fallback direct lookup
            return iface_dict.get(iface_name)

        src_iface = find_iface(src_iface_name, src_ifaces)
        dst_iface = find_iface(dst_iface_name, dst_ifaces)

        if not src_iface or not dst_iface:
            continue

        # 1. Native VLAN Audit (Trunks only)
        src_nat = src_iface.get("vlan_native")
        dst_nat = dst_iface.get("vlan_native")
        if src_nat is not None and dst_nat is not None:
            if src_nat != dst_nat:
                link["vlan_mismatch"] = True
                link["warnings"].append(
                    f"Native VLAN Mismatch: {src_label} ({src_iface_name}) uses VLAN {src_nat}, "
                    f"whereas {dst_label} ({dst_iface_name}) uses VLAN {dst_nat}."
                )

        # 2. Subnet Audit (Routed or IP-configured interfaces)
        src_ip = src_iface.get("ip")
        src_mask = src_iface.get("mask")
        dst_ip = dst_iface.get("ip")
        dst_mask = dst_iface.get("mask")

        if src_ip and src_mask and dst_ip and dst_mask:
            try:
                src_net = ipaddress.IPv4Interface(f"{src_ip}/{src_mask}")
                dst_net = ipaddress.IPv4Interface(f"{dst_ip}/{dst_mask}")

                # Check same IP conflict
                if src_net.ip == dst_net.ip:
                    link["subnet_mismatch"] = True
                    link["warnings"].append(
                        f"IP Address Conflict: Both {src_label} ({src_iface_name}) and {dst_label} ({dst_iface_name}) are configured with the same IP {src_ip}."
                    )
                # Check different subnets
                elif src_net.network != dst_net.network:
                    link["subnet_mismatch"] = True
                    link["warnings"].append(
                        f"Subnet Mismatch: {src_label} ({src_iface_name}) is configured with {src_ip}/{src_mask} "
                        f"(subnet {src_net.network}), but {dst_label} ({dst_iface_name}) has {dst_ip}/{dst_mask} "
                        f"(subnet {dst_net.network})."
                    )
            except Exception as e:
                logger.warning(
                    f"Error parsing subnet compatibility on link {src_id}-{dst_id}: {e}"
                )

        # 3. MTU Audit
        src_mtu = src_iface.get("mtu")
        dst_mtu = dst_iface.get("mtu")
        if src_mtu is not None and dst_mtu is not None:
            if src_mtu != dst_mtu:
                link["mtu_mismatch"] = True
                link["warnings"].append(
                    f"MTU Mismatch: {src_label} ({src_iface_name}) configured for MTU {src_mtu}, "
                    f"but {dst_label} ({dst_iface_name}) configured for MTU {dst_mtu}."
                )

        # 4. Speed Audit
        src_spd = src_iface.get("speed")
        dst_spd = dst_iface.get("speed")
        if src_spd is not None and dst_spd is not None:
            # We normalize speed values (e.g. 1000, 10g, auto)
            # If either is auto, we don't flag as speed mismatch because they auto-negotiate.
            if src_spd != "auto" and dst_spd != "auto" and src_spd != dst_spd:
                link["speed_mismatch"] = True
                link["warnings"].append(
                    f"Interface Speed Mismatch: {src_label} ({src_iface_name}) speed is set to {src_spd}, "
                    f"but {dst_label} ({dst_iface_name}) speed is set to {dst_spd}."
                )

    return topology


def audit_device_config(config_text: str) -> list[dict]:
    """
    Statically analyzes device configuration for security vulnerabilities and compliance issues.
    Returns a list of audit findings.
    """
    findings = []
    if not config_text:
        return findings

    # 1. Weak/Unencrypted Passwords
    # Check for unencrypted enable password
    if re.search(
        r"^\s*enable\s+password\s+(?!\d\s|\d\d\s|secret\s)\S+",
        config_text,
        re.MULTILINE | re.IGNORECASE,
    ):
        findings.append(
            {
                "category": "Security",
                "severity": "CRITICAL",
                "title": "Unencrypted Enable Password",
                "description": "An unhashed/cleartext enable password is configured. Use 'enable secret' instead.",
                "cis_rule_id": "CIS-Cisco-1.1.2",
                "framework": "CIS Controls / NIST IA-5",
                "remediation_cli": "enable secret <strong-password>\nno enable password",
            }
        )
    # Check for service password-encryption being disabled
    if re.search(
        r"^\s*no\s+service\s+password-encryption\b",
        config_text,
        re.MULTILINE | re.IGNORECASE,
    ):
        findings.append(
            {
                "category": "Security",
                "severity": "HIGH",
                "title": "Password Encryption Disabled",
                "description": "Cleartext password encryption is disabled ('no service password-encryption'). Unhashed passwords will be exposed in show run.",
                "cis_rule_id": "CIS-Cisco-1.1.4",
                "framework": "CIS Controls / NIST IA-5",
                "remediation_cli": "service password-encryption",
            }
        )

    # 2. Insecure Protocols
    # Check for Telnet allowed on VTY lines
    if re.search(
        r"^\s*transport\s+input\s+([^#\n\r]*\b(?:telnet|all)\b)",
        config_text,
        re.MULTILINE | re.IGNORECASE,
    ):
        findings.append(
            {
                "category": "Security",
                "severity": "CRITICAL",
                "title": "Insecure Management Protocol (Telnet) Allowed",
                "description": "Telnet is permitted on terminal lines (VTY), transmitting credentials in cleartext. Enforce 'transport input ssh' instead.",
                "cis_rule_id": "CIS-Cisco-2.1.1",
                "framework": "CIS Controls / NIST AC-17",
                "remediation_cli": "line vty 0 15\n transport input ssh\n login local",
            }
        )
    # Check for weak SNMP communities
    snmp_matches = re.findall(
        r"^\s*snmp-server\s+community\s+(\S+)\s+(RO|RW)",
        config_text,
        re.MULTILINE | re.IGNORECASE,
    )
    for community, access in snmp_matches:
        if community.lower() in ["public", "private", "admin", "cisco"]:
            findings.append(
                {
                    "category": "Security",
                    "severity": "HIGH",
                    "title": f"Weak SNMP Community String ({community})",
                    "description": f"A default/well-known SNMP community string '{community}' with {access} access is configured. Change it to a secure name.",
                    "cis_rule_id": "CIS-Cisco-3.2.1",
                    "framework": "CIS Controls / NIST IA-2",
                    "remediation_cli": f"no snmp-server community {community}\nsnmp-server group SECGROUP v3 priv\nsnmp-server user SECUSER SECGROUP v3 auth sha StrongAuthKey priv aes 128 StrongPrivKey",
                }
            )

    # 3. Missing Best Practices
    # Check for syslog logging
    if not re.search(
        r"^\s*logging\s+(?:host\s+)?(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|\S+)",
        config_text,
        re.MULTILINE | re.IGNORECASE,
    ):
        findings.append(
            {
                "category": "Best Practice",
                "severity": "INFO",
                "title": "Syslog Logging Disabled",
                "description": "No external syslog logging server is configured. Add a 'logging <ip>' directive for security event auditing.",
                "cis_rule_id": "CIS-Cisco-4.1.1",
                "framework": "CIS Controls / NIST AU-6",
                "remediation_cli": "logging host 10.0.0.50\nlogging trap informational\nservice timestamps log datetime msec",
            }
        )
    # Check for login banner
    if not re.search(r"^\s*banner\s+motd\b", config_text, re.MULTILINE | re.IGNORECASE):
        findings.append(
            {
                "category": "Best Practice",
                "severity": "INFO",
                "title": "Missing Login Banner (MOTD)",
                "description": "No Message of the Day (MOTD) banner is configured. A banner warning against unauthorized access is recommended for legal compliance.",
                "cis_rule_id": "CIS-Cisco-1.3.1",
                "framework": "CIS Controls / NIST AC-8",
                "remediation_cli": "banner motd ^C\n=======================================================\nAUTHORIZED ENTERPRISE ACCESS ONLY - ALL ACTIVITIES MONITORED\n=======================================================^C",
            }
        )
    # Check for domain-name
    if not re.search(
        r"^\s*ip\s+domain-name\b", config_text, re.MULTILINE | re.IGNORECASE
    ):
        findings.append(
            {
                "category": "Best Practice",
                "severity": "INFO",
                "title": "Missing Domain Name Configuration",
                "description": "No global IP domain-name is configured, which is required for generating SSH host keys.",
                "cis_rule_id": "CIS-Cisco-2.1.3",
                "framework": "CIS Controls / NIST SC-8",
                "remediation_cli": "ip domain-name corp.internal\ncrypto key generate rsa modulus 2048\nip ssh version 2",
            }
        )

    return findings


def analyze_topology_subnets(topology: Dict[str, Any]) -> Dict[str, Any]:
    """
    Enterprise IPAM & Subnet Analyzer.
    Aggregates all configured IP interfaces across devices and identifies
    subnets, address assignments, broadcast boundaries, utilization, and duplicate IP conflicts.
    """
    devices = topology.get("devices") or topology.get("nodes") or []
    subnets_map: Dict[str, Dict[str, Any]] = {}
    all_assigned_ips: Dict[str, list[dict]] = {}
    conflicts = []

    for dev in devices:
        dev_id = dev.get("id")
        dev_label = dev.get("label") or dev.get("name") or dev_id
        ifaces = dev.get("interfaces")
        if isinstance(ifaces, dict):
            ifaces = list(ifaces.values())
        elif not ifaces and dev.get("config"):
            parsed = parse_device_interfaces(dev["config"])
            ifaces = list(parsed.values())
        elif not ifaces:
            std = get_mock_interfaces_for_demo(dev_id)
            if std:
                ifaces = list(std.values())
            else:
                ifaces = []

        for iface in ifaces:
            if not isinstance(iface, dict):
                continue
            ip_str = iface.get("ip")
            mask_str = iface.get("mask")
            iface_name = iface.get("name", "Unknown")

            if not ip_str or not mask_str:
                continue

            try:
                iface_obj = ipaddress.IPv4Interface(f"{ip_str}/{mask_str}")
                net_obj = iface_obj.network
                cidr_str = str(net_obj)

                ip_clean = str(iface_obj.ip)
                if ip_clean not in all_assigned_ips:
                    all_assigned_ips[ip_clean] = []
                all_assigned_ips[ip_clean].append({
                    "device_id": dev_id,
                    "node_id": dev_id,
                    "device_label": dev_label,
                    "interface": iface_name,
                })

                if cidr_str not in subnets_map:
                    num_addresses = net_obj.num_addresses
                    if net_obj.prefixlen == 32:
                        usable_hosts = 1
                        usable_range = str(net_obj.network_address)
                    elif net_obj.prefixlen == 31:
                        usable_hosts = 2
                        usable_range = f"{net_obj.network_address} - {net_obj.broadcast_address}"
                    else:
                        usable_hosts = max(0, num_addresses - 2)
                        usable_range = f"{net_obj.network_address + 1} - {net_obj.broadcast_address - 1}"

                    subnets_map[cidr_str] = {
                        "cidr": cidr_str,
                        "network": cidr_str,
                        "network_address": str(net_obj.network_address),
                        "netmask": str(net_obj.netmask),
                        "wildcard": str(net_obj.hostmask),
                        "broadcast": str(net_obj.broadcast_address),
                        "prefix_len": net_obj.prefixlen,
                        "total_hosts": usable_hosts,
                        "usable_hosts": usable_hosts,
                        "usable_range": usable_range,
                        "assignments": [],
                        "interfaces": [],
                        "has_conflict": False,
                        "conflict_details": None,
                    }

                assignment_entry = {
                    "device_id": dev_id,
                    "node_id": dev_id,
                    "device_label": dev_label,
                    "interface": iface_name,
                    "ip": ip_clean,
                }
                subnets_map[cidr_str]["assignments"].append(assignment_entry)
                subnets_map[cidr_str]["interfaces"].append(assignment_entry)
            except Exception as e:
                logger.debug(f"IPAM parse error for {ip_str}/{mask_str}: {e}")

    # Check for IP conflicts (same IP on multiple interfaces)
    for ip, assigned_list in all_assigned_ips.items():
        if len(assigned_list) > 1:
            dev_refs = ", ".join(f"{a['device_label']}:{a['interface']}" for a in assigned_list)
            conflict_msg = f"Duplicate IP Conflict detected: {ip} is assigned to multiple interfaces ({dev_refs})"
            conflicts.append({
                "ip": ip,
                "message": conflict_msg,
                "targets": assigned_list,
                "devices": assigned_list,
            })
            for cidr, sdata in subnets_map.items():
                for a in sdata["assignments"]:
                    if a["ip"] == ip:
                        sdata["has_conflict"] = True
                        sdata["conflict_details"] = conflict_msg

    subnet_list = []
    for cidr_str, sdata in subnets_map.items():
        assigned_count = len(sdata["assignments"])
        sdata["assigned_hosts"] = assigned_count
        sdata["allocated_count"] = assigned_count
        if sdata["total_hosts"] > 0:
            util_pct = round(min(100.0, (assigned_count / sdata["total_hosts"]) * 100.0), 1)
        else:
            util_pct = 100.0
        sdata["utilization_pct"] = util_pct
        sdata["utilization_percent"] = util_pct
        subnet_list.append(sdata)

    def sort_key(s):
        try:
            return ipaddress.IPv4Network(s["cidr"]).network_address
        except Exception:
            return 0

    subnet_list.sort(key=sort_key)
    total_assigned = sum(len(s["assignments"]) for s in subnet_list)

    return {
        "total_subnets": len(subnet_list),
        "total_ips_assigned": total_assigned,
        "conflicts_count": len(conflicts),
        "conflicts": conflicts,
        "subnets": subnet_list,
    }


def compute_topology_overview(topology: Dict[str, Any], poller_states: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Computes high-level NOC dashboard KPIs:
    - Device health (online, offline, degraded)
    - Link health (healthy, MTU/VLAN/Subnet/Speed mismatches)
    - Security & CIS Compliance score (%)
    - IPAM subnet count and conflicts
    """
    devices = topology.get("devices") or topology.get("nodes") or []
    links = topology.get("links", [])
    poller_states = poller_states or {}

    total_devices = len(devices)
    online_count = 0
    offline_count = 0
    packet_loss_count = 0

    for dev in devices:
        dev_id = dev.get("id")
        pstate = poller_states.get(dev_id)
        if pstate:
            is_online = pstate.get("online") if "online" in pstate else pstate.get("is_alive", True)
            if not is_online:
                offline_count += 1
            else:
                online_count += 1
                if pstate.get("packet_loss", 0) > 0:
                    packet_loss_count += 1
        else:
            dev_status = dev.get("status", "online")
            if dev_status == "offline":
                offline_count += 1
            else:
                online_count += 1

    total_links = len(links)
    mismatch_links_count = 0
    for l in links:
        if (
            l.get("vlan_mismatch")
            or l.get("subnet_mismatch")
            or l.get("mtu_mismatch")
            or l.get("speed_mismatch")
            or (l.get("warnings") and len(l["warnings"]) > 0)
        ):
            mismatch_links_count += 1

    total_findings = 0
    crit_count = 0
    high_count = 0
    info_count = 0

    for dev in devices:
        for f in dev.get("audit_findings", []):
            total_findings += 1
            sev = f.get("severity", "").upper()
            if sev == "CRITICAL":
                crit_count += 1
            elif sev == "HIGH":
                high_count += 1
            else:
                info_count += 1

    deduction = (crit_count * 15) + (high_count * 8) + (info_count * 2)
    compliance_score = max(10, min(100, 100 - deduction)) if total_devices > 0 else 100

    ipam_summary = analyze_topology_subnets(topology)

    return {
        "devices": {
            "total": total_devices,
            "online": online_count,
            "offline": offline_count,
            "packet_loss": packet_loss_count,
        },
        "links": {
            "total": total_links,
            "nominal": total_links - mismatch_links_count,
            "mismatches": mismatch_links_count,
        },
        "compliance": {
            "score_pct": compliance_score,
            "cis_score_percent": compliance_score,
            "total_findings": total_findings,
            "critical": crit_count,
            "high": high_count,
            "info": info_count,
        },
        "ipam": {
            "subnets_count": ipam_summary.get("total_subnets", 0),
            "conflicts_count": ipam_summary.get("conflicts_count", 0),
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
