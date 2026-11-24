#!/usr/bin/env python3
"""Inventory supplied public repository references and route to local skill references.

This tool never executes a repository or promotes it to trusted status.
"""
from __future__ import annotations
import argparse
import json
import itertools
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'resources' / 'repo-catalog'
LIBRARY = ROOT / 'resources' / 'concordia'
EXTERNAL_INVENTORY = CATALOG / 'jack-agency-repositories-20261120.json'
EXTERNAL_ROUTES = CATALOG / 'jack-agency-routing.json'
STOP = {'the', 'and', 'for', 'from', 'with', 'this', 'that', 'your', 'using', 'video', 'skill', 'skills', 'create', 'make'}

def words(value: str) -> set[str]:
    tokens = re.findall(r'[a-z0-9][a-z0-9+.-]{2,}', value.lower())
    parts = [part for token in tokens for part in re.split(r'[-_.]+', token)]
    return {w for w in tokens + parts if len(w) >= 3 and w not in STOP}

def skill_index() -> list[dict]:
    result = []
    for folder, dirs, files in itertools.chain(os.walk(LIBRARY, followlinks=False), os.walk(ROOT / 'resources' / 'motion-systems', followlinks=False), os.walk(ROOT / '.claude' / 'skills', followlinks=False)):
        base = Path(folder)
        dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__'} and not (base / d).is_symlink()]
        if 'SKILL.md' not in files: continue
        path = base / 'SKILL.md'
        if path.is_symlink() or path.stat().st_size > 150_000: continue
        try: text = path.read_text(encoding='utf-8', errors='replace')
        except OSError: continue
        fm = text.split('---', 2)[1] if text.startswith('---') and text.count('---') >= 2 else ''
        name = re.search(r'^name:\s*["\']?([^\r\n"\']+)', fm, re.M)
        desc = re.search(r'^description:\s*["\']?([^\r\n"\']+)', fm, re.M)
        result.append({'name': name.group(1).strip() if name else base.name, 'description': desc.group(1).strip() if desc else '', 'path': str(path.relative_to(ROOT)).replace('\\', '/'), 'status': 'installed_project_skill' if base.parent == ROOT / '.claude' / 'skills' else 'unreviewed_reference'})
    return sorted(result, key=lambda x: x['path'].lower())

def repositories() -> list[dict]:
    metadata = json.loads((CATALOG / 'github-metadata.json').read_text(encoding='utf-8'))
    lines = (CATALOG / 'source-list.txt').read_text(encoding='utf-8', errors='replace').splitlines()
    local = json.loads((CATALOG / 'local-snapshots.json').read_text(encoding='utf-8'))
    result = []
    for item in metadata['repositories']:
        name = item['requested']
        mentions = [line.strip() for line in lines if re.search(r'https?://github\.com/' + re.escape(name) + r'(?![\w.\-/])', line, re.I)]
        result.append({'repository': name, 'url': 'https://github.com/' + name, 'github_metadata': item['metadata'], 'metadata_error': item['error'], 'mentions': mentions, 'local_reference': local.get(name.lower()), 'audit_status': 'not_audited', 'execution_status': 'not_approved', 'note': 'Repository metadata and local presence are not a security verdict.'})
    existing = {item['repository'].lower() for item in result}
    for item in routed_repositories():
        if item['repository'].lower() not in existing:
            result.append(item)
    return result

def routed_repositories() -> list[dict]:
    """Join curated descriptions with recorded source locations; never load repo code."""
    if not EXTERNAL_INVENTORY.is_file() or not EXTERNAL_ROUTES.is_file():
        return []
    inventory = json.loads(EXTERNAL_INVENTORY.read_text(encoding='utf-8'))
    routes = json.loads(EXTERNAL_ROUTES.read_text(encoding='utf-8'))
    by_name = {item['repository'].lower(): item for item in inventory['repositories']}
    result = []
    for route in routes['repositories']:
        record = by_name.get(route['repository'].lower())
        if not record:
            continue
        result.append({**route, 'url': record.get('source_url'),
                       'local_reference': record.get('path'), 'source_revision': record.get('commit'),
                       'checkout_status': record.get('checkout_status'),
                       'audit_status': 'not_audited', 'execution_status': 'not_approved'})
    return result

def main() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='backslashreplace')
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('index', help='Refresh local repository and skill-reference indexes')
    route = sub.add_parser('route', help='Suggest skill references for a task; never execute them')
    route.add_argument('task'); route.add_argument('--limit', type=int, default=8)
    args = parser.parse_args()
    skills = skill_index()
    if args.command == 'index':
        repos = repositories()
        (CATALOG / 'repositories.json').write_text(json.dumps({'source': 'source-list.txt', 'repositories': repos}, indent=2, ensure_ascii=False), encoding='utf-8')
        (CATALOG / 'skill-index.json').write_text(json.dumps({'skills': skills}, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f'Indexed {len(repos)} repository URLs and {len(skills)} local skill references. All require individual review.')
    else:
        q = words(args.task)
        matches = []
        for s in skills:
            title = words(s['name'] + ' ' + s['path']); desc = words(s['description'])
            score = 3 * len(q & title) + len(q & desc)
            if score: matches.append((score, s))
        for score, s in sorted(matches, key=lambda x: (-x[0], x[1]['path']))[:max(1, min(args.limit, 30))]:
            print(f"{score:2}  {s['name']}  [{s['status']}]\n    {s['path']}\n    {s['description'][:240]}")
        if not matches: print('No local skill reference matched. Check the task against the available installed skill catalog.')
        repo_matches = []
        for repo in routed_repositories():
            title = words(repo['repository'] + ' ' + ' '.join(repo['keywords']))
            desc = words(repo['description'])
            score = 3 * len(q & title) + len(q & desc)
            if score: repo_matches.append((score, repo))
        if repo_matches:
            print('\nStaged repository references:')
            for score, repo in sorted(repo_matches, key=lambda x: (-x[0], x[1]['repository'].lower()))[:max(1, min(args.limit, 30))]:
                print(f"{score:2}  {repo['repository']} [not audited; execution not approved]\n    {repo['local_reference']}\n    {repo['description']}")
        print('\nSuggestions are unreviewed references, not security approvals; only entries marked installed_project_skill are installed.')

if __name__ == '__main__': main()
