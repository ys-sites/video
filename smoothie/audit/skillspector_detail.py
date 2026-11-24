#!/usr/bin/env python3
"""Rescan one skill folder in the same offline bwrap sandbox and print every issue in full (WSL).
python3 skillspector_detail.py <skill-dir> <out.json>"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path
src, out = Path(sys.argv[1]), Path(sys.argv[2])
dest = Path('/var/tmp/skillscan-detail') / src.name
shutil.rmtree(dest, ignore_errors=True)
shutil.copytree(src, dest, ignore=shutil.ignore_patterns('.git', 'node_modules', '__pycache__'))
cmd = ['/usr/bin/timeout', '300', '/usr/bin/prlimit', '--as=3221225472', '--cpu=240', '--nproc=32', '--fsize=8388608', '--',
       '/usr/bin/bwrap', '--die-with-parent', '--unshare-all', '--uid', '65534', '--gid', '65534', '--new-session', '--clearenv',
       '--setenv', 'HOME', '/scratch', '--setenv', 'TMPDIR', '/scratch', '--setenv', 'PATH', '/opt/skillspector-2.12/bin:/usr/bin',
       '--setenv', 'LANG', 'C.UTF-8', '--ro-bind', '/usr', '/usr', '--ro-bind', '/opt/skillspector-2.12', '/opt/skillspector-2.12',
       '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev',
       '--size', '134217728', '--tmpfs', '/scratch', '--chmod', '1777', '/scratch', '--chdir', '/scratch',
       '--ro-bind', str(dest), '/target', '--', '/opt/skillspector-2.12/bin/skillspector', 'scan', '/target',
       '--no-llm', '--format', 'json']
with tempfile.TemporaryFile() as o:
    p = subprocess.run(cmd, stdout=o, stderr=subprocess.DEVNULL, timeout=320, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
    o.seek(0); data = json.load(o)
shutil.rmtree(dest, ignore_errors=True)
out.write_text(json.dumps(data, indent=1))
for i in data.get('issues') or []:
    if str(i.get('severity', '')).lower() in ('high', 'critical'):
        print(json.dumps(i)[:700])
print('exit', p.returncode, (data.get('risk_assessment') or {}))
