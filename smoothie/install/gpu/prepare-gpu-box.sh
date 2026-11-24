#!/usr/bin/env bash
# Runs ON the rented Nvidia box (Linux, CUDA image). Installs ComfyUI at the reviewed commit and only
# the model family the job needs, from official Hugging Face repos, verified by SHA-256. Binds to 127.0.0.1.
# Usage: bash prepare-gpu-box.sh ltx2b|ltx13b|wan1.3b|wan14b|wan14b-i2v|freevideo
set -euo pipefail
FAMILY=${1:?ltx2b|ltx13b|wan1.3b|wan14b|wan14b-i2v|freevideo}
COMFY_COMMIT=${COMFY_COMMIT:?set to the reviewed ComfyUI commit recorded in resources/repo-catalog (same as the local CPU copy)}
cd /workspace 2>/dev/null || cd ~
if [ ! -d ComfyUI ]; then
  git -c core.hooksPath=/dev/null clone --filter=blob:none https://github.com/Comfy-Org/ComfyUI.git
  git -C ComfyUI checkout "$COMFY_COMMIT"      # reviewed commit: d5d59c4011312df6b3a4241fb48c045289ad9441
fi
python -m pip install --no-cache-dir -r ComfyUI/requirements.txt     # torch with CUDA is already in the image
# Models: same files and hashes as the local tier. Copy download_models_family.py to the box first (scp);
# it refuses any file whose SHA-256 does not match Hugging Face's published value.
case "$FAMILY" in wan1.3b|ltx2b|ltx13b|wan14b|wan14b-i2v) python download_models_family.py --family "$FAMILY" --dest ComfyUI/models ;;
  freevideo) echo "FreeVideo: follow its setup.sh with official sources only (see MASTER-ROUTER section 3)"; exit 0 ;; esac
cd ComfyUI && nohup python main.py --listen 127.0.0.1 --port 8188 > comfy.log 2>&1 &
echo "ComfyUI on 127.0.0.1:8188 (box-local). From your PC: rent-gpu.sh <provider> tunnel <ssh-target>"
