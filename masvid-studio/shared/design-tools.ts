/**
 * Public MCP tool schemas for OpenMotion Design Studio.
 * Pure, browser-safe schema definitions imported by shared/phase1-tools.ts and WebMCP.
 * Server-side execution lives in design-projects.ts (dispatchDesignTool).
 */
import { designExportFormats, designScenarios } from './design-project.ts';

const read = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const revision = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const id = { type: 'string', minLength: 1, maxLength: 128 };
const relPath = { type: 'string', minLength: 1, maxLength: 240 };
const scenarioEnum = { enum: designScenarios.map(s => s.id) };

const anchorSchema = obj({
  filePath: relPath,
  viewport: obj({
    id: { enum: ['desktop', 'tablet', 'mobile'] },
    width: { type: 'number', minimum: 1, maximum: 16384 },
    height: { type: 'number', minimum: 1, maximum: 16384 },
  }, ['id', 'width', 'height']),
  slideIndex: { type: 'integer', minimum: 0, maximum: 1000 },
  element: obj({
    selector: { type: 'string', minLength: 1, maxLength: 500 },
    elementId: { type: 'string', minLength: 1, maxLength: 200 },
    tagName: { type: 'string', minLength: 1, maxLength: 64 },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    text: { type: 'string', maxLength: 1000 },
    htmlHint: { type: 'string', maxLength: 1000 },
    box: obj({
      x: { type: 'number', minimum: -1e6, maximum: 1e6 },
      y: { type: 'number', minimum: -1e6, maximum: 1e6 },
      width: { type: 'number', minimum: 0, maximum: 1e6 },
      height: { type: 'number', minimum: 0, maximum: 1e6 },
    }, ['x', 'y', 'width', 'height']),
  }, ['selector', 'tagName', 'label', 'box']),
  region: obj({
    x: { type: 'number', minimum: -1e6, maximum: 1e6 },
    y: { type: 'number', minimum: -1e6, maximum: 1e6 },
    width: { type: 'number', minimum: 0, maximum: 1e6 },
    height: { type: 'number', minimum: 0, maximum: 1e6 },
  }, ['x', 'y', 'width', 'height']),
  annotation: { type: 'object', additionalProperties: true },
}, ['filePath', 'viewport']);

export const designTools = [
  {
    name: 'openmotion_design_catalog',
    title: 'OpenMotion · Design Catalog',
    description: 'Read-only discovery for Design Studio HTML scenarios (prototype, deck, document, web-clone, live-artifact, webgl), starter templates, design systems (DESIGN.md + tokens.css), design Skills and craft rules. Read openmotion://workflow/design/start and the chosen scenario guide before authoring a new design project.',
    inputSchema: obj({
      action: { enum: ['list_scenarios', 'list_templates', 'get_template', 'list_skills', 'get_skill', 'list_design_systems', 'get_design_system', 'get_craft'] },
      id: { type: 'string', minLength: 1, maxLength: 128, description: 'Template, skill, design-system or craft document id.' },
      scenario: scenarioEnum,
      category: { type: 'string', minLength: 1, maxLength: 80 },
      q: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      cursor: { type: 'string', maxLength: 40 },
      referencePath: relPath,
    }, ['action']),
    annotations: read,
  },
  {
    name: 'openmotion_design_project',
    title: 'OpenMotion · Design Project',
    description: 'Create, inspect, organize, preview, open in a local app, export (zip, open-design round-trip zip, standalone html, pdf, png, pptx) and import (Open Design / Claude Design / OpenMotion ZIP or folder) HTML Design Studio projects. Call action=open after editing so the user gets the live previewUrl and Studio editorUrl. Export with outputPath writes the artifact to disk; delete requires the project to be in Trash first.',
    inputSchema: obj({
      action: { enum: ['create', 'list', 'get', 'rename', 'duplicate', 'trash', 'restore', 'delete', 'open', 'open_in', 'export', 'import'] },
      projectId: uuid,
      requestId: id,
      scenario: scenarioEnum,
      title: { type: 'string', minLength: 1, maxLength: 120 },
      expectedTitle: { type: 'string', minLength: 1, maxLength: 120 },
      templateId: id,
      designSystemId: id,
      trashed: { type: 'boolean' },
      editorId: { type: 'string', minLength: 1, maxLength: 40, description: 'Local app id for open_in (cursor, vscode, windsurf, zed, antigravity, webstorm, xcode, finder, terminal, warp).' },
      format: { enum: [...designExportFormats] },
      versionId: uuid,
      filePath: relPath,
      outputPath: { type: 'string', minLength: 1, maxLength: 1000, description: 'Optional local destination path for export.' },
      sourcePath: { type: 'string', minLength: 1, maxLength: 1000, description: 'Local ZIP file or project folder path for import.' },
    }, ['action']),
    annotations: destructive,
  },
  {
    name: 'openmotion_design_edit',
    title: 'OpenMotion · Design Edit',
    description: 'Read and edit files in an HTML Design Studio project with revision protection and version history. Always read the project first (openmotion_design_project action=get) to obtain current expectedRevision. Every action=write atomically persists files and creates a new immutable vN version snapshot. action=restore_version restores an older snapshot as a NEW version without erasing history. action=import_asset copies a pinned workspace asset version (assetId+versionId from openmotion_assets_use) into the project as a binary file and returns its project-relative path for use in HTML; requires expectedRevision; creates a new version.',
    inputSchema: obj({
      action: { enum: ['read_file', 'write', 'list_versions', 'restore_version', 'import_asset'] },
      projectId: uuid,
      requestId: id,
      expectedRevision: revision,
      assetId: uuid,
      path: relPath,
      offset: { type: 'integer', minimum: 0, maximum: 50_000_000 },
      limit: { type: 'integer', minimum: 1, maximum: 500_000 },
      files: {
        type: 'array', minItems: 1, maxItems: 100,
        items: obj({ path: relPath, content: { type: 'string' } }, ['path', 'content']),
      },
      deletes: { type: 'array', maxItems: 100, items: relPath },
      entry: relPath,
      summary: { type: 'string', maxLength: 300 },
      prompt: { type: 'string', maxLength: 4000 },
      versionId: uuid,
      cursor: { type: 'string', maxLength: 40 },
    }, ['action', 'projectId']),
    annotations: write,
  },
  {
    name: 'openmotion_design_comments',
    title: 'OpenMotion · Design Comments',
    description: 'List, create, resolve/update and delete element or region review annotations on an HTML Design Studio project. When revising from user annotations, call action=list for full anchors, read and edit only the marked elements via openmotion_design_edit, then mark each addressed comment status=resolved using its commentRevision.',
    inputSchema: obj({
      action: { enum: ['list', 'create', 'update', 'delete'] },
      projectId: uuid,
      requestId: id,
      expectedRevision: revision,
      commentId: uuid,
      expectedCommentRevision: { type: 'integer', minimum: 1, maximum: 1_000_000 },
      text: { type: 'string', minLength: 1, maxLength: 4000 },
      status: { enum: ['open', 'resolved'] },
      anchor: anchorSchema,
    }, ['action', 'projectId']),
    annotations: write,
  },
] as const;
