#!/usr/bin/env python3
"""Run bounded offline SkillSpector triage on local skill directories in WSL.

This is not a Cloudflare full audit or a trust verdict. Never execute target code.
"""
import json
import os
import subprocess
import tempfile
import argparse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'resources' / 'motion-systems'
OUT = ROOT / 'resources' / 'repo-catalog' / 'motion-skillspector-summary.json'
SKIP = {'.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__', 'tests', 'fixtures'}
SCRATCH = ROOT / 'resources' / 'repo-catalog' / 'security-audits' / 'scanner' / 'scratch'

def paths():
    for repo in sorted(SOURCE.iterdir()):
        if not repo.is_dir() or repo.is_symlink():
            continue
        for parent, dirs, files in os.walk(repo, followlinks=False):
            base = Path(parent)
            dirs[:] = [d for d in dirs if d not in SKIP and not (base / d).is_symlink()]
            if 'SKILL.md' in files and not (base / 'SKILL.md').is_symlink():
                yield repo, base

EXPORT = Path('/var/tmp/skillscan-export')

def export_tree(repo, skill):
    """Export tracked files at HEAD (no .git, no untracked files) to native WSL storage."""
    rel = skill.relative_to(repo).as_posix()
    dest = EXPORT / (repo.name + '__' + (rel.replace('/', '__') or 'root'))
    subprocess.run(['rm', '-rf', '--', str(dest)], check=True, timeout=120)
    dest.mkdir(parents=True)
    spec = 'HEAD' if rel in ('', '.') else 'HEAD:' + rel
    git = subprocess.Popen(['git', '-c', 'core.symlinks=false', '-C', str(repo), 'archive', '--format=tar', spec], stdout=subprocess.PIPE)
    tar = subprocess.run(['tar', '-x', '--no-same-owner', '--no-same-permissions', '-C', str(dest)], stdin=git.stdout, timeout=600)
    git.stdout.close()
    if git.wait(timeout=600) != 0 or tar.returncode != 0:
        raise OSError('git archive export failed')
    tree_spec = 'HEAD^{tree}' if spec == 'HEAD' else spec
    tree = subprocess.run(['git', '-C', str(repo), 'rev-parse', tree_spec], capture_output=True, text=True, timeout=15).stdout.strip()
    try:  # slow over /mnt/c; the scan input is HEAD regardless, so this is informational only
        dirty = bool(subprocess.run(['git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=no', '--', rel or '.'],
                                    capture_output=True, text=True, timeout=300).stdout.strip())
    except subprocess.TimeoutExpired:
        dirty = None
    return dest, tree, dirty

def scan(repo, skill, clean_export=False, seconds=180, cpu=120, mem=3221225472):
    target = skill
    extra = {}
    if clean_export:
        target, tree, dirty = export_tree(repo, skill)
        extra = {'scan_input': 'git archive of tracked files at HEAD (excludes .git and untracked files)',
                 'tree_object': tree, 'worktree_differs_from_head': dirty}
    cmd = ['/usr/bin/timeout', str(seconds), '/usr/bin/prlimit', '--as=' + str(mem), '--cpu=' + str(cpu), '--nproc=32', '--fsize=8388608', '--',
           '/usr/bin/bwrap', '--die-with-parent', '--unshare-all', '--uid', '65534', '--gid', '65534', '--new-session', '--clearenv',
           '--setenv', 'HOME', '/scratch', '--setenv', 'TMPDIR', '/scratch', '--setenv', 'PATH', '/opt/skillspector-2.12/bin:/usr/bin',
           '--setenv', 'LANG', 'C.UTF-8', '--ro-bind', '/usr', '/usr', '--ro-bind', '/opt/skillspector-2.12', '/opt/skillspector-2.12',
           '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
           '--size', '134217728', '--tmpfs', '/scratch', '--chmod', '1777', '/scratch', '--chdir', '/scratch',
           '--ro-bind', str(target), '/target', '--', '/opt/skillspector-2.12/bin/skillspector', 'scan', '/target', '--no-llm', '--format', 'json', '--fail-on-incomplete']
    revision = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=15).stdout.strip()
    result = {'repository': repo.name, 'skill_path': skill.relative_to(ROOT).as_posix(), 'source_revision': revision, 'status': 'incomplete', 'audit_status': 'not_audited',
              'limits': {'wall_s': seconds, 'cpu_s': cpu, 'address_space_bytes': mem}, **extra}
    try:
        SCRATCH.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=SCRATCH) as stdout, tempfile.TemporaryFile(dir=SCRATCH) as stderr:
            p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, timeout=190, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
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
                           'issue_count': len(issues), 'issues': [{'rule': str(x.get('rule_id') or x.get('id') or '')[:120], 'severity': str(x.get('severity') or '')[:40], 'path': str((x.get('location') or {}).get('file') or x.get('file') or x.get('file_path') or '')[:500], 'line': (x.get('location') or {}).get('start_line')} for x in issues[:100]],
                           'note': 'Static offline scanner only; no semantic review, dependency contents, or full audit.'})
    except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
        result['error'] = type(exc).__name__
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--retry-incomplete', action='store_true')
    parser.add_argument('--only', help='scan one named motion-systems repository')
    parser.add_argument('--clean-export', action='store_true', help='scan a git-archive export of HEAD instead of the live checkout')
    parser.add_argument('--all', action='store_true', help='with --clean-export, rescan every skill folder')
    parser.add_argument('--seconds', type=int, default=180)
    parser.add_argument('--cpu', type=int, default=120)
    parser.add_argument('--mem', type=int, default=3221225472)
    parser.add_argument('--skip', action='append', default=[], help='skill_path to leave out of this run')
    args = parser.parse_args()
    selected = None
    output = OUT
    if args.retry_incomplete:
        previous = json.loads(OUT.read_text(encoding='utf-8'))
        selected = {r['skill_path'] for r in previous['results'] if r['status'] != 'scanner_completed'}
        output = OUT.with_name('motion-skillspector-retry.json')
    if args.clean_export:
        output = OUT.with_name('motion-skillspector-clean.json')
    if args.only:
        if not args.only.replace('-', '').replace('_', '').isalnum():
            parser.error('invalid repository name')
        output = OUT.with_name('motion-skillspector-' + args.only + '.json')
    results = []
    for repo, skill in paths():
        if args.only and repo.name != args.only:
            continue
        if selected is not None and skill.relative_to(ROOT).as_posix() not in selected:
            continue
        if skill.relative_to(ROOT).as_posix() in args.skip:
            continue
        result = scan(repo, skill, args.clean_export, args.seconds, args.cpu, args.mem)
        results.append(result)
        output.write_text(json.dumps({'created_utc': datetime.now(timezone.utc).isoformat(), 'status': 'partial', 'results': results}, indent=2), encoding='utf-8')
        print(repo.name, result['status'], result.get('issue_count', '-'), flush=True)
    print('Total skill folders:', len(results), flush=True)

if __name__ == '__main__':
    main()
