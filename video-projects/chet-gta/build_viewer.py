"""Build the Chet GTA Files page: every project text file in one tabbed HTML page.

Usage: python -I build_viewer.py <output.html>
Rerun after each iteration, then republish the page so the iPad view stays current.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# (tab label, path relative to the project, short note shown above the file)
FILES = [
    ("Brainstorming", "brainstorming.md", "Living memory: Canon, open questions, iteration log"),
    ("Story", "story/story.md", "The story as prose (v3)"),
    ("Storyline", "story/storyline.md", "Beat sheet, screen layout, scenes, draft lines"),
    ("Pipeline", "PIPELINE.md", "Steps 01–05, gates and every tool mapped"),
    ("Project rules", "AGENTS.md", "What every session does on this project"),
    ("project.json", "project.json", "Project metadata"),
    ("01 Assets", "01-assets/README.md", "Checklist"),
    ("02 Voice", "02-voice/README.md", "Checklist"),
    ("03 Manga", "03-manga-storyboard/README.md", "Checklist"),
    ("04 Higgsfield", "04-higgsfield-scenes/README.md", "Checklist"),
    ("05 Edit", "05-edit/README.md", "Checklist"),
    ("Input", "input/README.md", "What to drop in input/"),
]

TEMPLATE = Path(__file__).with_name("viewer_template.html")


def main() -> None:
    out = Path(sys.argv[1])
    docs = []
    for label, rel, note in FILES:
        text = (ROOT / rel).read_text(encoding="utf-8").replace("\r\n", "\n")
        if rel.endswith(".json"):
            text = "```json\n" + text.strip() + "\n```\n"
        docs.append({"label": label, "path": f"video-projects/chet-gta/{rel}", "note": note, "md": text})
    payload = json.dumps(docs, ensure_ascii=False).replace("</", "<\\/")
    page = TEMPLATE.read_text(encoding="utf-8").replace("/*DOCS*/[]", payload)
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(docs)} files)")


if __name__ == "__main__":
    main()
