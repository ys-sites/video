// @vitest-environment jsdom
/** Exercise the shipped fallback registry and its native mirror with the reduced tool surface. */
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountReactHarness } from "../hooks/domSelectionTestHarness";
import { useStudioAgentTools, type StudioAgentToolsDeps } from "./useStudioAgentTools";
import { studioAgentToolsDeps } from "./webmcpTestUtils";

vi.mock("../telemetry/client", () => ({ trackEvent: vi.fn() }));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** What a browser's own `registerTool` receives from the bridge. */
interface MirroredTool {
  name: string;
  description: string;
  execute: (input: object, options?: { signal?: AbortSignal }) => Promise<unknown>;
}

/** What `getTools()` returns and `executeTool()` accepts. */
interface RegisteredTool {
  name: string;
  description: string;
  window: Window;
  origin: string;
}

/** The bridge's registry entry, as the reporter of the bug drove it. */
interface BridgeToolEntry {
  item: { name: string };
  execute: (input: object, signal?: AbortSignal) => Promise<unknown>;
}

interface BridgeModelContext {
  tools: Map<string, BridgeToolEntry>;
  getTools(): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    inputArguments: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}

const mirrored: MirroredTool[] = [];
/** Enough of a browser's `modelContext` for the bridge to wrap and mirror into. */
const fakeNative = {
  registerTool: async (tool: MirroredTool): Promise<void> => {
    mirrored.push(tool);
  },
  // The bridge delegates `getTools()` to the native context when there is one,
  // and its own `executeTool` then insists on a full `RegisteredTool`.
  getTools: async (): Promise<RegisteredTool[]> =>
    mirrored.map((tool) => ({
      name: tool.name,
      description: tool.description,
      window,
      origin: window.location.origin,
    })),
};

let cleanup: (() => void) | null = null;

beforeAll(async () => {
  // Configurable, so the bridge is allowed to replace it with itself.
  Object.defineProperty(document, "modelContext", {
    value: fakeNative,
    configurable: true,
    writable: true,
  });
  await import("@mcp-b/global");
  expect(Reflect.get(document, "modelContext")).not.toBe(fakeNative);
});

afterEach(async () => {
  cleanup?.();
  cleanup = null;
  mirrored.length = 0;
  // The polyfill watches the document with a MutationObserver that reads jsdom
  // globals. Empty the document and let the observer settle now, while those
  // globals still exist, instead of when vitest closes the window.
  document.body.replaceChildren();
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.localStorage.clear();
});

function bridge(): BridgeModelContext {
  // Through `unknown`: importing the package brings its own `Document.modelContext`
  // typing into scope, and this file reads the bridge's non-standard surface.
  return Reflect.get(document, "modelContext") as unknown as BridgeModelContext;
}

/** Registration is async, so wait for the whole tool set to land. */
async function waitForTools(count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (bridge().tools.size !== count || mirrored.length !== count) {
    if (Date.now() > deadline) {
      throw new Error(
        `expected ${count} tools, saw ${bridge().tools.size} in the bridge and ${mirrored.length} mirrored`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function bridgeEntry(name: string): BridgeToolEntry {
  const entry = [...bridge().tools.values()].find((candidate) => candidate.item.name === name);
  if (!entry) throw new Error(`expected ${name} in the bridge registry`);
  return entry;
}

function mirroredTool(name: string): MirroredTool {
  const tool = mirrored.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`expected ${name} to be mirrored into the native context`);
  return tool;
}

async function mountNavigationTools() {
  let time = 0;
  const requestSeek = vi.fn((next: number) => { time = next; });
  const deps: StudioAgentToolsDeps = studioAgentToolsDeps({
    requestSeek,
    readPlayhead: () => ({ currentTime: time, duration: 10, isPlaying: false }),
  });
  function Probe() {
    useStudioAgentTools(deps);
    return null;
  }
  await act(async () => {
    const root = mountReactHarness(<Probe />);
    cleanup = () => act(() => root.unmount());
  });
  await waitForTools(5);
  return { requestSeek };
}

describe("useStudioAgentTools through @mcp-b/global", () => {
  it("exposes only observation/navigation tools through both registries", async () => {
    const { requestSeek } = await mountNavigationTools();
    const names = ["openmotion_studio_look", "openmotion_studio_select", "openmotion_studio_seek", "openmotion_studio_frame", "openmotion_studio_inspect"].sort();
    expect((await bridge().getTools()).map(tool => tool.name).sort()).toEqual(names);
    expect(mirrored.map(tool => tool.name).sort()).toEqual(names);

    const viaEntry = await bridgeEntry("openmotion_studio_seek").execute({ time: 0.9 });
    expect(viaEntry).toMatchObject({ ok: true, playhead: 0.9 });
    const descriptor = (await bridge().getTools()).find(tool => tool.name === "openmotion_studio_seek")!;
    const viaExecuteTool = await bridge().executeTool(descriptor, JSON.stringify({ time: 1.2 }));
    expect(JSON.parse(viaExecuteTool ?? "null")).toMatchObject({ ok: true, playhead: 1.2 });
    expect(requestSeek).toHaveBeenCalledTimes(2);
  });

  it("seeks through the descriptor mirrored into a native modelContext", async () => {
    const { requestSeek } = await mountNavigationTools();
    const result = await mirroredTool("openmotion_studio_seek").execute(
      { time: 0.9 }, { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({ ok: true, playhead: 0.9 });
    expect(requestSeek).toHaveBeenCalledWith(0.9);
  });
});
