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


def test_websocket_terminal_auth():
    # Set up latest topology in the manager
    manager.latest_topology = {
        "devices": [
            {
                "id": "core-1",
                "label": "Core-1",
                "type": "router",
                "layer": "core",
                "ip": "10.0.0.1",
            }
        ],
        "links": [],
    }

    with client.websocket_connect("/ws/terminal/core-1?mode=mock") as websocket:
        # Send connect authentication packet as the first message
        websocket.send_json(
            {"type": "connect", "username": "cisco", "password": "secure_password"}
        )

        # Receive welcome message
        data = websocket.receive_json()
        assert data["type"] == "output"
        assert "Network Topology Visualizer" in data["text"]

        # Send a mock command
        websocket.send_text("show version")

        # Receive command output
        resp_data = websocket.receive_json()
        assert resp_data["type"] == "output"
        assert "Cisco IOS Software" in resp_data["text"]
