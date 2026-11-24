# Playable ads — the OpenMotion recipe

Read this when the brief says **Format: playable ad** (Studio's playable-ad switch, or a prompt that asks for a playable / interactive ad). It replaces the title-screen and session rules of [genre recipes](game-genres.md) for this format; everything else in the [game flow](game-flow.md), the [design system](game-design-system.md), [style](game-stylization.md) and [audio](game-audio.md) still applies. Score the result with the playable-ad addendum of the [rubric](review-rubric.md).

A playable ad is a 30–60 second slice of a game that sells the full game by letting the viewer play it. The viewer did not choose to open it, may never have played a game like it and will leave within seconds if nothing happens. Every rule below serves one of three goals: **the first touch already plays**, **the player wins something early and almost loses later**, and **the end card makes tapping the call-to-action (CTA) the obvious next step**.

## 1. Mode rules (all mandatory)

1. **Single player, portrait.** Studio creates a playable ad only as a portrait, single-player brief. Design for a 390×844 CSS-pixel phone held upright, scale that design space to whatever container the ad gets, and keep the full playfield visible in 9:16, 9:19.5, 3:4 and landscape containers (letterbox with scene colour, never black bars).
2. **One self-contained file.** The shipped ad is one `index.html` with every script, style, image and sound inline. No CDN, web font, `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `<img src="https://…">` or `@import`. Images are `data:` URIs or drawn in code; sounds are synthesized with WebAudio. The service-owned `game.json` holds metadata only (title, controls, cover) and is edited through `openmotion_game_update_meta`.
3. **No storage, no dialogs, no navigation.** No `localStorage`, `sessionStorage`, cookies, `alert`, `confirm`, `prompt`, `location.href = …` or `location.reload()`. The arcade-2d kit's best-score storage is removed in an ad build. Replay is an in-memory reset.
4. **Sound after the first touch.** Create or resume the `AudioContext` inside the first pointer or key handler. Nothing plays before it.
5. **The CTA is a function, not a link.** Every store tap goes through one `openStore()` (section 3.4). Nothing opens the store automatically, on the first touch, on Replay or on a timer.
6. **No title screen.** The scene, the player object and an animated hand are on screen at the first rendered frame. The first touch anywhere on the playfield starts play and counts as a correct first move.
7. **Tunables in one block.** Every number, colour, string and URL a marketer may change lives in the single `config` object at the top of `logic.js` (section 4). Game code reads values from it, never from literals.
8. **Deterministic rules.** Keep the kit's six exports, `pilot`, `referenceRoute` and `summarize`. `openmotion_game_simulate` must show the reference route winning the last level and idle losing (section 10).
9. **Language.** English in code, comments and file names. Ship strings for `en`, `zh-CN` and `es`; pick by `?lang=`, then `config.lang`, then `navigator.language`, then `en`.

## 2. Start from the arcade-2d kit

A playable-ad brief receives `templates/game-kits/arcade-2d/` (it already supports `ORIENTATION = 'portrait'` and a 9×16 world). Keep its fixed-step loop over `logic.js`, input layer, juice helpers (`burst`, popups, shake, hit-stop, `audio.blip`), pause-on-blur, `?debug` stats and the `window.__omGame` test hook. Replace or change these parts:

| Kit part | In a playable ad |
|---|---|
| Sample rules in `logic.js` (sparks and rocks) | The genre's rules from section 8, organised as levels (`config.levels`) with a phase machine `playing → clear → playing … → win`, or `loss` |
| `config` at the top of `logic.js` | The single tunables block of section 4 (gameplay, palette, CTA, store links, strings) |
| `STRINGS`, `PALETTE` in `client.js` | Read from `L.config.strings` and `L.config.palette`; delete the client copies |
| `#card` title card and `#start` button | Removed. Add `#hand` (tutorial), `#hud` regions, `#cta-dock` (persistent CTA) and `#end` (end card) |
| `begin()` on Enter/Space or a canvas tap | Any pointer down on the playfield or any key starts play (no button) |
| `#mute` in the top-right corner | Move it out of both 56×56 px top corners (networks place their close button there): top row, inset 64 px from the left, or into the bottom dock |
| `localStorage` best score | Removed; show the run's score only |
| `showEnd()` | The end card of section 3.3 with Play again and the CTA |
| `?autostart` | Keep: headless capture uses it to see gameplay instead of the intro |

**File plan while building:** `logic.js` (rules and tunables), `client.js` (presentation, input, ad hooks), `style.css`, `index.html` referencing them. This keeps `openmotion_game_validate`, `simulate` and `playtest` working on every edit.

**Single-file build before QA.** When gameplay is done, regenerate `index.html` as the inlined deliverable and keep the three source files as the editable originals:

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="game-layout" content="design=390x844;orientation=portrait">
<title>Coin Drop Rescue</title>
<link rel="icon" href="data:image/svg+xml;base64,PHN2Zy…">
<style>/* contents of style.css */</style></head>
<body>
<canvas id="game" aria-label="Game playfield"></canvas>
<div id="ui"><!-- hud, hand, cta-dock, end card --></div>
<!-- Generated from logic.js + client.js + style.css. Edit those files and regenerate; never edit this copy. -->
<script>
const L = (() => {
  /* contents of logic.js with every leading `export ` removed */
  return { meta, config, setup, validateAction, applyAction, isGameOver, viewFor, pilot, referenceRoute, summarize };
})();
/* contents of client.js without its `import * as L from './logic.js'` line */
</script>
</body></html>
```

- Use a classic `<script>`, not `type="module"`: some ad webviews and preview tools reject module scripts in a sandboxed `srcdoc`.
- Write explicit end tags (`<path …></path>`, never `<path …/>`) in inline SVG; some network validators parse the file as strict HTML.
- After any later change to `logic.js`, `client.js` or `style.css`, regenerate `index.html` in the same write batch. A stale inlined copy is the most likely playable-ad defect in OpenMotion.
- Report the byte size of the final `index.html` in `design/verification.md`.

## 3. Ad structure

**Section summary.** The ad is a short arc of levels framed by an instant start and an automatic end card. Treat the timeline below as the default; a brief that names its own levels, timings or win condition overrides it.

| Beat | When (first-time player) | What the viewer sees | Ends when |
|---|---|---|---|
| Hook | 0–1 s | Scene, player object, the goal (a reward, a rival, a locked area), the hand moving on the exact touch target, one 2–5 word instruction | First input |
| Level 1 — obvious win | 1–12 s | The core verb, taught by doing. The first input already scores. Cannot be lost in its first 8 s | Level-clear burst at 6–12 s |
| Level 2 (and 3) — near fail | 12–35 s | Same verb, faster or denser. The lose resource visibly drops to 20–40 % for a player who plays normally | Clear at 20–35 s |
| Twist level | 30–50 s | Same controls plus one new rule (a moving part, a thief, a boss, a second resource) | Win finale |
| End card | ≤ 3 s after win or loss | Result title, one line, CTA (primary) and Play again (secondary) | Player taps |

Use **3 to 8 levels**, each 6–20 s. Three levels is the default for genres with a long verb (racing, runner, crowd battle); puzzles with one move per second use 5–8 tiny levels. Total Normal session: 30–60 s, hard cap 90 s.

### 3.1 First frame and the hand tutorial

- The first frame is the game, fully drawn: never a loading spinner that waits for a tap, a logo slate or a "Tap to start" card. Decode inline images while drawing a procedural placeholder.
- Show the hand 0.3–0.6 s after the first frame, **on the exact element the first move uses** (the pin to pull, the gate to steer into, the tile to swap). The hand traces the real gesture: a press-and-lift for a tap, a drag path for a drag, a short arrow for a swipe. Compute the hand's target with the pilot's own next-move logic, so the hint and the bot never disagree.
- One instruction line next to the hand, 2–5 words, in the active language ("Pull the pin", "拖动转向", "Desliza para girar"). Never two hints at once, never a paragraph.
- Hide the hand on the first input. Show it again after `config.hintDelay` seconds (default 3) without input, and after a failed move after 1 s.
- The first touch never punishes: if the player taps somewhere else, treat it as the start and let the hand point again.
- Logic has no intro phase. The client holds the tick loop until the first input (or `?autostart`) so the scene is frozen behind the hand; `openmotion_game_simulate` ticks from tick 1, which is why the opening must still lose without input (section 5).

A compact hand drawn on the canvas (no image needed):

```js
// Draws a pointing hand whose fingertip is at (x, y) screen px; k is 0..1 press depth.
function drawHand(g, x, y, size, k) {
  g.save(); g.translate(x, y + k * size * 0.12); g.rotate(-0.35);
  g.fillStyle = '#ffffff'; g.strokeStyle = '#1b1b1f'; g.lineWidth = size * 0.07; g.lineJoin = 'round';
  g.beginPath();
  g.roundRect(-size * 0.13, 0, size * 0.26, size * 0.62, size * 0.13);   // index finger
  g.roundRect(-size * 0.36, size * 0.42, size * 0.72, size * 0.55, size * 0.2); // palm
  g.fill(); g.stroke();
  if (k > 0.6) { g.globalAlpha = (k - 0.6) * 2.5; g.beginPath(); g.arc(0, -size * 0.05, size * 0.3 * k, 0, Math.PI * 2); g.stroke(); }
  g.restore();
}
// Loop it on game-independent real time: t in seconds since the hint appeared.
function handPose(t, from, to) { const c = (t % 1.4) / 1.4, ease = c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2; return { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease, k: c < 0.15 || c > 0.85 ? 1 : 0 }; }
```

### 3.2 Level arc

- **Level 1 is an obvious win.** Generous numbers, no new hazard, success within 2–3 inputs. Its purpose is the first reward, not challenge.
- **Level 2 or 3 is a near fail.** The danger metric of section 5 peaks between 0.6 and 0.9 for the pilot. A real person feels "that was close".
- **The twist level adds one rule** the player must use, in a visibly different state (another layout, palette or set piece). Bigger numbers of the same thing are not a twist.
- **Between levels:** a 0.8–1.5 s clear beat in logic (`phase: 'clear'`, counted in ticks so simulate sees it), a banner, a burst and a count-up, then the next layout slides or pops in. No menu, no "Next level" button.
- **Progress is visible.** A level chip (`1/5`) and a goal bar or counter. Goal text updates on real events (level start, goal reached), never flickers between two states.
- **Lose resource.** Each genre has one (moves, hearts, line HP, dock slots, time when the brief names a timer). Use at least 3 units, or lose in halves, so "almost lost" is possible without losing.
- **Fail is short.** On loss, freeze the frame, play a 0.6–1.0 s fail beat (shake, dim, sad sound), then the fail end card. Replay restarts **the level that was lost** (keep earlier progress) unless the genre is a single continuous run.

### 3.3 End cards

Two outcomes, both reachable in every build: **win** (last level cleared) and **fail** (lose resource spent). An optional **gate** variant (the next locked area previewed for 1.5–2.5 s, then "Want to see what's next?") counts as a win.

- The card opens by itself 0.8–3 s after the result. It never waits for a tap.
- Keep the final game frame visible under a translucent dark layer; put the copy on one rounded, content-sized panel. Do not swap in a different scene or a full-screen image.
- **Title**: the outcome in the game's words, ≤ 16 characters in `en` ("TOWER BUILT!", "SO CLOSE!"). Fail titles encourage; never "Game over" or "You lost". Say "close" only when the player got past 60 % of the goal.
- **One line**: win names the feat or what comes next; fail gives one concrete tip about what caused the loss ("Pull the gold pin first").
- **CTA button**: primary style, largest button, verb first, from `config.cta.text` (default "Play now"). Enters about 0.4 s after the title, pulses gently unless `prefers-reduced-motion`.
- **Play again**: secondary style, below the CTA, restarts in memory. Never opens the store.
- Only the CTA button opens the store; a tap elsewhere on the card does nothing. Ignore taps for the first 0.6 s so a gameplay tap does not hit the CTA by accident.
- Hide the gameplay HUD and the hand while the card shows.
- The subtitle never repeats the store ask ("download", "install", "下载"); the CTA is the only element that asks.

### 3.4 CTA and the store hook

A **persistent CTA** in the bottom dock during play is recommended (small, secondary, never over the playfield's action area); the end-card CTA is mandatory. Both call the same function:

```js
// Store routing for the ad container. The container's SDK is detected at tap time.
let lastCta = -1e9;
function storeUrl() {
  const s = L.config.store, android = /android/i.test(navigator.userAgent || '');
  return (android ? s.android : s.ios) || s.ios || s.android || '';
}
function openStore(source) {
  const now = performance.now(); if (now - lastCta < 300) return; lastCta = now; // debounce double taps
  track('cta_click', { source }); sfx('cta');
  const url = storeUrl();
  try {
    if (window.mraid && typeof mraid.open === 'function') return mraid.open(url);          // MRAID networks
    if (window.FbPlayableAd && FbPlayableAd.onCTAClick) return FbPlayableAd.onCTAClick();   // Meta, Moloco
    if (window.ExitApi && ExitApi.exit) return ExitApi.exit();                              // Google
    if (typeof window.openAppStore === 'function') return window.openAppStore();            // TikTok / Pangle
    if (typeof window.install === 'function') return window.install();                      // Mintegral
  } catch (e) { console.warn('cta', e); }
  previewOpen(url);
}
// PREVIEW ONLY — the per-network packaging step deletes this function and its call:
// several networks reject a file that contains window.open.
function previewOpen(url) {
  try { if (window.parent !== window) window.parent.postMessage({ type: 'openmotion:cta', url }, '*'); } catch {}
  if (url) window.open(url, '_blank', 'noopener');
}
```

- Every CTA element has an `id` containing `cta` (`cta-dock`, `cta-end`) and `data-cta`, so tests can find and tap it.
- Never define, stub or overwrite `window.mraid`, `FbPlayableAd`, `ExitApi`, `openAppStore` or `install` in the file. A stub left in place makes every real CTA tap do nothing.
- Empty store URLs are allowed while building; list them as "store links pending" in the final message.

### 3.5 Container lifecycle and analytics

```js
// Start rendering/audio only when the ad container says the ad is ready and visible.
function whenAdVisible(start) {
  const m = window.mraid;
  if (!m) return start();                                   // OpenMotion preview, plain browser
  const go = () => (m.isViewable() ? start() : m.addEventListener('viewableChange', function v(on) { if (on) { m.removeEventListener('viewableChange', v); start(); } }));
  m.getState() === 'loading' ? m.addEventListener('ready', go) : go();
  m.addEventListener('viewableChange', on => setPaused('container', !on));
}
document.addEventListener('visibilitychange', () => setPaused('page', document.hidden));
const adEvents = (window.__adEvents = []);
function track(name, data = {}) { adEvents.push({ name, t: +(performance.now() / 1000).toFixed(2), ...data }); }
// Let headless tests read the ad events: include them in the kit's test hook.
window.__omGame.getState = () => ({ ...state, rules: L.config, ad: { events: adEvents.slice(-40), endCard: endShown } });
```

- Keep one pause flag per cause (`page`, `container`, `blur`); run the loop and audio only when none is set.
- Fire `track` for: `first_input`, `level_start` (`level`), `level_clear` (`level`), `win`, `loss` (`cause`), `end_card`, `replay`, `cta_click` (`source`), `mute`. Never send them over the network; a network wrapper may read `window.__adEvents` later.
- Call `window.gameEnd?.()` once when the end card opens (networks that track completion define it). Guard every SDK call with a `typeof` check and `try`.

## 4. The tunables block

**Section summary.** One `config` object at the top of `logic.js` holds everything a marketer may change: difficulty, speeds, level data, colours, CTA text, store links and strings. Comments say what each line does in player terms. The client applies URL overrides onto it at boot, before `setup`, so the same file serves every variant.

```js
// ===== AD TUNABLES — edit here only. Every value below is safe to change without touching game logic. =====
export const config = {
  W: 9, H: 19.5,                  // world size in units; 9:19.5 matches a 390x844 phone
  difficulty: 'normal',           // 'easy' | 'normal' | 'hard' (URL ?diff=)
  lang: 'auto',                   // 'auto' | 'en' | 'zh-CN' | 'es' (URL ?lang=)
  startLevel: 1,                  // review aid; ship with 1 (URL ?level=)
  difficultyScale: { easy: { pace: 0.8, pressure: 0.7 }, normal: { pace: 1, pressure: 1 }, hard: { pace: 1.2, pressure: 1.35 } },
  hintDelay: 3,                   // seconds without input before the hand returns
  maxSeconds: 90,                 // silent safety cap; ends on the fail card's encouraging copy
  lives: 3,                       // lose resource; 3+ units so a near miss is possible
  levels: [                       // 3–8 short levels; level 1 is an obvious win
    { goal: 6,  speed: 0.10, spawnEvery: 26, hazardShare: 0.0 },
    { goal: 10, speed: 0.14, spawnEvery: 18, hazardShare: 0.3 },
    { goal: 12, speed: 0.16, spawnEvery: 14, hazardShare: 0.4, twist: 'thief' },
  ],
  palette: { bg: '#2b2f6b', bg2: '#4b52b8', player: '#ffd23f', reward: '#3ee6a8', hazard: '#ff4f6d', ui: '#ffffff', ink: '#17152b' },
  cta: { text: '', pulse: true },  // '' = localized default ("Play now")
  store: { ios: '', android: '' }, // full store URLs; empty while building
  strings: {
    en:      { hint: 'Tap to catch', goal: 'Catch {n}', level: 'Level {n}', clear: 'Great!', winTitle: 'ALL CLEAR!', winSub: 'More levels are waiting.', failTitle: 'SO CLOSE!', failFar: 'NICE TRY!', failSub: 'Dodge the red ones.', cta: 'Play now', again: 'Play again' },
    'zh-CN': { hint: '点击接住', goal: '接住 {n} 个', level: '第 {n} 关', clear: '漂亮！', winTitle: '全部通关！', winSub: '更多关卡在等你。', failTitle: '差一点！', failFar: '再试一次！', failSub: '避开红色的。', cta: '立即玩', again: '再玩一次' },
    es:      { hint: 'Toca para atrapar', goal: 'Atrapa {n}', level: 'Nivel {n}', clear: '¡Genial!', winTitle: '¡TODO LISTO!', winSub: 'Te esperan más niveles.', failTitle: '¡CASI!', failFar: '¡BUEN INTENTO!', failSub: 'Esquiva los rojos.', cta: 'Jugar ya', again: 'Otra vez' },
  },
};
```

- Logic reads gameplay values through one helper that applies the difficulty scale (`const pace = v => v * config.difficultyScale[config.difficulty].pace`). Presentation reads colours and strings from `L.config`.
- **URL overrides** (client, at boot, clamped and type-checked, applied over the block): `?diff=easy|normal|hard`, `?lang=en|zh-CN|es`, `?cta=<text, ≤ 24 chars>`, `?ios=<url>`, `?android=<url>`, `?level=<n>`. Unknown keys are ignored. Language order: `?lang`, then `config.lang` when not `auto`, then `navigator.language`, then `en`.
- **Copy budgets in `en`:** hint ≤ 24 characters, end title ≤ 16, end subtitle ≤ 44, CTA ≤ 12. Write `en` first, then `zh-CN` and `es` by meaning; Spanish runs about 25 % longer, so test it on screen.
- **Easy/Hard must be visible.** Hard shows more on screen (more hazards, faster spawns), not only hidden HP changes. Easy and Hard pilots both win; idle loses on all three.
- Keep internal constants (collision radii, physics steps) in a separate `rules` object below the tunables, so the marketer block stays short.

## 5. Balance: on the edge, still winnable

- **Danger metric.** Logic computes `danger` 0–1 = how much of the lose resource is gone (or, for a timer, the share of time used) and keeps `maxDanger` per level. Expose both in `summarize(state)`.
- **Target bands for the pilot on Normal:** level 1 `maxDanger` ≤ 0.35; the near-fail level 0.6–0.9; the twist level 0.5–0.9. Tune numbers in 10 % steps until the bands hold; record the final values.
- **Pilot is human-like.** Give `pilot(state)` a reaction delay of about 8 ticks (0.25 s at 30 Hz) on every new target and no frame-perfect tricks. A perfect bot finishes too fast and hides a session that is too hard for people.
- **Idle loses, terminally.** Without input the game reaches `loss` before `config.maxSeconds`. If the genre has no lose resource (a pure sorting puzzle), add the brief's natural limit (moves, a filling dock, a creeping hazard) rather than a countdown the brief never asked for.
- **Tolerance.** Timing inputs succeed up to about 0.4 s late. A late input costs a unit of the lose resource, never the whole run.
- **One mistake is recoverable.** No single event spends more than half the lose resource. Rivals and pursuers rubber-band (slow when far ahead, speed up when far behind) so the threat stays on screen.
- **Nothing pays by itself.** A level clear, a reward or the win finale starts only from the player's input. A run with only the first tap must not clear level 2.
- **Same work on every seed.** The seed changes positions and order, never the amount of work in a level.

## 6. Screen layout and HUD

**Section summary.** Lay everything out in a 390×844 design unit scaled to the real container, reserve fixed regions for HUD, play and dock, and never let numbers, banners or the hand overlap each other or the thing the player is acting on.

- **Scale.** `u = min(containerW / 390, containerH / 844)`; in short containers (height/width < 1.6) fit the central 390×600 play band instead. Size UI in `u` via a CSS variable written from a `ResizeObserver` on the container, never from `vw/vh` or `screen`.
- **Regions (portrait, design px):** top HUD band 0–96 (with the two 56×56 corners empty), play band 96–760, bottom dock 760–844 (persistent CTA, optional mute). The player's object sits at 55–80 % of the height; the goal or threat at 20–45 %.
- **Top row.** One flex row inside x 64–326: level chip on the left, goal bar in the middle, score on the right, gaps ≥ 8 px; elements shrink their bars, never their text, and never wrap onto the playfield.
- **Numbers never overlap.**
  - Reserve the final width of a counting number (tabular digits, `min-width` in `ch`) so a count-up does not push neighbours.
  - Merge popups for the same target within 120 ms into one (`+3`, not `+1 +1 +1`), and give each target at most 3 vertical lanes; a new popup takes the free lane or replaces the oldest.
  - Clamp popups inside the play band and at least 12 px away from HUD rectangles; drop a cosmetic popup rather than cover a HUD value, the hand target or the CTA.
  - Floating numbers: ≥ 26 design px, bold, light fill with a dark outline of about 12 % of the font size, rise 40–60 px over 0.7 s, then shrink out.
- **One owner for instructions.** Priority: end card > level-clear banner > danger hint > tutorial hand. Only one shows at a time.
- **Touch targets** ≥ 48 CSS px, ≥ 16 px from the container edge. Pieces the player taps (pins, boats, cards) get a hit area at least 1.3× their drawn size.
- **Canvas sizing.** `canvas.width = cssW * dpr`, `canvas.style.width = cssW + 'px'`, `dpr = min(2, devicePixelRatio)`, re-run on resize and 200 ms after `orientationchange` without restarting the level.
- **No horizontal overflow at 390×844.** `html, body { overflow: hidden }`; no element wider than the container.

## 7. Look, juice and audio

- **Read in one glance.** Player, reward and hazard differ by hue (≥ 60° apart) and value; every actor has a dark outline or contact shadow of ≥ 2 px at 390 px width. Backgrounds carry a two-stop gradient plus a low-contrast silhouette layer; ground is never one flat fill. Bright, saturated frames outperform grey ones; keep neutral grey under a quarter of the frame.
- **Feedback on every input within one frame**, at the place of the input: squash on the touched piece, a particle burst in the reward or hazard hue, a sound. Big events add hit-stop (30–80 ms), screen shake (3–12 px, decaying), a flash and a camera kick.
- **Counts feel big.** Score and reward counters count up over 0.4–0.7 s with a 1.15× bump; multipliers and combos show as large popups; level clear shows a short confetti or coin shower that flies toward the counter.
- **Nothing jumps.** Positions, scale and HUD values move through damping or tweens (spawn: back-out pop 0.25 s; removal: 0.2 s shrink). Only the player's own controlled object follows input directly.
- **Procedural WebAudio SFX** with the kit's `audio.blip` pattern or a small synth: `tap`, `action`, `hit`, `pickup` (pitch climbs a pentatonic step per streak item, resets after 0.5 s), `clear`, `win`, `fail`, `cta`. Rate-limit each id (≥ 50 ms), cap simultaneous voices around 12, route through one compressor. A quiet 8–16 bar loop is optional. Mute toggles everything and is remembered only for the session.
- **Performance budget.** 60 fps target at 390×844 under software rendering, measured with `getStats().fps` in playtest:
  - Canvas 2D by default; Three.js only when the brief needs 3D and the inline size stays under the network budget.
  - Pool particles and bodies, cap them (for example 300 particles, 400 bodies); simulate a big crowd as a number and draw a capped subset.
  - Build gradients, patterns and sprite canvases once per resize, not per frame; no per-frame allocations in the hot loop.
  - Drop effects before frames: if the frame time averages over 24 ms for 2 s, halve particle caps and turn off shadows.

## 8. Genre presets

Pick the closest preset (a free-form brief: say which and why). Each entry: **Loop**, **Input**, **Must-haves**, **Feels good when**, **Accept** (what `openmotion_game_simulate` and playtest must show besides the general checks). World units refer to the kit's 9-wide portrait world.

**Racing.** Loop: hold to drive, steer to dodge gaps and overtake rivals, finish first. Input: hold anywhere to accelerate, drag sideways to steer. Must-haves: 2–3 rivals that start ahead and rubber-band, a position readout (`3rd → 1st`), hazards telegraphed a full second ahead (tiles blink before they drop), a boost pad, a finish banner. Feels good when: overtakes happen on screen with a whoosh and a position pop. Accept: reference finishes 1st; idle finishes last or falls; releasing the hold visibly slows the car.

**Runner (math gates).** Loop: the hero runs forward by itself; steer through the better of two gates (`+5`, `×2` vs `−3`, `÷2`) to grow a number, beat enemy groups, then a boss. Input: drag sideways; the hero's lane follows the finger directly. Must-haves: every gate pair has one good and one bad panel, numbers readable at decision distance, the number never changes without a popup explaining why, a boss whose number is beatable only on a mostly good route. Feels good when: the crowd or power number visibly swells at a `×` gate. Accept: gate math is exact in `summarize`; reference beats the boss; idle loses to the boss or the first bad gate.

**Party race.** Loop: before each zone pick one of three gates that gives the right gear (wings for a gap, skis for ice) and race a pack of rivals. Input: drag left or right to choose a gate. Must-haves: the next zone's need is shown before its gate row ("UP NEXT: ice"), the wrong gear costs visible places, every rival makes at least one wrong pick, 3–5 zones. Feels good when: the right gear sends the racer past several rivals at once. Accept: picking right in every zone finishes 1st; idle (staying in the middle gate) finishes outside the top 3.

**Swim race.** Loop: steer a small swimmer down a winding tube, dodge bumpers and stunning hazards, grab boost orbs and draft behind rivals, reach the goal first. Input: drag anywhere, relative steering; forward motion is automatic. Must-haves: a generated, always-passable course, a late neck-and-neck duel, boost orbs on the ideal line, stun shorter than 1 s. Feels good when: drafting and boosts produce a visible speed burst with stretch and trail. Accept: reference wins the duel; idle collides and finishes last.

**Swirl stack.** Loop: move a cone under a falling soft stream so it coils into a tall tower without toppling, up to a goal height. Input: drag; the cone follows the finger. Must-haves: lean grows with fast movement and recovers when slow, a height marker and goal line, a splat when the stream misses, a wobble warning before a topple. Feels good when: the coil rises smoothly with a rising pitch and the goal line bursts. Accept: reference reaches the goal height; idle splats until the miss limit ends the level.

**Crowd battle.** Loop: hold to fire units from a launcher, aim them through multiplier gates, push back a horde and defeat its boss. Input: hold to fire, drag to move the launcher; the launcher follows the finger directly. Must-haves: logical counts separate from drawn units (draw a capped subset), `×2/×3` gates that visibly clone units, a front line that moves both ways, a boss with an HP bar, nothing moves before the first touch. Feels good when: a gate pass spawns a wave of units with a pop sound per batch. Accept: count arithmetic is exact; reference clears the boss; idle lets the horde reach the launcher.

**Hero defense.** Loop: move a squad that aims and fires by itself; collect multipliers and weapon pickups; destroy waves or a boss before they reach the base. Input: floating joystick (origin where the finger lands, fixed while held). Must-haves: auto-fire only when enemies are in range, pickups visible 2 s before reachable, squad members with their own spacing and walk phase, floating damage numbers merged per target. Feels good when: a weapon pickup changes the firing pattern immediately. Accept: reference wins; idle loses the base; the squad never moves without joystick input.

**Idle tycoon.** Loop: walk to a source, gather items as a stream, carry a stack to a station, serve customers, collect cash, buy the next upgrade. Input: floating joystick. Must-haves: every transfer is a flying item with a pop (never a counter that just changes), the first upgrade affordable from a starting pile under the hero, prices under 100 in level 1, a helper or machine purchase that at least doubles throughput, every station inside the frame. Feels good when: the first helper starts working on its own and the cash stream speeds up. Accept: reference buys every upgrade and reaches the final unlock; idle earns nothing (customers leave or a raid ends the level); tycoons may end on a timed level goal instead of a death.

**Gem puzzle (match-3).** Loop: swap neighbouring gems to make lines of three or more, create power-ups, clear every blocker within a move budget. Input: swipe a gem, or tap two neighbours. Must-haves: a scripted first board whose hinted swap creates a power-up, cascades resolved before the next input, blockers with visible HP, a move counter, an invalid swap that bounces back without costing a move. Feels good when: a power-up chain sweeps a row with shake and a rising combo sound. Accept: the solver-backed reference clears all levels; idle runs out of moves (or a creeping blocker wins) and loses.

**Drop puzzle.** Loop: swap tiles in a narrow shaft so payloads sitting on tiles fall into a receiver at the bottom; fill the receiver meter. Input: swipe or tap-tap swap. Must-haves: payloads only fall when the tiles under them clear, a receiver that reacts (warms, eats, fills), a move budget, each level solvable by the solver. Feels good when: a payload drops several rows in one cascade and lands with a bounce. Accept: reference fills every meter; idle runs out of moves.

**Tower climb.** Loop: tap a target on the current floor; defeat only targets weaker than your power number to absorb it, climb floors, beat the top boss. Input: tap a target. Must-haves: power numbers on hero and targets always readable, a stronger target is tinted and warns before the fight, one wrong fight costs a life (not the run), the boss is beatable only after the right order. Feels good when: absorbing a target makes the hero's number tick up and the hero grow. Accept: reference follows the solvable order and wins; idle never climbs and the safety cap ends on the fail card.

**Pull the pin.** Loop: tap pins to slide them out so piles of particles (coins, water, balls) fall into the goal while hazards (lava, spikes, enemies) are kept away or neutralized. Input: tap a pin (hit area at least 1.3× the pin). Must-haves: cheap custom particle physics (capped count), one correct order per level that the reference performs, wrong orders that visibly ruin the outcome, a goal meter filling with each particle. Feels good when: a pile pours with clinks and the goal counter races up. Accept: reference fills every goal; idle loses through the level's hazard timer or a creeping threat; a wrong first pin fails that level.

**Jam sort.** Loop: tap vehicles or boats in a jammed board; each moves along its arrow if the way is clear; matching colours board the carrier, others park in a few dock slots; clear the board before the dock fills. Input: tap a vehicle. Must-haves: generated boards proven solvable, a blocked move bonks back and returns, the dock shows its free slots, the choke (dock almost full) arrives in level 2 or 3. Feels good when: a whole carrier fills and sails away with a horn. Accept: reference clears every board; idle leaves the dock filling from a conveyor or a timer the brief names; tapping in a wrong order fills the dock and fails.

**Eat and grow.** Loop: steer a predator that never stops; eat prey smaller than you to grow, avoid bigger ones, reach a frenzy or target size. Input: floating joystick or drag. Must-haves: size labels or clear visual size tiers, camera pulls back as the predator grows, prey respawns off screen so the area never empties, bigger threats telegraph their lunge. Feels good when: each bite pops a `+N` and the predator scales with a squash. Accept: reference reaches the final size; idle starves (hunger meter) or is eaten.

**Card battle.** Loop: play cards by dragging them into your side of the battlefield, paying with an energy bar that recharges; units fight their way to the enemy leader. Input: drag a card onto the field. Must-haves: four playable cards plus a next-card preview, card names and costs fully visible, a glowing deploy area while dragging, enemy units that pressure the lane, leader HP bars. Feels good when: a well-timed spell clears a cluster and the lane swings. Accept: reference destroys the enemy leader; idle loses its own leader.

**Shooter (gallery or defense line).** Loop: aim a fixed weapon and fire at waves of targets approaching a line; armoured targets take several hits; a boss has weak points. Input: drag to aim, hold or tap to fire (no auto-aim). Must-haves: line HP and the nearest target's distance always visible, hit flash, a number and knock-back on every hit, coins flying to the counter on a kill, the next wave visible before the current one dies. Feels good when: a weak-point hit triggers hit-stop and a big popup. Accept: reference clears every wave; idle lets the first wave breach the line.

**Adventure.** Loop: walk a hero through a few rooms, find keys for locked doors, avoid rhythmic traps, carry the treasure to the exit while a guardian wakes. Input: floating joystick. Must-haves: keys are the only way through doors, traps have a visible rhythm and telegraph, the current goal is on screen or shown by an arrow, a slower guardian whose threat is the shortcuts it takes. Feels good when: a door opens with a rumble and a camera beat on the next room. Accept: reference escapes with the treasure; idle is caught by a trap or the guardian.

**Merge, blast, hidden object and other briefs.** Pick the closest loop above for structure, write the core loop in one sentence ("tap groups of three or more same-colour blocks to clear the orders within the move budget"), and keep the same level arc, end cards, tunables, balance bands and QA.

## 9. Ad-network packaging (facts; later step)

**Section summary.** OpenMotion today ships the universal `index.html` described above. Per-network zips and SDK tags are a later packaging step; do not add any SDK tag to the universal file. The table records common published limits as observed in late 2026; specs change, so confirm with the network's current spec or preview tool before upload.

| Network | Upload form | Size cap | CTA call | Notes |
|---|---|---|---|---|
| AppLovin | single HTML | 5 MB | `mraid.open(url)` | Add `mraid.js` tag in the package; wait for MRAID ready |
| Unity Ads | single HTML | 5 MB | `mraid.open(url)` | MRAID injected by the webview; no `localStorage`, no auto audio |
| Meta (Facebook / Instagram / Audience Network) | single HTML, or zip with `index.html` | 2 MB HTML, 5 MB zip | `FbPlayableAd.onCTAClick()` | No MRAID, no JS redirects |
| Google App campaigns | zip with `index.html` | 5 MB, 512 files | `ExitApi.exit()` | Google's `exitapi.js` tag and `<meta name="ad.orientation" content="portrait">` |
| TikTok / Pangle | zip with `index.html` + `config.json` | 5 MB | `openAppStore()` | Orientation in `config.json`; SDK tag in the package |
| Mintegral | single HTML | 5 MB | `install()` | Call `gameReady()` on load, `gameEnd()` at the end card, `gameRetry()` on replay |
| Moloco | single HTML | 5 MB | `FbPlayableAd.onCTAClick()` | No `XMLHttpRequest` identifier, no `mraid.js` string |
| Liftoff (Vungle) | single HTML or zip | 5 MB | `mraid.open(url)` | Keep top corners free; no `window.open` |
| Chartboost | single HTML | 3 MB | `mraid.open(url)` | No `mraid.close()` or resize |

Rules for the universal file that keep later packaging possible:

- Stay under **2 MB** when the brief mentions Meta, otherwise under **4.5 MB**, leaving room for wrappers. A Canvas 2D ad with procedural art is usually 40–200 KB.
- No `window.open`, `location` changes or redirects in packaged builds: the packaging step deletes `previewOpen()` (section 3.4) and checks the file with a text search.
- Keep both top 56×56 px corners free; no own close button.
- Start timers and audio only after the first interaction and the container's ready/visible signal (section 3.5).
- Never stub an SDK object; detect it at call time.

## 10. QA checklist (run before validate and publish)

Run every item on the inlined `index.html` (section 2). Record the inputs, the measured value and the pass/fail in `design/verification.md`; a check that could not run is listed as not run, with the reason.

| # | Check | How in OpenMotion | Pass |
|---|---|---|---|
| 1 | Reference wins | `openmotion_game_simulate` `players:1`, `scripts:"reference"` | Terminal, winner present, `summarize` shows the last level cleared, level-1 clear tick and per-level `maxDanger` inside the bands of section 5 |
| 2 | Idle loses | `openmotion_game_simulate` `players:1`, `scripts:"idle"` | Terminal loss, no winners, before `config.maxSeconds`; a budget timeout is not a pass |
| 3 | Console 0 errors | `openmotion_game_playtest` `clients:1` with a click script | No page or console errors, no failed requests |
| 4 | Interactive within 1 s | Playtest script: wait 600 ms, mouse click on the hand target (1280×720 coordinates), wait 400 ms; read `getState()` | Tick advanced and the first input registered (`phase: 'playing'`, a score or move change) within 1 s of load |
| 5 | Tutorial visible | `openmotion_game_capture_cover` with `delayMs:700` and no actions; inspect the image | Hand and instruction on the first-move target, no title card |
| 6 | Win end card reachable | Playtest with the pilot's inputs as a key/mouse script (≤ 100 actions, ≤ 60 s of waits). If the full path does not fit, set `config.startLevel` to the last level for one run, test, then restore it and record both runs | End card visible with title, CTA and Play again |
| 7 | Fail end card reachable | Playtest with no input after the first tap until the loss | Fail card with encouraging title, tip, CTA and Play again |
| 8 | CTA calls `openStore` | Playtest click on `#cta-end`; read `getState().ad.events` from the after-snapshot | One `cta_click` event; Play again produces `replay`, never `cta_click` |
| 9 | No network requests | Playtest failed/external request list; text search of `index.html` for `http://`, `https://` in `src`/`href`, `fetch(`, `XMLHttpRequest`, `@import`, `localStorage` | Zero requests; store URLs only inside `config.store` |
| 10 | 390×844, no horizontal overflow | Playtest `mobileHorizontalOverflow` assertion | Pass; screenshot shows HUD inside the top band and corners empty |
| 11 | No overlapping numbers | Inspect playtest screenshots at the busiest moment and the end card | No HUD, popup, banner or hand overlaps another or the hand target |
| 12 | Replay resets | Playtest: reach an end card, click Play again, play 2 s | Fresh level state, no duplicated objects, no errors |
| 13 | File size | Byte length of `index.html` | Reported; under the target of section 9 |
| 14 | Languages | Headless tools cannot pass a query string: set `config.lang` to `zh-CN`, then `es`, capture the hand and an end card for each, then restore `auto` | No English left, no raw keys, no clipped text on the hand line and end card |
| 15 | Frame pacing | Playtest `getStats().fps` | Report the measured RAF pacing; software rendering is not phone performance |

- Puzzles without a moving player: pass `movementThreshold: 0` to playtest, because its default net-displacement assertion assumes a moving avatar, and expose `players[selfId].x/z` as the cursor or last-touched cell.
- `openmotion_game_capture_cover` crops a 16:9 frame: a portrait ad appears letterboxed. Capture mid-level (an action script that makes the first move) so the cover shows play, not the hand.
- Then run `openmotion_game_validate`, set status `ready`, update metadata (`title`, `description`, `controls`, `zh-CN`), and publish locally only with authorization, as in the [game flow](game-flow.md).

## 11. Final message additions

On top of the standard final message in the skill, say in plain language: the ad's length on Normal, the number of levels, the CTA text and whether store links are still empty, the file size, which network limits it already meets, and that per-network packaging and real-device ad-network testing have not been done.
