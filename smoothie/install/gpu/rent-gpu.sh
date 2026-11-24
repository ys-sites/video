#!/usr/bin/env bash
# Nvidia GPU tier: rent, prepare, tunnel, run, fetch, destroy. Run from WSL Ubuntu.
# PAID: every step after "search" costs money per hour. Nothing here runs without --yes from the user.
# Usage: rent-gpu.sh vast|runpod search
#        rent-gpu.sh vast|runpod start <offer-or-gpu-type> --yes
#        rent-gpu.sh vast|runpod stop <instance-id>
set -euo pipefail
PROVIDER=${1:?vast|runpod}; ACTION=${2:?search|start|stop}
IMAGE="pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime"   # official PyTorch image; pin by digest at install time
DISK_GB=60                                               # ComfyUI + one model family; raise only for 14B models

case "$PROVIDER:$ACTION" in
  vast:search)
    # Cheapest reliable 16 GB+ cards first (RTX 4060 Ti 16GB / 4090). Needs `pip install vastai` and `vastai set api-key` (user's key, never saved in the repo).
    vastai search offers 'num_gpus=1 gpu_ram>=16 reliability>0.98 inet_down>200 cuda_vers>=12.4' -o 'dph' | head -20 ;;
  vast:start)
    [[ "${4:-}" == "--yes" ]] || { echo "Add --yes to confirm a PAID rental."; exit 2; }
    vastai create instance "$3" --image "$IMAGE" --disk "$DISK_GB" --ssh --direct
    echo "Next: vastai ssh-url <instance-id>, then: bash rent-gpu.sh vast tunnel <ssh-target>" ;;
  vast:stop)
    vastai destroy instance "$3"; vastai show instances ;;          # destroy, not stop: stopped instances still bill for disk
  runpod:search)
    # Needs runpodctl and `runpodctl config --apiKey` (user's key).
    runpodctl get cloud | grep -Ei '4090|4060|A4000|A5000|3090' ;;
  runpod:start)
    [[ "${4:-}" == "--yes" ]] || { echo "Add --yes to confirm a PAID rental."; exit 2; }
    runpodctl create pod --name smoothie-gpu --gpuType "$3" --imageName "$IMAGE" --containerDiskSize "$DISK_GB" --communityCloud --ports '22/tcp'
    echo "Next: runpodctl get pod, then ssh in and run prepare-gpu-box.sh" ;;
  runpod:stop)
    runpodctl remove pod "$3"; runpodctl get pod ;;
  *:tunnel)
    # Forward the remote ComfyUI (bound to 127.0.0.1 on the box) to this PC. Never expose 8188 publicly.
    ssh -N -L 8188:127.0.0.1:8188 "$3" ;;
  *) echo "unknown: $PROVIDER $ACTION"; exit 2 ;;
esac
