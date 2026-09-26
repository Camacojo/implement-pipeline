// Discovery and parsing of implement-pipeline state directories.
// A run lives at <project root>/.claude/implement/<slug>/ and is described by
// free-form markdown; this module reads it tolerantly and never throws on odd input.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
async function git(cwd, ...args) {
  try { const { stdout } = await run('git', args, { cwd, timeout: 4000 }); return stdout.trim(); } catch { return null; }
}

const mergeCache = new Map(); // `${root}|${slug}` -> {at, result}

/** Is the run's branch merged into the project's main branch? Answers from git, cached for a minute. */
export async function mergedInfo(root, slug, branchFact) {
  const key = `${root}|${slug}`;
  const c = mergeCache.get(key);
  if (c && Date.now() - c.at < 60000) return c.result;
  let result = null;
  const inside = await git(root, 'rev-parse', '--is-inside-work-tree');
  if (inside === 'true') {
    let target = null;
    for (const cand of ['develop', 'main', 'master']) {
      if (await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${cand}`) !== null) { target = cand; break; }
    }
    if (target) {
      const candidates = [];
      if (branchFact) candidates.push(branchFact.split(/\s/)[0].replace(/^`|`$/g, ''));
      candidates.push(`feature/${slug}`, slug);
      for (const br of candidates) {
        if (!br || br === target) continue;
        let merged = false, at = null;
        // A merge commit on the target whose second parent is the branch tip. (A branch that is
        // merely an ancestor of the target is not enough: a fresh branch with no commits is one too.)
        const tip = await git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${br}`);
        if (tip) {
          const merges = await git(root, 'rev-list', '--merges', '--parents', '-n', '3000', target);
          if (merges) for (const line of merges.split('\n')) {
            const [sha, , ...others] = line.split(' ');
            if (others.includes(tip)) { merged = true; const d = await git(root, 'show', '-s', '--format=%ci', sha); if (d) at = Date.parse(d); break; }
          }
        }
        // Otherwise a commit on the target that names the branch (merge, squash or rebase).
        if (!merged) {
          const log = await git(root, 'log', target, '-1', '--format=%ci', `--grep=${br}`, '--fixed-strings');
          if (log) { at = Date.parse(log); merged = true; }
        }
        if (merged) { result = { branch: br, into: target, at }; break; }
      }
    }
  }
  mergeCache.set(key, { at: Date.now(), result });
  return result;
}

export const PHASES = [
  [0, 'Project knowledge'], [1, 'Intake'], [2, 'Specification'], [3, 'Design'],
  [4, 'Technical plan'], [5, 'Plan review'], [6, 'Tests first'], [7, 'Build'],
  [8, 'Code review'], [9, 'Verification'], [10, 'PR decision'], [11, 'Deliver'],
];

export const DOCUMENTS = [
  'state.md', 'spec.md', 'design.md', 'contracts.md', 'plan.md', 'tests.md',
  'review.md', 'evidence.md', 'pr.md', 'feedback.md',
];

const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', 'var', 'cache', 'storage', 'tmp', '.idea', 'Pods', 'DerivedData']);

export function runId(root, slug) {
  return Buffer.from(`${root}\n${slug}`).toString('base64url');
}
export function decodeRunId(id) {
  const [root, slug] = Buffer.from(id, 'base64url').toString().split('\n');
  return { root, slug };
}

/** Walk the given roots for `.claude/implement/<slug>/` directories. */
export async function discoverRuns(roots, maxDepth = 4) {
  const found = [];
  const seen = new Set();
  async function walk(dir, depth) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    const implementDir = path.join(dir, '.claude', 'implement');
    try {
      const st = await fs.stat(implementDir);
      if (st.isDirectory()) {
        for (const e of await fs.readdir(implementDir, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const key = `${dir}/${e.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ root: dir, slug: e.name, stateDir: path.join(implementDir, e.name) });
        }
      }
    } catch { /* no state here */ }
    if (depth >= maxDepth) return;
    await Promise.all(entries
      .filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && (!e.name.startsWith('.') || e.name === '.claude') && e.name !== '.claude')
      .map(e => walk(path.join(dir, e.name), depth + 1)));
  }
  await Promise.all(roots.map(r => walk(r, 0)));
  return found;
}

async function listFiles(dir, rel = '') {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { out.push(...await listFiles(p, r)); continue; }
    try {
      const st = await fs.stat(p);
      out.push({ path: r, size: st.size, mtime: st.mtimeMs, birth: st.birthtimeMs || st.ctimeMs });
    } catch { /* vanished */ }
  }
  return out;
}

const STATUS_RULES = [
  [/^\s*skip/i, 'skipped'],
  // "running" wins over "done": a row like "WP1–WP3 done, WP4 running" is still in progress
  [/in.progress|running|started|bezig|gestart|lopend|active|\bwip\b/i, 'in-progress'],
  [/\bskip/i, 'skipped'],
  [/\bdone\b|\bklaar\b|\bafgerond\b|\bcompleted?\b|\bmerged\b|\bgereed\b/i, 'done'],
  [/\btodo\b|pending|waiting|open\b/i, 'todo'],
];

function classify(statusText, started, ended) {
  const t = (statusText || '').trim();
  if (started && !ended && !/^\s*skip/i.test(t)) return 'in-progress'; // a start time without an end time is the clearest signal there is
  for (const [re, s] of STATUS_RULES) if (re.test(t)) return s;
  if (started && ended) return 'done';
  if (t) return 'done'; // a non-empty free-text status almost always describes finished work
  return 'todo';
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

/** Extract the phase table from state.md. Returns [] when there is none. */
export function parsePhaseTable(md) {
  const lines = md.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|') || !/phase|fase/i.test(lines[i])) continue;
    if (!/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const header = splitRow(lines[i]).map(h => h.toLowerCase());
    const col = (names) => header.findIndex(h => names.some(n => h.includes(n)));
    const cStatus = col(['status', 'state']);
    const cStart = col(['start', 'begin']);
    const cEnd = col(['end', 'eind', 'klaar']);
    const rows = [];
    for (let j = i + 2; j < lines.length; j++) {
      if (!lines[j].trim().startsWith('|')) break;
      const cells = splitRow(lines[j]);
      const label = cells[0] || '';
      const m = label.match(/(\d+)\s*[–—-]\s*(\d+)|(\d+)/);
      if (!m) continue;
      const from = Number(m[1] ?? m[3]);
      const to = Number(m[2] ?? m[3]);
      const status = cStatus >= 0 ? cells[cStatus] : (cells[1] || '');
      const started = cStart >= 0 ? cells[cStart] : '';
      const ended = cEnd >= 0 ? cells[cEnd] : '';
      rows.push({ from, to, label, statusText: status, started, ended, status: classify(status, started, ended) });
    }
    if (rows.length) return rows;
  }
  return [];
}

function phasesFromRows(rows) {
  const phases = PHASES.map(([n, title]) => ({ n, title, status: 'todo', note: '', started: '', ended: '' }));
  for (const r of rows) {
    for (let n = r.from; n <= Math.min(r.to, 11); n++) {
      const p = phases[n];
      if (!p) continue;
      p.status = r.status;
      p.note = r.statusText;
      p.started = r.started;
      p.ended = r.ended;
      p.grouped = r.from !== r.to;
    }
  }
  return phases;
}

/** Pull `Key: value` header facts out of the top of state.md. */
export function parseFacts(md) {
  const facts = {};
  const head = md.split('\n').slice(0, 40);
  for (const line of head) {
    const m = line.match(/^\s*[-*]?\s*\*{0,2}(Slug|Repo|Repository|Branch|Size|Mode|Ticket|Docs consulted|Environment)\*{0,2}\s*:\s*(.+)$/i);
    if (m) facts[m[1].toLowerCase().replace(/\s+/g, '_')] = m[2].replace(/\*\*/g, '').trim();
  }
  if (!facts.size) {
    const m = md.match(/\bSize\s*[:*]*\s*\**\s*(XS|S|M|L)\b/i);
    if (m) facts.size = m[1].toUpperCase();
  } else {
    const m = facts.size.match(/\b(XS|S|M|L)\b/);
    if (m) facts.size = m[1];
  }
  if (!facts.branch) {
    const m = md.match(/\bbranch\b[^\n`]*`([^`\n]+)`/i);
    if (m) facts.branch = m[1];
  }
  return facts;
}

const CLASS_WORDS = [
  [/defect|bug|fout/i, 'defect'], [/change|wijziging|amend/i, 'change'], [/question|vraag/i, 'question'],
  [/out of scope|buiten scope|scope/i, 'out-of-scope'], [/infra|flake/i, 'infrastructure'],
];
function classWord(text) {
  const t = (text || '').replace(/\*/g, '').trim();
  for (const [re, w] of CLASS_WORDS) if (re.test(t)) return w;
  return t ? t.split(/[.(:]/)[0].trim().toLowerCase().slice(0, 30) : 'other';
}

/** Feedback rounds from feedback.md: a heading naming "round N" (with a date) and a table of F-items. */
export function parseFeedback(md) {
  const rounds = [];
  let cur = null, header = null;
  const dateRe = /(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d)/;
  for (const line of md.split('\n')) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) {
      const m = h[1].match(/\b(?:round|ronde)\s*(\d+)/i);
      if (m) {
        const d = h[1].match(dateRe);
        cur = { n: Number(m[1]), title: h[1].replace(/^\s*[-–—]\s*/, '').trim(), at: d ? Date.parse(`${d[1]}T${d[2]}:00`) : null, items: [] };
        rounds.push(cur); header = null;
      }
      continue;
    }
    if (!cur || !line.trim().startsWith('|')) continue;
    const cells = splitRow(line);
    if (/^:?-{2,}/.test(cells[0])) continue;
    if (cells.some(c => /classification|classificatie/i.test(c))) { header = cells.map(c => c.toLowerCase()); continue; }
    const idCell = cells.find(c => /^\**F-?\d+\**$/i.test(c.trim()));
    if (!idCell) continue;
    const col = (names) => header ? header.findIndex(hh => names.some(n => hh.includes(n))) : -1;
    const pick = (i) => (i >= 0 && cells[i] != null) ? cells[i] : '';
    const quote = pick(col(['quote', 'citaat'])) || cells[Math.min(2, cells.length - 1)] || '';
    cur.items.push({
      id: idCell.replace(/\*/g, '').toUpperCase().replace(/^F(\d)/, 'F-$1'),
      quote: quote.replace(/\*/g, '').replace(/^[\s"“„]+|[\s"”]+$/g, '').slice(0, 220),
      classification: classWord(pick(col(['classification', 'classificatie']))),
      decision: (pick(col(['decision', 'besluit', 'resolution', 'oplossing'])) || '').replace(/\*/g, '').slice(0, 260),
    });
  }
  return rounds.sort((a, b) => a.n - b.n);
}

/** Optional structured log: <state dir>/events.jsonl, one JSON object per line. */
async function readEvents(stateDir) {
  try {
    const txt = await fs.readFile(path.join(stateDir, 'events.jsonl'), 'utf8');
    return txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function applyEvents(phases, events) {
  for (const ev of events) {
    const n = Number(ev.phase);
    if (!Number.isInteger(n) || !phases[n]) continue;
    const p = phases[n];
    const kind = String(ev.event || ev.type || '').toLowerCase();
    if (/start|begin/.test(kind)) { p.status = 'in-progress'; p.startedAt = ev.ts; }
    else if (/done|end|finish/.test(kind)) { p.status = 'done'; p.endedAt = ev.ts; }
    else if (/skip/.test(kind)) { p.status = 'skipped'; p.note = ev.detail || ev.reason || p.note; }
    if (ev.title && !p.grouped) p.title = ev.title;
  }
}

const ACTIVE_WINDOW_MS = 30 * 60 * 1000;

/** Build the summary of one run from its state directory. */
export async function readRun({ root, slug, stateDir }) {
  const files = await listFiles(stateDir);
  let stateMd = '';
  try { stateMd = await fs.readFile(path.join(stateDir, 'state.md'), 'utf8'); } catch { /* none yet */ }
  const rows = parsePhaseTable(stateMd);
  const phases = phasesFromRows(rows);
  const events = await readEvents(stateDir);
  applyEvents(phases, events);
  const facts = parseFacts(stateMd);

  let feedbackRounds = [];
  try {
    feedbackRounds = parseFeedback(await fs.readFile(path.join(stateDir, 'feedback.md'), 'utf8'));
    const fbFile = files.find(f => f.path === 'feedback.md');
    for (const r of feedbackRounds) if (!r.at && fbFile) r.at = r === feedbackRounds[feedbackRounds.length - 1] ? fbFile.mtime : fbFile.birth; // undated round: the file's times are the best guess
  } catch { /* no feedback yet */ }

  const merged = await mergedInfo(root, slug, facts.branch);
  if (merged) {
    for (const p of phases) if (p.status === 'todo' || p.status === 'in-progress') { p.status = 'done'; p.inferred = true; }
  }

  const updatedAt = files.reduce((m, f) => Math.max(m, f.mtime), 0);
  const startedAt = files.reduce((m, f) => Math.min(m, f.birth || f.mtime), Infinity);
  const allSettled = phases.every(p => p.status === 'done' || p.status === 'skipped');
  const delivered = phases[11].status === 'done';
  let status = 'idle';
  if (delivered || allSettled) status = 'done';
  else if (Date.now() - updatedAt < ACTIVE_WINDOW_MS) status = 'active';

  let current = phases.find(p => p.status === 'in-progress');
  if (!current && status !== 'done') current = phases.find(p => p.status === 'todo');

  const docs = DOCUMENTS.filter(d => files.some(f => f.path === d));
  const evidence = files.filter(f => f.path.startsWith('evidence/') || /\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(f.path));
  const title = (stateMd.match(/^#\s+(.+)$/m) || [])[1] || slug;

  return {
    id: runId(root, slug), slug, root, project: path.basename(root), stateDir, title: title.trim(),
    facts, phases, current: current ? { n: current.n, title: current.title } : null,
    status, merged, startedAt: Number.isFinite(startedAt) ? startedAt : updatedAt, updatedAt,
    docs, evidence, files, events, hasTable: rows.length > 0, feedbackRounds,
  };
}

/** Cheap change signature: the newest mtime and total size inside the state dir. */
export async function stateSignature(stateDir) {
  const files = await listFiles(stateDir);
  return files.reduce((s, f) => `${s}|${f.path}:${f.size}:${Math.round(f.mtime)}`, '');
}
