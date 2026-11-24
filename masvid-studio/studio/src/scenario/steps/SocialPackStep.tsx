import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useState } from 'react';
import { assetMediaUrl } from '../../../../shared/asset-library';
import { designRoutes } from '../../../../shared/design-project';
import { draftSocialPosts, socialPostsMarkdown } from '../../../../shared/scenario-content';
import { findOutputIteration, type PoolItem, type SocialPost, type StepIteration } from '../../../../shared/scenario-runs';
import { socialPlatforms, type SocialPlatformId } from '../../../../shared/scenarios';
import { MenuItem, Select } from '../../components/ui';
import { FilterChip } from '../../components/ui/FilterChip';
import { FieldInput, FieldTextarea } from '../../components/ui/FormField';
import { VideoFrameThumbnail } from '../../components/ui/VideoFrameThumbnail';
import { useNearViewport } from '../../hooks/useNearViewport';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { downloadText } from '../scenarioClient';
import type { StepProps } from '../stepContract';
import { BindingSlot } from './BindingSlot';
import { SocialPlatformGlyph } from './SocialPlatformGlyph';
import { StepCapabilityBar, StepMediaOutputs } from './StepCapabilityBar';
import { StepVideoPreview } from './StepVideoPreview';
import {
  briefStringValue,
  buildStepAgentPrompt,
  copyText,
  extractErrorMessage,
  isScenarioConflictError,
  poolKindIcon,
} from './stepUtils';

const TONE_OPTIONS = [
  { value: 'bold', label: 'Bold & direct' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'premium', label: 'Premium' },
  { value: 'playful', label: 'Playful' },
  { value: 'informative', label: 'Informative' },
] as const;

function extractPostsFromIteration(iteration: StepIteration | undefined): SocialPost[] {
  if (!iteration) return [];
  const out = iteration.outputs.find((item): item is { type: 'social'; posts: SocialPost[] } => item.type === 'social');
  return out ? out.posts.map(post => ({ ...post, hashtags: [...post.hashtags], mediaPoolItemIds: [...post.mediaPoolItemIds] })) : [];
}

function defaultPagePreviewLink(run: StepProps['run']): string {
  if (!run) return '';
  for (const st of Object.values(run.steps)) {
    if (st.links.designProjectId) {
      const raw = designRoutes.raw(st.links.designProjectId, 'index.html');
      if (typeof window !== 'undefined' && window.location?.origin) {
        return new URL(raw, window.location.origin).href;
      }
      return raw;
    }
  }
  return briefStringValue(run.brief, 'pageUrl');
}

function formatSinglePostText(post: SocialPost): string {
  const tags = post.hashtags.map(tag => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
  return [post.title, post.text, tags, post.link].filter(Boolean).join('\n\n');
}

function MediaMiniThumb({ item }: { item: PoolItem }) {
  const { t } = useI18n();
  const [thumbnail, setThumbnail] = useState<HTMLDivElement | null>(null);
  const nearViewport = useNearViewport(thumbnail);

  if (item.ref.type === 'asset' && item.kind === 'image') {
    return (
      <img
        className="om-step-social-media-thumb"
        src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
        alt={item.label}
        loading="lazy"
      />
    );
  }
  if (item.ref.type === 'asset' && item.kind === 'video') {
    const src = assetMediaUrl(item.ref.assetId, item.ref.versionId);
    return (
      <div ref={setThumbnail} className="om-step-social-media-thumb" role="img" aria-label={item.label}>
        {nearViewport && <VideoFrameThumbnail key={src} src={src} fallbackLabel={t('Preview unavailable')} />}
      </div>
    );
  }
  return (
    <span className="om-step-social-media-icon" aria-hidden="true">
      <RemixIcon name={poolKindIcon(item.kind)} size={16} />
    </span>
  );
}

function SocialImagePreview({ src, label }: { src: string; label: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="om-step-inline-error" role="status">
        <span>{t('Preview unavailable')}</span>
        <Button variant="ghost" size="sm" onClick={() => setFailed(false)}>{t('Retry')}</Button>
      </div>
    );
  }
  return <img src={src} alt={label} loading="lazy" onError={() => setFailed(true)} />;
}

export function SocialPackStep({
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

  const availablePlatformIds = useMemo<SocialPlatformId[]>(
    () => [...(step.platforms ?? socialPlatforms.map(p => p.id))],
    [step.platforms],
  );

  const initialPlatforms = useMemo<SocialPlatformId[]>(() => {
    const draftPlatforms = state.draft.platforms;
    if (Array.isArray(draftPlatforms) && draftPlatforms.length) {
      return draftPlatforms.filter((id): id is SocialPlatformId => availablePlatformIds.includes(id as SocialPlatformId));
    }
    const focus = run?.brief.platformFocus;
    if (Array.isArray(focus) && focus.length) {
      const matched = focus.filter((id): id is SocialPlatformId => availablePlatformIds.includes(id as SocialPlatformId));
      if (matched.length) return matched;
    }
    return availablePlatformIds;
  }, [state.draft.platforms, run?.brief.platformFocus, availablePlatformIds]);

  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatformId[]>(initialPlatforms);
  const [tone, setTone] = useState<string>(
    (typeof state.draft.tone === 'string' && state.draft.tone) ||
    briefStringValue(run?.brief ?? {}, 'tone') ||
    'bold',
  );
  const [link, setLink] = useState<string>(
    (typeof state.draft.link === 'string' && state.draft.link) || defaultPagePreviewLink(run),
  );

  const activeIteration = findOutputIteration(state, 'social');

  const iterVariant = useMemo(() => {
    const raw = activeIteration?.settings?.variant;
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : -1;
  }, [activeIteration]);
  const [lastVariant, setLastVariant] = useState(iterVariant);

  const [posts, setPosts] = useState<SocialPost[]>(() => extractPostsFromIteration(activeIteration));
  const [dirty, setDirty] = useState(false);
  const [hashtagInputs, setHashtagInputs] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPosts(extractPostsFromIteration(activeIteration));
    setLastVariant(iterVariant);
    setDirty(false);
  }, [activeIteration?.id, iterVariant]);

  const boundMediaIds = state.bindings.postMedia ?? [];

  const togglePlatform = (platformId: SocialPlatformId) => {
    setSelectedPlatforms(prev =>
      prev.includes(platformId) ? prev.filter(id => id !== platformId) : [...prev, platformId],
    );
  };

  const handleDraftPosts = async (nextVariant: number) => {
    if (!selectedPlatforms.length) {
      toast.showToast(t('Select at least one platform.'), 'error', 'feedback');
      return;
    }
    setDrafting(true);
    try {
      const briefLocale = briefStringValue(run?.brief ?? {}, 'language') || locale;
      const generated = draftSocialPosts(scenario, run?.brief ?? {}, selectedPlatforms, {
        tone,
        variant: nextVariant,
        mediaPoolItemIds: boundMediaIds,
        link: link.trim() || undefined,
        locale: briefLocale,
      });
      setPosts(generated);
      setLastVariant(nextVariant);
      await api.mutate(`social-draft:${step.id}:v${nextVariant}`, 'add_iteration', {
        stepId: step.id,
        iteration: {
          source: 'local',
          outputs: [{ type: 'social', posts: generated }],
          settings: { tone, variant: nextVariant, platforms: selectedPlatforms, link: link.trim() },
        },
      });
      setDirty(false);
      toast.showToast(nextVariant > 0 ? t('Drafts regenerated') : t('Social posts drafted'), 'info', 'feedback');
    } catch (error) {
      setDirty(true);
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not draft social posts.')), 'error', 'feedback');
      }
    } finally {
      setDrafting(false);
    }
  };

  const handleSaveEdits = async () => {
    if (!posts.length) return;
    setSaving(true);
    try {
      await api.mutate(`social-save:${step.id}`, 'add_iteration', {
        stepId: step.id,
        iteration: {
          source: 'manual',
          outputs: [{ type: 'social', posts }],
          settings: { tone, variant: Math.max(0, lastVariant), platforms: selectedPlatforms, link: link.trim() },
        },
      });
      setDirty(false);
      toast.showToast(t('Edits saved as new version'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not save edits.')), 'error', 'feedback');
      }
    } finally {
      setSaving(false);
    }
  };

  const updatePost = (postId: string, updater: (post: SocialPost) => SocialPost) => {
    setDirty(true);
    setPosts(prev => prev.map(post => (post.id === postId ? updater(post) : post)));
  };

  const handleAddHashtag = (postId: string) => {
    const raw = (hashtagInputs[postId] ?? '').trim().replace(/^#+/, '');
    if (!raw) return;
    updatePost(postId, post => {
      if (post.hashtags.some(tag => tag.toLowerCase() === raw.toLowerCase())) return post;
      return { ...post, hashtags: [...post.hashtags, raw] };
    });
    setHashtagInputs(prev => ({ ...prev, [postId]: '' }));
  };

  const handleMoveMedia = (postId: string, index: number, direction: -1 | 1) => {
    updatePost(postId, post => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= post.mediaPoolItemIds.length) return post;
      const next = [...post.mediaPoolItemIds];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return { ...post, mediaPoolItemIds: next };
    });
  };

  const handleCopyPost = async (post: SocialPost) => {
    const ok = await copyText(formatSinglePostText(post));
    toast.showToast(ok ? t('Post copied') : t('Could not copy to clipboard.'), ok ? 'info' : 'error', 'feedback');
  };

  const handleCopyAllMarkdown = async () => {
    const md = socialPostsMarkdown(posts);
    const ok = await copyText(md);
    toast.showToast(
      ok ? t('Copied all posts as Markdown') : t('Could not copy to clipboard.'),
      ok ? 'info' : 'error',
      'feedback',
    );
  };

  const handleDownloadJson = () => {
    downloadText('social-posts.json', JSON.stringify(posts, null, 2), 'application/json;charset=utf-8');
    toast.showToast(t('Downloaded social-posts.json'), 'info', 'feedback');
  };

  const handleDownloadMarkdown = () => {
    downloadText('social-posts.md', socialPostsMarkdown(posts), 'text/markdown;charset=utf-8');
    toast.showToast(t('Downloaded social-posts.md'), 'info', 'feedback');
  };

  const socialStepPrompt = useMemo(() => {
    const product = briefStringValue(run?.brief ?? {}, 'productName')
      || briefStringValue(run?.brief ?? {}, 'personaName')
      || briefStringValue(run?.brief ?? {}, 'concept');
    const idea = briefStringValue(run?.brief ?? {}, 'idea');
    const visual = briefStringValue(run?.brief ?? {}, 'visualStyle');
    return [
      product ? `Social campaign visual for ${product}` : '',
      idea,
      visual,
      selectedPlatforms.length ? `Platforms: ${selectedPlatforms.join(', ')} (${tone})` : '',
    ]
      .filter(Boolean)
      .join('. ');
  }, [run?.brief, selectedPlatforms, tone]);

  const handleCopyAgentPrompt = async () => {
    let ensuredRun = run;
    if (!ensuredRun) {
      try {
        ensuredRun = await api.ensureRun();
      } catch {
        ensuredRun = null;
      }
    }
    const prompt = buildStepAgentPrompt(scenario, ensuredRun, {
      stepId: step.id,
      stepPrompt: socialStepPrompt || undefined,
      locale,
      integration,
    });
    const ok = await copyText(prompt);
    toast.showToast(
      ok ? t('Copied. Paste into your Agent.') : t('Could not copy to clipboard.'),
      ok ? 'info' : 'error',
      'feedback',
    );
  };

  const exportMenuExtras = (
    <>
      <MenuItem icon={<RemixIcon name="file-copy-line" size={14} />} onClick={() => void handleCopyAllMarkdown()}>
        {t('Copy all posts (Markdown)')}
      </MenuItem>
      <MenuItem icon={<RemixIcon name="download-2-line" size={14} />} onClick={handleDownloadJson}>
        {t('Download JSON')}
      </MenuItem>
      <MenuItem icon={<RemixIcon name="download-2-line" size={14} />} onClick={handleDownloadMarkdown}>
        {t('Download Markdown')}
      </MenuItem>
    </>
  );

  return (
    <div className="om-step-body" data-step-body="social-pack">
      {renderExportMenu(exportMenuExtras)}

      <section className="om-step-card om-social-composer" data-tone="social-pack" aria-label={t('Social pack settings')}>
        <div className="om-brief-composer-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone="social-pack" aria-hidden="true">
              <RemixIcon name="chat-1-line" size={16} />
            </span>
            <div>
              <h3 className="om-step-section-title">{t('Compose social posts')}</h3>
              <p className="om-step-muted">{t('Pick your channels, attach images or video from Assets, and generate ready-to-post copy.')}</p>
            </div>
          </div>
        </div>

        <div className="om-step-field">
          <span className="om-step-field-label">{t('Platforms')}</span>
          <div className="om-step-chip-list" role="group" aria-label={t('Platforms')}>
            {availablePlatformIds.map(platformId => {
              const spec = socialPlatforms.find(p => p.id === platformId);
              if (!spec) return null;
              return (
                <FilterChip
                  key={platformId}
                  active={selectedPlatforms.includes(platformId)}
                  className="om-step-platform-chip"
                  onClick={() => togglePlatform(platformId)}
                >
                  <SocialPlatformGlyph platform={platformId} size="sm" />
                  <span>{t(spec.label)}</span>
                </FilterChip>
              );
            })}
          </div>
        </div>

        <div className="om-step-two-col">
          <div className="om-step-field">
            <span className="om-step-field-label">{t('Copy tone')}</span>
            <Select
              appearance="boxed"
              className="om-step-input"
              label={t('Copy tone')}
              value={tone}
              options={TONE_OPTIONS.map(opt => ({ value: opt.value, label: t(opt.label) }))}
              onCommit={setTone}
            />
          </div>
          <div className="om-step-field">
            <label className="om-step-field-label" htmlFor={`social-link-${step.id}`}>
              {t('Campaign link')}
            </label>
            <FieldInput
              id={`social-link-${step.id}`}
              className="om-step-input"
              type="url"
              value={link}
              placeholder={t('https://example.com')}
              onChange={e => setLink(e.target.value)}
            />
          </div>
        </div>

        <BindingSlot
          slot="postMedia"
          label={t('Attached media')}
          kinds={['image', 'video']}
          stepId={step.id}
          boundIds={boundMediaIds}
          pool={pool}
          api={api}
          toast={toast}
        />

        <div className="om-brief-composer-bar">
          <Button
            variant="secondary"
            size="sm"
            icon={<RemixIcon name="plug-line" size={14} />}
            onClick={() => void handleCopyAgentPrompt()}
          >
            {t('Write via MCP')}
          </Button>
          <div className="om-step-toolbar-group">
            {posts.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="save-line" size={14} />}
                loading={saving}
                disabled={!dirty}
                onClick={() => void handleSaveEdits()}
              >
                {t('Save edits')}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<RemixIcon name={posts.length ? 'refresh-line' : 'sparkling-line'} size={14} />}
              loading={drafting}
              onClick={() => void handleDraftPosts(posts.length ? lastVariant + 1 : 0)}
            >
              {posts.length ? t('Regenerate') : t('Generate posts')}
            </Button>
          </div>
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
            stepPrompt={socialStepPrompt}
            allowQuickMedia
            defaultModality="image"
            compact
          />
        );
        return renderCapabilityBar ? renderCapabilityBar(capabilityNode) : capabilityNode;
      })()}

      {posts.length > 0 && (
        <div className="om-step-social-list">
          {posts.map(post => {
            const spec = socialPlatforms.find(p => p.id === post.platform) ?? socialPlatforms[0];
            const charCount = Array.from(post.text).length;
            const overBodyLimit = charCount > spec.maxChars;
            const hasTitleLimit = 'maxTitleChars' in spec && Boolean(spec.maxTitleChars);
            const titleLimit = hasTitleLimit ? (spec as { maxTitleChars: number }).maxTitleChars : 0;
            const titleCount = Array.from(post.title ?? '').length;
            const overTitleLimit = hasTitleLimit && titleCount > titleLimit;
            const mediaItems = post.mediaPoolItemIds
              .map(id => pool.byId.get(id))
              .filter((item): item is PoolItem => Boolean(item));
            const leadMedia = mediaItems[0];
            const leadSrc = leadMedia?.ref.type === 'asset'
              ? assetMediaUrl(leadMedia.ref.assetId, leadMedia.ref.versionId)
              : null;

            return (
              <article key={post.id} className="om-step-card om-step-social-card" data-social-platform={post.platform}>
                <div className="om-step-social-editor">
                  <div className="om-step-section-head">
                    <div className="om-step-toolbar-group">
                      <SocialPlatformGlyph platform={post.platform} size="md" />
                      <h3 className="om-step-section-title">{t(spec.label)}</h3>
                      <span className="om-step-badge">{post.aspect}</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<RemixIcon name="file-copy-line" size={14} />}
                      onClick={() => void handleCopyPost(post)}
                    >
                      {t('Copy post')}
                    </Button>
                  </div>

                  {hasTitleLimit && (
                    <div className="om-step-field">
                      <div className="om-step-field-label-row">
                        <label className="om-step-field-label" htmlFor={`post-title-${post.id}`}>
                          {t('Title')}
                        </label>
                        <span
                          className="om-step-char-counter"
                          data-over-limit={overTitleLimit ? 'true' : undefined}
                        >
                          {titleCount} / {titleLimit}
                        </span>
                      </div>
                      <FieldInput
                        id={`post-title-${post.id}`}
                        className="om-step-input"
                        value={post.title ?? ''}
                        onChange={e => updatePost(post.id, cur => ({ ...cur, title: e.target.value }))}
                      />
                    </div>
                  )}

                  <div className="om-step-field">
                    <div className="om-step-field-label-row">
                      <label className="om-step-field-label" htmlFor={`post-body-${post.id}`}>
                        {t('Post copy')}
                      </label>
                      <span
                        className="om-step-char-counter"
                        data-char-counter={post.platform}
                        data-over-limit={overBodyLimit ? 'true' : undefined}
                      >
                        {charCount} / {spec.maxChars}
                      </span>
                    </div>
                    <FieldTextarea
                      id={`post-body-${post.id}`}
                      className="om-step-textarea"
                      rows={4}
                      value={post.text}
                      onChange={e => updatePost(post.id, cur => ({ ...cur, text: e.target.value }))}
                    />
                  </div>

                  <div className="om-step-field">
                    <div className="om-step-field-label-row">
                      <span className="om-step-field-label">{t('Hashtags')}</span>
                      <span className="om-step-muted">
                        {post.hashtags.length} / {spec.maxHashtags}
                      </span>
                    </div>
                    <div className="om-step-chip-list">
                      {post.hashtags.map((tag, idx) => (
                        <span key={`${tag}-${idx}`} className="om-step-hashtag-chip">
                          <span>#{tag}</span>
                          <IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={t('Remove #{tag}', { tag })}
                            icon={<RemixIcon name="close-line" size={12} />}
                            onClick={() => updatePost(post.id, cur => ({
                              ...cur,
                              hashtags: cur.hashtags.filter((_, i) => i !== idx),
                            }))}
                          />
                        </span>
                      ))}
                    </div>
                    <div className="om-step-hashtag-add">
                      <FieldInput
                        className="om-step-input"
                        value={hashtagInputs[post.id] ?? ''}
                        placeholder={t('Add hashtag')}
                        aria-label={t('Add hashtag for {platform}', { platform: t(spec.label) })}
                        onChange={e => setHashtagInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddHashtag(post.id);
                          }
                        }}
                      />
                      <Button variant="ghost" size="sm" onClick={() => handleAddHashtag(post.id)}>
                        {t('Add')}
                      </Button>
                    </div>
                  </div>

                  {mediaItems.length > 0 && (
                    <div className="om-step-field">
                      <span className="om-step-field-label">{t('Media order')}</span>
                      <div className="om-step-social-media-strip">
                        {mediaItems.map((item, idx) => (
                          <div key={`${item.id}-${idx}`} className="om-step-social-media-cell">
                            <MediaMiniThumb item={item} />
                            <div className="om-step-social-media-controls">
                              <IconButton
                                size="sm"
                                variant="ghost"
                                disabled={idx === 0}
                                aria-label={t('Move left')}
                                icon={<RemixIcon name="arrow-left-s-line" size={12} />}
                                onClick={() => handleMoveMedia(post.id, idx, -1)}
                              />
                              <IconButton
                                size="sm"
                                variant="ghost"
                                disabled={idx === mediaItems.length - 1}
                                aria-label={t('Move right')}
                                icon={<RemixIcon name="arrow-right-s-line" size={12} />}
                                onClick={() => handleMoveMedia(post.id, idx, 1)}
                              />
                              <IconButton
                                size="sm"
                                variant="ghost"
                                aria-label={t('Remove {label}', { label: item.label })}
                                icon={<RemixIcon name="close-line" size={12} />}
                                onClick={() => updatePost(post.id, cur => ({
                                  ...cur,
                                  mediaPoolItemIds: cur.mediaPoolItemIds.filter((_, i) => i !== idx),
                                }))}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {post.link && (
                    <div className="om-step-social-link-row">
                      <RemixIcon name="link" size={13} />
                      <span>{post.link}</span>
                    </div>
                  )}
                </div>

                <aside className="om-step-social-preview" aria-label={t('{platform} preview', { platform: t(spec.label) })}>
                  <div className="om-step-social-preview-head">
                    <span className="om-step-social-preview-brand">
                      <SocialPlatformGlyph platform={post.platform} size="sm" />
                      <strong>{t(spec.label)}</strong>
                    </span>
                    <span className="om-step-muted">{post.aspect}</span>
                  </div>
                  {leadMedia && (
                    <div className="om-step-social-preview-frame" data-aspect={post.aspect}>
                      {leadSrc && leadMedia.kind === 'image' ? (
                        <SocialImagePreview key={leadSrc} src={leadSrc} label={leadMedia.label} />
                      ) : leadSrc && leadMedia.kind === 'video' ? (
                        <StepVideoPreview key={leadSrc} src={leadSrc} active={active} label={leadMedia.label} />
                      ) : (
                        <span className="om-step-slot-icon">
                          <RemixIcon name={poolKindIcon(leadMedia.kind)} size={20} />
                        </span>
                      )}
                    </div>
                  )}
                  {post.title && <h4 className="om-step-social-preview-title">{post.title}</h4>}
                  <p className="om-step-social-preview-body">{post.text}</p>
                  {post.hashtags.length > 0 && (
                    <p className="om-step-social-preview-tags">
                      {post.hashtags.map(tag => `#${tag}`).join(' ')}
                    </p>
                  )}
                  {post.link && <p className="om-step-social-preview-link">{post.link}</p>}
                </aside>
              </article>
            );
          })}
        </div>
      )}

      {renderIterations({
        renderOutput: (iteration: StepIteration) => {
          const iterPosts = extractPostsFromIteration(iteration);
          if (!iterPosts.length) {
            return <StepMediaOutputs iteration={iteration} pool={pool} fallback={t('No posts')} />;
          }
          const labels = iterPosts.map(p => t(socialPlatforms.find(s => s.id === p.platform)?.label ?? p.platform));
          return (
            <div className="om-step-iter-text">
              <strong>{t('{count} posts', { count: iterPosts.length })} · {labels.join(', ')}</strong>
              <p>{iterPosts[0].text.slice(0, 120)}{iterPosts[0].text.length > 120 ? '…' : ''}</p>
            </div>
          );
        },
      })}
    </div>
  );
}
