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

    def discover(self) -> Dict[str, List[Any]]:
        try:
            from netmiko import ConnectHandler  # noqa: F401
        except ImportError:
            logger.error("Netmiko is not installed.")
            return {"devices": [], "links": []}

        # NOTE: This is a stub implementation.
        # A real implementation would:
        # 1. SSH to seed_ip
        # 2. Run 'show lldp neighbors detail' with use_textfsm=True
        # 3. Parse neighbors, add to devices/links list
        # 4. Recursively SSH to neighbors up to max_depth
        #
        # For now, it returns an empty topology.
        logger.info(f"Netmiko discovery stub called for {self.seed_ip}")
        return {"devices": [], "links": []}
