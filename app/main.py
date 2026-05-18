"""Network Topology Visualizer — FastAPI backend."""

from __future__ import annotations

import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import networkx as nx
import yaml
from fastapi import (
    FastAPI,
    File,
    Header,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel, Field, model_validator

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
    return HTMLResponse(
        (Path(__file__).parent.parent / "templates" / "index.html").read_text()
    )


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
