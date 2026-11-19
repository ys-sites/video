#!/usr/bin/env python3
"""Mirror the workspace's routing/capability layer into graph-corpus/ for graphify.

Copies only small, high-signal files (router, docs, local skills, playbooks, catalog records,
and each pulled repo's top-level README / SKILL.md). Removes mirrored files that are no longer
selected, so `graphify graph-corpus --update` stays incremental. Never executes repo content.
Usage: python tools/sync_graph_corpus.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'graph-corpus'
MAX_BYTES = 150_000
SKIP_DIRS = {'.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__', 'graphify-out', 'tests', 'test', 'examples', 'vendor'}

PATTERNS = [
    'AGENTS.md', 'README.md', 'SECURITY.md', 'STYLE_SYSTEM.md', 'Vox guide.md',
    'docs/*.md',
    'skills/*/SKILL.md', 'skills/*/references/*.md',
    'captions-skill/SKILL.md',
    'master-video-styles/README.md', 'master-video-styles/playbooks/*.md', 'master-video-styles/prompts/*.md',
    'resources/repo-catalog/*.md', 'resources/repo-catalog/security-tool-registry.json',
    'resources/concordia/README.md', 'resources/concordia/guides/*.md',
    'resources/visually-research/README.md', 'resources/higgsfield-reference/*.md',
    'talking-head-reels/*/SKILL.md', 'voiceover-glass-reel/*/SKILL.md',
]
REPO_PARENTS = ['resources/motion-systems', 'resources/repo-quarantine', 'resources/security-tools']


def repo_dirs():
    for parent in REPO_PARENTS:
        base = ROOT / parent
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            if not d.is_dir():
                continue
            if (d / '.git').exists():
                yield d
            else:  # owner/repo layout in the quarantine
                for sub in sorted(d.iterdir()):
                    if sub.is_dir() and (sub / '.git').exists():
                        yield sub


def selected():
    files = set()
    for pat in PATTERNS:
        files.update(p for p in ROOT.glob(pat) if p.is_file())
    for repo in repo_dirs():
        for name in ('README.md', 'SKILL.md'):
            if (repo / name).is_file():
                files.add(repo / name)
        if 'motion-systems' not in repo.parts:  # nested skills are the styles only for motion systems
            continue
        for skill in repo.glob('**/SKILL.md'):
            rel = skill.relative_to(repo).parts
            if len(rel) <= 5 and not SKIP_DIRS.intersection(rel) and 'plugins' not in rel:
                files.add(skill)
    return {f for f in files if f.stat().st_size <= MAX_BYTES and not f.is_symlink()}


def main():
    want = {f.relative_to(ROOT): f for f in selected()}
    OUT.mkdir(exist_ok=True)
    copied = kept = removed = 0
    for rel, src in want.items():
        dst = OUT / rel
        if dst.exists() and dst.stat().st_size == src.stat().st_size and dst.read_bytes() == src.read_bytes():
            kept += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        copied += 1
    for dst in list(OUT.rglob('*')):
        if dst.is_file() and dst.relative_to(OUT) not in want:
            dst.unlink()
            removed += 1
    for d in sorted((p for p in OUT.rglob('*') if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
        if not any(d.iterdir()):
            d.rmdir()
    print(f'graph-corpus: {len(want)} files ({copied} copied/updated, {kept} unchanged, {removed} removed)')


if __name__ == '__main__':
    main()
