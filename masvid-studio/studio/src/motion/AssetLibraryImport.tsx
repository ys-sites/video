import { useRef, useState } from 'react';
import type { AssetReference } from '../../../shared/asset-library';
import { AssetPicker } from './AssetBrowser';
import { assetRequest } from './assetClient';
import { useOptionalWorkspaceChrome } from './WorkspaceChromeContext';
import { useI18n } from '../i18n/I18n';
import { useToast } from '../hooks/useToast';
import { useMountEffect } from '../hooks/useMountEffect';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { RemixIcon } from '../icons/RemixIcons';
import { IconButton } from 'open-design-ui/icon-button';
import { Menu, MenuItem } from '../components/ui/Menu';

type AssetImportMenuProps = {
  projectId: string;
  importing: boolean;
  onUpload: () => void;
  onImported?: (projectId: string, paths: string[]) => Promise<void>;
};
type ImportResult = {
  projectId: string;
  status: string;
  items: { itemId: string; path?: string; status: string; error?: string }[];
};
type ImportAttempt = { requestId: string; paths?: string[] };

export function AssetImportMenu(props: AssetImportMenuProps) {
  return <ProjectAssetImportMenu key={props.projectId} {...props} />;
}

function ProjectAssetImportMenu({ projectId, importing, onUpload, onImported }: AssetImportMenuProps) {
  const { t } = useI18n(), chrome = useOptionalWorkspaceChrome(), toast = useToast();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const working = useRef(false), mounted = useRef(true);
  const errorToast = useRef<number | null>(null);
  const attempts = useRef(new Map<string, ImportAttempt>());
  useMountEffect(() => { mounted.current = true; return () => { mounted.current = false; }; });
  const pending = importing || busy;

  async function importReference(reference: AssetReference) {
    if (working.current || importing || !chrome || chrome.switchingDisabled || !onImported) return;
    working.current = true; setBusy(true);
    if (errorToast.current !== null) { toast.dismissToast(errorToast.current); errorToast.current = null; }
    const key = `${reference.assetId}/${reference.versionId}`;
    const attempt = attempts.current.get(key) ?? { requestId: crypto.randomUUID() };
    attempts.current.set(key, attempt);
    try {
      await chrome.beforeViewChange();
      if (!mounted.current) return;
      if (!attempt.paths) {
        const result = await assetRequest<ImportResult>({ action: 'import_to_project', projectId, requestId: attempt.requestId, ...reference });
        const item = result.items?.find(item => item.itemId === `library-${reference.assetId}-${reference.versionId}`);
        if (result.projectId !== projectId || result.status !== 'completed' || item?.status !== 'completed' || !item.path) {
          // A definite failure can be retried with a fresh request. Keep the
          // request identity on transport errors whose outcome is unknown.
          attempts.current.delete(key);
          throw new Error(item?.error || t('Import failed'));
        }
        attempt.paths = [item.path];
      }
      if (!mounted.current) return;
      await onImported(projectId, attempt.paths);
      if (!mounted.current) return;
      attempts.current.delete(key);
      setOpen(false);
      toast.showToast(t('Asset imported. Add it to your composition from My assets.'), 'info');
    } catch (error) {
      if (!mounted.current) return;
      errorToast.current = toast.showToast(attempt.paths
        ? t('Asset imported, but My assets could not refresh. Select the version again to retry.')
        : error instanceof Error ? error.message : t('Import failed'));
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <>
    <Menu tooltip={t(pending ? 'Importing…' : 'Import media')} modal={false} align="end" aria-label={t('Import media')} className="om-menu-panel" trigger={
      <IconButton type="button" className="shrink-0" disabled={pending || chrome?.switchingDisabled} aria-busy={pending} aria-label={t(pending ? 'Importing…' : 'Import media')}
        icon={<RemixIcon name={pending ? 'loader-4-line' : 'upload-2-line'} size={16} className={pending ? 'animate-spin motion-reduce:animate-none' : undefined} />} />
    }>
      <MenuItem onClick={onUpload}><span className="om-menu-label"><RemixIcon name="upload-2-line" size={16} />{t('Upload from computer')}</span></MenuItem>
      {chrome && onImported && <MenuItem onClick={() => setOpen(true)}><span className="om-menu-label"><RemixIcon name="folder-open-line" size={16} />{t('Import from asset library')}</span></MenuItem>}
    </Menu>
    {open && chrome && <AssetPicker title="Import from asset library" confirmLabel="Import selected version" busyLabel="Importing…" busy={busy} onClose={() => { if (!working.current) setOpen(false); }} onPick={reference => { void importReference(reference); }} />}
    <StudioToastViewport {...toast} />
  </>;
}
