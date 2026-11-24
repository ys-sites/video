# Skyline Courier

Carry three parcels through a rainlit skyline: a short parkour route combining momentum, forgiving jumps and wall kicks against a shift timer.

## Rules

- Move with A/D or arrows; W/Up/Space jumps. Mouse/touch direction pads and Jump expose the same actions; clicking/tapping the scene jumps.
- Deliveries are collected on contact. Land on rooftop tops; contact with a wall enables a limited wall-slide and a jump pushing upward/away. Coyote time and jump buffering make edge jumps forgiving.
- Deliver all three parcels within 90 seconds to win. Falling returns to the latest delivery checkpoint and costs seven seconds. Timer expiry loses. Restart resets parcels, physics, checkpoint and time.
- Early roofs teach jumps; later roofs narrow and rise, with a high wall requiring a kick. The final climb combines rising roofs and wider gaps.

## Art

`city.webp` is an original layered neon city; `courier.webp` is an original transparent helmeted courier. Perspective roof caps and side faces provide a dimensional, 2.5D presentation. The cover uses the courier and city. Rain, trails, delivery glows, particles and camera easing add motion.

The offline route simulation completed all three deliveries using only movement/jump inputs, with zero falls and approximately 80 seconds remaining. This establishes route reachability under the implemented physics, not human/browser acceptance or a fully rendered 3D engine.

## Implementation and verification boundary

The game is a standalone authored HTML canvas document, separate from Studio chrome. All CSS, JavaScript, WebAudio synthesis and game state are inline. Only local assets are loaded. Sound starts muted and requires a user gesture. Keyboard, pointer/touch, pause/resume, restart, visibility pausing, bounded particles, reduced motion and DPR-capped resize are implemented.

The cover and environment background were replaced on 2026-11-20 using the built-in image generation tool, with painterly key-art direction. The three existing painted template covers were inspected as visual references. Final outputs were fitted to 1280 x 720 and encoded locally as WebP within their original paths and byte budgets. Code-critical transparent sprites and the calibrated radio panel were preserved. No gameplay, CSS overlays or manifest values changed. The PNG sprite sheet/character retains its original true alpha. Both runtime images are consumed during play. Generated and compressed images were visually inspected separately from browser acceptance.

A temporary Node + jsdom/VM harness passed 169 assertions across the three templates: game state, manifests, solvable boards, matches/cascades, movement/collision, wall kicks, checkpoint penalties, rescues, both terminal outcomes, pause/resume/restart and desktop/portrait/landscape DPR paths. Canvas drawing was mocked; these assertions are **not browser rendering or performance evidence**. Pillow separately checked cover dimensions, image decode, transparent alpha and all byte budgets. Scripts are temporary under `$TMPDIR` (`om-games-route.cjs`, `om-games-test.cjs`, `om-games-file-test.cjs`). No dependencies were installed.

The required localhost Puppeteer test could not run: binding a loopback HTTP server failed with `listen EPERM: operation not permitted 127.0.0.1`. A file-URL attempt with Chrome pipe transport failed with `TargetCloseError` during browser startup. No screenshots were generated; title/play screenshots, visual browser iteration, real touch/audio behavior, console-error acceptance and 60 fps remain unverified. The requested Desktop screenshot destination is also outside the permitted write scope. Neither generated mock screenshots nor simulated browser-success claims are included.

## Art replacement prompts (built-in image generation)

**Cover prompt:**

Create finished 16:9 1280x720 premium painterly cinematic key art for original cyberpunk rooftop parkour game. Title text exactly "Skyline Courier", large elegant ivory lettering at upper left, extremely readable, integrated into composition. Only these words, no additional text or logos. An original athletic helmeted courier with opaque luminous pale cyan visor, coral pink jacket, dark trousers, mint luminous shoes and a small turquoise delivery backpack, mid-leap toward the right over a dramatic gap between wet rooftop ledges. Long scarf trailing, rain catching neon light, believable dimensional character with hand-painted fabric detail, not flat/vector. Vast richly detailed futuristic city behind, teal and coral neon reflections, deep indigo and violet haze, original skyscrapers, antennae, suspended walkways and tiny warm windows, pale peach moon in clouds. Beautiful atmospheric scale and depth, 3D cinematic perspective with painterly brush textures, polished deluxe indie-game cover finish, dynamic diagonal action, not a screenshot or UI. Title is tasteful stylish display typography and correctly spelled. No existing IP, no brands, no watermark.

**Environment prompt:**

Create a finished premium 16:9 landscape 1280x720 environment background for an original cyberpunk rooftop parkour game called Skyline Courier. NO text, no letters, no UI, no characters, no foreground platform objects. Cinematic dimensional 3D scene rendered with rich painterly brushwork and atmospheric perspective, finely detailed roof ventilation, rooftop gardens, antennae, layered original near-future towers, tangled aerial bridges, tiny window lights, wet concrete and neon reflections. Deep navy night and violet shadows, elegant turquoise and coral neon light, enormous pale peach moon upper right partially lost behind towers, rain and luminous mist in distance. Midground skyline and receding city are main focus; skyline softened at center so a small running courier can be seen over it. Lower third dark receding building facades, no imposing foreground structures or hard roofs that confuse actual collision platforms. Sophisticated painted science-fiction game key-art quality, beautiful warm/cool contrast, substantial material detail. Original unbranded city. No logos, no watermark, not flat vector art, not simple geometric city blocks.
