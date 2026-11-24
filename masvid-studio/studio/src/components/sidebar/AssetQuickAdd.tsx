import { useRef, useState } from "react";
import { useToast } from "../../hooks/useToast";
import { useI18n } from "../../i18n/I18n";
import { RemixIcon } from "../../icons/RemixIcons";
import { StudioToastViewport } from "../StudioToastViewport";
import { IconButton, Tooltip } from "../ui";

/** Explicit insertion stays separate from the thumbnail's preview and drag gestures. */
export function AssetQuickAdd({ asset, onAdd, compact = false }: { asset: string; onAdd: (path: string) => unknown; compact?: boolean }) {
  const { t } = useI18n();
  const busy = useRef(false);
  const [adding, setAdding] = useState(false);
  const { toasts, showToast, dismissToast } = useToast();
  const add = async () => {
    if (busy.current) return;
    busy.current = true;
    setAdding(true);
    try {
      if (await onAdd(asset) === false) throw new Error("Add failed");
    } catch {
      showToast("Failed to add media");
    } finally {
      busy.current = false;
      setAdding(false);
    }
  };
  const label = t(adding ? "Adding…" : "Add at playhead");
  // Portaled Toast events still bubble through React's owning asset row.
  return <div className="om-media-quick-actions" data-busy={adding || undefined} data-compact={compact || undefined}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}>
      <Tooltip label={label} wrap>
        <IconButton type="button" variant="primary" className="om-media-quick-add"
          aria-label={label} aria-busy={adding} disabled={adding} draggable={false}
          icon={<RemixIcon name="add-line" size={compact ? 14 : 16} />}
          onPointerDown={event => event.stopPropagation()}
          onPointerUp={event => event.stopPropagation()}
          onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); void add(); }} />
      </Tooltip>
    <StudioToastViewport toasts={toasts} dismissToast={dismissToast} />
  </div>;
}
