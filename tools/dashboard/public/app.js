// Implement dashboard — page logic. Vanilla JS, talks to the local server's JSON API
// and refreshes on Server-Sent Events.
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { runs: [], selected: null, detail: null, tab: null, showReads: false, openAgents: new Set(), agentDetails: new Map(), collapsed: new Set(), round: null };

const DOC_TABS = [
  ['journal', 'Journal'], ['spec.md', 'Spec'], ['design.md', 'Design'], ['contracts.md', 'Contracts'], ['plan.md', 'Plan'],
  ['tests.md', 'Tests'], ['review.md', 'Review'], ['evidence.md', 'Evidence'], ['evidence', 'Screenshots'], ['pr.md', 'PR'], ['feedback.md', 'Feedback'], ['state.md', 'State'],
];

// ---- formatting -------------------------------------------------------------
function hhmm(ts) { if (!ts) return ''; const d = new Date(ts); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
function dayTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? hhmm(ts) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + hhmm(ts);
}
function duration(ms) {
  if (!ms || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return ms < 30000 ? '<1 min' : '1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}
function ago(ts) { return ts ? duration(Date.now() - ts) + ' ago' : ''; }
function tokens(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n); }
function statusWord(run) {
  if (run.status === 'active') return 'Running';
  if (run.status === 'done') return 'Delivered';
  return 'Paused';
}

// ---- data -------------------------------------------------------------------
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }

async function loadRuns() {
  const data = await getJSON('/api/runs');
  state.runs = data.runs;
  $('#roots').textContent = 'Watching ' + data.roots.join(', ');
  renderRuns();
  if (!state.selected && state.runs.length) select(state.runs[0].id);
}

async function loadDetail() {
  if (!state.selected) return;
  const d = await getJSON(`/api/runs/${state.selected}`);
  if (d.id !== state.selected) return;
  state.detail = d;
  renderRun();
}

function select(id) {
  if (state.selected === id) return;
  state.selected = id; state.detail = null; state.tab = null; state.openAgents.clear(); state.agentDetails.clear(); state.collapsed.clear(); state.round = null;
  history.replaceState(null, '', '#' + id);
  renderRuns();
  loadDetail();
}

// ---- sidebar ----------------------------------------------------------------
function renderRuns() {
  const nav = $('#runs');
  const groups = new Map();
  for (const r of state.runs) { if (!groups.has(r.project)) groups.set(r.project, []); groups.get(r.project).push(r); }
  let html = '';
  for (const [project, list] of groups) {
    html += `<div class="group">${esc(project)}</div>`;
    for (const r of list) {
      const phase = r.status === 'done' ? 'done' : r.current ? `${r.activeRound ? 'R' + r.activeRound + ' ' : ''}${r.current.n}/11` : '';
      html += `<a href="#${r.id}" data-id="${r.id}" class="${r.id === state.selected ? 'selected' : ''}">
        <span class="dot ${r.status}"></span><span class="name">${esc(r.slug)}</span><span class="phase">${phase}</span></a>`;
    }
  }
  nav.innerHTML = html || '<div class="group">No runs found</div>';
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); select(a.dataset.id); }));
}

// ---- run view ---------------------------------------------------------------
function ensureRunDom() {
  const sec = $('#run');
  if (!sec.dataset.built) {
    sec.innerHTML = '';
    sec.appendChild($('#tpl-run').content.cloneNode(true));
    sec.dataset.built = '1';
    $('[data-f="showReads"]', sec).addEventListener('change', e => { state.showReads = e.target.checked; renderFiles(); });
  }
  $('#empty').hidden = true;
  sec.hidden = false;
  return sec;
}

function renderRun() {
  const d = state.detail;
  if (!d) return;
  const sec = ensureRunDom();
  const f = (name) => $(`[data-f="${name}"]`, sec);
  f('project').textContent = d.project;
  f('slug').textContent = d.slug;
  f('status').innerHTML = `<span class="status ${d.status}">${d.merged ? 'Merged' : statusWord(d)}</span>`;
  f('size').textContent = d.facts.size || '–';
  f('branch').textContent = d.facts.branch || (d.merged && d.merged.branch) || '–';
  f('started').textContent = dayTime(d.startedAt);
  f('updated').textContent = ago(d.updatedAt);

  renderRounds();
  const round = selectedRound();
  const phases = round && round.kind === 'feedback' ? round.phases : d.phases;
  const agentsInRound = round ? d.agents.filter(a => round.agentIds.includes(a.agentId)) : d.agents;

  // phase track
  f('track').innerHTML = phases.map(p => {
    // Under the station: how long the phase took, or has been running. The tooltip carries the clock times.
    let when = '', fromClock = true;
    if (p.clockStart && (p.status === 'done' || p.status === 'in-progress')) {
      when = duration((p.clockEnd || Date.now()) - p.clockStart);
    } else if (p.status === 'done' && p.started && p.ended) {
      const a = Date.parse(p.started.replace(' ', 'T')), b = Date.parse(p.ended.replace(' ', 'T'));
      if (a && b && b >= a) { when = duration(b - a); fromClock = false; }
    }
    const tipParts = [];
    if (p.note) tipParts.push(p.note);
    if (p.clockStart) tipParts.push(`Started ${dayTime(p.clockStart)}${p.clockEnd ? ', ended ' + dayTime(p.clockEnd) : ', still running'}`);
    else if (when && !fromClock) tipParts.push('Duration as written in state.md; no transcript found for this phase');
    const tip = tipParts.length ? ` title="${esc(tipParts.join('\n'))}"` : '';
    return `<li class="${p.status}"${tip}><span class="station">${p.status === 'done' ? '' : p.n}</span><span class="label">${esc(p.title)}</span><span class="when ${fromClock ? '' : 'unverified'}">${esc(when)}</span></li>`;
  }).join('');

  const running = agentsInRound.filter(a => a.state === 'running');
  const current = round && round.kind === 'feedback' ? round.current : d.current;
  let now = '';
  if (round && round.kind === 'feedback' && round.closed) {
    const done = round.phases.filter(p => p.status === 'done').map(p => p.n);
    now = `<strong>Round ${round.n} done.</strong> ${round.mergedAt ? `Merged into ${esc(d.merged.into)} on ${dayTime(round.mergedAt)}.` : done.length > 1 ? `Phases ${done.join(', ')} ran again.` : done.length ? `Phase ${done[0]} ran again.` : 'No activity recorded for this round.'}`;
  }
  else if (round && round.kind === 'feedback' && !current) now = `<strong>Round ${round.n}.</strong> Feedback recorded${round.items.length ? `: ${round.items.map(i => esc(i.id)).join(', ')}` : ''}; no phase has started yet.`;
  else if (round && round.kind === 'delivery' && d.rounds.length > 1) now = `<strong>Delivered.</strong> ${d.merged ? `${esc(d.merged.branch)} was merged into ${esc(d.merged.into)}. ` : ''}Later rounds are in the tabs above.`;
  else if (d.merged) now = `<strong>Delivered.</strong> ${esc(d.merged.branch)} was merged into ${esc(d.merged.into)}${d.merged.at ? ' on ' + dayTime(d.merged.at) : ''}.${d.hasTable ? '' : ' The state file has no phase table; the phases are taken from git.'}`;
  else if (d.status === 'done') now = `<strong>Delivered.</strong> ${d.phases.filter(p => p.status === 'done').length} phases done, ${d.phases.filter(p => p.status === 'skipped').length} skipped.`;
  else if (current) {
    const cur = phases[current.n];
    const start = cur.clockStart || (cur.startedAt ? Date.parse(cur.startedAt) : (running[0] ? running[0].startedAt : null));
    const busy = phases.filter(p => p.status === 'in-progress');
    const prefix = round && round.kind === 'feedback' ? `Round ${round.n}, ` : '';
    now = busy.length > 1
      ? `<strong>${prefix}phases ${busy.map(p => p.n).join(' and ')}, ${busy.map(p => esc(p.title.toLowerCase())).join(' and ')}</strong>`
      : `<strong>${prefix}phase ${current.n}, ${esc(current.title)}</strong>`;
    if (running.length) now += ` — ${running.length === 1 ? esc(running[0].description || running[0].briefHead.slice(0, 80) || 'one agent') + ' is working' : running.length + ' agents working'}`;
    else if (d.status === 'active') now += ' — orchestrator working';
    else now += ' — waiting';
    if (start) now += ` <span class="elapsed">${duration(Date.now() - start)}</span>`;
  }
  f('now').innerHTML = now;
  const peek = d.orchestrator.progress.filter(p => inWindow(round, p.ts)).slice(-3);
  f('peek').innerHTML = peek.map(p => `<li><time>${hhmm(p.ts)}</time><span>${esc(p.line)}</span></li>`).join('');

  renderAgents();
  renderFiles();
  renderTabs();
}

function selectedRound() {
  const d = state.detail;
  const rounds = d.rounds || [];
  if (!rounds.length) return null;
  if (state.round == null || !rounds.some(r => r.n === state.round)) state.round = rounds[rounds.length - 1].n;
  return rounds.find(r => r.n === state.round);
}
function inWindow(r, ts) { return !r || (ts >= r.at - 60000 && (r.until == null || ts < r.until)); }
function roundLabel(r) {
  if (r.kind === 'delivery') return 'Delivery';
  const counts = {};
  for (const i of r.items) counts[i.classification] = (counts[i.classification] || 0) + 1;
  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}${v > 1 && k === 'defect' ? 's' : ''}`);
  return parts.length ? parts.join(', ') : 'feedback';
}

function renderRounds() {
  const d = state.detail;
  const sec = $('#run');
  const el = $('[data-f="rounds"]', sec);
  const rounds = d.rounds || [];
  if (rounds.length < 2) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const sel = selectedRound();
  el.innerHTML = rounds.map(r => {
    const stateWord = r.running || (!r.closed && r.kind === 'feedback') ? 'running' : r.closed ? 'done' : '';
    return `<button role="tab" aria-selected="${sel && sel.n === r.n}" data-round="${r.n}" class="${stateWord}">
      <span class="rn">Round ${r.n}</span><span class="rl">${esc(roundLabel(r))}</span><span class="rt">${dayTime(r.at)}</span></button>`;
  }).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.round = Number(b.dataset.round); renderRun(); }));
}

function agentName(a) { return a.description || a.briefHead.replace(/^you are (an? )?/i, '').slice(0, 70) || a.agentId; }

function renderAgents() {
  const d = state.detail;
  const sec = $('#run');
  const round = selectedRound();
  const agents = round ? d.agents.filter(a => round.agentIds.includes(a.agentId)) : d.agents;
  $('[data-f="agentCount"]', sec).textContent = agents.length ? `${agents.filter(a => a.state === 'running').length} running of ${agents.length}` : '';
  const ol = $('[data-f="agents"]', sec);
  if (!agents.length) { ol.innerHTML = `<li class="muted">${round && round.kind === 'feedback' ? 'No agents have run in this round yet.' : 'No agents have run for this yet. Agents appear here from the transcripts Claude Code keeps.'}</li>`; return; }
  ol.innerHTML = agents.map(a => {
    const dur = duration((a.state === 'running' ? Date.now() : a.lastAt) - a.startedAt);
    const open = state.openAgents.has(a.agentId);
    const stateWord = a.state === 'running' ? 'running' : a.state === 'stale' ? 'no activity' : 'done';
    return `<li data-agent="${a.agentId}">
      <div class="agent-row" role="button" tabindex="0" aria-expanded="${open}">
        <span class="dot ${a.state}"></span>
        <span class="who">${esc(agentName(a))}${a.phase != null ? `<span class="chip">phase ${a.phase}</span>` : ''}</span>
        <span class="meta"><span>${stateWord}</span><span>${dur}</span><span>${tokens(a.usage.output)} out</span><span>${esc((a.model || '').replace(/^claude-/, ''))}</span></span>
        ${a.state === 'running' && a.lastText ? `<p class="agent-last">${esc(a.lastText.text.trim().slice(-300))}</p>` : a.state === 'running' && a.lastTool ? `<p class="agent-last">${esc(a.lastTool.name)} ${esc(a.lastTool.detail)}</p>` : ''}
        ${open ? `<div class="agent-detail" data-detail="${a.agentId}">${renderAgentDetail(a.agentId)}</div>` : ''}
      </div></li>`;
  }).join('');
  ol.querySelectorAll('.agent-row').forEach(row => {
    const id = row.closest('li').dataset.agent;
    const toggle = () => { state.openAgents.has(id) ? state.openAgents.delete(id) : state.openAgents.add(id); if (state.openAgents.has(id)) fetchAgent(id); renderAgents(); };
    row.addEventListener('click', e => { if (e.target.closest('a, pre, .agent-detail')) return; toggle(); });
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

async function fetchAgent(id) {
  try {
    const a = await getJSON(`/api/agents/${id}`);
    state.agentDetails.set(id, a);
    const el = document.querySelector(`[data-detail="${id}"]`);
    if (el) el.innerHTML = renderAgentDetail(id);
  } catch { /* leave the summary */ }
}

function renderAgentDetail(id) {
  const a = state.agentDetails.get(id);
  if (!a) return '<p class="muted">Loading…</p>';
  const texts = a.texts.slice(-3);
  const writes = a.files.filter(f => f.writes);
  return `
    <h4>Brief</h4><pre>${esc(a.brief.slice(0, 1500))}${a.brief.length > 1500 ? '\n…' : ''}</pre>
    ${texts.length ? `<h4>Latest output</h4><pre>${texts.map(t => `[${hhmm(t.ts)}]\n${esc(t.text.trim())}`).join('\n\n')}</pre>` : ''}
    ${writes.length ? `<h4>Wrote</h4><ol>${writes.map(f => `<li><span>${hhmm(f.last)}</span><span>${f.writes}×</span><b>${esc(f.path)}</b></li>`).join('')}</ol>` : ''}
    <h4>Last tool calls</h4><ol>${a.tools.slice(-25).map(t => `<li><span>${hhmm(t.ts)}</span><b>${esc(t.name)}</b><span>${esc(t.detail)}</span></li>`).join('')}</ol>
    <h4>Tokens</h4><p class="muted">${tokens(a.usage.output)} output, ${tokens(a.usage.input + a.usage.cacheCreate)} fresh input, ${tokens(a.usage.cacheRead)} cached, ${a.turns} turns</p>`;
}

function renderFiles() {
  const d = state.detail;
  const sec = $('#run');
  const round = selectedRound();
  const list = d.touched
    .map(f => {
      const by = f.by.filter(b => inWindow(round, b.last));
      return { ...f, by, writes: by.reduce((n, b) => n + b.writes, 0), reads: by.reduce((n, b) => n + b.reads, 0), last: Math.max(0, ...by.map(b => b.last)) };
    })
    .filter(f => f.by.length && (state.showReads || f.writes > 0));
  $('[data-f="fileCount"]', sec).textContent = list.length ? String(list.length) : '';
  const ol = $('[data-f="files"]', sec);
  if (!list.length) { ol.innerHTML = '<li class="muted">No edits recorded. Only writes made with the Edit and Write tools show up here; a shell heredoc does not.</li>'; return; }
  const root = { dirs: new Map(), files: [] };
  for (const f of list) {
    const rel = f.rel.startsWith('/') ? '…/' + f.rel.split('/').slice(-3).join('/') : f.rel;
    const parts = rel.split('/');
    let node = root;
    for (const seg of parts.slice(0, -1)) {
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push({ ...f, name: parts[parts.length - 1] });
  }
  ol.innerHTML = renderTree(root, '');
  ol.querySelectorAll('.dir-row').forEach(row => {
    const key = row.dataset.dir;
    const toggle = () => { state.collapsed.has(key) ? state.collapsed.delete(key) : state.collapsed.add(key); renderFiles(); };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

/** Directories with a single child directory and no files are joined into one node, the way an IDE compacts packages. */
function renderTree(node, prefix) {
  let html = '';
  const rank = (n) => n.startsWith('…') ? 2 : n.startsWith('.') ? 1 : 0; // project code first, then the run's own state directory, then files outside the project
  const dirs = [...node.dirs.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  for (let [name, child] of dirs) {
    let label = name;
    while (child.files.length === 0 && child.dirs.size === 1) {
      const [n, c] = [...child.dirs.entries()][0];
      label += '/' + n; child = c;
    }
    const key = prefix + label + '/';
    const count = countFiles(child);
    const last = latest(child);
    const open = !state.collapsed.has(key);
    html += `<li class="dir"><div class="dir-row" role="button" tabindex="0" aria-expanded="${open}" data-dir="${esc(key)}">
      <span class="chev"></span><span class="path">${esc(label)}/</span><span class="n">${count} file${count === 1 ? '' : 's'} · ${hhmm(last)}</span></div>
      ${open ? `<ul>${renderTree(child, key)}</ul>` : ''}</li>`;
  }
  const files = node.files.sort((a, b) => a.name.localeCompare(b.name));
  for (const f of files) {
    const by = f.by.filter(b => state.showReads || b.writes).map(b => `<span class="${b.writes ? 'w' : ''}">${esc(b.who)}${b.phase != null ? ` (phase ${b.phase})` : ''}${b.writes ? '' : ', read'}</span>`).join(' · ');
    html += `<li class="file" title="${esc(f.path)}"><span class="path ${f.inState ? 'state' : ''}">${esc(f.name)}</span><span class="n">${f.writes ? f.writes + ' write' + (f.writes > 1 ? 's' : '') : f.reads + ' reads'} · ${hhmm(f.last)}</span><span class="by">${by}</span></li>`;
  }
  return html;
}
function countFiles(node) { let n = node.files.length; for (const c of node.dirs.values()) n += countFiles(c); return n; }
function latest(node) { let t = node.files.reduce((m, f) => Math.max(m, f.last), 0); for (const c of node.dirs.values()) t = Math.max(t, latest(c)); return t; }

// ---- documents --------------------------------------------------------------
function renderTabs() {
  const d = state.detail;
  const sec = $('#run');
  const available = new Set(d.docs);
  const hasEvidence = d.evidence.some(e => /\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(e.path));
  if (!state.tab) state.tab = available.has('spec.md') && d.status !== 'active' ? 'spec.md' : 'journal';
  $('[data-f="tabs"]', sec).innerHTML = DOC_TABS.map(([key, label]) => {
    const enabled = key === 'journal' || (key === 'evidence' ? hasEvidence : available.has(key));
    return `<button role="tab" data-tab="${key}" aria-selected="${state.tab === key}" ${enabled ? '' : 'disabled'}>${label}</button>`;
  }).join('');
  $('[data-f="tabs"]', sec).querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderTabs(); }));
  renderDoc();
}

async function renderDoc() {
  const d = state.detail;
  const art = $('[data-f="doc"]', $('#run'));
  const tab = state.tab;
  if (tab === 'journal') {
    const lines = d.orchestrator.progress.filter(p => inWindow(selectedRound(), p.ts));
    art.innerHTML = lines.length
      ? `<ol class="journal">${lines.map(p => `<li><time>${hhmm(p.ts)}</time><span>${esc(p.line)}</span></li>`).join('')}</ol>`
      : '<p class="muted">No progress lines yet. The orchestrator writes one at every phase change and whenever an agent starts or finishes.</p>';
    return;
  }
  if (tab === 'evidence') {
    const media = d.evidence.filter(e => /\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(e.path)).sort((a, b) => a.path.localeCompare(b.path));
    art.innerHTML = `<div class="gallery">${media.map(e => {
      const src = `/api/runs/${d.id}/file/${encodeURI(e.path)}`;
      const isVideo = /\.(mp4|webm)$/i.test(e.path);
      return `<figure>${isVideo ? `<video src="${src}" controls></video>` : `<a href="${src}" target="_blank"><img src="${src}" alt="${esc(e.path)}" loading="lazy"></a>`}<figcaption>${esc(e.path)}</figcaption></figure>`;
    }).join('')}</div>`;
    return;
  }
  let doc;
  try { doc = await getJSON(`/api/runs/${d.id}/doc?name=${encodeURIComponent(tab)}`); } catch { art.innerHTML = '<p class="muted">Not written yet.</p>'; return; }
  if (state.tab !== tab || state.detail !== d) return;
  const html = window.marked ? marked.parse(doc.content, { gfm: true, breaks: false }) : `<pre>${esc(doc.content)}</pre>`;
  art.innerHTML = `<p class="doc-meta">${tab}, last written ${dayTime(doc.mtime)}</p>${html}`;
  const base = `/api/runs/${d.id}/file/`;
  art.querySelectorAll('img, video, a').forEach(el => {
    const attr = el.tagName === 'A' ? 'href' : 'src';
    const v = el.getAttribute(attr) || '';
    if (v && !/^([a-z]+:|\/|#)/i.test(v)) el.setAttribute(attr, base + encodeURI(v.replace(/^\.\//, '')));
    if (el.tagName === 'A') el.target = '_blank';
  });
}

// ---- live updates -----------------------------------------------------------
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await loadRuns();
    await loadDetail();
    for (const id of state.openAgents) fetchAgent(id);
  }, 400);
}

function connect() {
  const es = new EventSource('/events');
  const dot = $('#live');
  es.addEventListener('hello', () => { dot.className = 'live-dot on'; dot.title = 'Connected'; });
  es.addEventListener('change', () => scheduleRefresh());
  es.onerror = () => { dot.className = 'live-dot off'; dot.title = 'Reconnecting…'; };
}

// Elapsed times tick without a server round trip.
setInterval(() => { if (state.detail && state.detail.status === 'active') renderRun(); }, 30000);

(async function init() {
  const hash = location.hash.slice(1);
  if (hash) state.selected = hash;
  connect();
  await loadRuns();
  if (state.selected) { renderRuns(); await loadDetail(); }
})();
