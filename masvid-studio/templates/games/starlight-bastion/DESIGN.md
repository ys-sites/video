# Starlight Bastion

## Experience formula

A lone guardian, a fragile crystal and five tightening rings of enemies: kite the swarm, intercept threats and turn each victory into a stronger build.

## Loop and rules

Move independently from aim. Mouse fires toward its crosshair; Space or touch fires at the nearest enemy. Most invaders target the crystal, others pursue the guardian. Body collisions damage the target. Each cleared wave opens three upgrades: faster fire; health/core repair with stacking damage resistance; or +1 shot damage. No simulation runs while choosing.

## Ending and ramp

Guardian and crystal start at 100. Either reaching zero loses. Clear five waves to win; R or the end menu fully restarts, including upgrades. Waves grow from 8 to 16 enemies, spawn faster, move faster and gain health; elites appear from wave three. Projectiles expire and particles have a fixed cap.

## Art direction

Built-in image generation only; original art, no brands or external runtime dependencies. Cover: painterly 16:9 key art with the game title. Two in-game assets are loaded and rendered in the actual play scene. Flat-magenta sprites are keyed to real alpha with Pillow and edge colors decontaminated. Final assets are locally resized/compressed; generation originals are not shipped.

## Input and presentation

WASD / arrows move · Mouse aims + hold click fires · Space auto-aims + fires; Touch: drag to move + auto-fire · FIRE button auto-aims · 1–3 choose upgrades. P / Escape pauses; R restarts. Sound starts muted and can be enabled after a user gesture. Backgrounding clears inputs and pauses. Menus support native keyboard focus, responsive layouts and reduced motion.

## Verification — 2026-11-20

- `node templates/games/tidebreaker/verify-offline.cjs`: all three games, 115 assertions passed, including 300 simulated 60 Hz frames each, input, pause/resume/restart, game endings, upgrade effects, catalogue schema and asset closure. This harness uses a stub DOM and canvas, not Chrome.
- `GAME_TEST_WIDTH=390 GAME_TEST_HEIGHT=844 node templates/games/tidebreaker/verify-offline.cjs`: the same 115 assertions passed at portrait geometry.
- Lighthouse story enumerates all 2,187 choice sequences; 2,134 produce a valid complete/early-ending run under fuel restrictions. Four ending labels and rescue counts from zero through five are reachable. Prefixes ending early are counted once per enumerated sequence, not as unique paths.
- Pillow checks: 1280×720 cover; under-budget files; genuine 0–255 alpha on sprites; no opaque magenta key fringe.
- JavaScript compilation and `git diff --check` passed.
- Browser acceptance remains **unverified**: starting the required local HTTP server returned `listen EPERM: operation not permitted 127.0.0.1:41873`; the specified Chrome executable also failed to launch in this sandbox. No real browser screenshots or frame-rate measurements were produced.
- `node templates/games/tidebreaker/verify-browser.cjs` is prepared for a local session that permits loopback listeners and Chrome. It serves only the three new games, blocks external page requests, starts through actual UI controls, plays for at least five seconds, checks errors, pause/restart and portrait touch, then saves `<id>-title.jpg`, `<id>-play.jpg` and `<id>-mobile.jpg` into each game's `screenshots/` folder.
- The requested Desktop screenshot destination was not written because the task restricts writes to the new game folders. `screenshots/` is reserved, currently empty; no screenshot should be inferred from this document.
- The built-in generation tool automatically saved its original-image cache outside the checkout; its interface does not expose a save-location setting. Only compressed final assets are part of these game folders. No paid API or CLI internet request was used.
