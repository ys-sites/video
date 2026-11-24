const legacyAssetActions = ['list', 'get', 'import', 'update', 'generate', 'jobs', 'status', 'cancel', 'retry_save', 'resume', 'import_to_project'] as const;
export const assetActions = [...legacyAssetActions, 'read', 'brand_kit', 'transcript', 'scenario'] as const;
const actionSets = {
  openmotion_game_trailer: ['start', 'status'],
  openmotion_assets_use: assetActions,
  openmotion_assets: legacyAssetActions,
  openmotion_media_use: ['inspect', 'reference', 'models', 'generate', 'status', 'cancel', 'retry_save', 'resume'],
  openmotion_open_preview: ['open', 'record_review', 'record_display', 'begin', 'complete_generation'],
  openmotion_export_request: ['request', 'record_review'],
  openmotion_project_archive: ['export', 'import'],
  openmotion_manage_project: ['comments', 'info', 'rename', 'duplicate', 'reveal', 'trash', 'restore', 'delete'],
  openmotion_design_catalog: ['list_scenarios', 'list_templates', 'get_template', 'list_skills', 'get_skill', 'list_design_systems', 'get_design_system', 'get_craft'],
  openmotion_design_project: ['create', 'list', 'get', 'rename', 'duplicate', 'trash', 'restore', 'delete', 'open', 'open_in', 'export', 'import'],
  openmotion_design_edit: ['read_file', 'write', 'list_versions', 'restore_version', 'import_asset'],
  openmotion_design_comments: ['list', 'create', 'update', 'delete'],
} as const;
const targets = ['project', 'templates', 'providers'] as const;
export const toolDimensions = { action: [...new Set(Object.values(actionSets).flat())], target: targets } as const;

export function toolInputFields(tool: string, input: unknown) {
  const args = input && typeof input === 'object' && !Array.isArray(input) ? input as { action?: unknown; target?: unknown } : {};
  const actions: readonly typeof toolDimensions.action[number][] = Object.hasOwn(actionSets, tool) ? actionSets[tool as keyof typeof actionSets] : [];
  const defaultAction = tool === 'openmotion_export_request' ? 'request' : tool === 'openmotion_open_preview' ? 'open' : undefined;
  const action = actions.find(value => value === (args.action === undefined ? defaultAction : args.action));
  const target = tool === 'openmotion_open_preview'
    ? targets.find(value => value === (args.target === undefined ? 'project' : args.target)) : undefined;
  return { ...(action ? { action } : {}), ...(target ? { target } : {}) };
}

export const validationRules = ['missing', 'invalid_type', 'invalid_enum', 'invalid_format', 'out_of_range', 'unknown_field', 'invalid_combination'] as const;
// Keep the ingress allowlist independent of the app and its schema implementation.
const invalidFields = [
  'operation', 'commentId', 'expectedCommentRevision', 'text', 'status', 'anchor', 'anchor.scope',
  'anchor.compositionPath', 'anchor.time', 'anchor.element', 'anchor.element.handle', 'anchor.element.sourceFile',
  'anchor.element.label', 'anchor.element.tagName', 'anchor.element.hfId', 'anchor.element.domId',
  'anchor.element.selector', 'anchor.element.selectorIndex', 'anchor.element.text', 'anchor.element.box',
  'anchor.element.box.x', 'anchor.element.box.y', 'anchor.element.box.width', 'anchor.element.box.height',
  'anchor.annotation', 'anchor.annotation.version', 'anchor.annotation.coordinateSpace', 'anchor.annotation.width',
  'anchor.annotation.height', 'anchor.annotation.marks', 'anchor.annotation.marks[]', 'anchor.annotation.marks[].kind',
  'anchor.annotation.marks[].text', 'anchor.annotation.marks[].points', 'anchor.annotation.marks[].points[]',
  'anchor.annotation.marks[].points[].x', 'anchor.annotation.marks[].points[].y',
  'action', 'all', 'arguments', 'assetId', 'assetNames', 'assetNames[]', 'assetNames[].name',
  'assetNames[].path', 'audio', 'brandKit', 'brandKit.catalogId', 'brandKit.expectedUpdatedAt', 'brandKit.file',
  'brandKit.file.data', 'brandKit.file.name', 'brandKit.kitId', 'brandKit.name', 'brandKit.operation',
  'brandKit.query', 'brandKit.remove', 'brandKit.requestId', 'brandKit.rules', 'brandKit.rules[]', 'brandKit.style',
  'brandKit.style.background', 'brandKit.style.bodyFont', 'brandKit.style.foreground', 'brandKit.style.gradient',
  'brandKit.style.headingFont', 'brandKit.style.onPrimary', 'brandKit.style.primary', 'brandKit.style.radius',
  'brandKit.style.surface', 'brandKit.url', 'changes', 'changes.currentVersionId', 'changes.name',
  'changes.trashed', 'compositionPath', 'conversationId', 'cursor', 'display', 'display.contentVerified',
  'display.evidence', 'display.hostStatus', 'display.hostTabId', 'display.previewUrl', 'display.revision',
  'display.versionId', 'display.visibility', 'duration', 'embedded', 'entry', 'expectedRevision',
  'expectedRevisions', 'expectedTitle', 'expectedVersionId', 'exportJobId', 'file', 'file.length',
  'file.offset', 'file.path', 'files', 'files[]', 'files[].content', 'files[].path', 'generation',
  'includeVideo', 'items', 'items[]', 'items[].itemId', 'items[].licensePath', 'items[].name',
  'items[].sourcePath', 'jobId', 'language', 'limit', 'modality', 'mode', 'model', 'name', 'namingLanguage',
  'offset', 'onboarding', 'parameters', 'parentVersionId', 'presentation', 'projectId', 'projectIds',
  'projectIds[]', 'projectType', 'prompt', 'provider', 'query', 'referenceAsset', 'referenceUrl',
  'referenceVideoId', 'references', 'references[]', 'references[].assetId', 'references[].versionId', 'refresh',
  'requestId', 'requirements', 'review', 'review.conclusion', 'review.evidence', 'review.objectId',
  'review.range', 'review.range.end', 'review.range.start', 'review.source', 'review.versionId', 'sessionId',
  'sort', 'source', 'sourcePath', 'start', 'summary', 'target', 'templateId', 'templateIds', 'templateIds[]',
  'timestamps', 'timestamps[]', 'title', 'transcript', 'transcript.captionSettings',
  'transcript.captionSettings.pacing', 'transcript.captionSettings.position',
  'transcript.captionSettings.preset', 'transcript.captionSettings.scale', 'transcript.captionSettings.visible',
  'transcript.command', 'transcript.compositionPath', 'transcript.expectedRevision',
  'transcript.expectedTranscriptRevision', 'transcript.expectedVersionId', 'transcript.format',
  'transcript.jobId', 'transcript.language', 'transcript.model', 'transcript.parameters',
  'transcript.playbackRate', 'transcript.projectId', 'transcript.remove', 'transcript.requestId',
  'transcript.segments', 'transcript.segments[]', 'transcript.segments[].end', 'transcript.segments[].id',
  'transcript.segments[].speaker', 'transcript.segments[].start', 'transcript.segments[].text',
  'transcript.segments[].words', 'transcript.segments[].words[]', 'transcript.segments[].words[].end',
  'transcript.segments[].words[].start', 'transcript.segments[].words[].text', 'transcript.sourceEnd',
  'transcript.sourcePath', 'transcript.sourceStart', 'transcript.subtitles', 'transcript.textKind',
  'transcript.timelineStart', 'transcript.transcriptId', 'trash', 'trashed', 'unknown_field', 'versionId',
  'workId',
  'id', 'scenario', 'category', 'q', 'referencePath', 'designSystemId', 'editorId', 'format', 'filePath',
  'outputPath', 'path', 'deletes', 'deletes[]', 'anchor.filePath', 'anchor.viewport', 'anchor.viewport.id',
  'anchor.viewport.width', 'anchor.viewport.height', 'anchor.slideIndex', 'anchor.element.elementId',
  'anchor.element.htmlHint', 'anchor.region', 'anchor.region.x', 'anchor.region.y', 'anchor.region.width',
  'anchor.region.height',
  'scenario.command', 'scenario.runId', 'scenario.expectedRevision', 'scenario.requestId', 'scenario.scenarioId',
  'scenario.includeArchived', 'scenario.offset', 'scenario.limit', 'scenario.title', 'scenario.locale',
  'scenario.brief', 'scenario.changes', 'scenario.changes.title', 'scenario.changes.archived',
  'scenario.changes.activeStepId', 'scenario.changes.label', 'scenario.changes.tags', 'scenario.changes.tags[]',
  'scenario.changes.pinned', 'scenario.stepId', 'scenario.status', 'scenario.draft', 'scenario.bindings',
  'scenario.activeIterationId', 'scenario.iterationNote', 'scenario.iterationNote.iterationId',
  'scenario.iterationNote.note', 'scenario.items', 'scenario.items[]', 'scenario.items[].ref',
  'scenario.items[].label', 'scenario.items[].tags', 'scenario.items[].tags[]', 'scenario.items[].stepId',
  'scenario.items[].source', 'scenario.poolItemId', 'scenario.iteration', 'scenario.iteration.source',
  'scenario.iteration.prompt', 'scenario.iteration.settings', 'scenario.iteration.inputs',
  'scenario.iteration.inputs[]', 'scenario.iteration.outputs', 'scenario.iteration.outputs[]',
  'scenario.iteration.note', 'scenario.iterationId', 'scenario.modality', 'scenario.model', 'scenario.mode',
  'scenario.prompt', 'scenario.parameters', 'scenario.referencePoolItemIds', 'scenario.referencePoolItemIds[]',
  'scenario.scene', 'scenario.templateId', 'scenario.designProjectId', 'scenario.expectedDesignRevision',
  'scenario.target', 'scenario.alt', 'scenario.projectType', 'scenario.requirements', 'scenario.poolItemIds',
  'scenario.poolItemIds[]', 'scenario.projectId', 'scenario.stepIds', 'scenario.stepIds[]',
  'scenario.activeOnly', 'scenario.includeStandaloneHtml', 'scenario.includeMotionSource',
] as const;
export const toolErrorCodes = [
  'COMMENT_TARGET_NOT_FOUND', 'COMMENT_NOT_FOUND', 'COMMENT_CONFLICT', 'COMMENT_LIMIT', 'NOT_FOUND', 'UNSUPPORTED',
  'INVALID_ARGUMENT', 'VERSION_CONFLICT', 'PROJECT_NOT_BOUND', 'PROJECT_NOT_FOUND', 'PROJECT_SESSION_MISMATCH',
  'REQUEST_ID_CONFLICT', 'REQUEST_STATE_UNKNOWN', 'MCP_TOOL_NOT_EXPOSED', 'EXPORT_BUSY', 'EXPORT_NOT_FOUND',
  'EXPORT_NOT_COMPLETED', 'TEMPLATE_NOT_FOUND', 'TEMPLATE_NOT_EDITABLE', 'SOURCE_BATCH_TOO_LARGE',
  'INVALID_FILE_TYPE_OR_RESERVED_PATH', 'PROJECT_VALIDATION_FAILED', 'VERSION_NOT_FOUND',
  'WORK_CLOSED', 'WORK_NOT_FOUND', 'WORK_VERSION_MISMATCH', 'WORK_GENERATION_UNTRACKED', 'GENERATION_CONTENT_UNCHANGED',
  'GENERATION_ARTIFACT_INVALID', 'VERSION_NOT_RESTORABLE', 'REVIEW_VERSION_MISMATCH', 'REVIEW_OBJECT_MISMATCH',
  'PREVIEW_TARGET_MISMATCH', 'NATIVE_RUNTIME_NOT_READY', 'EDITOR_RUNTIME_INCOMPATIBLE', 'RUNTIME_NOT_READY',
  'SESSION_NOT_FOUND', 'PROJECT_TRASHED', 'INVALID_CURSOR', 'INVALID_PROJECT_ARCHIVE', 'PROJECT_ARCHIVE_TOO_LARGE',
  'TEMPLATE_NOT_COPYABLE', 'INVALID_REFERENCE_URL', 'INVALID_REVIEW_RANGE', 'UNSUPPORTED_TEXT_TYPE',
  'INVALID_FILE_OFFSET', 'INVALID_UTF8_OFFSET', 'READ_WINDOW_TOO_SMALL', 'TRANSCRIPT_CONFLICT',
  'PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE', 'PROJECT_NOT_READY', 'REVEAL_UNAVAILABLE', 'GENERATION_NOT_FOUND',
  'ASSET_JOB_NOT_FOUND', 'ASSET_NOT_FOUND', 'ASSET_VERSION_NOT_FOUND', 'ASSET_IMPORT_FAILED', 'DUPLICATE_ITEM_ID',
  'FINAL_VIDEO_NOT_READY', 'TEMPLATE_PRESENTATION_INVALID', 'WEBMCP_TRANSPORT_ERROR', 'WEBMCP_CALL_FAILED',
  'STUDIO_TOOL_BLOCKED', 'STUDIO_TOOL_INTERNAL', 'ABORTED', 'TOOL_FAILED',
] as const;
export const toolFailureDimensions = { error_code: toolErrorCodes, invalid_field: invalidFields, validation_rule: validationRules } as const;

export function trackingError(error: unknown) {
  const explicit = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const code = typeof explicit === 'string' ? explicit : error instanceof Error ? /^([A-Z_]+)(?::|$)/.exec(error.message)?.[1] : undefined;
  return toolErrorCodes.find(value => value === code) ?? 'TOOL_FAILED';
}

export function toolFailureFields(error: unknown) {
  const error_code = trackingError(error);
  if (error_code === 'INVALID_ARGUMENT' && error && typeof error === 'object') {
    const fields = error as { invalid_field?: unknown; validation_rule?: unknown };
    const invalid_field = invalidFields.find(value => value === fields.invalid_field);
    const validation_rule = validationRules.find(value => value === fields.validation_rule);
    if (invalid_field && validation_rule) return { error_code, invalid_field, validation_rule };
  }
  return { error_code };
}

export const assetImportErrorCodes = ['ATTACHMENT_NOT_READABLE', 'ASSET_TOO_LARGE_OR_NOT_FILE', 'INVALID_MEDIA',
  'ITEM_ID_CONFLICT', 'ASSET_NOT_IN_CURRENT_VERSION', 'ASSET_CONTENT_CHANGED', 'FONT_LICENSE_REQUIRES_FONT'] as const;

export function assetImportError(error: unknown) {
  const explicit = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].some(value => value === explicit)) return 'ATTACHMENT_NOT_READABLE';
  const code = explicit ?? (error instanceof Error ? /^([A-Z_]+)(?::|$)/.exec(error.message)?.[1] : undefined);
  return assetImportErrorCodes.find(value => value === code) ?? trackingError(error);
}

export const exportFailureStages = ['queued', 'lint', 'render', 'output', 'verification', 'finalize', 'unknown'] as const;
export const exportFailureCodes = ['EXPORT_LINT_FAILED', 'EXPORT_RENDER_FAILED', 'EXPORT_RENDER_TIMEOUT',
  'EXPORT_OUTPUT_MISSING', 'EXPORT_OUTPUT_INVALID', 'EXPORT_VERIFICATION_FAILED', 'EXPORT_VERIFICATION_BLOCKED',
  'EXPORT_FINALIZE_FAILED', 'EXPORT_DEADLINE_EXCEEDED', 'EXPORT_WORKER_INTERRUPTED', 'EXPORT_FAILED'] as const;

export type ExportFailure = { failureStage: typeof exportFailureStages[number]; failureCode: typeof exportFailureCodes[number] };
