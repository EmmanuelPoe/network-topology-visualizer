from fastapi.testclient import TestClient
from app.main import app
from pathlib import Path
import time
import pytest
import shutil

client = TestClient(app)


@pytest.fixture(autouse=True)
def backup_restore_topology():
    topology_path = Path(__file__).parent / "sample" / "topology.json"
    backup_path = Path(__file__).parent / "sample" / "topology.json.bak"

    # Back up the original file if it exists
    existed = topology_path.exists()
    if existed:
        shutil.copy2(topology_path, backup_path)

    yield

    # Restore the original file
    if existed:
        shutil.copy2(backup_path, topology_path)
        if backup_path.exists():
            backup_path.unlink()
    elif topology_path.exists():
        topology_path.unlink()


def test_save_and_list_backups():
    # Clean up backups directory
    backup_dir = Path(__file__).parent / "sample" / "backups"
    if backup_dir.exists():
        for p in backup_dir.glob("topology_*.json"):
            try:
                p.unlink()
            except Exception:
                pass

    # Save a topology to trigger backup creation
    payload = {
        "devices": [
            {
                "id": "core-1",
                "label": "Core-1",
                "type": "router",
                "layer": "core",
                "ip": "10.0.0.1",
                "config": "hostname Core-1\n!",
            }
        ],
        "links": [],
    }

    response = client.post("/api/save", json=payload)
    assert response.status_code == 200

    # Wait a second to allow distinct timestamping
    time.sleep(1.1)

    # Save another one with different config to create a second backup
    payload2 = {
        "devices": [
            {
                "id": "core-1",
                "label": "Core-1",
                "type": "router",
                "layer": "core",
                "ip": "10.0.0.1",
                "config": "hostname Core-1-drifted\n!",
            }
        ],
        "links": [],
    }
    response2 = client.post("/api/save", json=payload2)
    assert response2.status_code == 200

    # List backups
    response_list = client.get("/api/backups")
    assert response_list.status_code == 200
    data = response_list.json()
    assert "backups" in data
    assert len(data["backups"]) >= 2

    # Get diff between backup 1 and backup 2
    file1 = data["backups"][1]["filename"]  # older
    file2 = data["backups"][0]["filename"]  # newer

    response_diff = client.get(
        f"/api/backups/diff?device_id=core-1&file1={file1}&file2={file2}"
    )
    assert response_diff.status_code == 200
    diff_data = response_diff.json()
    assert "diff" in diff_data
    assert "-hostname Core-1" in diff_data["diff"]
    assert "+hostname Core-1-drifted" in diff_data["diff"]

    # Test comparing older backup with active topology.json
    response_diff_active = client.get(
        f"/api/backups/diff?device_id=core-1&file1={file1}&file2=topology.json"
    )
    assert response_diff_active.status_code == 200
    diff_data_active = response_diff_active.json()
    assert "diff" in diff_data_active
    assert "-hostname Core-1" in diff_data_active["diff"]
    assert "+hostname Core-1-drifted" in diff_data_active["diff"]
