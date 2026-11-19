#!/usr/bin/env python3
"""Fail closed for execution of unreviewed external resources.

This is a project workflow check, not OS-wide execution control or antivirus.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUMMARY = ROOT / 'resources' / 'repo-catalog' / 'motion-skillspector-summary.json'
RETRY = ROOT / 'resources' / 'repo-catalog' / 'motion-skillspector-retry.json'

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('path', help='local third-party resource path to evaluate')
    args = p.parse_args()
    target = Path(args.path).resolve()
    if not target.exists():
        print('BLOCKED: source does not exist; acquire and review it first.')
        return 2
    findings = []
    for report in (SUMMARY, RETRY):
        if not report.is_file():
            continue
        data = json.loads(report.read_text(encoding='utf-8'))
        for entry in data.get('results', []):
            source = (ROOT / entry.get('skill_path', '')).resolve()
            if source == target or target in source.parents or source in target.parents:
                findings.append({'path': entry.get('skill_path'), 'status': entry.get('status'),
                                 'recommendation': entry.get('recommendation'), 'revision': entry.get('source_revision')})
    print(json.dumps({'decision': 'BLOCKED', 'reason': 'No completed, independently verified full audit and approval is recorded by this gate.',
                      'scope': 'Project workflow only; this does not prevent operating-system execution.',
                      'scanner_observations': findings}, indent=2))
    return 1

if __name__ == '__main__':
    sys.exit(main())
