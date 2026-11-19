#!/usr/bin/env python3
"""Measure every reel in the real-estate reference folders without modifying them.

usage:
  python tools/study_reels.py metrics      # ffprobe, scene cuts, loudness, contact sheets
  <captions venv python> tools/study_reels.py transcribe   # faster-whisper word timings
  python tools/study_reels.py summarize    # merge into study.json + study.csv
  python tools/study_reels.py report       # per-archetype table + catalogue (needs notes.json)

notes.json (hand-written after viewing every contact sheet) maps reel id -> [archetype, observation].

Outputs go to resources/creator-styles/real-estate-study/ (git-ignored: derived from
third-party creator media, local research only). Source folders are read-only here.
"""
import csv, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = [os.path.join(ROOT, 'real-estate-reels'), os.path.join(ROOT, 'real-estate-reels-expansion')]
OUT = os.path.join(ROOT, 'resources', 'creator-styles', 'real-estate-study')
FONT = 'C\\:/Windows/Fonts/arialbd.ttf'


def reels():
    for src in SOURCES:
        with open(os.path.join(src, 'reels-manifest.json'), encoding='utf-8') as f:
            data = json.load(f)
        for r in data['reels']:
            if r.get('status') != 'downloaded' or not r.get('local_file'):
                continue
            path = os.path.join(src, r['local_file'])
            if os.path.exists(path):
                r['_path'] = path
                r['_collection'] = os.path.basename(src)
                yield r


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')


def metrics_one(r):
    rid = r['id']
    dest = os.path.join(OUT, 'metrics', rid + '.json')
    if os.path.exists(dest):
        return rid, 'skip'
    p = r['_path']
    probe = json.loads(run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', p]).stdout)
    v = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    num, den = (v.get('avg_frame_rate') or '0/1').split('/')
    fps = float(num) / float(den) if float(den) else 0
    dur = float(probe['format']['duration'])
    # Hard cuts: scene score > 0.28 on a downscaled stream.
    sc = run(['ffmpeg', '-hide_banner', '-i', p, '-an', '-vf', "scale=180:-2,select='gt(scene,0.28)',metadata=print", '-f', 'null', '-'])
    cuts = []
    for m in re.finditer(r'pts_time:([\d.]+)', sc.stderr):
        t = float(m.group(1))
        if not cuts or t - cuts[-1] > 0.25:
            cuts.append(round(t, 2))
    bounds = [0.0] + cuts + [dur]
    shots = [round(b - a, 2) for a, b in zip(bounds, bounds[1:]) if b - a > 0.05]
    # Loudness and dynamic range.
    lo = run(['ffmpeg', '-hide_banner', '-i', p, '-vn', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'])
    I = re.findall(r'I:\s+(-?[\d.]+) LUFS', lo.stderr)
    LRA = re.findall(r'LRA:\s+([\d.]+) LU', lo.stderr)
    # Contact sheet: 10 evenly spaced frames with timestamps, labelled strip on top.
    os.makedirs(os.path.join(OUT, 'sheets'), exist_ok=True)
    sheet = os.path.join(OUT, 'sheets', rid + '.jpg')
    label = f"{rid}  {r.get('creator','')}  {dur:.0f}s  cuts={len(cuts)}".replace(':', ' ').replace("'", '')
    vf = (f"fps=10/{dur:.3f},scale=144:256:force_original_aspect_ratio=decrease,pad=144:256:(ow-iw)/2:(oh-ih)/2,"
          f"drawtext=fontfile='{FONT}':text='%{{pts\\:hms}}':x=4:y=4:fontsize=13:fontcolor=yellow:box=1:boxcolor=black@0.6,"
          f"tile=10x1,pad=iw:ih+24:0:24:color=0x202020,"
          f"drawtext=fontfile='{FONT}':text='{label}':x=6:y=5:fontsize=15:fontcolor=white")
    run(['ffmpeg', '-hide_banner', '-y', '-i', p, '-an', '-vf', vf, '-frames:v', '1', '-q:v', '4', sheet])
    rec = {
        'id': rid, 'collection': r['_collection'], 'creator': r.get('creator'), 'url': r.get('url'),
        'file': os.path.relpath(p, ROOT).replace('\\', '/'),
        'duration': round(dur, 2), 'width': v.get('width'), 'height': v.get('height'), 'fps': round(fps, 2),
        'audio': any(s['codec_type'] == 'audio' for s in probe['streams']),
        'cuts': cuts, 'cut_count': len(cuts), 'shots': shots,
        'avg_shot': round(sum(shots) / len(shots), 2) if shots else dur,
        'cuts_per_10s': round(len(cuts) / dur * 10, 2) if dur else 0,
        'lufs': float(I[-1]) if I else None, 'lra': float(LRA[-1]) if LRA else None,
        'sheet': os.path.relpath(sheet, ROOT).replace('\\', '/'),
    }
    os.makedirs(os.path.join(OUT, 'metrics'), exist_ok=True)
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(rec, f, indent=1)
    return rid, f"{dur:.0f}s cuts={len(cuts)}"


def transcribe():
    import numpy as np
    from faster_whisper import WhisperModel
    # Optional sharding for parallel runs: STUDY_SHARD=0/2 and 1/2. Keep threads modest; oversubscribing
    # ctranslate2 while ffmpeg jobs run stalls it badly.
    shard, nshards = (int(x) for x in os.environ.get('STUDY_SHARD', '0/1').split('/'))
    model = WhisperModel(os.environ.get('WHISPER_MODEL', 'small'), device='cpu', compute_type='int8',
                         cpu_threads=int(os.environ.get('WHISPER_THREADS', '8')))
    os.makedirs(os.path.join(OUT, 'transcripts'), exist_ok=True)
    for i, r in enumerate(reels()):
        if i % nshards != shard:
            continue
        dest = os.path.join(OUT, 'transcripts', r['id'] + '.json')
        if os.path.exists(dest):
            continue
        # Decode with ffmpeg (faster-whisper's PyAV path breaks on av>=19).
        pcm = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', r['_path'], '-vn', '-ac', '1', '-ar', '16000',
                              '-f', 's16le', '-'], capture_output=True).stdout
        audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
        if audio.size < 16000:
            with open(dest, 'w', encoding='utf-8') as f:
                json.dump({'id': r['id'], 'language': None, 'text': '', 'words': [], 'mean_word_p': None}, f)
            continue
        segs, info = model.transcribe(audio, word_timestamps=True, vad_filter=True)
        segs = list(segs)
        words = [{'w': w.word.strip(), 's': round(w.start, 2), 'e': round(w.end, 2), 'p': round(w.probability, 2)}
                 for s in segs for w in (s.words or []) if w.word.strip()]
        rec = {'id': r['id'], 'language': info.language, 'language_p': round(info.language_probability, 2),
               'text': ' '.join(s.text.strip() for s in segs), 'words': words,
               'mean_word_p': round(sum(w['p'] for w in words) / len(words), 2) if words else None}
        with open(dest, 'w', encoding='utf-8') as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        print(r['id'], info.language, len(words), 'words', flush=True)


def summarize():
    rows = []
    for r in reels():
        m = json.load(open(os.path.join(OUT, 'metrics', r['id'] + '.json'), encoding='utf-8'))
        tp = os.path.join(OUT, 'transcripts', r['id'] + '.json')
        t = json.load(open(tp, encoding='utf-8')) if os.path.exists(tp) else {}
        words = t.get('words', [])
        # Speech is "real" only if whisper is reasonably confident (music-only reels hallucinate).
        # 0.78 separates real speech from transcribed song lyrics in this set (lyrics scored ~0.73).
        speech = bool(words) and (t.get('mean_word_p') or 0) >= 0.78 and len(words) >= 8
        talk = sum(w['e'] - w['s'] for w in words) if speech else 0
        m.update({
            'caption': (r.get('caption') or '')[:600], 'notes': r.get('notes') or '',
            'style_tags': r.get('style_tags') or [], 'likes': r.get('like_count'),
            'language': t.get('language'), 'speech': speech,
            'first_word_s': words[0]['s'] if speech else None,
            'words_per_min': round(len(words) / m['duration'] * 60) if speech else 0,
            'speech_coverage': round(talk / m['duration'], 2) if speech else 0,
            'opening_line': ' '.join(w['w'] for w in words if w['s'] < 4) if speech else '',
            'transcript': t.get('text', '') if speech else '',
        })
        rows.append(m)
    with open(os.path.join(OUT, 'study.json'), 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    keys = ['id', 'creator', 'duration', 'cut_count', 'avg_shot', 'cuts_per_10s', 'lufs', 'speech', 'language',
            'first_word_s', 'words_per_min', 'speech_coverage', 'likes', 'opening_line']
    with open(os.path.join(OUT, 'study.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, keys, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)
    print(len(rows), 'reels summarized')


def report():
    """Per-archetype numbers + catalogue table, from study.json and the hand-written notes.json."""
    import statistics as st
    rows = json.load(open(os.path.join(OUT, 'study.json'), encoding='utf-8'))
    notes = json.load(open(os.path.join(OUT, 'notes.json'), encoding='utf-8'))
    arche = notes.pop('_archetypes')
    med = lambda xs: round(st.median(xs), 1) if xs else None
    out = ['| Archetype | Reels | Median length (s) | Median hard cuts / 10 s | Median shot (s) | Speech-led | Median words/min | Median first word (s) |',
           '|---|---|---|---|---|---|---|---|']
    for code, desc in arche.items():
        rs = [r for r in rows if notes.get(r['id'], [''])[0] == code]
        if not rs:
            continue
        sp = [r for r in rs if r['speech']]
        out.append(f"| **{code}** — {re.split(r'[:(]', desc)[0].strip()} | {len(rs)} | {med([r['duration'] for r in rs])} | "
                   f"{med([r['cuts_per_10s'] for r in rs])} | {med([s for r in rs for s in r['shots']])} | "
                   f"{len(sp)}/{len(rs)} | {med([r['words_per_min'] for r in sp])} | {med([r['first_word_s'] for r in sp])} |")
    cat = ['| Reel | Creator | Type | s | Cuts/10s | Hook (first ~4 s spoken) | What to take from it |', '|---|---|---|---|---|---|---|']
    for r in rows:
        code, note = notes.get(r['id'], ['?', ''])
        hook = (r['opening_line'] or '—').replace('|', '/')[:90]
        creator = (r['creator'] or '').split(';')[0].split(',')[0]
        cat.append(f"| [{r['id']}]({r['url']}) | {creator} | {code} | {r['duration']:.0f} | {r['cuts_per_10s']} | {hook} | {note.replace('|', '/')} |")
    with open(os.path.join(OUT, 'report.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n\n' + '\n'.join(cat) + '\n')
    print('\n'.join(out))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    os.makedirs(OUT, exist_ok=True)
    if cmd == 'metrics':
        with ThreadPoolExecutor(6) as ex:
            for rid, msg in ex.map(metrics_one, list(reels())):
                print(rid, msg, flush=True)
    elif cmd == 'transcribe':
        transcribe()
    elif cmd == 'summarize':
        summarize()
    elif cmd == 'report':
        report()
    else:
        print(__doc__)
