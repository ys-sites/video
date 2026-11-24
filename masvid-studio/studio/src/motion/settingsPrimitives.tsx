import { Button } from "open-design-ui/button";
import { Tooltip } from "../components/ui/Tooltip";
import { useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { designSystemAsset, providerIcons, modelBrandId } from '../../../packages/design-system/index.js';
import type { ProviderConnection } from '../../../shared/provider-directory';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { Skeleton } from '../components/ui/Skeleton';

// Version media-model artwork with the Studio bundle, including on already-running editor servers.
const modelArtwork = import.meta.glob<string>('../../../packages/design-system/providers/models/*.svg', {
  eager: true, import: 'default', query: '?url&no-inline',
});

export function SettingsLoading() {
  const { t } = useI18n();
  return <div className="om-settings-loading" role="status" aria-label={t('Loading settings…')}><Skeleton style={{ width: '40%', height: 28 }} /><Skeleton style={{ width: '100%', height: 120 }} /><Skeleton style={{ width: '100%', height: 180 }} /></div>;
}
export function SettingsError({ retry }: { retry: () => void }) {
  const { t } = useI18n();
  return <div className="om-empty" role="alert"><RemixIcon name="error-warning-line" size={28} /><h2 className="om-subtitle">{t('Could not load settings')}</h2><p className="om-muted">{t('Check your connection and try again.')}</p><Button variant="ghost" className="om-button h-auto" onClick={retry}>{t('Retry')}</Button></div>;
}
export function SettingsDialog({ title, onClose, children, returnFocus, className = '' }: { title: string; onClose: () => void; children: ReactNode; returnFocus?: HTMLElement | null; className?: string }) {
  const { t } = useI18n();
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Backdrop forceRender className="hf-overlay-backdrop om-settings-backdrop" />
    <Dialog.Popup data-feedback-modal className={`om-dialog om-settings-dialog ${className}`} finalFocus={returnFocus ? closeType => (closeType === 'mouse' || closeType === 'touch' || closeType === 'pen' ? false : returnFocus) : undefined} onKeyDown={event => event.stopPropagation()}>
      <header className="om-settings-row"><Dialog.Title className="om-subtitle">{title}</Dialog.Title><Dialog.Close className="motion-icon-button" aria-label={t('Close')}><RemixIcon name="close-line" size={20} /></Dialog.Close></header>
      {children}
    </Dialog.Popup>
  </Dialog.Portal></Dialog.Root>;
}
export function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <Tooltip label={label} wrap><button type="button" className="om-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} /></Tooltip>;
}
export function ProviderAvatar({ name, provider }: { name: string; provider?: Pick<ProviderConnection, 'id' | 'custom'> }) {
  const [failed, setFailed] = useState<string>();
  const icon = provider && !provider.custom ? (providerIcons as Record<string, { file?: string; padded?: boolean; symbol?: string }>)[provider.id] : undefined;
  const src = icon?.file ? modelArtwork[`../../../packages/design-system/${icon.file}`] ?? designSystemAsset(icon.file) : undefined;
  return <span className="om-avatar om-provider-avatar" data-provider={provider?.custom ? undefined : provider?.id} data-brand={Boolean(src && failed !== src)} aria-hidden="true">
    {src && failed !== src ? <img src={src} alt="" draggable={false} data-padded={icon?.padded || undefined} onError={() => setFailed(src)} />
      : icon?.symbol ? <RemixIcon name={icon.symbol} size={22} /> : name.slice(0, 2).toUpperCase()}
  </span>;
}

export function ModelAvatar({ name, modelId, provider }: { name: string; modelId: string; provider?: Pick<ProviderConnection, 'id' | 'custom'> }) {
  const brandId = modelBrandId(modelId);
  return <ProviderAvatar name={name} provider={typeof brandId === 'string' ? { id: brandId, custom: false } : provider} />;
}
