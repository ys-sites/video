"""Report the compressed installer size and uncompressed contributors without extracting files."""

import argparse
from collections import Counter
import os
from pathlib import Path
import re
import tarfile

MIB = 1024 * 1024
WARNING_GROWTH = MIB
MAX_BYTES = 28 * MIB  # 26 playable game templates add about 2.3 MiB compressed (PR #768).


def package_files(path):
    with tarfile.open(path, "r:gz") as installer:
        applications = [
            entry for entry in installer if entry.isfile() and
            re.fullmatch(r"package/payload/openmotion-application-[\w.-]+\.tar\.gz", entry.name)
        ]
        if len(applications) != 1:
            raise ValueError("Expected one default npm application archive")
        with tarfile.open(fileobj=installer.extractfile(applications[0]), mode="r|gz") as application:
            return {entry.name.removeprefix("./"): entry.size for entry in application if entry.isfile()}


def totals(files):
    directories = Counter()
    for path, size in files.items():
        parts = path.split("/")
        depth = 3 if path.startswith("studio/build/") else 2
        directories["/".join(parts[:min(depth, len(parts) - 1)]) or "(root)"] += size
    return directories


def comparable_files(files):
    names = Counter()
    for path, size in files.items():
        if path.startswith("studio/build/editor-assets/"):
            path = re.sub(r"-[A-Za-z0-9_-]{8}(?=\.[^.]+$)", "-*", path)
        names[path] += size
    return names


def changes(current, baseline):
    delta = {name: current.get(name, 0) - baseline.get(name, 0) for name in current.keys() | baseline.keys()}
    return sorted(delta.items(), key=lambda item: (-abs(item[1]), item[0]))[:8]


def report(candidate, baseline=None, report_only=False):
    size = candidate.stat().st_size
    title = f"Default npm package: {size / MIB:.2f} MiB"
    files = package_files(candidate)
    base = package_files(baseline) if baseline else {}
    if baseline:
        previous = baseline.stat().st_size
        growth = size - previous
        title = f"Default npm package: {previous / MIB:.2f} → {size / MIB:.2f} MiB ({growth / MIB:+.2f} MiB)"
        if growth >= WARNING_GROWTH:
            print(f"::warning::{title}. See the package size summary for the largest changes.")
    lines = [f"### {title}", f"Budget: {MAX_BYTES // MIB} MiB compressed.", ""]
    file_changes = changes(comparable_files(files), comparable_files(base)) if baseline else changes(files, base)
    for label, items in [("Directories", changes(totals(files), totals(base))), ("Files", file_changes)]:
        lines += [f"{label} by {'change in ' if baseline else ''}uncompressed size", "", "| Path | MiB |", "| --- | ---: |"]
        for path, delta in items:
            if delta:
                safe_path = re.sub(r"[^\w./ @+()*-]", "?", path)
                amount = f"{delta / MIB:+.3f}" if baseline else f"{delta / MIB:.3f}"
                lines.append(f"| `{safe_path}` | {amount} |")
        lines.append("")
    if baseline:
        lines.append("Studio build names with a content hash are grouped under the same name.")
    summary = "\n".join(lines)
    print(summary)
    if output := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(output, "a", encoding="utf-8") as file:
            file.write(summary + "\n")
    if size > MAX_BYTES and not report_only:
        raise SystemExit("Default npm package exceeds its budget. Move optional media out of the package or document and review the budget change.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--report-only", action="store_true", help="Report older build revisions that predate the npm budget")
    args = parser.parse_args()
    report(args.candidate, args.baseline, args.report_only)
