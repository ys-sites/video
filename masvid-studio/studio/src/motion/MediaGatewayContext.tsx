import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { isStudioSaveErrorAlreadyToasted } from '../utils/studioSaveDiagnostics';
import { ModelSettings } from './ModelSettings';
import { MediaGenerator } from './MediaGenerator';
import { useArtifactViewActive } from './ArtifactViewState';
import type { GenerateInput, GenerationJob, Modality } from './gatewayClient';
import type { MediaPopoverAnchor } from './mediaPopoverPosition';
import './media-gateway.css';

export type MediaPlacement = { start: number; duration: number; track: number };
export type SelectedMedia = { key: string; elementId: string; path: string; src: string; sourceFile?: string; modality: Modality; label: string };
export type TimelineMediaTarget = { projectId: string; compositionId: string; place: (asset: string, placement: MediaPlacement) => Promise<void>; replace?: (asset: string, selection: SelectedMedia) => Promise<void>; importFiles: (files: File[]) => Promise<void>; currentPlacement: () => MediaPlacement };
export type MediaRequest = { id: string; modality?: Modality; prompt?: string; usage?: GenerateInput['usage'];
  placement?: MediaPlacement; target?: TimelineMediaTarget; onComplete?: (job: GenerationJob) => void;
  selection?: SelectedMedia; intent?: 'edit'; anchor?: MediaPopoverAnchor };
type GatewayUI = { openSettings: () => void; openGenerator: (input?: Omit<MediaRequest, 'id' | 'target'>) => void;
  bindTimeline: (target: TimelineMediaTarget | null) => void; importFiles: () => void; generationOpen: boolean };
const MediaGatewayContext = createContext<GatewayUI | null>(null);
export const useMediaGateway = () => useContext(MediaGatewayContext);

export function MediaGatewayProvider({ children }: { children: ReactNode }) {
  const active = useArtifactViewActive();
  const toast = useToast();
  const [settings, setSettings] = useState(false);
  const [request, setRequest] = useState<MediaRequest | null>(null);
  const timeline = useRef<TimelineMediaTarget | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const bindTimeline = useCallback((target: TimelineMediaTarget | null) => { timeline.current = target; }, []);
  const openSettings = useCallback(() => setSettings(true), []);
  const openGenerator = useCallback((input: Omit<MediaRequest, 'id' | 'target'> = {}) => {
    const target = timeline.current ?? undefined;
    setRequest({ id: crypto.randomUUID(), target, placement: target?.currentPlacement(), ...input });
  }, []);
  const value = useMemo(() => ({ openSettings, openGenerator, bindTimeline, importFiles: () => importInput.current?.click(), generationOpen: !!request }), [openSettings, openGenerator, bindTimeline, request]);
  return <MediaGatewayContext.Provider value={value}>
    {children}
    <input ref={importInput} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={event => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (!files.length || !timeline.current) return;
      void timeline.current.importFiles(files).catch(error => {
        if (!isStudioSaveErrorAlreadyToasted(error)) toast.showToast(error instanceof Error ? error.message : 'Action not completed. Please try again.', 'error');
      });
    }} />
    {active && <StudioToastViewport {...toast} />}
    {active && settings && <ModelSettings onClose={() => setSettings(false)} />}
    {createPortal(<div hidden={!active} inert={!active}>
      {request && <MediaGenerator key={request.id} request={request} onClose={() => setRequest(null)} onSettings={openSettings} />}
    </div>, document.body)}
  </MediaGatewayContext.Provider>;
}
