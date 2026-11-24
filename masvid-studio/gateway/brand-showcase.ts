import type { BrandCapture } from "./brand-extract.ts";
import { brandKitShowcase, validateBrandStyle } from "../shared/brand-kit.ts";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

function componentSkin(selector: string, component: object | undefined) {
  if (!component) return '';
  const properties = { borderRadius: 'border-radius', border: 'border', boxShadow: 'box-shadow', backgroundImage: 'background-image', backdropFilter: 'backdrop-filter', fontWeight: 'font-weight' };
  const declarations = Object.entries(properties).flatMap(([key, property]) => {
    const value = (component as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length <= 2000 && /^[a-z0-9#.,%()+/\s-]+$/i.test(value) && !/(url|image|var|expression)\s*\(/i.test(value) ? [`${property}:${value}`] : [];
  });
  return `${selector}{${declarations.join(';')}}`;
}

/** Authored video styling is domain content, independent of Studio theme tokens. */
export function brandShowcase(capture: BrandCapture) {
  const s = validateBrandStyle(capture.sample.style),
    name = escape(capture.sample.name);
  const faces = capture.fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${f.path}");font-weight:${f.weight};font-style:${f.style};font-display:block;${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ""}}`,
    )
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name} · Brand Kit</title>
<script src="assets/gsap.min.js"></script><style>
${faces}
*{box-sizing:border-box}body{margin:0}#main{position:relative;width:1280px;height:720px;overflow:hidden;background:${s.background};color:${s.foreground};font-family:${s.bodyFont}}
.scene{position:absolute;inset:0;padding:64px;overflow:hidden;background:${s.background}}
.scene-header{height:48px;display:flex;align-items:center;justify-content:space-between;gap:32px}
.kicker{font-size:15px;line-height:1.4;letter-spacing:3px;text-transform:uppercase;overflow-wrap:anywhere}
.heading{margin:0;font-family:${s.headingFont};font-size:90px;font-weight:700;line-height:1.08;letter-spacing:-3px;max-width:100%;overflow-wrap:anywhere}
.brand{display:flex;gap:16px;align-items:center;min-width:0;font-size:22px;font-weight:600}.brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.brand img{max-width:140px;max-height:48px;object-fit:contain;flex-shrink:0}
.number{flex-shrink:0;font-size:16px;opacity:.6}.rule{position:absolute;bottom:64px;left:64px;right:64px;height:2px;background:currentColor;opacity:.2}
.scene-content{position:absolute;inset:128px 64px;display:flex;align-items:center;justify-content:center;text-align:center;z-index:1}
.content-stack{display:flex;flex-direction:column;align-items:center;gap:24px;width:100%;max-width:1088px}
#title .accent{position:absolute;width:260px;height:260px;right:-65px;bottom:-65px;background:${s.primary};border-radius:${s.radius};transform:rotate(-18deg)}
#type{background:${s.primary};color:${s.onPrimary}}#type .heading{font-size:96px}#type .body{font-size:28px;line-height:1.5;margin:0;max-width:100%}#type .sample{position:absolute;right:64px;bottom:60px;font-size:64px;line-height:1;font-family:${s.headingFont};opacity:.6}
#palette .content-stack{gap:36px}#palette .heading{font-size:64px}
.swatches{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:32px;width:100%}
.swatch{margin:0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:18px}
.swatch-color{width:220px;height:220px;max-width:100%;border-radius:${s.radius};border:1px solid ${s.foreground}26}
.swatch figcaption{display:flex;flex-direction:column;gap:4px;align-items:center;font-size:18px;line-height:1.3;color:${s.foreground}}
.swatch-code{font-size:16px;font-variant-numeric:tabular-nums}
.swatch:nth-child(1) .swatch-color{background:${s.primary}}.swatch:nth-child(2) .swatch-color{background:${s.foreground}}.swatch:nth-child(3) .swatch-color{background:${s.surface}}.swatch:nth-child(4) .swatch-color{background:${s.background}}
#finish{background:${s.gradient === "none" ? s.surface : s.gradient}}
.card{width:900px;max-width:100%;min-height:360px;padding:56px 100px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;background:${s.background};color:${s.foreground};border:1px solid ${s.foreground}26;border-radius:${s.radius}}
.card .kicker{max-width:100%}.card .heading{font-size:62px}.cta{display:inline-flex;align-items:center;justify-content:center;padding:16px 28px;background:${s.primary};color:${s.onPrimary};border-radius:${s.radius};font-size:20px;line-height:1.4}.caption{position:absolute;bottom:34px;left:64px;right:64px;text-align:center;font-size:14px;line-height:1.4}
${componentSkin('.card', capture.sample.design?.cards[0])}
${componentSkin('.cta', capture.sample.design?.buttons.find(button => button.background.toLowerCase() === s.primary.toLowerCase()) || capture.sample.design?.buttons.find(button => button.backgroundImage) || capture.sample.design?.buttons[0])}
${componentSkin('.heading', capture.sample.typography.find(t => t.role === 'display'))}
</style></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="${brandKitShowcase.duration}" data-width="1280" data-height="720" data-fps="30">
<section id="title" class="scene clip" data-start="0" data-duration="3" data-track-index="0"><header class="scene-header"><div class="brand">${capture.logo ? '<img src="assets/logo.png" alt="">' : ""}<span>${name}</span></div><span class="number">01 / 04</span></header><div class="scene-content"><div class="content-stack"><div class="kicker">A BRAND IN MOTION</div><div class="heading">One identity.<br>Every expression.</div></div></div><div class="accent"></div><div class="rule"></div></section>
<section id="type" class="scene clip" data-start="3" data-duration="3" data-track-index="1"><header class="scene-header"><div class="kicker">TYPE & VOICE</div><span class="number">02 / 04</span></header><div class="scene-content"><div class="content-stack"><div class="heading">Make it<br>recognizable.</div><p class="body">A clear voice. A familiar feeling.<br>Built from your brand’s visual language.</p></div></div><span class="sample">Aa</span></section>
<section id="palette" class="scene clip" data-start="6" data-duration="3" data-track-index="2"><header class="scene-header"><div class="kicker">COLOR & CONTRAST</div><span class="number">03 / 04</span></header><div class="scene-content"><div class="content-stack"><div class="heading">Your signature palette.</div><div class="swatches">${[["Primary", s.primary], ["Ink", s.foreground], ["Surface", s.surface], ["Canvas", s.background]].map(([label, color]) => `<figure class="swatch"><div class="swatch-color"></div><figcaption><span>${label}</span><span class="swatch-code">${color}</span></figcaption></figure>`).join("")}</div></div></div></section>
<section id="finish" class="scene clip" data-start="9" data-duration="3" data-track-index="3"><header class="scene-header"><div class="kicker">SHAPE & EXPRESSION</div><span class="number">04 / 04</span></header><div class="scene-content"><div class="card"><div class="kicker">${name}</div><div class="heading">Make it yours.</div><div class="cta">Your next story →</div></div></div><div class="caption">Brand Kit · Style reference</div></section>
</div><script>
const tl=gsap.timeline({paused:true});
tl.set('.scene',{autoAlpha:0},0);
['title','type','palette','finish'].forEach((id,i)=>{const start=i*3;tl.set('#'+id,{autoAlpha:1},start);tl.fromTo('#'+id+' .heading',{y:45,opacity:0},{y:0,opacity:1,duration:.65,ease:'power3.out'},start+.15);if(i<3)tl.set('#'+id,{autoAlpha:0},start+3);});
tl.fromTo('.swatch',{y:55,opacity:0},{y:0,opacity:1,duration:.6,stagger:.1,ease:'power3.out'},6.35);
tl.fromTo('.card',{y:40,scale:.95},{y:0,scale:1,duration:.7,ease:'power3.out'},9);
tl.to({}, {duration:.01},11.99);window.__timelines={main:tl};
</script></body></html>`;
}
