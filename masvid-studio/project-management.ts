import { reviewComments } from './review-comments.ts';
import { ToolInputError } from './shared/tool-input-error.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat } from 'node:fs/promises';
import { WorkspaceStore } from './workspace.ts';
import { duplicateProject } from './project-archive.ts';
import type { ProjectLocation, ProjectManagementInput } from './shared/project-management.ts';

const execute = promisify(execFile);
export function projectRevealCommand(directory: string, platform: string) {
  if (platform === 'darwin') return { command: '/usr/bin/open', args: ['-R', directory] };
  if (platform === 'win32') return { command: 'explorer.exe', args: ['/select,', directory] };
  if (platform === 'linux') return { command: 'xdg-open', args: [directory] };
  throw new Error('REVEAL_UNAVAILABLE: This platform has no supported file manager');
}

/** One implementation for Studio and MCP; caller paths never reach the launcher. */
export async function manageProject(store: WorkspaceStore, input: ProjectManagementInput, runtimeRoot?: string,
  launch = async (command: string, args: string[]) => { await execute(command, args, { timeout: 10_000, windowsHide: true }); }) {
  if (input.action === 'comments') return reviewComments(store, input);
  if (input.action === 'trash' || input.action === 'restore' || input.action === 'delete') {
    if (!input.requestId || !/^[\w-]{1,100}$/.test(input.requestId)) throw new ToolInputError('Stable requestId required', 'requestId', input.requestId ? 'invalid_format' : 'missing');
    return input.action === 'trash' ? store.trashProject(input.projectId, input.requestId)
      : input.action === 'restore' ? store.restoreProject(input.projectId, input.requestId) : store.deleteProject(input.projectId, input.requestId);
  }
  const scoped = store.forProject(input.projectId, input.action === 'info');
  const project = store.projectCatalog().projects.find(item => item.id === input.projectId)!;
  const info: ProjectLocation = { projectId: project.id, title: project.title, titleKey: project.titleKey, path: scoped.projectDirectory, platform: process.platform };
  if (input.action === 'info') return info;
  if (input.action === 'rename' || input.action === 'duplicate') {
    if (!input.requestId || !/^[\w-]{1,100}$/.test(input.requestId)) throw new ToolInputError('Stable requestId required', 'requestId', input.requestId ? 'invalid_format' : 'missing');
    if (input.action === 'duplicate') return duplicateProject(store, { ...input, requestId: input.requestId }, runtimeRoot);
    if (typeof input.expectedTitle !== 'string') throw new ToolInputError('Read info and supply expectedTitle before renaming', 'expectedTitle', 'missing');
    const catalog = await store.renameProject(input.projectId, input.title!, { requestId: input.requestId, expectedTitle: input.expectedTitle });
    const updated = catalog.projects.find(item => item.id === project.id)!;
    return { ...info, title: updated.title, titleKey: updated.titleKey };
  }
  if (input.action !== 'reveal') throw new ToolInputError('Unknown project action', 'action', 'invalid_enum');
  const directory = await lstat(info.path).catch(() => null);
  if (!directory?.isDirectory() || directory.isSymbolicLink()) throw new Error('PROJECT_NOT_READY: Project directory is unavailable');
  const { command, args } = projectRevealCommand(info.path, process.platform);
  try { await launch(command, args); }
  catch { throw new Error('REVEAL_UNAVAILABLE: Could not open the local file manager'); }
  return { ...info, revealed: true };
}
