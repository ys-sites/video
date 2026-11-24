"""Turn an edit list into an OpenTimelineIO (.otio) timeline you can open and fine-tune by hand.

Kdenlive (File > OpenTimelineIO Import, or open the .otio directly), DaVinci Resolve and Premiere read it.
Standard library only.

  python to_otio.py edit.json cut.otio

edit.json:
{"name": "Listing reel", "fps": 30,
 "clips": [
   {"file": "C:/footage/entry.mp4", "in": 0.5, "out": 2.5},
   {"file": "C:/footage/kitchen.mp4", "in": 4.0, "out": 6.2, "name": "kitchen hero"}
 ],
 "audio": [{"file": "C:/music/bed.mp3", "in": 0, "out": 30, "at": 0}]}

Clip "in"/"out" are seconds inside the source file. Clips play one after another on V1 with their own sound on A1;
"audio" items go on A2 starting at "at" seconds (gaps are filled). Give each source's real length with "length"
(seconds) or the script asks ffprobe for it.
"""
import json
import pathlib
import subprocess
import sys


def rt(value, rate):
    return {"OTIO_SCHEMA": "RationalTime.1", "rate": float(rate), "value": float(round(value * rate))}


def trange(start, dur, rate):
    return {"OTIO_SCHEMA": "TimeRange.1", "start_time": rt(start, rate), "duration": rt(dur, rate)}


def length_of(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                          "default=nw=1:nk=1", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def clip(item, rate):
    path = pathlib.Path(item["file"]).resolve()
    if not path.exists():
        raise SystemExit(f"missing source: {path}")
    total = float(item.get("length") or length_of(path))
    a, b = float(item["in"]), float(item["out"])
    if not 0 <= a < b <= total + 1e-6:
        raise SystemExit(f"bad range {a}-{b} for {path.name} (length {total:.2f} s)")
    return {
        "OTIO_SCHEMA": "Clip.2", "name": item.get("name", path.name), "metadata": {}, "enabled": True,
        "source_range": trange(a, b - a, rate), "effects": [], "markers": [],
        "active_media_reference_key": "DEFAULT_MEDIA",
        "media_references": {"DEFAULT_MEDIA": {
            "OTIO_SCHEMA": "ExternalReference.1", "name": path.name, "metadata": {},
            "target_url": path.as_uri(), "available_range": trange(0, total, rate)}},
    }


def gap(seconds, rate):
    return {"OTIO_SCHEMA": "Gap.1", "name": "", "metadata": {}, "enabled": True,
            "source_range": trange(0, seconds, rate), "effects": [], "markers": []}


def track(name, kind, children):
    return {"OTIO_SCHEMA": "Track.1", "name": name, "kind": kind, "metadata": {}, "enabled": True,
            "source_range": None, "effects": [], "markers": [], "children": children}


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    spec = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    rate = spec.get("fps", 30)
    video = [clip(c, rate) for c in spec["clips"]]
    sound = [clip(c, rate) for c in spec["clips"] if not c.get("mute")]
    tracks = [track("V1", "Video", video), track("A1", "Audio", sound)]
    if spec.get("audio"):
        a2, t = [], 0.0
        for item in sorted(spec["audio"], key=lambda x: x.get("at", 0)):
            at = float(item.get("at", 0))
            if at > t:
                a2.append(gap(at - t, rate))
            a2.append(clip(item, rate))
            t = at + float(item["out"]) - float(item["in"])
        tracks.append(track("A2", "Audio", a2))
    timeline = {"OTIO_SCHEMA": "Timeline.1", "name": spec.get("name", "cut"), "metadata": {},
                "global_start_time": None,
                "tracks": {"OTIO_SCHEMA": "Stack.1", "name": "tracks", "metadata": {}, "enabled": True,
                           "source_range": None, "effects": [], "markers": [], "children": tracks}}
    pathlib.Path(sys.argv[2]).write_text(json.dumps(timeline, indent=2), encoding="utf-8")
    dur = sum(float(c["out"]) - float(c["in"]) for c in spec["clips"])
    print(f"wrote {sys.argv[2]}: {len(video)} clips, {dur:.2f} s, {len(tracks)} tracks")


if __name__ == "__main__":
    main()
