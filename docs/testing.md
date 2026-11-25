# Testing

## Run

```bash
make setup
uv run --with pytest --with pytest-asyncio --with httpx pytest -q
```

Current result: **25 passed**. Without `pytest-asyncio`, the two async tests in `tests/test_enterprise_features.py` fail. `pytest`, `pytest-asyncio` and `httpx` are not in the `dev` dependency group yet; add them (`uv add --dev pytest pytest-asyncio httpx`) so `uv run pytest` works on its own. `pyproject.toml` already configures `testpaths = ["tests"]`, `pythonpath = ["."]` and excludes `scratch/`.

## Suite map

| File | Covers |
|---|---|
| `test_auditor.py`, `test_config_auditor.py` | config parsing and audit rules |
| `test_config_parser.py` | building topologies from configs |
| `test_path_trace.py`, `test_enhanced_polling_and_trace.py` | path finding, diagnostics, poller |
| `test_backups.py` | layout save/backup/diff |
| `test_enterprise_features.py` | IPAM and overview API endpoints (async) |
| `test_report_export.py` | report export |
| `test_runbook.py` | runbook execution (mock mode) |
| `test_router.py` | helper/mock router, not collected as tests |

## Lint

```bash
make lint      # ruff check + validates every *.json with json.tool
make format
```

## Lab testing with SSH

`docker-compose.test-router.yml` + `Dockerfile.test_router` start a local SSH target for discovery and terminal tests. `scratch/` holds ad-hoc scripts (`test_netmiko.py`, `test_real_discovery.py`) that point at it; they are excluded from pytest.

## Guidelines

- Tests must not need network access: use `MockDiscoveryEngine`, mock mode for runbooks/terminal, and monkeypatch Netmiko/`check_tcp_port`.
- Use `tmp_path` and monkeypatch the `sample/` path when testing save/delete, so tests never modify tracked files.
- **Known issue:** `tests/test_backups.py` saves through the real API, which writes `sample/topology.json` (restored by a fixture) and new `sample/backups/topology_<timestamp>.json` files. Its cleanup looks in `tests/sample/backups` (`Path(__file__).parent`), the wrong directory, so every run leaves untracked backup files in the repo's `sample/backups/`. Delete them before committing (`git status`), and fix the test by pointing storage at `tmp_path`.
- Add a test for every new endpoint (status codes, filename sanitization, error paths). Frontend behavior has no automated tests; check it manually in a browser after changes.
- There is no CI; consider a GitHub Actions workflow running `make lint` and the pytest command.
