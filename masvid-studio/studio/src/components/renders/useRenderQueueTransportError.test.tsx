// @vitest-environment happy-dom

// Losing the request response does not prove whether the server accepted it.
// Preserve its diagnostic cause and request identity without declaring failure
// or recommending a second render before the original result is checked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountRenderQueue } from "./renderQueueTestHarness";

vi.mock("./useFfmpegStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useFfmpegStatus")>()),
  useFfmpegStatus: () => ({ status: { ok: true }, checking: false, recheck: vi.fn() }),
}));
vi.mock("../../telemetry/events", () => ({ trackStudioRenderStart: vi.fn() }));

const { useRenderQueue } = await import("./useRenderQueue");

let queue: ReturnType<typeof mountRenderQueue> | null = null;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
  );
});

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useRenderQueue transport failure", () => {
  it("keeps an unconfirmed request unknown and preserves its diagnostic cause", async () => {
    queue = mountRenderQueue(useRenderQueue);
    const { act } = await import("react");
    await act(async () => {
      await queue?.api().startRender({});
    });

    const job = queue.api().jobs.at(-1);
    expect(job?.status).toBe("unknown");
    expect(job?.error).toContain("Failed to fetch");
    expect(job?.requestId).toEqual(expect.any(String));
    expect(job?.error).toContain("Check the original export");
    expect(job?.nativeJobId).toBeUndefined();
  });
});
