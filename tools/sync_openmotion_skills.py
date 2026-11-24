"""Copy this workspace's skills into the sibling OpenMotion library.

OpenMotion lists every folder with a SKILL.md under <openmotion>/library/skills
through openmotion_list_skills / openmotion_get_skill. This script copies the
skills named in tools/openmotion-skills.json there as 'masvid-<id>'.

Only text files are copied (instructions and references). Scripts, assets,
fonts and models stay in the original folder; a header added to each SKILL.md
points back to it. Nothing is executed. Re-run after adding or editing a skill:

    python tools/sync_openmotion_skills.py            # sync
    python tools/sync_openmotion_skills.py --dry-run  # show what would change
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MANIFEST = REPO / "tools" / "openmotion-skills.json"
DEFAULT_TARGET = REPO / "masvid-studio" / "library" / "skills"  # Masvid Studio; pass --target for another OpenMotion checkout
PREFIX = "masvid-"
OWNED = ".masvid-sync-owned.json"  # a file, so OpenMotion's directory scan ignores it
TEXT_EXT = {".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".toml"}
MAX_BYTES = 1_000_000
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".pytest_cache"}


def resolve(source: str) -> Path:
    return Path(source).expanduser() if source.startswith("~") else REPO / source


def header(src: Path, skipped: int) -> str:
    note = f" {skipped} non-text or oversized files were left there." if skipped else ""
    return (
        "\n> **Imported from the Master Video Editor workspace** by `tools/sync_openmotion_skills.py`.\n"
        f"> Original folder: `{src}`. Only text files were copied here.{note} Resolve relative paths "
        "(scripts, assets, fonts, models) against the original folder. Paths that start with `skills/`, "
        f"`docs/`, `master-video-styles/` or `resources/` resolve against the workspace root `{REPO}`.\n"
        f"> The workspace rules in `{REPO / 'AGENTS.md'}` and `docs/MASTER-ROUTER.md` still apply: run the "
        "security gate before executing any script, and honour each reference's licence. Use this Skill as "
        "creative direction inside OpenMotion projects; OpenMotion's own Skills govern its project tools, "
        "preview and export.\n"
    )


def with_header(text: str, block: str) -> str:
    # Keep YAML frontmatter first: OpenMotion reads name/description from it.
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            cut = text.find("\n", end + 4)
            cut = len(text) if cut == -1 else cut + 1
            return text[:cut] + block + "\n" + text[cut:]
    return block + "\n" + text


def plan(src: Path) -> tuple[list[Path], int]:
    keep, skipped = [], 0
    for path in sorted(src.rglob("*")):
        rel = path.relative_to(src)
        if any(part in SKIP_DIRS for part in rel.parts) or not path.is_file():
            continue
        if path.suffix.lower() in TEXT_EXT and path.stat().st_size <= MAX_BYTES:
            keep.append(rel)
        else:
            skipped += 1
    return keep, skipped


def style_skills() -> list[tuple[str, str]]:
    """One skill per free style shown on masvid.vercel.app, built from the site's own data."""
    sys.path.insert(0, str(REPO / "master-video-styles" / "scripts"))
    import build  # the site generator; importing it only loads the data files

    styles, _ = build.free_only(build.STYLES["styles"], build.STYLES["tools"])
    out = []
    for s in styles:
        desc = f"{s['title']} ({s.get('tag', '')}). {s.get('look', '')} Best for: {s.get('best_for', '')}"
        desc = " ".join(desc.split()).replace('"', "'")
        lines = [
            "---",
            f"name: masvid-style-{s['slug']}",
            f'description: "Site style — {desc[:900]}"',
            "---",
            "",
            f"# {s['title']}",
            "",
            "> **Generated from masvid.vercel.app** (`master-video-styles/data/styles.json`) by "
            "`tools/sync_openmotion_skills.py`. Use it as creative direction for an OpenMotion composition; "
            "OpenMotion's own Skills govern project tools, preview and export. Only the user's own or licensed "
            "footage and audio go into the video.",
            "",
            f"**Tag:** {s.get('tag', '')}  ",
            f"**Best for:** {s.get('best_for', '')}",
            "",
            "## Look",
            "",
            s.get("look", ""),
            "",
        ]
        if s.get("rules"):
            lines += ["## Rules", ""] + [f"- {r}" for r in s["rules"]] + [""]
        if s.get("steps"):
            lines += ["## Steps", ""]
            for i, st in enumerate(s["steps"], 1):
                lines.append(f"{i}. **{st.get('title', '')}** — {st.get('detail', '')}")
            lines.append("")
        if s.get("prompt"):
            lines += ["## Brief to apply", "", s["prompt"], ""]
        if s.get("reference_reel_note"):
            lines += ["## Reference (study only, not licensed for reuse)", "", s["reference_reel_note"], ""]
        out.append((f"{PREFIX}style-{s['slug']}", "\n".join(lines)))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    target: Path = args.target
    if not target.is_dir():
        print(f"OpenMotion library not found: {target}", file=sys.stderr)
        return 1
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))["skills"]
    owned_file = target / OWNED
    previous = set(json.loads(owned_file.read_text(encoding="utf-8"))) if owned_file.exists() else set()

    synced, problems = [], []
    for entry in entries:
        name = PREFIX + entry["id"]
        src = resolve(entry["source"])
        if not (src / "SKILL.md").is_file():
            problems.append(f"{name}: no SKILL.md in {src}")
            continue
        dest = target / name
        if dest.exists() and name not in previous:
            problems.append(f"{name}: {dest} exists and is not owned by this sync; left untouched")
            continue
        files, skipped = plan(src)
        total = sum((src / f).stat().st_size for f in files)
        print(f"{name:40} {len(files):4} files {total / 1024:9.0f} KB  (left {skipped} in source)")
        synced.append(name)
        if args.dry_run:
            continue
        if dest.exists():
            shutil.rmtree(dest)
        for rel in files:
            out = dest / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            if rel.as_posix() == "SKILL.md":
                text = (src / rel).read_text(encoding="utf-8", errors="replace")
                out.write_text(with_header(text, header(src, skipped)), encoding="utf-8")
            else:
                shutil.copyfile(src / rel, out)

    for name, text in style_skills():
        dest = target / name
        if dest.exists() and name not in previous:
            problems.append(f"{name}: {dest} exists and is not owned by this sync; left untouched")
            continue
        print(f"{name:40}    1 files {len(text.encode('utf-8')) / 1024:9.0f} KB  (site style)")
        synced.append(name)
        if not args.dry_run:
            if dest.exists():
                shutil.rmtree(dest)
            dest.mkdir(parents=True)
            (dest / "SKILL.md").write_text(text, encoding="utf-8")

    stale = sorted(previous - set(synced) - {p.split(":")[0] for p in problems})
    for name in stale:
        print(f"remove stale {name}")
        if not args.dry_run and (target / name).is_dir():
            shutil.rmtree(target / name)
    if not args.dry_run:
        owned_file.write_text(json.dumps(sorted(synced), indent=2) + "\n", encoding="utf-8")
    for problem in problems:
        print("WARNING " + problem, file=sys.stderr)
    print(f"{'Would sync' if args.dry_run else 'Synced'} {len(synced)} skills into {target}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
