# Hollow Signal

Find human voices inside an empty town's static: a restrained radio-search horror vignette where careful tuning preserves sanity.

## Rules

- Tune 88–108 MHz with A/D or arrows; hold Shift for precision. A mouse/touch slider or dragging across the scene changes the same frequency.
- A clear signal reveals a survivor and location. Hold Space or the Hold Signal button to fill the rescue link. Releasing or losing signal slowly reduces the link.
- Rescue four survivors before sanity reaches zero to win. Sanity drains over time; holding a noisy frequency accelerates loss, while each rescue restores some sanity. Restart resets the radio and survivors.
- Each successive voice has a narrower tuning window, takes longer to lock and adds background sanity pressure. The last two carriers drift slightly, requiring finer tuning.

## Art

`town.webp` is the original fog-bound town; `radio.webp` is the illustrated field receiver used in play. A live frequency needle, interference waveform, signal/lock feedback, vignette and low-sanity tint establish the minimal horror presentation. The cover uses the fog-town composition and lettered title.

## Implementation and verification boundary

The game is a standalone authored HTML canvas document, separate from Studio chrome. All CSS, JavaScript, WebAudio synthesis and game state are inline. Only local assets are loaded. Sound starts muted and requires a user gesture. Keyboard, pointer/touch, pause/resume, restart, visibility pausing, bounded particles, reduced motion and DPR-capped resize are implemented.

The cover and environment background were replaced on 2026-11-20 using the built-in image generation tool, with painterly key-art direction. The three existing painted template covers were inspected as visual references. Final outputs were fitted to 1280 x 720 and encoded locally as WebP within their original paths and byte budgets. Code-critical transparent sprites and the calibrated radio panel were preserved. No gameplay, CSS overlays or manifest values changed. The PNG sprite sheet/character retains its original true alpha. Both runtime images are consumed during play. Generated and compressed images were visually inspected separately from browser acceptance.

A temporary Node + jsdom/VM harness passed 169 assertions across the three templates: game state, manifests, solvable boards, matches/cascades, movement/collision, wall kicks, checkpoint penalties, rescues, both terminal outcomes, pause/resume/restart and desktop/portrait/landscape DPR paths. Canvas drawing was mocked; these assertions are **not browser rendering or performance evidence**. Pillow separately checked cover dimensions, image decode, transparent alpha and all byte budgets. Scripts are temporary under `$TMPDIR` (`om-games-route.cjs`, `om-games-test.cjs`, `om-games-file-test.cjs`). No dependencies were installed.

The required localhost Puppeteer test could not run: binding a loopback HTTP server failed with `listen EPERM: operation not permitted 127.0.0.1`. A file-URL attempt with Chrome pipe transport failed with `TargetCloseError` during browser startup. No screenshots were generated; title/play screenshots, visual browser iteration, real touch/audio behavior, console-error acceptance and 60 fps remain unverified. The requested Desktop screenshot destination is also outside the permitted write scope. Neither generated mock screenshots nor simulated browser-success claims are included.

## Art replacement prompts (built-in image generation)

**Cover prompt:**

Create finished 16:9 1280x720 painted cinematic key art for original minimal psychological horror game. Title exactly "Hollow Signal" in large tasteful pale ivory editorial serif lettering in upper-left dark fog, perfectly spelled and legible at market-card scale. Only this text. In right/lower foreground, a weathered portable analog field radio on a damp wooden windowsill, tactile brushed metal, worn knobs, dim green illuminated frequency window, antenna rising into gloom. Beyond it an empty wet street disappears between decaying modern coastal town buildings and power poles into thick sea fog. One lonely distant amber-lit window; a faint ambiguous person-shaped shadow far in the mist, no identifiable existing character. Restrained unsettling atmosphere, gorgeous visible oil and gouache brushwork, finely painted material detail, volumetric mist, muted deep petrol green/slate palette, dim cream sodium light with a small warm amber accent. The radio provides the clear focal point and human scale, town establishes lonely narrative. Sophisticated painterly indie horror game cover at same finish as premium illustrated game key art. No gore, no UI, no logos, no brands, no watermark, no flat vector or geometric placeholder art.

**Environment prompt:**

Create a finished 16:9 landscape 1280x720 background for a restrained modern horror radio game, original fog-bound abandoned coastal town at blue-gray night. No text, no letters, no UI, no characters, no monsters, no radio in the image. Premium painterly cinematic environment concept art with visible oil/gouache brush texture, weathered modern houses, a deserted wet two-lane street receding into thick volumetric sea fog, telephone poles and sagging powerlines, dark shopfronts, distant water tower, a single tiny warm amber window suggesting somebody is still alive. Muted desaturated petrol green, slate, blue charcoal, small pale sodium-lamp halos. Layered depth, palpable dampness, beautifully painted realistic materials and atmospheric light, eerie and quiet rather than gory. Reserve a broad dark low-contrast center and lower-center for a radio interface overlay while detailed buildings and twisted powerlines frame the side edges. Sophisticated hand-painted indie horror game box quality, not vector, no flat silhouettes, no logos, no watermark.
