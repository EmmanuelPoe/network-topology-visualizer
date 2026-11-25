# Testing

## Run

```bash
make setup              # uv sync, includes pytest, pytest-asyncio, httpx, ruff
uv run pytest -q        # 25 passed
make lint               # ruff check + JSON syntax check
uv run ruff format --check .
```

CI (`.github/workflows/ci.yml`) runs `uv sync --locked`, ruff check, ruff format check, the JSON check and pytest on every pull request.

`tests/conftest.py` has an autouse fixture that copies `sample/*.json` into a temp directory and points `app.main.DATA_DIR` at it, so tests never touch `sample/` or `data/`.

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
- Storage is isolated automatically by `conftest.py`; use `main.data_dir()` in tests that inspect files.
- Add a test for every new endpoint (status codes, filename sanitization, error paths). Frontend behavior has no automated tests; check it manually in a browser after changes.
