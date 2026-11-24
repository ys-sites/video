/** Portable source packages, separate from rendered-video exports. */
export const PROJECT_ARCHIVE_LIMITS = { bytes: 500_000_000, files: 5000, projects: 100 } as const;
export const PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE = 'PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE';
export type ProjectArchiveInput = {
  action: 'export' | 'import'; requestId: string; projectIds?: string[]; all?: boolean;
  expectedRevisions?: Record<string, string>; sourcePath?: string;
};
export const projectArchiveTool = {
  name: 'openmotion_project_archive', title: 'OpenMotion · Project Archive',
  description: 'Share editable projects offline as ZIP packages. List projects first with openmotion_get_project. Export explicit projectIds or all=true; optionally pin expectedRevisions. Validates the finished ZIP with the same rules as import before returning an immutable local ZIP path and download URL with current sources, local assets, fonts and Studio editing metadata. Excludes credentials, conversations, history, caches and renders. Import an absolute local ZIP sourcePath, either an OpenMotion package or a HyperFrames composition folder with index.html; hyperframes.json, meta.json or project.json markers are supported and optional for index-only compositions. Validate paths, sizes, checksums and native composition structure before adding independent projects; never overwrite or automatically open them. Stable requestId deduplicates retries. Limits: 500 MB archive and expanded content, 5000 files, 100 projects. Remote URLs remain external dependencies; importing does not fetch them or run package scripts.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    action: { enum: ['export', 'import'] }, requestId: { type: 'string', pattern: '^[\\w-]{1,100}$' },
    projectIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', pattern: '^(project|[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})$' } },
    all: { type: 'boolean' }, expectedRevisions: { type: 'object', additionalProperties: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    sourcePath: { type: 'string', minLength: 1, maxLength: 4096 },
  }, required: ['action', 'requestId'] },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
