import { Popover } from "@base-ui/react/popover";
import type { RefObject } from "react";
import { useI18n } from "../../i18n/I18n";
import { RemixIcon } from "../../icons/RemixIcons";
import { IconButton } from "open-design-ui/icon-button";
import { RenderQueuePanel } from "./RenderQueuePanel";
import { Tabs, TabsList, Tab, TabPanel } from "../ui/Tabs";
import { CaptionExportPanel } from "./CaptionExportPanel";
import { PlatformExportPanel } from "./PlatformExportPanel";

/** Export settings and history share the native queue; closing does not cancel jobs. */
export function ExportDialog({ open, onOpenChange, triggerRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  return <Popover.Root modal open={open} onOpenChange={onOpenChange}>
    <Popover.Portal>
      <Popover.Backdrop className="fixed inset-0 z-140" />
      <Popover.Positioner anchor={triggerRef} side="bottom" align="end" sideOffset={8} collisionPadding={12}
        collisionAvoidance={{ side: "none", align: "shift" }} positionMethod="fixed" className="z-150">
      <Popover.Popup data-testid="export-dialog" finalFocus={triggerRef} aria-describedby={undefined}
        className="hf-floating-motion flex max-h-[var(--available-height)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-surface text-text-1 shadow-menu outline-none h-[640px]">
        <div className="flex shrink-0 items-center justify-between px-3 py-2">
          <Popover.Title className="text-step-14 font-semibold">{t("Export")}</Popover.Title>
          <Popover.Close render={<IconButton aria-label={t("Close")} icon={<RemixIcon name="close-line" size={16} />} />} />
        </div>
        <Tabs defaultValue="file" className="flex min-h-0 flex-1 flex-col overflow-hidden" onKeyDown={event => event.stopPropagation()}>
          <TabsList aria-label={t("Export method")} className="mx-3 mb-3 flex shrink-0">
            <Tab value="file" className="flex-1 gap-1.5"><RemixIcon name="download-2-line" size={14} />{t("Video")}</Tab>
            <Tab value="captions" className="flex-1 gap-1.5"><RemixIcon name="closed-captioning-line" size={14} />{t("Captions")}</Tab>
            <Tab value="platform" className="flex-1 gap-1.5"><RemixIcon name="global-line" size={14} />{t("Platform export")}</Tab>
          </TabsList>
          <TabPanel value="file" className="min-h-0 overflow-y-auto"><RenderQueuePanel /></TabPanel>
          <TabPanel value="captions" className="flex min-h-0 flex-1 flex-col overflow-hidden"><CaptionExportPanel onClose={() => onOpenChange(false)} /></TabPanel>
          <TabPanel value="platform" className="flex min-h-0 flex-1 flex-col overflow-hidden"><PlatformExportPanel onClose={() => onOpenChange(false)} /></TabPanel>
        </Tabs>
      </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
