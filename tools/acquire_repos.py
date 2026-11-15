#!/usr/bin/env python3
"""Stage a listed public GitHub repo for review. This never installs or runs it."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / 'resources' / 'repo-catalog'
STAGE = ROOT / 'resources' / 'repo-quarantine'
NAME = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--repo', help='exact owner/name from the supplied catalog')
    group.add_argument('--all', action='store_true', help='attempt all catalog entries within the size bound')
    p.add_argument('--max-git-kb', type=int, default=500000, help='skip repos over this GitHub-reported Git size; default 500000 KB')
    p.add_argument('--timeout-seconds', type=int, default=600)
    args = p.parse_args()
    if args.max_git_kb <= 0 or args.timeout_seconds <= 0: p.error('limits must be positive')
    catalog = json.loads((CAT / 'github-metadata.json').read_text(encoding='utf-8'))['repositories']
    selected = [r for r in catalog if args.all or r['requested'].casefold() == args.repo.casefold()]
    if not selected: p.error('repository is not in the supplied catalog')
    STAGE.mkdir(parents=True, exist_ok=True)
    env = {k: os.environ[k] for k in ('PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT') if k in os.environ}
    env.update({'GIT_TERMINAL_PROMPT': '0', 'GIT_LFS_SKIP_SMUDGE': '1', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull})
    failed = 0
    for item in selected:
        name, meta = item['requested'], item.get('metadata')
        if not NAME.fullmatch(name) or '..' in name: print(f'SKIP invalid repository name: {name}'); failed += 1; continue
        if not meta or meta.get('visibility') != 'public': print(f'SKIP missing public metadata: {name}'); failed += 1; continue
        if not isinstance(meta.get('git_size_kb'), int) or meta['git_size_kb'] > args.max_git_kb: print(f'SKIP size or missing size: {name}'); failed += 1; continue
        owner, repo = name.split('/'); target = STAGE / owner / repo
        if target.exists():
            provenance = target.parent / (repo + '.provenance.json')
            print(f'SKIP existing destination: {target}' + ('' if provenance.is_file() else ' (no provenance; may be incomplete)'))
            if not provenance.is_file(): failed += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        command = ['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=' + os.devnull, '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false', 'clone', '--no-recurse-submodules', '--', 'https://github.com/' + name + '.git', str(target)]
        try:
            run = subprocess.run(command, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=args.timeout_seconds)
            if run.returncode: print(f'FAILED {name}: {run.stderr[-500:].strip()}'); failed += 1; continue
            rev = subprocess.run(['git', '-C', str(target), 'rev-parse', 'HEAD'], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30, check=True).stdout.strip()
            record = {'repository': name, 'source_url': 'https://github.com/' + name, 'commit': rev, 'acquired_utc': datetime.now(timezone.utc).isoformat(), 'submodules': 'not initialized', 'lfs': 'not downloaded', 'security_audit': 'not_audited', 'execution': 'not_approved'}
            (target.parent / (repo + '.provenance.json')).write_text(json.dumps(record, indent=2), encoding='utf-8')
            print(f'STAGED {name} at {rev}; not audited')
        except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as ex: print(f'FAILED {name}: {type(ex).__name__}'); failed += 1
    if failed: sys.exit(1)

if __name__ == '__main__': main()
