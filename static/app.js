'use strict';

let network = null;
let currentTopology = null;
let currentLayout = 'hierarchical';

const NODE_COLORS = {
  router:   { background: '#1f3a5f', border: '#58a6ff', font: '#79c0ff' },
  switch:   { background: '#1a3a1a', border: '#3fb950', font: '#56d364' },
  firewall: { background: '#3a1a1a', border: '#f85149', font: '#ff7b72' },
  wireless: { background: '#2d1f3a', border: '#d2a8ff', font: '#d2a8ff' },
  cloud:    { background: '#21262d', border: '#8b949e', font: '#8b949e' },
};

const LAYER_LEVEL = { internet: 1, edge: 2, core: 3, distribution: 4, access: 5 };

const DEVICE_ICONS = {
  router: '⬡', switch: '⬡', firewall: '🔥', wireless: '📡', cloud: '☁',
};

function buildGraph(data) {
  const nodes = data.devices.map(d => {
    const colors = NODE_COLORS[d.type] || NODE_COLORS.switch;
    return {
      id: d.id,
      label: d.label + (d.ip ? '\n' + d.ip : ''),
      level: LAYER_LEVEL[d.layer] || 3,
      color: { background: colors.background, border: colors.border, highlight: { background: colors.background, border: '#fff' } },
      font: { color: colors.font, size: 11, face: 'Courier New' },
      shape: 'box',
      borderWidth: 2,
      margin: 8,
      shadow: true,
      title: buildNodeTooltip(d),
      _data: d,
    };
  });

  const edges = data.links.map((l, i) => ({
    id: i,
    from: l.source,
    to: l.target,
    label: l.protocol || '',
    font: { size: 9, color: '#58a6ff', align: 'middle', strokeWidth: 0 },
    color: { color: '#30363d', highlight: '#58a6ff' },
    width: l.bandwidth && l.bandwidth.startsWith('10') ? 3 : 1.5,
    smooth: { type: 'curvedCW', roundness: 0.1 },
    title: buildEdgeTooltip(l),
    _data: l,
  }));

  return { nodes, edges };
}

function buildNodeTooltip(d) {
  return `<b>${d.label}</b><br>Type: ${d.type}<br>Layer: ${d.layer}${d.ip ? '<br>IP: ' + d.ip : ''}${d.platform ? '<br>Platform: ' + d.platform : ''}`;
}

function buildEdgeTooltip(l) {
  let t = `Protocol: ${l.protocol || 'N/A'}<br>BW: ${l.bandwidth || 'N/A'}`;
  if (l.src_iface) t += `<br>Src: ${l.src_iface}`;
  if (l.dst_iface) t += `<br>Dst: ${l.dst_iface}`;
  return t;
}

function renderNetwork(data) {
  currentTopology = data;
  const { nodes, edges } = buildGraph(data);

  const container = document.getElementById('network-container');
  const options = getOptions();

  if (network) network.destroy();
  network = new vis.Network(container, { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) }, options);

  network.on('click', params => {
    if (params.nodes.length > 0) {
      const node = nodes.find(n => n.id === params.nodes[0]);
      showDeviceDetail(node._data, data.links);
    } else if (params.edges.length > 0) {
      const edge = edges.find(e => e.id === params.edges[0]);
      showEdgeDetail(edge._data);
    }
  });

  updateStats(data);
}

function getOptions() {
  const base = {
    physics: { enabled: currentLayout === 'free', stabilization: { iterations: 100 } },
    interaction: { hover: true, tooltipDelay: 150, navigationButtons: true, keyboard: true },
    edges: { arrows: { to: { enabled: false } } },
  };
  if (currentLayout === 'hierarchical') {
    base.layout = { hierarchical: { direction: 'UD', sortMethod: 'directed', levelSeparation: 100, nodeSpacing: 150 } };
    base.physics = { enabled: false };
  }
  return base;
}

function setLayout(layout) {
  currentLayout = layout;
  document.querySelectorAll('.ctrl-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['hierarchical', 'free'][i] === layout);
  });
  if (currentTopology) renderNetwork(currentTopology);
}

function showDeviceDetail(device, links) {
  document.getElementById('detail-title').textContent = device.label;
  const connectedLinks = links.filter(l => l.source === device.id || l.target === device.id);
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
        </div>`).join('')}
    </div>
  `;
}

function showEdgeDetail(link) {
  document.getElementById('detail-title').textContent = `Link: ${link.source} ↔ ${link.target}`;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-row"><div class="detail-key">Protocol</div><div class="detail-val">${link.protocol || 'N/A'}</div></div>
    <div class="detail-row"><div class="detail-key">Bandwidth</div><div class="detail-val">${link.bandwidth || 'N/A'}</div></div>
    ${link.src_iface ? `<div class="detail-row"><div class="detail-key">Source Interface</div><div class="detail-val">${link.src_iface}</div></div>` : ''}
    ${link.dst_iface ? `<div class="detail-row"><div class="detail-key">Dest Interface</div><div class="detail-val">${link.dst_iface}</div></div>` : ''}
  `;
}

function updateStats(data) {
  const types = {};
  data.devices.forEach(d => { types[d.type] = (types[d.type] || 0) + 1; });
  document.getElementById('stats').innerHTML =
    `Devices: ${data.devices.length}<br>Links: ${data.links.length}<br>` +
    Object.entries(types).map(([t, n]) => `${t}: ${n}`).join('<br>');
}

async function loadSample() {
  const resp = await fetch('/api/sample');
  const data = await resp.json();
  renderNetwork(data);
}

async function uploadTopology(event) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch('/api/upload', { method: 'POST', body: form });
  if (!resp.ok) {
    const err = await resp.json();
    alert('Error: ' + err.detail);
    return;
  }
  renderNetwork(await resp.json());
}

// Load sample on startup
window.addEventListener('load', loadSample);
