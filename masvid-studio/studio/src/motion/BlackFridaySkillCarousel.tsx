import { Button } from 'open-design-ui/button';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { MotionIcon } from './icons';
import { reportSkillCardOpened } from './pageTracking';
import { SkillMedia } from './SkillMedia';
import type { MotionSkill } from './skillCatalog';
import styles from './BlackFridaySkillCarousel.module.css';

const slideDuration = 7000;

export function BlackFridaySkillCarousel({ skills, previewsEnabled, onOpenSkill }: {
  skills: readonly MotionSkill[];
  previewsEnabled: boolean;
  onOpenSkill: (id: string, trigger: HTMLButtonElement) => void;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const previous = (index - 1 + skills.length) % skills.length;
  const next = (index + 1) % skills.length;

  useEffect(() => {
    if (!stage.current) return;
    let onScreen = false;
    const update = () => setVisible(onScreen && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      update();
    }, { threshold: 0.5 });
    observer.observe(stage.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const playing = visible && previewsEnabled && !reducedMotion;
  useEffect(() => {
    if (!playing || hovered || focused || skills.length < 2) return;
    const timer = window.setTimeout(() => setIndex(next), slideDuration);
    return () => window.clearTimeout(timer);
  }, [playing, hovered, focused, next, skills.length]);

  return <section className={styles.carousel} aria-label={t('Black Friday Skills')}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setIndex(event.key === 'ArrowLeft' ? previous : next);
    }}>
    <div className={styles.toolbar}>
      <h2 className={styles.title}>{t('Black Friday Skills')}</h2>
      {skills.length > 1 && <div className={styles.indicators}>
        {skills.map((skill, position) => <Button variant="plain" key={skill.id} type="button" aria-label={t(skill.title)}
          aria-current={index === position ? 'true' : undefined} onClick={() => setIndex(position)}><span /></Button>)}
      </div>}
    </div>
    <div className={styles.stage} ref={stage}>
      {skills.map((skill, position) => {
        const placement = position === index ? 'current' : position === next ? 'next' : position === previous ? 'previous' : undefined;
        if (!placement) return null;
        const selected = position === index;
        return <Button variant="plain" key={skill.id} type="button" className={`om-button om-gallery-cover ${styles.slide}`} data-carousel-position={placement}
          aria-label={t(skill.title)} aria-describedby={selected ? descriptionId : undefined} onClick={event => {
            if (!selected) { setIndex(position); return; }
            reportSkillCardOpened(skill, position + 1, undefined, 'black_friday');
            onOpenSkill(skill.id, event.currentTarget);
          }}>
          <SkillMedia skill={skill} playing={selected && playing} />
          {selected && <>
            <span className="om-gallery-card-shade" aria-hidden="true" />
            <span className="om-gallery-card-bottom">
              <span className={styles.caption}>
                <strong>{t(skill.title)}</strong>
                <span id={descriptionId}>{t(skill.useWhen)}</span>
              </span>
              <span className="om-gallery-card-arrow" aria-hidden="true"><MotionIcon name="arrow-up-right" size={18} /></span>
            </span>
          </>}
        </Button>;
      })}
    </div>
  </section>;
}
