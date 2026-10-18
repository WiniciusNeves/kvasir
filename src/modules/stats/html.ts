import type { StatsData } from './data';

// Self-contained page: no CDN (works offline and nothing leaves the machine), charts drawn as SVG
// by a small script from the embedded JSON. Text from the data is inserted with textContent only.
// The client script avoids backticks and "${" so it can live inside this template literal.

export interface StatsHtmlOptions {
  // seconds; set by `kvasir stats --watch` / `kvasir board` to follow the agents live
  refreshSeconds?: number;
  // open scrolled to the Agent Board (kvasir board)
  focusBoard?: boolean;
}

function embed(data: unknown): string {
  // < and the JS line separators U+2028/U+2029 must not appear raw inside a <script> block
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (char) => '\\u' + char.charCodeAt(0).toString(16));
}

export function renderStatsHtml(data: StatsData, options: StatsHtmlOptions = {}): string {
  const refresh = options.refreshSeconds ? `<meta http-equiv="refresh" content="${options.refreshSeconds}">` : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}
<title>Kvasir Stats</title>
<style>
:root {
  --bg: #0f1115; --panel: #171a21; --panel-2: #1e222b; --border: #2a2f3a; --text: #e6e8ee; --muted: #9aa3b2;
  --accent: #7c9cff; --accent-2: #4fd1c5; --ok: #48bb78; --fail: #f56565; --warn: #ecc94b;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #f6f7fb; --panel: #ffffff; --panel-2: #f0f2f7; --border: #dfe3ec; --text: #1a1f2b; --muted: #5d6677;
    --accent: #3b5bdb; --accent-2: #0f9d8f; --ok: #2f9e44; --fail: #e03131; --warn: #b08900; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 20px 24px 8px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; }
header h1 { margin: 0; font-size: 22px; }
header .meta { color: var(--muted); font-size: 13px; }
nav { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--border); padding: 8px 24px; display: flex; gap: 6px; flex-wrap: wrap; }
nav a { color: var(--muted); text-decoration: none; padding: 6px 10px; border-radius: 8px; }
nav a:hover { background: var(--panel-2); color: var(--text); }
main { padding: 16px 24px 48px; max-width: 1400px; margin: 0 auto; }
section { margin: 0 0 32px; scroll-margin-top: 56px; }
h2 { font-size: 17px; margin: 0 0 12px; }
.grid { display: grid; gap: 12px; }
.cards { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.card, .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.card .value { font-size: 24px; font-weight: 650; }
.card .label { color: var(--muted); font-size: 12px; }
.two { grid-template-columns: minmax(280px, 1fr) minmax(320px, 2fr); }
@media (max-width: 820px) { .two { grid-template-columns: 1fr; } main, header, nav { padding-left: 16px; padding-right: 16px; } }
svg text { fill: var(--muted); font-size: 11px; }
.legend { display: flex; gap: 14px; color: var(--muted); font-size: 12px; margin-top: 6px; flex-wrap: wrap; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.agent { margin-bottom: 16px; }
.agent-head { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: baseline; margin-bottom: 10px; }
.agent-head strong { font-size: 15px; }
.agent-head span { color: var(--muted); font-size: 12px; }
.kanban { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 820px) { .kanban { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.column { background: var(--panel-2); border-radius: 10px; padding: 8px; min-height: 60px; }
.column h3 { margin: 0 0 6px; font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.job { background: var(--panel); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; font-size: 12px; overflow-wrap: anywhere; }
.job.running { border-left-color: var(--warn); }
.job.done { border-left-color: var(--ok); }
.job.failed { border-left-color: var(--fail); }
.job .sub { color: var(--muted); }
.empty { color: var(--muted); font-size: 12px; padding: 4px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--muted); font-weight: 600; }
ul { margin: 0; padding-left: 18px; }
.muted { color: var(--muted); }
</style>
</head>
<body>
<header><h1>Kvasir · Stats</h1><span class="meta" id="meta"></span></header>
<nav><a href="#geral">Visão geral</a><a href="#board">Agent Board</a><a href="#modelos">Modelos</a><a href="#aprendeu">O que aprendeu</a></nav>
<main>
  <section id="geral">
    <h2>Visão geral</h2>
    <div class="grid cards" id="cards"></div>
    <div class="grid two" style="margin-top:12px">
      <div class="panel"><h2>Onde você usa o Kvasir</h2><div id="radar"></div>
        <div class="legend"><span><i style="background:var(--accent)"></i>últimos 7 dias</span><span><i style="background:var(--accent-2)"></i>média semanal (30 dias)</span></div></div>
      <div class="panel"><h2>Chamadas por dia</h2><div id="daily"></div>
        <div class="legend"><span><i style="background:var(--ok)"></i>ok</span><span><i style="background:var(--fail)"></i>falhou (o próximo modelo assumiu)</span></div></div>
    </div>
  </section>
  <section id="board">
    <h2>Agent Board</h2>
    <p class="muted" style="margin-top:-6px">Cada tarefa tem um único dono. "A fazer" e "em andamento" são ao vivo; "feito" e "falhou" mostram os últimos 7 dias.</p>
    <div id="agents"></div>
  </section>
  <section id="modelos">
    <h2>Modelos por tarefa</h2>
    <div class="panel table-wrap"><table id="models"></table></div>
  </section>
  <section id="aprendeu">
    <h2>O que aprendeu</h2>
    <div class="grid two"><div class="panel" id="notes"></div><div class="panel" id="prefs"></div></div>
  </section>
</main>
<script id="kvasir-data" type="application/json">${embed(data)}</script>
${options.focusBoard ? '<script>window.addEventListener("load", function () { document.getElementById("board").scrollIntoView(); });</script>' : ''}
<script>
(function () {
  var data = JSON.parse(document.getElementById('kvasir-data').textContent);
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) for (var key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function svg(tag, attrs, text) {
    var node = document.createElementNS(NS, tag);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function pct(a, r) { var t = a + r; return t === 0 ? '—' : Math.round((a / t) * 100) + '% (' + a + '/' + t + ')'; }
  function secs(v) { return v === null || v === undefined ? '—' : v.toFixed(1) + 's'; }
  function fmt(n) { return Number(n).toLocaleString('pt-BR'); }
  function ago(iso) {
    var m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.round(m / 60);
    return h < 24 ? 'há ' + h + ' h' : 'há ' + Math.round(h / 24) + ' d';
  }

  document.getElementById('meta').textContent =
    'últimos ' + data.days + ' dias · gerado ' + new Date(data.generatedAt).toLocaleString('pt-BR');

  var c = data.cards;
  var cards = [
    ['Chamadas de IA', fmt(c.calls), c.failures + ' falharam e foram para o próximo modelo'],
    ['Aprovação', pct(c.approved, c.rejected), 'o que você aceitou do que a IA sugeriu'],
    ['Tempo médio', secs(c.avgSeconds), 'por resposta'],
    ['Tokens gerados', fmt(c.outputTokens), 'pelos modelos executores'],
    ['Na nuvem', c.calls ? Math.round((c.cloudCalls / Math.max(c.calls - c.failures, 1)) * 100) + '%' : '—', fmt(c.cloudCalls) + ' respostas do Gemini/Groq'],
    ['Claude (clipboard)', fmt(c.claudeRoundTrips), '~' + fmt(c.claudeTokens) + ' tokens enviados']
  ];
  var cardBox = document.getElementById('cards');
  cards.forEach(function (item) {
    var card = el('div', { 'class': 'card' });
    card.appendChild(el('div', { 'class': 'label' }, item[0]));
    card.appendChild(el('div', { 'class': 'value' }, item[1]));
    card.appendChild(el('div', { 'class': 'label' }, item[2]));
    cardBox.appendChild(card);
  });

  (function radar() {
    var size = 300, cx = 150, cy = 150, r = 105, axes = data.radar.axes, n = axes.length;
    var max = Math.max.apply(null, data.radar.week.concat(data.radar.monthWeeklyAvg).concat([1]));
    var root = svg('svg', { viewBox: '0 0 ' + size + ' ' + size, width: '100%', style: 'max-width:340px;display:block;margin:auto' });
    function point(i, value) {
      var angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(angle) * r * value, cy + Math.sin(angle) * r * value];
    }
    [0.25, 0.5, 0.75, 1].forEach(function (level) {
      var pts = axes.map(function (_, i) { return point(i, level).join(','); }).join(' ');
      root.appendChild(svg('polygon', { points: pts, fill: 'none', stroke: 'var(--border)' }));
    });
    axes.forEach(function (axis, i) {
      var end = point(i, 1), label = point(i, 1.18);
      root.appendChild(svg('line', { x1: cx, y1: cy, x2: end[0], y2: end[1], stroke: 'var(--border)' }));
      root.appendChild(svg('text', { x: label[0], y: label[1] + 4, 'text-anchor': 'middle' }, axis));
    });
    [[data.radar.monthWeeklyAvg, 'var(--accent-2)'], [data.radar.week, 'var(--accent)']].forEach(function (serie) {
      var pts = serie[0].map(function (v, i) { return point(i, v / max).join(','); }).join(' ');
      root.appendChild(svg('polygon', { points: pts, fill: serie[1], 'fill-opacity': '0.22', stroke: serie[1], 'stroke-width': '2' }));
    });
    document.getElementById('radar').appendChild(root);
  })();

  (function daily() {
    var bars = data.daily, w = 720, h = 220, pad = 28, bw = (w - pad * 2) / bars.length;
    var max = Math.max.apply(null, bars.map(function (b) { return b.ok + b.failed; }).concat([1]));
    var root = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%' });
    [0, 0.5, 1].forEach(function (level) {
      var y = h - pad - (h - pad * 2) * level;
      root.appendChild(svg('line', { x1: pad, x2: w - pad, y1: y, y2: y, stroke: 'var(--border)' }));
      root.appendChild(svg('text', { x: 4, y: y + 4 }, Math.round(max * level)));
    });
    bars.forEach(function (b, i) {
      var x = pad + i * bw + 2, okH = ((h - pad * 2) * b.ok) / max, failH = ((h - pad * 2) * b.failed) / max;
      var base = h - pad;
      var title = b.date + ': ' + b.ok + ' ok, ' + b.failed + ' falha(s)';
      var okRect = svg('rect', { x: x, y: base - okH, width: Math.max(bw - 4, 1), height: okH, rx: 2, fill: 'var(--ok)' });
      okRect.appendChild(svg('title', {}, title));
      root.appendChild(okRect);
      var failRect = svg('rect', { x: x, y: base - okH - failH, width: Math.max(bw - 4, 1), height: failH, rx: 2, fill: 'var(--fail)' });
      failRect.appendChild(svg('title', {}, title));
      root.appendChild(failRect);
      if (i % 5 === 0 || i === bars.length - 1) root.appendChild(svg('text', { x: x + bw / 2, y: h - 8, 'text-anchor': 'middle' }, b.date.slice(5)));
    });
    document.getElementById('daily').appendChild(root);
  })();

  var agentsBox = document.getElementById('agents');
  data.agents.forEach(function (agent) {
    var box = el('div', { 'class': 'panel agent' });
    var head = el('div', { 'class': 'agent-head' });
    head.appendChild(el('strong', null, agent.label));
    head.appendChild(el('span', null, agent.role + ' · tarefas: ' + agent.tasks.join(', ')));
    head.appendChild(el('span', null, agent.calls + ' chamada(s) · aprovação ' + pct(agent.approved, agent.rejected) + ' · ' + secs(agent.avgSeconds) + ' · ' + fmt(agent.outputTokens) + ' tokens'));
    if (agent.mostUsed) head.appendChild(el('span', null, 'mais usado: ' + agent.mostUsed));
    if (agent.bestModel) head.appendChild(el('span', null, 'rendeu melhor: ' + agent.bestModel));
    box.appendChild(head);
    var kanban = el('div', { 'class': 'kanban' });
    [['A fazer', 'queued', ''], ['Em andamento', 'running', 'running'], ['Feito', 'done', 'done'], ['Falhou', 'failed', 'failed']].forEach(function (col) {
      var column = el('div', { 'class': 'column' });
      var items = agent.board[col[1]];
      column.appendChild(el('h3', null, col[0] + ' (' + items.length + ')'));
      if (items.length === 0) column.appendChild(el('div', { 'class': 'empty' }, '—'));
      items.forEach(function (job) {
        var card = el('div', { 'class': 'job ' + col[2] });
        card.appendChild(el('div', null, job.title));
        var sub = job.model + ' · ' + ago(job.when) + (job.detail ? ' · ' + job.detail : '');
        card.appendChild(el('div', { 'class': 'sub' }, sub));
        column.appendChild(card);
      });
      kanban.appendChild(column);
    });
    box.appendChild(kanban);
    agentsBox.appendChild(box);
  });

  var table = document.getElementById('models');
  var header = el('tr');
  ['tarefa', 'modelo', 'chamadas', 'falhas', 'tempo médio', 'tokens de saída', 'aprovação'].forEach(function (name) { header.appendChild(el('th', null, name)); });
  table.appendChild(header);
  if (data.models.length === 0) {
    var row = el('tr'); var cell = el('td', { colspan: '7', 'class': 'muted' }, 'Nenhuma chamada registrada ainda.'); row.appendChild(cell); table.appendChild(row);
  }
  data.models.forEach(function (m) {
    var row = el('tr');
    [m.task, m.provider === 'ollama' ? m.model : m.provider + '/' + m.model, m.calls, m.failures, secs(m.avgSeconds), m.avgOutputTokens === null ? '—' : Math.round(m.avgOutputTokens), pct(m.approved, m.rejected)]
      .forEach(function (value) { row.appendChild(el('td', null, value)); });
    table.appendChild(row);
  });

  var notes = document.getElementById('notes');
  notes.appendChild(el('h2', null, 'Base de conhecimento (' + data.learned.totalNotes + ' notas)'));
  var list = el('ul');
  Object.keys(data.learned.notesByCategory).forEach(function (category) {
    list.appendChild(el('li', null, category + ': ' + data.learned.notesByCategory[category]));
  });
  notes.appendChild(list);
  if (data.learned.recentErrors.length) {
    notes.appendChild(el('h2', { style: 'margin-top:14px' }, 'Erros resolvidos recentes'));
    var errors = el('ul');
    data.learned.recentErrors.forEach(function (title) { errors.appendChild(el('li', null, title)); });
    notes.appendChild(errors);
  }

  var prefs = document.getElementById('prefs');
  prefs.appendChild(el('h2', null, 'Preferências aprendidas (profile.md)'));
  if (data.learned.preferences.length === 0) prefs.appendChild(el('p', { 'class': 'muted' }, 'Ainda nada: use commit, fix e review e rode "kvasir learn".'));
  else {
    var ul = el('ul');
    data.learned.preferences.forEach(function (line) { ul.appendChild(el('li', null, line)); });
    prefs.appendChild(ul);
  }
})();
</script>
</body>
</html>
`;
}
