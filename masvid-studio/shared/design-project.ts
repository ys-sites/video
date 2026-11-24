/**
 * Design Studio contract shared by the design-projects domain service, its HTTP adapter,
 * the public MCP tools and the Studio editor. OpenMotion runs no design agent: external
 * Agents create and iterate through the openmotion_design_* tools; Studio previews,
 * annotates, versions, exports and hands briefs to those Agents.
 */
import type { ReviewAnnotation } from './review-comments.ts';
import { guideUrl, setupGuideUrl, setupReadmeUrl, setupSkillUrl, type IntegrationInfo } from './integration.ts';

export const DESIGN_API = '/motion-api/design';
export const DESIGN_TOOL_NAMES = ['openmotion_design_catalog', 'openmotion_design_project', 'openmotion_design_edit', 'openmotion_design_comments'] as const;
export type DesignToolName = typeof DESIGN_TOOL_NAMES[number];

/** Preview mode decides editor chrome; the stored files are always plain HTML/CSS/JS/assets. */
export type DesignPreviewMode = 'html' | 'deck' | 'document' | 'webgl' | 'live';

type HtmlScenario = {
  id: string; label: string; icon: string; hint: string; mode: DesignPreviewMode; entry: string;
  /** Open Design project kind / metadata.intent for round-trip export and import. */
  openDesign: { kind: 'prototype' | 'deck' | 'other'; intent?: string };
  examples: readonly string[];
};
type LinkedScenario = { id: string; label: string; icon: string; hint: string; studio: 'motion' | 'cinema' | 'sound' | 'design-image' };

/** HTML scenarios are design projects. Linked scenarios route to the studio that already owns them. */
export const designScenarios = [
  { id: 'prototype', label: 'Prototype', icon: 'layout-line', hint: 'Interactive web and app mockups.', mode: 'html', entry: 'index.html', openDesign: { kind: 'prototype' },
    examples: ['Design a high-converting website for an AI CRM with a clear hero, feature story, proof points and trial CTA.', 'Build an analytics dashboard for a subscription business with revenue, churn and cohort views.'] },
  { id: 'mobile-app', label: 'Mobile App', icon: 'smartphone-line', hint: 'Mobile app interfaces previewed in a 390×844 phone frame.', mode: 'html', entry: 'index.html', openDesign: { kind: 'prototype', intent: 'mobile-app' },
    examples: ['Prototype a mobile fitness coaching app covering goal setup, weekly plans, workout check-ins and progress review.', 'Design an iOS personal finance app with account balance, recent transactions, budget rings and quick transfer.', 'Create a mobile travel companion app with itinerary timeline, boarding pass card and offline city tips.'] },
  { id: 'deck', label: 'Slide deck', icon: 'slideshow-line', hint: 'Presentations with speaker notes, exportable to PDF and PPTX.', mode: 'deck', entry: 'index.html', openDesign: { kind: 'deck' },
    examples: ['Design an investor pitch with market sizing, growth model, product advantage and three-year forecast data.', 'Create a 10-slide weekly product review with metrics, shipped work, risks and next steps.'] },
  { id: 'document', label: 'Document', icon: 'file-text-line', hint: 'Resumes, reports and print-ready PDFs.', mode: 'document', entry: 'index.html', openDesign: { kind: 'other', intent: 'document' },
    examples: ['Draft a one-page resume for a senior product designer with summary, experience, skills and selected work.', 'Write a two-page quarterly finance report with KPIs, charts and commentary.'] },
  { id: 'web-clone', label: 'Website clone', icon: 'global-line', hint: 'Rebuild a reference website as editable HTML.', mode: 'html', entry: 'index.html', openDesign: { kind: 'prototype', intent: 'web-clone' },
    examples: ['Website URL to clone: https://example.com — rebuild the home page as responsive, editable HTML.'] },
  { id: 'live-artifact', label: 'Live artifact', icon: 'bar-chart-box-line', hint: 'Data-backed dashboards that refresh from data.json.', mode: 'live', entry: 'index.html', openDesign: { kind: 'prototype', intent: 'live-artifact' },
    examples: ['Create a live sales dashboard driven by data.json with KPIs, a trend chart and a top-accounts table.'] },
  { id: 'webgl', label: 'WebGL', icon: 'sparkling-line', hint: 'Interactive WebGL2 experiences and shader scenes.', mode: 'webgl', entry: 'index.html', openDesign: { kind: 'prototype', intent: 'webgl-experience' },
    examples: ['Build a WebGL2 hero with a flowing particle field that reacts to the pointer and scroll.'] },
] as const satisfies readonly HtmlScenario[];

export const linkedDesignScenarios = [
  { id: 'motion-design', label: 'Motion design', icon: 'movie-line', hint: 'Editable HyperFrames motion films live in Motion Studio.', studio: 'motion' },
  { id: 'hyperframes', label: 'HyperFrames', icon: 'film-line', hint: 'Timeline HTML motion graphics live in Motion Studio.', studio: 'motion' },
  { id: 'image', label: 'Image', icon: 'image-line', hint: 'Generate or edit images in Design Studio image scenes.', studio: 'design-image' },
  { id: 'video', label: 'Video', icon: 'clapperboard-line', hint: 'Generate video clips in Cinema Studio.', studio: 'cinema' },
  { id: 'audio', label: 'Audio', icon: 'music-2-line', hint: 'Generate music and speech in Sound Studio.', studio: 'sound' },
] as const satisfies readonly LinkedScenario[];

export type DesignScenario = typeof designScenarios[number];
export type DesignScenarioId = DesignScenario['id'];
export const isDesignScenario = (value: unknown): value is DesignScenarioId => designScenarios.some(item => item.id === value);
export const findDesignScenario = (value: unknown) => designScenarios.find(item => item.id === value);

/** Same presets as Open Design. Desktop fills the pane (null = fluid). */
export const designViewports = [
  { id: 'desktop', label: 'Desktop', icon: 'computer-line', width: null, height: null },
  { id: 'tablet', label: 'Tablet', icon: 'tablet-line', width: 820, height: 1180 },
  { id: 'mobile', label: 'Mobile', icon: 'smartphone-line', width: 390, height: 844 },
] as const;
export type DesignViewportId = typeof designViewports[number]['id'];

export const designExportFormats = ['zip', 'open-design', 'html', 'pdf', 'png', 'pptx'] as const;
export type DesignExportFormat = typeof designExportFormats[number];

export type DesignProject = {
  id: string; title: string; scenario: DesignScenarioId; entry: string;
  designSystemId: string | null; templateId: string | null;
  source: 'blank' | 'template' | 'import' | 'duplicate';
  createdAt: number; updatedAt: number; trashedAt: number | null;
  /** Current content identity. */
  revision: string; versionId: string | null; versionLabel: string | null;
};
export type DesignFile = { path: string; size: number; sha256: string; kind: 'html' | 'css' | 'js' | 'json' | 'markdown' | 'text' | 'image' | 'font' | 'media' | 'other' };
export type DesignProjectDetail = DesignProject & { files: DesignFile[]; path: string; previewUrl: string; editorUrl: string; openComments: number };

export type DesignVersion = {
  id: string; label: string; number: number; createdAt: number;
  source: 'agent' | 'manual' | 'restore' | 'import' | 'create';
  summary: string | null; prompt: string | null; restoredFrom: string | null;
  entry?: string;
  files: { path: string; sha256: string; size: number }[];
};

/** Element or region annotation on a rendered HTML page. Pixel boxes are page coordinates in the given viewport. */
export type DesignCommentAnchor = {
  filePath: string;
  viewport: { id: DesignViewportId; width: number; height: number };
  slideIndex?: number;
  element?: { selector: string; elementId?: string; tagName: string; label: string; text?: string; htmlHint?: string; box: { x: number; y: number; width: number; height: number } };
  region?: { x: number; y: number; width: number; height: number };
  annotation?: ReviewAnnotation;
};
export type DesignComment = {
  id: string; projectId: string; text: string; status: 'open' | 'resolved';
  anchor: DesignCommentAnchor; sourceRevision: string; author: 'user' | 'agent';
  createdAt: number; updatedAt: number; commentRevision: number;
};

export type DesignTemplateSummary = {
  id: string; title: string; description: string; scenario: DesignScenarioId; category: string;
  tags: string[]; entry: string; previewUrl: string; examplePrompt: string | null; license: string; source: string;
};
export type DesignSystemSummary = { id: string; title: string; description: string; category: string; swatches: string[]; previewUrl: string | null };
export type DesignSkillSummary = { id: string; title: string; description: string; scenario: DesignScenarioId | null; category: string; examplePrompt: string | null };

export type DesignEditorApp = { id: string; label: string; icon: string; available: boolean };

/** HTTP adapter routes (all JSON unless stated). The Studio client and tests use these exact paths. */
export const designRoutes = {
  catalogScenarios: `${DESIGN_API}/catalog/scenarios`,            // GET
  catalogTemplates: `${DESIGN_API}/catalog/templates`,            // GET ?scenario=&q=&limit=&cursor=
  catalogTemplate: (id: string) => `${DESIGN_API}/catalog/templates/${encodeURIComponent(id)}`,
  catalogTemplatePreview: (id: string, path = '') => `${DESIGN_API}/catalog/templates/${encodeURIComponent(id)}/preview/${path}`, // GET static
  catalogSystems: `${DESIGN_API}/catalog/systems`,                // GET ?q=
  catalogSystem: (id: string) => `${DESIGN_API}/catalog/systems/${encodeURIComponent(id)}`,
  catalogSkills: `${DESIGN_API}/catalog/skills`,                  // GET ?scenario=&q=
  projects: `${DESIGN_API}/projects`,                             // GET ?scenario=&trashed=1 · POST create
  project: (id: string) => `${DESIGN_API}/projects/${id}`,        // GET detail · PATCH {title, expectedTitle} · DELETE (trashed only)
  projectAction: (id: string, action: 'duplicate' | 'trash' | 'restore' | 'open-in' | 'reveal') => `${DESIGN_API}/projects/${id}/${action}`, // POST
  file: (id: string, path: string) => `${DESIGN_API}/projects/${id}/files/${path}`,   // GET text content {path, content, revision}
  write: (id: string) => `${DESIGN_API}/projects/${id}/write`,    // POST {requestId, expectedRevision, files:[{path,content}], deletes?:[], summary?, source:'manual'}
  importAsset: (id: string) => `${DESIGN_API}/projects/${id}/import-asset`, // POST {requestId, expectedRevision, assetId, versionId, path?}
  raw: (id: string, path = '') => `${DESIGN_API}/raw/${id}/${path}`, // GET static preview (sandboxed iframe src); ?version=<id> for history
  versions: (id: string) => `${DESIGN_API}/projects/${id}/versions`, // GET
  restore: (id: string, versionId: string) => `${DESIGN_API}/projects/${id}/versions/${versionId}/restore`, // POST {requestId, expectedRevision}
  comments: (id: string) => `${DESIGN_API}/projects/${id}/comments`, // GET · POST {requestId, text, anchor, expectedRevision}
  comment: (id: string, commentId: string) => `${DESIGN_API}/projects/${id}/comments/${commentId}`, // PATCH {status|text, expectedCommentRevision} · DELETE
  exportProject: (id: string) => `${DESIGN_API}/projects/${id}/export`, // POST {format, versionId?, filePath?} → binary download
  importProjects: `${DESIGN_API}/import`,                         // POST multipart file (zip) or JSON {sourcePath}
  editors: `${DESIGN_API}/editors`,                               // GET DesignEditorApp[]
  events: (id: string) => `${DESIGN_API}/projects/${id}/state`,   // GET {revision, versionId, openComments} for cheap polling
} as const;

/** Studio editor deep link. Design projects never use the Motion #project/ hash. */
export const designEditorHref = (projectId: string) => `/design/projects/${encodeURIComponent(projectId)}`;

const fence = (value: string) => value.replace(/```/g, '`\u200b``');

export type DesignPromptIntegration = Pick<IntegrationInfo, 'previewUrl' | 'dataDirectory'> & Partial<Pick<IntegrationInfo, 'deployment' | 'templateSource' | 'templateEnvironment' | 'transport'>>;

/**
 * Self-contained MCP install/connect bootstrap block included in every Design Studio Agent
 * hand-off prompt so users who have never installed OpenMotion MCP can paste one single
 * instruction and have their Agent install/connect and continue seamlessly.
 */
function designMcpSetupLines(integration?: DesignPromptIntegration | null, locale?: string | null): string[] {
  const fullInfo = integration && 'transport' in integration && integration.transport ? (integration as IntegrationInfo) : null;
  const installGuide = setupGuideUrl(fullInfo);
  let origin: string | null = null;
  if (integration?.previewUrl) {
    try { origin = new URL(integration.previewUrl).origin; } catch { origin = integration.previewUrl; }
  }
  const connectionGuide = origin ? guideUrl({ previewUrl: origin }, 'mcp') : null;
  const isDocker = integration?.deployment?.type === 'docker';
  const zh = locale === 'zh-CN';

  if (zh) {
    return [
      'MCP 安装与接入（如果当前 Agent 尚未安装或连接 OpenMotion MCP，请先完成以下步骤再继续）：',
      '1. 先检查当前 Agent 是否已连接 openmotion MCP 服务并可见 openmotion_design_* 工具；如已连接，直接跳过安装并执行下方创作流程。',
      `2. 未连接时，先阅读 OpenMotion 主 Skill（${setupSkillUrl}）、快速开始 README（${setupReadmeUrl}）和安装指南（${installGuide}）。`,
      '3. 优先检查并复用本机已有的 OpenMotion 安装与工作区（保留已有工程、凭据及其他 MCP 配置）；仅在未安装时安装。配置并接入本机 stdio openmotion MCP 服务，重新加载工具后调用 openmotion_design_catalog（action=list_scenarios）验证连接成功后再继续。仅写入配置不代表连接成功；遇到阻碍请直接说明。',
      origin ? `- 当前 Studio 地址：${origin}` : null,
      integration?.dataDirectory ? `- 当前工作区：${integration.dataDirectory}` : null,
      connectionGuide ? `- 本机 MCP 接入指引与配置：${connectionGuide}` : null,
      isDocker && origin ? `- 容器接入配置：${origin}/connect/config?host=mcp（通过 docker exec 进入现有容器，保留当前容器和工作区，不另装宿主运行时）` : null,
    ].filter((line): line is string => line !== null);
  }

  return [
    'MCP setup (complete first if OpenMotion MCP is not yet installed or connected in this Agent):',
    '1. Check whether the `openmotion` MCP server is already connected and `openmotion_design_*` tools are available. If already connected, skip setup and continue with Workflow below.',
    `2. Otherwise, read the OpenMotion Skill (${setupSkillUrl}), Quick Start README (${setupReadmeUrl}), and installation guide (${installGuide}).`,
    '3. Reuse any existing local OpenMotion installation and workspace first (preserve existing projects, credentials and other MCP settings). Install only if missing, add/connect the local stdio `openmotion` MCP server, reload tools, and verify connection with `openmotion_design_catalog` (action=list_scenarios) before authoring. Writing config alone does not prove connection; report any blocker if tools do not load.',
    origin ? `- Studio URL: ${origin}` : null,
    integration?.dataDirectory ? `- Workspace: ${integration.dataDirectory}` : null,
    connectionGuide ? `- Live MCP connection guide & config: ${connectionGuide}` : null,
    isDocker && origin ? `- Container config: ${origin}/connect/config?host=mcp (uses docker exec in the existing container; preserve this container and do not install a second host runtime.)` : null,
  ].filter((line): line is string => line !== null);
}

/** Brief from a Design Studio scene composer, copied to an external Agent. */
export function designBriefPrompt(input: {
  scenario: DesignScenarioId;
  brief: string;
  designSystemId?: string | null;
  templateId?: string | null;
  templateIds?: string[];
  skillId?: string | null;
  skillIds?: string[];
  projectId?: string | null;
  language?: string | null;
  integration?: DesignPromptIntegration | null;
}) {
  const scenario = findDesignScenario(input.scenario)!;
  const templates = [...new Set([...(input.templateIds ?? []), ...(input.templateId ? [input.templateId] : [])])];
  const skills = [...new Set([...(input.skillIds ?? []), ...(input.skillId ? [input.skillId] : [])])];
  const primaryTemplate = templates[0] ?? null;
  return [
    `Use the OpenMotion MCP design tools to ${input.projectId ? 'update' : 'create'} a ${scenario.label.toLowerCase()} design.`,
    '',
    ...designMcpSetupLines(input.integration, input.language),
    '',
    `Scenario: ${scenario.id}`,
    input.projectId ? `Project: ${input.projectId}` : null,
    input.designSystemId ? `Brand Kit / Design system: ${input.designSystemId} (read it with openmotion_design_catalog action=get_design_system)` : null,
    skills.length > 0 ? `Design skills (${skills.length}): ${skills.join(', ')} (read each with openmotion_design_catalog action=get_skill)` : null,
    templates.length > 0 ? `Reference templates (${templates.length}): ${templates.join(', ')} (read with openmotion_design_catalog action=get_template${primaryTemplate ? `; start from ${primaryTemplate}` : ''})` : null,
    input.language ? `Reply and write visible copy in: ${input.language}` : null,
    '',
    'Brief:',
    '```text', fence(input.brief.trim()), '```',
    '',
    'Workflow:',
    '1. Read openmotion://workflow/design/start and the scenario guide, or call openmotion_design_catalog action=list_scenarios.',
    input.projectId
      ? '2. Read the project with openmotion_design_project action=get and current files with openmotion_design_edit action=read_file.'
      : `2. Create the project with openmotion_design_project action=create scenario=${scenario.id}${primaryTemplate ? ` templateId=${primaryTemplate}` : ''}${input.designSystemId ? ` designSystemId=${input.designSystemId}` : ''}.`,
    '3. Write complete HTML/CSS/JS with openmotion_design_edit action=write, passing expectedRevision and a short summary.',
    '4. Call openmotion_design_project action=open so the user can review it in the OpenMotion Design editor.',
  ].filter(line => line !== null).join('\n');
}

/** Iteration hand-off: open annotations become a hard-scoped edit request for the Agent. */
export function designCommentsPrompt(
  project: Pick<DesignProject, 'id' | 'title' | 'revision'>,
  comments: DesignComment[],
  note?: string,
  options?: { integration?: DesignPromptIntegration | null; language?: string | null },
) {
  const open = comments.filter(comment => comment.status === 'open');
  const lines = open.map((comment, index) => {
    const anchor = comment.anchor, element = anchor.element, annotation = anchor.annotation;
    return [
      `${index + 1}. [${comment.id}] file=${anchor.filePath} viewport=${anchor.viewport.id} ${anchor.viewport.width}×${anchor.viewport.height}${anchor.slideIndex !== undefined ? ` slide=${anchor.slideIndex + 1}` : ''}`,
      element ? `   target: ${element.label} <${element.tagName}> selector=${element.selector}${element.text ? ` text="${element.text.slice(0, 160)}"` : ''}` : null,
      element?.htmlHint ? `   html: ${element.htmlHint.slice(0, 240)}` : null,
      anchor.region ? `   region: x=${Math.round(anchor.region.x)} y=${Math.round(anchor.region.y)} w=${Math.round(anchor.region.width)} h=${Math.round(anchor.region.height)}` : null,
      annotation ? (() => {
        const pts = annotation.marks.flatMap(mark => mark.points);
        if (!pts.length) return `   drawing: ${annotation.marks.map(mark => mark.kind).join(', ')}`;
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        const x1 = Math.round(Math.min(...xs) * 100), y1 = Math.round(Math.min(...ys) * 100);
        const x2 = Math.round(Math.max(...xs) * 100), y2 = Math.round(Math.max(...ys) * 100);
        return `   drawing: ${annotation.marks.map(mark => mark.kind).join(', ')} bounds=${x1}%..${x2}%, ${y1}%..${y2}% (${annotation.width}×${annotation.height})`;
      })() : null,
      `   comment: ${comment.text}`,
    ].filter(Boolean).join('\n');
  });
  return [
    `Use the OpenMotion MCP design tools to revise the design project "${project.title}" (${project.id}).`,
    `Current revision: ${project.revision}`,
    '',
    ...designMcpSetupLines(options?.integration, options?.language),
    note?.trim() ? `\nRequest: ${note.trim()}` : null,
    '',
    '<attached-preview-comments>',
    'Change ONLY the elements and regions identified below. Keep everything else unchanged.',
    ...lines,
    '</attached-preview-comments>',
    '',
    'Workflow:',
    `1. openmotion_design_comments action=list projectId=${project.id} for full anchors; openmotion_design_edit action=read_file for the affected files.`,
    '2. Apply the changes with openmotion_design_edit action=write (expectedRevision above, summary listing the comment IDs).',
    '3. Mark each addressed comment resolved with openmotion_design_comments action=update status=resolved.',
    '4. Call openmotion_design_project action=open to show the updated design.',
  ].filter(line => line !== null).join('\n');
}

/** Generic "continue this project" hand-off from the editor header. */
export function designProjectPrompt(
  project: Pick<DesignProject, 'id' | 'title' | 'revision' | 'scenario'>,
  request?: string,
  options?: { integration?: DesignPromptIntegration | null; language?: string | null },
) {
  return [
    `Continue the OpenMotion design project "${project.title}" (${project.id}, scenario ${project.scenario}) with the OpenMotion MCP design tools.`,
    `Current revision: ${project.revision}`,
    '',
    ...designMcpSetupLines(options?.integration, options?.language),
    request?.trim() ? `\nRequest: ${request.trim()}` : '\nAsk me what to change, then edit it.',
    '',
    `Read it with openmotion_design_project action=get, edit with openmotion_design_edit action=write (expectedRevision), then call openmotion_design_project action=open.`,
  ].join('\n');
}
