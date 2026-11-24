import { IconButton } from "open-design-ui/icon-button";
import { Button } from "open-design-ui/button";
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useI18n } from "../i18n/I18n";
import { RemixIcon } from "../icons/RemixIcons";
import { Menu, MenuItem } from "../components/ui/Menu";
import { Skeleton } from "../components/ui/Skeleton";
import { ProgressBar } from "../../../packages/design-system/react/ProgressBar";
import { brandCatalogFile } from "../../../shared/brand-catalog";
import { TemplateSourceLink } from "./TemplateGalleryCard";
import { BrandKitInspector } from "./BrandKitInspector";
import { BrandKitLivePreview } from "./BrandKitLivePreview";
import { SettingsDialog } from "./settingsPrimitives";
import { brandCard, brandFile, brandKitInstruction, brandKitShowcase, brandStage, isBrandKitBusy, type BrandKit, type BrandStyle } from "./brandKitClient";
import { templateRatio } from "./templateDiscovery";

export const BrandKitDetail = memo(function BrandKitDetail({ kit, busy, onAction, onCopy, onDownload, onClose, onNavigate, position, total, refreshFailed, onRefresh, returnFocus, previewsEnabled = true }: {
  kit: BrandKit;
  busy: boolean;
  onAction: (action: "cancel" | "retry" | "delete" | "edit" | "context" | "rescan", body?: unknown, expectedUpdatedAt?: string) => Promise<BrandKit | undefined>;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
  onNavigate: (direction: number) => void;
  position: number;
  total: number;
  refreshFailed: boolean;
  onRefresh: () => void;
  previewsEnabled?: boolean;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false), [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const processing = isBrandKitBusy(kit), ready = kit.state === "ready";
  const template = brandCard(kit, t("Style only"));
  const liveCatalog = kit.catalogId && !kit.nameOverride && !Object.keys(kit.styleOverrides || {}).length ? kit.catalogId : undefined;
  const playbackEnabled = previewsEnabled && !editing && !deleting;
  const poster = kit.catalogId && (liveCatalog || !ready || !kit.poster) ? brandCatalogFile(kit.catalogId, "poster.svg")
    : ready && kit.poster ? brandFile(kit, "poster.png") : undefined;
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Popup className="om-media-detail-surface om-media-detail-popup" data-feedback-modal aria-label={t("Brand details")} initialFocus={close} finalFocus={returnFocus}>
          <div className="om-media-detail-grid om-brand-detail">
            <div className="om-media-detail-stage">
              {poster && <img className="om-media-detail-ambient" src={poster} alt="" aria-hidden="true" />}
              <div className="om-media-detail-glass" />
              {liveCatalog ? <BrandKitLivePreview id={liveCatalog} poster={poster} enabled={playbackEnabled} />
                : ready ? <BrandKitVideo key={`${kit.id}:${kit.preview}:${kit.previewError || ''}`} kit={kit} poster={poster} onRetry={() => void onAction("retry").catch(() => {})} busy={busy} enabled={playbackEnabled} />
                : <div className="om-media-detail-media om-brand-video" aria-label={t("Brand Kit preview")}>
                  {poster ? <img className="om-brand-preview-poster" src={poster} alt={kit.name} /> : <div className="om-brand-preview-placeholder"><RemixIcon name="palette-line" size={36} /><span className="om-muted">{t(brandStage[kit.state])}</span>{processing && <Skeleton className="om-brand-preview-skeleton" />}</div>}
                </div>}
            </div>
            <aside className="om-media-detail-info">
              <div className="om-media-detail-nav">
                <IconButton variant="plain" ref={close} className="om-gallery-round-button" aria-label={t("Close Brand Kit preview")} onClick={onClose} icon={<RemixIcon name="close-line" size={20} />} />
                <span className="om-result-count">{position} / {total}</span>
                <IconButton variant="plain" className="om-gallery-round-button" aria-label={t("Previous Brand Kit")} disabled={busy || total < 2} onClick={() => onNavigate(-1)} icon={<RemixIcon name="arrow-left-line" size={18} />} />
                <IconButton variant="plain" className="om-gallery-round-button" aria-label={t("Next Brand Kit")} disabled={busy || total < 2} onClick={() => onNavigate(1)} icon={<RemixIcon name="arrow-right-line" size={18} />} />
              </div>
              <div className="om-media-detail-body om-brand-detail-body">
                <header className="om-brand-heading">
                  <h1 className="om-media-detail-title">{kit.name}</h1>
                  {!processing && <Menu modal={false} align="end" className="om-selection-panel om-menu-panel" aria-label={t("Brand Kit actions")} trigger={<IconButton variant="plain" className="om-gallery-round-button" disabled={busy} aria-label={t("Brand Kit actions")} icon={<RemixIcon name="more-line" size={18} />} />}>
                    {ready && <MenuItem onClick={() => setEditing(true)}>{t("Edit brand styles")}</MenuItem>}
                    {ready && !kit.catalogId && <MenuItem onClick={() => void onAction("rescan", { rescan: true }).catch(() => {})}>{t("Scan website again")}</MenuItem>}
                    <MenuItem onClick={() => setDeleting(true)}>{t("Delete Brand Kit")}</MenuItem>
                  </Menu>}
                </header>
                <TemplateSourceLink template={template} className="om-media-detail-creator om-media-detail-website" />
                <div className="om-control-row"><span className="om-badge">{t("Brand Kit")}</span><span className="om-badge">{t("Style only")}</span>{kit.category && <span className="om-badge">{t(kit.category)}</span>}</div>
                {refreshFailed && <div className="om-card om-card-stack" role="status"><span className="om-muted">{t("Could not refresh Brand Kit status")}</span><Button variant="ghost" className="om-button h-auto" onClick={onRefresh}>{t("Retry")}</Button></div>}
                {processing ? <div className="om-card om-card-stack" role="status">
                  <div className="om-control-row"><span className="om-muted">{t(brandStage[kit.state])}</span><RemixIcon name="loader-4-line" className="om-busy-icon" size={16} /></div>
                  <ProgressBar value={kit.progress} label={t(brandStage[kit.state])} />
                  <Button variant="ghost" className="om-button h-auto" disabled={busy} onClick={() => void onAction("cancel").catch(() => {})}>{t("Cancel extraction")}</Button>
                </div> : !ready ? <div className="om-card om-card-stack" role="status"><h2 className="om-subtitle">{t(brandStage[kit.state])}</h2><p className="om-muted">{t(kit.error || "You can retry this website at any time.")}</p><Button variant="ghost" className="om-button h-auto" disabled={busy} onClick={() => void onAction("retry").catch(() => {})}>{t("Retry extraction")}</Button></div> : null}
                <div className="om-media-detail-actions">
                  <Button variant="ghost" className="om-button h-auto" data-primary disabled={busy || !ready} onClick={onCopy}><RemixIcon name="file-copy-line" size={16} />{t("Copy for Agent")}</Button>
                  <Button variant="ghost" className="om-button h-auto" disabled={busy || !ready} onClick={onDownload}><RemixIcon name="download-2-line" size={16} />{t("Download package")}</Button>
                </div>
                {ready && <>
                  <section className="om-media-detail-prompt" aria-label={t('Brand Kit instruction')}>
                    <header><h3>{t('Brand Kit instruction')}</h3><Button variant="ghost" className="om-button h-auto" onClick={onCopy}><RemixIcon name="file-copy-line" size={14} />{t('Copy')}</Button></header>
                    <p className="om-media-detail-prompt-text" data-collapsed={!expanded}>{brandKitInstruction(kit)}</p>
                    <Button variant="plain" className="om-text-link om-media-detail-expand" data-quiet aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'Show less' : 'Show instruction')}<RemixIcon name="arrow-down-s-line" size={14} /></Button>
                  </section>
                  <dl className="om-media-detail-metadata">
                    <div><dt>{t('Duration')}</dt><dd>{t('{value}s', { value: brandKitShowcase.duration })}</dd></div>
                    <div><dt>{t('Aspect ratio')}</dt><dd>{templateRatio(template)}</dd></div>
                    <div><dt>{t('Reference')}</dt><dd><span className="om-badge">{t('Style only')}</span></dd></div>
                    {kit.category && <div><dt>{t('Categories')}</dt><dd><span className="om-badge">{t(kit.category)}</span></dd></div>}
                  </dl>
                </>}
                {kit.sample && <BrandKitInspector kit={kit} busy={busy || !ready} save={(body, revision) => onAction("context", body, revision)} />}
              </div>
            </aside>
          </div>
          {editing && kit.sample && (
            <BrandStyleEditor
              kit={kit}
              busy={busy}
              close={() => setEditing(false)}
              save={async (body) => {
                await onAction("edit", body);
                setEditing(false);
              }}
            />
          )}
          {deleting && (
            <SettingsDialog
              title={t("Delete Brand Kit")}
              onClose={() => setDeleting(false)}
            >
              <p className="om-muted">
                {t(
                  "Delete this local kit and its preview? Downloaded copies and existing projects are kept.",
                )}
              </p>
              <div className="om-brand-actions">
                <Button variant="ghost"
                  className="om-button h-auto"
                  disabled={busy}
                  onClick={() => setDeleting(false)}
                >
                  {t("Cancel")}
                </Button>
                <Button variant="ghost"
                  className="om-button h-auto"
                  data-primary
                  disabled={busy}
                  onClick={() => void onAction("delete").catch(() => {})}
                >
                  {t("Delete")}
                </Button>
              </div>
            </SettingsDialog>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
});

function BrandKitVideo({ kit, poster, onRetry, busy, enabled }: { kit: BrandKit; poster?: string; onRetry: () => void; busy: boolean; enabled: boolean }) {
  const { t } = useI18n(), video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [waiting, setWaiting] = useState(true), [attempt, setAttempt] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const src = brandFile(kit, "preview.mp4");
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!kit.preview || failed || !waiting || !enabled) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const visible = () => {
      clearTimeout(timeout);
      if (!document.hidden) timeout = setTimeout(() => setFailed(true), 15_000);
    };
    visible();
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timeout); document.removeEventListener('visibilitychange', visible); };
  }, [kit.preview, failed, waiting, enabled, attempt]);
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (!enabled || reducedMotion) node.pause();
    const pause = () => { if (document.hidden) node.pause(); };
    const observer = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) node.pause(); });
    observer.observe(node);
    document.addEventListener("visibilitychange", pause);
    return () => { node.pause(); observer.disconnect(); document.removeEventListener("visibilitychange", pause); };
  }, [enabled, failed, attempt, reducedMotion]);
  return <div className="om-media-detail-media om-brand-video" aria-busy={kit.preview && waiting && !failed}>
    {poster && <img className="om-brand-preview-poster" src={poster} alt="" />}
    {kit.preview && !failed && <video ref={video} key={attempt} src={src} controls autoPlay={enabled && !reducedMotion} muted loop playsInline preload="metadata" aria-label={t("Brand Kit preview")}
      style={{ opacity: ready ? 1 : 0 }}
      onLoadedData={() => { setReady(true); setWaiting(false); }} onCanPlay={() => setWaiting(false)} onPlaying={() => setWaiting(false)} onWaiting={() => setWaiting(true)} onStalled={() => setWaiting(true)} onPause={() => setWaiting(false)} onError={() => { setFailed(true); setWaiting(false); }} />}
    {kit.preview && waiting && !failed && <div className="om-media-detail-loading" role="status"><span>{t("Loading preview…")}</span><Skeleton className="om-media-detail-progress" /></div>}
    {(!kit.preview || failed) && <div className="om-media-detail-failure" role="status"><span>{t("Preview unavailable. Try again.")}</span>
      <Button variant="plain" disabled={busy} onClick={() => { if (kit.preview) { setReady(false); setFailed(false); setWaiting(true); setAttempt(n => n + 1); } else onRetry(); }}>{t(kit.preview ? "Retry" : "Retry preview")}</Button>
    </div>}
  </div>;
}
const styleLabels: Record<keyof BrandStyle, string> = {
  background: "Canvas",
  foreground: "Text",
  primary: "Primary color",
  onPrimary: "Text on primary",
  surface: "Surface",
  headingFont: "Heading font",
  bodyFont: "Body font",
  radius: "Corner radius",
  gradient: "Background gradient",
};
function BrandStyleEditor({
  kit,
  busy,
  close,
  save,
}: {
  kit: BrandKit;
  busy: boolean;
  close: () => void;
  save: (body: unknown) => Promise<void>;
}) {
  const { t } = useI18n(),
    [name, setName] = useState(kit.name),
    [style, setStyle] = useState(kit.sample!.style);
  return (
    <SettingsDialog title={t("Edit brand styles")} onClose={close}>
      <form
        className="om-brand-edit"
        onSubmit={(event) => {
          event.preventDefault();
          void save({ name, style }).catch(() => {});
        }}
      >
        <label>
          {t("Brand name")}
          <span className="om-field">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </span>
        </label>
        {Object.entries(style).map(([key, value]) => (
          <label key={key}>
            {t(styleLabels[key as keyof BrandStyle])}
            <span className="om-field">
              <input
                required
                value={value}
                maxLength={key === "gradient" ? 2000 : 160}
                onChange={(e) => setStyle({ ...style, [key]: e.target.value })}
              />
            </span>
          </label>
        ))}
        <div className="om-brand-actions">
          <Button variant="ghost"
            type="button"
            className="om-button h-auto"
            disabled={busy}
            onClick={close}
          >
            {t("Cancel")}
          </Button>
          <Button variant="ghost" className="om-button h-auto" data-primary disabled={busy}>
            {t("Save styles")}
          </Button>
        </div>
      </form>
    </SettingsDialog>
  );
}
