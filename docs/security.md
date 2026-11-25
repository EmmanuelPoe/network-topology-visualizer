# Security

This app can open SSH sessions to network devices and run commands, so treat it as a privileged admin tool.

## Threat model

| Asset | Exposure |
|---|---|
| Device credentials | Sent by the browser per request (discovery, runbooks, terminal, live route lookups); not stored server-side |
| Device CLI access | `/ws/terminal/{device_id}` and `/api/runbook` execute commands with those credentials |
| Saved topologies | Files in `sample/` (IPs, hostnames, interface data) |

## Controls in place

- `make run` binds to **127.0.0.1** by default (`HOST=0.0.0.0 make run` exposes it).
- **CORS is off by default.** The UI is same-origin; `CORS_ORIGINS` enables CORS for listed exact origins only, and a wildcard is never combined with credentials. (Previously `*` + credentials let any website you visited call the API on localhost.)
- **WebSocket origin check**: `/ws/topology` and `/ws/terminal/{id}` close cross-site connections with code 1008; same-origin pages and non-browser clients (no `Origin` header) are allowed.
- **No credentials in URLs**: the terminal WebSocket takes username/password only from its first message, so they never reach access logs or browser history.
- **Storage outside git**: layouts, the active topology and backups live in `data/` (gitignored) or `TOPOLOGY_DATA_DIR`; tests use a temp dir.
- **Third-party script integrity**: vis-network 9.1.9 from unpkg is pinned with an SRI `sha384` hash (verified against both the npm package and the live CDN file).
- Layout filenames are sanitized and confined to the data dir; `topology.json` cannot be deleted or renamed.
- Device-derived strings are escaped with `escapeHtml()` in `app.js`.
- `/api/push` can be protected with `TOPOLOGY_API_KEY`.

## Remaining risks

1. **No authentication except `/api/push`.** Anyone who can reach the port can read/modify layouts, run discovery and use the server as an SSH relay (with credentials). Keep it on localhost or put an authenticating reverse proxy in front before exposing it.
2. **Background polling**: the `LivePoller` TCP-connects to every device in the loaded topology (port 22). Loading a topology with someone else's addresses makes the server probe them.
3. **CDN dependency**: the page needs unpkg reachable; vendoring `vis-network.min.js` into `static/` would remove that dependency (keep the SRI hash if you do).

## Rules for changes

- Never log or persist device passwords; keep them request-scoped.
- Any new HTML built from device or user data goes through `escapeHtml()` (or `textContent`).
- New file-handling endpoints must reuse the existing filename sanitization and stay inside the storage directory.
- New endpoints that change state or touch devices should honor an API key/auth check, not add to the unauthenticated surface.
