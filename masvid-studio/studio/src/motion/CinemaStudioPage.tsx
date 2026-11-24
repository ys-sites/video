import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { cinemaTemplates, type CinemaTemplate } from './cinemaTemplates';
import '../design/design.css';
import './sceneDiscovery.css';

export function CinemaStudioPage({ onTemplate, onStart }: {
  onTemplate: (template: CinemaTemplate, position: number) => void;
  onStart: () => void;
}) {
  const { t, locale } = useI18n();
  const chinese = locale === 'zh-CN';
  const title = t('Cinema Studio');
  const hero = cinemaTemplates[1];

  return <main className="om-explore om-cinema-home" aria-label={title}>
    <div className="om-discovery-page">
      <section className="om-discovery-hero" aria-labelledby="cinema-studio-title">
        <img src={hero.poster} alt="" />
        <div className="om-discovery-hero-copy">
          <h1 id="cinema-studio-title">{title}</h1>
          <p>{chinese ? '从一个镜头开始。选择模板，用提示词或首帧把画面动起来。' : 'Start with a shot. Use a template to bring a prompt or a first frame to life.'}</p>
          <Button variant="ghost" className="om-button h-auto" data-primary="media" onClick={onStart}>
            {t('Create video')}<RemixIcon name="arrow-right-line" size={16} />
          </Button>
        </div>
        <small className="om-scene-credit">{hero.credit}</small>
      </section>

      <section className="om-studio-template-shelf" data-studio="cinema" aria-labelledby="cinema-templates-title">
        <header><h2 className="om-title" id="cinema-templates-title">{t('Templates')}</h2></header>
        <div className="om-studio-template-grid">
          {cinemaTemplates.map((template, position) => {
            const copy = chinese ? template.zh : template.en;
            const mode = t(template.scene === 'text-to-video' ? 'Create video' : 'Image to video');
            return <Button type="button" key={template.id} variant="plain" className="om-design-card om-design-gallery-card om-cinema-template-card"
              data-template-id={template.id} aria-label={copy.title} aria-describedby={`${template.id}-mode ${template.id}-details ${template.id}-materials`} onClick={() => onTemplate(template, position)}>
              <span className="om-design-card-thumb">
                <img src={template.poster} alt="" loading="lazy" />
                <span className="om-design-thumb-badge" id={template.id + '-mode'}>{mode}</span>
                {template.credit && <small className="om-scene-credit">{template.credit}</small>}
              </span>
              <span className="om-design-card-body om-design-gallery-body">
                <strong className="om-design-card-title">{copy.title}</strong>
                <span className="om-design-card-desc" id={template.id + '-details'}>{copy.tag} · {chinese ? '推荐' : 'Recommended'} {template.model.name} · {template.aspect} · {t('{value}s', { value: template.duration })}</span>
                <span className="om-design-card-desc" id={template.id + '-materials'}>{copy.materials}</span>
              </span>
            </Button>;
          })}
        </div>
      </section>
    </div>
  </main>;
}
