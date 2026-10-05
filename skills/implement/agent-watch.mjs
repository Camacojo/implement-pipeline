#!/usr/bin/env node
// Watches the agents of one implement run: active time against the role's budget, plus the signals
// that explain a slow agent (polling, repeated long commands, timeouts, a dead environment, compaction,
// error streaks, silence). Reads Claude Code's subagent transcripts; no dependencies, Node 18+.
//
//   node agent-watch.mjs <state dir>            one report of the run's agents
//   node agent-watch.mjs <state dir> --wait     exits (and so wakes the orchestrator) on the first new alert,
//                                               or when none of the run's agents is working any more
//   --budget dev=40 --budget verify=30          override a role budget in minutes
//   --all                                       include agents that finished
//   --days=2                                    how far back to look for transcripts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BUDGETS = { explore: 5, review: 10, test: 15, plan: 20, design: 20, dev: 25, verify: 25 };
const MAX_GAP = 10 * 60 * 1000;
const SILENT_MS = 5 * 60 * 1000;
const POLL_MS = 30 * 1000;
const ENV_RE = /ECONNREFUSED|Connection refused|Timeout \d+ms exceeded|net::ERR_[A-Z_]+|Cannot connect to the Docker daemon|SQLSTATE\[HY000\] \[2002\]|could not translate host name|getaddrinfo ENOTFOUND/;
const TIMEOUT_RE = /did not complete within its \d+s timeout|moved to the background/;

const args = process.argv.slice(2);
const stateDir = path.resolve((args.find(a => !a.startsWith('--') && !/^\w+=\d+$/.test(a)) || '').replace(/^~(?=\/)/, os.homedir()));
const wait = args.includes('--wait');
const all = args.includes('--all');
args.forEach((a, i) => { if (a === '--budget' && /^\w+=\d+$/.test(args[i + 1] || '')) { const [k, v] = args[i + 1].split('='); BUDGETS[k] = Number(v); } });
const m = stateDir.match(/^(.*)\/\.claude\/implement\/([^/]+)$/);
if (!m) { console.error('usage: agent-watch.mjs <project>/.claude/implement/<slug> [--wait] [--all] [--budget role=min]'); process.exit(2); }
const [, projectRoot, slug] = m;
const projectsDir = path.join(os.homedir(), '.claude', 'projects');
const runRe = new RegExp(`(\\S*?)\\.claude/implement/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'g');
const days = Number((args.find(a => a.startsWith('--days=')) || '--days=2').slice(7));

function transcripts() {
  const out = [];
  const since = Date.now() - days * 86400000;
  for (const proj of safe(() => fs.readdirSync(projectsDir), [])) {
    for (const session of safe(() => fs.readdirSync(path.join(projectsDir, proj)), [])) {
      const dir = path.join(projectsDir, proj, session, 'subagents');
      for (const f of safe(() => fs.readdirSync(dir), [])) {
        if (!/^agent-.*\.jsonl$/.test(f)) continue;
        const file = path.join(dir, f);
        if (safe(() => fs.statSync(file).mtimeMs, 0) > since) out.push(file);
      }
    }
  }
  return out;
}
function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b.text || (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => x.text || '').join(' ') : '')).join(' ') : '';
const commandKey = (cmd) => {
  let c = cmd.replace(/\s+/g, ' ').trim(), prev;
  do { prev = c; c = c.replace(/^(cd \S+|[A-Z_][A-Z0-9_]*=\S+|export [^;&]+|mkdir -p \S+)\s*(&&|;)\s*/, ''); } while (c !== prev);
  return c.slice(0, 90);
};

function role(desc, type, brief) {
  const d = `${desc} ${type}`.toLowerCase();
  if (type === 'Explore' || /\bexplor/.test(d)) return 'explore';
  if (/review/.test(d)) return 'review';
  if (/\bplan/.test(d)) return 'plan';
  if (/verif|evidence/.test(d)) return 'verify';
  if (/test/.test(d)) return 'test';
  if (/design/.test(d)) return 'design';
  return /^you are (an? )?(code )?reviewer/i.test(brief) ? 'review' : 'dev';
}

/** One agent's current assignment: from the coordinator's last message after an idle stretch until now. */
function analyse(file, now) {
  const recs = [];
  for (const line of safe(() => fs.readFileSync(file, 'utf8'), '').split('\n')) {
    if (!line) continue;
    const r = safe(() => JSON.parse(line), null);
    if (r && r.timestamp) recs.push(r);
  }
  if (!recs.length) return null;
  const brief = textOf((recs.find(r => r.type === 'user') || {}).message?.content);
  // Agents run in the orchestrator's working directory, so the brief's path to the state directory decides.
  const roots = [...brief.matchAll(runRe)].map(x => x[1].replace(/^[`'"(]+/, '').replace(/^~(?=\/)/, os.homedir()).replace(/\/$/, ''));
  if (!roots.length || !roots.some(r => r === '' || r === projectRoot)) return null;
  const meta = safe(() => JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')), {});
  let idle = true, cap = MAX_GAP, at = 0, assignment = 0, active = 0, total = 0;
  const pending = new Map();
  let s = fresh();
  function fresh() { return { compactions: 0, timeouts: 0, env: [], polls: 0, pollMs: 0, cmds: new Map(), slow: [], results: [], lastTool: null }; }
  for (const r of recs) {
    const ts = Date.parse(r.timestamp);
    if (at && !idle && ts > at) { const g = Math.min(ts - at, cap); active += g; total += g; }
    if (ts > at) at = ts;
    const msg = r.message || {};
    if (r.type === 'system' && r.subtype === 'compact_boundary') s.compactions++;
    if (r.type === 'user') {
      if (idle && assignment) { s = fresh(); active = 0; }
      if (idle) assignment = ts;
      idle = false; cap = MAX_GAP;
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b.type !== 'tool_result') continue;
        const t = textOf([b]);
        const p = pending.get(b.tool_use_id);
        pending.delete(b.tool_use_id);
        s.results.push(!!b.is_error);
        if (TIMEOUT_RE.test(t)) s.timeouts++;
        const e = t.match(ENV_RE); if (e && !s.env.includes(e[0])) s.env.push(e[0]);
        if (p && p.cmd) {
          const c = s.cmds.get(p.cmd) || { n: 0, ms: 0 };
          c.n++; c.ms += ts - p.ts; s.cmds.set(p.cmd, c);
          if (p.poll) s.pollMs += ts - p.ts;
          else if (ts - p.ts >= 5 * 60000) s.slow.push({ cmd: p.cmd, ms: ts - p.ts });
        }
      }
      continue;
    }
    if (r.type !== 'assistant') continue;
    const uses = (Array.isArray(msg.content) ? msg.content : []).filter(b => b.type === 'tool_use');
    if (!uses.length) { if (msg.stop_reason === 'end_turn') idle = true; continue; }
    idle = false;
    cap = uses.some(u => u.name === 'Agent' || u.name === 'Workflow') ? Infinity : MAX_GAP;
    for (const u of uses) {
      const cmd = u.name === 'Bash' ? String(u.input?.command || '') : '';
      const poll = /\bsleep\s+\d/.test(cmd) && /\b(until|while|for)\b/.test(cmd) || /\bsleep\s+([3-9]\d|\d{3,})\b/.test(cmd);
      if (poll) s.polls++;
      pending.set(u.id, { ts, cmd: cmd ? commandKey(cmd) : '', poll });
      s.lastTool = { ts, name: u.name, detail: cmd ? commandKey(cmd) : String(u.input?.file_path || u.input?.pattern || u.input?.description || '').slice(0, 90) };
    }
  }
  const working = !idle;
  if (working) { const g = Math.min(now - at, cap); active += g; total += g; }
  const desc = meta.description || brief.split('\n').find(l => l.trim())?.slice(0, 70) || path.basename(file);
  const rl = role(desc, meta.agentType || '', brief);
  const own = brief.match(/time budget:?\s*(\d+)\s*min/i);
  const budget = own ? Number(own[1]) : BUDGETS[rl];
  const signals = [];
  if (s.polls) signals.push({ kind: 'poll', hard: true, text: `polls with sleep loops (${s.polls}×, ${min(s.pollMs)} min) — waiting for another agent or a process instead of reporting` });
  for (const [cmd, c] of s.cmds) if ((c.n >= 3 && c.ms >= 3 * 60000) || c.ms >= 10 * 60000) signals.push({ kind: 'repeat', hard: true, text: `ran \`${cmd}\` ${c.n}× (${min(c.ms)} min)` });
  if (s.slow.length) signals.push({ kind: 'slow', hard: true, text: `${s.slow.length} command(s) of 5 min or more (${min(s.slow.reduce((n, x) => n + x.ms, 0))} min), longest: \`${s.slow.sort((a, b) => b.ms - a.ms)[0].cmd}\`` });
  if (s.timeouts) signals.push({ kind: 'timeout', hard: true, text: `${s.timeouts} command(s) hit the tool timeout` });
  if (s.env.length) signals.push({ kind: 'env', hard: true, text: `environment errors: ${s.env.slice(0, 3).join(', ')}` });
  if (s.compactions) signals.push({ kind: 'compacted', hard: true, text: `context compacted ${s.compactions}× — the package is too large for one agent` });
  const tail = s.results.slice(-6);
  if (tail.length >= 4 && tail.filter(Boolean).length >= 4) signals.push({ kind: 'errors', hard: true, text: `${tail.filter(Boolean).length} of the last ${tail.length} tool calls failed` });
  if (working && now - at > SILENT_MS) signals.push({ kind: 'silent', hard: false, text: `no transcript activity for ${min(now - at)} min${s.lastTool ? ` — last call: ${s.lastTool.name} ${s.lastTool.detail}` : ''}` });
  return { id: path.basename(file, '.jsonl').replace(/^agent-/, ''), file, desc, role: rl, budget, working, active, total, assignment, last: at, lastTool: s.lastTool, signals };
}
const min = (ms) => Math.round(ms / 60000);

function report(agents, now) {
  const lines = [];
  for (const a of agents) {
    const over = a.active / 60000 / a.budget;
    const mark = !a.working ? '·' : over >= 2 ? '▲▲' : over >= 1 ? '▲' : a.signals.some(x => x.hard) ? '!' : '✓';
    lines.push(`${mark} ${a.desc} · ${a.role} · ${min(a.active)}/${a.budget} min active${a.working ? '' : `, reported ${new Date(a.last).toTimeString().slice(0, 5)}`}${a.total - a.active > 60000 ? ` (${min(a.total)} over all assignments)` : ''} · agent ${a.id}`);
    for (const x of a.signals) lines.push(`    ${x.hard ? '!' : '?'} ${x.text}`);
    if (a.working && !a.signals.length && a.lastTool) lines.push(`    last: ${a.lastTool.name} ${a.lastTool.detail} (${min(now - a.lastTool.ts)} min ago)`);
  }
  return lines.join('\n');
}

function scan() {
  const now = Date.now();
  const agents = transcripts().map(f => analyse(f, now)).filter(Boolean).sort((a, b) => a.assignment - b.assignment);
  return { now, agents: all ? agents : agents.filter(a => a.working || now - a.last < 60000) };
}

if (!wait) {
  const { now, agents } = scan();
  console.log(agents.length ? report(agents, now) : `No agent of ${slug} is working.`);
  process.exit(0);
}

// Wait mode: alerts already reported (per agent and assignment) are kept in the state directory, so a
// restarted watcher only wakes the orchestrator for something new.
const seenFile = path.join(stateDir, '.agent-watch.json');
const lockFile = path.join(stateDir, '.agent-watch.pid');
const other = safe(() => Number(fs.readFileSync(lockFile, 'utf8')), 0);
if (other && other !== process.pid && safe(() => process.kill(other, 0), false)) { console.log(`Already watching ${slug} (pid ${other}).`); process.exit(0); }
fs.writeFileSync(lockFile, String(process.pid));
const release = () => { if (safe(() => Number(fs.readFileSync(lockFile, 'utf8')), 0) === process.pid) safe(() => fs.unlinkSync(lockFile)); };
process.on('exit', release);
process.on('SIGTERM', () => process.exit(0));
const seen = new Set(safe(() => JSON.parse(fs.readFileSync(seenFile, 'utf8')), []));
let started = false;
const begun = Date.now();
for (;;) {
  const { now, agents } = scan();
  const working = agents.filter(a => a.working);
  if (working.length) started = true;
  const fresh = [];
  for (const a of working) {
    const level = a.active >= 2 * a.budget * 60000 ? 2 : a.active >= a.budget * 60000 ? 1 : 0;
    const keys = [...(level ? [`${a.id}@${a.assignment}:budget${level}`] : []), ...a.signals.filter(x => x.hard).map(x => `${a.id}@${a.assignment}:${x.kind}`)];
    for (const k of keys) if (!seen.has(k)) { seen.add(k); fresh.push(k); }
  }
  if (fresh.length) {
    fs.writeFileSync(seenFile, JSON.stringify([...seen]));
    console.log(`ALERT ${slug}: ${fresh.length} new\n${report(agents, now)}`);
    process.exit(0);
  }
  if (started && !working.length) { console.log(`No agent of ${slug} is working any more.`); process.exit(0); }
  if (!started && Date.now() - begun > 10 * 60000) { console.log(`No agent of ${slug} started within 10 minutes.`); process.exit(0); }
  await new Promise(r => setTimeout(r, POLL_MS));
}
