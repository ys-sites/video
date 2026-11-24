# Blender 3D mode (headless, local CPU / Vega 8)

Installed: Blender 5.3.0 portable at `C:\Users\Sharafath\AI-Local\apps\blender-5.3.0\blender.exe` (official build, SHA-256 checked against download.blender.org). Online access and add-on extensions stay off (`--factory-startup`).

Use Blender when the shot is real 3D: a floor plan, a product, a lesson object, a 3D title. Two-dimensional motion stays in Remotion/HyperFrames; browser three.js stays for interactive web pieces.

## Run

```powershell
$B = "C:\Users\Sharafath\AI-Local\apps\blender-5.3.0\blender.exe"
$S = ".claude\skills\vs-motion\scripts\blender_scene.py"
& $B -b --factory-startup -P $S -- --spec shot.json --out renders\shot --still   # proof frame first
& $B -b --factory-startup -P $S -- --spec shot.json --out renders\shot           # all frames
ffmpeg -framerate 30 -i renders\shot\frame_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 shot.mp4
```

Always render the `--still` proof frame and look at it before the full render. Then `vs-edit` QA.

## Spec examples

Floor plan "dollhouse" orbit (listing reels; rooms in metres from the agent's floor plan; one `door` per room, optional):

```json
{"kind": "floorplan", "seconds": 6,
 "rooms": [
  {"name": "Living", "x": 0, "y": 0, "w": 5.2, "d": 4.1, "door": {"side": "e", "at": 0.5}},
  {"name": "Kitchen", "x": 5.2, "y": 0, "w": 3.4, "d": 4.1, "door": {"side": "n", "at": 0.3}},
  {"name": "Bedroom", "x": 0, "y": 4.1, "w": 4.0, "d": 3.6, "door": {"side": "s", "at": 0.8}},
  {"name": "Bath", "x": 4.0, "y": 4.1, "w": 2.2, "d": 2.4, "door": {"side": "s", "at": 0.5}}]}
```

3D title or stat: `{"kind": "title", "text": "SOLD\nIN 9 DAYS", "accent": [0.85, 0.6, 0.25], "seconds": 4}`

Product or lesson object turntable: `{"kind": "turntable", "model": "C:/path/model.glb", "seconds": 8}` (no `model` renders a test object).

Common keys: `width`/`height` (default 1080×1920), `fps` 30, `seconds`, `scale_percent` (50 for drafts), `samples` (Eevee 32 default; 16 for drafts), `engine` `eevee` | `workbench` (flat, fastest) | `cycles` (CPU, slow: stills only), `background`, `accent`, `elevation`, `sweep`, `margin` (framing room around the subject), `lens`, `look`, `sun`, `world_strength`.

## Speed on this PC

Measured numbers are in the install record (`smoothie/README.md`). Rules of thumb: draft at `scale_percent: 50` and `samples: 16`; Eevee for motion; Cycles only for single hero stills; keep shots ≤ 8 s and cut them together in `vs-edit`.

## Direction rules (from `vs-director`)

- One sealed camera move per shot: slow orbit ≤ 60° for plans, push-in for titles, 360° only for product turntables.
- Interiors: 24–35 mm lens, eye height 1.5–1.7 m, straight verticals; exteriors: correct verticals.
- Real scale (metres) from real plans; never invent rooms, sizes or features for a listing (truth in advertising, `vs-real-estate`).
- Neutral walls, one accent colour, soft light; avoid over-saturated materials.

## Sources

Written fresh. Ideas from arjun988/blender-skills (archviz, camera-cinematography, lighting notes; MIT) and mromidev/claude-blender-skills (reviewed, not installed: SkillSpector DO_NOT_INSTALL on its MCP bridge).
