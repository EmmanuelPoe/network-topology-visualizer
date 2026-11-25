import shutil

import pytest

import app.main as main


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Run every test against a temp copy of the bundled sample layouts, so tests
    never create, modify or delete files in the repository's sample/ directory."""
    data = tmp_path / "data"
    data.mkdir()
    for f in main.BUNDLED_SAMPLE_DIR.glob("*.json"):
        shutil.copy2(f, data / f.name)
    monkeypatch.setattr(main, "DATA_DIR", data)
    return data
