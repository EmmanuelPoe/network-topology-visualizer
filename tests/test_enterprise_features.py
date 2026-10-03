import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.auditor import analyze_topology_subnets, compute_topology_overview, audit_device_config


def test_analyze_topology_subnets():
    topology = {
        "nodes": [
            {
                "id": "R1",
                "name": "Router-1",
                "interfaces": [
                    {"name": "GigabitEthernet0/0", "ip": "10.0.0.1", "mask": "255.255.255.0"},
                    {"name": "GigabitEthernet0/1", "ip": "192.168.1.1", "mask": "255.255.255.252"},
                    {"name": "Loopback0", "ip": "172.16.0.1", "mask": "255.255.255.255"},
                ],
            },
            {
                "id": "R2",
                "name": "Router-2",
                "interfaces": [
                    {"name": "GigabitEthernet0/0", "ip": "10.0.0.2", "mask": "255.255.255.0"},
                    {"name": "GigabitEthernet0/1", "ip": "192.168.1.2", "mask": "255.255.255.252"},
                ],
            },
        ],
        "links": []
    }

    result = analyze_topology_subnets(topology)
    assert result["total_subnets"] == 3
    assert len(result["conflicts"]) == 0

    # Find the 10.0.0.0/24 subnet
    subnet_24 = next(s for s in result["subnets"] if s["network"] == "10.0.0.0/24")
    assert subnet_24["prefix_len"] == 24
    assert subnet_24["netmask"] == "255.255.255.0"
    assert subnet_24["wildcard"] == "0.0.0.255"
    assert subnet_24["broadcast"] == "10.0.0.255"
    assert subnet_24["usable_hosts"] == 254
    assert subnet_24["allocated_count"] == 2
    assert len(subnet_24["interfaces"]) == 2

    # Find the 192.168.1.0/30 subnet
    subnet_30 = next(s for s in result["subnets"] if s["network"] == "192.168.1.0/30")
    assert subnet_30["usable_hosts"] == 2
    assert subnet_30["allocated_count"] == 2
    assert subnet_30["utilization_percent"] == 100.0


def test_analyze_topology_subnets_conflict_detection():
    topology = {
        "nodes": [
            {
                "id": "R1",
                "interfaces": [
                    {"name": "Gi0/0", "ip": "10.10.10.5", "mask": "255.255.255.0"},
                ],
            },
            {
                "id": "SW1",
                "interfaces": [
                    {"name": "Vlan10", "ip": "10.10.10.5", "mask": "255.255.255.0"},
                ],
            },
        ],
        "links": []
    }

    result = analyze_topology_subnets(topology)
    assert len(result["conflicts"]) == 1
    conflict = result["conflicts"][0]
    assert conflict["ip"] == "10.10.10.5"
    assert len(conflict["devices"]) == 2
    assert conflict["devices"][0]["node_id"] == "R1"
    assert conflict["devices"][1]["node_id"] == "SW1"


def test_compute_topology_overview():
    topology = {
        "nodes": [
            {"id": "R1", "status": "online"},
            {"id": "R2", "status": "offline"},
            {"id": "SW1", "status": "online"},
        ],
        "links": [
            {"source": "R1", "target": "R2", "speed": "1000", "speed_mismatch": True},
            {"source": "R1", "target": "SW1", "speed": "1000", "speed_mismatch": False},
        ],
    }
    poller_states = {
        "R1": {"is_alive": True},
        "R2": {"is_alive": False},
        "SW1": {"is_alive": True},
    }

    overview = compute_topology_overview(topology, poller_states)
    assert overview["devices"]["total"] == 3
    assert overview["devices"]["online"] == 2
    assert overview["devices"]["offline"] == 1
    assert overview["links"]["total"] == 2
    assert overview["links"]["mismatches"] == 1
    assert overview["links"]["nominal"] == 1
    assert overview["ipam"]["subnets_count"] >= 0
    assert 0 <= overview["compliance"]["cis_score_percent"] <= 100


def test_remediation_cli_in_audit():
    raw_config = """
    hostname Core-Router
    enable password unencrypted
    service password-encryption
    line vty 0 4
     transport input telnet
    snmp-server community public RO
    """
    findings = audit_device_config(raw_config)
    assert len(findings) > 0
    for finding in findings:
        assert "remediation_cli" in finding
        assert "cis_rule_id" in finding
        assert len(finding["remediation_cli"]) > 0


@pytest.mark.asyncio
async def test_api_topology_ipam():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/topology/ipam")
        assert response.status_code == 200
        data = response.json()
        assert "total_subnets" in data
        assert "subnets" in data
        assert "conflicts" in data
        assert isinstance(data["subnets"], list)


@pytest.mark.asyncio
async def test_api_topology_overview():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/topology/overview")
        assert response.status_code == 200
        data = response.json()
        assert "devices" in data
        assert "links" in data
        assert "compliance" in data
        assert "ipam" in data
        assert "timestamp" in data
