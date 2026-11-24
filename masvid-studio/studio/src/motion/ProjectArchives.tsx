import { IconButton } from 'open-design-ui/icon-button';
import * as tracking from './pageTracking';
import { useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Menu, MenuItem } from '../components/ui/Menu';
import { Checkbox } from '../components/ui/Checkbox';
import { Button } from 'open-design-ui/button';
import { Popover } from '../components/ui/Popover';
import { Tabs, TabsList, Tab, TabPanel } from '../components/ui/Tabs';
import { Skeleton } from '../components/ui/Skeleton';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { SettingsDialog } from './settingsPrimitives';
import { motionApi, type useWorkspace } from './useWorkspace';
import { PROJECT_ARCHIVE_LIMITS, PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE } from '../../../shared/project-archive';
import type { ProjectLocation, ProjectManagementInput } from '../../../shared/project-management';

type Workspace = ReturnType<typeof useWorkspace>;
type ExportResult = { downloadUrl: string; filename: string; projects: { projectId: string }[] };
type LifecycleAction = 'trash' | 'restore' | 'delete';
type ProjectTarget = { projectId: string; title: string };
type LifecycleRequest = ProjectTarget & { requestId: string };
type RenameDraft = { projectId: string; title: string; expectedTitle: string; returnFocus: HTMLElement | null };
const manage = <T,>(input: ProjectManagementInput) => motionApi<T>('/phase1/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'openmotion_manage_project', arguments: input }) });
type ProjectMenuActions = {
  locked: boolean;
  exportProject: (projectId?: string) => Promise<void>;
  beginRename: (projectId: string, title: string, trigger: HTMLElement | null) => Promise<void>;
  projectAction: (action: 'duplicate' | 'info' | 'reveal' | 'trash' | 'restore' | 'delete', projectId: string, title: string, trigger?: HTMLElement | null) => Promise<void>;
};

export function useProjectArchives(workspace: Workspace, waitForSaves: () => Promise<void>, disabled: boolean, onManagerOpen: () => void) {
  const { t } = useI18n();
  const archiveErrorMessage = (error: unknown) => {
    const message = (error as Error).message;
    return message.startsWith(PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE)
      ? t('Project validation is temporarily unavailable. Try again when OpenMotion is ready.')
      : message;
  };
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const acting = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [name, setName] = useState('');
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'projects' | 'trash'>('projects');
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [deleteDraft, setDeleteDraft] = useState<{ projects: ProjectTarget[]; returnFocus?: HTMLElement | null } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const showManager = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTab('projects'); setSelection(new Set()); setOpened(true); onManagerOpen();
    tracking.reportProjectsPageView(Boolean(workspace.status?.projectId));
  };
  const chooseImport = () => input.current?.click();
  const download = (result: ExportResult) => {
    const link = document.createElement('a');
    link.href = result.downloadUrl; link.download = result.filename;
    document.body.append(link); link.click(); link.remove();
  };
  const exportProject = (projectId?: string) => exportProjects(projectId ? [projectId] : undefined);
  async function exportProjects(projectIds?: string[], requestId = crypto.randomUUID()) {
    if (acting.current || disabled) return;
    acting.current = true; setBusy('export');
    try {
      await waitForSaves();
      const result = await motionApi<ExportResult>('/phase1/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        name: 'openmotion_project_archive', arguments: { action: 'export', requestId, ...(projectIds ? { projectIds } : { all: true }) },
      }) });
      download(result);
      // The archive service may skip projects (an uninitialised default); report what the ZIP holds.
      tracking.reportProjectManage('export', 'success', Array.isArray(result.projects) ? result.projects.length : projectIds?.length ?? workspace.projects.length);
      toast.showToast(t('Project ZIP ready'), 'info', 'feedback', { label: t('Download'), key: requestId, onClick: () => download(result) });
    } catch (error) {
      tracking.reportProjectManage('export', 'failure', projectIds?.length ?? workspace.projects.length);
      toast.showToast(t('Could not export projects: {message}', { message: archiveErrorMessage(error) }), 'error', 'feedback',
        { label: t('Retry'), key: requestId, onClick: () => exportProjects(projectIds, requestId) });
    } finally { acting.current = false; setBusy(null); }
  }
  async function importProject(file: File, requestId = crypto.randomUUID()) {
    if (acting.current || disabled) return;
    if (!file.name.toLowerCase().endsWith('.zip') || file.size > PROJECT_ARCHIVE_LIMITS.bytes) {
      toast.showToast(t('Choose a ZIP file up to 500 MB.'), 'error', 'feedback'); return;
    }
    acting.current = true; setBusy('import');
    try {
      const result = await motionApi<{ projects: { projectId: string }[] }>('/project-archives/import?requestId=' + requestId,
        { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
      workspace.retryConnection();
      tracking.reportProjectManage('import', 'success', result.projects.length);
      setQuery('');
      if (!opened) showManager();
      toast.showToast(t('Imported {count} projects as new copies.', { count: result.projects.length }), 'info', 'feedback');
    } catch (error) {
      tracking.reportProjectManage('import', 'failure', 0);
      const message = archiveErrorMessage(error);
      if (message.startsWith('INVALID_PROJECT_ARCHIVE')) {
        // Keep the actionable server reason visible. It is already bounded and
        // sanitized by the archive service; hiding it made valid HyperFrames
        // packages indistinguishable from corrupted downloads.
        const detail = message.replace(/^INVALID_PROJECT_ARCHIVE:\s*/, '').replace(/\s+/g, ' ').slice(0, 240);
        toast.showToast(t('Could not import projects: {message}', { message: detail || t('This ZIP is damaged or does not contain a supported project.') }), 'error', 'feedback',
          { label: t('Import projects'), key: requestId, onClick: chooseImport });
      } else {
        toast.showToast(t('Could not import projects: {message}', { message }), 'error', 'feedback',
          { label: t('Retry'), key: requestId, onClick: () => importProject(file, requestId) });
      }
    } finally { acting.current = false; setBusy(null); }
  }
  async function beginRename(projectId: string, title: string, trigger: HTMLElement | null) {
    if (acting.current || disabled) return;
    acting.current = true; setBusy('info');
    try {
      const info = await manage<ProjectLocation>({ action: 'info', projectId });
      setName(info.titleKey ? t(info.titleKey) : info.title); setRenameDraft({ projectId, title, expectedTitle: info.title, returnFocus: trigger });
    } catch (error) { toast.showToast(t('Project action failed: {message}', { message: (error as Error).message }), 'error', 'feedback'); }
    finally { acting.current = false; setBusy(null); }
  }
  async function renameProject(draft: RenameDraft, title: string, requestId = crypto.randomUUID()) {
    if (acting.current || disabled) return;
    if (!title.trim() || title.trim().length > 100 || /[\x00-\x1f]/.test(title)) {
      toast.showToast(t('Use a project name with 1–100 characters.'), 'error', 'feedback'); return;
    }
    acting.current = true; setBusy('rename');
    try {
      await manage({ action: 'rename', projectId: draft.projectId, title: title.trim(), expectedTitle: draft.expectedTitle, requestId });
      workspace.retryConnection(); setRenameDraft(null);
      tracking.reportProjectManage('rename', 'success', 1);
      toast.showToast(t('Project renamed'), 'info', 'feedback');
    } catch (error) {
      tracking.reportProjectManage('rename', 'failure', 1);
      const conflict = (error as Error).message.startsWith('PROJECT_NAME_CONFLICT');
      toast.showToast(conflict ? t('The project name changed. Reload it before renaming.') : t('Project action failed: {message}', { message: (error as Error).message }), 'error', 'feedback',
        { label: t('Retry'), key: requestId, onClick: () => conflict ? beginRename(draft.projectId, title, draft.returnFocus) : renameProject(draft, title, requestId) });
    } finally { acting.current = false; setBusy(null); }
  }
  async function projectAction(action: 'duplicate' | 'info' | 'reveal' | LifecycleAction, projectId: string, title: string, trigger?: HTMLElement | null) {
    if (acting.current || disabled) return;
    const targets = [{ projectId, title }];
    if (action === 'delete') { setDeleteDraft({ projects: targets, returnFocus: trigger }); return; }
    if (action === 'trash' || action === 'restore') return runLifecycle(action, targets);
    await performProjectAction(action, projectId, title);
  }
  const runLifecycle = (action: LifecycleAction, projects: ProjectTarget[]) => {
    if (action === 'trash' && workspace.projects.every(project => projects.some(target => target.projectId === project.id))) {
      toast.showToast(t('Keep at least one project outside Trash.'), 'error', 'feedback');
      return;
    }
    return applyLifecycle(action, projects.map(project => ({ ...project, requestId: crypto.randomUUID() })));
  };
  async function applyLifecycle(action: LifecycleAction, requests: LifecycleRequest[]) {
    if (acting.current || disabled || !requests.length) return;
    acting.current = true; setBusy(action);
    const completed = new Set<string>(), failed: LifecycleRequest[] = [];
    let fallback: string | undefined, failure: string | undefined;
    const current = workspace.status?.projectId;
    try {
      await waitForSaves();
      // Move the displayed project last so the fallback cannot be another selected row.
      const ordered = action === 'trash' ? [...requests].sort((a, b) => Number(a.projectId === current) - Number(b.projectId === current)) : requests;
      for (const request of ordered) {
        try {
          const result = await manage<{ activeProjectId: string }>({ action, projectId: request.projectId, requestId: request.requestId });
          completed.add(request.projectId);
          if (action === 'trash' && request.projectId === current) fallback = result.activeProjectId;
        } catch (error) {
          failed.push(request);
          failure ??= (error as Error).message;
        }
      }
    } catch (error) {
      failed.push(...requests);
      failure = (error as Error).message;
    } finally {
      acting.current = false; setBusy(null);
      workspace.retryConnection();
    }
    tracking.reportProjectManage(action, failed.length === 0 ? 'success' : completed.size ? 'partial' : 'failure', requests.length, failed.length);
    if (completed.size) {
      setSelection(previous => new Set([...previous].filter(id => !completed.has(id))));
      if (!failed.length) toast.showToast(t(requests.length > 1 ? 'Projects updated: {count}' : action === 'trash' ? 'Project moved to trash' : action === 'restore' ? 'Project restored' : 'Project permanently deleted', { count: completed.size }), 'info', 'feedback');
    }
    if (failed.length) {
      const message = completed.size
        ? t('Updated {count}; {failed} failed: {message}', { count: completed.size, failed: failed.length, message: failure ?? '' })
        : t('Project action failed: {message}', { message: failure ?? '' });
      toast.showToast(message, 'error', 'feedback', { label: t('Retry'), key: requests[0].requestId, onClick: () => applyLifecycle(action, failed) });
    }
    if (fallback && fallback !== current) workspace.followActiveProject(fallback);
  }
  async function performProjectAction(action: 'duplicate' | 'info' | 'reveal', projectId: string, title: string, requestId = crypto.randomUUID()) {
    if (acting.current || disabled) return;
    acting.current = true; setBusy(action);
    try {
      if (action === 'duplicate') {
        await waitForSaves();
        const result = await manage<{ projectId: string }>({ action, projectId, requestId, title: t('{title} (copy)', { title: title.slice(0, 80) }).slice(0, 100) });
        workspace.retryConnection();
        toast.showToast(t('Project duplicated'), 'info', 'feedback', { label: t('Open project'), key: requestId, onClick: () => { void workspace.open('projects', result.projectId).then(open => { if (open) setOpened(false); }); } });
      } else {
        const info = await manage<ProjectLocation>({ action, projectId });
        if (action === 'info') await navigator.clipboard.writeText(info.path);
        toast.showToast(t(action === 'info' ? 'Project path copied' : 'Opened in file manager'), 'info', 'feedback');
      }
      tracking.reportProjectManage(action === 'info' ? 'copy_path' : action, 'success', 1);
    } catch (error) {
      tracking.reportProjectManage(action === 'info' ? 'copy_path' : action, 'failure', 1);
      toast.showToast(t('Project action failed: {message}', { message: archiveErrorMessage(error) }), 'error', 'feedback',
        { label: t('Retry'), key: requestId, onClick: () => performProjectAction(action, projectId, title, requestId) });
    } finally { acting.current = false; setBusy(null); }
  }
  const locked = disabled || Boolean(busy);
  const actions: ProjectMenuActions = { locked, exportProject, beginRename, projectAction };
  const catalog = tab === 'trash' ? workspace.trashedProjects : workspace.projects;
  const filter = query.trim().toLocaleLowerCase();
  const visible = catalog.filter(project => project.title.toLocaleLowerCase().includes(filter));
  const selected = catalog.filter(project => selection.has(project.id)).map(({ id, title }) => ({ projectId: id, title }));
  const visibleSelected = visible.filter(project => selection.has(project.id)).length;
  const allVisibleSelected = visible.length > 0 && visibleSelected === visible.length;
  const toggleSelection = (ids: string[], checked: boolean) => setSelection(previous => {
    const next = new Set(previous);
    for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
    return next;
  });
  const loading = !workspace.status && !workspace.error && !workspace.projects.length;
  const manager = <>
    <input ref={input} type="file" accept=".zip,application/zip" hidden aria-label={t('Import projects')} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (file) void importProject(file);
    }} />
    <StudioToastViewport {...toast} />
    {opened && <SettingsDialog title={t('All projects')} className="om-project-manager-dialog" onClose={() => setOpened(false)} returnFocus={returnFocus.current}>
      <Tabs value={tab} onValueChange={value => { tracking.reportProjectsClick('manager_tab', { manager_tab: value === 'trash' ? 'trash' : 'projects' }); setTab(value as typeof tab); setSelection(new Set()); setQuery(''); }} className="om-project-manager">
        <div className="om-project-manager-toolbar">
          <TabsList aria-label={t('All projects')}><Tab value="projects">{t('Projects')}</Tab><Tab value="trash">{t('Trash')}</Tab></TabsList>
          {tab === 'projects' && <div className="om-settings-actions">
            <Button variant="ghost" className="om-button h-auto" data-primary disabled={locked} onClick={() => { tracking.reportProjectsClick('import_projects'); chooseImport(); }}><RemixIcon name="upload-2-line" size={16} />{t(busy === 'import' ? 'Importing…' : 'Import projects')}</Button>
            <Popover modal={false} align="end" aria-label={t('Import help')} className="om-project-import-help"
              trigger={<IconButton variant="ghost" type="button" className="motion-icon-button" aria-label={t('Import help')} icon={<RemixIcon name="question-line" size={18} />} />}>
              <h3 className="om-subtitle">{t('Start with a HyperFrames project')}</h3>
              <p className="om-muted">{t('Zip your HyperFrames project folder with its source and local assets, then choose Import projects to continue editing in OpenMotion.')}</p>
              <p className="om-muted">{t('OpenMotion or HyperFrames ZIP · Up to 500 MB. Local assets are included; linked online resources still need the internet.')}</p>
            </Popover>
          </div>}
        </div>
        <TabPanel key={tab} value={tab} className="om-project-manager-panel">
          <label className="om-field"><RemixIcon name="search-line" size={16} /><input type="search" aria-label={t('Search all projects')} placeholder={t('Search projects…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="om-project-manager-toolbar om-project-selection">
            <div className="om-settings-actions">
              <Checkbox aria-label={t('Select visible projects')} checked={allVisibleSelected} mixed={visibleSelected > 0 && !allVisibleSelected} disabled={locked || !visible.length} onCheckedChange={checked => toggleSelection(visible.map(project => project.id), checked)} />
              <span className="om-muted" aria-live="polite">{t('{count} selected', { count: selected.length })}</span>
              {selected.length > 0 && <Button variant="ghost" size="sm" disabled={locked} onClick={() => setSelection(new Set())}>{t('Clear project selection')}</Button>}
            </div>
            <div className="om-settings-actions">
              {tab === 'projects' ? <>
                <Button variant="ghost" className="om-button h-auto" disabled={locked || !catalog.length} onClick={() => { tracking.reportProjectsClick('export_projects', { selection_count: selected.length }); void exportProjects(selected.length ? selected.map(project => project.projectId) : undefined); }}>{t(busy === 'export' ? 'Exporting…' : selected.length ? 'Export selected' : 'Export all projects')}</Button>
                <Button variant="ghost" className="om-button h-auto" disabled={locked || !selected.length} onClick={() => void runLifecycle('trash', selected)}>{t('Move to trash')}</Button>
              </> : <>
                <Button variant="ghost" className="om-button h-auto" disabled={locked || !selected.length} onClick={() => void runLifecycle('restore', selected)}>{t('Restore')}</Button>
                <Button variant="danger" disabled={locked || !selected.length} onClick={event => setDeleteDraft({ projects: selected, returnFocus: event.currentTarget })}>{t('Delete permanently')}</Button>
              </>}
            </div>
          </div>
          <div className="om-project-manager-list" aria-label={t(tab === 'trash' ? 'Trash' : 'Project list')} aria-busy={loading || Boolean(busy)}>
            {loading && [0, 1, 2].map(id => <Skeleton key={id} style={{ height: 'var(--motion-control)' }} />)}
            {workspace.error && !catalog.length && !workspace.status ? <div className="om-empty"><p className="om-muted">{t('Check your connection and try again.')}</p><Button variant="ghost" className="om-button h-auto" onClick={workspace.retryConnection}>{t('Retry')}</Button></div>
              : !loading && !visible.length && <p className="om-muted">{t(filter ? 'No matching projects' : tab === 'trash' ? 'Trash is empty' : 'Create a project with your Agent to start editing.')}</p>}
            {visible.map(project => <div className="om-project-manager-row om-nav-row" key={project.id} data-active={tab === 'projects' && workspace.status?.projectId === project.id}>
              <Checkbox aria-label={t('Select {title}', { title: project.title })} checked={selection.has(project.id)} disabled={locked} onCheckedChange={checked => toggleSelection([project.id], checked)} />
              {tab === 'projects'
                ? <Button variant="plain" className="om-nav-item om-nav-row-link" disabled={locked} onClick={() => { void workspace.open('projects', project.id).then(open => { if (open) setOpened(false); }); }}><span className="truncate">{project.title}</span></Button>
                : <span className="om-project-trashed-label truncate" title={project.title}>{project.title}</span>}
              <ProjectArchiveMenu projectId={project.id} title={project.title} trashed={tab === 'trash'} archives={actions} />
            </div>)}
          </div>
        </TabPanel>
      </Tabs>
      {deleteDraft && <SettingsDialog title={t('Delete permanently?')} onClose={() => setDeleteDraft(null)} returnFocus={deleteDraft.returnFocus}>
        <div className="om-project-edit-form">
          <p className="om-muted">{deleteDraft.projects.length === 1
            ? t('This permanently deletes “{title}” and its local files.', { title: deleteDraft.projects[0].title })
            : t('This permanently deletes {count} selected projects and their local files.', { count: deleteDraft.projects.length })}</p>
          <div className="om-settings-actions"><Button variant="ghost" type="button" className="om-button h-auto" onClick={() => setDeleteDraft(null)}>{t('Cancel')}</Button>
            <Button type="button" variant="danger" disabled={locked} onClick={() => { const { projects } = deleteDraft; setDeleteDraft(null); void runLifecycle('delete', projects); }}>{t('Delete permanently')}</Button></div>
        </div>
      </SettingsDialog>}
    </SettingsDialog>}
    {renameDraft && <SettingsDialog title={t('Rename project')} onClose={() => setRenameDraft(null)} returnFocus={renameDraft.returnFocus}>
      <form className="om-project-edit-form" onSubmit={event => { event.preventDefault(); void renameProject(renameDraft, name); }}>
        <label className="om-label">{t('Project name')}<span className="om-field"><input autoFocus maxLength={100} value={name} disabled={locked} onFocus={event => event.target.select()} onChange={event => setName(event.target.value)} /></span></label>
        <div className="om-settings-actions"><Button variant="ghost" type="button" className="om-button h-auto" onClick={() => setRenameDraft(null)}>{t('Cancel')}</Button><Button variant="ghost" className="om-button h-auto" data-primary disabled={locked || !name.trim()}>{t(busy === 'rename' ? 'Saving…' : 'Save')}</Button></div>
      </form>
    </SettingsDialog>}
  </>;
  return { ...actions, open: opened, busy, showManager, chooseImport, manager };
}

export type ProjectArchiveActions = ReturnType<typeof useProjectArchives>;
export function ProjectArchiveMenu({ projectId, title, trashed = false, archives }: { projectId: string; title: string; trashed?: boolean; archives: ProjectMenuActions }) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const revealLabel = /Mac/i.test(navigator.platform) ? 'Reveal in Finder' : /Win/i.test(navigator.platform) ? 'Show in File Explorer' : 'Show in file manager';
  return <Menu modal={false} align="end" presentation="panel" aria-label={t('Actions for {title}', { title })} trigger={<IconButton variant="plain" ref={trigger} type="button" className="motion-icon-button om-nav-row-action" disabled={archives.locked} aria-label={t('Actions for {title}', { title })} icon={<RemixIcon name="more-2-line" size={16} />} />}>
    {trashed ? <>
      <MenuItem icon={<RemixIcon name="history-line" size={14} />} onClick={() => void archives.projectAction('restore', projectId, title)}>{t('Restore project')}</MenuItem>
      <MenuItem icon={<RemixIcon name="delete-bin-line" size={14} />} tone="danger" onClick={() => void archives.projectAction('delete', projectId, title, trigger.current)}>{t('Delete permanently')}</MenuItem>
    </> : <>
      <MenuItem icon={<RemixIcon name="edit-line" size={14} />} onClick={() => void archives.beginRename(projectId, title, trigger.current)}>{t('Rename project')}</MenuItem>
      <MenuItem icon={<RemixIcon name="file-copy-line" size={14} />} onClick={() => void archives.projectAction('duplicate', projectId, title)}>{t('Duplicate project')}</MenuItem>
      <MenuItem icon={<RemixIcon name="download-2-line" size={14} />} onClick={() => void archives.exportProject(projectId)}>{t('Export project')}</MenuItem>
      <MenuItem icon={<RemixIcon name="folder-open-line" size={14} />} onClick={() => void archives.projectAction('reveal', projectId, title)}>{t(revealLabel)}</MenuItem>
      <MenuItem icon={<RemixIcon name="clipboard-line" size={14} />} onClick={() => void archives.projectAction('info', projectId, title)}>{t('Copy path')}</MenuItem>
      <MenuItem icon={<RemixIcon name="delete-bin-line" size={14} />} tone="danger" onClick={() => void archives.projectAction('trash', projectId, title)}>{t('Move to trash')}</MenuItem>
    </>}
  </Menu>;
}
