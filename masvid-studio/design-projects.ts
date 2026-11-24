/**
 * Shared domain service and HTTP adapter for OpenMotion Design Studio.
 * Both public MCP tools (openmotion_design_*) and Studio HTTP endpoints call this service.
 * OpenMotion runs no design agent: external Agents create and edit HTML projects through
 * this service while Studio previews, annotates, versions, exports and hands off briefs.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { atomicJson, jsonFile } from './phase1-versions.ts';
import { withProcessLock } from './shared/process-lock.ts';
import { readProjectZip } from './shared/project-zip.ts';
import { attachmentDisposition } from './shared/http-header.ts';
import { zip } from './scripts/zip.mjs';
import { browserExecutable } from './browser.ts';
import { validateReviewAnnotation } from './shared/review-comments.ts';
import { designCatalog } from './shared/design-catalog.ts';
import {
  designEditorHref, designExportFormats, designRoutes, designScenarios, findDesignScenario, isDesignScenario,
  type DesignComment, type DesignCommentAnchor, type DesignEditorApp, type DesignExportFormat,
  type DesignFile, type DesignProject, type DesignProjectDetail, type DesignScenarioId, type DesignVersion,
} from './shared/design-project.ts';

const execFileAsync = promisify(execFile);
const UUID_RE = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_FILES = 5000;
const MAX_WRITE_FILES = 100;
const MAX_WRITE_BYTES = 8 * 1024 * 1024;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_COMMENTS = 2000;
const READ_LIMIT_DEFAULT = 200_000;
const IGNORED_DIRS = new Set(['node_modules', '.git', '__MACOSX', 'dist', 'build', '.next']);

const TEXT_EXTS = new Set(['html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'md', 'markdown', 'txt', 'svg', 'xml', 'csv', 'yaml', 'yml', 'glsl', 'vert', 'frag']);
const BINARY_IMPORT_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'ico', 'bmp', 'svg', 'woff', 'woff2', 'ttf', 'otf', 'mp3', 'wav', 'ogg', 'mp4', 'webm']);
const IMPORT_EXTS = new Set([...TEXT_EXTS, 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'ico', 'bmp', 'woff', 'woff2', 'ttf', 'otf', 'pdf', 'mp3', 'wav', 'ogg', 'mp4', 'webm', 'wasm', 'map', 'webmanifest']);

export type DesignAssetResolver = (ref: { assetId: string; versionId: string }) => Promise<{
  asset: { id: string; name: string; modality: string };
  version: { id: string; filename: string; name?: string; mimeType: string; bytes: number; sha256: string };
  filename: string;
}>;

function slugifyAssetName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'asset';
}

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', cjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
};

export type DesignErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'COMMENT_CONFLICT' | 'UNSUPPORTED';

export class DesignError extends Error {
  readonly code: DesignErrorCode;
  readonly status: number;
  constructor(code: DesignErrorCode, message: string, status?: number) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status ?? (code === 'NOT_FOUND' ? 404 : code === 'VERSION_CONFLICT' || code === 'COMMENT_CONFLICT' ? 409 : code === 'UNSUPPORTED' ? 501 : 400);
  }
}

type StoredProject = Omit<DesignProject, 'revision' | 'versionId' | 'versionLabel'>;
type ProjectCatalogFile = { schemaVersion: 1; projects: StoredProject[] };
type VersionFile = { schemaVersion: 1; currentVersionId: string | null; versions: DesignVersion[] };
type CommentFile = { schemaVersion: 1; comments: DesignComment[] };
type RequestReceipt = { inputHash: string; result: unknown };

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function mimeFor(filePath: string) {
  return MIME_BY_EXT[path.extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

function fileKind(filePath: string): DesignFile['kind'] {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(ext)) return 'js';
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (['txt', 'xml', 'csv', 'yaml', 'yml', 'glsl', 'vert', 'frag'].includes(ext)) return 'text';
  if (['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'ico', 'bmp'].includes(ext)) return 'image';
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return 'font';
  if (['mp3', 'wav', 'ogg', 'mp4', 'webm'].includes(ext)) return 'media';
  return 'other';
}

function validateId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new DesignError('INVALID_ARGUMENT', 'Invalid design project id');
  return id;
}

function validateTitle(title: unknown): string {
  if (typeof title !== 'string') throw new DesignError('INVALID_ARGUMENT', 'Title must be a string');
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 120 || /[\x00-\x1f\x7f]/.test(trimmed)) throw new DesignError('INVALID_ARGUMENT', 'Title must be 1–120 printable characters');
  return trimmed;
}

function validateRequestId(requestId: unknown): string {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 120) throw new DesignError('INVALID_ARGUMENT', 'Valid requestId is required');
  return requestId.trim();
}

export function cleanDesignPath(raw: unknown): string {
  if (typeof raw !== 'string') throw new DesignError('INVALID_ARGUMENT', 'File path must be a string');
  const normalized = raw.replace(/^\/+/, '');
  if (!normalized || normalized.length > 240 || /[\\\x00-\x1f\x7f]/.test(normalized)) {
    throw new DesignError('INVALID_ARGUMENT', `Unsafe file path: ${raw}`);
  }
  const parts = normalized.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.') || IGNORED_DIRS.has(p))) {
    throw new DesignError('INVALID_ARGUMENT', `Disallowed path segment: ${raw}`);
  }
  return parts.join('/');
}

function isTextFile(filePath: string) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return TEXT_EXTS.has(ext) || /^(license|notice|readme)(\.|$)/i.test(path.basename(filePath));
}

function computeRevision(files: { path: string; size: number; sha256: string }[]) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path)).map(f => ({ path: f.path, size: f.size, sha256: f.sha256 }));
  return sha256(JSON.stringify(sorted));
}

function starterFiles(scenario: DesignScenarioId, title: string, hasTokensCss: boolean): Record<string, string> {
  const safeTitle = title.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]!));
  const tokensLink = hasTokensCss ? '\n  <link rel="stylesheet" href="./tokens.css" />' : '';
  if (scenario === 'deck') {
    return {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>${tokensLink}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #0f1115; color: #f4f5f7; font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
    .deck-stage { width: 100vw; height: 100vh; display: grid; place-items: center; }
    .slide { display: none; width: min(100vw, 177.78vh); height: min(100vh, 56.25vw); padding: 7%; background: #161922; border: 1px solid rgba(255,255,255,0.08); flex-direction: column; justify-content: space-between; }
    .slide.active { display: flex; }
    .eyebrow { font-size: 14px; letter-spacing: 0.14em; text-transform: uppercase; color: #7c9cff; }
    h1 { font-size: clamp(36px, 5vw, 72px); line-height: 1.08; letter-spacing: -0.025em; max-width: 16ch; }
    h2 { font-size: clamp(28px, 3.6vw, 52px); line-height: 1.15; letter-spacing: -0.02em; }
    p { font-size: clamp(16px, 1.8vw, 24px); line-height: 1.5; color: #b5bccb; max-width: 56ch; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 32px; }
    .card { padding: 28px; border-radius: 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
    .card strong { display: block; font-size: 28px; margin-bottom: 8px; color: #fff; }
    footer { display: flex; justify-content: space-between; font-size: 13px; color: #7e8699; }
    @media print {
      @page { size: 1920px 1080px; margin: 0; }
      html, body { height: auto; overflow: visible; }
      .deck-stage { display: block; width: auto; height: auto; }
      .slide { display: flex !important; width: 1920px; height: 1080px; page-break-after: always; break-after: page; }
    }
  </style>
</head>
<body>
  <main class="deck-stage" id="deck">
    <section class="slide active" data-screen-label="Cover">
      <div class="eyebrow">Slide Deck</div>
      <div>
        <h1>${safeTitle}</h1>
        <p style="margin-top:20px">Edit with your coding Agent via OpenMotion MCP, or switch to Code view for manual edits.</p>
      </div>
      <footer><span>${safeTitle}</span><span>01 / 03</span></footer>
    </section>
    <section class="slide" data-screen-label="Key Points">
      <div class="eyebrow">Overview</div>
      <div>
        <h2>Three pillars for this presentation</h2>
        <div class="grid">
          <div class="card"><strong>01 · Context</strong><p>Frame the core user problem and why now.</p></div>
          <div class="card"><strong>02 · Approach</strong><p>Show the product mechanics and clear proof points.</p></div>
          <div class="card"><strong>03 · Plan</strong><p>Share milestones, metrics and the immediate next step.</p></div>
        </div>
      </div>
      <footer><span>${safeTitle}</span><span>02 / 03</span></footer>
    </section>
    <section class="slide" data-screen-label="Next Steps">
      <div class="eyebrow">Summary</div>
      <div>
        <h2>Ready to refine with annotations</h2>
        <p style="margin-top:20px">Pin comments on any slide in Design Studio, then copy the brief to Codex or Claude Code to apply scoped revisions.</p>
      </div>
      <footer><span>${safeTitle}</span><span>03 / 03</span></footer>
    </section>
  </main>
  <script type="application/json" id="speaker-notes">["Open with the headline and establish the goal of the deck.", "Walk through each pillar concisely — pause on the key proof point.", "Close with the decision needed and next milestones."]</script>
  <script>
    (function () {
      const slides = Array.from(document.querySelectorAll('.slide'));
      let active = 0;
      function announce() {
        try { window.parent.postMessage({ type: 'od:slide-state', active, count: slides.length, protocolVersion: 1 }, '*'); } catch {}
      }
      function go(index) {
        active = Math.max(0, Math.min(slides.length - 1, index));
        slides.forEach((el, i) => el.classList.toggle('active', i === active));
        announce();
      }
      window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(active + 1); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(active - 1); }
        else if (e.key === 'Home') { e.preventDefault(); go(0); }
        else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1); }
      });
      window.addEventListener('message', (e) => {
        const msg = e.data;
        if (!msg || msg.type !== 'od:slide') return;
        if (msg.action === 'next') go(active + 1);
        else if (msg.action === 'prev') go(active - 1);
        else if (msg.action === 'first') go(0);
        else if (msg.action === 'last') go(slides.length - 1);
        else if (msg.action === 'go' && typeof msg.index === 'number') go(msg.index);
      });
      try { window.parent.postMessage({ type: 'od:deck-ready', capabilities: ['absolute-navigation', 'state-events'] }, '*'); } catch {}
      announce();
    })();
  </script>
</body>
</html>`,
    };
  }
  if (scenario === 'document') {
    return {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>${tokensLink}
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 48px 24px; background: #f3f4f6; color: #111827; font-family: Georgia, 'Times New Roman', serif; line-height: 1.65; }
    article { max-width: 760px; margin: 0 auto; padding: 64px 72px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; }
    header { border-bottom: 2px solid #111827; padding-bottom: 20px; margin-bottom: 32px; }
    h1 { font-family: system-ui, -apple-system, sans-serif; font-size: 32px; margin: 0 0 8px; letter-spacing: -0.02em; }
    .meta { font-family: system-ui, sans-serif; font-size: 13px; color: #6b7280; }
    h2 { font-family: system-ui, sans-serif; font-size: 18px; margin: 28px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-family: system-ui, sans-serif; font-size: 14px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
    th { font-weight: 600; background: #f9fafb; }
    @media print {
      body { background: #fff; padding: 0; }
      article { border: 0; border-radius: 0; padding: 0; max-width: none; }
      thead { display: table-header-group; }
    }
  </style>
</head>
<body>
  <article>
    <header>
      <h1>${safeTitle}</h1>
      <div class="meta">Print-ready HTML document · Exportable to PDF from Design Studio</div>
    </header>
    <section>
      <h2>Executive Summary</h2>
      <p>Replace this section with your document brief using your coding Agent through OpenMotion MCP. Semantic headings, responsive tables and <code>@media print</code> pagination rules are already configured.</p>
    </section>
    <section>
      <h2>Key Figures</h2>
      <table>
        <thead><tr><th>Metric</th><th>Current</th><th>Target</th></tr></thead>
        <tbody>
          <tr><td>Primary outcome</td><td>—</td><td>—</td></tr>
          <tr><td>Timeline</td><td>—</td><td>—</td></tr>
        </tbody>
      </table>
    </section>
  </article>
</body>
</html>`,
    };
  }
  if (scenario === 'live-artifact') {
    const sample = {
      title,
      updatedAt: new Date().toISOString(),
      metrics: [
        { label: 'Active users', value: '12,480', delta: '+8.4%' },
        { label: 'Conversion', value: '4.72%', delta: '+0.6%' },
        { label: 'Latency (p95)', value: '142 ms', delta: '-18 ms' },
      ],
      items: [
        { name: 'North America', status: 'Healthy', value: '$48,200' },
        { name: 'Europe', status: 'Healthy', value: '$31,900' },
        { name: 'Asia-Pacific', status: 'Watching', value: '$24,600' },
      ],
    };
    return {
      'data.json': JSON.stringify(sample, null, 2),
      'provenance.json': JSON.stringify({ source: 'local-data.json', refreshedAt: sample.updatedAt }, null, 2),
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>${tokensLink}
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0d1016; color: #f3f4f6; padding: 32px; }
    .wrap { max-width: 1080px; margin: 0 auto; display: grid; gap: 24px; }
    header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 12px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .card { background: #161b24; border: 1px solid #262d3d; border-radius: 14px; padding: 20px; }
    .label { font-size: 13px; color: #9aa3b5; }
    .val { font-size: 30px; font-weight: 700; margin: 8px 0 4px; }
    .delta { font-size: 13px; color: #5eead4; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #262d3d; font-size: 14px; }
    th { color: #9aa3b5; font-weight: 500; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1 id="title">${safeTitle}</h1>
      <span class="label" id="updated">Loading data.json…</span>
    </header>
    <section class="kpis" id="kpis"></section>
    <section class="card">
      <table><thead><tr><th>Segment</th><th>Status</th><th>Value</th></tr></thead><tbody id="rows"></tbody></table>
    </section>
  </div>
  <script>
    fetch('./data.json', { cache: 'no-store' }).then(r => r.json()).then(data => {
      document.getElementById('title').textContent = data.title || '${safeTitle}';
      document.getElementById('updated').textContent = 'Updated ' + (data.updatedAt || '');
      const kpis = document.getElementById('kpis');
      kpis.replaceChildren(...(data.metrics || []).map(m => {
        const d = document.createElement('div'); d.className = 'card';
        const l = document.createElement('div'); l.className = 'label'; l.textContent = m.label;
        const v = document.createElement('div'); v.className = 'val'; v.textContent = m.value;
        const t = document.createElement('div'); t.className = 'delta'; t.textContent = m.delta;
        d.append(l, v, t); return d;
      }));
      const rows = document.getElementById('rows');
      rows.replaceChildren(...(data.items || []).map(item => {
        const tr = document.createElement('tr');
        for (const val of [item.name, item.status, item.value]) {
          const td = document.createElement('td'); td.textContent = String(val); tr.append(td);
        }
        return tr;
      }));
    }).catch(() => { document.getElementById('updated').textContent = 'Could not load data.json'; });
  </script>
</body>
</html>`,
    };
  }
  if (scenario === 'webgl') {
    return {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>${tokensLink}
  <style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #090b10; color: #f8fafc; font-family: system-ui, sans-serif; }
    canvas { display: block; width: 100vw; height: 100vh; }
    .hud { position: fixed; left: 32px; bottom: 32px; pointer-events: none; }
    .hud h1 { font-size: 28px; letter-spacing: -0.02em; }
    .hud p { font-size: 14px; color: #cbd5e1; margin-top: 6px; }
  </style>
</head>
<body>
  <canvas id="gl"></canvas>
  <div class="hud"><h1>${safeTitle}</h1><p id="status">WebGL2 shader canvas — move pointer to interact.</p></div>
  <script>
    const canvas = document.getElementById('gl');
    const gl = canvas.getContext('webgl2');
    if (!gl) { document.getElementById('status').textContent = 'WebGL2 is unavailable in this browser.'; }
    else {
      const vs = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vs, '#version 300 es\\nin vec2 p;void main(){gl_Position=vec4(p,0,1);}');
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, '#version 300 es\\nprecision highp float;uniform vec2 u_res,u_ptr;uniform float u_t;out vec4 o;void main(){vec2 uv=gl_FragCoord.xy/u_res;float d=length(uv-u_ptr);float w=0.5+0.5*sin(uv.x*6.0+u_t+d*8.0);vec3 c=mix(vec3(0.06,0.09,0.18),vec3(0.24,0.52,0.96),w*exp(-d*1.4));o=vec4(c,1.0);}');
      gl.compileShader(fs);
      const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const ptr = [0.5, 0.5];
      window.addEventListener('pointermove', e => { ptr[0] = e.clientX / innerWidth; ptr[1] = 1 - e.clientY / innerHeight; });
      const resize = () => { const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; gl.viewport(0, 0, canvas.width, canvas.height); };
      resize(); window.addEventListener('resize', resize);
      let raf = 0;
      const frame = (t) => {
        if (document.hidden) { raf = 0; return; }
        gl.useProgram(prog);
        gl.uniform2f(gl.getUniformLocation(prog, 'u_res'), canvas.width, canvas.height);
        gl.uniform2f(gl.getUniformLocation(prog, 'u_ptr'), ptr[0], ptr[1]);
        gl.uniform1f(gl.getUniformLocation(prog, 'u_t'), t * 0.001);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        raf = requestAnimationFrame(frame);
      };
      document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf) raf = requestAnimationFrame(frame); });
      raf = requestAnimationFrame(frame);
    }
  </script>
</body>
</html>`,
    };
  }
  return {
    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>${tokensLink}
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #f4f5f7; min-height: 100vh; display: grid; place-items: center; padding: 32px; }
    main { max-width: 680px; text-align: center; display: grid; gap: 18px; }
    .badge { display: inline-block; margin: 0 auto; padding: 6px 14px; border-radius: 999px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; background: rgba(124,156,255,0.14); color: #9db7ff; }
    h1 { font-size: clamp(32px, 5vw, 56px); line-height: 1.08; letter-spacing: -0.025em; }
    p { font-size: 17px; line-height: 1.6; color: #a7b0c2; }
  </style>
</head>
<body>
  <main>
    <span class="badge">${scenario === 'web-clone' ? 'Website Clone' : scenario === 'mobile-app' ? 'Mobile App' : 'Prototype'}</span>
    <h1>${safeTitle}</h1>
    <p>This design project is ready for your coding Agent. Use Copy to Agent in Design Studio so Codex or Claude Code can author and iterate on this page through OpenMotion MCP.</p>
  </main>
</body>
</html>`,
  };
}

function inferScenarioFromFiles(files: Map<string, Buffer>, entry: string, hint?: string): DesignScenarioId {
  if (hint && isDesignScenario(hint)) return hint;
  const html = files.get(entry)?.toString('utf8') ?? '';
  if (/od:slide|class=["'][^"']*\b(slide|deck-slide|ppt-slide|slide-frame)\b|data-screen-label/.test(html)) return 'deck';
  if (/getContext\(\s*['"]webgl2?['"]\s*\)/.test(html)) return 'webgl';
  if (files.has('data.json') && (files.has('template.html') || /data\.json/.test(html))) return 'live-artifact';
  if (/@media\s+print/.test(html) && /<article\b/i.test(html)) return 'document';
  return 'prototype';
}

function buildOpenDesignManifest(project: StoredProject, files: DesignFile[]) {
  const all = files.map(f => f.path);
  const html = all.filter(p => /\.(html?)$/i.test(p));
  const css = all.filter(p => /\.css$/i.test(p));
  const scripts = all.filter(p => /\.(js|mjs|ts|tsx|jsx)$/i.test(p));
  const assets = all.filter(p => !html.includes(p) && !css.includes(p) && !scripts.includes(p));
  return {
    schema: 'open-design.design-manifest.v1',
    title: project.title,
    entryFile: project.entry,
    sourceFiles: { all, html, css, scriptsAndComponents: scripts, assets },
    screens: html.map(file => ({
      file,
      role: file === project.entry ? 'landing-page' : 'screen',
      implementationNote: `Exported from OpenMotion Design Studio (${project.scenario})`,
    })),
    responsiveViewports: [
      { id: 'desktop', width: 1440, height: 900 },
      { id: 'tablet', width: 820, height: 1180 },
      { id: 'mobile', width: 390, height: 844 },
    ],
    implementationChecklist: [
      `Entry HTML: ${project.entry}`,
      project.designSystemId ? `Design system: ${project.designSystemId}` : 'Review CSS tokens in project stylesheets',
    ],
  };
}

function buildOpenDesignHandoff(project: StoredProject, files: DesignFile[]) {
  return [
    `# ${project.title} — Design Handoff`,
    '',
    `- Scenario: ${project.scenario}`,
    `- Entry file: \`${project.entry}\``,
    project.designSystemId ? `- Design system: \`${project.designSystemId}\`` : null,
    `- Files: ${files.length}`,
    '',
    'Open this folder or ZIP in Open Design or OpenMotion Design Studio to continue editing.',
  ].filter(Boolean).join('\n');
}

function buildOpenDesignProjectJson(project: StoredProject) {
  return {
    schemaVersion: 1,
    id: project.id,
    name: project.title,
    createdAt: new Date(project.createdAt).toISOString(),
    updatedAt: new Date(project.updatedAt).toISOString(),
    skillId: project.scenario,
    designSystemId: project.designSystemId ?? undefined,
  };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 1500 });
    return true;
  } catch { return false; }
}

type EditorSpec = { id: string; label: string; icon: string; cli?: string; macApp?: string; kind: 'editor' | 'manager' | 'terminal' };
const EDITOR_SPECS: EditorSpec[] = [
  { id: 'cursor', label: 'Cursor', icon: 'code-s-slash-line', cli: 'cursor', macApp: '/Applications/Cursor.app', kind: 'editor' },
  { id: 'vscode', label: 'VS Code', icon: 'code-s-slash-line', cli: 'code', macApp: '/Applications/Visual Studio Code.app', kind: 'editor' },
  { id: 'windsurf', label: 'Windsurf', icon: 'code-s-slash-line', cli: 'windsurf', macApp: '/Applications/Windsurf.app', kind: 'editor' },
  { id: 'zed', label: 'Zed', icon: 'code-s-slash-line', cli: 'zed', macApp: '/Applications/Zed.app', kind: 'editor' },
  { id: 'antigravity', label: 'Antigravity', icon: 'code-s-slash-line', cli: 'agy', macApp: '/Applications/Antigravity.app', kind: 'editor' },
  { id: 'webstorm', label: 'WebStorm', icon: 'code-s-slash-line', cli: 'webstorm', macApp: '/Applications/WebStorm.app', kind: 'editor' },
  { id: 'xcode', label: 'Xcode', icon: 'code-s-slash-line', macApp: '/Applications/Xcode.app', kind: 'editor' },
  { id: 'finder', label: process.platform === 'darwin' ? 'Finder' : process.platform === 'win32' ? 'Explorer' : 'File Manager', icon: 'folder-open-line', kind: 'manager' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal-box-line', macApp: '/System/Applications/Utilities/Terminal.app', kind: 'terminal' },
  { id: 'warp', label: 'Warp', icon: 'terminal-box-line', macApp: '/Applications/Warp.app', kind: 'terminal' },
];

export class DesignProjects {
  readonly root: string;
  private readonly projectsDir: string;
  private readonly versionsDir: string;
  private readonly blobsDir: string;
  private readonly commentsDir: string;
  private readonly requestsDir: string;
  private readonly catalogPath: string;
  private readonly lockPath: string;

  constructor(dataDirectory: string) {
    this.root = path.join(path.resolve(dataDirectory), 'design');
    this.projectsDir = path.join(this.root, 'projects');
    this.versionsDir = path.join(this.root, 'versions');
    this.blobsDir = path.join(this.root, 'blobs');
    this.commentsDir = path.join(this.root, 'comments');
    this.requestsDir = path.join(this.root, 'requests');
    this.catalogPath = path.join(this.root, 'projects.json');
    this.lockPath = path.join(this.root, 'design.lock');
  }

  private async ensureDirs() {
    await Promise.all([this.projectsDir, this.versionsDir, this.blobsDir, this.commentsDir, this.requestsDir].map(dir => mkdir(dir, { recursive: true })));
  }

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureDirs();
    return withProcessLock(this.lockPath, fn);
  }

  projectDir(id: string) { return path.join(this.projectsDir, validateId(id)); }
  private versionPath(id: string) { return path.join(this.versionsDir, `${validateId(id)}.json`); }
  private commentPath(id: string) { return path.join(this.commentsDir, `${validateId(id)}.json`); }
  private receiptPath(scope: string, requestId: string) { return path.join(this.requestsDir, `${sha256(`${scope}:${requestId}`)}.json`); }

  private async readCatalog(): Promise<ProjectCatalogFile> {
    return jsonFile<ProjectCatalogFile>(this.catalogPath, { schemaVersion: 1, projects: [] });
  }

  private async saveCatalog(catalog: ProjectCatalogFile) {
    await atomicJson(this.catalogPath, catalog);
  }

  private async readVersionFile(id: string): Promise<VersionFile> {
    return jsonFile<VersionFile>(this.versionPath(id), { schemaVersion: 1, currentVersionId: null, versions: [] });
  }

  private async readCommentFile(id: string): Promise<CommentFile> {
    return jsonFile<CommentFile>(this.commentPath(id), { schemaVersion: 1, comments: [] });
  }

  private async idempotent<T>(scope: string, requestId: string, input: unknown, work: () => Promise<T>): Promise<T> {
    const file = this.receiptPath(scope, validateRequestId(requestId));
    const inputHash = sha256(JSON.stringify(input ?? null));
    const existing = await jsonFile<RequestReceipt | null>(file, null);
    if (existing) {
      if (existing.inputHash !== inputHash) throw new DesignError('INVALID_ARGUMENT', 'requestId already used with different arguments');
      return existing.result as T;
    }
    const result = await work();
    await atomicJson(file, { inputHash, result });
    return result;
  }

  private async scanFiles(dir: string): Promise<DesignFile[]> {
    const out: DesignFile[] = [];
    const walk = async (rel: string) => {
      let entries;
      try { entries = await readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        const full = path.join(dir, child);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await walk(child); continue; }
        if (!entry.isFile()) continue;
        if (out.length >= MAX_FILES) throw new DesignError('INVALID_ARGUMENT', 'Project exceeds file count limit');
        const bytes = await readFile(full);
        out.push({ path: child, size: bytes.length, sha256: sha256(bytes), kind: fileKind(child) });
      }
    };
    await walk('');
    return out;
  }

  private async retainBlobs(dir: string, files: DesignFile[]) {
    for (const file of files) {
      const target = path.join(this.blobsDir, file.sha256);
      if (existsSync(target)) continue;
      const bytes = await readFile(path.join(dir, file.path));
      const tmp = `${target}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, target);
    }
  }

  private resolveEntryPath(preferred: string | undefined | null, paths: Iterable<string>): string | null {
    const list = [...paths];
    if (preferred && list.includes(preferred)) return preferred;
    if (list.includes('index.html')) return 'index.html';
    const html = list.find(p => fileKind(p) === 'html');
    return html ?? null;
  }

  private async appendVersion(id: string, files: DesignFile[], opts: { source: DesignVersion['source']; summary?: string | null; prompt?: string | null; restoredFrom?: string | null; entry?: string }): Promise<DesignVersion> {
    const dir = this.projectDir(id);
    await this.retainBlobs(dir, files);
    const vf = await this.readVersionFile(id);
    const number = (vf.versions.at(-1)?.number ?? 0) + 1;
    const version: DesignVersion = {
      id: randomUUID(),
      label: `v${number}`,
      number,
      createdAt: Date.now(),
      source: opts.source,
      summary: opts.summary?.trim() || null,
      prompt: opts.prompt?.trim() || null,
      restoredFrom: opts.restoredFrom ?? null,
      ...(opts.entry ? { entry: opts.entry } : {}),
      files: files.map(f => ({ path: f.path, sha256: f.sha256, size: f.size })),
    };
    vf.versions.push(version);
    vf.currentVersionId = version.id;
    await atomicJson(this.versionPath(id), vf);
    return version;
  }

  private async hydrate(stored: StoredProject, origin = ''): Promise<DesignProjectDetail> {
    const dir = this.projectDir(stored.id);
    const files = await this.scanFiles(dir);
    const revision = computeRevision(files);
    const vf = await this.readVersionFile(stored.id);
    const current = vf.versions.find(v => v.id === vf.currentVersionId) ?? vf.versions.at(-1) ?? null;
    const cf = await this.readCommentFile(stored.id);
    const openComments = cf.comments.filter(c => c.status === 'open').length;
    const previewPath = designRoutes.raw(stored.id, stored.entry);
    const editorPath = designEditorHref(stored.id);
    return {
      ...stored,
      revision,
      versionId: current?.id ?? null,
      versionLabel: current?.label ?? null,
      files,
      path: dir,
      previewUrl: origin ? new URL(previewPath, origin).href : previewPath,
      editorUrl: origin ? new URL(editorPath, origin).href : editorPath,
      openComments,
    };
  }

  private async toSummary(stored: StoredProject): Promise<DesignProject> {
    const detail = await this.hydrate(stored);
    const { files: _f, path: _p, previewUrl: _pu, editorUrl: _eu, openComments: _oc, ...summary } = detail;
    return summary;
  }

  async list(opts: { scenario?: string; trashed?: boolean } = {}): Promise<DesignProject[]> {
    const catalog = await this.readCatalog();
    const filtered = catalog.projects
      .filter(p => Boolean(p.trashedAt) === Boolean(opts.trashed))
      .filter(p => !opts.scenario || p.scenario === opts.scenario)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.all(filtered.map(p => this.toSummary(p)));
  }

  async get(id: string, origin = ''): Promise<DesignProjectDetail> {
    const catalog = await this.readCatalog();
    const found = catalog.projects.find(p => p.id === validateId(id));
    if (!found) throw new DesignError('NOT_FOUND', `Design project ${id} not found`);
    return this.hydrate(found, origin);
  }

  async state(id: string): Promise<{ revision: string; versionId: string | null; openComments: number; updatedAt: number }> {
    const detail = await this.get(id);
    return { revision: detail.revision, versionId: detail.versionId, openComments: detail.openComments, updatedAt: detail.updatedAt };
  }

  async create(input: { requestId: string; scenario?: string; title?: string; templateId?: string | null; designSystemId?: string | null }, origin = ''): Promise<DesignProjectDetail> {
    return this.lock(() => this.idempotent('create', input.requestId, { scenario: input.scenario, title: input.title, templateId: input.templateId, designSystemId: input.designSystemId }, async () => {
      const cat = designCatalog();
      const template = input.templateId ? cat.template(input.templateId) : null;
      if (input.templateId && !template) throw new DesignError('NOT_FOUND', `Design template ${input.templateId} not found`);
      const system = input.designSystemId ? cat.system(input.designSystemId) : null;
      if (input.designSystemId && !system) throw new DesignError('NOT_FOUND', `Design system ${input.designSystemId} not found`);

      const scenario: DesignScenarioId = template ? template.scenario : isDesignScenario(input.scenario) ? input.scenario : 'prototype';
      const defaultTitle = template ? template.title : `Untitled ${findDesignScenario(scenario)!.label}`;
      const title = input.title !== undefined ? validateTitle(input.title) : defaultTitle;
      const id = randomUUID();
      const dir = this.projectDir(id);
      await mkdir(dir, { recursive: true });

      let entry = template ? template.entry : findDesignScenario(scenario)!.entry;
      if (template) {
        for (const rel of template.files) {
          const safe = cleanDesignPath(rel);
          const out = path.join(dir, safe);
          await mkdir(path.dirname(out), { recursive: true });
          await copyFile(path.join(template.dir, rel), out);
        }
      } else {
        const files = starterFiles(scenario, title, Boolean(system?.tokensCss));
        for (const [rel, content] of Object.entries(files)) {
          const out = path.join(dir, cleanDesignPath(rel));
          await mkdir(path.dirname(out), { recursive: true });
          await writeFile(out, content, 'utf8');
        }
      }

      if (system) {
        await writeFile(path.join(dir, 'DESIGN.md'), system.designMd, 'utf8');
        if (system.tokensCss) await writeFile(path.join(dir, 'tokens.css'), system.tokensCss, 'utf8');
      }

      const now = Date.now();
      const stored: StoredProject = {
        id, title, scenario, entry,
        designSystemId: system?.id ?? null,
        templateId: template?.id ?? null,
        source: template ? 'template' : 'blank',
        createdAt: now, updatedAt: now, trashedAt: null,
      };
      const catalog = await this.readCatalog();
      catalog.projects.push(stored);
      await this.saveCatalog(catalog);
      const files = await this.scanFiles(dir);
      await this.appendVersion(id, files, { source: 'create', summary: template ? `Created from template ${template.id}` : `Created blank ${scenario}`, entry });
      return this.hydrate(stored, origin);
    }));
  }

  async rename(id: string, input: { title: string; expectedTitle?: string; requestId: string }, origin = ''): Promise<DesignProjectDetail> {
    const pid = validateId(id);
    const title = validateTitle(input.title);
    return this.lock(() => this.idempotent(`rename:${pid}`, input.requestId, { title, expectedTitle: input.expectedTitle }, async () => {
      const catalog = await this.readCatalog();
      const stored = catalog.projects.find(p => p.id === pid);
      if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
      if (input.expectedTitle !== undefined && stored.title !== input.expectedTitle) {
        throw new DesignError('VERSION_CONFLICT', `Expected title "${input.expectedTitle}", current title is "${stored.title}"`);
      }
      stored.title = title;
      stored.updatedAt = Date.now();
      await this.saveCatalog(catalog);
      return this.hydrate(stored, origin);
    }));
  }

  async duplicate(id: string, input: { title?: string; requestId: string }, origin = ''): Promise<DesignProjectDetail> {
    const pid = validateId(id);
    return this.lock(() => this.idempotent(`duplicate:${pid}`, input.requestId, { title: input.title }, async () => {
      const catalog = await this.readCatalog();
      const source = catalog.projects.find(p => p.id === pid && !p.trashedAt);
      if (!source) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
      const newId = randomUUID();
      const srcDir = this.projectDir(pid);
      const dstDir = this.projectDir(newId);
      await mkdir(dstDir, { recursive: true });
      const files = await this.scanFiles(srcDir);
      for (const file of files) {
        const dst = path.join(dstDir, file.path);
        await mkdir(path.dirname(dst), { recursive: true });
        await copyFile(path.join(srcDir, file.path), dst);
      }
      const now = Date.now();
      const stored: StoredProject = {
        ...source,
        id: newId,
        title: input.title ? validateTitle(input.title) : `${source.title} (Copy)`.slice(0, 120),
        source: 'duplicate',
        createdAt: now, updatedAt: now, trashedAt: null,
      };
      catalog.projects.push(stored);
      await this.saveCatalog(catalog);
      await this.appendVersion(newId, files, { source: 'create', summary: `Duplicated from ${source.title}`, entry: stored.entry });
      return this.hydrate(stored, origin);
    }));
  }

  async trash(id: string, requestId: string, origin = ''): Promise<DesignProjectDetail> {
    const pid = validateId(id);
    return this.lock(() => this.idempotent(`trash:${pid}`, requestId, { pid }, async () => {
      const catalog = await this.readCatalog();
      const stored = catalog.projects.find(p => p.id === pid);
      if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
      stored.trashedAt = Date.now();
      stored.updatedAt = stored.trashedAt;
      await this.saveCatalog(catalog);
      return this.hydrate(stored, origin);
    }));
  }

  async restore(id: string, requestId: string, origin = ''): Promise<DesignProjectDetail> {
    const pid = validateId(id);
    return this.lock(() => this.idempotent(`restore:${pid}`, requestId, { pid }, async () => {
      const catalog = await this.readCatalog();
      const stored = catalog.projects.find(p => p.id === pid);
      if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
      stored.trashedAt = null;
      stored.updatedAt = Date.now();
      await this.saveCatalog(catalog);
      return this.hydrate(stored, origin);
    }));
  }

  async remove(id: string, requestId: string): Promise<{ deletedId: string }> {
    const pid = validateId(id);
    return this.lock(() => this.idempotent(`delete:${pid}`, requestId, { pid }, async () => {
      const catalog = await this.readCatalog();
      const idx = catalog.projects.findIndex(p => p.id === pid);
      if (idx === -1) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
      if (!catalog.projects[idx].trashedAt) throw new DesignError('INVALID_ARGUMENT', 'Move the project to Trash before permanent deletion');
      catalog.projects.splice(idx, 1);
      await this.saveCatalog(catalog);
      await Promise.all([
        rm(this.projectDir(pid), { recursive: true, force: true }),
        rm(this.versionPath(pid), { force: true }),
        rm(this.commentPath(pid), { force: true }),
      ]);
      return { deletedId: pid };
    }));
  }

  async readFile(id: string, relPath: string, opts: { offset?: number; limit?: number } = {}): Promise<{ path: string; content: string; revision: string; size: number; nextOffset: number | null }> {
    const detail = await this.get(id);
    const safe = cleanDesignPath(relPath);
    if (!isTextFile(safe)) throw new DesignError('INVALID_ARGUMENT', `File ${safe} is binary and cannot be read as text`);
    const entry = detail.files.find(f => f.path === safe);
    if (!entry) throw new DesignError('NOT_FOUND', `File ${safe} not found`);
    const full = await readFile(path.join(this.projectDir(id), safe), 'utf8');
    const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
    const limit = Math.max(1, Math.min(500_000, Math.floor(Number(opts.limit) || READ_LIMIT_DEFAULT)));
    const slice = full.slice(offset, offset + limit);
    const nextOffset = offset + slice.length < full.length ? offset + slice.length : null;
    return { path: safe, content: slice, revision: detail.revision, size: full.length, nextOffset };
  }

  async readRawFile(id: string, relPath: string, versionId?: string | null): Promise<{ body: Buffer; mime: string }> {
    const pid = validateId(id);
    const catalog = await this.readCatalog();
    const stored = catalog.projects.find(p => p.id === pid);
    if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
    const safe = cleanDesignPath(relPath || stored.entry);
    if (versionId) {
      const vf = await this.readVersionFile(pid);
      const version = vf.versions.find(v => v.id === versionId);
      if (!version) throw new DesignError('NOT_FOUND', `Version ${versionId} not found`);
      const entry = version.files.find(f => f.path === safe);
      if (!entry) throw new DesignError('NOT_FOUND', `File ${safe} not found in ${version.label}`);
      const blob = path.join(this.blobsDir, entry.sha256);
      if (!existsSync(blob)) throw new DesignError('NOT_FOUND', `Retained blob missing for ${safe}`);
      return { body: await readFile(blob), mime: mimeFor(safe) };
    }
    const dir = this.projectDir(pid);
    const target = path.resolve(dir, safe);
    if (!target.startsWith(dir + path.sep) || !existsSync(target)) throw new DesignError('NOT_FOUND', `File ${safe} not found`);
    return { body: await readFile(target), mime: mimeFor(safe) };
  }

  async write(id: string, input: {
    requestId: string; expectedRevision: string; files?: { path: string; content: string }[]; deletes?: string[];
    summary?: string; prompt?: string; source?: 'agent' | 'manual'; entry?: string;
  }, origin = ''): Promise<{ project: DesignProjectDetail; version: DesignVersion }> {
    const pid = validateId(id);
    return this.lock(() => this.idempotent(`write:${pid}`, input.requestId, { expectedRevision: input.expectedRevision, files: input.files, deletes: input.deletes, summary: input.summary, entry: input.entry }, async () => {
      const catalog = await this.readCatalog();
      const stored = catalog.projects.find(p => p.id === pid && !p.trashedAt);
      if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
      const dir = this.projectDir(pid);
      const currentFiles = await this.scanFiles(dir);
      const currentRevision = computeRevision(currentFiles);
      if (input.expectedRevision !== currentRevision) {
        throw new DesignError('VERSION_CONFLICT', `Expected revision ${input.expectedRevision}, current revision is ${currentRevision}`);
      }
      const writes = input.files ?? [];
      const deletes = input.deletes ?? [];
      if (!writes.length && !deletes.length) throw new DesignError('INVALID_ARGUMENT', 'Provide at least one file write or delete');
      if (writes.length + deletes.length > MAX_WRITE_FILES) throw new DesignError('INVALID_ARGUMENT', `At most ${MAX_WRITE_FILES} file changes per write`);

      let totalBytes = 0;
      const prepared: { path: string; bytes: Buffer }[] = [];
      for (const item of writes) {
        const safe = cleanDesignPath(item.path);
        if (!isTextFile(safe)) throw new DesignError('INVALID_ARGUMENT', `Only text files can be written via edit: ${safe}`);
        if (typeof item.content !== 'string') throw new DesignError('INVALID_ARGUMENT', `File content must be a string: ${safe}`);
        const bytes = Buffer.from(item.content, 'utf8');
        totalBytes += bytes.length;
        if (totalBytes > MAX_WRITE_BYTES) throw new DesignError('INVALID_ARGUMENT', 'Write batch exceeds 8 MB limit');
        prepared.push({ path: safe, bytes });
      }
      const cleanDeletes = deletes.map(cleanDesignPath);
      const writtenSet = new Set(prepared.map(item => item.path));
      const overlap = cleanDeletes.find(rel => writtenSet.has(rel));
      if (overlap) {
        throw new DesignError('INVALID_ARGUMENT', `Cannot write and delete the same path in one request: ${overlap}`);
      }
      const requestedEntry = input.entry ? cleanDesignPath(input.entry) : null;
      const projectedPaths = new Set(currentFiles.map(f => f.path));
      for (const rel of cleanDeletes) projectedPaths.delete(rel);
      for (const item of prepared) projectedPaths.add(item.path);
      if (requestedEntry && !projectedPaths.has(requestedEntry)) {
        throw new DesignError('INVALID_ARGUMENT', `Entry file ${requestedEntry} does not exist in project after write`);
      }
      const projectedEntry = requestedEntry ?? this.resolveEntryPath(stored.entry, projectedPaths);
      if (!projectedEntry) {
        throw new DesignError('INVALID_ARGUMENT', 'Write would remove project entry without leaving a valid HTML entry file');
      }

      for (const item of prepared) {
        const full = path.join(dir, item.path);
        await mkdir(path.dirname(full), { recursive: true });
        const tmp = `${full}.${randomUUID()}.tmp`;
        await writeFile(tmp, item.bytes);
        await rename(tmp, full);
      }
      for (const rel of cleanDeletes) {
        await rm(path.join(dir, rel), { force: true });
      }
      const nextFiles = await this.scanFiles(dir);
      const verifiedEntry = this.resolveEntryPath(projectedEntry, nextFiles.map(f => f.path));
      if (!verifiedEntry) {
        throw new DesignError('INVALID_ARGUMENT', 'Write left no valid HTML entry file on disk');
      }
      stored.entry = verifiedEntry;
      stored.updatedAt = Date.now();
      await this.saveCatalog(catalog);
      const version = await this.appendVersion(pid, nextFiles, {
        source: input.source ?? 'agent',
        summary: input.summary ?? `Updated ${writes.length} file(s)`,
        prompt: input.prompt ?? null,
        entry: stored.entry,
      });
      return { project: await this.hydrate(stored, origin), version };
    }));
  }

  async importBinaryFile(id: string, input: {
    requestId: string;
    expectedRevision: string;
    sourcePath: string;
    expectedSha256?: string;
    path?: string;
    name?: string;
    versionId?: string;
    summary?: string;
    source?: 'agent' | 'manual' | 'import';
  }, origin = ''): Promise<{ project: DesignProjectDetail; version: DesignVersion; path: string }> {
    const pid = validateId(id);
    if (typeof input.sourcePath !== 'string' || !input.sourcePath.trim()) {
      throw new DesignError('INVALID_ARGUMENT', 'sourcePath is required');
    }
    const sourceExt = path.extname(input.sourcePath).slice(1).toLowerCase();
    if (!BINARY_IMPORT_EXTS.has(sourceExt)) {
      throw new DesignError('INVALID_ARGUMENT', `Unsupported binary asset extension: .${sourceExt || 'none'}`);
    }
    const defaultSlug = slugifyAssetName(input.name ?? path.basename(input.sourcePath, `.${sourceExt}`));
    const suffix = (input.versionId ?? input.expectedSha256 ?? randomUUID()).slice(0, 8);
    const safePath = cleanDesignPath(input.path ?? `assets/${defaultSlug}-${suffix}.${sourceExt}`);
    const targetExt = path.extname(safePath).slice(1).toLowerCase();
    if (!BINARY_IMPORT_EXTS.has(targetExt)) {
      throw new DesignError('INVALID_ARGUMENT', `Unsupported destination asset extension: .${targetExt || 'none'}`);
    }

    let bytes: Buffer;
    let handle;
    try {
      handle = await open(input.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new DesignError('NOT_FOUND', 'Source asset file not found');
      throw new DesignError('INVALID_ARGUMENT', 'Unable to open source asset file');
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new DesignError('INVALID_ARGUMENT', 'Source asset must be a regular file');
      if (!info.size) throw new DesignError('INVALID_ARGUMENT', 'Source asset file is empty');
      if (info.size > MAX_IMPORT_FILE_BYTES) {
        throw new DesignError('INVALID_ARGUMENT', `Binary asset exceeds ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB limit`);
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        total += chunk.length;
        if (total > MAX_IMPORT_FILE_BYTES) {
          throw new DesignError('INVALID_ARGUMENT', `Binary asset exceeds ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB limit`);
        }
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
    } finally {
      await handle.close();
    }

    const actualSha = sha256(bytes);
    if (input.expectedSha256 && actualSha !== input.expectedSha256) {
      throw new DesignError('INVALID_ARGUMENT', 'Source asset checksum mismatch');
    }

    return this.lock(() => this.idempotent(
      `import-asset:${pid}`,
      input.requestId,
      { expectedRevision: input.expectedRevision, sha256: actualSha, path: safePath },
      async () => {
        const catalog = await this.readCatalog();
        const stored = catalog.projects.find(p => p.id === pid && !p.trashedAt);
        if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
        const dir = this.projectDir(pid);
        const currentFiles = await this.scanFiles(dir);
        const currentRevision = computeRevision(currentFiles);
        if (input.expectedRevision !== currentRevision) {
          throw new DesignError('VERSION_CONFLICT', `Expected revision ${input.expectedRevision}, current revision is ${currentRevision}`);
        }
        if (!currentFiles.some(f => f.path === safePath) && currentFiles.length >= MAX_FILES) {
          throw new DesignError('INVALID_ARGUMENT', 'Project exceeds file count limit');
        }
        const full = path.join(dir, safePath);
        await mkdir(path.dirname(full), { recursive: true });
        const tmp = `${full}.${randomUUID()}.tmp`;
        await writeFile(tmp, bytes);
        await rename(tmp, full);

        const nextFiles = await this.scanFiles(dir);
        stored.updatedAt = Date.now();
        await this.saveCatalog(catalog);
        const version = await this.appendVersion(pid, nextFiles, {
          source: input.source ?? 'manual',
          summary: input.summary ?? `Imported ${safePath}`,
          entry: stored.entry,
        });
        return { project: await this.hydrate(stored, origin), version, path: safePath };
      },
    ));
  }

  async listVersions(id: string, opts: { cursor?: string; limit?: number } = {}): Promise<{ versions: DesignVersion[]; currentVersionId: string | null; nextCursor: string | null }> {
    const pid = validateId(id);
    const catalog = await this.readCatalog();
    if (!catalog.projects.some(p => p.id === pid)) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
    const vf = await this.readVersionFile(pid);
    const reversed = [...vf.versions].reverse();
    const limit = Math.max(1, Math.min(50, Math.floor(Number(opts.limit) || 20)));
    const start = /^\d+$/.test(opts.cursor ?? '') ? Number(opts.cursor) : 0;
    const versions = reversed.slice(start, start + limit);
    return { versions, currentVersionId: vf.currentVersionId, nextCursor: start + limit < reversed.length ? String(start + limit) : null };
  }

  async restoreVersion(id: string, versionId: string, input: { requestId: string; expectedRevision: string }, origin = ''): Promise<{ project: DesignProjectDetail; version: DesignVersion }> {
    const pid = validateId(id);
    return this.lock(() => this.idempotent(`restore-ver:${pid}:${versionId}`, input.requestId, { versionId, expectedRevision: input.expectedRevision }, async () => {
      const catalog = await this.readCatalog();
      const stored = catalog.projects.find(p => p.id === pid && !p.trashedAt);
      if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
      const dir = this.projectDir(pid);
      const currentFiles = await this.scanFiles(dir);
      const currentRevision = computeRevision(currentFiles);
      if (input.expectedRevision !== currentRevision) {
        throw new DesignError('VERSION_CONFLICT', `Expected revision ${input.expectedRevision}, current revision is ${currentRevision}`);
      }
      const vf = await this.readVersionFile(pid);
      const target = vf.versions.find(v => v.id === versionId);
      if (!target) throw new DesignError('NOT_FOUND', `Version ${versionId} not found`);
      // Verify every historical blob exists and snapshot has a valid entry before mutating disk.
      const snapshotPaths = target.files.map(f => cleanDesignPath(f.path));
      const restoredEntry = this.resolveEntryPath(target.entry ?? stored.entry, snapshotPaths) ?? snapshotPaths[0] ?? null;
      if (!restoredEntry) {
        throw new DesignError('INVALID_ARGUMENT', `Snapshot ${target.label} contains no files to restore`);
      }
      for (const file of target.files) {
        if (!existsSync(path.join(this.blobsDir, file.sha256))) {
          throw new DesignError('UNSUPPORTED', `Historical blob missing for ${file.path} in ${target.label}`);
        }
      }
      // Replace project files with snapshot bytes.
      for (const existing of currentFiles) await rm(path.join(dir, existing.path), { force: true });
      for (const file of target.files) {
        const dest = path.join(dir, cleanDesignPath(file.path));
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(path.join(this.blobsDir, file.sha256), dest);
      }
      stored.entry = restoredEntry;
      stored.updatedAt = Date.now();
      await this.saveCatalog(catalog);
      const restoredFiles = await this.scanFiles(dir);
      const version = await this.appendVersion(pid, restoredFiles, {
        source: 'restore',
        summary: `Restored from ${target.label}`,
        restoredFrom: target.id,
        entry: restoredEntry,
      });
      return { project: await this.hydrate(stored, origin), version };
    }));
  }

  async listComments(id: string): Promise<{ comments: DesignComment[]; sourceRevision: string }> {
    const detail = await this.get(id);
    const cf = await this.readCommentFile(id);
    return { comments: cf.comments, sourceRevision: detail.revision };
  }

  async createComment(id: string, input: { requestId: string; text: string; anchor: DesignCommentAnchor; expectedRevision: string; author?: 'user' | 'agent' }): Promise<{ comment: DesignComment; comments: DesignComment[] }> {
    const pid = validateId(id);
    return this.lock(() => this.idempotent(`comment:${pid}`, input.requestId, { text: input.text, anchor: input.anchor, expectedRevision: input.expectedRevision }, async () => {
      const detail = await this.get(pid);
      if (input.expectedRevision !== detail.revision) {
        throw new DesignError('VERSION_CONFLICT', `Expected revision ${input.expectedRevision}, current revision is ${detail.revision}`);
      }
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text || text.length > 4000) throw new DesignError('INVALID_ARGUMENT', 'Comment text must be 1–4000 characters');
      const anchor = input.anchor;
      if (!anchor || typeof anchor !== 'object') throw new DesignError('INVALID_ARGUMENT', 'Comment anchor is required');
      const filePath = cleanDesignPath(anchor.filePath);
      if (!detail.files.some(f => f.path === filePath)) throw new DesignError('INVALID_ARGUMENT', `Anchored file ${filePath} not in project`);
      if (!anchor.viewport || !['desktop', 'tablet', 'mobile'].includes(anchor.viewport.id) || !(anchor.viewport.width > 0) || !(anchor.viewport.height > 0)) {
        throw new DesignError('INVALID_ARGUMENT', 'Valid viewport is required on anchor');
      }
      if (anchor.annotation) {
        try { validateReviewAnnotation(anchor.annotation); } catch (error) {
          throw new DesignError('INVALID_ARGUMENT', (error as Error).message);
        }
      }
      const cf = await this.readCommentFile(pid);
      if (cf.comments.length >= MAX_COMMENTS) throw new DesignError('INVALID_ARGUMENT', 'Comment limit reached');
      const now = Date.now();
      const comment: DesignComment = {
        id: randomUUID(),
        projectId: pid,
        text,
        status: 'open',
        anchor: { ...anchor, filePath },
        sourceRevision: detail.revision,
        author: input.author === 'agent' ? 'agent' : 'user',
        createdAt: now, updatedAt: now, commentRevision: 1,
      };
      cf.comments.push(comment);
      await atomicJson(this.commentPath(pid), cf);
      return { comment, comments: cf.comments };
    }));
  }

  async updateComment(id: string, commentId: string, input: { status?: 'open' | 'resolved'; text?: string; expectedCommentRevision?: number }): Promise<{ comment: DesignComment }> {
    const pid = validateId(id);
    return this.lock(async () => {
      const cf = await this.readCommentFile(pid);
      const comment = cf.comments.find(c => c.id === commentId);
      if (!comment) throw new DesignError('NOT_FOUND', `Comment ${commentId} not found`);
      if (input.expectedCommentRevision !== undefined && comment.commentRevision !== input.expectedCommentRevision) {
        throw new DesignError('COMMENT_CONFLICT', `Expected commentRevision ${input.expectedCommentRevision}, current is ${comment.commentRevision}`);
      }
      if (input.status !== undefined) {
        if (input.status !== 'open' && input.status !== 'resolved') throw new DesignError('INVALID_ARGUMENT', 'Invalid comment status');
        comment.status = input.status;
      }
      if (input.text !== undefined) {
        const text = input.text.trim();
        if (!text || text.length > 4000) throw new DesignError('INVALID_ARGUMENT', 'Comment text must be 1–4000 characters');
        comment.text = text;
      }
      comment.commentRevision += 1;
      comment.updatedAt = Date.now();
      await atomicJson(this.commentPath(pid), cf);
      return { comment };
    });
  }

  async deleteComment(id: string, commentId: string): Promise<{ deletedId: string }> {
    const pid = validateId(id);
    return this.lock(async () => {
      const cf = await this.readCommentFile(pid);
      const idx = cf.comments.findIndex(c => c.id === commentId);
      if (idx === -1) throw new DesignError('NOT_FOUND', `Comment ${commentId} not found`);
      cf.comments.splice(idx, 1);
      await atomicJson(this.commentPath(pid), cf);
      return { deletedId: commentId };
    });
  }

  private async snapshotMap(id: string, versionId?: string | null): Promise<{ stored: StoredProject; files: Map<string, Buffer>; entry: string }> {
    const pid = validateId(id);
    const catalog = await this.readCatalog();
    const stored = catalog.projects.find(p => p.id === pid);
    if (!stored) throw new DesignError('NOT_FOUND', `Design project ${pid} not found`);
    const map = new Map<string, Buffer>();
    let snapshotEntry: string | undefined;
    if (versionId) {
      const vf = await this.readVersionFile(pid);
      const ver = vf.versions.find(v => v.id === versionId);
      if (!ver) throw new DesignError('NOT_FOUND', `Version ${versionId} not found`);
      snapshotEntry = ver.entry;
      for (const file of ver.files) {
        map.set(file.path, await readFile(path.join(this.blobsDir, file.sha256)));
      }
    } else {
      const dir = this.projectDir(pid);
      const scanned = await this.scanFiles(dir);
      for (const file of scanned) map.set(file.path, await readFile(path.join(dir, file.path)));
    }
    const entry = this.resolveEntryPath(snapshotEntry ?? stored.entry, map.keys()) ?? stored.entry;
    return { stored, files: map, entry };
  }

  private inlineHtml(entry: string, files: Map<string, Buffer>): string {
    let html = files.get(entry)?.toString('utf8');
    if (html === undefined) throw new DesignError('NOT_FOUND', `Entry file ${entry} not found`);
    const resolveLocal = (ref: string) => {
      if (/^(?:https?:|data:|blob:|#|mailto:|javascript:)/i.test(ref)) return null;
      const clean = ref.split(/[?#]/)[0];
      const joined = path.posix.normalize(path.posix.join(path.posix.dirname(entry), clean));
      return files.has(joined) ? joined : null;
    };
    const toDataUri = (filePath: string) => `data:${mimeFor(filePath).split(';')[0]};base64,${files.get(filePath)!.toString('base64')}`;
    html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi, (match, href) => {
      const target = resolveLocal(href);
      if (!target) return match;
      const css = files.get(target)!.toString('utf8').replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, u) => {
        const asset = resolveLocal(u);
        return asset ? `url("${toDataUri(asset)}")` : m;
      });
      return `<style data-inlined="${target}">\n${css}\n</style>`;
    });
    html = html.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi, (match, src) => {
      const target = resolveLocal(src);
      if (!target) return match;
      return `<script data-inlined="${target}">\n${files.get(target)!.toString('utf8').replace(/<\/script>/gi, '<\\/script>')}\n</script>`;
    });
    html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (match, pre, src, post) => {
      const target = resolveLocal(src);
      return target ? `${pre}${toDataUri(target)}${post}` : match;
    });
    return html;
  }

  private async withSnapshotServer<T>(files: Map<string, Buffer>, fn: (baseUrl: string) => Promise<T>): Promise<T> {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const body = files.get(rel);
      if (!body) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mimeFor(rel), 'Cache-Control': 'no-store' });
      res.end(body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    try { return await fn(`http://127.0.0.1:${addr.port}`); } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  private async launchHeadless() {
    const executablePath = await browserExecutable();
    if (!executablePath) throw new DesignError('UNSUPPORTED', 'Chrome/Chromium executable not found for visual export');
    const puppeteer = (await import('puppeteer-core')).default;
    return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
  }

  async exportProject(id: string, input: { format: DesignExportFormat; versionId?: string | null; filePath?: string | null }): Promise<{ filename: string; mime: string; data: Buffer }> {
    if (!designExportFormats.includes(input.format)) throw new DesignError('INVALID_ARGUMENT', `Unsupported export format: ${input.format}`);
    const { stored, files, entry: snapshotEntry } = await this.snapshotMap(id, input.versionId);
    const slug = stored.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design-project';
    const entry = input.filePath ? cleanDesignPath(input.filePath) : snapshotEntry;

    if (input.format === 'zip' || input.format === 'open-design') {
      const entries = [...files.entries()].map(([name, data]) => ({ name, data }));
      if (input.format === 'open-design') {
        const list: DesignFile[] = [...files.entries()].map(([p, b]) => ({ path: p, size: b.length, sha256: sha256(b), kind: fileKind(p) }));
        if (!files.has('DESIGN-MANIFEST.json')) {
          entries.push({ name: 'DESIGN-MANIFEST.json', data: Buffer.from(JSON.stringify(buildOpenDesignManifest(stored, list), null, 2), 'utf8') });
        }
        if (!files.has('DESIGN-HANDOFF.md')) {
          entries.push({ name: 'DESIGN-HANDOFF.md', data: Buffer.from(buildOpenDesignHandoff(stored, list), 'utf8') });
        }
        entries.push({ name: '.open-design/project.json', data: Buffer.from(JSON.stringify(buildOpenDesignProjectJson(stored), null, 2), 'utf8') });
      }
      return { filename: `${slug}${input.format === 'open-design' ? '-opendesign' : ''}.zip`, mime: 'application/zip', data: zip(entries) };
    }

    if (input.format === 'html') {
      return { filename: `${slug}.html`, mime: 'text/html; charset=utf-8', data: Buffer.from(this.inlineHtml(entry, files), 'utf8') };
    }

    // Visual exports (PDF, PNG, PPTX) use Chrome via puppeteer-core.
    return this.withSnapshotServer(files, async baseUrl => {
      const browser = await this.launchHeadless();
      try {
        const page = await browser.newPage();
        const isDeck = stored.scenario === 'deck';
        await page.setViewport(isDeck ? { width: 1920, height: 1080, deviceScaleFactor: 1 } : { width: 1440, height: 900, deviceScaleFactor: 2 });
        await page.goto(`${baseUrl}/${encodeURI(entry)}`, { waitUntil: 'networkidle0', timeout: 30_000 });
        await page.evaluate(() => document.fonts?.ready).catch(() => undefined);

        if (input.format === 'png') {
          const buf = Buffer.from(await page.screenshot({ type: 'png', fullPage: !isDeck }));
          return { filename: `${slug}.png`, mime: 'image/png', data: buf };
        }

        if (input.format === 'pdf') {
          const pdf = Buffer.from(await page.pdf(isDeck
            ? { width: '1920px', height: '1080px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }
            : { format: 'A4', printBackground: true, preferCSSPageSize: true }));
          return { filename: `${slug}.pdf`, mime: 'application/pdf', data: pdf };
        }

        // PPTX: capture every slide (via OD deck protocol or slide elements) + speaker notes.
        const slideInfo = await page.evaluate(() => {
          const selector = '.slide, [data-screen-label], .deck-slide, .ppt-slide, .slide-frame';
          const count = document.querySelectorAll(selector).length;
          let notes: string[] = [];
          const script = document.getElementById('speaker-notes');
          if (script?.textContent) {
            try {
              const parsed = JSON.parse(script.textContent);
              notes = Array.isArray(parsed) ? parsed.map(String) : Array.isArray(parsed?.notes) ? parsed.notes.map(String) : [];
            } catch {}
          }
          if (!notes.length) {
            notes = Array.from(document.querySelectorAll(selector)).map(el => el.querySelector('aside.notes, .notes')?.textContent?.trim() ?? '');
          }
          return { count: Math.max(1, count), notes };
        });

        const pptxMod = await import('pptxgenjs');
        const PptxGenJS = ((pptxMod as any).default ?? pptxMod) as new () => any;
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_WIDE';
        pptx.title = stored.title;

        for (let i = 0; i < slideInfo.count; i++) {
          await page.evaluate(index => {
            window.postMessage({ type: 'od:slide', action: 'go', index }, '*');
            const nodes = Array.from(document.querySelectorAll('.slide, [data-screen-label], .deck-slide, .ppt-slide, .slide-frame'));
            if (nodes.length > 1) nodes.forEach((n, idx) => n.classList.toggle('active', idx === index));
          }, i);
          await new Promise(resolve => setTimeout(resolve, 120));
          const shot = Buffer.from(await page.screenshot({ type: 'png' }));
          const slide = pptx.addSlide();
          slide.addImage({ data: `data:image/png;base64,${shot.toString('base64')}`, x: 0, y: 0, w: '100%', h: '100%' });
          if (slideInfo.notes[i]) slide.addNotes(slideInfo.notes[i]);
        }
        const out = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;
        return { filename: `${slug}.pptx`, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', data: Buffer.from(out) };
      } finally {
        await browser.close();
      }
    });
  }

  private async registerImportedFiles(rawEntries: Map<string, Buffer>, titleHint?: string, origin = ''): Promise<DesignProjectDetail> {
    // Strip OS junk and unwrap single enclosing folder when present.
    let entries = new Map([...rawEntries].filter(([name]) => !name.split('/').some(seg => seg === '__MACOSX' || seg === '.DS_Store')));
    const tops = new Set([...entries.keys()].map(k => k.split('/')[0]));
    if (tops.size === 1) {
      const [only] = tops;
      if ([...entries.keys()].every(k => k.startsWith(`${only}/`))) {
        entries = new Map([...entries].map(([k, v]) => [k.slice(only.length + 1), v]));
      }
    }

    // Read Open Design metadata when present before dropping dotfiles.
    let odProject: { name?: string; skillId?: string; designSystemId?: string } = {};
    let odManifest: { title?: string; entryFile?: string } = {};
    const odJsonRaw = entries.get('.open-design/project.json');
    if (odJsonRaw) { try { odProject = JSON.parse(odJsonRaw.toString('utf8')); } catch {} }
    const manifestRaw = entries.get('DESIGN-MANIFEST.json');
    if (manifestRaw) { try { odManifest = JSON.parse(manifestRaw.toString('utf8')); } catch {} }

    const cleaned = new Map<string, Buffer>();
    let totalBytes = 0;
    for (const [rawPath, bytes] of entries) {
      if (rawPath.split('/').some(seg => seg.startsWith('.') || IGNORED_DIRS.has(seg))) continue;
      if (rawPath.endsWith('.artifact.json')) continue;
      let safe: string;
      try { safe = cleanDesignPath(rawPath); } catch { continue; }
      const ext = path.extname(safe).slice(1).toLowerCase();
      if (!IMPORT_EXTS.has(ext) && !/^(license|notice|readme)(\.|$)/i.test(path.basename(safe))) continue;
      if (bytes.length > MAX_IMPORT_FILE_BYTES) throw new DesignError('INVALID_ARGUMENT', `Imported file exceeds 25 MB: ${safe}`);
      totalBytes += bytes.length;
      if (totalBytes > MAX_IMPORT_BYTES) throw new DesignError('INVALID_ARGUMENT', 'Imported archive exceeds 100 MB limit');
      if (cleaned.size >= MAX_FILES) throw new DesignError('INVALID_ARGUMENT', 'Imported archive exceeds file limit');
      cleaned.set(safe, bytes);
    }
    if (!cleaned.size) throw new DesignError('INVALID_ARGUMENT', 'No supported design files found in archive');

    const htmlFiles = [...cleaned.keys()].filter(k => /\.html?$/i.test(k)).sort();
    const manifestEntry = odManifest.entryFile && cleaned.has(odManifest.entryFile) ? odManifest.entryFile : null;
    const entry = manifestEntry ?? (cleaned.has('index.html') ? 'index.html' : null)
      ?? htmlFiles.find(f => !f.includes('/')) ?? htmlFiles[0] ?? [...cleaned.keys()][0];

    const title = validateTitle((odProject.name || odManifest.title || titleHint || 'Imported design').slice(0, 120));
    const scenario = inferScenarioFromFiles(cleaned, entry, odProject.skillId);
    const id = randomUUID();
    const dir = this.projectDir(id);
    await mkdir(dir, { recursive: true });
    for (const [rel, bytes] of cleaned) {
      const out = path.join(dir, rel);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, bytes);
    }

    const now = Date.now();
    const stored: StoredProject = {
      id, title, scenario, entry,
      designSystemId: odProject.designSystemId && designCatalog().system(odProject.designSystemId) ? odProject.designSystemId : null,
      templateId: null,
      source: 'import',
      createdAt: now, updatedAt: now, trashedAt: null,
    };
    const catalog = await this.readCatalog();
    catalog.projects.push(stored);
    await this.saveCatalog(catalog);
    const scanned = await this.scanFiles(dir);
    await this.appendVersion(id, scanned, { source: 'import', summary: `Imported ${scanned.length} file(s)`, entry });
    return this.hydrate(stored, origin);
  }

  async importZip(data: Buffer, opts: { titleHint?: string; origin?: string } = {}): Promise<DesignProjectDetail[]> {
    if (data.length > MAX_IMPORT_BYTES) throw new DesignError('INVALID_ARGUMENT', 'ZIP exceeds 100 MB limit');
    let entries: Map<string, Buffer>;
    try { entries = readProjectZip(data); } catch (error) { throw new DesignError('INVALID_ARGUMENT', (error as Error).message); }
    return this.lock(async () => [await this.registerImportedFiles(entries, opts.titleHint, opts.origin)]);
  }

  async importPath(sourcePath: string, opts: { titleHint?: string; origin?: string } = {}): Promise<DesignProjectDetail[]> {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new DesignError('INVALID_ARGUMENT', 'sourcePath is required');
    const resolved = await realpath(sourcePath).catch(() => { throw new DesignError('NOT_FOUND', `Source path not found: ${sourcePath}`); });
    const info = await stat(resolved);
    if (info.isFile()) {
      const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (info.size > MAX_IMPORT_BYTES) throw new DesignError('INVALID_ARGUMENT', 'ZIP exceeds 100 MB limit');
        const data = await handle.readFile();
        return this.importZip(data, { titleHint: opts.titleHint ?? path.basename(resolved, path.extname(resolved)), origin: opts.origin });
      } finally { await handle.close(); }
    }
    if (!info.isDirectory()) throw new DesignError('INVALID_ARGUMENT', 'sourcePath must be a ZIP file or folder');
    const map = new Map<string, Buffer>();
    const walk = async (rel: string) => {
      const items = await readdir(path.join(resolved, rel), { withFileTypes: true });
      for (const item of items) {
        if (item.isSymbolicLink() || IGNORED_DIRS.has(item.name)) continue;
        const child = rel ? `${rel}/${item.name}` : item.name;
        if (item.isDirectory()) {
          if (item.name.startsWith('.') && child !== '.open-design') continue;
          await walk(child);
        } else if (item.isFile()) {
          if (item.name.startsWith('.')) continue;
          const bytes = await readFile(path.join(resolved, child));
          map.set(child, bytes);
        }
      }
    };
    await walk('');
    return this.lock(async () => [await this.registerImportedFiles(map, opts.titleHint ?? path.basename(resolved), opts.origin)]);
  }

  async detectEditors(): Promise<DesignEditorApp[]> {
    const out: DesignEditorApp[] = [];
    for (const spec of EDITOR_SPECS) {
      let available = false;
      if (spec.kind === 'manager') available = true;
      else if (process.platform === 'darwin' && spec.macApp && existsSync(spec.macApp)) available = true;
      else if (spec.cli) available = await commandExists(spec.cli);
      else if (spec.id === 'terminal' && process.platform !== 'darwin') available = await commandExists('x-terminal-emulator');
      out.push({ id: spec.id, label: spec.label, icon: spec.icon, available });
    }
    return out;
  }

  async openIn(id: string, editorId: string): Promise<{ ok: true }> {
    const detail = await this.get(id);
    const spec = EDITOR_SPECS.find(e => e.id === editorId);
    if (!spec) throw new DesignError('INVALID_ARGUMENT', `Unknown editor: ${editorId}`);
    const dir = detail.path;
    const launch = (cmd: string, args: string[]) => {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.unref();
    };
    if (spec.kind === 'manager') {
      if (process.platform === 'darwin') launch('open', [dir]);
      else if (process.platform === 'win32') launch('explorer', [dir]);
      else launch('xdg-open', [dir]);
      return { ok: true };
    }
    if (process.platform === 'darwin' && spec.macApp && existsSync(spec.macApp)) {
      launch('open', ['-a', spec.macApp, dir]);
      return { ok: true };
    }
    if (spec.cli && await commandExists(spec.cli)) {
      launch(spec.cli, [dir]);
      return { ok: true };
    }
    throw new DesignError('UNSUPPORTED', `${spec.label} is not installed on this machine`);
  }
}

const instances = new Map<string, DesignProjects>();
export function designProjectsFor(dataDirectory: string): DesignProjects {
  const key = path.resolve(dataDirectory);
  let inst = instances.get(key);
  if (!inst) instances.set(key, inst = new DesignProjects(key));
  return inst;
}

/** Parse a single uploaded file from multipart/form-data without external dependencies. */
async function readMultipartZip(req: IncomingMessage, maxBytes = MAX_IMPORT_BYTES): Promise<{ filename: string; data: Buffer }> {
  const ct = req.headers['content-type'] ?? '';
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(ct);
  if (!match) throw new DesignError('INVALID_ARGUMENT', 'Missing multipart boundary');
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes + 1024 * 1024) throw new DesignError('INVALID_ARGUMENT', 'Upload exceeds size limit');
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  let pos = body.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = body.subarray(start, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd + 4);
    if (next === -1) break;
    const filenameMatch = /filename="([^"]+)"/i.exec(headers);
    if (filenameMatch) {
      // Strip trailing CRLF before the next boundary.
      const data = body.subarray(headerEnd + 4, next - 2);
      return { filename: filenameMatch[1], data: Buffer.from(data) };
    }
    pos = next;
  }
  throw new DesignError('INVALID_ARGUMENT', 'No file part found in multipart upload');
}

/** HTTP adapter mounted by server.ts for /motion-api/design/* (rewritten to /api/design/*). */
const THUMB_PERF_SCRIPT = `<style data-om-thumb-style>html:not([data-om-thumb-play="1"]) *,html:not([data-om-thumb-play="1"]) *::before,html:not([data-om-thumb-play="1"]) *::after{animation-play-state:paused!important;transition:none!important;}</style><script data-om-thumb-guard>(function(){try{Object.defineProperty(window,'devicePixelRatio',{get:function(){return 1;},configurable:true});}catch(e){}var nRaf=window.requestAnimationFrame.bind(window),nCaf=window.cancelAnimationFrame.bind(window);var playing=false,budget=3,q=[],nextId=1;window.requestAnimationFrame=function(cb){if(playing||budget>0){if(!playing)budget--;return nRaf(cb);}var id=nextId++;q.push({id:id,cb:cb});return id;};window.cancelAnimationFrame=function(id){nCaf(id);q=q.filter(function(x){return x.id!==id;});};window.addEventListener('message',function(e){var d=e.data;if(!d||d.type!=='om:thumb-play')return;playing=Boolean(d.play);document.documentElement.setAttribute('data-om-thumb-play',playing?'1':'0');if(playing&&q.length){var batch=q.splice(0,q.length);for(var i=0;i<batch.length;i++)nRaf(batch[i].cb);}});})();</script>`;

const THUMB_READY_SCRIPT = `<script data-om-thumb-ready>window.addEventListener('load',function(){window.parent.postMessage({type:'om:thumb-ready'},'*');},{once:true});</script>`;

function injectThumbPerfGuard(buf: Buffer, notifyReady = false): Buffer {
  const html = buf.toString('utf8');
  const scripts = THUMB_PERF_SCRIPT + (notifyReady ? THUMB_READY_SCRIPT : '');
  const injected = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, m => `${m}\n${scripts}`)
    : `${scripts}\n${html}`;
  return Buffer.from(injected, 'utf8');
}

async function importResolvedAsset(
  service: DesignProjects,
  projectId: string,
  input: {
    requestId: string;
    expectedRevision: string;
    assetId: string;
    versionId: string;
    path?: string;
    summary?: string;
    source: 'agent' | 'manual';
  },
  origin: string,
  resolveAsset?: DesignAssetResolver,
) {
  if (!resolveAsset) throw new DesignError('UNSUPPORTED', 'Workspace asset import is not available in this context');
  if (!input.expectedRevision || !input.assetId || !input.versionId) {
    throw new DesignError('INVALID_ARGUMENT', 'expectedRevision, assetId and versionId are required');
  }
  let resolved;
  try {
    resolved = await resolveAsset({ assetId: input.assetId, versionId: input.versionId });
  } catch (error) {
    const message = (error as Error)?.message ?? 'Workspace asset not found';
    if (/ASSET_NOT_FOUND|ASSET_VERSION_UNAVAILABLE/i.test(message)) {
      throw new DesignError('NOT_FOUND', message);
    }
    throw error;
  }
  const ext = path.extname(resolved.filename).toLowerCase();
  const slug = slugifyAssetName(resolved.asset.name || resolved.version.name || 'asset');
  const defaultPath = `assets/${slug}-${resolved.version.id.slice(0, 8)}${ext}`;
  return service.importBinaryFile(projectId, {
    requestId: input.requestId,
    expectedRevision: input.expectedRevision,
    sourcePath: resolved.filename,
    expectedSha256: resolved.version.sha256,
    path: input.path ?? defaultPath,
    name: resolved.asset.name,
    versionId: resolved.version.id,
    summary: input.summary ?? `Imported asset ${resolved.asset.name}`,
    source: input.source,
  }, origin);
}

export async function designHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dataDirectory: string,
  origin: string,
  input: (req: IncomingMessage, limit?: number) => Promise<any>,
  resolveAsset?: DesignAssetResolver,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/design/')) return false;
  const service = designProjectsFor(dataDirectory);
  const catalog = designCatalog();
  const sendJson = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
    return true;
  };
  const sendError = (error: unknown) => {
    if (error instanceof DesignError) return sendJson(error.status, { error: { code: error.code, message: error.message.replace(/^[A-Z_]+:\s*/, '') } });
    return sendJson(500, { error: { code: 'INVALID_ARGUMENT', message: (error as Error)?.message ?? 'Internal error' } });
  };

  try {
    const sub = url.pathname.slice('/api/design/'.length);

    // --- Catalog routes ---
    if (sub === 'catalog/scenarios' && req.method === 'GET') {
      return sendJson(200, { scenarios: catalog.scenarios() });
    }
    if (sub === 'catalog/templates' && req.method === 'GET') {
      return sendJson(200, catalog.templates({
        scenario: url.searchParams.get('scenario') ?? undefined,
        q: url.searchParams.get('q') ?? undefined,
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
      }));
    }
    const tplPreview = /^catalog\/templates\/([^/]+)\/preview\/(.*)$/.exec(sub);
    if (tplPreview && req.method === 'GET') {
      const id = decodeURIComponent(tplPreview[1]);
      const rel = decodeURIComponent(tplPreview[2]);
      const file = catalog.templateFile(id, rel);
      if (!file) return sendJson(404, { error: { code: 'NOT_FOUND', message: 'Template preview file not found' } });
      const mime = mimeFor(file);
      let data: Buffer = await readFile(file);
      if (url.searchParams.get('thumb') === '1' && mime.startsWith('text/html')) data = injectThumbPerfGuard(data, url.searchParams.get('thumbReady') === '1');
      const headers: Record<string, string> = { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' };
      if (mime.startsWith('text/html')) headers['Content-Security-Policy'] = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads';
      res.writeHead(200, headers);
      res.end(data);
      return true;
    }
    const tplDetail = /^catalog\/templates\/([^/]+)$/.exec(sub);
    if (tplDetail && req.method === 'GET') {
      const detail = catalog.template(decodeURIComponent(tplDetail[1]));
      return detail ? sendJson(200, { template: detail }) : sendJson(404, { error: { code: 'NOT_FOUND', message: 'Template not found' } });
    }
    if (sub === 'catalog/systems' && req.method === 'GET') {
      return sendJson(200, { systems: catalog.systems({ q: url.searchParams.get('q') ?? undefined, category: url.searchParams.get('category') ?? undefined }) });
    }
    const sysDetail = /^catalog\/systems\/([^/]+)$/.exec(sub);
    if (sysDetail && req.method === 'GET') {
      const detail = catalog.system(decodeURIComponent(sysDetail[1]));
      return detail ? sendJson(200, { system: detail }) : sendJson(404, { error: { code: 'NOT_FOUND', message: 'Design system not found' } });
    }
    if (sub === 'catalog/skills' && req.method === 'GET') {
      return sendJson(200, { skills: catalog.skills({ scenario: url.searchParams.get('scenario') ?? undefined, q: url.searchParams.get('q') ?? undefined }) });
    }

    // --- Editors & Import ---
    if (sub === 'editors' && req.method === 'GET') {
      return sendJson(200, { editors: await service.detectEditors() });
    }
    if (sub === 'import' && req.method === 'POST') {
      const ct = req.headers['content-type'] ?? '';
      if (ct.includes('multipart/form-data')) {
        const { filename, data } = await readMultipartZip(req);
        const projects = await service.importZip(data, { titleHint: path.basename(filename, path.extname(filename)), origin });
        return sendJson(200, { projects });
      }
      const body = await input(req, 64 * 1024);
      const projects = await service.importPath(body?.sourcePath, { titleHint: body?.title, origin });
      return sendJson(200, { projects });
    }

    // --- Raw static preview (current or historical ?version=) ---
    const rawMatch = /^raw\/([^/]+)\/(.*)$/.exec(sub);
    if (rawMatch && req.method === 'GET') {
      const { body, mime } = await service.readRawFile(rawMatch[1], decodeURIComponent(rawMatch[2]), url.searchParams.get('version'));
      const out = url.searchParams.get('thumb') === '1' && mime.startsWith('text/html') ? injectThumbPerfGuard(body) : body;
      const headers: Record<string, string> = { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      if (mime.startsWith('text/html')) headers['Content-Security-Policy'] = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads';
      res.writeHead(200, headers);
      res.end(out);
      return true;
    }

    // --- Projects collection ---
    if (sub === 'projects' && req.method === 'GET') {
      const projects = await service.list({ scenario: url.searchParams.get('scenario') ?? undefined, trashed: url.searchParams.get('trashed') === '1' });
      return sendJson(200, { projects });
    }
    if (sub === 'projects' && req.method === 'POST') {
      const body = await input(req, 128 * 1024);
      const project = await service.create({ ...body, requestId: body?.requestId || randomUUID() }, origin);
      return sendJson(200, { project });
    }

    // --- Single project & sub-resources ---
    const projBase = /^projects\/([^/]+)$/.exec(sub);
    if (projBase) {
      const id = projBase[1];
      if (req.method === 'GET') return sendJson(200, { project: await service.get(id, origin) });
      if (req.method === 'PATCH') {
        const body = await input(req, 32 * 1024);
        return sendJson(200, { project: await service.rename(id, { ...body, requestId: body?.requestId || randomUUID() }, origin) });
      }
      if (req.method === 'DELETE') {
        const requestId = url.searchParams.get('requestId') || randomUUID();
        return sendJson(200, await service.remove(id, requestId));
      }
    }

    const projState = /^projects\/([^/]+)\/state$/.exec(sub);
    if (projState && req.method === 'GET') return sendJson(200, await service.state(projState[1]));

    const projAction = /^projects\/([^/]+)\/(duplicate|trash|restore|open-in|reveal)$/.exec(sub);
    if (projAction && req.method === 'POST') {
      const [, id, action] = projAction;
      const body = await input(req, 32 * 1024).catch(() => ({}));
      const requestId = body?.requestId || randomUUID();
      if (action === 'duplicate') return sendJson(200, { project: await service.duplicate(id, { title: body?.title, requestId }, origin) });
      if (action === 'trash') return sendJson(200, { project: await service.trash(id, requestId, origin) });
      if (action === 'restore') return sendJson(200, { project: await service.restore(id, requestId, origin) });
      if (action === 'reveal') return sendJson(200, await service.openIn(id, 'finder'));
      if (action === 'open-in') return sendJson(200, await service.openIn(id, body?.editorId));
    }

    const fileMatch = /^projects\/([^/]+)\/files\/(.+)$/.exec(sub);
    if (fileMatch && req.method === 'GET') {
      return sendJson(200, await service.readFile(fileMatch[1], decodeURIComponent(fileMatch[2]), {
        offset: url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined,
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined,
      }));
    }

    const writeMatch = /^projects\/([^/]+)\/write$/.exec(sub);
    if (writeMatch && req.method === 'POST') {
      const body = await input(req, MAX_WRITE_BYTES + 256 * 1024);
      return sendJson(200, await service.write(writeMatch[1], { ...body, requestId: body?.requestId || randomUUID() }, origin));
    }

    const importAssetMatch = /^projects\/([^/]+)\/import-asset$/.exec(sub);
    if (importAssetMatch && req.method === 'POST') {
      const body = await input(req, 32 * 1024);
      return sendJson(200, await importResolvedAsset(service, importAssetMatch[1], {
        requestId: body?.requestId || randomUUID(),
        expectedRevision: body?.expectedRevision,
        assetId: body?.assetId,
        versionId: body?.versionId,
        path: body?.path,
        summary: body?.summary,
        source: 'manual',
      }, origin, resolveAsset));
    }

    const versionsMatch = /^projects\/([^/]+)\/versions$/.exec(sub);
    if (versionsMatch && req.method === 'GET') {
      return sendJson(200, await service.listVersions(versionsMatch[1], { cursor: url.searchParams.get('cursor') ?? undefined }));
    }

    const restoreVer = /^projects\/([^/]+)\/versions\/([^/]+)\/restore$/.exec(sub);
    if (restoreVer && req.method === 'POST') {
      const body = await input(req, 32 * 1024);
      return sendJson(200, await service.restoreVersion(restoreVer[1], restoreVer[2], { ...body, requestId: body?.requestId || randomUUID() }, origin));
    }

    const commentsMatch = /^projects\/([^/]+)\/comments$/.exec(sub);
    if (commentsMatch) {
      const id = commentsMatch[1];
      if (req.method === 'GET') return sendJson(200, await service.listComments(id));
      if (req.method === 'POST') {
        const body = await input(req, 256 * 1024);
        return sendJson(200, await service.createComment(id, { ...body, requestId: body?.requestId || randomUUID() }));
      }
    }

    const commentItem = /^projects\/([^/]+)\/comments\/([^/]+)$/.exec(sub);
    if (commentItem) {
      const [, id, commentId] = commentItem;
      if (req.method === 'PATCH') return sendJson(200, await service.updateComment(id, commentId, await input(req, 64 * 1024)));
      if (req.method === 'DELETE') return sendJson(200, await service.deleteComment(id, commentId));
    }

    const exportMatch = /^projects\/([^/]+)\/export$/.exec(sub);
    if (exportMatch && req.method === 'POST') {
      const body = await input(req, 32 * 1024);
      const result = await service.exportProject(exportMatch[1], body ?? {});
      res.writeHead(200, {
        'Content-Type': result.mime,
        'Content-Disposition': attachmentDisposition(result.filename),
        'Content-Length': result.data.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(result.data);
      return true;
    }

    return sendJson(404, { error: { code: 'NOT_FOUND', message: `Unknown design endpoint: ${url.pathname}` } });
  } catch (error) {
    return sendError(error);
  }
}

export async function dispatchDesignTool(
  name: string,
  args: any,
  dataDirectory: string,
  origin: string,
  resolveAsset?: DesignAssetResolver,
): Promise<unknown> {
  const service = designProjectsFor(dataDirectory);
  const catalog = designCatalog();

  if (name === 'motion_design_catalog') {
    switch (args.action) {
      case 'list_scenarios': return { scenarios: catalog.scenarios() };
      case 'list_templates': return catalog.templates({ scenario: args.scenario, q: args.q, limit: args.limit, cursor: args.cursor });
      case 'get_template': {
        if (!args.id) throw new DesignError('INVALID_ARGUMENT', 'id is required');
        const detail = catalog.template(args.id);
        if (!detail) throw new DesignError('NOT_FOUND', `Design template ${args.id} not found`);
        const entryContent = await readFile(path.join(detail.dir, detail.entry), 'utf8').catch(() => null);
        return { template: detail, entryContent };
      }
      case 'list_skills': return { skills: catalog.skills({ scenario: args.scenario, q: args.q }) };
      case 'get_skill': {
        if (!args.id) throw new DesignError('INVALID_ARGUMENT', 'id is required');
        if (args.referencePath) {
          const ref = catalog.skillReference(args.id, args.referencePath);
          if (ref === null) throw new DesignError('NOT_FOUND', `Skill reference ${args.id}/${args.referencePath} not found`);
          return { id: args.id, referencePath: args.referencePath, content: ref };
        }
        const detail = catalog.skill(args.id);
        if (!detail) throw new DesignError('NOT_FOUND', `Design skill ${args.id} not found`);
        return { skill: detail };
      }
      case 'list_design_systems': return { systems: catalog.systems({ q: args.q, category: args.category }) };
      case 'get_design_system': {
        if (!args.id) throw new DesignError('INVALID_ARGUMENT', 'id is required');
        const detail = catalog.system(args.id);
        if (!detail) throw new DesignError('NOT_FOUND', `Design system ${args.id} not found`);
        return { system: detail };
      }
      case 'get_craft': {
        if (!args.id) return { craft: catalog.craft() };
        const content = catalog.craftDoc(args.id);
        if (content === null) throw new DesignError('NOT_FOUND', `Craft guide ${args.id} not found`);
        return { id: args.id, content };
      }
      default: throw new DesignError('INVALID_ARGUMENT', `Unknown catalog action: ${args.action}`);
    }
  }

  if (name === 'motion_design_project') {
    switch (args.action) {
      case 'create': {
        const project = await service.create({
          requestId: args.requestId || randomUUID(),
          scenario: args.scenario, title: args.title, templateId: args.templateId, designSystemId: args.designSystemId,
        }, origin);
        return { project };
      }
      case 'list': return { projects: await service.list({ scenario: args.scenario, trashed: args.trashed }) };
      case 'get': {
        if (!args.projectId) throw new DesignError('INVALID_ARGUMENT', 'projectId is required');
        return { project: await service.get(args.projectId, origin) };
      }
      case 'rename': {
        if (!args.projectId || !args.title) throw new DesignError('INVALID_ARGUMENT', 'projectId and title are required');
        return { project: await service.rename(args.projectId, { title: args.title, expectedTitle: args.expectedTitle, requestId: args.requestId || randomUUID() }, origin) };
      }
      case 'duplicate': {
        if (!args.projectId) throw new DesignError('INVALID_ARGUMENT', 'projectId is required');
        return { project: await service.duplicate(args.projectId, { title: args.title, requestId: args.requestId || randomUUID() }, origin) };
      }
      case 'trash': {
        if (!args.projectId) throw new DesignError('INVALID_ARGUMENT', 'projectId is required');
        return { project: await service.trash(args.projectId, args.requestId || randomUUID(), origin) };
      }
      case 'restore': {
        if (!args.projectId) throw new DesignError('INVALID_ARGUMENT', 'projectId is required');
        return { project: await service.restore(args.projectId, args.requestId || randomUUID(), origin) };
      }
      case 'delete': {
        if (!args.projectId) throw new DesignError('INVALID_ARGUMENT', 'projectId is required');
        return service.remove(args.projectId, args.requestId || randomUUID());
      }
      case 'open': {
        if (!args.projectId) throw new DesignError('INVALID_ARGUMENT', 'projectId is required');
        const project = await service.get(args.projectId, origin);
        return {
          projectId: project.id, title: project.title, scenario: project.scenario,
          revision: project.revision, versionId: project.versionId, versionLabel: project.versionLabel,
          previewUrl: project.previewUrl, editorUrl: project.editorUrl, openComments: project.openComments,
        };
      }
      case 'open_in': {
        if (!args.projectId) throw new DesignError('INVALID_ARGUMENT', 'projectId is required');
        if (!args.editorId) return { editors: await service.detectEditors() };
        return service.openIn(args.projectId, args.editorId);
      }
      case 'export': {
        if (!args.projectId || !args.format) throw new DesignError('INVALID_ARGUMENT', 'projectId and format are required');
        const exported = await service.exportProject(args.projectId, { format: args.format, versionId: args.versionId, filePath: args.filePath });
        const exportDir = path.join(service.root, 'exports');
        await mkdir(exportDir, { recursive: true });
        const outPath = args.outputPath ? path.resolve(args.outputPath) : path.join(exportDir, `${Date.now()}-${exported.filename}`);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, exported.data);
        return { projectId: args.projectId, format: args.format, filename: exported.filename, mime: exported.mime, bytes: exported.data.length, outputPath: outPath };
      }
      case 'import': {
        if (!args.sourcePath) throw new DesignError('INVALID_ARGUMENT', 'sourcePath is required');
        const projects = await service.importPath(args.sourcePath, { titleHint: args.title, origin });
        return { projects };
      }
      default: throw new DesignError('INVALID_ARGUMENT', `Unknown project action: ${args.action}`);
    }
  }

  if (name === 'motion_design_edit') {
    switch (args.action) {
      case 'read_file': {
        if (!args.path) throw new DesignError('INVALID_ARGUMENT', 'path is required');
        return service.readFile(args.projectId, args.path, { offset: args.offset, limit: args.limit });
      }
      case 'write': {
        if (!args.expectedRevision) throw new DesignError('INVALID_ARGUMENT', 'expectedRevision is required');
        return service.write(args.projectId, {
          requestId: args.requestId || randomUUID(),
          expectedRevision: args.expectedRevision,
          files: args.files, deletes: args.deletes, entry: args.entry,
          summary: args.summary, prompt: args.prompt, source: 'agent',
        }, origin);
      }
      case 'list_versions': return service.listVersions(args.projectId, { cursor: args.cursor });
      case 'restore_version': {
        if (!args.versionId || !args.expectedRevision) throw new DesignError('INVALID_ARGUMENT', 'versionId and expectedRevision are required');
        return service.restoreVersion(args.projectId, args.versionId, { requestId: args.requestId || randomUUID(), expectedRevision: args.expectedRevision }, origin);
      }
      case 'import_asset': {
        return importResolvedAsset(service, args.projectId, {
          requestId: args.requestId || randomUUID(),
          expectedRevision: args.expectedRevision,
          assetId: args.assetId,
          versionId: args.versionId,
          path: args.path,
          summary: args.summary,
          source: 'agent',
        }, origin, resolveAsset);
      }
      default: throw new DesignError('INVALID_ARGUMENT', `Unknown edit action: ${args.action}`);
    }
  }

  if (name === 'motion_design_comments') {
    switch (args.action) {
      case 'list': return service.listComments(args.projectId);
      case 'create': {
        if (!args.text || !args.anchor || !args.expectedRevision) throw new DesignError('INVALID_ARGUMENT', 'text, anchor and expectedRevision are required');
        return service.createComment(args.projectId, {
          requestId: args.requestId || randomUUID(),
          text: args.text, anchor: args.anchor, expectedRevision: args.expectedRevision, author: 'agent',
        });
      }
      case 'update': {
        if (!args.commentId) throw new DesignError('INVALID_ARGUMENT', 'commentId is required');
        return service.updateComment(args.projectId, args.commentId, {
          status: args.status, text: args.text, expectedCommentRevision: args.expectedCommentRevision,
        });
      }
      case 'delete': {
        if (!args.commentId) throw new DesignError('INVALID_ARGUMENT', 'commentId is required');
        return service.deleteComment(args.projectId, args.commentId);
      }
      default: throw new DesignError('INVALID_ARGUMENT', `Unknown comments action: ${args.action}`);
    }
  }

  throw new DesignError('INVALID_ARGUMENT', `Unknown design tool: ${name}`);
}

export { designScenarios };
