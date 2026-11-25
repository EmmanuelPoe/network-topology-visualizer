# UI

Single page: `templates/index.html` (markup, ~550 lines) + `static/app.js` (~4,500 lines) + `static/style.css` (~2,200 lines). No framework or bundler. Assets are cache-busted with query strings (`style.css?v=1.0.3`, `app.js?v=1.0.4`) — bump them when you change the files.

## Main areas

- **Canvas** — a Vis.js `Network` with custom dark-mode SVG icons per device type (router, switch, firewall, AP, cloud); drag, zoom, pan; layer colors (core/distribution/access/edge).
- **Toolbar / controls** — upload JSON/YAML, load sample, save to server (named layouts), layout list (load/rename/delete), export PNG/SVG/JSON, search by name/IP, layer filters.
- **GUI editor** — add/edit devices and links through modals (IP, layer, type, interfaces).
- **Side panel** — details for the selected device or link.
- **Terminal drawer** — tabbed sessions over `/ws/terminal/{device_id}`: mock Cisco CLI or real SSH, with history and PTY resize. `ping`/`traceroute` output is parsed live to highlight the path on the canvas (BFS shortest path in cyan `#00d2ff`; traceroute hops in orange `#ff9c3a`; gaps bridged with BFS). Highlights clear when the drawer closes or a new trace starts. Details in the README's "Pathfinding & Highlight Logic".
- **Operations views** — discovery form, runbooks, path trace, polling status, IPAM and overview, backups and diffs, report export.

## Conventions

- Escape any data-derived string with `escapeHtml()` before using it in `innerHTML` or template literals. Prefer `textContent` for plain text.
- Keep the visual language: dark theme, the existing CSS variables/colors in `style.css`, SVG icons consistent with the current set.
- New panels and modals should follow the existing modal markup and classes in `index.html` rather than inventing new patterns.
- The client talks to the backend only through `/api/*` and the two WebSockets; do not embed device logic in the browser.
- `app.js` is large; add new features as clearly named functions grouped near related code, and avoid new global state where an existing module-level object already holds it.

## Screenshot

`docs/gui-editor-demo.png` (used in the README) shows the GUI editor.
