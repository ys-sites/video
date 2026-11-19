# Bang Motion reconnaissance

Source reviewed: commit `c1aa65e921c970d858705fcb4a53a8294d1a4131`, initially clean. This is Phase 1 reconnaissance only, not a completed audit.

Bang Motion is an agent-oriented HTML motion-graphics toolkit. The operator supplies briefs, assets, working directory and optional browser/renderer inputs. Main entry points are `SKILL.md`, starter HTML under `assets/`, `scripts/serve.py`, `scripts/snap.mjs`, `scripts/export-frames.mjs`, and optional `scripts/ae/bridge/`.

Local server `scripts/serve.py:9` serves the current directory on loopback. `scripts/snap.mjs:24` and `scripts/export-frames.mjs:17` accept caller-controlled URLs and output paths and launch Puppeteer. `scripts/ae/bridge/svg2png.cjs:3` accepts SVG, inserts it into a browser page and writes output beside input. Starter pages reference external JavaScript and fonts. `scripts/ae/bridge/package.json:6` has a placeholder test and `:13` specifies a Puppeteer dependency. `references/ae-bridge-higgsfield.md:20` describes an optional remote relay; no connection is established by this review.

These are trust-boundary leads, not confirmed vulnerabilities or malware. Whether another actor controls the inputs, browser sandboxing, active network reachability and relevant deployment assumptions are not established. No target code was executed. The browser dependencies and the full required sandbox/evidence-promotion controls need verification before any dynamic validation. No compatible prior coverage ledger was found for this repository.
