import { Button } from 'open-design-ui/button';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { deterministicWaveform, resampleWaveform } from './soundPresets';

const WAVE_HEIGHT = 38;
const WAVE_BAR_WIDTH = 2;
const WAVE_BAR_GAP = 2;
const WAVE_BAR_PITCH = WAVE_BAR_WIDTH + WAVE_BAR_GAP;
const WAVE_DEFAULT_WIDTH = 360;

function useElementWidth<T extends HTMLElement>(fallback = WAVE_DEFAULT_WIDTH) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const sync = (next: number) => {
      const rounded = Math.round(next);
      if (rounded >= 64) {
        setWidth(prev => (Math.abs(prev - rounded) >= 2 ? rounded : prev));
      }
    };
    sync(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) sync(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function waveformBarHeight(value: number): number {
  const norm = Math.max(0, Math.min(1, (value - 6) / 90));
  if (norm <= 0.01) return 3;
  // Leave headroom inside WAVE_HEIGHT (38px) so live playing resonance swells smoothly without clipping.
  return Math.max(3, Math.round(3 + norm * (WAVE_HEIGHT - 11)));
}

export function InteractiveWaveform({
  bars,
  progress,
  active,
  playing,
  duration,
  audioRef,
  label,
  onSeek,
  onScrub,
}: {
  bars: readonly number[];
  progress: number;
  active: boolean;
  playing: boolean;
  duration: number;
  audioRef?: RefObject<HTMLAudioElement | null>;
  label: string;
  onSeek: (ratio?: number) => void;
  onScrub?: (ratio: number) => void;
}) {
  const rawId = useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const barsId = `om-wf-bars-${safeId}`;
  const playedClipId = `om-wf-played-${safeId}`;
  const playedGradId = `om-wf-pgrad-${safeId}`;
  const aheadClipId = `om-wf-ahead-${safeId}`;
  const aheadGradId = `om-wf-agrad-${safeId}`;
  const hoverClipId = `om-wf-hover-${safeId}`;

  const [hostRef, hostWidth] = useElementWidth<HTMLDivElement>(WAVE_DEFAULT_WIDTH);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const barsGroupRef = useRef<SVGGElement>(null);
  const playedClipRectRef = useRef<SVGRectElement>(null);
  const playheadRectRef = useRef<SVGRectElement>(null);
  const playedGradRef = useRef<SVGLinearGradientElement>(null);
  const aheadClipRectRef = useRef<SVGRectElement>(null);
  const aheadGradRef = useRef<SVGLinearGradientElement>(null);
  const aheadUseRef = useRef<SVGUseElement>(null);
  const motionBlendRef = useRef(0);
  const smoothEnergyRef = useRef(0);
  const dragStartXRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  const barCount = Math.max(24, Math.floor((hostWidth + WAVE_BAR_GAP) / WAVE_BAR_PITCH));
  const contentWidth = barCount * WAVE_BAR_PITCH - WAVE_BAR_GAP;
  const offsetX = Math.max(0, Math.floor((hostWidth - contentWidth) / 2));

  const sampled = useMemo(() => resampleWaveform(bars, barCount), [bars, barCount]);
  const baseMetrics = useMemo(
    () => sampled.map(value => ({
      amp: Math.max(0, Math.min(1, (value - 6) / 90)),
      height: waveformBarHeight(value),
    })),
    [sampled],
  );

  // Read live audio time on render while playing so hover re-renders never snap the playhead backward.
  const liveEl = active && playing && dragRatio === null ? audioRef?.current : null;
  const liveDur = liveEl && Number.isFinite(liveEl.duration) && liveEl.duration > 0 ? liveEl.duration : duration;
  const liveRatio = liveEl && liveDur > 0 ? liveEl.currentTime / liveDur : progress;
  const clamped = dragRatio !== null ? dragRatio : Math.max(0, Math.min(1, liveRatio));

  const showPlayhead = active || dragRatio !== null;
  const playheadX = offsetX + clamped * contentWidth;
  const playheadRectX = Math.max(0, Math.min(hostWidth - 2, playheadX - 1));
  const hoverX = dragRatio === null && hoverRatio !== null ? offsetX + hoverRatio * contentWidth : null;
  const aheadWidth = 32;

  const applyStaticBars = useCallback((group: SVGGElement | null) => {
    if (!group) return;
    const nodes = group.children;
    const count = Math.min(nodes.length, baseMetrics.length);
    for (let i = 0; i < count; i++) {
      const h = baseMetrics[i].height;
      const rect = nodes[i] as SVGRectElement;
      rect.setAttribute('height', String(h));
      rect.setAttribute('y', String((WAVE_HEIGHT - h) / 2));
    }
  }, [baseMetrics]);

  // Subtle tactile lift under the dragged playhead so manual scrubbing feels responsive.
  useEffect(() => {
    if (dragRatio === null) {
      if (!active || !playing) applyStaticBars(barsGroupRef.current);
      return;
    }
    const group = barsGroupRef.current;
    if (!group) return;
    const nodes = group.children;
    const count = Math.min(nodes.length, baseMetrics.length);
    const playPos = dragRatio * Math.max(1, count - 1);
    for (let i = 0; i < count; i++) {
      const { amp, height: baseH } = baseMetrics[i];
      const dist = i - playPos;
      const focus = Math.exp(-(dist * dist) / 26);
      const lift = amp > 0.02 ? focus * 0.28 : focus * 0.14;
      const h = Math.min(WAVE_HEIGHT - 2, baseH * (1 + lift));
      const rect = nodes[i] as SVGRectElement;
      rect.setAttribute('height', h.toFixed(2));
      rect.setAttribute('y', ((WAVE_HEIGHT - h) / 2).toFixed(2));
    }
  }, [dragRatio, active, playing, baseMetrics, applyStaticBars]);

  // 60/120fps direct-DOM playhead glide + living acoustic flow & syllable resonance (zero React re-renders).
  useEffect(() => {
    const isLive = active && playing && dragRatio === null;
    if (!isLive && motionBlendRef.current <= 0.004) return;

    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    const tick = (nowMs: number) => {
      const targetBlend = isLive ? 1 : 0;
      const blendRate = isLive ? 0.15 : 0.09;
      motionBlendRef.current += (targetBlend - motionBlendRef.current) * blendRate;
      const blend = motionBlendRef.current;

      const el = audioRef?.current;
      const dur = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
      const ratio = isLive && el && dur > 0
        ? Math.max(0, Math.min(1, el.currentTime / dur))
        : Math.max(0, Math.min(1, progress));

      const px = offsetX + ratio * contentWidth;
      const headX = Math.max(0, Math.min(hostWidth - 2, px - 1));

      if (isLive) {
        playedClipRectRef.current?.setAttribute('width', px.toFixed(2));
        playheadRectRef.current?.setAttribute('x', headX.toFixed(2));
        playedGradRef.current?.setAttribute('x1', Math.max(0, px - 72).toFixed(1));
        playedGradRef.current?.setAttribute('x2', px.toFixed(1));
      }

      const group = barsGroupRef.current;
      const count = group ? Math.min(group.children.length, baseMetrics.length) : 0;
      const playPos = ratio * Math.max(1, count - 1);

      // Interpolated instantaneous audio energy right at the playhead with musical attack/release smoothing.
      let rawEnergy = 0;
      if (count > 0) {
        const lo = Math.max(0, Math.min(count - 1, Math.floor(playPos)));
        const hi = Math.min(count - 1, lo + 1);
        const frac = playPos - lo;
        const localLo = baseMetrics[lo].amp;
        const localHi = baseMetrics[hi].amp;
        rawEnergy = baseMetrics[Math.max(0, lo - 1)].amp * 0.2
          + (localLo * (1 - frac) + localHi * frac) * 0.6
          + baseMetrics[Math.min(count - 1, hi + 1)].amp * 0.2;
      }
      const energyRate = rawEnergy > smoothEnergyRef.current ? 0.32 : 0.12;
      smoothEnergyRef.current += (rawEnergy - smoothEnergyRef.current) * energyRate;
      const liveEnergy = smoothEnergyRef.current;

      // Fiber-optic approaching light shimmer clipped strictly inside the upcoming bars ahead of the needle.
      if (aheadClipRectRef.current && aheadGradRef.current && aheadUseRef.current) {
        const aw = Math.min(aheadWidth, Math.max(0, offsetX + contentWidth - px));
        aheadClipRectRef.current.setAttribute('x', px.toFixed(2));
        aheadClipRectRef.current.setAttribute('width', aw.toFixed(2));
        aheadGradRef.current.setAttribute('x1', px.toFixed(1));
        aheadGradRef.current.setAttribute('x2', (px + Math.max(1, aw)).toFixed(1));
        aheadUseRef.current.setAttribute('opacity', (blend * (0.45 + 0.55 * liveEnergy)).toFixed(3));
      }

      // Animate individual bar heights with rolling playhead wave crest + fluid forward current.
      if (!reducedMotion && group && count > 0) {
        const t = nowMs * 0.001;
        const nodes = group.children;
        for (let i = 0; i < count; i++) {
          const { amp, height: baseH } = baseMetrics[i];
          const dist = i - playPos;
          const sigma = dist >= 0 ? 5.4 : 10.0;
          const focus = Math.exp(-(dist * dist) / (2 * sigma * sigma));

          // Rolling acoustic crest right around the needle synced to instantaneous speech/music energy.
          const ripple = 0.5 + 0.5 * Math.sin(t * 11.8 - i * 0.52);
          const localBoost = amp > 0.02
            ? focus * (0.24 + liveEnergy * (0.42 + 0.36 * ripple))
            : focus * liveEnergy * 0.45;

          // Continuous forward-flowing wave current across voiced bars so playback feels fluid and alive.
          const flowWave = Math.sin(t * 5.6 - i * 0.24) * 0.68 + Math.sin(t * 9.0 - i * 0.40 + 1.2) * 0.32;
          const flowStrength = dist <= 0 ? 0.22 : 0.09;
          const flow = amp > 0.03 ? flowWave * flowStrength * (0.45 + 0.55 * liveEnergy) * (0.45 + 0.55 * amp) : 0;

          const scaled = baseH * (1 + blend * (localBoost + flow));
          const minH = baseH <= 3 ? 3 : 3.2;
          const h = Math.max(minH, Math.min(WAVE_HEIGHT - 2, scaled));
          const rect = nodes[i] as SVGRectElement;
          rect.setAttribute('height', h.toFixed(2));
          rect.setAttribute('y', ((WAVE_HEIGHT - h) / 2).toFixed(2));
        }
      }

      if (isLive || blend > 0.004) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        motionBlendRef.current = 0;
        smoothEnergyRef.current = 0;
        if (aheadUseRef.current) aheadUseRef.current.setAttribute('opacity', '0');
        applyStaticBars(barsGroupRef.current);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [active, playing, dragRatio, audioRef, duration, progress, offsetX, contentWidth, hostWidth, baseMetrics, applyStaticBars]);

  const pointerRatio = (clientX: number, el: HTMLElement): number | undefined => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return undefined;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  return (
    <div ref={hostRef} className="om-sound-waveform-host">
      <Button
        type="button"
        variant="plain"
        className="om-sound-waveform-btn"
        data-active={active || undefined}
        data-playing={(active && playing) || undefined}
        data-dragging={dragRatio !== null || undefined}
        data-hovering={hoverRatio !== null || undefined}
        aria-label={label}
        onPointerDown={event => {
          if (event.button !== 0) return;
          dragStartXRef.current = event.clientX;
          draggingRef.current = false;
          try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
        }}
        onPointerMove={event => {
          const ratio = pointerRatio(event.clientX, event.currentTarget);
          if (ratio === undefined) return;
          if (dragStartXRef.current !== null) {
            if (!draggingRef.current && Math.abs(event.clientX - dragStartXRef.current) >= 3) {
              draggingRef.current = true;
              suppressClickRef.current = true;
            }
            if (draggingRef.current) {
              setDragRatio(ratio);
              if (active) onScrub?.(ratio);
              return;
            }
          }
          setHoverRatio(ratio);
        }}
        onPointerUp={event => {
          try {
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          } catch {}
          if (draggingRef.current) {
            const ratio = pointerRatio(event.clientX, event.currentTarget);
            setDragRatio(null);
            if (ratio !== undefined) onSeek(ratio);
          }
          dragStartXRef.current = null;
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          dragStartXRef.current = null;
          draggingRef.current = false;
          setDragRatio(null);
        }}
        onPointerLeave={() => {
          if (!draggingRef.current) setHoverRatio(null);
        }}
        onClick={event => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (event.detail === 0) {
            onSeek(undefined);
            return;
          }
          onSeek(pointerRatio(event.clientX, event.currentTarget));
        }}
      >
        <svg viewBox={`0 0 ${hostWidth} ${WAVE_HEIGHT}`} aria-hidden="true">
          <defs>
            <g id={barsId} ref={barsGroupRef}>
              {baseMetrics.map(({ height: barH }, index) => (
                <rect
                  key={index}
                  x={offsetX + index * WAVE_BAR_PITCH}
                  y={(WAVE_HEIGHT - barH) / 2}
                  width={WAVE_BAR_WIDTH}
                  height={barH}
                  rx={WAVE_BAR_WIDTH / 2}
                />
              ))}
            </g>
            {hoverX !== null && (
              <clipPath id={hoverClipId}>
                <rect x={0} y={0} width={hoverX} height={WAVE_HEIGHT} />
              </clipPath>
            )}
            {showPlayhead && (
              <>
                <clipPath id={playedClipId}>
                  <rect ref={playedClipRectRef} x={0} y={0} width={playheadX} height={WAVE_HEIGHT} />
                </clipPath>
                <linearGradient
                  id={playedGradId}
                  ref={playedGradRef}
                  gradientUnits="userSpaceOnUse"
                  x1={Math.max(0, playheadX - 72)}
                  y1={0}
                  x2={playheadX}
                  y2={0}
                >
                  <stop offset="0%" className="om-sound-wave-stop-body" />
                  <stop offset="56%" className="om-sound-wave-stop-body" />
                  <stop offset="100%" className="om-sound-wave-stop-tip" />
                </linearGradient>
                <clipPath id={aheadClipId}>
                  <rect ref={aheadClipRectRef} x={playheadX} y={0} width={aheadWidth} height={WAVE_HEIGHT} />
                </clipPath>
                <linearGradient
                  id={aheadGradId}
                  ref={aheadGradRef}
                  gradientUnits="userSpaceOnUse"
                  x1={playheadX}
                  y1={0}
                  x2={playheadX + aheadWidth}
                  y2={0}
                >
                  <stop offset="0%" className="om-sound-wave-ahead-start" />
                  <stop offset="100%" className="om-sound-wave-ahead-end" />
                </linearGradient>
              </>
            )}
          </defs>

          <use href={`#${barsId}`} className="om-sound-wave-base" />

          {hoverX !== null && (
            <use href={`#${barsId}`} className="om-sound-wave-hover" clipPath={`url(#${hoverClipId})`} />
          )}

          {showPlayhead && (
            <use
              ref={aheadUseRef}
              href={`#${barsId}`}
              className="om-sound-wave-ahead"
              style={{ fill: `url(#${aheadGradId})` }}
              clipPath={`url(#${aheadClipId})`}
              opacity={0}
            />
          )}

          {showPlayhead && (
            <use
              href={`#${barsId}`}
              className="om-sound-wave-played"
              style={active && playing ? { fill: `url(#${playedGradId})` } : undefined}
              clipPath={`url(#${playedClipId})`}
            />
          )}

          {hoverX !== null && (
            <line
              className="om-sound-wave-scrub"
              x1={Math.max(0.5, Math.min(hostWidth - 0.5, hoverX))}
              y1={2}
              x2={Math.max(0.5, Math.min(hostWidth - 0.5, hoverX))}
              y2={WAVE_HEIGHT - 2}
            />
          )}

          {showPlayhead && (
            <rect
              ref={playheadRectRef}
              className="om-sound-playhead"
              x={playheadRectX}
              y={0}
              width={2}
              height={WAVE_HEIGHT}
              rx={1}
            />
          )}
        </svg>
      </Button>
    </div>
  );
}

export function GeneratingWaveform({ seed }: { seed: string }) {
  const [hostRef, hostWidth] = useElementWidth<HTMLDivElement>(WAVE_DEFAULT_WIDTH);
  const barCount = Math.max(24, Math.floor((hostWidth + WAVE_BAR_GAP) / WAVE_BAR_PITCH));
  const contentWidth = barCount * WAVE_BAR_PITCH - WAVE_BAR_GAP;
  const offsetX = Math.max(0, Math.floor((hostWidth - contentWidth) / 2));
  const bars = useMemo(() => deterministicWaveform(`gen:${seed}`, barCount), [seed, barCount]);

  return (
    <div ref={hostRef} className="om-sound-wave-generating" aria-hidden="true">
      <svg viewBox={`0 0 ${hostWidth} ${WAVE_HEIGHT}`}>
        {bars.map((value, index) => {
          const barH = waveformBarHeight(value);
          return (
            <rect
              key={index}
              x={offsetX + index * WAVE_BAR_PITCH}
              y={(WAVE_HEIGHT - barH) / 2}
              width={WAVE_BAR_WIDTH}
              height={barH}
              rx={WAVE_BAR_WIDTH / 2}
              style={{ animationDelay: `${(index % 18) * 65}ms` }}
            />
          );
        })}
      </svg>
    </div>
  );
}
