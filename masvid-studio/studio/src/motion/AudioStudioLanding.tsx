import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { scenesForStudio, studioIconTone, type StudioDestination, type StudioScene } from './creativeStudios';
import { studioExamples } from './sceneShowcase';
import './skills.css';
import './sceneDiscovery.css';

/** Sound Studio home with the technique-studio layout: the intro banner, then the template grid. */
export function AudioStudioLanding({ destination, active, onPrompt, onCreate }: {
  destination: StudioDestination; active: boolean; onPrompt: (prompt: string, scene: StudioScene['id']) => void; onCreate: () => void;
}) {
  const { t } = useI18n();
  const { studio } = destination;
  // The home has no scene tabs: it lists every template in the studio that has an audio preview.
  const templates = scenesForStudio(studio).flatMap(scene => studioExamples({ ...destination, scene }).filter(example => example.audio).map(example => ({ ...example, scene })));
  const [selected, setSelected] = useState(0), [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const featured = templates[selected] ?? templates[0];
  useEffect(() => { if (!active) audio.current?.pause(); }, [active]);
  const play = (index: number) => {
    const element = audio.current, item = templates[index];
    if (!element) return;
    if (index === selected && !element.paused) { element.pause(); return; }
    setSelected(index);
    if (!item.audio) return;
    if (element.getAttribute('src') !== item.audio) element.src = item.audio;
    void element.play().catch(() => setPlaying(false));
  };
  return <div className="om-gallery-results om-audio-landing">
    <audio ref={audio} preload="none" hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <section className="om-specialty-intro">
      <div><h1 className="om-title"><span className="om-studio-heading-icon" data-tone={studioIconTone(studio)}><RemixIcon name={studio.icon} size={24} /></span>{t(studio.title)}</h1>
        <p className="om-muted">{t('Create a voice, a soundtrack, an atmosphere.')}</p>
        <div className="om-specialty-actions">
          <Button variant="ghost" className="om-button h-auto" data-primary onClick={onCreate}><RemixIcon name="add-line" size={16} />{t('Generate audio')}</Button>
        </div>
      </div>
      <Button variant="plain" className="om-specialty-feature" aria-pressed={playing} onClick={() => play(selected)}>
        <img src={featured.poster} alt="" /><span className="om-button om-media-caption"><RemixIcon name={playing ? 'pause-fill' : 'play-fill'} size={16} />{t(featured.title)}</span>
      </Button>
    </section>
    <section className="om-studio-template-shelf" aria-label={t('Audio templates')}>
      <header><h2 className="om-title">{t('Audio templates')}</h2></header>
      <div className="om-studio-template-grid">
        {templates.map((item, index) => <article key={item.title} className="om-gallery-card om-audio-card" data-current={index === selected}>
          <div className="om-gallery-card-media">
            <Button variant="plain" className="motion-gallery-card-cover om-gallery-cover" aria-pressed={index === selected && playing} aria-label={t(item.title)} onClick={() => play(index)}>
              <div className="om-gallery-poster" data-loaded="true"><img src={item.poster} alt="" loading="lazy" decoding="async" /></div>
              <span className="om-gallery-card-shade" />
              <span className="om-gallery-card-top">{item.kind && <span>{t(item.kind)}</span>}{item.seconds && <span>{t('{value}s', { value: item.seconds })}</span>}</span>
              <span className="om-gallery-card-bottom">
                <span className="om-gallery-card-caption"><strong>{t(item.title)}</strong>{item.model && <small>{t('Recommended model')} · {item.model}</small>}</span>
                <span className="om-gallery-card-arrow"><RemixIcon name={index === selected && playing ? 'pause-fill' : 'play-fill'} size={18} /></span>
              </span>
            </Button>
          </div>
          <div className="om-audio-card-prompt">
            <p className="om-muted"><span>{t('Audio prompt')}</span>{t(item.prompt)}</p>
            <Button variant="ghost" className="om-button h-auto" onClick={() => onPrompt(t(item.prompt), item.scene.id)}><RemixIcon name="add-line" size={15} />{t('Use prompt')}</Button>
          </div>
        </article>)}
      </div>
    </section>
  </div>;
}
