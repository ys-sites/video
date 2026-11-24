# Lighthouse Log

## Experience formula

Seven nights as a keeper: every act of light costs something, and every rescued person can become the reason another survives.

## Loop and rules

Read each night, choose one of three actions and inspect its immediate result. Fuel gates costly options. Structure absorbs storm wear (1 nightly, rising to 2 on nights 5–7). Hope and five named rescue states persist. Mara unlocks a safe route for June; Elias makes saving Ada and the lens possible; June helps a repair; three rescued people can brace the lantern. The first-night salvaged lamps provide a fuel-free final signal. Resource effects and prerequisites are visible before selecting. At least one option is always free.

## Ending and ramp

Start with 8 fuel, 7 structure, 4 hope and zero sheltered people. Complete seven nights with the tower standing for a dawn ending, graded by rescued people and the final signal. Zero structure ends early with survivors moved to cliff shelter. The final log preserves every selected action and outcome in-memory until restart. R or Play again resets all decisions and rescues; no network or storage. Storm wear and fuel demands intensify; narrative choices rather than reflex timers create the difficulty.

## Survival scope

The named count means people actually sheltered by the keeper. Missing rescue windows leave their fate unresolved until the ending; successfully sheltered people survive even in a tower-collapse ending. The seven-night best ending requires at least four rescued people and a safe dawn signal.

## Art direction

Built-in image generation only; original art, no brands or external runtime dependencies. Cover: painterly 16:9 key art with the game title. Two in-game assets are loaded and rendered in the actual play scene. Flat-magenta sprites are keyed to real alpha with Pillow and edge colors decontaminated. Final assets are locally resized/compressed; generation originals are not shipped.

## Input and presentation

Mouse / touch: select a choice · 1–3 choose · Enter continues; Read each consequence before deciding. Your supplies and earlier rescues change later outcomes.. P / Escape pauses; R restarts. Sound starts muted and can be enabled after a user gesture. Backgrounding clears inputs and pauses. Menus support native keyboard focus, responsive layouts and reduced motion.

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
