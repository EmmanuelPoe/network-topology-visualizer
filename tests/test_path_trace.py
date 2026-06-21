from fastapi.testclient import TestClient
from app.main import app, manager

client = TestClient(app)


def test_path_trace_mock():
    # Set up latest topology in the manager
    manager.latest_topology = {
        "devices": [
            {
                "id": "core-1",
                "label": "Core-1",
                "type": "router",
                "layer": "core",
                "ip": "10.0.0.1",
            },
            {
                "id": "dist-1",
                "label": "Dist-1",
                "type": "switch",
                "layer": "distribution",
                "ip": "10.0.0.2",
            },
            {
                "id": "access-1",
                "label": "Access-1",
                "type": "switch",
                "layer": "access",
                "ip": "10.0.0.3",
            },
        ],
        "links": [
            {
                "source": "core-1",
                "target": "dist-1",
                "src_iface": "Gi1/0/1",
                "dst_iface": "Gi1/0/2",
            },
            {
                "source": "dist-1",
                "target": "access-1",
                "src_iface": "Gi1/0/3",
                "dst_iface": "Gi1/0/4",
            },
        ],
    }

    # Request path trace execution
    payload = {
        "source_device_id": "core-1",
        "destination_ip": "10.0.0.3",
        "mock_mode": True,
    }

    response = client.post("/api/path-trace", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "hops" in data
    hops = data["hops"]
    assert len(hops) == 3

    # Verify hops sequence
    assert hops[0]["device_id"] == "core-1"
    assert hops[0]["egress_interface"] == "Gi1/0/1"

    assert hops[1]["device_id"] == "dist-1"
    assert hops[1]["ingress_interface"] == "Gi1/0/2"
    assert hops[1]["egress_interface"] == "Gi1/0/3"

    assert hops[2]["device_id"] == "access-1"
    assert hops[2]["ingress_interface"] == "Gi1/0/4"
