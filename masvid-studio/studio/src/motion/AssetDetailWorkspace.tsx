import { Button } from 'open-design-ui/button';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { assetMediaUrl, assetVersion, type AssetReference, type LibraryAsset } from '../../../shared/asset-library';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { AssetPreview } from './AssetBrowser';
import { ResizablePane } from './ResizablePane';
import { Tooltip } from '../components/ui/Tooltip';

function formatAssetSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes, unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  // Promote values that would round up to the next unit as well.
  if (Number(size.toFixed(2)) >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${Number(size.toFixed(2))} ${units[unit]}`;
}

function AssetNameEditor({ name, saving, onRename }: { name: string; saving: boolean; onRename: (name: string) => Promise<boolean | void> }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(name), [pending, setPending] = useState(false), [overflow, setOverflow] = useState(false);
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), label = useRef<HTMLSpanElement>(null);
  const finished = useRef(true), submitting = useRef(false), restoreFocus = useRef(false);
  useEffect(() => { setDraft(name); setEditing(false); finished.current = true; }, [name]);
  useEffect(() => {
    if (editing) { input.current?.focus({ preventScroll: true }); input.current?.select(); }
    else if (restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus({ preventScroll: true }); }
  }, [editing]);
  useEffect(() => {
    const element = label.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { observer.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [name, editing]);
  const finish = (focus: boolean) => { finished.current = true; restoreFocus.current = focus; setEditing(false); };
  const save = async (focus: boolean) => {
    if (finished.current || submitting.current || saving) return;
    const next = draft.trim();
    if (!next || next === name) { finish(focus); return; }
    submitting.current = true; setPending(true);
    try { if (await onRename(next) !== false) finish(focus); }
    catch { /* The update handler owns failure feedback; retain the draft for retry. */ }
    finally { submitting.current = false; setPending(false); }
  };
  return <div className="om-asset-name" aria-busy={pending}>
    {editing ? <label className="om-field"><input ref={input} aria-label={t('Asset name')} maxLength={200} value={draft} readOnly={saving || pending}
      onChange={event => setDraft(event.target.value)} onBlur={() => void save(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void save(true); }
        if (event.key === 'Escape' && !submitting.current) { event.preventDefault(); event.stopPropagation(); finish(true); }
      }} /></label>
      : <h2 className="om-subtitle" aria-label={name}><Tooltip label={name} disabled={!overflow} wrap withinDialog><Button variant="plain" ref={trigger} className="om-nav-item om-asset-name-display" aria-label={t('Rename')} disabled={saving}
        onClick={() => { setDraft(name); finished.current = false; setEditing(true); }}>
        <span ref={label}>{name}</span><RemixIcon name="edit-line" size={16} />
      </Button></Tooltip></h2>}
  </div>;
}

function AssetVersionAction({ label, icon, primary = false, onClick }: { label: string; icon: ReactNode; primary?: boolean; onClick: () => void }) {
  const text = useRef<HTMLSpanElement>(null), [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = text.current!;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { observer.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [label]);
  return <Tooltip label={label} disabled={!overflow} wrap withinDialog><Button variant="ghost" className="om-button h-auto" data-primary={primary || undefined} onClick={onClick}>{icon}<span className="om-asset-version-action-label" ref={text}>{label}</span></Button></Tooltip>;
}

function AssetVersionItem({ preview, selected, onSelect, children }: { preview: ReactNode; selected: boolean; onSelect: () => void; children: ReactNode }) {
  const details = useRef<HTMLSpanElement>(null), [previewSize, setPreviewSize] = useState<number>();
  useLayoutEffect(() => {
    const element = details.current!;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) setPreviewSize(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <Button variant="plain" className="om-nav-item om-asset-version" aria-pressed={selected} onClick={onSelect}
    style={previewSize ? { '--asset-version-preview-size': `${previewSize}px` } as CSSProperties : undefined}>
    {preview}<span ref={details}>{children}</span>{selected && <RemixIcon name="check-line" size={14} />}
  </Button>;
}

export function AssetDetailWorkspace({ asset, versionId, active, uploading, saving = false, navigation, editor, taskControls, backLabel, modelDisplayName, voiceName, durationLabel, editLabel, onBack, onVersion, onUpdate, onEdit, onReference, onFirstFrame, onOpenReference, onUpload, onDownload }: {
  asset: LibraryAsset; versionId: string; active: boolean; uploading: boolean; saving?: boolean; navigation: ReactNode; editor?: ReactNode; taskControls?: ReactNode;
  backLabel?: string; modelDisplayName?: string; voiceName?: string; durationLabel?: string; editLabel?: string;
  onBack: () => void; onVersion: (id: string) => void;
  onUpdate: (changes: Record<string, unknown>) => Promise<boolean | void>; onEdit: () => void; onFirstFrame?: () => void; onReference?: () => void;
  onOpenReference: (reference: AssetReference) => void; onUpload: () => void; onDownload: () => void;
}) {
  const { t, formatDate } = useI18n();
  const editing = Boolean(editor);
  const viewer = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = viewer.current!;
    const observer = new ResizeObserver(() => {
      if (!element.getClientRects().length) element.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause());
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const version = assetVersion(asset, versionId) ?? assetVersion(asset)!;
  const number = asset.versions.findIndex(v => v.id === version.id) + 1;
  const update = async (changes: Record<string, unknown>) => { if (!saving) await onUpdate(changes); };
  return <section className="om-asset-workspace" aria-label={t('Asset preview')} data-editing={editing}>
    <header className="om-asset-workspace-header">
      <Button variant="plain" className="om-nav-item" onClick={onBack}><RemixIcon name="arrow-left-line" size={16} />{backLabel ?? t('All assets')}</Button>
      <Tooltip label={asset.name} wrap><strong>{asset.name}</strong></Tooltip><span className="om-badge">V{number}</span>
      <div className="om-asset-workspace-actions">{taskControls}<a className="om-button" href={assetMediaUrl(asset.id, version.id) + '?download=1'} download onClick={onDownload}><RemixIcon name="download-2-line" size={15} />{t('Download')}</a></div>
    </header>
    <div className="om-asset-workspace-body">
      <ResizablePane className="om-asset-filmstrip om-surface-divider" storageKey="motion-asset-filmstrip-width" initial={150} min={112} max={280} edge="right" label={t('Resize asset navigation')}>
        {navigation}
      </ResizablePane>
      <main ref={viewer} className="om-asset-viewer">
        <div className="om-asset-viewer-stage">{active && <AssetPreview key={`${asset.id}/${version.id}`} asset={asset} version={version} controls autoPlay />}</div>
        <footer className="om-asset-viewer-caption om-muted"><span>{version.width && version.height ? `${version.width} × ${version.height}` : version.mimeType}</span><span>{formatAssetSize(version.bytes)}</span><span>V{number}{version.id === asset.currentVersionId ? ` · ${t('Current')}` : ''}</span></footer>
      </main>
      <ResizablePane className="om-asset-inspector-pane" storageKey="motion-asset-inspector-width" initial={360} min={280} max={600} edge="left" label={t('Resize asset details')}>
        {editor ?? <aside className="om-asset-inspector" aria-label={t('Asset details')}>
          <AssetNameEditor key={asset.id} name={asset.name} saving={saving} onRename={name => onUpdate({ name })} />
          <dl className="om-asset-metadata"><dt>{t('Created')}</dt><dd>{formatDate(version.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</dd>{durationLabel && <><dt>{t('Duration')}</dt><dd>{durationLabel}</dd></>}<dt>{t('Format')}</dt><dd>{version.mimeType}</dd><dt>{t('Source')}</dt><dd>{t(version.source === 'upload' ? 'Local upload' : 'AI generated')}</dd>{version.model && <><dt>{t('Generation model')}</dt><dd>{modelDisplayName ?? version.model}</dd></>}{voiceName && <><dt>{t('Voice')}</dt><dd>{voiceName}</dd></>}{version.parentVersionId && <><dt>{t('Based on')}</dt><dd>V{asset.versions.findIndex(v => v.id === version.parentVersionId) + 1}</dd></>}</dl>
          {version.prompt && <section className="om-asset-provenance"><h3 className="om-eyebrow">{t('Prompt')}</h3><p>{version.prompt}</p></section>}
          {version.parameters && Object.keys(version.parameters).length > 0 && <details className="om-asset-provenance"><summary className="om-nav-item">{t('Generation settings')}</summary><pre>{JSON.stringify(version.parameters, null, 2)}</pre></details>}
          {version.references.length > 0 && <section className="om-asset-provenance"><h3 className="om-eyebrow">{t('References')}</h3>{version.references.map(ref => <Button variant="plain" className="om-nav-item" key={`${ref.assetId}/${ref.versionId}`} onClick={() => onOpenReference(ref)}><RemixIcon name="links-line" size={14} />{t('View reference')} · {ref.assetId.slice(0, 8)}</Button>)}</section>}
          {!asset.trashedAt && <div className="om-asset-version-actions"><AssetVersionAction label={editLabel ?? t('Edit as new version')} icon={<RemixIcon name="sparkling-line" size={16} />} primary onClick={onEdit} />{onReference && <AssetVersionAction label={t('Use as reference')} icon={<RemixIcon name="add-line" size={16} />} onClick={onReference} />}{onFirstFrame && <AssetVersionAction label={t('Use as first frame')} icon={<RemixIcon name="film-line" size={16} />} onClick={onFirstFrame} />}</div>}
          <section className="om-asset-versions" aria-label={t('Version history')}><div className="om-asset-inspector-title"><h3 className="om-subtitle">{t('Version history')}</h3><span className="om-eyebrow">{asset.versions.length}</span></div>
            <div className="om-asset-version-list">{[...asset.versions].reverse().map((item, i) => <AssetVersionItem key={item.id} preview={<AssetPreview asset={asset} version={item} />} selected={item.id === version.id} onSelect={() => onVersion(item.id)}><strong>V{asset.versions.length - i}{item.id === asset.currentVersionId && <span className="om-badge">{t('Current')}</span>}</strong><small>{formatDate(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</small><small>{t(item.source === 'upload' ? 'Local upload' : 'AI generated')}{item.parentVersionId ? ` · ${t('Based on')} V${asset.versions.findIndex(v => v.id === item.parentVersionId) + 1}` : ''}</small></AssetVersionItem>)}</div>
            {version.id !== asset.currentVersionId && <Button variant="ghost" className="om-button h-auto" disabled={saving} onClick={() => void update({ currentVersionId: version.id })}><RemixIcon name="history-line" size={15} />{t('Make current version')}</Button>}
          </section>
          <div className="om-asset-inspector-footer">{!asset.trashedAt && <Button variant="plain" className="om-nav-item" disabled={uploading} onClick={onUpload}><RemixIcon name="upload-2-line" size={15} />{t('Upload new version')}</Button>}<Button variant="plain" className="om-nav-item" disabled={saving} onClick={() => void update({ trashed: !asset.trashedAt })}><RemixIcon name={asset.trashedAt ? 'history-line' : 'delete-bin-line'} size={15} />{t(asset.trashedAt ? 'Restore asset' : 'Move to trash')}</Button></div>
        </aside>}
      </ResizablePane>
    </div>
  </section>;
}
