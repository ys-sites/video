import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useId, useState, type DragEvent, type Ref } from 'react';
import { assetMediaUrl } from '../../../../shared/asset-library';
import type { PoolItem } from '../../../../shared/scenario-runs';
import type { PoolKind } from '../../../../shared/scenarios';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import type { StepProps } from '../stepContract';
import {
  extractErrorMessage,
  isScenarioConflictError,
  POOL_DRAG_MIME,
  poolKindIcon,
  poolKindLabel,
} from './stepUtils';

export type BindingSlotProps = {
  slot: string;
  label: string;
  hint?: string;
  kinds: PoolKind[];
  max?: number;
  required?: boolean;
  error?: string;
  pickButtonRef?: Ref<HTMLButtonElement>;
  stepId: string;
  boundIds: string[];
  pool: StepProps['pool'];
  api: StepProps['api'];
  toast: StepProps['toast'];
  disabled?: boolean;
  onChanged?: (nextIds: string[]) => void;
};

function SlotThumb({ item }: { item: PoolItem }) {
  const [failed, setFailed] = useState(false);

  if (item.ref.type === 'asset' && item.kind === 'image' && !failed) {
    return (
      <img
        className="om-step-slot-thumb"
        src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  if (item.ref.type === 'asset' && item.kind === 'video' && !failed) {
    return (
      <video
        className="om-step-slot-thumb"
        src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="om-step-slot-icon" data-pool-kind={item.kind} aria-hidden="true">
      <RemixIcon name={poolKindIcon(item.kind)} size={14} />
    </span>
  );
}

function parseDraggedPoolId(data: string): string | null {
  const trimmed = data.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { poolItemId?: unknown; id?: unknown };
      if (typeof parsed.poolItemId === 'string' && parsed.poolItemId) return parsed.poolItemId;
      if (typeof parsed.id === 'string' && parsed.id) return parsed.id;
    } catch {
      return null;
    }
  }
  return trimmed;
}

export function BindingSlot({
  slot,
  label,
  hint,
  kinds,
  max,
  required = false,
  error,
  pickButtonRef,
  stepId,
  boundIds,
  pool,
  api,
  toast,
  disabled = false,
  onChanged,
}: BindingSlotProps) {
  const { t } = useI18n();
  const labelId = useId();
  const errorId = `${labelId}-error`;
  const [dragOver, setDragOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const busy = disabled || picking || api.busy.has(`bind:${slot}`);

  const commit = async (nextIds: string[]) => {
    const capped = max !== undefined ? nextIds.slice(0, max) : nextIds;
    try {
      await api.mutate(`bind:${slot}`, 'update_step', {
        stepId,
        bindings: { [slot]: capped },
      });
      onChanged?.(capped);
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not update step inputs.')), 'error', 'feedback');
      }
    }
  };

  const handlePick = async () => {
    if (busy) return;
    setPicking(true);
    try {
      const picked = await pool.requestPick({
        slot,
        kinds,
        ...(max !== undefined ? { max } : {}),
        selected: boundIds,
      });
      if (picked !== null) {
        await commit(picked);
      }
    } finally {
      setPicking(false);
    }
  };

  const handleRemove = (id: string) => {
    if (busy) return;
    void commit(boundIds.filter(existing => existing !== id));
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (busy) return;
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes(POOL_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    if (busy) return;
    const raw = event.dataTransfer?.getData(POOL_DRAG_MIME);
    if (!raw) return;
    event.preventDefault();
    const id = parseDraggedPoolId(raw);
    if (!id) return;
    const item = pool.byId.get(id);
    if (!item) {
      toast.showToast(t('That asset is no longer in Assets.'), 'error', 'feedback');
      return;
    }
    if (!kinds.includes(item.kind)) {
      toast.showToast(
        t('This slot accepts {kinds} only.', { kinds: kinds.map(kind => t(poolKindLabel(kind))).join(', ') }),
        'error',
        'feedback',
      );
      return;
    }
    if (boundIds.includes(item.id)) return;
    if (max === 1) {
      void commit([item.id]);
      return;
    }
    if (max !== undefined && boundIds.length >= max) {
      toast.showToast(t('This slot accepts at most {max} items.', { max }), 'error', 'feedback');
      return;
    }
    void commit([...boundIds, item.id]);
  };

  const resolvedItems = boundIds
    .map(id => ({ id, item: pool.byId.get(id) ?? null }))
    .filter(entry => entry.item !== null);

  const primaryKind = kinds[0] ?? 'image';

  return (
    <div
      className="om-step-field om-step-binding-slot"
      data-slot={slot}
      data-pool-kind={primaryKind}
      data-has-items={resolvedItems.length > 0 ? 'true' : undefined}
      data-drag-over={dragOver ? 'true' : undefined}
      data-picking={picking ? 'true' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="om-step-field-label-row om-step-binding-head">
        <div className="om-step-binding-meta">
          <span className="om-step-binding-icon" data-pool-kind={primaryKind} aria-hidden="true">
            <RemixIcon name={poolKindIcon(primaryKind)} size={13} />
          </span>
          <span id={labelId} className="om-step-field-label om-step-binding-label">
            {label}
            {required && <span className="om-step-required" aria-hidden="true">*</span>}
          </span>
          {max !== undefined && (
            <span className="om-step-count-badge">
              {resolvedItems.length}/{max}
            </span>
          )}
        </div>
        {(hint || !required) && (
          <span className="om-step-field-hint">
            {hint ?? t('Optional')}
          </span>
        )}
      </div>

      <div
        className="om-step-binding-control"
        role="group"
        aria-labelledby={labelId}
        aria-invalid={error ? true : undefined}
      >
        <div className="om-step-binding-content">
          {resolvedItems.length > 0 ? (
            <div className="om-step-chip-list">
              {resolvedItems.map(({ id, item }) => {
                const isVisual =
                  item!.ref.type === 'asset' && (item!.kind === 'image' || item!.kind === 'video');
                return (
                  <span
                    key={id}
                    className={isVisual ? 'om-step-bound-thumb-card' : 'om-step-bound-chip'}
                    data-pool-item-id={id}
                    title={item!.label}
                  >
                    <SlotThumb item={item!} />
                    {!isVisual && <span className="om-step-bound-chip-label">{item!.label}</span>}
                    <IconButton
                      size="sm"
                      variant="ghost"
                      className={isVisual ? 'om-step-bound-thumb-remove' : undefined}
                      disabled={busy}
                      aria-label={t('Remove {label}', { label: item!.label })}
                      icon={<RemixIcon name="close-line" size={12} />}
                      onClick={() => handleRemove(id)}
                    />
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="om-step-slot-empty">
              {t('Drag assets here or choose from Assets.')}
            </p>
          )}
        </div>

        <Button
          ref={pickButtonRef}
          variant="secondary"
          size="sm"
          className="om-step-binding-pick-btn"
          icon={<RemixIcon name="stack-line" size={14} />}
          loading={picking}
          disabled={busy}
          aria-describedby={error ? errorId : undefined}
          onClick={() => void handlePick()}
        >
          {t('Choose assets')}
        </Button>
      </div>
      {error && <p id={errorId} className="om-step-binding-error" role="alert">{error}</p>}
    </div>
  );
}
