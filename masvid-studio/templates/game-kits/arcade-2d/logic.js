// arcade-2d starter logic — single-player, deterministic, runs in the browser AND in openmotion_game_simulate.
// Replace the sample rules ("catch sparks, dodge rocks") with the requested game; keep the contract:
// six exports + referenceRoute + summarize; state.players[selfId] has x/z/connected; phase in playing|win|loss.
export const meta = { minPlayers: 1, maxPlayers: 1, tickRate: 30, serverTick: true };

// All tuning lives here so a design change is one edit. World units: 0..W horizontally, 0..H vertically (z grows downward).
export const config = {
  W: 9, H: 16,                 // portrait world (9:16). For landscape briefs use W:16,H:9 and set ORIENTATION in client.js.
  speed: 0.32,                 // player units per tick at full input
  duration: 60 * 30,           // ticks (60 s) — a session should end in 30–90 s
  targetScore: 45,             // win threshold; idle must never reach it
  lives: 3,
  spawnEvery: [22, 9],         // spawn interval at start → at end (difficulty ramp)
  fallSpeed: [0.08, 0.2],      // object speed at start → at end
  hazardShare: [0.25, 0.5],    // share of hazards among spawns at start → at end
  pickupRadius: 0.75,
  dash: { cost: 0, cooldown: 45, distance: 2.4 },
};

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
function rand(state) { // mulberry32 on state.seed — never Math.random in logic
  let t = (state.seed = (state.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function newPlayer(id) { return { id, x: config.W / 2, z: config.H - 1.6, connected: true, input: 0, lives: config.lives, dashReady: 0, invulnerableUntil: 0 }; }

export function setup(ctx, players) {
  const id = players[0] ?? 'player-1';
  return { selfId: id, players: { [id]: newPlayer(id) }, objects: [], events: [], phase: 'playing', result: null,
    score: 0, combo: 0, best: 0, tick: ctx.tick, startTick: ctx.tick, nextSpawn: ctx.tick + 15, serial: 0, seed: 12345 };
}

export function validateAction(state, playerId, action, ctx) {
  if (!action || typeof action !== 'object' || !state.players[playerId]) return false;
  if (action.type === 'restart') return !!state.result;
  if (state.result) return false;
  if (action.type === 'input') return Number.isFinite(action.dx) && Math.abs(action.dx) <= 1;
  if (action.type === 'dash') return ctx.tick >= state.players[playerId].dashReady;
  return false;
}

function event(state, kind, x, z, extra = {}) { state.events.push({ id: ++state.serial, kind, x, z, tick: state.tick, ...extra }); if (state.events.length > 40) state.events.shift(); }

export function applyAction(state, playerId, action, ctx) {
  if (playerId === null && action.type === 'membership') { const p = state.players[action.player]; if (p) p.connected = action.connected; return state; }
  if (playerId !== null) {
    if (!validateAction(state, playerId, action, ctx)) return state;
    const p = state.players[playerId];
    if (action.type === 'restart') { const s = setup(ctx, [playerId]); s.best = Math.max(state.best, state.score); return s; }
    if (action.type === 'input') p.input = action.dx;
    if (action.type === 'dash') { const dir = p.input || 1; p.x = Math.min(config.W - 0.5, Math.max(0.5, p.x + dir * config.dash.distance)); p.dashReady = ctx.tick + config.dash.cooldown; p.invulnerableUntil = ctx.tick + 10; event(state, 'dash', p.x, p.z); }
    return state;
  }
  if (action.type !== 'tick' || state.result) return state;
  state.tick = ctx.tick;
  const p = state.players[state.selfId], t = (ctx.tick - state.startTick) / config.duration;
  p.x = Math.min(config.W - 0.5, Math.max(0.5, p.x + p.input * config.speed));
  if (ctx.tick >= state.nextSpawn) {
    const hazard = rand(state) < lerp(config.hazardShare[0], config.hazardShare[1], t);
    state.objects.push({ id: ++state.serial, kind: hazard ? 'rock' : 'spark', x: 0.6 + rand(state) * (config.W - 1.2), z: -0.5, vz: lerp(config.fallSpeed[0], config.fallSpeed[1], t) * (0.85 + rand(state) * 0.3) });
    state.nextSpawn = ctx.tick + Math.round(lerp(config.spawnEvery[0], config.spawnEvery[1], t));
  }
  for (const o of state.objects) o.z += o.vz;
  state.objects = state.objects.filter(o => {
    const hit = Math.hypot(o.x - p.x, o.z - p.z) < config.pickupRadius;
    if (hit && o.kind === 'spark') { state.combo++; const gain = 1 + Math.floor(state.combo / 5); state.score += gain; event(state, 'pickup', o.x, o.z, { gain, combo: state.combo }); return false; }
    if (hit && o.kind === 'rock' && ctx.tick >= p.invulnerableUntil) { p.lives--; state.combo = 0; p.invulnerableUntil = ctx.tick + 30; event(state, 'hurt', o.x, o.z); return false; }
    if (o.z > config.H + 1) { if (o.kind === 'spark') state.combo = 0; return false; }
    return true;
  });
  if (state.score >= config.targetScore) { state.result = 'win'; state.phase = 'win'; event(state, 'win', p.x, p.z); }
  else if (p.lives <= 0) { state.result = 'loss'; state.phase = 'loss'; event(state, 'loss', p.x, p.z); }
  else if (ctx.tick - state.startTick >= config.duration) { state.result = 'loss'; state.phase = 'loss'; event(state, 'timeout', p.x, p.z); }
  return state;
}

export function isGameOver(state, ctx) { return { over: !!state.result, winners: state.result === 'win' ? [state.selfId] : [] }; }
export function viewFor(state, playerId, ctx) { return { ...state, rules: config, tickRate: meta.tickRate }; }

// A competent-player policy: reads state, returns the same validated inputs a human would send.
// Update it whenever the rules change; referenceRoute replays it so simulate proves the game is winnable.
export function pilot(state) {
  const p = state.players[state.selfId];
  const danger = state.objects.filter(o => o.kind === 'rock' && o.z > p.z - 4 && o.z < p.z + 0.5 && Math.abs(o.x - p.x) < 1.1);
  if (danger.length) { const away = Math.sign(p.x - danger[0].x) || (p.x < config.W / 2 ? 1 : -1); const blocked = p.x + away * 1.2 < 0.5 || p.x + away * 1.2 > config.W - 0.5; return { type: 'input', dx: blocked ? -away : away }; }
  const goal = state.objects.filter(o => o.kind === 'spark' && o.z < p.z && (p.z - o.z) / o.vz * config.speed >= Math.abs(o.x - p.x) - 0.3).sort((a, b) => b.z - a.z)[0];
  if (!goal) return { type: 'input', dx: 0 };
  const d = goal.x - p.x; return { type: 'input', dx: Math.abs(d) < 0.15 ? 0 : Math.max(-1, Math.min(1, d * 2)) };
}
// Test contract for openmotion_game_simulate: ordinary validated inputs only (recorded from pilot). Idle must lose.
export function referenceRoute(playerIndex) {
  const ctx = { tick: 0, now: 0 }; let s = setup(ctx, ['player-1']); const route = [];
  for (let tick = 1; tick <= 6000 && !s.result; tick++) {
    ctx.tick = tick; const a = pilot(s), lastStep = route.at(-1);
    if (lastStep && lastStep.action.dx === a.dx && lastStep.toTick === tick - 1) lastStep.toTick = tick; else route.push({ fromTick: tick, toTick: tick, action: a });
    s = applyAction(s, s.selfId, a, ctx); s = applyAction(s, null, { type: 'tick' }, ctx);
  }
  return route.slice(0, 1000);
}
export function summarize(state) {
  const p = state.players[state.selfId];
  return { phase: state.result ?? state.phase, score: state.score, lives: p?.lives, tick: state.tick, objects: state.objects.length };
}
