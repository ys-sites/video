#!/usr/bin/env python3
"""Copy a user-selected local reference folder into this workspace without overwriting."""
import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'resources' / 'creator-styles' / 'sources'

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', help='local folder or file to copy; URLs require a separate supported download workflow')
    p.add_argument('--name', required=True, help='new source package name (letters, digits, hyphen and underscore)')
    args = p.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', args.name): p.error('invalid package name')
    source = Path(args.source)
    if not source.exists() or source.is_symlink(): p.error('source must exist and must not be a symlink')
    source = source.resolve()
    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / args.name
    if target.exists(): p.error('package already exists; choose a new name to avoid overwriting')
    if source == DEST.resolve() or DEST.resolve().is_relative_to(source): p.error('source would include the destination')
    target.mkdir()
    entries, skipped = [], []
    files = [source] if source.is_file() else sorted(source.rglob('*'))
    for f in files:
        if f.is_symlink(): skipped.append(str(f)); continue
        if not f.is_file(): continue
        rel = Path(f.name) if source.is_file() else f.relative_to(source)
        if any(part.lower() in {'.git', 'node_modules', '.venv', 'venv', '__pycache__'} for part in rel.parts): continue
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
        a, b = sha(f), sha(dst)
        if a != b: raise RuntimeError(f'Hash mismatch for {rel}; inspect the incomplete package before retrying')
        entries.append({'path': rel.as_posix(), 'bytes': dst.stat().st_size, 'sha256': b})
    manifest = {'source': str(source), 'created_utc': datetime.now(timezone.utc).isoformat(), 'files': entries, 'skipped_symlinks': skipped, 'status': 'copied_reference_not_edit_or_render'}
    (DEST / (args.name + '.manifest.json')).write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Copied and hash-verified {len(entries)} files into {target}; skipped {len(skipped)} symlinks.')

if __name__ == '__main__': main()
