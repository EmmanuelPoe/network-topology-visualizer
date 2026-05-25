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
let isEditingMode = false;
let hasDraggedNode = false;

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

function hasCustomCoordinates() {
  return currentTopology && currentTopology.devices && currentTopology.devices.some(d => typeof d.x === 'number' && typeof d.y === 'number');
}

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
      borderWidth: 1,
      shadow: {
        enabled: true,
        color: 'rgba(0,0,0,0.5)',
        size: 10,
        x: 5,
        y: 5
      },
      title: buildNodeTooltip(d),
      _data: d,
      x: d.x,
      y: d.y,
      fixed: !isEditingMode,
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
    dashing: false,
    shadow: false,
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
  closeTerminal(false);
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

  // Automatically switch layout mode to 'free' if saved positions are present in the layout file
  const hasSavedPositions = data.devices && data.devices.some(d => typeof d.x === 'number' && typeof d.y === 'number');
  if (hasSavedPositions) {
    currentLayout = 'free';
  } else {
    // If layout is server/free and there are no saved positions, we can keep it as is,
    // otherwise fallback to hierarchical for default layouts.
    if (currentLayout !== 'free' && currentLayout !== 'server') {
      currentLayout = 'hierarchical';
    }
  }

  // Update layout control active states
  document.querySelectorAll('.ctrl-btn[data-layout]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === currentLayout);
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
    if (!isEditingMode) return;
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

  network.on('dragEnd', params => {
    if (isEditingMode) {
      hasDraggedNode = true;
    }
  });

  updateStats(data);
  enableExportButtons(true);
}

function getOptions() {
  const base = {
    physics: {
      enabled: currentLayout === 'free' && !isEditingMode && !hasCustomCoordinates(),
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
      dragNodes: isEditingMode,
      selectConnectedEdges: false,
    },
    manipulation: {
      enabled: isEditingMode,
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
        enabled: !isEditingMode,
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
    <button id="open-console-btn" class="ctrl-btn active" style="margin-top: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600;">
      <span>&#128187;</span> Open Console
    </button>
  `;
  setDetailVisible(true);
  const consoleBtn = document.getElementById('open-console-btn');
  if (consoleBtn) {
    consoleBtn.addEventListener('click', () => {
      openTerminalForDevice(device.id);
    });
  }
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
  document.getElementById('btn-save-server').disabled = !enabled;
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
  
  const select = document.getElementById('select-server-layout');
  if (select) select.value = '';
  const deleteBtn = document.getElementById('btn-delete-layout');
  if (deleteBtn) deleteBtn.disabled = true;
  const renameBtn = document.getElementById('btn-rename-layout');
  if (renameBtn) renameBtn.disabled = true;
}

function stopAdding() {
  if (isEditingMode) {
    toggleEditMode();
  }
}

function toggleEditMode() {
  isEditingMode = !isEditingMode;
  const btn = document.getElementById('btn-edit-toggle');
  if (btn) {
    if (isEditingMode) {
      btn.innerHTML = '&#10004; Done Editing';
      btn.title = 'Finish editing network diagram';
      btn.classList.add('active-editing');
      showToast('Entered edit mode. Rearrange devices or add/link new ones.', 'info');
    } else {
      btn.innerHTML = '&#9998; Edit Layout';
      btn.title = 'Toggle editing network diagram';
      btn.classList.remove('active-editing');
      showToast('Exited edit mode. Viewing mode active.', 'info');
    }
  }
  
  if (!isEditingMode) {
    // Exiting edit mode
    if (hasDraggedNode && currentLayout === 'hierarchical') {
      currentLayout = 'free';
      document.querySelectorAll('.ctrl-btn[data-layout]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === 'free');
      });
      showToast('Switched to Free layout to preserve your custom positions.', 'info');
    }
    hasDraggedNode = false;
    
    // Automatically save layout to server
    saveToServer();
  }

  if (network) {
    const isHierarchical = currentLayout === 'hierarchical';
    network.setOptions({
      manipulation: { enabled: isEditingMode },
      interaction: { dragNodes: isEditingMode },
      layout: {
        hierarchical: {
          enabled: isHierarchical ? !isEditingMode : false
        }
      },
      physics: {
        enabled: currentLayout === 'free' && !isEditingMode && !hasCustomCoordinates()
      }
    });
    if (!isEditingMode) {
      network.disableEditMode();
    }
  }

  // Update nodes dataset fixed state
  if (nodesDataset) {
    const allNodes = nodesDataset.get();
    const updates = allNodes.map(n => ({
      id: n.id,
      fixed: !isEditingMode
    }));
    nodesDataset.update(updates);
  }
}

async function refreshServerLayouts() {
  try {
    const resp = await fetch('/api/layouts');
    if (!resp.ok) return;
    const { layouts } = await resp.json();
    const select = document.getElementById('select-server-layout');
    if (!select) return;
    
    // Clear existing options except the first one
    select.innerHTML = '<option value="">-- Load Layout --</option>';
    
    layouts.forEach(filename => {
      const option = document.createElement('option');
      option.value = filename;
      // Make a clean display name: e.g. campus_network.json -> Campus Network
      let displayName = filename.replace(/\.(json|yaml|yml)$/i, '').replace(/_/g, ' ');
      displayName = displayName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      option.textContent = displayName;
      select.appendChild(option);
    });
  } catch (e) {
    console.error('Failed to fetch server-side layouts:', e);
  }
}

async function loadServerLayout(filename) {
  if (!filename) {
    const deleteBtn = document.getElementById('btn-delete-layout');
    if (deleteBtn) deleteBtn.disabled = true;
    const renameBtn = document.getElementById('btn-rename-layout');
    if (renameBtn) renameBtn.disabled = true;
    return;
  }
  setLoading(true);
  try {
    const resp = await fetch(`/api/layouts/${encodeURIComponent(filename)}`);
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Failed to load layout: ' + (err.detail || resp.statusText), 'error');
      if (filename === 'topology.json') {
        renderNetwork({ devices: [], links: [] });
      }
      const deleteBtn = document.getElementById('btn-delete-layout');
      if (deleteBtn) deleteBtn.disabled = true;
      const renameBtn = document.getElementById('btn-rename-layout');
      if (renameBtn) renameBtn.disabled = true;
      return;
    }
    const data = await resp.json();
    renderNetwork(data);
    showToast(`Layout loaded successfully`, 'success');
    
    const isCustom = filename !== 'topology.json';
    const deleteBtn = document.getElementById('btn-delete-layout');
    if (deleteBtn) deleteBtn.disabled = !isCustom;
    const renameBtn = document.getElementById('btn-rename-layout');
    if (renameBtn) renameBtn.disabled = !isCustom;
  } catch (e) {
    showToast('Network error loading layout', 'error');
    if (filename === 'topology.json') {
      renderNetwork({ devices: [], links: [] });
    }
    const deleteBtn = document.getElementById('btn-delete-layout');
    if (deleteBtn) deleteBtn.disabled = true;
    const renameBtn = document.getElementById('btn-rename-layout');
    if (renameBtn) renameBtn.disabled = true;
  } finally {
    setLoading(false);
    // Keep selection in dropdown
    const select = document.getElementById('select-server-layout');
    if (select) select.value = filename;
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
    const select = document.getElementById('select-server-layout');
    if (select) select.value = '';
    const deleteBtn = document.getElementById('btn-delete-layout');
    if (deleteBtn) deleteBtn.disabled = true;
    const renameBtn = document.getElementById('btn-rename-layout');
    if (renameBtn) renameBtn.disabled = true;
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

  try {
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
  } catch (err) {
    console.error('WebSocket connection failed to initialize:', err);
    setLiveIndicator(false);
    _wsReconnectTimer = setTimeout(initWebSocket, _wsDelay);
  }
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
  
  // Update node coordinates of all devices
  if (network) {
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

async function saveToServer() {
  if (!currentTopology) return;
  
  // Update node coordinates of all devices immediately before prompt blocks
  if (network) {
    const positions = network.getPositions();
    currentTopology.devices.forEach(d => {
      if (positions[d.id]) {
        d.x = positions[d.id].x;
        d.y = positions[d.id].y;
      }
    });
  }

  const select = document.getElementById('select-server-layout');
  let defaultName = 'topology';
  if (select && select.value) {
    defaultName = select.value.replace(/\.(json|yaml|yml)$/i, '');
  }
  
  const name = prompt("Enter a name for the layout:", defaultName);
  if (name === null) return; // user cancelled
  const cleanName = name.trim();
  if (!cleanName) {
    showToast('Layout name cannot be empty', 'warning');
    return;
  }

  setLoading(true);
  try {
    const resp = await fetch(`/api/save?name=${encodeURIComponent(cleanName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentTopology),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Save failed: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    const result = await resp.json();
    showToast('Topology saved to server successfully', 'success');
    await refreshServerLayouts();
    // Select the saved layout in dropdown
    const select = document.getElementById('select-server-layout');
    if (select && result.filename) {
      select.value = result.filename;
      const deleteBtn = document.getElementById('btn-delete-layout');
      if (deleteBtn) {
        deleteBtn.disabled = result.filename === 'topology.json';
      }
      const renameBtn = document.getElementById('btn-rename-layout');
      if (renameBtn) {
        renameBtn.disabled = result.filename === 'topology.json';
      }
    }
  } catch (e) {
    showToast('Network error saving topology', 'error');
  } finally {
    setLoading(false);
  }
}

async function deleteCurrentLayout() {
  const select = document.getElementById('select-server-layout');
  if (!select) return;
  const filename = select.value;
  if (!filename || filename === 'topology.json') return;

  const cleanName = filename.replace(/\.(json|yaml|yml)$/i, '').replace(/_/g, ' ');
  const displayName = cleanName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  if (!confirm(`Are you sure you want to permanently delete the layout "${displayName}"?`)) {
    return;
  }

  setLoading(true);
  try {
    const resp = await fetch(`/api/layouts/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Delete failed: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    showToast(`Layout "${displayName}" deleted successfully`, 'success');
    await refreshServerLayouts();
    // Revert to default layout
    await loadServerLayout('topology.json');
  } catch (e) {
    showToast('Network error deleting layout', 'error');
  } finally {
    setLoading(false);
  }
}

async function renameCurrentLayout() {
  const select = document.getElementById('select-server-layout');
  if (!select) return;
  const filename = select.value;
  if (!filename || filename === 'topology.json') return;

  const currentDisplayName = filename.replace(/\.(json|yaml|yml)$/i, '').replace(/_/g, ' ');
  const displayName = currentDisplayName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const newName = prompt(`Enter a new name for the layout "${displayName}":`, displayName);
  if (newName === null) return; // cancelled
  const cleanNewName = newName.trim();
  if (!cleanNewName) {
    showToast('Layout name cannot be empty', 'warning');
    return;
  }

  setLoading(true);
  try {
    const resp = await fetch(`/api/layouts/${encodeURIComponent(filename)}?new_name=${encodeURIComponent(cleanNewName)}`, {
      method: 'PATCH'
    });
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Rename failed: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    const result = await resp.json();
    showToast(`Layout renamed successfully`, 'success');
    await refreshServerLayouts();
    
    // Load the renamed layout
    if (result.filename) {
      await loadServerLayout(result.filename);
    }
  } catch (e) {
    showToast('Network error renaming layout', 'error');
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Discovery Feature
// ---------------------------------------------------------------------------
function openDiscoverModal() {
  document.getElementById('discover-ip').value = '';
  document.getElementById('discover-user').value = '';
  document.getElementById('discover-pass').value = '';
  document.getElementById('discover-modal').classList.remove('hidden');
}

function closeDiscoverModal() {
  document.getElementById('discover-modal').classList.add('hidden');
}

async function runDiscovery() {
  const ip = document.getElementById('discover-ip').value.trim();
  const username = document.getElementById('discover-user').value.trim();
  const password = document.getElementById('discover-pass').value;
  const platform = document.getElementById('discover-platform').value;
  const depth = parseInt(document.getElementById('discover-depth').value, 10);
  const mock_mode = document.getElementById('discover-mock').checked;

  if (!ip || !username) {
    showToast('IP Address and Username are required', 'warning');
    return;
  }

  closeDiscoverModal();
  setLoading(true);
  
  try {
    const resp = await fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seed_ip: ip,
        username: username,
        password: password,
        platform: platform,
        max_depth: depth,
        mock_mode: mock_mode
      })
    });
    
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Discovery error: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    
    // The new topology will be pushed automatically via WebSocket!
    showToast('Discovery started successfully...', 'success');
  } catch (e) {
    showToast('Network error during discovery', 'error');
  } finally {
    setLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.addEventListener('load', () => {
  refreshServerLayouts().then(() => {
    loadServerLayout('topology.json');
  });
  initWebSocket();

  // Prevent canvas panning when clicking and dragging starting on a node in viewing mode
  const container = document.getElementById('network-container');
  if (container) {
    container.addEventListener('mousedown', event => {
      if (!network || isEditingMode) return;
      const rect = container.getBoundingClientRect();
      const domPosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      const nodeId = network.getNodeAt(domPosition);
      if (nodeId !== undefined) {
        network.setOptions({ interaction: { dragView: false } });
      }
    });
  }

  window.addEventListener('mouseup', () => {
    if (network && !isEditingMode) {
      network.setOptions({ interaction: { dragView: true } });
    }
  });
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

// Click handler for vis.js manipulation is handled by persistent toggle Edit Layout button.

// ---------------------------------------------------------------------------
// Terminal Console & Path Highlighting Feature
// ---------------------------------------------------------------------------
let terminalDeviceId = null;
let terminalSocket = null;
let terminalMode = 'mock';
let terminalHistory = [];
let terminalHistoryIndex = -1;
let pathHighlightTimeout = null;
let activeTraceSource = null;
let activeTracePath = [];

function adjustViewportForTerminal(animate = true) {
  if (!network) return;

  const drawer = document.getElementById('terminal-drawer');
  if (!drawer) return;

  let D = 0;
  if (!drawer.classList.contains('closed')) {
    if (drawer.classList.contains('minimized')) {
      D = 38; // visible height when minimized
    } else {
      D = 250; // visible height when open
    }
  }

  const container = document.getElementById('network-container');
  if (!container) return;
  const H = container.clientHeight;
  if (!H || H <= D) return;

  // Save current view
  const originalScale = network.getScale();
  const originalCenter = network.getViewPosition();

  // Temporarily fit the network synchronously to calculate baseline fit scale & center
  network.fit({ animation: false });
  const baselineScale = network.getScale();
  const baselineCenter = network.getViewPosition();

  // Restore the original view immediately (synchronously so it doesn't render)
  network.moveTo({
    position: originalCenter,
    scale: originalScale,
    animation: false
  });

  // Calculate target scale and shift to fit within visible height (H - D)
  const heightFactor = (H - D) / H;
  const targetScale = baselineScale * heightFactor;
  if (targetScale <= 0) return;

  const targetCenter = {
    x: baselineCenter.x,
    y: baselineCenter.y + (D / 2) / targetScale
  };

  // Perform smooth transition to the target state
  network.moveTo({
    position: targetCenter,
    scale: targetScale,
    animation: animate ? { duration: 300, easingFunction: 'easeInOutQuad' } : false
  });
}

function openTerminalForDevice(deviceId) {
  if (!currentTopology) return;
  const device = currentTopology.devices.find(d => d.id === deviceId);
  if (!device) return;

  terminalDeviceId = deviceId;
  const selectEl = document.getElementById('terminal-mode-select');
  terminalMode = selectEl.value;

  document.getElementById('terminal-title').textContent = `Console: ${device.label}`;
  
  // Show drawer
  const drawer = document.getElementById('terminal-drawer');
  drawer.classList.remove('closed');
  drawer.classList.remove('minimized');
  document.getElementById('terminal-min-btn').textContent = '━';

  // Load history from localStorage
  try {
    const hist = localStorage.getItem('netvis_terminal_history_' + deviceId);
    terminalHistory = hist ? JSON.parse(hist) : [];
  } catch (e) {
    terminalHistory = [];
  }
  terminalHistoryIndex = terminalHistory.length;

  // Toggle SSH Credentials form if we were left in SSH mode
  const credsForm = document.getElementById('terminal-ssh-creds');
  if (terminalMode === 'ssh') {
    credsForm.classList.remove('hidden');
  } else {
    credsForm.classList.add('hidden');
  }

  clearTerminalOutput();
  
  if (terminalMode === 'mock') {
    connectTerminalSocket();
  } else {
    updateTerminalStatus('disconnected', 'offline');
    appendTerminalText("Choose mode or enter credentials to start session.\r\n");
  }

  // Focus terminal input
  setTimeout(() => {
    document.getElementById('terminal-input').focus();
  }, 100);

  // Keep all devices within visible view above terminal drawer
  adjustViewportForTerminal(true);
}

function closeTerminal(adjustViewport = true) {
  const drawer = document.getElementById('terminal-drawer');
  if (!drawer) return;
  drawer.classList.add('closed');
  drawer.classList.remove('minimized');
  
  if (terminalSocket) {
    terminalSocket.close();
    terminalSocket = null;
  }
  terminalDeviceId = null;
  
  activeTraceSource = null;
  activeTracePath = [];

  // Clear path highlight immediately if console is closed
  if (pathHighlightTimeout) {
    clearTimeout(pathHighlightTimeout);
    pathHighlightTimeout = null;
  }
  resetGraphHighlight();

  // Reset viewport to center nodes in full screen
  if (adjustViewport) {
    adjustViewportForTerminal(true);
  }
}

function toggleTerminalMinimize() {
  const drawer = document.getElementById('terminal-drawer');
  const minBtn = document.getElementById('terminal-min-btn');
  
  if (drawer.classList.contains('minimized')) {
    drawer.classList.remove('minimized');
    minBtn.textContent = '━';
    document.getElementById('terminal-input').focus();
    setTimeout(sendTerminalResize, 320); // Wait for transition animation
  } else {
    drawer.classList.add('minimized');
    minBtn.textContent = '┠';
  }

  // Adjust viewport based on minimized/expanded terminal state
  adjustViewportForTerminal(true);
}

function handleTerminalModeChange(mode) {
  terminalMode = mode;
  if (terminalSocket) {
    terminalSocket.close();
    terminalSocket = null;
  }
  
  clearTerminalOutput();
  
  const credsForm = document.getElementById('terminal-ssh-creds');
  if (mode === 'ssh') {
    credsForm.classList.remove('hidden');
    updateTerminalStatus('disconnected', 'offline');
    appendTerminalText("SSH Session requested. Please enter credentials above and click Connect.\r\n");
  } else {
    credsForm.classList.add('hidden');
    connectTerminalSocket();
  }
  document.getElementById('terminal-input').focus();
}

function updateTerminalStatus(dotClass, text) {
  const dot = document.getElementById('terminal-dot');
  const status = document.getElementById('terminal-status');
  
  dot.className = `terminal-dot ${dotClass}`;
  status.className = `terminal-status ${dotClass}`;
  status.textContent = text;

  // Dynamically update placeholder and prompt text based on connection state
  if (dotClass === 'disconnected') {
    const promptEl = document.getElementById('terminal-prompt');
    if (promptEl) promptEl.textContent = '>';
    const inputEl = document.getElementById('terminal-input');
    if (inputEl) inputEl.placeholder = 'Type a command...';
  } else {
    const inputEl = document.getElementById('terminal-input');
    if (inputEl) inputEl.placeholder = '';
  }
}

function connectTerminalSocket(username = null, password = null) {
  if (terminalSocket) {
    terminalSocket.close();
  }
  
  if (!terminalDeviceId || !currentTopology) return;
  const device = currentTopology.devices.find(d => d.id === terminalDeviceId);
  if (!device) return;

  updateTerminalStatus('connecting', 'connecting');

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = `${proto}//${location.host}/ws/terminal/${terminalDeviceId}?mode=${terminalMode}`;
  
  url += `&ip=${encodeURIComponent(device.ip || '')}`;
  url += `&platform=${encodeURIComponent(device.platform || 'cisco_ios')}`;
  
  if (terminalMode === 'ssh' && username && password) {
    url += `&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  }

  terminalSocket = new WebSocket(url);

  terminalSocket.onopen = () => {
    updateTerminalStatus('connected', 'connected');
    document.getElementById('terminal-input').focus();
    sendTerminalResize();
  };

  terminalSocket.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      if (data && data.type) {
        if (data.type === 'output') {
          appendTerminalText(data.text);
        } else if (data.type === 'path_highlight') {
          highlightPath(data.source, data.target, data.highlight_type || 'trace');
        } else if (data.type === 'clear') {
          clearTerminalOutput();
        }
        return;
      }
    } catch (e) {
      // Not JSON, handle as raw text
    }
    appendTerminalText(event.data);
  };

  terminalSocket.onclose = () => {
    updateTerminalStatus('disconnected', 'disconnected');
    appendTerminalText("\r\n*** Session closed ***\r\n");
  };

  terminalSocket.onerror = () => {
    updateTerminalStatus('disconnected', 'error');
    appendTerminalText("\r\n*** Connection error ***\r\n");
  };
}

function connectRealSsh() {
  const user = document.getElementById('ssh-username').value.trim();
  const pass = document.getElementById('ssh-password').value;
  
  if (!user || !pass) {
    showToast('Username and password required for SSH', 'warning');
    return;
  }
  
  const credsForm = document.getElementById('terminal-ssh-creds');
  credsForm.classList.add('hidden');
  
  connectTerminalSocket(user, pass);
}

function clearTerminalOutput() {
  const out = document.getElementById('terminal-output');
  if (out) out.innerHTML = '';
}

function appendTerminalText(text) {
  const out = document.getElementById('terminal-output');
  if (!out) return;

  // Parse traceroute hops in real-time if active
  if (activeTraceSource && currentTopology) {
    const lines = text.split(/\r?\n/);
    lines.forEach(line => {
      const hopMatch = line.match(/^\s*(\d+)\s+.*?\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (hopMatch) {
        const hopIp = hopMatch[2];
        const device = currentTopology.devices.find(d => d.ip === hopIp);
        if (device && !activeTracePath.includes(device.id)) {
          // Bridge the gap using BFS pathfinding if there is a gap
          if (activeTracePath.length > 0) {
            const lastHopId = activeTracePath[activeTracePath.length - 1];
            const gapPath = findShortestPath(lastHopId, device.id);
            if (gapPath && gapPath.length > 1) {
              // Add all intermediate nodes along the path
              for (let i = 1; i < gapPath.length; i++) {
                if (!activeTracePath.includes(gapPath[i])) {
                  activeTracePath.push(gapPath[i]);
                }
              }
            } else {
              activeTracePath.push(device.id);
            }
          } else {
            activeTracePath.push(device.id);
          }
          highlightExplicitPath(activeTracePath, 'trace');
        }
      }
    });
  }

  // Extract prompt dynamic updates (e.g. hostname> or hostname# or config mode or Username/Password)
  const promptRegex = /([A-Za-z0-9._-]+(?:\([^)]+\))?[>#])\s*$/;
  const loginRegex = /(Username:|Password:)\s*$/i;
  
  let match = text.match(promptRegex) || text.match(loginRegex);
  if (match) {
    const promptStr = match[1];
    const promptEl = document.getElementById('terminal-prompt');
    if (promptEl) {
      promptEl.textContent = promptStr;
    }
    const matchIndex = text.lastIndexOf(match[0]);
    if (matchIndex !== -1) {
      text = text.substring(0, matchIndex);
    }
  }

  // Format line endings for standard browser displaying
  let formatted = text
    .replace(/\r\n/g, '\n')
    .replace(/\n\r/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '<br>');

  const div = document.createElement('span');
  div.innerHTML = formatted;
  out.appendChild(div);
  
  // Auto scroll to bottom
  out.scrollTop = out.scrollHeight;
}

// Wire up terminal input key actions
document.getElementById('terminal-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') {
    const val = this.value;
    
    const trimmedVal = val.trim().toLowerCase();
    if (trimmedVal.startsWith('traceroute') || trimmedVal.startsWith('trace')) {
      activeTraceSource = terminalDeviceId;
      activeTracePath = [terminalDeviceId];
      resetGraphHighlight();
    } else if (trimmedVal.length > 0) {
      activeTraceSource = null;
      activeTracePath = [];
    }

    // Add to history if not empty and not identical to last entry
    if (val.trim() && (terminalHistory.length === 0 || terminalHistory[terminalHistory.length - 1] !== val)) {
      terminalHistory.push(val);
      if (terminalDeviceId) {
        localStorage.setItem('netvis_terminal_history_' + terminalDeviceId, JSON.stringify(terminalHistory));
      }
    }
    terminalHistoryIndex = terminalHistory.length;
    
    // Send via socket
    if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
      if (terminalMode === 'mock') {
        const promptEl = document.getElementById('terminal-prompt');
        const activePrompt = promptEl ? promptEl.textContent : '>';
        appendTerminalText(`${activePrompt} ${val}\r\n`);
      }
      terminalSocket.send(val);
    } else {
      appendTerminalText(`\r\n${val}\r\n[Not connected]\r\n`);
    }
    
    this.value = '';
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (terminalHistory.length > 0 && terminalHistoryIndex > 0) {
      terminalHistoryIndex--;
      this.value = terminalHistory[terminalHistoryIndex];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (terminalHistoryIndex < terminalHistory.length - 1) {
      terminalHistoryIndex++;
      this.value = terminalHistory[terminalHistoryIndex];
    } else {
      terminalHistoryIndex = terminalHistory.length;
      this.value = '';
    }
  }
});

function sendTerminalResize() {
  if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) return;
  const out = document.getElementById('terminal-output');
  if (!out) return;
  
  const width = out.clientWidth;
  const height = out.clientHeight;
  
  // Approximate character dimensions: ~8.2px width and ~17px height per character
  const cols = Math.floor(width / 8.2);
  const rows = Math.floor(height / 17);
  
  terminalSocket.send(JSON.stringify({
    type: 'resize',
    cols: Math.max(40, cols),
    rows: Math.max(5, rows)
  }));
}

window.addEventListener('resize', sendTerminalResize);

// Auto focus input on clicking anywhere inside terminal body
document.getElementById('terminal-body').addEventListener('click', () => {
  document.getElementById('terminal-input').focus();
});

// ---------------------------------------------------------------------------
// Shortest Path Finder & Visual Highlighting
// ---------------------------------------------------------------------------

function findShortestPath(startId, endId) {
  if (!currentTopology) return null;
  const adj = {};
  currentTopology.devices.forEach(d => adj[d.id] = []);
  currentTopology.links.forEach(l => {
    if (adj[l.source] && adj[l.target]) {
      adj[l.source].push({ target: l.target });
      adj[l.target].push({ target: l.source });
    }
  });

  const queue = [[startId]];
  const visited = new Set([startId]);

  while (queue.length > 0) {
    const path = queue.shift();
    const node = path[path.length - 1];

    if (node === endId) {
      return path;
    }

    const neighbors = adj[node] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.target)) {
        visited.add(neighbor.target);
        queue.push([...path, neighbor.target]);
      }
    }
  }
  return null;
}

function getEdgeIdBetween(nodeA, nodeB) {
  if (!currentTopology) return -1;
  return currentTopology.links.findIndex(l => 
    (l.source === nodeA && l.target === nodeB) || 
    (l.source === nodeB && l.target === nodeA)
  );
}

function resetGraphHighlight() {
  if (!nodesDataset || !edgesDataset || !currentTopology) return;
  const { nodes, edges } = buildGraph(currentTopology);
  const visibleNodeIds = new Set(nodesDataset.getIds());
  nodesDataset.update(nodes.filter(n => visibleNodeIds.has(n.id)));
  
  const visibleEdgeIds = new Set(edgesDataset.getIds());
  edgesDataset.update(edges.filter(e => visibleEdgeIds.has(e.id)));
  
  network.unselectAll();
}

function highlightExplicitPath(path, highlightType = 'trace') {
  if (!network || !nodesDataset || !edgesDataset || !path || path.length < 2) return;

  const isPing = highlightType === 'ping';
  const highlightColor = isPing ? '#00d2ff' : '#ff9c3a'; // Cyan for ping, Orange for trace

  // Dim all other nodes and edges
  const DIM_NODE = { background: '#161b22', border: '#21262d' };
  const DIM_FONT = { color: '#3d444d' };

  const nodeUpdates = nodesDataset.get().map(node => {
    if (path.includes(node.id)) {
      const colors = NODE_COLORS[node._data.type] || NODE_COLORS.switch;
      return {
        id: node.id,
        color: { 
          background: colors.background, 
          border: highlightColor, 
          highlight: { background: colors.background, border: highlightColor } 
        },
        borderWidth: 3,
        shadow: { enabled: true, color: highlightColor, size: 15, x: 0, y: 0 }
      };
    }
    return {
      id: node.id,
      color: { background: DIM_NODE.background, border: DIM_NODE.border },
      font: { ...DIM_FONT },
      borderWidth: 1,
      shadow: false
    };
  });

  const pathEdgeIds = [];
  for (let i = 0; i < path.length - 1; i++) {
    const idx = getEdgeIdBetween(path[i], path[i+1]);
    if (idx !== -1) {
      pathEdgeIds.push(idx);
    }
  }

  const edgeUpdates = edgesDataset.get().map(edge => {
    if (pathEdgeIds.includes(edge.id)) {
      return {
        id: edge.id,
        color: { color: highlightColor, highlight: highlightColor },
        width: 5,
        shadow: { enabled: true, color: highlightColor, size: 10 },
        smooth: { type: 'curvedCW', roundness: 0.1 },
        dashing: true
      };
    }
    return {
      id: edge.id,
      color: { color: '#161b22', highlight: '#161b22' },
      width: 1,
      shadow: false
    };
  });

  nodesDataset.update(nodeUpdates);
  edgesDataset.update(edgeUpdates);

  // Pan and zoom to cover the path nodes
  network.fit({
    nodes: path,
    animation: { duration: 600, easingFunction: 'easeInOutQuad' }
  });
}

function highlightPath(sourceId, targetId, highlightType = 'trace') {
  if (!network || !nodesDataset || !edgesDataset) return;
  
  if (pathHighlightTimeout) {
    clearTimeout(pathHighlightTimeout);
    pathHighlightTimeout = null;
  }
  
  // Reset graph to default state first to clear any previous traces/highlights
  resetGraphHighlight();

  let path = null;
  if (highlightType === 'trace' && activeTracePath && activeTracePath.length > 1) {
    path = activeTracePath;
  } else {
    path = findShortestPath(sourceId, targetId);
  }

  if (!path || path.length < 2) {
    showToast('No active connection path found between devices', 'warning');
    return;
  }

  highlightExplicitPath(path, highlightType);
  
  const isPing = highlightType === 'ping';
  showToast(isPing ? 'Ping path highlighted in cyan' : 'Traceroute path highlighted in orange', 'info');
}

