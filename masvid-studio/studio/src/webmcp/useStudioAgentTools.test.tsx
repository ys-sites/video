// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountReactHarness } from "../hooks/domSelectionTestHarness";
import { writeStudioUiPreferences } from "../utils/studioUiPreferences";
import { useStudioAgentTools, type StudioAgentToolsDeps } from "./useStudioAgentTools";
import type { ModelContext, ModelContextRegisterToolOptions, ModelContextTool } from "./types";
import { lookSnapshot, studioAgentToolsDeps } from "./webmcpTestUtils";

const trackEvent = vi.hoisted(() => vi.fn());
vi.mock("../telemetry/client", () => ({ trackEvent }));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let cleanup: (() => void) | null = null;

/** Install a fake `document.modelContext` and report what got registered. */
function installModelContext() {
  const registered: ModelContextTool[] = [];
  const registerTool = vi.fn(
    async (tool: ModelContextTool, _options?: ModelContextRegisterToolOptions) => {
      registered.push(tool);
    },
  );
  const modelContext: ModelContext = { registerTool };
  Object.defineProperty(document, "modelContext", {
    value: modelContext,
    configurable: true,
    writable: true,
  });
  return { registered, registerTool };
}

async function executeFirstRegistered<T>(registered: ModelContextTool[]): Promise<T> {
  const look = registered[0];
  if (!look) throw new Error("expected openmotion_studio_look to be registered");
  return (await look.execute({}, { signal: new AbortController().signal })) as T;
}

function removeModelContext() {
  Reflect.deleteProperty(document, "modelContext");
}

function mountTools(initial: StudioAgentToolsDeps) {
  function Probe({ current }: { current: StudioAgentToolsDeps }) {
    useStudioAgentTools(current);
    return null;
  }
  const root = mountReactHarness(<Probe current={initial} />);
  cleanup = () => act(() => root.unmount());
  return {
    rerenderWith(next: StudioAgentToolsDeps) {
      act(() => root.render(<Probe current={next} />));
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  trackEvent.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  removeModelContext();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useStudioAgentTools", () => {
  it("registers the tool set once on mount", async () => {
    const { registered } = installModelContext();

    await act(async () => {
      mountTools(studioAgentToolsDeps({ getSnapshot: () => lookSnapshot() }));
    });

    expect(registered.map((tool) => tool.name)).toEqual([
      "openmotion_studio_look",
      "openmotion_studio_select",
      "openmotion_studio_seek",
      "openmotion_studio_frame",
      "openmotion_studio_inspect",
    ]);
    expect(trackEvent).toHaveBeenCalledWith("webmcp.native_present");
  });

  it("does not re-register when the deps object changes identity", async () => {
    // The regression test for the whole design. The DomEdit actions object
    // changes identity on nearly every interaction; if registration depended on
    // it, the signal would abort and unregister the tools each time.
    const { registerTool } = installModelContext();

    let harness: ReturnType<typeof mountTools> | null = null;
    await act(async () => {
      harness = mountTools(studioAgentToolsDeps({ getSnapshot: () => lookSnapshot() }));
    });
    expect(registerTool).toHaveBeenCalledTimes(5);

    await act(async () => {
      harness?.rerenderWith(
        studioAgentToolsDeps({ getSnapshot: () => lookSnapshot({ currentTime: 5 }) }),
      );
      harness?.rerenderWith(
        studioAgentToolsDeps({ getSnapshot: () => lookSnapshot({ currentTime: 6 }) }),
      );
    });

    expect(registerTool).toHaveBeenCalledTimes(5);
  });

  it("executes against the LATEST deps, not the ones present at registration", async () => {
    // The other half of the ref: registering once must not freeze the state the
    // tools read, or every answer after the first render would be stale.
    const { registered } = installModelContext();

    let harness: ReturnType<typeof mountTools> | null = null;
    await act(async () => {
      harness = mountTools(
        studioAgentToolsDeps({ getSnapshot: () => lookSnapshot({ currentTime: 1 }) }),
      );
    });

    await act(async () => {
      harness?.rerenderWith(
        studioAgentToolsDeps({ getSnapshot: () => lookSnapshot({ currentTime: 42 }) }),
      );
    });

    const result = await executeFirstRegistered<{
      ok: boolean;
      playhead: number;
    }>(registered);

    expect(result.ok).toBe(true);
    expect(result.playhead).toBe(42);
  });

  it("unregisters on unmount by aborting the registration signal", async () => {
    const { registerTool } = installModelContext();

    await act(async () => {
      mountTools(studioAgentToolsDeps({ getSnapshot: () => lookSnapshot() }));
    });
    const signal = registerTool.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    cleanup?.();
    cleanup = null;

    expect(signal?.aborted).toBe(true);
  });

  it("boots cleanly when the browser has no native WebMCP", async () => {
    removeModelContext();

    await act(async () => {
      mountTools(studioAgentToolsDeps({ getSnapshot: () => lookSnapshot() }));
    });

    // The assertion is that mounting did not throw; a browser without the
    // native API must still boot Studio. The polyfill may install
    // document.modelContext as a fallback — that is expected.
  });

  it("registers nothing when the preference is turned off", async () => {
    writeStudioUiPreferences({ agentToolsEnabled: false });
    const { registerTool } = installModelContext();

    await act(async () => {
      mountTools(studioAgentToolsDeps({ getSnapshot: () => lookSnapshot() }));
    });

    expect(registerTool).not.toHaveBeenCalled();
  });

  it("registers when the preference is absent, because on is the default", async () => {
    const { registerTool } = installModelContext();

    await act(async () => {
      mountTools(studioAgentToolsDeps({ getSnapshot: () => lookSnapshot() }));
    });

    expect(registerTool).toHaveBeenCalledTimes(5);
  });

  it("reports a non-abort registration failure through production telemetry", async () => {
    const { registerTool } = installModelContext();
    registerTool.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));

    await act(async () => {
      mountTools(studioAgentToolsDeps({ getSnapshot: () => lookSnapshot() }));
    });

    expect(trackEvent).toHaveBeenCalledWith("webmcp_registration_failed", {
      error_name: "NotAllowedError",
      tool_name: "openmotion_studio_look",
    });
  });

  it("reports a tool that throws as an internal failure instead of rejecting", async () => {
    const { registered } = installModelContext();

    await act(async () => {
      mountTools(
        studioAgentToolsDeps({
          getSnapshot: () => {
            throw new TypeError("handler signature moved");
          },
        }),
      );
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await executeFirstRegistered<{
      ok: boolean;
      kind: string;
    }>(registered);

    expect(result.ok).toBe(false);
    expect(result.kind).toBe("internal");
  });

  it("keeps content-writing tools unavailable for discovery and invocation", async () => {
    const { registered } = installModelContext();
    const setText = vi.fn();
    const setStyle = vi.fn();
    await act(async () => mountTools(studioAgentToolsDeps({ setText, setStyle })));
    for (const action of ["set_text", "set_style", "transform", "add_animation", "update_animation", "add_keyframe", "delete_animation"]) {
      expect(registered.find(tool => tool.name === `openmotion_studio_${action}`)).toBeUndefined();
    }
    expect(setText).not.toHaveBeenCalled();
    expect(setStyle).not.toHaveBeenCalled();
  });
});
