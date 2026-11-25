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
- Layout filenames are sanitized and confined to `sample/`; `topology.json` cannot be deleted or renamed.
- Path-trace `<select>` options and other device fields are escaped with `escapeHtml()` in `app.js`.
- `/api/push` can be protected with `TOPOLOGY_API_KEY`.

## Known gaps

1. **No authentication on everything except `/api/push`.** Anyone who can reach the port can read/modify/delete layouts, run discovery, use the server as an SSH relay, and open terminal sessions (given credentials). Keep it on localhost, or put it behind an authenticating reverse proxy before binding to other interfaces.
2. **Permissive CORS**: `allow_origins=["*"]` with `allow_credentials=True` by default. Verified: a preflight from `Origin: https://evil.example` for `DELETE /api/layouts/...` is answered with that origin and `Allow-Credentials: true`. Combined with no auth, any website you visit can send requests to `http://127.0.0.1:8000` from your browser (e.g. delete or overwrite layouts). Set `CORS_ORIGINS` to the app's own origin, or remove the CORS middleware (same-origin requests do not need it).
3. **WebSockets are not origin-checked**: a malicious page can open `/ws/topology` or `/ws/terminal/...` to localhost. Check the `Origin` header in both WebSocket handlers.
4. **Third-party script without integrity**: `templates/index.html` loads vis-network from unpkg without a Subresource Integrity hash. Vendor it into `static/` or add `integrity="sha384-..." crossorigin="anonymous"`.
5. **Saved data in the repo tree**: "Save to Server" writes into `sample/`, a tracked directory. Real topologies can end up in commits. Consider a separate, gitignored `data/` directory.
6. **Background polling**: the `LivePoller` starts at boot and TCP-connects to every device in the loaded topology (port 22 by default). Loading a topology with someone else's addresses makes the server probe them.

## Rules for changes

- Never log or persist device passwords; keep them request-scoped.
- Any new HTML built from device or user data goes through `escapeHtml()` (or `textContent`).
- New file-handling endpoints must reuse the existing filename sanitization and stay inside the storage directory.
- New endpoints that change state or touch devices should honor an API key/auth check, not add to the unauthenticated surface.
