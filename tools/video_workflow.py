#!/usr/bin/env python3
"""Create private creator-edit projects and non-rendered style comparison plans."""
import argparse
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / 'video-projects'
RULEBOOKS = ROOT / 'skills' / 'creator-video' / 'references' / 'rulebooks'
RESERVED = {'con','prn','aux','nul',*(f'com{i}' for i in range(1,10)),*(f'lpt{i}' for i in range(1,10))}

def safe_name(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', value) or value.casefold() in RESERVED:
        raise ValueError('Names must contain only letters, numbers, hyphens and underscores, and cannot be Windows device names.')
    return value

def write_json(path, value):
    with path.open('x', encoding='utf-8', newline='\n') as f: json.dump(value, f, ensure_ascii=False, indent=2); f.write('\n')

def init(name):
    target = PROJECTS / safe_name(name)
    PROJECTS.mkdir(exist_ok=True)
    target.mkdir(exist_ok=False)
    for directory in ('input', 'references/good', 'references/bad', 'rulebooks', 'notes', 'variants', 'exports'):
        (target / directory).mkdir(parents=True, exist_ok=True)
    for source in sorted(RULEBOOKS.glob('*.md')): shutil.copy2(source, target / 'rulebooks' / source.name)
    write_json(target / 'project.json', {'name': name, 'status': 'awaiting_source', 'source_files': [], 'target_platform': None, 'approved_style': None, 'notes': 'Edit these settings for this project.'})
    write_json(target / 'cut-plan.json', {'status': 'not_created', 'source': None, 'segments': [], 'note': 'Add reviewed source ranges before using this as a shared cut.'})
    (target / 'notes' / 'taste.md').write_text('# Approved taste decisions\n\nNo decisions approved yet. Add the reference, the specific decision, and its scope after review.\n', encoding='utf-8')
    (target / 'notes' / 'revisions.md').write_text('# Revision notes\n\nRecord the version, time or frame, exact words, requested change, and review status.\n', encoding='utf-8')
    print(f'Created {target}; no media, edit or render has been generated.')

def variants(name, styles):
    target = PROJECTS / safe_name(name)
    if not (target / 'project.json').is_file(): raise ValueError('Project not found; run init first.')
    names = [safe_name(s) for s in styles]
    if len({s.casefold() for s in names}) != len(names): raise ValueError('Style names must be unique.')
    output = target / 'variants'
    paths = [output / (s + '.json') for s in names]
    if any(p.exists() for p in paths): raise ValueError('A variant plan already exists; nothing was overwritten.')
    for style,path in zip(names,paths):
        write_json(path, {'style': style, 'status': 'planning_only', 'shared_cut_plan': '../cut-plan.json', 'creative_direction': None, 'visual_reference': None, 'caption_treatment': None, 'sound_treatment': None, 'render_path': None, 'review_status': 'not_reviewed'})
    print(f'Created {len(paths)} separate variant plans in {output}; no video was rendered or published.')

def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='command',required=True)
    one=sub.add_parser('init'); one.add_argument('project_name')
    two=sub.add_parser('variants'); two.add_argument('project_name'); two.add_argument('--styles',nargs='+',required=True)
    a=p.parse_args()
    try:
        if a.command == 'init': init(a.project_name)
        else: variants(a.project_name,a.styles)
    except (ValueError,FileExistsError) as e: p.error(str(e))

if __name__ == '__main__': main()
