from fastapi.testclient import TestClient
from app.main import app, manager

client = TestClient(app)


def test_runbook_mock():
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
        ],
        "links": [],
    }

    # Request runbook execution
    payload = {
        "device_ids": ["core-1", "dist-1"],
        "command": "show version",
        "mock_mode": True,
    }

    response = client.post("/api/runbook", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "outputs" in data
    assert "core-1" in data["outputs"]
    assert "dist-1" in data["outputs"]

    # Verify mock output contains version details
    assert "Cisco IOS Software" in data["outputs"]["core-1"]
    assert "Cisco IOS Software" in data["outputs"]["dist-1"]
