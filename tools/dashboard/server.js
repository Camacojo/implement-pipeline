#!/usr/bin/env node
// Implement pipeline dashboard: a local web page that follows every run in
// <project>/.claude/implement/<slug>/ and the agents working on it.
//
//   node tools/dashboard/server.js [--port 4680] [--roots ~/Projects,~/Work] [--days 14]
//
// No dependencies. Reads the state directories and Claude Code's transcripts, pushes
// changes to the browser over Server-Sent Events.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { discoverRuns, readRun, decodeRunId, stateSignature, DOCUMENTS } from './lib/runs.js';
import { TranscriptIndex } from './lib/transcripts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const PORT = Number(flag('port', process.env.PORT || 4680));
const ROOTS = flag('roots', process.env.IMPLEMENT_ROOTS || path.join(os.homedir(), 'PhpstormProjects'))
  .split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/^~/, os.homedir()));
const DAYS = Number(flag('days', 14));

const index = new TranscriptIndex({ days: DAYS });
let runs = [];               // discovered {root, slug, stateDir}
let runsAt = 0;
const signatures = new Map(); // run id -> signature
const clients = new Set();

async function ensureRuns(force = false) {
  if (force || Date.now() - runsAt > 30000) {
    runs = await discoverRuns(ROOTS);
    runsAt = Date.now();
  }
  return runs;
}

function findRun(id) {
  const { root, slug } = decodeRunId(id);
  return runs.find(r => r.root === root && r.slug === slug) || null;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.patch': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };

async function sendFile(res, file) {
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch { json(res, 404, { error: 'not found' }); }
}

const PHASE_IN_LINE = /(?:phase|fase)\s*(\d{1,2})(?:\s*(?:[–—-]|→|->)\s*(\d{1,2}))?/i;

/** Real clock times per phase, from the transcripts: the first progress line that names a phase starts it,
 *  a ✔ line or the first line of a later phase ends it; agents widen the window. The state table's own
 *  times are hand-written by the orchestrator and unreliable, so these win when present. */
function clockTimes(run, agents, progress) {
  const start = new Map(), end = new Map();
  const lower = (m, k, v) => { if (v && (!m.has(k) || v < m.get(k))) m.set(k, v); };
  const raise = (m, k, v) => { if (v && (!m.has(k) || v > m.get(k))) m.set(k, v); };
  for (const p of progress) {
    const m = p.line.match(PHASE_IN_LINE);
    if (!m) continue;
    const from = Number(m[1]), to = Number(m[2] ?? m[1]);
    const done = /^[✔✓]/.test(p.line);
    for (let n = from; n <= to; n++) { if (done) raise(end, n, p.ts); else lower(start, n, p.ts); }
    for (let n = 0; n < from; n++) if (start.has(n) && !end.has(n)) end.set(n, p.ts); // a later phase starting closes the earlier ones
  }
  for (const a of agents) {
    if (a.phase == null) continue;
    lower(start, a.phase, a.startedAt);
    if (a.state !== 'running') raise(end, a.phase, a.lastAt);
  }
  // the documents a phase writes are its own end marker when nothing else is known
  const DOC_ENDS = { 'spec.md': 2, 'design.md': 3, 'plan.md': 4, 'tests.md': 6, 'review.md': 8, 'evidence.md': 9, 'pr.md': 11 };
  for (const f of run.files || []) {
    const n = DOC_ENDS[f.path];
    if (n != null && !end.has(n) && run.phases[n].status === 'done') end.set(n, f.mtime);
  }
  // Phases run in order: no phase ends after a later one ended. Starts are left alone: overlap there is real (a review round while the planner reworks).
  for (let n = 10; n >= 0; n--) {
    const later = Math.min(...run.phases.slice(n + 1).map(q => end.get(q.n) ?? start.get(q.n) ?? Infinity));
    if (end.has(n) && end.get(n) > later) end.set(n, later);
    if (!end.has(n) && start.has(n) && later !== Infinity && run.phases[n].status !== 'in-progress') end.set(n, later);
  }
  for (const p of run.phases) {
    const s = start.get(p.n), e = end.get(p.n);
    if (s) p.clockStart = s;
    if (e && (p.status === 'done' || p.status === 'skipped')) p.clockEnd = e;
    if (p.status === 'in-progress' && p.clockEnd) delete p.clockEnd;
  }
  // last phase's end for a delivered run: the merge commit or the newest state file
  if (run.merged && run.merged.at) { const last = run.phases[11]; if (!last.clockEnd) last.clockEnd = run.merged.at; }
}

/** Rounds: round 1 is the delivery, every feedback round after it is a time window of its own with its
 *  own phases (derived from the progress lines and agents inside the window), agents and activity. */
function buildRounds(run, agents, progress) {
  const now = Date.now();
  const rounds = [{ n: 1, kind: 'delivery', at: run.startedAt, title: 'Delivery', items: [] }];
  for (const r of (run.feedbackRounds || []).filter(r => r.at && r.at > run.startedAt).sort((a, b) => a.at - b.at)) {
    rounds.push({ n: r.n, kind: 'feedback', at: r.at, title: r.title, items: r.items });
  }
  rounds.forEach((r, i) => { r.until = i + 1 < rounds.length ? rounds[i + 1].at : null; });
  for (const r of rounds) {
    const from = r.at - 60000, to = r.until ?? now + 1;
    const ag = agents.filter(a => a.startedAt >= from && a.startedAt < to);
    const pr = progress.filter(p => p.ts >= from && p.ts < to);
    r.agentIds = ag.map(a => a.agentId);
    r.running = ag.some(a => a.state === 'running');
    r.lastActivity = Math.max(r.at, ...ag.map(a => a.lastAt), ...pr.map(p => p.ts));
    r.mergedAt = run.merged && run.merged.at > from && run.merged.at < to ? run.merged.at : null;
    if (r.kind === 'delivery') { r.phases = run.phases; r.closed = !!run.merged || run.status === 'done'; r.current = run.current; continue; }
    const status = new Map();
    for (const p of pr) {
      const m = p.line.match(PHASE_IN_LINE);
      if (!m) continue;
      const a = Number(m[1]), b = Number(m[2] ?? m[1]);
      for (const [k, v] of status) if (k < a && v === 'in-progress') status.set(k, 'done');
      for (let n = a; n <= b; n++) status.set(n, /^[✔✓]/.test(p.line) ? 'done' : 'in-progress');
    }
    for (const a of ag) if (a.phase != null) {
      if (a.state === 'running') status.set(a.phase, 'in-progress');
      else if (!status.has(a.phase)) status.set(a.phase, 'done');
    }
    r.closed = r.until != null || !!r.mergedAt || (!r.running && now - r.lastActivity > 30 * 60 * 1000);
    if (r.closed) for (const [k, v] of status) if (v === 'in-progress') status.set(k, 'done');
    if (r.mergedAt) for (const n of [10, 11]) if (!status.has(n)) status.set(n, 'done');
    r.phases = run.phases.map(p => ({ n: p.n, title: p.title, status: status.get(p.n) || 'absent', note: '' }));
    clockTimes({ phases: r.phases, files: [], merged: r.mergedAt ? { at: r.mergedAt } : null, status: r.closed ? 'done' : 'active' }, ag, pr);
    const cur = r.phases.find(p => p.status === 'in-progress');
    r.current = !r.closed && cur ? { n: cur.n, title: cur.title } : null;
  }
  run.rounds = rounds;
  const last = rounds[rounds.length - 1];
  if (last.kind === 'feedback' && !last.closed) { run.status = 'active'; run.current = last.current; run.activeRound = last.n; }
  else if (last.kind === 'feedback' && last.closed) { run.activeRound = null; }
}

/** Gross and net wall-clock time per round. Gross runs from the round's first to its last activity (until now
 *  while it runs); net counts only the stretches in which the orchestrator or an agent was working, so the time
 *  spent waiting for the user's answers, approvals and next message drops out. */
function durations(run, agents, spans, progress) {
  const now = Date.now();
  const byId = new Map(agents.map(a => [a.agentId, a]));
  const last = run.rounds[run.rounds.length - 1];
  // Screenshots left in the state directory by other processes can be days older than the run; its documents are not.
  const docs = (run.files || []).filter(f => f.path.endsWith('.md'));
  const firstDoc = Math.min(...docs.map(f => f.birth || f.mtime));
  const lastDoc = Math.max(0, ...docs.map(f => f.mtime));
  for (const r of run.rounds) {
    const ag = r.agentIds.map(id => byId.get(id)).filter(Boolean);
    const at = r.kind === 'delivery' && Number.isFinite(firstDoc) ? firstDoc : r.at;
    const firstLine = progress.find(p => p.ts >= at - (r.kind === 'delivery' ? 10 * 60000 : 60000) && (r.until == null || p.ts < r.until));
    const start = Math.min(at, ...ag.map(a => a.startedAt), firstLine ? firstLine.ts : Infinity);
    const open = r.running || (r === last && run.status === 'active');
    const end = open ? now : Math.max(r.lastActivity, r === last ? lastDoc : 0);
    const parts = [...spans, ...ag.flatMap(a => a.spans)]
      .map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let net = 0, reach = start;
    for (const [a, b] of parts) { if (b > reach) { net += b - Math.max(a, reach); reach = b; } }
    r.gross = Math.max(0, end - start);
    r.net = parts.length ? net : null; // no transcript covers this round
  }
  const known = run.rounds.filter(r => r.net != null);
  run.duration = { gross: run.rounds.reduce((n, r) => n + r.gross, 0), net: known.length ? known.reduce((n, r) => n + r.net, 0) : null };
}

/** The state table is only updated at phase ends; running agents and the orchestrator's progress lines tell what is happening now. */
function inferProgress(run, agents, progress) {
  if (run.status === 'done' || run.merged) { clockTimes(run, agents, progress); return; }
  const mark = (n) => { const p = run.phases[n]; if (p && p.status === 'todo') { p.status = 'in-progress'; p.inferred = true; } };
  const last = progress.length ? progress[progress.length - 1] : null;
  if (last) {
    const m = last.line.match(/(?:phase|fase)\s*(\d{1,2})(?:\s*(?:[–—-]|→|->)\s*(\d{1,2}))?/i);
    if (m) {
      const from = Number(m[1]), to = Number(m[2] ?? m[1]);
      for (let n = 0; n < from; n++) { const p = run.phases[n]; if (p && p.status === 'todo') p.status = 'done', p.inferred = true; }
      for (let n = from; n <= to; n++) mark(n);
      if (run.status === 'idle' && Date.now() - last.ts < 30 * 60 * 1000) run.status = 'active';
    }
  }
  // an agent that is still working makes its phase current, whatever the table says
  clockTimes(run, agents, progress);
  for (const a of agents) if (a.state === 'running' && a.phase != null && run.phases[a.phase] && run.phases[a.phase].status !== 'skipped') { run.phases[a.phase].status = 'in-progress'; run.phases[a.phase].inferred = true; }
  const cur = run.phases.find(p => p.status === 'in-progress') || run.phases.find(p => p.status === 'todo');
  run.current = cur ? { n: cur.n, title: cur.title } : null;
  if (run.phases.every(p => p.status === 'done' || p.status === 'skipped')) run.status = 'done';
}

async function runSummaries() {
  await ensureRuns();
  const out = [];
  for (const r of runs) {
    const run = await readRun(r);
    const agents = index.agentsForRun(run);
    const progress = index.orchestratorForRun(run, agents).progress;
    inferProgress(run, agents, progress);
    buildRounds(run, agents, progress);
    out.push({
      ...run, files: undefined, events: undefined,
      agentCount: agents.length,
      running: agents.filter(a => a.state === 'running').length,
    });
  }
  out.sort((a, b) => (a.status === 'active' ? -1 : 0) - (b.status === 'active' ? -1 : 0) || b.updatedAt - a.updatedAt);
  return out;
}

async function runDetail(r) {
  const run = await readRun(r);
  const agents = index.agentsForRun(run);
  const orchestrator = index.orchestratorForRun(run, agents);
  inferProgress(run, agents, orchestrator.progress);
  buildRounds(run, agents, orchestrator.progress);
  durations(run, agents, orchestrator.spans, orchestrator.progress);
  // Files touched, merged across agents and orchestrator.
  const touched = new Map();
  const add = (p, who, phase, ts, kind) => {
    const key = p;
    const f = touched.get(key) || { path: p, rel: p.startsWith(run.root + '/') ? p.slice(run.root.length + 1) : p, inState: p.startsWith(run.stateDir), by: [], first: ts, last: ts, writes: 0, reads: 0 };
    let b = f.by.find(x => x.who === who);
    if (!b) { b = { who, phase, writes: 0, reads: 0, last: ts }; f.by.push(b); }
    if (kind === 'write') { b.writes++; f.writes++; } else { b.reads++; f.reads++; }
    b.last = Math.max(b.last, ts); f.first = Math.min(f.first, ts); f.last = Math.max(f.last, ts);
    touched.set(key, f);
  };
  for (const a of agents) for (const f of a.files) {
    const who = a.description || a.briefHead.slice(0, 60) || a.agentId;
    for (let i = 0; i < f.writes; i++) add(f.path, who, a.phase, f.last, 'write');
    for (let i = 0; i < f.reads; i++) add(f.path, who, a.phase, f.last, 'read');
  }
  for (const e of orchestrator.edits) add(e.path, 'orchestrator', null, e.ts, 'write');
  const files = [...touched.values()].sort((a, b) => b.last - a.last);
  return { ...run, agents, orchestrator: { progress: orchestrator.progress, sessions: orchestrator.sessions }, touched: files };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(here, 'public', 'index.html'));
    if (p === '/app.js' || p === '/style.css') return sendFile(res, path.join(here, 'public', p.slice(1)));
    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/runs') return json(res, 200, { roots: ROOTS, runs: await runSummaries(), at: Date.now() });
    let m;
    if ((m = p.match(/^\/api\/runs\/([\w-]+)$/))) {
      await ensureRuns();
      const r = findRun(m[1]);
      if (!r) return json(res, 404, { error: 'unknown run' });
      return json(res, 200, await runDetail(r));
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/doc$/))) {
      await ensureRuns();
      const r = findRun(m[1]);
      const name = url.searchParams.get('name') || '';
      if (!r || !DOCUMENTS.includes(name)) return json(res, 404, { error: 'unknown document' });
      try {
        const file = path.join(r.stateDir, name);
        const [content, st] = [await fs.readFile(file, 'utf8'), await fs.stat(file)];
        return json(res, 200, { name, content, mtime: st.mtimeMs });
      } catch { return json(res, 404, { error: 'no such document yet' }); }
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/file\/(.+)$/))) {
      await ensureRuns();
      const r = findRun(m[1]);
      if (!r) return json(res, 404, { error: 'unknown run' });
      const rel = decodeURIComponent(m[2]);
      const file = path.resolve(r.stateDir, rel);
      if (!file.startsWith(r.stateDir + path.sep)) return json(res, 403, { error: 'outside the state directory' });
      return sendFile(res, file);
    }
    if ((m = p.match(/^\/api\/agents\/([0-9a-f]+)$/))) {
      const a = index.agent(m[1]);
      return a ? json(res, 200, a) : json(res, 404, { error: 'unknown agent' });
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: String(err && err.message || err) });
  }
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

async function tick() {
  try {
    await ensureRuns();
    const transcriptsChanged = await index.refresh();
    const changed = [];
    for (const r of runs) {
      const id = Buffer.from(`${r.root}\n${r.slug}`).toString('base64url');
      const sig = await stateSignature(r.stateDir);
      if (signatures.get(id) !== sig) { signatures.set(id, sig); changed.push(id); }
    }
    if (changed.length || transcriptsChanged) broadcast('change', { runs: changed, transcripts: transcriptsChanged, at: Date.now() });
  } catch (err) { console.error('tick failed:', err.message); }
  setTimeout(tick, 2000);
}

const server = http.createServer(handle);
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`implement dashboard  http://127.0.0.1:${PORT}`);
  console.log(`watching ${ROOTS.join(', ')} for .claude/implement/*  (transcripts from the last ${DAYS} days)`);
  await ensureRuns(true);
  console.log(`${runs.length} run(s) found; indexing transcripts…`);
  await index.scan();
  await index.refresh();
  console.log(`${index.agents.size} agent transcript(s) indexed`);
  tick();
});
