import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../packages/design-system/react/RemixIcons';
import {
  designCommentsPrompt, designProjectPrompt, designRoutes, designViewports, findDesignScenario,
  type DesignComment, type DesignCommentAnchor, type DesignExportFormat, type DesignViewportId,
} from '../../../shared/design-project';
import type { ReviewAnnotation, ReviewPoint } from '../../../shared/review-comments';
import { IconButton } from 'open-design-ui/icon-button';
import { Tooltip } from '../components/ui';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { ResizablePane } from '../motion/ResizablePane';
import { ReviewAnnotationGraphic } from '../motion/ReviewAnnotationGraphic';
import { useIntegrationInfo } from '../motion/useIntegrationInfo';
import { CodeViewer } from './CodeViewer';
import { DesignApiError, designClient, makeRequestId } from './designClient';
import { buildBridgeSrcDoc, looksLikeDeck, parseDeckSlides, parseSpeakerNotes, type PickedElement } from './previewBridge';
import { useDesignProject } from './useDesignProject';
import './design.css';

type AnnotationTool = 'none' | 'comment' | 'region' | 'pen';
type SidebarTab = 'files' | 'comments' | 'versions';
type PendingDraft = {
  element?: PickedElement;
  region?: { x: number; y: number; width: number; height: number };
  annotation?: ReviewAnnotation;
  pinX: number;
  pinY: number;
};

const ZOOM_STEPS = [50, 75, 100, 125, 150];

function formatTime(ms: number) {
  try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function annotationBounds(annotation: ReviewAnnotation) {
  const pts = annotation.marks.flatMap(m => m.points);
  if (!pts.length) return { minX: 0.05, minY: 0.05, maxX: 0.2, maxY: 0.2 };
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeInlineJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Build isolated Presenter popup HTML with sandboxed deck iframe and escaped title/notes. */
export function buildPresenterPopupHtml(title: string, rawUrl: string, speakerNotes: string[], total: number): string {
  const safeTotal = Math.max(1, Math.floor(total));
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(rawUrl);
  const safeNotesJson = escapeInlineJson(speakerNotes);
  return `<!doctype html><html><head><title>${safeTitle} — Presenter</title>
<link rel="stylesheet" href="/design-system/ui.css" />
<style>body{margin:0;background:var(--motion-bg);color:var(--motion-text);font-family:var(--motion-font-sans);display:grid;grid-template-columns:2fr 1fr;height:100vh}
iframe{width:100%;height:100%;border:0;background:var(--motion-canvas)}aside{display:flex;flex-direction:column;gap:12px;padding:18px;background:var(--motion-panel);border-left:1px solid var(--motion-border-subtle)}
.row{display:flex;gap:8px;align-items:center}button{padding:8px 14px;border-radius:8px;border:1px solid var(--motion-border);background:var(--motion-raised);color:var(--motion-text);cursor:pointer}
.notes{flex:1;overflow:auto;line-height:1.6;color:var(--motion-muted);white-space:pre-wrap;font-size:15px}</style></head>
<body data-motion-ui><iframe id="deck" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" src="${safeUrl}"></iframe>
<aside><div class="row"><strong id="counter">1 / ${safeTotal}</strong><span id="timer" style="margin-left:auto;font-variant-numeric:tabular-nums">00:00</span></div>
<div class="row"><button onclick="go(cur-1)">Prev</button><button onclick="go(cur+1)">Next</button><button onclick="reset()">Reset timer</button></div>
<div class="notes" id="notes"></div></aside>
<script id="om-presenter-notes" type="application/json">${safeNotesJson}</script>
<script>const notes=JSON.parse(document.getElementById('om-presenter-notes').textContent||'[]');let cur=0,sec=0;const f=document.getElementById('deck');
function render(){document.getElementById('counter').textContent=(cur+1)+' / ${safeTotal}';document.getElementById('notes').textContent=notes[cur]||'No speaker notes for this slide.';}
function go(i){cur=Math.max(0,Math.min(${safeTotal - 1},i));f.contentWindow.postMessage({type:'od:slide',action:'go',index:cur},'*');render();}
function reset(){sec=0;}setInterval(()=>{sec++;document.getElementById('timer').textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');},1000);
window.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')go(cur+1);if(e.key==='ArrowLeft')go(cur-1);});render();</script></body></html>`;
}

/** Convert pointer client coordinates into the overlay's unscaled local layout coordinate space. */
export function overlayLocalPoint(el: Pick<HTMLElement, 'getBoundingClientRect' | 'clientWidth' | 'clientHeight'>, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  const width = el.clientWidth > 0 ? el.clientWidth : Math.max(1, Math.round(rect.width));
  const height = el.clientHeight > 0 ? el.clientHeight : Math.max(1, Math.round(rect.height));
  const scaleX = width > 0 && rect.width > 0 ? rect.width / width : 1;
  const scaleY = height > 0 && rect.height > 0 ? rect.height / height : 1;
  return {
    x: (clientX - rect.left) / scaleX,
    y: (clientY - rect.top) / scaleY,
    width,
    height,
  };
}

function AnnotationVisualPreview({
  element,
  region,
  annotation,
  viewport,
}: {
  element?: { selector: string };
  region?: { x: number; y: number; width: number; height: number };
  annotation?: ReviewAnnotation;
  viewport?: { width: number; height: number };
}) {
  if (annotation) {
    const b = annotationBounds(annotation);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="om-design-annotation-thumb" aria-hidden="true">
          <svg width="100%" height="100%" viewBox="0 0 160 90" preserveAspectRatio="none" style={{ display: 'block' }}>
            <ReviewAnnotationGraphic annotation={{ ...annotation, width: 160, height: 90 }} />
          </svg>
        </div>
        <div className="om-design-annotation-meta">
          <span>Draw · {annotation.marks.length} stroke</span>
          <span>{Math.round(b.minX * 100)}%–{Math.round(b.maxX * 100)}%, {Math.round(b.minY * 100)}%–{Math.round(b.maxY * 100)}%</span>
        </div>
      </div>
    );
  }
  if (region) {
    const vw = Math.max(1, viewport?.width ?? 1440);
    const vh = Math.max(1, viewport?.height ?? 900);
    const leftPct = Math.max(0, Math.min(96, (region.x / vw) * 100));
    const topPct = Math.max(0, Math.min(96, (region.y / vh) * 100));
    const widthPct = Math.max(4, Math.min(100 - leftPct, (region.width / vw) * 100));
    const heightPct = Math.max(4, Math.min(100 - topPct, (region.height / vh) * 100));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="om-design-annotation-thumb" aria-hidden="true">
          <div className="om-design-annotation-thumb-region" style={{ left: `${leftPct}%`, top: `${topPct}%`, width: `${widthPct}%`, height: `${heightPct}%` }} />
        </div>
        <div className="om-design-annotation-meta">
          <span>Region · {Math.round(region.width)} × {Math.round(region.height)}</span>
          <span>({Math.round(region.x)}, {Math.round(region.y)})</span>
        </div>
      </div>
    );
  }
  if (element) {
    return <code className="om-design-selector-chip">{element.selector}</code>;
  }
  return null;
}

export function DesignProjectEditor({
  projectId,
  onBack,
  onOpenMcp,
}: {
  projectId: string;
  onBack: () => void;
  onOpenMcp?: () => void;
}) {
  const { t, locale } = useI18n();
  const { info: integrationInfo } = useIntegrationInfo();
  const promptOptions = { integration: integrationInfo, language: locale !== 'en' ? locale : null };
  const toast = useToast();
  const { project, versions, currentVersionId, comments, editors, loading, error, refresh, setProject, setComments } = useDesignProject(projectId);

  const [titleDraft, setTitleDraft] = useState('');
  const [activeFile, setActiveFile] = useState<string>('');
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview');
  const [viewportId, setViewportId] = useState<DesignViewportId>('desktop');
  const [rotated, setRotated] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [commentFilter, setCommentFilter] = useState<'open' | 'all' | 'resolved'>('open');
  const [activeTool, setActiveTool] = useState<AnnotationTool>('none');
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Code view state
  const [fileContent, setFileContent] = useState<string>('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeEditing, setCodeEditing] = useState(false);
  const [codeEditBaseRevision, setCodeEditBaseRevision] = useState<string | null>(null);
  const [codeConflict, setCodeConflict] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [reloadingCode, setReloadingCode] = useState(false);
  const fileReadSeqRef = useRef(0);

  // Deck state
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideCount, setSlideCount] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);

  // Agent copy popover & fallback
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentNote, setAgentNote] = useState('');
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [exporting, setExporting] = useState<DesignExportFormat | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [openInOpen, setOpenInOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  // Region / Pen drawing state
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [penPoints, setPenPoints] = useState<ReviewPoint[]>([]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const bridgeToken = useMemo(() => makeRequestId('bridge'), []);

  // Sync title, active file, and default viewport when project loads
  useEffect(() => {
    if (!project) return;
    setTitleDraft(project.title);
    setActiveFile(prev => (prev && project.files.some(f => f.path === prev) ? prev : project.entry));
    if (project.scenario === 'mobile-app') setViewportId('mobile');
  }, [project?.id]);

  // Reset edit session when switching project or active file
  useEffect(() => {
    setCodeEditing(false);
    setCodeEditBaseRevision(null);
    setCodeConflict(false);
  }, [project?.id, activeFile]);

  // Load text content for active file (needed for code view, deck parsing, and srcdoc bridge)
  useEffect(() => {
    if (!project || !activeFile) return;
    let cancelled = false;
    const seq = ++fileReadSeqRef.current;
    setCodeLoading(true);
    designClient.readFile(project.id, activeFile).then(res => {
      if (cancelled || fileReadSeqRef.current !== seq) return;
      setFileContent(res.content);
      if (!codeEditing) setCodeDraft(res.content);
    }).catch(() => {
      if (!cancelled && fileReadSeqRef.current === seq) setFileContent('');
    }).finally(() => {
      if (!cancelled && fileReadSeqRef.current === seq) setCodeLoading(false);
    });
    return () => { cancelled = true; };
  }, [project?.id, project?.revision, activeFile, reloadNonce]);

  const htmlFiles = useMemo(() => project?.files.filter(f => f.kind === 'html') ?? [], [project]);
  const effectiveFile = activeFile || project?.entry || '';
  const isHtmlActive = useMemo(() => /\.html?$/i.test(effectiveFile), [effectiveFile]);
  const isDeck = useMemo(() => project?.scenario === 'deck' || (isHtmlActive && looksLikeDeck(fileContent)), [project?.scenario, isHtmlActive, fileContent]);
  const deckSlides = useMemo(() => (isDeck && fileContent ? parseDeckSlides(fileContent) : []), [isDeck, fileContent]);
  const speakerNotes = useMemo(() => (isDeck && fileContent ? parseSpeakerNotes(fileContent) : []), [isDeck, fileContent]);

  useEffect(() => {
    if (deckSlides.length > 0 && slideCount === 0) setSlideCount(deckSlides.length);
  }, [deckSlides.length, slideCount]);

  // Escape dismisses active annotation tool / composer
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveTool('none');
        setPendingDraft(null);
        setDragStart(null);
        setPenPoints([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Listen to bridge postMessages from preview iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'od:slide-state' && typeof data.active === 'number' && typeof data.count === 'number') {
        setActiveSlide(data.active);
        setSlideCount(data.count);
      } else if (data.type === 'om:design-pick' && data.token === bridgeToken && data.element) {
        const pt = data.clientPoint ?? { x: 100, y: 100 };
        setPendingDraft({ element: data.element, pinX: pt.x, pinY: pt.y });
        setCommentText('');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bridgeToken]);

  // Toggle pick mode inside bridge iframe
  useEffect(() => {
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'om:design-mode', token: bridgeToken, pick: activeTool === 'comment' }, '*');
    } catch { /* ignore */ }
  }, [activeTool, bridgeToken]);

  const sendDeckCommand = useCallback((action: 'next' | 'prev' | 'first' | 'last' | 'go', index?: number) => {
    const total = Math.max(1, slideCount || deckSlides.length);
    const target = action === 'go' && typeof index === 'number' ? Math.max(0, Math.min(total - 1, index))
      : action === 'next' ? Math.min(total - 1, activeSlide + 1)
      : action === 'prev' ? Math.max(0, activeSlide - 1)
      : action === 'last' ? total - 1 : 0;
    setActiveSlide(target);
    try { iframeRef.current?.contentWindow?.postMessage({ type: 'od:slide', action: 'go', index: target }, '*'); } catch { /* ignore */ }
  }, [activeSlide, slideCount, deckSlides.length]);

  const showToast = toast.showToast;
  const copyPrompt = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManualCopy(null);
      showToast(t('Copied. Paste into your Agent.'), 'info', 'feedback');
    } catch {
      setManualCopy(text);
      showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback');
    }
  }, [showToast, t]);

  const commitTitle = async () => {
    if (!project) return;
    const next = titleDraft.trim();
    if (!next || next === project.title) { setTitleDraft(project.title); return; }
    try {
      const { project: updated } = await designClient.renameProject(project.id, next, project.title);
      setProject(updated);
      toast.showToast(t('Project renamed'), 'info', 'feedback');
    } catch (err) {
      setTitleDraft(project.title);
      toast.showToast(err instanceof Error ? err.message : t('Could not rename project'), 'error', 'feedback');
    }
  };

  const saveCode = async (overrideRevision?: string) => {
    if (!project || !activeFile || savingCode || reloadingCode) return;
    setSavingCode(true);
    try {
      const { project: updated } = await designClient.writeFiles(project.id, {
        expectedRevision: overrideRevision ?? codeEditBaseRevision ?? project.revision,
        files: [{ path: activeFile, content: codeDraft }],
        summary: `Manual edit to ${activeFile}`,
        source: 'manual',
      });
      setProject(updated);
      setFileContent(codeDraft);
      setCodeEditBaseRevision(null);
      setCodeConflict(false);
      setCodeEditing(false);
      await refresh();
      toast.showToast(t('Saved new version'), 'info', 'feedback');
    } catch (err) {
      if (err instanceof DesignApiError && err.code === 'VERSION_CONFLICT') {
        await refresh();
        setCodeConflict(true);
        toast.showToast(t('Project changed externally. Reload to get the latest revision.'), 'error', 'feedback');
      } else {
        toast.showToast(err instanceof Error ? err.message : t('Could not save file'), 'error', 'feedback');
      }
    } finally {
      setSavingCode(false);
    }
  };

  const discardAndReloadLatest = async () => {
    if (!project || !activeFile || savingCode || reloadingCode) return;
    setReloadingCode(true);
    const seq = ++fileReadSeqRef.current;
    try {
      const { project: latest } = await designClient.getProject(project.id);
      const targetFile = latest.files.some(f => f.path === activeFile) ? activeFile : latest.entry;
      const { content } = await designClient.readFile(latest.id, targetFile);
      if (fileReadSeqRef.current !== seq) return;
      setProject(latest);
      if (targetFile !== activeFile) setActiveFile(targetFile);
      setFileContent(content);
      setCodeDraft(content);
      setCodeEditBaseRevision(latest.revision);
      setCodeConflict(false);
    } catch (err) {
      if (fileReadSeqRef.current === seq) {
        toast.showToast(err instanceof Error ? err.message : t('Could not reload file'), 'error', 'feedback');
      }
    } finally {
      if (fileReadSeqRef.current === seq) setCodeLoading(false);
      setReloadingCode(false);
    }
  };

  const handleRestoreVersion = async (versionId: string, label: string) => {
    if (!project) return;
    try {
      const { project: updated } = await designClient.restoreVersion(project.id, versionId, project.revision);
      setProject(updated);
      setPreviewVersionId(null);
      await refresh();
      toast.showToast(t('Restored {label} as a new version', { label }), 'info', 'feedback');
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not restore version'), 'error', 'feedback');
    }
  };

  const handleExport = async (format: DesignExportFormat, versionId?: string | null) => {
    if (!project) return;
    setExporting(format);
    setExportOpen(false);
    try {
      const filename = await designClient.downloadExport(project.id, { format, versionId: versionId ?? previewVersionId, filePath: isHtmlActive ? activeFile : project.entry });
      toast.showToast(t('Exported {filename}', { filename }), 'info', 'feedback');
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Export failed'), 'error', 'feedback');
    } finally {
      setExporting(null);
    }
  };

  const handleOpenIn = async (editorId: string, label: string) => {
    if (!project) return;
    setOpenInOpen(false);
    try {
      await designClient.openIn(project.id, editorId);
      toast.showToast(t('Opened in {app}', { app: label }), 'info', 'feedback');
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not open editor'), 'error', 'feedback');
    }
  };

  const openPresenterPopup = () => {
    if (!project) return;
    const popup = window.open('', 'om-design-presenter', 'width=1200,height=760');
    if (!popup) { toast.showToast(t('Pop-up blocked by browser'), 'error', 'feedback'); return; }
    const rawUrl = new URL(designRoutes.raw(project.id, activeFile || project.entry), window.location.origin).href;
    const total = Math.max(1, slideCount || deckSlides.length);
    popup.document.write(buildPresenterPopupHtml(project.title, rawUrl, speakerNotes, total));
    popup.document.close();
  };

  const currentViewport = designViewports.find(v => v.id === viewportId) ?? designViewports[0];
  const frameWidth = currentViewport.width ? (rotated ? currentViewport.height! : currentViewport.width) : null;
  const frameHeight = currentViewport.height ? (rotated ? currentViewport.width! : currentViewport.height) : null;

  const submitDraftComment = async () => {
    if (!project || !pendingDraft || !commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const el = overlayRef.current;
      const rect = el?.getBoundingClientRect();
      const vw = frameWidth ?? Math.max(320, Math.round(el?.clientWidth || rect?.width || 1280));
      const vh = frameHeight ?? Math.max(240, Math.round(el?.clientHeight || rect?.height || 800));
      const anchor: DesignCommentAnchor = {
        filePath: activeFile || project.entry,
        viewport: { id: viewportId, width: vw, height: vh },
        ...(isDeck ? { slideIndex: activeSlide } : {}),
        ...(pendingDraft.element ? { element: pendingDraft.element } : {}),
        ...(pendingDraft.region ? { region: pendingDraft.region } : {}),
        ...(pendingDraft.annotation ? { annotation: pendingDraft.annotation } : {}),
      };
      const res = await designClient.createComment(project.id, {
        text: commentText.trim(), anchor, expectedRevision: project.revision,
      });
      setComments(res.comments);
      setPendingDraft(null);
      setCommentText('');
      setActiveTool('none');
      setSidebarOpen(true);
      setSidebarTab('comments');
      toast.showToast(t('Annotation saved'), 'info', 'feedback');
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not save annotation'), 'error', 'feedback');
    } finally {
      setSubmittingComment(false);
    }
  };

  const toggleCommentStatus = async (comment: DesignComment) => {
    if (!project) return;
    try {
      const nextStatus = comment.status === 'open' ? 'resolved' : 'open';
      const { comment: updated } = await designClient.updateComment(project.id, comment.id, {
        status: nextStatus, expectedCommentRevision: comment.commentRevision,
      });
      setComments(comments.map(c => (c.id === updated.id ? updated : c)));
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not update annotation'), 'error', 'feedback');
    }
  };

  const removeComment = async (commentId: string) => {
    if (!project) return;
    try {
      await designClient.deleteComment(project.id, commentId);
      setComments(comments.filter(c => c.id !== commentId));
    } catch (err) {
      toast.showToast(err instanceof Error ? err.message : t('Could not delete annotation'), 'error', 'feedback');
    }
  };

  // Pointer handlers for region box & pen drawing overlay (always in unscaled overlay coordinates)
  const onOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== 'region' && activeTool !== 'pen') return;
    if (event.target !== event.currentTarget) return;
    setPendingDraft(null);
    const { x, y, width, height } = overlayLocalPoint(event.currentTarget, event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (activeTool === 'region') {
      setDragStart({ x, y });
      setDragCurrent({ x, y });
    } else if (activeTool === 'pen') {
      setPenPoints([{ x: Math.max(0, Math.min(1, x / width)), y: Math.max(0, Math.min(1, y / height)) }]);
    }
  };

  const onOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const { x, y, width, height } = overlayLocalPoint(event.currentTarget, event.clientX, event.clientY);
    if (activeTool === 'region' && dragStart) {
      setDragCurrent({ x, y });
    } else if (activeTool === 'pen' && penPoints.length > 0 && event.buttons > 0) {
      setPenPoints(prev => prev.length < 900 ? [...prev, { x: Math.max(0, Math.min(1, x / width)), y: Math.max(0, Math.min(1, y / height)) }] : prev);
    }
  };

  const onOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const { width: w, height: h } = overlayLocalPoint(event.currentTarget, event.clientX, event.clientY);
    if (activeTool === 'region' && dragStart && dragCurrent) {
      const x = Math.round(Math.min(dragStart.x, dragCurrent.x));
      const y = Math.round(Math.min(dragStart.y, dragCurrent.y));
      const width = Math.round(Math.abs(dragCurrent.x - dragStart.x));
      const height = Math.round(Math.abs(dragCurrent.y - dragStart.y));
      setDragStart(null);
      setDragCurrent(null);
      if (width > 8 && height > 8) {
        setPendingDraft({ region: { x, y, width, height }, pinX: x, pinY: y });
        setCommentText('');
      }
    } else if (activeTool === 'pen' && penPoints.length >= 2) {
      const annotation: ReviewAnnotation = { version: 1, coordinateSpace: 'normalized', width: w, height: h, marks: [{ kind: 'pen', points: penPoints }] };
      const bounds = annotationBounds(annotation);
      setPenPoints([]);
      setPendingDraft({ annotation, pinX: bounds.minX * w, pinY: bounds.minY * h });
      setCommentText('');
    }
  };

  const openComments = useMemo(() => comments.filter(c => c.status === 'open'), [comments]);
  const visibleComments = useMemo(() => {
    if (commentFilter === 'open') return openComments;
    if (commentFilter === 'resolved') return comments.filter(c => c.status === 'resolved');
    return comments;
  }, [comments, openComments, commentFilter]);

  const pinComments = useMemo(() => openComments.filter(c =>
    c.anchor.filePath === (activeFile || project?.entry)
    && (!isDeck || c.anchor.slideIndex === undefined || c.anchor.slideIndex === activeSlide),
  ), [openComments, activeFile, project?.entry, isDeck, activeSlide]);

  const awaitingSrcDoc = viewMode === 'preview' && isHtmlActive && !previewVersionId && !fileContent;
  const useSrcDoc = viewMode === 'preview' && isHtmlActive && !previewVersionId && Boolean(fileContent);
  const baseHref = useMemo(() => {
    if (!project) return '';
    const relDir = activeFile.includes('/') ? activeFile.slice(0, activeFile.lastIndexOf('/') + 1) : '';
    return new URL(designRoutes.raw(project.id, relDir), window.location.origin).href;
  }, [project, activeFile]);
  const srcDocValue = useMemo(() => (useSrcDoc ? buildBridgeSrcDoc(fileContent, baseHref, bridgeToken, false) : undefined), [useSrcDoc, fileContent, baseHref, bridgeToken]);
  const rawPreviewUrl = project ? `${designRoutes.raw(project.id, activeFile || project.entry)}${previewVersionId ? `?version=${encodeURIComponent(previewVersionId)}&r=${reloadNonce}` : `?r=${reloadNonce}`}` : '';

  if (loading && !project) {
    return <div className="om-design-shell" style={{ alignItems: 'center', justifyContent: 'center' }}><span className="om-design-muted">{t('Loading design project…')}</span></div>;
  }
  if (error || !project) {
    return <div className="om-design-shell" style={{ alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <p>{error || t('Design project not found')}</p>
      <Button type="button" variant="secondary" onClick={onBack}>{t('Back to Design Studio')}</Button>
    </div>;
  }

  return (
    <div className="om-design-shell" data-design-editor={project.id}>
      {/* Top header */}
      <header className="om-design-header">
        <div className="om-design-header-group">
          <Tooltip label={t('Back to projects')}>
            <IconButton aria-label={t('Back to projects')} icon={<RemixIcon name="arrow-left-line" size={16} />} onClick={onBack} />
          </Tooltip>
          <input
            className="om-design-title-input"
            aria-label={t('Project title')}
            size={Math.max(6, Math.min(32, (titleDraft || project.title).length))}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
          {findDesignScenario(project.scenario) && (
            <span className="om-design-badge">
              <RemixIcon name={findDesignScenario(project.scenario)!.icon} size={12} />
              {t(findDesignScenario(project.scenario)!.label)}
            </span>
          )}
          {htmlFiles.length > 1 && htmlFiles.slice(0, 4).map(file => (
            <Button key={file.path} type="button" size="sm" variant={activeFile === file.path ? 'secondary' : 'ghost'} onClick={() => setActiveFile(file.path)}>
              {file.path}
            </Button>
          ))}
        </div>

        <div className="om-design-header-group">
          {/* Versions popover */}
          <Popover.Root modal={false} open={versionsOpen} onOpenChange={setVersionsOpen}>
            <Popover.Trigger render={
              <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="history-line" size={15} />}>
                {project.versionLabel ?? 'v1'}
              </Button>
            } />
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-150">
                <Popover.Popup className="om-design-popover" style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <strong>{t('Version history')}</strong>
                  {versions.map(v => (
                    <div key={v.id} className="om-design-item-card" data-active={v.id === (previewVersionId ?? currentVersionId)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <strong>{v.label}</strong>
                        <span className="om-design-badge">{v.source}</span>
                        <span className="om-design-muted">{formatTime(v.createdAt)}</span>
                      </div>
                      {v.summary && <span className="om-design-muted">{v.summary}</span>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setPreviewVersionId(v.id === currentVersionId ? null : v.id); setVersionsOpen(false); }}>
                          {v.id === currentVersionId ? t('Current') : t('Preview')}
                        </Button>
                        {v.id !== currentVersionId && (
                          <Button type="button" size="sm" variant="secondary" onClick={() => { void handleRestoreVersion(v.id, v.label); setVersionsOpen(false); }}>
                            {t('Restore')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>

          {/* Export menu */}
          <Popover.Root modal={false} open={exportOpen} onOpenChange={setExportOpen}>
            <Popover.Trigger render={
              <Button type="button" size="sm" variant="secondary" loading={Boolean(exporting)} icon={<RemixIcon name="download-2-line" size={14} />}>
                {t('Export')}
              </Button>
            } />
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-150">
                <Popover.Popup className="om-design-popover">
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport('open-design')}>{t('Open Design project (.zip)')}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport('zip')}>{t('Source archive (.zip)')}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport('html')}>{t('Standalone HTML (.html)')}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport('pdf')}>{t('PDF document (.pdf)')}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport('png')}>{t('PNG screenshot (.png)')}</Button>
                  {isDeck && <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport('pptx')}>{t('PowerPoint deck (.pptx)')}</Button>}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>

          {/* Open in menu */}
          <Popover.Root modal={false} open={openInOpen} onOpenChange={setOpenInOpen}>
            <Popover.Trigger render={
              <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="folder-open-line" size={14} />}>
                {t('Open in')}
              </Button>
            } />
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-150">
                <Popover.Popup className="om-design-popover">
                  {editors.filter(e => e.available).map(ed => (
                    <Button key={ed.id} type="button" size="sm" variant="ghost" icon={<RemixIcon name={ed.icon} size={14} />} onClick={() => void handleOpenIn(ed.id, ed.label)}>
                      {ed.label}
                    </Button>
                  ))}
                  <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="file-copy-line" size={14} />} onClick={() => { setOpenInOpen(false); void copyPrompt(project.path); }}>
                    {t('Copy local path')}
                  </Button>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>

          {/* Copy to Agent (MCP) */}
          <Popover.Root modal={false} open={agentOpen} onOpenChange={setAgentOpen}>
            <Popover.Trigger render={
              <Button type="button" size="sm" variant="primary" icon={<RemixIcon name="plug-line" size={14} />}>
                {t('Copy to Agent')}
              </Button>
            } />
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-150">
                <Popover.Popup className="om-design-popover" style={{ width: 340 }}>
                  <strong>{t('Hand off to Codex or Claude Code (MCP)')}</strong>
                  <span className="om-design-muted">{t('OpenMotion does not run a built-in agent. Copy this MCP instruction into your connected Agent to edit this project.')}</span>
                  <textarea
                    className="om-design-textarea"
                    placeholder={t('Optional change request for your Agent…')}
                    value={agentNote}
                    onChange={e => setAgentNote(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {openComments.length > 0 && (
                      <Button type="button" size="sm" variant="primary" onClick={() => { void copyPrompt(designCommentsPrompt(project, openComments, agentNote, promptOptions)); setAgentOpen(false); }}>
                        {t('Copy {count} open annotations', { count: openComments.length })}
                      </Button>
                    )}
                    <Button type="button" size="sm" variant={openComments.length > 0 ? 'secondary' : 'primary'} onClick={() => { void copyPrompt(designProjectPrompt(project, agentNote, promptOptions)); setAgentOpen(false); }}>
                      {t('Copy project brief')}
                    </Button>
                    {onOpenMcp && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setAgentOpen(false); onOpenMcp(); }}>
                        {t('Connect MCP')}
                      </Button>
                    )}
                  </div>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </header>

      {/* Secondary tool bar: sidebar toggle, reload, Preview/Code, viewport, deck controls, annotation icons, zoom */}
      <div className="om-design-toolbar">
        <div className="om-design-header-group">
          <Tooltip label={t('Toggle panel')}>
            <IconButton aria-label={t('Toggle panel')} icon={<RemixIcon name="side-bar-line" size={15} />} onClick={() => setSidebarOpen(v => !v)} />
          </Tooltip>
          <Tooltip label={t('Reload preview')}>
            <IconButton aria-label={t('Reload preview')} icon={<RemixIcon name="refresh-line" size={15} />} onClick={() => { setReloadNonce(n => n + 1); void refresh(); }} />
          </Tooltip>

          <div className="om-design-segmented" role="group" aria-label={t('View mode')}>
            <Button type="button" size="sm" variant={viewMode === 'preview' ? 'secondary' : 'ghost'} icon={<RemixIcon name="eye-line" size={14} />} onClick={() => setViewMode('preview')}>
              {t('Preview')}
            </Button>
            <Button type="button" size="sm" variant={viewMode === 'code' ? 'secondary' : 'ghost'} icon={<RemixIcon name="code-s-slash-line" size={14} />} onClick={() => setViewMode('code')}>
              {t('Code')}
            </Button>
          </div>

          {/* Device selector */}
          <Popover.Root modal={false} open={deviceOpen} onOpenChange={setDeviceOpen}>
            <Popover.Trigger render={
              <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name={currentViewport.icon} size={14} />}>
                <span>{t(currentViewport.label)}</span>
                <RemixIcon name="arrow-down-s-line" size={14} />
              </Button>
            } />
            <Popover.Portal>
              <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-150">
                <Popover.Popup className="om-design-popover" style={{ minWidth: 180 }}>
                  {designViewports.map(vp => (
                    <Button key={vp.id} type="button" size="sm" variant={viewportId === vp.id ? 'secondary' : 'ghost'}
                      icon={<RemixIcon name={vp.icon} size={14} />}
                      onClick={() => { setViewportId(vp.id); setRotated(false); setDeviceOpen(false); }}>
                      {t(vp.label)}{vp.width ? ` (${vp.width}×${vp.height})` : ''}
                    </Button>
                  ))}
                  {viewportId !== 'desktop' && (
                    <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="clockwise-line" size={14} />} onClick={() => { setRotated(r => !r); setDeviceOpen(false); }}>
                      {t('Rotate orientation')}
                    </Button>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>

          {project.scenario === 'live-artifact' && (
            <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="refresh-line" size={14} />} onClick={() => setReloadNonce(n => n + 1)}>
              {t('Refresh data')}
            </Button>
          )}
          <Tooltip label={t('Open preview in new tab')}>
            <IconButton aria-label={t('Open preview in new tab')} icon={<RemixIcon name="external-link-line" size={15} />} onClick={() => window.open(rawPreviewUrl, '_blank', 'noopener,noreferrer')} />
          </Tooltip>
        </div>

        {/* Deck controls (centered in 3-column toolbar grid) */}
        {isDeck && viewMode === 'preview' ? (
          <div className="om-design-header-group">
            <IconButton aria-label={t('Previous slide')} icon={<RemixIcon name="arrow-left-s-line" size={16} />} onClick={() => sendDeckCommand('prev')} />
            <span className="om-design-muted" style={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{activeSlide + 1} / {Math.max(1, slideCount || deckSlides.length)}</span>
            <IconButton aria-label={t('Next slide')} icon={<RemixIcon name="arrow-right-s-line" size={16} />} onClick={() => sendDeckCommand('next')} />
            <Button type="button" size="sm" variant={notesOpen ? 'secondary' : 'ghost'} onClick={() => setNotesOpen(v => !v)}>{t('Notes')}</Button>
            <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="fullscreen-line" size={14} />} onClick={() => iframeRef.current?.requestFullscreen?.()}>{t('Present')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={openPresenterPopup}>{t('Presenter view')}</Button>
          </div>
        ) : <div />}

        {/* Annotation tools & Zoom */}
        <div className="om-design-header-group">
          <div className="om-design-header-group" role="group" aria-label={t('Annotation tools')} style={{ gap: 2 }}>
            <Tooltip label={t('Comment on element')}>
              <IconButton
                aria-label={t('Comment')}
                variant={activeTool === 'comment' ? 'primary' : 'ghost'}
                icon={<RemixIcon name="chat-1-line" size={15} />}
                onClick={() => { setViewMode('preview'); setActiveTool(t0 => t0 === 'comment' ? 'none' : 'comment'); }}
              />
            </Tooltip>
            <Tooltip label={t('Mark region')}>
              <IconButton
                aria-label={t('Region')}
                variant={activeTool === 'region' ? 'primary' : 'ghost'}
                icon={<RemixIcon name="shape-2-line" size={15} />}
                onClick={() => { setViewMode('preview'); setActiveTool(t0 => t0 === 'region' ? 'none' : 'region'); }}
              />
            </Tooltip>
            <Tooltip label={t('Draw pen annotation')}>
              <IconButton
                aria-label={t('Draw')}
                variant={activeTool === 'pen' ? 'primary' : 'ghost'}
                icon={<RemixIcon name="pen-nib-line" size={15} />}
                onClick={() => { setViewMode('preview'); setActiveTool(t0 => t0 === 'pen' ? 'none' : 'pen'); }}
              />
            </Tooltip>
          </div>

          <Tooltip label={t('Comments')}>
            <Button
              type="button"
              size="sm"
              variant={sidebarOpen && sidebarTab === 'comments' ? 'secondary' : 'ghost'}
              aria-pressed={sidebarOpen && sidebarTab === 'comments'}
              icon={<RemixIcon name="chat-1-line" size={14} />}
              onClick={() => {
                if (sidebarOpen && sidebarTab === 'comments') {
                  setSidebarOpen(false);
                } else {
                  setSidebarOpen(true);
                  setSidebarTab('comments');
                }
              }}
            >
              {openComments.length}
            </Button>
          </Tooltip>

          <div className="om-design-header-group" style={{ gap: 2 }}>
            <IconButton aria-label={t('Zoom out')} icon={<RemixIcon name="zoom-out-line" size={14} />}
              onClick={() => setZoom(z => ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(z) - 1)] ?? 75)} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setZoom(100)}>{zoom}%</Button>
            <IconButton aria-label={t('Zoom in')} icon={<RemixIcon name="zoom-in-line" size={14} />}
              onClick={() => setZoom(z => ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(z) + 1)] ?? 125)} />
          </div>
        </div>
      </div>

      {/* Historical version preview notice */}
      {previewVersionId && (
        <div className="om-design-banner">
          <span>{t('Previewing historical snapshot {label}', { label: versions.find(v => v.id === previewVersionId)?.label ?? '' })}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="button" size="sm" variant="secondary" onClick={() => {
              const ver = versions.find(v => v.id === previewVersionId);
              if (ver) void handleRestoreVersion(ver.id, ver.label);
            }}>{t('Restore as new version')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewVersionId(null)}>{t('Return to current')}</Button>
          </div>
        </div>
      )}

      {/* Main split body */}
      <div className="om-design-body">
        {sidebarOpen && (
          <ResizablePane className="om-design-sidebar" storageKey="om.design.sidebar" initial={280} min={220} max={420} edge="right" label={t('Resize panel')}>
            <div className="om-design-sidebar-tabs" role="tablist">
              <Button type="button" size="sm" variant={sidebarTab === 'files' ? 'secondary' : 'ghost'} onClick={() => setSidebarTab('files')}>{t('Files')}</Button>
              <Button type="button" size="sm" variant={sidebarTab === 'comments' ? 'secondary' : 'ghost'} onClick={() => setSidebarTab('comments')}>
                {t('Comments')}{openComments.length ? ` (${openComments.length})` : ''}
              </Button>
              <Button type="button" size="sm" variant={sidebarTab === 'versions' ? 'secondary' : 'ghost'} onClick={() => setSidebarTab('versions')}>{t('Versions')}</Button>
            </div>

            <div className="om-design-sidebar-scroll">
              {sidebarTab === 'files' && project.files.map(file => (
                <Button key={file.path} type="button" size="sm" variant={activeFile === file.path ? 'secondary' : 'ghost'}
                  className="om-design-file-row"
                  onClick={() => { setActiveFile(file.path); if (file.kind !== 'html') setViewMode('code'); }}>
                  <span className="om-design-file-name">
                    <RemixIcon name={file.kind === 'html' ? 'file-code-line' : file.kind === 'image' ? 'file-image-line' : 'file-text-line'} size={14} />
                    <span>{file.path}</span>
                  </span>
                  <span className="om-design-file-size">{formatBytes(file.size)}</span>
                </Button>
              ))}

              {sidebarTab === 'comments' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <div className="om-design-segmented">
                      {(['open', 'resolved', 'all'] as const).map(f => (
                        <Button key={f} type="button" size="sm" variant={commentFilter === f ? 'secondary' : 'ghost'} onClick={() => setCommentFilter(f)}>
                          {t(f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All')}
                        </Button>
                      ))}
                    </div>
                    {openComments.length > 0 && (
                      <Button type="button" size="sm" variant="primary" icon={<RemixIcon name="plug-line" size={13} />}
                        onClick={() => void copyPrompt(designCommentsPrompt(project, openComments, undefined, promptOptions))}>
                        {t('Copy for Agent')}
                      </Button>
                    )}
                  </div>

                  {visibleComments.length === 0 && (
                    <p className="om-design-muted">{t('No annotations yet. Pick Comment, Region or Draw to mark an element, then copy the brief to your Agent.')}</p>
                  )}

                  {visibleComments.map((comment, idx) => {
                    const kindLabel = comment.anchor.annotation ? t('Draw') : comment.anchor.region ? t('Region') : t('Comment');
                    const kindIcon = comment.anchor.annotation ? 'pen-nib-line' : comment.anchor.region ? 'shape-2-line' : 'chat-1-line';
                    const focusComment = () => {
                      setSelectedCommentId(comment.id);
                      setViewMode('preview');
                      if (comment.anchor.filePath && comment.anchor.filePath !== activeFile) setActiveFile(comment.anchor.filePath);
                      if (isDeck && comment.anchor.slideIndex !== undefined && comment.anchor.slideIndex !== activeSlide) {
                        sendDeckCommand('go', comment.anchor.slideIndex);
                      }
                    };
                    return (
                      <div key={comment.id} className="om-design-item-card" data-active={selectedCommentId === comment.id} style={{ cursor: 'pointer' }} onClick={focusComment}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span className="om-design-badge">
                            <RemixIcon name={kindIcon} size={11} />
                            <span>#{idx + 1} · {kindLabel} · {comment.anchor.viewport.id}</span>
                          </span>
                          <span className="om-design-muted">{comment.status}</span>
                        </div>
                        <AnnotationVisualPreview
                          element={comment.anchor.element}
                          region={comment.anchor.region}
                          annotation={comment.anchor.annotation}
                          viewport={comment.anchor.viewport}
                        />
                        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>{comment.text}</p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                          {comment.anchor.slideIndex !== undefined && (
                            <Button type="button" size="sm" variant="ghost" onClick={focusComment}>
                              {t('Slide {n}', { n: comment.anchor.slideIndex + 1 })}
                            </Button>
                          )}
                          <Button type="button" size="sm" variant="ghost" onClick={() => void toggleCommentStatus(comment)}>
                            {comment.status === 'open' ? t('Resolve') : t('Reopen')}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => void copyPrompt(designCommentsPrompt(project, [comment], undefined, promptOptions))}>
                            {t('Copy')}
                          </Button>
                          <IconButton aria-label={t('Delete annotation')} icon={<RemixIcon name="delete-bin-line" size={14} />} onClick={() => void removeComment(comment.id)} />
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {sidebarTab === 'versions' && versions.map(ver => (
                <div key={ver.id} className="om-design-item-card" data-active={ver.id === (previewVersionId ?? currentVersionId)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <strong>{ver.label}</strong>
                    <span className="om-design-badge">{ver.source}</span>
                  </div>
                  {ver.summary && <span className="om-design-muted">{ver.summary}</span>}
                  {ver.prompt && <span className="om-design-muted" style={{ fontStyle: 'italic' }}>{ver.prompt}</span>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewVersionId(ver.id === currentVersionId ? null : ver.id)}>
                      {ver.id === currentVersionId ? t('Current') : t('Preview')}
                    </Button>
                    {ver.id !== currentVersionId && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleRestoreVersion(ver.id, ver.label)}>
                        {t('Restore')}
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" onClick={() => void handleExport('zip', ver.id)}>{t('Export')}</Button>
                  </div>
                </div>
              ))}
            </div>
          </ResizablePane>
        )}

        {/* Stage: Preview or Code */}
        <section className="om-design-stage">
          {manualCopy && (
            <div className="om-design-banner" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{t('Copy this MCP instruction manually')}</strong>
                <IconButton aria-label={t('Close')} icon={<RemixIcon name="close-line" size={14} />} onClick={() => setManualCopy(null)} />
              </div>
              <textarea className="om-design-textarea" readOnly value={manualCopy} onFocus={e => e.currentTarget.select()} />
            </div>
          )}

          {viewMode === 'preview' ? (
            <>
              <div className="om-design-stage-viewport" data-fluid={viewportId === 'desktop' && zoom === 100 && project.scenario !== 'document'}>
                {(viewportId !== 'desktop' || zoom !== 100) && (
                  <div className="om-design-device-caption">
                    <RemixIcon name={currentViewport.icon} size={13} />
                    <span>{t(currentViewport.label)}</span>
                    {frameWidth && frameHeight && <span>· {frameWidth} × {frameHeight}</span>}
                    <span>· {zoom}%</span>
                  </div>
                )}
                <div
                  className="om-design-frame-wrap"
                  data-fluid={viewportId === 'desktop' && zoom === 100 && project.scenario !== 'document'}
                  data-document={viewportId === 'desktop' && project.scenario === 'document'}
                  style={{
                    ...(frameWidth ? { width: frameWidth, height: frameHeight! } : { width: '100%', height: '100%' }),
                    ...(zoom !== 100 ? { transform: `scale(${zoom / 100})` } : {}),
                  }}
                >
                  <iframe
                    ref={iframeRef}
                    key={`${project.id}:${activeFile}:${reloadNonce}`}
                    title={project.title}
                    className="om-design-iframe"
                    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                    src={useSrcDoc || awaitingSrcDoc ? undefined : rawPreviewUrl}
                    srcDoc={useSrcDoc ? srcDocValue : undefined}
                    onLoad={() => {
                      try {
                        iframeRef.current?.contentWindow?.postMessage({ type: 'om:design-mode', token: bridgeToken, pick: activeTool === 'comment' }, '*');
                      } catch { /* ignore */ }
                    }}
                  />

                  {/* Annotation & Pins overlay */}
                  <div
                    ref={overlayRef}
                    className="om-design-overlay"
                    data-interactive={activeTool === 'region' || activeTool === 'pen'}
                    onPointerDown={onOverlayPointerDown}
                    onPointerMove={onOverlayPointerMove}
                    onPointerUp={onOverlayPointerUp}
                    onPointerCancel={() => { setDragStart(null); setDragCurrent(null); setPenPoints([]); }}
                  >
                    {/* Live region drag preview */}
                    {dragStart && dragCurrent && (() => {
                      const rx = Math.min(dragStart.x, dragCurrent.x);
                      const ry = Math.min(dragStart.y, dragCurrent.y);
                      const rw = Math.abs(dragCurrent.x - dragStart.x);
                      const rh = Math.abs(dragCurrent.y - dragStart.y);
                      return (
                        <div className="om-design-region-box" style={{ left: rx, top: ry, width: rw, height: rh }}>
                          {rw >= 48 && rh >= 28 && (
                            <span className="om-design-region-size">{Math.round(rw)} × {Math.round(rh)}</span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Pending region outline while composing comment */}
                    {pendingDraft?.region && (
                      <div
                        className="om-design-region-box"
                        data-selected="true"
                        style={{
                          left: pendingDraft.region.x,
                          top: pendingDraft.region.y,
                          width: pendingDraft.region.width,
                          height: pendingDraft.region.height,
                        }}
                      />
                    )}

                    {/* Saved region outlines */}
                    {pinComments.map(c => c.anchor.region ? (
                      <div
                        key={`region-${c.id}`}
                        className="om-design-region-box"
                        data-saved="true"
                        data-selected={selectedCommentId === c.id}
                        style={{
                          left: c.anchor.region.x,
                          top: c.anchor.region.y,
                          width: c.anchor.region.width,
                          height: c.anchor.region.height,
                        }}
                      />
                    ) : null)}

                    {/* Live pen stroke, pending draft stroke & saved vector annotations */}
                    <svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                      {penPoints.length >= 2 && (
                        <ReviewAnnotationGraphic annotation={{ version: 1, coordinateSpace: 'normalized', width: 1000, height: 1000, marks: [{ kind: 'pen', points: penPoints }] }} />
                      )}
                      {pendingDraft?.annotation && (
                        <g className="om-design-annotation-group" data-selected="true">
                          <ReviewAnnotationGraphic annotation={{ ...pendingDraft.annotation, width: 1000, height: 1000 }} />
                        </g>
                      )}
                      {pinComments.map(c => c.anchor.annotation ? (
                        <g key={c.id} className="om-design-annotation-group" data-selected={selectedCommentId === c.id}>
                          <ReviewAnnotationGraphic annotation={{ ...c.anchor.annotation, width: 1000, height: 1000 }} />
                        </g>
                      ) : null)}
                    </svg>

                    {/* Saved pins */}
                    {pinComments.map((c, idx) => {
                      const ow = overlayRef.current?.clientWidth ?? c.anchor.viewport.width ?? 960;
                      const oh = overlayRef.current?.clientHeight ?? c.anchor.viewport.height ?? 640;
                      const drawBounds = c.anchor.annotation ? annotationBounds(c.anchor.annotation) : null;
                      const x = c.anchor.region
                        ? c.anchor.region.x
                        : drawBounds
                          ? drawBounds.minX * ow
                          : c.anchor.element
                            ? c.anchor.element.box.x + c.anchor.element.box.width / 2
                            : 32 + idx * 28;
                      const y = c.anchor.region
                        ? c.anchor.region.y
                        : drawBounds
                          ? drawBounds.minY * oh
                          : c.anchor.element
                            ? c.anchor.element.box.y + 12
                            : 32;
                      return (
                        <div
                          key={c.id}
                          className="om-design-pin"
                          data-selected={selectedCommentId === c.id}
                          style={{ left: x, top: y }}
                          title={c.text}
                          onClick={() => { setSelectedCommentId(c.id); setSidebarOpen(true); setSidebarTab('comments'); }}
                        >
                          {idx + 1}
                        </div>
                      );
                    })}

                    {/* Pending comment composer anchored cleanly outside the marked region or drawing */}
                    {pendingDraft && (() => {
                      const ow = overlayRef.current?.clientWidth ?? 960;
                      const oh = overlayRef.current?.clientHeight ?? 640;
                      const popW = 300;
                      const popH = pendingDraft.annotation || pendingDraft.region ? 290 : 196;
                      const pendingAnnotation = pendingDraft.annotation;
                      const drawBox = pendingAnnotation ? (() => {
                        const b = annotationBounds(pendingAnnotation);
                        return { x: b.minX * ow, y: b.minY * oh, width: (b.maxX - b.minX) * ow, height: (b.maxY - b.minY) * oh };
                      })() : null;
                      const anchorBox = pendingDraft.region ?? drawBox;
                      const preferredX = anchorBox ? anchorBox.x : pendingDraft.pinX;
                      const preferredY = anchorBox
                        ? (anchorBox.y + anchorBox.height + 12 + popH <= oh
                          ? anchorBox.y + anchorBox.height + 12
                          : Math.max(12, anchorBox.y - popH - 12))
                        : (pendingDraft.pinY + 14 + popH <= oh
                          ? pendingDraft.pinY + 14
                          : Math.max(12, pendingDraft.pinY - popH - 14));
                      const left = Math.min(Math.max(12, preferredX), Math.max(12, ow - popW - 12));
                      const top = Math.min(Math.max(12, preferredY), Math.max(12, oh - popH - 12));
                      return (
                        <div className="om-design-popover" style={{ position: 'absolute', left, top, width: popW, pointerEvents: 'auto', zIndex: 25 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong>{pendingDraft.element ? `<${pendingDraft.element.tagName}> ${pendingDraft.element.label}` : pendingDraft.region ? t('Region annotation') : t('Pen annotation')}</strong>
                            <IconButton aria-label={t('Cancel')} icon={<RemixIcon name="close-line" size={14} />} onClick={() => setPendingDraft(null)} />
                          </div>
                          <AnnotationVisualPreview
                            element={pendingDraft.element}
                            region={pendingDraft.region}
                            annotation={pendingDraft.annotation}
                            viewport={{ width: ow, height: oh }}
                          />
                          <textarea
                            className="om-design-textarea"
                            autoFocus
                            placeholder={t('Describe the change for your Agent…')}
                            value={commentText}
                            onChange={e => setCommentText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitDraftComment(); }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setPendingDraft(null)}>{t('Cancel')}</Button>
                            <Button type="button" size="sm" variant="primary" loading={submittingComment} disabled={!commentText.trim()} onClick={() => void submitDraftComment()}>
                              {t('Save annotation')}
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Deck speaker notes & thumbnail rail */}
              {isDeck && notesOpen && (
                <div className="om-design-notes-bar">
                  <strong>{t('Speaker notes')} · {t('Slide {n}', { n: activeSlide + 1 })}: </strong>
                  {speakerNotes[activeSlide] || t('No speaker notes for this slide.')}
                </div>
              )}
              {isDeck && deckSlides.length > 0 && (
                <div className="om-design-deck-rail" role="tablist" aria-label={t('Slides')}>
                  {deckSlides.map(slide => (
                    <Button key={slide.index} type="button" size="sm" variant={slide.index === activeSlide ? 'secondary' : 'ghost'}
                      className="om-design-deck-thumb" data-active={slide.index === activeSlide}
                      onClick={() => sendDeckCommand('go', slide.index)}>
                      <span className="om-design-slide-num">{String(slide.index + 1).padStart(2, '0')}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{slide.label}</span>
                    </Button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="om-design-code-wrap">
              <div className="om-design-code-bar">
                <span className="om-design-muted">{activeFile} · {project.versionLabel ?? 'v1'}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {codeEditing ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" disabled={savingCode || reloadingCode} onClick={() => { setCodeDraft(fileContent); setCodeEditBaseRevision(null); setCodeConflict(false); setCodeEditing(false); }}>{t('Cancel')}</Button>
                      <Button type="button" size="sm" variant="primary" loading={savingCode} disabled={reloadingCode} icon={<RemixIcon name="save-line" size={14} />} onClick={() => void saveCode()}>
                        {t('Save version')}
                      </Button>
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="file-copy-line" size={14} />} onClick={() => void copyPrompt(fileContent)}>
                        {t('Copy code')}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" icon={<RemixIcon name="edit-line" size={14} />} onClick={() => { setCodeDraft(fileContent); setCodeEditBaseRevision(project.revision); setCodeConflict(false); setCodeEditing(true); }}>
                        {t('Edit source')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              {codeEditing && codeConflict && (
                <div className="om-design-banner" role="alert">
                  <span>{t('Project changed externally. Reload to get the latest revision.')}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      loading={savingCode}
                      disabled={reloadingCode}
                      onClick={() => {
                        setCodeEditBaseRevision(project.revision);
                        void saveCode(project.revision);
                      }}
                    >
                      {t('Overwrite with my draft')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      loading={reloadingCode}
                      disabled={savingCode}
                      onClick={() => void discardAndReloadLatest()}
                    >
                      {t('Discard draft & reload latest')}
                    </Button>
                  </div>
                </div>
              )}
              {reloadingCode || (!codeEditing && codeLoading) ? (
                <div style={{ padding: 16 }} className="om-design-muted">{t('Loading file…')}</div>
              ) : codeEditing ? (
                <textarea className="om-design-code-editor" aria-label={t('Source editor')} value={codeDraft} onChange={e => setCodeDraft(e.target.value)} spellCheck={false} />
              ) : (
                <CodeViewer content={fileContent} />
              )}
            </div>
          )}
        </section>
      </div>
      <StudioToastViewport {...toast} />
    </div>
  );
}
