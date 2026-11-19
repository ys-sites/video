#!/usr/bin/env python3
"""Render the Master Video Styles site from the data files.

Pages: index.html (home), styles.html (styles, playbooks, moves, tools),
skills.html (skill stack) and reels.html (reel catalog). The AI Editor lives in
editor/ and is built from the Vite app with `npm run build:live`.

Run `python scripts/build.py` from master-video-styles/ after editing
data/styles.json, data/reels.json or data/skills.json. The deployed site needs
no build step: every page is plain static HTML/CSS/JS.

The home page follows the section order of opus.pro/ai-video-editor (studied
with the REA MCP, see docs/ai-editor-research.md); all copy is our own.
"""
import html
import re
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = json.loads((ROOT / "data" / "styles.json").read_text(encoding="utf-8"))
REELS = json.loads((ROOT / "data" / "reels.json").read_text(encoding="utf-8"))
SKILLS = json.loads((ROOT / "data" / "skills.json").read_text(encoding="utf-8"))
UPDATED = "Nov 19, 2026"

# The site shows free tools only (user rule: nothing paid on the website).
PAID_STYLES = {"motionsmith-saas-launch", "motionsmith-vox", "invideo-paper-cutout", "ae-claude-mcp"}
PAID_WORDS = ("after effects", "premiere", "audition", "photoshop", "media encoder", "motionsmith", "higgsfield",
              "runway", "kling", "luma", "seedance", "invideo", "elevenlabs", "autoedit", "treg", "ae gpt", "subscription", "paid")


def is_paid(text):
    t = str(text).lower()
    return any(w in t for w in PAID_WORDS)


FREE_SWAPS = [
    (r"AI video generator \(Runway, Kling, Higgsfield, Luma\)", "ComfyUI (LTX-Video / Wan)"),
    (r"Runway[- ]style generators", "ComfyUI (LTX-Video / Wan)"),
    (r"Claude Code \+ After Effects", "Claude Code + Remotion"),
    (r"After Effects", "Remotion"), (r"Premiere Pro|Premiere", "DaVinci Resolve"), (r"Media Encoder", "ffmpeg"),
    (r"Audition", "Audacity"), (r"Photoshop", "GIMP"), (r"ElevenLabs", "OmniVoice"),
    (r"Higgsfield|Kling|Seedance|Runway|Luma", "ComfyUI"),
]


def swap(v):
    if isinstance(v, str):
        for a, b in FREE_SWAPS:
            v = re.sub(a, b, v)
        return v
    if isinstance(v, list):
        return [swap(x) for x in v]
    if isinstance(v, dict):
        return {k: swap(x) for k, x in v.items()}
    return v


def free_only(styles, tools):
    styles = [swap(dict(st, tools=[t for t in st.get("tools", []) if not is_paid(t)])) for st in styles if st["slug"] not in PAID_STYLES]
    for st in styles:
        st["tools"] = list(dict.fromkeys(st["tools"]))
    tools = [t for t in tools if str(t.get("price", "")).lower().startswith("free") and not is_paid(t.get("notes", ""))]
    for g in SKILLS["groups"]:
        g["skills"] = [k for k in g["skills"] if k["cost"] != "paid"]
    return styles, tools


def esc(s):
    return html.escape(str(s or ""), quote=True)


def esc_text(s):
    return html.escape(str(s or ""))


CSS = """
:root{--bg:#09090b;--panel:#171718;--panel2:#1f1f22;--line:#27272a;--text:#fafafa;--muted:#a1a1aa;--faint:#8b8b94;--brand:#c5f04a;--pink:#ff5da2;--amber:#ffb020;--violet:#8b7cff;--cyan:#22d3ee;--green:#34d399;--orange:#f97316;--yellow:#facc15;--red:#ff6b6b;--radius:20px}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:Geist,"Geist Fallback",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-wrap:break-word}
img,video{max-width:100%;display:block}
a{color:inherit}
:focus-visible{outline:3px solid var(--brand);outline-offset:3px;border-radius:6px}
.wrap{width:100%;max-width:1200px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right))}
.announce{display:block;text-align:center;font-size:14px;font-weight:600;padding:12px 16px;text-decoration:none;background:linear-gradient(90deg,#1a1708,#26210a 50%,#1a1708);border-bottom:1px solid #3a3210}
.announce span{color:var(--brand)}
header.top{position:sticky;top:0;z-index:20;background:rgba(11,11,12,.86);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #18181b}
header.top .wrap{display:flex;align-items:center;gap:20px;min-height:68px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;letter-spacing:-.02em;text-decoration:none;white-space:nowrap}
.logo i{width:30px;height:30px;border-radius:9px;background:var(--brand);color:#111;display:grid;place-items:center;font-style:normal;font-size:15px}
.menu{display:flex;gap:4px;margin:0 auto}
.menu a{color:var(--muted);text-decoration:none;font-size:15px;font-weight:600;padding:8px 12px;border-radius:10px;white-space:nowrap}
.menu a:hover,.menu a[aria-current]{color:var(--text);background:#18181b}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-weight:700;font-size:15px;padding:12px 22px;border-radius:999px;text-decoration:none;border:1px solid transparent;white-space:nowrap;cursor:pointer;font-family:inherit}
.btn.light{background:#fff;color:#111}
.btn.light:hover{background:#e4e4e7}
.btn.brand{background:var(--brand);color:#111}
.btn.ghost{border-color:var(--line);color:var(--text);background:transparent}
.btn.ghost:hover{background:#18181b}
.btn.sm{padding:9px 16px;font-size:14px}
.hero{text-align:center;padding:88px 0 40px;position:relative}
.hero::before{content:"";position:absolute;inset:-60px 0 auto;height:420px;background:radial-gradient(ellipse at 50% 0,rgba(250,204,21,.13),transparent 65%);pointer-events:none}
.eyebrow{font-size:15px;font-weight:500;color:var(--muted)}
.hero h1{font-size:clamp(40px,7.4vw,84px);line-height:1.02;letter-spacing:-.045em;font-weight:800;margin:18px auto 0;max-width:900px}
.hero h1 em{font-style:normal;color:var(--brand)}
.hero .lede{font-size:clamp(17px,2vw,20px);color:var(--muted);max-width:640px;margin:20px auto 0}
.paths{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:52px;text-align:center}
.path{background:var(--panel);border:1px solid #202024;border-radius:var(--radius);padding:36px 28px;display:flex;flex-direction:column;align-items:center;gap:14px;text-decoration:none;transition:border-color .2s,transform .2s}
.path:hover{border-color:#3f3f46;transform:translateY(-2px)}
.path .kicker{font-size:14px;font-weight:500;color:var(--faint)}
.path h2{font-size:clamp(21px,2.4vw,26px);line-height:1.2;letter-spacing:-.02em;max-width:360px}
.path .btn{margin-top:8px}
.mini{width:100%;max-width:300px;height:96px;border-radius:14px;background:#0f0f11;border:1px solid var(--line);position:relative;overflow:hidden}
.mini .tr{position:absolute;left:12px;right:12px;height:10px;border-radius:4px}
.mini .tr b{position:absolute;top:0;bottom:0;border-radius:4px}
.mini .ph{position:absolute;top:8px;bottom:8px;width:2px;background:var(--brand);left:58%;animation:scan 4s linear infinite}
@keyframes scan{from{left:8%}to{left:92%}}
.chipwall{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;max-width:320px;min-height:96px;align-content:center}
.chipwall span{font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c)}
section{padding:72px 0}
.center{text-align:center}
h2.big{font-size:clamp(30px,4.4vw,48px);letter-spacing:-.035em;line-height:1.08;font-weight:800}
.sub{color:var(--muted);font-size:clamp(16px,1.7vw,18px);max-width:700px;margin-top:14px}
.center .sub{margin-left:auto;margin-right:auto}
.numbers{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:32px}
.numbers div{background:var(--panel);border:1px solid #202024;border-radius:16px;padding:20px 12px;text-align:center}
.numbers b{display:block;font-size:clamp(26px,3vw,34px);letter-spacing:-.03em}
.numbers span{font-size:13px;color:var(--muted)}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:40px}
.shot{background:var(--panel);border:1px solid #202024;border-radius:var(--radius);padding:28px 28px 0;display:flex;flex-direction:column;overflow:hidden}
.shot .kicker{font-size:13px;font-weight:700;color:var(--faint)}
.shot h3{font-size:clamp(22px,2.4vw,28px);letter-spacing:-.02em;margin-top:6px}
.shot p{color:var(--muted);margin-top:10px;font-size:15.5px}
.shot img{margin-top:24px;border-radius:14px 14px 0 0;border:1px solid var(--line);border-bottom:0;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;object-position:top left}
.explainer{display:grid;grid-template-columns:300px 1fr;gap:40px;align-items:center;background:var(--panel);border:1px solid #202024;border-radius:24px;padding:32px;margin-top:36px;text-align:left}
.ex-video video{width:100%;aspect-ratio:9/16;border-radius:22px;background:#000;border:1px solid var(--line)}
.ex-meta{font-size:12.5px;color:var(--faint);text-align:center;margin-top:8px}
.ex-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
.ex-stat{background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:12px 14px}
.ex-stat b{display:block;font-size:24px;color:var(--brand);letter-spacing:-.02em}
.ex-stat span{font-size:12.5px;color:var(--muted)}
.ex-steps{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ex-steps li{display:flex;gap:12px;background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:14px;color:var(--muted)}
.ex-steps .n{flex:0 0 26px;height:26px;border-radius:50%;background:#2e2e33;color:var(--text);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
.ex-steps li.you .n{background:var(--brand);color:#111}
.ex-steps li b{color:var(--text);display:block}
.ex-say{margin-top:16px;padding:14px 16px;border:1px dashed var(--line);border-radius:14px;font-size:14.5px;color:#d4d4d8}
.feature{display:grid;grid-template-columns:1fr 1.15fr;gap:40px;align-items:center;margin-top:56px}
.feature .label{font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--brand)}
.feature h3{font-size:clamp(24px,3vw,34px);letter-spacing:-.03em;line-height:1.12;margin-top:8px}
.tabs{display:flex;flex-direction:column;gap:8px;margin-top:22px}
.tabs button{all:unset;cursor:pointer;display:block;padding:14px 18px;border-radius:14px;border:1px solid transparent;color:var(--muted);font-weight:700;font-size:16px}
.tabs button[aria-selected=true]{background:var(--panel);border-color:#2a2a2e;color:var(--text)}
.tabs button:focus-visible{outline:3px solid var(--brand)}
.tabs button span{display:none;font-weight:400;font-size:14.5px;color:var(--muted);margin-top:6px}
.tabs button[aria-selected=true] span{display:block}
.panel{background:var(--panel);border:1px solid #202024;border-radius:var(--radius);padding:28px;min-height:300px;display:flex;flex-direction:column;justify-content:center;gap:16px}
.panel[hidden]{display:none}
.panel .huge{font-size:clamp(48px,7vw,80px);font-weight:800;letter-spacing:-.05em;line-height:1;color:var(--brand)}
.panel p{color:var(--muted)}
.panel .rows{display:grid;gap:8px}
.panel .rows div{background:#0f0f11;border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:14px;color:#d4d4d8;display:flex;justify-content:space-between;gap:12px}
.panel .rows div b{color:var(--text)}
.four{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:40px;list-style:none;text-align:left}
.four li{background:var(--panel);border:1px solid #202024;border-radius:18px;padding:24px}
.ico{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--c,var(--brand)) 15%,transparent);color:var(--c,var(--brand));font-size:22px;font-weight:800}
.four h3{font-size:18px;margin-top:16px}
.four p{color:var(--muted);font-size:14.5px;margin-top:6px}
.eight{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:40px;list-style:none;text-align:left}
.eight a{display:block;height:100%;background:var(--panel);border:1px solid #202024;border-radius:18px;padding:22px;text-decoration:none;transition:border-color .2s}
.eight a:hover{border-color:#3f3f46}
.eight h3{font-size:17px;margin-top:14px}
.eight p{color:var(--muted);font-size:14px;margin-top:4px}
.which{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:40px;text-align:left}
.which>div{background:var(--panel);border:1px solid #202024;border-radius:var(--radius);padding:30px;display:flex;flex-direction:column}
.which .kicker{font-size:12.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--brand)}
.which h3{font-size:24px;margin-top:6px}
.which>div>p{color:var(--muted);margin-top:6px}
.which ul{list-style:none;margin:18px 0 24px;display:grid;gap:10px;flex:1}
.which li{padding-left:28px;position:relative;color:#d4d4d8;font-size:15px}
.which li::before{content:"✓";position:absolute;left:0;top:0;width:20px;height:20px;border-radius:50%;background:#123524;color:var(--green);font-size:12px;font-weight:800;display:grid;place-items:center}
.which .btn{align-self:flex-start}
.agent{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:36px;text-align:left}
.agent>div{background:var(--panel);border:1px solid #202024;border-radius:var(--radius);padding:28px}
.agent h3{font-size:22px}
.agent p{color:var(--muted);margin-top:8px}
.agent pre{margin-top:16px;background:#0a0a0b;border:1px solid var(--line);border-radius:12px;padding:14px;font-size:13px;color:#d4d4d8;white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace}
.faq{max-width:820px;margin:36px auto 0;text-align:left;display:grid;gap:10px}
.faq details{background:var(--panel);border:1px solid #202024;border-radius:16px;padding:0 22px}
.faq summary{cursor:pointer;list-style:none;font-weight:700;font-size:17px;padding:20px 30px 20px 0;position:relative}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";position:absolute;right:0;top:16px;font-size:24px;color:var(--muted);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{color:var(--muted);padding-bottom:20px}
.final{text-align:center;padding:84px 24px;border-radius:28px;background:radial-gradient(ellipse at 50% 120%,rgba(250,204,21,.18),transparent 60%),var(--panel);border:1px solid #202024}
.final p{color:var(--muted);margin-top:12px;font-size:14px}
.final .btn{margin-top:26px}
footer.foot{border-top:1px solid #18181b;margin-top:72px;padding:48px 0 56px;color:var(--muted);font-size:14.5px}
.cols{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:28px}
.cols h4{color:var(--text);font-size:14px;margin-bottom:12px}
.cols a{display:block;text-decoration:none;padding:4px 0}
.cols a:hover{color:var(--text)}
.legal{margin-top:36px;font-size:13px;color:var(--faint)}
/* inner pages */
.page-head{padding:64px 0 8px}
.page-head h1{font-size:clamp(34px,5.4vw,58px);letter-spacing:-.04em;line-height:1.05;font-weight:800}
.page-head .sub{margin-top:12px}
.jump{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.search input{width:100%;max-width:520px;background:var(--panel);border:1px solid var(--line);border-radius:999px;color:var(--text);font-size:16px;padding:12px 18px;outline:none;font-family:inherit}
.search input:focus{border-color:var(--brand)}
h2.sec{font-size:clamp(26px,3.4vw,34px);letter-spacing:-.025em;line-height:1.15}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:24px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px;position:relative;overflow:hidden;display:flex;flex-direction:column}
.card::before,.detail::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--accent,var(--pink))}
.card .num{font-size:13px;color:var(--faint);font-weight:700}
.card h3{font-size:19px;margin:6px 0 4px}
.card h3 a{text-decoration:none}
.card h3 a:hover{color:var(--accent,var(--pink))}
.card .who{color:var(--muted);font-size:13.5px}
.card p{font-size:14.5px;color:var(--muted);margin-top:10px;flex:1}
.card .go{margin-top:14px;font-size:14px;font-weight:700;color:var(--accent,var(--pink));text-decoration:none}
.tag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent,var(--pink));background:color-mix(in srgb,var(--accent,var(--pink)) 12%,transparent);padding:5px 10px;border-radius:999px;align-self:flex-start}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:28px;margin-top:18px;position:relative;overflow:hidden;scroll-margin-top:90px}
.detail h3{font-size:24px;letter-spacing:-.01em;margin:10px 0 4px}
.detail .who{color:var(--muted);font-size:14px}
.detail p{color:#d4d4d8;font-size:15.5px;margin-top:12px}
.detail p b{color:var(--text)}
.detail ul{margin:14px 0 0 18px;color:#d4d4d8;font-size:15px}
.detail li{margin-bottom:6px}
.steps{display:grid;gap:12px;margin-top:16px}
.step{display:flex;gap:16px;background:var(--panel2);border:1px solid var(--line);border-radius:16px;padding:18px 20px}
.step .n{flex:0 0 34px;height:34px;border-radius:50%;background:var(--accent,var(--pink));color:#111;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
.step h4{font-size:16.5px}
.step p{font-size:14.5px;color:var(--muted);margin-top:2px}
.step .days{font-size:12.5px;color:var(--faint);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.chip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:13px;color:#d4d4d8;display:inline-block}
.reel-link{display:inline-block;margin-top:18px;font-size:14.5px;font-weight:700;color:var(--accent,var(--pink));text-decoration:none;border:1px solid color-mix(in srgb,var(--accent,var(--pink)) 45%,transparent);padding:9px 16px;border-radius:999px}
.prompt-box{background:#0a0a0b;border:1px solid var(--line);border-radius:16px;padding:20px;margin-top:20px}
.prompt-box pre{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#d4d4d8;line-height:1.55;margin-top:8px}
button.copy{background:var(--brand);color:#111;border:none;font-weight:800;font-size:14px;padding:10px 20px;border-radius:999px;cursor:pointer;margin-top:12px;font-family:inherit}
.pairs{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:24px}
.move,.tool{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.move b,.tool b{font-size:15.5px}
.move p,.tool p{font-size:14px;color:var(--muted);margin-top:4px}
.move .src{font-size:12.5px;color:var(--faint);margin-top:6px}
.move .src a,.tool a{color:var(--cyan);text-decoration:none;font-size:13.5px}
.tool .price{float:right;font-size:12.5px;color:var(--faint);font-weight:600;margin-left:8px}
.skill-group{margin-top:40px}
.skill-group h2{display:flex;align-items:center;gap:12px}
.skill-group h2::before{content:"";flex:0 0 12px;height:12px;border-radius:50%;background:var(--accent)}
.skills{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin-top:16px}
.skill{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:6px}
.skill b{font-size:15.5px}
.skill p{font-size:14px;color:var(--muted)}
.skill .where{font-size:12px;color:var(--faint);font-family:ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere;margin-top:auto;padding-top:4px}
.skill .alt{font-size:13px;color:var(--green);font-weight:600}
.badges{display:flex;gap:6px;flex-wrap:wrap}
.badge{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:var(--panel2);color:var(--muted)}
.badge.ready{background:#123524;color:var(--green)}.badge.setup{background:#352a10;color:var(--amber)}.badge.reference{background:#1f1d33;color:#c4bfff}.badge.paid{background:#3a1616;color:var(--red)}.badge.free{background:#0f2f30;color:var(--cyan)}
.note{background:var(--panel);border:1px dashed var(--line);border-radius:16px;padding:18px 20px;color:var(--muted);font-size:15px;overflow-wrap:anywhere;margin-top:20px}
.table-box{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:16px;border:1px solid var(--line);margin-top:16px}
table{width:100%;border-collapse:collapse;background:var(--panel);font-size:15px}
th,td{padding:13px 16px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--panel2);font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
tr:last-child td{border-bottom:none}
td:first-child{font-weight:600;white-space:nowrap}
td a{color:var(--cyan)}
/* Opus design system: weight 600 headings, tight tracking, borderless cards */
h1,h2,h3,.hero h1,h2.big,.path h2,.page-head h1{font-weight:600}
.hero h1{letter-spacing:-.045em}
h2.big{letter-spacing:-.04em}
.announce{background:linear-gradient(90deg,#070a12,#18213a 50%,#070a12);border-bottom:0;color:#fafafa}
.announce span{color:#fafafa;text-decoration:underline;text-underline-offset:3px}
.hero::before{display:none}
.hero h1 em{color:var(--text)}
.logo i{background:#fafafa;color:#09090b}
.path,.shot,.numbers div,.four li,.eight a,.which>div,.agent>div,.faq details,.panel,.explainer{border-color:transparent;background:var(--panel)}
.path:hover,.eight a:hover{border-color:#3f3f46}
.label{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0;text-transform:none}
.label svg{width:16px;height:16px}
.stage{position:relative;margin-top:40px;border-radius:var(--radius);overflow:hidden;background:linear-gradient(160deg,#2b3a55,#4a6283 45%,#7d93ad);padding:clamp(18px,4vw,48px) clamp(14px,5vw,72px) 0}
.stage img{border-radius:14px 14px 0 0;box-shadow:0 30px 80px rgba(0,0,0,.45);width:100%;height:auto}
.bubble{position:absolute;left:50%;bottom:clamp(16px,4vw,40px);transform:translateX(-50%);width:min(560px,86%);background:rgba(255,255,255,.18);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.28);border-radius:22px;padding:18px 64px 18px 22px;text-align:left;font-size:clamp(15px,1.7vw,20px);line-height:1.35;color:#fff}
.bubble i{position:absolute;right:14px;bottom:14px;width:36px;height:36px;border-radius:50%;background:#fff;color:#111;display:grid;place-items:center;font-style:normal;font-weight:700}
.row{display:grid;grid-template-columns:1fr 1.1fr;gap:clamp(24px,5vw,72px);align-items:center;text-align:left;margin-top:96px}
.row.boxed{background:var(--panel);border-radius:24px;padding:clamp(24px,5vw,72px)}
.row h3{font-size:clamp(26px,3vw,36px);letter-spacing:-.03em;line-height:1.12;margin-top:10px}
.row p{color:var(--muted);margin-top:12px;font-size:16px;max-width:460px}
.row img{border-radius:16px;width:100%;height:auto}
.log{background:#0f0f11;border:1px solid var(--line);border-radius:18px;padding:20px;display:grid;gap:10px}
.log .ask{justify-self:end;background:#27272a;border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:14px;max-width:85%}
.log .done{font-size:13px;color:var(--brand);font-weight:600}
.log li{list-style:none;font-size:14px;color:#d4d4d8;padding:8px 12px;border-radius:10px;background:#18181b}
.log li b{color:#fafafa}
.ctl{display:grid;grid-template-columns:1fr 1.15fr;gap:clamp(24px,5vw,72px);align-items:center;text-align:left;margin-top:96px}
.ctl h3{font-size:clamp(26px,3vw,36px);letter-spacing:-.03em;line-height:1.12;margin-top:10px;max-width:440px}
.ctl .tabs{display:block;margin-top:24px;max-width:420px}
.ctl .tabs button{display:block;width:100%;padding:14px 0;border-radius:0;border:0;border-bottom:1px solid var(--line);background:none;color:var(--faint);font-size:15px;font-weight:500}
.ctl .tabs button[aria-selected=true]{background:none;color:var(--text);border-color:#52525b}
.ctl .tabs button span{display:none}
.ctl .panel{background:none;padding:0;min-height:0;gap:18px;align-items:center}
.ctl .cap{color:var(--muted);font-size:14.5px;text-align:center;max-width:420px}
.ui{width:100%;max-width:480px;background:#111113;border:1px solid var(--line);border-radius:20px;padding:20px;display:grid;gap:10px}
.ui .t{font-size:13px;color:var(--faint);font-weight:600}
.ui .r{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#18181b;border-radius:10px;padding:10px 14px;font-size:14px;color:#e4e4e7}
.ui .r em{font-style:normal;font-size:12px;font-weight:700;color:var(--brand)}
.ui .r.on{outline:1.5px solid #fafafa}
.ui .chips{margin:0}
.ui .big{font-size:clamp(40px,6vw,64px);font-weight:700;letter-spacing:-.04em;line-height:1}
.ui .cap-demo{background:#000;border-radius:12px;aspect-ratio:16/9;display:grid;place-items:center;font-weight:800;font-size:clamp(20px,3vw,30px)}
.ui .cap-demo span{background:#000;padding:4px 10px}
.ui .cap-demo b{color:var(--brand)}
.ui img{border-radius:12px}
.four li{padding:0;overflow:hidden}
.four .vis{height:150px;background:#111113;display:grid;place-items:center;border-bottom:1px solid #1f1f22}
.four .txt{padding:20px 22px 24px}
.four h3{margin-top:0}
.aspects{display:flex;gap:10px;align-items:flex-end}
.aspects span{border:2px solid #52525b;border-radius:6px;display:grid;place-items:center;font-size:11px;color:var(--muted);font-weight:700}
.pill-demo{background:#27272a;border-radius:999px;padding:10px 16px;font-size:13px;color:#e4e4e7}
.vis .big{font-size:44px;font-weight:700;letter-spacing:-.04em}
.btn.light{background:#fafafa;color:#09090b}
.btn.brand{background:#fafafa;color:#09090b}
.final{background:var(--panel);border-color:transparent}
.ex-stat b,.ex-steps li.you .n{color:var(--brand)}
.ex-steps li.you .n{background:var(--brand);color:#111}
.tag{background:#27272a}
@media(max-width:860px){.row,.ctl{grid-template-columns:1fr;margin-top:64px}.row .vis-first{order:-1}.bubble{position:static;transform:none;width:auto;margin:16px 0 18px}.stage{padding-bottom:0}}


/* Opus-style stage: raw phone -> edited phone, typed prompt, carousel dots */
.stage.live{padding:clamp(24px,5vw,56px) clamp(14px,4vw,48px) clamp(120px,14vw,150px)}
.phones{display:flex;align-items:center;justify-content:center;gap:clamp(14px,4vw,56px)}
.phone{position:relative;width:clamp(130px,22vw,250px);aspect-ratio:9/16;border-radius:clamp(18px,2.4vw,28px);overflow:hidden;background:#0b0b0c;box-shadow:0 24px 60px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18)}
.phone .tagp{position:absolute;top:10px;left:10px;z-index:3;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:rgba(9,9,11,.72);color:#fafafa}
.phone.raw .scene{filter:saturate(.35) brightness(.85)}
.scene{position:absolute;inset:0;transition:transform 1.4s ease}
.phone.cut.go .scene{transform:scale(1.12)}
.scene{background-size:cover;background-position:center}
.sc-house{background-image:url(img/demo/house.jpg)}
.sc-room{background-image:url(img/demo/living.jpg)}
.sc-pod{background-image:url(img/demo/kitchen.jpg)}
.scene::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),transparent 30%,transparent 60%,rgba(0,0,0,.45))}
.phone.raw .scene::after{display:none}
.ov{position:absolute;left:0;right:0;z-index:2;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .4s,transform .4s;padding:0 8px}
.phone.cut.go .ov{opacity:1;transform:none}
.ov.title{top:12%;font-weight:800;letter-spacing:-.02em;font-size:clamp(14px,2vw,22px);color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.45);line-height:1.05}
.ov.title small{display:block;font-size:.55em;letter-spacing:.12em;opacity:.85;margin-bottom:4px}
.ov.cap{bottom:16%;transition-delay:.25s}
.ov.cap span{background:#09090b;color:#fafafa;font-weight:800;font-size:clamp(11px,1.4vw,15px);padding:5px 9px;border-radius:7px;display:inline-block}
.ov.cap b{color:var(--brand)}
.ov.ask{bottom:5%;transition-delay:.5s}
.ov.ask span{background:var(--brand);color:#111;font-weight:800;font-size:clamp(10px,1.2vw,13px);padding:4px 10px;border-radius:999px;display:inline-block}
.ov.num{top:30%;left:auto;right:8%;width:auto;font-weight:800;font-size:clamp(22px,3.4vw,40px);color:var(--brand);transition-delay:.15s}
.ex{display:none}
.ex.on{display:block}
.mid{display:flex;flex-direction:column;align-items:center;gap:10px;color:rgba(255,255,255,.8)}
.mid .dots{display:flex;flex-direction:column;gap:7px}
.mid .dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.35);transition:background .3s,transform .3s}
.mid .dots i.on{background:#fff;transform:scale(1.25)}
.mid small{font-size:11px;font-weight:600;writing-mode:vertical-rl;letter-spacing:.08em;opacity:.8}
.stage.live .bubble{bottom:clamp(14px,2.4vw,28px)}
.stage.live .bubble .typed2::after{content:"";display:inline-block;width:2px;height:1em;background:#fff;margin-left:2px;vertical-align:-3px;animation:blink 1s steps(1) infinite}
.stage.live .bubble i{transition:transform .2s,background .2s}
.stage.live .bubble.sent i{background:var(--brand);transform:scale(1.12)}
@media(max-width:860px){.stage.live .bubble{position:absolute;left:50%;transform:translateX(-50%);width:min(560px,92%);margin:0}}
@media(max-width:560px){.stage.live{padding-bottom:150px}.mid small{display:none}}
/* animated how-it-works demo */
.demo{display:grid;grid-template-columns:.8fr 1.2fr;gap:clamp(24px,5vw,64px);align-items:center;text-align:left}
.demo h2{font-size:clamp(34px,5vw,60px);letter-spacing:-.045em;line-height:1.02}
.demo .lede{margin:18px 0 26px;color:var(--muted);font-size:clamp(16px,1.8vw,19px);max-width:440px}
.win{background:#111113;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.win-top{display:grid;grid-template-columns:1fr 1.05fr;min-height:300px}
.win-ai{padding:16px;display:flex;flex-direction:column;gap:10px;border-right:1px solid var(--line);min-width:0}
.win-tabs{display:flex;gap:16px;font-size:12px;font-weight:600;color:var(--faint)}
.win-tabs b{color:var(--text);border-bottom:2px solid var(--text);padding-bottom:3px}
.steps-live{list-style:none;display:grid;gap:9px;flex:1;align-content:start;font-size:12.5px}
.steps-live li{opacity:0;transform:translateY(6px);transition:opacity .35s,transform .35s;color:#d4d4d8}
.steps-live li.on{opacity:1;transform:none}
.steps-live li code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:#fafafa}
.steps-live li code::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:8px;vertical-align:1px}
.steps-live li span{color:var(--muted)}
.composer{display:flex;align-items:flex-end;gap:10px;background:#18181b;border:1px solid var(--line);border-radius:14px;padding:10px 10px 10px 14px;font-size:12.5px;min-height:56px}
.composer .typed{flex:1;color:#fafafa;min-height:34px}
.composer .typed::after{content:"";display:inline-block;width:1.5px;height:13px;background:var(--brand);margin-left:2px;vertical-align:-2px;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.composer i{flex:0 0 28px;height:28px;border-radius:50%;background:var(--brand);color:#111;display:grid;place-items:center;font-style:normal;font-weight:800;font-size:13px}
.win-view{position:relative;overflow:hidden;background:#18181b;min-height:260px}
.house{position:absolute;inset:0;background:url(img/demo/kitchen-square.jpg) center/cover;transform:scale(var(--zoom,1));transition:transform 1.2s ease}
.house .roof{height:clamp(30px,6vw,56px);background:#3f3f46;clip-path:polygon(50% 0,100% 100%,0 100%);margin:0 -8%}
.house .body{height:clamp(54px,10vw,92px);background:#f4f1ea;border-radius:2px;display:grid;grid-template-columns:repeat(3,1fr);gap:8%;padding:10% 10% 0}
.house .body span{background:#7fb0d6;border-radius:2px;height:55%}
.house .body span:nth-child(2){background:#5b4636;height:100%;border-radius:2px 2px 0 0}
.view-cap{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);background:#09090b;color:#fafafa;font-weight:800;font-size:clamp(13px,1.6vw,17px);padding:6px 12px;border-radius:8px;white-space:nowrap;transition:opacity .25s}
.view-cap b{color:var(--brand)}
.view-title{position:absolute;top:10%;left:0;right:0;text-align:center;font-weight:800;letter-spacing:-.02em;font-size:clamp(20px,3vw,30px);color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.35);opacity:0;transition:opacity .3s}
.view-title.on{opacity:1}
.view-tag{position:absolute;top:10px;left:10px;font-size:10.5px;font-weight:700;background:rgba(9,9,11,.7);color:#fafafa;padding:3px 8px;border-radius:999px}
.win-tl{border-top:1px solid var(--line);padding:10px 14px 14px;position:relative}
.ruler{display:flex;justify-content:space-between;font-size:10.5px;color:var(--faint);margin-left:34px;padding-bottom:6px}
.lane{display:flex;align-items:center;gap:10px;height:30px;margin-top:5px}
.lane>em{flex:0 0 24px;font-style:normal;font-size:10.5px;font-weight:700;color:var(--faint)}
.lane>div{position:relative;flex:1;height:100%;border:1px dashed #27272a;border-radius:6px}
.clip{position:absolute;top:2px;bottom:2px;border-radius:5px;font-size:10px;font-weight:700;padding:0 6px;display:flex;align-items:center;overflow:hidden;white-space:nowrap;color:#09090b;opacity:0;transform:scaleX(.6);transform-origin:left;transition:opacity .35s,transform .35s}
.clip.on{opacity:1;transform:none}
.clip.v{background:linear-gradient(90deg,#4b5563,#6b7280);color:#fafafa}
.clip.c{background:#e4e4e7}
.clip.m{background:var(--brand)}
.clip.a{background:repeating-linear-gradient(90deg,#a78bfa 0 2px,transparent 2px 5px),#2e2645;color:#e9e5ff}
.playhead{position:absolute;top:28px;bottom:12px;width:2px;background:var(--orange);left:calc(48px + (100% - 62px) * var(--t,0));pointer-events:none}
.playhead::before{content:"";position:absolute;top:-5px;left:-4px;width:10px;height:10px;border-radius:2px;background:var(--orange)}
.demo-note{font-size:12.5px;color:var(--faint);margin-top:12px;text-align:center}
@media(max-width:960px){.demo{grid-template-columns:1fr}.demo .lede{max-width:none}}
@media(max-width:560px){.win-top{grid-template-columns:1fr}.win-ai{border-right:0;border-bottom:1px solid var(--line)}.win-view{min-height:220px}}

.proof{margin-top:28px;color:var(--faint);font-size:14px}
.three{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:36px;text-align:left}
.three li{background:var(--panel);border-radius:20px;padding:26px}
.three span{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#fafafa;color:#09090b;font-weight:700}
.three h3{font-size:19px;margin-top:16px}
.three p{color:var(--muted);margin-top:6px;font-size:15px}
@media(max-width:760px){.three{grid-template-columns:1fr}}

.showcase{margin:44px auto 0;max-width:1080px;position:relative}
.showcase img{width:100%;height:auto;border-radius:24px;box-shadow:0 40px 100px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.08)}
figcaption{position:absolute;right:14px;bottom:12px;font-size:11px;color:rgba(255,255,255,.75);background:rgba(9,9,11,.55);padding:3px 8px;border-radius:999px}
.steps-wrap{display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr);gap:28px;align-items:center;margin-top:36px;text-align:left}
.steps-wrap .tall{position:relative;margin:0}
.steps-wrap .tall img{width:100%;height:auto;max-height:620px;object-fit:cover;border-radius:24px}
.steps-wrap .three{grid-template-columns:1fr;margin-top:0}
@media(max-width:760px){.steps-wrap{grid-template-columns:1fr}.steps-wrap .tall img{max-height:420px}}

/* unslop pass (github.com/heydamir/unslop, CC BY 4.0, Damir Sokolovsky): one neutral ramp, one accent,
   sentence-case labels, no colour stripes, glows or idle loops. */
.tag,.which .kicker,.step .days,.badge,th,.shot .kicker,.eyebrow,.kicker{text-transform:none;letter-spacing:0}
.tag{background:#1f1f22;color:var(--muted);border-radius:6px;font-weight:500;font-size:12.5px;padding:4px 9px}
.card::before,.detail::before{display:none}
.card .go,.reel-link,.card h3 a:hover{color:var(--text)}
.reel-link{border-color:var(--line)}
.reel-link:hover{background:#1f1f22}
.step .n{background:#fafafa;color:#09090b}
.chipwall span{background:#1f1f22;color:#d4d4d8;font-weight:500;border-radius:8px}
.ico{background:#1f1f22;color:#d4d4d8}
.mini .ph{animation:none;left:58%}
.announce{background:var(--panel);border-bottom:1px solid #1f1f22;font-weight:500;color:var(--muted)}
.announce span{color:var(--text);text-decoration:none}
.logo{font-weight:600;gap:10px}
.logo svg{flex:0 0 auto;display:block}
.btn,button.copy{font-weight:600}
button.copy{background:#fafafa;color:#09090b}
.search input{border-radius:12px}
.search input:focus{border-color:#52525b}
.badge{border-radius:6px;font-weight:600}
.which li::before{background:#1f1f22;color:var(--text)}
.ex-stat b{color:var(--text)}
.composer i{background:#fafafa}
.skill-group h2::before{background:#52525b}
.move .src a,.tool a,td a{color:#d4d4d8;text-decoration:underline;text-underline-offset:3px;text-decoration-color:#52525b}
.detail p,.detail ul{color:#d4d4d8}
/* responsive: tablets, phones, landscape phones, ultrawide */
@media(min-width:1700px){.wrap{max-width:1320px}}
@media(max-width:1024px){
  .numbers{grid-template-columns:repeat(3,1fr)}
  .four,.eight{grid-template-columns:1fr 1fr}
  .feature{grid-template-columns:1fr;gap:24px}
  .cols{grid-template-columns:1fr 1fr}
}
@media(max-width:860px){
  header.top .wrap{flex-wrap:wrap;gap:0 12px;padding-top:10px}
  .logo{flex:1}
  .menu{order:3;width:100%;margin:6px 0 0;overflow-x:auto;scrollbar-width:none;padding-bottom:8px}
  .menu::-webkit-scrollbar{display:none}
  .paths,.duo,.which,.agent{grid-template-columns:1fr}
  .explainer{grid-template-columns:1fr;padding:22px}
  .ex-video{max-width:300px;width:100%;margin:0 auto}
  section{padding:56px 0}
  .hero{padding:56px 0 28px}
}
@media(max-width:560px){
  .numbers{grid-template-columns:1fr 1fr}
  .numbers div:last-child{grid-column:1/-1}
  .four,.eight{grid-template-columns:1fr}
  .ex-stats{grid-template-columns:1fr 1fr}
  .ex-steps{grid-template-columns:1fr}
  .path{padding:28px 20px}
  .shot{padding:22px 20px 0}
  .which>div,.agent>div,.panel{padding:22px}
  .detail{padding:20px}
  .step{padding:14px}
  .cols{grid-template-columns:1fr 1fr}
  .final{padding:56px 20px}
  .btn{white-space:normal;text-align:center}
  #reel-table,#reel-table tbody,#reel-table tr,#reel-table td{display:block;width:100%}
  #reel-table tr:first-child{display:none}
  #reel-table tr{border-bottom:1px solid var(--line);padding:10px 0}
  #reel-table td{border:none;padding:3px 16px;white-space:normal}
  #reel-table td:first-child a{font-weight:800;color:var(--text)}
}
@media(max-width:360px){.cols{grid-template-columns:1fr}.logo{font-size:16px}}
@media(orientation:landscape) and (max-height:520px){
  header.top{position:static}
  .hero{padding:32px 0 20px}
  .explainer{grid-template-columns:190px 1fr}
  .ex-video{max-width:190px}
  .panel{min-height:0}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
"""

SCRIPT = """

(function(){
  var stage = document.getElementById('stage-demo');
  if (!stage) return;
  var exs = stage.querySelectorAll('.ex');
  var dots = stage.querySelectorAll('.dots i');
  var cut = stage.querySelector('.phone.cut');
  var bubble = stage.querySelector('.bubble');
  var typed = stage.querySelector('.typed2');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timers = [], idx = 0, live = false;
  function at(ms, fn){ timers.push(setTimeout(fn, ms)); }
  function show(i){
    exs.forEach(function(e){ e.classList.toggle('on', +e.dataset.i === i); });
    dots.forEach(function(d, k){ d.classList.toggle('on', k === i); });
  }
  function run(i){
    timers.forEach(clearTimeout); timers = [];
    idx = i; show(i);
    var text = stage.dataset['p' + i];
    cut.classList.remove('go'); bubble.classList.remove('sent'); typed.textContent = '';
    if (reduce) { typed.textContent = text; cut.classList.add('go'); return; }
    for (var n = 1; n <= text.length; n++) (function(n){ at(400 + n * 30, function(){ typed.textContent = text.slice(0, n); }); })(n);
    var t = 400 + text.length * 30 + 350;
    at(t, function(){ bubble.classList.add('sent'); });
    at(t + 450, function(){ cut.classList.add('go'); });
    at(t + 5200, function(){ if (live) run((idx + 1) % dots.length); });
  }
  dots.forEach(function(d, k){ d.addEventListener('click', function(){ run(k); }); d.style.cursor = 'pointer'; });
  if (reduce || !('IntersectionObserver' in window)) { run(0); return; }
  new IntersectionObserver(function(es){
    es.forEach(function(e){
      if (e.isIntersecting && !live) { live = true; run(idx); }
      else if (!e.isIntersecting && live) { live = false; timers.forEach(clearTimeout); }
    });
  }, {threshold: .3}).observe(stage);
})();

(function(){
  var demo = document.getElementById('demo-win');
  if (!demo) return;
  var steps = demo.querySelectorAll('.steps-live li');
  var clips = demo.querySelectorAll('.clip');
  var typed = demo.querySelector('.typed');
  var cap = demo.querySelector('.view-cap');
  var title = demo.querySelector('.view-title');
  var house = demo.querySelector('.house');
  var tl = demo.querySelector('.win-tl');
  var prompt = typed.dataset.text;
  var caps = JSON.parse(demo.dataset.caps);
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var timers = [], raf = 0, running = false;
  function at(ms, fn){ timers.push(setTimeout(fn, ms)); }
  function finalState(){
    typed.textContent = prompt;
    steps.forEach(function(s){ s.classList.add('on'); });
    clips.forEach(function(c){ c.classList.add('on'); });
    title.classList.add('on');
    cap.innerHTML = caps[caps.length - 1];
    tl.style.setProperty('--t', .62);
  }
  function play(){
    if (running) return;
    running = true;
    timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf);
    typed.textContent = '';
    steps.forEach(function(s){ s.classList.remove('on'); });
    clips.forEach(function(c){ c.classList.remove('on'); });
    title.classList.remove('on');
    house.style.setProperty('--zoom', 1);
    tl.style.setProperty('--t', 0);
    cap.innerHTML = caps[0];
    for (var i = 1; i <= prompt.length; i++) (function(n){ at(n * 32, function(){ typed.textContent = prompt.slice(0, n); }); })(i);
    var t0 = prompt.length * 32 + 300;
    steps.forEach(function(s, i){ at(t0 + i * 900, function(){ s.classList.add('on'); }); });
    var t1 = t0 + steps.length * 900;
    clips.forEach(function(c, i){ at(t1 + i * 160, function(){ c.classList.add('on'); }); });
    at(t1 + 300, function(){ title.classList.add('on'); house.style.setProperty('--zoom', 1.12); });
    var start = performance.now() + t1 + 400, len = 6500;
    (function tick(now){
      var k = Math.max(0, Math.min(1, (now - start) / len));
      tl.style.setProperty('--t', k);
      cap.innerHTML = caps[Math.min(caps.length - 1, Math.floor(k * caps.length))];
      if (k > .55) house.style.setProperty('--zoom', 1.3);
      if (k < 1) raf = requestAnimationFrame(tick);
      else at(2200, function(){ running = false; play(); });
    })(performance.now());
  }
  if (reduce || !('IntersectionObserver' in window)) { finalState(); return; }
  new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) play();
      else { running = false; timers.forEach(clearTimeout); cancelAnimationFrame(raf); }
    });
  }, {threshold: .35}).observe(demo);
})();
document.querySelectorAll('[data-filter]').forEach(function(input){
  var items = document.querySelectorAll(input.dataset.filter);
  input.addEventListener('input', function(){
    var q = input.value.trim().toLowerCase();
    items.forEach(function(el){
      var text = (el.dataset.search || el.textContent).toLowerCase();
      el.style.display = (!q || text.indexOf(q) !== -1) ? '' : 'none';
    });
  });
});
document.querySelectorAll('[role=tablist]').forEach(function(list){
  var tabs = list.querySelectorAll('[role=tab]');
  function show(tab){
    tabs.forEach(function(t){
      var on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  }
  tabs.forEach(function(t, i){
    t.addEventListener('click', function(){ show(t); });
    t.addEventListener('keydown', function(e){
      var d = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 0;
      if (d) { e.preventDefault(); var n = tabs[(i + d + tabs.length) % tabs.length]; show(n); n.focus(); }
    });
  });
});
document.querySelectorAll('button.copy').forEach(function(b){
  b.addEventListener('click', function(){
    var t = document.getElementById(b.dataset.target).innerText;
    navigator.clipboard.writeText(t).then(function(){
      b.textContent = 'Copied ✓';
      setTimeout(function(){ b.textContent = 'Copy the prompt'; }, 2000);
    }, function(){ b.textContent = 'Select the text to copy'; });
  });
});
"""

NAV = [("editor/", "AI Editor", "editor"), ("styles.html", "Styles", "styles"), ("reels.html", "Reels", "reels"), ("index.html#how", "How it works", "how")]


def shell(page, title, description, body):
    current = ' aria-current="page"'
    links = "".join(f'<a href="{href}"{current if key == page else ""}>{label}</a>' for href, label, key in NAV)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc_text(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="theme-color" content="#09090b">
<link rel="icon" href="img/logo.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<a class="announce" href="editor/">New: <span>the AI Editor</span> — edit your video by describing it. Try it free →</a>
<header class="top"><div class="wrap">
  <a class="logo" href="index.html"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#fafafa"/><rect x="6" y="8.5" width="11" height="3.5" rx="1.75" fill="#09090b"/><rect x="6" y="14.25" width="20" height="3.5" rx="1.75" fill="#09090b"/><rect x="6" y="20" width="8" height="3.5" rx="1.75" fill="#09090b"/><rect x="19.5" y="5.5" width="2.5" height="21" rx="1.25" fill="#09090b"/><rect x="17.25" y="5.5" width="7" height="2.5" rx="1.25" fill="#09090b"/></svg>Master Video Styles</a>
  <nav class="menu" aria-label="Main">{links}</nav>
  <a class="btn light sm" href="editor/">Open editor</a>
</div></header>
<main class="wrap">
{body}
</main>
<footer class="foot"><div class="wrap">
  <div class="cols">
    <div><a class="logo" href="index.html"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#fafafa"/><rect x="6" y="8.5" width="11" height="3.5" rx="1.75" fill="#09090b"/><rect x="6" y="14.25" width="20" height="3.5" rx="1.75" fill="#09090b"/><rect x="6" y="20" width="8" height="3.5" rx="1.75" fill="#09090b"/><rect x="19.5" y="5.5" width="2.5" height="21" rx="1.25" fill="#09090b"/><rect x="17.25" y="5.5" width="7" height="2.5" rx="1.25" fill="#09090b"/></svg>Master Video Styles</a><p style="margin-top:12px;max-width:300px">Every video style as a playbook, an AI editor that plans the cut, and a free-first skill stack to render it.</p></div>
    <div><h4>Studio</h4><a href="editor/">AI Editor</a><a href="index.html#how">How it works</a><a href="index.html#faq">FAQ</a></div>
    <div><h4>Library</h4><a href="styles.html">Styles and playbooks</a><a href="styles.html#moves">Motion dictionary</a><a href="styles.html#tools">Tools</a></div>
    <div><h4>Resources</h4><a href="skills.html">Skill stack</a><a href="reels.html">Reel catalog</a><a href="styles.html#details">Copy-paste prompts</a></div>
  </div>
  <p class="legal">Techniques are studied from public reels and sites; their footage, voices, text and branding are never copied. Updated {UPDATED}.</p>
</div></footer>
<script>{SCRIPT}</script>
</body>
</html>
"""


# ---------- library pieces ----------

def card(s):
    who = esc_text(s.get("creator") or s.get("creator_role") or "")
    handle = esc_text(s.get("creator_handle") or "")
    who_line = f"{who} {handle}".strip()
    search = esc((s['title'] + ' ' + s.get('tag', '') + ' ' + who_line + ' ' + s.get('look', '')).lower())
    return f"""<article class="card" style="--accent:{esc(s['accent'])}" data-search="{search}">
      <span class="num">Style {s['number']}</span>
      <span class="tag">{esc_text(s.get('tag', ''))}</span>
      <h3><a href="#style-{esc(s['slug'])}">{esc_text(s['title'])}</a></h3>
      <div class="who">{esc_text(who_line)}</div>
      <p>{esc_text(s.get('look', ''))}</p>
      <a class="go" href="#style-{esc(s['slug'])}">Read the playbook →</a>
    </article>"""


def detail(s):
    who = esc_text(s.get("creator") or s.get("creator_role") or "")
    handle = esc_text(s.get("creator_handle") or "")
    who_line = f"{who} {handle}".strip()
    if s.get("creator_role") and s.get("creator"):
        who_line = f"{who} · {esc_text(s['creator_role'])}"
    parts = [f'<article class="detail" id="style-{esc(s["slug"])}" style="--accent:{esc(s["accent"])}">']
    parts.append(f'<span class="tag">{esc_text(s.get("tag", ""))}</span>')
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
    return f'''<div class="tool"><b>{esc_text(t["name"])}</b><span class="price">{esc_text(t.get("price", ""))}</span><p>{esc_text(t["notes"])}</p>{link}</div>'''


def reel_row(r):
    tags = ' '.join(f'<span class="chip">{esc_text(t)}</span>' for t in r.get("style_tags", []))
    return (f'<tr><td><a href="{esc(r["url"])}" target="_blank" rel="noopener">{esc_text(r["id"])}</a></td>'
            f'<td>{esc_text(r.get("creator", ""))}</td><td>{tags}</td><td>{esc_text(r.get("notes", ""))}</td></tr>')


def skill_card(k):
    alt = f'<div class="alt">Free route: {esc_text(k["free_alt"])}</div>' if k.get("free_alt") else ""
    search = esc(" ".join([k["name"], k["does"], k["status"], k["cost"], k.get("free_alt", "")]).lower())
    return (f'<div class="skill" data-search="{search}"><div class="badges"><span class="badge {esc(k["status"])}">{esc_text(k["status"])}</span>'
            f'<span class="badge {esc(k["cost"])}">{esc_text(k["cost"])}</span></div><b>{esc_text(k["name"])}</b>'
            f'<p>{esc_text(k["does"])}</p>{alt}<div class="where">{esc_text(k["where"])}</div></div>')


# ---------- pages ----------

SPARK = ''
BOLT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>'
PEN = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.2V21h3.8L17.8 10 14 6.2zM20.7 7a1 1 0 000-1.4l-2.3-2.3a1 1 0 00-1.4 0L15.2 5 19 8.8z"/></svg>'


def ui(title, rows):
    body = "".join(f'<div class="r{" on" if on else ""}">{name}<em>{tag}</em></div>' for name, tag, on in rows)
    return f'<div class="ui"><div class="t">{title}</div>{body}</div>'


def home(n_styles, n_moves, n_skills, n_free):
    chips = "".join(f'<span style="--c:{c}">{t}</span>' for t, c in [
        ("Sumit", "#ff5da2"), ("Kelsie listicle", "#ffb020"), ("Fly-through", "#8b7cff"), ("Vision pitch", "#22d3ee"),
        ("Vox", "#facc15"), ("Realtor reels", "#34d399")])
    tracks = "".join(
        f'<div class="tr" style="top:{12 + i * 16}px">' + "".join(
            f'<b style="left:{l}%;width:{w}%;background:{c}"></b>' for l, w in spans) + '</div>'
        for i, (c, spans) in enumerate([
            ("#c5f04a", [(0, 14), (80, 20)]), ("#e4e4e7", [(0, 100)]),
            ("#71717a", [(0, 18), (20, 16), (38, 22), (62, 16), (80, 20)]), ("#52525b", [(0, 100)])]))
    groups = [
        ("speed", BOLT, "Speed", "Edit in minutes with chat, timeline and one-tap fixes", [
            ("Describe the edit", ui("Edit agent", [("Make it punchy", "chip", True), ("Add captions", "chip", False), ("Open on the strongest moment", "chip", False), ("Add music under my voice", "chip", False)]),
             "Type the edit in plain words or tap a quick prompt. The plan lands on six tracks, each change with a reason."),
            ("Fix it by hand", '<div class="ui"><img src="img/editor-hand.jpg" alt="Selected timeline block with rename, move and remove controls" width="1200" height="675" loading="lazy"></div>',
             "Click any block to rename, move, stretch or remove it. Undo and redo every step."),
            ("One-tap fixes", ui("Quick fixes", [("Trim fillers and pauses", "ON", True), ("Clean audio to −14 LUFS", "ON", True), ("Punch-in zooms", "ON", False), ("Background", "OFF", False)]),
             "Each fix joins the next edit and names the free local tool that does the work.")]),
        ("style", PEN, "Style", "Start from a style that already works", [
            ("Proven formats", ui("Walk-and-talk · 25 reels", [("Length", "34 s", False), ("Per shot", "2.8 s", True), ("Talking speed", "209 wpm", False), ("First word", "0.0 s", False)]),
             "Nine reel types measured from 136 real reels: real lengths, shot timing and talking speed."),
            ("Playbooks", ui(f"{n_styles} playbooks", [("What it looks like", "1", False), ("When to use it", "2", False), ("Step-by-step build", "3", True), ("Copy-paste prompt", "4", False)]),
             f"{n_styles} styles, each with what it looks like, when to use it, the steps and a prompt for Claude."),
            ("Motion moves", ui(f"{n_moves} moves", [("Punch-in on the keyword", "move", True), ("Fly-through push-in", "move", False), ("Kinetic keyword", "move", False), ("Before / after wipe", "move", False)]),
             "Borrow one move at a time without taking on a whole style.")]),
        ("ai", SPARK, "AI", "AI that runs on your own machine", [
            ("Captions", '<div class="ui"><div class="t">Word-by-word captions</div><div class="cap-demo"><span>your <b>words</b> here</span></div></div>',
             "Seven caption styles from word timings, checked on three frames before the full render."),
            ("Face-tracked effects", ui("45 effects", [("Spotlight", "face", True), ("Orbit", "face", False), ("Glass widgets", "face", False), ("iMessage pop-ups", "face", False)]),
             "Effects that follow the speaker and can sit behind them."),
            ("Free voice and music", ui(f"{n_free} of {n_skills} skills free", [("Voice: OmniVoice, Piper", "free", True), ("Transcripts: Whisper", "free", False), ("Music: code synth, MusicGen", "free", False), ("Paid services", "fallback", False)]),
             "Local voices, transcripts and code-made music. Paid services are fallbacks only.")]),
    ]
    ctl = []
    for key, icon, label, title, items in groups:
        buttons, panels = [], []
        for i, (name, visual, cap) in enumerate(items):
            pid = f"{key}-{i}"
            on = i == 0
            buttons.append(f'<button role="tab" id="t-{pid}" aria-controls="p-{pid}" aria-selected="{str(on).lower()}" tabindex="{0 if on else -1}">{name}</button>')
            panels.append(f'<div class="panel" role="tabpanel" id="p-{pid}" aria-labelledby="t-{pid}"{"" if on else " hidden"}>{visual}<p class="cap">{cap}</p></div>')
        ctl.append(f'<div class="ctl"><div><span class="label">{icon}{label}</span><h3>{title}</h3>'
                   f'<div class="tabs" role="tablist" aria-label="{label}">{"".join(buttons)}</div></div><div>{"".join(panels)}</div></div>')

    return f"""
<section class="hero">
  <p class="eyebrow">Video editor for real-estate creators</p>
  <h1>Every video style,<br>mastered</h1>
  <p class="lede">Upload your video, say what you want, and get a ready-to-post edit plan. Free, and your footage stays on your device.</p>
  <div class="paths">
    <a class="path" href="editor/">
      <div class="mini" aria-hidden="true">{tracks}<div class="ph"></div></div>
      <span class="kicker">Edit your own footage</span>
      <h2>Edit like a pro just by chatting</h2>
      <span class="btn light">Open the AI Editor</span>
    </a>
    <a class="path" href="styles.html">
      <div class="chipwall" aria-hidden="true">{chips}</div>
      <span class="kicker">Follow a proven style</span>
      <h2>{n_styles} styles, each with steps and a prompt</h2>
      <span class="btn light">Browse styles</span>
    </a>
  </div>
  <p class="proof">Built from 136 real creator reels · 17 proven styles · free to use</p>
  <figure class="showcase">
    <img src="img/creator-desk.jpg" alt="A creator editing a vertical video on a large monitor with a timeline" width="1600" height="900" fetchpriority="high">
    <figcaption>AI-generated illustration</figcaption>
  </figure>
</section>

<section class="center">
  <h2 class="big">See it in action</h2>
  <p class="sub">Type what you want. Watch a raw clip become a finished reel.</p>
  <div class="stage live" id="stage-demo" role="img"
       aria-label="Animated demo: a typed request turns a raw clip into an edited reel, cycling through a listing tour, a tips listicle and a cinematic listing film"
       data-p0="Cut this walkthrough like a Kelsie listing tour — captions, a push-in and a comment-word ask"
       data-p1="Turn this into a 3-tip listicle with keyword captions and a counter"
       data-p2="Make a cinematic film from these listing clips — fast cuts on the beat, music only, a title card">
    <div class="phones">
      <div class="phone raw">
        <span class="tagp">Raw clip</span>
        <div class="ex on" data-i="0"><div class="scene sc-house"></div></div>
        <div class="ex" data-i="1"><div class="scene sc-room"></div></div>
        <div class="ex" data-i="2"><div class="scene sc-pod"></div></div>
      </div>
      <div class="mid" aria-hidden="true"><div class="dots"><i class="on"></i><i></i><i></i></div><small>AI EDITOR</small></div>
      <div class="phone cut">
        <div class="ex on" data-i="0"><span class="tagp">Listing tour · 60 s · 1.3 s shots</span><div class="scene sc-house"></div>
          <div class="ov title"><small>JUST LISTED</small>4 bed · 3 bath</div><div class="ov cap"><span>Corner lot · <b>big yard</b></span></div><div class="ov ask"><span>Comment “TOUR”</span></div></div>
        <div class="ex" data-i="1"><span class="tagp">Listicle · 42 s · 220 wpm</span><div class="scene sc-room"></div>
          <div class="ov title"><small>3 TIPS BEFORE YOU BUY</small>Get pre-approved</div><div class="ov num">01</div><div class="ov cap"><span>Know your <b>budget</b> first</span></div><div class="ov ask"><span>Save this for later</span></div></div>
        <div class="ex" data-i="2"><span class="tagp">Cinematic film · 64 s · 1.1 s shots</span><div class="scene sc-pod"></div>
          <div class="ov title"><small>OPEN HOUSE SUNDAY</small>Chef's kitchen</div><div class="ov cap"><span>Quartz <b>island</b> · new oak floors</span></div><div class="ov ask"><span>DM for the private tour</span></div></div>
      </div>
    </div>
    <div class="bubble"><span class="typed2">Cut this walkthrough like a Kelsie listing tour — captions, a push-in and a comment-word ask</span><i>↑</i></div>
  </div>
  <p class="demo-note">Illustration of the workflow. Formats and numbers come from the 136-reel creator study; no creator footage is shown.</p>

</section>

<section>
  <div class="demo">
    <div>
      <span class="label">{SPARK}How it works</span>
      <h2 style="margin-top:12px">Edit just by describing it</h2>
      <p class="lede">Ask like you'd ask an editor — “cut it like a listing tour” — and every change lands on the timeline while you watch.</p>
      <a class="btn light" href="editor/">Open the AI Editor</a>
    </div>
    <div>
      <div class="win" id="demo-win" data-caps='["Just <b>listed</b>","4 bed · <b>3 bath</b>","Walk-in <b>pantry</b>","Sunset <b>skyline</b>","Comment <b>TOUR</b>"]' aria-label="Animated demo: a chat request becomes a listing-tour edit on the timeline" role="img">
        <div class="win-top">
          <div class="win-ai">
            <div class="win-tabs"><b>AI</b><span>Transcript</span></div>
            <ul class="steps-live">
              <li><code>read_footage</code> <span>· 6 clips · 0:58 · host + rooms</span></li>
              <li><code>match_format</code> <span>· Hosted listing tour (36 of 136 reels)</span></li>
              <li>Kelsie-style tour: neighbourhood hook, fly-through push-in, one selling point per room, aerial, seated ask.</li>
              <li><code>plan</code> <span>· 1.3 s shots → captions → “Comment TOUR”</span></li>
            </ul>
            <div class="composer"><span class="typed" data-text="Cut my listing walkthrough like a Kelsie tour, drop the dead air and caption every word"></span><i>↑</i></div>
          </div>
          <div class="win-view">
            <span class="view-tag">9:16 · 59 s</span>
            <div class="view-title">Just listed</div>
            <div class="house" aria-hidden="true"></div>
            <div class="view-cap">Just <b>listed</b></div>
          </div>
        </div>
        <div class="win-tl">
          <div class="ruler"><span>0:00</span><span>0:15</span><span>0:30</span><span>0:45</span><span>0:59</span></div>
          <div class="lane"><em>C1</em><div>
            <span class="clip c" style="left:0;width:24%">Just listed</span><span class="clip c" style="left:25%;width:24%">4 bed · 3 bath</span><span class="clip c" style="left:50%;width:24%">Walk-in pantry</span><span class="clip c" style="left:75%;width:25%">Comment TOUR</span>
          </div></div>
          <div class="lane"><em>MG</em><div>
            <span class="clip m" style="left:0;width:12%">Hook</span><span class="clip m" style="left:30%;width:14%">Push-in</span><span class="clip m" style="left:62%;width:12%">Aerial</span><span class="clip m" style="left:88%;width:12%">Ask</span>
          </div></div>
          <div class="lane"><em>V1</em><div>
            <span class="clip v" style="left:0;width:15%">Street</span><span class="clip v" style="left:16%;width:13%">Front</span><span class="clip v" style="left:30%;width:14%">Kitchen</span><span class="clip v" style="left:45%;width:15%">Living</span><span class="clip v" style="left:61%;width:13%">Aerial</span><span class="clip v" style="left:75%;width:12%">Suite</span><span class="clip v" style="left:88%;width:12%">Seated</span>
          </div></div>
          <div class="lane"><em>A1</em><div>
            <span class="clip a" style="left:0;width:100%"><span style="background:#2e2645;padding:1px 6px;border-radius:4px">Voice + music bed, ducked</span></span>
          </div></div>
          <div class="playhead" aria-hidden="true"></div>
        </div>
      </div>
      <p class="demo-note">Illustration of the workflow — the numbers come from the creator study; no creator footage is used.</p>
    </div>
  </div>
</section>

<section class="center">
  <h2 class="big">Three steps. That's it.</h2>
  <div class="steps-wrap">
  <figure class="tall"><img src="img/creator-vertical.jpg" alt="A creator at a desk editing their reel on the timeline" width="900" height="1600" loading="lazy"><figcaption>AI-generated illustration</figcaption></figure>
  <ol class="three">
    <li><span>1</span><h3>Add your video</h3><p>It stays on your device.</p></li>
    <li><span>2</span><h3>Say what you want</h3><p>“Make it punchy”, “add captions”, “cut it like a listing tour”.</p></li>
    <li><span>3</span><h3>Adjust and export</h3><p>Change anything on the timeline, then export.</p></li>
  </ol>
  </div>
  <a class="btn light" href="editor/" style="margin-top:32px">Start editing — free</a>
</section>
<section class="center" id="how">
  <h2 class="big">Why the edits work</h2>
  <p class="sub">Every style is measured from real creator reels — watch the 84-second tour.</p>
  <div class="explainer">
    <div class="ex-video">
      <video src="videos/creator-style-explainer.mp4" poster="videos/creator-style-explainer-poster.jpg" controls playsinline preload="metadata">
        Your browser can't play this video. <a href="videos/creator-style-explainer.mp4">Download it</a>.
      </video>
      <div class="ex-meta">84 s · 9:16 · made with Remotion</div>
    </div>
    <div>
      <span class="label">{SPARK}136 reels studied</span>
      <h3 style="font-size:clamp(22px,2.6vw,30px);margin-top:10px;letter-spacing:-.03em">Every creator-style edit starts from measured reels.</h3>
      <div class="ex-stats">
        <div class="ex-stat"><b>136</b><span>reels studied</span></div>
        <div class="ex-stat"><b>12</b><span>reel types</span></div>
        <div class="ex-stat"><b>1.4 s</b><span>median shot</span></div>
        <div class="ex-stat"><b>0.5 s</b><span>to the first word</span></div>
      </div>
    </div>
  </div>
</section>

<section class="center" id="faq">
  <h2 class="big">Got questions?</h2>
  <div class="faq">
    <details><summary>What is the AI Editor?</summary><p>A video editor you talk to. Describe the edit and it plans the cuts, captions, titles, music and sound on a timeline. You can change anything by hand.</p></details>
    <details><summary>Does my footage get uploaded?</summary><p>No. The clip plays in your browser only. Nothing is sent to a server.</p></details>
    <details><summary>Do I need paid tools?</summary><p>No. The editor is free to use.</p></details>
    <details><summary>Which formats does it support?</summary><p>Vertical 9:16 for Reels, TikTok and Shorts, square 1:1 and widescreen 16:9.</p></details>
  </div>
</section>

<section>
  <div class="final">
    <h2 class="big">Ready to make your next video?</h2>
    <a class="btn light" href="editor/">Open the AI Editor</a>
    <p>No account. No upload. No credit card.</p>
  </div>
</section>
"""


def styles_page(styles, moves, tools):
    cards = '\n'.join(card(s) for s in styles)
    details = '\n'.join(detail(s) for s in styles)
    return f"""
<div class="page-head">
  <p class="eyebrow">Style library</p>
  <h1>Every style, as a playbook.</h1>
  <p class="sub">What each style looks like, when to use it, the steps to make one and a copy-paste prompt for Claude.</p>
  <div class="jump"><a class="btn ghost sm" href="#details">Playbooks</a><a class="btn ghost sm" href="#moves">Motion dictionary</a><a class="btn ghost sm" href="#tools">Tools</a><a class="btn light sm" href="editor/">Edit in a style →</a></div>
</div>
<section style="padding-top:36px">
  <div class="search"><input type="text" data-filter="#cards .card" placeholder="Search styles — try “real estate”, “captions”, “drone”…" aria-label="Search styles"></div>
  <div class="grid" id="cards">
{cards}
  </div>
</section>
<section id="details">
  <h2 class="sec">The playbooks</h2>
  <p class="sub">The full instructions for each style. Copy the prompt and paste it into Claude with your raw footage.</p>
{details}
</section>
<section id="moves">
  <h2 class="sec">Motion dictionary</h2>
  <p class="sub">The individual moves that make the styles work. Borrow one at a time.</p>
  <div class="pairs">
{''.join(move_card(m) for m in moves)}
  </div>
</section>
<section id="tools">
  <h2 class="sec">The tools, grouped by what they do</h2>
  <p class="sub">Each style needs one or two. Pick the style first, then the tool. Free routes are on the <a href="skills.html" style="color:var(--brand)">skill stack</a>.</p>
  <div class="pairs">
{''.join(tool_card(t) for t in tools)}
  </div>
</section>
"""


def skills_page(n_skills, n_free):
    groups = []
    for g in SKILLS["groups"]:
        gid = "".join(c if c.isalnum() else "-" for c in g["job"].lower()).strip("-")
        while "--" in gid:
            gid = gid.replace("--", "-")
        cards = "\n".join(skill_card(k) for k in g["skills"])
        groups.append(f'<div class="skill-group" id="{gid}" style="--accent:var(--{esc(g["accent"])})"><h2 class="sec">{esc_text(g["job"])}</h2><div class="skills">{cards}</div></div>')
    return f"""
<div class="page-head">
  <p class="eyebrow">Skill stack</p>
  <h1>{n_skills} skills. {n_free} free.</h1>
  <p class="sub">Every creator-video skill in the workspace, grouped by job. Everything listed here is free.</p>
  <div class="note"><span class="badge ready">ready</span> works now · <span class="badge setup">setup</span> one setup step left · <span class="badge reference">reference</span> local copy, not yet installed or reviewed</div>
</div>
<section style="padding-top:28px">
  <div class="search"><input type="text" data-filter=".skill" placeholder="Search skills — try “voice”, “captions”, “free”…" aria-label="Search skills"></div>
{''.join(groups)}
</section>
"""


def reels_page(reels):
    rows = '\n'.join(reel_row(r) for r in reels)
    fields = ''.join(f'<tr><td>{esc(f)}</td><td>{esc_text(REELS["field_notes"].get(f, ""))}</td></tr>' for f in REELS["fields"])
    return f"""
<div class="page-head">
  <p class="eyebrow">Reel catalog</p>
  <h1>{len(reels)} reels, tagged by style.</h1>
  <p class="sub">Every reel studied so far, with the styles it shows, so you can see each style in the wild.</p>
  <div class="note">{esc_text(REELS.get("harvest_plan", ""))}</div>
</div>
<section style="padding-top:28px">
  <div class="search"><input type="text" data-filter="#reel-table tr:not(:first-child)" placeholder="Search reels — try a creator, a style, or a word…" aria-label="Search reels"></div>
  <div class="table-box"><table id="reel-table">
    <tr><th>Reel</th><th>Creator</th><th>Style tags</th><th>What it shows</th></tr>
{rows}
  </table></div>
  <h2 class="sec" style="margin-top:48px">What each field holds</h2>
  <div class="table-box"><table>
    <tr><th>Field</th><th>What it holds</th></tr>
{fields}
  </table></div>
</section>
"""


def main():
    styles, tools = free_only(STYLES["styles"], STYLES["tools"])
    slugs = {st["slug"] for st in styles}
    moves = [m for m in STYLES["motion_dictionary"] if m.get("source_style") in slugs]
    reels = REELS.get("reels", [])
    n_skills = sum(len(g["skills"]) for g in SKILLS["groups"])
    n_free = sum(1 for g in SKILLS["groups"] for k in g["skills"] if k["cost"] == "free")
    pages = {
        "index.html": shell("home", "Master Video Styles — every video style, mastered",
                            "Edit your footage by describing it, or pick a proven style and follow its playbook.",
                            home(len(styles), len(moves), n_skills, n_free)),
        "styles.html": shell("styles", "Styles and playbooks — Master Video Styles",
                             "Every video style as a playbook: what it looks like, when to use it, the steps and a prompt.",
                             styles_page(styles, moves, tools)),
        "skills.html": shell("skills", "Skill stack — Master Video Styles",
                             "Every creator-video skill in the workspace, grouped by job, free routes first.",
                             skills_page(n_skills, n_free)),
        "reels.html": shell("reels", "Reel catalog — Master Video Styles",
                            "Every studied reel, tagged with the styles it demonstrates.", reels_page(reels)),
    }
    for name, doc in pages.items():
        (ROOT / name).write_text(doc, encoding="utf-8", newline="\n")
        print(f"Wrote {name} ({len(doc)} bytes)")
    print(f"Styles: {len(styles)}, moves: {len(moves)}, tools: {len(tools)}, reels: {len(reels)}, skills: {n_skills} ({n_free} free)")


if __name__ == "__main__":
    main()
