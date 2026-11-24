import { designStyleScript } from './brand-capture/design-style-extractor.mjs';
import { designTokenScript } from './brand-capture/token-extractor.mjs';
import { browserHelpers } from './brand-capture/browser-helpers.mjs';

// Preserve the upstream measurements alongside the fixed showcase's representative roles.
export const brandSampleScript = `(() => {
  ${browserHelpers}
  const design = ${designStyleScript};
  const tokens = ${designTokenScript};
  const elements = sel => Array.from(document.querySelectorAll(sel)).slice(0, 500).filter(isVisible);
  const body = getComputedStyle(document.body), heading = elements('h1,h2')[0] || document.body;
  const solid = (el, fallback) => el && brandColor(getComputedStyle(el).backgroundColor, false) || fallback;
  const buttons = elements('button,a[role="button"],a[class*="button"],a[class*="btn"],a[class*="cta"]')
    .filter(el => el.getBoundingClientRect().height <= 140 && el.getBoundingClientRect().width <= 800 && !el.closest('[role="dialog"], [class*="cookie" i], [id*="cookie" i], [class*="consent" i]'));
  const filled = buttons.filter(el => solid(el, null) || getComputedStyle(el).backgroundImage.includes('gradient'));
  const chroma = color => { if (!/^#[a-f0-9]{6}$/i.test(color || '')) return 0; const rgb = color.slice(1).match(/../g).map(n=>parseInt(n,16)); return (Math.max(...rgb)-Math.min(...rgb))/255; };
  const score = el => { const color=solid(el,null), usage=tokens.colorStats?.find(c=>c.hex===color); return chroma(color)*4 + Math.min(5,usage?.interactiveBg || 0)*.5 + (/primary|cta/i.test(el.className)?2:0) + (el.getBoundingClientRect().top < innerHeight ? 1:0); };
  const button = filled.sort((a,b)=>score(b)-score(a))[0];
  const card = design.cards[0];
  const background = solid(document.body, solid(document.documentElement, '#ffffff'));
  const foreground = brandColor(body.color, false) || '#111111';
  const gradientStop = button && (getComputedStyle(button).backgroundImage.match(/(?:rgba?|oklch|oklab|hsla?|lab|lch|color)\\([^)]+\\)|#[a-f0-9]{3,8}/ig) || []).map(value => brandColor(value, false)).find(Boolean);
  const primary = solid(button, gradientStop || tokens.colorStats?.filter(c => c.interactiveBg > 0).sort((a,b) => chroma(b.hex)*Math.min(8,b.interactiveBg) - chroma(a.hex)*Math.min(8,a.interactiveBg))[0]?.hex || foreground);
  const font = value => value.replace(/[^\\p{L}\\p{N} _,'".-]/gu,'').slice(0,160) || 'sans-serif';
  const safeGradient = value => value && value.length <= 2000 && !/[;{}<>\\\\]|url\\s*\\(|image\\s*\\(/i.test(value) && /^(?:linear|radial|conic)-gradient\\([a-z0-9#.,%()+/\\s-]+\\)$/i.test(value);
  const gradients = (design.backgrounds || []).map(g => g.value).filter(safeGradient);
  const components = [['Button',design.buttons],['Card',design.cards],['Navigation',design.nav ? [design.nav] : []],['Badge',design.chips || []],['Tab',design.tabs || []]]
    .flatMap(([role,list]) => list.map(component => ({role,...component})));
  const name = document.querySelector('meta[property="og:site_name"]')?.content || document.title.split(/[|–—]/)[0] || location.hostname;
  const hexSolid = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : undefined;
  return {name:name.trim().slice(0,100),title:tokens.title,colors:tokens.colors,typography:design.typography,
    components,spacing:design.spacing.observed.map(n=>n+'px'),gradients,design,tokens,
    style:{background,foreground,primary,onPrimary:button && brandColor(getComputedStyle(button).color,false) || background,
      surface:hexSolid(card?.background) || background,headingFont:font(getComputedStyle(heading).fontFamily),bodyFont:font(body.fontFamily),
      radius:Math.min(999,parseFloat(getComputedStyle(button || document.body).borderRadius) || 0)+'px',gradient:gradients[0] || 'none'}};
})()`;
