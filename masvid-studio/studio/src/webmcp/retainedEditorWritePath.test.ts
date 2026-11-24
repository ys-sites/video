// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { studioSetText, type ContentToolDeps } from "./tools/contentTools";
import { studioEditLifecycle } from "./writeCoordinator";
import {
  expectOk,
  previewElement,
  selectionFor,
  sourceHandle,
  targetedWriteDeps,
} from "./webmcpTestUtils";

/**
 * The seven atomic editor write tools are not registered as page tools, but
 * their modules are retained on purpose (see the retention note in
 * `useStudioAgentTools.ts`). This suite keeps that decision honest: the
 * retained functions must still drive the shared write coordinator and still
 * publish the receipt `TopologyLens` renders, so retention is a working path
 * rather than a module nothing can reach.
 *
 * If the retained path is ever deleted, delete this suite with it instead of
 * leaving the modules untested.
 */

afterEach(() => {
  studioEditLifecycle.reset();
  document.body.replaceChildren();
});

function recordPhases(): { phases: string[]; stop: () => void } {
  const phases: string[] = [];
  const stop = studioEditLifecycle.subscribe(() => {
    phases.push(studioEditLifecycle.getSnapshot().phase);
  });
  return { phases, stop };
}

describe("retained editor write path", () => {
  it("publishes a receipt when the retained set-text module writes", async () => {
    const element = previewElement('<h1 id="headline">Ship it</h1>', "headline");
    const { phases, stop } = recordPhases();
    const deps: ContentToolDeps = {
      ...targetedWriteDeps(selectionFor(element)),
      setText: vi.fn(async (target) => {
        target.element.textContent = "Ship it faster";
        return { ok: true } as const;
      }),
      setStyle: async () => ({ ok: true }),
    };

    const result = await studioSetText(deps, {
      handle: sourceHandle("headline"),
      text: "Ship it faster",
    });
    stop();

    expectOk(result);
    // `begin` first binds the project, which publishes the idle reset, then the
    // dispatch and its terminal receipt.
    expect(phases).toEqual(["idle", "dispatching", "dispatched"]);
    expect(studioEditLifecycle.getSnapshot()).toMatchObject({
      phase: "dispatched",
      projectId: "project-a",
      operation: "set-text",
      target: { sourceFile: "index.html" },
      receipt: { ok: true, stage: "dispatched", changed: true },
    });
  });
});
