import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import type { MotionSkill, SkillMotif } from './skillCatalog';
import { useSkillPreview } from './useSkillPreview';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { ExploreCoverImage } from './ExploreCoverImage';
import './skills.css';

/** Upstream demo media when available; otherwise the package-token illustration. */
export function SkillMedia({ skill, playing = false, large = false, brandedFallback = false }: { skill: MotionSkill; playing?: boolean; large?: boolean; brandedFallback?: boolean }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const cover = failed ? undefined : skill.cover;
  const play = large || playing;
  const video = useSkillPreview(cover?.video, play);
  if (!cover || (!video && !cover.poster && !(play && cover.gif))) {
    return brandedFallback ? <CoverPlaceholder fill /> : <SkillCover motif={skill.motif} name={skill.name} large={large} playing={play} />;
  }
  // A side-by-side before/after demo becomes a split cover (like an upscale preview):
  // each half fills one side, a divider runs down the middle and the skill name sits on it.
  if (cover.compare) return <span className="om-skill-media om-skill-split" data-large={large}>
    {(['before', 'after'] as const).map(side => <span key={side} className="om-skill-split-half" data-side={side}>
      <CoverMedia cover={cover} video={video} play={play} large={large} onFail={() => setFailed(true)} brandedFallback={brandedFallback} />
    </span>)}
    <span className="om-skill-split-divider" aria-hidden="true" />
    <span className="om-skill-split-label" aria-hidden="true"><RemixIcon name="sparkling-line" size={14} />{t('Remove the AI look')}</span>
    <span className="om-skill-split-caption" data-side="before" aria-hidden="true">{t('Before')}</span>
    <span className="om-skill-split-caption" data-side="after" aria-hidden="true">{t('After')}</span>
  </span>;
  return <span className="om-skill-media" data-large={large}><CoverMedia cover={cover} video={video} play={play} large={large} onFail={() => setFailed(true)} brandedFallback={brandedFallback} /></span>;
}

/** Keep the poster visible while an active card's demo loads. */
function CoverMedia({ cover, video, play, large, onFail, brandedFallback }: { cover: NonNullable<MotionSkill['cover']>; video?: string; play: boolean; large: boolean; onFail: () => void; brandedFallback: boolean }) {
  const player = useRef<HTMLVideoElement>(null);
  // A video the browser cannot load or decode falls back to its poster before the motif illustration.
  const [videoFailed, setVideoFailed] = useState(false);
  const [readyVideo, setReadyVideo] = useState<string>();
  useEffect(() => {
    const element = player.current;
    if (!element || !video) return;
    if (play) void element.play().catch(() => {}); else element.pause();
  }, [play, video]);
  if (brandedFallback) return <>
    <ExploreCoverImage src={video && !videoFailed ? cover.poster : (play && cover.gif ? cover.gif : cover.poster)} />
    {video && !videoFailed && <video ref={player} src={video} muted playsInline loop preload="auto" aria-hidden="true"
      style={{ opacity: readyVideo === video ? 1 : 0 }} onLoadedData={() => setReadyVideo(video)} onError={() => setVideoFailed(true)} />}
  </>;
  if (video && !videoFailed) return <video ref={player} src={video} poster={cover.poster} muted playsInline loop
    preload="auto" aria-hidden="true" onError={() => cover.poster ? setVideoFailed(true) : onFail()} />;
  const still = cover.poster ?? cover.gif;
  return <>{cover.gif && <img src={play ? cover.gif : still} alt="" loading="lazy" decoding="async" onError={onFail} />}
    {!cover.gif && cover.poster && <img src={cover.poster} alt="" loading="lazy" decoding="async" onError={onFail} />}</>;
}

/** Package-token illustration: one motif per technique, animated only when motion is allowed. */
function SkillCover({ motif, name, large, playing }: { motif: SkillMotif; name: string; large: boolean; playing: boolean }) {
  return <span className="om-skill-cover om-media-surface" data-motif={motif} data-large={large} data-playing={playing} role="img" aria-label={name}>
    <svg viewBox="0 0 160 90" aria-hidden="true">{motifShapes[motif]}</svg>
  </span>;
}

const dots = (count: number, y: number) => Array.from({ length: count }, (_, index) => <circle key={`${y}-${index}`} className="om-skill-dot" style={{ animationDelay: `${index * 0.12}s` }} cx={24 + index * 16} cy={y} r="4" />);
const motifShapes: Record<SkillMotif, ReactElement> = {
  agent: <><rect className="om-skill-line" x="28" y="22" width="104" height="46" rx="8" /><path className="om-skill-stroke" d="M44 38h40M44 50h64" /><circle className="om-skill-pulse" cx="118" cy="36" r="6" /></>,
  scene: <><rect className="om-skill-line" x="18" y="20" width="36" height="50" rx="6" /><rect className="om-skill-fill om-skill-slide" x="62" y="20" width="36" height="50" rx="6" /><rect className="om-skill-line" x="106" y="20" width="36" height="50" rx="6" /></>,
  layout: <><rect className="om-skill-fill om-skill-morph" x="20" y="18" width="56" height="54" rx="8" /><rect className="om-skill-line" x="86" y="18" width="54" height="24" rx="6" /><rect className="om-skill-line" x="86" y="48" width="54" height="24" rx="6" /></>,
  curve: <><path className="om-skill-line" d="M16 74H146M16 74V14" /><path className="om-skill-stroke om-skill-draw" d="M16 74C60 74 70 18 146 18" /><circle className="om-skill-pulse" cx="146" cy="18" r="5" /></>,
  stagger: <>{dots(8, 30)}{dots(8, 46)}{dots(8, 62)}</>,
  math: <><path className="om-skill-line" d="M12 45H148M80 10V80" /><path className="om-skill-stroke om-skill-draw" d="M12 45C24 20 36 20 48 45S72 70 84 45 108 20 120 45 144 70 148 60" /><circle className="om-skill-line" cx="80" cy="45" r="18" /></>,
  vector: <><polygon className="om-skill-fill om-skill-spin" points="50,20 70,58 30,58" /><circle className="om-skill-line om-skill-pulse" cx="96" cy="44" r="18" /><rect className="om-skill-fill om-skill-slide" x="118" y="30" width="26" height="26" rx="4" /></>,
  playback: <><path className="om-skill-line" d="M20 64H140" /><circle className="om-skill-fill om-skill-scrub" cx="20" cy="64" r="6" /><path className="om-skill-fill" d="M70 22l24 14-24 14z" /></>,
  depth: <><path className="om-skill-line" d="M80 14l40 20v32L80 86 40 66V34z" /><path className="om-skill-line" d="M40 34l40 20 40-20M80 54v32" /><path className="om-skill-fill om-skill-float" d="M80 14l40 20-40 20-40-20z" /></>,
  frames: <><rect className="om-skill-line" x="18" y="24" width="30" height="42" rx="4" /><rect className="om-skill-line" x="54" y="24" width="30" height="42" rx="4" /><rect className="om-skill-line" x="90" y="24" width="30" height="42" rx="4" /><rect className="om-skill-fill om-skill-frame" x="18" y="24" width="30" height="42" rx="4" /><path className="om-skill-stroke" d="M128 45h16" /></>,
  canvas: <><rect className="om-skill-line" x="14" y="14" width="132" height="62" rx="6" /><rect className="om-skill-fill om-skill-drag" x="28" y="28" width="34" height="22" rx="4" /><rect className="om-skill-line" x="98" y="44" width="34" height="22" rx="4" /><path className="om-skill-stroke" d="M62 39C80 39 80 55 98 55" /></>,
  icon: <><circle className="om-skill-line" cx="80" cy="45" r="26" /><path className="om-skill-stroke om-skill-draw" d="M66 46l10 10 20-22" /></>,
  sequence: <><path className="om-skill-line" d="M16 72H144" /><rect className="om-skill-fill om-skill-dot" style={{ animationDelay: '0s' }} x="20" y="22" width="34" height="10" rx="5" /><rect className="om-skill-fill om-skill-dot" style={{ animationDelay: '.3s' }} x="58" y="38" width="44" height="10" rx="5" /><rect className="om-skill-fill om-skill-dot" style={{ animationDelay: '.6s' }} x="106" y="54" width="34" height="10" rx="5" /></>,
  character: <><circle className="om-skill-fill" cx="80" cy="24" r="9" /><path className="om-skill-stroke" d="M80 34v24M80 58l-12 18M80 58l12 18M80 42l-16 8" /><path className="om-skill-stroke om-skill-wave" d="M80 42l16-12" /></>,
  globe: <><circle className="om-skill-line" cx="80" cy="45" r="30" /><ellipse className="om-skill-line om-skill-turn" cx="80" cy="45" rx="12" ry="30" /><path className="om-skill-line" d="M50 45h60" /><path className="om-skill-stroke om-skill-draw" d="M60 30C80 6 110 20 104 50" /></>,
  levelup: <><rect className="om-skill-line" x="24" y="56" width="112" height="12" rx="6" /><rect className="om-skill-fill om-skill-grow" x="24" y="56" width="112" height="12" rx="6" /><path className="om-skill-fill om-skill-pulse" d="M80 14l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z" /></>,
  orbit: <><ellipse className="om-skill-line" cx="80" cy="45" rx="54" ry="18" /><circle className="om-skill-fill" cx="80" cy="45" r="14" /><circle className="om-skill-fill om-skill-orbit" cx="134" cy="45" r="5" /></>,
  promo: <><rect className="om-skill-line" x="22" y="18" width="116" height="54" rx="6" /><rect className="om-skill-fill om-skill-dot" style={{ animationDelay: '0s' }} x="32" y="28" width="28" height="34" rx="3" /><rect className="om-skill-fill om-skill-dot" style={{ animationDelay: '.25s' }} x="66" y="28" width="28" height="34" rx="3" /><rect className="om-skill-fill om-skill-dot" style={{ animationDelay: '.5s' }} x="100" y="28" width="28" height="34" rx="3" /><path className="om-skill-stroke" d="M22 82h116" /><circle className="om-skill-fill om-skill-scrub" cx="22" cy="82" r="3" /></>,
  photo: <><ellipse className="om-skill-line" cx="80" cy="72" rx="34" ry="7" /><rect className="om-skill-fill om-skill-float" x="64" y="24" width="32" height="42" rx="8" /><path className="om-skill-stroke" d="M22 20l14 10M138 20l-14 10" /></>,
  listing: <><rect className="om-skill-fill" x="18" y="16" width="56" height="58" rx="5" /><rect className="om-skill-line om-skill-dot" style={{ animationDelay: '0s' }} x="82" y="16" width="26" height="26" rx="4" /><rect className="om-skill-line om-skill-dot" style={{ animationDelay: '.2s' }} x="114" y="16" width="26" height="26" rx="4" /><rect className="om-skill-line om-skill-dot" style={{ animationDelay: '.4s' }} x="82" y="48" width="58" height="26" rx="4" /></>,
  narration: <><rect className="om-skill-line" x="20" y="16" width="120" height="44" rx="6" /><path className="om-skill-stroke om-skill-draw" d="M36 46l18-14 16 10 20-16 18 12" />{[0, 1, 2, 3, 4, 5, 6, 7, 8].map(index => <rect key={index} className="om-skill-fill om-skill-dot" style={{ animationDelay: `${index * 0.1}s` }} x={44 + index * 8} y={70 - (index % 3) * 3} width="4" height={8 + (index % 3) * 6} rx="2" />)}</>,
  brand: <><circle className="om-skill-fill om-skill-spin" cx="48" cy="45" r="18" /><rect className="om-skill-fill" x="84" y="26" width="16" height="38" rx="3" /><rect className="om-skill-line" x="104" y="26" width="16" height="38" rx="3" /><rect className="om-skill-line" x="124" y="26" width="16" height="38" rx="3" /></>,
  thumbnail: <><rect className="om-skill-line" x="18" y="14" width="124" height="62" rx="6" /><circle className="om-skill-fill" cx="112" cy="46" r="20" /><path className="om-skill-stroke om-skill-pulse" d="M30 34h44M30 50h30" /></>,
  polish: <><rect className="om-skill-line" x="16" y="18" width="60" height="54" rx="6" /><rect className="om-skill-fill" x="84" y="18" width="60" height="54" rx="6" /><path className="om-skill-stroke om-skill-draw" d="M66 45h28" /></>,
  particles: <>{Array.from({ length: 14 }, (_, index) => <circle key={index} className="om-skill-dot om-skill-burst" style={{ animationDelay: `${(index % 7) * 0.15}s`, transformOrigin: '80px 45px', ['--angle' as string]: `${index * 26}deg` }} cx="80" cy="45" r={index % 3 + 2} />)}</>,
};
