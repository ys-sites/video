import { usePlayerStore, type TimelineElement } from "../../player/store/playerStore";
import { expandToLinkedMembers } from "../../player/components/audioClipLink";
import { isLinkedSelectionOn } from "../../utils/linkedClipPreferences";
import {
  applyPatchByTarget,
  readAttributeByTarget,
  type PatchTarget,
} from "../../utils/sourcePatcher";
import type { CommitDomAttributeBatch } from "../../hooks/domEditCommitTypes";
import { buildPatchTarget } from "../../hooks/timelineEditingHelpers";
import type { DomEditSelection } from "./domEditingTypes";
import { parseClipSpeedSource, planClipSpeedTiming, type SpeedTimingPlan } from './clipSpeedTiming';
import { useStudioShellContextOptional } from '../../contexts/StudioContext';
import { useRef } from 'react';
import { parseTimelineFromDOM } from '../../player/lib/timelineDOM';
import { bumpDomEditCommitMapVersion } from '../../hooks/domEditCommitRunner';

type AttributeValueFor = (current: string | undefined) => string | null;

/** Writes a speed attribute on the selection and every `data-link` partner as one undo step. */
export interface LinkedSpeedCommit {
  commitAttribute: (attr: string, valueFor: AttributeValueFor, label: string) => Promise<boolean>;
  commitRate?: (value: string) => Promise<boolean>;
}

const keyOf = (el: TimelineElement) => el.key ?? el.id;
const dataProperty = (attr: string) => (attr.startsWith("data-") ? attr.slice(5) : attr);

function isSelected(el: TimelineElement, selection: PatchTarget): boolean {
  if (selection.hfId && el.hfId) return el.hfId === selection.hfId;
  return selection.id != null && (el.domId ?? el.id) === selection.id;
}

export function linkedPartnerTargets(
  selection: PatchTarget,
  elements: readonly TimelineElement[],
): PatchTarget[] {
  const self = elements.find((el) => isSelected(el, selection));
  if (!self?.link) return [];
  const members = expandToLinkedMembers([keyOf(self)], elements, isLinkedSelectionOn());
  members.delete(keyOf(self));
  return elements
    .filter((el) => members.has(keyOf(el)))
    .map(buildPatchTarget)
    .filter((target): target is NonNullable<typeof target> => target !== null);
}

export function fanOutAttributeInSource(
  source: string,
  targets: readonly PatchTarget[],
  attr: string,
  valueFor: AttributeValueFor,
): string {
  const property = dataProperty(attr);
  return targets.reduce(
    (html, target) =>
      applyPatchByTarget(html, target, {
        type: "attribute",
        property,
        value: valueFor(readAttributeByTarget(html, target, attr)),
      }),
    source,
  );
}

/** A constant speed edit always uses one atomic rate/timing commit, even without a partner. */
export function useLinkedSpeedCommit(
  selection: DomEditSelection,
  commit: CommitDomAttributeBatch | undefined,
): LinkedSpeedCommit | null {
  const elements = usePlayerStore((s) => s.elements);
  const shell = useStudioShellContextOptional();
  const rateVersions = useRef(new Map<string, symbol>());
  if (!commit) return null;
  const partners = linkedPartnerTargets(selection, elements);
  return {
    commitRate: async value => {
      const state = usePlayerStore.getState();
      // Authored IDs (including generated hf-ids) can repeat across source files.
      const storedSelf = state.elements.find(el =>
        (el.sourceFile ?? 'index.html') === selection.sourceFile && isSelected(el, selection));
      state.pinTimelineZoom(state.timelinePps, state.timelineFitPps);
      let plan: SpeedTimingPlan | undefined;
      const latest = bumpDomEditCommitMapVersion(rateVersions.current, `${selection.sourceFile}:${selection.hfId ?? selection.id ?? selection.selector}:${selection.selectorIndex ?? 0}`);
      let ok: boolean;
      try { ok = await commit(selection, [{ type: 'attribute', property: 'playback-rate', value }], {
        label: 'Edit speed',
        syncTimingInPlace: true,
        // Slider events waiting behind a save should not replay obsolete widths after release.
        shouldSave: latest,
        validateContent: html => {
          if (selection.isInsideLockedComposition) throw new Error('Unlock the composition before changing speed');
          // Nested media is intentionally absent from the flat store. Resolve its
          // composition peers from the fresh saved source using the maintained parser.
          const peers = storedSelf ? state.elements : parseTimelineFromDOM(parseClipSpeedSource(html), Infinity)
            .map(el => ({ ...el, sourceFile: selection.sourceFile }));
          const self = storedSelf ?? peers.find(el => isSelected(el, selection));
          if (!self) throw new Error('Selected media is unavailable in the saved source');
          const keys = expandToLinkedMembers([keyOf(self)], peers, isLinkedSelectionOn());
          plan = planClipSpeedTiming(html, self, peers, keys, Number(value),
            state.rippleEditEnabled, state.timelineLinkageEnabled);
        },
        prepareContent: html => {
          if (!plan) throw new Error('Speed timing was not validated');
          return plan.apply(html);
        },
      }); } finally { latest.release(); }
      if (ok && plan?.limited) shell?.showToast('Speed change limited to the available gap', 'info');
      return ok;
    },
    commitAttribute: (attr, valueFor, label) => {
      const property = dataProperty(attr);
      return commit(
        selection,
        [{ type: "attribute", property, value: valueFor(selection.dataAttributes[property]) }],
        {
          label,
          prepareContent: (html) => fanOutAttributeInSource(html, partners, attr, valueFor),
        },
      );
    },
  };
}

/** Routes `playback-rate` through the linked commit; every other attribute keeps `onSetAttribute`. */
export function withLinkedPlaybackRate(
  onSetAttribute: (attr: string, value: string) => void | Promise<void>,
  linked: LinkedSpeedCommit | null,
): (attr: string, value: string) => void | Promise<void> {
  if (!linked) return onSetAttribute;
  return async (attr, value) => {
    if (attr !== "playback-rate") return onSetAttribute(attr, value);
    if (linked.commitRate) { await linked.commitRate(value); return; }
    await linked.commitAttribute("data-playback-rate", () => value, "Edit speed");
  };
}
