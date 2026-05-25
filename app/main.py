"""Network Topology Visualizer — FastAPI backend."""

from __future__ import annotations
import base64
import asyncio
import json
import os
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from pathlib import Path

import networkx as nx
import yaml
from fastapi import (
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import Response, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from app.discovery import MockDiscoveryEngine, NetmikoDiscoveryEngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app.main")

try:
    from netmiko import ConnectHandler

    NETMIKO_AVAILABLE = True
except ImportError:
    NETMIKO_AVAILABLE = False
    logger.warning("Netmiko not available. Real SSH console sessions will be disabled.")

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(title="Network Topology Visualizer")
app.mount(
    "/static",
    StaticFiles(directory=str(Path(__file__).parent.parent / "static")),
    name="static",
)

SAMPLE_PATH = Path(__file__).parent.parent / "sample" / "topology.json"

# Optional bearer-token protection for /api/push.
# Set the TOPOLOGY_API_KEY environment variable to enable it.
API_KEY: str | None = os.getenv("TOPOLOGY_API_KEY")

# Thread pool for blocking NetworkX computations
_executor = ThreadPoolExecutor(max_workers=2)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class Device(BaseModel):
    id: str
    label: str
    type: str = "switch"
    layer: str = "core"
    ip: Optional[str] = None
    platform: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None

    model_config = {"populate_by_name": True}


class Link(BaseModel):
    source: str
    target: str
    protocol: Optional[str] = None
    bandwidth: Optional[str] = None
    # Accept both naming conventions; normalise to src_iface / dst_iface
    src_iface: Optional[str] = Field(None)
    dst_iface: Optional[str] = Field(None)
    source_interface: Optional[str] = Field(None, exclude=True)
    target_interface: Optional[str] = Field(None, exclude=True)

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def normalise_interfaces(self) -> "Link":
        if self.src_iface is None and self.source_interface is not None:
            self.src_iface = self.source_interface
        if self.dst_iface is None and self.target_interface is not None:
            self.dst_iface = self.target_interface
        return self


class Topology(BaseModel):
    devices: list[Device]
    links: list[Link]


class LayoutRequest(BaseModel):
    devices: list[Device]
    links: list[Link]
    algorithm: str = "spring"


class DiscoverRequest(BaseModel):
    seed_ip: str
    username: str
    password: str
    platform: str = "cisco_ios"
    max_depth: int = 2
    mock_mode: bool = True


def parse_topology(raw: dict) -> dict:
    """Validate and normalise a raw topology dict. Returns serialisable dict."""
    try:
        topo = Topology.model_validate(raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Validation error: {exc}")
    return topo.model_dump()


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------


class ConnectionManager:
    """Manages active WebSocket connections and broadcasts topology updates."""

    def __init__(self) -> None:
        self.active: list[WebSocket] = []
        self.latest_topology: dict | None = None

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict) -> int:
        """Send topology to all connected clients. Returns number of live clients."""
        self.latest_topology = data
        message = json.dumps(data)
        dead: list[WebSocket] = []
        for ws in list(self.active):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)
        return len(self.active)


manager = ConnectionManager()

# ---------------------------------------------------------------------------
# NetworkX layout engine
# ---------------------------------------------------------------------------

LAYOUT_ALGORITHMS: dict[str, callable] = {
    "spring": nx.spring_layout,
    "kamada_kawai": nx.kamada_kawai_layout,
    "circular": nx.circular_layout,
    "shell": nx.shell_layout,
    "spectral": nx.spectral_layout,
}

# Scale factor: NetworkX positions are in [-1, 1]; map to canvas px
_CANVAS_HALF = 1100


def _build_nx_graph(devices: list, links: list) -> nx.Graph:
    G = nx.Graph()
    for d in devices:
        G.add_node(d["id"])
    for lnk in links:
        G.add_edge(lnk["source"], lnk["target"])
    return G


def _compute_layout_sync(devices: list, links: list, algorithm: str) -> dict[str, dict]:
    """
    Run NetworkX layout synchronously (called inside a thread pool).
    Returns {node_id: {x: float, y: float}} scaled to canvas coordinates.
    """
    G = _build_nx_graph(devices, links)

    try:
        if algorithm == "shell":
            # Group nodes into concentric shells by network layer
            layer_order = ["internet", "edge", "core", "distribution", "access"]
            shells: list[list[str]] = []
            placed: set[str] = set()
            for layer in layer_order:
                shell = [d["id"] for d in devices if d.get("layer") == layer]
                if shell:
                    shells.append(shell)
                    placed.update(shell)
            # Any unmapped devices go in the outermost shell
            remainder = [d["id"] for d in devices if d["id"] not in placed]
            if remainder:
                shells.append(remainder)
            pos = (
                nx.shell_layout(G, nlist=shells)
                if len(shells) >= 2
                else nx.spring_layout(G, seed=42)
            )
        elif algorithm == "spectral":
            # Spectral fails on disconnected graphs — fall back to spring
            if not nx.is_connected(G):
                pos = nx.spring_layout(G, seed=42)
            else:
                pos = nx.spectral_layout(G)
        else:
            fn = LAYOUT_ALGORITHMS[algorithm]
            kwargs = {"seed": 42} if algorithm == "spring" else {}
            pos = fn(G, **kwargs)
    except Exception:
        # Ultimate fallback
        pos = nx.spring_layout(G, seed=42)

    # Normalise to canvas coordinates and flip Y (screen coords)
    return {
        node_id: {
            "x": float(xy[0] * _CANVAS_HALF),
            "y": float(-xy[1] * _CANVAS_HALF),  # invert Y so top=internet
        }
        for node_id, xy in pos.items()
    }


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _check_api_key(x_api_key: Optional[str]) -> None:
    """Raise 401 if TOPOLOGY_API_KEY is set and the request key doesn't match."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid X-Api-Key header.",
        )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    import time
    import re

    html_path = Path(__file__).parent.parent / "templates" / "index.html"
    html = html_path.read_text()
    ts = str(int(time.time()))
    html = re.sub(
        r'src="/static/app\.js(\?v=[^"]*)?"', f'src="/static/app.js?v={ts}"', html
    )
    html = re.sub(
        r'href="/static/style\.css(\?v=[^"]*)?"',
        f'href="/static/style.css?v={ts}"',
        html,
    )
    return HTMLResponse(html)


@app.get("/api/sample")
async def get_sample() -> JSONResponse:
    raw = json.loads(SAMPLE_PATH.read_text())
    return JSONResponse(parse_topology(raw))


@app.post("/api/upload")
async def upload_topology(file: UploadFile = File(...)) -> JSONResponse:
    content = await file.read()
    try:
        if file.filename.endswith((".yaml", ".yml")):
            raw = yaml.safe_load(content)
        else:
            raw = json.loads(content)
    except (json.JSONDecodeError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=422, detail=f"Parse error: {exc}")

    if not isinstance(raw, dict) or "devices" not in raw or "links" not in raw:
        raise HTTPException(
            status_code=422,
            detail="File must contain 'devices' and 'links' keys.",
        )
    return JSONResponse(parse_topology(raw))


@app.post("/api/validate")
async def validate_topology(file: UploadFile = File(...)) -> JSONResponse:
    """Dry-run validation without storing anything."""
    content = await file.read()
    try:
        raw = (
            yaml.safe_load(content)
            if file.filename.endswith((".yaml", ".yml"))
            else json.loads(content)
        )
    except (json.JSONDecodeError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=422, detail=f"Parse error: {exc}")
    parse_topology(raw)
    return JSONResponse(
        {"valid": True, "devices": len(raw["devices"]), "links": len(raw["links"])}
    )


@app.post("/api/discover")
async def discover_topology(req: DiscoverRequest) -> JSONResponse:
    try:
        if req.mock_mode:
            engine = MockDiscoveryEngine(
                req.seed_ip, req.username, req.password, req.platform, req.max_depth
            )
        else:
            engine = NetmikoDiscoveryEngine(
                req.seed_ip, req.username, req.password, req.platform, req.max_depth
            )

        loop = asyncio.get_running_loop()
        raw_topo = await loop.run_in_executor(_executor, engine.discover)

        data = parse_topology(raw_topo)
        await manager.broadcast(data)

        return JSONResponse(
            {"ok": True, "devices": len(data["devices"]), "links": len(data["links"])}
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Discovery failed: {exc}")


@app.get("/api/layouts")
async def list_layouts() -> JSONResponse:
    try:
        sample_dir = Path(__file__).parent.parent / "sample"
        files = []
        for p in sample_dir.glob("*.json"):
            files.append(p.name)
        for p in sample_dir.glob("*.yaml"):
            files.append(p.name)
        for p in sample_dir.glob("*.yml"):
            files.append(p.name)
        return JSONResponse({"layouts": sorted(files)})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list layouts: {exc}")


@app.get("/api/layouts/{filename}")
async def get_layout(filename: str) -> JSONResponse:
    try:
        sample_dir = Path(__file__).parent.parent / "sample"
        safe_path = (sample_dir / filename).resolve()
        if not safe_path.is_relative_to(sample_dir.resolve()):
            raise HTTPException(status_code=400, detail="Invalid filename")

        if not safe_path.exists():
            raise HTTPException(status_code=404, detail="Layout not found")

        content = safe_path.read_text()
        raw = (
            yaml.safe_load(content)
            if filename.endswith((".yaml", ".yml"))
            else json.loads(content)
        )
        parsed = parse_topology(raw)
        manager.latest_topology = parsed
        return JSONResponse(parsed)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load layout: {exc}")


@app.delete("/api/layouts/{filename}")
async def delete_layout(filename: str) -> JSONResponse:
    try:
        sample_dir = Path(__file__).parent.parent / "sample"
        safe_path = (sample_dir / filename).resolve()

        # Block deleting default topology layout
        if safe_path.name == "topology.json":
            raise HTTPException(
                status_code=400, detail="Cannot delete the default layout"
            )

        if not safe_path.is_relative_to(sample_dir.resolve()):
            raise HTTPException(status_code=400, detail="Invalid filename")

        if not safe_path.exists():
            raise HTTPException(status_code=404, detail="Layout not found")

        safe_path.unlink()
        return JSONResponse(
            {"ok": True, "detail": f"Layout {filename} removed successfully"}
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete layout: {exc}")


@app.patch("/api/layouts/{filename}")
async def rename_layout(filename: str, new_name: str) -> JSONResponse:
    try:
        sample_dir = Path(__file__).parent.parent / "sample"
        safe_path = (sample_dir / filename).resolve()

        # Block renaming default topology layout
        if safe_path.name == "topology.json":
            raise HTTPException(
                status_code=400, detail="Cannot rename the default layout"
            )

        if not safe_path.is_relative_to(sample_dir.resolve()) or not safe_path.exists():
            raise HTTPException(status_code=404, detail="Layout not found")

        # Sanitize new name
        clean_new_name = "".join(
            [c for c in new_name if c.isalnum() or c in " _-"]
        ).strip()
        clean_new_name = clean_new_name.lower().replace(" ", "_")
        if not clean_new_name.endswith(".json"):
            clean_new_name += ".json"

        new_path = sample_dir / clean_new_name
        if not new_path.resolve().is_relative_to(sample_dir.resolve()):
            raise HTTPException(status_code=400, detail="Invalid new name")

        if new_path.exists() and new_path.resolve() != safe_path.resolve():
            raise HTTPException(
                status_code=409, detail="A layout with that name already exists"
            )

        # Rename
        safe_path.rename(new_path)
        return JSONResponse({"ok": True, "filename": new_path.name})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to rename layout: {exc}")


@app.post("/api/save")
async def save_topology(req: Topology, name: Optional[str] = None) -> JSONResponse:
    try:
        sample_dir = Path(__file__).parent.parent / "sample"
        if name:
            safe_name = "".join([c for c in name if c.isalnum() or c in " _-"]).strip()
            safe_name = safe_name.lower().replace(" ", "_")
            if not safe_name.endswith(".json"):
                safe_name += ".json"
            save_path = sample_dir / safe_name
        else:
            save_path = sample_dir / "topology.json"

        if not save_path.resolve().is_relative_to(sample_dir.resolve()):
            raise HTTPException(status_code=400, detail="Invalid layout name")

        data = req.model_dump()
        save_path.write_text(json.dumps(data, indent=2))
        manager.latest_topology = data
        await manager.broadcast(data)
        return JSONResponse(
            {
                "ok": True,
                "devices": len(data["devices"]),
                "links": len(data["links"]),
                "filename": save_path.name,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save topology: {exc}")


# ---------------------------------------------------------------------------
# #17 — Server-side layout
# ---------------------------------------------------------------------------


@app.post("/api/layout")
async def compute_layout(request: LayoutRequest) -> JSONResponse:
    """
    Compute node positions server-side using NetworkX.

    Body: { devices: [...], links: [...], algorithm: "spring" | "kamada_kawai" |
            "circular" | "shell" | "spectral" }

    Returns: { positions: { nodeId: {x, y} }, algorithm: str }
    """
    if request.algorithm not in LAYOUT_ALGORITHMS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown algorithm '{request.algorithm}'. Valid: {list(LAYOUT_ALGORITHMS)}",
        )

    devices = [d.model_dump() for d in request.devices]
    links = [lnk.model_dump() for lnk in request.links]

    try:
        loop = asyncio.get_running_loop()
        positions = await loop.run_in_executor(
            _executor,
            _compute_layout_sync,
            devices,
            links,
            request.algorithm,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Layout failed: {exc}")

    return JSONResponse({"positions": positions, "algorithm": request.algorithm})


# ---------------------------------------------------------------------------
# #18 — WebSocket live topology push
# ---------------------------------------------------------------------------


@app.websocket("/ws/topology")
async def ws_topology(websocket: WebSocket) -> None:
    """
    WebSocket endpoint for live topology updates.
    On connect, immediately sends the latest pushed topology (if any).
    Subsequent updates arrive whenever POST /api/push is called.
    """
    await manager.connect(websocket)
    try:
        # Immediately hydrate the new client with the current topology
        if manager.latest_topology is not None:
            await websocket.send_text(json.dumps(manager.latest_topology))
        # Keep connection alive — we only push from the server side
        while True:
            await websocket.receive_text()  # discard any client messages
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# Interactive Terminal Emulator (Mock Shell / Netmiko SSH Proxy)
# ---------------------------------------------------------------------------


def find_path_python(data: dict, start: str, end: str) -> list[str] | None:
    """Helper BFS to find shortest path between devices in topology."""
    adj = {d["id"]: [] for d in data.get("devices", [])}
    for link in data.get("links", []):
        s, t = link.get("source"), link.get("target")
        if s in adj and t in adj:
            adj[s].append(t)
            adj[t].append(s)

    if start not in adj or end not in adj:
        return None

    queue = [[start]]
    visited = {start}
    while queue:
        path = queue.pop(0)
        node = path[-1]
        if node == end:
            return path
        for neighbor in adj.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(path + [neighbor])
    return None


class MockTerminalSession:
    """Simulates a stateful Cisco IOS-like command prompt for topology nodes."""

    def __init__(
        self,
        device_id: str,
        label: str,
        ip: Optional[str],
        platform: str,
        topology_data: dict,
    ):
        self.device_id = device_id
        self.label = label
        self.ip = ip or "10.0.0.1"
        self.platform = platform or "cisco_ios"
        self.topology_data = topology_data
        self.state = "user"  # user, privileged, config
        self.hostname = label.replace(" ", "-").lower()

    def get_prompt(self) -> str:
        if self.state == "user":
            return f"{self.hostname}>"
        elif self.state == "privileged":
            return f"{self.hostname}#"
        elif self.state == "config":
            return f"{self.hostname}(config)#"
        return ">"

    def handle_command(self, cmd_line: str) -> dict:
        cmd_line = cmd_line.strip()
        if not cmd_line:
            return {"text": f"\r\n{self.get_prompt()}"}

        parts = cmd_line.split()
        base_cmd = parts[0].lower()
        args = parts[1:]

        text = ""
        actions = []

        # State transition commands
        if base_cmd in ["enable", "en"]:
            if self.state == "user":
                self.state = "privileged"
            text = ""
        elif base_cmd == "disable":
            if self.state in ["privileged", "config"]:
                self.state = "user"
            text = ""
        elif base_cmd in ["configure", "conf"]:
            if args and args[0].lower() in ["terminal", "t"]:
                if self.state == "privileged":
                    self.state = "config"
                else:
                    text = "% Must be in privileged mode to configure.\r\n"
            else:
                text = "% Incomplete command. Use 'configure terminal'.\r\n"
        elif base_cmd in ["exit", "quit", "end"]:
            if self.state == "config":
                self.state = "privileged"
                text = "% Exiting configuration mode.\r\n"
            elif self.state == "privileged":
                self.state = "user"
            else:
                text = "*** Session closing ***\r\n"
                actions.append({"type": "close"})

        # Show commands
        elif base_cmd in ["show", "sh"]:
            if not args:
                text = "% Incomplete command. Type 'show ?' for options.\r\n"
            else:
                sub_cmd = args[0].lower()
                if (
                    sub_cmd == "ip"
                    and len(args) > 2
                    and args[1].lower() == "interface"
                    and args[2].lower() in ["brief", "br"]
                ):
                    text = self._show_ip_interface_brief()
                elif sub_cmd in ["version", "ver"]:
                    text = self._show_version()
                elif (
                    sub_cmd in ["lldp", "cdp"]
                    and len(args) > 1
                    and args[1].lower() in ["neighbors", "neighbor", "neigh"]
                ):
                    text = self._show_lldp_neighbors()
                else:
                    text = f"% Invalid show command: {' '.join(args)}\r\n"

        # Ping command
        elif base_cmd == "ping":
            if not args:
                text = "Usage: ping <ip_address_or_hostname>\r\n"
            else:
                target = args[0]
                text, path_actions = self._run_ping(target)
                actions.extend(path_actions)

        # Traceroute command
        elif base_cmd in ["traceroute", "trace"]:
            if not args:
                text = "Usage: traceroute <ip_address_or_hostname>\r\n"
            else:
                target = args[0]
                text, path_actions = self._run_traceroute(target)
                actions.extend(path_actions)

        # Clear command
        elif base_cmd in ["clear", "cls"]:
            if args and args[0].lower() == "screen":
                actions.append({"type": "clear"})
            else:
                text = "\r\n"

        # Help command
        elif base_cmd in ["help", "?"]:
            text = self._show_help()

        else:
            text = f"% Unknown command: {cmd_line}\r\n"

        # Construct response output
        if actions and any(a.get("type") == "close" for a in actions):
            output = f"\r\n{text}"
        else:
            output = f"\r\n{text}{self.get_prompt()}"

        return {"text": output, "actions": actions}

    def _show_ip_interface_brief(self) -> str:
        return (
            "Interface              IP-Address      OK? Method Status                Protocol\r\n"
            f"GigabitEthernet1/0/1   {self.ip}       YES manual up                    up\r\n"
            "GigabitEthernet1/0/2   unassigned      YES unset  up                    up\r\n"
            "GigabitEthernet1/0/3   unassigned      YES unset  down                  down\r\n"
            "Loopback0              127.0.0.1       YES manual up                    up\r\n\r\n"
        )

    def _show_version(self) -> str:
        return (
            f"Cisco IOS Software, {self.platform.upper()} Software, Version 15.6(2)T, RELEASE SOFTWARE\r\n"
            "Technical Support: http://www.cisco.com/techsupport\r\n"
            "Copyright (c) 1986-2026 by Cisco Systems, Inc.\r\n"
            "Compiled Wed 23-Mar-26 12:45 by prod_rel_team\r\n"
            "\r\n"
            f"{self.hostname} uptime is 4 weeks, 2 days, 6 hours, 32 minutes\r\n"
            "System returned to ROM by power-on\r\n"
            'System image file is "flash:c2900-universalk9-mz.SPA.156-2.T.bin"\r\n'
            "\r\n"
            "Last reload reason: PowerOn\r\n"
            "\r\n"
        )

    def _show_lldp_neighbors(self) -> str:
        neighbors = []
        for link in self.topology_data.get("links", []):
            if link.get("source") == self.device_id:
                neighbors.append(
                    {
                        "neighbor": link.get("target"),
                        "local_port": link.get("src_iface") or "Gi1/0/1",
                        "remote_port": link.get("dst_iface") or "Gi1/0/1",
                    }
                )
            elif link.get("target") == self.device_id:
                neighbors.append(
                    {
                        "neighbor": link.get("source"),
                        "local_port": link.get("dst_iface") or "Gi1/0/1",
                        "remote_port": link.get("src_iface") or "Gi1/0/1",
                    }
                )

        if not neighbors:
            return "No LLDP neighbors found.\r\n\r\n"

        output = "Capability codes:\r\n  (R) Router, (B) Bridge, (W) WLAN Access Point, (S) Station\r\n\r\n"
        output += "Device ID          Local Intf     Hold-time  Capability Port ID\r\n"
        for n in neighbors:
            # Find the target device label to print
            tgt = next(
                (
                    d
                    for d in self.topology_data.get("devices", [])
                    if d.get("id") == n["neighbor"]
                ),
                None,
            )
            label = tgt.get("label") if tgt else n["neighbor"]

            dev_id = label[:18].ljust(18)
            local_i = n["local_port"][:14].ljust(14)
            rem_i = n["remote_port"][:10].ljust(10)
            output += f"{dev_id} {local_i} 120        R S        {rem_i}\r\n"
        output += "\r\n"
        return output

    def _show_help(self) -> str:
        return (
            "Available Commands:\r\n"
            "  help, ?                 Display this help menu\r\n"
            "  enable / disable        Switch between User/Privileged EXEC modes\r\n"
            "  configure terminal      Enter configuration mode\r\n"
            "  exit, quit              Go back one level, or exit console session\r\n"
            "  clear screen            Clear terminal screen output\r\n"
            "  show version            Display operating system version details\r\n"
            "  show ip interface brief Display interfaces and assigned IP addresses\r\n"
            "  show lldp neighbors     List local LLDP neighbors\r\n"
            "  ping <ip_or_host>       Verify connectivity (flashes visual canvas path)\r\n"
            "  traceroute <ip_or_host> Trace network path (flashes visual canvas path)\r\n\r\n"
        )

    def _run_ping(self, target: str) -> tuple[str, list]:
        target_device = None
        for d in self.topology_data.get("devices", []):
            if (
                d.get("ip") == target
                or d.get("id") == target
                or d.get("label").lower() == target.lower()
            ):
                target_device = d
                break

        text = (
            "Type escape sequence to abort.\r\n"
            f"Sending 5, 100-byte ICMP Echos to {target}, timeout is 2 seconds:\r\n"
        )
        actions = []

        if target_device:
            text += "!!!!!\r\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 1/4/9 ms\r\n\r\n"
            actions.append(
                {
                    "type": "path_highlight",
                    "highlight_type": "ping",
                    "source": self.device_id,
                    "target": target_device.get("id"),
                }
            )
        else:
            text += ".....\r\nSuccess rate is 0 percent (0/5)\r\n\r\n"

        return text, actions

    def _run_traceroute(self, target: str) -> tuple[str, list]:
        target_device = None
        for d in self.topology_data.get("devices", []):
            if (
                d.get("ip") == target
                or d.get("id") == target
                or d.get("label").lower() == target.lower()
            ):
                target_device = d
                break

        text = f"Tracing the route to {target}\r\nVRF info: (default)\r\n"
        actions = []

        if target_device:
            path = find_path_python(
                self.topology_data, self.device_id, target_device.get("id")
            )
            if path:
                for idx, node_id in enumerate(path[1:], 1):
                    node = next(
                        d for d in self.topology_data["devices"] if d["id"] == node_id
                    )
                    ip = node.get("ip") or f"10.0.{idx}.1"
                    text += f"  {idx}  {ip}  {idx * 2} msec  {idx * 2 - 1} msec  {idx * 2 + 1} msec\r\n"
                actions.append(
                    {
                        "type": "path_highlight",
                        "highlight_type": "trace",
                        "source": self.device_id,
                        "target": target_device.get("id"),
                    }
                )
            else:
                text += "  1  * * *\r\n"
        else:
            text += "  1  * * *\r\n"

        text += "\r\n"
        return text, actions


@app.websocket("/ws/terminal/{device_id}")
async def ws_terminal(
    websocket: WebSocket,
    device_id: str,
    mode: str = "mock",
    ip: Optional[str] = None,
    platform: str = "cisco_ios",
    username: Optional[str] = None,
    password: Optional[str] = None,
) -> None:
    await websocket.accept()

    # Load current topology to hydrate mock discovery values
    if manager.latest_topology is not None:
        topology_data = manager.latest_topology
    else:
        try:
            topology_data = json.loads(SAMPLE_PATH.read_text())
        except Exception:
            topology_data = {"devices": [], "links": []}

    # Find the device metadata
    device = next(
        (d for d in topology_data.get("devices", []) if d.get("id") == device_id), None
    )
    device_label = device.get("label") if device else device_id
    device_ip = ip or (device.get("ip") if device else "10.0.0.1")

    if mode == "mock":
        session = MockTerminalSession(
            device_id, device_label, device_ip, platform, topology_data
        )

        welcome = (
            "**************************************************************************\r\n"
            f"*  Network Topology Visualizer - Mock Shell Session                       *\r\n"
            f"*  Connected to: {device_label} ({device_ip})".ljust(73)
            + "*\r\n"
            "*  Type 'help' or '?' to list available commands.                        *\r\n"
            "**************************************************************************\r\n\r\n"
            f"{session.get_prompt()}"
        )
        await websocket.send_json({"type": "output", "text": welcome})

        try:
            while True:
                cmd_line = await websocket.receive_text()
                result = session.handle_command(cmd_line)

                # Send text output
                await websocket.send_json({"type": "output", "text": result["text"]})

                # Run triggers/actions
                for action in result.get("actions", []):
                    if action["type"] == "clear":
                        await websocket.send_json({"type": "clear"})
                    elif action["type"] == "path_highlight":
                        await websocket.send_json(
                            {
                                "type": "path_highlight",
                                "highlight_type": action.get("highlight_type", "trace"),
                                "source": action["source"],
                                "target": action["target"],
                            }
                        )
                    elif action["type"] == "close":
                        await websocket.close()
                        return
        except WebSocketDisconnect:
            pass
        return

    # Real SSH Proxy Session using Netmiko
    else:
        if not NETMIKO_AVAILABLE:
            err_msg = "\r\nError: Netmiko library is not installed in the environment.\r\nReal SSH sessions are disabled.\r\n"
            await websocket.send_json({"type": "output", "text": err_msg})
            await websocket.close()
            return

        if not ip:
            err_msg = "\r\nError: Device IP is required for SSH connection.\r\n"
            await websocket.send_json({"type": "output", "text": err_msg})
            await websocket.close()
            return

        if not username or not password:
            err_msg = (
                "\r\nError: Username and Password credentials are required for SSH.\r\n"
            )
            await websocket.send_json({"type": "output", "text": err_msg})
            await websocket.close()
            return

        ssh_host = ip
        ssh_port = 22
        if ":" in ip:
            try:
                ssh_host, port_str = ip.split(":", 1)
                ssh_port = int(port_str)
            except ValueError:
                pass

        await websocket.send_json(
            {
                "type": "output",
                "text": f"Connecting to {device_label} ({ssh_host}) via SSH on port {ssh_port}...\r\n",
            }
        )

        loop = asyncio.get_running_loop()
        conn_params = {
            "device_type": platform,
            "host": ssh_host,
            "port": ssh_port,
            "username": username,
            "password": password,
        }

        try:
            # Connect handler runs synchronously in ThreadPoolExecutor
            net_connect = await loop.run_in_executor(
                _executor, lambda: ConnectHandler(**conn_params)
            )
        except Exception as e:
            await websocket.send_json(
                {"type": "output", "text": f"\r\nSSH Connection Failed: {str(e)}\r\n"}
            )
            await websocket.close()
            return

        await websocket.send_json(
            {
                "type": "output",
                "text": "Connected! Initializing terminal session...\r\n\r\n",
            }
        )

        # Periodic background read loop
        async def read_from_ssh():
            try:
                while True:
                    # Non-blocking check for incoming terminal characters
                    output = await loop.run_in_executor(
                        _executor, net_connect.read_channel
                    )
                    if output:
                        await websocket.send_json({"type": "output", "text": output})
                    await asyncio.sleep(0.08)
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.error(f"SSH background read error: {e}")

        read_task = asyncio.create_task(read_from_ssh())

        try:
            # Send initial shell prompts already in buffer
            initial_buffer = await loop.run_in_executor(
                _executor, net_connect.read_channel
            )
            if initial_buffer:
                await websocket.send_json({"type": "output", "text": initial_buffer})

            while True:
                # Command string received from websocket
                client_input = await websocket.receive_text()

                # Try to parse client_input as a JSON control packet first (e.g. resize event)
                try:
                    msg = json.loads(client_input)
                    if isinstance(msg, dict) and msg.get("type") == "resize":
                        cols = msg.get("cols", 80)
                        rows = msg.get("rows", 24)
                        if (
                            hasattr(net_connect, "remote_conn")
                            and net_connect.remote_conn
                        ):
                            try:
                                await loop.run_in_executor(
                                    _executor,
                                    net_connect.remote_conn.resize_pty,
                                    cols,
                                    rows,
                                )
                                logger.info(f"PTY resized to {cols}x{rows}")
                            except Exception as re_err:
                                logger.warning(f"Failed to resize SSH PTY: {re_err}")
                        continue
                except json.JSONDecodeError:
                    # Normal terminal command line, proceed with check & execution
                    pass

                cmd_line = client_input.strip()
                if cmd_line:
                    parts = cmd_line.split()
                    base_cmd = parts[0].lower()
                    if base_cmd in ["ping", "traceroute", "trace"] and len(parts) > 1:
                        target = parts[1]
                        target_device = None
                        for d in topology_data.get("devices", []):
                            if (
                                d.get("ip") == target
                                or d.get("id") == target
                                or d.get("label", "").lower() == target.lower()
                            ):
                                target_device = d
                                break
                        if target_device:
                            await websocket.send_json(
                                {
                                    "type": "path_highlight",
                                    "highlight_type": "ping"
                                    if base_cmd == "ping"
                                    else "trace",
                                    "source": device_id,
                                    "target": target_device["id"],
                                }
                            )

                # Write command synchronously in executor
                await loop.run_in_executor(
                    _executor, net_connect.write_channel, client_input + "\n"
                )
        except WebSocketDisconnect:
            pass
        finally:
            # Cleanup SSH connection and loops
            read_task.cancel()
            await loop.run_in_executor(_executor, net_connect.disconnect)


@app.post("/api/push")
async def push_topology(
    request: Request,
    x_api_key: Optional[str] = Header(None),
) -> JSONResponse:
    """
    Push a new topology to all connected WebSocket clients.

    Accepts either:
      - application/json  body: { devices: [...], links: [...] }
      - multipart/form-data with a 'file' field (JSON or YAML)

    Optionally protected by the TOPOLOGY_API_KEY env variable.
    """
    _check_api_key(x_api_key)

    content_type = request.headers.get("content-type", "")

    if "application/json" in content_type:
        raw = await request.json()
    elif "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if not upload:
            raise HTTPException(status_code=422, detail="No 'file' field in form.")
        content = await upload.read()
        try:
            raw = (
                yaml.safe_load(content)
                if upload.filename.endswith((".yaml", ".yml"))
                else json.loads(content)
            )
        except (json.JSONDecodeError, yaml.YAMLError) as exc:
            raise HTTPException(status_code=422, detail=f"Parse error: {exc}")
    else:
        raise HTTPException(
            status_code=415,
            detail="Content-Type must be application/json or multipart/form-data.",
        )

    if not isinstance(raw, dict) or "devices" not in raw or "links" not in raw:
        raise HTTPException(
            status_code=422,
            detail="Payload must have 'devices' and 'links' keys.",
        )

    data = parse_topology(raw)
    client_count = await manager.broadcast(data)
    return JSONResponse({"ok": True, "clients_notified": client_count})


# ---------------------------------------------------------------------------
# Reliable Export Endpoint
# ---------------------------------------------------------------------------


@app.post("/api/export")
async def export_file(
    filename: str = Form(...),
    content: str = Form(...),
    content_type: str = Form(...),
) -> Response:
    """
    Echo endpoint to bypass strict browser (Safari) local Blob download policies.
    Expects raw text for JSON/SVG, and a Data URI for PNG.
    """
    if content.startswith("data:image/png;base64,"):
        b64_str = content.split(",", 1)[1]
        data = base64.b64decode(b64_str)
    else:
        data = content.encode("utf-8")

    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
