// Reads Claude Code transcripts (~/.claude/projects/**.jsonl) to learn which agents
// worked for which run, what they did, and which files they touched.
//
// The transcript format is Claude Code's internal one and may change between
// versions; everything that knows about its shape lives in this file.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const RUN_PATH_RE = /((?:~|\/)[^\s`'"()]+?)?\/?\.claude\/implement\/([A-Za-z0-9._-]+)/;
const RUN_NAME_RE = /\brun\s+["“'`]([A-Za-z0-9._-]+)["”'`]/;
const HOME_PATH_RE = /(?:^|\s|\(|`)((?:~|\/(?:Users|home|opt|srv|var|work))\/[^\s`'"():,]+)/g;
const expandHome = (p) => p.replace(/^~(?=\/|$)/, os.homedir());
const PROGRESS_RE = /^[ \t]*(?:[▶✔✓✗⏸⏹⚠]|implement\s*·|\/?implement[-\w]*\s*·)[^\n]*/gmu;
// orchestrators sometimes put the marker after a sentence ("Gates green. ▶ phase 8 …")
const INLINE_PROGRESS_RE = /[▶✔✓][ \t]*(?:implement[ \t]*·[ \t]*)?(?:phase|fase)[ \t]*\d[^\n]*/giu;
const WAIT_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const LONG_TOOLS = new Set(['Agent', 'Task', 'Workflow']);
// Bash times out after 10 minutes, so a longer silence mid-turn is a permission prompt or a sleeping laptop.
const MAX_GAP = 10 * 60 * 1000;

/** Wall-clock stretches in which a transcript was working rather than waiting for its user. */
class Activity {
  constructor() { this.spans = []; this.at = 0; this.waiting = true; this.cap = MAX_GAP; }

  take(rec, ts) {
    if (!ts) return;
    if (this.at && !this.waiting && ts > this.at) this.add(this.at, Math.min(ts, this.at + this.cap));
    if (ts > this.at) this.at = ts;
    const msg = rec.message || {};
    if (rec.type === 'user') { this.waiting = false; this.cap = MAX_GAP; return; }
    if (rec.type !== 'assistant') return;
    const tools = (Array.isArray(msg.content) ? msg.content : []).filter(b => b.type === 'tool_use').map(b => b.name);
    if (!tools.length) { if (msg.stop_reason === 'end_turn') this.waiting = true; return; }
    this.waiting = tools.some(t => WAIT_TOOLS.has(t));
    this.cap = tools.some(t => LONG_TOOLS.has(t)) ? Infinity : MAX_GAP;
  }

  add(a, b) {
    const last = this.spans[this.spans.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else this.spans.push([a, b]);
  }

  /** The spans, with a turn that is still open running until now. */
  until(now) {
    if (this.waiting || !this.at) return this.spans;
    return [...this.spans, [this.at, Math.min(now, this.at + this.cap)]];
  }
}

/** Incrementally parsed transcript file. */
class Transcript {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.rest = '';
    this.size = 0;
    this.mtime = 0;
  }

  /** Read new bytes since the last call and hand each complete JSON line to `onRecord`. */
  async advance(onRecord) {
    let st;
    try { st = await fs.stat(this.file); } catch { return false; }
    if (st.size === this.size && st.mtimeMs === this.mtime) return false;
    if (st.size < this.offset) { this.offset = 0; this.rest = ''; } // truncated/rewritten
    const fh = await fs.open(this.file, 'r');
    try {
      const len = st.size - this.offset;
      if (len > 0) {
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, this.offset);
        this.offset = st.size;
        const text = this.rest + buf.toString('utf8');
        const lines = text.split('\n');
        this.rest = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          let rec;
          try { rec = JSON.parse(line); } catch { continue; }
          onRecord(rec);
        }
      }
    } finally { await fh.close(); }
    this.size = st.size;
    this.mtime = st.mtimeMs;
    return true;
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
}

function toolDetail(name, input) {
  if (!input) return '';
  if (input.file_path) return input.file_path;
  if (input.command) return String(input.command).split('\n')[0].slice(0, 160);
  if (input.pattern) return input.pattern;
  if (input.description) return input.description;
  if (input.skill) return `/${input.skill}`;
  if (input.url) return input.url;
  return '';
}

/** One subagent transcript: `<project>/<session>/subagents/agent-<id>.jsonl`. */
class Agent {
  constructor(file) {
    this.t = new Transcript(file);
    this.file = file;
    this.agentId = path.basename(file, '.jsonl').replace(/^agent-/, '');
    this.sessionId = path.basename(path.dirname(path.dirname(file)));
    this.projectDir = path.dirname(path.dirname(path.dirname(file)));
    this.brief = '';
    this.cwd = '';
    this.model = '';
    this.startedAt = 0;
    this.lastAt = 0;
    this.finished = false;
    this.lastStop = '';
    this.turns = 0;
    this.tools = [];          // {ts, name, detail}
    this.texts = [];          // {ts, text}
    this.files = new Map();   // path -> {writes, reads, first, last}
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    this.runRoot = '';
    this.runSlug = '';
    this.phase = null;
    this.activity = new Activity();
  }

  async refresh() {
    if (!this.meta) {
      try { this.meta = JSON.parse(await fs.readFile(this.file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { this.meta = null; }
    }
    const advanced = await this.t.advance(rec => this.take(rec));
    // A brief that lives in a file ("Read your brief at <path>") carries the phase; read its head once.
    if (this.brief && !this.briefFileRead) {
      this.briefFileRead = true;
      const m = this.brief.match(/((?:~|\/)[^\s`'"()]+?\/\.claude\/implement\/[^\s`'"()]+?\.md)/);
      if (m) {
        try {
          const head = (await fs.readFile(expandHome(m[1]), 'utf8')).slice(0, 1500);
          if (this.phase == null) { const ph = head.match(/\b(?:phase|fase)\s*(\d{1,2})\b/i); if (ph) this.phase = Number(ph[1]); }
          if (!this.runSlug) { const r = head.match(RUN_NAME_RE); if (r) this.runSlug = r[1]; }
        } catch { /* the brief file is gone or unreadable */ }
      }
    }
    return advanced;
  }

  take(rec) {
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : 0;
    if (ts) { if (!this.startedAt) this.startedAt = ts; this.lastAt = Math.max(this.lastAt, ts); }
    this.activity.take(rec, ts);
    if (rec.cwd && !this.cwd) this.cwd = rec.cwd;
    const msg = rec.message || {};
    if (rec.type === 'user') {
      if (!this.brief) {
        const text = textOf(msg.content);
        if (text) {
          this.brief = text;
          const m = text.match(RUN_PATH_RE);
          if (m) { this.runRoot = expandHome((m[1] || '').replace(/[.;!?]+$/, '')); this.runSlug = m[2]; }
          else { const n = text.match(RUN_NAME_RE); if (n) this.runSlug = n[1]; }
          if (!this.runRoot && this.runSlug) {
            // the brief usually names the project once as an absolute or ~-prefixed path
            const roots = [...text.matchAll(HOME_PATH_RE)]
              .map(x => expandHome(x[1].replace(/[.;!?]+$/, '').replace(/\/$/, ''))); // a path at the end of a sentence carries the full stop
            if (roots.length) this.runRoot = roots.sort((a, b) => a.length - b.length)[0];
          }
          const ph = text.slice(0, 800).match(/\b(?:phase|fase)\s*(\d{1,2})\b/i);
          if (ph) this.phase = Number(ph[1]);
        }
      }
      // a tool_result arriving means the agent is still going
      if (Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool_result')) this.finished = false;
      return;
    }
    if (rec.type !== 'assistant') return;
    this.turns++;
    if (msg.model) this.model = msg.model;
    const u = msg.usage || {};
    this.usage.input += u.input_tokens || 0;
    this.usage.output += u.output_tokens || 0;
    this.usage.cacheRead += u.cache_read_input_tokens || 0;
    this.usage.cacheCreate += u.cache_creation_input_tokens || 0;
    let sawTool = false;
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (b.type === 'text' && b.text && b.text.trim()) {
        this.texts.push({ ts, text: b.text });
        if (this.texts.length > 40) this.texts.shift();
      } else if (b.type === 'tool_use') {
        sawTool = true;
        const detail = toolDetail(b.name, b.input);
        this.tools.push({ ts, name: b.name, detail });
        if (this.tools.length > 400) this.tools.shift();
        const fp = b.input && b.input.file_path;
        if (fp && (WRITE_TOOLS.has(b.name) || READ_TOOLS.has(b.name))) {
          const f = this.files.get(fp) || { writes: 0, reads: 0, first: ts, last: ts };
          if (WRITE_TOOLS.has(b.name)) f.writes++; else f.reads++;
          f.last = ts;
          this.files.set(fp, f);
        }
      }
    }
    this.lastStop = msg.stop_reason || '';
    this.finished = !sawTool && msg.stop_reason === 'end_turn';
  }

  summary(now = Date.now()) {
    const stale = !this.finished && now - this.lastAt > 20 * 60 * 1000;
    const lastText = this.texts.length ? this.texts[this.texts.length - 1] : null;
    const lastTool = this.tools.length ? this.tools[this.tools.length - 1] : null;
    return {
      agentId: this.agentId, sessionId: this.sessionId, model: this.model,
      metaDescription: this.meta ? this.meta.description || '' : '', metaType: this.meta ? this.meta.agentType || '' : '',
      runRoot: this.runRoot, runSlug: this.runSlug, phase: this.phase,
      briefHead: this.brief.split('\n').find(l => l.trim()) || '',
      startedAt: this.startedAt, lastAt: this.lastAt,
      state: this.finished ? 'done' : stale ? 'stale' : 'running',
      turns: this.turns, usage: this.usage,
      spans: this.activity.until(now),
      toolCount: this.tools.length,
      lastText: lastText ? { ts: lastText.ts, text: lastText.text.slice(-1200) } : null,
      lastTool,
      files: [...this.files].map(([p, f]) => ({ path: p, ...f })),
    };
  }

  detail() {
    return {
      ...this.summary(),
      brief: this.brief,
      texts: this.texts.slice(-8),
      tools: this.tools.slice(-120),
    };
  }
}

/** The orchestrator's own session transcript: `<project>/<session>.jsonl`. */
class Session {
  constructor(file) {
    this.t = new Transcript(file);
    this.file = file;
    this.sessionId = path.basename(file, '.jsonl');
    this.cwd = '';
    this.agentCalls = new Map(); // tool_use_id -> {description, subagent_type, model, promptHead, ts}
    this.agentById = new Map();  // agentId -> tool_use_id
    this.edits = [];             // {ts, path, tool}
    this.progress = [];          // {ts, line}
    this.lastAt = 0;
    this.activity = new Activity();
  }

  // Every line is parsed: the working time needs the timestamps of the records nobody else looks at.
  async refresh() {
    return this.t.advance(rec => this.take(rec));
  }

  take(rec) {
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : 0;
    if (ts) this.lastAt = Math.max(this.lastAt, ts);
    this.activity.take(rec, ts);
    if (rec.cwd && !this.cwd) this.cwd = rec.cwd;
    const msg = rec.message || {};
    if (rec.type === 'user') {
      const r = rec.toolUseResult;
      const agentId = r && typeof r === 'object' ? r.agentId : (typeof r === 'string' ? (r.match(/agentId['"]?:\s*['"]?([0-9a-f]{10,})/) || [])[1] : null);
      if (agentId && Array.isArray(msg.content)) {
        const tr = msg.content.find(b => b.type === 'tool_result');
        if (tr) this.agentById.set(agentId, tr.tool_use_id);
      }
      return;
    }
    if (rec.type !== 'assistant' || !Array.isArray(msg.content)) return;
    for (const b of msg.content) {
      if (b.type === 'text' && b.text) {
        const covered = [];
        for (const m of b.text.matchAll(PROGRESS_RE)) {
          covered.push([m.index, m.index + m[0].length]);
          const line = m[0].trim();
          if (line.length < 8 || line.length > 300) continue;
          this.progress.push({ ts, line });
        }
        for (const m of b.text.matchAll(INLINE_PROGRESS_RE)) {
          if (covered.some(([a, z]) => m.index >= a && m.index < z)) continue;
          const line = m[0].trim();
          if (line.length < 8 || line.length > 300) continue;
          this.progress.push({ ts, line });
        }
        if (this.progress.length > 2000) this.progress.splice(0, this.progress.length - 2000);
      } else if (b.type === 'tool_use') {
        if (b.name === 'Agent') {
          const inp = b.input || {};
          this.agentCalls.set(b.id, {
            description: inp.description || '', subagent_type: inp.subagent_type || '', model: inp.model || '',
            promptHead: String(inp.prompt || '').slice(0, 400), ts,
          });
        } else if (WRITE_TOOLS.has(b.name) && b.input && b.input.file_path) {
          this.edits.push({ ts, path: b.input.file_path, tool: b.name });
        }
      }
    }
  }

  callFor(agentId) {
    const id = this.agentById.get(agentId);
    return id ? this.agentCalls.get(id) : null;
  }
}

async function safeReaddir(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
}

/** Keeps every transcript of interest up to date and answers questions per run. */
export class TranscriptIndex {
  constructor({ days = 14 } = {}) {
    this.days = days;
    this.agents = new Map();   // file -> Agent
    this.sessions = new Map(); // file -> Session
    this.lastScan = 0;
  }

  async scan() {
    const cutoff = Date.now() - this.days * 86400000;
    for (const proj of await safeReaddir(PROJECTS_DIR)) {
      if (!proj.isDirectory()) continue;
      const projDir = path.join(PROJECTS_DIR, proj.name);
      for (const e of await safeReaddir(projDir)) {
        const p = path.join(projDir, e.name);
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          if (!this.sessions.has(p)) {
            const st = await fs.stat(p).catch(() => null);
            if (st && st.mtimeMs > cutoff) this.sessions.set(p, new Session(p));
          }
        } else if (e.isDirectory()) {
          const sub = path.join(p, 'subagents');
          for (const a of await safeReaddir(sub)) {
            if (!a.isFile() || !a.name.startsWith('agent-') || !a.name.endsWith('.jsonl')) continue;
            const ap = path.join(sub, a.name);
            if (this.agents.has(ap)) continue;
            const st = await fs.stat(ap).catch(() => null);
            if (st && st.mtimeMs > cutoff) this.agents.set(ap, new Agent(ap));
          }
        }
      }
    }
    this.lastScan = Date.now();
  }

  /** Re-read whatever changed. Returns true when any transcript advanced. */
  async refresh() {
    if (Date.now() - this.lastScan > 5000) await this.scan();
    let changed = false;
    for (const a of this.agents.values()) if (await a.refresh()) changed = true;
    // Only sessions that spawned agents matter for the pipeline; parse those and any
    // session whose subagents mention a run.
    const wanted = new Set([...this.agents.values()].map(a => path.join(a.projectDir, `${a.sessionId}.jsonl`)));
    for (const [file, s] of this.sessions) {
      if (!wanted.has(file)) continue;
      if (await s.refresh()) changed = true;
    }
    return changed;
  }

  signature() {
    let s = '';
    for (const a of this.agents.values()) s += `${a.t.size}.`;
    for (const x of this.sessions.values()) s += `${x.t.size}.`;
    return s;
  }

  agentsForRun(run) {
    const list = [];
    for (const a of this.agents.values()) {
      if (a.runSlug !== run.slug) continue;
      if (a.runRoot && run.root && a.runRoot !== run.root && !a.runRoot.startsWith(run.root + '/') && !run.root.startsWith(a.runRoot + '/')) continue;
      const session = this.sessions.get(path.join(a.projectDir, `${a.sessionId}.jsonl`));
      const call = session ? session.callFor(a.agentId) : null;
      const sum = a.summary();
      list.push({ ...sum, description: sum.metaDescription || (call ? call.description : ''), subagentType: sum.metaType || (call ? call.subagent_type : ''), requestedModel: call ? call.model : '' });
    }
    list.sort((x, y) => x.startedAt - y.startedAt);
    return list;
  }

  agent(agentId) {
    for (const a of this.agents.values()) if (a.agentId === agentId) return a.detail();
    return null;
  }

  /** Orchestrator activity that belongs to this run: file edits inside the project and progress lines, within the run's time window. */
  orchestratorForRun(run, agents) {
    const from = Math.min(run.startedAt || Infinity, ...agents.map(a => a.startedAt || Infinity)) - 10 * 60 * 1000;
    const to = (run.status === 'active' ? Date.now() : Math.max(run.updatedAt, ...agents.map(a => a.lastAt))) + 15 * 60 * 1000;
    const sessionIds = new Set(agents.map(a => a.sessionId));
    const edits = [];
    const progress = [];
    const spans = [];
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (!sessionIds.has(s.sessionId)) continue;
      for (const [a, b] of s.activity.until(now)) if (b > from && a < to) spans.push([Math.max(a, from), Math.min(b, to)]);
      for (const e of s.edits) if (e.ts >= from && e.ts <= to && (e.path.startsWith(run.root + '/') || e.path.startsWith(run.stateDir))) edits.push(e);
      for (const p of s.progress) if (p.ts >= from && p.ts <= to) progress.push(p);
    }
    edits.sort((a, b) => a.ts - b.ts);
    progress.sort((a, b) => a.ts - b.ts);
    return { edits, progress, spans, sessions: [...sessionIds] };
  }
}
