import { listAllNotes, slugify } from './notes';
import type { VaultNote } from './notes';

// Graph view of the vault (like Obsidian's): one node per note, one edge per [[link]] between notes.
// Optional tag nodes connect notes that share a tag. Self-contained HTML, no CDN, text inserted with
// textContent only. The client script avoids backticks and "${" (it lives in a template literal).

export interface GraphNode {
  id: string;
  title: string;
  category: string;
  tags: string[];
  projects: string[];
  updated: string;
  excerpt: string;
}

export interface GraphData {
  generatedAt: string;
  nodes: GraphNode[];
  links: { source: string; target: string }[];
}

const EXCERPT_CHARS = 700;
// tags every note gets automatically: they would connect everything to everything
const GENERIC_TAGS = new Set(['kvasir', 'libs', 'patterns', 'decisions', 'tasks', 'commits', 'errors', 'agents', 'answers']);

function linkTargets(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)].map((match) => match[1].trim());
}

export function buildGraph(notes: VaultNote[]): GraphData {
  const byKey = new Map<string, string>();
  for (const note of notes) {
    const id = `${note.category}/${note.slug}`;
    byKey.set(id.toLowerCase(), id);
    byKey.set(note.slug.toLowerCase(), byKey.get(note.slug.toLowerCase()) ?? id);
    byKey.set(slugify(note.meta.title), byKey.get(slugify(note.meta.title)) ?? id);
  }

  const links = new Map<string, { source: string; target: string }>();
  for (const note of notes) {
    const source = `${note.category}/${note.slug}`;
    for (const raw of linkTargets(note.body)) {
      const target = byKey.get(raw.toLowerCase()) ?? byKey.get(slugify(raw));
      if (!target || target === source) continue;
      const key = [source, target].sort().join('\u0000');
      links.set(key, { source, target });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes: notes.map((note) => ({
      id: `${note.category}/${note.slug}`,
      title: note.meta.title,
      category: note.category,
      tags: note.meta.tags.filter((tag) => !GENERIC_TAGS.has(tag)),
      projects: note.meta.projects,
      updated: note.meta.updated,
      excerpt: note.body.slice(0, EXCERPT_CHARS),
    })),
    links: [...links.values()],
  };
}

export async function collectGraph(): Promise<GraphData> {
  return buildGraph(await listAllNotes());
}

function embed(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (char) => '\\u' + char.charCodeAt(0).toString(16));
}

export function renderGraphHtml(data: GraphData): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kvasir Knowledge</title>
<style>
:root { --bg: #0f1115; --panel: #171a21; --border: #2a2f3a; --text: #e6e8ee; --muted: #9aa3b2; --edge: rgba(154,163,178,.28); }
@media (prefers-color-scheme: light) { :root { --bg: #f6f7fb; --panel: #fff; --border: #dfe3ec; --text: #1a1f2b; --muted: #5d6677; --edge: rgba(93,102,119,.3); } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
.bar { position: fixed; top: 12px; left: 12px; right: 12px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; pointer-events: none; }
.bar > * { pointer-events: auto; }
.chip { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 6px 10px; }
input[type=search] { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 7px 10px; min-width: 200px; font: inherit; }
.legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; }
#info { position: fixed; right: 12px; bottom: 12px; width: min(420px, calc(100vw - 24px)); max-height: 55vh; overflow: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; display: none; }
#info h2 { margin: 0 0 4px; font-size: 16px; }
#info .sub { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
#info pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, Consolas, monospace; margin: 0; }
#empty { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; color: var(--muted); text-align: center; padding: 24px; }
label { font-size: 13px; color: var(--muted); }
</style>
</head>
<body>
<canvas id="graph"></canvas>
<div class="bar">
  <span class="chip"><strong>Kvasir · Knowledge</strong> <span id="count" style="color:var(--muted)"></span></span>
  <input type="search" id="search" placeholder="Buscar nota ou tag...">
  <label class="chip"><input type="checkbox" id="tags"> ligar por tags</label>
  <span class="chip legend" id="legend"></span>
</div>
<div id="info"></div>
<div id="empty">A base de conhecimento ainda está vazia.<br>fix, commit, review e doc criam notas sozinhos; ou use "kvasir knowledge add".</div>
<script id="kvasir-data" type="application/json">${embed(data)}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('kvasir-data').textContent);
  var COLORS = { libs: '#7c9cff', patterns: '#4fd1c5', decisions: '#ecc94b', tasks: '#ed8936', commits: '#9f7aea', errors: '#f56565', agents: '#48bb78', answers: '#f687b3', tag: '#718096' };
  var NAMES = { libs: 'bibliotecas', patterns: 'padrões', decisions: 'decisões', tasks: 'tasks', commits: 'commits', errors: 'erros', agents: 'agentes', answers: 'respostas', tag: 'tag' };
  var canvas = document.getElementById('graph'), ctx = canvas.getContext('2d');
  var styles = getComputedStyle(document.documentElement);
  var info = document.getElementById('info');
  var nodes = [], links = [], byId = {}, view = { x: 0, y: 0, k: 1 }, selected = null, query = '';

  document.getElementById('count').textContent = data.nodes.length + ' notas · ' + data.links.length + ' links';
  if (data.nodes.length === 0) document.getElementById('empty').style.display = 'flex';

  var legend = document.getElementById('legend');
  Object.keys(NAMES).forEach(function (key) {
    if (key !== 'tag' && !data.nodes.some(function (n) { return n.category === key; })) return;
    var item = document.createElement('span');
    var dot = document.createElement('i'); dot.style.background = COLORS[key];
    item.appendChild(dot); item.appendChild(document.createTextNode(NAMES[key]));
    legend.appendChild(item);
  });

  function build(withTags) {
    var old = byId; nodes = []; links = []; byId = {};
    data.nodes.forEach(function (n, i) {
      var prev = old[n.id], angle = i * 2.399;
      var node = { id: n.id, note: n, title: n.title, color: COLORS[n.category] || '#a0aec0', r: 6,
        x: prev ? prev.x : Math.cos(angle) * 40 * Math.sqrt(i + 1), y: prev ? prev.y : Math.sin(angle) * 40 * Math.sqrt(i + 1), vx: 0, vy: 0 };
      nodes.push(node); byId[n.id] = node;
    });
    data.links.forEach(function (l) { if (byId[l.source] && byId[l.target]) links.push({ s: byId[l.source], t: byId[l.target] }); });
    if (withTags) {
      data.nodes.forEach(function (n) {
        n.tags.forEach(function (tag) {
          var id = '#' + tag;
          if (!byId[id]) {
            var prev = old[id];
            byId[id] = { id: id, title: '#' + tag, color: COLORS.tag, r: 4, tag: true, x: prev ? prev.x : Math.random() * 200 - 100, y: prev ? prev.y : Math.random() * 200 - 100, vx: 0, vy: 0 };
            nodes.push(byId[id]);
          }
          links.push({ s: byId[n.id], t: byId[id], weak: true });
        });
      });
    }
    var degree = {};
    links.forEach(function (l) { degree[l.s.id] = (degree[l.s.id] || 0) + 1; degree[l.t.id] = (degree[l.t.id] || 0) + 1; });
    nodes.forEach(function (n) { if (!n.tag) n.r = 5 + Math.min(Math.sqrt(degree[n.id] || 0) * 2.5, 12); });
    heat = 1;
  }

  var heat = 1;
  function step() {
    if (heat < 0.002) return;
    var i, j, a, b, dx, dy, d2, f;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j]; dx = a.x - b.x; dy = a.y - b.y; d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 250000) continue;
        f = 400 / d2; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      a.vx -= a.x * 0.01; a.vy -= a.y * 0.01;
    }
    links.forEach(function (l) {
      dx = l.t.x - l.s.x; dy = l.t.y - l.s.y; var d = Math.sqrt(dx * dx + dy * dy) || 1;
      f = (d - (l.weak ? 50 : 60)) * (l.weak ? 0.01 : 0.03) / d;
      l.s.vx += dx * f; l.s.vy += dy * f; l.t.vx -= dx * f; l.t.vy -= dy * f;
    });
    nodes.forEach(function (n) {
      if (n === dragging) { n.vx = n.vy = 0; return; }
      n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx * heat; n.y += n.vy * heat;
    });
    heat *= 0.992;
  }

  function matches(n) {
    if (!query) return true;
    var text = (n.title + ' ' + (n.note ? n.note.tags.join(' ') + ' ' + n.note.category : '')).toLowerCase();
    return text.indexOf(query) >= 0;
  }

  function draw() {
    var w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + view.x, h / 2 + view.y); ctx.scale(view.k, view.k);
    var near = {};
    if (selected) { near[selected.id] = true; links.forEach(function (l) { if (l.s === selected) near[l.t.id] = true; if (l.t === selected) near[l.s.id] = true; }); }
    ctx.lineWidth = 1 / view.k;
    links.forEach(function (l) {
      var on = selected && (l.s === selected || l.t === selected);
      ctx.strokeStyle = on ? styles.getPropertyValue('--text') : styles.getPropertyValue('--edge');
      ctx.globalAlpha = selected && !on ? 0.25 : 1;
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
    });
    nodes.forEach(function (n) {
      var dim = (selected && !near[n.id]) || !matches(n);
      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(n.x, n.y, Math.max(n.r, 4 / view.k), 0, Math.PI * 2); ctx.fill();
      if (n === selected) { ctx.strokeStyle = styles.getPropertyValue('--text'); ctx.lineWidth = 2 / view.k; ctx.stroke(); }
      if (view.k > 0.7 || nodes.length <= 80 || n === selected || (query && matches(n))) {
        ctx.fillStyle = styles.getPropertyValue('--text'); ctx.font = (12 / view.k) + 'px system-ui';
        ctx.textAlign = 'center'; ctx.fillText(n.title.length > 32 ? n.title.slice(0, 31) + '…' : n.title, n.x, n.y + Math.max(n.r, 4 / view.k) + 14 / view.k);
      }
    });
    ctx.globalAlpha = 1;
  }

  // Until the user pans, zooms or drags, the view follows the layout so every note stays on screen.
  var autoFit = true;
  function fit() {
    if (!autoFit || nodes.length === 0) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) { minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r); minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r + 16); });
    var w = canvas.clientWidth, h = canvas.clientHeight, margin = 90;
    var k = Math.min((w - margin * 2) / Math.max(maxX - minX, 1), (h - margin * 2) / Math.max(maxY - minY, 1), 2);
    view.k = Math.max(k, 0.2);
    view.x = -((minX + maxX) / 2) * view.k;
    view.y = -((minY + maxY) / 2) * view.k + 30;
  }

  function loop() { step(); fit(); draw(); requestAnimationFrame(loop); }

  function toWorld(ev) {
    var rect = canvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left - rect.width / 2 - view.x) / view.k, y: (ev.clientY - rect.top - rect.height / 2 - view.y) / view.k };
  }
  function hit(p) {
    for (var i = nodes.length - 1; i >= 0; i--) { var n = nodes[i], dx = n.x - p.x, dy = n.y - p.y; if (dx * dx + dy * dy <= (n.r + 3) * (n.r + 3)) return n; }
    return null;
  }

  function show(n) {
    selected = n;
    info.textContent = '';
    if (!n) { info.style.display = 'none'; return; }
    info.style.display = 'block';
    var title = document.createElement('h2'); title.textContent = n.title; info.appendChild(title);
    var sub = document.createElement('div'); sub.className = 'sub';
    if (n.note) {
      sub.textContent = n.note.id + ' · atualizado ' + n.note.updated + (n.note.tags.length ? ' · #' + n.note.tags.join(' #') : '') + (n.note.projects.length ? ' · ' + n.note.projects.join(', ') : '');
      info.appendChild(sub);
      var pre = document.createElement('pre'); pre.textContent = n.note.excerpt; info.appendChild(pre);
    } else {
      var count = links.filter(function (l) { return l.t === n || l.s === n; }).length;
      sub.textContent = count + ' nota(s) com esta tag'; info.appendChild(sub);
    }
  }

  var dragging = null, panning = null, moved = false;
  canvas.addEventListener('mousedown', function (ev) {
    var p = toWorld(ev), n = hit(p); moved = false;
    autoFit = false;
    if (n) { dragging = n; heat = Math.max(heat, 0.3); } else panning = { x: ev.clientX - view.x, y: ev.clientY - view.y };
  });
  window.addEventListener('mousemove', function (ev) {
    if (dragging) { var p = toWorld(ev); dragging.x = p.x; dragging.y = p.y; moved = true; heat = Math.max(heat, 0.3); }
    else if (panning) { view.x = ev.clientX - panning.x; view.y = ev.clientY - panning.y; moved = true; }
  });
  window.addEventListener('mouseup', function (ev) {
    if (!moved) show(hit(toWorld(ev)));
    dragging = null; panning = null;
  });
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    autoFit = false;
    var factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1, k = Math.min(Math.max(view.k * factor, 0.2), 4);
    var rect = canvas.getBoundingClientRect(), mx = ev.clientX - rect.left - rect.width / 2, my = ev.clientY - rect.top - rect.height / 2;
    view.x = mx - ((mx - view.x) * k) / view.k; view.y = my - ((my - view.y) * k) / view.k; view.k = k;
  }, { passive: false });
  document.getElementById('search').addEventListener('input', function (ev) { query = ev.target.value.trim().toLowerCase(); });
  document.getElementById('tags').addEventListener('change', function (ev) { build(ev.target.checked); show(null); autoFit = true; });

  build(false);
  loop();
})();
</script>
</body>
</html>
`;
}
