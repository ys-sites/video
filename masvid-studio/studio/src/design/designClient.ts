import {
  designRoutes,
  type DesignComment, type DesignCommentAnchor, type DesignEditorApp, type DesignExportFormat,
  type DesignProject, type DesignProjectDetail, type DesignScenarioId, type DesignSkillSummary,
  type DesignSystemSummary, type DesignTemplateSummary, type DesignVersion,
} from '../../../shared/design-project';

export class DesignApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function makeRequestId(prefix = 'design') {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let code = 'REQUEST_FAILED';
    let message = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      if (payload?.error?.code) code = String(payload.error.code);
      if (payload?.error?.message) message = String(payload.error.message);
      else if (typeof payload?.error === 'string') message = payload.error;
    } catch { /* non-JSON error body */ }
    throw new DesignApiError(code, message, res.status);
  }
  return res.json() as Promise<T>;
}

export type DesignScenarioCatalogEntry = {
  id: DesignScenarioId; label: string; icon: string; hint: string; mode: string; entry: string;
  examples: readonly string[]; guide: string;
};

export const designClient = {
  // Catalog
  listScenarios: () => requestJson<{ scenarios: DesignScenarioCatalogEntry[] }>(designRoutes.catalogScenarios),
  listTemplates: (params: { scenario?: string; q?: string; limit?: number; cursor?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.scenario) search.set('scenario', params.scenario);
    if (params.q) search.set('q', params.q);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.cursor) search.set('cursor', params.cursor);
    const qs = search.toString();
    return requestJson<{ items: DesignTemplateSummary[]; nextCursor: string | null }>(`${designRoutes.catalogTemplates}${qs ? `?${qs}` : ''}`);
  },
  listSystems: (params: { q?: string; category?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.category) search.set('category', params.category);
    const qs = search.toString();
    return requestJson<{ systems: DesignSystemSummary[] }>(`${designRoutes.catalogSystems}${qs ? `?${qs}` : ''}`);
  },
  listSkills: (params: { scenario?: string; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.scenario) search.set('scenario', params.scenario);
    if (params.q) search.set('q', params.q);
    const qs = search.toString();
    return requestJson<{ skills: DesignSkillSummary[] }>(`${designRoutes.catalogSkills}${qs ? `?${qs}` : ''}`);
  },

  // Projects
  listProjects: (params: { scenario?: string; trashed?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (params.scenario) search.set('scenario', params.scenario);
    if (params.trashed) search.set('trashed', '1');
    const qs = search.toString();
    return requestJson<{ projects: DesignProject[] }>(`${designRoutes.projects}${qs ? `?${qs}` : ''}`);
  },
  createProject: (input: { scenario?: DesignScenarioId; title?: string; templateId?: string | null; designSystemId?: string | null; requestId?: string }) =>
    requestJson<{ project: DesignProjectDetail }>(designRoutes.projects, {
      method: 'POST',
      body: JSON.stringify({ ...input, requestId: input.requestId ?? makeRequestId('create') }),
    }),
  getProject: (id: string) => requestJson<{ project: DesignProjectDetail }>(designRoutes.project(id)),
  getState: (id: string) => requestJson<{ revision: string; versionId: string | null; openComments: number; updatedAt: number }>(designRoutes.events(id)),
  renameProject: (id: string, title: string, expectedTitle?: string) =>
    requestJson<{ project: DesignProjectDetail }>(designRoutes.project(id), {
      method: 'PATCH',
      body: JSON.stringify({ title, expectedTitle, requestId: makeRequestId('rename') }),
    }),
  duplicateProject: (id: string, title?: string) =>
    requestJson<{ project: DesignProjectDetail }>(designRoutes.projectAction(id, 'duplicate'), {
      method: 'POST',
      body: JSON.stringify({ title, requestId: makeRequestId('dup') }),
    }),
  trashProject: (id: string) =>
    requestJson<{ project: DesignProjectDetail }>(designRoutes.projectAction(id, 'trash'), {
      method: 'POST',
      body: JSON.stringify({ requestId: makeRequestId('trash') }),
    }),
  restoreProject: (id: string) =>
    requestJson<{ project: DesignProjectDetail }>(designRoutes.projectAction(id, 'restore'), {
      method: 'POST',
      body: JSON.stringify({ requestId: makeRequestId('restore') }),
    }),
  deleteProject: (id: string) =>
    requestJson<{ deletedId: string }>(`${designRoutes.project(id)}?requestId=${encodeURIComponent(makeRequestId('del'))}`, { method: 'DELETE' }),

  // Files & Versions
  readFile: (id: string, path: string, offset = 0) =>
    requestJson<{ path: string; content: string; revision: string; size: number; nextOffset: number | null }>(
      `${designRoutes.file(id, path)}${offset ? `?offset=${offset}` : ''}`,
    ),
  writeFiles: (id: string, input: { expectedRevision: string; files: { path: string; content: string }[]; deletes?: string[]; summary?: string; source?: 'manual' | 'agent'; requestId?: string }) =>
    requestJson<{ project: DesignProjectDetail; version: DesignVersion }>(designRoutes.write(id), {
      method: 'POST',
      body: JSON.stringify({ ...input, source: input.source ?? 'manual', requestId: input.requestId ?? makeRequestId('write') }),
    }),
  importAsset: (id: string, input: { expectedRevision: string; assetId: string; versionId: string; path?: string; requestId?: string }) =>
    requestJson<{ project: DesignProjectDetail; version: DesignVersion; path: string }>(designRoutes.importAsset(id), {
      method: 'POST',
      body: JSON.stringify({ ...input, requestId: input.requestId ?? makeRequestId('import-asset') }),
    }),
  listVersions: (id: string, cursor?: string) =>
    requestJson<{ versions: DesignVersion[]; currentVersionId: string | null; nextCursor: string | null }>(
      `${designRoutes.versions(id)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  restoreVersion: (id: string, versionId: string, expectedRevision: string) =>
    requestJson<{ project: DesignProjectDetail; version: DesignVersion }>(designRoutes.restore(id, versionId), {
      method: 'POST',
      body: JSON.stringify({ expectedRevision, requestId: makeRequestId('restore-ver') }),
    }),

  // Comments
  listComments: (id: string) => requestJson<{ comments: DesignComment[]; sourceRevision: string }>(designRoutes.comments(id)),
  createComment: (id: string, input: { text: string; anchor: DesignCommentAnchor; expectedRevision: string; requestId?: string }) =>
    requestJson<{ comment: DesignComment; comments: DesignComment[] }>(designRoutes.comments(id), {
      method: 'POST',
      body: JSON.stringify({ ...input, requestId: input.requestId ?? makeRequestId('comment') }),
    }),
  updateComment: (id: string, commentId: string, input: { status?: 'open' | 'resolved'; text?: string; expectedCommentRevision: number }) =>
    requestJson<{ comment: DesignComment }>(designRoutes.comment(id, commentId), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteComment: (id: string, commentId: string) =>
    requestJson<{ deletedId: string }>(designRoutes.comment(id, commentId), { method: 'DELETE' }),

  // Export, Import, Editors
  downloadExport: async (id: string, input: { format: DesignExportFormat; versionId?: string | null; filePath?: string | null }) => {
    const res = await fetch(designRoutes.exportProject(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      let code = 'EXPORT_FAILED', message = `Export failed (${res.status})`;
      try { const p = await res.json(); code = p?.error?.code ?? code; message = p?.error?.message ?? message; } catch {}
      throw new DesignApiError(code, message, res.status);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/i.exec(disposition);
    const filename = match?.[1] ?? `design.${input.format === 'open-design' ? 'zip' : input.format}`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
  },
  importZipFile: async (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return requestJson<{ projects: DesignProjectDetail[] }>(designRoutes.importProjects, { method: 'POST', body: form });
  },
  detectEditors: () => requestJson<{ editors: DesignEditorApp[] }>(designRoutes.editors),
  openIn: (id: string, editorId: string) =>
    requestJson<{ ok: true }>(designRoutes.projectAction(id, 'open-in'), {
      method: 'POST',
      body: JSON.stringify({ editorId }),
    }),
};
