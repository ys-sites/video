import { IconGlyph } from "../../../../packages/design-system/react/IconGlyph";
import React, { useEffect, useRef, useState } from "react";
import { translations, resolveLanguage } from "../../../../mcp-ui/template-recommendations/i18n.ts";
import { createInlineFeedback } from "../../../../packages/design-system/inline-feedback.ts";
import type { RecommendationDetails, RecommendedTemplate } from "./templateRecommendationAction.ts";
import { useHostTheme } from "./theme.ts";
import { studioAssetUrl } from "./studio.ts";

type Props = {
  proposal: { callId?: string; details: RecommendationDetails };
  decision?: { phase?: string };
  summary?: React.ReactNode;
  act: (verb: string, payload: { templateId: string }) => Promise<unknown>;
};

export function TemplateRecommendationCard({ proposal, decision, summary, act }: Props) {
  const theme = useHostTheme();
  const details = proposal.details;
  const language = resolveLanguage(details.language || "en");
  const { ui, welcome } = translations[language];
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<RecommendedTemplate | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLElement>(null);
  const feedback = useRef<ReturnType<typeof createInlineFeedback> | undefined>(undefined);
  useEffect(() => {
    feedback.current = createInlineFeedback(root.current!);
    return () => feedback.current?.destroy();
  }, []);
  useEffect(() => {
    if (!preview) return;
    const modal = dialog.current!, video = player.current;
    if (typeof modal.showModal === "function") modal.showModal();
    else modal.open = true;
    if (video) void Promise.resolve(video.play()).catch(() => {});
    return () => { video?.pause(); modal.close(); };
  }, [preview]);
  function enlarge(template: RecommendedTemplate) {
    root.current?.querySelectorAll("video").forEach(video => video.pause());
    setPreviewFailed(false);
    setPreview(template);
  }
  async function choose(verb: string, templateId: string) {
    setPending(true);
    try {
      const result = await act(verb, { templateId }) as { status?: string } | undefined;
      if (!result || result.status === "refused" || result.status === "unconfirmed") feedback.current?.show(ui.notSent);
    } catch { feedback.current?.show(ui.notSent); }
    finally { setPending(false); }
  }
  return (
    <section ref={root} className="omd-recommendation-card" data-motion-ui data-theme={theme} data-phase={decision?.phase || "open"} aria-label={ui.listLabel}>
      {details.onboarding ? <header className="omd-recommendation-welcome">
        {details.libraryOpened && <strong>{welcome.heading}</strong>}
        <p>{welcome.introduction}</p>
        <p>{welcome.discovery}</p>
        <strong>{welcome.recommendations}</strong>
      </header> : summary}
      <div className="omd-recommendation-list">
        {details.templates.map(template => (
          <article className="omd-recommendation-item" key={template.id} data-template-id={template.id}>
            <button type="button" className="omd-recommendation-cover" aria-label={`${ui.preview}: ${template.title}`} onClick={() => enlarge(template)}>
              {template.previewUrl ? <video muted preload="none" playsInline poster={studioAssetUrl(template.posterUrl)} src={studioAssetUrl(template.previewUrl)} />
                : template.posterUrl ? <img src={studioAssetUrl(template.posterUrl)} alt="" loading="lazy" /> : <span className="omd-recommendation-placeholder" />}
              <span className="omd-recommendation-preview-label">{ui.preview}</span>
            </button>
            <div className="omd-recommendation-info">
              <div className="omd-recommendation-heading">
                <strong title={template.title}>{template.title}</strong>
                {template.duration != null && <span>{Math.round(template.duration)}s</span>}
              </div>
              <p className="omd-recommendation-description">{template.description}</p>
              <button type="button" className="omd-recommendation-clone ui-button ui-button--primary" disabled={pending} onClick={() => void choose("use", template.id)}>{ui.clone}</button>
            </div>
          </article>
        ))}
      </div>
      <dialog ref={dialog} className="omd-video-preview" aria-label={ui.player} onClose={() => setPreview(null)}
        onClick={event => { if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setPreview(null);
        } }}>
        {preview && <>
          <header><strong>{preview.title}</strong><button type="button" className="ui-button ui-button--ghost ui-button--icon" aria-label={ui.close} title={ui.close} onClick={() => setPreview(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><IconGlyph id="ri-close-line" /></svg>
          </button></header>
          {preview.previewUrl && <video ref={player} controls muted playsInline preload="metadata" poster={studioAssetUrl(preview.posterUrl)}
            src={studioAssetUrl(preview.previewUrl)} aria-label={preview.title} onError={() => setPreviewFailed(true)} />}
          {(previewFailed || !preview.previewUrl) && <p role="status">{ui.failed}</p>}
        </>}
      </dialog>
    </section>
  );
}
