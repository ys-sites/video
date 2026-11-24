import { create } from 'zustand';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import type { CaptionTrack } from '../../../shared/transcript-captions';
import type { TimelineElement } from '../player/store/timelineElement';
import { trackIdentities } from '../player/components/timelineTrackIdentity';

type Selection = { transcriptId?: string; sourcePath: string; nonce: number };
export type CaptionMode = 'auto' | 'manual' | 'style';
type PanelRequest = { compositionPath: string; mode: CaptionMode; trackId?: string; selectClip?: boolean; nonce: number };
export const useCaptionWorkspace = create<{
  selections: Record<string, Selection>;
  requests: Record<string, PanelRequest>;
  epoch: number;
  open: (projectId: string, request: Omit<PanelRequest, 'nonce'>) => void;
  select: (projectId: string, sourcePath: string, transcriptId?: string) => void;
  changed: () => void;
}>(set => ({
  selections: {}, requests: {}, epoch: 0,
  open: (projectId, request) => {
    set(state => ({ requests: { ...state.requests, [projectId]: { ...request, nonce: (state.requests[projectId]?.nonce || 0) + 1 } } }));
    useDockLayoutStore.getState().activatePanel('captions');
  },
  select: (projectId, sourcePath, transcriptId) => set(state => ({ selections: { ...state.selections, [projectId]: { sourcePath, transcriptId, nonce: (state.selections[projectId]?.nonce || 0) + 1 } } })),
  changed: () => set(state => ({ epoch: state.epoch + 1 })),
}));

export function belongsToCaptionTrack(element: TimelineElement, id: string): boolean {
  return ['transcript', 'text'].some(prefix => (element.domId || element.id).startsWith(`${prefix}-${id}-`))
    || ['tr', 'txt'].some(prefix => element.hfId?.startsWith(`${prefix}-${id}-`));
}

export function captionTrackCode(track: CaptionTrack, tracks: CaptionTrack[], elements: TimelineElement[] = []): string {
  const clip = elements.find(element => belongsToCaptionTrack(element, track.id));
  if (clip) {
    const lanes = new Map<number, TimelineElement[]>();
    for (const element of elements) lanes.set(element.track, [...(lanes.get(element.track) || []), element]);
    const identity = trackIdentities([...lanes.keys()], lanes).get(clip.track);
    if (identity) return identity.code;
  }
  const kind = track.kind === 'text' ? 'T' : 'C';
  const lanes = [...new Set(tracks.filter(item => (item.kind === 'text') === (track.kind === 'text')).map(item => item.track))].sort((a, b) => a - b);
  return `${kind}${lanes.indexOf(track.track) + 1}`;
}

export function captionTrackText(track: CaptionTrack, elements: TimelineElement[]): string | undefined {
  return track.kind === 'text' ? elements.find(element => belongsToCaptionTrack(element, track.id))?.text?.value : undefined;
}
