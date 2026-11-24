import { useRef, useState } from 'react';
import type { ManualImportBatch } from '../../hooks/manualImportResults';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { Button } from 'open-design-ui/button';

type Props = {
  batch: ManualImportBatch;
  onReplace: (batchId: string, files: { itemId: string; file: File }[]) => Promise<string[]>;
  onReload: (batchId: string) => Promise<void>;
  onReveal?: (paths: string[]) => void;
  onRetryPending?: () => Promise<string[]>;
};
const labels = { pending: 'Waiting', imported: 'Imported', failed: 'Not imported', unknown: 'Result unknown' };
const icons = { pending: 'time-line', imported: 'check-line', failed: 'error-warning-line', unknown: 'question-line' } as const;

/** In-memory result of this selection, separate from the project's asset list.
 * Recovery uses fresh selections only; a list refresh never replays an upload. */
export function ManualImportResults({ batch, onReplace, onReload, onReveal, onRetryPending }: Props) {
  const { t } = useI18n();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [selected, setSelected] = useState(new Map<string, File>());
  const failed = batch.items.filter(item => item.status === 'failed');
  const unknown = batch.items.some(item => item.status === 'unknown');
  const loading = batch.busy || batch.listing === 'loading';
  const replacements = failed.flatMap(item => {
    const file = selected.get(item.id);
    return file ? [{ itemId: item.id, file }] : [];
  });
  async function submitReplacements() {
    if (!replacements.length || loading) return;
    await onReplace(batch.id, replacements);
    setSelected(previous => new Map([...previous].filter(([id]) => !replacements.some(item => item.itemId === id))));
  }
  return <section aria-label={t('This upload')} className="mb-2 rounded-md border border-border bg-surface p-2 text-step-11 text-text-1">
    <div className="flex items-start gap-2">
      <RemixIcon name="upload-2-line" size={14} className="mt-0.5 shrink-0 text-text-2" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{t('This upload')}</h3>
        <p>{t('Imported {added}/{total} files', { added: batch.paths.length, total: batch.items.length })}</p>
        {failed.length > 0 && <p className="text-text-2">{t('Needs attention: {count}', { count: failed.length })}</p>}
        {batch.paths.length > 0 && <p className="text-text-2">{t('Not added to the timeline.')}</p>}
      </div>
    </div>
    <details className="mt-2" open>
      <summary className="cursor-pointer text-text-2">{t('File results')}</summary>
      <ul className="mt-2 space-y-2">
        {batch.items.map(item => <li key={item.id} className="min-w-0 border-t border-border pt-2">
          <div className="flex items-start gap-1.5">
            <RemixIcon name={icons[item.status]} size={14} className="shrink-0 text-text-2" />
            <div className="min-w-0 flex-1">
              <p className="break-all font-medium">{item.name}</p>
              <p className="text-text-2">{t(labels[item.status])}</p>
              {item.path && item.path !== item.name && <p className="break-all text-text-2">{item.path}</p>}
              {item.reason && <p className="text-text-2">{t(item.reason)}</p>}
              {item.status === 'failed' && <div className="mt-1 space-y-1">
                <input ref={element => { if (element) inputs.current.set(item.id, element); else inputs.current.delete(item.id); }} type="file" accept="video/*,image/*,audio/*,font/*" className="hidden" aria-label={t('Choose replacement for {name}', { name: item.name })} disabled={loading}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) setSelected(previous => new Map(previous).set(item.id, file));
                    event.target.value = '';
                  }} />
                <Button size="sm" variant="secondary" disabled={loading} onClick={() => inputs.current.get(item.id)?.click()}>{t('Choose replacement')}</Button>
                {selected.get(item.id) && <p className="break-all text-text-2">{t('Selected: {name}', { name: selected.get(item.id)!.name })}</p>}
              </div>}
            </div>
          </div>
        </li>)}
      </ul>
    </details>
    {batch.diagnostic && <details className="mt-2 text-text-2"><summary className="cursor-pointer">{t('Upload details')}</summary><p className="break-all">{t('Project: {id}', { id: batch.projectId })}</p><p className="break-all">{batch.diagnostic}</p></details>}
    {batch.listing === 'failed' && batch.paths.length > 0 && <p className="mt-2 text-text-2">{t('Files were imported, but the asset list could not reload.')}</p>}
    {unknown && <p className="mt-2 text-text-2">{t('Checking the list does not confirm which files belong to this upload. Unknown files will not be uploaded again.')}</p>}
    {failed.length > 0 && <p className="mt-2 text-text-2">{t('Choose a replacement for each failed file, then submit. Imported files are kept.')}</p>}
    <div className="mt-2 flex flex-wrap gap-1.5">
      {replacements.length > 0 && <Button size="sm" variant="primary" loading={batch.busy} disabled={batch.listing === 'loading'} onClick={() => { void submitReplacements(); }}>{t('Import selected replacements')}</Button>}
      {(unknown || batch.listing === 'failed') && <Button size="sm" loading={batch.listing === 'loading'} disabled={batch.busy} onClick={() => { void onReload(batch.id); }}>{t(unknown ? 'Check project assets' : 'Reload assets')}</Button>}
      {onReveal && batch.paths.length > 0 && batch.listing === 'ready' && <Button size="sm" disabled={batch.busy} onClick={() => onReveal(batch.paths)}>{t('View imported assets')}</Button>}
      {onRetryPending && !batch.busy && <Button size="sm" onClick={() => { void onRetryPending(); }}>{t('Retry import')}</Button>}
    </div>
  </section>;
}
