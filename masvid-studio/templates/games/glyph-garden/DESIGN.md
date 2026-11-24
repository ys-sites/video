# Glyph Garden

A small swap becomes a cascading moonlit bloom: a gentle match-3 puzzle with finite moves and multiplying chain reactions.

## Rules

- Select two adjacent blooms, drag/swipe, or use arrow keys and Space/Enter. Only swaps forming a horizontal/vertical line of at least three spend a move; invalid swaps revert.
- Matched blooms yield 40 points each, multiplied by cascade depth. Columns refill and resolve again until stable. A board with no legal swap reshuffles without spending a move.
- Reach 2,200 points within 24 moves to win. Exhausting the moves below the target loses. Restart generates a new solvable board and resets score/moves.
- Four bloom species begin the garden. At 900 points, a fifth species joins new refills, making future matches less frequent. The move budget adds late-game pressure.

## Art

`garden.webp` is the layered moon-garden setting; `blooms.webp` is an original five-flower transparent sprite sheet. The cover uses the setting and lettered title. Moonlight, bloom particles, cascade score floats and restrained shake provide feedback.

## Implementation and verification boundary

The game is a standalone authored HTML canvas document, separate from Studio chrome. All CSS, JavaScript, WebAudio synthesis and game state are inline. Only local assets are loaded. Sound starts muted and requires a user gesture. Keyboard, pointer/touch, pause/resume, restart, visibility pausing, bounded particles, reduced motion and DPR-capped resize are implemented.

The cover and environment background were replaced on 2026-11-20 using the built-in image generation tool, with painterly key-art direction. The three existing painted template covers were inspected as visual references. Final outputs were fitted to 1280 x 720 and encoded locally as WebP within their original paths and byte budgets. Code-critical transparent sprites and the calibrated radio panel were preserved. No gameplay, CSS overlays or manifest values changed. The PNG sprite sheet/character retains its original true alpha. Both runtime images are consumed during play. Generated and compressed images were visually inspected separately from browser acceptance.

A temporary Node + jsdom/VM harness passed 169 assertions across the three templates: game state, manifests, solvable boards, matches/cascades, movement/collision, wall kicks, checkpoint penalties, rescues, both terminal outcomes, pause/resume/restart and desktop/portrait/landscape DPR paths. Canvas drawing was mocked; these assertions are **not browser rendering or performance evidence**. Pillow separately checked cover dimensions, image decode, transparent alpha and all byte budgets. Scripts are temporary under `$TMPDIR` (`om-games-route.cjs`, `om-games-test.cjs`, `om-games-file-test.cjs`). No dependencies were installed.

The required localhost Puppeteer test could not run: binding a loopback HTTP server failed with `listen EPERM: operation not permitted 127.0.0.1`. A file-URL attempt with Chrome pipe transport failed with `TargetCloseError` during browser startup. No screenshots were generated; title/play screenshots, visual browser iteration, real touch/audio behavior, console-error acceptance and 60 fps remain unverified. The requested Desktop screenshot destination is also outside the permitted write scope. Neither generated mock screenshots nor simulated browser-success claims are included.

## Art replacement prompts (built-in image generation)

**Cover prompt:**

Use case: stylized-concept. Create a finished 16:9 landscape 1280x720 premium painted indie-game key art for "Glyph Garden". Fantasy anime storybook gouache and luminous painterly brushwork, finely rendered botanical detail, atmospheric depth like a deluxe illustrated game box. An original young moon-garden keeper in an elegant flowing teal cloak tending magical five-petal flowers on a terraced secret garden, glowing pink peach lilac blossoms curling around weathered carved stone glyphs, tiny luminous moths, lush overgrown glass conservatory and spired fantasy towers beyond, huge pearl moon and deep indigo dusk, warm golden windows. Beautiful layered composition with the gardener and flowers on the right, luminous garden paths leading into distance. Exact title text "Glyph Garden" in large tasteful cream-gold hand-lettered serif calligraphy at upper left, perfectly spelled and very readable at card size. Only this title, no additional text. Sophisticated rich light and texture, original character only, no logos, no watermark. Not flat vector art, not simple geometric shapes, not pixel art. Render complete polished cinematic key art.

**Environment prompt:**

Create a complete finished 16:9 landscape 1280x720 painterly fantasy anime moon garden environment background for an elegant match-3 video game. No text, no letters, no UI, no characters. Sumptuous storybook gouache brushwork, highly detailed layered botanical environment, cinematic depth and soft luminous light. A magical walled garden at dusk, lilac and peach flowering vines framing the far left and right edges, weathered moss-covered stone arches, overgrown glass conservatory with warm amber windows in middle distance, fantastical pale spires, huge pearl moon upper right in deep indigo sky, a gentle narrow garden path and small fireflies. The central half should be atmospheric soft dark blue teal low-contrast foliage and distant garden so a 7x7 puzzle grid remains legible there. Flowers on the foreground edges and corners richly painted and detailed, beautiful painterly texture and nuanced volumetric lighting. Same sumptuous illustrated game-box quality as polished hand-painted indie fantasy key art. Original environment, no logos, no watermark. No flat vector shapes, no polygon art.
