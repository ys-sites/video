import { normalizeToZones } from "../components/timelineZones";
import { usePlayerStore } from "../store/playerStore";
import { getTimelineElementIdentity, parseTimelineFromDOM, readTimelineDurationFromDocument } from "./timelineDOM";
import { collectSubCompositionDomChildren, collectSubCompositionHostState } from "../hooks/timelineSyncHydration";
import { invalidateGroupInfoCache } from "./timelineGroupInfo";
import { syncStoredAutomationFromPreview } from "./automationStoreSync";

const TIMING_FIELDS = ["start", "duration", "playbackStart", "playbackStartAttr", "playbackRate", "parentCompositionStart", "authoredStartIsMasterTime", "hidden", "timelineRole", "link", "audioGroup"] as const;

/** A soft restore already changed the preview DOM. Update existing clips through
 * the normal DOM parser now instead of waiting for the runtime's next manifest.
 * Structural restores still reload and discover their complete element set. */
export function syncRestoredTimelineFromPreview(doc: Document | null | undefined): void {
  if (!doc) return;
  invalidateGroupInfoCache(doc);
  const duration = readTimelineDurationFromDocument(doc) || usePlayerStore.getState().duration;
  const parsed = new Map(parseTimelineFromDOM(doc, duration).map(element => [getTimelineElementIdentity(element), element]));
  usePlayerStore.setState(state => {
    let changed = false;
    const elements = state.elements.map(element => {
      const restored = parsed.get(getTimelineElementIdentity(element));
      if (!restored) return element;
      const authoredTrack = restored.authoredTrack ?? restored.track;
      if (TIMING_FIELDS.every(key => element[key] === restored[key]) && (element.authoredTrack ?? element.track) === authoredTrack) return element;
      changed = true;
      return { ...element, ...Object.fromEntries(TIMING_FIELDS.map(key => [key, restored[key]])), authoredTrack };
    });
    return {
      ...(changed ? { elements: normalizeToZones(elements.map(element => ({ ...element, track: element.authoredTrack ?? element.track }))) } : {}),
      ...(duration > 0 && duration !== state.duration && { duration }),
    };
  });
  syncStoredAutomationFromPreview(doc);
  const state = usePlayerStore.getState();
  if (state.clipManifest) {
    const parentMap = new Map(state.clipParentMap);
    usePlayerStore.setState({
      domClipChildren: collectSubCompositionDomChildren(doc, state.clipManifest, parentMap),
      subCompositionHostState: collectSubCompositionHostState(doc, state.clipManifest),
      clipParentMap: parentMap,
    });
  }
}
