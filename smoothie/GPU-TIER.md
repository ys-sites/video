# Nvidia GPU tier

Everything that needs CUDA runs here: LTX-Video 13B, Wan 2.1 14B (text→video and image→video), FreeVideo/MiniMax-H3, Openjutsu, fast depth/upscale, and Blender Cycles at scale. Your PC (Radeon Vega 8, no CUDA) stays the control room: it plans, sends one job, gets the files back.

**Paid.** Nothing in this file runs without your yes for that specific job. Prices are the figures in your brief (Nov 23, 2026); re-check them on the provider's page at rent time.

## How a job flows

```
this PC (vs-generate)                          rented Linux GPU box
1. export ComfyUI workflow (API JSON)
2. rent-gpu.sh vast start <offer> --yes  ───▶  box boots (pytorch CUDA image)
3. ssh in, prepare-gpu-box.sh <family>   ───▶  ComfyUI @ reviewed commit d5d59c4, models from HF, SHA-256 verified,
                                               listening on 127.0.0.1:8188 only
4. rent-gpu.sh vast tunnel <ssh-target>  ◀──▶  ssh -L 8188:127.0.0.1:8188 (nothing exposed to the internet)
5. comfy_job.py shot.json --server http://127.0.0.1:8188 --out video-projects/<p>/gen
6. look at clip 1; batch the rest in the same session
7. rent-gpu.sh vast stop <id>            ───▶  instance DESTROYED (stopped instances still bill for disk)
```

Files: `install/gpu/rent-gpu.sh` (rent, tunnel, destroy), `install/gpu/prepare-gpu-box.sh` (box setup), `install/gpu/comfy_job.py` (submit + download; refuses non-loopback servers), `install/download_models_family.py` (one model list for both tiers).

## What to rent

| Job | Card | Box RAM | Disk | Model download on the box |
|---|---|---|---|---|
| LTX 13B text/image→video | RTX 4060 Ti 16 GB (or 4090) | 32 GB | 60 GB | 15.7 GB + 4.9 GB T5 |
| Wan 2.1 14B t2v | RTX 4090 24 GB | 32 GB | 60 GB | 14.3 GB + 6.7 GB UMT5 + 0.25 GB VAE |
| Wan 2.1 14B i2v (animate listing photos) | RTX 4090 24 GB | 32 GB | 60 GB | 16.4 GB + 1.3 GB CLIP-vision + UMT5 + VAE |
| FreeVideo (MiniMax-H3, ~60 s with sound) | RTX 4060 Ti 16 GB+ | 32 GB | 80 GB | per its setup (official sources only) |
| Openjutsu (person/object swap) | RTX 4060 Ti 16 GB+ | **64 GB** (H3 int8 streams from RAM) | 100 GB | H3 + Qwen3-VL encoder; consent of anyone replaced |

Sizes for LTX and Wan were measured by `download_models_family.py --dry-run` against Hugging Face (all 9 files found, hashes published). These downloads land on the **rented disk, not your PC**: 0 GB of your 100 GB budget.

## Cost per job (estimate)

Cost = (setup + render + transfer minutes) ÷ 60 × hourly rate. First session on a fresh box adds ~10–15 min to download models; batching several shots in one session pays that once.

| Job | Rate (brief) | Time estimate | Cost estimate |
|---|---|---|---|
| 5 clips LTX 13B, 768p, 5 s each, on 4060 Ti 16 GB | $0.06–0.11/h | 15 min setup + ~5 × 3 min | ≈ $0.03–0.06 |
| 5 clips Wan 14B i2v 480p, 5 s each, on 4090 | $0.34/h | 15 min setup + ~5 × 6 min | ≈ $0.26 |
| One FreeVideo 5 s clip on 16 GB | $0.06–0.11/h | 15 min + 8–10 min | ≈ $0.03–0.05 |
| Openjutsu swap, 10 s clip (64 GB RAM box costs more) | check the offer | 20 min + ~10 min | under $0.50 at the brief's rates |

Times are estimates from published benchmarks for these card classes, not measured here; the first real job records actual minutes and cost in `video-projects/<project>/gen/gpu-log.md`.

## Rules

- Spend gate: state the card, the rate, the estimate and the shut-down step before renting; wait for yes.
- API keys for Vast.ai/RunPod are yours: set them in the CLI on your PC (`vastai set api-key`, `runpodctl config`), never in the repo or a chat log.
- ComfyUI binds to 127.0.0.1 on the box; access only through the SSH tunnel. Never `--listen 0.0.0.0` on a public host.
- Always destroy the instance at the end and confirm with `vastai show instances` / `runpodctl get pod`.
- Only official model sources, SHA-256 verified; no `.ckpt/.pt/.pkl` from unofficial repos; no `trust_remote_code`.

## If you buy an Nvidia card later

What changes: run ComfyUI on this PC without `--cpu` (a CUDA build of torch in its venv), and run `download_models_family.py --family ltx13b wan14b ...` locally (+~48 GB, still inside the 100 GB budget). What stays the same: the workflows, `comfy_job.py` (same `--server http://127.0.0.1:8188`), the model list and hashes, and every skill. Only the rent/tunnel/destroy steps disappear.
