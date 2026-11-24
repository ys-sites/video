// Masvid Studio: chat with the user's own Claude Code inside the Studio.
//
// Runs the installed Claude Code CLI headless (the user's own login; no API key) with ONLY this
// Studio's MCP tools plus read-only file tools, so Claude edits projects through the same
// OpenMotion tool surface the editor uses and cannot touch anything else on the PC.
// Ported from the master-studio prototype (session video-5b), which was verified live with Sonnet.
//
// Routes (reached as /motion-api/claude/* from the Studio page; POSTs are same-origin only, see server.ts):
//   GET  /api/claude/status            Claude installed? version, running turn, models
//   GET  /api/claude/skills            the user's skill library, grouped
//   GET  /api/claude/chat?projectId=   saved transcript for a project
//   POST /api/claude/turn              { projectId?, message, skill?, model?, newChat? } -> text/event-stream
//   POST /api/claude/stop              stop the running turn
//   POST /api/claude/reset             { projectId? } forget the conversation for a project
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Input = (req: IncomingMessage, limit?: number) => Promise<Record<string, any>>;
type Project = { id: string; title: string; width: number; height: number; duration: number; fps: number };
type Skill = { id: string; title: string; description: string };
type Group = { id: string; label: string; skills: Skill[] };
type ChatEntry = { role: 'user' | 'assistant'; text: string; at: number; tools?: string[]; skill?: string | null; ok?: boolean };

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO = path.dirname(path.resolve(ROOT));
const LIBRARY_SKILLS = path.join(ROOT, 'library', 'skills');
const WORKFLOW_SKILLS = path.join(ROOT, 'skills');
const MANIFEST = path.join(REPO, 'tools', 'openmotion-skills.json');
const MODELS = ['sonnet', 'opus', 'haiku'];
const ID = /^[A-Za-z0-9_-]{1,80}$/;

function readJson<T>(file: string, fallback: T): T { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } }

function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(local) ? local : 'claude';
}
const CLAUDE = findClaude();
let claudeVersion: string | null = null;
function claudeInfo() {
  if (claudeVersion === null) {
    const r = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    claudeVersion = r.status === 0 ? r.stdout.trim() : '';
  }
  return { installed: Boolean(claudeVersion), version: claudeVersion };
}

// ---------- per-workspace state ----------
function home(data: string) {
  const dir = path.join(data, 'masvid-studio');
  for (const d of [dir, path.join(dir, 'work'), path.join(dir, 'chats')]) mkdirSync(d, { recursive: true });
  // Only this Studio's MCP server, on the same data directory, so edits show up in the editor.
  writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({
    mcpServers: { openmotion: { type: 'stdio', command: process.execPath, args: ['--experimental-strip-types', path.join(ROOT, 'mcp.ts')], env: { MOTION_DATA_DIR: data, DO_NOT_TRACK: '1', OPENMOTION_TELEMETRY: 'off' } } },
  }, null, 2));
  return dir;
}
const homes = new Map<string, string>();
function homeFor(data: string) { let h = homes.get(data); if (!h) { h = home(data); homes.set(data, h); } return h; }

function sessions(data: string): Record<string, string> { return readJson(path.join(homeFor(data), 'sessions.json'), {}); }
function saveSession(data: string, key: string, id: string) { const s = sessions(data); if (id) s[key] = id; else delete s[key]; writeFileSync(path.join(homeFor(data), 'sessions.json'), JSON.stringify(s, null, 2)); }
function chatFile(data: string, key: string) { return path.join(homeFor(data), 'chats', `${key}.json`); }
function readChat(data: string, key: string): ChatEntry[] { return readJson(chatFile(data, key), [] as ChatEntry[]); }
function appendChat(data: string, key: string, entry: ChatEntry) { const c = readChat(data, key); c.push(entry); writeFileSync(chatFile(data, key), JSON.stringify(c.slice(-200), null, 1)); }

// ---------- projects ----------
function projectMeta(data: string, id: string): Project | null {
  const index = path.join(data, 'projects', id, 'index.html');
  if (!existsSync(index)) return null;
  const html = readFileSync(index, 'utf8');
  const root = /<[^>]*data-composition-id="[^"]*"[^>]*>/.exec(html.slice(Math.max(0, html.indexOf('<body'))))?.[0] || '';
  const attr = (n: string) => (new RegExp(`data-${n}="([^"]+)"`).exec(root) || [])[1];
  const catalog = readJson<{ projects?: { id: string; title?: string }[] }>(path.join(data, 'projects.json'), {});
  const title = catalog.projects?.find(p => p.id === id)?.title || 'Untitled';
  return { id, title, width: Number(attr('width')) || 1080, height: Number(attr('height')) || 1920, duration: Number(attr('duration')) || 0, fps: Number(attr('fps')) || 30 };
}
function knownProject(data: string, id: unknown) { return typeof id === 'string' && ID.test(id) ? projectMeta(data, id) : null; }

// ---------- skills ----------
const GROUP_LABELS: Record<string, string> = {
  'video-system': 'Your video system', creator: 'Creator & social', 'site-styles': 'Your site styles', study: 'Lessons & explainers',
  design: 'Lessons & explainers', 'motion-system': 'Motion & animation', ecc: 'Video, content & design', openmotion: 'Studio recipes',
};
function frontmatter(text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  let key: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) { key = kv[1]; out[key] = kv[2].replace(/^>-?\s*$|^\|-?\s*$/, '').replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'); }
    else if (key && /^\s+/.test(line)) out[key] = (out[key] + ' ' + line.trim()).trim();
  }
  return out;
}
function prettyTitle(id: string, desc: string) {
  if (id.startsWith('masvid-style-')) { const t = /^([^(]+)\(/.exec(desc); if (t) return t[1].trim(); }
  return id.replace(/^masvid-(style-)?|^openmotion-/, '').replace(/^vs-/, '').replace(/^ecc-/, '').split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}
let skillCache: { at: number; data: Group[] } | null = null;
export function listSkills(): Group[] {
  if (skillCache && Date.now() - skillCache.at < 60000) return skillCache.data;
  const manifest = readJson<{ skills: { id: string; group: string }[] }>(MANIFEST, { skills: [] });
  const groupOf = new Map(manifest.skills.map(s => ['masvid-' + s.id, s.group]));
  const groups: Record<string, Skill[]> = {};
  if (existsSync(LIBRARY_SKILLS)) for (const name of readdirSync(LIBRARY_SKILLS)) {
    const file = path.join(LIBRARY_SKILLS, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    let group = groupOf.get(name) || (name.startsWith('masvid-style-') ? 'site-styles' : name.startsWith('openmotion-') ? 'openmotion' : null);
    if (!group) continue;
    if (group === 'design') group = 'study';
    const desc = (frontmatter(readFileSync(file, 'utf8')).description || '').replace(/^OpenMotion\s+[—-]\s*/, '').replace(/^Site style\s+[—-]\s*/, '');
    (groups[group] ||= []).push({ id: name, title: prettyTitle(name, desc), description: desc.slice(0, 260) });
  }
  const order = ['video-system', 'creator', 'site-styles', 'study', 'motion-system', 'ecc', 'openmotion'];
  const data = order.filter(g => groups[g]).map(g => ({ id: g, label: GROUP_LABELS[g] || g, skills: groups[g].sort((a, b) => a.title.localeCompare(b.title)) }));
  skillCache = { at: Date.now(), data };
  return data;
}
function skillCatalogText() {
  return listSkills().filter(g => g.id !== 'openmotion').map(g => `${g.label}: ` + g.skills.map(s => s.id).join(', ')).join('\n');
}

function systemPrompt() {
  const wf = (name: string) => path.join(WORKFLOW_SKILLS, name, 'SKILL.md');
  return `You are the video editor inside Masvid Studio, a local app on the user's PC (built on OpenMotion).
The user sees the project's live preview and timeline next to this chat. They do not see your tool calls, only short activity lines.

How to work:
- Make every change through the Studio's MCP tools (mcp__openmotion__*), following the Studio's workflow Skills. They are files; read the matching one with the Read tool once per conversation:
  new video, creative or motion redesign -> ${wf('openmotion-director')}
  edits, imports, audio swaps, fixes, exports -> ${wf('openmotion-production')}
  start from a template -> ${wf('openmotion-template-to-video')}
  recreate a reference video -> ${wf('openmotion-recreate')}
  (entry overview: ${wf('openmotion')})
- Project round: openmotion_open_preview action "begin" -> author/import -> openmotion_edit_project with expectedRevision/expectedVersionId/workId -> openmotion_open_preview action "complete_generation". Do NOT call action "open" or "record_display": the Studio already shows the preview.
- No project open and the user describes a video: create one with openmotion_create_project (pick a short title), then build it.
- When the studio context names a skill or style, call openmotion_get_skill with that exact skillId and follow it as the creative direction before editing. Otherwise choose the best fitting skill from the user's library below.
- Media the user imported is in the project's assets; inspect the project before assuming. User files given as absolute paths: import them with openmotion_import_assets.
- Free tools only. Never configure, register or call a paid model provider or ask for an API key. If a request needs AI-generated footage, say so and suggest a free route (code-rendered motion, the user's own footage, or the local LTX/Wan models outside the Studio).
- Never invent quotes, numbers, prices, specs or dates. Use only the user's media, licensed assets or what the Studio provides.
- Export only when asked: openmotion_export_request, then poll openmotion_get_project with exportJobId until done, and give the file name.
- Do not claim you watched the result. Say what you changed; the user checks the preview.

Replies: short and friendly, plain words, no code or JSON. After an edit, 1-3 sentences on what changed and one suggested next step.

The user's skill library (ids for openmotion_get_skill):
${skillCatalogText()}`;
}

function contextBlock(project: Project | null, skill: string | null) {
  const lines = ['[Studio context]'];
  if (project) lines.push(`Current project: ${project.id} "${project.title}" (${project.width}x${project.height}, ${project.duration} s, ${project.fps} fps).`);
  else lines.push('No project is open yet.');
  lines.push(skill ? `Chosen skill/style: ${skill} - read it with openmotion_get_skill before changing anything.` : 'Chosen skill/style: auto (pick the best fit).');
  lines.push('[/Studio context]');
  return lines.join('\n');
}

const TOOL_LABELS: Record<string, (i: Record<string, any>) => string> = {
  openmotion_get_skill: i => `Reading skill ${i.skillId || ''}`,
  openmotion_list_skills: () => 'Looking through skills',
  openmotion_create_project: i => `Creating project${i.title ? ` "${i.title}"` : ''}`,
  openmotion_get_project: i => (i.exportJobId ? 'Checking the export' : 'Reading the project'),
  openmotion_edit_project: () => 'Saving the edit',
  openmotion_open_preview: i => (i.action === 'begin' ? 'Starting an edit round' : i.action === 'complete_generation' ? 'Finishing the edit' : 'Preview'),
  openmotion_import_assets: () => 'Importing media',
  openmotion_export_request: () => 'Starting the MP4 export',
  openmotion_list_templates: () => 'Browsing templates',
  openmotion_get_template: () => 'Opening a template',
  Read: i => `Reading ${path.basename(String(i.file_path || 'file'))}`,
  Glob: () => 'Looking for files',
  Grep: () => 'Searching files',
};
function toolLabel(name: string, input: Record<string, any>) {
  const short = name.replace(/^mcp__openmotion__/, '');
  const f = TOOL_LABELS[short];
  return f ? f(input || {}) : short.replace(/^openmotion_/, '').replace(/_/g, ' ');
}
function findProjectId(value: unknown, depth = 0): string | null {
  if (!value || depth > 4) return null;
  if (typeof value === 'string') { try { return findProjectId(JSON.parse(value), depth + 1); } catch { return null; } }
  if (Array.isArray(value)) { for (const v of value) { const r = findProjectId(v, depth + 1); if (r) return r; } return null; }
  if (typeof value === 'object') {
    const o = value as Record<string, any>;
    if (typeof o.projectId === 'string' && ID.test(o.projectId)) return o.projectId;
    if (o.project && typeof o.project.id === 'string' && ID.test(o.project.id)) return o.project.id;
    for (const k of ['content', 'text', 'result', 'structuredContent']) { const r = findProjectId(o[k], depth + 1); if (r) return r; }
  }
  return null;
}

// ---------- the turn ----------
let running: { child: ChildProcess; projectId: string | null } | null = null;

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function runTurn(req: IncomingMessage, res: ServerResponse, data: string, body: Record<string, any>) {
  if (running) return json(res, 409, { error: 'Claude is still working on the last request. Stop it or wait.' });
  if (!claudeInfo().installed) return json(res, 500, { error: 'Claude Code is not installed on this PC.' });
  const project = knownProject(data, body.projectId);
  const skill = typeof body.skill === 'string' && /^[a-z0-9-]{2,80}$/.test(body.skill) ? body.skill : null;
  const model = MODELS.includes(body.model) ? body.model : 'sonnet';
  const message = String(body.message || '').slice(0, 8000).trim();
  if (!message) return json(res, 400, { error: 'Type what you want to change.' });

  const dir = homeFor(data);
  const key = project ? project.id : '_new';
  if (body.newChat) saveSession(data, key, '');
  const resume = body.newChat ? null : sessions(data)[key] || null;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', model,
    '--setting-sources', 'project',
    '--strict-mcp-config', '--mcp-config', path.join(dir, 'mcp.json'),
    '--tools', 'Read,Glob,Grep',
    '--allowedTools', 'mcp__openmotion', 'Read', 'Glob', 'Grep',
    '--add-dir', data, WORKFLOW_SKILLS, LIBRARY_SKILLS,
    '--append-system-prompt', systemPrompt()];
  if (resume) args.push('--resume', resume);

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event: Record<string, unknown>) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  send({ type: 'start', model, resumed: Boolean(resume), project: project?.id || null });
  appendChat(data, key, { role: 'user', text: message, at: Date.now(), skill });

  const child = spawn(CLAUDE, args, { cwd: path.join(dir, 'work'), env: { ...process.env, MOTION_DATA_DIR: data, DO_NOT_TRACK: '1' }, windowsHide: true });
  running = { child, projectId: project?.id || null };
  child.stdin.end(contextBlock(project, skill) + '\n\n' + message);

  let buffer = '', stderr = '', sessionId: string | null = resume, currentProject = project?.id || null, finished = false, reply = '';
  const toolLines: string[] = [];
  const noteProject = (id: string | null) => {
    if (id && id !== currentProject && projectMeta(data, id)) { currentProject = id; send({ type: 'project', id }); }
  };
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.session_id) sessionId = e.session_id;
      if (e.type === 'system' && e.subtype === 'init') {
        const om = (e.mcp_servers || []).find((s: any) => s.name === 'openmotion');
        send({ type: 'status', text: om && om.status === 'connected' ? 'Connected to the Studio' : 'Studio tools unavailable', ok: Boolean(om && om.status === 'connected') });
      } else if (e.type === 'stream_event') {
        const ev = e.event || {};
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') send({ type: 'delta', text: ev.delta.text });
        else if (ev.type === 'message_start') send({ type: 'message_start' });
      } else if (e.type === 'assistant') {
        for (const block of e.message?.content || []) {
          if (block.type === 'text' && block.text) { reply += (reply ? '\n\n' : '') + block.text; send({ type: 'text', text: block.text }); }
          else if (block.type === 'tool_use') {
            const label = toolLabel(block.name, block.input);
            toolLines.push(label);
            send({ type: 'tool', id: block.id, label });
            noteProject(block.input?.projectId ?? null);
          }
        }
      } else if (e.type === 'user') {
        for (const block of e.message?.content || []) {
          if (block.type !== 'tool_result') continue;
          send({ type: 'tool_done', id: block.tool_use_id, ok: !block.is_error });
          noteProject(findProjectId(block.content));
        }
      } else if (e.type === 'result') {
        finished = true;
        send({ type: 'done', ok: !e.is_error, seconds: Math.round((e.duration_ms || 0) / 1000), text: e.is_error ? String(e.result || 'Claude stopped with an error.') : '' });
      }
    }
  });
  child.stderr!.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
  child.on('error', err => { stderr += String(err); });
  child.on('close', code => {
    running = null;
    if (sessionId) { saveSession(data, currentProject || key, sessionId); if (currentProject && key === '_new') saveSession(data, '_new', ''); }
    const failure = finished ? '' : (code === null || child.killed ? 'Stopped.' : (stderr.split('\n').filter(Boolean).slice(-2).join(' ') || `Claude exited (${code}).`));
    if (!finished) send({ type: 'done', ok: false, text: failure });
    appendChat(data, currentProject || key, { role: 'assistant', text: reply || failure, at: Date.now(), tools: toolLines, ok: finished && !failure });
    send({ type: 'end', project: currentProject });
    res.end();
  });
  // Closing the page does not cancel the turn; the edit finishes and is saved with the project.
  req.on('close', () => undefined);
}

/** Returns true when the request was a Claude chat route. */
export async function claudeChatHttp(req: IncomingMessage, res: ServerResponse, url: URL, data: string, input: Input): Promise<boolean> {
  if (!url.pathname.startsWith('/api/claude/')) return false;
  const route = url.pathname.slice('/api/claude/'.length);
  if (req.method === 'GET' && route === 'status') { json(res, 200, { ...claudeInfo(), running: Boolean(running), projectId: running?.projectId ?? null, models: MODELS }); return true; }
  if (req.method === 'GET' && route === 'skills') { json(res, 200, { groups: listSkills() }); return true; }
  if (req.method === 'GET' && route === 'chat') {
    const id = url.searchParams.get('projectId');
    const key = id && ID.test(id) ? id : '_new';
    json(res, 200, { messages: readChat(data, key), hasSession: Boolean(sessions(data)[key]) });
    return true;
  }
  if (req.method !== 'POST') { json(res, 405, { error: 'Unsupported request' }); return true; }
  if (route === 'turn') { runTurn(req, res, data, await input(req, 64 * 1024)); return true; }
  if (route === 'stop') { if (running) running.child.kill(); json(res, 200, { stopped: Boolean(running) }); return true; }
  if (route === 'reset') {
    const body = await input(req, 4 * 1024);
    const key = typeof body.projectId === 'string' && ID.test(body.projectId) ? body.projectId : '_new';
    saveSession(data, key, '');
    if (existsSync(chatFile(data, key)) && statSync(chatFile(data, key)).isFile()) writeFileSync(chatFile(data, key), '[]');
    json(res, 200, { reset: true });
    return true;
  }
  json(res, 404, { error: 'Unknown Claude route' });
  return true;
}
