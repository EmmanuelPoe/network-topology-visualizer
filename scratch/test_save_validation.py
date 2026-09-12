from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_save():
    # 1. Load the current layouts
    res = client.get("/api/layouts")
    print("Available layouts:", res.json())

    # 2. Get one layout
    res_layout = client.get("/api/layouts/topology.json")
    print("Get layout response code:", res_layout.status_code)
    layout_data = res_layout.json()
    print("Get layout data:", layout_data)

    # 3. Simulate editing a device in the frontend (removing or modifying fields)
    if layout_data.get("devices"):
        # Simulated edit: modify the first device
        device = layout_data["devices"][0]
        device["label"] = device["label"] + " (Edited)"
        # Note: the frontend node-save does NOT include audit_findings in deviceData
        # but let's test both with and without audit_findings
        if "audit_findings" in device:
            print("device has audit_findings:", device["audit_findings"])

    # 4. Save the edited layout
    res_save = client.post("/api/save?name=topology", json=layout_data)
    print("Save layout response code:", res_save.status_code)
    if res_save.status_code != 200:
        print("Save layout response content:", res_save.text)


if __name__ == "__main__":
    test_save()
