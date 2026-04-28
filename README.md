# Network Topology Visualizer

Upload a network inventory (JSON or YAML) and get an interactive, zoomable topology diagram. Supports multi-layer visualizations (L2, L3, and logical overlays).

## Features

- **Interactive Diagram** — drag nodes, zoom, pan; click a device to see its config details
- **Layer Toggle** — switch between L2 (VLAN), L3 (routing), and physical views
- **Auto-Layout** — hierarchical layout (core → distribution → access) or free-form
- **Link Annotations** — shows protocol (OSPF/BGP/EIGRP), interface names, and IP addresses on links
- **Export** — save diagram as PNG or SVG
- **JSON/YAML Input** — simple inventory format, or import from Nornir hosts.yaml

## Tech Stack

- Python 3.10+ / FastAPI — backend API
- [Vis.js Network](https://visjs.github.io/vis-network/) — interactive graph rendering
- D3.js — custom layouts and link annotations
- HTML/CSS/JavaScript — frontend

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
pip install -r requirements.txt
uvicorn app.main:app --reload
# Open http://localhost:8000
# Upload your inventory JSON or use the sample topology
```
