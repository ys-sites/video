/** Portable draft contract for each catalog entry's own authored motion example. */
export type TemplateGuideDraft = { title: string; accent: string };
export const templateGuideContinuationInstruction = 'Continue the authored guide example using the exact templateId and guideDraft from my copied requirements. First call openmotion_get_template and confirm this entry declares the title/accent example. Use openmotion_create_project with projectType=template, that templateId, guideDraft and a stable requestId; preserve the complete creation payload when retrying. If creation confirms applied=false, retry with a new requestId; keep the original request for unknown outcomes. Open the returned project with openmotion_open_preview and verify my trial values. This creates the authored canvas example, not a reconstruction of the reference film. Canvas text has no direct inspector control; continue source edits through the Agent. Copying does not send a task or create a project.';
export const templateGuideActions = ['shown', 'edit', 'chapter', 'reference', 'reset', 'copy', 'open_editor', 'download', 'document', 'source'] as const;
export type TemplateGuideEvent = { action: typeof templateGuideActions[number]; view_id: string; field?: 'title' | 'accent'; outcome?: 'success' | 'failure' | 'manual_fallback'; project_id?: string; expanded?: boolean; delivery_status?: 'browser_save_requested' | 'fetch_failed' };
export function isTemplateGuideEvent(input: unknown): input is TemplateGuideEvent {
  const value = input as TemplateGuideEvent;
  return Boolean(value && templateGuideActions.includes(value.action) && /^[a-f0-9-]{36}$/i.test(value.view_id)
    && (value.field === undefined || ['title', 'accent'].includes(value.field))
    && (value.outcome === undefined || ['success', 'failure', 'manual_fallback'].includes(value.outcome))
    && (value.project_id === undefined || value.action === 'open_editor' && value.outcome === 'success' && /^[a-f0-9-]{36}$/i.test(value.project_id))
    && (value.expanded === undefined || value.action === 'document' && typeof value.expanded === 'boolean')
    && (value.delivery_status === undefined || value.action === 'download' && ['browser_save_requested', 'fetch_failed'].includes(value.delivery_status))
    && Object.keys(value).every(key => ['action', 'view_id', 'field', 'outcome', 'project_id', 'expanded', 'delivery_status'].includes(key)));
}
export const templateGuideDraftSchema = { type: 'object', additionalProperties: false,
  properties: { title: { type: 'string', minLength: 1, maxLength: 60 }, accent: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' } },
  required: ['title', 'accent'] };
export function parseTemplateGuideDraft(input: unknown): TemplateGuideDraft {
  const value = input as TemplateGuideDraft;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['title', 'accent'].includes(key))
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 60 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.title)
    || typeof value.accent !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value.accent)) throw new Error('INVALID_GUIDE_DRAFT');
  return { title: value.title, accent: value.accent.toLowerCase() };
}
export const jsonForHtml = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const decodeAttribute = (value: string) => value.replace(/&(quot|apos|lt|gt|amp|#39);/g, (_, key: string) =>
  ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', '#39': "'" }[key]!));
export type AuthoredGuide = { src: 'demos/sequence.html'; duration: number; defaults: TemplateGuideDraft };
/** Read declarations only; catalog scripts and prose are never executed on the server. */
export function authoredTemplateGuide(source: string): AuthoredGuide | undefined {
  for (const match of source.matchAll(/\bdata-demo="([^"]+)"/g)) {
    let data;
    try { data = JSON.parse(decodeAttribute(match[1])); } catch { continue; }
    if (data.id !== 'sequence') continue;
    if (data.src !== 'demos/sequence.html' || data.status !== 'authored' || !Number.isFinite(data.duration) || data.duration <= 0 || data.duration > 600) return;
    if (!Array.isArray(data.params) || data.params.length !== 2) return;
    const title = data.params.find((item: any) => item.key === 'title' && item.type === 'text');
    const accent = data.params.find((item: any) => item.key === 'accent' && item.type === 'color');
    if (!title || !accent || title.maxLength !== 60) return;
    try { return { src: data.src, duration: data.duration, defaults: parseTemplateGuideDraft({ title: title.value, accent: accent.value }) }; } catch { return; }
  }
}

export type TemplateGuidePage = { id: string; title: string; brand?: string; sourceUrl?: string; previewUrl?: string; posterUrl?: string; hasHtmlProject?: boolean; motionDocument?: string; authored: boolean };
export function compactNativeGuideStage(source: string): string {
  return source.replace(/<\/head>/i, '<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0;gap:8px;min-height:100vh}body>header,body>footer{display:none}.viewport,.controls{width:min(100vw,calc((100vh - 64px)*16/9))}</style></head>');
}
/** Serve one maintained interface at every existing preview URL, preserving each entry's source and resource base. */
export function upgradeTemplateGuidePage(source: string, template: Omit<TemplateGuidePage, 'authored'>): string {
  const config = { ...template, authored: Boolean(authoredTemplateGuide(source)) };
  const head = '<link rel="stylesheet" href="/design-system/ui.css"><link rel="stylesheet" href="/design-system/studio/feedback.css"><link rel="stylesheet" href="/guide-assets/viewer.css">';
  const scripts = '<script type="application/json" id="openmotion-guide-page">' + jsonForHtml(config) + '</script><script defer src="/guide-assets/viewer.js"></script>';
  if (!config.authored) return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + head + '</head><body>' + scripts + '</body></html>';
  const html = source.replace(/<link\b[^>]*href=["']viewer\/(?:guide|board)\.css["'][^>]*>/gi, '');
  return html.replace(/<\/head>/i, head + '</head>').replace(/<\/body>/i, scripts + '</body>');
}
