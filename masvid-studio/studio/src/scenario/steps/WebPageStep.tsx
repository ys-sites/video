import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  designBriefPrompt,
  designProjectPrompt,
  designRoutes,
  designViewports,
  type DesignProject,
  type DesignProjectDetail,
  type DesignTemplateSummary,
  type DesignVersion,
  type DesignViewportId,
} from '../../../../shared/design-project';
import {
  briefMarkdown,
  listHtmlImageTargets,
  type EmbedImageTarget,
  type HtmlImageTarget,
} from '../../../../shared/scenario-content';
import type { ScenarioRun, StepIteration } from '../../../../shared/scenario-runs';
import { findScenarioStep } from '../../../../shared/scenarios';
import { MenuItem, Select } from '../../components/ui';
import { FieldTextarea } from '../../components/ui/FormField';
import { PanelEmptyState } from '../../components/ui/PanelEmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { designClient } from '../../design/designClient';
import { ScaledPreviewThumb } from '../../design/ScaledPreviewThumb';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { ScenarioApiError } from '../scenarioClient';
import type { StepProps } from '../stepContract';
import { BindingSlot } from './BindingSlot';
import { StepCapabilityBar, StepMediaOutputs } from './StepCapabilityBar';
import { copyText, extractErrorMessage, isScenarioConflictError } from './stepUtils';

function targetToValue(target: HtmlImageTarget): string {
  return target.kind === 'slot' ? `slot:${target.slot}` : `img:${target.index}`;
}

function parseTargetValue(value: string): EmbedImageTarget {
  if (value.startsWith('slot:')) {
    return { kind: 'slot', slot: value.slice(5) };
  }
  if (value.startsWith('img:')) {
    const index = Number.parseInt(value.slice(4), 10);
    if (Number.isInteger(index) && index >= 0) return { kind: 'img', index };
  }
  return { kind: 'append' };
}

function briefText(brief: Record<string, string | string[]> | undefined, key: string): string {
  const value = brief?.[key];
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(v => v.trim()).filter(Boolean).join(', ');
  return '';
}

function buildDefaultPagePrompt(
  recipe: string | undefined,
  brief: Record<string, string | string[]> | undefined,
  locale: string,
): string {
  const isZh = locale.toLowerCase().startsWith('zh');
  const product = briefText(brief, 'productName') || briefText(brief, 'personaName') || briefText(brief, 'concept');
  const idea = briefText(brief, 'idea');
  const salePrice = briefText(brief, 'salePrice');
  const originalPrice = briefText(brief, 'originalPrice');
  const promoCode = briefText(brief, 'promoCode');
  const saleWindow = briefText(brief, 'saleWindow');
  const cta = briefText(brief, 'cta');

  if (recipe === 'sale') {
    const pricePart = salePrice
      ? (originalPrice ? `${salePrice} (${isZh ? '原价' : 'was'} ${originalPrice})` : salePrice)
      : '';
    const codePart = promoCode ? `${isZh ? '优惠码' : 'code'} ${promoCode}` : '';
    const parts = [pricePart, codePart, saleWindow].filter(Boolean).join(isZh ? '，' : ', ');
    if (isZh) {
      return `${product ? `为「${product}」` : ''}生成黑五商品详情页${parts ? `（${parts}）` : ''}。${idea ? `突出${idea}，` : ''}包含首屏促销头图、核心卖点、商品图画廊与${cta || '立即抢购'}按钮。`;
    }
    return `Black Friday sale detail page${product ? ` for ${product}` : ''}${parts ? ` — ${parts}` : ''}. ${idea ? `Highlight ${idea}. ` : ''}Include a bold offer hero, product gallery, key highlights, and "${cta || 'Shop now'}" CTA.`;
  }

  if (recipe === 'link-in-bio') {
    const niche = briefText(brief, 'niche');
    const topic = briefText(brief, 'topic');
    if (isZh) {
      return `为${product || 'AI 博主'}${niche ? `（${niche}）` : ''}打造个人主页与外链聚合页，包含头像简介、精选链接、${topic ? `本期主题「${topic}」` : '最新视频'}与视觉作品画廊。`;
    }
    return `Creator link-in-bio page${product ? ` for ${product}` : ''}${niche ? ` (${niche})` : ''} with avatar bio, featured links, ${topic ? `latest episode "${topic}"` : 'latest video spotlight'}, and visual gallery.`;
  }

  if (recipe === 'code-animation') {
    const style = briefText(brief, 'codeStyle');
    if (isZh) {
      return `编写一个全屏交互式 HTML/Canvas 代码动画${product ? `：${product}` : ''}${style ? `（${style} 风格）` : ''}。${idea || '支持流畅粒子动效与高对比标题呈现。'}`;
    }
    return `Full-screen interactive HTML/Canvas code animation${product ? ` for "${product}"` : ''}${style ? ` in ${style} style` : ''}. ${idea || 'Smooth kinetic motion, responsive canvas, and crisp typography.'}`;
  }

  if (isZh) {
    return `${product ? `为「${product}」` : ''}设计高转化产品落地页。${idea ? `核心介绍：${idea}。` : ''}包含首屏视觉、核心卖点卡片、图片画廊与「${cta || '立即体验'}」行动号召。`;
  }
  return `High-converting landing page${product ? ` for ${product}` : ''}. ${idea ? `${idea}. ` : ''}Include hero visual, value proposition cards, product gallery, and "${cta || 'Get started'}" CTA.`;
}

const PAGE_QUICK_CHIPS: Record<string, readonly { id: string; en: string; zh: string; appendEn: string; appendZh: string }[]> = {
  sale: [
    { id: 'countdown', en: 'Countdown banner', zh: '倒计时横幅', appendEn: 'Add a top countdown urgency banner.', appendZh: '加入顶部倒计时促销横幅。' },
    { id: 'gallery', en: 'Multi-angle gallery', zh: '多角度商品图集', appendEn: 'Include a multi-angle product photo gallery.', appendZh: '加入多角度商品实拍画廊。' },
    { id: 'reviews', en: 'Buyer reviews & FAQ', zh: '买家好评与 FAQ', appendEn: 'Add customer reviews and shipping FAQ.', appendZh: '加入真实评价与发货售后 FAQ。' },
  ],
  'link-in-bio': [
    { id: 'newsletter', en: 'Newsletter signup', zh: '订阅入口', appendEn: 'Include an email newsletter signup card.', appendZh: '加入邮件/社群订阅卡片。' },
    { id: 'social-row', en: 'Social links', zh: '全平台社媒入口', appendEn: 'Highlight all social platform links at the top.', appendZh: '顶部突出展示全平台社媒入口。' },
  ],
  'code-animation': [
    { id: 'cursor', en: 'Cursor reactive', zh: '鼠标跟随交互', appendEn: 'Make motion react smoothly to pointer movement.', appendZh: '支持鼠标滑动实时交互反馈。' },
    { id: 'loop', en: 'Seamless 15s loop', zh: '无缝循环动画', appendEn: 'Design as a seamless loop ready for video capture.', appendZh: '设计为适合录屏成片的无缝循环动画。' },
  ],
  landing: [
    { id: 'pricing', en: 'Pricing section', zh: '价格方案区', appendEn: 'Add a clear pricing comparison section.', appendZh: '加入清晰的价格方案对比区。' },
    { id: 'social-proof', en: 'Testimonials', zh: '客户口碑', appendEn: 'Include customer logos and testimonials.', appendZh: '加入客户案例与评价模块。' },
  ],
};

export function WebPageStep({
  scenario,
  step,
  state,
  run,
  active,
  api,
  pool,
  toast,
  nav,
  renderExportMenu,
  renderIterations,
  renderCapabilityBar,
}: StepProps) {
  const { t, locale } = useI18n();
  const { info: integration } = useIntegrationInfo();

  const pageConfig = step.page;
  const linkedStepId = pageConfig?.linkedStepId;
  const linkedStepState = linkedStepId ? run?.steps[linkedStepId] : undefined;
  const designProjectId = state.links.designProjectId ?? linkedStepState?.links.designProjectId ?? null;
  const isEmbedOnly = pageConfig?.mode === 'embed';

  // Creation catalog state (when no project linked)
  const [templates, setTemplates] = useState<DesignTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [linkProjectExpanded, setLinkProjectExpanded] = useState(false);
  const [existingProjects, setExistingProjects] = useState<DesignProject[]>([]);
  const [selectedExistingId, setSelectedExistingId] = useState('');
  const [creatingMode, setCreatingMode] = useState<string | null>(null);

  const defaultPagePrompt = useMemo(
    () => buildDefaultPagePrompt(pageConfig?.recipe, run?.brief, locale),
    [pageConfig?.recipe, run?.brief, locale],
  );
  const savedDraftPrompt = typeof state.draft.prompt === 'string' && state.draft.prompt.trim()
    ? state.draft.prompt
    : '';
  const [pagePrompt, setPagePrompt] = useState(() => savedDraftPrompt || defaultPagePrompt);
  const [promptTouched, setPromptTouched] = useState(Boolean(savedDraftPrompt));

  useEffect(() => {
    if (!promptTouched) {
      setPagePrompt(savedDraftPrompt || defaultPagePrompt);
    }
  }, [savedDraftPrompt, defaultPagePrompt, promptTouched]);

  // Linked project state
  const [project, setProject] = useState<DesignProjectDetail | null>(null);
  const [currentHtml, setCurrentHtml] = useState('');
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [viewportId, setViewportId] = useState<DesignViewportId>('desktop');

  // Embed state
  const [targetByPoolId, setTargetByPoolId] = useState<Record<string, string>>({});
  const [embeddingId, setEmbeddingId] = useState<string | null>(null);
  const [embeddingAll, setEmbeddingAll] = useState(false);

  const loadTemplatesAndProjects = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(false);
    try {
      const [tplRes, projRes] = await Promise.all([
        designClient.listTemplates({ scenario: pageConfig?.designScenario ?? 'prototype' }),
        designClient.listProjects().catch(() => ({ projects: [] })),
      ]);
      const preferred = new Set(pageConfig?.templates ?? []);
      const sorted = [...tplRes.items].sort(
        (a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)),
      );
      setTemplates(sorted);
      const activeProjects = projRes.projects.filter(p => !p.trashedAt);
      setExistingProjects(activeProjects);
      setSelectedExistingId(prev => prev || activeProjects[0]?.id || '');
    } catch {
      setTemplatesError(true);
    } finally {
      setTemplatesLoading(false);
    }
  }, [pageConfig?.designScenario, pageConfig?.templates]);

  useEffect(() => {
    if (!active || designProjectId || isEmbedOnly) return;
    void loadTemplatesAndProjects();
  }, [active, designProjectId, isEmbedOnly, loadTemplatesAndProjects]);

  const loadLinkedProject = useCallback(async (id: string) => {
    setProjectLoading(true);
    setProjectError(null);
    try {
      const { project: detail } = await designClient.getProject(id);
      setProject(detail);
      const file = await designClient.readFile(detail.id, detail.entry);
      setCurrentHtml(file.content);
    } catch (error) {
      setProjectError(extractErrorMessage(error, t('Could not load Design project.')));
    } finally {
      setProjectLoading(false);
    }
  }, [t]);

  // Reload project whenever designProjectId or latest design iteration revision changes
  const latestDesignRevision = useMemo(() => {
    for (let i = state.iterations.length - 1; i >= 0; i -= 1) {
      const rev = state.iterations[i].design?.revision;
      if (rev) return rev;
    }
    return null;
  }, [state.iterations]);
  useEffect(() => {
    if (!active || !designProjectId) {
      if (!designProjectId) {
        setProject(null);
        setCurrentHtml('');
      }
      return;
    }
    void loadLinkedProject(designProjectId);
  }, [active, designProjectId, latestDesignRevision, loadLinkedProject]);

  const htmlTargets = useMemo(() => listHtmlImageTargets(currentHtml), [currentHtml]);
  const targetOptions = useMemo(() => {
    const items = htmlTargets.map(target => {
      if (target.kind === 'slot') {
        return { value: targetToValue(target), label: `${target.label} (${target.slot})` };
      }
      const shortSrc = target.src ? ` · ${target.src.slice(0, 26)}` : '';
      return { value: targetToValue(target), label: `${t('Image {index}', { index: target.index + 1 })}${shortSrc}` };
    });
    items.push({ value: 'append', label: t('Append to gallery') });
    return items;
  }, [htmlTargets, t]);

  const boundEmbedIds = state.bindings.embedImages ?? [];
  const boundImages = useMemo(
    () => boundEmbedIds
      .map(id => pool.byId.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item && item.kind === 'image')),
    [boundEmbedIds, pool.byId],
  );

  const defaultTargetForIndex = useCallback(
    (index: number) => {
      const slotTargets = htmlTargets.filter(target => target.kind === 'slot');
      if (slotTargets[index]) return targetToValue(slotTargets[index]);
      if (htmlTargets[index]) return targetToValue(htmlTargets[index]);
      return 'append';
    },
    [htmlTargets],
  );

  const selectedTargetFor = (poolItemId: string, index: number) => {
    const existing = targetByPoolId[poolItemId];
    if (existing && targetOptions.some(opt => opt.value === existing)) return existing;
    return defaultTargetForIndex(index);
  };

  const handleCreateStarter = async () => {
    setCreatingMode('starter');
    try {
      const trimmedPrompt = pagePrompt.trim();
      if (trimmedPrompt && trimmedPrompt !== savedDraftPrompt) {
        await api.mutate(`page-prompt:${step.id}`, 'update_step', {
          stepId: step.id,
          draft: { prompt: trimmedPrompt },
        }).catch(() => {});
      }
      const res = await api.mutate<{ run: ScenarioRun; project: DesignProjectDetail }>(
        `create-page:${step.id}:starter`,
        'create_page',
        { stepId: step.id, mode: 'starter' },
      );
      let currentProject = res.project;
      let failedEmbeds = 0;
      // If the user already attached images from the shared pool in this step, embed them automatically!
      if (pageConfig?.mode === 'both' && boundImages.length > 0) {
        const htmlRes = await designClient.readFile(currentProject.id, currentProject.entry).catch(() => null);
        const slots = htmlRes ? listHtmlImageTargets(htmlRes.content).filter(item => item.kind === 'slot') : [];
        for (let i = 0; i < boundImages.length; i += 1) {
          const item = boundImages[i];
          const target: EmbedImageTarget = slots[i]
            ? { kind: 'slot', slot: slots[i].slot }
            : { kind: 'append' };
          try {
            const embedRes = await api.mutate<{ run: ScenarioRun; project: DesignProjectDetail }>(
              `auto-embed:${step.id}:${item.id}:${i}`,
              'embed_image',
              {
                stepId: step.id,
                designProjectId: currentProject.id,
                expectedDesignRevision: currentProject.revision,
                poolItemId: item.id,
                target,
                alt: item.label,
              },
            );
            if (embedRes?.project) currentProject = embedRes.project;
          } catch {
            failedEmbeds += 1;
            const refreshed = await designClient.getProject(currentProject.id).catch(() => null);
            if (refreshed?.project) currentProject = refreshed.project;
          }
        }
      }
      setProject(currentProject);
      if (failedEmbeds > 0) {
        toast.showToast(
          t('Starter page created, but {count} attached image(s) could not be embedded.', { count: failedEmbeds }),
          'error',
          'feedback',
        );
      } else {
        toast.showToast(t('Starter page created'), 'info', 'feedback');
      }
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not create starter page.')), 'error', 'feedback');
      }
    } finally {
      setCreatingMode(null);
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    setCreatingMode(`template:${templateId}`);
    try {
      const res = await api.mutate<{ run: ScenarioRun; project: DesignProjectDetail }>(
        `create-page:${step.id}:${templateId}`,
        'create_page',
        { stepId: step.id, mode: 'template', templateId },
      );
      setProject(res.project);
      toast.showToast(t('Page created from template'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not create page from template.')), 'error', 'feedback');
      }
    } finally {
      setCreatingMode(null);
    }
  };

  const handleLinkExisting = async () => {
    if (!selectedExistingId) return;
    setCreatingMode('link');
    try {
      const res = await api.mutate<{ run: ScenarioRun; project: DesignProjectDetail }>(
        `link-design:${step.id}:${selectedExistingId}`,
        'link_design',
        { stepId: step.id, designProjectId: selectedExistingId },
      );
      setProject(res.project);
      toast.showToast(t('Design project linked'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not link Design project.')), 'error', 'feedback');
      }
    } finally {
      setCreatingMode(null);
    }
  };

  const handleCopyAgentDesignPrompt = async () => {
    let ensuredRun = run;
    if (!ensuredRun) {
      try {
        ensuredRun = await api.ensureRun();
      } catch {
        ensuredRun = null;
      }
    }

    if (project) {
      const prompt = designProjectPrompt(
        project,
        `Update this page for the "${scenario.title}" workflow (runId=${ensuredRun?.id ?? 'draft'}, expectedRevision=${ensuredRun?.revision ?? 1}, step=${step.id}). When done, link or refresh the revision via openmotion_assets_use (action=scenario, command=link_design, runId=${ensuredRun?.id ?? '<runId>'}, expectedRevision=${ensuredRun?.revision ?? 1}, stepId="${step.id}", designProjectId="${project.id}").`,
        { integration, language: locale },
      );
      const ok = await copyText(prompt);
      toast.showToast(ok ? t('Copied. Paste into your Agent.') : t('Could not copy to clipboard.'), ok ? 'info' : 'error', 'feedback');
      return;
    }

    const imageRefs = (ensuredRun?.pool ?? pool.items)
      .filter(item => item.ref.type === 'asset' && item.kind === 'image')
      .map(item =>
        item.ref.type === 'asset'
          ? `- "${item.label}": assetId=${item.ref.assetId} versionId=${item.ref.versionId}`
          : null,
      )
      .filter((line): line is string => line !== null);

    const briefLines = [
      pagePrompt.trim() ? `Page instructions:\n${pagePrompt.trim()}` : '',
      briefMarkdown(scenario, ensuredRun?.brief ?? {}),
      ensuredRun
        ? `Scenario write-back: runId=${ensuredRun.id}, expectedRevision=${ensuredRun.revision}, stepId="${step.id}". Link the resulting Design project back via openmotion_assets_use (action=scenario, command=link_design, runId=${ensuredRun.id}, expectedRevision=${ensuredRun.revision}, stepId="${step.id}", designProjectId=<id>).`
        : '',
      imageRefs.length
        ? `Available shared images (embed with openmotion_design_edit action=import_asset):\n${imageRefs.join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n');

    const prompt = designBriefPrompt({
      scenario: pageConfig?.designScenario ?? 'prototype',
      brief: briefLines,
      templateIds: [...(pageConfig?.templates ?? [])],
      language: locale,
      integration,
    });
    const ok = await copyText(prompt);
    toast.showToast(ok ? t('Copied. Paste into your Agent.') : t('Could not copy to clipboard.'), ok ? 'info' : 'error', 'feedback');
  };

  const handleEmbedSingle = async (poolItemId: string, index: number) => {
    if (!project) return;
    const item = pool.byId.get(poolItemId);
    if (!item) return;
    setEmbeddingId(poolItemId);
    try {
      const target = parseTargetValue(selectedTargetFor(poolItemId, index));
      const res = await api.mutate<{ run: ScenarioRun; project: DesignProjectDetail; version: DesignVersion; path: string }>(
        `embed:${step.id}:${poolItemId}`,
        'embed_image',
        {
          stepId: step.id,
          designProjectId: project.id,
          expectedDesignRevision: project.revision,
          poolItemId,
          target,
          alt: item.label,
        },
      );
      setProject(res.project);
      const updatedFile = await designClient.readFile(res.project.id, res.project.entry).catch(() => null);
      if (updatedFile) setCurrentHtml(updatedFile.content);
      toast.showToast(t('Image embedded'), 'info', 'feedback');
    } catch (error) {
      if (error instanceof ScenarioApiError && error.code === 'DESIGN_CONFLICT') {
        await loadLinkedProject(project.id);
        toast.showToast(t('The page changed elsewhere. Reloaded the latest version.'), 'error', 'feedback');
      } else if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not embed image.')), 'error', 'feedback');
      }
    } finally {
      setEmbeddingId(null);
    }
  };

  const handleEmbedAll = async () => {
    if (!project || !boundImages.length) return;
    setEmbeddingAll(true);
    let currentProject = project;
    let embeddedCount = 0;
    try {
      for (let i = 0; i < boundImages.length; i += 1) {
        const item = boundImages[i];
        const target = parseTargetValue(selectedTargetFor(item.id, i));
        const res = await api.mutate<{ run: ScenarioRun; project: DesignProjectDetail; version: DesignVersion; path: string }>(
          `embed-all:${step.id}:${item.id}:${i}`,
          'embed_image',
          {
            stepId: step.id,
            designProjectId: currentProject.id,
            expectedDesignRevision: currentProject.revision,
            poolItemId: item.id,
            target,
            alt: item.label,
          },
        );
        currentProject = res.project;
        embeddedCount += 1;
      }
      setProject(currentProject);
      const updatedFile = await designClient.readFile(currentProject.id, currentProject.entry).catch(() => null);
      if (updatedFile) setCurrentHtml(updatedFile.content);
      toast.showToast(t('Embedded {count} images', { count: embeddedCount }), 'info', 'feedback');
    } catch (error) {
      await loadLinkedProject(currentProject.id);
      if (error instanceof ScenarioApiError && error.code === 'DESIGN_CONFLICT') {
        toast.showToast(t('The page changed elsewhere. Reloaded the latest version.'), 'error', 'feedback');
      } else if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not embed all images.')), 'error', 'feedback');
      }
    } finally {
      setEmbeddingAll(false);
    }
  };

  const handleDownloadDesign = async (format: 'html' | 'zip') => {
    if (!project) return;
    try {
      await designClient.downloadExport(project.id, { format });
      toast.showToast(t('Download started'), 'info', 'feedback');
    } catch (error) {
      toast.showToast(extractErrorMessage(error, t('Could not export page.')), 'error', 'feedback');
    }
  };

  const handleCopyPreviewUrl = async () => {
    if (!project) return;
    const rawPath = designRoutes.raw(project.id, project.entry);
    const fullUrl = typeof window !== 'undefined' ? new URL(rawPath, window.location.origin).href : rawPath;
    const ok = await copyText(fullUrl);
    toast.showToast(ok ? t('Preview URL copied') : t('Could not copy to clipboard.'), ok ? 'info' : 'error', 'feedback');
  };

  const exportMenuExtras = project ? (
    <>
      <MenuItem icon={<RemixIcon name="download-2-line" size={14} />} onClick={() => void handleDownloadDesign('html')}>
        {t('Download HTML')}
      </MenuItem>
      <MenuItem icon={<RemixIcon name="download-2-line" size={14} />} onClick={() => void handleDownloadDesign('zip')}>
        {t('Download ZIP')}
      </MenuItem>
      <MenuItem icon={<RemixIcon name="link" size={14} />} onClick={() => void handleCopyPreviewUrl()}>
        {t('Copy preview URL')}
      </MenuItem>
      <MenuItem icon={<RemixIcon name="external-link-line" size={14} />} onClick={() => nav.openDesignProject(project.id)}>
        {t('Open in Design editor')}
      </MenuItem>
      <MenuItem icon={<RemixIcon name="plug-line" size={14} />} onClick={() => void handleCopyAgentDesignPrompt()}>
        MCP
      </MenuItem>
    </>
  ) : undefined;

  // Embed-only step without a linked upstream page yet
  if (isEmbedOnly && linkedStepId && !designProjectId) {
    const linkedStepDef = findScenarioStep(scenario, linkedStepId);
    const linkedTitle = t(linkedStepDef?.title ?? linkedStepId);
    return (
      <div className="om-step-body" data-step-body="web-page">
        <div className="om-step-toolbar">
          <div className="om-step-toolbar-group" />
          <div className="om-step-toolbar-group">{renderExportMenu()}</div>
        </div>
        <div className="om-step-card om-step-empty-action-card">
          <PanelEmptyState
            icon="layout-line"
            message={t('Create the page in {step} first.', { step: linkedTitle })}
            description={t('Once the landing page exists, return here to embed images as versioned local assets.')}
          />
          <Button
            variant="primary"
            icon={<RemixIcon name="arrow-right-line" size={14} />}
            onClick={() => nav.selectStep(linkedStepId)}
          >
            {t('Go to {step}', { step: linkedTitle })}
          </Button>
        </div>
      </div>
    );
  }

  // No project linked yet (create or both mode)
  if (!designProjectId) {
    const preferredSet = new Set(pageConfig?.templates ?? []);
    const recommendedTemplates = templates.filter(tpl => preferredSet.has(tpl.id));
    const visibleTemplates = showAllTemplates
      ? templates.slice(0, 8)
      : (recommendedTemplates.length > 0 ? recommendedTemplates : templates.slice(0, 3));
    const hasMoreTemplates = templates.length > visibleTemplates.length;
    const isZh = locale.toLowerCase().startsWith('zh');
    const quickChips = PAGE_QUICK_CHIPS[pageConfig?.recipe ?? 'landing'] ?? PAGE_QUICK_CHIPS.landing;

    return (
      <div className="om-step-body" data-step-body="web-page">
        {renderExportMenu()}

        <section className="om-step-card om-page-composer" data-page-composer="true" data-tone="web-page" aria-label={t('Describe your page')}>
          <div className="om-brief-composer-head">
            <div className="om-brief-composer-lead">
              <span className="om-brief-composer-icon" data-tone="web-page" aria-hidden="true">
                <RemixIcon name="layout-line" size={16} />
              </span>
              <div>
                <h3 className="om-step-section-title">{t('Describe your page')}</h3>
                <p className="om-step-muted">{t('Pre-filled from your brief. Tweak what you want and create the page in one click.')}</p>
              </div>
            </div>
          </div>

          <FieldTextarea
            id={`page-prompt-${step.id}`}
            className="om-step-textarea om-page-composer-input"
            rows={3}
            aria-label={t('Describe your page')}
            value={pagePrompt}
            placeholder={defaultPagePrompt}
            onChange={e => {
              setPromptTouched(true);
              setPagePrompt(e.target.value);
            }}
          />

          <div className="om-brief-presets">
            <span className="om-brief-presets-label">{t('Quick additions')}</span>
            <div className="om-step-chip-list">
              {quickChips.map(chip => {
                const addition = isZh ? chip.appendZh : chip.appendEn;
                const activeChip = pagePrompt.includes(addition);
                return (
                  <Button
                    key={chip.id}
                    variant={activeChip ? 'secondary' : 'ghost'}
                    size="sm"
                    className="om-brief-preset-chip"
                    data-tone="web-page"
                    data-active={activeChip ? 'true' : undefined}
                    aria-pressed={activeChip}
                    icon={<RemixIcon name={activeChip ? 'check-line' : 'add-line'} size={13} />}
                    onClick={() => {
                      setPromptTouched(true);
                      setPagePrompt(prev => {
                        if (prev.includes(addition)) {
                          return prev.replace(addition, '').replace(/\s{2,}/g, ' ').trim();
                        }
                        return prev.trim() ? `${prev.trim()} ${addition}` : addition;
                      });
                    }}
                  >
                    {isZh ? chip.zh : chip.en}
                  </Button>
                );
              })}
            </div>
          </div>

          {pageConfig?.mode === 'both' && (
            <BindingSlot
              slot="embedImages"
              label={t('Images to embed')}
              hint={t('Optional. Attach images from Assets to place automatically.')}
              kinds={['image']}
              stepId={step.id}
              boundIds={boundEmbedIds}
              pool={pool}
              api={api}
              toast={toast}
            />
          )}

          <div className="om-brief-composer-bar">
            <Button
              variant="secondary"
              size="sm"
              icon={<RemixIcon name="plug-line" size={14} />}
              onClick={() => void handleCopyAgentDesignPrompt()}
            >
              {t('Design via MCP')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<RemixIcon name="sparkling-line" size={14} />}
              loading={creatingMode === 'starter'}
              disabled={creatingMode !== null}
              onClick={() => void handleCreateStarter()}
            >
              {t('Create page')}
            </Button>
          </div>
        </section>

        {(() => {
          const capabilityNode = (
            <StepCapabilityBar
              scenario={scenario}
              step={step}
              state={state}
              run={run}
              active={active}
              api={api}
              pool={pool}
              toast={toast}
              nav={nav}
              stepPrompt={pagePrompt}
              allowQuickMedia
              defaultModality="image"
              compact
            />
          );
          return renderCapabilityBar ? renderCapabilityBar(capabilityNode) : capabilityNode;
        })()}

        {(templatesLoading || templatesError || visibleTemplates.length > 0) && (
          <section className="om-step-section" aria-label={t('Start from a Design template')}>
            <div className="om-step-section-head">
              <div className="om-brief-composer-lead">
                <span className="om-brief-composer-icon" data-tone="web-page" aria-hidden="true">
                  <RemixIcon name="grid-line" size={16} />
                </span>
                <div>
                  <h3 className="om-step-section-title">{t('Or pick a starting layout')}</h3>
                  <p className="om-step-muted">{t('Pick a starter layout and customize it in this workflow or in Design Studio.')}</p>
                </div>
              </div>
              {(hasMoreTemplates || showAllTemplates) && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RemixIcon name="apps-2-line" size={14} />}
                  onClick={() => setShowAllTemplates(prev => !prev)}
                >
                  {showAllTemplates
                    ? t('Show recommended only')
                    : t('Show all layouts ({count})', { count: templates.length })}
                </Button>
              )}
            </div>
            {templatesError ? (
              <div className="om-step-inline-error">
                <span>{t('Could not load Design templates.')}</span>
                <Button variant="ghost" size="sm" onClick={() => void loadTemplatesAndProjects()}>{t('Retry')}</Button>
              </div>
            ) : templatesLoading ? (
              <div className="om-step-template-grid">
                {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="om-step-template-skeleton" />)}
              </div>
            ) : (
              <div className="om-step-template-grid">
                {visibleTemplates.map(tpl => {
                  const recommended = preferredSet.has(tpl.id);
                  return (
                    <Button
                      key={tpl.id}
                      variant="plain"
                      type="button"
                      className="om-step-template-card"
                      disabled={creatingMode !== null}
                      onClick={() => void handleCreateFromTemplate(tpl.id)}
                    >
                      <ScaledPreviewThumb
                        src={tpl.previewUrl}
                        title={tpl.title}
                        badge={recommended ? t('Recommended') : undefined}
                      />
                      <span className="om-step-template-copy">
                        <strong>{tpl.title}</strong>
                        <small>{tpl.description}</small>
                      </span>
                    </Button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {existingProjects.length > 0 && (
          <section className="om-step-disclosure" aria-label={t('Link an existing Design project')}>
            <Button
              variant="ghost"
              size="sm"
              className="om-step-disclosure-trigger"
              aria-expanded={linkProjectExpanded}
              icon={<RemixIcon name={linkProjectExpanded ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={14} />}
              onClick={() => setLinkProjectExpanded(prev => !prev)}
            >
              <span>
                {t('Or reuse an existing Design page')} · {t('{count} available', { count: existingProjects.length })}
              </span>
            </Button>
            {linkProjectExpanded && (
              <div className="om-step-disclosure-body om-step-disclosure-panel">
                <div className="om-step-section-head">
                  <div className="om-brief-composer-lead">
                    <span className="om-brief-composer-icon" data-tone="web-page" aria-hidden="true">
                      <RemixIcon name="link" size={16} />
                    </span>
                    <div>
                      <h3 className="om-step-section-title">{t('Link an existing Design project')}</h3>
                      <p className="om-step-muted">{t('Reuse a Design Studio HTML project already in this workspace.')}</p>
                    </div>
                  </div>
                </div>
                <div className="om-step-link-row">
                  <Select
                    label={t('Design project')}
                    value={selectedExistingId}
                    options={existingProjects.map(p => ({ value: p.id, label: p.title }))}
                    onCommit={setSelectedExistingId}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={creatingMode === 'link'}
                    disabled={!selectedExistingId || creatingMode !== null}
                    onClick={() => void handleLinkExisting()}
                  >
                    {t('Link project')}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {state.iterations.length > 0 && renderIterations({
          renderOutput: (iteration: StepIteration) => (
            <StepMediaOutputs iteration={iteration} pool={pool} fallback={t('Page version')} />
          ),
        })}
      </div>
    );
  }

  const activeViewport = designViewports.find(v => v.id === viewportId) ?? designViewports[0];
  const previewSrc = project
    ? `${designRoutes.raw(project.id, project.entry)}?v=${encodeURIComponent(project.revision)}`
    : '';

  return (
    <div className="om-step-body" data-step-body="web-page">
      <div className="om-step-toolbar">
        <div className="om-step-toolbar-group">
          <div className="om-step-segmented" role="group" aria-label={t('Preview viewport')}>
            {designViewports.map(vp => (
              <Button
                key={vp.id}
                variant={viewportId === vp.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={viewportId === vp.id}
                icon={<RemixIcon name={vp.icon} size={14} />}
                onClick={() => setViewportId(vp.id)}
              >
                {t(vp.label)}
              </Button>
            ))}
          </div>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t('Reload preview')}
            icon={<RemixIcon name="refresh-line" size={14} />}
            onClick={() => void loadLinkedProject(designProjectId)}
          />
        </div>
        <div className="om-step-toolbar-group">
          <Button
            variant="secondary"
            size="sm"
            icon={<RemixIcon name="external-link-line" size={14} />}
            onClick={() => nav.openDesignProject(designProjectId)}
          >
            {t('Open in Design editor')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RemixIcon name="plug-line" size={14} />}
            onClick={() => void handleCopyAgentDesignPrompt()}
          >
            {t('Design via MCP')}
          </Button>
          {renderExportMenu(exportMenuExtras)}
        </div>
      </div>

      <section className="om-step-card om-step-page-preview-card" aria-label={t('Live page preview')}>
        {projectError ? (
          <div className="om-step-inline-error">
            <span>{projectError}</span>
            <Button variant="ghost" size="sm" onClick={() => void loadLinkedProject(designProjectId)}>{t('Retry')}</Button>
          </div>
        ) : projectLoading && !project ? (
          <Skeleton className="om-step-iframe-skeleton" />
        ) : project ? (
          <div className="om-step-page-stage" data-viewport={viewportId}>
            <div
              className="om-step-page-frame"
              style={activeViewport.width ? { width: activeViewport.width, maxWidth: '100%' } : undefined}
            >
              <iframe
                key={`${project.id}:${project.revision}`}
                className="om-step-page-iframe"
                title={project.title}
                sandbox="allow-scripts"
                src={previewSrc}
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="om-step-card" aria-label={t('Embed images')}>
        <div className="om-step-section-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone="image" aria-hidden="true">
              <RemixIcon name="file-image-line" size={16} />
            </span>
            <div>
              <h3 className="om-step-section-title">{t('Embed images into this page')}</h3>
              <p className="om-step-muted">{t('Place images from Assets directly into the page layout.')}</p>
            </div>
          </div>
          {boundImages.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              icon={<RemixIcon name="file-image-line" size={14} />}
              loading={embeddingAll}
              disabled={!project || embeddingId !== null || embeddingAll}
              onClick={() => void handleEmbedAll()}
            >
              {t('Embed all')}
            </Button>
          )}
        </div>

        <BindingSlot
          slot="embedImages"
          label={t('Images to embed')}
          kinds={['image']}
          stepId={step.id}
          boundIds={boundEmbedIds}
          pool={pool}
          api={api}
          toast={toast}
          disabled={embeddingAll}
        />

        {boundImages.length > 0 && (
          <div className="om-step-embed-rows">
            {boundImages.map((item, idx) => {
              const targetValue = selectedTargetFor(item.id, idx);
              return (
                <div key={item.id} className="om-step-embed-row" data-embed-item={item.id}>
                  <span className="om-step-embed-label">{item.label}</span>
                  <div className="om-step-embed-target">
                    <Select
                      label={t('Target slot for {label}', { label: item.label })}
                      value={targetValue}
                      options={targetOptions}
                      disabled={embeddingAll || embeddingId === item.id}
                      onCommit={next => setTargetByPoolId(prev => ({ ...prev, [item.id]: next }))}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={embeddingId === item.id}
                    disabled={!project || embeddingAll || embeddingId !== null}
                    onClick={() => void handleEmbedSingle(item.id, idx)}
                  >
                    {t('Embed')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {(() => {
        const capabilityNode = (
          <StepCapabilityBar
            scenario={scenario}
            step={step}
            state={state}
            run={run}
            active={active}
            api={api}
            pool={pool}
            toast={toast}
            nav={nav}
            stepPrompt={pagePrompt}
            allowQuickMedia
            defaultModality="image"
            compact
            onAfterSync={() => loadLinkedProject(designProjectId)}
          />
        );
        return renderCapabilityBar ? renderCapabilityBar(capabilityNode) : capabilityNode;
      })()}

      {renderIterations({
        renderOutput: (iteration: StepIteration) => {
          if (!iteration.design) {
            return <StepMediaOutputs iteration={iteration} pool={pool} fallback={t('Page version')} />;
          }
          const entry = project?.entry ?? 'index.html';
          const versionUrl = iteration.design.versionId
            ? `${designRoutes.raw(iteration.design.projectId, entry)}?version=${encodeURIComponent(iteration.design.versionId)}`
            : `${designRoutes.raw(iteration.design.projectId, entry)}?v=${encodeURIComponent(iteration.design.revision)}`;
          return (
            <div className="om-step-design-iter">
              <ScaledPreviewThumb
                src={versionUrl}
                title={t('Version {number}', { number: iteration.number })}
              />
              <span className="om-step-muted">
                {iteration.design.revision.slice(0, 8)}
              </span>
            </div>
          );
        },
      })}
    </div>
  );
}
