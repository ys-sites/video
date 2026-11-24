import { useEffect, useRef, useState, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../packages/design-system/react/RemixIcons';
import {
  designViewports, findDesignScenario,
  type DesignTemplateSummary, type DesignViewportId,
} from '../../../shared/design-project';
import { IconButton } from 'open-design-ui/icon-button';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { MotionIcon } from '../motion/icons';
import './design.css';

/**
 * Full-screen Design template detail view aligned with Motion's Template Detail layout:
 * large interactive live HTML preview stage on the left, structured metadata and
 * Remix / Copy-to-Agent actions on the right, plus Previous / Next template navigation.
 */
export function DesignTemplateDetailModal({
  templates,
  index,
  remixing,
  studioActions = false,
  onNavigate,
  onClose,
  onRemix,
  onUseWithAgent,
}: {
  templates: DesignTemplateSummary[];
  index: number;
  remixing?: boolean;
  studioActions?: boolean;
  onNavigate: (nextIndex: number) => void;
  onClose: () => void;
  onRemix: (template: DesignTemplateSummary) => void;
  onUseWithAgent: (template: DesignTemplateSummary) => Promise<string | null> | void;
}) {
  const { t } = useI18n();
  const template = templates[index] ?? null;
  const total = templates.length;
  const popupRef = useRef<HTMLDivElement>(null);
  const [viewportId, setViewportId] = useState<DesignViewportId>('desktop');

  useEffect(() => {
    if (!template) return;
    setViewportId(template.scenario === 'mobile-app' ? 'mobile' : 'desktop');
  }, [template?.id]);

  useEffect(() => {
    if (!template) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft' && total > 1) onNavigate((index - 1 + total) % total);
      else if (e.key === 'ArrowRight' && total > 1) onNavigate((index + 1) % total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [template, index, total, onNavigate]);

  if (!template) return null;

  const scen = findDesignScenario(template.scenario);
  const vp = designViewports.find(v => v.id === viewportId) ?? designViewports[0];

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="om-design-dialog-backdrop" />
        <Dialog.Popup ref={popupRef} className="om-media-detail-surface om-media-detail-popup om-design-tpl-detail-popup" data-feedback-modal={studioActions || undefined} aria-label={template.title}>
          <div className="om-media-detail-grid">
            {/* Left interactive preview stage with Motion-aligned ambient frosted backdrop */}
            <div className="om-media-detail-stage om-design-tpl-stage">
              <iframe
                key={`ambient-${template.id}`}
                title=""
                aria-hidden="true"
                tabIndex={-1}
                src={`${template.previewUrl}?thumb=1`}
                sandbox="allow-scripts"
                className="om-media-detail-ambient om-design-tpl-ambient"
              />
              <div className="om-media-detail-glass" />

              <div className="om-design-tpl-stage-bar">
                <div className="om-design-segmented">
                  {designViewports.map(item => (
                    <Button
                      key={item.id}
                      type="button"
                      size="sm"
                      variant={viewportId === item.id ? 'secondary' : 'ghost'}
                      icon={<RemixIcon name={item.icon} size={13} />}
                      onClick={() => setViewportId(item.id)}
                    >
                      {t(item.label)}
                    </Button>
                  ))}
                </div>
                <IconButton
                  aria-label={t('Open preview in new tab')}
                  icon={<RemixIcon name="external-link-line" size={14} />}
                  onClick={() => window.open(template.previewUrl, '_blank', 'noopener,noreferrer')}
                />
              </div>

              <div className="om-design-tpl-stage-frame-host">
                <div
                  className="om-design-tpl-stage-frame"
                  style={vp.width ? { width: vp.width, height: vp.height!, maxWidth: '100%', maxHeight: '100%' } : { width: '100%', height: '100%' }}
                >
                  <iframe
                    key={template.id}
                    title={template.title}
                    src={template.previewUrl}
                    sandbox="allow-scripts allow-forms allow-popups"
                    className="om-design-iframe"
                  />
                </div>
              </div>
            </div>

            {/* Right metadata & actions sidebar */}
            <aside className="om-media-detail-info">
              <div className="om-media-detail-nav">
                <IconButton aria-label={t('Close')} icon={<RemixIcon name="close-line" size={18} />} onClick={onClose} />
                <span className="om-design-muted" style={{ marginLeft: 'auto' }}>{index + 1} / {total}</span>
                <IconButton aria-label={t('Previous template')} disabled={total < 2} icon={<RemixIcon name="arrow-left-line" size={16} />} onClick={() => onNavigate((index - 1 + total) % total)} />
                <IconButton aria-label={t('Next template')} disabled={total < 2} icon={<RemixIcon name="arrow-right-line" size={16} />} onClick={() => onNavigate((index + 1) % total)} />
              </div>

              <div className="om-media-detail-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h2 className="om-media-detail-title" style={{ margin: 0 }}>{template.title}</h2>
                  {template.description && (
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--motion-muted)' }}>{template.description}</p>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    <span className="om-design-badge">{scen ? t(scen.label) : template.scenario}</span>
                    {template.category && <span className="om-design-badge">{template.category}</span>}
                  </div>
                </div>

                <div className="om-design-tpl-meta-list">
                  <div className="om-design-tpl-meta-row">
                    <span className="om-design-muted">{t('Scenario')}</span>
                    <span>{scen ? t(scen.label) : template.scenario}</span>
                  </div>
                  <div className="om-design-tpl-meta-row">
                    <span className="om-design-muted">{t('Entry file')}</span>
                    <code>{template.entry}</code>
                  </div>
                  {template.tags.length > 0 && (
                    <div className="om-design-tpl-meta-row" style={{ alignItems: 'flex-start' }}>
                      <span className="om-design-muted">{t('Tags')}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                        {template.tags.slice(0, 6).map(tag => <span key={tag} className="om-design-badge">{tag}</span>)}
                      </div>
                    </div>
                  )}
                </div>

                {template.examplePrompt && (
                  <div className="om-design-item-card">
                    <span className="om-design-muted" style={{ fontSize: 11 }}>{t('Example brief')}</span>
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>{template.examplePrompt}</p>
                  </div>
                )}

                {!studioActions && <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--motion-border-subtle)' }}>
                  <Button type="button" variant="primary" loading={remixing} icon={<RemixIcon name="arrow-right-up-line" size={15} />} onClick={() => onRemix(template)}>
                    {t('Remix into project')}
                  </Button>
                  <Button type="button" variant="secondary" icon={<RemixIcon name="plug-line" size={15} />} onClick={() => onUseWithAgent(template)}>
                    {t('Use with Agent')}
                  </Button>
                </div>}
              </div>
              {studioActions && <DesignTemplateActions
                key={template.id}
                popupRef={popupRef}
                remixing={remixing}
                onRecreate={() => onUseWithAgent(template)}
                onRemix={() => onRemix(template)}
              />}
            </aside>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DesignTemplateActions({ popupRef, remixing, onRecreate, onRemix }: {
  popupRef: RefObject<HTMLDivElement | null>;
  remixing?: boolean;
  onRecreate: () => Promise<string | null> | void;
  onRemix: () => void;
}) {
  const { t } = useI18n();
  const [copying, setCopying] = useState(false);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const copyField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (manualCopy) copyField.current?.focus();
  }, [manualCopy]);

  const recreate = async () => {
    setCopying(true);
    try {
      setManualCopy(await onRecreate() ?? null);
    } finally {
      setCopying(false);
    }
  };

  return <div className="om-media-detail-footer" role="group" aria-label={t('Template actions')}>
    {manualCopy && <textarea
      ref={copyField}
      className="om-design-textarea mb-2"
      aria-label={t('Content to copy')}
      readOnly
      rows={3}
      value={manualCopy}
      onFocus={event => event.currentTarget.select()}
    />}
    <div className="om-media-detail-action-row">
      <Button type="button" variant="ghost" className="om-button h-auto" data-primary disabled={copying} onClick={() => void recreate()}>
        {t('Recreate this template')}<MotionIcon name="sparkles" size={16} />
      </Button>
      <Tooltip label={t('Remix into project')} wrap portalContainer={popupRef}>
        <IconButton
          type="button"
          variant="plain"
          className="om-button om-media-detail-icon-action"
          aria-label={t('Remix into project')}
          disabled={remixing}
          aria-busy={remixing}
          icon={<RemixIcon name={remixing ? 'loader-4-line' : 'folder-add-line'} size={17} className={remixing ? 'om-busy-icon' : undefined} />}
          onClick={onRemix}
        />
      </Tooltip>
    </div>
  </div>;
}
