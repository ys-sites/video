// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { openComposition } from "@hyperframes/sdk";
import { sdkDeletePersist } from "./sdkCutover";
import { SCRIPT_DEPENDENCY_DELETE_MESSAGE } from "./deleteScriptDependencies";

vi.mock("../components/editor/manualEditingAvailability", () => ({
  STUDIO_SDK_CUTOVER_ENABLED: true,
  STUDIO_SDK_RESOLVER_SHADOW_ENABLED: false,
}));
vi.mock("./studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

it.each([false, true])("checks script dependencies in the latest SDK candidate (source changed: %s)", async (changed) => {
  const markup = '<html><body><div data-hf-id="hf-stage" data-hf-root><div data-hf-id="hf-box" id="box"></div></div></body></html>';
  const source = markup.replace('</body>', '<script>const box = document.getElementById("box"); box.style.color = "red";</script></body>');
  const original = changed ? markup : source;
  const live = await openComposition(original, { history: false });
  const before = live.serialize();
  const deps = {
    readProjectFile: vi.fn().mockResolvedValue(source),
    writeProjectFile: vi.fn(),
    editHistory: { recordEdit: vi.fn() },
    publishSession: vi.fn(),
    reloadPreview: vi.fn(),
  };
  try {
    const result = await sdkDeletePersist("hf-box", original, "index.html", live, deps);
    expect(result).toMatchObject({ status: "failed", error: new Error(SCRIPT_DEPENDENCY_DELETE_MESSAGE) });
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
    expect(deps.editHistory.recordEdit).not.toHaveBeenCalled();
    expect(deps.publishSession).not.toHaveBeenCalled();
    expect(deps.reloadPreview).not.toHaveBeenCalled();
    expect(live.serialize()).toBe(before);
  } finally { live.dispose(); }
});

it.each([
  ["hf-box", "box"],
  ["hf-host/hf-box", "nested-box"],
])("preserves the SDK's actual target when its handle is ambiguous or scoped: %s", async (hfId, domId) => {
  const source = `<html><body><div data-hf-root data-hf-id="hf-stage">
    <div data-hf-id="hf-host" data-composition-file="nested.html"><div data-hf-id="hf-box" id="nested-box"></div></div>
    <div data-hf-id="hf-box" id="box"></div></div>
    <script>document.getElementById("${domId}").style.color = "red";</script></body></html>`;
  const live = await openComposition(source, { history: false });
  const before = live.serialize();
  const deps = {
    readProjectFile: vi.fn().mockResolvedValue(source),
    writeProjectFile: vi.fn(),
    editHistory: { recordEdit: vi.fn() },
    publishSession: vi.fn(),
    reloadPreview: vi.fn(),
  };
  try {
    expect(live.getElement(hfId)?.attributes.id).toBe(domId);
    const result = await sdkDeletePersist(hfId, source, "index.html", live, deps);
    expect(result).toMatchObject({ status: "failed", error: new Error(SCRIPT_DEPENDENCY_DELETE_MESSAGE) });
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
    expect(deps.editHistory.recordEdit).not.toHaveBeenCalled();
    expect(deps.publishSession).not.toHaveBeenCalled();
    expect(deps.reloadPreview).not.toHaveBeenCalled();
    expect(live.serialize()).toBe(before);
  } finally { live.dispose(); }
});

it.each([
  { selector: ".item:nth-child(2)", safe: false },
  { selector: ".item + .item", safe: false },
  { selector: ".word", safe: true },
])("persists only safe receiver-aware deletes: $selector", async ({ selector, safe }) => {
  const markup = safe
    ? '<div id="keep"><div class="word"></div></div><div id="first" class="word" data-hf-id="hf-first"></div>'
    : '<div id="first" class="item" data-hf-id="hf-first"></div><div class="item"></div>';
  const receiver = safe ? 'document.getElementById("keep")' : "document";
  const source = `<html><body><div data-hf-root data-hf-id="hf-stage">${markup}</div><script>${receiver}.querySelector("${selector}").style.color = "red";</script></body></html>`;
  const live = await openComposition(source, { history: false });
  const before = live.serialize();
  const deps = {
    readProjectFile: vi.fn().mockResolvedValue(source),
    writeProjectFile: vi.fn(),
    editHistory: { recordEdit: vi.fn() },
    publishSession: vi.fn(),
    reloadPreview: vi.fn(),
  };
  try {
    const result = await sdkDeletePersist("hf-first", source, "index.html", live, deps);
    if (safe) {
      expect(result.status).toBe("committed");
      expect(deps.writeProjectFile).toHaveBeenCalledOnce();
      expect(deps.editHistory.recordEdit).toHaveBeenCalledOnce();
      expect(deps.publishSession).toHaveBeenCalledOnce();
      if (result.status === "committed") {
        const after = new DOMParser().parseFromString(result.after, "text/html");
        expect(after.getElementById("first")).toBeNull();
        expect(after.querySelector("#keep .word")).not.toBeNull();
      }
    } else {
      expect(result).toMatchObject({ status: "failed", error: new Error(SCRIPT_DEPENDENCY_DELETE_MESSAGE) });
      expect(deps.writeProjectFile).not.toHaveBeenCalled();
      expect(deps.editHistory.recordEdit).not.toHaveBeenCalled();
      expect(deps.publishSession).not.toHaveBeenCalled();
      expect(deps.reloadPreview).not.toHaveBeenCalled();
      expect(live.serialize()).toBe(before);
    }
  } finally { live.dispose(); }
});
