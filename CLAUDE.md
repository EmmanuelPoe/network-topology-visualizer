# CLAUDE.md

Guidance for AI agents working in this repository. Read this first, then the matching file in `docs/`.

## What this is

A FastAPI + vanilla-JS (Vis.js) web app for building, importing, discovering and operating on network topology diagrams. Beyond drawing, the backend does real network work: SSH neighbor discovery (Netmiko + TextFSM), live TCP reachability polling, runbook command execution, path tracing, config auditing, IPAM/subnet analysis, layout backups/diffs, and an SSH or mock-CLI terminal over WebSocket.

## Commands

```bash
make setup                         # uv sync
make run                           # uvicorn --reload on http://127.0.0.1:8000  (HOST=0.0.0.0 make run to expose — see security)
make lint                          # ruff check + JSON syntax check of every *.json
make format                        # ruff format
uv run --with pytest --with pytest-asyncio --with httpx pytest -q   # 25 tests; pytest is NOT in the dev deps yet
docker compose -f docker-compose.test-router.yml up -d              # optional SSH test router (Dockerfile.test_router)
```

## Layout

```
app/main.py          FastAPI app: 22 HTTP routes, 2 WebSockets, Pydantic models, ConnectionManager, lifespan (loads sample/topology.json, starts poller)
app/discovery.py     DiscoveryEngine → MockDiscoveryEngine / NetmikoDiscoveryEngine (BFS over CDP/LLDP neighbors)
app/polling.py       LivePoller: periodic TCP-connect checks (default port 22) for latency/reachability
app/path_tracer.py   shortest paths over the topology graph + per-hop diagnostics, optional live route lookups
app/auditor.py       config parsing/audit, topology audit, subnet analysis (IPAM), overview stats
app/config_parser.py ConfigTopologyParser: build a topology from device configs
templates/index.html the single page (loads vis-network from unpkg, then /static/app.js)
static/app.js        ~4,500 lines: canvas, editor, modals, terminal drawer, path highlighting, exports
static/style.css     dark theme
sample/              topology.json (default), test-a/b.json, backups/ — ALSO where "Save to Server" writes layouts
tests/               pytest suite (tests/test_router.py is a helper, not a test module)
scratch/             throwaway experiments, excluded from pytest
```

## Rules for agents

- **Saved layouts are written into `sample/`, which is tracked by git.** Never commit topologies, backups or device data a user saved there; only the curated sample files belong in git.
- Anything touching SSH, discovery, runbooks, `/api/push` or `/ws/terminal` acts on real devices. Use `MockDiscoveryEngine`/mock mode in tests; never hard-code real credentials (the `scratch/` scripts use lab `cisco/cisco` on localhost only).
- Escape every device-derived string (labels, hostnames, interface names, config text) before inserting it into HTML in `app.js` — use the existing `escapeHtml()`. Discovered hostnames are attacker-controllable.
- Keep the server bound to 127.0.0.1 by default.
- Run `make lint` and the test command above before finishing.

## Docs

- [docs/architecture.md](docs/architecture.md)
- [docs/security.md](docs/security.md)
- [docs/ui.md](docs/ui.md)
- [docs/testing.md](docs/testing.md)
- [docs/agent-guide.md](docs/agent-guide.md)
