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
let currentNodeSize = 24;
let selectedDeviceId = null;
let deviceHealthStatuses = {};
let currentOverlay = 'physical';
let backupsList = [];
let isTimelineMode = false;
let isCompareMode = true;
let selectedBackupIndex = -1;
let auditFlashInterval = null;

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
      ...(currentLayout === 'hierarchical' && !isEditingMode && { level: LAYER_LEVEL[d.layer] || 3 }),
      color: {
        background: colors.background,
        border: colors.border,
        highlight: { background: colors.background, border: '#fff' },
      },
      font: { color: colors.font, size: 11, face: 'Courier New' },
      shape: 'image',
      image: icon,
      size: currentNodeSize,
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
      x: currentLayout === 'free' ? d.x : undefined,
      y: currentLayout === 'free' ? d.y : undefined,
      fixed: !isEditingMode,
    };
  });

  const edges = data.links.map((l, i) => {
    let label = l.protocol || '';
    let edgeColor = '#30363d';
    let edgeHighlight = '#58a6ff';
    let isMismatch = false;

    if (l.vlan_mismatch) {
      edgeColor = '#ff9f43';
      edgeHighlight = '#ffa851';
      isMismatch = true;
    } else if (l.subnet_mismatch) {
      edgeColor = '#f85149';
      edgeHighlight = '#ff7875';
      isMismatch = true;
    } else if (l.mtu_mismatch || l.speed_mismatch) {
      edgeColor = '#ffc107';
      edgeHighlight = '#ffe066';
      isMismatch = true;
    }

    if (l.warnings && l.warnings.length > 0) {
      const warningTypes = [];
      if (l.vlan_mismatch) warningTypes.push('VLAN');
      if (l.subnet_mismatch) warningTypes.push('Subnet');
      if (l.mtu_mismatch) warningTypes.push('MTU');
      if (l.speed_mismatch) warningTypes.push('Speed');
      label = `⚠️ [${warningTypes.join('/')}] ` + label;
    }

    return {
      id: i,
      from: l.source,
      to: l.target,
      label: label,
      font: { size: 9, color: isMismatch ? edgeColor : '#58a6ff', align: 'middle', strokeWidth: 0 },
      color: { color: edgeColor, highlight: edgeHighlight },
      width: isMismatch ? 3.0 : calcEdgeWidth(l.bandwidth),
      smooth: currentLayout === 'free' ? false : { type: 'curvedCW', roundness: 0.1 },
      dashing: isMismatch ? [5, 5] : false,
      shadow: false,
      title: buildEdgeTooltip(l),
      _data: l,
    };
  });

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
  return `${d.label}` +
    `\nType: ${d.type}` +
    `\nLayer: ${d.layer}` +
    (d.ip ? `\nIP: ${d.ip}` : '') +
    (d.platform ? `\nPlatform: ${d.platform}` : '');
}

function buildEdgeTooltip(l) {
  let t = `Protocol: ${l.protocol || 'N/A'}\nBW: ${l.bandwidth || 'N/A'}`;
  if (l.src_iface) t += `\nSrc: ${l.src_iface}`;
  if (l.dst_iface) t += `\nDst: ${l.dst_iface}`;
  if (l.warnings && l.warnings.length > 0) {
    t += `\n\n⚠️ Diagnostics Mismatch:`;
    l.warnings.forEach(w => {
      t += `\n• ${w}`;
    });
  }
  return t;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderNetwork(data, isInitialLoad = false) {
  closeTerminal(false);
  
  if (auditFlashInterval) {
    clearInterval(auditFlashInterval);
    auditFlashInterval = null;
  }

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

  if (isInitialLoad) {
    // Automatically switch layout mode to 'free' if saved positions are present in the layout file
    const hasSavedPositions = data.devices && data.devices.some(d => typeof d.x === 'number' && typeof d.y === 'number');
    if (hasSavedPositions) {
      currentLayout = 'free';
    } else {
      // If layout is free and there are no saved positions, we can keep it as is,
      // otherwise fallback to hierarchical for default layouts.
      if (currentLayout !== 'free') {
        currentLayout = 'hierarchical';
      }
    }
  }

  // Update layout control active states
  updateLayoutToggleUI(currentLayout);

  const zoomSlider = document.getElementById('zoom-slider');
  if (zoomSlider) {
    zoomSlider.value = 1.0;
    updateSliderTrackFill('zoom-slider', 1.0);
  }
  const zoomVal = document.getElementById('zoom-val');
  if (zoomVal) { zoomVal.textContent = '100%'; }

  const sizeSlider = document.getElementById('nodesize-slider');
  if (sizeSlider) {
    sizeSlider.value = currentNodeSize;
    updateSliderTrackFill('nodesize-slider', currentNodeSize);
  }
  const sizeVal = document.getElementById('nodesize-val');
  if (sizeVal) { sizeVal.textContent = currentNodeSize + 'px'; }

  const { nodes, edges } = buildGraph(data);

  nodesDataset = new vis.DataSet(nodes);
  edgesDataset = new vis.DataSet(edges);

  const container = document.getElementById('network-container');
  if (network) network.destroy();
  network = new vis.Network(container, { nodes: nodesDataset, edges: edgesDataset }, getOptions());
  window.network = network;
  window.nodesDataset = nodesDataset;
  window.currentTopology = currentTopology;
  window.showDeviceDetail = showDeviceDetail;

  network.on('click', params => {
    hideContextMenu();
    if (params.nodes.length > 1) {
      selectedDeviceId = null;
      showBulkActionPanel(params.nodes);
    } else if (params.nodes.length === 1) {
      selectedDeviceId = params.nodes[0];
      const node = nodesDataset.get(selectedDeviceId);
      showDeviceDetail(node._data, data.links);
    } else if (params.edges.length > 0) {
      selectedDeviceId = null;
      const edge = edgesDataset.get(params.edges[0]);
      showEdgeDetail(edge._data);
    } else {
      selectedDeviceId = null;
      resetDetailPanel();
    }
  });

  network.on('zoom', () => {
    const scale = network.getScale();
    const slider = document.getElementById('zoom-slider');
    if (slider) {
      slider.value = scale;
      updateSliderTrackFill('zoom-slider', scale);
    }
    const zoomVal = document.getElementById('zoom-val');
    if (zoomVal) {
      zoomVal.textContent = Math.round(scale * 100) + '%';
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
  
  // Start flashing alert logic for audited links containing mismatches
  startAuditFlashing();
}

function startAuditFlashing() {
  if (auditFlashInterval) clearInterval(auditFlashInterval);
  let flashState = false;
  
  auditFlashInterval = setInterval(() => {
    if (!edgesDataset || !currentTopology) return;
    const updates = [];
    currentTopology.links.forEach((l, index) => {
      if (l.vlan_mismatch || l.subnet_mismatch || l.mtu_mismatch || l.speed_mismatch) {
        updates.push({
          id: index,
          dashing: flashState ? [5, 5] : false,
          width: flashState ? 4.0 : 2.5
        });
      }
    });
    if (updates.length > 0) {
      edgesDataset.update(updates);
    }
    flashState = !flashState;
  }, 1000);
}

function getOptions() {
  const base = {
    physics: {
      enabled: currentLayout === 'free' && !isEditingMode && !hasCustomCoordinates(),
      stabilization: { iterations: 150 },
    },
    layout: {
      randomSeed: 42,
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
      randomSeed: 42,
      hierarchical: {
        enabled: !isEditingMode,
        direction: 'UD',
        sortMethod: 'hubsize',
        levelSeparation: 120,
        nodeSpacing: 180,
        treeSpacing: 200,
        blockShifting: true,
        edgeMinimization: true,
        parentCentralization: true,
      },
    };
    base.physics = { enabled: false };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Layout toggle and Sliders
// ---------------------------------------------------------------------------
function updateSliderTrackFill(sliderId, val) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const percentage = (val - min) / (max - min) * 100;
  slider.style.background = `linear-gradient(to right, #58a6ff 0%, #58a6ff ${percentage}%, #21262d ${percentage}%, #21262d 100%)`;
}

function updateLayoutToggleUI(layout) {
  const container = document.getElementById('layout-segmented-control');
  if (container) {
    container.classList.toggle('hierarchical-active', layout === 'hierarchical');
  }
  const btnFree = document.getElementById('btn-layout-free');
  const btnHier = document.getElementById('btn-layout-hierarchical');
  if (btnFree && btnHier) {
    btnFree.classList.toggle('active', layout === 'free');
    btnHier.classList.toggle('active', layout === 'hierarchical');
  }
}

function onZoomSliderChanged(val) {
  if (!network) return;
  network.moveTo({
    scale: parseFloat(val),
    animation: false
  });
  const zoomVal = document.getElementById('zoom-val');
  if (zoomVal) {
    zoomVal.textContent = Math.round(val * 100) + '%';
  }
  updateSliderTrackFill('zoom-slider', val);
}

function onNodeSizeSliderChanged(val) {
  currentNodeSize = parseInt(val);
  const sizeVal = document.getElementById('nodesize-val');
  if (sizeVal) {
    sizeVal.textContent = val + 'px';
  }
  if (!nodesDataset) return;
  const ids = nodesDataset.getIds();
  const updates = ids.map(id => ({ id: id, size: currentNodeSize }));
  nodesDataset.update(updates);
  updateSliderTrackFill('nodesize-slider', val);
}

function setLayout(layout) {
  // Capture current positions if switching from hierarchical to free AND the topology doesn't have custom coordinates yet.
  // This prevents layout reshuffling on first switch, while preserving custom dragged/loaded positions on subsequent switches.
  if (currentLayout === 'hierarchical' && layout === 'free' && network && currentTopology) {
    if (!hasCustomCoordinates()) {
      const positions = network.getPositions();
      currentTopology.devices.forEach(d => {
        if (positions[d.id]) {
          d.x = positions[d.id].x;
          d.y = positions[d.id].y;
        }
      });
    }
  }

  currentLayout = layout;
  updateLayoutToggleUI(layout);
  if (currentTopology) {
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

function showBulkActionPanel(deviceIds) {
  if (!currentTopology) return;
  const devices = deviceIds.map(id => currentTopology.devices.find(d => d.id === id)).filter(Boolean);
  
  document.getElementById('detail-title').textContent = `Bulk Actions (${devices.length})`;
  
  const selectEl = document.getElementById('terminal-mode-select');
  const termMode = selectEl ? selectEl.value : 'mock';

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-card">
      <div class="card-title">Selected Devices</div>
      <div style="max-height: 120px; overflow-y: auto; margin-bottom: 12px; border: 1px solid #30363d; border-radius: 6px; padding: 6px; background: #161b22;">
        ${devices.map(d => `
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.8rem; padding: 4px 6px; border-bottom: 1px solid #21262d;">
            <span style="font-weight:600; color: #c9d1d9;">${d.label}</span>
            <span class="uppercase-badge">${d.type}</span>
          </div>
        `).join('')}
      </div>
      
      <div class="form-group" style="margin-top: 12px;">
        <label for="bulk-cmd-input">Run Command</label>
        <input type="text" id="bulk-cmd-input" placeholder="e.g. show version, show ip interface brief" style="width: 100%; box-sizing: border-box; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 8px 10px; font-family: monospace; outline: none; margin-bottom: 12px;">
      </div>

      <div id="bulk-creds-fields" style="display: ${termMode === 'ssh' ? 'block' : 'none'}; margin-top: 12px; border-top: 1px solid #21262d; padding-top: 12px;">
        <div class="form-group">
          <label for="bulk-user">SSH Username</label>
          <input type="text" id="bulk-user" value="cisco" style="width: 100%; box-sizing: border-box; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 6px 8px; margin-bottom: 8px;">
        </div>
        <div class="form-group">
          <label for="bulk-pass">SSH Password</label>
          <input type="password" id="bulk-pass" placeholder="Password" style="width: 100%; box-sizing: border-box; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 6px 8px;">
        </div>
      </div>

      <button id="run-bulk-btn" class="ctrl-btn active" style="width: 100%; margin-top: 16px;">
        Run Bulk Command
      </button>
    </div>
  `;

  setDetailVisible(true);

  const cmdInput = document.getElementById('bulk-cmd-input');
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeBulkCommand(deviceIds, cmdInput.value);
    }
  });

  const runBtn = document.getElementById('run-bulk-btn');
  runBtn.addEventListener('click', () => {
    executeBulkCommand(deviceIds, cmdInput.value);
  });
}

async function executeBulkCommand(deviceIds, command) {
  if (!command || !command.trim()) {
    showToast('Please enter a CLI command to run.', 'warning');
    return;
  }

  const selectEl = document.getElementById('terminal-mode-select');
  const termMode = selectEl ? selectEl.value : 'mock';

  const runBtn = document.getElementById('run-bulk-btn');
  const originalText = runBtn.textContent;
  runBtn.disabled = true;
  runBtn.textContent = 'Executing...';

  let username = null;
  let password = null;
  if (termMode === 'ssh') {
    username = document.getElementById('bulk-user')?.value || 'admin';
    password = document.getElementById('bulk-pass')?.value || '';
  }

  try {
    const response = await fetch('/api/runbook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        device_ids: deviceIds,
        command: command.trim(),
        username: username,
        password: password,
        mock_mode: termMode === 'mock'
      })
    });

    if (!response.ok) {
      const err = await response.json();
      showToast('Runbook error: ' + (err.detail || response.statusText), 'error');
      return;
    }

    const result = await response.json();
    displayRunbookOutputs(command.trim(), result.outputs);
    showToast(`Executed command on ${deviceIds.length} devices`, 'success');
  } catch (error) {
    console.error('Failed to run bulk CLI command:', error);
    showToast('Network error during runbook execution', 'error');
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = originalText;
  }
}

function displayRunbookOutputs(command, outputs) {
  const drawer = document.getElementById('terminal-drawer');
  drawer.classList.remove('closed');
  drawer.classList.remove('minimized');
  const minBtn = document.getElementById('terminal-min-btn');
  if (minBtn) minBtn.textContent = '━';

  const deviceIds = Object.keys(outputs);
  let firstDeviceId = null;

  deviceIds.forEach(deviceId => {
    const device = currentTopology.devices.find(d => d.id === deviceId);
    if (!device) return;
    if (!firstDeviceId) firstDeviceId = deviceId;

    if (!terminalSessions[deviceId]) {
      const session = new TerminalSession(deviceId, device.label);
      terminalSessions[deviceId] = session;

      const tabsContainer = document.getElementById('terminal-tabs');
      const tabEl = document.createElement('div');
      tabEl.className = 'terminal-tab';
      tabEl.dataset.deviceId = deviceId;
      tabEl.innerHTML = `
        <span class="terminal-tab-dot offline"></span>
        <span class="terminal-tab-name">${device.label}</span>
        <span class="terminal-tab-close">&times;</span>
      `;

      tabEl.addEventListener('click', () => {
        switchSession(deviceId);
      });

      const closeBtn = tabEl.querySelector('.terminal-tab-close');
      closeBtn.addEventListener('click', (e) => {
        closeTab(deviceId, e);
      });

      tabsContainer.appendChild(tabEl);
      session.updateStatus('offline', 'runbook output');
    }

    const session = terminalSessions[deviceId];
    session.appendText(`\r\n\x1b[36m=== Bulk Runbook Command: '${command}' ===\x1b[0m\r\n`);
    session.appendText(outputs[deviceId] + "\r\n");
  });

  if (firstDeviceId) {
    switchSession(firstDeviceId);
  }
  adjustViewportForTerminal(true);
}

async function runPathTrace(sourceId, destIp) {
  if (!destIp) {
    showToast('Please enter a destination IP or hostname.', 'warning');
    return;
  }

  const selectEl = document.getElementById('terminal-mode-select');
  const termMode = selectEl ? selectEl.value : 'mock';

  const traceBtn = document.getElementById('trace-path-btn');
  const originalText = traceBtn.textContent;
  traceBtn.disabled = true;
  traceBtn.textContent = 'Tracing...';

  try {
    const response = await fetch('/api/path-trace', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_device_id: sourceId,
        destination_ip: destIp,
        username: null,
        password: null,
        mock_mode: termMode === 'mock'
      })
    });

    if (!response.ok) {
      const err = await response.json();
      showToast('Path trace error: ' + (err.detail || response.statusText), 'error');
      return;
    }

    const result = await response.json();
    const hops = result.hops;
    
    if (!hops || hops.length < 2) {
      showToast('No path found or target unreachable', 'warning');
      return;
    }

    highlightPathWithInterfaces(hops);
    renderTraceResultInDetailPanel(sourceId, destIp, hops);
    showToast(`Path trace completed: ${hops.length} hops`, 'success');
  } catch (error) {
    console.error('Failed to run path trace:', error);
    showToast('Network error during path tracing', 'error');
  } finally {
    traceBtn.disabled = false;
    traceBtn.textContent = originalText;
  }
}

function highlightPathWithInterfaces(hops) {
  if (!network || !nodesDataset || !edgesDataset || !hops || hops.length < 2) return;

  const path = hops.map(h => h.device_id);
  const highlightColor = '#ff9c3a'; // Orange for L3 routing trace
  
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

  const pathEdgeUpdates = {};
  for (let i = 0; i < hops.length - 1; i++) {
    const nodeA = hops[i].device_id;
    const nodeB = hops[i+1].device_id;
    const idx = getEdgeIdBetween(nodeA, nodeB);
    if (idx !== -1) {
      const edge = edgesDataset.get(idx);
      const egress = hops[i].egress_interface || 'Gi0/1';
      const ingress = hops[i+1].ingress_interface || 'Gi0/1';
      pathEdgeUpdates[edge.id] = {
        label: `${egress} ↔ ${ingress}`,
        font: { color: '#ff9c3a', size: 11, background: '#0d1117', strokeWidth: 0 }
      };
    }
  }

  const edgeUpdates = edgesDataset.get().map(edge => {
    if (pathEdgeUpdates[edge.id]) {
      return {
        id: edge.id,
        color: { color: highlightColor, highlight: highlightColor },
        width: 5,
        shadow: { enabled: true, color: highlightColor, size: 10 },
        smooth: currentLayout === 'free' ? false : { type: 'curvedCW', roundness: 0.1 },
        dashing: true,
        ...pathEdgeUpdates[edge.id]
      };
    }
    return {
      id: edge.id,
      color: { color: '#161b22', highlight: '#161b22' },
      width: 1,
      shadow: false,
      label: edge._data.protocol || ''
    };
  });

  nodesDataset.update(nodeUpdates);
  edgesDataset.update(edgeUpdates);

  network.fit({
    nodes: path,
    animation: { duration: 600, easingFunction: 'easeInOutQuad' }
  });
}

function renderTraceResultInDetailPanel(sourceId, destIp, hops) {
  const sourceDevice = currentTopology.devices.find(d => d.id === sourceId);
  const sourceLabel = sourceDevice ? sourceDevice.label : sourceId;

  document.getElementById('detail-title').textContent = `Trace: to ${destIp}`;
  
  let html = `
    <div class="detail-card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <span style="font-size: 0.72rem; color: #8b949e; font-weight: 600;">SOURCE: ${sourceLabel}</span>
        <button id="btn-back-to-device" class="ctrl-btn" style="width: auto; margin: 0; padding: 2px 8px; font-size: 0.65rem;">Back</button>
      </div>
      
      <div style="position: relative; padding-left: 20px; margin-top: 15px; border-left: 2px dashed #30363d; margin-left: 8px;">
        ${hops.map((hop, idx) => {
          const isLast = idx === hops.length - 1;
          const isFirst = idx === 0;
          
          return `
            <div style="position: relative; margin-bottom: 20px;">
              <span style="position: absolute; left: -27px; top: 2px; width: 12px; height: 12px; border-radius: 50%; background: #ff9c3a; border: 3px solid #0d1117;"></span>
              
              <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 8px 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span style="font-weight: 600; font-size: 0.82rem; color: #ff9c3a;">Hop ${idx + 1}: ${hop.label}</span>
                  <span class="uppercase-badge">${hop.type}</span>
                </div>
                
                <div style="font-size: 0.75rem; color: #8b949e; font-family: monospace; margin-top: 4px;">IP: ${hop.ip}</div>
                
                <div style="display: flex; gap: 8px; margin-top: 6px; font-size: 0.7rem; font-family: monospace; color: #c9d1d9; border-top: 1px solid #21262d; padding-top: 6px;">
                  ${!isFirst ? `<div style="background: rgba(88, 166, 255, 0.1); border: 1px solid rgba(88, 166, 255, 0.2); padding: 1px 4px; border-radius: 3px; color: #58a6ff;">In: ${hop.ingress_interface}</div>` : ''}
                  ${!isLast ? `<div style="background: rgba(255, 156, 58, 0.1); border: 1px solid rgba(255, 156, 58, 0.2); padding: 1px 4px; border-radius: 3px; color: #ff9c3a;">Out: ${hop.egress_interface}</div>` : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  document.getElementById('detail-body').innerHTML = html;
  setDetailVisible(true);

  const backBtn = document.getElementById('btn-back-to-device');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      resetGraphHighlight();
      const dev = currentTopology.devices.find(d => d.id === sourceId);
      if (dev) showDeviceDetail(dev, currentTopology.links);
    });
  }
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function showDeviceDetail(device, links) {
  const connectedLinks = links.filter(l => l.source === device.id || l.target === device.id);
  const statusInfo = deviceHealthStatuses[device.id] || { online: true, latency: null };
  const isOnline = statusInfo.online;
  const latency = statusInfo.latency;

  document.getElementById('detail-title').textContent = device.label;
  document.getElementById('detail-body').innerHTML = `
    <!-- Status & Info Card -->
    <div class="detail-card">
      <div class="detail-row">
        <div class="detail-key">Status</div>
        <div class="detail-val">
          <span class="status-badge ${isOnline ? 'online' : 'offline'}">
            <span class="status-badge-dot"></span>${isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
      ${isOnline && latency !== null && latency !== undefined ? `
      <div class="detail-row">
        <div class="detail-key">Latency</div>
        <div class="detail-val font-mono highlight-text">${latency}ms</div>
      </div>` : ''}
      <div class="detail-row"><div class="detail-key">Type</div><div class="detail-val uppercase-badge">${device.type}</div></div>
      <div class="detail-row"><div class="detail-key">Layer</div><div class="detail-val uppercase-badge">${device.layer}</div></div>
      ${device.ip ? `<div class="detail-row"><div class="detail-key">IP Address</div><div class="detail-val font-mono highlight-text">${device.ip}</div></div>` : ''}
      ${device.platform ? `<div class="detail-row"><div class="detail-key">Platform</div><div class="detail-val font-mono">${device.platform}</div></div>` : ''}
    </div>

    <!-- Connections Card -->
    <div class="detail-card">
      <div class="card-title">Interface Status (${connectedLinks.length})</div>
      <div class="connections-list">
        ${connectedLinks.length === 0 ? '<div class="no-connections">No active physical links</div>' : 
          connectedLinks.map(l => {
            const isSrc = l.source === device.id;
            const remoteNodeId = isSrc ? l.target : l.source;
            const remoteDevice = currentTopology.devices.find(d => d.id === remoteNodeId);
            const remoteLabel = remoteDevice ? remoteDevice.label : remoteNodeId;
            const localIface = isSrc ? (l.src_iface || 'Gi0/1') : (l.dst_iface || 'Gi0/1');
            
            return `
              <div class="interface-item">
                <div class="interface-meta">
                  <span class="interface-name">${localIface}</span>
                  <span class="interface-peer">to ${remoteLabel}</span>
                </div>
                <div class="interface-stats">
                  <span class="proto-tag">${l.protocol || 'UP'}</span>
                  <span class="bw-tag">${l.bandwidth || '1G'}</span>
                </div>
              </div>
            `;
          }).join('')
        }
      </div>
    </div>

    <!-- Configured Interfaces Card -->
    ${device.interfaces && device.interfaces.length > 0 ? `
    <div class="detail-card">
      <div class="card-title">Configured Interfaces (${device.interfaces.length})</div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${device.interfaces.map(iface => {
          let modeBadge = `<span class="uppercase-badge" style="font-size: 0.65rem; padding: 2px 6px; font-weight: 600; color: #58a6ff; background: rgba(56, 139, 253, 0.15); border: 1px solid rgba(56, 139, 253, 0.3); border-radius: 4px;">${iface.mode || 'routed'}</span>`;
          let detailsHtml = '';
          if (iface.mode === 'access') {
            detailsHtml = `<div style="color: #c9d1d9;">VLAN: <span style="color: #58a6ff;">${iface.vlan_access !== undefined && iface.vlan_access !== null ? iface.vlan_access : 'N/A'}</span></div>`;
          } else if (iface.mode === 'trunk') {
            detailsHtml = `<div style="color: #c9d1d9;">Native VLAN: <span style="color: #58a6ff;">${iface.vlan_native !== undefined && iface.vlan_native !== null ? iface.vlan_native : '1'}</span>${iface.vlan_trunk ? `<br>Allowed VLANs: <span style="color: #58a6ff;">${iface.vlan_trunk}</span>` : ''}</div>`;
          } else {
            detailsHtml = `<div style="color: #c9d1d9;">IP Address: <span style="color: #58a6ff;">${iface.ip || ''}/${iface.mask || ''}</span></div>`;
          }
          let sharedHtml = `<div style="color: #8b949e; font-size: 0.7rem; margin-top: 4px;">MTU: ${iface.mtu || 1500} | Speed: ${iface.speed || 'auto'}</div>`;
          return `
            <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; justify-content: space-between;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-weight: 600; color: #c9d1d9; font-family: monospace;">${iface.name}</span>
                ${modeBadge}
              </div>
              <div style="font-family: monospace; font-size: 0.72rem; line-height: 1.4;">
                ${detailsHtml}
                ${sharedHtml}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <button id="open-console-btn" class="console-action-card">
      <div class="console-action-icon">&#128187;</div>
      <div class="console-action-text">
        <div class="console-action-title">Open Terminal Console</div>
        <div class="console-action-desc">Start interactive CLI session</div>
      </div>
    </button>

    <!-- Path Tracing Card -->
    <div class="detail-card">
      <div class="card-title">L3 Path Tracing</div>
      <div class="form-group" style="margin-top: 8px;">
        <label for="trace-dst-input" style="font-size: 0.72rem; color: #8b949e;">Destination IP or Node Label:</label>
        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <input type="text" id="trace-dst-input" placeholder="e.g. 10.0.0.3" style="flex: 1; min-width: 0; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; padding: 6px 8px; font-size: 0.8rem; outline: none; font-family: monospace;">
          <button id="trace-path-btn" class="ctrl-btn active" style="width: auto; margin: 0; padding: 6px 12px; font-size: 0.8rem;">Trace</button>
        </div>
      </div>
    </div>

    <!-- Config Drift Analysis Card -->
    ${isTimelineMode && selectedBackupIndex !== -1 ? `
    <div class="detail-card" style="margin-top: 12px;">
      <div class="card-title">Config Drift Analysis</div>
      <p style="font-size: 0.72rem; color: #8b949e; margin-bottom: 8px;">Compare configuration with selected timeline snapshot.</p>
      <button id="view-config-diff-btn" class="ctrl-btn active" style="width: 100%;">
        Compare Configuration
      </button>
    </div>
    ` : ''}
  `;
  setDetailVisible(true);
  
  const consoleBtn = document.getElementById('open-console-btn');
  if (consoleBtn) {
    consoleBtn.addEventListener('click', () => {
      openTerminalForDevice(device.id);
    });
  }

  const traceBtn = document.getElementById('trace-path-btn');
  if (traceBtn) {
    traceBtn.addEventListener('click', () => {
      const destIp = document.getElementById('trace-dst-input').value.trim();
      runPathTrace(device.id, destIp);
    });
    document.getElementById('trace-dst-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const destIp = document.getElementById('trace-dst-input').value.trim();
        runPathTrace(device.id, destIp);
      }
    });
  }

  const diffBtn = document.getElementById('view-config-diff-btn');
  if (diffBtn) {
    diffBtn.addEventListener('click', () => {
      showConfigDiffModal(device.id);
    });
  }
}

function showEdgeDetail(link) {
  let warningsHtml = '';
  if (link.warnings && link.warnings.length > 0) {
    warningsHtml = `
      <div class="audit-warning-card" style="margin-top: 15px; padding: 12px; background: rgba(255, 159, 67, 0.15); border: 1px solid #ff9f43; border-radius: 6px;">
        <div style="font-weight: bold; color: #ff9f43; display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Protocol & Link Audit Mismatches
        </div>
        <ul style="margin: 0; padding-left: 18px; color: #ffb067; font-size: 11.5px; line-height: 1.5; text-align: left;">
          ${link.warnings.map(w => `<li>${w}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  document.getElementById('detail-title').textContent = `Link: ${link.source} ↔ ${link.target}`;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-row"><div class="detail-key">Protocol</div><div class="detail-val">${link.protocol || 'N/A'}</div></div>
    <div class="detail-row"><div class="detail-key">Bandwidth</div><div class="detail-val">${link.bandwidth || 'N/A'}</div></div>
    ${link.src_iface ? `<div class="detail-row"><div class="detail-key">Source Interface</div><div class="detail-val">${link.src_iface}</div></div>` : ''}
    ${link.dst_iface ? `<div class="detail-row"><div class="detail-key">Dest Interface</div><div class="detail-val">${link.dst_iface}</div></div>` : ''}
    ${warningsHtml}
  `;
  setDetailVisible(true);
}

function resetDetailPanel() {
  setDetailVisible(false);
  resetGraphHighlight();
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
  
  updateDiagnosticsSummary(data);
}

function updateDiagnosticsSummary(data) {
  const container = document.getElementById('diagnostics-summary');
  if (!container) return;

  const mismatchLinks = data.links.filter(l => l.vlan_mismatch || l.subnet_mismatch || l.mtu_mismatch || l.speed_mismatch);
  
  if (mismatchLinks.length === 0) {
    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; color: #3fb950; font-weight: 500; font-size: 0.8rem; margin-top: 5px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        All links healthy
      </div>
    `;
    return;
  }

  let html = `
    <div style="display: flex; align-items: center; gap: 8px; color: #ff9f43; font-weight: 500; font-size: 0.8rem; margin-bottom: 8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Found ${mismatchLinks.length} issue${mismatchLinks.length > 1 ? 's' : ''}
    </div>
    <div style="max-height: 180px; overflow-y: auto; border: 1px solid #21262d; border-radius: 4px; padding: 4px; display: flex; flex-direction: column; gap: 4px;">
  `;

  mismatchLinks.forEach(l => {
    let typeLabel = 'Warning';
    let typeColor = '#ffc107';
    if (l.subnet_mismatch) {
      typeLabel = 'Subnet';
      typeColor = '#f85149';
    } else if (l.vlan_mismatch) {
      typeLabel = 'VLAN';
      typeColor = '#ff9f43';
    } else if (l.mtu_mismatch) {
      typeLabel = 'MTU';
    } else if (l.speed_mismatch) {
      typeLabel = 'Speed';
    }

    // Find the edge index in currentTopology.links to select it on click
    const edgeId = data.links.indexOf(l);

    html += `
      <div class="diag-item" onclick="focusOnEdge(${edgeId})" style="cursor: pointer; padding: 6px; border-radius: 4px; background: #161b22; font-size: 0.72rem; border-left: 3px solid ${typeColor}; transition: background 0.2s; text-align: left;">
        <div style="font-weight: 600; display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span>${l.source} ↔ ${l.target}</span>
          <span style="color: ${typeColor}; font-size: 0.65rem;">[${typeLabel}]</span>
        </div>
        <div style="color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${l.warnings[0] || ''}">
          ${l.warnings[0] || 'Mismatch detected'}
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function focusOnEdge(edgeId) {
  if (!network || !edgesDataset) return;
  const edge = edgesDataset.get(edgeId);
  if (!edge) return;
  
  // Select the edge
  network.selectEdges([edgeId]);
  
  // Show details
  showEdgeDetail(edge._data);
  
  // Center camera on the connected nodes
  const nodeIds = [edge.from, edge.to];
  network.fit({
    nodes: nodeIds,
    animation: {
      duration: 500,
      easingFunction: 'easeInOutQuad'
    }
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function enableExportButtons(enabled) {
  document.getElementById('btn-export-png').disabled = !enabled;
  document.getElementById('btn-export-svg').disabled = !enabled;
  document.getElementById('btn-export-json').disabled = !enabled;
  document.getElementById('btn-save-server').disabled = !enabled;
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
function setLoading(loading, text = 'Loading topology…', showLog = false) {
  const el = document.getElementById('canvas-loading');
  if (el) {
    el.classList.toggle('hidden', !loading);
  }
  const textEl = document.getElementById('canvas-loading-text');
  if (textEl) {
    textEl.textContent = text;
  }
  const logEl = document.getElementById('discovery-log-container');
  if (logEl) {
    logEl.style.display = (loading && showLog) ? 'block' : 'none';
    if (!loading) {
      logEl.innerHTML = '';
    }
  }
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
      updateLayoutToggleUI('free');
      showToast('Switched to Free layout to preserve your custom positions.', 'info');
      
      // Update edge smoothing to straight
      if (edgesDataset) {
        const allEdges = edgesDataset.get();
        const updates = allEdges.map(e => ({
          id: e.id,
          smooth: false
        }));
        edgesDataset.update(updates);
      }
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
      },
      edges: {
        smooth: currentLayout === 'free' ? false : { type: 'curvedCW', roundness: 0.1 }
      }
    });
    if (!isEditingMode) {
      network.disableEditMode();
    }
  }

  // Update nodes dataset fixed state and clear/restore level constraint
  if (nodesDataset) {
    const allNodes = nodesDataset.get();
    const updates = allNodes.map(n => {
      const isHierarchical = currentLayout === 'hierarchical';
      return {
        id: n.id,
        fixed: !isEditingMode,
        level: (isHierarchical && !isEditingMode) ? (LAYER_LEVEL[n._data.layer] || 3) : null
      };
    });
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
    renderNetwork(data, true);
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
  const isZip = file.name.endsWith('.zip');
  setLoading(true, isZip ? 'Importing and parsing config zip...' : 'Loading topology…');
  const form = new FormData();
  form.append('file', file);
  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json();
      showToast('Upload error: ' + (err.detail || resp.statusText), 'error');
      return;
    }
    renderNetwork(await resp.json(), true);
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
// #18 — WebSocket live topology feed
// ---------------------------------------------------------------------------

let _ws = null;
let _wsReconnectTimer = null;
let _wsDelay = 1000; // ms; doubles on each failure, capped at 30s

function handleStatusUpdate(statuses) {
  deviceHealthStatuses = statuses;
  if (!nodesDataset) return;

  const updates = [];
  for (const [deviceId, status] of Object.entries(statuses)) {
    const node = nodesDataset.get(deviceId);
    if (!node) continue;

    const isOnline = status.online;
    const latency = status.latency;

    // Red pulsing shadow for offline nodes, normal shadow for online nodes
    const shadowOptions = isOnline 
      ? { enabled: true, color: 'rgba(0,0,0,0.5)', size: 10, x: 5, y: 5 }
      : { enabled: true, color: '#f85149', size: 20, x: 0, y: 0 };

    // Rebuild tooltip with health information
    const baseData = node._data;
    let tooltip = `${baseData.label}\nType: ${baseData.type}\nLayer: ${baseData.layer}`;
    if (baseData.ip) tooltip += `\nIP: ${baseData.ip}`;
    if (baseData.platform) tooltip += `\nPlatform: ${baseData.platform}`;
    
    tooltip += `\nStatus: ${isOnline ? 'Online' : 'Offline'}`;
    if (isOnline && latency !== undefined && latency !== null) {
      tooltip += `\nLatency: ${latency}ms`;
    }

    updates.push({
      id: deviceId,
      shadow: shadowOptions,
      title: tooltip
    });
  }

  if (updates.length > 0) {
    nodesDataset.update(updates);
  }

  // If the currently selected node received an update, refresh the detail panel
  if (selectedDeviceId && statuses[selectedDeviceId] && currentTopology) {
    const node = nodesDataset.get(selectedDeviceId);
    if (node) {
      showDeviceDetail(node._data, currentTopology.links);
    }
  }
}

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
        if (data && data.type === 'status_update') {
          handleStatusUpdate(data.statuses);
        } else if (data && data.type === 'discovery_log') {
          const logEl = document.getElementById('discovery-log-container');
          if (logEl) {
            const div = document.createElement('div');
            div.textContent = data.message;
            logEl.appendChild(div);
            logEl.scrollTop = logEl.scrollHeight;
          }
        } else if (data && data.devices && data.links) {
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

function addInterfaceRowToModal(iface = {}) {
  const container = document.getElementById('modal-interfaces-list');
  if (!container) return;

  const rowId = `iface-row-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  
  const name = iface.name || '';
  const mode = iface.mode || 'routed';
  const ip = iface.ip || '';
  const mask = iface.mask || '';
  const vlanAccess = iface.vlan_access !== undefined && iface.vlan_access !== null ? iface.vlan_access : '';
  const vlanNative = iface.vlan_native !== undefined && iface.vlan_native !== null ? iface.vlan_native : '';
  const vlanTrunk = iface.vlan_trunk || '';
  const mtu = iface.mtu !== undefined && iface.mtu !== null ? iface.mtu : '';
  const speed = iface.speed || '';

  const rowHtml = `
    <div class="interface-row" id="${rowId}" style="background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-bottom: 8px; position: relative;">
      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input type="text" class="iface-name" placeholder="Interface (e.g. Gi1/0/1)" value="${name}" style="flex: 2; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9;" required>
        <select class="iface-mode" style="flex: 1.5; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9;">
          <option value="routed" ${mode === 'routed' ? 'selected' : ''}>Routed</option>
          <option value="trunk" ${mode === 'trunk' ? 'selected' : ''}>Trunk</option>
          <option value="access" ${mode === 'access' ? 'selected' : ''}>Access</option>
        </select>
        <button type="button" class="iface-delete-btn" style="background: transparent; border: none; color: #f85149; cursor: pointer; padding: 4px 8px; font-size: 1rem;" title="Delete Interface">
          🗑️
        </button>
      </div>
      <div class="iface-details-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
        <!-- Conditional L3 fields (IP/Mask) -->
        <div class="iface-field-group iface-l3-fields" style="${mode === 'routed' ? '' : 'display: none;'}">
          <label style="font-size: 0.7rem; color: #8b949e; display: block; margin-bottom: 2px;">IP Address</label>
          <input type="text" class="iface-ip" placeholder="e.g. 10.0.1.1" value="${ip}" style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; box-sizing: border-box;">
        </div>
        <div class="iface-field-group iface-l3-fields" style="${mode === 'routed' ? '' : 'display: none;'}">
          <label style="font-size: 0.7rem; color: #8b949e; display: block; margin-bottom: 2px;">Subnet Mask</label>
          <input type="text" class="iface-mask" placeholder="e.g. 255.255.255.252" value="${mask}" style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; box-sizing: border-box;">
        </div>
        <!-- Conditional L2 Access fields -->
        <div class="iface-field-group iface-access-fields" style="grid-column: span 2; ${mode === 'access' ? '' : 'display: none;'}">
          <label style="font-size: 0.7rem; color: #8b949e; display: block; margin-bottom: 2px;">Access VLAN</label>
          <input type="number" class="iface-vlan-access" placeholder="e.g. 10" value="${vlanAccess}" style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; box-sizing: border-box;">
        </div>
        <!-- Conditional L2 Trunk fields -->
        <div class="iface-field-group iface-trunk-fields" style="${mode === 'trunk' ? '' : 'display: none;'}">
          <label style="font-size: 0.7rem; color: #8b949e; display: block; margin-bottom: 2px;">Native VLAN</label>
          <input type="number" class="iface-vlan-native" placeholder="e.g. 1" value="${vlanNative}" style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; box-sizing: border-box;">
        </div>
        <div class="iface-field-group iface-trunk-fields" style="${mode === 'trunk' ? '' : 'display: none;'}">
          <label style="font-size: 0.7rem; color: #8b949e; display: block; margin-bottom: 2px;">Allowed VLANs</label>
          <input type="text" class="iface-vlan-trunk" placeholder="e.g. 10,20,30" value="${vlanTrunk}" style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; box-sizing: border-box;">
        </div>
        <!-- Shared fields -->
        <div class="iface-field-group">
          <label style="font-size: 0.7rem; color: #8b949e; display: block; margin-bottom: 2px;">MTU</label>
          <input type="number" class="iface-mtu" placeholder="e.g. 1500" value="${mtu}" style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; box-sizing: border-box;">
        </div>
        <div class="iface-field-group">
          <label style="font-size: 0.7rem; color: #8b949e; display: block; margin-bottom: 2px;">Speed</label>
          <input type="text" class="iface-speed" placeholder="e.g. auto, 1000, 10g" value="${speed}" style="width: 100%; padding: 6px 8px; background: #161b22; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9; box-sizing: border-box;">
        </div>
      </div>
    </div>
  `;
  
  container.insertAdjacentHTML('beforeend', rowHtml);
  
  const newRow = document.getElementById(rowId);
  if (!newRow) return;
  
  // Bind change listener to mode select
  const modeSelect = newRow.querySelector('.iface-mode');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      const newMode = e.target.value;
      const l3Fields = newRow.querySelectorAll('.iface-l3-fields');
      const accessFields = newRow.querySelectorAll('.iface-access-fields');
      const trunkFields = newRow.querySelectorAll('.iface-trunk-fields');
      
      if (newMode === 'routed') {
        l3Fields.forEach(f => f.style.display = '');
        accessFields.forEach(f => f.style.display = 'none');
        trunkFields.forEach(f => f.style.display = 'none');
      } else if (newMode === 'access') {
        l3Fields.forEach(f => f.style.display = 'none');
        accessFields.forEach(f => f.style.display = '');
        trunkFields.forEach(f => f.style.display = 'none');
      } else if (newMode === 'trunk') {
        l3Fields.forEach(f => f.style.display = 'none');
        accessFields.forEach(f => f.style.display = 'none');
        trunkFields.forEach(f => f.style.display = '');
      }
    });
  }
  
  // Bind delete button listener
  const deleteBtn = newRow.querySelector('.iface-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      newRow.remove();
    });
  }
}

function showNodeEditor(action, data, callback) {
  pendingCallback = callback;
  pendingNodeAction = action;
  const modal = document.getElementById('node-modal');
  const isEdit = action === 'edit';
  
  document.getElementById('node-modal-title').textContent = isEdit ? 'Edit Node' : 'Add Node';
  document.getElementById('node-id').value = data.id || `node-${Math.random().toString(36).substr(2, 6)}`;
  
  // Clear interfaces list
  const listContainer = document.getElementById('modal-interfaces-list');
  if (listContainer) {
    listContainer.innerHTML = '';
  }

  if (isEdit && currentTopology) {
    const existing = currentTopology.devices.find(d => d.id === data.id);
    if (existing) {
      document.getElementById('node-label').value = existing.label || '';
      document.getElementById('node-type').value = existing.type || 'switch';
      document.getElementById('node-layer').value = existing.layer || 'access';
      document.getElementById('node-ip').value = existing.ip || '';
      document.getElementById('node-platform').value = existing.platform || '';
      
      // Populate interfaces
      if (existing.interfaces && Array.isArray(existing.interfaces)) {
        existing.interfaces.forEach(iface => {
          addInterfaceRowToModal(iface);
        });
      }
    }
  } else {
    document.getElementById('node-label').value = data.label || '';
    document.getElementById('node-type').value = data.type || 'switch';
    document.getElementById('node-layer').value = data.layer || 'access';
    document.getElementById('node-ip').value = data.ip || '';
    document.getElementById('node-platform').value = data.platform || '';
    
    if (data.interfaces && Array.isArray(data.interfaces)) {
      data.interfaces.forEach(iface => {
        addInterfaceRowToModal(iface);
      });
    }
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

// Bind "+ Add Interface" button click
document.getElementById('btn-add-interface')?.addEventListener('click', () => {
  addInterfaceRowToModal();
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

  // Extract interfaces from rows
  const interfaces = [];
  const rows = document.querySelectorAll('#modal-interfaces-list .interface-row');
  rows.forEach(row => {
    const nameInput = row.querySelector('.iface-name');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) return; // skip row if name is empty
    
    const modeSelect = row.querySelector('.iface-mode');
    const mode = modeSelect ? modeSelect.value : 'routed';
    
    const mtuInput = row.querySelector('.iface-mtu');
    const mtuVal = mtuInput ? mtuInput.value.trim() : '';
    const mtu = mtuVal ? parseInt(mtuVal, 10) : null;
    
    const speedInput = row.querySelector('.iface-speed');
    const speed = speedInput ? speedInput.value.trim() || null : null;
    
    const ifaceData = { name, mode, mtu, speed };
    
    if (mode === 'routed') {
      const ipInput = row.querySelector('.iface-ip');
      const maskInput = row.querySelector('.iface-mask');
      ifaceData.ip = ipInput ? ipInput.value.trim() || null : null;
      ifaceData.mask = maskInput ? maskInput.value.trim() || null : null;
    } else if (mode === 'access') {
      const vlanAccessInput = row.querySelector('.iface-vlan-access');
      const vlanAccessVal = vlanAccessInput ? vlanAccessInput.value.trim() : '';
      ifaceData.vlan_access = vlanAccessVal ? parseInt(vlanAccessVal, 10) : null;
    } else if (mode === 'trunk') {
      const vlanNativeInput = row.querySelector('.iface-vlan-native');
      const vlanTrunkInput = row.querySelector('.iface-vlan-trunk');
      const vlanNativeVal = vlanNativeInput ? vlanNativeInput.value.trim() : '';
      ifaceData.vlan_native = vlanNativeVal ? parseInt(vlanNativeVal, 10) : null;
      ifaceData.vlan_trunk = vlanTrunkInput ? vlanTrunkInput.value.trim() || null : null;
    }
    
    interfaces.push(ifaceData);
  });

  const deviceData = { id, label, type, layer, ip, platform, interfaces };
  
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
  if (network && currentLayout === 'free') {
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
  if (network && currentLayout === 'free') {
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
  setLoading(true, 'Running discovery crawler...', true);
  
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

class TerminalSession {
  constructor(deviceId, deviceName) {
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.mode = 'mock';
    this.socket = null;
    this.history = [];
    this.historyIndex = 0;
    this.activeTraceSource = null;
    this.activeTracePath = [];
    this.status = 'disconnected';
    this.statusText = 'disconnected';
    this.lastPrompt = '>';
    this.sshUsername = 'admin';
    this.sshPassword = '';

    try {
      const hist = localStorage.getItem('netvis_terminal_history_' + deviceId);
      this.history = hist ? JSON.parse(hist) : [];
    } catch (e) {
      this.history = [];
    }
    this.historyIndex = this.history.length;

    this.createDomElement();
  }

  createDomElement() {
    const contentArea = document.getElementById('terminal-content-area');
    if (!contentArea) return;

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'terminal-tab-body hidden';
    this.bodyEl.dataset.deviceId = this.deviceId;
    
    this.bodyEl.innerHTML = `
      <div class="terminal-ssh-creds terminal-creds-form hidden">
        <span class="terminal-creds-label">SSH credentials required for real connection:</span>
        <div class="terminal-creds-inputs">
          <input type="text" class="ssh-username" placeholder="Username" value="${this.sshUsername}">
          <input type="password" class="ssh-password" placeholder="Password">
          <button class="ctrl-btn active" style="width: auto; margin-bottom: 0; padding: 4px 12px; font-size: 0.75rem;">Connect</button>
        </div>
      </div>
      <div class="terminal-body">
        <div class="terminal-output"></div>
        <div class="terminal-input-line">
          <span class="terminal-prompt">${this.lastPrompt}</span>
          <input type="text" class="terminal-input" autocomplete="off" spellcheck="false" placeholder="Type a command...">
        </div>
      </div>
    `;
    
    contentArea.appendChild(this.bodyEl);

    // Credentials Connect Event
    const connectBtn = this.bodyEl.querySelector('.terminal-creds-inputs button');
    connectBtn.addEventListener('click', () => {
      const u = this.bodyEl.querySelector('.ssh-username').value.trim();
      const p = this.bodyEl.querySelector('.ssh-password').value;
      if (!u || !p) {
        showToast('Username and password required for SSH', 'warning');
        return;
      }
      this.bodyEl.querySelector('.terminal-ssh-creds').classList.add('hidden');
      this.sshUsername = u;
      this.sshPassword = p;
      this.connectSocket(u, p);
    });

    // Auto-focus input on clicking anywhere inside terminal body
    const bodyContainer = this.bodyEl.querySelector('.terminal-body');
    const inputEl = this.bodyEl.querySelector('.terminal-input');
    bodyContainer.addEventListener('click', () => {
      inputEl.focus();
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = inputEl.value;
        const trimmedVal = val.trim().toLowerCase();
        
        if (trimmedVal.startsWith('traceroute') || trimmedVal.startsWith('trace')) {
          this.activeTraceSource = this.deviceId;
          this.activeTracePath = [this.deviceId];
          if (activeSessionId === this.deviceId) {
            activeTraceSource = this.deviceId;
            activeTracePath = [this.deviceId];
            resetGraphHighlight();
          }
        } else if (trimmedVal.length > 0) {
          this.activeTraceSource = null;
          this.activeTracePath = [];
          if (activeSessionId === this.deviceId) {
            activeTraceSource = null;
            activeTracePath = [];
            resetGraphHighlight();
          }
        }

        if (val.trim() && (this.history.length === 0 || this.history[this.history.length - 1] !== val)) {
          this.history.push(val);
          localStorage.setItem('netvis_terminal_history_' + this.deviceId, JSON.stringify(this.history));
        }
        this.historyIndex = this.history.length;

        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(val + '\r');
        } else {
          this.appendText("\r\nSession not connected.\r\n");
        }
        inputEl.value = '';
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.historyIndex > 0) {
          this.historyIndex--;
          inputEl.value = this.history[this.historyIndex];
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          inputEl.value = this.history[this.historyIndex];
        } else {
          this.historyIndex = this.history.length;
          inputEl.value = '';
        }
      }
    });
  }

  appendText(text) {
    const out = this.bodyEl.querySelector('.terminal-output');
    if (!out) return;

    // Parse traceroute hops in real-time
    if (this.activeTraceSource && currentTopology) {
      const lines = text.split(/\r?\n/);
      lines.forEach(line => {
        const hopMatch = line.match(/^\s*(\d+)\s+.*?\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
        if (hopMatch) {
          const hopIp = hopMatch[2];
          const device = currentTopology.devices.find(d => d.ip === hopIp);
          if (device && !this.activeTracePath.includes(device.id)) {
            if (this.activeTracePath.length > 0) {
              const lastHopId = this.activeTracePath[this.activeTracePath.length - 1];
              const gapPath = findShortestPath(lastHopId, device.id);
              if (gapPath && gapPath.length > 1) {
                for (let i = 1; i < gapPath.length; i++) {
                  if (!this.activeTracePath.includes(gapPath[i])) {
                    this.activeTracePath.push(gapPath[i]);
                  }
                }
              } else {
                this.activeTracePath.push(device.id);
              }
            } else {
              this.activeTracePath.push(device.id);
            }
            if (activeSessionId === this.deviceId) {
              activeTracePath = this.activeTracePath;
              highlightExplicitPath(this.activeTracePath, 'trace');
            }
          }
        }
      });
    }

    const promptRegex = /([A-Za-z0-9._-]+(?:\([^)]+\))?[>#])\s*$/;
    const loginRegex = /(Username:|Password:)\s*$/i;
    let match = text.match(promptRegex) || text.match(loginRegex);
    if (match) {
      this.lastPrompt = match[1];
      const promptEl = this.bodyEl.querySelector('.terminal-prompt');
      if (promptEl) promptEl.textContent = this.lastPrompt;
    }

    let formatted = text
      .replace(/\r\n/g, '\n')
      .replace(/\n\r/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n/g, '<br>');

    const div = document.createElement('span');
    div.innerHTML = formatted;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  }

  clearOutput() {
    const out = this.bodyEl.querySelector('.terminal-output');
    if (out) out.innerHTML = '';
  }

  updateStatus(dotClass, text) {
    this.status = dotClass;
    this.statusText = text;
    
    // Update tab status dot
    const tabEl = document.querySelector(`.terminal-tab[data-device-id="${this.deviceId}"]`);
    if (tabEl) {
      const tabDot = tabEl.querySelector('.terminal-tab-dot');
      if (tabDot) {
        tabDot.className = `terminal-tab-dot ${dotClass}`;
      }
    }

    if (activeSessionId === this.deviceId) {
      updateUIStatus(dotClass, text, this.lastPrompt);
    }
  }

  connectSocket(username = null, password = null) {
    if (this.socket) {
      this.socket.close();
    }
    
    if (!currentTopology) return;
    const device = currentTopology.devices.find(d => d.id === this.deviceId);
    if (!device) return;

    this.updateStatus('connecting', 'connecting');

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${proto}//${location.host}/ws/terminal/${this.deviceId}?mode=${this.mode}`;
    url += `&ip=${encodeURIComponent(device.ip || '')}`;
    url += `&platform=${encodeURIComponent(device.platform || 'cisco_ios')}`;
    
    if (this.mode === 'ssh' && username && password) {
      url += `&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    }

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.updateStatus('connected', 'connected');
      if (activeSessionId === this.deviceId) {
        const inputEl = this.bodyEl.querySelector('.terminal-input');
        if (inputEl) inputEl.focus();
        sendTerminalResize();
      }
    };

    this.socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type) {
          if (data.type === 'output') {
            this.appendText(data.text);
          } else if (data.type === 'path_highlight') {
            if (this.activeTracePath && this.activeTracePath.length > 1) {
              if (activeSessionId === this.deviceId) {
                activeTracePath = this.activeTracePath;
                highlightExplicitPath(this.activeTracePath, data.highlight_type || 'trace');
                showToast(data.highlight_type === 'ping' ? 'Ping path highlighted in cyan' : 'Traceroute path highlighted in orange', 'info');
              }
            } else {
              if (activeSessionId === this.deviceId) {
                highlightPath(data.source, data.target, data.highlight_type || 'trace');
              }
            }
          } else if (data.type === 'clear') {
            this.clearOutput();
          }
          return;
        }
      } catch (e) {}
      this.appendText(event.data);
    };

    this.socket.onclose = () => {
      this.updateStatus('disconnected', 'disconnected');
      this.appendText("\r\n*** Session closed ***\r\n");
    };

    this.socket.onerror = () => {
      this.updateStatus('disconnected', 'error');
      this.appendText("\r\n*** Connection error ***\r\n");
    };
  }

  destroy() {
    if (this.socket) {
      this.socket.close();
    }
    if (this.bodyEl && this.bodyEl.parentNode) {
      this.bodyEl.parentNode.removeChild(this.bodyEl);
    }
  }
}

let terminalSessions = {};
let activeSessionId = null;

function focusActiveSessionInput() {
  if (activeSessionId && terminalSessions[activeSessionId]) {
    const session = terminalSessions[activeSessionId];
    const inputEl = session.bodyEl.querySelector('.terminal-input');
    if (inputEl) inputEl.focus();
  }
}

function updateUIStatus(dotClass, text, lastPrompt) {
  const dot = document.getElementById('terminal-dot');
  const status = document.getElementById('terminal-status');
  
  if (dot) dot.className = `terminal-dot ${dotClass}`;
  if (status) {
    status.className = `terminal-status ${dotClass}`;
    status.textContent = text;
  }
  
  if (activeSessionId) {
    const session = terminalSessions[activeSessionId];
    if (session && session.bodyEl) {
      const inputEl = session.bodyEl.querySelector('.terminal-input');
      const promptEl = session.bodyEl.querySelector('.terminal-prompt');
      
      if (promptEl) promptEl.textContent = lastPrompt || '>';
      if (inputEl) {
        if (dotClass === 'disconnected') {
          inputEl.placeholder = 'Type a command...';
        } else {
          inputEl.placeholder = '';
        }
      }
    }
  }
}

function switchSession(deviceId) {
  const nextSession = terminalSessions[deviceId];
  if (!nextSession) return;

  // Deactivate active UI components
  const activeTab = document.querySelector('.terminal-tab.active');
  if (activeTab) activeTab.classList.remove('active');
  
  const activeBody = document.querySelector('.terminal-tab-body:not(.hidden)');
  if (activeBody) activeBody.classList.add('hidden');

  // Activate next UI components
  activeSessionId = deviceId;
  terminalDeviceId = deviceId;

  const newTab = document.querySelector(`.terminal-tab[data-device-id="${deviceId}"]`);
  if (newTab) newTab.classList.add('active');
  
  if (nextSession.bodyEl) {
    nextSession.bodyEl.classList.remove('hidden');
  }

  // Update header parameters
  const selectEl = document.getElementById('terminal-mode-select');
  if (selectEl) {
    selectEl.value = nextSession.mode;
  }
  updateUIStatus(nextSession.status, nextSession.statusText, nextSession.lastPrompt);

  // Restore path highlights
  resetGraphHighlight();
  activeTraceSource = nextSession.activeTraceSource;
  activeTracePath = nextSession.activeTracePath;
  if (nextSession.activeTracePath && nextSession.activeTracePath.length > 1) {
    highlightExplicitPath(nextSession.activeTracePath, 'trace');
  }

  focusActiveSessionInput();
}

function closeTab(deviceId, event) {
  if (event) {
    event.stopPropagation();
  }
  
  const session = terminalSessions[deviceId];
  if (!session) return;
  
  session.destroy();
  delete terminalSessions[deviceId];

  const tabEl = document.querySelector(`.terminal-tab[data-device-id="${deviceId}"]`);
  if (tabEl && tabEl.parentNode) {
    tabEl.parentNode.removeChild(tabEl);
  }

  if (activeSessionId === deviceId) {
    const remaining = Object.keys(terminalSessions);
    if (remaining.length > 0) {
      switchSession(remaining[0]);
    } else {
      closeTerminal(true);
    }
  }
}

function openTerminalForDevice(deviceId) {
  if (!currentTopology) return;
  const device = currentTopology.devices.find(d => d.id === deviceId);
  if (!device) return;

  const drawer = document.getElementById('terminal-drawer');
  drawer.classList.remove('closed');
  drawer.classList.remove('minimized');
  const minBtn = document.getElementById('terminal-min-btn');
  if (minBtn) minBtn.textContent = '━';

  if (!terminalSessions[deviceId]) {
    const session = new TerminalSession(deviceId, device.label);
    terminalSessions[deviceId] = session;

    const tabsContainer = document.getElementById('terminal-tabs');
    const tabEl = document.createElement('div');
    tabEl.className = 'terminal-tab';
    tabEl.dataset.deviceId = deviceId;
    tabEl.innerHTML = `
      <span class="terminal-tab-dot ${session.status}"></span>
      <span class="terminal-tab-name">${device.label}</span>
      <span class="terminal-tab-close">&times;</span>
    `;

    tabEl.addEventListener('click', () => {
      switchSession(deviceId);
    });

    const closeBtn = tabEl.querySelector('.terminal-tab-close');
    closeBtn.addEventListener('click', (e) => {
      closeTab(deviceId, e);
    });

    tabsContainer.appendChild(tabEl);

    const selectEl = document.getElementById('terminal-mode-select');
    session.mode = selectEl ? selectEl.value : 'mock';

    if (session.mode === 'mock') {
      session.connectSocket();
    } else {
      const credsForm = session.bodyEl.querySelector('.terminal-creds-form');
      if (credsForm) credsForm.classList.remove('hidden');
      session.updateStatus('disconnected', 'offline');
      session.appendText("SSH Session requested. Please enter credentials above and click Connect.\r\n");
    }
  }

  switchSession(deviceId);
  adjustViewportForTerminal(true);
}

function closeTerminal(adjustViewport = true) {
  const drawer = document.getElementById('terminal-drawer');
  if (!drawer) return;
  drawer.classList.add('closed');
  drawer.classList.remove('minimized');
  
  Object.keys(terminalSessions).forEach(deviceId => {
    terminalSessions[deviceId].destroy();
  });
  terminalSessions = {};
  activeSessionId = null;
  
  const tabsContainer = document.getElementById('terminal-tabs');
  if (tabsContainer) tabsContainer.innerHTML = '';
  
  terminalDeviceId = null;
  activeTraceSource = null;
  activeTracePath = [];

  if (pathHighlightTimeout) {
    clearTimeout(pathHighlightTimeout);
    pathHighlightTimeout = null;
  }
  resetGraphHighlight();

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
    focusActiveSessionInput();
    setTimeout(sendTerminalResize, 320);
  } else {
    drawer.classList.add('minimized');
    minBtn.textContent = '┠';
  }

  adjustViewportForTerminal(true);
}

function handleTerminalModeChange(mode) {
  const bulkCreds = document.getElementById('bulk-creds-fields');
  if (bulkCreds) {
    bulkCreds.style.display = mode === 'ssh' ? 'block' : 'none';
  }

  if (!activeSessionId) return;
  const session = terminalSessions[activeSessionId];
  if (!session) return;
  
  session.mode = mode;
  if (session.socket) {
    session.socket.close();
    session.socket = null;
  }
  
  session.clearOutput();
  
  const credsForm = session.bodyEl.querySelector('.terminal-creds-form');
  if (mode === 'ssh') {
    credsForm.classList.remove('hidden');
    session.updateStatus('disconnected', 'offline');
    session.appendText("SSH Session requested. Please enter credentials above and click Connect.\r\n");
  } else {
    credsForm.classList.add('hidden');
    session.connectSocket();
  }
  focusActiveSessionInput();
}

function clearTerminalOutput() {
  if (activeSessionId && terminalSessions[activeSessionId]) {
    terminalSessions[activeSessionId].clearOutput();
  }
}

function sendTerminalResize() {
  if (!activeSessionId) return;
  const session = terminalSessions[activeSessionId];
  if (!session || !session.socket || session.socket.readyState !== WebSocket.OPEN) return;
  
  const out = session.bodyEl.querySelector('.terminal-output');
  if (!out) return;
  
  const width = out.clientWidth;
  const height = out.clientHeight;
  
  const cols = Math.floor(width / 8.2);
  const rows = Math.floor(height / 17);
  
  session.socket.send(JSON.stringify({
    type: 'resize',
    cols: Math.max(40, cols),
    rows: Math.max(5, rows)
  }));
}

window.addEventListener('resize', sendTerminalResize);

// ---------------------------------------------------------------------------
// Shortest Path Finder & Visual Highlighting
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
        smooth: currentLayout === 'free' ? false : { type: 'curvedCW', roundness: 0.1 },
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

function setOverlayView(overlayType) {
  if (!network || !nodesDataset || !edgesDataset || !currentTopology) return;

  currentOverlay = overlayType;

  if (overlayType === 'physical') {
    resetGraphHighlight();
    return;
  }

  const DIM_NODE = { background: '#161b22', border: '#21262d' };
  const DIM_FONT = { color: '#3d444d' };
  const DIM_EDGE = '#161b22';

  const nodeUpdates = [];
  const edgeUpdates = [];

  const matchedNodeIds = new Set();
  const matchedEdgeIds = new Set();

  if (overlayType.startsWith('vlan-')) {
    const vlanId = overlayType.substring(5); // "10", "20", "30", or "all"
    
    edgesDataset.get().map(edge => {
      const linkVlan = edge._data.vlan;
      
      let isMatch = false;
      let color = '#30363d';
      let label = edge._data.protocol || '';

      if (vlanId === 'all') {
        if (linkVlan) {
          isMatch = true;
          color = linkVlan === '10' ? '#58a6ff' :
                  linkVlan === '20' ? '#56d364' :
                  linkVlan === '30' ? '#ff7b72' : '#ff9c3a'; // Trunk or other is orange
          label = `VLAN ${linkVlan}`;
        }
      } else {
        if (linkVlan === vlanId || linkVlan === 'Trunk') {
          isMatch = true;
          color = linkVlan === 'Trunk' ? '#ff9c3a' : '#58a6ff';
          label = `VLAN ${linkVlan}`;
        }
      }

      if (isMatch) {
        matchedEdgeIds.add(edge.id);
        matchedNodeIds.add(edge.from);
        matchedNodeIds.add(edge.to);
        edgeUpdates.push({
          id: edge.id,
          color: { color: color, highlight: color },
          width: 4,
          label: label,
          font: { color: color, size: 10, background: '#0d1117', strokeWidth: 0 },
          shadow: { enabled: true, color: color, size: 8 }
        });
      } else {
        edgeUpdates.push({
          id: edge.id,
          color: { color: DIM_EDGE, highlight: DIM_EDGE },
          width: 1,
          label: '',
          shadow: false
        });
      }
    });
  } else if (overlayType.startsWith('routing-')) {
    const protocol = overlayType.substring(8).toUpperCase(); // "OSPF" or "BGP"
    const color = protocol === 'OSPF' ? '#ff9c3a' : '#f85149';

    edgesDataset.get().map(edge => {
      const linkProto = edge._data.protocol;
      
      if (linkProto === protocol) {
        matchedEdgeIds.add(edge.id);
        matchedNodeIds.add(edge.from);
        matchedNodeIds.add(edge.to);
        edgeUpdates.push({
          id: edge.id,
          color: { color: color, highlight: color },
          width: 5,
          label: protocol,
          font: { color: color, size: 11, background: '#0d1117', strokeWidth: 0 },
          shadow: { enabled: true, color: color, size: 10 },
          dashing: true
        });
      } else {
        edgeUpdates.push({
          id: edge.id,
          color: { color: DIM_EDGE, highlight: DIM_EDGE },
          width: 1,
          label: '',
          shadow: false,
          dashing: false
        });
      }
    });
  }

  nodesDataset.get().map(node => {
    if (matchedNodeIds.has(node.id)) {
      const colors = NODE_COLORS[node._data.type] || NODE_COLORS.switch;
      const highlightColor = overlayType.startsWith('routing-') 
        ? (overlayType.endsWith('ospf') ? '#ff9c3a' : '#f85149')
        : '#58a6ff';
        
      nodeUpdates.push({
        id: node.id,
        color: { 
          background: colors.background, 
          border: highlightColor,
          highlight: { background: colors.background, border: highlightColor }
        },
        borderWidth: 3,
        shadow: { enabled: true, color: highlightColor, size: 12, x: 0, y: 0 }
      });
    } else {
      nodeUpdates.push({
        id: node.id,
        color: { background: DIM_NODE.background, border: DIM_NODE.border },
        font: { ...DIM_FONT },
        borderWidth: 1,
        shadow: false
      });
    }
  });

  nodesDataset.update(nodeUpdates);
  edgesDataset.update(edgeUpdates);

  if (matchedNodeIds.size > 0) {
    network.fit({
      nodes: Array.from(matchedNodeIds),
      animation: { duration: 500, easingFunction: 'easeInOutQuad' }
    });
  }
}

async function initTimeline() {
  try {
    const response = await fetch('/api/backups');
    if (!response.ok) {
      showToast('Failed to load timeline backups', 'error');
      return;
    }
    const data = await response.json();
    if (!data.backups || data.backups.length === 0) {
      showToast('No backups found. Trigger "Save to Server" to create one first.', 'warning');
      return;
    }

    // Reverse list so index 0 is oldest, last index is newest
    backupsList = data.backups.reverse();
    isTimelineMode = true;

    const container = document.getElementById('timeline-container');
    if (container) {
      container.classList.remove('hidden');
    }

    const slider = document.getElementById('timeline-slider');
    if (slider) {
      slider.min = 0;
      slider.max = backupsList.length - 1;
      slider.value = backupsList.length - 1; // newest by default
    }

    loadBackupIndex(backupsList.length - 1);
    showToast('Timeline Compare Mode active', 'success');
  } catch (error) {
    console.error('Failed to initialize timeline:', error);
    showToast('Network error loading timeline', 'error');
  }
}

function onTimelineSliderInput(val) {
  loadBackupIndex(parseInt(val));
}

async function loadBackupIndex(index) {
  if (index < 0 || index >= backupsList.length) return;
  selectedBackupIndex = index;
  const backup = backupsList[index];

  const d = new Date(backup.timestamp * 1000);
  const dateString = d.toLocaleString();
  const label = document.getElementById('timeline-date-label');
  if (label) {
    label.textContent = dateString;
  }

  try {
    const response = await fetch('/api/layouts/backups/' + backup.filename);
    if (!response.ok) {
      showToast('Failed to load snapshot layout data', 'error');
      return;
    }
    const histTopology = await response.json();

    if (isCompareMode) {
      compareTopologies(histTopology);
    } else {
      renderNetwork(histTopology, false);
    }

    if (selectedDeviceId) {
      const node = nodesDataset.get(selectedDeviceId);
      if (node) {
        showDeviceDetail(node._data, currentTopology.links);
      }
    }
  } catch (error) {
    console.error('Failed to load snapshot layout:', error);
    showToast('Network error loading snapshot data', 'error');
  }
}

function toggleTimelineMode() {
  isCompareMode = !isCompareMode;
  const btn = document.getElementById('btn-timeline-toggle');
  if (btn) {
    btn.textContent = isCompareMode ? 'Compare Mode' : 'Snapshot View';
    btn.classList.toggle('active', isCompareMode);
  }
  if (selectedBackupIndex !== -1) {
    loadBackupIndex(selectedBackupIndex);
  }
}

function exitTimelineMode() {
  isTimelineMode = false;
  selectedBackupIndex = -1;
  
  const container = document.getElementById('timeline-container');
  if (container) {
    container.classList.add('hidden');
  }

  if (currentTopology) {
    renderNetwork(currentTopology, false);
  }

  if (selectedDeviceId) {
    const node = nodesDataset.get(selectedDeviceId);
    if (node) {
      showDeviceDetail(node._data, currentTopology.links);
    }
  }
  
  showToast('Timeline Mode exited. Returned to Live View.', 'info');
}

function compareTopologies(histTopo) {
  if (!currentTopology || !nodesDataset || !edgesDataset) return;

  const { nodes, edges } = buildGraph(currentTopology);
  nodesDataset.clear();
  nodesDataset.add(nodes);
  edgesDataset.clear();
  edgesDataset.add(edges);

  const histLinks = histTopo.links || [];
  const currentLinks = currentTopology.links || [];

  const histDevices = histTopo.devices || [];
  const currentDevices = currentTopology.devices || [];

  const currentDeviceIds = new Set(currentDevices.map(d => d.id));
  const histDeviceIds = new Set(histDevices.map(d => d.id));

  const nodeUpdates = nodesDataset.get().map(node => {
    if (!histDeviceIds.has(node.id)) {
      return {
        id: node.id,
        borderWidth: 3,
        color: { border: '#56d364' },
        shadow: { enabled: true, color: '#56d364', size: 15, x: 0, y: 0 }
      };
    }
    return node;
  });
  nodesDataset.update(nodeUpdates);

  histDevices.forEach(d => {
    if (!currentDeviceIds.has(d.id)) {
      const colors = NODE_COLORS[d.type] || NODE_COLORS.switch;
      nodesDataset.add({
        id: d.id,
        label: d.label + ' (Deleted)',
        type: d.type,
        layer: d.layer,
        color: { background: '#161b22', border: '#f85149' },
        font: { color: '#f85149' },
        borderWidth: 2,
        shadow: { enabled: true, color: '#f85149', size: 10, x: 0, y: 0 },
        x: d.x,
        y: d.y,
        _data: d
      });
    }
  });

  const getLinkKey = l => `${l.source}_${l.target}`;
  const getReverseLinkKey = l => `${l.target}_${l.source}`;

  const currentLinkKeys = new Set();
  currentLinks.forEach(l => {
    currentLinkKeys.add(getLinkKey(l));
    currentLinkKeys.add(getReverseLinkKey(l));
  });

  const histLinkKeys = new Set();
  histLinks.forEach(l => {
    histLinkKeys.add(getLinkKey(l));
    histLinkKeys.add(getReverseLinkKey(l));
  });

  const edgeUpdates = edgesDataset.get().map(edge => {
    const linkKey = `${edge.from}_${edge.to}`;
    if (!histLinkKeys.has(linkKey)) {
      return {
        id: edge.id,
        color: { color: '#56d364', highlight: '#56d364' },
        width: 5,
        label: 'Added',
        font: { color: '#56d364', size: 10, background: '#0d1117', strokeWidth: 0 }
      };
    }
    return edge;
  });
  edgesDataset.update(edgeUpdates);

  histLinks.forEach(l => {
    const linkKey = getLinkKey(l);
    if (!currentLinkKeys.has(linkKey)) {
      edgesDataset.add({
        id: 'deleted_' + l.source + '_' + l.target,
        from: l.source,
        to: l.target,
        color: { color: '#f85149', highlight: '#f85149' },
        width: 3,
        dashing: true,
        label: 'Deleted',
        font: { color: '#f85149', size: 10, background: '#0d1117', strokeWidth: 0 }
      });
    }
  });
}

async function showConfigDiffModal(deviceId) {
  if (selectedBackupIndex === -1 || !backupsList[selectedBackupIndex]) return;
  const backup = backupsList[selectedBackupIndex];
  
  const body = document.getElementById('config-diff-body');
  if (body) body.textContent = "Loading configuration difference analysis...";
  
  const modal = document.getElementById('config-diff-modal');
  if (modal) modal.classList.remove('hidden');

  try {
    const url = `/api/backups/diff?device_id=${encodeURIComponent(deviceId)}&file1=${encodeURIComponent(backup.filename)}&file2=topology.json`;
    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.json();
      if (body) body.textContent = "Error: " + (err.detail || response.statusText);
      return;
    }
    const data = await response.json();
    
    if (body) {
      if (!data.diff) {
        body.innerHTML = `<span style="color: #8b949e;">Configurations are identical. No drift detected.</span>`;
      } else {
        const highlighted = data.diff.split('\n').map(line => {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            return `<span style="color: #56d364;">${escapeHtml(line)}</span>`;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            return `<span style="color: #f85149;">${escapeHtml(line)}</span>`;
          } else if (line.startsWith('@@')) {
            return `<span style="color: #58a6ff;">${escapeHtml(line)}</span>`;
          }
          return escapeHtml(line);
        }).join('\n');
        body.innerHTML = highlighted;
      }
    }
  } catch (error) {
    if (body) body.textContent = "Failed to communicate with server: " + error.message;
  }
}

function closeConfigDiffModal() {
  const modal = document.getElementById('config-diff-modal');
  if (modal) modal.classList.add('hidden');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

