#!/usr/bin/env python3
"""Bounded, read-only signal inventory for already copied repository snapshots.

Signals are not vulnerabilities, security findings, or audit clearance.
"""
import json
import os
from pathlib import Path
import re
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / 'resources' / 'repo-catalog'
PATTERNS = {
    'process_execution': re.compile(r'\b(subprocess\.(?:run|Popen|call)|child_process|execFile|os\.system|shell\s*=\s*True)\b', re.I),
    'network_or_upload': re.compile(r'\b(fetch\s*\(|requests\.(?:get|post|put)|https?\.request|axios\.|httpx\.)', re.I),
    'credential_or_secret_access': re.compile(r'\b(api[_-]?key|secret[_-]?key|access[_-]?token|credentials|\.env)\b', re.I),
    'install_or_lifecycle': re.compile(r'\b(postinstall|preinstall|pip install|npm install|curl\s+[^\n]{0,100}\|\s*(?:sh|bash))\b', re.I),
    'dynamic_code': re.compile(r'\b(eval\s*\(|exec\s*\(|new\s+Function\s*\()', re.I),
}
EXT = {'.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.ps1', '.json', '.toml', '.yml', '.yaml', '.md'}
SKIP = {'.git', 'node_modules', 'venv', '.venv', 'dist', 'build', '__pycache__', 'tests', 'test', 'fixtures'}

def inspect(path):
    counts = {k: 0 for k in PATTERNS}; examples = {k: [] for k in PATTERNS}; files = skipped = 0
    for folder, dirs, names in os.walk(path, followlinks=False):
        base = Path(folder); dirs[:] = [d for d in dirs if d not in SKIP and not (base / d).is_symlink()]
        for name in names:
            f = base / name
            if f.suffix.lower() not in EXT or f.is_symlink(): continue
            try:
                if f.stat().st_size > 512_000: skipped += 1; continue
                text = f.read_text(encoding='utf-8', errors='replace'); files += 1
            except OSError: skipped += 1; continue
            for i, line in enumerate(text.splitlines(), 1):
                for category, pattern in PATTERNS.items():
                    if pattern.search(line):
                        counts[category] += 1
                        if len(examples[category]) < 5: examples[category].append(f'{f.relative_to(path).as_posix()}:{i}')
    return {'files_scanned': files, 'files_skipped': skipped, 'signals': counts, 'examples': examples, 'scope': 'bounded filename/text signal scan; tests, dependencies, build outputs and large files excluded', 'audit_status': 'not_audited'}

def main():
    records = json.loads((CAT / 'repositories.json').read_text(encoding='utf-8'))['repositories']; results=[]
    for item in records:
        ref=item.get('local_reference'); path=ROOT / ref['path'] if ref else None
        if path and path.is_dir(): results.append({'repository': item['repository'], 'local_path': ref['path'], **inspect(path)})
        else: results.append({'repository': item['repository'], 'status': 'source_not_available_in_copied_library', 'audit_status': 'not_audited'})
    out={'created_utc':datetime.now(timezone.utc).isoformat(), 'warning':'Text matches are leads for review only; they are not confirmed vulnerabilities or proof of safety.', 'results':results}
    (CAT / 'triage-signals.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    print('Signal inventory:',sum('files_scanned' in r for r in results),'local snapshots;',len(results),'catalog repositories. No security audits completed.')

if __name__ == '__main__': main()
