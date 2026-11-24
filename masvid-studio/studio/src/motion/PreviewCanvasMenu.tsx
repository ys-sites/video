import { useEffect, useRef, useState } from 'react';
import { canvasPresets, canvasRatio, type CanvasRatio, type CanvasFit } from '../../../shared/composition-canvas';
import { useStudioShellContext } from '../contexts/StudioContext';
import { useLivePreviewIframe } from '../player/store/previewIframeStore';
import { useI18n } from '../i18n/I18n';
import { Button } from 'open-design-ui/button';
import { Menu, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../components/ui/Menu';
import { CaretDown } from '../icons/RemixIcons';
import { gatewayRequest } from './gatewayClient';

export function PreviewCanvasMenu() {
  const shell = useStudioShellContext(), { t } = useI18n(), iframe = useLivePreviewIframe();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const running = useRef(false), alive = useRef(true), latest = useRef(shell); latest.current = shell;
  const pending = useRef<{ signature: string; payload: Record<string, unknown> } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  let root: Element | null = null;
  try { root = iframe?.contentDocument?.querySelector('[data-composition-id]') ?? null; } catch { /* A new preview is still loading. */ }
  const dimensions = shell.compositionDimensions;
  const ratio = dimensions ? canvasRatio(dimensions.width, dimensions.height) : '';
  const fit: CanvasFit = root?.getAttribute('data-canvas-fit') === 'cover' ? 'cover' : 'contain';
  const disabled = busy || !root || !dimensions || Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering;
  async function change(nextRatio: CanvasRatio, nextFit: CanvasFit) {
    if (running.current || disabled) return;
    running.current = true; setBusy(true);
    const projectId = shell.projectId, compositionPath = shell.activeCompPath || 'index.html';
    const valid = () => alive.current && latest.current.projectId === projectId && (latest.current.activeCompPath || 'index.html') === compositionPath && !latest.current.writeBlockedReason && !latest.current.renderQueue.isRendering;
    try {
      await shell.waitForPendingDomEditSaves(); if (!valid()) return;
      const canvas = { compositionPath, ratio: nextRatio, fit: nextFit }, signature = JSON.stringify({ projectId, canvas });
      if (pending.current?.signature !== signature) {
        const detail = await gatewayRequest<{ revision: string; currentVersionId: string }>('phase1/call', 'POST', { name: 'openmotion_get_project', arguments: { projectId } });
        pending.current = { signature, payload: { projectId, canvas, expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: crypto.randomUUID(), summary: 'Change canvas framing' } };
      }
      if (!valid()) return;
      await gatewayRequest('phase1/call', 'POST', { name: 'openmotion_edit_project', arguments: pending.current.payload });
      pending.current = null;
      if (valid()) { setOpen(false); shell.showToast(t('Canvas updated'), 'info'); }
    } catch (error) {
      if (error instanceof Error && /CONFLICT/.test(error.message)) pending.current = null;
      if (valid()) shell.showToast(t(error instanceof Error ? error.message : 'Canvas update failed'), 'error');
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }
  return <Menu open={open} onOpenChange={setOpen} modal={false} side="bottom" align="end" className="w-28 min-w-0" tooltip={t('Aspect ratio')} aria-label={t('Aspect ratio')} trigger={<Button size="sm" variant="ghost" className="shrink-0 font-normal tabular-nums text-text-0" aria-label={t('Aspect ratio')} disabled={disabled} onPointerDown={event => event.stopPropagation()}>{ratio || '—'}<CaretDown size={12} /></Button>}>
    <div className="om-menu-caption" data-tone="subtle">{t('Aspect ratio')}</div>
    <MenuRadioGroup value={ratio} aria-label={t('Aspect ratio')}>
      {canvasPresets.map(preset => <MenuRadioItem
        key={preset.ratio}
        value={preset.ratio}
        className="gap-2 tabular-nums"
        disabled={disabled}
        onClick={() => void change(preset.ratio, fit)}
      >
        <span className="flex items-center gap-2">
          <span className="w-6">{preset.ratio}</span>
          <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
            <span className="block rounded-[var(--motion-radius-xs)] border border-current" style={{
              width: `${Math.min(1, preset.width / preset.height) * 100}%`,
              aspectRatio: `${preset.width} / ${preset.height}`,
            }} />
          </span>
        </span>
      </MenuRadioItem>)}
    </MenuRadioGroup>
    <MenuSeparator />
    <div className="om-menu-caption" data-tone="subtle">{t('Content fit')}</div>
    <MenuRadioGroup value={fit} aria-label={t('Content fit')}>
      {(['contain', 'cover'] as const).map(value => <MenuRadioItem key={value} value={value} className="gap-2" disabled={disabled || !canvasPresets.some(item => item.ratio === ratio)} onClick={() => void change(ratio as CanvasRatio, value)}>{t(value === 'contain' ? 'Letterbox' : 'Crop')}</MenuRadioItem>)}
    </MenuRadioGroup>
  </Menu>;
}
