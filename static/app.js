'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let network = null;
let currentTopology = null;
let currentLayout = 'hierarchical';
let currentLayer = 'all';
let nodesDataset = null;
let edgesDataset = null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NODE_COLORS = {
  router:   { background: '#1f3a5f', border: '#58a6ff', font: '#79c0ff' },
  switch:   { background: '#1a3a1a', border: '#3fb950', font: '#56d364' },
  firewall: { background: '#3a1a1a', border: '#f85149', font: '#ff7b72' },
  wireless: { background: '#2d1f3a', border: '#d2a8ff', font: '#d2a8ff' },
  cloud:    { background: '#21262d', border: '#8b949e', font: '#8b949e' },
};

const LAYER_LEVEL = {
  internet: 1,
  edge: 2,
  core: 3,
  distribution: 4,
  access: 5,
};

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------
function buildGraph(data) {
  const nodes = data.devices.map(d => {
    const colors = NODE_COLORS[d.type] || NODE_COLORS.switch;
    return {
      id: d.id,
      label: d.label + (d.ip ? '\n' + d.ip : ''),
      ...(currentLayout === 'hierarchical' && { level: LAYER_LEVEL[d.layer] || 3 }),
      color: {
        background: colors.background,
        border: colors.border,
        highlight: { background: colors.background, border: '#fff' },
      },
      font: { color: colors.font, size: 11, face: 'Courier New' },
      shape: 'box',
      borderWidth: 2,
      margin: 8,
      shadow: true,
      title: buildNodeTooltip(d),
      _data: d,
      x: d.x,
      y: d.y,
    };
  });

  const edges = data.links.map((l, i) => ({
    id: i,
    from: l.source,
    to: l.target,
    label: l.protocol || '',
    font: { size: 9, color: '#58a6ff', align: 'middle', strokeWidth: 0 },
    color: { color: '#30363d', highlight: '#58a6ff' },
    width: calcEdgeWidth(l.bandwidth),
    smooth: { type: 'curvedCW', roundness: 0.1 },
    title: buildEdgeTooltip(l),
    _data: l,
  }));

  return { nodes, edges };
}

/** Parse bandwidth string (e.g. "10G", "100M", "1T") to Gbps number. */
function parseBandwidthGbps(bw) {
  if (!bw) return 0;
  const n = parseFloat(bw);
  if (isNaN(n)) return 0;
  const unit = bw.slice(-1).toUpperCase();
  if (unit === 'T') return n * 1000;
  if (unit === 'G') return n;
  if (unit === 'M') return n / 1000;
  if (unit === 'K') return n / 1_000_000;
  return n; // assume Gbps if no unit
}

/** Map Gbps to a visual edge width (1–6px). */
function calcEdgeWidth(bw) {
  const gbps = parseBandwidthGbps(bw);
  if (gbps <= 0) return 1.5;
  // log2 scale: 1G→2, 10G→4.5, 100G→6
  return Math.max(1.5, Math.min(6, Math.log2(gbps + 1) * 1.2 + 1));
}

function buildNodeTooltip(d) {
  return `<b>${d.label}</b><br>Type: ${d.type}<br>Layer: ${d.layer}` +
    (d.ip ? `<br>IP: ${d.ip}` : '') +
    (d.platform ? `<br>Platform: ${d.platform}` : '');
}

function buildEdgeTooltip(l) {
  let t = `Protocol: ${l.protocol || 'N/A'}<br>BW: ${l.bandwidth || 'N/A'}`;
  if (l.src_iface) t += `<br>Src: ${l.src_iface}`;
  if (l.dst_iface) t += `<br>Dst: ${l.dst_iface}`;
  return t;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderNetwork(data) {
  currentTopology = data;
  currentLayer = 'all';

  // Reset search UI
  const searchInput = document.getElementById('node-search');
  if (searchInput) { searchInput.value = ''; }
  const searchClear = document.getElementById('search-clear');
  if (searchClear) { searchClear.style.display = 'none'; }
  const searchResults = document.getElementById('search-results');
  if (searchResults) { searchResults.textContent = ''; searchResults.className = 'search-results'; }

  // Reset layer buttons
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layer === 'all');
  });

  const { nodes, edges } = buildGraph(data);

  nodesDataset = new vis.DataSet(nodes);
  edgesDataset = new vis.DataSet(edges);

  const container = document.getElementById('network-container');
  if (network) network.destroy();
  network = new vis.Network(container, { nodes: nodesDataset, edges: edgesDataset }, getOptions());

  network.on('click', params => {
    if (params.nodes.length > 0) {
      const node = nodesDataset.get(params.nodes[0]);
      showDeviceDetail(node._data, data.links);
    } else if (params.edges.length > 0) {
      const edge = edgesDataset.get(params.edges[0]);
      showEdgeDetail(edge._data);
    } else {
      resetDetailPanel();
    }
  });

  updateStats(data);
  enableExportButtons(true);
}

function getOptions() {
  const base = {
    physics: {
      enabled: currentLayout === 'free',
      stabilization: { iterations: 150 },
    },
    layout: {
      hierarchical: { enabled: false }
    },
    interaction: {
      hover: true,
      tooltipDelay: 150,
      navigationButtons: true,
      keyboard: true,
    },
    edges: { arrows: { to: { enabled: false } } },
  };
  if (currentLayout === 'hierarchical') {
    base.layout = {
      hierarchical: {
        enabled: true,
        direction: 'UD',
        sortMethod: 'directed',
        levelSeparation: 110,
        nodeSpacing: 160,
      },
    };
    base.physics = { enabled: false };
  } else if (currentLayout === 'server') {
    base.physics = { enabled: false };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Layout toggle
// ---------------------------------------------------------------------------
function setLayout(layout) {
  currentLayout = layout;
  document.querySelectorAll('.ctrl-btn[data-layout]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === layout);
  });
  if (currentTopology) {
    // Strip manual coordinates so Vis.js recalculates
    currentTopology.devices.forEach(d => { delete d.x; delete d.y; });
    renderNetwork(currentTopology);
  }
}

// ---------------------------------------------------------------------------
// Layer filter
// ---------------------------------------------------------------------------
function setLayerFilter(layer) {
  if (!currentTopology) return;
  currentLayer = layer;

  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layer === layer);
  });

  if (layer === 'all') {
    // Restore all nodes and their connected edges
    const { nodes, edges } = buildGraph(currentTopology);
    nodesDataset.clear();
    edgesDataset.clear();
    nodesDataset.add(nodes);
    edgesDataset.add(edges);
    return;
  }

  const { nodes: allNodes, edges: allEdges } = buildGraph(currentTopology);
  const visibleIds = new Set(
    allNodes.filter(n => n._data.layer === layer).map(n => n.id)
  );
  const filteredNodes = allNodes.filter(n => visibleIds.has(n.id));
  const filteredEdges = allEdges.filter(e => visibleIds.has(e.from) && visibleIds.has(e.to));

  nodesDataset.clear();
  edgesDataset.clear();
  nodesDataset.add(filteredNodes);
  edgesDataset.add(filteredEdges);

  if (filteredNodes.length === 0) {
    showToast('No devices in this layer', 'warning');
  }
}

// ---------------------------------------------------------------------------
// Fit to screen
// ---------------------------------------------------------------------------
function fitNetwork() {
  if (network) network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
}

// ---------------------------------------------------------------------------
// Node search & highlight
// ---------------------------------------------------------------------------

/**
 * Dim all nodes that don't match the query, highlight and focus those that do.
 * Searches: label, ip, platform, type, layer.
 */
function searchNodes(query) {
  const clearBtn = document.getElementById('search-clear');
  const resultsEl = document.getElementById('search-results');

  query = (query || '').trim().toLowerCase();
  clearBtn.style.display = query ? 'flex' : 'none';

  if (!network || !nodesDataset) { resultsEl.textContent = ''; return; }

  if (!query) {
    resetNodeHighlight();
    resultsEl.textContent = '';
    return;
  }

  const allNodes = nodesDataset.get();
  const matchIds = allNodes
    .filter(n => {
      const d = n._data;
      return (
        d.label.toLowerCase().includes(query) ||
        (d.ip && d.ip.includes(query)) ||
        (d.platform && d.platform.toLowerCase().includes(query)) ||
        d.type.toLowerCase().includes(query) ||
        d.layer.toLowerCase().includes(query)
      );
    })
    .map(n => n.id);

  highlightMatchedNodes(matchIds);

  // Update result count
  if (matchIds.length === 0) {
    resultsEl.textContent = 'No matches';
    resultsEl.className = 'search-results search-no-match';
  } else {
    resultsEl.textContent = `${matchIds.length} match${matchIds.length > 1 ? 'es' : ''}`;
    resultsEl.className = 'search-results search-match';
  }

  // Pan/focus
  if (matchIds.length === 1) {
    network.focus(matchIds[0], { scale: 1.3, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
    network.selectNodes(matchIds);
  } else if (matchIds.length > 1 && matchIds.length <= 10) {
    network.fit({ nodes: matchIds, animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
  }
}

function clearSearch() {
  const input = document.getElementById('node-search');
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.focus();
}

/** Dim unmatched nodes, brighten matched ones. */
function highlightMatchedNodes(matchIds) {
  if (!nodesDataset) return;
  const matchSet = new Set(matchIds);
  const DIM = { background: '#161b22', border: '#21262d' };
  const DIM_FONT = { color: '#3d444d' };

  const updates = nodesDataset.get().map(node => {
    if (matchSet.has(node.id)) {
      const colors = NODE_COLORS[node._data.type] || NODE_COLORS.switch;
      return {
        id: node.id,
        color: { background: colors.background, border: '#ffffff', highlight: { background: colors.background, border: '#ffffff' } },
        font: { color: colors.font, size: 12, face: 'Courier New' },
        borderWidth: 3,
        shadow: { enabled: true, color: colors.border, size: 12, x: 0, y: 0 },
      };
    }
    return {
      id: node.id,
      color: { background: DIM.background, border: DIM.border, highlight: { background: DIM.background, border: DIM.border } },
      font: { ...DIM_FONT, size: 10, face: 'Courier New' },
      borderWidth: 1,
      shadow: false,
    };
  });
  nodesDataset.update(updates);
}

/** Restore all node styles to their type defaults. */
function resetNodeHighlight() {
  if (!nodesDataset || !currentTopology) return;
  const { nodes } = buildGraph(currentTopology);
  // Only update nodes currently in the dataset (respects layer filter)
  const visibleIds = new Set(nodesDataset.getIds());
  nodesDataset.update(nodes.filter(n => visibleIds.has(n.id)));
  network.unselectAll();
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function showDeviceDetail(device, links) {
  const connectedLinks = links.filter(l => l.source === device.id || l.target === device.id);
  document.getElementById('detail-title').textContent = device.label;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-row"><div class="detail-key">Type</div><div class="detail-val">${device.type}</div></div>
    <div class="detail-row"><div class="detail-key">Layer</div><div class="detail-val">${device.layer}</div></div>
    ${device.ip ? `<div class="detail-row"><div class="detail-key">IP Address</div><div class="detail-val">${device.ip}</div></div>` : ''}
    ${device.platform ? `<div class="detail-row"><div class="detail-key">Platform</div><div class="detail-val">${device.platform}</div></div>` : ''}
    <div class="detail-row"><div class="detail-key">Connections (${connectedLinks.length})</div>
      ${connectedLinks.map(l => `
        <div class="link-item">
          <div class="link-proto">${l.protocol || 'UNKNOWN'}</div>
          <div class="link-detail">${l.source === device.id ? '→ ' + l.target : '← ' + l.source}${l.bandwidth ? ' · ' + l.bandwidth : ''}</div>
          ${l.src_iface || l.dst_iface ? `<div class="link-iface">${l.src_iface || '—'} ↔ ${l.dst_iface || '—'}</div>` : ''}
        </div>`).join('')}
    </div>
  `;
  setDetailVisible(true);
}

function showEdgeDetail(link) {
  document.getElementById('detail-title').textContent = `Link: ${link.source} ↔ ${link.target}`;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-row"><div class="detail-key">Protocol</div><div class="detail-val">${link.protocol || 'N/A'}</div></div>
    <div class="detail-row"><div class="detail-key">Bandwidth</div><div class="detail-val">${link.bandwidth || 'N/A'}</div></div>
    ${link.src_iface ? `<div class="detail-row"><div class="detail-key">Source Interface</div><div class="detail-val">${link.src_iface}</div></div>` : ''}
    ${link.dst_iface ? `<div class="detail-row"><div class="detail-key">Dest Interface</div><div class="detail-val">${link.dst_iface}</div></div>` : ''}
  `;
  setDetailVisible(true);
}

function resetDetailPanel() {
  setDetailVisible(false);
}

function setDetailVisible(visible) {
  document.getElementById('detail-empty').classList.toggle('hidden', visible);
  document.getElementById('detail-content').classList.toggle('hidden', !visible);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
function updateStats(data) {
  const types = {};
  data.devices.forEach(d => { types[d.type] = (types[d.type] || 0) + 1; });
  document.getElementById('stats').innerHTML =
    `Devices: <b>${data.devices.length}</b><br>Links: <b>${data.links.length}</b><br>` +
    Object.entries(types).map(([t, n]) => `${t}: ${n}`).join('<br>');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function enableExportButtons(enabled) {
  document.getElementById('btn-export-png').disabled = !enabled;
  document.getElementById('btn-export-svg').disabled = !enabled;
  document.getElementById('btn-apply-layout').disabled = !enabled;
}

function exportPNG() {
  if (!network) return;
  const canvas = document.querySelector('#network-container canvas');
  if (!canvas) {
    alert("Error: Canvas element not found. Please try zooming or moving the graph slightly.");
    return;
  }
  
  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = 'network-topology.png';
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('PNG exported successfully', 'success');
}

function exportSVG() {
  if (!network) return;
  const canvas = document.querySelector('#network-container canvas');
  if (!canvas) {
    alert("Error: Canvas element not found. Please try zooming or moving the graph slightly.");
    return;
  }
  
  const dataUrl = canvas.toDataURL('image/png');
  const { width, height } = canvas;
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#0d1117"/>
  <image href="${dataUrl}" x="0" y="0" width="${width}" height="${height}"/>
</svg>`;
  // Force octet-stream so Safari doesn't ignore the file extension
  const blob = new Blob([svgContent], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = 'network-topology.svg';
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('SVG exported successfully', 'success');
}

// ---------------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------------
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-msg">${message}</span>`;
  container.appendChild(toast);

  // Trigger enter animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------
function setLoading(loading) {
  document.getElementById('canvas-loading').classList.toggle('hidden', !loading);
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
async function loadSample() {
  setLoading(true);
  try {
    const resp = await fetch('/api/sample');
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Failed to load sample: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    renderNetwork(await resp.json());
    showToast('Sample topology loaded', 'success');
  } catch (e) {
    showToast('Network error loading sample', 'error');
  } finally {
    setLoading(false);
  }
}

async function uploadTopology(event) {
  const file = event.target.files[0];
  if (!file) return;
  setLoading(true);
  const form = new FormData();
  form.append('file', file);
  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Upload error: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    renderNetwork(await resp.json());
    showToast(`Loaded: ${file.name}`, 'success');
  } catch (e) {
    showToast('Network error during upload', 'error');
  } finally {
    setLoading(false);
    // Reset input so same file can be re-uploaded
    event.target.value = '';
  }
}

// ---------------------------------------------------------------------------
// #17 — Server-side layout (NetworkX)
// ---------------------------------------------------------------------------

async function computeServerLayout() {
  if (!currentTopology || !network) return;
  const algorithm = document.getElementById('server-algorithm').value;

  setLoading(true);
  try {
    const resp = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...currentTopology, algorithm }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Layout error: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    const { positions, algorithm: algo } = await resp.json();

    // Update currentTopology devices with positions
    currentTopology.devices.forEach(d => {
      if (positions[d.id]) {
        d.x = positions[d.id].x;
        d.y = positions[d.id].y;
      }
    });

    // Switch to server layout mode
    currentLayout = 'server';
    document.querySelectorAll('.ctrl-btn[data-layout]').forEach(btn => {
      btn.classList.remove('active');
    });

    // Re-render completely with the new coordinates
    renderNetwork(currentTopology);

    setTimeout(() => {
      network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    }, 80);

    const label = document.querySelector(`#server-algorithm option[value="${algo}"]`);
    showToast(`${label ? label.textContent : algo} layout applied`, 'success');
  } catch (e) {
    showToast('Network error computing layout', 'error');
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// #18 — WebSocket live topology feed
// ---------------------------------------------------------------------------

let _ws = null;
let _wsReconnectTimer = null;
let _wsDelay = 1000; // ms; doubles on each failure, capped at 30s

function initWebSocket() {
  clearTimeout(_wsReconnectTimer);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/topology`;

  _ws = new WebSocket(url);

  _ws.onopen = () => {
    _wsDelay = 1000; // reset back-off on successful connect
    setLiveIndicator(true);
  };

  _ws.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      if (data && data.devices && data.links) {
        renderNetwork(data);
        showToast('Topology updated via live feed', 'info');
      }
    } catch (e) {
      console.error('[WS] message parse error', e);
    }
  };

  _ws.onclose = () => {
    setLiveIndicator(false);
    _wsDelay = Math.min(_wsDelay * 2, 30_000);
    _wsReconnectTimer = setTimeout(initWebSocket, _wsDelay);
  };

  _ws.onerror = () => {
    _ws.close(); // triggers onclose → reconnect
  };
}

function setLiveIndicator(connected) {
  document.getElementById('live-indicator')?.classList.toggle('hidden', !connected);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.addEventListener('load', () => {
  loadSample();
  initWebSocket();
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  // Skip if focus is inside an input
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Escape') {
      clearSearch();
      document.getElementById('node-search').blur();
    }
    return;
  }
  if (e.key === 'f' || e.key === 'F') fitNetwork();
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('node-search').focus();
  }
});
