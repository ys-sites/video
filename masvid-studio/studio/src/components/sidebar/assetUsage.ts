import type { ClipManifestClip } from '../../player/lib/playbackTypes';
import type { TimelineElement } from '../../player/store/timelineElement';

export interface AssetUsage {
  asset: string;
  clipId: string;
  targetId?: string;
  start: number;
  end: number;
  compositionPath: string;
  localStart: number;
}

/** Match project files, not a different project or a remote URL's basename. */
export function assetSourcePath(source: string, sourceFile = 'index.html', projectId?: string): string | null {
  if (!source) return null;
  let path = source.split(/[?#]/)[0];
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
      const url = new URL(path);
      if (!/^https?:$/.test(url.protocol)) return null;
      if (!url.pathname.startsWith('/api/projects/')) return null;
      if (globalThis.location?.origin && url.origin !== globalThis.location.origin) return null;
      path = url.pathname;
    }
    const served = path.match(/^\/api\/projects\/([^/]+)\/preview\/(?:comp\/)?(.*)$/);
    if (served) {
      if (projectId && decodeURIComponent(served[1]) !== projectId) return null;
      path = served[2];
      sourceFile = 'index.html';
    } else if (path.startsWith('/api/')) return null;
    return decodeURIComponent(new URL(path, `https://project.invalid/${sourceFile}`).pathname.slice(1));
  } catch { return null; }
}

/** Runtime manifest times are already in the active timeline's clock and clipped to host windows. */
export function deriveAssetUsages(elements: readonly TimelineElement[], manifest: readonly ClipManifestClip[] | null, projectId: string, activePath = 'index.html'): Map<string, AssetUsage[]> {
  const result = new Map<string, AssetUsage[]>();
  const matchesId = (el: TimelineElement, id: string | null) => id != null && [el.id, el.domId, el.hfId].includes(id);
  const hosts = new Map(manifest?.filter(c => c.compositionId).map(c => [c.compositionId!, c]));
  const covered = new Set<TimelineElement>();
  const add = (usage: AssetUsage) => {
    if (!Number.isFinite(usage.start) || !Number.isFinite(usage.end) || usage.end <= usage.start) return;
    const list = result.get(usage.asset) ?? [];
    list.push(usage); result.set(usage.asset, list);
  };
  for (const clip of manifest ?? []) {
    if (!clip.assetUrl || !['audio', 'video', 'image'].includes(clip.kind)) continue;
    let parent = hosts.get(clip.parentCompositionId ?? '');
    let owner: ClipManifestClip | undefined;
    let target: TimelineElement | undefined;
    const seen = new Set<ClipManifestClip>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const visibleHost = elements.find(el => matchesId(el, parent!.id));
      target ??= visibleHost;
      const source = parent.compositionSrc ?? visibleHost?.compositionSrc;
      if (!owner && source) owner = { ...parent, compositionSrc: source };
      parent = hosts.get(parent.parentCompositionId ?? '');
    }
    const compositionPath = (owner?.compositionSrc ? assetSourcePath(owner.compositionSrc, activePath, projectId) : activePath) ?? activePath;
    // DOM ids are local to each composition; rows without sourceFile belong to the active file.
    const live = elements.find(el => matchesId(el, clip.id) && el.src && (el.sourceFile ?? activePath) === compositionPath);
    if (live) covered.add(live);
    target = live ?? target;
    const asset = assetSourcePath(live?.src ?? clip.assetUrl, live?.sourceFile ?? compositionPath, projectId);
    if (!asset) continue;
    const start = live?.start ?? clip.start, duration = live?.duration ?? clip.duration;
    const localStart = owner && !live ? (start - owner.start) * (owner.playbackRate ?? 1) + (owner.playbackStart ?? 0) : start;
    add({ asset, clipId: clip.id ?? '', targetId: target && (target.key ?? target.id), start, end: start + duration, compositionPath, localStart });
  }
  for (const el of elements) {
    if (!el.src || covered.has(el) || el.kind === 'composition' || el.compositionSrc) continue;
    const asset = assetSourcePath(el.src, el.sourceFile ?? activePath, projectId);
    if (asset) add({ asset, clipId: el.domId ?? el.id, targetId: el.key ?? el.id, start: el.start, end: el.start + el.duration, compositionPath: el.sourceFile ?? activePath, localStart: el.start });
  }
  for (const list of result.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return result;
}
