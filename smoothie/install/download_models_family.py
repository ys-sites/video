"""Family-aware version of AI-Local/download-models.py: official .safetensors only, each verified against the
SHA-256 Hugging Face publishes, resumable, one shared model store for every skill and both tiers.

  python download_models_family.py --family ltx2b wan1.3b --dest C:\\Users\\Sharafath\\AI-Local\\ComfyUI\\models
  python download_models_family.py --family wan14b --dest ~/ComfyUI/models          (on a rented GPU box)
  python download_models_family.py --family all --dry-run                            (sizes + hashes, no download)

Files already present with the published size are reused, never downloaded twice. Stdlib only.
"""
import argparse, hashlib, json, os, sys, urllib.request

# (repo, path in repo, ComfyUI subfolder). Shared encoders/VAEs are listed once and reused across families.
T5 = ('comfyanonymous/flux_text_encoders', 't5xxl_fp8_e4m3fn.safetensors', 'text_encoders')
UMT5 = ('Comfy-Org/Wan-2.1', 'split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'text_encoders')
WANVAE = ('Comfy-Org/Wan-2.1', 'split_files/vae/wan_2.1_vae.safetensors', 'vae')
FAMILIES = {
    'ltx2b':   [('Lightricks/LTX-Video', 'ltxv-2b-0.9.8-distilled-fp8.safetensors', 'checkpoints'), T5],      # local CPU tier
    'wan1.3b': [('Comfy-Org/Wan-2.1', 'split_files/diffusion_models/wan2.1_t2v_1.3B_bf16.safetensors', 'diffusion_models'), UMT5, WANVAE],
    'ltx13b':  [('Lightricks/LTX-Video', 'ltxv-13b-0.9.8-distilled-fp8.safetensors', 'checkpoints'), T5],     # GPU tier
    'wan14b':  [('Comfy-Org/Wan-2.1', 'split_files/diffusion_models/wan2.1_t2v_14B_fp8_e4m3fn.safetensors', 'diffusion_models'), UMT5, WANVAE],
    'wan14b-i2v': [('Comfy-Org/Wan-2.1', 'split_files/diffusion_models/wan2.1_i2v_480p_14B_fp8_e4m3fn.safetensors', 'diffusion_models'),
                   ('Comfy-Org/Wan-2.1', 'split_files/clip_vision/clip_vision_h.safetensors', 'clip_vision'), UMT5, WANVAE],
}
UA = {'User-Agent': 'model-download-client'}

def expected(repo, path):
    folder = os.path.dirname(path)
    url = f'https://huggingface.co/api/models/{repo}/tree/main/{folder}'.rstrip('/')
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        for f in json.load(r):
            if f['path'] == path and f.get('lfs'):
                return f['lfs']['oid'], f['lfs']['size']
    return None, None

def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(8 << 20), b''):
            h.update(b)
    return h.hexdigest()

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--family', nargs='+', required=True, choices=[*FAMILIES, 'all'])
    ap.add_argument('--dest', default=r'C:\Users\Sharafath\AI-Local\ComfyUI\models')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    fams = list(FAMILIES) if 'all' in a.family else a.family
    files = list(dict.fromkeys(f for fam in fams for f in FAMILIES[fam]))   # dedupe shared encoders/VAEs
    total = new = 0; missing = []
    for repo, path, sub in files:
        oid, size = expected(repo, path)
        if not oid:
            missing.append(f'{repo}/{path}'); print('NOT FOUND on Hugging Face:', repo, path); continue
        dest = os.path.join(os.path.expanduser(a.dest), sub, os.path.basename(path))
        have = os.path.exists(dest) and os.path.getsize(dest) == size
        total += size; new += 0 if have else size
        print(f'{"have " if have else "need "} {size/1e9:6.2f} GB  {sub}/{os.path.basename(path)}  sha256 {oid[:12]}')
        if a.dry_run or have:
            continue
        part = dest + '.part'; os.makedirs(os.path.dirname(dest), exist_ok=True)
        got_bytes = os.path.getsize(part) if os.path.exists(part) else 0
        req = urllib.request.Request(f'https://huggingface.co/{repo}/resolve/main/{path}', headers={**UA, 'Range': f'bytes={got_bytes}-'})
        with urllib.request.urlopen(req, timeout=120) as r, open(part, 'ab') as out:
            for b in iter(lambda: r.read(8 << 20), b''):
                out.write(b)
        if sha256(part) != oid:
            os.remove(part); sys.exit(f'HASH MISMATCH for {path}: deleted')
        os.replace(part, dest); print('   verified ->', dest)
    print(f'families {fams}: {total/1e9:.2f} GB total, {new/1e9:.2f} GB new download' + (' (dry run)' if a.dry_run else ''))
    if missing:
        sys.exit(f'{len(missing)} file(s) not found; fix the list before installing')

if __name__ == '__main__':
    main()
