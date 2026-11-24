// arcade-2d starter client — full-screen canvas, local fixed-step loop over logic.js, input for keyboard/mouse/touch/one-tap,
// juice (shake, particles, popups, hit-stop, synth SFX), best score, pause on blur, and the window.__omGame test hook.
// Keep: game-first screen (the playfield fills the viewport; title/end cards are small overlays), first input works within 1 s.
import * as L from './logic.js';

const ORIENTATION = 'portrait';            // 'portrait' (9:16, phone-first, playable ads) or 'landscape' (16:9)
const ONE_BUTTON = false;                  // true: the whole game is one action (tap / click / Space / Enter)
const STRINGS = {
  en: { title: 'Spark Catcher', goal: 'Catch 45 sparks · dodge rocks', start: 'Tap to play', win: 'You win!', loss: 'Game over', again: 'Play again', best: 'Best', score: 'Score' },
  'zh-CN': { title: '接住火花', goal: '接住 45 颗火花 · 躲开石头', start: '点一下开始', win: '赢了！', loss: '游戏结束', again: '再来一局', best: '最高', score: '得分' },
};
const T = STRINGS[navigator.language?.startsWith('zh') ? 'zh-CN' : 'en'];
const PALETTE = { bg: '#141826', bg2: '#1f2540', player: '#ffd166', spark: '#7ef0c8', rock: '#ef476f', text: '#f4f1de', dim: '#8d93b8' };

const canvas = document.getElementById('game'), g = canvas.getContext('2d');
const ui = { card: document.getElementById('card'), title: document.getElementById('card-title'), sub: document.getElementById('card-sub'), btn: document.getElementById('start'), hud: document.getElementById('hud'), mute: document.getElementById('mute') };
const debug = new URLSearchParams(location.search).has('debug');
const STORE = 'om-best:' + location.pathname;
const ctx = { tick: 0, now: 0 };
let state = L.setup(ctx, ['player-1']), running = false, paused = false, lastEvent = 0;
try { state.best = +localStorage.getItem(STORE) || 0; } catch {}

// ---------- layout: playfield fills the screen, letterboxed to the world aspect ----------
let scale = 1, ox = 0, oy = 0, dpr = 1;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  const W = L.config.W, H = L.config.H;
  scale = Math.min(canvas.width / W, canvas.height / H); ox = (canvas.width - W * scale) / 2; oy = (canvas.height - H * scale) / 2;
}
addEventListener('resize', resize); resize();
const sx = x => ox + x * scale, sz = z => oy + z * scale;

// ---------- input ----------
const keys = new Set(); let pointerDir = 0, pointerDown = false;
function begin() { if (!running) { running = true; ui.card.hidden = true; audio.unlock(); } else if (state.result) send({ type: 'restart' }); }
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'Enter' || (e.code === 'Space' && (!running || state.result))) return begin();
  if (e.code === 'Space' || e.code === 'ShiftLeft') send({ type: 'dash' });
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'KeyR' && state.result) send({ type: 'restart' });
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); pointerDown = false; if (running && !state.result) paused = true; });
canvas.addEventListener('pointerdown', e => { pointerDown = true; if (!running || state.result) return begin(); if (ONE_BUTTON) return send({ type: 'dash' }); aim(e); });
canvas.addEventListener('pointermove', e => { if (pointerDown || e.pointerType === 'mouse') aim(e); });
addEventListener('pointerup', () => { pointerDown = false; if (!ONE_BUTTON) pointerDir = 0; });
function aim(e) { const x = (e.clientX * dpr - ox) / scale, p = state.players[state.selfId]; pointerDir = Math.max(-1, Math.min(1, (x - p.x) * 1.5)); }
ui.card.addEventListener('click', begin);
ui.mute.addEventListener('click', () => { audio.muted = !audio.muted; ui.mute.textContent = audio.muted ? '🔇' : '🔊'; });
function heldDx() { const k = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0); return k || pointerDir; }
function send(action) { ctx.now = ctx.tick * 1000 / L.meta.tickRate; if (L.validateAction(state, state.selfId, action, ctx)) state = L.applyAction(state, state.selfId, action, ctx); }

// ---------- juice ----------
const fx = { shake: 0, hitStop: 0, flash: 0, particles: [], popups: [] };
function burst(x, z, color, n = 14, speed = 0.18) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random()); fx.particles.push({ x, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, life: 1, color }); } }
const audio = { ctx: null, muted: false,
  unlock() { try { this.ctx ??= new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume(); } catch {} },
  blip(freq, dur = 0.08, type = 'square', gain = 0.06, slide = 0) { if (!this.ctx || this.muted) return; const t = this.ctx.currentTime, o = this.ctx.createOscillator(), v = this.ctx.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur); v.gain.setValueAtTime(gain, t); v.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(v).connect(this.ctx.destination); o.start(t); o.stop(t + dur); } };
function onEvent(e) {
  if (e.kind === 'pickup') { burst(e.x, e.z, PALETTE.spark, 10); fx.popups.push({ x: e.x, z: e.z, text: '+' + e.gain + (e.combo >= 5 ? ' ×' + (1 + Math.floor(e.combo / 5)) : ''), life: 1 }); audio.blip(660 + Math.min(e.combo, 12) * 40, 0.07, 'triangle'); }
  if (e.kind === 'hurt') { burst(e.x, e.z, PALETTE.rock, 22, 0.28); fx.shake = 14; fx.hitStop = 5; fx.flash = 1; audio.blip(140, 0.25, 'sawtooth', 0.08, -90); navigator.vibrate?.(60); }
  if (e.kind === 'dash') { burst(e.x, e.z, PALETTE.player, 8, 0.12); audio.blip(320, 0.1, 'triangle', 0.05, 300); }
  if (e.kind === 'win' || e.kind === 'loss' || e.kind === 'timeout') { audio.blip(e.kind === 'win' ? 880 : 180, 0.4, 'triangle', 0.08, e.kind === 'win' ? 400 : -100); showEnd(); }
}
function showEnd() {
  state.best = Math.max(state.best, state.score); try { localStorage.setItem(STORE, state.best); } catch {}
  ui.title.textContent = state.result === 'win' ? T.win : T.loss; ui.sub.textContent = `${T.score} ${state.score} · ${T.best} ${state.best}`; ui.btn.textContent = T.again; ui.card.hidden = false;
}

// ---------- loop: fixed step ----------
const step = 1000 / L.meta.tickRate; let acc = 0, last = performance.now(), frames = 0, fps = 0, fpsT = last;
function frame(now) {
  const dt = Math.min(100, now - last); last = now; frames++; if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; }
  if (running && !paused && !state.result) {
    acc += dt;
    while (acc >= step) {
      acc -= step;
      if (fx.hitStop > 0) { fx.hitStop--; continue; }
      send({ type: 'input', dx: heldDx() });
      ctx.tick++; ctx.now = ctx.tick * 1000 / L.meta.tickRate; state = L.applyAction(state, null, { type: 'tick' }, ctx);
      for (const e of state.events) if (e.id > lastEvent) { lastEvent = e.id; onEvent(e); }
    }
  } else if (state.result && ui.card.hidden) showEnd();
  if (!state.result && lastEvent > (state.events.at(-1)?.id ?? 0)) lastEvent = 0; // restart resets serials
  draw(); requestAnimationFrame(frame);
}

// ---------- render ----------
function draw() {
  const p = state.players[state.selfId];
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = PALETTE.bg; g.fillRect(0, 0, canvas.width, canvas.height);
  const s = fx.shake > 0.3 ? fx.shake * dpr : 0; fx.shake *= 0.85; g.translate((Math.random() - .5) * s, (Math.random() - .5) * s);
  const grad = g.createLinearGradient(0, oy, 0, oy + L.config.H * scale); grad.addColorStop(0, PALETTE.bg2); grad.addColorStop(1, PALETTE.bg); g.fillStyle = grad; g.fillRect(ox, oy, L.config.W * scale, L.config.H * scale);
  for (const o of state.objects) {
    g.fillStyle = o.kind === 'spark' ? PALETTE.spark : PALETTE.rock; g.beginPath();
    if (o.kind === 'spark') { const r = 0.32 * scale * (1 + 0.15 * Math.sin(o.z * 4)); g.moveTo(sx(o.x), sz(o.z) - r); g.lineTo(sx(o.x) + r * .6, sz(o.z)); g.lineTo(sx(o.x), sz(o.z) + r); g.lineTo(sx(o.x) - r * .6, sz(o.z)); }
    else g.arc(sx(o.x), sz(o.z), 0.42 * scale, 0, Math.PI * 2);
    g.fill();
  }
  const blink = state.tick < p.invulnerableUntil && (state.tick >> 2) % 2;
  if (!blink) { g.fillStyle = PALETTE.player; g.beginPath(); g.roundRect(sx(p.x) - 0.45 * scale, sz(p.z) - 0.3 * scale, 0.9 * scale, 0.6 * scale, 0.18 * scale); g.fill(); }
  for (const q of fx.particles) { q.x += q.vx; q.z += q.vz; q.vz += 0.006; q.life -= 0.03; g.globalAlpha = Math.max(0, q.life); g.fillStyle = q.color; g.fillRect(sx(q.x) - 3 * dpr, sz(q.z) - 3 * dpr, 6 * dpr, 6 * dpr); }
  fx.particles = fx.particles.filter(q => q.life > 0);
  g.font = `700 ${Math.round(0.45 * scale)}px system-ui,sans-serif`; g.textAlign = 'center';
  for (const t of fx.popups) { t.z -= 0.03; t.life -= 0.025; g.globalAlpha = Math.max(0, t.life); g.fillStyle = PALETTE.text; g.fillText(t.text, sx(t.x), sz(t.z)); }
  fx.popups = fx.popups.filter(t => t.life > 0); g.globalAlpha = 1;
  if (fx.flash > 0) { g.fillStyle = `rgba(239,71,111,${fx.flash * 0.35})`; g.fillRect(0, 0, canvas.width, canvas.height); fx.flash *= 0.85; }
  const left = Math.max(0, Math.ceil((L.config.duration - (state.tick - state.startTick)) / L.meta.tickRate));
  ui.hud.textContent = `${'♥'.repeat(Math.max(0, p.lives))}  ${T.score} ${state.score}/${L.config.targetScore}  ⏱ ${left}s${state.combo >= 5 ? '  ×' + (1 + Math.floor(state.combo / 5)) : ''}`;
  if (debug) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0f0'; g.font = `${12 * dpr}px monospace`; g.textAlign = 'left'; g.fillText(`fps ${fps} tick ${state.tick} objects ${state.objects.length}`, 8 * dpr, canvas.height - 8 * dpr); }
}

// ---------- test hook (read by openmotion_game_playtest / capture_cover) ----------
window.__omGame = { getState: () => ({ ...state, rules: L.config }), getStats: () => ({ fps, tick: state.tick, entities: state.objects.length }), sendAction: a => { if (!running) begin(); send(a); } };
ui.title.textContent = T.title; ui.sub.textContent = T.goal; ui.btn.textContent = T.start; document.title = T.title;
document.documentElement.dataset.orientation = ORIENTATION;
// Autostart lets headless playtests and covers see gameplay; humans still see the title card for under a second.
if (new URLSearchParams(location.search).has('autostart')) begin();
requestAnimationFrame(frame);
