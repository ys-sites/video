// @vitest-environment happy-dom

import React, { act, type ComponentProps } from "react";
import type { DockviewApi } from "dockview-react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dockLayout from "./dockLayout";
import { I18nProvider, useI18n } from "../../i18n/I18n";
import { Dock } from "./Dock";
import { StudioHostContext } from "../../motion/StudioHost";
import { parseDockLayout } from "./dockLayoutSchema";
import { useDockLayoutStore } from "./dockLayoutStore";
import { MVP_PANEL_IDS, PANEL_IDS } from "./panelRegistry";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";
import { applyMotionLayout, MotionPreviewButton } from "../../motion/MotionLayoutControls";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let dockApi: DockviewApi | null = null;
vi.mock("dockview-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dockview-react")>();
  return {
    ...actual,
    DockviewReact: (props: ComponentProps<typeof actual.DockviewReact>) =>
      React.createElement(actual.DockviewReact, {
        ...props,
        onReady: (event) => {
          dockApi = event.api;
          props.onReady(event);
        },
      }),
  };
});

const liveObservers = new Set<{ callback: () => void; target?: Element }>();
class ResizeObserverStub {
  private readonly entry: { callback: () => void; target?: Element };
  constructor(callback: () => void) {
    this.entry = { callback };
  }
  observe(target: Element) {
    this.entry.target = target;
    liveObservers.add(this.entry);
  }
  unobserve() {}
  disconnect() {
    liveObservers.delete(this.entry);
  }
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

vi.mock("./dockLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dockLayout")>();
  return {
    ...actual,
    applySideMinimums: vi.fn(actual.applySideMinimums),
    addRegisteredPanel: vi.fn(actual.addRegisteredPanel),
  };
});
const applySideMinimums = vi.mocked(dockLayout.applySideMinimums);
const addRegisteredPanel = vi.mocked(dockLayout.addRegisteredPanel);

let root: Root | null = null;

function mount(
  projectId: string | null,
  titles: Partial<Record<(typeof PANEL_IDS)[number], string>> = {},
  options: Omit<ComponentProps<typeof Dock.Root>, "projectId" | "children"> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <Dock.Root projectId={projectId} {...options}>
        <Dock.WindowMenu />
        <MotionPreviewButton />
        {(options.panels ?? PANEL_IDS).map((id) => (
          <Dock.Panel key={id} id={id} title={titles[id]}>
            <div data-testid={`content-${id}`}>{id}</div>
          </Dock.Panel>
        ))}
      </Dock.Root>,
    );
  });
  return host;
}

/** The persisted views of the group holding `id`, after the debounced write lands. */
function persistedGroupOf(id: string): string | undefined {
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  const grid = JSON.stringify(readStudioUiPreferences(undefined, "p1").dockLayout?.grid);
  const groups = [...grid.matchAll(/"views":\[([^\]]*)\]/g)].map((m) => m[1]);
  return groups.find((views) => views.includes(`"${id}"`));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

// The default Edit layout tabs [compositions|assets|transcript|captions|code|catalog] into one
// group and [design|layers|renders|variables] into another; dockview shows
// only the active tab's content per group. `slideshow` is never part of the
// default build — StudioRightPanels opens it itself when the file is one.
const DEFAULT_OPEN = PANEL_IDS.filter((id) => id !== "slideshow" && id !== "history");
const DEFAULT_VISIBLE = ["preview", "timeline", "compositions", "design"];

describe("Dock on React 19", () => {
  it("mounts the default layout's panels, retaining capture state while hidden", () => {
    const host = mount("p1");
    for (const id of DEFAULT_VISIBLE) {
      expect(host.querySelector(`[data-testid="content-${id}"]`)).not.toBeNull();
    }
    for (const id of DEFAULT_OPEN.filter((id) => !DEFAULT_VISIBLE.includes(id) && id !== "transcript" && id !== "captions" && id !== "comments")) {
      expect(host.querySelector(`[data-testid="content-${id}"]`)).toBeNull();
    }
    expect(host.querySelector('[data-testid="content-transcript"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="content-comments"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="content-slideshow"]')).toBeNull();
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(DEFAULT_OPEN));
  });

  it("keeps the preview header controls mounted when the timeline becomes active", async () => {
    const host = mount("p1");
    const { activatePanel } = useDockLayoutStore.getState();
    await act(async () => activatePanel("preview"));
    const previewHeader = host.querySelector('[data-panel-header-controls="preview"]');
    expect(previewHeader).not.toBeNull();

    await act(async () => activatePanel("timeline"));
    expect(dockApi?.activePanel?.id).toBe("timeline");
    expect(host.querySelector('[data-panel-header-controls="preview"]')).toBe(previewHeader);
    expect(previewHeader?.closest(".hf-dock-strip-actions")).toBeNull();
  });

  it("persists a layout change per project and reads it back through the schema", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const stored = readStudioUiPreferences(undefined, "p1").dockLayout;
    const expected = DEFAULT_OPEN.filter((id) => id !== "renders");
    expect(Object.keys(stored?.panels ?? {}).sort()).toEqual([...expected].sort());
    expect(readStudioUiPreferences(undefined, "p2").dockLayout).toBeUndefined();
  });

  it("closes a panel and reopens it from the store, becoming its group's visible tab", async () => {
    const host = mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    expect(useDockLayoutStore.getState().openPanels.has("renders")).toBe(false);
    expect(host.querySelector('[data-testid="content-renders"]')).toBeNull();
    // dockview's own panel-active event dispatch resolves on a microtask, one
    // tick after the synchronous store call returns; `act(async ...)` is what
    // actually waits for it instead of asserting against pre-flush DOM.
    await act(async () => {
      useDockLayoutStore.getState().togglePanel("renders");
      await Promise.resolve();
    });
    expect(useDockLayoutStore.getState().openPanels.has("renders")).toBe(true);
    expect(host.querySelector('[data-testid="content-renders"]')).not.toBeNull();
  });

  it("keeps a panel's custom title when it is closed and reopened", async () => {
    const host = mount("p1", { renders: "Renders (2)" });
    expect(host.textContent).toContain("Renders (2)");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    await act(async () => {
      useDockLayoutStore.getState().togglePanel("renders");
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Renders (2)");
  });

  it("reopens a closed panel as a tab of its zone's group, not a new group", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("compositions"));
    act(() => useDockLayoutStore.getState().togglePanel("compositions"));
    expect(persistedGroupOf("compositions")).toContain('"assets"');
  });

  it("reopens a side panel next to the preview when its whole column was closed", () => {
    mount("p1");
    const { closePanel, togglePanel } = useDockLayoutStore.getState();
    for (const id of ["compositions", "assets", "transcript", "captions", "code", "catalog"] as const)
      act(() => closePanel(id));
    act(() => togglePanel("compositions"));
    expect(useDockLayoutStore.getState().openPanels.has("compositions")).toBe(true);
    expect(useDockLayoutStore.getState().visiblePanels.has("compositions")).toBe(true);
  });

  it("reopens a side panel beside preview when its usual tab neighbour is closed", () => {
    mount("p1");
    const { closePanel, togglePanel } = useDockLayoutStore.getState();
    for (const id of ["compositions", "assets", "transcript", "captions", "code", "catalog"] as const)
      act(() => closePanel(id));
    addRegisteredPanel.mockClear();
    act(() => togglePanel("assets"));
    expect(addRegisteredPanel).toHaveBeenCalledWith(expect.anything(), "assets", { referencePanel: "preview", direction: "left" });
    expect(dockApi!.getPanel("assets")!.group).not.toBe(dockApi!.getPanel("preview")!.group);
  });

  it("reopens the timeline as its own group, never as a tab of the preview", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("timeline"));
    act(() => useDockLayoutStore.getState().togglePanel("timeline"));
    expect(persistedGroupOf("timeline")).not.toContain('"preview"');
  });

  it("reopens preview between the side columns and keeps the timeline below", () => {
    mount("p1");
    function hierarchy(node: ReturnType<DockviewApi["toJSON"]>["grid"]["root"]): unknown {
      return node.type === "leaf" ? node.data.views : node.data.map(hierarchy);
    }
    const before = hierarchy(dockApi!.toJSON().grid.root);
    act(() => useDockLayoutStore.getState().closePanel("preview"));
    act(() => useDockLayoutStore.getState().activatePanel("preview"));
    expect(hierarchy(dockApi!.toJSON().grid.root)).toEqual(before);
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
    act(() => dockApi!.getPanel("preview")!.group.api.maximize());
    act(() => useDockLayoutStore.getState().activatePanel("preview"));
    expect(dockApi!.getPanel("preview")!.group.api.isMaximized()).toBe(true);
  });

  it("recovers a preview closed before reload through the permanent header button", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("preview"));
    act(() => vi.advanceTimersByTime(400));
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    const host = mount("p1");
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Open preview"]')!;
    expect(button).not.toBeNull();
    act(() => button.click());
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
    expect(dockApi!.getPanel("preview")!.group).not.toBe(dockApi!.getPanel("timeline")!.group);
    act(() => button.click());
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
  });

  it("restores preview after every panel is closed and can recover a maximized layout", () => {
    const host = mount("p1");
    act(() => { for (const id of [...useDockLayoutStore.getState().openPanels]) useDockLayoutStore.getState().closePanel(id); });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Open preview"]')!.click());
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
    act(() => useDockLayoutStore.getState().activatePanel("design"));
    act(() => dockApi!.getPanel("design")!.group.api.maximize());
    act(() => useDockLayoutStore.getState().activatePanel("preview"));
    expect(dockApi!.getPanel("design")!.group.api.isMaximized()).toBe(false);
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
  });

  it("applies persistent layout presets and restores the full editor", () => {
    mount("p1");
    act(() => applyMotionLayout("preview"));
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(["preview"]));
    expect(persistedGroupOf("preview")).toBe('"preview"');
    act(() => useDockLayoutStore.getState().activatePanel("assets"));
    expect(dockApi!.getPanel("assets")!.group).not.toBe(dockApi!.getPanel("preview")!.group);
    expect(useDockLayoutStore.getState().visiblePanels.has("preview")).toBe(true);
    act(() => applyMotionLayout("code"));
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(["preview", "timeline", "code"]));
    act(() => applyMotionLayout("edit"));
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(DEFAULT_OPEN));
    act(() => useDockLayoutStore.getState().activatePanel("history"));
    expect(persistedGroupOf("history")).toContain('"design"');
  });

  it("restores the stored layout on the next mount instead of rebuilding the default", () => {
    mount("p1");
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";

    mount("p1");
    expect(useDockLayoutStore.getState().openPanels.has("renders")).toBe(false);
  });

  it("falls back to the default layout when the stored one names an unknown panel", () => {
    localStorage.setItem(
      "hf-studio-ui-preferences:p1",
      JSON.stringify({ dockLayout: { grid: {}, panels: { nope: {} } } }),
    );
    const host = mount("p1");
    expect(host.querySelector('[data-testid="content-preview"]')).not.toBeNull();
  });
});

describe("Dock wiring", () => {
  it("re-applies the side minimums when a panel is dragged to another group", () => {
    mount(null);
    applySideMinimums.mockClear();
    const preview = dockApi?.getPanel("preview");
    const design = dockApi?.getPanel("design");
    if (!preview || !design) throw new Error("default layout is missing panels");
    act(() => design.api.moveTo({ group: preview.group }));
    expect(applySideMinimums).toHaveBeenCalled();
  });

  it("makes the sashes keyboard-focusable separators", () => {
    const host = mount(null);
    const sashes = host.querySelectorAll<HTMLElement>('.dv-sash[role="separator"]');
    expect(sashes.length).toBeGreaterThan(0);
    for (const sash of sashes) expect(sash.tabIndex).toBe(0);
  });

  it("re-fits the side columns to the window width when it resizes", () => {
    mount(null);
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 560, configurable: true });
    try {
      applySideMinimums.mockClear();
      const dockObservers = [...liveObservers].filter(({ target }) =>
        target?.classList.contains("hf-dock"),
      );
      act(() => dockObservers.forEach(({ callback }) => callback()));
      expect(applySideMinimums).toHaveBeenCalledWith(expect.anything(), 560, false);
    } finally {
      Object.defineProperty(window, "innerWidth", { value: innerWidth, configurable: true });
    }
  });
});

// A host app mounts a subset of Studio's panels under its own storage key and width.
describe("a host's dock", () => {
  const panels = ["preview", "timeline", "assets", "renders"] as const;
  const hostDock = { panels, storageKey: "host-dock" };

  it("builds only its panels, a side column each, and its Window menu lists only them", () => {
    const host = mount("p1", {}, hostDock);
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(panels));
    expect(useDockLayoutStore.getState().visiblePanels).toEqual(new Set(panels));
    expect(dockApi?.getPanel("assets")?.group.id).not.toBe(dockApi?.getPanel("renders")?.group.id);
    const menu = [...host.querySelectorAll("button")].find((b) => b.textContent === "Window");
    act(() => menu?.click());
    const items = [...host.querySelectorAll('[role="menuitemcheckbox"]')].map((i) => i.textContent);
    expect(items).toEqual(["Preview", "Timeline", "Assets", "Renders"]);
    expect(host.querySelectorAll('[role="menuitemcheckbox"] [data-remix-icon="check-line"]')).toHaveLength(4);
  });

  it("keeps its layout alone under its own key, never in Studio's preferences", () => {
    mount("p1", {}, hostDock);
    act(() => useDockLayoutStore.getState().closePanel("renders"));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const stored = readStudioUiPreferences(undefined, "p1", "host-dock").dockLayout;
    expect(Object.keys(stored?.panels ?? {}).sort()).toEqual(["assets", "preview", "timeline"]);
    expect(readStudioUiPreferences(undefined, "p1").dockLayout).toBeUndefined();
  });

  it("falls back to its default when a stored layout names a panel it lacks", () => {
    mount("p1");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const studio = readStudioUiPreferences(undefined, "p1").dockLayout;
    act(() => root?.unmount());
    root = null;
    localStorage.setItem("host-dock:p1", JSON.stringify({ dockLayout: studio }));
    mount("p1", {}, hostDock);
    expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(panels));
  });

  it("reopens a panel beside the preview when the panel it reopens near is not in the dock", () => {
    mount("p1", {}, hostDock);
    act(() => useDockLayoutStore.getState().closePanel("assets"));
    act(() => useDockLayoutStore.getState().togglePanel("assets"));
    expect(useDockLayoutStore.getState().visiblePanels.has("assets")).toBe(true);
  });

  it("sizes its sides against its own width, not the window's", () => {
    mount(null, {}, { ...hostDock, dockWidth: () => 700 });
    applySideMinimums.mockClear();
    const dockObservers = [...liveObservers].filter(({ target }) =>
      target?.classList.contains("hf-dock"),
    );
    act(() => dockObservers.forEach(({ callback }) => callback()));
    expect(applySideMinimums).toHaveBeenCalledWith(expect.anything(), 700, false);
  });
});

describe("parseDockLayout", () => {
  it("rejects shapes that are not a dock layout", () => {
    expect(parseDockLayout(null)).toBeNull();
    expect(parseDockLayout({ grid: {}, panels: {} })).toBeNull();
    expect(
      parseDockLayout({
        grid: {
          width: 1,
          height: 1,
          orientation: "HORIZONTAL",
          root: { type: "leaf", data: { views: ["ghost"] } },
        },
        panels: { ghost: { id: "ghost", contentComponent: "panel" } },
      }),
    ).toBeNull();
  });

  const placed = (views: string[], panelIds: string[]) => ({
    grid: {
      width: 1,
      height: 1,
      orientation: "HORIZONTAL",
      root: { type: "leaf", data: { views } },
    },
    panels: Object.fromEntries(panelIds.map((id) => [id, { id, contentComponent: "panel" }])),
  });

  it("rejects a view that has no panel entry and a panel that no view places", () => {
    expect(parseDockLayout(placed(["preview", "design"], ["preview"]))).toBeNull();
    expect(parseDockLayout(placed(["preview"], ["preview", "design"]))).toBeNull();
    expect(parseDockLayout(placed(["preview", "design"], ["preview", "design"]))).not.toBeNull();
  });

  it("merges the retired Text tab into Captions without resetting saved geometry", () => {
    const saved = placed(["assets", "text", "captions"], ["assets", "text", "captions"]);
    Object.assign(saved.grid, { width: 1440, height: 900 });
    Object.assign(saved.grid.root, { size: 480 });
    Object.assign(saved.grid.root.data, { id: "left", activeView: "text" });
    const restored = parseDockLayout(saved)!;
    expect(restored.grid.width).toBe(1440);
    expect(restored.grid.root).toMatchObject({ size: 480, data: { views: ["assets", "captions"], activeView: "captions" } });
    expect(restored.panels).not.toHaveProperty("text");
    expect(saved.grid.root.data.views).toContain("text");
  });

  it("replaces a lone Text tab and removes an obsolete floating duplicate", () => {
    const saved = placed(["text"], ["text"]);
    expect(parseDockLayout(saved)?.grid.root).toMatchObject({ data: { views: ["captions"] } });
    const floating = { ...placed(["captions"], ["captions", "text"]), floatingGroups: [{ data: { id: "old", views: ["text"], activeView: "text" } }] };
    expect(parseDockLayout(floating)?.floatingGroups).toEqual([]);
  });
});

function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return <button data-testid="change-language" onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}>Language</button>;
}

it('changes native dock titles live without recreating panels, preview or layout', () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root?.render(<I18nProvider initialLocale="en"><Dock.Root projectId="p1">
    <LocaleSwitcher />
    {PANEL_IDS.map(id => <Dock.Panel key={id} id={id}>
      {id === 'preview' ? <iframe title="Project preview" srcDoc="<p>Preview</p>" /> : <div>{id}</div>}
    </Dock.Panel>)}
  </Dock.Root></I18nProvider>));
  const preview = host.querySelector('iframe');
  const api = dockApi!;
  const groupId = api.getPanel('preview')!.group.id;
  act(() => api.getPanel('preview')!.api.setSize({ width: 650 }));
  const grid = JSON.stringify(api.toJSON().grid);
  const switchLanguage = () => act(() => host.querySelector<HTMLButtonElement>('[data-testid="change-language"]')!.click());
  expect(api.getPanel('preview')!.title).toBe('Preview');
  switchLanguage();
  expect(api.getPanel('preview')!.title).toBe('预览');
  expect(api.getPanel('compositions')!.title).toBe('片段');
  expect(api.getPanel('preview')!.group.id).toBe(groupId);
  expect(JSON.stringify(api.toJSON().grid)).toBe(grid);
  expect(host.querySelector('iframe')).toBe(preview);
  act(() => useDockLayoutStore.getState().activatePanel('history'));
  expect(api.getPanel('history')!.title).toBe('版本历史');
  switchLanguage();
  expect(api.getPanel('history')!.title).toBe('Version history');
  expect(api.getPanel('preview')!.title).toBe('Preview');
  expect(host.querySelector('iframe')).toBe(preview);
});

it("adds a missing allowed side panel to an existing MVP layout without resetting divider sizes", () => {
  const options = { fixedLayout: true, storageKey: "motion.mvp.dock.v1" };
  mount("p1", {}, { ...options, panels: MVP_PANEL_IDS.filter(id => id !== "layers") });
  act(() => {
    dockApi!.getPanel("compositions")!.api.setSize({ width: 320 });
    vi.advanceTimersByTime(1000);
  });
  const leftWidth = dockApi!.getPanel("compositions")!.group.width;
  const rightWidth = dockApi!.getPanel("design")!.group.width;
  act(() => root?.unmount());
  root = null;

  const host = mount("p1", {}, { ...options, panels: MVP_PANEL_IDS });
  expect(dockApi!.getPanel("layers")?.group.id).toBe(dockApi!.getPanel("design")!.group.id);
  expect(dockApi!.getPanel("compositions")!.group.width).toBe(leftWidth);
  expect(dockApi!.getPanel("design")!.group.width).toBe(rightWidth);
  act(() => useDockLayoutStore.getState().activatePanel("layers"));
  expect(host.querySelector('[data-testid="content-layers"]')).not.toBeNull();
  expect(dockApi!.getPanel("code")).toBeUndefined();
});

it("keeps the MVP panels fixed, rejects hidden panels, and restores divider sizes", () => {
  mount("p1", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, storageKey: "motion.mvp.dock.v1" });
  const store = useDockLayoutStore.getState();
  expect(store.openPanels).toEqual(new Set(MVP_PANEL_IDS));
  act(() => {
    store.closePanel("preview");
    store.closePanel("assets");
    store.activatePanel("code");
    dockApi!.getPanel("compositions")!.api.setSize({ width: 320 });
    vi.advanceTimersByTime(1000);
  });
  expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(MVP_PANEL_IDS));
  expect(dockApi!.getPanel("timeline")!.group.header.hidden).toBe(true);
  expect(dockApi!.getPanel("preview")!.group.header.hidden).toBe(false);
  const saved = dockApi!.toJSON();
  expect(saved.panels.code).toBeUndefined();
  act(() => root?.unmount());
  root = null;
  mount("p1", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, storageKey: "motion.mvp.dock.v1" });
  expect(dockApi!.toJSON().grid).toEqual(saved.grid);
  expect(dockApi!.getPanel("timeline")!.group.header.hidden).toBe(true);
  expect(useDockLayoutStore.getState().openPanels).toEqual(new Set(MVP_PANEL_IDS));
});


it("keeps version history outside the MVP dock", () => {
  mount("p1", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, storageKey: "motion.mvp.dock.v1" });
  act(() => useDockLayoutStore.getState().activatePanel("history"));
  expect(dockApi!.getPanel("history")).toBeUndefined();
});

it("expands only the MVP preview and restores layout without remounting the player", () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <I18nProvider initialLocale="en"><StudioHostContext.Provider value={{ mvpEditor: true }}>
      <Dock.Root projectId="p1" panels={MVP_PANEL_IDS} fixedLayout storageKey="motion.mvp.dock.v1">
        {MVP_PANEL_IDS.map(id => <Dock.Panel key={id} id={id}>
          {id === "preview" ? <iframe title="Preview player" /> : <div>{id}</div>}
        </Dock.Panel>)}
      </Dock.Root>
    </StudioHostContext.Provider></I18nProvider>,
  ));
  const api = dockApi!;
  act(() => {
    api.getPanel("compositions")!.api.setSize({ width: 310 });
    api.getPanel("layers")!.api.setActive();
    vi.advanceTimersByTime(1000);
  });
  const grid = api.toJSON().grid;
  const player = host.querySelector("iframe");
  const animation = { cancel: vi.fn(), onfinish: null };
  const animate = vi.fn(() => animation);
  Object.defineProperty(api.getPanel("preview")!.view.content.element, "animate", { value: animate, configurable: true });
  const click = (label: string) => act(() => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
  click("Immersive preview");
  expect(animate).toHaveBeenCalledWith(expect.any(Array), { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  expect(api.getPanel("preview")!.group.api.isMaximized()).toBe(true);
  expect(host.querySelector("iframe")).toBe(player);
  expect(document.fullscreenElement).toBeFalsy();
  act(() => vi.advanceTimersByTime(1000));
  expect(readStudioUiPreferences(undefined, "p1", "motion.mvp.dock.v1").dockLayout?.grid).toEqual(grid);
  click("Exit immersive preview");
  expect(api.hasMaximizedGroup()).toBe(false);
  expect(api.toJSON().grid).toEqual(grid);
  expect(host.querySelector("iframe")).toBe(player);
  click("Immersive preview");
  const exitComposition = vi.fn();
  window.addEventListener("keydown", exitComposition);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  window.removeEventListener("keydown", exitComposition);
  expect(exitComposition).not.toHaveBeenCalled();
  expect(api.hasMaximizedGroup()).toBe(false);
  expect(api.toJSON().grid).toEqual(grid);
  expect(host.querySelector("iframe")).toBe(player);
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Immersive preview"]'));
  expect(animation.cancel).toHaveBeenCalled();
  const calls = animate.mock.calls.length;
  const reduced = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  try {
    click("Immersive preview");
    expect(api.hasMaximizedGroup()).toBe(true);
    expect(animate).toHaveBeenCalledTimes(calls);
    click("Exit immersive preview");
    expect(api.toJSON().grid).toEqual(grid);
  } finally {
    reduced.mockRestore();
  }
});

it("collapses both MVP sides into rails, restores their tabs and widths, and preserves the preview", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <I18nProvider initialLocale="en"><StudioHostContext.Provider value={{ mvpEditor: true }}>
      <Dock.Root projectId="p1" panels={MVP_PANEL_IDS} fixedLayout dockWidth={() => 1400} storageKey="motion.mvp.dock.v1">
        {MVP_PANEL_IDS.map(id => <Dock.Panel key={id} id={id}>
          {id === "preview" ? <iframe title="Preview player" /> : <textarea aria-label={`${id} draft`} defaultValue="Keep draft" />}
        </Dock.Panel>)}
      </Dock.Root>
    </StudioHostContext.Provider></I18nProvider>,
  ));
  const api = dockApi!;
  act(() => {
    api.layout(1400, 800);
    api.getPanel("compositions")!.group.api.setSize({ width: 310 });
    vi.advanceTimersByTime(1000);
  });
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  const preview = api.getPanel("preview")!.group;
  const widths = [left.width, right.width, preview.width];
  const saved = readStudioUiPreferences(undefined, "p1", "motion.mvp.dock.v1").dockLayout;
  const player = host.querySelector("iframe");
  const draft = host.querySelector('[aria-label="compositions draft"]');
  const click = async (label: string) => act(async () => {
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
    await Promise.resolve();
  });
  await click("Collapse left panel");
  expect(right.width).toBe(widths[1]);
  await click("Collapse right panel");
  expect(left.width).toBe(48);
  expect(right.width).toBe(48);
  expect(preview.width).toBeGreaterThan(widths[2]!);
  expect(host.querySelectorAll(".hf-dock-side-rail")).toHaveLength(2);
  expect(host.querySelector('[aria-label="compositions draft"]')).toBe(draft);
  expect(draft?.closest('[inert]')).not.toBeNull();
  act(() => {
    dockLayout.applySideMinimums(api, 1000);
    vi.advanceTimersByTime(1000);
  });
  expect(left.width).toBe(48);
  expect(readStudioUiPreferences(undefined, "p1", "motion.mvp.dock.v1").dockLayout).toEqual(saved);
  await click("Immersive preview");
  await click("Exit immersive preview");
  expect(left.width).toBe(48);
  expect(right.width).toBe(48);
  expect(host.querySelector("iframe")).toBe(player);
  await click("Expand left panel");
  expect(left.width).toBe(widths[0]);
  expect(draft?.closest('[inert]')).toBeNull();
  await click("Layers");
  expect(right.width).toBe(widths[1]);
  expect(right.activePanel?.id).toBe("layers");
  expect(host.querySelectorAll(".hf-dock-side-rail")).toHaveLength(0);
  expect(host.querySelector("iframe")).toBe(player);
  await click("Collapse right panel");
  await click("Immersive preview");
  await act(async () => useDockLayoutStore.getState().activatePanel("layers"));
  expect(api.hasMaximizedGroup()).toBe(false);
  expect(right.width).toBe(widths[1]);
  expect(right.activePanel?.id).toBe("layers");
});


it("animates side widths, reverses from the current width, and leaves the opposite side and player intact", () => {
  mount("motion", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => 1400 });
  const api = dockApi!;
  act(() => api.layout(1400, 800));
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  const preview = api.getPanel("preview")!.group;
  const initial = { left: left.width, right: right.width, preview: preview.width };
  const controller = useDockLayoutStore.getState().controller!;
  act(() => controller.setGroupCollapsed!("compositions", true, true));
  expect(left.width).toBe(initial.left);
  act(() => vi.advanceTimersByTime(64));
  expect(left.width).toBeGreaterThan(48);
  expect(left.width).toBeLessThan(initial.left);
  expect(right.width).toBe(initial.right);
  expect(preview.width).toBeGreaterThan(initial.preview);
  const halfway = left.width;
  act(() => controller.setGroupCollapsed!("compositions", false, true));
  expect(left.width).toBe(halfway);
  act(() => vi.advanceTimersByTime(240));
  expect(left.width).toBe(initial.left);
  expect(left.element.hasAttribute("data-side-motion")).toBe(false);
  act(() => {
    controller.setGroupCollapsed!("compositions", true, true);
    controller.setGroupCollapsed!("design", true, true);
    vi.advanceTimersByTime(240);
  });
  expect(left.width).toBe(48);
  expect(right.width).toBe(48);
  act(() => {
    controller.setGroupCollapsed!("compositions", false, true);
    controller.setGroupCollapsed!("design", false, true);
    vi.advanceTimersByTime(240);
  });
  expect(left.width).toBe(initial.left);
  expect(right.width).toBe(initial.right);
});

it("skips side motion when reduced motion is requested", () => {
  const media = vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  try {
    mount("reduced", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => 1400 });
    act(() => dockApi!.layout(1400, 800));
    const left = dockApi!.getPanel("compositions")!.group;
    act(() => useDockLayoutStore.getState().controller!.setGroupCollapsed!("compositions", true, true));
    expect(left.width).toBe(48);
    expect(left.element.hasAttribute("data-side-motion")).toBe(false);
  } finally {
    media.mockRestore();
  }
});


it("fits the MVP timeline to content and preserves deliberate divider resizing", () => {
  const host = mount("compact", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => 1400 });
  const api = dockApi!;
  const controller = useDockLayoutStore.getState().controller!;
  act(() => { api.layout(1400, 800); vi.advanceTimersByTime(32); });
  expect(useDockLayoutStore.getState().collapsedZones).toEqual(expect.arrayContaining(["left", "right"]));
  const timeline = api.getPanel("timeline")!.group;
  act(() => { controller.setTimelineContentHeight!(176); vi.advanceTimersByTime(32); });
  expect(timeline.height).toBe(176);
  act(() => { controller.setTimelineContentHeight!(400); vi.advanceTimersByTime(32); });
  expect(timeline.height).toBe(224);
  const sash = host.querySelector<HTMLElement>('.dv-sash[aria-orientation="horizontal"]')!;
  act(() => {
    sash.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientY: 624, button: 0 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientY: 488 }));
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientY: 488 }));
    vi.advanceTimersByTime(32);
  });
  expect(timeline.height).toBe(360);
  act(() => { api.layout(1400, 1000); for (const observer of liveObservers) if (observer.target?.classList.contains("hf-dock")) (observer.callback as (entries: unknown[]) => void)([{ target: observer.target, contentRect: { width: 1400, height: 1000 } }]); vi.advanceTimersByTime(32); });
  expect(timeline.height).toBe(360);
  expect(readStudioUiPreferences(undefined, "compact").workspaceLayout?.timelineHeight).toBe(360);
  act(() => { controller.setTimelineContentHeight!(176); controller.fitTimeline!(); vi.advanceTimersByTime(32); });
  expect(timeline.height).toBe(176);
  expect(readStudioUiPreferences(undefined, "compact").workspaceLayout?.timelineHeight).toBeNull();
});

it("changes workspace visibility and restores preferences without replacing the mounted preview", () => {
  const host = mount("workspace", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => 1400 });
  const api = dockApi!;
  act(() => { api.layout(1400, 800); vi.advanceTimersByTime(32); });
  const controller = useDockLayoutStore.getState().controller!;
  const preview = host.querySelector('[data-testid="content-preview"]');
  act(() => { controller.applyWorkspacePreset!("preview"); vi.advanceTimersByTime(32); });
  expect(api.getPanel("timeline")!.group.api.isVisible).toBe(false);
  expect(host.querySelector('[data-testid="content-preview"]')).toBe(preview);
  act(() => { controller.setPanelVisible!("assets", true); controller.setPanelVisible!("timeline", true); vi.advanceTimersByTime(32); });
  expect(api.getPanel("assets")!.api.isActive).toBe(true);
  expect(readStudioUiPreferences(undefined, "workspace").workspaceLayout).toMatchObject({ left: true, right: false, timeline: true });
  act(() => { controller.applyWorkspacePreset!("edit"); vi.advanceTimersByTime(32); });
  expect(useDockLayoutStore.getState().collapsedZones).toEqual([]);
  expect(host.querySelector('[data-testid="content-preview"]')).toBe(preview);
  act(() => root!.unmount());
  root = null;
  mount("workspace", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => 1400 });
  act(() => { dockApi!.layout(1400, 800); vi.advanceTimersByTime(32); });
  expect(useDockLayoutStore.getState().collapsedZones).toEqual([]);
  expect(dockApi!.getPanel("timeline")!.group.api.isVisible).toBe(true);
});


it("hides preview independently, preserves its content and restores its preference", () => {
  const host = mount("hidden-preview", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => 1400 });
  const api = dockApi!;
  act(() => { api.layout(1400, 800); vi.advanceTimersByTime(32); });
  const controller = useDockLayoutStore.getState().controller!;
  const content = host.querySelector('[data-testid="content-preview"]');
  act(() => { controller.setPanelVisible!("preview", false); vi.advanceTimersByTime(32); });
  expect(api.getPanel("preview")!.group.api.isVisible).toBe(false);
  expect(api.getPanel("compositions")!.group.api.isVisible).toBe(true);
  expect(api.getPanel("design")!.group.api.isVisible).toBe(true);
  expect(host.querySelector('[data-testid="content-preview"]')).toBe(content);
  act(() => { api.layout(1200, 800); for (const observer of liveObservers) if (observer.target?.classList.contains("hf-dock")) (observer.callback as (entries: unknown[]) => void)([{ target: observer.target, contentRect: { width: 1200, height: 800 } }]); });
  expect(api.getPanel("preview")!.group.api.isVisible).toBe(false);
  expect(readStudioUiPreferences(undefined, "hidden-preview").workspaceLayout?.preview).toBe(false);
  act(() => root!.unmount()); root = null;
  mount("hidden-preview", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => 1400 });
  act(() => { dockApi!.layout(1400, 800); vi.advanceTimersByTime(32); });
  expect(dockApi!.getPanel("preview")!.group.api.isVisible).toBe(false);
  act(() => useDockLayoutStore.getState().controller!.setPanelVisible!("preview", true));
  expect(dockApi!.getPanel("preview")!.group.api.isVisible).toBe(true);
  act(() => useDockLayoutStore.getState().controller!.applyWorkspacePreset!("edit"));
  expect(dockApi!.getPanel("compositions")!.group.width).toBeLessThan(400);
  expect(dockApi!.getPanel("design")!.group.width).toBeLessThan(425);
  expect(dockApi!.getPanel("preview")!.group.width).toBeGreaterThan(500);
});

it("keeps a recoverable workspace when the last upper panel or timeline is hidden", () => {
  mount("timeline-only", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => 1400 });
  const api = dockApi!;
  act(() => { api.layout(1400, 800); vi.advanceTimersByTime(32); });
  const controller = useDockLayoutStore.getState().controller!;
  act(() => { controller.setPanelVisible!("preview", false); vi.advanceTimersByTime(32); });
  expect(api.groups.filter(group => group.api.isVisible).map(group => group.activePanel?.id)).toEqual(["timeline"]);
  act(() => controller.setPanelVisible!("timeline", false));
  expect(api.getPanel("preview")!.group.api.isVisible).toBe(true);
  act(() => controller.setPanelVisible!("assets", true));
  expect(api.getPanel("assets")!.group.api.isVisible).toBe(true);
});

it.each([[320, 304], [740, 264], [900, 344]])("keeps a full track reachable in a short %ipx host", (width, height) => {
  const host = mount("landscape", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => width });
  const api = dockApi!;
  const dock = host.querySelector<HTMLElement>(".hf-dock")!;
  Object.defineProperty(dock, "clientHeight", { configurable: true, value: height });
  act(() => {
    [...liveObservers].filter(({ target }) => target === dock)
      .forEach(({ callback, target }) => (callback as (entries: unknown[]) => void)([{ target, contentRect: { width, height } }]));
    api.layout(width, height);
    vi.advanceTimersByTime(32);
  });
  const preview = api.getPanel("preview")!.group;
  const timeline = api.getPanel("timeline")!.group;
  expect(preview.height).toBeGreaterThanOrEqual(96);
  expect(timeline.height).toBeGreaterThanOrEqual(width <= 480 ? 160 : 128);
  expect(preview.height + timeline.height).toBeLessThanOrEqual(height);
  act(() => useDockLayoutStore.getState().activatePanel("design"));
  expect(timeline.height).toBeGreaterThanOrEqual(width <= 480 ? 160 : 128);
});

it.each([320, 447, 448, 480, 487, 488, 599, 600, 700, 800, 1000, 1400])("keeps preview visible while fitting readable sides at %ipx", (width) => {
  const host = mount("independent", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => width });
  const api = dockApi!;
  act(() => { api.layout(width, 800); vi.advanceTimersByTime(32); });
  const content = host.querySelector('[data-testid="content-preview"]');
  const controller = useDockLayoutStore.getState().controller!;
  act(() => { controller.setPanelVisible!("assets", true); controller.setPanelVisible!("layers", true); vi.advanceTimersByTime(240); });
  const left = api.getPanel("assets")!.group;
  const right = api.getPanel("layers")!.group;
  const preview = api.getPanel("preview")!.group;
  expect(preview.api.isVisible).toBe(true);
  expect(preview.width).toBeGreaterThanOrEqual(Math.min(width >= 448 ? 200 : 240, width - 96));
  expect([left, right, preview].filter(group => group.api.isVisible).reduce((sum, group) => sum + group.width, 0)).toBeLessThanOrEqual(width);
  if (width < 448) {
    expect(left.api.isVisible).toBe(true);
    expect(right.api.isVisible).toBe(true);
    expect(preview.width).toBe(width - 96);
  } else {
    expect(left.width).toBeGreaterThanOrEqual(dockLayout.isSideCollapsed(left) ? 48 : 160);
    expect(right.width).toBeGreaterThanOrEqual(dockLayout.isSideCollapsed(right) ? 48 : 200);
  }
  if (width >= 600) expect(useDockLayoutStore.getState().collapsedZones).toEqual([]);
  else expect(dockLayout.isSideCollapsed(left)).toBe(true);
  act(() => controller.setPanelVisible!("assets", false));
  expect(dockLayout.isSideCollapsed(left)).toBe(true);
  expect(host.querySelector('[data-testid="content-preview"]')).toBe(content);
});

it.each([448, 480, 488, 560, 640, 739])("keeps side controls and the same preview usable together at %ipx", async (width) => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <I18nProvider initialLocale="en"><StudioHostContext.Provider value={{ mvpEditor: true }}>
      <Dock.Root projectId="narrow-controls" panels={MVP_PANEL_IDS} fixedLayout initialCompactLayout dockWidth={() => width}>
        {MVP_PANEL_IDS.map(id => <Dock.Panel key={id} id={id}>
          {id === "preview" ? <iframe title="Preview player" /> : <textarea aria-label={`${id} draft`} defaultValue="Keep draft" />}
        </Dock.Panel>)}
      </Dock.Root>
    </StudioHostContext.Provider></I18nProvider>,
  ));
  const api = dockApi!;
  act(() => { api.layout(width, 800); vi.advanceTimersByTime(32); });
  const preview = api.getPanel("preview")!.group;
  const player = host.querySelector("iframe");
  const click = async (label: string) => act(async () => {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    button!.click();
    await Promise.resolve();
  });
  expect(host.querySelectorAll(".hf-dock-side-rail")).toHaveLength(2);
  for (const [label, id, opposite, collapse] of [
    ["Expand left panel", "compositions", "design", "Collapse left panel"],
    ["Assets", "assets", "design", "Collapse left panel"],
    ["Expand right panel", "design", "compositions", "Collapse right panel"],
    ["Layers", "layers", "compositions", "Collapse right panel"],
  ] as const) {
    await click(label);
    const group = api.getPanel(id)!.group;
    expect(group.activePanel?.id).toBe(id);
    expect(group.width).toBeGreaterThanOrEqual(id === "compositions" || id === "assets" ? 160 : 200);
    expect(api.getPanel(opposite)!.group.width).toBe(48);
    expect(group.width + 48).toBeLessThanOrEqual(width);
    expect(preview.api.isVisible).toBe(true);
    expect(host.querySelector(`[aria-label="${id} draft"]`)?.closest("[inert]")).toBeNull();
    act(() => {
      [...liveObservers].filter(({ target }) => target?.classList.contains("hf-dock"))
        .forEach(({ callback }) => callback());
      api.layout(width, 650);
    });
    expect(preview.api.isVisible).toBe(true); // Height changes preserve preview and the chosen panel.
    expect(api.getPanel("timeline")!.group.api.isVisible).toBe(true);
    await click(collapse);
    expect(preview.api.isVisible).toBe(true);
    expect(preview.width).toBeGreaterThanOrEqual(width - 108);
    expect(host.querySelector("iframe")).toBe(player);
  }
  await click("Layers");
  await click("Assets"); // The most recently opened side takes priority when both cannot fit.
  expect(dockLayout.isSideCollapsed(api.getPanel("layers")!.group)).toBe(width < 600);
  expect(preview.api.isVisible).toBe(true);
  act(() => useDockLayoutStore.getState().activatePanel("preview"));
  expect(preview.api.isVisible).toBe(true);
  expect(host.querySelectorAll(".hf-dock-side-rail")).toHaveLength(width < 600 ? 1 : 0);
  expect(host.querySelector("iframe")).toBe(player);
});


it("fits oversized remembered sides without closing either side on a wide host", () => {
  mount("remembered-width", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => 1200 });
  const api = dockApi!;
  act(() => api.layout(1200, 800));
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  const controller = useDockLayoutStore.getState().controller!;
  act(() => {
    controller.setGroupCollapsed!("design", true);
    left.api.setSize({ width: 650 });
    controller.setGroupCollapsed!("compositions", true);
    controller.setGroupCollapsed!("design", false);
    controller.setGroupCollapsed!("compositions", false);
  });
  expect(right.width).toBeGreaterThanOrEqual(200);
  expect(left.width).toBeGreaterThanOrEqual(260);
  expect(api.getPanel("preview")!.group.width).toBeGreaterThanOrEqual(360);
});

function resizeDock(api: DockviewApi, width: number, height = 800) {
  api.layout(width, height);
  [...liveObservers].filter(({ target }) => target?.classList.contains("hf-dock"))
    .forEach(({ callback, target }) => (callback as (entries: unknown[]) => void)([{ target, contentRect: { width, height } }]));
  vi.advanceTimersByTime(32);
}

it("shrinks both sides before preview and restores preferred widths on expansion", () => {
  let width = 1400;
  const host = mount("preview-first", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  act(() => resizeDock(api, width));
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  const preview = api.getPanel("preview")!.group;
  const before = { left: left.width, right: right.width, preview: preview.width };
  const content = host.querySelector('[data-testid="content-preview"]');
  act(() => { width -= 40; resizeDock(api, width); });
  expect(left.width).toBeLessThan(before.left);
  expect(right.width).toBeLessThan(before.right);
  expect(Math.abs(preview.width - before.preview)).toBeLessThanOrEqual(2);
  act(() => { width = Math.floor(before.preview + 160 + 200 - 80); resizeDock(api, width); });
  expect(left.width).toBe(160);
  expect(right.width).toBe(200);
  expect(preview.width).toBe(width - 360);
  act(() => { width = 1400; resizeDock(api, width); });
  expect(Math.abs(left.width - before.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(right.width - before.right)).toBeLessThanOrEqual(1);
  expect(host.querySelector('[data-testid="content-preview"]')).toBe(content);
});

it("preserves user widths and requested visibility across automatic rails and timeline changes", async () => {
  let width = 1400;
  mount("auto-rails", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  const controller = useDockLayoutStore.getState().controller!;
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  act(() => {
    resizeDock(api, width);
    left.api.setSize({ width: 310 });
    right.api.setSize({ width: 330 });
    vi.advanceTimersByTime(32);
    controller.rememberWorkspace!();
  });
  await act(async () => { await Promise.resolve(); });
  act(() => {
    width = 580; resizeDock(api, width);
    controller.setPanelVisible!("timeline", false);
  });
  expect(left.width).toBe(48);
  expect(right.width).toBeGreaterThanOrEqual(200);
  expect(readStudioUiPreferences(undefined, "auto-rails").workspaceLayout).toMatchObject({ left: true, right: true });
  act(() => { width = 480; resizeDock(api, width); });
  expect(left.width).toBe(48);
  expect(right.width).toBe(200);
  expect(api.getPanel("preview")!.group.api.isVisible).toBe(true);
  act(() => { width = 1400; resizeDock(api, width); });
  expect(left.width).toBe(310);
  expect(right.width).toBe(330);
  act(() => {
    controller.setGroupCollapsed!("compositions", true);
    width = 480; resizeDock(api, width);
    width = 1400; resizeDock(api, width);
  });
  expect(left.width).toBe(48); // A deliberate collapse must not be undone by expansion.
  expect(right.width).toBe(330);
});

it("finishes an in-flight opening before automatically railing sides on a narrow host", () => {
  let width = 800;
  mount("resize-motion", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  act(() => {
    api.layout(width, 800);
    useDockLayoutStore.getState().controller!.setGroupCollapsed!("design", false, true);
    vi.advanceTimersByTime(64);
    width = 480;
    [...liveObservers].filter(({ target }) => target?.classList.contains("hf-dock"))
      .forEach(({ callback, target }) => (callback as (entries: unknown[]) => void)([{ target, contentRect: { width, height: 800 } }]));
    api.layout(width, 800);
    vi.advanceTimersByTime(240);
  });
  expect(api.getPanel("design")!.group.width).toBe(200);
  expect(api.getPanel("compositions")!.group.width).toBe(48);
  expect(api.getPanel("preview")!.group.api.isVisible).toBe(true);
});


it("retains the 160px library and 200px inspector floors through side-panel animations", () => {
  mount("narrow-library", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => 1400 });
  const api = dockApi!;
  act(() => api.layout(1400, 800));
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  const controller = useDockLayoutStore.getState().controller!;
  act(() => {
    controller.setGroupCollapsed!("compositions", false);
    left.api.setSize({ width: 260 });
  });
  expect(left.width).toBe(260);
  act(() => {
    controller.setGroupCollapsed!("compositions", true, true);
    vi.advanceTimersByTime(240);
    controller.setGroupCollapsed!("compositions", false, true);
    vi.advanceTimersByTime(240);
    controller.setGroupCollapsed!("design", false, true);
    vi.advanceTimersByTime(240);
    dockLayout.applySideMinimums(api, 1400, true);
    left.api.setSize({ width: 140 });
    right.api.setSize({ width: 180 });
  });
  expect(left.width).toBe(160);
  expect(left.minimumWidth).toBe(160);
  expect(right.width).toBe(200);
  expect(right.minimumWidth).toBe(200);
  act(() => {
    controller.setGroupCollapsed!("design", true, true);
    vi.advanceTimersByTime(240);
    controller.setGroupCollapsed!("design", false, true);
    vi.advanceTimersByTime(240);
    right.api.setSize({ width: 180 });
  });
  expect(right.width).toBe(200);
  expect(right.minimumWidth).toBe(200);
  expect(api.getPanel("preview")!.group.width).toBeGreaterThanOrEqual(360);
});


it("keeps preferred side widths across a compressed-layout save and reload", async () => {
  let width = 1400;
  mount("width-reload", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  await act(async () => {
    resizeDock(dockApi!, width);
    dockApi!.getPanel("compositions")!.group.api.setSize({ width: 310 });
    dockApi!.getPanel("design")!.group.api.setSize({ width: 330 });
    await Promise.resolve();
  });
  act(() => vi.advanceTimersByTime(400));
  const saved = readStudioUiPreferences(undefined, "width-reload").dockLayout;
  expect(saved).toBeDefined();
  await act(async () => { width = 1100; resizeDock(dockApi!, width); await Promise.resolve(); });
  act(() => vi.advanceTimersByTime(400));
  expect(readStudioUiPreferences(undefined, "width-reload").dockLayout).toEqual(saved);
  act(() => root?.unmount());
  width = 1400;
  mount("width-reload", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  act(() => resizeDock(dockApi!, width));
  expect(dockApi!.getPanel("compositions")!.group.width).toBe(310);
  expect(dockApi!.getPanel("design")!.group.width).toBe(330);
});

it.each(["compositions", "design"] as const)("shrinks the single open %s side before preview", (id) => {
  let width = 1400;
  mount("one-side", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  act(() => {
    resizeDock(api, width);
    useDockLayoutStore.getState().controller!.setGroupCollapsed!("compositions", true);
    useDockLayoutStore.getState().controller!.setGroupCollapsed!("design", true);
    useDockLayoutStore.getState().controller!.setGroupCollapsed!(id, false);
  });
  const side = api.getPanel(id)!.group;
  const preview = api.getPanel("preview")!.group;
  const before = { side: side.width, preview: preview.width };
  act(() => { width -= 20; resizeDock(api, width); });
  expect(side.width).toBeLessThan(before.side);
  expect(Math.abs(preview.width - before.preview)).toBeLessThanOrEqual(1);
  act(() => { width = 1400; resizeDock(api, width); });
  expect(side.width).toBe(before.side);
});


it.each(["compositions", "design"] as const)("opens a new %s side at its preferred width without reserving an expanded opposite side", (id) => {
  let width = 800;
  mount("default-single-side", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => width });
  const api = dockApi!;
  const controller = useDockLayoutStore.getState().controller!;
  const side = api.getPanel(id)!.group;
  const opposite = api.getPanel(id === "compositions" ? "design" : "compositions")!.group;
  const preview = api.getPanel("preview")!.group;
  const preferred = id === "compositions" ? 200 : 230;
  act(() => { resizeDock(api, width); controller.setGroupCollapsed!(id, false); });
  expect(side.width).toBe(preferred);
  expect(opposite.width).toBe(48);
  const beforePreview = preview.width;
  act(() => { width -= 20; resizeDock(api, width); });
  expect(side.width).toBe(preferred - 20);
  expect(preview.width).toBe(beforePreview);
  act(() => { width = 800; resizeDock(api, width); });
  expect(side.width).toBe(preferred);
  act(() => controller.setGroupCollapsed!(id === "compositions" ? "design" : "compositions", false));
  expect(side.width).toBe(preferred);
  expect(preview.width).toBeGreaterThanOrEqual(360);
  act(() => { width = 750; resizeDock(api, width); });
  expect(side.width).toBeLessThan(preferred);
  expect(preview.width).toBeGreaterThanOrEqual(360);
  act(() => { width = 800; resizeDock(api, width); });
  act(() => controller.setGroupCollapsed!(id === "compositions" ? "design" : "compositions", true));
  expect(side.width).toBe(preferred);
});

it.each(["compositions", "design"] as const)("reopens %s at the user's width after collapse and temporary host compression", (id) => {
  let width = 1000;
  mount("manual-reopen", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => width });
  const api = dockApi!;
  const controller = useDockLayoutStore.getState().controller!;
  const side = api.getPanel(id)!.group;
  act(() => {
    resizeDock(api, width);
    controller.setGroupCollapsed!(id, false);
    side.api.setSize({ width: 310 });
  });
  act(() => controller.setGroupCollapsed!(id, true));
  act(() => controller.setGroupCollapsed!(id, false));
  expect(side.width).toBe(310);
  act(() => { width = 600; resizeDock(api, width); });
  expect(side.width).toBeLessThan(310);
  act(() => controller.setGroupCollapsed!(id, true));
  act(() => { width = 1000; resizeDock(api, width); });
  act(() => controller.setGroupCollapsed!(id, false));
  expect(side.width).toBe(310);
});

it("compresses a new single side only when its preferred width cannot fit beside preview", () => {
  mount("default-narrow-side", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => 600 });
  const api = dockApi!;
  act(() => { resizeDock(api, 600); useDockLayoutStore.getState().controller!.setGroupCollapsed!("compositions", false); });
  expect(api.getPanel("compositions")!.group.width).toBe(192);
  expect(api.getPanel("design")!.group.width).toBe(48);
  expect(api.getPanel("preview")!.group.width).toBe(360);
});

it("keeps disabled rails visible and enables both when one readable side fits", async () => {
  let width = 420;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(
    <I18nProvider initialLocale="en"><StudioHostContext.Provider value={{ mvpEditor: true }}>
      <Dock.Root projectId="rail-fit" panels={MVP_PANEL_IDS} fixedLayout initialCompactLayout dockWidth={() => width}>
        {MVP_PANEL_IDS.map(id => <Dock.Panel key={id} id={id}><div>{id}</div></Dock.Panel>)}
      </Dock.Root>
    </StudioHostContext.Provider></I18nProvider>,
  ));
  act(() => resizeDock(dockApi!, width));
  const left = host.querySelector<HTMLButtonElement>('button[aria-label="Expand left panel"]')!;
  const right = host.querySelector<HTMLButtonElement>('button[aria-label="Expand right panel"]')!;
  expect(left.disabled).toBe(true);
  expect(right.disabled).toBe(true);
  expect(dockApi!.getPanel("compositions")!.group.api.isVisible).toBe(true);
  expect(dockApi!.getPanel("design")!.group.api.isVisible).toBe(true);
  expect(dockApi!.getPanel("preview")!.group.width).toBe(width - 96);
  act(() => useDockLayoutStore.getState().activatePanel("assets"));
  expect(dockApi!.getPanel("assets")!.group.api.isVisible).toBe(true);
  await act(async () => { width = 448; resizeDock(dockApi!, width); await Promise.resolve(); });
  expect(dockApi!.getPanel("compositions")!.group.api.isVisible).toBe(true);
  expect(dockApi!.getPanel("design")!.group.api.isVisible).toBe(true);
  expect(left.disabled).toBe(false);
  expect(right.disabled).toBe(false);
});

it("remembers manual widths while the opposite side is automatically collapsed", () => {
  let width = 560;
  mount("switch-widths", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, initialCompactLayout: true, dockWidth: () => width });
  const api = dockApi!;
  const controller = useDockLayoutStore.getState().controller!;
  act(() => {
    resizeDock(api, width);
    controller.setGroupCollapsed!("compositions", false);
    controller.setGroupCollapsed!("design", false);
    api.getPanel("design")!.group.api.setSize({ width: 240 });
    controller.setGroupCollapsed!("compositions", false);
    api.getPanel("compositions")!.group.api.setSize({ width: 250 });
    controller.setGroupCollapsed!("design", false);
    width = 1000;
    resizeDock(api, width);
  });
  expect(api.getPanel("compositions")!.group.width).toBe(250);
  expect(api.getPanel("design")!.group.width).toBe(240);
});

it("preserves requested sides, widths and mounted preview across disabled-rail widths", () => {
  let width = 1400;
  const host = mount("preview-only", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  const controller = useDockLayoutStore.getState().controller!;
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  const preview = api.getPanel("preview")!.group;
  const content = host.querySelector('[data-testid="content-preview"]');
  act(() => {
    resizeDock(api, width);
    left.api.setSize({ width: 310 });
    right.api.setSize({ width: 330 });
    vi.advanceTimersByTime(32);
    controller.setGroupCollapsed!("compositions", true);
  });
  for (const narrow of [447, 320, 240]) {
    act(() => { width = narrow; resizeDock(api, width); controller.rememberWorkspace!(); });
    expect(left.api.isVisible).toBe(true);
    expect(right.api.isVisible).toBe(true);
    expect(preview.width).toBe(narrow - 96);
    expect(api.getPanel("timeline")!.group.api.isVisible).toBe(true);
    expect(readStudioUiPreferences(undefined, "preview-only").workspaceLayout).toMatchObject({ left: false, right: true });
    act(() => { width = 1400; resizeDock(api, width); });
    expect(left.api.isVisible).toBe(true);
    expect(right.api.isVisible).toBe(true);
    expect(left.width).toBe(48);
    expect(right.width).toBe(330);
    expect(host.querySelector('[data-testid="content-preview"]')).toBe(content);
  }
  act(() => controller.setGroupCollapsed!("compositions", false));
  expect(left.width).toBe(310);
});


it.each([
  [900, 0, "pointerup"], [900, 1, "pointerup"],
  [1200, 0, "pointerup"], [1200, 1, "pointerup"],
  [1200, 0, "pointercancel"], [1200, 1, "contextmenu"],
] as const)("keeps live geometry at %ipx on divider %i until %s", (width, index, release) => {
  const host = mount("live-sash", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  act(() => resizeDock(api, width));
  const side = api.getPanel(index === 0 ? "compositions" : "design")!.group;
  const initial = side.width;
  const sash = host.querySelectorAll<HTMLElement>('.dv-sash[aria-orientation="vertical"]')[index];
  act(() => sash.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, button: 0 })));
  for (const delta of [80, 160, 100, 40]) {
    act(() => document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: index === 0 ? delta : -delta })));
    expect(side.width).toBe(initial + delta);
    act(() => {
      [...liveObservers].filter(({ target }) => target?.classList.contains("hf-dock")).forEach(({ callback, target }) => (callback as (entries: unknown[]) => void)([{ target, contentRect: { width, height: 800 } }]));
      vi.advanceTimersByTime(32);
    });
    expect(side.width).toBe(initial + delta);
  }
  act(() => document.dispatchEvent(new MouseEvent(release, { bubbles: true })));
  act(() => resizeDock(api, width));
  expect(side.width).toBe(initial + 40);
});

it.each([
  [0, 1100, 24], [1, 1100, 24],
  [0, 1250, 600], [1, 1250, 600],
  [0, 1100, 0], [1, 1100, 0],
])("preserves the untouched preference after dragging divider %i at %ipx by %ipx", async (index, narrowWidth, delta) => {
  let width = 1400;
  const host = mount("compressed-drag-preferences", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  const controller = useDockLayoutStore.getState().controller!;
  const sides = [api.getPanel("compositions")!.group, api.getPanel("design")!.group];
  await act(async () => {
    resizeDock(api, width);
    sides[0].api.setSize({ width: 310 });
    sides[1].api.setSize({ width: 330 });
    await Promise.resolve();
  });
  act(() => {
    width = narrowWidth;
    resizeDock(api, width);
  });
  const before = sides.map(side => side.width);
  expect(before[0]).toBeLessThan(310);
  expect(before[1]).toBeLessThan(330);
  const sash = host.querySelectorAll<HTMLElement>('.dv-sash[aria-orientation="vertical"]')[index];
  act(() => {
    sash.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, button: 0 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: index === 0 ? delta : -delta }));
    vi.advanceTimersByTime(32);
  });
  const live = sides.map(side => side.width);
  if (delta === 24) expect(live[index]).toBe(before[index] + delta);
  if (delta === 600) expect(live[1 - index]).toBeLessThan(before[1 - index]);
  await act(async () => {
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    await Promise.resolve();
    resizeDock(api, width);
  });
  expect(sides.map(side => side.width)).toEqual(live);
  const expected = delta === 0 ? (index === 0 ? 310 : 330) : live[index];
  act(() => { width = 1400; resizeDock(api, width); });
  expect(sides[index].width).toBe(expected);
  expect(sides[1 - index].width).toBe(index === 0 ? 330 : 310);
  const id = index === 0 ? "compositions" : "design";
  act(() => { controller.setGroupCollapsed!(id, true); controller.setGroupCollapsed!(id, false); });
  // Reopening reserves the default preview width; make room even for a very wide manual side.
  act(() => { width = 1800; resizeDock(api, width); });
  expect(sides[index].width).toBe(expected);
  expect(sides[1 - index].width).toBe(index === 0 ? 330 : 310);
});

it.each([648, 703, 720])("keeps both column dividers draggable after repeated resizing at %ipx", (compactWidth) => {
  let width = 1400;
  const host = mount("repeat-column-drag", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  act(() => { resizeDock(api, width); width = compactWidth; resizeDock(api, width); });
  const left = api.getPanel("compositions")!.group;
  const right = api.getPanel("design")!.group;
  const preview = api.getPanel("preview")!.group;
  const sashes = host.querySelectorAll<HTMLElement>('.dv-sash[aria-orientation="vertical"]');
  const drag = (sash: HTMLElement, delta: number) => act(() => {
    sash.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, button: 0 }));
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: delta }));
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: delta }));
    vi.advanceTimersByTime(32);
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    expect(sashes[0].classList.contains("dv-disabled")).toBe(false);
    drag(sashes[0], 24);
    expect(left.width).toBe(184);
    drag(sashes[0], -24);
    expect(left.width).toBe(160);
    expect(sashes[1].classList.contains("dv-disabled")).toBe(false);
    drag(sashes[1], -24);
    expect(right.width).toBe(224);
    drag(sashes[1], 24);
    expect(right.width).toBe(200);
    expect(preview.width).toBeGreaterThanOrEqual(240);
  }
});

it.each([
  ["captions", "transcript"],
  ["transcript", "captions"],
] as const)("keeps column widths stable when switching from %s to %s", async (first, second) => {
  let width = 1400;
  mount("stable-caption-tabs", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  await act(async () => { resizeDock(api, width); await Promise.resolve(); });
  const left = api.getPanel(first)!.group;
  const columns = () => ({ left: left.width, preview: api.getPanel("preview")!.group.width, right: api.getPanel("design")!.group.width });
  const activate = async (id: typeof first | typeof second | "assets") => act(async () => {
    useDockLayoutStore.getState().activatePanel(id);
    await Promise.resolve();
  });
  const initial = columns();
  await activate(first);
  expect(columns()).toEqual(initial);
  // A deliberate narrow sash adjustment must survive the other tab's first activation.
  await act(async () => { left.api.setSize({ width: 280 }); await Promise.resolve(); });
  const custom = columns();
  await activate(second);
  expect(columns()).toEqual(custom);
  for (const hostWidth of [700, 1400]) {
    await act(async () => { width = hostWidth; resizeDock(api, width); await Promise.resolve(); });
    const fitted = columns();
    for (const tab of [first, second, "assets", first, second] as const) {
      await activate(tab);
      expect(columns()).toEqual(fitted);
    }
    expect(api.getPanel("preview")!.group.width).toBeGreaterThanOrEqual(240);
  }
  expect(left.width).toBe(280);
});

it.each(["captions", "transcript"] as const)("retains %s and custom widths while the editor is hidden by settings", async (panel) => {
  let width = 1400;
  const host = mount("settings-return", {}, { panels: MVP_PANEL_IDS, fixedLayout: true, dockWidth: () => width });
  const api = dockApi!;
  await act(async () => {
    resizeDock(api, width);
    useDockLayoutStore.getState().activatePanel(panel);
    await Promise.resolve();
  });
  const left = api.getPanel(panel)!.group;
  const before = () => ({ left: left.width, preview: api.getPanel("preview")!.group.width, right: api.getPanel("design")!.group.width });
  for (const custom of [false, true]) {
    if (custom) await act(async () => { left.api.setSize({ width: 480 }); await Promise.resolve(); });
    const expected = before();
    for (let visit = 0; visit < 2; visit++) {
      await act(async () => { host.hidden = true; width = 0; resizeDock(api, width, 0); await Promise.resolve(); });
      await act(async () => { host.hidden = false; width = 1400; resizeDock(api, width); await Promise.resolve(); });
      expect(before()).toEqual(expected);
      expect(api.getPanel(panel)!.api.isActive).toBe(true);
    }
  }
});
