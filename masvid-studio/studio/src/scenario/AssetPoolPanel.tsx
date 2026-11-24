import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { assetDownloadUrl, assetUploadAccept, type AssetReference, type LibraryAsset } from '../../../shared/asset-library';
import { findDesignScenario, type DesignProject } from '../../../shared/design-project';
import type { PoolItem, PoolRef, ScenarioBundleReceipt, ScenarioRun } from '../../../shared/scenario-runs';
import type { PoolKind, ScenarioDefinition, ScenarioStepDefinition } from '../../../shared/scenarios';
import { Checkbox } from '../components/ui/Checkbox';
import { FilterChip } from '../components/ui/FilterChip';
import { FieldInput } from '../components/ui/FormField';
import { Menu, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { PanelEmptyState } from '../components/ui/PanelEmptyState';
import { Popover } from '../components/ui/Popover';
import { Skeleton } from '../components/ui/Skeleton';
import { designClient } from '../design/designClient';
import type { useToast } from '../hooks/useToast';
import { assetUploadFormatsHint, assetUploadMessage, recordAssetUploadFailure, type AssetUploadSummary } from '../i18n/assetUploadMessages';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { AssetPicker } from '../motion/AssetBrowser';
import { uploadLibraryAsset } from '../motion/assetClient';
import { useOptionalWorkspaceChrome } from '../motion/WorkspaceChromeContext';
import { downloadText } from './scenarioClient';
import { PoolItemPreviewDialog, PoolThumb, resolvePoolTextContent } from './PoolItemPreview';
import { isScenarioConflictError, triggerUrlDownload } from './steps/stepUtils';

export type PoolPickRequest = {
  slot: string;
  kinds: PoolKind[];
  max?: number;
  selected: string[];
};

export type PoolExportOptions = {
  poolItemIds?: string[];
  activeOnly?: boolean;
  includeStandaloneHtml?: boolean;
  includeMotionSource?: boolean;
};

export type AssetPoolPanelProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  currentStep: ScenarioStepDefinition;
  items: PoolItem[];
  highlightedIds: ReadonlySet<string>;
  open: boolean;
  onOpenChange(open: boolean): void;
  presentation?: 'sidebar' | 'inline';
  collapsed?: boolean;
  onToggleCollapsed?(): void;
  onRefresh?(): Promise<void> | void;
  pickRequest: PoolPickRequest | null;
  onConfirmPick(ids: string[]): void;
  onCancelPick(): void;
  onAddItems(
    items: { ref: PoolRef; label?: string; tags?: string[]; stepId?: string | null; source: PoolItem['source'] }[],
  ): Promise<string[]>;
  onUpdateItem(
    poolItemId: string,
    changes: { label?: string; tags?: string[]; pinned?: boolean },
  ): Promise<void>;
  onRemoveItem(poolItemId: string): Promise<void>;
  onUseInCurrentStep(item: PoolItem): Promise<void>;
  onOpenDesignProject(id: string): void;
  onOpenMotionProject(id: string): Promise<boolean>;
  onExportBundle?(options?: PoolExportOptions): Promise<ScenarioBundleReceipt | null>;
  exportingBundle?: boolean;
  onCopySummaryJson?(): Promise<void> | void;
  toast: Pick<ReturnType<typeof useToast>, 'showToast'>;
};

const MAX_POOL_ADD_BATCH = 50;

type KindFilter = 'all' | PoolKind;
type PoolFilters = { kind: KindFilter; steps: string[] };
const EMPTY_POOL_FILTERS: PoolFilters = { kind: 'all', steps: [] };

const KIND_FILTERS: readonly { id: KindFilter; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'stack-line' },
  { id: 'image', label: 'Images', icon: 'image-line' },
  { id: 'video', label: 'Video', icon: 'movie-line' },
  { id: 'audio', label: 'Audio', icon: 'music-2-line' },
  { id: 'page', label: 'Pages', icon: 'layout-line' },
  { id: 'motion', label: 'Motion', icon: 'film-line' },
  { id: 'text', label: 'Text', icon: 'file-text-line' },
];

const KIND_BADGE_LABELS: Record<PoolKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  page: 'Page',
  motion: 'Motion',
  text: 'Text',
};

const MANUAL_STEP_KEY = '__manual__';

type LayoutMode = 'docked' | 'drawer' | 'sheet';

function readLayoutMode(): LayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'docked';
  }
  if (window.matchMedia('(max-width: 767px)').matches) return 'sheet';
  if (window.matchMedia('(max-width: 1099px)').matches) return 'drawer';
  return 'docked';
}

function usePoolLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(readLayoutMode);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const sheetMq = window.matchMedia('(max-width: 767px)');
    const drawerMq = window.matchMedia('(max-width: 1099px)');
    const update = () => {
      if (sheetMq.matches) setMode('sheet');
      else if (drawerMq.matches) setMode('drawer');
      else setMode('docked');
    };
    update();
    sheetMq.addEventListener?.('change', update);
    drawerMq.addEventListener?.('change', update);
    return () => {
      sheetMq.removeEventListener?.('change', update);
      drawerMq.removeEventListener?.('change', update);
    };
  }, []);

  return mode;
}

export function AssetPoolPanel({
  scenario,
  run,
  currentStep,
  items,
  highlightedIds,
  open,
  onOpenChange,
  presentation = 'sidebar',
  collapsed = false,
  onToggleCollapsed,
  onRefresh,
  pickRequest,
  onConfirmPick,
  onCancelPick,
  onAddItems,
  onUpdateItem,
  onRemoveItem,
  onUseInCurrentStep,
  onOpenDesignProject,
  onOpenMotionProject,
  onExportBundle,
  exportingBundle = false,
  onCopySummaryJson,
  toast,
}: AssetPoolPanelProps) {
  const { t } = useI18n();
  const uploadHintId = useId();
  const uploadHint = assetUploadFormatsHint(t);
  const chrome = useOptionalWorkspaceChrome();
  const layoutMode = usePoolLayoutMode();

  const [browseFilters, setBrowseFilters] = useState(EMPTY_POOL_FILTERS);
  const [pickFilters, setPickFilters] = useState(EMPTY_POOL_FILTERS);
  const { kind: kindFilter, steps: stepFilters } = pickRequest ? pickFilters : browseFilters;
  const setFilters = pickRequest ? setPickFilters : setBrowseFilters;
  const [uploading, setUploading] = useState(false);
  const [importingProjects, setImportingProjects] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetPickerBusy, setAssetPickerBusy] = useState(false);
  const [designPickerOpen, setDesignPickerOpen] = useState(false);
  const [designProjects, setDesignProjects] = useState<DesignProject[]>([]);
  const [designLoading, setDesignLoading] = useState(false);
  const [designError, setDesignError] = useState<string | null>(null);
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>([]);
  const [motionPickerOpen, setMotionPickerOpen] = useState(false);
  const [selectedMotionIds, setSelectedMotionIds] = useState<string[]>([]);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const previewItem = items.find(item => item.id === previewItemId) ?? null;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [draftPickIds, setDraftPickIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  const [exportPopoverOpen, setExportPopoverOpen] = useState(false);
  const [exportActiveOnly, setExportActiveOnly] = useState(false);
  const [exportStandaloneHtml, setExportStandaloneHtml] = useState(true);
  const [exportMotionSource, setExportMotionSource] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlurRef = useRef(false);

  // Sync draft selection when pick mode activates or changes.
  useEffect(() => {
    setPickFilters(EMPTY_POOL_FILTERS);
    if (pickRequest) {
      setDraftPickIds(pickRequest.selected);
      setSelectionMode(false);
    } else {
      setDraftPickIds([]);
    }
  }, [pickRequest]);

  // Prune stale selected export IDs whenever pool items change.
  useEffect(() => {
    const validIds = new Set(items.map(item => item.id));
    setSelectedExportIds(prev => {
      const next = prev.filter(id => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    if (items.length === 0) {
      setSelectionMode(false);
    }
  }, [items]);

  useEffect(() => {
    if (!designPickerOpen) setSelectedDesignIds([]);
  }, [designPickerOpen]);

  useEffect(() => {
    if (!motionPickerOpen) setSelectedMotionIds([]);
  }, [motionPickerOpen]);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const loadDesignProjects = useCallback(async () => {
    setDesignLoading(true);
    setDesignError(null);
    try {
      const res = await designClient.listProjects();
      setDesignProjects((res.projects ?? []).filter(project => !project.trashedAt));
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : t('Could not load Design projects'));
    } finally {
      setDesignLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (designPickerOpen) {
      void loadDesignProjects();
    }
  }, [designPickerOpen, loadDesignProjects]);

  const stepTitleMap = useMemo(
    () => new Map(scenario.steps.map(step => [step.id, step.title])),
    [scenario.steps],
  );

  const eligibleItems = useMemo(
    () => pickRequest ? items.filter(item => pickRequest.kinds.includes(item.kind)) : items,
    [items, pickRequest],
  );
  const eligibleIds = useMemo(() => new Set(eligibleItems.map(item => item.id)), [eligibleItems]);
  const selectedPickIds = draftPickIds.filter(id => eligibleIds.has(id)).slice(0, pickRequest?.max);

  const stepFilteredItems = useMemo(() => {
    if (stepFilters.length === 0) return eligibleItems;
    return eligibleItems.filter(item => stepFilters.includes(item.stepId ?? MANUAL_STEP_KEY));
  }, [eligibleItems, stepFilters]);

  const kindCounts = useMemo(() => {
    const counts: Record<KindFilter, number> = {
      all: stepFilteredItems.length,
      image: 0,
      video: 0,
      audio: 0,
      page: 0,
      motion: 0,
      text: 0,
    };
    for (const item of stepFilteredItems) {
      counts[item.kind] += 1;
    }
    return counts;
  }, [stepFilteredItems]);

  const stepCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of eligibleItems) {
      if (kindFilter !== 'all' && item.kind !== kindFilter) continue;
      const key = item.stepId ?? MANUAL_STEP_KEY;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [eligibleItems, kindFilter]);

  const visibleItems = useMemo(() => {
    const matched = stepFilteredItems.filter(item =>
      kindFilter === 'all' ? true : item.kind === kindFilter,
    );
    return [...matched].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.addedAt - a.addedAt;
    });
  }, [kindFilter, stepFilteredItems]);

  const setKindFilter = (kind: KindFilter) => setFilters(prev => ({ ...prev, kind }));
  const setStepFilters = (update: string[] | ((prev: string[]) => string[])) => {
    setFilters(prev => ({ ...prev, steps: typeof update === 'function' ? update(prev.steps) : update }));
  };
  const setStepFilter = (key: string, checked: boolean) => {
    setStepFilters(prev => {
      if (checked) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter(item => item !== key);
    });
  };

  const toggleStepFilter = (key: string) => {
    setStepFilters(prev =>
      prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key],
    );
  };

  const clearAllFilters = () => setFilters(EMPTY_POOL_FILTERS);

  const addItemsBatched = useCallback(
    async (
      entries: {
        ref: PoolRef;
        label?: string;
        tags?: string[];
        stepId?: string | null;
        source: PoolItem['source'];
      }[],
    ): Promise<string[]> => {
      const ids: string[] = [];
      for (let i = 0; i < entries.length; i += MAX_POOL_ADD_BATCH) {
        const chunk = entries.slice(i, i + MAX_POOL_ADD_BATCH);
        const added = await onAddItems(chunk);
        ids.push(...added);
      }
      return ids;
    },
    [onAddItems],
  );

  const uploadFilesToPool = async (files: File[]) => {
    if (uploading || files.length === 0) return;

    setUploading(true);
    try {
      const toAdd: { ref: PoolRef; label: string; stepId: null; source: 'upload' }[] = [];
      const summary: AssetUploadSummary = { uploaded: 0, failed: 0, unknown: 0, reasons: new Set() };

      for (const file of files) {
        try {
          const uploaded = await uploadLibraryAsset(file);
          toAdd.push({
            ref: {
              type: 'asset',
              assetId: uploaded.id,
              versionId: uploaded.currentVersionId,
            },
            label: uploaded.name || file.name,
            stepId: null,
            source: 'upload',
          });
        } catch (error) {
          recordAssetUploadFailure(summary, file, error);
        }
      }

      if (toAdd.length > 0) {
        await addItemsBatched(toAdd);
        summary.uploaded = toAdd.length;
      }
      if (summary.failed || summary.unknown) {
        toast.showToast(assetUploadMessage(summary), 'error', 'feedback');
      } else {
        toast.showToast(
          t('Added {count} file(s) to assets', { count: toAdd.length }),
          'info',
          'feedback',
        );
      }
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add uploaded files'),
          'error',
          'feedback',
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    await uploadFilesToPool(files);
  };

  const handleWorkspaceAssetsImport = async (
    picked: { reference: AssetReference; asset: LibraryAsset }[],
  ) => {
    if (picked.length === 0) return;
    setAssetPickerBusy(true);
    try {
      await addItemsBatched(
        picked.map(({ reference, asset }) => ({
          ref: {
            type: 'asset',
            assetId: reference.assetId,
            versionId: reference.versionId,
          },
          label: asset.name,
          stepId: null,
          source: 'workspace',
        })),
      );
      setAssetPickerOpen(false);
      toast.showToast(
        picked.length === 1
          ? t('Added to assets')
          : t('Imported {count} asset(s)', { count: picked.length }),
        'info',
        'feedback',
      );
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add asset'),
          'error',
          'feedback',
        );
      }
    } finally {
      setAssetPickerBusy(false);
    }
  };

  const handleImportDesignProjects = async (projects: DesignProject[]) => {
    if (projects.length === 0) return;
    setImportingProjects(true);
    try {
      await addItemsBatched(
        projects.map(project => ({
          ref: {
            type: 'design',
            projectId: project.id,
            versionId: project.versionId,
            revision: project.revision,
          },
          label: project.title,
          stepId: null,
          source: 'workspace',
        })),
      );
      setDesignPickerOpen(false);
      toast.showToast(
        projects.length === 1
          ? t('Added Design project')
          : t('Imported {count} Design page(s)', { count: projects.length }),
        'info',
        'feedback',
      );
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add Design project'),
          'error',
          'feedback',
        );
      }
    } finally {
      setImportingProjects(false);
    }
  };

  const handleImportMotionProjects = async (projects: { id: string; title: string }[]) => {
    if (projects.length === 0) return;
    setImportingProjects(true);
    try {
      await addItemsBatched(
        projects.map(project => ({
          ref: {
            type: 'motion',
            projectId: project.id,
            sessionId: null,
          },
          label: project.title,
          stepId: null,
          source: 'workspace',
        })),
      );
      setMotionPickerOpen(false);
      toast.showToast(
        projects.length === 1
          ? t('Added Motion project')
          : t('Imported {count} Motion project(s)', { count: projects.length }),
        'info',
        'feedback',
      );
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not add Motion project'),
          'error',
          'feedback',
        );
      }
    } finally {
      setImportingProjects(false);
    }
  };

  const canDownloadItem = (item: PoolItem): boolean =>
    item.ref.type !== 'motion' || Boolean(onExportBundle);

  const handleDownloadItem = async (item: PoolItem) => {
    try {
      if (item.ref.type === 'asset') {
        triggerUrlDownload(assetDownloadUrl(item.ref.assetId, item.ref.versionId, item.label));
      } else if (item.ref.type === 'design') {
        await designClient.downloadExport(item.ref.projectId, {
          format: 'zip',
          versionId: item.ref.versionId,
        });
      } else if (item.ref.type === 'text') {
        const text = resolvePoolTextContent(item, run);
        const safeName = item.label.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'note';
        downloadText(`${safeName}.txt`, text);
      } else if (item.ref.type === 'motion' && onExportBundle) {
        await onExportBundle({
          poolItemIds: [item.id],
          includeMotionSource: true,
        });
      }
    } catch (err) {
      toast.showToast(
        err instanceof Error ? err.message : t('Could not download asset'),
        'error',
        'feedback',
      );
    }
  };

  const handleOpenItem = (item: PoolItem) => {
    if (item.ref.type === 'design') {
      onOpenDesignProject(item.ref.projectId);
    } else if (item.ref.type === 'motion') {
      void onOpenMotionProject(item.ref.projectId);
    } else if (item.ref.type === 'asset') {
      const url = `/assets/${encodeURIComponent(item.ref.assetId)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleCopyReference = async (item: PoolItem) => {
    const payload = JSON.stringify(
      {
        poolItemId: item.id,
        kind: item.kind,
        label: item.label,
        ref: item.ref,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      toast.showToast(t('Copied asset reference'), 'info', 'feedback');
    } catch {
      toast.showToast(t('Could not copy reference'), 'error', 'feedback');
    }
  };

  const handleRemoveItem = async (item: PoolItem) => {
    try {
      await onRemoveItem(item.id);
      toast.showToast(
        t('Removed from workflow. Original workspace asset was kept.'),
        'info',
        'feedback',
      );
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not remove item'),
          'error',
          'feedback',
        );
      }
    }
  };

  const handleTogglePin = async (item: PoolItem) => {
    try {
      await onUpdateItem(item.id, { pinned: !item.pinned });
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not update asset'),
          'error',
          'feedback',
        );
      }
    }
  };

  const beginRename = (item: PoolItem) => {
    skipRenameBlurRef.current = false;
    setRenamingId(item.id);
    setRenameDraft(item.label);
  };

  const commitRename = async (item: PoolItem) => {
    if (skipRenameBlurRef.current) {
      skipRenameBlurRef.current = false;
      return;
    }
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === item.label) return;
    try {
      await onUpdateItem(item.id, { label: trimmed });
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not rename asset'),
          'error',
          'feedback',
        );
      }
    }
  };

  const togglePickItem = (itemId: string) => {
    if (!pickRequest) return;
    setDraftPickIds(prev => {
      const selected = prev.filter(id => eligibleIds.has(id)).slice(0, pickRequest.max);
      if (selected.includes(itemId)) {
        return selected.filter(id => id !== itemId);
      }
      if (pickRequest.max === 1) {
        return [itemId];
      }
      if (pickRequest.max && selected.length >= pickRequest.max) {
        return selected;
      }
      return [...selected, itemId];
    });
  };

  const toggleExportItem = (itemId: string) => {
    setSelectedExportIds(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId],
    );
  };

  const toggleSelectAllVisibleForExport = () => {
    const visibleIds = visibleItems.map(item => item.id);
    if (visibleIds.length === 0) return;
    setSelectedExportIds(prev => {
      const prevSet = new Set(prev);
      const allSelected = visibleIds.every(id => prevSet.has(id));
      if (allSelected) {
        return prev.filter(id => !visibleIds.includes(id));
      }
      const next = [...prev];
      for (const id of visibleIds) {
        if (!prevSet.has(id)) next.push(id);
      }
      return next;
    });
  };

  const handleExportSelected = async () => {
    const selectedSet = new Set(selectedExportIds);
    const chosen = items.filter(item => selectedSet.has(item.id));
    if (chosen.length === 0) return;
    if (chosen.length === 1) {
      await handleDownloadItem(chosen[0]);
      return;
    }
    if (onExportBundle) {
      await onExportBundle({
        poolItemIds: chosen.map(item => item.id),
        activeOnly: exportActiveOnly,
        includeStandaloneHtml: exportStandaloneHtml,
        includeMotionSource: exportMotionSource,
      });
    }
  };

  const motionProjects = useMemo(
    () => (chrome?.workspace.projects ?? []).filter(project => !project.trashedAt),
    [chrome?.workspace.projects],
  );

  const hasActiveFilters = kindFilter !== 'all' || stepFilters.length > 0;
  const visibleSelectedExportCount = useMemo(() => {
    const selectedSet = new Set(selectedExportIds);
    return visibleItems.filter(item => selectedSet.has(item.id)).length;
  }, [selectedExportIds, visibleItems]);
  const allVisibleSelectedForExport =
    visibleItems.length > 0 && visibleSelectedExportCount === visibleItems.length;
  const exportSelectionActive = !pickRequest && (selectionMode || selectedExportIds.length > 0);
  const selectedExportSet = useMemo(() => new Set(selectedExportIds), [selectedExportIds]);

  const hasExternalFiles = (event: DragEvent<HTMLElement>) =>
    !pickRequest && Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const panelBody = (
    <div
      className="om-scenario-pool-inner"
      data-file-drop-active={fileDragActive ? 'true' : undefined}
      onDragOver={event => {
        if (!hasExternalFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setFileDragActive(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFileDragActive(false);
        }
      }}
      onDrop={event => {
        setFileDragActive(false);
        if (pickRequest || !event.dataTransfer?.files?.length) return;
        event.preventDefault();
        void uploadFilesToPool(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={assetUploadAccept()}
        className="om-scenario-hidden-file-input"
        aria-label={t('Upload files to assets')}
        aria-describedby={items.length === 0 ? uploadHintId : undefined}
        onChange={event => void handleFileUpload(event)}
      />

      <header className="om-scenario-pool-header">
        <div className="om-scenario-pool-title-group">
          <span className="om-scenario-pool-header-icon" aria-hidden="true">
            <RemixIcon name="stack-line" size={14} />
          </span>
          <h2 className="om-scenario-pool-title">{t('Assets')}</h2>
          <span className="om-badge">{pickRequest ? visibleItems.length : items.length}</span>
        </div>
        <div className="om-scenario-pool-header-actions">
          <Menu
            align="end"
            aria-label={t('Import assets')}
            trigger={
              <IconButton
                variant="ghost"
                size="sm"
                type="button"
                aria-label={t('Import')}
                title={t('Import')}
                disabled={uploading || importingProjects}
                icon={
                  uploading || importingProjects ? (
                    <RemixIcon name="loader-4-line" size={14} className="om-scenario-spin" />
                  ) : (
                    <RemixIcon name="upload-2-line" size={14} />
                  )
                }
              />
            }
          >
            <MenuItem
              icon={<RemixIcon name="upload-2-line" size={14} />}
              aria-label={t('Upload files…')}
              aria-describedby={`${uploadHintId}-menu`}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('Upload files…')}
              <span id={`${uploadHintId}-menu`} className="om-scenario-pool-upload-hint om-scenario-pool-upload-hint--menu">{uploadHint}</span>
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="folder-open-line" size={14} />}
              onClick={() => setAssetPickerOpen(true)}
            >
              {t('Import from workspace…')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="layout-line" size={14} />}
              onClick={() => setDesignPickerOpen(true)}
            >
              {t('Import Design pages…')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="movie-line" size={14} />}
              onClick={() => setMotionPickerOpen(true)}
            >
              {t('Import Motion projects…')}
            </MenuItem>
          </Menu>

          {onExportBundle && (
            <Popover
              align="end"
              open={exportPopoverOpen}
              onOpenChange={setExportPopoverOpen}
              aria-label={t('Export options')}
              className="om-scenario-export-popover"
              trigger={
                <IconButton
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={t('Export')}
                  title={t('Export')}
                  disabled={exportingBundle}
                  icon={
                    exportingBundle ? (
                      <RemixIcon name="loader-4-line" size={14} className="om-scenario-spin" />
                    ) : (
                      <RemixIcon name="download-2-line" size={14} />
                    )
                  }
                />
              }
            >
              <div className="om-scenario-popover-body">
                <div className="om-scenario-export-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    loading={exportingBundle}
                    icon={<RemixIcon name="download-2-line" size={14} />}
                    onClick={() => {
                      setExportPopoverOpen(false);
                      void onExportBundle({
                        activeOnly: exportActiveOnly,
                        includeStandaloneHtml: exportStandaloneHtml,
                        includeMotionSource: exportMotionSource,
                      });
                    }}
                  >
                    {t('Export all (ZIP)')}
                  </Button>

                  {selectedExportIds.length > 0 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={exportingBundle}
                      onClick={() => {
                        setExportPopoverOpen(false);
                        void handleExportSelected();
                      }}
                    >
                      {t('Export selected ({count})', { count: selectedExportIds.length })}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={items.length === 0}
                      onClick={() => {
                        setSelectionMode(true);
                        setExportPopoverOpen(false);
                      }}
                    >
                      {t('Select assets to export')}
                    </Button>
                  )}

                  {hasActiveFilters && visibleItems.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={exportingBundle}
                      onClick={() => {
                        setExportPopoverOpen(false);
                        void onExportBundle({
                          poolItemIds: visibleItems.map(item => item.id),
                          activeOnly: exportActiveOnly,
                          includeStandaloneHtml: exportStandaloneHtml,
                          includeMotionSource: exportMotionSource,
                        });
                      }}
                    >
                      {t('Export filtered ({count})', { count: visibleItems.length })}
                    </Button>
                  )}
                </div>

                <div className="om-scenario-export-options">
                  <div className="om-scenario-popover-option">
                    <Checkbox
                      aria-label={t('Active outputs only')}
                      checked={exportActiveOnly}
                      onCheckedChange={checked => setExportActiveOnly(Boolean(checked))}
                    />
                    <span
                      className="om-scenario-popover-option-label"
                      onClick={() => setExportActiveOnly(prev => !prev)}
                    >
                      {t('Active outputs only')}
                    </span>
                  </div>
                  <div className="om-scenario-popover-option">
                    <Checkbox
                      aria-label={t('Standalone HTML')}
                      checked={exportStandaloneHtml}
                      onCheckedChange={checked => setExportStandaloneHtml(Boolean(checked))}
                    />
                    <span
                      className="om-scenario-popover-option-label"
                      onClick={() => setExportStandaloneHtml(prev => !prev)}
                    >
                      {t('Standalone HTML')}
                    </span>
                  </div>
                  <div className="om-scenario-popover-option">
                    <Checkbox
                      aria-label={t('Include Motion project source')}
                      checked={exportMotionSource}
                      onCheckedChange={checked => setExportMotionSource(Boolean(checked))}
                    />
                    <span
                      className="om-scenario-popover-option-label"
                      onClick={() => setExportMotionSource(prev => !prev)}
                    >
                      {t('Include Motion project source')}
                    </span>
                  </div>
                </div>

                {onCopySummaryJson && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    icon={<RemixIcon name="file-copy-line" size={14} />}
                    onClick={() => {
                      setExportPopoverOpen(false);
                      void onCopySummaryJson();
                    }}
                  >
                    {t('Copy summary (JSON)')}
                  </Button>
                )}
              </div>
            </Popover>
          )}

          {!pickRequest && items.length > 0 && (
            <IconButton
              variant={selectionMode ? 'secondary' : 'ghost'}
              size="sm"
              type="button"
              aria-label={t(selectionMode ? 'Done' : 'Select')}
              title={t(selectionMode ? 'Done' : 'Select')}
              aria-pressed={selectionMode}
              icon={<RemixIcon name={selectionMode ? 'check-line' : 'checkbox-blank-line'} size={14} />}
              onClick={() => {
                if (selectionMode) {
                  setSelectionMode(false);
                  setSelectedExportIds([]);
                } else {
                  setSelectionMode(true);
                }
              }}
            />
          )}

          {onRefresh && (
            <IconButton
              variant="ghost"
              size="sm"
              type="button"
              aria-label={t('Sync assets')}
              title={t('Sync assets')}
              onClick={() => void onRefresh()}
              icon={<RemixIcon name="refresh-line" size={14} />}
            />
          )}

          {presentation !== 'inline' && layoutMode === 'docked' && onToggleCollapsed && (
            <IconButton
              variant="ghost"
              size="sm"
              type="button"
              aria-label={t('Collapse assets')}
              title={t('Collapse assets')}
              onClick={onToggleCollapsed}
              icon={<RemixIcon name="side-bar-line" size={15} />}
            />
          )}

          {presentation !== 'inline' && layoutMode !== 'docked' && (
            <IconButton
              variant="ghost"
              size="sm"
              type="button"
              aria-label={t('Close assets')}
              onClick={() => onOpenChange(false)}
              icon={<RemixIcon name="close-line" size={16} />}
            />
          )}
        </div>
      </header>

      {fileDragActive && (
        <div className="om-scenario-pool-drop-hint" role="status">
          <RemixIcon name="upload-2-line" size={16} />
          <span>{t('Drop files to upload to assets')}</span>
        </div>
      )}

      {exportSelectionActive && (
        <div className="om-scenario-pool-selection-bar" role="region" aria-label={t('Export selected assets')}>
          <div className="om-scenario-pool-selection-meta">
            <strong>{t('{count} selected', { count: selectedExportIds.length })}</strong>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={visibleItems.length === 0}
              onClick={toggleSelectAllVisibleForExport}
            >
              {t(allVisibleSelectedForExport ? 'Deselect all' : 'Select all')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setSelectionMode(false);
                setSelectedExportIds([]);
              }}
            >
              {t('Done')}
            </Button>
          </div>
          <Button
            variant="primary"
            size="sm"
            type="button"
            loading={exportingBundle}
            disabled={selectedExportIds.length === 0 || (!onExportBundle && selectedExportIds.length > 1)}
            icon={<RemixIcon name="download-2-line" size={14} />}
            onClick={() => void handleExportSelected()}
          >
            {t('Export ({count})', { count: selectedExportIds.length })}
          </Button>
        </div>
      )}

      {pickRequest && (
        <div className="om-scenario-pick-banner" role="region" aria-label={t('Choose assets')}>
          <div className="om-scenario-pick-banner-copy">
            <strong>{t('Select assets for {slot}', { slot: pickRequest.slot })}</strong>
            <span className="om-muted">
              {pickRequest.max
                ? t('Choose up to {max} matching item(s).', { max: pickRequest.max })
                : t('Choose one or more matching items.')}
            </span>
          </div>
          <div className="om-scenario-pick-actions">
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={() => onConfirmPick(selectedPickIds)}
            >
              {t('Use {count} selected', { count: selectedPickIds.length })}
            </Button>
            <Button variant="ghost" size="sm" type="button" onClick={onCancelPick}>
              {t('Cancel')}
            </Button>
          </div>
        </div>
      )}

      {(items.length > 0 || pickRequest !== null || hasActiveFilters) && (
        <div className="om-scenario-pool-filters">
          <div className="om-scenario-kind-chips" role="group" aria-label={t('Filter by asset kind')}>
            {KIND_FILTERS.map(filter => {
              const disallowedInPick =
                pickRequest !== null &&
                filter.id !== 'all' &&
                !pickRequest.kinds.includes(filter.id);
              if (disallowedInPick) return null;
              const visibleKind =
                filter.id === 'all' ||
                kindCounts[filter.id] > 0 ||
                kindFilter === filter.id ||
                (pickRequest !== null && pickRequest.kinds.includes(filter.id));
              if (!visibleKind) return null;
              return (
                <FilterChip
                  key={filter.id}
                  active={kindFilter === filter.id}
                  className="om-scenario-kind-chip"
                  data-pool-kind={filter.id}
                  onClick={() => setKindFilter(filter.id)}
                >
                  <span className="om-scenario-kind-chip-icon" aria-hidden="true">
                    <RemixIcon name={filter.icon} size={12} />
                  </span>
                  <span>{t(filter.label)}</span>
                  <span className="om-scenario-chip-count">{kindCounts[filter.id]}</span>
                </FilterChip>
              );
            })}
          </div>

          {(items.length > 1 || stepFilters.length > 0) && (
            <div className="om-scenario-step-filter-row">
              <Popover
                align="end"
                aria-label={t('Filter by step')}
                className="om-scenario-step-popover"
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    icon={<RemixIcon name="filter-3-line" size={14} />}
                  >
                    <span>{t('Step filter')}</span>
                    {stepFilters.length > 0 && (
                      <span className="om-badge" data-active="true">
                        {stepFilters.length}
                      </span>
                    )}
                  </Button>
                }
              >
                <div className="om-scenario-popover-body">
                  <div className="om-scenario-popover-header">
                    <strong>{t('Filter by source step')}</strong>
                    <span className="om-muted">
                      {t('{count} matching', { count: visibleItems.length })}
                    </span>
                  </div>
                  <div className="om-scenario-popover-list">
                    {scenario.steps.map(step => {
                      const checked = stepFilters.includes(step.id);
                      const count = stepCounts.get(step.id) ?? 0;
                      return (
                        <div key={step.id} className="om-scenario-popover-option">
                          <Checkbox
                            aria-label={t(step.title)}
                            checked={checked}
                            onCheckedChange={next => setStepFilter(step.id, Boolean(next))}
                          />
                          <span
                            className="om-scenario-popover-option-label"
                            onClick={() => setStepFilter(step.id, !checked)}
                          >
                            {t(step.title)}
                          </span>
                          <span className="om-scenario-chip-count">{count}</span>
                        </div>
                      );
                    })}
                    <div className="om-scenario-popover-option">
                      <Checkbox
                        aria-label={t('Added manually')}
                        checked={stepFilters.includes(MANUAL_STEP_KEY)}
                        onCheckedChange={next => setStepFilter(MANUAL_STEP_KEY, Boolean(next))}
                      />
                      <span
                        className="om-scenario-popover-option-label"
                        onClick={() => setStepFilter(MANUAL_STEP_KEY, !stepFilters.includes(MANUAL_STEP_KEY))}
                      >
                        {t('Added manually')}
                      </span>
                      <span className="om-scenario-chip-count">
                        {stepCounts.get(MANUAL_STEP_KEY) ?? 0}
                      </span>
                    </div>
                  </div>
                  <div className="om-scenario-popover-footer">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={stepFilters.length === 0}
                      onClick={() => setStepFilters([])}
                    >
                      {t('Clear current')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={!hasActiveFilters}
                      onClick={clearAllFilters}
                    >
                      {t('Clear all')}
                    </Button>
                  </div>
                </div>
              </Popover>
            </div>
          )}

          {hasActiveFilters && (
            <div className="om-scenario-active-filters" aria-label={t('Active filters')}>
              {kindFilter !== 'all' && (
                <Button
                  variant="plain"
                  type="button"
                  className="om-badge om-scenario-filter-chip"
                  onClick={() => setKindFilter('all')}
                >
                  <span>{t(KIND_BADGE_LABELS[kindFilter])}</span>
                  <RemixIcon name="close-line" size={12} />
                </Button>
              )}
              {stepFilters.map(key => {
                const label =
                  key === MANUAL_STEP_KEY
                    ? t('Added manually')
                    : t(stepTitleMap.get(key) ?? key);
                return (
                  <Button
                    key={key}
                    variant="plain"
                    type="button"
                    className="om-badge om-scenario-filter-chip"
                    onClick={() => toggleStepFilter(key)}
                  >
                    <span>{label}</span>
                    <RemixIcon name="close-line" size={12} />
                  </Button>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={clearAllFilters}
              >
                {t('Clear all')}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="om-scenario-pool-scroll">
        {items.length === 0 ? (
          <div className="om-scenario-pool-empty">
            <PanelEmptyState
              icon="stack-line"
              message={t('No assets yet')}
              description={t('Upload files, pick from your workspace, or generate in any step — everything you create appears here.')}
            />
            <div className="om-scenario-pool-empty-actions">
              <Button
                variant="primary"
                size="sm"
                type="button"
                icon={<RemixIcon name="upload-2-line" size={14} />}
                loading={uploading}
                aria-describedby={uploadHintId}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('Upload files')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                icon={<RemixIcon name="folder-open-line" size={14} />}
                onClick={() => setAssetPickerOpen(true)}
              >
                {t('Pick from workspace')}
              </Button>
            </div>
            <p id={uploadHintId} className="om-scenario-pool-upload-hint om-scenario-pool-upload-hint--empty">{uploadHint}</p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="om-scenario-pool-empty">
            <PanelEmptyState
              icon="filter-3-line"
              message={t('No matching assets')}
              description={t('Try clearing filters or add a matching asset.')}
            />
            {hasActiveFilters && (
              <div className="om-scenario-pool-empty-actions">
                <Button variant="secondary" size="sm" type="button" onClick={clearAllFilters}>
                  {t('Clear all')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div
            className="om-scenario-pool-grid"
            data-image-picker={pickRequest?.kinds.length === 1 && pickRequest.kinds[0] === 'image' ? true : undefined}
          >
            {visibleItems.map(item => {
              const isHighlighted = highlightedIds.has(item.id);
              const isSelectedForPick = selectedPickIds.includes(item.id);
              const isSelectedForExport = !pickRequest && selectedExportSet.has(item.id);
              const isCardSelected = pickRequest ? isSelectedForPick : isSelectedForExport;
              const pickLimitReached =
                pickRequest !== null &&
                pickRequest.max !== undefined &&
                pickRequest.max > 1 &&
                !isSelectedForPick &&
                selectedPickIds.length >= pickRequest.max;
              const canUse = presentation !== 'inline' && currentStep.accepts.includes(item.kind);
              const stepTitle = item.stepId ? stepTitleMap.get(item.stepId) : null;
              const sourceBadge = stepTitle
                ? t('From {step}', { step: t(stepTitle) })
                : item.source === 'upload'
                  ? t('Upload')
                  : item.source === 'workspace'
                    ? t('Workspace')
                    : item.source === 'agent'
                      ? t('Agent')
                      : t('Generated');

              return (
                <article
                  key={item.id}
                  className="om-scenario-pool-card"
                  data-pool-item={item.id}
                  data-kind={item.kind}
                  data-pinned={item.pinned || undefined}
                  data-highlighted={isHighlighted || undefined}
                  data-selected={isCardSelected || undefined}
                  draggable={!pickRequest}
                  onDragStart={event => {
                    if (pickRequest) return;
                    event.dataTransfer.setData('application/x-om-pool-item', item.id);
                    event.dataTransfer.effectAllowed = 'copyLink';
                  }}
                >
                  <div className="om-scenario-pool-card-media">
                    <PoolThumb item={item} run={run} size="md" hoverPreview />
                    {pickRequest ? (
                      <div className="om-scenario-pool-card-check">
                        <Checkbox
                          aria-label={t('Select {label}', { label: item.label })}
                          checked={isSelectedForPick}
                          disabled={pickLimitReached}
                          onCheckedChange={() => togglePickItem(item.id)}
                        />
                      </div>
                    ) : (
                      <div
                        className="om-scenario-pool-card-check"
                        data-export-select="true"
                        data-checked={isSelectedForExport ? 'true' : undefined}
                        data-selection-mode={exportSelectionActive ? 'true' : undefined}
                      >
                        <Checkbox
                          aria-label={t('Select {label}', { label: item.label })}
                          checked={isSelectedForExport}
                          onCheckedChange={() => toggleExportItem(item.id)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="om-scenario-pool-card-body">
                    <div className="om-scenario-pool-card-top">
                      {renamingId === item.id ? (
                        <FieldInput
                          ref={renameInputRef}
                          density="compact"
                          className="om-scenario-pool-rename"
                          aria-label={t('Rename asset')}
                          value={renameDraft}
                          maxLength={200}
                          onChange={event => setRenameDraft(event.target.value)}
                          onBlur={() => void commitRename(item)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void commitRename(item);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              skipRenameBlurRef.current = true;
                              setRenamingId(null);
                            }
                          }}
                        />
                      ) : (
                        <strong className="om-scenario-pool-card-label" title={item.label}>
                          {item.label}
                        </strong>
                      )}

                      <div className="om-scenario-pool-card-controls">
                        <IconButton
                          variant="ghost"
                          size="sm"
                          type="button"
                          disabled={!canDownloadItem(item)}
                          aria-label={t('Export {label}', { label: item.label })}
                          title={t('Export')}
                          onClick={() => void handleDownloadItem(item)}
                          icon={<RemixIcon name="download-2-line" size={14} />}
                        />

                        <IconButton
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="om-scenario-pin-button"
                          aria-label={t(item.pinned ? 'Unpin asset' : 'Pin asset')}
                          aria-pressed={item.pinned}
                          onClick={() => void handleTogglePin(item)}
                          icon={
                            <RemixIcon
                              name={item.pinned ? 'sparkling-fill' : 'sparkling-line'}
                              size={14}
                            />
                          }
                        />

                        <Menu
                          align="end"
                          aria-label={t('Actions for {label}', { label: item.label })}
                          trigger={
                            <IconButton
                              variant="ghost"
                              size="sm"
                              type="button"
                              aria-label={t('Asset actions')}
                              icon={<RemixIcon name="more-line" size={14} />}
                            />
                          }
                        >
                          {presentation !== 'inline' && (
                            <MenuItem
                              icon={<RemixIcon name="check-line" size={14} />}
                              disabled={!canUse}
                              onClick={() => void onUseInCurrentStep(item)}
                            >
                              {t('Use in current step')}
                            </MenuItem>
                          )}
                          <MenuItem
                            icon={<RemixIcon name="eye-line" size={14} />}
                            onClick={() => setPreviewItemId(item.id)}
                          >
                            {t('Preview')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="download-2-line" size={14} />}
                            disabled={!canDownloadItem(item)}
                            onClick={() => void handleDownloadItem(item)}
                          >
                            {t('Download')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="external-link-line" size={14} />}
                            disabled={item.ref.type === 'text'}
                            onClick={() => handleOpenItem(item)}
                          >
                            {t('Open')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="file-copy-line" size={14} />}
                            onClick={() => void handleCopyReference(item)}
                          >
                            {t('Copy reference')}
                          </MenuItem>
                          <MenuItem
                            icon={<RemixIcon name="edit-line" size={14} />}
                            onClick={() => beginRename(item)}
                          >
                            {t('Rename')}
                          </MenuItem>
                          <MenuSeparator />
                          <MenuItem
                            icon={<RemixIcon name="delete-bin-line" size={14} />}
                            tone="danger"
                            onClick={() => void handleRemoveItem(item)}
                          >
                            {t('Remove from workflow')}
                          </MenuItem>
                        </Menu>
                      </div>
                    </div>

                    <div className="om-scenario-pool-card-badges">
                      <span
                        className="om-badge om-scenario-pool-kind-badge"
                        data-pool-kind={item.kind}
                      >
                        <RemixIcon
                          name={KIND_FILTERS.find(f => f.id === item.kind)?.icon ?? 'file-line'}
                          size={11}
                        />
                        <span>{t(KIND_BADGE_LABELS[item.kind])}</span>
                      </span>
                      <span className="om-badge">{sourceBadge}</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const toggleSelectedProjectId = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    projectId: string,
  ) => {
    setter(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId],
    );
  };

  const dialogs = (
    <>
      {assetPickerOpen && (
        <AssetPicker
          multiple
          title="Import from workspace"
          confirmLabel="Import to assets"
          busy={assetPickerBusy}
          onClose={() => setAssetPickerOpen(false)}
          onPickMany={picked => void handleWorkspaceAssetsImport(picked)}
        />
      )}

      {designPickerOpen && (
        <Dialog.Root open onOpenChange={next => { if (!next) setDesignPickerOpen(false); }}>
          <Dialog.Portal>
            <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
            <Dialog.Popup
              data-feedback-modal=""
              className="om-dialog om-scenario-picker-dialog"
              onKeyDown={event => event.stopPropagation()}
            >
              <header className="om-scenario-preview-header">
                <Dialog.Title className="om-subtitle">{t('Import Design pages')}</Dialog.Title>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={t('Close')}
                  onClick={() => setDesignPickerOpen(false)}
                  icon={<RemixIcon name="close-line" size={18} />}
                />
              </header>
              {designProjects.length > 0 && !designLoading && !designError && (
                <div className="om-scenario-picker-toolbar">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={importingProjects}
                    onClick={() =>
                      setSelectedDesignIds(prev =>
                        prev.length === designProjects.length ? [] : designProjects.map(p => p.id),
                      )
                    }
                  >
                    {t(
                      selectedDesignIds.length === designProjects.length
                        ? 'Deselect all'
                        : 'Select all ({count})',
                      { count: designProjects.length },
                    )}
                  </Button>
                  {selectedDesignIds.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={importingProjects}
                      onClick={() => setSelectedDesignIds([])}
                    >
                      {t('Clear')}
                    </Button>
                  )}
                  <span className="om-muted">{t('{count} selected', { count: selectedDesignIds.length })}</span>
                </div>
              )}
              <div className="om-scenario-picker-list">
                {designLoading ? (
                  <div className="om-scenario-runs-skeleton">
                    <Skeleton className="om-scenario-run-skeleton-row" />
                    <Skeleton className="om-scenario-run-skeleton-row" />
                  </div>
                ) : designError ? (
                  <div className="om-scenario-runs-error" role="alert">
                    <RemixIcon name="error-warning-line" size={18} />
                    <span>{designError}</span>
                    <Button variant="secondary" size="sm" onClick={() => void loadDesignProjects()}>
                      {t('Retry')}
                    </Button>
                  </div>
                ) : designProjects.length === 0 ? (
                  <PanelEmptyState
                    icon="layout-line"
                    message={t('No Design projects yet')}
                    description={t('Create a web page in a workflow step or in Design Studio first.')}
                  />
                ) : (
                  designProjects.map(project => {
                    const checked = selectedDesignIds.includes(project.id);
                    return (
                      <div
                        key={project.id}
                        className="om-scenario-picker-row om-scenario-picker-select-row"
                        data-selected={checked || undefined}
                      >
                        <Checkbox
                          aria-label={project.title}
                          checked={checked}
                          onCheckedChange={() => toggleSelectedProjectId(setSelectedDesignIds, project.id)}
                        />
                        <RemixIcon name="layout-line" size={16} />
                        <span
                          className="om-scenario-picker-row-title"
                          onClick={() => toggleSelectedProjectId(setSelectedDesignIds, project.id)}
                        >
                          {project.title}
                        </span>
                        <span className="om-badge">
                          {t(findDesignScenario(project.scenario)?.label ?? project.scenario)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
              {designProjects.length > 0 && !designLoading && !designError && (
                <footer className="om-scenario-picker-footer">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={importingProjects}
                    onClick={() => void handleImportDesignProjects(designProjects)}
                  >
                    {t('Import all ({count})', { count: designProjects.length })}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    loading={importingProjects}
                    disabled={selectedDesignIds.length === 0 || importingProjects}
                    onClick={() =>
                      void handleImportDesignProjects(
                        designProjects.filter(project => selectedDesignIds.includes(project.id)),
                      )
                    }
                  >
                    {t('Import ({count})', { count: selectedDesignIds.length })}
                  </Button>
                </footer>
              )}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {motionPickerOpen && (
        <Dialog.Root open onOpenChange={next => { if (!next) setMotionPickerOpen(false); }}>
          <Dialog.Portal>
            <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
            <Dialog.Popup
              data-feedback-modal=""
              className="om-dialog om-scenario-picker-dialog"
              onKeyDown={event => event.stopPropagation()}
            >
              <header className="om-scenario-preview-header">
                <Dialog.Title className="om-subtitle">{t('Import Motion projects')}</Dialog.Title>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label={t('Close')}
                  onClick={() => setMotionPickerOpen(false)}
                  icon={<RemixIcon name="close-line" size={18} />}
                />
              </header>
              {motionProjects.length > 0 && (
                <div className="om-scenario-picker-toolbar">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={importingProjects}
                    onClick={() =>
                      setSelectedMotionIds(prev =>
                        prev.length === motionProjects.length ? [] : motionProjects.map(p => p.id),
                      )
                    }
                  >
                    {t(
                      selectedMotionIds.length === motionProjects.length
                        ? 'Deselect all'
                        : 'Select all ({count})',
                      { count: motionProjects.length },
                    )}
                  </Button>
                  {selectedMotionIds.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={importingProjects}
                      onClick={() => setSelectedMotionIds([])}
                    >
                      {t('Clear')}
                    </Button>
                  )}
                  <span className="om-muted">{t('{count} selected', { count: selectedMotionIds.length })}</span>
                </div>
              )}
              <div className="om-scenario-picker-list">
                {motionProjects.length === 0 ? (
                  <PanelEmptyState
                    icon="movie-line"
                    message={t('No Motion projects available')}
                    description={t('Create a Motion project from the video step or Motion Studio first.')}
                  />
                ) : (
                  motionProjects.map(project => {
                    const checked = selectedMotionIds.includes(project.id);
                    return (
                      <div
                        key={project.id}
                        className="om-scenario-picker-row om-scenario-picker-select-row"
                        data-selected={checked || undefined}
                      >
                        <Checkbox
                          aria-label={project.title}
                          checked={checked}
                          onCheckedChange={() => toggleSelectedProjectId(setSelectedMotionIds, project.id)}
                        />
                        <RemixIcon name="film-line" size={16} />
                        <span
                          className="om-scenario-picker-row-title"
                          onClick={() => toggleSelectedProjectId(setSelectedMotionIds, project.id)}
                        >
                          {project.title}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
              {motionProjects.length > 0 && (
                <footer className="om-scenario-picker-footer">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={importingProjects}
                    onClick={() => void handleImportMotionProjects(motionProjects)}
                  >
                    {t('Import all ({count})', { count: motionProjects.length })}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    loading={importingProjects}
                    disabled={selectedMotionIds.length === 0 || importingProjects}
                    onClick={() =>
                      void handleImportMotionProjects(
                        motionProjects.filter(project => selectedMotionIds.includes(project.id)),
                      )
                    }
                  >
                    {t('Import ({count})', { count: selectedMotionIds.length })}
                  </Button>
                </footer>
              )}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      <PoolItemPreviewDialog
        item={previewItem}
        run={run}
        canUseInCurrentStep={
          presentation !== 'inline' &&
          Boolean(previewItem && currentStep.accepts.includes(previewItem.kind))
        }
        canDownloadMotion={Boolean(onExportBundle)}
        onClose={() => setPreviewItemId(null)}
        onUseInCurrentStep={item => void onUseInCurrentStep(item)}
        onDownload={item => void handleDownloadItem(item)}
        onOpen={handleOpenItem}
        onCopyReference={item => void handleCopyReference(item)}
      />
    </>
  );

  if (presentation === 'inline') {
    return (
      <>
        <section
          id="om-scenario-pool"
          aria-label={t('Assets')}
          className="om-scenario-pool om-scenario-pool--inline"
        >
          {panelBody}
        </section>
        {dialogs}
      </>
    );
  }

  if (layoutMode === 'sheet') {
    return (
      <>
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
          <Dialog.Portal>
            <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
            <Dialog.Popup
              id="om-scenario-pool"
              data-feedback-modal=""
              className="om-scenario-pool om-scenario-pool--sheet"
              onKeyDown={event => event.stopPropagation()}
            >
              {panelBody}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
        {dialogs}
      </>
    );
  }

  if (layoutMode === 'drawer') {
    return (
      <>
        <div
          className="om-scenario-drawer-scrim"
          data-open={open ? 'true' : 'false'}
          hidden={!open}
          aria-hidden="true"
          onClick={() => onOpenChange(false)}
        />
        <aside
          id="om-scenario-pool"
          aria-label={t('Assets')}
          aria-hidden={!open || undefined}
          inert={!open}
          className="om-scenario-pool om-scenario-pool--drawer"
          data-open={open ? 'true' : 'false'}
          hidden={!open}
        >
          {panelBody}
        </aside>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <aside
        id="om-scenario-pool"
        aria-label={t('Assets')}
        aria-hidden={Boolean(collapsed) || undefined}
        inert={Boolean(collapsed)}
        className="om-scenario-pool om-scenario-pool--docked"
        data-collapsed={collapsed ? 'true' : 'false'}
        hidden={Boolean(collapsed)}
      >
        {panelBody}
      </aside>
      {dialogs}
    </>
  );
}
