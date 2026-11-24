import { Tooltip } from "../components/ui/Tooltip";
import { useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { useWorkspaceChrome } from './WorkspaceFrame';
import { reportEdit } from './editorTracking';

export function WorkspaceProject() {
  const { t } = useI18n();
  const { workspace, switchingDisabled } = useWorkspaceChrome();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const project = workspace.projects.find(item => item.id === workspace.status?.projectId);
  const editingRef = useRef(false);
  const savingRef = useRef(false);
  const displayedTitle = editing ? title : project?.title || '';
  const finishEditing = () => { editingRef.current = false; setEditing(false); };
  const saveTitle = async () => {
    if (!editingRef.current || savingRef.current) return;
    const nextTitle = title.trim() || t('Untitled');
    if (!project || nextTitle === project.title) { finishEditing(); return; }
    savingRef.current = true;
    try {
      // The committed rename, not each keystroke; the title itself is never reported.
      const renamed = Boolean(await workspace.rename(project.id, nextTitle));
      reportEdit('project_rename', 'header', renamed, project.id);
      if (renamed) finishEditing();
    }
    finally { savingRef.current = false; }
  };
  return <span className="motion-project-control om-app-project-title">
    <span className="motion-project-name-measure" aria-hidden="true">{displayedTitle || t(project ? 'Untitled' : 'Connecting…')}</span>
    <Tooltip label={project?.title || t('Untitled')} wrap><input
      className="om-inline-input motion-project-name-input"
      maxLength={100}
      aria-label={t('Project name')}
      value={displayedTitle}
      placeholder={t(project ? 'Untitled' : 'Connecting…')}
      disabled={workspace.busy || switchingDisabled || !project}
      onFocus={() => {
        if (editingRef.current) return;
        setTitle(project?.title || '');
        editingRef.current = true;
        setEditing(true);
      }}
      onChange={event => setTitle(event.target.value)}
      onBlur={() => void saveTitle()}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finishEditing();
          event.currentTarget.blur();
        }
      }}
    /></Tooltip>
  </span>;
}

