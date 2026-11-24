// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountRenderQueue } from "./renderQueueTestHarness";

vi.mock("./useFfmpegStatus", () => ({
  useFfmpegStatus: () => ({ status: { ok: true }, checking: false, recheck: vi.fn() }),
  ffmpegInstallMessage: () => "FFmpeg is unavailable",
}));
vi.mock("../../telemetry/events", () => ({ trackStudioRenderStart: vi.fn() }));
vi.mock("../feedback/feedbackTrigger", () => ({ requestStudioFeedback: vi.fn() }));
vi.mock("../../telemetry/ioRecovery", () => ({ beginStudioIo: vi.fn(() => vi.fn()) }));

const { useRenderQueue } = await import("./useRenderQueue");
const { requestStudioFeedback } = await import("../feedback/feedbackTrigger");
const { beginStudioIo } = await import("../../telemetry/ioRecovery");
type ServerJob = { id: string; nativeJobId: string; filename: string; status: string; progress: number; createdAt: number; requestId?: string; workerActive?: boolean };

class ProgressStream {
  static instances: ProgressStream[] = [];
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: { data: string }) => void>();
  closed = false;
  constructor(readonly url: string) { ProgressStream.instances.push(this); }
  addEventListener(type: string, listener: (event: { data: string }) => void) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
  progress(value: object) { this.listeners.get("progress")?.({ data: JSON.stringify(value) }); }
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
let queue: ReturnType<typeof mountRenderQueue> | null = null;
let history: ServerJob[];
let cancelResponse: Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  history = [];
  ProgressStream.instances = [];
  cancelResponse = Promise.resolve(json({ status: "cancelling" }));
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal("EventSource", ProgressStream);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const pathname = new URL(url, "http://localhost").pathname;
    if (pathname.endsWith("/renders")) return json({ renders: history });
    if (pathname.endsWith("/cancel")) return cancelResponse;
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      history = [{ id: "native-1", nativeJobId: "native-1", filename: "Same title.mp4", createdAt: 100, status: "rendering", progress: 10, requestId: body.requestId }];
      return json({ jobId: "native-1", filename: "Same title.mp4", createdAt: 100 });
    }
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  queue?.unmount();
  queue = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function start() {
  queue = mountRenderQueue(useRenderQueue);
  await act(async () => { await queue!.api().startRender({}); });
  return queue;
}

describe("export attempt recovery", () => {
  it("keeps the accepted native attempt ID instead of using its output filename", async () => {
    const mounted = await start();
    expect(mounted.api().jobs[0]).toMatchObject({ id: "native-1", nativeJobId: "native-1", filename: "Same title.mp4" });
  });

  it("keeps a disconnected task unknown, then finds its completed result without exporting again", async () => {
    const mounted = await start();
    act(() => { ProgressStream.instances.at(-1)!.onerror?.(); });
    expect(mounted.api().jobs[0].status).toBe("unknown");
    expect(requestStudioFeedback).not.toHaveBeenCalledWith(expect.objectContaining({ reason: "render_failed" }));
    history[0] = { ...history[0], status: "complete", progress: 100 };
    await act(async () => { await mounted.api().reloadRenders(); });
    expect(mounted.api().jobs).toHaveLength(1);
    expect(mounted.api().jobs[0]).toMatchObject({ id: "native-1", status: "complete" });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it.each(["truncated receipt", "server error", "missing identity"])("retains an accepted request after %s", async mode => {
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const response = await real(url, init);
      if (init?.method !== "POST") return response;
      history[0] = { ...history[0], status: "complete", progress: 100 };
      return mode === "server error" ? json({ error: "Persistence failed" }, 500)
        : mode === "missing identity" ? json({}) : new Response('{"jobId":');
    });
    const mounted = await start();
    expect(mounted.api().jobs[0]).toMatchObject({ status: "unknown", requestId: expect.any(String) });
    await act(async () => { await mounted.api().reloadRenders(); });
    expect(mounted.api().jobs).toHaveLength(1);
    expect(mounted.api().jobs[0]).toMatchObject({ id: "native-1", status: "complete" });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("merges a late acceptance receipt into history without duplicating or reverting a completed task", async () => {
    let acknowledge!: (response: Response) => void;
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const response = await real(url, init);
      if (init?.method !== "POST") return response;
      history[0] = { ...history[0], status: "complete", progress: 100 };
      return new Promise<Response>(resolve => { acknowledge = resolve; });
    });
    queue = mountRenderQueue(useRenderQueue);
    let pending!: Promise<string | void>;
    await act(async () => { pending = queue!.api().startRender({}); });
    await act(async () => { await queue!.api().reloadRenders(); });
    await act(async () => { acknowledge(json({ jobId: "native-1", filename: "Same title.mp4" })); await pending; });
    expect(queue.api().jobs).toHaveLength(1);
    expect(queue.api().jobs[0]).toMatchObject({ id: "native-1", status: "complete" });
  });

  it("restores cancelled and running attempts after remount, even when their filenames match", async () => {
    history = [
      { id: "old", nativeJobId: "old", filename: "Same title.mp4", createdAt: 1, status: "cancelled", progress: 9 },
      { id: "new", nativeJobId: "new", filename: "Same title.mp4", createdAt: 2, status: "rendering", progress: 30 },
    ];
    queue = mountRenderQueue(useRenderQueue);
    await act(async () => {});
    expect(queue.api().jobs.map(job => [job.id, job.status])).toEqual([["old", "cancelled"], ["new", "rendering"]]);
    expect(queue.api().isRendering).toBe(true);
    expect(ProgressStream.instances.some(stream => stream.url.includes("new"))).toBe(true);
  });

  it("preserves write protection after a disconnected stream until the service confirms no worker", async () => {
    const mounted = await start();
    act(() => { ProgressStream.instances.at(-1)!.onerror?.(); });
    expect(mounted.api().isRendering).toBe(true);
    await act(async () => { await mounted.api().startRender({}); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    history[0] = { ...history[0], status: "unknown", workerActive: false };
    await act(async () => { await mounted.api().recheckRender("native-1"); });
    expect(mounted.api().isRendering).toBe(false);
    expect(mounted.api().jobs[0].status).toBe("unknown");
    fetchMock.mockResolvedValueOnce(json({ renders: history })).mockResolvedValueOnce(json({ jobId: "native-2", filename: "Another.mp4" }));
    await act(async () => { await mounted.api().startRender({}); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(mounted.api().jobs).toHaveLength(2);
    expect(mounted.api().jobs.find(job => job.id === "native-1")?.status).toBe("unknown");
  });

  it("rechecks an inactive unknown and refuses a separate export if the original worker is now active", async () => {
    history = [{ id: "old", nativeJobId: "old", filename: "old.mp4", createdAt: 1, status: "unknown", progress: 10, workerActive: false }];
    queue = mountRenderQueue(useRenderQueue); await act(async () => {});
    expect(queue.api().isRendering).toBe(false);
    history[0] = { ...history[0], status: "rendering", workerActive: true };
    await act(async () => { await queue!.api().startRender({}); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(queue.api().isRendering).toBe(true);
  });

  it("does not submit a separate export when the original task cannot be checked", async () => {
    history = [{ id: "old", nativeJobId: "old", filename: "old.mp4", createdAt: 1, status: "unknown", progress: 10, workerActive: false }];
    queue = mountRenderQueue(useRenderQueue); await act(async () => {});
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await act(async () => { await queue!.api().startRender({}); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(queue.api().jobs[0].status).toBe("unknown");
  });

  it("provides reload guidance only after a client-only receipt cannot be found", async () => {
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === "POST" ? Promise.reject(new TypeError("lost")) : real(url, init));
    const mounted = await start();
    expect(mounted.api().jobs[0].requestNotFound).toBeUndefined();
    await act(async () => { await mounted.api().recheckRender(mounted.api().jobs[0].id); });
    expect(mounted.api().jobs[0]).toMatchObject({ status: "unknown", requestNotFound: true });
    expect(mounted.api().isRendering).toBe(true);
  });

  it("shows cancelling until the renderer confirms a terminal state", async () => {
    const mounted = await start();
    let finish!: (response: Response) => void;
    cancelResponse = new Promise(resolve => { finish = resolve; });
    let cancel!: Promise<void>;
    await act(async () => { cancel = mounted.api().cancelRender("native-1"); });
    expect(mounted.api().jobs[0].status).toBe("cancelling");
    await act(async () => { finish(json({ status: "cancelling" })); await cancel; });
    act(() => { ProgressStream.instances.at(-1)!.progress({ status: "cancelled", progress: 10 }); });
    expect(mounted.api().jobs[0].status).toBe("cancelled");
  });

  it("does not let a late cancel acknowledgement undo a completed result", async () => {
    const mounted = await start();
    let finish!: (response: Response) => void;
    cancelResponse = new Promise(resolve => { finish = resolve; });
    let cancel!: Promise<void>;
    await act(async () => { cancel = mounted.api().cancelRender("native-1"); });
    act(() => { ProgressStream.instances.at(-1)!.progress({ status: "complete", progress: 100 }); });
    await act(async () => { finish(json({ status: "cancelling" })); await cancel; });
    expect(mounted.api().jobs[0].status).toBe("complete");
  });

  it("recovers a lost response by request identity without resubmitting", async () => {
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await real(url, init);
        history[0] = { ...history[0], status: "complete", progress: 100 };
        throw new TypeError("Response lost");
      }
      return real(url, init);
    });
    const mounted = await start();
    expect(mounted.api().jobs[0].status).toBe("unknown");
    await act(async () => { await mounted.api().reloadRenders(); });
    expect(mounted.api().jobs).toHaveLength(1);
    expect(mounted.api().jobs[0]).toMatchObject({ id: "native-1", status: "complete" });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("counts only manual rechecks and treats a known failed task as a successful lookup", async () => {
    const mounted = await start();
    expect(beginStudioIo).not.toHaveBeenCalled();
    history[0] = { ...history[0], status: "failed" };
    await act(async () => { await mounted.api().recheckRender("native-1"); });
    expect(beginStudioIo).toHaveBeenCalledExactlyOnceWith("recheck_render");
    expect(vi.mocked(beginStudioIo).mock.results[0].value).toHaveBeenCalledWith({ outcome: "success", state_after: "failed" });
  });

  it("accepts rapid repeat clicks only once", async () => {
    queue = mountRenderQueue(useRenderQueue);
    await act(async () => { await Promise.all([queue!.api().startRender({}), queue!.api().startRender({})]); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(queue.api().jobs).toHaveLength(1);
  });
});
