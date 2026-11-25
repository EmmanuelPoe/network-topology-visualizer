# Architecture

```
Browser: templates/index.html + static/app.js (Vis.js network canvas)
   │  REST /api/*            │  WS /ws/topology (live topology pushes)   │  WS /ws/terminal/{device_id}
   ▼                         ▼                                            ▼
FastAPI app/main.py ── ConnectionManager (latest_topology + connected clients)
   ├─ discovery.py   (Netmiko SSH BFS or mock) ──SSH──> devices
   ├─ polling.py     (LivePoller, TCP connect to port 22) ──TCP──> devices
   ├─ path_tracer.py (graph shortest paths; optional live "show ip route" over SSH)
   ├─ auditor.py / config_parser.py (pure parsing and analysis)
   └─ DATA_DIR (default data/, gitignored): layouts, topology.json, backups/
```

## Startup (`lifespan`)

`seed_data_dir()` creates `DATA_DIR` and copies in any bundled `sample/*.json` file it does not have yet; then `topology.json` from the data dir is loaded into `manager.latest_topology` and the `LivePoller` starts (stopped on shutdown). Blocking work (graph computations, Netmiko calls) runs in a 16-thread `ThreadPoolExecutor` or via `asyncio.to_thread`.

## Data model

`Topology = { devices: [Device], links: [Link] }`. A `Device` has `id`, `label`, `type` (router/switch/firewall/ap/cloud…), `layer` (core/distribution/access/edge), `ip`, `platform`, optional `x`/`y` canvas coordinates and `interfaces`; a `Link` has `source`, `target`, `protocol`, `source_interface`, `target_interface`, `bandwidth`. `parse_topology()` normalizes uploaded JSON/YAML into this shape. See the README's "Inventory Format".

## HTTP API (`app/main.py`)

| Area | Endpoints |
|---|---|
| Page | `GET /` |
| Import | `GET /api/sample`, `POST /api/upload` (JSON/YAML file), `POST /api/validate` |
| Discovery | `POST /api/discover` (seed IP + credentials; mock or Netmiko) |
| Layouts | `GET /api/layouts`, `GET/DELETE /api/layouts/{filename}`, `PATCH /api/layouts/{filename}` (rename), `POST /api/save?name=` (writes `<DATA_DIR>/<name>.json`, or `topology.json` without a name, and keeps timestamped backups in `<DATA_DIR>/backups/`) |
| Backups | `GET /api/backups`, `GET /api/layouts/backups/{filename}`, `GET /api/backups/diff` |
| Operations | `POST /api/runbook` (commands on devices, mock or SSH), `POST /api/path-trace`, `POST /api/poll/all`, `POST /api/poll/device/{id}` |
| Analysis | `GET /api/topology/ipam`, `GET /api/topology/overview` |
| Integration | `POST /api/push` (external systems push a topology; broadcast to `/ws/topology`; only endpoint that checks `TOPOLOGY_API_KEY`) |
| Export | `POST /api/export`, `GET /api/export/report` |
| WebSockets | `/ws/topology` (live updates), `/ws/terminal/{device_id}` (mock CLI or real SSH via Netmiko/Paramiko with PTY resize; credentials, IP, platform and mode come in the first `{"type": "connect", ...}` message). Both reject cross-site origins (`websocket_origin_allowed`, close code 1008). |

Layout filenames are sanitized (alphanumerics, space, `_`, `-`) and resolved inside the data dir; `topology.json` is protected from deletion/rename.

## Configuration (environment)

| Variable | Effect |
|---|---|
| `TOPOLOGY_API_KEY` | if set, `/api/push` requires a matching `X-API-Key` header |
| `CORS_ORIGINS` | comma-separated exact origins; unset (default) means no CORS middleware — the UI is same-origin and needs none |
| `TOPOLOGY_DATA_DIR` | storage directory; default `data/` in the repo (gitignored) |
| `HOST` | `make run` bind address, default `127.0.0.1` |

## Frontend

One page; `static/app.js` holds all client logic (no build step, no framework). Vis.js is loaded from `https://unpkg.com/vis-network@9.1.9` with an `integrity` hash. See [ui.md](ui.md).
