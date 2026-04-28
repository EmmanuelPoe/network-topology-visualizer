from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pathlib import Path
import json
import yaml

app = FastAPI(title="Network Topology Visualizer")
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent.parent / "static")), name="static")

SAMPLE_PATH = Path(__file__).parent.parent / "sample" / "topology.json"


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTMLResponse((Path(__file__).parent.parent / "templates" / "index.html").read_text())


@app.get("/api/sample")
async def get_sample():
    return JSONResponse(json.loads(SAMPLE_PATH.read_text()))


@app.post("/api/upload")
async def upload_topology(file: UploadFile = File(...)):
    content = await file.read()
    try:
        if file.filename.endswith(('.yaml', '.yml')):
            data = yaml.safe_load(content)
        else:
            data = json.loads(content)
        if "devices" not in data or "links" not in data:
            raise HTTPException(status_code=422, detail="JSON must have 'devices' and 'links' keys")
        return JSONResponse(data)
    except (json.JSONDecodeError, yaml.YAMLError) as e:
        raise HTTPException(status_code=422, detail=f"Parse error: {e}")
