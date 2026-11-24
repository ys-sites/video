// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetsTab } from "./AssetsTab";

vi.mock("../../i18n/I18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(projectId = "p", manifest = false) {
  const assets = ["assets/picture.svg", ...(manifest ? [".media/manifest.jsonl"] : [])];
  await act(async () => root.render(<AssetsTab projectId={projectId} assets={assets} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

it("does not probe an absent manifest on mount, remount or project switch", async () => {
  await render();
  expect(container.querySelector("[data-assets-list]")?.textContent).toContain("picture.svg");
  await act(async () => root.render(null));
  await render();
  await render("q");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("uses an existing manifest for metadata search and clears it on project switch", async () => {
  fetchMock.mockImplementation(async () => new Response('{"path":"assets/picture.svg","description":"unique metadata"}\n'));
  await render("p", true);
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search assets"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "unique metadata");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector("[data-assets-list]")?.textContent).toContain("picture.svg");
  await render("q");
  expect(container.querySelector("[data-assets-list]")?.textContent).not.toContain("picture.svg");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("loads a manifest added later, without permanently caching an earlier 404", async () => {
  await render("p", true);
  await render("p", false);
  fetchMock.mockImplementation(async () => new Response('{"path":"assets/picture.svg","description":"restored"}\n'));
  await render("p", true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("reports a genuine metadata server failure instead of treating it as missing", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockResolvedValue(new Response("", { status: 500 }));
  await render("p", true);
  expect(warn).toHaveBeenCalledWith("[Studio] Failed to load project asset metadata", expect.any(Error));
  expect(container.querySelector("[data-assets-list]")?.textContent).toContain("picture.svg");
});

it("ignores a slow metadata response after switching projects", async () => {
  let release!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await render("p", true);
  fetchMock.mockImplementation(async () => new Response(""));
  await render("q", true);
  await act(async () => release(new Response('{"path":"assets/picture.svg","description":"old project only"}\n')));
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search assets"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "old project only");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector("[data-assets-list]")?.textContent).not.toContain("picture.svg");
});

it('searches the readable project name while keeping the original media path', async () => {
  const path = 'assets/imported/820c4903-b493-48e8-84b3-7252d365727a.jpg';
  await act(async () => root.render(<AssetsTab projectId="p" assets={[path]} assetNames={{ [path]: 'Dia wallpaper' }} />));
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search assets"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'wallpaper');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelector('[data-assets-list]')?.textContent).toContain('Dia wallpaper');
  expect(container.querySelector('img')?.src).toContain(path);
});
