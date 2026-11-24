---
name: vs-generate
description: Make footage that does not exist yet - text/image to video, still-to-film depth parallax, AI b-roll and character or object swaps - on two tiers - local CPU (LTX-Video 2B, Wan 2.1 1.3B in ComfyUI) and a rented Nvidia GPU (LTX 13B, Wan 14B t2v/i2v, FreeVideo/MiniMax-H3, Openjutsu) sharing one model store and one job script. Use when footage must be generated; plan the shots with vs-director first.
---

# Generate (one model store, two tiers)

Always plan the shot in `vs-director` first (six layers, one sealed move). Generation without a shot spec wastes hours on this CPU and money on the GPU.

## Decide the tier

| Need | Local CPU tier (free, slow) | Nvidia GPU tier (paid by the hour) |
|---|---|---|
| Short b-roll, abstract motion, textures | LTX-Video 2B distilled fp8, ≤512 px wide, 3–5 s, 15–40 min | LTX 13B distilled fp8: 768–1280 px, minutes |
| Realistic motion from text | Wan 2.1 1.3B, 30–60+ min, small | Wan 2.1 14B t2v fp8 |
| Animate a still (listing photo, illustration) | Still-to-film depth parallax (`vs-director` mode; depth model on CPU is slow but works) | Wan 2.1 14B i2v 480p fp8 |
| Long clips with sound, drama shots | — | FreeVideo (MiniMax-H3, ~60 s), needs RTX 30+ ≥ 8 GB |
| Replace a person or object in a video | — (refused locally) | Openjutsu (needs 16 GB VRAM **and 64 GB system RAM**); written consent from anyone replaced |
| Many variations, batch b-roll | — | Any GPU model; batch in one rental session |

Rule of thumb: if the CPU tier needs more than ~2 hours for the job, or the result fails the look gate twice, propose the GPU tier with a price (see `smoothie/GPU-TIER.md`) and wait for a yes.

## One model store

All weights live in `C:\Users\Sharafath\AI-Local\ComfyUI\models` (local) and `~/ComfyUI/models` (GPU box), fetched by `smoothie/install/download_models_family.py` from official Hugging Face repos and verified by SHA-256. Shared encoders (T5, UMT5) and the Wan VAE are stored once. Never download a second copy under another name; never load `.ckpt/.pt/.pkl` from unofficial sources.

## Running a job (same on both tiers)

1. Build the workflow in ComfyUI, then **Export (API)** to `video-projects/<project>/gen/<shot>.json`.
2. Local: start ComfyUI with `--cpu` (close other heavy apps; RAM is shared with the iGPU). GPU: rent → prepare → tunnel (`GPU-TIER.md`).
3. `python smoothie/install/gpu/comfy_job.py <shot>.json --set 6.text="<prompt>" --set 3.seed=42 --out video-projects/<project>/gen/` (loopback servers only).
4. Look gate on the first clip; then batch the rest **in the same session**; then **destroy the GPU instance** and confirm it is gone.
5. Hand the clips to `vs-edit` (upscale/fit, grade to match, conform fps).

## Prompting (from the shot spec)

Order: subject and action → setting → shot size/angle/lens → camera move with start and end → light and palette → style → duration. One move per clip. Describe the subject's blocking. Negative: flashes, morphing hands/faces, text, warping architecture, heavy objects moving. For real estate: straight verticals, no new furniture or features that are not in the listing photos (never misrepresent a property).

## Paid generators (fallback only, spend gate)

fal.ai, Replicate, Higgsfield, Seedance, Kling, Veo, muapi.ai, HiAPI/Pollo (Hypit), Atlas Cloud (vox-director): only when the user asks and approves the cost in this conversation. Keys are single-use and never written to the repo.

## Sources merged here (references only)

ComfyUI (Comfy-Org, reviewed commit d5d59c4) · Lightricks LTX-Video and Comfy-Org Wan 2.1 weights · FlashML-org/FreeVideo@2259974 (GPU tier) · d3voz/openjutsu@7fe118b (GPU tier; MIT) · AustinZ21/cinematic-skills (still-to-film depth plates) · moh4696/open-3d-skills (motion-assets cost planning; MIT) · kaomei/stickman-video-director@8394bec (model-engine prompt contracts; MIT) · hypit-ai/hypit@9a6f688 (generation directing ideas; modified Apache, paid backends) · voyager-so/vork@bc228cb (Vulkan 3D engine; source-available preview licence — optional, see results table).
