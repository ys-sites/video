#!/usr/bin/env python3
"""Send one ComfyUI workflow to a GPU (or CPU) ComfyUI server, wait, and download the outputs.

The same script serves every tier; only --server changes:
  local CPU tier        --server http://127.0.0.1:8188   (ComfyUI started with --cpu on this PC)
  rented Nvidia GPU     --server http://127.0.0.1:8188   (after `ssh -L 8188:127.0.0.1:8188 ...` to the rented box)
  future physical GPU   --server http://127.0.0.1:8188   (ComfyUI on this PC without --cpu)

Standard library only. ComfyUI API endpoints used: POST /prompt, GET /history/<id>, GET /view.
--dry-run validates the workflow and prints the plan without contacting any server.
"""
import argparse, json, sys, time, urllib.parse, urllib.request, uuid
from pathlib import Path

def load_workflow(path: Path) -> dict:
    wf = json.loads(path.read_text(encoding='utf-8'))
    if 'nodes' in wf and 'links' in wf:
        sys.exit('This is a UI-format workflow. In ComfyUI use "Export (API)" and pass that file.')
    if not isinstance(wf, dict) or not all(isinstance(v, dict) and 'class_type' in v for v in wf.values()):
        sys.exit('Not an API-format ComfyUI workflow (expected {node_id: {class_type, inputs}}).')
    return wf

def set_inputs(wf: dict, assignments: list[str]) -> None:
    for a in assignments:
        key, _, value = a.partition('=')
        node, _, field = key.partition('.')
        if node not in wf or not field:
            sys.exit(f'--set {a}: expected <node_id>.<input>=<value> with an existing node id')
        try:
            value = json.loads(value)
        except ValueError:
            pass
        wf[node].setdefault('inputs', {})[field] = value

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('workflow', type=Path)
    p.add_argument('--server', default='http://127.0.0.1:8188')
    p.add_argument('--out', type=Path, default=Path('gpu-outputs'))
    p.add_argument('--set', action='append', default=[], help='override an input, e.g. 6.text="a red barn" or 3.seed=42')
    p.add_argument('--timeout-min', type=float, default=45)
    p.add_argument('--dry-run', action='store_true')
    a = p.parse_args()
    if not a.server.startswith(('http://127.0.0.1', 'http://localhost')):
        sys.exit('Refusing a non-loopback server. Reach remote GPUs through an SSH tunnel, never an open port.')
    wf = load_workflow(a.workflow)
    set_inputs(wf, a.set)
    outputs = [k for k, v in wf.items() if v['class_type'] in ('SaveImage', 'SaveVideo', 'SaveAnimatedWEBP', 'VHS_VideoCombine', 'SaveWEBM')]
    print(f'workflow: {len(wf)} nodes, output nodes: {outputs or "none found"}; server {a.server}; out {a.out}')
    if a.dry_run:
        print('DRY RUN OK: workflow is API format; nothing sent.')
        return
    client = str(uuid.uuid4())
    req = urllib.request.Request(a.server + '/prompt', data=json.dumps({'prompt': wf, 'client_id': client}).encode(),
                                 headers={'Content-Type': 'application/json'})
    pid = json.load(urllib.request.urlopen(req, timeout=30))['prompt_id']
    print('queued', pid)
    deadline = time.time() + a.timeout_min * 60
    while time.time() < deadline:
        hist = json.load(urllib.request.urlopen(f'{a.server}/history/{pid}', timeout=30))
        if pid in hist:
            status = hist[pid].get('status', {})
            if status.get('status_str') == 'error':
                sys.exit('ComfyUI reported an error: ' + json.dumps(status.get('messages', []))[:800])
            a.out.mkdir(parents=True, exist_ok=True)
            n = 0
            for node_out in hist[pid].get('outputs', {}).values():
                for kind in ('images', 'gifs', 'videos'):
                    for item in node_out.get(kind, []):
                        q = urllib.parse.urlencode({'filename': item['filename'], 'subfolder': item.get('subfolder', ''), 'type': item.get('type', 'output')})
                        dest = a.out / Path(item['filename']).name
                        dest.write_bytes(urllib.request.urlopen(f'{a.server}/view?{q}', timeout=300).read())
                        print('saved', dest); n += 1
            print(f'done: {n} file(s)')
            return
        time.sleep(5)
    sys.exit('timed out; the job may still be running on the server')

if __name__ == '__main__':
    main()
