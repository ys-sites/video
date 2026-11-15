#!/usr/bin/env python3
"""Run bounded offline SkillSpector triage on local skill directories in WSL.

This is not a Cloudflare full audit or a trust verdict. Never execute target code.
"""
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'resources' / 'motion-systems'
OUT = ROOT / 'resources' / 'repo-catalog' / 'motion-skillspector-summary.json'
SKIP = {'.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__', 'tests', 'fixtures'}

def paths():
    for repo in sorted(SOURCE.iterdir()):
        if not repo.is_dir() or repo.is_symlink():
            continue
        for parent, dirs, files in os.walk(repo, followlinks=False):
            base = Path(parent)
            dirs[:] = [d for d in dirs if d not in SKIP and not (base / d).is_symlink()]
            if 'SKILL.md' in files and not (base / 'SKILL.md').is_symlink():
                yield repo, base

def scan(repo, skill):
    cmd = ['/usr/bin/timeout', '90', '/usr/bin/prlimit', '--as=2147483648', '--cpu=60', '--nproc=32', '--fsize=8388608', '--',
           '/usr/bin/bwrap', '--die-with-parent', '--unshare-all', '--uid', '65534', '--gid', '65534', '--new-session', '--clearenv',
           '--setenv', 'HOME', '/scratch', '--setenv', 'TMPDIR', '/scratch', '--setenv', 'PATH', '/opt/skillspector-2.12/bin:/usr/bin',
           '--setenv', 'LANG', 'C.UTF-8', '--ro-bind', '/usr', '/usr', '--ro-bind', '/opt/skillspector-2.12', '/opt/skillspector-2.12',
           '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
           '--size', '134217728', '--tmpfs', '/scratch', '--chmod', '1777', '/scratch', '--chdir', '/scratch',
           '--ro-bind', str(skill), '/target', '--', '/opt/skillspector-2.12/bin/skillspector', 'scan', '/target', '--no-llm', '--format', 'json', '--fail-on-incomplete']
    result = {'repository': repo.name, 'skill_path': skill.relative_to(ROOT).as_posix(), 'status': 'incomplete', 'audit_status': 'not_audited'}
    try:
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, timeout=100, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
            result['exit_code'] = p.returncode
            size = stdout.tell()
            if size > 8_388_608:
                result['error'] = 'report exceeds byte limit'
                return result
            stdout.seek(0)
            data = json.load(stdout)
            risk = data.get('risk_assessment') or {}
            issues = data.get('issues') or []
            result.update({'status': 'scanner_completed' if p.returncode in (0, 1) else 'scanner_incomplete',
                           'score': risk.get('score'), 'recommendation': risk.get('recommendation'),
                           'issue_count': len(issues), 'issues': [{'rule': str(x.get('rule_id') or x.get('id') or '')[:120], 'severity': str(x.get('severity') or '')[:40], 'path': str(x.get('file') or x.get('file_path') or '')[:500]} for x in issues[:100]],
                           'note': 'Static offline scanner only; no semantic review, dependency contents, or full audit.'})
    except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
        result['error'] = type(exc).__name__
    return result

def main():
    results = []
    for repo, skill in paths():
        result = scan(repo, skill)
        results.append(result)
        OUT.write_text(json.dumps({'created_utc': datetime.now(timezone.utc).isoformat(), 'status': 'partial', 'results': results}, indent=2), encoding='utf-8')
        print(repo.name, result['status'], result.get('issue_count', '-'), flush=True)
    print('Total skill folders:', len(results), flush=True)

if __name__ == '__main__':
    main()
