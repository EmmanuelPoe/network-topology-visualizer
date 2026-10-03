import pytest
from fastapi.testclient import TestClient
from app.main import app, manager

client = TestClient(app)


def test_poll_all_endpoint():
    manager.latest_topology = {
        "devices": [
            {
                "id": "rtr-core",
                "label": "Core Router",
                "type": "router",
                "layer": "core",
                "ip": "10.99.1.1",
                "interfaces": [
                    {"name": "Gi0/0", "mtu": 1500, "speed": "1000", "mode": "routed"},
                    {"name": "Gi0/1", "mtu": 1500, "speed": "1000", "mode": "routed"}
                ]
            },
            {
                "id": "sw-access",
                "label": "Access Switch",
                "type": "switch",
                "layer": "access",
                "ip": "10.99.1.2",
                "interfaces": [
                    {"name": "Gi1/0/1", "mtu": 1500, "speed": "1000", "mode": "access"}
                ]
            }
        ],
        "links": [
            {
                "source": "rtr-core",
                "target": "sw-access",
                "src_iface": "Gi0/0",
                "dst_iface": "Gi1/0/1",
                "bandwidth": "1G"
            }
        ]
    }

    response = client.post("/api/poll/all")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["devices_polled"] == 2
    assert "rtr-core" in data["statuses"]
    assert "sw-access" in data["statuses"]

    core_state = data["statuses"]["rtr-core"]
    assert core_state["online"] is True
    assert "cpu_utilization" in core_state
    assert "memory_utilization" in core_state
    assert "packet_loss" in core_state
    assert "uptime" in core_state
    assert "interface_rates" in core_state
    assert "Gi0/0" in core_state["interface_rates"]
    assert core_state["snmp_status"] == "OK"


def test_poll_device_endpoint():
    manager.latest_topology = {
        "devices": [
            {
                "id": "fw-edge",
                "label": "Edge Firewall",
                "type": "firewall",
                "layer": "edge",
                "ip": "10.99.2.1",
                "interfaces": [{"name": "eth1/1", "mtu": 1500, "mode": "routed"}]
            }
        ],
        "links": []
    }

    # Test existing device
    response = client.post("/api/poll/device/fw-edge")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["device_id"] == "fw-edge"
    telemetry = data["telemetry"]
    assert telemetry["online"] is True
    assert telemetry["protocol"] in ("SNMPv2c", "SSH/SNMP")
    assert "cpu_utilization" in telemetry
    assert "memory_utilization" in telemetry

    # Test non-existing device
    resp_404 = client.post("/api/poll/device/unknown-device-999")
    assert resp_404.status_code == 404


def test_path_trace_mtu_mismatch_and_bottleneck():
    manager.latest_topology = {
        "devices": [
            {
                "id": "c1",
                "label": "Core-1",
                "type": "router",
                "layer": "core",
                "ip": "10.0.1.1",
                "interfaces": [
                    {"name": "Gi0/0", "mtu": 9000, "speed": "10G", "mode": "routed"}
                ]
            },
            {
                "id": "d1",
                "label": "Dist-1",
                "type": "switch",
                "layer": "distribution",
                "ip": "10.0.1.2",
                "interfaces": [
                    {"name": "Gi1/0/1", "mtu": 1500, "speed": "10G", "mode": "routed"},
                    {"name": "Gi1/0/2", "mtu": 1500, "speed": "100M", "mode": "routed"}
                ]
            },
            {
                "id": "a1",
                "label": "Access-1",
                "type": "switch",
                "layer": "access",
                "ip": "10.0.1.3",
                "interfaces": [
                    {"name": "Fa0/1", "mtu": 1500, "speed": "100M", "mode": "access"}
                ]
            }
        ],
        "links": [
            {
                "source": "c1",
                "target": "d1",
                "src_iface": "Gi0/0",
                "dst_iface": "Gi1/0/1",
                "bandwidth": "10G"
            },
            {
                "source": "d1",
                "target": "a1",
                "src_iface": "Gi1/0/2",
                "dst_iface": "Fa0/1",
                "bandwidth": "100M"
            }
        ]
    }

    payload = {
        "source_device_id": "c1",
        "destination_ip": "10.0.1.3",
        "mock_mode": True
    }

    response = client.post("/api/path-trace", json=payload)
    assert response.status_code == 200
    res = response.json()

    # Check hops
    assert "hops" in res
    assert len(res["hops"]) == 3
    assert res["hops"][0]["egress_mtu"] == 9000
    assert res["hops"][1]["ingress_mtu"] == 1500

    # Check diagnostics for MTU mismatch between Core-1 and Dist-1
    assert "diagnostics" in res
    mtu_issues = [d for d in res["diagnostics"] if d["type"] == "mtu_mismatch"]
    assert len(mtu_issues) >= 1
    assert "9000" in mtu_issues[0]["message"]
    assert "1500" in mtu_issues[0]["message"]

    # Check bottleneck identification (100M link)
    assert "bottleneck" in res
    assert res["bottleneck"] is not None
    assert res["bottleneck"]["bandwidth"] == "100M"
    assert res["bottleneck"]["source"] == "d1"
    assert res["bottleneck"]["target"] == "a1"

    # Check cumulative latency and path MTU
    assert res["path_mtu"] == 1500
    assert res["cumulative_latency_ms"] > 0


def test_path_trace_ecmp_alternate_paths():
    manager.latest_topology = {
        "devices": [
            {"id": "src", "label": "Source", "type": "switch", "layer": "access", "ip": "10.1.1.1"},
            {"id": "c1", "label": "Core-A", "type": "router", "layer": "core", "ip": "10.1.1.2"},
            {"id": "c2", "label": "Core-B", "type": "router", "layer": "core", "ip": "10.1.1.3"},
            {"id": "dst", "label": "Destination", "type": "switch", "layer": "access", "ip": "10.1.1.4"},
        ],
        "links": [
            {"source": "src", "target": "c1", "bandwidth": "10G"},
            {"source": "c1", "target": "dst", "bandwidth": "10G"},
            {"source": "src", "target": "c2", "bandwidth": "10G"},
            {"source": "c2", "target": "dst", "bandwidth": "10G"},
        ]
    }

    payload = {
        "source_device_id": "src",
        "destination_ip": "10.1.1.4",
        "mock_mode": True
    }

    response = client.post("/api/path-trace", json=payload)
    assert response.status_code == 200
    res = response.json()

    assert len(res["hops"]) == 3
    # Check alternate paths (ECMP route via other core router)
    assert "alternate_paths" in res
    assert len(res["alternate_paths"]) == 1
    assert len(res["alternate_paths"][0]["hops"]) == 3
