import { parseTemplateGuideDraft, type TemplateGuideDraft, type TemplateGuidePage, type TemplateGuideEvent } from '../../../shared/template-guide';
import labels from '../../../shared/template-guide-ui.json';
import { handleGuideAction, type GuideAction } from './actions';
import { readStudioUiPreferences } from '../utils/studioUiPreferences';

type Label = keyof typeof labels.en;
declare const __OPENMOTION_GUIDE_ICONS__: Record<string, string>;
const config = JSON.parse(document.querySelector('#openmotion-guide-page')!.textContent!) as TemplateGuidePage;
const viewId = crypto.randomUUID();
function report(action: TemplateGuideEvent['action'], details: Partial<Omit<TemplateGuideEvent, 'action' | 'view_id'>> = {}) {
  const event = { action, view_id: viewId, ...details };
  if (parent !== window) parent.postMessage({ type: 'openmotion:guide-event', templateId: config.id, event }, '*');
  else return import('../motion/tracking').then(({ trackMotion }) => trackMotion('template_guide_interaction', { page_name: 'studio', template_id: config.id, ...event })).catch(() => {});
}
let locale = 'zh-CN';
try { locale = localStorage.getItem('motion.studio.locale') || locale; } catch {}
locale = document.documentElement.dataset.guideLocale || locale;
const messages = labels as Record<string, Record<string, string>>;
const t = (key: Label) => messages[locale]?.[key] || messages.en[key];
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
};
const icon = (name: string) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${__OPENMOTION_GUIDE_ICONS__[name] || ''}</svg>`;
const button = (text: string, name?: string, quiet = false) => {
  const node = element('button', 'ui-button' + (quiet ? ' ui-button--ghost' : ''), text); node.type = 'button';
  if (name) { const box = element('span'); box.innerHTML = icon(name); node.append(box); } return node;
};
const link = (text: string, url: string, name?: string) => {
  const node = element('a', 'ui-button ui-button--ghost', text); node.href = url; node.target = '_blank'; node.rel = 'noreferrer';
  if (name) { const box = element('span'); box.innerHTML = icon(name); node.append(box); } return node;
};
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
window.addEventListener('message', event => {
  if (event.source !== parent || parent === window) return;
  if (event.data?.type === 'openmotion:guide-action-result') {
    const callback = pending.get(event.data.requestId); if (!callback) return;
    clearTimeout(callback.timer); pending.delete(event.data.requestId);
    if (event.data.error) callback.reject(new Error(event.data.error)); else callback.resolve(event.data.result);
  }
  if (event.data?.type === 'openmotion:guide-appearance') document.documentElement.dataset.theme = event.data.appearance?.theme === 'dark' ? 'dark' : 'light';
});
function host(action: GuideAction, value?: TemplateGuideDraft): Promise<any> {
  if (parent === window) return handleGuideAction(config.id, action, value, locale);
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('GUIDE_HOST_UNAVAILABLE')); }, action === 'open' ? 120_000 : 8_000);
    pending.set(requestId, { resolve, reject, timer });
    parent.postMessage({ type: 'openmotion:guide-action', templateId: config.id, viewId, requestId, action, value, locale }, '*');
  });
}

async function mount() {
  const root = document.documentElement;
  root.dataset.motionUi = ''; root.dataset.templateGuide = config.id;
  const syncTheme = () => {
    const theme = readStudioUiPreferences().theme || 'light';
    root.dataset.theme = root.dataset.openmotionGuide || (theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme);
  };
  syncTheme(); window.addEventListener('storage', syncTheme);
  const original = document.querySelector<HTMLElement>('#board-view');
  const source = document.querySelector<HTMLElement>('#source-view') || (config.motionDocument ? element('section') : null);
  if (source && !source.id) { source.id = 'source-view'; source.hidden = true; source.append(element('pre', '', config.motionDocument)); }
  const sequence = document.querySelector<HTMLElement>('#demo-sequence');
  const intro = original?.querySelector<HTMLElement>('.intro');
  const summary = intro?.querySelector<HTMLElement>('.intro-copy');
  const card = sequence || element('figure', 'demo');
  const stage = sequence?.querySelector<HTMLElement>('.demo-stage') || element('div', 'demo-stage');
  if (!sequence) {
    const frame = element('iframe'); frame.src = `?raw=1&stage=1`; frame.title = config.title; frame.sandbox.add('allow-scripts'); stage.append(frame); card.append(stage);
  }
  const defaults = sequence ? JSON.parse(sequence.dataset.demo!).params : [];
  const values = () => sequence ? parseTemplateGuideDraft(Object.fromEntries([...params.querySelectorAll<HTMLInputElement>('input[data-key]')].map(input => [input.dataset.key, input.value]))) : undefined;
  const params = sequence?.querySelector<HTMLElement>('.demo-params') || element('div', 'demo-params');
  const controls = sequence?.querySelector<HTMLElement>('.demo-controls');
  const beats = original?.querySelector<HTMLElement>('.beats');
  const shell = element('header', 'omg-top');
  const home = link('', `/?templates=1&template=${encodeURIComponent(config.id)}`); home.target = '_self'; home.setAttribute('aria-label', t('library'));
  home.onclick = event => { if (parent !== window) { event.preventDefault(); void host('library'); } };
  const logo = element('img'); logo.src = '/design-system/brand/openmotion-logo.svg'; logo.alt = 'OpenMotion'; home.append(logo);
  shell.append(home, element('span', 'omg-top-title', config.title));
  const back = link(t('library'), `/?templates=1&template=${encodeURIComponent(config.id)}`, 'arrow-left-line'); back.target = '_self'; back.onclick = home.onclick; shell.append(back);
  const layout = element('main', 'omg-layout'), preview = element('section', 'omg-preview'), first = element('div', 'omg-first');
  const heading = element('header', 'omg-heading');
  heading.append(element('span', 'omg-eyebrow', config.brand || 'MOTION'), element('h1', '', config.title));
  if (summary) heading.append(summary);
  const tabs = element('div', 'omg-tabs'), own = button(t('example'), undefined, true), reference = button(t('reference'), undefined, true);
  own.setAttribute('aria-pressed', 'true'); reference.setAttribute('aria-pressed', 'false'); tabs.append(own);
  if (config.previewUrl) tabs.append(reference);
  card.classList.add('omg-card'); stage.classList.add('omg-stage');
  const stageBox = element('div', 'omg-stage-box'); stage.before(stageBox); stageBox.append(stage);
  card.querySelector('.demo-heading')?.remove(); card.querySelector('figcaption')?.remove();
  const originalFilm = element('video', 'omg-original'); originalFilm.controls = true; originalFilm.preload = 'none'; originalFilm.hidden = true;
  if (config.posterUrl) originalFilm.poster = config.posterUrl;
  stageBox.append(originalFilm);
  const showReference = (show: boolean) => {
    own.setAttribute('aria-pressed', String(!show)); reference.setAttribute('aria-pressed', String(show));
    stage.hidden = show; originalFilm.hidden = !show; if (controls) controls.hidden = show;
    if (show && config.previewUrl && !originalFilm.getAttribute('src')) originalFilm.src = config.previewUrl;
    if (show && sequence?.querySelector('.play')?.textContent === '暂停') sequence.querySelector<HTMLButtonElement>('.play')!.click();
    if (!show) originalFilm.pause();
  };
  own.onclick = () => showReference(false); reference.onclick = () => { showReference(true); report('reference'); };
  first.append(heading, tabs, card);
  if (beats) { const title = element('h2', 'omg-chapter-heading', t('chapters')); first.append(title, beats); }
  preview.append(first); if (sequence) preview.append(element('p', 'omg-notice', t('notice')));
  const breakdown = element('section', 'omg-breakdown'); breakdown.setAttribute('aria-label', t('breakdown'));
  const referenceHeading = element('header', 'omg-reference-heading'); referenceHeading.append(element('h2', '', t('breakdown')));
  const downloads = element('nav', 'omg-resources'), download = link(t('download'), 'motion.md?download=1', 'download-2-line'); download.download = 'motion.md'; download.target = '_self';
  downloads.setAttribute('aria-label', t('document')); downloads.append(download);
  download.addEventListener('click', event => { event.preventDefault(); void host('download').then(() => report('download', { delivery_status: 'browser_save_requested' })).catch(() => { notice(t('failed')); report('download', { delivery_status: 'fetch_failed' }); }); });
  if (source) { const doc = button(t('document'), 'file-text-line', true); doc.setAttribute('aria-expanded', 'false'); doc.onclick = () => { source.hidden = !source.hidden; doc.setAttribute('aria-expanded', String(!source.hidden)); if (!source.hidden) source.scrollIntoView({ block: 'start' }); report('document', { expanded: !source.hidden }); }; downloads.append(doc); }
  if (config.sourceUrl) { const sourceLink = link(t('source'), config.sourceUrl, 'external-link-line'); sourceLink.onclick = event => { report('source'); if (parent !== window) { event.preventDefault(); void host('source').catch(() => notice(t('failed'))); } }; downloads.append(sourceLink); }
  for (const control of downloads.children) { control.className = 'ui-text-link'; const glyph = control.querySelector('span'); if (glyph) control.prepend(glyph); }
  breakdown.append(referenceHeading);
  const rules = original?.querySelector('.rule-grid'), identity = original?.querySelector('.identity'), filmstrip = original?.querySelector('.filmstrip'), production = original?.querySelector('.production');
  if (rules) breakdown.append(rules);
  if (identity) { identity.querySelector('.type-brand')?.remove(); identity.querySelector('.type-sample')?.remove(); identity.querySelector('.type-baseline')?.remove(); breakdown.append(identity); }
  if (filmstrip) breakdown.append(filmstrip);
  if (production) {
    const authoredCopy = new Set([...(rules?.querySelectorAll('.rule-copy p,.rule-copy li') || []), ...(summary ? [summary] : [])].map(node => node.textContent?.trim()));
    // The source repeats its rule paragraphs as production bullets; retain only distinct constraints.
    for (const item of production.querySelectorAll('.production-rules li')) if (authoredCopy.has(item.textContent?.trim())) item.remove();
    if (!production.querySelector('.production-rules li')) production.querySelector('.production-rules')?.remove();
    breakdown.append(production);
  }
  if (source) breakdown.append(source);
  if (!sequence && config.motionDocument) {
    const content = element('div', 'omg-document');
    for (const paragraph of config.motionDocument.split(/\n\s*\n/)) {
      if (/^#{1,3} /.test(paragraph)) content.append(element('h3', '', paragraph.replace(/^#{1,3} /, '')));
      else if (/^- /.test(paragraph)) { const list = element('ul'); for (const item of paragraph.split('\n')) list.append(element('li', '', item.replace(/^- /, ''))); content.append(list); }
      else if (/^\|/.test(paragraph)) {
        const table = element('table'), wrap = element('div', 'table-wrap');
        paragraph.split('\n').filter(line => !/^\|[\s:|-]+\|$/.test(line)).forEach((line, index) => { const row = element('tr');
          for (const cell of line.replace(/^\||\|$/g, '').split('|')) row.append(element(index === 0 ? 'th' : 'td', '', cell.trim())); table.append(row);
        }); wrap.append(table); content.append(wrap);
      }
      else content.append(element('p', '', paragraph));
    }
    breakdown.append(content);
  }
  preview.append(breakdown);
  const inspector = element('aside', 'omg-inspector'); inspector.setAttribute('aria-label', t('make'));
  const inspectorHeading = element('header', 'omg-inspector-heading'), reset = button('', 'refresh-line', true); reset.setAttribute('aria-label', t('reset')); reset.title = t('reset');
  const inspectorTitles = element('div'); inspectorTitles.append(element('h2', '', t('make'))); if (sequence) inspectorTitles.append(element('p', '', t('hint'))); inspectorHeading.append(inspectorTitles);
  if (sequence) inspectorHeading.append(reset);
  const inspectorBody = element('div', 'omg-inspector-body'); params.querySelector('.demo-presets')?.remove();
  for (const label of params.querySelectorAll('label')) { label.classList.add('ui-field'); label.querySelector('input')?.classList.add('ui-input'); }
  const color = params.querySelector<HTMLInputElement>('input[type=color]');
  if (color) { const control = element('span', 'ui-input omg-color'), code = element('input', 'omg-color-code'); code.type = 'text'; code.value = color.value.toUpperCase(); code.maxLength = 7;
    code.setAttribute('aria-label', (defaults.find((item: { key: string }) => item.key === 'accent')?.label || 'Accent') + ' HEX');
    color.before(control); color.classList.remove('ui-input'); control.append(color, code);
    color.addEventListener('input', () => { code.value = color.value.toUpperCase(); });
    code.addEventListener('input', () => { if (/^#[a-fA-F0-9]{6}$/.test(code.value)) { code.removeAttribute('aria-invalid'); color.value = code.value; color.dispatchEvent(new Event('input', { bubbles: true })); }
      else code.setAttribute('aria-invalid', 'true'); });
    code.addEventListener('change', () => { if (!code.hasAttribute('aria-invalid')) report('edit', { field: 'accent' }); });
    code.addEventListener('blur', () => { code.value = color.value.toUpperCase(); code.removeAttribute('aria-invalid'); });
  }
  inspectorBody.append(params);
  if (!sequence) inspectorBody.append(element('p', 'omg-notice', t('unavailable')));
  const footer = element('footer', 'omg-actions'), status = element('small', 'omg-status', t('pending'));
  status.setAttribute('role', 'status');
  const open = button(t('edit'), 'arrow-right-line'); open.classList.add('ui-button--primary'); open.disabled = !sequence && !config.hasHtmlProject;
  const copy = button(t('copy'), 'file-copy-line', true), manual = element('textarea', 'ui-input'); manual.hidden = true; manual.readOnly = true; manual.rows = 7; manual.setAttribute('aria-label', t('manual'));
  if (sequence) footer.append(status); if (sequence || config.hasHtmlProject) footer.append(open); else { copy.classList.remove('ui-button--ghost'); copy.classList.add('ui-button--primary'); }
  if (sequence) footer.append(element('small', 'omg-notice', t('variables'))); footer.append(copy, manual, downloads);
  inspector.append(inspectorHeading, inspectorBody, footer); layout.append(preview, inspector);
  document.body.replaceChildren(shell, layout);
  const feedback = element('div', 'motion-inline-toast'); feedback.hidden = true; feedback.setAttribute('role', 'status'); document.body.append(feedback);
  let feedbackTimer: ReturnType<typeof setTimeout>;
  const notice = (text: string) => { feedback.textContent = text; feedback.hidden = false; clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 3000); };
  for (const swatch of document.querySelectorAll<HTMLButtonElement>('[data-color]')) swatch.onclick = async () => {
    try { await navigator.clipboard.writeText(swatch.dataset.color!); notice(swatch.dataset.color!); } catch { notice(swatch.dataset.color!); }
  };
  const apply = (draft: TemplateGuideDraft) => {
    for (const input of params.querySelectorAll<HTMLInputElement>('input[data-key]')) { input.value = draft[input.dataset.key as keyof TemplateGuideDraft]; input.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  let saveTimer: ReturnType<typeof setTimeout>, dirty = false;
  params.addEventListener('input', () => { dirty = true; showReference(false); clearTimeout(saveTimer); saveTimer = setTimeout(() => { let draft; try { draft = values(); } catch { return; }
    void host('save', draft).then(() => { status.textContent = t('saved'); }).catch(() => { status.textContent = t('pending'); }); }, 180); });
  params.addEventListener('change', event => { const key = (event.target as HTMLInputElement).dataset.key; if (key === 'title' || key === 'accent') { try { values(); report('edit', { field: key }); } catch {} } });
  reset.onclick = () => { if (sequence) { apply(parseTemplateGuideDraft(Object.fromEntries(defaults.map((item: { key: string; value: string }) => [item.key, item.value])))); report('reset'); } };
  if (sequence) {
    void host('load').then(saved => { if (saved && !dirty) { apply(parseTemplateGuideDraft(saved)); status.textContent = t('saved'); } }).catch(() => { /* An unavailable host never prevents playback. */ });
  }
  copy.onclick = async () => {
    try { copy.disabled = true; const result = await host('copy', values()); if (result.copied) notice(t('copied')); else { manual.value = result.text; manual.hidden = false; manual.focus(); manual.select(); } report('copy', { outcome: result.copied ? 'success' : 'manual_fallback' }); }
    catch { notice(t('failed')); report('copy', { outcome: 'failure' }); } finally { copy.disabled = false; }
  };
  open.onclick = async () => {
    report('open_editor');
    try { open.disabled = true; copy.disabled = true; open.textContent = t('opening'); const result = await host('open', values());
      if (parent === window) { await report('open_editor', { outcome: 'success', project_id: result.projectId }); location.assign(result.url); }
    } catch { notice(t('failed')); if (parent === window) report('open_editor', { outcome: 'failure' }); } finally { open.disabled = false; copy.disabled = false; open.textContent = t('edit'); }
  };
  controls?.querySelectorAll('button').forEach(node => node.classList.add('ui-button', 'ui-button--ghost'));
  controls?.querySelector('select')?.classList.add('ui-input');
  beats?.querySelectorAll<HTMLButtonElement>('button').forEach(node => { node.classList.add('ui-button'); node.onclick = () => {
    showReference(false); const seek = sequence?.querySelector<HTMLInputElement>('.seek'); if (!seek) return; seek.value = node.dataset.time!; seek.dispatchEvent(new Event('input'));
    for (const other of beats.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === node));
    report('chapter');
  }; });
  // Restore semantic keyboard labels missing from older authored controls.
  const play = controls?.querySelector('.play');
  if (play) { const label = () => play.setAttribute('aria-label', play.textContent || 'Play'); label(); new MutationObserver(label).observe(play, { childList: true, characterData: true, subtree: true }); }
  document.title = config.title + ' · OpenMotion';
  let exposure: ReturnType<typeof setTimeout> | undefined, shown = false, visible = false, ready = !sequence || sequence.dataset.ready === 'true';
  const measure = () => { clearTimeout(exposure); if (!shown && ready && visible && !document.hidden) exposure = setTimeout(() => { shown = true; report('shown'); observer.disconnect(); }, 1000); };
  const observer = new IntersectionObserver(entries => { visible = Boolean(entries[0]?.isIntersecting && entries[0].intersectionRatio >= .5); measure(); }, { threshold: [.5] });
  observer.observe(stageBox);
  document.addEventListener('visibilitychange', measure);
  window.addEventListener('message', event => { if (!ready && event.source === stage.querySelector('iframe')?.contentWindow && event.data?.type === 'motion-demo:ready') { ready = true; measure(); } });
}
void mount();
