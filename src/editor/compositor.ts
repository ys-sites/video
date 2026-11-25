// Draws one moment of the edit onto a canvas. Used by both the live preview and the MP4 export,
// so the export matches what the user saw.
import { LOOKS, type Project, type Word } from './project';

export type OutWord = Word & { i: number; os: number; oe: number };
export type Chunk = { words: OutWord[]; s: number; e: number };

const SANS = "'Segoe UI', Inter, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

/** Group spoken words into short caption chunks (max 3 words, break on pauses and punctuation). */
export function captionChunks(words: OutWord[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: OutWord[] = [];
  const flush = () => { if (cur.length) chunks.push({ words: cur, s: cur[0].os, e: cur[cur.length - 1].oe }); cur = []; };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= 3 || w.os - prev.oe > 0.35 || /[.!?,;:]$/.test(prev.w))) flush();
    cur.push(w);
  }
  flush();
  return chunks;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function zoomAt(p: Project, t: number) {
  let scale = 1;
  for (const z of p.zooms) {
    if (t < z.at || t > z.at + z.dur) continue;
    const ramp = Math.min(0.25, z.dur / 3);
    const k = t < z.at + ramp ? ease((t - z.at) / ramp) : t > z.at + z.dur - ramp ? ease((z.at + z.dur - t) / ramp) : 1;
    scale = Math.max(scale, 1 + (z.scale - 1) * k);
  }
  return scale;
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, scale = 1, focusY = 0.42) {
  const k = Math.max(W / sw, H / sh) * scale;
  const dw = sw * k, dh = sh * k;
  const dx = (W - dw) / 2;
  const dy = Math.min(0, Math.max(H - dh, H * focusY - dh * focusY));
  ctx.drawImage(src, dx, dy, dw, dh);
}
function drawContain(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, W: number, H: number, scale = 1) {
  const k = Math.min(W / sw, H / sh) * scale;
  const dw = sw * k, dh = sh * k;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawCaptions(ctx: CanvasRenderingContext2D, p: Project, chunks: Chunk[], t: number, W: number, H: number) {
  const chunk = chunks.find(c => t >= c.s - 0.02 && t < c.e + 0.18);
  if (!chunk) return;
  const st = p.captions.style;
  const vertical = H > W;
  const base = (vertical ? W * 0.078 : H * 0.075) * p.captions.size;
  const size = st === 'minimal' ? base * 0.7 : st === 'editorial' ? base * 0.9 : base;
  const upper = st === 'pop' || st === 'bold' || st === 'karaoke';
  ctx.font = st === 'editorial' ? `italic 600 ${size}px ${SERIF}` : `${st === 'minimal' ? 500 : 900} ${size}px ${SANS}`;
  ctx.textBaseline = 'middle';
  const texts = chunk.words.map(w => (upper ? w.w.toUpperCase() : st === 'minimal' ? w.w.toLowerCase() : w.w));
  const space = size * 0.28;
  const widths = texts.map(s => ctx.measureText(s).width);
  // Wrap into lines that fit 86% of the width.
  const maxW = W * 0.86;
  const lines: number[][] = [[]];
  let lineW = 0;
  texts.forEach((_, i) => {
    const add = widths[i] + (lines[lines.length - 1].length ? space : 0);
    if (lineW + add > maxW && lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
    lines[lines.length - 1].push(i);
    lineW += widths[i] + (lines[lines.length - 1].length > 1 ? space : 0);
  });
  const lh = size * 1.25;
  const anchor = p.captions.position === 'high' ? 0.22 : p.captions.position === 'mid' ? 0.5 : 0.74;
  const y0 = H * anchor - ((lines.length - 1) * lh) / 2;
  const intro = ease((t - chunk.s) / 0.12);
  lines.forEach((line, li) => {
    const total = line.reduce((n, i) => n + widths[i], 0) + space * (line.length - 1);
    let x = (W - total) / 2;
    const y = y0 + li * lh;
    for (const i of line) {
      const w = chunk.words[i];
      const active = t >= w.os && t < w.oe + 0.05;
      const spoken = t >= w.os;
      const txt = texts[i];
      ctx.save();
      const pop = active && st === 'pop' ? 1 + 0.12 * (1 - ease((t - w.os) / 0.14)) : 1;
      ctx.translate(x + widths[i] / 2, y + (1 - intro) * size * 0.25);
      ctx.scale(pop, pop);
      ctx.globalAlpha = intro;
      if (st === 'pop' && active) {
        ctx.fillStyle = p.captions.accent;
        roundRect(ctx, -widths[i] / 2 - size * 0.16, -size * 0.62, widths[i] + size * 0.32, size * 1.18, size * 0.2);
        ctx.fill();
        ctx.fillStyle = '#0b0b0c';
        ctx.fillText(txt, -widths[i] / 2, 0);
      } else if (st === 'editorial') {
        ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = size * 0.25;
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, -widths[i] / 2, 0);
        if (active) { ctx.shadowBlur = 0; ctx.fillStyle = p.captions.accent; ctx.fillRect(-widths[i] / 2, size * 0.5, widths[i], size * 0.09); }
      } else if (st === 'minimal') {
        ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = size * 0.3;
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, -widths[i] / 2, 0);
      } else {
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = 'rgba(0,0,0,0.92)';
        ctx.strokeText(txt, -widths[i] / 2, 0);
        ctx.fillStyle = active ? p.captions.accent : st === 'karaoke' && !spoken ? 'rgba(255,255,255,0.55)' : '#fff';
        ctx.fillText(txt, -widths[i] / 2, 0);
      }
      ctx.restore();
      x += widths[i] + space;
    }
  });
}

function drawOverlays(ctx: CanvasRenderingContext2D, p: Project, t: number, W: number, H: number) {
  const unit = Math.min(W, H);
  for (const o of p.overlays) {
    if (t < o.start || t > o.start + o.dur) continue;
    const k = ease((t - o.start) / 0.35) * ease((o.start + o.dur - t) / 0.3);
    ctx.save();
    ctx.globalAlpha = k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (o.kind === 'cta') {
      const size = unit * 0.062;
      ctx.font = `800 ${size}px ${SANS}`;
      const w = Math.min(W * 0.86, ctx.measureText(o.text).width + size * 1.6);
      const y = H * 0.86 + (1 - k) * size;
      ctx.fillStyle = p.captions.accent;
      roundRect(ctx, (W - w) / 2, y - size * 0.95, w, size * 1.9, size * 0.5);
      ctx.fill();
      ctx.fillStyle = '#0b0b0c';
      ctx.fillText(o.text, W / 2, y, W * 0.8);
    } else {
      const size = unit * (o.kind === 'title' ? 0.095 : 0.07);
      ctx.font = `900 ${size}px ${SANS}`;
      const y = H * (o.kind === 'title' ? 0.2 : 0.5) + (1 - k) * size * 0.4;
      const words = o.text.toUpperCase().split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > W * 0.84 && line) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      lines.forEach((l, i) => {
        const ly = y + (i - (lines.length - 1) / 2) * size * 1.12;
        ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(l, W / 2, ly);
        ctx.fillStyle = i === 0 && o.kind === 'title' ? '#fff' : p.captions.accent;
        ctx.fillText(l, W / 2, ly);
      });
    }
    ctx.restore();
  }
}

/** Draw the edit at output time `t`. `src` is the source frame for that moment (or null while seeking). */
export function drawFrame(ctx: CanvasRenderingContext2D, p: Project, chunks: Chunk[], t: number, src: CanvasImageSource | null, sw: number, sh: number) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (src && sw > 0 && sh > 0) {
    const scale = zoomAt(p, t);
    const filter = LOOKS[p.look].filter;
    if (p.fit === 'blur' && Math.abs(sw / sh - W / H) > 0.02) {
      ctx.filter = `blur(${Math.round(Math.min(W, H) * 0.04)}px) brightness(0.55)${filter === 'none' ? '' : ' ' + filter}`;
      drawCover(ctx, src, sw, sh, W, H, 1.1);
      ctx.filter = filter;
      drawContain(ctx, src, sw, sh, W, H, scale);
    } else {
      ctx.filter = filter;
      drawCover(ctx, src, sw, sh, W, H, scale);
    }
    ctx.filter = 'none';
  }
  ctx.restore();
  if (p.captions.on) drawCaptions(ctx, p, chunks, t, W, H);
  drawOverlays(ctx, p, t, W, H);
}
