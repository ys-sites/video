#!/usr/bin/env python3
"""Offline, sandboxed SkillSpector scan of SKILL.md folders inside staged repositories. Run inside WSL.

Same isolation as tools/scan_motion_skills.py: bubblewrap with every namespace unshared (no network),
uid 65534, cleared environment, read-only target, prlimit CPU/memory/file-size caps, wall-clock timeout,
SkillSpector --no-llm. The skill folder is copied (without .git) to native WSL storage first.
Scanner output is a lead, not a verdict. Never executes target code.

Usage (WSL): python3 scan_staged_skills.py <out.json> <repo-dir> [<repo-dir> ...]
"""
import json, os, shutil, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path

SKIP = {'.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__'}
EXPORT = Path('/var/tmp/skillscan-staged')
MAX_SKILLS_PER_REPO = 12

def skill_dirs(repo: Path):
    found = []
    for parent, dirs, files in os.walk(repo, followlinks=False):
        base = Path(parent)
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not (base / d).is_symlink())
        if 'SKILL.md' in files and not (base / 'SKILL.md').is_symlink():
            found.append(base)
    return found

def scan(target: Path, seconds=180, cpu=120, mem=3221225472):
    cmd = ['/usr/bin/timeout', str(seconds), '/usr/bin/prlimit', f'--as={mem}', f'--cpu={cpu}', '--nproc=32', '--fsize=8388608', '--',
           '/usr/bin/bwrap', '--die-with-parent', '--unshare-all', '--uid', '65534', '--gid', '65534', '--new-session', '--clearenv',
           '--setenv', 'HOME', '/scratch', '--setenv', 'TMPDIR', '/scratch', '--setenv', 'PATH', '/opt/skillspector-2.12/bin:/usr/bin',
           '--setenv', 'LANG', 'C.UTF-8', '--ro-bind', '/usr', '/usr', '--ro-bind', '/opt/skillspector-2.12', '/opt/skillspector-2.12',
           '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
           '--size', '134217728', '--tmpfs', '/scratch', '--chmod', '1777', '/scratch', '--chdir', '/scratch',
           '--ro-bind', str(target), '/target', '--', '/opt/skillspector-2.12/bin/skillspector', 'scan', '/target',
           '--no-llm', '--format', 'json', '--fail-on-incomplete']
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=err, timeout=seconds + 15,
                           env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        if out.tell() > 8_388_608:
            return {'status': 'scanner_incomplete', 'error': 'report exceeds byte limit'}
        out.seek(0)
        try:
            data = json.load(out)
        except ValueError:
            err.seek(0)
            return {'status': 'scanner_incomplete', 'exit_code': p.returncode, 'error': err.read()[-300:].decode('utf-8', 'replace')}
    risk = data.get('risk_assessment') or {}
    issues = data.get('issues') or []
    return {'status': 'scanner_completed' if p.returncode in (0, 1) else 'scanner_incomplete', 'exit_code': p.returncode,
            'score': risk.get('score'), 'recommendation': risk.get('recommendation'), 'issue_count': len(issues),
            'issues': [{'rule': str(x.get('rule_id') or x.get('id') or '')[:80], 'severity': str(x.get('severity') or '')[:20],
                        'file': str((x.get('location') or {}).get('file') or '')[:160], 'message': str(x.get('message') or x.get('title') or '')[:200]}
                       for x in issues[:25]]}

def main():
    out = Path(sys.argv[1]); results = []
    EXPORT.mkdir(parents=True, exist_ok=True)
    for r in sys.argv[2:]:
        repo = Path(r)
        dirs = skill_dirs(repo)
        if not dirs:
            results.append({'repository': repo.parent.name + '/' + repo.name, 'status': 'no_skill_md'}); continue
        for sd in dirs[:MAX_SKILLS_PER_REPO]:
            dest = EXPORT / (repo.parent.name + '__' + repo.name + '__' + (sd.relative_to(repo).as_posix().replace('/', '__') or 'root'))
            shutil.rmtree(dest, ignore_errors=True)
            shutil.copytree(sd, dest, symlinks=True, ignore=shutil.ignore_patterns(*SKIP))
            rec = {'repository': repo.parent.name + '/' + repo.name, 'skill_path': sd.relative_to(repo).as_posix() or '.'}
            try:
                rec.update(scan(dest))
            except (OSError, subprocess.TimeoutExpired) as e:
                rec.update({'status': 'scanner_incomplete', 'error': type(e).__name__})
            shutil.rmtree(dest, ignore_errors=True)
            results.append(rec); print(rec['repository'], rec['skill_path'], rec.get('status'), rec.get('recommendation'), rec.get('issue_count'), flush=True)
        if len(dirs) > MAX_SKILLS_PER_REPO:
            results.append({'repository': repo.parent.name + '/' + repo.name, 'status': 'partial', 'note': f'{len(dirs)} SKILL.md folders; first {MAX_SKILLS_PER_REPO} scanned'})
        out.write_text(json.dumps({'created_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                                   'isolation': 'bwrap --unshare-all (no network), prlimit, --no-llm', 'results': results}, indent=1))
    print('done', len(results))

if __name__ == '__main__':
    main()
