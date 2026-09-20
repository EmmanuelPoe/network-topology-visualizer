from fastapi.testclient import TestClient
from app.main import app, manager

client = TestClient(app)

def test_export_executive_report_markdown():
    # Setup test topology in manager
    manager.latest_topology = {
        "devices": [
            {
                "id": "core-1",
                "label": "Core-Router-1",
                "type": "router",
                "layer": "core",
                "ip": "10.0.0.1",
                "interfaces": [
                    {"name": "Gi0/0", "ip": "10.0.0.1", "mask": "255.255.255.0", "mode": "routed"}
                ],
                "config": "enable password cisco\nno service password-encryption\n"
            }
        ],
        "links": []
    }

    response = client.get("/api/export/report?format=markdown")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    content = response.text
    assert "# Network Topology & Security Executive Report" in content
    assert "Core-Router-1" in content
    assert "Unencrypted Enable Password" in content or "CIS-Cisco" in content

def test_export_executive_report_html():
    manager.latest_topology = {
        "devices": [
            {
                "id": "sw-1",
                "label": "Switch-1",
                "type": "switch",
                "layer": "access",
                "ip": "10.0.0.2",
                "interfaces": [],
                "config": "transport input telnet\n"
            }
        ],
        "links": []
    }

    response = client.get("/api/export/report?format=html")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    content = response.text
    assert "<h1>Network Topology & Security Executive Report</h1>" in content
    assert "Switch-1" in content
    assert "Insecure Management Protocol (Telnet) Allowed" in content
