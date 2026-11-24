import { useEffect, useRef } from "react";
import { trackEvent } from "../telemetry/client";
import { readStudioUiPreferences } from "../utils/studioUiPreferences";
import { makeStudioDebugLogger } from "../utils/studioDebug";
import { loadModelContextPolyfill } from "./polyfill";
import { registerStudioTools, type ToolRegistrationReport } from "./registrar";
import { runToolBody, type ToolResult } from "./toolResult";
import { getModelContext, type ModelContext, type ModelContextTool } from "./types";
import {
  buildStudioLook,
  STUDIO_LOOK_DESCRIPTION,
  STUDIO_LOOK_INPUT_SCHEMA,
  type StudioLook,
  type StudioLookInput,
  type StudioLookSnapshot,
} from "./tools/lookTools";
import {
  studioSeek,
  studioSelect,
  STUDIO_SEEK_DESCRIPTION,
  STUDIO_SEEK_INPUT_SCHEMA,
  STUDIO_SELECT_DESCRIPTION,
  STUDIO_SELECT_INPUT_SCHEMA,
  type SelectionToolDeps,
  type StudioSeekResult,
  type StudioSelectResult,
} from "./tools/selectionTools";
import {
  studioFrame,
  STUDIO_FRAME_DESCRIPTION,
  STUDIO_FRAME_INPUT_SCHEMA,
  type FrameToolDeps,
  type StudioFrameInput,
  type StudioFrameResult,
} from "./tools/frameTools";
import {
  studioInspect,
  STUDIO_INSPECT_DESCRIPTION,
  STUDIO_INSPECT_INPUT_SCHEMA,
  type InspectToolDeps,
  type StudioInspectInput,
  type StudioInspectResult,
} from "./tools/inspectTools";
// Retention is deliberate, not an oversight: this pull request stops REGISTERING
// the seven atomic editor write tools while keeping their implementations, so
// Studio's manual editing handlers, the shared write coordinator and the receipt
// lens stay in one maintained place and a future registration needs no new
// host wiring. The list below registers observation and navigation only, and the
// retained path is exercised by `retainedEditorWritePath.test.ts`. See
// `docs/mcp-phase1-tools.md` ("WebMCP access from Studio").
import type { ContentToolDeps } from "./tools/contentTools";
import type { TransformToolDeps } from "./tools/transformTools";
import type { AnimationToolDeps } from "./tools/animationTools";

const log = makeStudioDebugLogger("webmcp");

function reportRegistration(report: ToolRegistrationReport, native: boolean): void {
  log("registered", { native, ...report });
  for (const failure of report.failed) {
    trackEvent("webmcp_registration_failed", {
      error_name: failure.name,
      tool_name: failure.tool,
    });
  }
}

/**
 * The five registered tools read `getSnapshot`, the selection, the playhead and
 * the frame probe. The write dep groups (`ContentToolDeps`,
 * `TransformToolDeps`, `AnimationToolDeps`) are retained on purpose: they keep
 * the retained write modules reachable from the host, and their handlers are
 * still wired in `StudioAgentTools.tsx`. Trimming them would delete the entry
 * points this pull request deliberately kept while leaving the modules and the
 * receipt lens orphaned instead.
 */
export interface StudioAgentToolsDeps
  extends
    SelectionToolDeps,
    FrameToolDeps,
    InspectToolDeps,
    ContentToolDeps,
    TransformToolDeps,
    AnimationToolDeps {
  /** Read Studio's current state. Called per tool invocation, never cached. */
  getSnapshot: () => StudioLookSnapshot;
}

/**
 * Build the observation and navigation tools once.
 * Video content changes go through version-checked openmotion_edit_project.
 *
 * The atomic editor write tools are intentionally absent from this list while
 * their modules stay maintained; see the retention note on the imports above.
 *
 * Every `execute` reads `depsRef.current` at CALL time rather than closing over
 * a snapshot, which is what lets the list be built once and still see live
 * state. That is the whole point of the ref: see the registration note below.
 */
export function buildStudioTools(depsRef: {
  readonly current: StudioAgentToolsDeps;
}): ModelContextTool[] {
  return [
    {
      name: "openmotion_studio_look",
      title: "Look at the composition",
      description: STUDIO_LOOK_DESCRIPTION +
        " Content changes use openmotion_get_project and openmotion_edit_project. The can flags describe Studio manual editing capabilities.",
      inputSchema: STUDIO_LOOK_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: true,
        // The labels, text and ids come from the user's composition, which can
        // contain anything. This is a hint to the agent, not a sanitiser.
        untrustedContentHint: true,
      },
      execute: (input): Promise<ToolResult<StudioLook>> =>
        runToolBody("openmotion_studio_look", async () =>
          buildStudioLook(depsRef.current.getSnapshot(), input as StudioLookInput),
        ),
    },
    {
      name: "openmotion_studio_select",
      title: "Select an element",
      description: STUDIO_SELECT_DESCRIPTION,
      inputSchema: STUDIO_SELECT_INPUT_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input): Promise<ToolResult<StudioSelectResult>> =>
        runToolBody("openmotion_studio_select", () =>
          studioSelect(depsRef.current, readStringInput(input, "handle")),
        ),
    },
    {
      name: "openmotion_studio_seek",
      title: "Move the playhead",
      description: STUDIO_SEEK_DESCRIPTION,
      inputSchema: STUDIO_SEEK_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input): Promise<ToolResult<StudioSeekResult>> =>
        runToolBody("openmotion_studio_seek", async () =>
          studioSeek(depsRef.current, readNumberInput(input, "time")),
        ),
    },
    {
      name: "openmotion_studio_frame",
      title: "See the composition",
      description: STUDIO_FRAME_DESCRIPTION,
      inputSchema: STUDIO_FRAME_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input): Promise<ToolResult<StudioFrameResult>> =>
        runToolBody("openmotion_studio_frame", () => studioFrame(depsRef.current, input as StudioFrameInput)),
    },
    {
      name: "openmotion_studio_inspect",
      title: "Inspect one element",
      description: STUDIO_INSPECT_DESCRIPTION +
        " Content changes use openmotion_get_project and openmotion_edit_project. The can flags describe Studio manual editing capabilities.",
      inputSchema: STUDIO_INSPECT_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input): Promise<ToolResult<StudioInspectResult>> =>
        runToolBody("openmotion_studio_inspect", () =>
          studioInspect(depsRef.current, input as StudioInspectInput),
        ),
    },
  ];
}

/**
 * Nothing in the platform validates the input object against `inputSchema`, so
 * a tool receives whatever the agent sent. These read a field without asserting
 * its type; the tools themselves reject what they cannot use.
 */
function readStringInput(input: object, key: string): string {
  const value = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}

function readNumberInput(input: object, key: string): number {
  const value = Reflect.get(input, key);
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * Register Studio's tools with the browser, exactly once per mount.
 *
 * The effect has an EMPTY dependency array on purpose, and the deps live in a
 * ref that every render refreshes. The obvious alternative — depend on the
 * handlers — re-runs on nearly every interaction, because the DomEdit actions
 * object changes identity whenever the selection or the element list does.
 * Re-running means the registration signal aborts and unregisters everything,
 * `toolchange` fires constantly so a connected agent watches the tool list
 * churn, and the spec warns that a quick unregister-then-reregister can apply
 * an old call's arguments against the new schema.
 *
 * `useStudioTestHooks` carries a comment about the same class of bug already hit
 * in this codebase, where effect teardown revoked a lease moments after it was
 * taken because writing state changed the effect's dependency identities.
 *
 * Any fallback must be awaited inside this effect before registration and then
 * re-read here. Installing one from a sibling effect would race this mount-only
 * lookup. Hot-module replacement can still create a brief unregister/register
 * window in development; production has one document-scoped registration.
 */
export function useStudioAgentTools(deps: StudioAgentToolsDeps): void {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (readStudioUiPreferences().agentToolsEnabled === false) {
      log("skipped", { why: "disabled by preference" });
      return;
    }

    const controller = new AbortController();

    void (async () => {
      const native: ModelContext | null = getModelContext();
      if (native) trackEvent("webmcp.native_present");
      // Native browsers never download the polyfill.
      const modelContext = native ?? (await loadModelContextPolyfill());
      if (!modelContext) {
        log("skipped", { why: "no model context, native or polyfilled" });
        return;
      }
      // The import is async, so the component may already be gone.
      if (controller.signal.aborted) return;

      const report = await registerStudioTools(
        modelContext,
        buildStudioTools(depsRef),
        controller.signal,
      );
      reportRegistration(report, native !== null);
    })();

    return () => controller.abort();
  }, []);
}
