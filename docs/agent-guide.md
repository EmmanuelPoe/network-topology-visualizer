# Agent guide

## Recipes

**Add an API endpoint**: define request/response Pydantic models near the related ones in `app/main.py`, put logic in the matching module (`auditor.py`, `path_tracer.py`, …) as a pure function where possible, run blocking work with `asyncio.to_thread`/the executor, add a test with `TestClient`, and call it from `app.js` with a relative `/api/...` URL.

**Add a device type**: add its SVG icon and color in `app.js`/`style.css`, accept the new `type` value wherever the backend validates or audits types, and include it in the sample if useful.

**Add an audit rule**: extend `audit_device_config` or `audit_topology` in `app/auditor.py` and add a case to `tests/test_auditor.py`/`test_config_auditor.py`.

**Add a discovery backend**: subclass `DiscoveryEngine` in `app/discovery.py` (see `MockDiscoveryEngine` for the interface), select it in `/api/discover`, and test it through the mock path.

**Move saved layouts out of `sample/`**: introduce a `DATA_DIR` (env-configurable, gitignored), point list/get/save/delete/rename/backups at it, keep `sample/topology.json` as the read-only default, and update tests to use `tmp_path`.

## Pitfalls

- `app/main.py` is ~1,800 lines; search before adding, since helpers often already exist (e.g. filename sanitization in save/rename, `parse_topology`).
- `manager.latest_topology` is shared state used by the poller, WebSockets and analysis endpoints; update it through the same paths the existing endpoints use so clients get broadcasts.
- `app.js` looks up DOM elements by ID; new elements must exist in `index.html` before scripts reference them.
- Bump the `?v=` query strings on `app.js`/`style.css` in `index.html` after changing them, or browsers serve stale files.
- `tests/test_router.py` is not a test module; do not "fix" it by adding asserts.

## Done means

`make lint` passes, the pytest command passes, the feature works in a browser at http://127.0.0.1:8000 with no console errors, new HTML output is escaped, and no saved layouts or device data are staged.
