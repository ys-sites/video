#!/usr/bin/env python3
"""Read-only triage of staged repositories against MASTER-ROUTER section 4 step 2.

Checks: install hooks, download-and-execute, pickle/unsafe weights, trust_remote_code, extra package
indexes, shipped binaries (from the full tree list, including files left out of a sparse checkout),
secrets, hidden Unicode, prompt-injection text, telemetry/upload endpoints, license presence.

Signals are leads for a human reader, not vulnerabilities and not clearance. Never executes target code.
Usage: python -I tools/security/triage_staged.py <out.json> <repo-dir> [<repo-dir> ...]
"""
import json, os, re, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

TEXT_EXT = {'.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.json', '.toml',
            '.yml', '.yaml', '.md', '.txt', '.cfg', '.ini', '.lua', '.rs', '.go', '.html', '.dockerfile', ''}
SKIP_DIRS = {'.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next', 'target'}
BINARY_EXT = {'.exe', '.dll', '.so', '.dylib', '.msi', '.dmg', '.pkg', '.deb', '.appimage', '.jar', '.node', '.wasm', '.bin',
              '.pkl', '.pickle', '.pt', '.pth', '.ckpt', '.npy', '.npz', '.joblib'}
SIGNALS = {
    'install_hook': re.compile(r'"(?:pre|post)?install"\s*:|"prepare"\s*:|setup\.py.*cmdclass|cmdclass\s*=', re.I),
    'download_execute': re.compile(r'(curl|wget)\s[^\n|]{0,200}\|\s*(sudo\s+)?(ba|z)?sh\b|iwr\s[^\n]{0,200}\|\s*iex|Invoke-Expression|irm\s[^\n]{0,200}\|\s*iex|bash\s+<\(\s*curl', re.I),
    'unsafe_weights': re.compile(r'torch\.load\((?![^)]*weights_only\s*=\s*True)|pickle\.loads?\(|joblib\.load\(|\.ckpt\b', re.I),
    'trust_remote_code': re.compile(r'trust_remote_code\s*=\s*True', re.I),
    'extra_index': re.compile(r'--(extra-)?index-url\s+(?!https://(download\.pytorch\.org|pypi\.org))\S+|registry\s*=\s*(?!https://registry\.npmjs\.org)https?://', re.I),
    'secret_literal': re.compile(r'(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[bap]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY)'),
    'prompt_injection': re.compile(r'ignore (all |any )?(previous|prior|above) instructions|disregard (the )?(system|previous)|you are now (in )?developer mode|do not (tell|inform) the user|without (asking|telling) the user|exfiltrat', re.I),
    'permission_bypass': re.compile(r'dangerously-?skip-?permissions|bypassPermissions|--no-verify|chmod\s+777|sudo\s+rm\s+-rf', re.I),
    'dynamic_code': re.compile(r'\beval\s*\(|new\s+Function\s*\(|\bexec\s*\(\s*(base64|codecs|compile|requests|urllib)', re.I),
    'obfuscation': re.compile(r'base64\.b64decode\([^)]{80,}|atob\(["\'][A-Za-z0-9+/=]{120,}|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){40,}', re.I),
    'telemetry_upload': re.compile(r'posthog|mixpanel|segment\.io|amplitude|sentry_sdk|telemetry|upload_file|transfer\.sh|catbox\.moe|0x0\.st|file\.io|webhook\.site|ngrok', re.I),
}
HIDDEN = re.compile('[​-‏‪-‮⁠-⁤﻿\U000e0000-\U000e007f]')
URL = re.compile(r'https?://([A-Za-z0-9.-]+\.[a-z]{2,})')
PAID = re.compile(r'\b(fal\.ai|FAL_KEY|replicate|REPLICATE_API|elevenlabs|ELEVENLABS|openai\.com|OPENAI_API_KEY|anthropic|ANTHROPIC_API_KEY|higgsfield|muapi|seedance|kling|runway|heygen|atlas ?cloud|gemini|GOOGLE_API_KEY|OPENROUTER|deepgram|assemblyai|suno|stability)', re.I)
GPU = re.compile(r'\b(cuda|nvidia|rtx ?\d{4}|vram|torch\.cuda|cu1[12]\d|flash[-_]attn|xformers|tensorrt)\b', re.I)

def scan(repo: Path):
    counts, examples, hosts, paid, gpu = Counter(), {}, Counter(), Counter(), 0
    hidden, files, skipped = [], 0, 0
    def walk():
        for parent, dirs, names in os.walk(repo, followlinks=False):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for n in names:
                yield Path(parent) / n
    for f in walk():
        if f.is_symlink() or not f.is_file():
            continue
        if f.suffix.lower() not in TEXT_EXT and f.name.lower() not in {'dockerfile', 'makefile'}:
            continue
        try:
            if f.stat().st_size > 1_000_000: skipped += 1; continue
            text = f.read_text(encoding='utf-8', errors='replace')
        except OSError:
            skipped += 1; continue
        files += 1
        rel = f.relative_to(repo).as_posix()
        if HIDDEN.search(text): hidden.append(rel)
        for i, line in enumerate(text.splitlines(), 1):
            if len(line) > 4000: line = line[:4000]
            for k, rx in SIGNALS.items():
                if rx.search(line):
                    counts[k] += 1
                    examples.setdefault(k, [])
                    if len(examples[k]) < 6: examples[k].append(f'{rel}:{i}: {line.strip()[:160]}')
            for h in URL.findall(line): hosts[h.lower()] += 1
            for p in PAID.findall(line): paid[p.lower()] += 1
            if GPU.search(line): gpu += 1
    tree_file = repo / '.git' / 'full-tree.txt'
    tree = tree_file.read_text(encoding='utf-8').splitlines() if tree_file.exists() else \
        [p.relative_to(repo).as_posix() for p in walk()]
    binaries = [p for p in tree if Path(p).suffix.lower() in BINARY_EXT]
    skills = [p for p in tree if p.endswith('SKILL.md')]
    lic = [p for p in tree if re.fullmatch(r'(LICEN[CS]E|COPYING)(\.\w+)?', Path(p).name, re.I) and '/' not in p]
    pkg = {'package.json': 'package.json' in tree, 'requirements': any(p.endswith(('requirements.txt', 'pyproject.toml', 'setup.py')) for p in tree if '/' not in p),
           'cargo': 'Cargo.toml' in tree, 'dockerfile': any(Path(p).name.lower() == 'dockerfile' for p in tree)}
    return {'files_scanned': files, 'files_skipped_large': skipped, 'tree_files': len(tree), 'signals': dict(counts), 'examples': examples,
            'hidden_unicode_files': hidden[:20], 'shipped_binaries_or_weights': binaries[:40], 'binary_count': len(binaries),
            'skill_md_files': len(skills), 'skill_md_sample': skills[:15], 'license_files': lic, 'manifests': pkg,
            'paid_service_mentions': dict(paid.most_common(10)), 'gpu_mentions': gpu, 'top_hosts': dict(hosts.most_common(15))}

def _one(d):
    p = Path(d)
    return (p.parent.name + '/' + p.name, scan(p)) if p.is_dir() else (None, None)

def main():
    from concurrent.futures import ProcessPoolExecutor, as_completed
    out = Path(sys.argv[1]); res = {}
    with ProcessPoolExecutor(max_workers=max(2, (os.cpu_count() or 4) - 2)) as pool:
        for fut in as_completed([pool.submit(_one, d) for d in sys.argv[2:]]):
            name, r = fut.result()
            if name:
                res[name] = r; print('done', name, flush=True)
    out.write_text(json.dumps({'created_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                               'warning': 'Text signals are leads for review, not findings or clearance.', 'results': res}, indent=1), encoding='utf-8')
    print(f'triaged {len(res)} repositories -> {out}')

if __name__ == '__main__':
    main()
