import { Button } from "open-design-ui/button";
import { Tooltip } from "../components/ui/Tooltip";
import { useRef, useState } from 'react';
import { resumableJob, type GenerationJob, type Modality } from '../../../shared/gateway';
import { assetMediaUrl } from '../../../shared/asset-library';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';

export const creationKinds = [
  { id: 'image', label: 'Image', icon: 'image-line', title: 'Give your imagination a frame.', hint: 'Describe a subject, a mood, a world.', action: 'Generate image' },
  { id: 'video', label: 'Video', icon: 'film-line', title: 'Set your story in motion.', hint: 'Describe the scene, movement and atmosphere.', action: 'Generate video' },
  { id: 'audio', label: 'Audio', icon: 'voiceprint-line', title: 'Find the sound of your idea.', hint: 'Create a voice, a soundtrack, an atmosphere.', action: 'Generate audio' },
] as const;
export function CreationEmblem({ kind = 'agent', working = false }: { kind?: Modality | 'agent'; working?: boolean }) {
  return <div className="om-creation-emblem" data-tone={kind} data-working={working} aria-hidden="true"><div className="om-creation-orbit" /><div className="om-creation-orbit" /><span className="om-creation-emblem-core"><RemixIcon name={working ? 'sparkling-fill' : kind === 'agent' ? 'sparkling-line' : creationKinds.find(item => item.id === kind)!.icon} size={28} /></span><span className="om-creation-satellite"><RemixIcon name="sparkling-fill" size={12} /></span></div>;
}
export function WorkingIndicator() {
  return <span className="om-creation-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>;
}
export function AssetGenerationCard({ job, onCancel, onView, onRetrySave, onResume }: { job: GenerationJob; onCancel: (job: GenerationJob) => void; onView: (job: GenerationJob) => void; onRetrySave?: (job: GenerationJob) => Promise<void>; onResume?: (job: GenerationJob) => Promise<void> }) {
  const { t } = useI18n();
  const working = job.state === 'queued' || job.state === 'running', done = job.state === 'completed';
  const saving = job.phase === 'downloading' || job.phase === 'saving';
  const [retrying, setRetrying] = useState(false);
  const retrySave = async () => { if (!onRetrySave || retrying) return; setRetrying(true); try { await onRetrySave(job); } finally { setRetrying(false); } };
  const resumable = resumableJob(job);
  const accountImage = job.model.provider === 'account' && job.modality === 'image';
  const resuming = useRef(false);
  const resume = async () => { if (!onResume || resuming.current) return; resuming.current = true; setRetrying(true); try { await onResume(job); } finally { resuming.current = false; setRetrying(false); } };
  const title = t(done ? 'Ready for your next creation' : job.savePending && job.state === 'failed' ? 'Saving needs attention' : job.state === 'failed' ? 'Generation needs attention' : job.state === 'cancelled' ? 'Generation stopped' : job.state === 'queued' ? 'Your idea is in the queue' : saving ? 'Bringing your asset home' : 'Your idea is taking shape');
  const result = job.libraryAssets?.[0];
  const [failedPreview, setFailedPreview] = useState<string>();
  const preview = result && assetMediaUrl(result.assetId, result.versionId);
  let error = job.error;
  if (error?.startsWith('SAVE_NOT_AVAILABLE:')) error = t('The retained files are missing, changed or unreadable. Saving cannot be retried. No new generation was requested.');
  else if (error?.startsWith('CODEX_IMAGE_PROXY_AUTH_REQUIRED:')) error = t('The local Codex proxy requires its own authentication. In Codex settings, select the configured proxy provider and check its endpoint and credentials. Signing in again alone will not fix a missing proxy key. Your original asset is unchanged; no automatic retry was made.');
  else if (error?.startsWith('CODEX_IMAGE_AUTH_REQUIRED:')) error = t('The configured Codex image service rejected authorization. Check the active provider, endpoint and authentication in Codex settings; sign in again only if your account session has expired. Your original asset is unchanged; no automatic retry was made.');
  else if (error?.startsWith('ASSET_MEDIA_RUNTIME_NOT_READY:')) error = t('Local media components are unavailable. Prepare or repair this installation, then submit again. No model request was made; your original asset is unchanged.');
  return <section className="om-creation-job" data-tone={job.modality} data-state={job.state} aria-label={t('Generation activity')} aria-busy={working}>
    <div className="om-creation-job-row">
      <div className="om-creation-job-thumbnail" aria-hidden="true">
        {done && preview && preview !== failedPreview && job.modality === 'image' ? <img src={preview} onError={() => setFailedPreview(preview)} alt="" /> : working ? <WorkingIndicator /> : <RemixIcon name={done ? 'checkbox-circle-line' : job.state === 'failed' ? 'error-warning-line' : 'pause-line'} size={18} />}
      </div>
      <div className="om-creation-job-copy"><div className="om-creation-job-title"><Tooltip label={title} wrap><span className="om-creation-status" role="status">{t(saving && working ? 'Saving to assets' : working && job.phase === 'reconnecting' ? 'Reconnecting…' : job.state)}</span></Tooltip><span className="om-eyebrow">{job.model.label}</span></div><Tooltip label={job.prompt} wrap><p className="om-muted om-creation-job-prompt">{job.prompt}</p></Tooltip><span className="om-sr-only">{title}</span></div>
      {working ? <Button variant="plain" className="om-nav-item" onClick={() => onCancel(job)}>{t('Cancel')}</Button> : <>
        {resumable && onResume && <Button variant="plain" className="om-nav-item" disabled={retrying} onClick={() => void resume()}>{t(accountImage ? retrying ? 'Continuing download…' : 'Continue download' : retrying ? 'Checking original task…' : 'Check original task')}</Button>}
        {job.savePending && onRetrySave && <Button variant="plain" className="om-nav-item" disabled={retrying} onClick={() => void retrySave()}>{t(retrying ? 'Retrying save…' : 'Retry saving')}</Button>}
        {result && <Button variant="plain" className="om-nav-item" onClick={() => onView(job)}>{t('View asset')}<RemixIcon name="arrow-right-up-line" size={14} /></Button>}
      </>}
    </div>
    {(working || done) && <ol className="om-creation-steps" aria-label={t('Generation progress')}>{['Submitted', 'Creating', 'Saved to assets'].map((label, i) => <li key={label} data-complete={done || i === 0 && job.state === 'running' || i === 1 && saving} data-current={working && (i === 0 && job.state === 'queued' || i === 1 && job.state === 'running' && !saving || i === 2 && saving)}><span>{done || i === 0 && job.state === 'running' || i === 1 && saving ? <RemixIcon name="check-line" size={12} /> : i + 1}</span>{t(label)}</li>)}</ol>}
    {job.savePending && !working && <p className="om-muted">{t('Generated files are kept locally. Retry saving without generating again.')}</p>}
    {accountImage && job.download && !done && <p className="om-muted" role="status">{t('Downloaded')}: {(job.download.receivedBytes / 1024 / 1024).toFixed(1)} / {(job.download.totalBytes / 1024 / 1024).toFixed(1)} MB</p>}
    {accountImage && (resumable || working && job.remoteId) && <p className="om-muted">{t('Download the original task image. Draft changes apply only to your next generation.')}</p>}
    {error && <details className="om-creation-job-error"><summary>{t('Failure details')}</summary><p>{t(error)}</p></details>}
  </section>;
}
