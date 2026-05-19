# Network Topology Visualizer

Upload a network inventory (JSON or YAML) or build one from scratch using the Interactive GUI Editor. Get an interactive, zoomable topology diagram featuring custom dark-mode SVG device icons and multi-layer filtering.

![GUI Editor Demo](docs/gui-editor-demo.png)

## Features

- **Interactive GUI Builder** — Build networks dynamically without writing JSON! Drag and drop nodes, draw connections, and configure device properties (IP, Layer, Type) through sleek popup modals.
- **Custom Device Icons** — Premium, dark-mode native SVG icons for Routers, Switches, Firewalls, Wireless APs, and Cloud environments.
- **Server-Side Layouts** — Leverage Python's `networkx` backend to arrange topologies using advanced algorithms (Spring, Kamada-Kawai, Circular, Shell, Spectral).
- **Interactive Canvas** — Drag nodes, zoom, pan; click a device or link to see its configuration details in the side panel.
- **Export Capabilities** — Save your visual diagram as **PNG** or **SVG**, or export your custom-drawn network back to a **JSON** file to use in automation workflows.
- **Live Search & Layer Filtering** — Quickly find specific devices by IP/Name, and toggle between Core, Distribution, Access, and Edge views.

## Tech Stack

- Python 3.10+ / FastAPI — backend API & NetworkX layout algorithms
- [Vis.js Network](https://visjs.github.io/vis-network/) — interactive graph rendering and GUI builder module
- HTML/CSS/JavaScript — vanilla frontend featuring a premium dark mode aesthetic

## Inventory Format

```json
{
  "devices": [
    {
      "id": "core-sw-01",
      "label": "Core Switch 1",
      "type": "switch",
      "layer": "core",
      "ip": "10.0.0.1",
      "platform": "Cisco Catalyst 6509"
    },
    {
      "id": "dist-sw-01",
      "label": "Dist Switch 1",
      "type": "switch",
      "layer": "distribution",
      "ip": "10.0.1.1",
      "platform": "Cisco Catalyst 4507"
    }
  ],
  "links": [
    {
      "source": "core-sw-01",
      "target": "dist-sw-01",
      "protocol": "OSPF",
      "source_interface": "Gi1/0/1",
      "target_interface": "Gi1/0/24",
      "bandwidth": "10G"
    }
  ]
}
```

## Quick Start

```bash
make setup
make run
# Open http://localhost:8000
# Upload your inventory JSON, use the sample topology, or draw your own!
```
