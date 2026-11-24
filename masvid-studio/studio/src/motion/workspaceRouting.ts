import { editorProjectIdFromPath } from '../../../shared/spa-routes';
import { parseProjectIdFromHash } from '../utils/projectRouting';
import { sessionPath } from '../../../shared/workspace-url';

export const projectHref = (id: string) => {
  const encoded = encodeURIComponent(id);
  return `/editor/${encoded}#project/${encoded}`;
};
export const sessionHref = (id: string, projectId?: string, openArtifact = false) => sessionPath(id, projectId, { openArtifact });
export const validWorkspaceProject = (id: string) => /^(?:project|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(id);

/** Semantic `/editor/:id`, hash links from MCP, and legacy query links all address the same project. */
export function requestedProject(search: string, hash: string, pathname = ''): string | null {
  const pathId = pathname ? editorProjectIdFromPath(pathname) : null;
  if (pathId !== null) return pathId;
  const query = new URLSearchParams(search).get('project');
  return query ?? parseProjectIdFromHash(hash) ?? (hash.startsWith('#project/') ? '' : null);
}
