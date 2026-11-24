import { ToolInputError } from './tool-input-error.ts';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { templates } from '../template-library.ts';
import { builtinRecommendationIds, onboardingSourceFiles, onboardingTemplateIds, recommendationTemplateIds } from './onboarding-templates.ts';

export const templatePresentationName = 'openmotion_show_template_recommendations';
export const templatePresentationMime = 'text/html;profile=mcp-app';
export const templatePresentationCapability = 'io.modelcontextprotocol/ui';
export const templatePresentationLimit = 1.5 * 1024 * 1024;
const applicationRoot = fileURLToPath(new URL('../', import.meta.url));
const uiDirectory = path.join(applicationRoot, 'mcp-ui/template-recommendations');
const supportedIds: readonly string[] = recommendationTemplateIds;
const supportedLanguages = ['zh', 'en', 'ja', 'ko', 'fr', 'es', 'pt'];
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

type AssetFile = { path: string; sha256: string; bytes: number; mimeType?: string };
type PreviewTemplate = {
  id: string; title: string; description: string; durationSeconds: number;
  width: number; height: number; sourceFiles: AssetFile[];
} & ({ kind?: 'builtin'; video: AssetFile; poster: AssetFile }
  | { kind: 'reference'; videoUrl: string; posterUrl: string });
type ToolDefinition = {
  name: string; title: string; description: string; inputSchema: any;
  annotations: { readOnlyHint: boolean; openWorldHint: boolean };
  _meta: Record<string, unknown>;
};
export type TemplatePresentation = Readonly<{
  uri: string; resourceVersion: string; tool: ToolDefinition;
  descriptor: { uri: string; name: string; mimeType: string };
  content: { uri: string; mimeType: string; text: string; _meta: Record<string, unknown> };
  templates: readonly Readonly<PreviewTemplate>[];
}>;
export type McpClientState = { presentation?: TemplatePresentation };
export function createMcpClientState(): McpClientState { return {}; }

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('TEMPLATE_PRESENTATION_INVALID: ' + message);
}
function regularFile(root: string, relative: string): Buffer {
  requireValue(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative)
    && !relative.includes('\\') && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'invalid asset path');
  const realRoot = realpathSync(root);
  let current = realRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    requireValue(!lstatSync(current).isSymbolicLink(), 'symbolic assets are not supported');
  }
  const info = lstatSync(current);
  requireValue(info.isFile() && info.size <= 1024 * 1024, 'asset must be a regular file below 1 MiB');
  return readFileSync(current);
}
function verifiedFile(root: string, file: AssetFile): Buffer {
  requireValue(file && typeof file === 'object' && /^[a-f0-9]{64}$/.test(file.sha256)
    && Number.isSafeInteger(file.bytes) && file.bytes > 0, 'invalid asset identity');
  const bytes = regularFile(root, file.path);
  requireValue(bytes.length === file.bytes && digest(bytes) === file.sha256, 'asset identity differs: ' + file.path);
  return bytes;
}

/** Inline documents use renders of local editable projects, not remote films. */
export function loadInlineProjectPreviews(templateIds: string[], options: { directory?: string; applicationRoot?: string } = {}) {
  const directory = options.directory ?? uiDirectory;
  const appRoot = options.applicationRoot ?? applicationRoot;
  const manifest = JSON.parse(regularFile(directory, 'project-previews/manifest.json').toString('utf8'));
  requireValue(manifest.schemaVersion === 1 && manifest.previewSource === 'project' && manifest.silent === true
    && Array.isArray(manifest.templates) && manifest.templates.length === onboardingTemplateIds.length, 'invalid project preview manifest');
  const ids = manifest.templates.map((item: any) => item.id);
  requireValue(new Set(ids).size === onboardingTemplateIds.length
    && onboardingTemplateIds.every(id => ids.includes(id)), 'incomplete project previews');
  return templateIds.map(id => {
    const item = manifest.templates.find((item: any) => item.id === id);
    requireValue(item, 'missing project preview: ' + id);
    const record = JSON.parse(regularFile(appRoot, 'library/templates/catalog/' + id + '/template.json').toString('utf8'));
    requireValue(item.sourceFilesSha256 === digest(JSON.stringify(record.entry.files)), 'project source identity differs');
    requireValue(Number.isFinite(item.durationSeconds) && item.durationSeconds > 0, 'invalid project duration');
    requireValue(item.video?.path === 'project-previews/' + id + '.webm' && item.video.mimeType === 'video/webm'
      && item.poster?.path === 'project-previews/' + id + '.jpg' && item.poster.mimeType === 'image/jpeg', 'invalid project media paths');
    const video = verifiedFile(directory, item.video), poster = verifiedFile(directory, item.poster);
    requireValue(video.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      && poster[0] === 0xff && poster[1] === 0xd8, 'invalid project media bytes');
    return { id, durationSeconds: item.durationSeconds, videoBase64: video.toString('base64'), videoMimeType: 'video/webm' as const,
      posterBase64: poster.toString('base64'), posterMimeType: 'image/jpeg' };
  });
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const safeJson = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

/** Read only the approved, prebuilt assets. No engine, service, or network is involved. */
export function loadTemplatePresentation(options: { directory?: string; applicationRoot?: string } = {}): TemplatePresentation {
  const directory = options.directory ?? uiDirectory;
  const appRoot = options.applicationRoot ?? applicationRoot;
  const manifest = JSON.parse(regularFile(directory, 'manifest.json').toString('utf8'));
  requireValue(manifest.schemaVersion === 1 && Array.isArray(manifest.templates)
    && manifest.templates.length === supportedIds.length, 'invalid manifest');
  const packageInfo = JSON.parse(regularFile(appRoot, 'package.json').toString('utf8'));
  requireValue(manifest.runtime?.hyperframes === packageInfo.dependencies.hyperframes
    && manifest.runtime?.gsap === packageInfo.dependencies.gsap, 'preview runtime differs');
  const seen = new Set<string>();
  const previews = (manifest.templates as PreviewTemplate[]).map(template => {
    if (template.kind === 'reference') {
      requireValue((onboardingTemplateIds as readonly string[]).includes(template.id) && !seen.has(template.id), 'unsupported or duplicate reference');
      seen.add(template.id);
      const prefix = 'library/templates/catalog/' + template.id + '/';
      const sourcePaths = new Set<string>();
      requireValue(Array.isArray(template.sourceFiles), 'missing reference source identity');
      for (const source of template.sourceFiles) {
        requireValue(typeof source.path === 'string' && source.path.startsWith(prefix) && !sourcePaths.has(source.path), 'invalid reference source identity');
        sourcePaths.add(source.path);
        verifiedFile(appRoot, source);
      }
      for (const file of onboardingSourceFiles.filter(file => file.startsWith(prefix)))
        requireValue(sourcePaths.has(file), 'incomplete reference source identity');
      const record = JSON.parse(regularFile(appRoot, prefix + 'template.json').toString('utf8'));
      const entry = record.entry;
      requireValue(record.templateId === template.id && entry?.templateId === template.id
        && template.title === entry.original?.templateName && template.description === entry.original?.summary
        && template.durationSeconds === Number(entry.original?.durationSeconds)
        && template.width === entry.width && template.height === entry.height, 'reference metadata differs');
      const approvedMedia = /^https:\/\/r\.open-design\.ai\/files\/[a-f0-9]{64}$/;
      requireValue(typeof template.videoUrl === 'string' && approvedMedia.test(template.videoUrl)
        && template.videoUrl === entry.previewUrl && typeof template.posterUrl === 'string'
        && approvedMedia.test(template.posterUrl) && template.posterUrl === entry.coverUrl, 'reference media differs');
      const descriptions = Object.fromEntries(supportedLanguages.map(language => [language,
        record.locales[language === 'zh' ? 'zh-CN' : language === 'pt' ? 'pt-br' : language]?.original?.summary || entry.original.summary]));
      const videoCategories = Object.fromEntries(supportedLanguages.map(language => [language,
        (record.locales[language === 'zh' ? 'zh-CN' : language === 'pt' ? 'pt-br' : language]?.original?.promotionalUseCases
          ?? entry.original.promotionalUseCases ?? '').trim()]));
      return { id: template.id, title: template.title, description: template.description,
        durationSeconds: template.durationSeconds, kind: 'reference', descriptions, videoCategories,
        videoUrl: template.videoUrl, posterUrl: template.posterUrl };
    }
    const canonical = templates.find(item => item.id === template.id);
    requireValue(canonical && (builtinRecommendationIds as readonly string[]).includes(template.id) && !seen.has(template.id), 'unsupported or duplicate template');
    seen.add(template.id);
    requireValue(template.title === canonical.title && template.durationSeconds === canonical.duration
      && typeof template.description === 'string' && template.width === 960 && template.height === 540, 'template metadata differs');
    requireValue(Array.isArray(template.sourceFiles) && template.sourceFiles.length > 0, 'missing source identity');
    const sourcePaths = new Set<string>();
    for (const source of template.sourceFiles) {
      requireValue(typeof source.path === 'string' && (source.path.startsWith('template-library/' + template.id + '/')
        || ['template-library/LICENSE', 'template-library/NOTICE.md'].includes(source.path)) && !sourcePaths.has(source.path), 'invalid source identity');
      sourcePaths.add(source.path);
      verifiedFile(appRoot, source);
    }
    const registryPath = 'template-library/' + template.id + '/registry-item.json';
    requireValue(sourcePaths.has(registryPath), 'missing source registry identity');
    const registry = JSON.parse(regularFile(appRoot, registryPath).toString('utf8'));
    requireValue(Array.isArray(registry.files) && registry.files.every((file: { path: string }) =>
      sourcePaths.has('template-library/' + template.id + '/' + file.path)), 'incomplete template source identity');
    requireValue(template.video?.path === 'assets/' + template.id + '.mp4' && template.video.mimeType === 'video/mp4'
      && template.poster?.path === 'assets/' + template.id + '.jpg' && template.poster.mimeType === 'image/jpeg', 'invalid preview media');
    const video = verifiedFile(directory, template.video), poster = verifiedFile(directory, template.poster);
    requireValue(video.subarray(4, 8).toString() === 'ftyp' && poster[0] === 0xff && poster[1] === 0xd8, 'invalid preview bytes');
    return { id: template.id, title: template.title, description: template.description, durationSeconds: template.durationSeconds,
      videoBase64: video.toString('base64'), posterBase64: poster.toString('base64'), posterMimeType: 'image/jpeg' };
  });
  const script = regularFile(directory, 'build/app.js').toString('utf8');
  const css = regularFile(directory, 'build/app.css').toString('utf8');
  const metadata = { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: ['blob:', 'https://r.open-design.ai'] } },
    'openai/ui': { preferredDisplayMode: 'inline' } };
  const skeleton = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>{{css}}</style></head><body><main id="openmotion-template-cards"></main><script>window.__OPENMOTION_TEMPLATE_CARDS__={{bootstrap}};</script><script>{{script}}</script></body></html>';
  // This identity precedes HTML injection, avoiding a self-referential content hash.
  const resourceVersion = digest(JSON.stringify({ skeleton, manifest, metadata, css, script }));
  const text = skeleton.replace('{{css}}', () => css.replace(/<\/style/gi, '<\\/style'))
    .replace('{{bootstrap}}', () => safeJson({ resourceVersion, templates: previews }))
    .replace('{{script}}', () => script.replace(/<\/script/gi, '<\\/script'));
  const contentHash = digest(JSON.stringify({ text, metadata }));
  const uri = `ui://openmotion/template-recommendations/${contentHash}/index.html`;
  const content = { uri, mimeType: templatePresentationMime, text, _meta: metadata };
  requireValue(Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { contents: [content] } })) <= templatePresentationLimit, 'resource exceeds 1.5 MiB');
  const tool: ToolDefinition = {
    name: templatePresentationName, title: 'OpenMotion · Show Template Recommendations',
    description: 'Show three approved, full-video template previews in this chat, in the supplied order. Always set language to the language of the latest user request (or their explicit requested output language), regardless of the host interface locale. Supported: zh, en, ja, ko, fr, es, pt; use en for other languages. For first-run onboarding, preserve the prepared random three-of-four selection, open the template library once, then set onboarding=true: the persistent conversation component displays the maintained welcome above exactly three cards. Do not repeat the welcome in the final reply. Ordinary recommendations omit onboarding. Result _meta binds the negotiated immutable ui.resourceUri and a recommendation-specific openai/widgetSessionId. This read-only presentation does not create or select a project. Use only when discovered natively; otherwise use the prepared self-contained project-preview document from installation onboarding and assess native activation separately.',
    inputSchema: { type: 'object', properties: { templateIds: { type: 'array', minItems: 3, maxItems: 3,
      items: { type: 'string', enum: supportedIds }, uniqueItems: true },
      language: { type: 'string', enum: supportedLanguages, description: 'Language of the latest user request, or their explicit requested output language. Always supply this field; do not infer it from the host UI locale.' },
      onboarding: { type: 'boolean', description: 'Use true for installation onboarding: the maintained welcome appears above exactly three cards in the persistent conversation component. Open the right-hand template library first; detailed validation is unnecessary. Keep the three prepared curated-pool IDs in their supplied order. Use false only when the welcome was already delivered; omission retains ordinary cards-only recommendations.' } }, required: ['templateIds'], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: uri }, 'openai/ui': { preferredModelDisplayMode: 'inline' } },
  };
  return freeze({ uri, resourceVersion, tool, descriptor: { uri, name: 'OpenMotion template recommendations', mimeType: templatePresentationMime }, content, templates: manifest.templates });
}

/** Reinitialization must clear capabilities even when a previous init supported UI. */
export function negotiateTemplatePresentation(state: McpClientState | undefined, profile: string, capabilities: any): void {
  if (!state) return;
  state.presentation = undefined;
  const mimeTypes = capabilities?.extensions?.[templatePresentationCapability]?.mimeTypes;
  if (profile !== 'phase1' || process.env.OPENMOTION_TEMPLATE_CARDS === '0'
    || !Array.isArray(mimeTypes) || !mimeTypes.includes(templatePresentationMime)) return;
  try { state.presentation = loadTemplatePresentation(); }
  catch { /* Optional presentation failure must leave the domain tools available. */ }
}

export function showTemplateRecommendations(presentation: TemplatePresentation, args: { templateIds: string[]; onboarding?: boolean; language?: string }) {
  requireValue(Array.isArray(args.templateIds), 'templateIds is required');
  if (args.onboarding !== undefined && typeof args.onboarding !== 'boolean') throw new ToolInputError('onboarding must be boolean', 'onboarding', 'invalid_type');
  if (args.language !== undefined && !supportedLanguages.includes(args.language)) throw new ToolInputError('unsupported presentation language', 'language', 'invalid_enum');
  if (args.templateIds.length !== 3 || new Set(args.templateIds).size !== 3
    || args.templateIds.some(id => !supportedIds.includes(id))) throw new ToolInputError('choose three distinct approved template IDs', 'templateIds', 'invalid_combination');
  if (args.onboarding === true && args.templateIds.some(id => !(onboardingTemplateIds as readonly string[]).includes(id)))
    throw new ToolInputError('onboarding requires three distinct curated reference IDs; preserve the prepared order and accepted template during recovery', 'templateIds', 'invalid_combination');
  const cards = args.templateIds.map((templateId, index) => {
    const template = presentation.templates.find(item => item.id === templateId)!;
    const actionRequestId = randomUUID();
    const card = { position: index + 1, templateId, title: template.title, description: template.description,
      durationSeconds: template.durationSeconds, actionRequestId };
    if (template.kind === 'reference') return { ...card, templateKind: 'reference' as const };
    return { ...card,
      createArgs: { requestId: actionRequestId, projectType: 'template' as const, templateId,
        title: template.title, requirements: `Use the ${template.title} template with its unchanged sample content. Preserve its structure and animation. Do not export a video unless requested.` } };
  });
  return { schemaVersion: 1, resourceVersion: presentation.resourceVersion, recommendationId: randomUUID(), cards,
    ...(args.language !== undefined ? { language: args.language } : {}),
    ...(args.onboarding === true ? { onboarding: true as const } : {}),
    selectionGuide: 'Previewing is read-only. The Recreate template button prepares or copies an unsent brief; it never submits a task. A user-sent yes to one named recommendation accepts that exact template ID; continue without asking them to choose again. A numbered reply selects the corresponding card in this result order. If several cards were offered without one named recommendation, ask which card; a generic yes alone does not identify one. If the user delegates selection for onboarding, recommend the first card in this prepared result by name before creating. Carry the accepted ID, source and requirements into creation, route changes, retries and recovery until the user explicitly changes their selection. Rendering speed, duration or builtin availability never authorizes substitution. Follow the exact chosen template and complete submitted requirements, including requested HTML/MP4 delivery. Legacy createArgs apply only to an explicitly accepted unchanged builtin sample; never substitute them for a customized brief or reference. Call openmotion_get_template with the accepted ID and read instructions and motionDocument before choosing a workflow. If hasHtmlProject is true, follow openmotion-template-to-video and reuse the editable source, preserving unchanged content when no customization was requested. Use openmotion-recreate only for reference-only sources without an editable project. templateKind describes presentation provenance, not editable-source availability; reference cards intentionally have no builtin createArgs. If the selected source or workflow is unavailable, preserve the selection and report the blocker; do not create a different example. Reuse confirmed projects and stable operation IDs for the same intent, and reconcile an unknown write before retrying. Redisplaying cards never authorizes another project or export.' };
}
