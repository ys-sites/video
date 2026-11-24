// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeStudioDebugLogger } from "./studioDebug";

describe("makeStudioDebugLogger", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it.each(["commit", "reload"])("does no console work while %s is disabled", (channel) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const buildDetails = vi.fn(() => ({ expensive: true }));

    makeStudioDebugLogger(channel)("persisted", buildDetails);

    expect(buildDetails).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs only after its exact channel is enabled", () => {
    localStorage.setItem("hf-commit-debug", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    makeStudioDebugLogger("commit")("persisted", { mutations: 2 });

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('[hf-commit] {"stage":"persisted"');
    expect(log.mock.calls[0]?.[0]).toContain('"mutations":2');
  });
});
