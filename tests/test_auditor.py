from app.auditor import parse_device_interfaces, audit_topology


def test_parse_device_interfaces():
    config = """
    !
    interface GigabitEthernet1/0/1
     description Trunk Link to switch2
     switchport mode trunk
     switchport trunk allowed vlan 10,20,30
     switchport trunk native vlan 99
     mtu 9000
     speed 10000
     duplex full
    !
    interface GigabitEthernet1/0/2
     description Access Link
     switchport access vlan 10
     mtu 1500
     speed auto
    !
    interface GigabitEthernet1/0/3
     description Routed interface
     ip address 10.0.0.1 255.255.255.252
    !
    """
    ifaces = parse_device_interfaces(config)

    assert "GigabitEthernet1/0/1" in ifaces
    assert ifaces["GigabitEthernet1/0/1"]["vlan_native"] == 99
    assert ifaces["GigabitEthernet1/0/1"]["mtu"] == 9000
    assert ifaces["GigabitEthernet1/0/1"]["speed"] == "10000"
    assert ifaces["GigabitEthernet1/0/1"]["mode"] == "trunk"

    assert "GigabitEthernet1/0/2" in ifaces
    assert ifaces["GigabitEthernet1/0/2"]["vlan_access"] == 10
    assert ifaces["GigabitEthernet1/0/2"]["mtu"] == 1500
    assert ifaces["GigabitEthernet1/0/2"]["speed"] == "auto"
    assert ifaces["GigabitEthernet1/0/2"]["mode"] == "access"

    assert "GigabitEthernet1/0/3" in ifaces
    assert ifaces["GigabitEthernet1/0/3"]["ip"] == "10.0.0.1"
    assert ifaces["GigabitEthernet1/0/3"]["mask"] == "255.255.255.252"


def test_audit_topology():
    config_sw1 = """
    interface GigabitEthernet1/1
     switchport mode trunk
     switchport trunk native vlan 10
     mtu 1500
     speed 1000
    interface GigabitEthernet1/2
     ip address 192.168.1.1 255.255.255.0
    """

    config_sw2 = """
    interface GigabitEthernet1/1
     switchport mode trunk
     switchport trunk native vlan 20
     mtu 9000
     speed 10000
    interface GigabitEthernet1/2
     ip address 192.168.2.1 255.255.255.0
    """

    topology = {
        "devices": [
            {
                "id": "sw1",
                "label": "Switch 1",
                "type": "switch",
                "layer": "core",
                "config": config_sw1,
            },
            {
                "id": "sw2",
                "label": "Switch 2",
                "type": "switch",
                "layer": "core",
                "config": config_sw2,
            },
        ],
        "links": [
            {
                "source": "sw1",
                "target": "sw2",
                "src_iface": "GigabitEthernet1/1",
                "dst_iface": "GigabitEthernet1/1",
            },
            {
                "source": "sw1",
                "target": "sw2",
                "src_iface": "GigabitEthernet1/2",
                "dst_iface": "GigabitEthernet1/2",
            },
        ],
    }

    result = audit_topology(topology)
    links = result["links"]

    # Check Trunk link mismatches (native VLAN, MTU, speed)
    trunk_link = next(lnk for lnk in links if lnk["src_iface"] == "GigabitEthernet1/1")
    assert trunk_link["vlan_mismatch"] is True
    assert trunk_link["mtu_mismatch"] is True
    assert trunk_link["speed_mismatch"] is True
    assert len(trunk_link["warnings"]) == 3
    assert any("VLAN" in w for w in trunk_link["warnings"])
    assert any("MTU" in w for w in trunk_link["warnings"])
    assert any("Speed" in w for w in trunk_link["warnings"])

    # Check Subnet mismatch link
    routed_link = next(lnk for lnk in links if lnk["src_iface"] == "GigabitEthernet1/2")
    assert routed_link["subnet_mismatch"] is True
    assert len(routed_link["warnings"]) == 1
    assert any("Subnet" in w for w in routed_link["warnings"])


def test_audit_topology_with_explicit_interfaces():
    topology = {
        "devices": [
            {
                "id": "rtr-01",
                "label": "Router 1",
                "type": "router",
                "interfaces": [
                    {
                        "name": "Gi0/1",
                        "mode": "routed",
                        "ip": "10.0.1.1",
                        "mask": "255.255.255.252",
                        "mtu": 1500,
                        "speed": "1000",
                    }
                ],
            },
            {
                "id": "rtr-02",
                "label": "Router 2",
                "type": "router",
                "interfaces": [
                    {
                        "name": "Gi0/1",
                        "mode": "routed",
                        "ip": "10.0.1.5",  # Subnet mismatch (10.0.1.0/30 vs 10.0.1.4/30)
                        "mask": "255.255.255.252",
                        "mtu": 9000,  # MTU mismatch
                        "speed": "10000",  # Speed mismatch
                    }
                ],
            },
        ],
        "links": [
            {
                "source": "rtr-01",
                "target": "rtr-02",
                "src_iface": "Gi0/1",
                "dst_iface": "Gi0/1",
            }
        ],
    }

    result = audit_topology(topology)
    link = result["links"][0]

    assert link["subnet_mismatch"] is True
    assert link["mtu_mismatch"] is True
    assert link["speed_mismatch"] is True
    assert len(link["warnings"]) == 3
    assert any("Subnet" in w for w in link["warnings"])
    assert any("MTU" in w for w in link["warnings"])
    assert any("Speed" in w for w in link["warnings"])
