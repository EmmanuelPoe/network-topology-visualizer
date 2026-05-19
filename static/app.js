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

const DEVICE_ICONS = {
  router:   `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#1f3a5f" stroke="#58a6ff" stroke-width="3"/><path d="M32 14L32 50M14 32L50 32M26 22l6-6 6 6M26 42l6 6 6-6M22 26l-6 6 6 6M42 26l6 6-6 6" fill="none" stroke="#58a6ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`)}`,
  switch:   `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="8" y="20" width="48" height="24" rx="4" fill="#1a3a1a" stroke="#3fb950" stroke-width="3"/><path d="M16 28h32M44 28l-4-4M44 28l-4 4M48 36H16M20 36l4-4M20 36l4 4" fill="none" stroke="#3fb950" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`)}`,
  firewall: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="8" y="12" width="48" height="40" rx="2" fill="#3a1a1a" stroke="#f85149" stroke-width="3"/><path d="M8 26h48M8 38h48M22 12v14M42 12v14M32 26v12M18 38v14M46 38v14" fill="none" stroke="#f85149" stroke-width="3" stroke-linecap="round"/></svg>`)}`,
  wireless: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="18" y="44" width="28" height="8" rx="2" fill="#2d1f3a" stroke="#d2a8ff" stroke-width="3"/><path d="M32 44v-6M22 28c5.5-5.5 14.5-5.5 20 0M16 20c8.8-8.8 23.2-8.8 32 0M28 36c2.2-2.2 5.8-2.2 8 0" fill="none" stroke="#d2a8ff" stroke-width="3" stroke-linecap="round"/></svg>`)}`,
  cloud:    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M18 44c-5.5 0-10-4.5-10-10 0-5.1 3.8-9.4 8.8-9.9 1.7-6.2 7.4-10.9 14.5-10.9 6 0 11.2 3.5 13.8 8.6 6.1.9 9.5 5.3 9.5 10.4 0 6.4-5.2 11.8-11.6 11.8H18z" fill="#21262d" stroke="#8b949e" stroke-width="3" stroke-linejoin="round"/></svg>`)}`
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
    const icon = DEVICE_ICONS[d.type] || DEVICE_ICONS.switch;
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
      shape: 'image',
      image: icon,
      size: 24,
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
    hideContextMenu();
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

  network.on('doubleClick', params => {
    if (params.nodes.length > 0) {
      const nodeData = nodesDataset.get(params.nodes[0]);
      showNodeEditor('edit', nodeData, null);
    } else if (params.edges.length > 0) {
      const edgeData = edgesDataset.get(params.edges[0]);
      showEdgeEditor('edit', { from: edgeData.from, to: edgeData.to, _data: edgeData._data }, null);
    }
  });

  network.on('oncontext', params => {
    params.event.preventDefault();
    const menu = document.getElementById('context-menu');
    const copyBtn = document.getElementById('menu-copy');
    const pasteBtn = document.getElementById('menu-paste');
    
    menu.style.left = params.event.clientX + 'px';
    menu.style.top = params.event.clientY + 'px';
    menu.classList.remove('hidden');
    
    pastePosition = params.pointer.canvas;
    
    const nodeId = network.getNodeAt(params.pointer.DOM);
    if (nodeId) {
      const nodeData = nodesDataset.get(nodeId);
      if (nodeData && nodeData._data) {
        menuSelectedNodeData = nodeData._data;
        copyBtn.classList.remove('disabled');
      } else {
        copyBtn.classList.add('disabled');
      }
    } else {
      menuSelectedNodeData = null;
      copyBtn.classList.add('disabled');
    }
    
    if (copiedNodeData) {
      pasteBtn.classList.remove('disabled');
    } else {
      pasteBtn.classList.add('disabled');
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
    manipulation: {
      enabled: true,
      addNode: function (data, callback) {
        showNodeEditor('add', data, callback);
      },
      editNode: function (data, callback) {
        showNodeEditor('edit', data, callback);
      },
      addEdge: function (data, callback) {
        if (data.from === data.to) {
          callback(null);
          return;
        }
        showEdgeEditor('add', data, callback);
      },
      editEdge: function (data, callback) {
        if (data.from === data.to) {
          callback(null);
          return;
        }
        showEdgeEditor('edit', data, callback);
      },
      deleteNode: function (data, callback) {
        if (!currentTopology) return callback(null);
        const nodeIds = data.nodes;
        currentTopology.devices = currentTopology.devices.filter(d => !nodeIds.includes(d.id));
        currentTopology.links = currentTopology.links.filter(l => !nodeIds.includes(l.source) && !nodeIds.includes(l.target));
        updateStats(currentTopology);
        callback(data);
      },
      deleteEdge: function (data, callback) {
        if (!currentTopology) return callback(null);
        // Vis.js provides internal edge IDs in data.edges.
        // It's safest to just rebuild currentTopology.links based on what edges remain in edgesDataset.
        // However, Vis hasn't deleted them yet. We'll delete from dataset, then rebuild.
        callback(data);
        setTimeout(() => syncTopologyFromGraph(), 50);
      }
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
  document.getElementById('btn-export-json').disabled = !enabled;
  document.getElementById('btn-apply-layout').disabled = !enabled;
}

function forceDownload(filename, content, type) {
  const form = document.getElementById('export-form');
  document.getElementById('export-filename').value = filename;
  document.getElementById('export-content').value = content;
  document.getElementById('export-content-type').value = type;
  form.submit();
}

function exportPNG() {
  if (!network) return;
  const canvas = document.querySelector('#network-container canvas');
  if (!canvas) {
    alert("Error: Canvas element not found. Please try zooming or moving the graph slightly.");
    return;
  }
  
  const dataUrl = canvas.toDataURL('image/png');
  forceDownload('network-topology.png', dataUrl, 'image/png');
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

  forceDownload('network-topology.svg', svgContent, 'image/svg+xml');
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
function clearLayout() {
  renderNetwork({ devices: [], links: [] });
  showToast('Started new empty topology', 'success');
}

function stopAdding() {
  if (network) {
    network.disableEditMode();
    network.enableEditMode();
    document.getElementById('btn-done-adding')?.classList.add('hidden');
    showToast('Exited add mode');
  }
}

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
// Context Menu
// ---------------------------------------------------------------------------
let copiedNodeData = null;
let pastePosition = null;
let menuSelectedNodeData = null;
let pendingPastePosition = null;

function hideContextMenu() {
  document.getElementById('context-menu')?.classList.add('hidden');
}

function handleMenuCopy() {
  hideContextMenu();
  if (menuSelectedNodeData) {
    copiedNodeData = menuSelectedNodeData;
    showToast('Node copied', 'success');
  }
}

function handleMenuPaste() {
  hideContextMenu();
  if (copiedNodeData && pastePosition) {
    const copyData = { 
      ...copiedNodeData, 
      id: '', 
      label: copiedNodeData.label + ' (copy)'
    };
    pendingPastePosition = pastePosition;
    showNodeEditor('add', copyData, null);
  }
}

// ---------------------------------------------------------------------------
// GUI Builder Modals & Syncing
// ---------------------------------------------------------------------------
let pendingCallback = null;
let pendingNodeAction = null;

function showNodeEditor(action, data, callback) {
  pendingCallback = callback;
  pendingNodeAction = action;
  const modal = document.getElementById('node-modal');
  const isEdit = action === 'edit';
  
  document.getElementById('node-modal-title').textContent = isEdit ? 'Edit Node' : 'Add Node';
  document.getElementById('node-id').value = data.id || `node-${Math.random().toString(36).substr(2, 6)}`;
  
  if (isEdit && currentTopology) {
    const existing = currentTopology.devices.find(d => d.id === data.id);
    if (existing) {
      document.getElementById('node-label').value = existing.label || '';
      document.getElementById('node-type').value = existing.type || 'switch';
      document.getElementById('node-layer').value = existing.layer || 'access';
      document.getElementById('node-ip').value = existing.ip || '';
      document.getElementById('node-platform').value = existing.platform || '';
    }
  } else {
    document.getElementById('node-label').value = data.label || '';
    document.getElementById('node-type').value = data.type || 'switch';
    document.getElementById('node-layer').value = data.layer || 'access';
    document.getElementById('node-ip').value = data.ip || '';
    document.getElementById('node-platform').value = data.platform || '';
  }
  
  modal.classList.remove('hidden');
}

function showEdgeEditor(action, data, callback) {
  pendingCallback = callback;
  const modal = document.getElementById('edge-modal');
  const isEdit = action === 'edit';
  
  document.getElementById('edge-modal-title').textContent = isEdit ? 'Edit Link' : 'Add Link';
  
  if (isEdit && currentTopology && data._data) {
    document.getElementById('edge-protocol').value = data._data.protocol || '';
    document.getElementById('edge-bandwidth').value = data._data.bandwidth || '';
    document.getElementById('edge-src-iface').value = data._data.src_iface || '';
    document.getElementById('edge-dst-iface').value = data._data.dst_iface || '';
  } else {
    document.getElementById('edge-protocol').value = '';
    document.getElementById('edge-bandwidth').value = '1G';
    document.getElementById('edge-src-iface').value = '';
    document.getElementById('edge-dst-iface').value = '';
  }
  
  modal.classList.remove('hidden');
}

document.getElementById('node-cancel')?.addEventListener('click', () => {
  document.getElementById('node-modal').classList.add('hidden');
  if (pendingCallback) pendingCallback(null);
  pendingCallback = null;
});

document.getElementById('node-save')?.addEventListener('click', () => {
  const id = document.getElementById('node-id').value;
  const label = document.getElementById('node-label').value;
  const type = document.getElementById('node-type').value;
  const layer = document.getElementById('node-layer').value;
  const ip = document.getElementById('node-ip').value;
  const platform = document.getElementById('node-platform').value;

  document.getElementById('node-modal').classList.add('hidden');

  if (!label.trim()) {
    showToast('Label is required', 'warning');
    if (pendingCallback) pendingCallback(null);
    return;
  }

  const deviceData = { id, label, type, layer, ip, platform };
  
  if (pendingPastePosition) {
    deviceData.x = pendingPastePosition.x;
    deviceData.y = pendingPastePosition.y;
    pendingPastePosition = null;
  }
  
  // Update internal model
  if (!currentTopology) currentTopology = { devices: [], links: [] };
  const existingIndex = currentTopology.devices.findIndex(d => d.id === id);
  if (existingIndex >= 0) {
    currentTopology.devices[existingIndex] = deviceData;
  } else {
    currentTopology.devices.push(deviceData);
  }
  
  const { nodes, edges } = buildGraph(currentTopology);
  nodesDataset.update(nodes);
  edgesDataset.update(edges);
  updateStats(currentTopology);
  
  if (pendingCallback) pendingCallback(null);
  pendingCallback = null;

  if (pendingNodeAction === 'add' && network) {
    setTimeout(() => { 
      network.addNodeMode(); 
      document.getElementById('btn-done-adding')?.classList.remove('hidden');
    }, 50);
  }
});

document.getElementById('edge-cancel')?.addEventListener('click', () => {
  document.getElementById('edge-modal').classList.add('hidden');
  if (pendingCallback) pendingCallback(null);
  pendingCallback = null;
});

document.getElementById('edge-save')?.addEventListener('click', () => {
  const protocol = document.getElementById('edge-protocol').value;
  const bandwidth = document.getElementById('edge-bandwidth').value;
  const src_iface = document.getElementById('edge-src-iface').value;
  const dst_iface = document.getElementById('edge-dst-iface').value;
  
  document.getElementById('edge-modal').classList.add('hidden');
  
  // To link correctly, we need from/to which are hidden in pendingCallback scope
  // Since we don't have access to the data object easily here, we rely on a global or hack:
  // We can just recreate the edge logic inside the callback wrapper.
});

// Let's modify showEdgeEditor to bind the save action dynamically
function showEdgeEditor(action, data, callback) {
  const modal = document.getElementById('edge-modal');
  const isEdit = action === 'edit';
  document.getElementById('edge-modal-title').textContent = isEdit ? 'Edit Link' : 'Add Link';
  
  let oldEdgeData = isEdit && data._data ? data._data : null;
  if (!oldEdgeData && isEdit && currentTopology) {
    // Attempt to find by from/to if data._data is missing
    oldEdgeData = currentTopology.links.find(l => l.source === data.from && l.target === data.to);
  }

  document.getElementById('edge-protocol').value = oldEdgeData?.protocol || '';
  document.getElementById('edge-bandwidth').value = oldEdgeData?.bandwidth || '1G';
  document.getElementById('edge-src-iface').value = oldEdgeData?.src_iface || '';
  document.getElementById('edge-dst-iface').value = oldEdgeData?.dst_iface || '';
  
  const saveBtn = document.getElementById('edge-save');
  const cancelBtn = document.getElementById('edge-cancel');
  
  const cleanup = () => {
    modal.classList.add('hidden');
    saveBtn.removeEventListener('click', onSave);
    cancelBtn.removeEventListener('click', onCancel);
  };
  
  const onCancel = () => {
    cleanup();
    callback(null);
  };
  
  const onSave = () => {
    cleanup();
    const linkData = {
      source: data.from,
      target: data.to,
      protocol: document.getElementById('edge-protocol').value,
      bandwidth: document.getElementById('edge-bandwidth').value,
      src_iface: document.getElementById('edge-src-iface').value,
      dst_iface: document.getElementById('edge-dst-iface').value,
    };
    
    if (!currentTopology) currentTopology = { devices: [], links: [] };
    
    if (isEdit) {
      const idx = currentTopology.links.findIndex(l => l.source === data.from && l.target === data.to);
      if (idx >= 0) currentTopology.links[idx] = linkData;
    } else {
      currentTopology.links.push(linkData);
    }
    
    const { nodes, edges } = buildGraph(currentTopology);
    nodesDataset.update(nodes);
    edgesDataset.update(edges);
    updateStats(currentTopology);

    callback(null);

    if (!isEdit && network) {
      setTimeout(() => { 
        network.addEdgeMode(); 
        document.getElementById('btn-done-adding')?.classList.remove('hidden');
      }, 50);
    }
  };
  
  saveBtn.addEventListener('click', onSave);
  cancelBtn.addEventListener('click', onCancel);
  modal.classList.remove('hidden');
}

// Ensure the edge-save global listener is removed (we just use the dynamic one above)
const existingEdgeSave = document.getElementById('edge-save');
if (existingEdgeSave) {
  const newEdgeSave = existingEdgeSave.cloneNode(true);
  existingEdgeSave.parentNode.replaceChild(newEdgeSave, existingEdgeSave);
}
const existingEdgeCancel = document.getElementById('edge-cancel');
if (existingEdgeCancel) {
  const newEdgeCancel = existingEdgeCancel.cloneNode(true);
  existingEdgeCancel.parentNode.replaceChild(newEdgeCancel, existingEdgeCancel);
}

function syncTopologyFromGraph() {
  if (!network || !currentTopology) return;
  // Rebuild links based on edgesDataset to handle deletions
  const activeEdgeIds = edgesDataset.getIds();
  const activeEdges = edgesDataset.get(activeEdgeIds);
  currentTopology.links = activeEdges.map(e => {
    return {
      source: e.from,
      target: e.to,
      protocol: e._data?.protocol || '',
      bandwidth: e._data?.bandwidth || '1G',
      src_iface: e._data?.src_iface || '',
      dst_iface: e._data?.dst_iface || ''
    };
  });
  updateStats(currentTopology);
}

function exportJSON() {
  if (!currentTopology) return;
  
  // Update node coordinates if layout is free or server
  if (network && (currentLayout === 'free' || currentLayout === 'server')) {
    const positions = network.getPositions();
    currentTopology.devices.forEach(d => {
      if (positions[d.id]) {
        d.x = positions[d.id].x;
        d.y = positions[d.id].y;
      }
    });
  }
  
  const jsonString = JSON.stringify(currentTopology, null, 2);
  forceDownload('network-topology.json', jsonString, 'application/json');
  showToast('JSON exported successfully', 'success');
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
  if (e.key === 'Escape' && network) {
    stopAdding();
  }
  if (e.key === 'f' || e.key === 'F') fitNetwork();
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('node-search').focus();
  }
});

// Catch vis.js manipulation toolbar clicks to show/hide the Done button
document.addEventListener('click', e => {
  if (!e.target || !e.target.classList) return;
  if (e.target.classList.contains('vis-back')) {
    document.getElementById('btn-done-adding')?.classList.add('hidden');
  } else if (e.target.classList.contains('vis-add') || e.target.classList.contains('vis-addEdge')) {
    document.getElementById('btn-done-adding')?.classList.remove('hidden');
  }
});
