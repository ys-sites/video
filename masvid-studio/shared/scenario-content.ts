import {
  socialPlatforms,
  type PageRecipeId,
  type ScenarioDefinition,
  type ScenarioRunSummaryForPrompt,
  type SocialPlatformId,
} from './scenarios.ts';
import type { SocialPost } from './scenario-runs.ts';

export type HtmlImageTarget =
  | { kind: 'slot'; slot: string; label: string }
  | { kind: 'img'; index: number; src: string; alt: string };

export type EmbedImageTarget =
  | { kind: 'slot'; slot: string }
  | { kind: 'img'; index: number }
  | { kind: 'append' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case '\'': return '&#39;';
      default: return ch;
    }
  });
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    return null;
  } catch {
    return null;
  }
}

function briefString(brief: Record<string, string | string[]>, key: string, fallback = ''): string {
  const val = brief[key];
  if (Array.isArray(val)) return val.map(item => String(item).trim()).filter(Boolean).join(', ') || fallback;
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function briefList(brief: Record<string, string | string[]>, key: string): string[] {
  const val = brief[key];
  if (Array.isArray(val)) return val.map(item => String(item).trim()).filter(Boolean);
  if (typeof val === 'string' && val.trim()) {
    return val.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function isZh(locale?: string | null): boolean {
  return Boolean(locale && locale.toLowerCase().startsWith('zh'));
}

function titleCase(raw: string): string {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

const STARTER_BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }
:root {
  --page-bg: #0c0e14;
  --page-surface: #151924;
  --page-border: rgba(255, 255, 255, 0.12);
  --page-text: #f5f7fb;
  --page-muted: #b0b8c9;
  --page-accent: #ff5a36;
  --page-accent-2: #38bdf8;
  --page-radius: 18px;
}
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: var(--page-bg);
  color: var(--page-text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.55;
}
a { color: inherit; text-decoration: none; }
img { display: block; max-width: 100%; height: auto; }
.om-container { width: min(1080px, calc(100% - 32px)); margin: 0 auto; }
.om-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0;
  border-bottom: 1px solid var(--page-border);
}
.om-brand { font-weight: 700; letter-spacing: -0.02em; font-size: 1.05rem; }
.om-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 90, 54, 0.16);
  color: #ffb29f;
  font-size: 0.82rem;
  font-weight: 600;
}
.om-hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 32px;
  align-items: center;
  padding: 56px 0 40px;
}
.om-hero h1 {
  margin: 14px 0 14px;
  font-size: clamp(2rem, 4.8vw, 3.4rem);
  line-height: 1.08;
  letter-spacing: -0.03em;
}
.om-lead { color: var(--page-muted); font-size: 1.08rem; margin: 0 0 24px; max-width: 56ch; }
.om-cta-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.om-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 22px;
  border-radius: 999px;
  background: var(--page-accent);
  color: #ffffff;
  font-weight: 600;
}
.om-slot-frame {
  border-radius: var(--page-radius);
  background: var(--page-surface);
  border: 1px solid var(--page-border);
  padding: 16px;
  min-height: 220px;
  display: grid;
  gap: 12px;
  place-items: center;
}
.om-slot-placeholder {
  color: var(--page-muted);
  font-size: 0.92rem;
  text-align: center;
  padding: 28px 16px;
  border: 1px dashed var(--page-border);
  border-radius: 12px;
  width: 100%;
}
.om-embed { margin: 0; width: 100%; }
.om-embed img { width: 100%; border-radius: 12px; object-fit: cover; }
.om-section { padding: 36px 0; }
.om-section h2 { margin: 0 0 18px; font-size: 1.55rem; letter-spacing: -0.02em; }
.om-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.om-card {
  padding: 20px;
  border-radius: var(--page-radius);
  background: var(--page-surface);
  border: 1px solid var(--page-border);
}
.om-card h3 { margin: 0 0 8px; font-size: 1.05rem; }
.om-card p { margin: 0; color: var(--page-muted); font-size: 0.94rem; }
.om-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  padding: 16px;
  border-radius: var(--page-radius);
  background: var(--page-surface);
  border: 1px solid var(--page-border);
}
.om-sale-banner {
  background: linear-gradient(90deg, #ff5a36, #f97316);
  color: #ffffff;
  text-align: center;
  padding: 10px 16px;
  font-size: 0.9rem;
  font-weight: 600;
}
.om-price-row { display: flex; align-items: baseline; gap: 14px; margin: 16px 0 22px; flex-wrap: wrap; }
.om-price-sale { font-size: 2.2rem; font-weight: 800; color: #ff8a6b; }
.om-price-orig { font-size: 1.15rem; color: var(--page-muted); text-decoration: line-through; }
.om-promo-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.35);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
}
.om-bio-shell { max-width: 680px; margin: 0 auto; padding: 48px 16px 64px; text-align: center; }
.om-avatar-slot { width: 128px; height: 128px; margin: 0 auto 18px; border-radius: 999px; overflow: hidden; padding: 6px; min-height: 128px; }
.om-link-stack { display: grid; gap: 12px; margin: 28px 0; text-align: left; }
.om-link-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-radius: 14px;
  background: var(--page-surface);
  border: 1px solid var(--page-border);
  font-weight: 600;
}
.om-canvas-stage { position: relative; width: 100%; height: min(78vh, 620px); overflow: hidden; background: #070910; border-bottom: 1px solid var(--page-border); }
.om-canvas-stage canvas { width: 100%; height: 100%; display: block; }
.om-canvas-overlay {
  position: absolute;
  inset: auto 0 24px 0;
  text-align: center;
  pointer-events: none;
  padding: 0 20px;
}
.om-footer {
  padding: 28px 0 44px;
  border-top: 1px solid var(--page-border);
  color: var(--page-muted);
  font-size: 0.86rem;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
@media (max-width: 640px) {
  .om-hero { padding: 32px 0 24px; }
}`;

export function scenarioStarterPage(
  recipe: PageRecipeId,
  brief: Record<string, string | string[]>,
  locale = 'en',
): { path: string; content: string }[] {
  const zh = isZh(locale);
  const lang = zh ? 'zh-CN' : 'en';
  const brand = escapeHtml(briefString(brief, 'brandName', zh ? 'OpenMotion 创意工作室' : 'OpenMotion Studio'));
  const idea = escapeHtml(briefString(brief, 'idea', zh ? '把你的核心想法变成可分享的交互式页面。' : 'Turn your core idea into a focused, shareable web experience.'));
  const audience = escapeHtml(briefString(brief, 'audience', zh ? '创作者与团队' : 'Creators and teams'));
  const cta = escapeHtml(briefString(brief, 'cta', zh ? '立即体验' : 'Get started'));
  const href = escapeHtml(safeHttpUrl(brief.pageUrl) ?? '#cta');

  if (recipe === 'sale') {
    const product = escapeHtml(briefString(brief, 'productName', zh ? '黑五限量精选商品' : 'Black Friday Featured Product'));
    const description = escapeHtml(briefString(brief, 'productDescription', idea));
    const originalPrice = escapeHtml(briefString(brief, 'originalPrice', '$129'));
    const salePrice = escapeHtml(briefString(brief, 'salePrice', '$79'));
    const discount = escapeHtml(briefString(brief, 'discountPercent', zh ? '限时直降' : 'LIMITED OFFER'));
    const promoCode = escapeHtml(briefString(brief, 'promoCode', 'BF2026'));
    const saleWindow = escapeHtml(briefString(brief, 'saleWindow', zh ? '限时活动进行中' : 'Nov 27 – Dec 1'));

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${product} — ${brand}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div class="om-sale-banner" role="banner">
    <span>${discount}</span> · <span>${saleWindow}</span> · <span>${zh ? '优惠码' : 'Code'}: ${promoCode}</span>
  </div>
  <div class="om-container">
    <header class="om-header">
      <div class="om-brand">${brand}</div>
      <span class="om-pill">${saleWindow}</span>
    </header>
    <main>
      <section class="om-hero">
        <div>
          <span class="om-pill">${discount}</span>
          <h1>${product}</h1>
          <p class="om-lead">${description}</p>
          <div class="om-price-row">
            <span class="om-price-sale">${salePrice}</span>
            <span class="om-price-orig">${originalPrice}</span>
            <span class="om-promo-badge">${zh ? '优惠码' : 'CODE'}: ${promoCode}</span>
          </div>
          <div class="om-cta-row" id="cta">
            <a class="om-cta" href="${href}">${cta}</a>
          </div>
        </div>
        <div class="om-slot-frame" data-om-slot="hero" data-om-label="${zh ? '主视觉商品图' : 'Hero product image'}">
          <div class="om-slot-placeholder">${zh ? '在此嵌入商品主图' : 'Embed hero product image here'}</div>
        </div>
      </section>
      <section class="om-section">
        <h2>${zh ? '商品细节' : 'Product spotlight'}</h2>
        <div class="om-slot-frame" data-om-slot="product" data-om-label="${zh ? '商品细节图' : 'Product detail'}">
          <div class="om-slot-placeholder">${zh ? '在此嵌入商品细节图' : 'Embed product detail shot here'}</div>
        </div>
      </section>
      <section class="om-section">
        <h2>${zh ? '更多展示' : 'Gallery'}</h2>
        <div class="om-gallery" data-om-slot="gallery" data-om-label="${zh ? '商品图集' : 'Product gallery'}">
          <div class="om-slot-placeholder">${zh ? '在此嵌入多角度商品图' : 'Embed additional product angles here'}</div>
        </div>
      </section>
    </main>
    <footer class="om-footer">
      <span>${brand}</span>
      <span>${saleWindow}</span>
    </footer>
  </div>
</body>
</html>`;
    return [
      { path: 'index.html', content: html },
      { path: 'styles.css', content: STARTER_BASE_CSS },
    ];
  }

  if (recipe === 'link-in-bio') {
    const persona = escapeHtml(briefString(brief, 'personaName', zh ? '创作者主页' : 'Creator Studio'));
    const niche = escapeHtml(briefString(brief, 'niche', zh ? '数字创作与日常分享' : 'Digital storytelling & workflows'));
    const topic = escapeHtml(briefString(brief, 'topic', zh ? '最新一期内容' : 'Latest episode'));
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${persona}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main class="om-bio-shell">
    <div class="om-slot-frame om-avatar-slot" data-om-slot="avatar" data-om-label="${zh ? '人设头像' : 'Persona avatar'}">
      <div class="om-slot-placeholder">${zh ? '头像' : 'Avatar'}</div>
    </div>
    <span class="om-pill">${niche}</span>
    <h1>${persona}</h1>
    <p class="om-lead">${idea}</p>
    <nav class="om-link-stack" aria-label="${zh ? '精选链接' : 'Featured links'}">
      <a class="om-link-card" href="${href}"><span>${zh ? '本期主题：' : 'Latest topic: '}${topic}</span><span>&rarr;</span></a>
      <a class="om-link-card" href="#featured"><span>${zh ? '视觉精选' : 'Featured showcase'}</span><span>&rarr;</span></a>
      <a class="om-link-card" href="#gallery"><span>${zh ? '作品图集' : 'Visual gallery'}</span><span>&rarr;</span></a>
    </nav>
    <section class="om-section" id="featured">
      <h2>${zh ? '最新内容封面' : 'Featured highlight'}</h2>
      <div class="om-slot-frame" data-om-slot="hero" data-om-label="${zh ? '封面视觉' : 'Hero visual'}">
        <div class="om-slot-placeholder">${zh ? '在此嵌入封面人设图' : 'Embed featured persona visual here'}</div>
      </div>
    </section>
    <section class="om-section" id="gallery">
      <h2>${zh ? '内容图集' : 'Gallery'}</h2>
      <div class="om-gallery" data-om-slot="gallery" data-om-label="${zh ? '内容图集' : 'Creator gallery'}">
        <div class="om-slot-placeholder">${zh ? '在此嵌入更多创作者照片' : 'Embed creator visuals here'}</div>
      </div>
    </section>
    <footer class="om-footer">
      <span>${persona}</span>
      <span>${brand}</span>
    </footer>
  </main>
</body>
</html>`;
    return [
      { path: 'index.html', content: html },
      { path: 'styles.css', content: STARTER_BASE_CSS },
    ];
  }

  if (recipe === 'code-animation') {
    const rawConcept = briefString(brief, 'concept', briefString(brief, 'idea', 'Gemini 4 Neon'));
    const concept = escapeHtml(rawConcept);
    const codeStyle = escapeHtml(briefString(brief, 'codeStyle', 'art-animation'));
    const safeConceptJson = JSON.stringify(rawConcept.slice(0, 80)).replace(/</g, '\\u003c');
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${concept} — ${brand}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main>
    <section class="om-canvas-stage" aria-label="${concept}">
      <canvas id="stage"></canvas>
      <div class="om-canvas-overlay">
        <span class="om-pill">${codeStyle}</span>
        <h1>${concept}</h1>
        <p class="om-lead" style="margin:0 auto;">${idea}</p>
      </div>
    </section>
    <div class="om-container">
      <section class="om-section">
        <h2>${zh ? '关键帧视觉' : 'Hero still'}</h2>
        <div class="om-slot-frame" data-om-slot="hero" data-om-label="${zh ? '主视觉帧' : 'Hero still'}">
          <div class="om-slot-placeholder">${zh ? '在此嵌入关键静帧' : 'Embed a key still here'}</div>
        </div>
      </section>
      <section class="om-section">
        <h2>${zh ? '视觉图集' : 'Gallery'}</h2>
        <div class="om-gallery" data-om-slot="gallery" data-om-label="${zh ? '视觉图集' : 'Gallery'}">
          <div class="om-slot-placeholder">${zh ? '在此嵌入更多静帧' : 'Embed additional stills here'}</div>
        </div>
      </section>
      <footer class="om-footer">
        <span>${brand}</span>
        <span>${audience}</span>
      </footer>
    </div>
  </main>
  <script>
    (function () {
      var canvas = document.getElementById('stage');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      var label = ${safeConceptJson};
      var particles = [];
      for (var i = 0; i < 64; i++) {
        particles.push({
          angle: (i / 64) * Math.PI * 2,
          radius: 70 + (i % 8) * 26,
          speed: 0.004 + (i % 5) * 0.0018,
          hue: 190 + (i * 4) % 140
        });
      }
      function resize() {
        canvas.width = canvas.clientWidth || 960;
        canvas.height = canvas.clientHeight || 540;
      }
      resize();
      window.addEventListener('resize', resize);
      var tick = 0;
      function draw() {
        tick += 1;
        var w = canvas.width, h = canvas.height;
        ctx.fillStyle = 'rgba(7, 9, 16, 0.24)';
        ctx.fillRect(0, 0, w, h);
        var cx = w / 2, cy = h / 2 - 24;
        for (var i = 0; i < particles.length; i++) {
          var p = particles[i];
          var a = p.angle + tick * p.speed;
          var x = cx + Math.cos(a) * p.radius * 1.4;
          var y = cy + Math.sin(a * 1.5) * p.radius * 0.72;
          ctx.beginPath();
          ctx.fillStyle = 'hsl(' + p.hue + ', 92%, 64%)';
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.save();
        ctx.font = '700 ' + Math.max(22, Math.min(48, Math.floor(w / 18))) + 'px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(245, 247, 251, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, cy + 12);
        ctx.restore();
        window.requestAnimationFrame(draw);
      }
      draw();
    })();
  </script>
</body>
</html>`;
    return [
      { path: 'index.html', content: html },
      { path: 'styles.css', content: STARTER_BASE_CSS },
    ];
  }

  // Default: 'landing'
  const product = escapeHtml(briefString(brief, 'productName', brand));
  const valueProps = briefList(brief, 'valueProps');
  const propsToRender = valueProps.length
    ? valueProps.slice(0, 5)
    : zh
      ? ['一处输入灵感，全程共享素材', '网页与配图随时预览、一键替换', '一键打包网页、媒体与社媒文案']
      : ['Start from one brief and reuse every asset across steps', 'Versioned HTML pages with embedded local images', 'Export one organized ZIP package ready for delivery'];

  const propCards = propsToRender
    .map((item, idx) => `          <article class="om-card"><h3>0${idx + 1}</h3><p>${escapeHtml(item)}</p></article>`)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${product} — ${brand}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <div class="om-container">
    <header class="om-header">
      <div class="om-brand">${brand}</div>
      <span class="om-pill">${audience}</span>
    </header>
    <main>
      <section class="om-hero">
        <div>
          <span class="om-pill">${brand}</span>
          <h1>${product}</h1>
          <p class="om-lead">${idea}</p>
          <div class="om-cta-row" id="cta">
            <a class="om-cta" href="${href}">${cta}</a>
          </div>
        </div>
        <div class="om-slot-frame" data-om-slot="hero" data-om-label="${zh ? '主视觉图' : 'Hero visual'}">
          <div class="om-slot-placeholder">${zh ? '在此嵌入页面主视觉图' : 'Embed hero visual here'}</div>
        </div>
      </section>
      <section class="om-section">
        <h2>${zh ? '核心亮点' : 'Key highlights'}</h2>
        <div class="om-grid" data-om-slot="features" data-om-label="${zh ? '特性配图' : 'Features visual'}">
${propCards}
        </div>
      </section>
      <section class="om-section">
        <h2>${zh ? '视觉图集' : 'Gallery'}</h2>
        <div class="om-gallery" data-om-slot="gallery" data-om-label="${zh ? '视觉图集' : 'Gallery'}">
          <div class="om-slot-placeholder">${zh ? '在此嵌入展示图片' : 'Embed gallery images here'}</div>
        </div>
      </section>
    </main>
    <footer class="om-footer">
      <span>${product}</span>
      <span>${brand}</span>
    </footer>
  </div>
</body>
</html>`;

  return [
    { path: 'index.html', content: html },
    { path: 'styles.css', content: STARTER_BASE_CSS },
  ];
}

function readAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`(?<![\\w:-])${escapeRegex(attr)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = re.exec(tag);
  return match ? (match[1] ?? match[2] ?? '') : null;
}

function setAttr(tag: string, attr: string, escapedValue: string): string {
  const re = new RegExp(`((?<![\\w:-])${escapeRegex(attr)}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, 'i');
  if (re.test(tag)) {
    return tag.replace(re, (_match, prefix: string) => `${prefix}"${escapedValue}"`);
  }
  return tag.replace(/\s*(\/?>)$/, (_match, closing: string) => ` ${attr}="${escapedValue}"${closing}`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingCloseIndex(html: string, tagName: string, openTagEnd: number): number {
  const tokenRe = new RegExp(`<(\\/?)${escapeRegex(tagName)}(?=[\\s/>])[^>]*>`, 'gi');
  tokenRe.lastIndex = openTagEnd;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(html)) !== null) {
    const isClose = match[1] === '/';
    const isSelfClose = /\/\s*>$/.test(match[0]);
    if (isClose) {
      depth -= 1;
      if (depth === 0) return match.index;
    } else if (!isSelfClose) {
      depth += 1;
    }
  }
  return -1;
}

export function listHtmlImageTargets(html: string): HtmlImageTarget[] {
  const slots: HtmlImageTarget[] = [];
  const seenSlots = new Set<string>();
  const slotTagRe = /<[a-zA-Z][\w-]*\b[^>]*\bdata-om-slot\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = slotTagRe.exec(html)) !== null) {
    const slot = (match[1] ?? match[2] ?? '').trim();
    if (!slot || seenSlots.has(slot)) continue;
    seenSlots.add(slot);
    const label = readAttr(match[0], 'data-om-label')?.trim() || titleCase(slot);
    slots.push({ kind: 'slot', slot, label });
  }

  const imgs: HtmlImageTarget[] = [];
  const imgTagRe = /<img\b[^>]*>/gi;
  let index = 0;
  while ((match = imgTagRe.exec(html)) !== null) {
    const tag = match[0];
    imgs.push({
      kind: 'img',
      index,
      src: readAttr(tag, 'src') ?? '',
      alt: readAttr(tag, 'alt') ?? '',
    });
    index += 1;
  }

  return [...slots, ...imgs];
}

export function applyImageToHtml(html: string, target: EmbedImageTarget, src: string, alt = ''): string {
  const safeSrc = escapeHtml(src);
  const safeAlt = escapeHtml(alt);
  const figure = `<figure class="om-embed"><img src="${safeSrc}" alt="${safeAlt}" loading="lazy" /></figure>`;

  if (target.kind === 'img') {
    const imgTagRe = /<img\b[^>]*>/gi;
    let index = 0;
    let replaced = false;
    const output = html.replace(imgTagRe, tag => {
      if (index !== target.index) {
        index += 1;
        return tag;
      }
      index += 1;
      replaced = true;
      return setAttr(setAttr(tag, 'src', safeSrc), 'alt', safeAlt);
    });
    if (!replaced) {
      throw new Error(`Image target index ${target.index} not found`);
    }
    return output;
  }

  if (target.kind === 'append') {
    if (/\bdata-om-slot\s*=\s*(?:"gallery"|'gallery')/i.test(html)) {
      return applyImageToHtml(html, { kind: 'slot', slot: 'gallery' }, src, alt);
    }
    const existingSrcRe = new RegExp(`<img\\b[^>]*\\bsrc\\s*=\\s*(?:"${escapeRegex(safeSrc)}"|'${escapeRegex(safeSrc)}')[^>]*>`, 'i');
    if (existingSrcRe.test(html)) {
      return html.replace(existingSrcRe, tag => setAttr(tag, 'alt', safeAlt));
    }
    const section = `<section class="om-gallery" data-om-slot="gallery">\n  ${figure}\n</section>\n`;
    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, `${section}</body>`);
    }
    return `${html}\n${section}`;
  }

  // target.kind === 'slot'
  const slotEsc = escapeRegex(target.slot);
  const imgSlotRe = new RegExp(`<img\\b[^>]*\\bdata-om-slot\\s*=\\s*(?:"${slotEsc}"|'${slotEsc}')[^>]*>`, 'i');
  if (imgSlotRe.test(html)) {
    return html.replace(imgSlotRe, tag => setAttr(setAttr(tag, 'src', safeSrc), 'alt', safeAlt));
  }

  const containerRe = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bdata-om-slot\\s*=\\s*(?:"${slotEsc}"|'${slotEsc}')[^>]*>`, 'i');
  const openMatch = containerRe.exec(html);
  if (!openMatch) {
    const safeSlot = escapeHtml(target.slot);
    const section = `<section class="om-gallery" data-om-slot="${safeSlot}">\n  ${figure}\n</section>\n`;
    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, `${section}</body>`);
    }
    return `${html}\n${section}`;
  }

  const tagName = openMatch[1];
  const openEnd = openMatch.index + openMatch[0].length;
  const closeStart = findMatchingCloseIndex(html, tagName, openEnd);
  if (closeStart === -1) {
    return html;
  }

  const inner = html.slice(openEnd, closeStart);
  const existingInSlot = new RegExp(`<img\\b[^>]*\\bsrc\\s*=\\s*(?:"${escapeRegex(safeSrc)}"|'${escapeRegex(safeSrc)}')[^>]*>`, 'i');
  if (existingInSlot.test(inner)) {
    const updatedInner = inner.replace(existingInSlot, tag => setAttr(tag, 'alt', safeAlt));
    return html.slice(0, openEnd) + updatedInner + html.slice(closeStart);
  }

  const cleanedInner = inner.replace(/<div\b[^>]*class\s*=\s*(?:"[^"]*om-slot-placeholder[^"]*"|'[^']*om-slot-placeholder[^']*')[^>]*>[\s\S]*?<\/div>\s*/gi, '');
  const prefix = cleanedInner.trimEnd();
  const nextInner = `${prefix ? `${prefix}\n` : '\n'}  ${figure}\n`;
  return html.slice(0, openEnd) + nextInner + html.slice(closeStart);
}

const EN_HOOKS = [
  'Meet {subject} — built to stand out.',
  'Here is a closer look at {subject}.',
  'Why everyone is talking about {subject}:',
  'Fresh off the studio floor: {subject}.',
] as const;

const EN_CTAS = [
  'Explore the full showcase and grab yours today.',
  'Tap the link for full details and behind-the-scenes visuals.',
  'Save this post and share what you think in the comments.',
  'Check it out before the window closes.',
] as const;

const ZH_HOOKS = [
  '一眼爱上的 {subject}，完整视觉与亮点来了！',
  '这次把 {subject} 从灵感到成片一次搞定，细节拉满。',
  '关于 {subject}，你最关心的重点都在这一条：',
  '全新上线：{subject}，从画面到体验一次看个够。',
] as const;

const ZH_CTAS = [
  '点击链接查看完整页面与更多细节。',
  '先收藏不迷路，评论区聊聊你最喜欢哪一帧。',
  '限时窗口开启中，马上入手体验。',
  '关注主页，持续分享幕后创作流程。',
] as const;

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= maxChars) return chars.join('');
  if (maxChars <= 1) return chars.slice(0, maxChars).join('');
  const sliced = chars.slice(0, maxChars - 1).join('');
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace > Math.floor((maxChars - 1) * 0.65) ? sliced.slice(0, lastSpace) : sliced;
  return `${cut.trimEnd()}…`;
}

function buildHashtags(
  scenario: ScenarioDefinition,
  brief: Record<string, string | string[]>,
  zh: boolean,
  maxHashtags: number,
): string[] {
  const raw: string[] = [];
  const brand = briefString(brief, 'brandName');
  const product = briefString(brief, 'productName');
  const persona = briefString(brief, 'personaName');
  const niche = briefString(brief, 'niche');

  for (const source of [product, brand, persona, niche]) {
    if (!source) continue;
    const tag = source.replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 28);
    if (tag) raw.push(tag);
  }

  const defaults = zh
    ? scenario.id === 'black-friday'
      ? ['黑五好物', '限时特惠', '电商上新', '种草清单', '优惠攻略', '年度必买']
      : scenario.id === 'ai-influencer'
        ? ['AI博主', '创作者日常', '效率分享', '口播干货', '自媒体创作', '主页上新']
        : ['创意工作流', '视觉设计', '动效成片', '新品发布', '灵感分享', 'OpenMotion']
    : scenario.id === 'black-friday'
      ? ['BlackFriday', 'HolidayDeals', 'ProductLaunch', 'LimitedOffer', 'ShopNow', 'Ecommerce']
      : scenario.id === 'ai-influencer'
        ? ['CreatorWorkflow', 'AICreator', 'Storytelling', 'VideoTips', 'LinkInBio', 'BehindTheScenes']
        : ['CreativeWorkflow', 'MotionDesign', 'DesignStudio', 'ProductLaunch', 'VisualStory', 'OpenMotion'];

  for (const tag of defaults) raw.push(tag);
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const tag of raw) {
    const cleaned = tag.replace(/^#+/, '').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(cleaned);
    if (deduped.length >= maxHashtags) break;
  }
  return deduped;
}

export function draftSocialPosts(
  scenario: ScenarioDefinition,
  brief: Record<string, string | string[]>,
  platforms: readonly SocialPlatformId[],
  options: {
    tone?: string;
    variant?: number;
    mediaPoolItemIds?: readonly string[];
    link?: string;
    locale?: string;
  } = {},
): SocialPost[] {
  const zh = isZh(options.locale ?? briefString(brief, 'language'));
  const variant = Math.abs(Math.floor(options.variant ?? 0));
  const tone = (options.tone ?? briefString(brief, 'tone', 'bold')).trim();
  const subject =
    briefString(brief, 'productName') ||
    briefString(brief, 'personaName') ||
    briefString(brief, 'concept') ||
    briefString(brief, 'brandName') ||
    scenario.title;
  const idea = briefString(brief, 'idea', scenario.subtitle);
  const valueProps = briefList(brief, 'valueProps');
  const salePrice = briefString(brief, 'salePrice');
  const originalPrice = briefString(brief, 'originalPrice');
  const discount = briefString(brief, 'discountPercent');
  const promoCode = briefString(brief, 'promoCode');
  const saleWindow = briefString(brief, 'saleWindow');
  const customCta = briefString(brief, 'cta');
  const link = safeHttpUrl(options.link ?? brief.pageUrl) ?? undefined;
  const mediaPoolItemIds = [...(options.mediaPoolItemIds ?? [])];

  const hooks = zh ? ZH_HOOKS : EN_HOOKS;
  const ctas = zh ? ZH_CTAS : EN_CTAS;

  return platforms.map((platformId, idx) => {
    const spec = socialPlatforms.find(p => p.id === platformId) ?? socialPlatforms[0];
    const hook = hooks[(variant + idx) % hooks.length].replace('{subject}', subject);
    const closing = customCta || ctas[(variant + idx) % ctas.length];
    const hashtags = buildHashtags(scenario, brief, zh, spec.maxHashtags);

    const offerParts = [
      salePrice ? (originalPrice ? (zh ? `特惠价 ${salePrice}（原价 ${originalPrice}）` : `Now ${salePrice} (was ${originalPrice})`) : (zh ? `特惠价 ${salePrice}` : `Now ${salePrice}`)) : '',
      discount ? discount : '',
      promoCode ? (zh ? `优惠码 ${promoCode}` : `Code: ${promoCode}`) : '',
      saleWindow ? saleWindow : '',
    ].filter(Boolean);

    const parts: string[] = [hook];
    if (idea && idea !== subject) parts.push(idea);
    if (offerParts.length) parts.push(offerParts.join(zh ? ' · ' : ' · '));
    if (valueProps.length && spec.maxChars >= 500) {
      parts.push(valueProps.slice(0, 3).map(v => `- ${v}`).join('\n'));
    }
    if (tone && spec.id === 'linkedin' && !zh) {
      parts.push(`Angle: ${tone}.`);
    }
    parts.push(closing);
    if (link && spec.maxChars >= 500) parts.push(link);

    const rawText = parts.join(spec.id === 'x' ? ' ' : '\n\n');
    const text = truncateChars(rawText, spec.maxChars);

    const post: SocialPost = {
      id: `${spec.id}-v${variant + 1}`,
      platform: spec.id,
      text,
      hashtags,
      mediaPoolItemIds,
      aspect: spec.aspect,
      ...(link ? { link } : {}),
    };

    if ('maxTitleChars' in spec && spec.maxTitleChars) {
      const rawTitle = zh
        ? salePrice ? `${subject} ${salePrice}限时特惠` : `${subject} 完整攻略`
        : salePrice ? `${subject} ${salePrice} Deal` : `${subject} Guide`;
      post.title = truncateChars(rawTitle, spec.maxTitleChars);
    }

    return post;
  });
}

export function scriptOutline(brief: Record<string, string | string[]>, locale = 'en'): string {
  const zh = isZh(locale ?? briefString(brief, 'language'));
  const persona = briefString(brief, 'personaName', zh ? '主理人' : 'Creator');
  const topic = briefString(brief, 'topic', briefString(brief, 'idea', zh ? '今天的核心主题' : 'today\'s core topic'));
  const niche = briefString(brief, 'niche', zh ? '实用工作流' : 'practical workflows');
  const notes = briefString(brief, 'scriptOutline');
  const cta = briefString(brief, 'cta', zh ? '收藏并在评论区告诉我你的想法' : 'Save this and drop your questions in the comments');

  const noteLines = notes
    ? notes.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];
  const beat1 = noteLines[0] ?? (zh ? `先抛出痛点：为什么大家在「${topic}」上总走弯路。` : `Frame the problem: why most people get stuck on ${topic}.`);
  const beat2 = noteLines[1] ?? (zh ? `展示关键步骤与真实画面，用「${niche}」的方法拆解。` : `Walk through the concrete steps with visual proof from ${niche}.`);
  const beat3 = noteLines[2] ?? (zh ? '总结可立即上手的一条建议，并给出对比效果。' : 'Share the single takeaway viewers can try immediately and show the before/after.');

  if (zh) {
    return [
      `【开场 Hook（0-3s）】大家好，我是 ${persona}。今天用 30 秒讲透「${topic}」。`,
      `【要点 1（3-12s）】${beat1}`,
      `【要点 2（12-22s）】${beat2}`,
      `【要点 3（22-27s）】${beat3}`,
      `【结尾 CTA（27-30s）】${cta}，主页链接里放了完整清单。`,
    ].join('\n\n');
  }

  return [
    `[Hook 0-3s] Hey, I'm ${persona}. In the next 30 seconds, let's break down ${topic}.`,
    `[Beat 1 · 3-12s] ${beat1}`,
    `[Beat 2 · 12-22s] ${beat2}`,
    `[Beat 3 · 22-27s] ${beat3}`,
    `[CTA · 27-30s] ${cta} — full breakdown is in the link in bio.`,
  ].join('\n\n');
}

export function socialPostsMarkdown(posts: readonly SocialPost[]): string {
  if (!posts.length) return '# Social posts\n\nNo social posts drafted yet.\n';
  const sections = posts.map(post => {
    const spec = socialPlatforms.find(p => p.id === post.platform);
    const heading = `## ${spec?.label ?? post.platform} (${post.aspect})`;
    const tags = post.hashtags.length ? post.hashtags.map(tag => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ') : '';
    return [
      heading,
      post.title ? `**Title:** ${post.title}` : null,
      post.text,
      tags || null,
      post.link ? `Link: ${post.link}` : null,
    ].filter(Boolean).join('\n\n');
  });
  return `# Social posts\n\n${sections.join('\n\n---\n\n')}\n`;
}

export function briefMarkdown(scenario: ScenarioDefinition, brief: Record<string, string | string[]>): string {
  const lines: string[] = [`# ${scenario.title} — Brief`, ''];
  const rendered = new Set<string>();
  for (const field of scenario.briefFields) {
    rendered.add(field.id);
    const val = brief[field.id];
    if (Array.isArray(val)) {
      if (!val.length) continue;
      lines.push(`## ${field.label}`, ...val.map(item => `- ${item}`), '');
    } else if (typeof val === 'string' && val.trim()) {
      lines.push(`## ${field.label}`, val.trim(), '');
    }
  }
  for (const [key, val] of Object.entries(brief)) {
    if (rendered.has(key)) continue;
    const text = Array.isArray(val) ? val.join(', ') : String(val ?? '').trim();
    if (text) lines.push(`## ${key}`, text, '');
  }
  return lines.join('\n');
}

export function runReadme(
  scenario: ScenarioDefinition,
  run: ScenarioRunSummaryForPrompt,
  options: { origin?: string } = {},
): string {
  const origin = options.origin?.replace(/\/+$/, '') ?? '';
  const stepLines = scenario.steps.map(step => {
    const st = run.steps[step.id];
    const links: string[] = [];
    if (st?.links.designProjectId) {
      const editorPath = `/design/projects/${encodeURIComponent(st.links.designProjectId)}`;
      links.push(`Design editor: ${origin ? origin + editorPath : editorPath}`);
    }
    if (st?.links.motionProjectId) {
      const encoded = encodeURIComponent(st.links.motionProjectId);
      const editorPath = st.links.motionSessionId
        ? `/editor/${encoded}?session=${encodeURIComponent(st.links.motionSessionId)}#project/${encoded}`
        : `/editor/${encoded}#project/${encoded}`;
      links.push(`Motion editor: ${origin ? origin + editorPath : editorPath}`);
    }
    return `- **${step.title}** (\`${step.id}\`, ${st?.status ?? 'todo'})${links.length ? ` — ${links.join(' · ')}` : ''}`;
  });

  return [
    `# ${run.title}`,
    '',
    `- **Scenario:** ${scenario.title} (\`${scenario.id}\`)`,
    `- **Run ID:** \`${run.id}\``,
    `- **Revision:** ${run.revision}`,
    '',
    '## Package contents',
    '',
    '- `manifest.json` — Machine-readable inventory of steps, revisions and exported file paths.',
    '- `brief/` — Structured campaign brief (`brief.md`, `brief.json`) and script (`script.md`, when present).',
    '- `web/` — Exported Design Studio HTML projects (`web/<step-id>/index.html` with local relative `assets/*`) and optional standalone HTML snapshots.',
    '- `media/` — Pinned images, video and audio assets referenced by the workflow.',
    '- `social/` — Multi-platform social copy (`posts.json`, `posts.md`, and per-platform `.txt` files).',
    '- `motion/` — Linked Motion Studio project references (`<step-id>.json`) and optional source archives.',
    '',
    '## Steps & editor links',
    '',
    ...stepLines,
    '',
    '## Licenses & provenance',
    '',
    'Keep third-party font, template, stock and generated media licenses alongside any distributed deliverables. Verify rights and brand compliance before publishing externally.',
    '',
  ].join('\n');
}
