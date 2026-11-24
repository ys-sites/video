"""Record one UTC day's GitHub star total and render the README chart."""

import argparse
import csv
import math
from datetime import date
from pathlib import Path

START_X, END_X = 65, 740
TOP, BOTTOM = 64, 226


def record(history, day, stars):
    if stars < 0 or (history and day < max(history)):
        raise ValueError("Expected a nonnegative star count on or after the latest date")
    history[day] = stars


def chart(history):
    first, last = min(history), max(history)
    span = max((last - first).days, 1)
    peak = max(max(history.values()), 1)
    unit = 10 ** math.floor(math.log10(max(peak / 5, 1)))
    step = next(n * unit for n in (1, 2, 5, 10) if n * unit >= peak / 5)
    ceiling = math.ceil(peak / step) * step

    def x(day):
        return START_X + (END_X - START_X) * (day - first).days / span

    def y(count):
        return BOTTOM - (BOTTOM - TOP) * count / ceiling

    svg = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="780" height="280" viewBox="0 0 780 280" role="img" aria-labelledby="title desc">
  <title id="title">OpenMotion star history</title>
  <desc id="desc">Daily GitHub stars for nexu-io/openmotion from {first} to {last}. Latest total: {history[last]:,}.</desc>
  <style>
    svg {{ font: 13px system-ui, sans-serif; color: #24292f; }}
    text {{ fill: currentColor; }}
    .background {{ fill: #fff; }}
    .grid {{ stroke: #d1d9e0; }}
    .series {{ fill: none; stroke: #0969da; stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }}
    @media (prefers-color-scheme: dark) {{
      svg {{ color: #e6edf3; }} .background {{ fill: #0d1117; }} .grid {{ stroke: #30363d; }} .series {{ stroke: #58a6ff; }}
    }}
  </style>
  <rect class="background" width="780" height="280" rx="10"/>
  <text x="24" y="40" font-size="23" font-weight="600">nexu-io/openmotion</text>
  <text x="740" y="39" text-anchor="end">{history[last]:,} ★ · {last}</text>''']
    for tick in range(0, ceiling + 1, step):
        label = f"{tick / 1000:g}k" if tick >= 1000 else str(tick)
        svg.append(f'  <path class="grid" d="M{START_X} {y(tick):.1f}H{END_X}"/>')
        svg.append(f'  <text x="53" y="{y(tick)+4:.1f}" text-anchor="end">{label}</text>')
    # Choose up to six actual dates; include both ends, even across missing days.
    dates = sorted(history)
    for i in sorted({round(n * (len(dates) - 1) / 5) for n in range(6)}):
        day = dates[i]
        svg.append(f'  <text x="{x(day):.1f}" y="254" text-anchor="middle">{day:%Y-%m-%d}</text>')
    points = " ".join(f"{x(day):.1f},{y(history[day]):.1f}" for day in dates)
    svg.append(f'  <polyline class="series" points="{points}"/>')
    return "\n".join([*svg, "</svg>", ""])


def update(directory, day, stars):
    data = directory / "stars.csv"
    history = {}
    with data.open(newline="") as source:
        rows = csv.DictReader(source)
        if rows.fieldnames != ["date", "stars"]:
            raise ValueError("Invalid stars.csv header")
        for row in rows:
            observed = date.fromisoformat(row["date"])
            if observed in history:
                raise ValueError(f"Duplicate observation for {observed}")
            record(history, observed, int(row["stars"]))
    if not history:
        raise ValueError("Missing historical observations")
    record(history, day, stars)
    svg = chart(history)
    with data.open("w", newline="") as out:
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["date", "stars"])
        writer.writerows(sorted(history.items()))
    (directory / "star-history.svg").write_text(svg, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("day", type=date.fromisoformat)
    parser.add_argument("stars", type=int)
    args = parser.parse_args()
    update(args.directory, args.day, args.stars)
