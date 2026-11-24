import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState } from "react";
import { useI18n } from "../../i18n/I18n";
import { useToast } from "../../hooks/useToast";
import { StudioToastViewport } from "../StudioToastViewport";
import { RemixIcon } from "../../icons/RemixIcons";
import { Button } from "open-design-ui/button";
import { IconButton, Tooltip } from "../ui";
import { MediaPreviewPlayer } from "./MediaPreviewPlayer";

/** Independent media playback: never writes the composition's playhead or settings. */
export function AssetPreviewDialog({ url, kind, name, onClose, onAdd }: {
  url: string; kind: "video" | "audio" | "image"; name: string; onClose: () => void; onAdd?: () => unknown;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const { toasts, showToast, dismissToast } = useToast();
  const busy = useRef(false);
  const add = async () => {
    if (!onAdd || busy.current) return;
    busy.current = true;
    setAdding(true);
    try {
      if (await onAdd() === false) throw new Error("Add failed");
      onClose();
    } catch {
      showToast("Failed to add media");
    } finally {
      busy.current = false;
      setAdding(false);
    }
  };
  const audioMode = kind === "audio";
  return <><Dialog.Root open={open} onOpenChange={setOpen} onOpenChangeComplete={next => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop forceRender className="hf-overlay-backdrop fixed inset-0 z-140 bg-media-preview-scrim" />
      <Dialog.Popup aria-label={t("Preview: {name}", { name })} aria-describedby={undefined}
        data-feedback-modal
        data-preview-kind={kind}
        className={`fixed top-1/2 left-1/2 z-150 flex ${audioMode ? "motion-asset-audio-preview h-[min(280px,85dvh)] w-[min(640px,90vw)]" : "h-[min(600px,85dvh)] w-[min(800px,90vw)]"} -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface text-text-1 shadow-menu outline-none`}
        onKeyDown={event => event.stopPropagation()}>
        <div className={`${audioMode ? "motion-audio-preview-header " : ""}flex shrink-0 items-center justify-between gap-3 px-3 py-2`}>
          {audioMode && <span className="motion-audio-preview-icon" aria-hidden="true"><RemixIcon name="music-2-line" size={18} /></span>}
          <Tooltip label={name} wrap><Dialog.Title className={`${audioMode ? "flex-1 " : ""}min-w-0 truncate text-step-14 font-semibold`}>{name}</Dialog.Title></Tooltip>
          <div className="flex shrink-0 items-center gap-2">
            {onAdd && <Button type="button" variant="primary" loading={adding} onClick={add}>
              {t(adding ? "Adding…" : "Use")}
            </Button>}
            <Dialog.Close render={<IconButton className="shrink-0" aria-label={t("Close preview")} icon={<RemixIcon name="close-line" size={16} />} />} />
          </div>
        </div>
        <MediaPreviewPlayer key={`${kind}:${url}`} url={url} kind={kind} name={name} />
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root><StudioToastViewport toasts={toasts} dismissToast={dismissToast} /></>;
}
