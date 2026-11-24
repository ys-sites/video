import { Button } from "open-design-ui/button";
import { IconButton } from "open-design-ui/icon-button";
import { brandCard } from "./brandKitClient";
import { Dialog } from "@base-ui/react/dialog";
import { BrandLogo } from "../../../packages/design-system/react/BrandLogo";
import { GalleryIntro } from "./GalleryIntro";
import { templateContributionUrl } from "./templateContribution";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { RemixIcon } from "../icons/RemixIcons";
import { Skeleton } from "../components/ui/Skeleton";
import { ProgressBar } from "../../../packages/design-system/react/ProgressBar";
import { useToast } from "../hooks/useToast";
import { StudioToastViewport } from "../components/StudioToastViewport";
import { TemplateGalleryCard } from "./TemplateGalleryCard";
import { useTemplatePlayback } from "./useTemplatePlayback";
import type { GalleryTemplate } from "../../../shared/catalog";
import { brandCoverRevision } from "../../../shared/brand-catalog";
import { BrandCatalogGallery } from "./BrandCatalogGallery";
import { SettingsDialog } from "./settingsPrimitives";
import { BrandKitDetail } from "./BrandKitDetail";
import { GallerySearchField, GallerySortMenu } from "./GalleryFilters";
import {
  brandFile,
  brandKitInstruction,
  brandRequest,
  brandStage,
  isBrandKitBusy,
  loadBrandKits,
  type BrandKit,
} from "./brandKitClient";
import * as tracking from "./pageTracking";
import "./brand-kits.css";

const sameKitList = (previous: BrandKit[] | undefined, next: BrandKit[]) => Boolean(previous && previous.length === next.length && previous.every((kit, index) => {
  const candidate = next[index];
  return candidate?.id === kit.id && candidate.updatedAt === kit.updatedAt && candidate.state === kit.state && candidate.progress === kit.progress && candidate.preview === kit.preview && candidate.poster === kit.poster && candidate.previewError === kit.previewError && candidate.name === kit.name;
}));

type BrandCollection = "official" | "mine";

export function BrandKitPage({
  selectedId,
  inWorkspace = false,
  onSelect,
  onClose = () => onSelect(null),
  previewsEnabled = true,
  hasProject = false,
}: {
  selectedId: string | null;
  inWorkspace?: boolean;
  onSelect: (id: string | null) => void;
  onClose?: () => void;
  previewsEnabled?: boolean;
  hasProject?: boolean;
}) {
  const { t } = useI18n(),
    toast = useToast();
  const [kits, setKits] = useState<BrandKit[]>(),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false);
  const collectionRoute = selectedId === null || selectedId === "official" ? "official" : selectedId === "mine" ? "mine" : null;
  const detailId = collectionRoute === null && selectedId !== "new" ? selectedId : null;
  const [detailCollection, setDetailCollection] = useState<BrandCollection>(detailId ? "mine" : "official");
  const collection = collectionRoute ?? detailCollection;
  const [sort, setSort] = useState("newest");
  const detailReturnFocus = useRef<HTMLElement | null>(null);
  const pendingExtraction = useRef<{ url: string; requestId: string } | null>(null);
  const [catalogOrder, setCatalogOrder] = useState<string[]>([]);
  const lastRandom = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null),
    [priority, setPriority] = useState<string | null>(null);
  useEffect(() => { if (collectionRoute) setDetailCollection(collectionRoute); }, [collectionRoute]);
  useEffect(() => {
    let disposed = false,
      request: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      clearTimeout(timer);
      if (document.hidden || disposed || request) return;
      const controller = new AbortController();
      request = controller;
      const deadline = setTimeout(() => controller.abort(), 10_000);
      let interval = 15_000;
      try {
        const kits = await loadBrandKits(controller.signal);
        if (kits.some(isBrandKitBusy)) interval = 1800;
        if (!disposed && !controller.signal.aborted) {
          setKits(previous => sameKitList(previous, kits) ? previous : kits);
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
        interval = 1800;
      } finally {
        clearTimeout(deadline);
        request = undefined;
        if (!disposed) timer = setTimeout(() => void refresh(), interval);
      }
    };
    const visible = () => {
      if (!document.hidden) void refresh();
      else clearTimeout(timer);
    };
    void refresh();
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      request?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [revision]);
  const cards = useMemo(() => new Map((kits || []).map(kit => [kit.id, brandCard(kit, t("Style only"))])), [kits, t]);
  const filtered = useMemo(() => kits?.filter((kit) => `${kit.name} ${kit.url}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)) || [], [kits, query, sort]);
  const playback = useTemplatePlayback(
    root,
    filtered.map((kit) => kit.id + kit.updatedAt).join("|"),
    collectionRoute === "mine" && previewsEnabled,
    true,
    priority,
    true,
  );
  const selected = kits?.find((kit) => kit.id === detailId);
  // One page view per visit; one detail view per opened kit, reported once its record is loaded.
  useEffect(() => { tracking.reportBrandKitPageView(collection, hasProject); }, []);
  const detailView = useRef<string | undefined>(undefined);
  useEffect(() => {
    detailView.current = selected ? tracking.newTrackingId() : undefined;
    if (selected && detailView.current) tracking.reportBrandDetailShown(selected, detailView.current);
  }, [selected?.id]);
  const back = useCallback(() => onSelect(collection === "official" ? null : "mine"), [onSelect, collection]);
  const notify = useCallback((message: string, failure = false) =>
    toast.showToast(t(message), failure ? "error" : "info", "feedback"), [t, toast.showToast]);
  const run = useCallback(async <T,>(action: () => Promise<T>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      setRevision((n) => n + 1);
      return result;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Brand Kit operation failed",
        true,
      );
      throw error;
    } finally {
      setBusy(false);
    }
  }, [busy, notify]);
  const create = useCallback((url: string) => {
    const attempt = tracking.newTrackingId();
    const result = run(async () => {
      const pending = pendingExtraction.current?.url === url ? pendingExtraction.current : { url, requestId: crypto.randomUUID() };
      pendingExtraction.current = pending;
      const { kit } = await brandRequest<{ kit: BrandKit }>("", "POST", {
        url,
        requestId: pending.requestId,
      });
      pendingExtraction.current = null;
      setKits((previous) => [kit, ...(previous || []).filter(record => record.id !== kit.id)]);
      setDetailCollection("mine");
      onSelect(kit.id);
      notify("Brand extraction started");
    });
    // `run` resolves to undefined without starting when another operation is in progress; that is not an attempt.
    if (!busy) void result.then(() => tracking.reportBrandKitCreateResult("success", attempt), () => tracking.reportBrandKitCreateResult("failure", attempt));
    return result;
  }, [busy, notify, onSelect, run]);
  const importCatalog = useCallback((id: string, visible?: string[], trigger?: HTMLElement) => {
    const position = visible ? visible.indexOf(id) + 1 || undefined : undefined;
    let alreadyInLibrary = false;
    const result = run(async () => {
    if (visible) {
      detailReturnFocus.current = trigger ?? document.activeElement as HTMLElement;
      setCatalogOrder(visible);
    }
    setDetailCollection("official");
    const existing = kits?.find(kit => kit.catalogId === id);
    if (existing) {
      alreadyInLibrary = true;
      onSelect(existing.id);
      return;
    }
    const { kit } = await brandRequest<{ kit: BrandKit }>(`/catalog/${encodeURIComponent(id)}/import`, "POST");
    setKits(previous => [kit, ...(previous || []).filter(item => item.id !== kit.id)]);
    onSelect(kit.id);
    notify("Brand Kit added to your library");
    });
    if (!busy) void result.then(() => tracking.reportBrandKitImportResult(id, "success", alreadyInLibrary, position),
      () => tracking.reportBrandKitImportResult(id, "failure", false, position));
    return result;
  }, [busy, kits, notify, onSelect, run]);
  const action = useCallback((
    operation: "cancel" | "retry" | "delete" | "edit" | "context" | "rescan",
    body?: unknown,
    expectedUpdatedAt?: string,
  ) => {
    const subject = selected, view = detailView.current;
    const result = run(async () => {
      if (!selected) return;
      const response = await brandRequest<{ kit?: BrandKit }>(
        `/${selected.id}${operation === "rescan" ? "/retry" : ["cancel", "retry", "context"].includes(operation) ? "/" + operation : ""}`,
        operation === "delete"
          ? "DELETE"
          : ["edit", "context"].includes(operation)
            ? "PUT"
            : "POST",
        operation === "cancel" ? body : { ...(body && typeof body === 'object' ? body : {}), expectedUpdatedAt: expectedUpdatedAt ?? selected.updatedAt },
      );
      if (operation === "delete") {
        setKits((previous) =>
          previous?.filter((kit) => kit.id !== selected.id),
        );
        back();
        notify("Brand Kit deleted");
      } else if (response.kit) {
        const changed = response.kit;
        setKits((previous) =>
          previous?.map((kit) => (kit.id === changed.id ? changed : kit)),
        );
        if (operation === "edit") notify("Brand styles saved");
        if (operation === "context") notify("Brand context saved");
        if (operation === "rescan") notify("Brand extraction started");
      }
      return response.kit;
    });
    if (subject && !busy) void result.then(() => tracking.reportBrandActionResult(subject, operation, "success", view),
      () => tracking.reportBrandActionResult(subject, operation, "failure", view));
    return result;
  }, [back, busy, notify, run, selected]);
  const copy = useCallback(() => {
    if (!selected) return;
    const attempt = tracking.newTrackingId(), view = detailView.current;
    tracking.reportBrandDetailClick(selected, "copy_instruction", view, { copy_attempt_id: attempt });
    void navigator.clipboard.writeText(brandKitInstruction(selected)).then(
      () => { notify("Style-only instruction copied"); tracking.reportBrandCopyResult(selected, "clipboard_written", attempt, view); },
      () => { notify("Could not copy the instruction", true); tracking.reportBrandCopyResult(selected, "failed", attempt, view); },
    );
  }, [notify, selected]);
  const download = useCallback(() => {
    if (!selected) return;
    if (busy) return;
    const attempt = tracking.newTrackingId(), view = detailView.current;
    tracking.reportBrandDetailClick(selected, "download_package", view, { download_attempt_id: attempt });
    void run(async () => {
      const response = await fetch(brandFile(selected, "package.zip"));
      if (!response.ok) throw new Error("Could not download the Brand Kit");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `brand-kit-${selected.id}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      notify("Package download started");
      tracking.reportBrandDownloadResult(selected, "browser_save_requested", attempt, view);
    }).catch(() => { tracking.reportBrandDownloadResult(selected, "fetch_failed", attempt, view); });
  }, [busy, notify, run, selected]);
  const switchCollection = useCallback((next: BrandCollection) => {
    if (next === collectionRoute) return;
    tracking.reportBrandCollectionTab(next);
    setQuery("");
    onSelect(next === "official" ? null : "mine");
  }, [collectionRoute, onSelect]);
  const openKit = useCallback((id: string, trigger?: HTMLElement) => { detailReturnFocus.current = trigger ?? document.activeElement as HTMLElement; onSelect(id); }, [onSelect]);
  const positionOf = useCallback((id: string) => filtered.findIndex(kit => kit.id === id) + 1 || undefined, [filtered]);
  const openPrivateCard = useCallback((id: string, trigger?: HTMLElement) => {
    const kit = kits?.find(record => record.id === id);
    if (kit) tracking.reportBrandCardOpened(kit, positionOf(id));
    openKit(id, trigger);
  }, [kits, openKit, positionOf]);
  const selectPrivateCard = useCallback((template: GalleryTemplate, trigger: HTMLButtonElement) => openPrivateCard(template.id, trigger), [openPrivateCard]);
  const setCardPriority = useCallback((id: string | null) => setPriority(id), []);
  const surprise = useCallback(() => {
    const ready = filtered.filter(kit => kit.state === "ready");
    const pool = ready.length > 1 ? ready.filter(kit => kit.id !== lastRandom.current) : ready;
    const kit = pool[Math.floor(Math.random() * pool.length)];
    if (kit) { tracking.reportBrandSurprise("mine", ready.length); lastRandom.current = kit.id; openKit(kit.id); }
  }, [filtered, openKit]);
  const officialOrder = collection === "official" && catalogOrder.length > 0;
  const detailOrder = useMemo(() => officialOrder ? catalogOrder : filtered.map(kit => kit.id), [officialOrder, catalogOrder, filtered]);
  const detailPosition = selected ? detailOrder.indexOf(collection === "official" ? selected.catalogId || selected.id : selected.id) : -1;
  const navigate = useCallback((direction: number) => {
    if (busy || !detailOrder.length) return;
    if (selected) tracking.reportBrandDetailClick(selected, direction < 0 ? "detail_previous" : "detail_next", detailView.current);
    const id = detailOrder[(Math.max(detailPosition, 0) + direction + detailOrder.length) % detailOrder.length];
    if (officialOrder) void importCatalog(id).catch(() => {});
    else onSelect(id);
  }, [busy, officialOrder, detailOrder, detailPosition, importCatalog, onSelect, selected]);
  const refreshStatus = useCallback(() => setRevision(value => value + 1), []);
  const openCreate = useCallback(() => { tracking.reportNewBrandKitClicked(collection); onSelect('new'); }, [collection, onSelect]);
  const listSuspended = Boolean(selected || (detailId && kits));
  const content = <>
    <StudioToastViewport {...toast} />
    {selectedId !== "new" && <>
      <header className="om-gallery-sticky-header">
        <div className="om-gallery-header">
          <div className="om-gallery-wordmark">{!inWorkspace && <BrandLogo compact />}<span className="om-gallery-page-label">{t('Brand Kit')}</span></div>
          <nav className="om-gallery-collection-tabs" aria-label={t('Brand Kit')}>
            <Button variant="plain" className="om-nav-item" aria-current={collection === 'official' ? 'page' : undefined} onClick={() => switchCollection('official')}>{t('Official collection')}</Button>
            <Button variant="plain" className="om-nav-item" aria-current={collection === 'mine' ? 'page' : undefined} onClick={() => switchCollection('mine')}>{t('My brand kits')}</Button>
          </nav>
          <div className="om-control-row om-gallery-header-actions">
            <Button variant="ghost" type="button" className="om-button h-auto" data-primary onClick={openCreate}><RemixIcon name="add-line" size={16} />{t('New Brand Kit')}</Button>
            <GallerySearchField label={t('Search brand kits')} value={query} onChange={setQuery} />
            <IconButton variant="plain" type="button" className="om-gallery-round-button" aria-label={t('Close Brand Kit')} onClick={onClose} icon={<RemixIcon name="close-line" size={20} />} />
          </div>
        </div>
      </header>
      <main className={listSuspended ? "om-brand-list-suspended" : undefined} aria-hidden={listSuspended || undefined} aria-label={t(collection === 'official' ? 'Official collection' : 'My brand kits')}>
        {collection === "official" ? <BrandCatalogGallery scrollRoot={root} onImport={importCatalog} onCreate={openCreate} busy={busy} previewsEnabled={previewsEnabled && !detailId} query={query} onQueryChange={setQuery} /> : <>
          <div className="om-gallery-toolbar"><div className="om-gallery-categories"><Button variant="plain" aria-pressed>{t('All')}</Button></div><div className="om-gallery-controls"><GallerySortMenu value={sort} options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["name", "Name A–Z"]]} onChange={setSort} /></div></div>
          <div className="om-gallery-results">
            <div className="om-gallery-masonry" aria-busy={!kits && !error} aria-label={!kits && !error ? t('Loading Brand Kits') : undefined}>
              <GalleryIntro eyebrow={t('My brand kits')} title={t('Bring your brand into motion.')} count={t('{count} brand kits', { count: filtered.length })} disabled={busy || !filtered.some(kit => kit.state === 'ready')} onSurprise={surprise} submitLabel={t('Submit Brand Kit')} submitUrl={templateContributionUrl} createAction={{ label: t('New Brand Kit'), onClick: openCreate }} />
              {!kits && !error && Array.from({ length: 8 }, (_, key) => <div className="om-gallery-skeleton" key={key} aria-hidden="true"><Skeleton className="om-brand-loading" /></div>)}
              {filtered.map(kit => kit.state === 'ready' ? <TemplateGalleryCard key={kit.id + kit.updatedAt} template={cards.get(kit.id)!} resourceKind="brand-kit" coverUrl={`/motion-api/brand-kits/${kit.id}/cover?v=${brandCoverRevision}-${encodeURIComponent(kit.updatedAt)}`} active={priority === kit.id && playback.has(kit.id)} onPriority={setCardPriority} onSelect={selectPrivateCard} /> : <Button variant="plain" key={kit.id} className="om-card om-brand-task-card om-gallery-card" data-interactive onClick={event => openPrivateCard(kit.id, event.currentTarget)}>{isBrandKitBusy(kit) ? <span className="motion-loading-mark" aria-hidden="true" /> : <RemixIcon name="error-warning-line" size={28} />}<strong className="om-subtitle">{kit.name}</strong><span className="om-muted">{t(brandStage[kit.state])}</span>{isBrandKitBusy(kit) && <ProgressBar value={kit.progress} label={t(brandStage[kit.state])} />}</Button>)}
            </div>
            {error && !kits && <div className="om-empty" role="alert"><h2 className="om-subtitle">{t('Could not load Brand Kits')}</h2><Button variant="ghost" className="om-button h-auto" onClick={() => setRevision(n => n + 1)}>{t('Retry')}</Button></div>}
            {kits && !filtered.length && <div className="om-empty">{query ? t('No matching brand kits') : <BrandKitCreate busy={busy} onCreate={create} />}</div>}
          </div>
        </>}
      </main>
    </>}
    {selectedId === 'new' && <div className="om-media-detail-grid om-brand-detail">
      <div className="om-media-detail-stage"><div className="om-media-detail-glass" /><div className="om-media-detail-media om-brand-video"><div className="om-brand-preview-placeholder"><RemixIcon name="palette-line" size={36} /><span className="om-title">Brand Kit</span></div></div></div>
      <aside className="om-media-detail-info"><div className="om-media-detail-nav"><IconButton variant="plain" className="om-gallery-round-button" aria-label={t('All brand kits')} onClick={back} icon={<RemixIcon name="close-line" size={20} />} /></div><div className="om-media-detail-body"><BrandKitCreate busy={busy} onCreate={create} /></div></aside>
    </div>}
    {selected && <BrandKitDetail key={selected.id} kit={selected} busy={busy} onAction={action} onCopy={copy} onDownload={download} previewsEnabled={previewsEnabled} onClose={back} returnFocus={detailReturnFocus.current?.isConnected ? detailReturnFocus : root} position={detailPosition < 0 ? 1 : detailPosition + 1} total={detailOrder.length || 1} onNavigate={navigate} refreshFailed={error} onRefresh={refreshStatus} />}
    {detailId && kits && !selected && <SettingsDialog title={t('Brand Kit not found')} onClose={back}><Button variant="ghost" className="om-button h-auto" onClick={back}>{t('All brand kits')}</Button></SettingsDialog>}
  </>;
  if (inWorkspace) return <div ref={root} tabIndex={-1} className="om-gallery-surface om-brand-library" data-workspace-gallery role="region" aria-label={t('Brand Kit')}>{content}</div>;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Popup ref={root} className="om-gallery-surface om-gallery-popup om-brand-library" data-feedback-modal aria-label={t('Brand Kit')}>{content}</Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

function BrandKitCreate({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (url: string) => Promise<void>;
}) {
  const { t } = useI18n(),
    [url, setUrl] = useState("");
  return (
    <section className="om-brand-create">
      <RemixIcon name="palette-line" size={40} />
      <h2 className="om-media-detail-title">{t("New Brand Kit")}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onCreate(url).catch(() => {});
        }}
      >
        <label className="om-field">
          <RemixIcon name="link" size={18} />
          <input
            required
            maxLength={2048}
            aria-label={t("Website address")}
            placeholder="yourbrand.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
        </label>
        <Button variant="ghost"
          className="om-button h-auto"
          data-primary
          disabled={busy || !url.trim()}
        >
          {t(busy ? "Starting…" : "Extract Brand Kit")}
        </Button>
      </form>
    </section>
  );
}
