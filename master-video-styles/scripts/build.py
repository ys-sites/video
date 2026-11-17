#!/usr/bin/env python3
"""Render index.html for Master Video Styles from data/styles.json + data/reels.json.

Static output only: run `python3 scripts/build.py` from the project root after
editing the data files. The deployed site needs no build step — index.html is
plain static HTML/CSS/JS.
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = json.loads((ROOT / "data" / "styles.json").read_text())
REELS = json.loads((ROOT / "data" / "reels.json").read_text())

def esc(s):
    return html.escape(str(s or ""), quote=True)

def esc_text(s):
    return html.escape(str(s or ""))

CSS = """
:root{--bg:#0c0c12;--panel:#15151d;--panel2:#1b1b26;--line:#262633;--text:#f5f2ea;--muted:#a7a7b8;--faint:#7c7c8f;--pink:#ff5da2;--amber:#ffb020;--violet:#8b7cff;--cyan:#22d3ee;--green:#34d399;--orange:#f97316;--yellow:#facc15;--red:#ff6b6b}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1020px;margin:0 auto;padding:0 20px}
header{padding:28px 0 8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.logo{font-weight:800;font-size:19px;letter-spacing:-.02em}
.logo span{color:var(--pink)}
nav a{color:var(--muted);text-decoration:none;font-size:14px;margin-left:20px}
nav a:hover{color:var(--text)}
.hero{padding:56px 0 40px}
.hero h1{font-size:clamp(38px,7vw,64px);line-height:1.05;letter-spacing:-.03em;font-weight:800}
.hero h1 em{font-style:normal;color:var(--pink)}
.hero p{font-size:19px;color:var(--muted);max-width:640px;margin-top:18px}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-top:28px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:8px 16px;font-size:14px;color:var(--muted)}
.stat b{color:var(--text);font-size:16px}
.search{margin:8px 0 0}
.search input{width:100%;max-width:520px;background:var(--panel);border:1px solid var(--line);border-radius:999px;color:var(--text);font-size:15px;padding:12px 18px;outline:none}
.search input:focus{border-color:var(--pink)}
section{padding:44px 0}
h2{font-size:30px;letter-spacing:-.02em;line-height:1.15;margin-bottom:8px}
.sub{color:var(--muted);font-size:17px;max-width:680px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:820px){.grid{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px;position:relative;overflow:hidden;display:flex;flex-direction:column}
.card::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--accent,var(--pink))}
.card .num{font-size:13px;color:var(--faint);font-weight:700}
.card h3{font-size:19px;margin:6px 0 4px}
.card h3 a{text-decoration:none}
.card h3 a:hover{color:var(--accent,var(--pink))}
.card .who{color:var(--muted);font-size:13.5px}
.card p{font-size:14.5px;color:var(--muted);margin-top:10px;flex:1}
.card .go{margin-top:14px;font-size:14px;font-weight:700;color:var(--accent,var(--pink));text-decoration:none}
.tag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent,var(--pink));background:color-mix(in srgb,var(--accent,var(--pink)) 12%,transparent);padding:5px 10px;border-radius:999px}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:28px;margin-bottom:18px;position:relative;overflow:hidden}
.detail::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--accent,var(--pink))}
.detail h3{font-size:24px;letter-spacing:-.01em;margin:10px 0 4px}
.detail .who{color:var(--muted);font-size:14px}
.detail p{color:#d6d3dc;font-size:15.5px;margin-top:12px}
.detail p b{color:var(--text)}
.detail ul{margin:14px 0 0 18px;color:#d6d3dc;font-size:15px}
.detail li{margin-bottom:6px}
.detail li b{color:var(--text)}
.steps{counter-reset:step;display:grid;gap:12px;margin-top:16px}
.step{display:flex;gap:16px;background:var(--panel2);border:1px solid var(--line);border-radius:16px;padding:18px 20px}
.step .n{flex:0 0 34px;height:34px;border-radius:50%;background:var(--accent,var(--pink));color:#111;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
.step h4{font-size:16.5px}
.step p{font-size:14.5px;color:var(--muted);margin-top:2px}
.step .days{font-size:12.5px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.chip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:13.5px;color:#d6d3dc}
.reel-link{display:inline-block;margin-top:18px;font-size:14.5px;font-weight:700;color:var(--accent,var(--pink));text-decoration:none;border:1px solid color-mix(in srgb,var(--accent,var(--pink)) 45%,transparent);padding:9px 16px;border-radius:999px}
.reel-link:hover{background:color-mix(in srgb,var(--accent,var(--pink)) 12%,transparent)}
.prompt-box{background:#0a0a0f;border:1px solid var(--line);border-radius:16px;padding:20px;margin-top:20px}
.prompt-box pre{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#cfcbd8;line-height:1.55;margin-top:8px}
button.copy{background:var(--pink);color:#111;border:none;font-weight:800;font-size:14px;padding:10px 20px;border-radius:999px;cursor:pointer;margin-top:12px}
button.copy:hover{opacity:.9}
.moves{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:640px){.moves{grid-template-columns:1fr}}
.move{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.move b{font-size:15.5px}
.move p{font-size:14px;color:var(--muted);margin-top:4px}
.move .src{font-size:12.5px;color:var(--faint);margin-top:6px}
.move .src a{color:var(--cyan);text-decoration:none}
.tools-list{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:640px){.tools-list{grid-template-columns:1fr}}
.tool{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.tool b{font-size:15.5px}
.tool .price{float:right;font-size:12.5px;color:var(--faint);font-weight:600}
.tool p{font-size:14px;color:var(--muted);margin-top:4px}
.tool a{font-size:13.5px;color:var(--cyan);text-decoration:none}
.howto{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:720px){.howto{grid-template-columns:1fr}}
.how{background:var(--panel2);border:1px solid var(--line);border-radius:18px;padding:22px}
.how .big{font-size:30px;font-weight:800;color:var(--pink)}
.how h4{font-size:17px;margin:6px 0 4px}
.how p{font-size:14.5px;color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--panel);border-radius:16px;overflow:hidden;font-size:15px}
th,td{padding:14px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--panel2);font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
tr:last-child td{border-bottom:none}
td:first-child{color:var(--muted);font-weight:600;white-space:nowrap}
footer{padding:36px 0 60px;color:var(--faint);font-size:14px;border-top:1px solid var(--line);margin-top:20px}
footer a{color:var(--muted)}
.note{background:var(--panel);border:1px dashed var(--line);border-radius:16px;padding:20px;color:var(--muted);font-size:15px}
"""

def card(s):
    who = esc_text(s.get("creator") or s.get("creator_role") or "")
    handle = esc_text(s.get("creator_handle") or "")
    who_line = f"{who} {handle}".strip()
    return f"""<article class="card" style="--accent:{esc(s['accent'])}" data-search="{esc((s['title'] + ' ' + s.get('tag','') + ' ' + who_line + ' ' + s.get('look','')).lower())}">
      <span class="num">Style {s['number']}</span>
      <span class="tag">{esc_text(s.get('tag',''))}</span>
      <h3><a href="#style-{esc(s['slug'])}">{esc_text(s['title'])}</a></h3>
      <div class="who">{esc_text(who_line)}</div>
      <p>{esc_text(s.get('look',''))}</p>
      <a class="go" href="#style-{esc(s['slug'])}">Read the playbook →</a>
    </article>"""

def detail(s):
    who = esc_text(s.get("creator") or s.get("creator_role") or "")
    handle = esc_text(s.get("creator_handle") or "")
    who_line = f"{who} {handle}".strip()
    if s.get("creator_role") and s.get("creator"):
        who_line = f"{who} · {esc_text(s['creator_role'])}"
    parts = [f'<article class="detail" id="style-{esc(s["slug"])}" style="--accent:{esc(s["accent"])}">']
    parts.append(f'<span class="tag">{esc_text(s.get("tag",""))}</span>')
    parts.append(f'<h3>Style {s["number"]} — {esc_text(s["title"])}</h3>')
    if who_line:
        parts.append(f'<div class="who">{who_line}</div>')
    if s.get("look"):
        parts.append(f'<p><b>What it looks like:</b> {esc_text(s["look"])}</p>')
    if s.get("best_for"):
        parts.append(f'<p><b>Best for:</b> {esc_text(s["best_for"])}</p>')
    if s.get("rules"):
        parts.append('<ul>' + ''.join(f'<li>{esc_text(r)}</li>' for r in s["rules"]) + '</ul>')
    if s.get("steps"):
        parts.append('<div class="steps">')
        for i, st in enumerate(s["steps"], 1):
            days = f'<span class="days">{esc_text(st["days"])}</span>' if st.get("days") else ''
            tools = f'<p>Tools: {esc_text(", ".join(st["tools"]))}</p>' if st.get("tools") else ''
            parts.append(f'<div class="step" style="--accent:{esc(s["accent"])}"><div class="n">{i}</div><div>{days}<h4>{esc_text(st["title"])}</h4><p>{esc_text(st["detail"])}</p>{tools}</div></div>')
        parts.append('</div>')
    if s.get("tools"):
        parts.append('<div class="chips">' + ''.join(f'<span class="chip">{esc_text(t)}</span>' for t in s["tools"]) + '</div>')
    if s.get("reference_reel_note"):
        parts.append(f'<p style="font-size:14px;color:var(--muted)">{esc_text(s["reference_reel_note"])}</p>')
    if s.get("reference_reel_url"):
        label = "Watch the example reel →" if "instagram" in s["reference_reel_url"] else "Source →"
        parts.append(f'<a class="reel-link" href="{esc(s["reference_reel_url"])}" target="_blank" rel="noopener">{label}</a>')
    if s.get("prompt"):
        parts.append(f'''<div class="prompt-box"><h4 style="font-size:17px">Copy-paste prompt</h4>
<pre id="prompt-{esc(s["slug"])}">{esc_text(s["prompt"])}</pre>
<button class="copy" data-target="prompt-{esc(s["slug"])}">Copy the prompt</button></div>''')
    parts.append('</article>')
    return '\n'.join(parts)

def move_card(m):
    return f'''<div class="move"><b>{esc_text(m["name"])}</b><p>{esc_text(m["demo"])}</p><div class="src">From: <a href="#style-{esc(m["source_style"])}">{esc_text(m["source_style"])}</a></div></div>'''

def tool_card(t):
    link = f'<a href="{esc(t["link"])}" target="_blank" rel="noopener">Link →</a>' if t.get("link") else ''
    return f'''<div class="tool"><b>{esc_text(t["name"])}</b><span class="price">{esc_text(t.get("price",""))}</span><p>{esc_text(t["notes"])}</p>{link}</div>'''

def reel_row(r):
    tags = ' '.join(f'<span class="chip">{esc_text(t)}</span>' for t in r.get("style_tags", []))
    return (f'<tr><td><a href="{esc(r["url"])}" target="_blank" rel="noopener">{esc_text(r["id"])}</a></td>'
            f'<td>{esc_text(r.get("creator", ""))}</td><td>{tags}</td><td>{esc_text(r.get("notes", ""))}</td></tr>')

def main():
    styles = STYLES["styles"]
    moves = STYLES["motion_dictionary"]
    tools = STYLES["tools"]
    reels = REELS.get("reels", [])
    n_reels = len(reels)

    cards = '\n'.join(card(s) for s in styles)
    details = '\n'.join(detail(s) for s in styles)
    moves_html = '\n'.join(move_card(m) for m in moves)
    tools_html = '\n'.join(tool_card(t) for t in tools)
    fields_rows = ''.join(
        f'<tr><td>{esc(f)}</td><td>{esc_text(REELS["field_notes"].get(f, ""))}</td></tr>'
        for f in REELS["fields"])
    reel_rows = '\n'.join(reel_row(r) for r in reels)

    doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Master Video Styles — every video style, mastered</title>
<meta name="description" content="Video editing styles as reusable playbooks: what each style looks like, when to use it, and the step-by-step instructions to make one.">
<style>{CSS}</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="logo">Master Video <span>Styles</span></div>
  <nav>
    <a href="#styles">Styles</a>
    <a href="#moves">Moves</a>
    <a href="#tools">Tools</a>
    <a href="#use">Use it</a>
    <a href="#reels">Reels</a>
  </nav>
</header>

<div class="hero">
  <h1>Every video style,<br><em>mastered.</em></h1>
  <p>{esc_text(STYLES["site"]["tagline"])} Each style is a playbook: what it looks like, when to use it, and the steps to make one — with a copy-paste prompt for Claude.</p>
  <div class="stats">
    <div class="stat"><b>{len(styles)}</b> styles explained</div>
    <div class="stat"><b>{len(moves)}</b> motion moves</div>
    <div class="stat"><b>{len(tools)}</b> tools</div>
    <div class="stat"><b>{n_reels}</b> reels catalogued · 1,000+ coming</div>
  </div>
  <div class="search"><input id="filter" type="text" placeholder="Search styles — try “real estate”, “captions”, “drone”…"></div>
</div>

<section id="styles">
  <h2>Every style</h2>
  <p class="sub">Start with the mastered ones at the top. The library categories at the bottom are ready to study the same way — send a reel and it gets a playbook here.</p>
  <div class="grid" id="cards">
{cards}
  </div>
</section>

<section id="details">
  <h2>The playbooks</h2>
  <p class="sub">The full instructions for each style. Copy the prompt, paste it into Claude with your raw footage.</p>
{details}
</section>

<section id="moves">
  <h2>Motion dictionary</h2>
  <p class="sub">The individual moves that make the styles work. Steal one move at a time — you don't need the whole style.</p>
  <div class="moves">
{moves_html}
  </div>
</section>

<section id="tools">
  <h2>The tools, grouped by what they do</h2>
  <p class="sub">You don't need all of these. Each style needs one or two. Pick the style first, then the tool.</p>
  <div class="tools-list">
{tools_html}
  </div>
</section>

<section id="use">
  <h2>Use it yourself</h2>
  <p class="sub">Three steps. That's the whole workflow.</p>
  <div class="howto">
    <div class="how"><div class="big">1</div><h4>Pick a style</h4><p>Explainer? Sumit. Tips list? Kelsie. Selling a home? Kelsie tour or the Melissa vision pitch. Product launch? MotionSmith SaaS Launch.</p></div>
    <div class="how"><div class="big">2</div><h4>Post your raw footage</h4><p>Send the video file and say the style name — “Sumit style” or “Kelsie style” — plus the platform (Reels / TikTok / Shorts).</p></div>
    <div class="how"><div class="big">3</div><h4>Get the video back</h4><p>Claude storyboards it first, builds it in After Effects (or MotionSmith), and hands back the finished 9:16 video.</p></div>
  </div>
</section>

<section id="reels">
  <h2>Reel catalog</h2>
  <p class="sub">The harvested reels live here. Each one is studied and tagged with the styles it demonstrates, so you can see every style in the wild.</p>
  <div class="note"><b>{n_reels} reels catalogued so far.</b> {esc_text(REELS.get("harvest_plan", ""))}</div>
  <div style="height:18px"></div>
  <div class="search"><input id="reel-filter" type="text" placeholder="Search reels — try a creator, a style, or a word…"></div>
  <div style="height:14px"></div>
  <table id="reel-table">
    <tr><th>Reel</th><th>Creator</th><th>Style tags</th><th>What it shows</th></tr>
{reel_rows}
  </table>
  <div style="height:18px"></div>
  <table>
    <tr><th>Field</th><th>What it holds</th></tr>
{fields_rows}
  </table>
</section>

<footer>
  Master Video Styles — built from the video style library. Data lives in <code>data/styles.json</code> and <code>data/reels.json</code>; this page is generated by <code>scripts/build.py</code>.<br>
  Sumit reel: <a href="https://www.instagram.com/reel/DfRAkn4xIZy/" target="_blank" rel="noopener">instagram.com/reel/DfRAkn4xIZy</a> ·
  Kelsie reel: <a href="https://www.instagram.com/reel/DewTzCzxR9q/" target="_blank" rel="noopener">instagram.com/reel/DewTzCzxR9q</a> ·
  Wilmore tour: <a href="https://www.instagram.com/reel/DfzaFE1xv02/" target="_blank" rel="noopener">instagram.com/reel/DfzaFE1xv02</a> ·
  Melissa pitch: <a href="https://www.instagram.com/reel/DfkBM9XuE_L/" target="_blank" rel="noopener">instagram.com/reel/DfkBM9XuE_L</a><br>
  Updated Nov 17, 2026.
</footer>

</div>
<script>
document.getElementById('filter').addEventListener('input', function(e){{
  var q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#cards .card').forEach(function(c){{
    c.style.display = (!q || c.dataset.search.indexOf(q) !== -1) ? '' : 'none';
  }});
}});
var rf = document.getElementById('reel-filter');
if (rf) rf.addEventListener('input', function(e){{
  var q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#reel-table tr').forEach(function(row, i){{
    if (i === 0) return;
    row.style.display = (!q || row.textContent.toLowerCase().indexOf(q) !== -1) ? '' : 'none';
  }});
}});
document.querySelectorAll('button.copy').forEach(function(b){{
  b.addEventListener('click', function(){{
    var t = document.getElementById(b.dataset.target).innerText;
    navigator.clipboard.writeText(t).then(function(){{
      b.textContent = 'Copied ✓';
      setTimeout(function(){{ b.textContent = 'Copy the prompt'; }}, 2000);
    }});
  }});
}});
</script>
</body>
</html>
"""
    out = ROOT / "index.html"
    out.write_text(doc)
    print(f"Wrote {out} ({len(doc)} bytes)")
    print(f"Styles: {len(styles)}, moves: {len(moves)}, tools: {len(tools)}, reels: {n_reels}")

if __name__ == "__main__":
    main()
