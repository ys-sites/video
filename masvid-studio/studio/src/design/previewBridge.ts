/**
 * Isolated HTML preview bridge for sandboxed iframes (without allow-same-origin).
 * Adapted in part from Open Design (Apache-2.0) deck protocol and speaker-notes extraction.
 * Uses an ephemeral token so only messages from the active preview iframe are accepted.
 */
import type { DesignCommentAnchor } from '../../../shared/design-project';

export type PickedElement = NonNullable<DesignCommentAnchor['element']>;
export type DeckStateMessage = { active: number; count: number };

const SLIDE_SELECTORS = '.slide, [data-screen-label], .deck-slide, .ppt-slide, .slide-frame';

/** Extract speaker notes from raw deck HTML (<script id="speaker-notes"> or aside.notes). */
export function parseSpeakerNotes(html: string): string[] {
  const scriptMatch = /<script\b[^>]*id=["']speaker-notes["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (scriptMatch) {
    try {
      const parsed = JSON.parse(scriptMatch[1].trim());
      if (Array.isArray(parsed)) return parsed.map(String);
      if (Array.isArray(parsed?.notes)) return parsed.notes.map(String);
    } catch { /* ignore malformed JSON */ }
  }
  const notes: string[] = [];
  const asideRe = /<(?:aside|div)\b[^>]*\bnotes\b[^>]*>([\s\S]*?)<\/(?:aside|div)>/gi;
  let match: RegExpExecArray | null;
  while ((match = asideRe.exec(html)) !== null) {
    notes.push(match[1].replace(/<[^>]+>/g, '').trim());
  }
  return notes;
}

/** Extract slide titles/labels and lightweight count from deck HTML for the thumbnail rail. */
export function parseDeckSlides(html: string): { index: number; label: string }[] {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nodes = Array.from(doc.querySelectorAll(SLIDE_SELECTORS));
    return nodes.map((node, index) => {
      const explicit = node.getAttribute('data-screen-label');
      const heading = node.querySelector('h1, h2, h3')?.textContent?.trim();
      const label = (explicit || heading || `Slide ${index + 1}`).slice(0, 48);
      return { index, label };
    });
  } catch {
    return [];
  }
}

/** Detect whether an HTML document looks like a multi-slide deck. */
export function looksLikeDeck(html: string): boolean {
  return /od:slide|data-screen-label|["'][^"']*\b(?:slide|deck-slide|ppt-slide|slide-frame)\b/.test(html);
}

/**
 * Wrap raw HTML for srcdoc rendering with a <base href> pointing at the project's raw asset URL
 * and a tiny postMessage bridge for element picking, hover highlighting and deck navigation.
 */
export function buildBridgeSrcDoc(rawHtml: string, baseHref: string, token: string, pickEnabled: boolean): string {
  const escapedBase = baseHref.replace(/"/g, '&quot;');
  const safeToken = JSON.stringify(token);
  const bridge = `<script data-om-design-bridge>
(function(){
  const TOKEN = ${safeToken};
  let pick = ${pickEnabled ? 'true' : 'false'};
  const box = document.createElement('div');
  box.setAttribute('data-om-hover', '1');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid Highlight;background:color-mix(in srgb, Highlight 14%, transparent);border-radius:4px;display:none;transition:all 60ms ease;';
  const mount = () => { if (!box.isConnected && document.body) document.body.appendChild(box); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      const cls = Array.from(cur.classList || []).filter(c => !c.startsWith('om-')).slice(0, 2);
      if (cls.length) seg += '.' + cls.map(c => CSS.escape(c)).join('.');
      else if (cur.parentElement) {
        const sibs = Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const rect = el.getBoundingClientRect();
    const tagName = el.tagName.toLowerCase();
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240);
    const label = el.getAttribute('aria-label') || (text ? text.slice(0, 48) : tagName);
    return {
      selector: cssPath(el),
      elementId: el.id || undefined,
      tagName,
      label,
      text: text || undefined,
      htmlHint: (el.outerHTML || '').slice(0, 320),
      box: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
    };
  }

  document.addEventListener('mousemove', (e) => {
    if (!pick) { box.style.display = 'none'; return; }
    mount();
    const el = e.target;
    if (!el || el === box || el === document.documentElement || el === document.body) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  }, true);

  document.addEventListener('mouseleave', () => { box.style.display = 'none'; }, true);

  document.addEventListener('click', (e) => {
    if (!pick) return;
    const el = e.target;
    if (!el || el === box) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect();
    window.parent.postMessage({
      type: 'om:design-pick', token: TOKEN,
      element: describe(el),
      clientPoint: { x: e.clientX || Math.round(r.left + r.width / 2), y: e.clientY || Math.round(r.top + r.height / 2) },
      viewport: { width: innerWidth, height: innerHeight },
      rect: { x: r.left, y: r.top, width: r.width, height: r.height }
    }, '*');
  }, true);

  // Fallback deck navigation ONLY when the page itself did not react to od:slide.
  const slides = () => Array.from(document.querySelectorAll('${SLIDE_SELECTORS}'));
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'om:design-mode' && m.token === TOKEN) {
      pick = Boolean(m.pick);
      if (!pick) box.style.display = 'none';
    }
    if (m.type === 'od:slide') {
      const list = slides();
      if (list.length > 1) {
        const before = Math.max(0, list.findIndex(el => el.classList.contains('active')));
        setTimeout(() => {
          const current = slides();
          const after = Math.max(0, current.findIndex(el => el.classList.contains('active')));
          if (after !== before) return;
          let next = before;
          if (m.action === 'next') next = Math.min(current.length - 1, before + 1);
          else if (m.action === 'prev') next = Math.max(0, before - 1);
          else if (m.action === 'first') next = 0;
          else if (m.action === 'last') next = current.length - 1;
          else if (m.action === 'go' && typeof m.index === 'number') next = Math.max(0, Math.min(current.length - 1, m.index));
          if (next !== before) {
            current.forEach((el, i) => el.classList.toggle('active', i === next));
            window.parent.postMessage({ type: 'od:slide-state', active: next, count: current.length, protocolVersion: 1 }, '*');
          }
        }, 0);
      }
    }
  });
  window.addEventListener('load', () => {
    const list = slides();
    if (list.length > 1) {
      const active = Math.max(0, list.findIndex(el => el.classList.contains('active')));
      window.parent.postMessage({ type: 'od:slide-state', active, count: list.length, protocolVersion: 1 }, '*');
    }
  });
})();
</script>`;

  const baseTag = `<base href="${escapedBase}" />`;
  let out = rawHtml;
  if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b[^>]*>/i, m => `${m}\n${baseTag}`);
  else out = `${baseTag}\n${out}`;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${bridge}\n</body>`);
  else out += `\n${bridge}`;
  return out;
}
