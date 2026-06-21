import zipfile
import io
from app.config_parser import ConfigTopologyParser


def create_mock_zip(configs_dict: dict[str, str]) -> bytes:
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        for filename, content in configs_dict.items():
            zip_file.writestr(filename, content)
    return zip_buffer.getvalue()


def test_config_parser():
    config1 = """
    !
    hostname Core-01
    !
    interface Loopback0
     ip address 1.1.1.1 255.255.255.255
    !
    interface GigabitEthernet1/1
     description Link to Core-02
     ip address 10.0.0.1 255.255.255.252
    !
    interface GigabitEthernet1/2
     description User Ports
     ip address 192.168.1.1 255.255.255.0
     switchport mode access
     switchport access vlan 10
    !
    """

    config2 = """
    !
    hostname Core-02
    !
    interface Loopback0
     ip address 2.2.2.2 255.255.255.255
    !
    interface GigabitEthernet1/1
     description Link to Core-01
     ip address 10.0.0.2 255.255.255.252
    !
    """

    configs = {
        "core_01.cfg": config1,
        "core_02.cfg": config2,
    }

    zip_bytes = create_mock_zip(configs)

    parser = ConfigTopologyParser()
    result = parser.parse_zip(zip_bytes)

    # Assert devices are parsed
    devices = {d["id"]: d for d in result["devices"]}
    assert "Core-01" in devices
    assert "Core-02" in devices

    # Check details of Core-01
    dev1 = devices["Core-01"]
    assert dev1["type"] == "switch"  # Has switchport keywords
    assert dev1["layer"] == "core"
    assert dev1["ip"] == "1.1.1.1"  # Loopback or first IP found

    # Check details of Core-02
    dev2 = devices["Core-02"]
    assert dev2["ip"] == "2.2.2.2"

    # Assert links are discovered
    links = result["links"]
    assert len(links) >= 1

    # Check OSPF / Subnet link
    link = links[0]
    assert link["source"] == "Core-01" or link["target"] == "Core-01"
    assert link["source"] == "Core-02" or link["target"] == "Core-02"
    assert link["src_iface"] == "GigabitEthernet1/1"
    assert link["dst_iface"] == "GigabitEthernet1/1"
