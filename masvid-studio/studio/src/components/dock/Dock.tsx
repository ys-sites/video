import { Button } from "open-design-ui/button";
import { useI18n } from "../../i18n/I18n";
import { Check } from "../../icons/RemixIcons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { installDockWorkspace } from "./dockWorkspace";
import { installDockAccessibility } from "./dockAccessibility";
import { DockStripActions } from "./DockStripActions";
import { DockHeaderSlotsProvider } from "./DockHeaderSlots";
import { DockTab } from "./DockTab";
import { installTabFill } from "./dockTabFill";
import { createSidePanelMotion } from "./dockSidePanelMotion";
import { createResponsiveDockSides } from "./dockResponsiveSides";
import { savedSideWidths, type SideWidths } from "./dockSideSizing";
import { addRegisteredPanel, applySideMinimums, buildEditLayout, defaultSideWidths, isSideCollapsed, COMPACT_DOCK_WIDTH } from "./dockLayout";
import { DOCK_PANEL_COMPONENT, parseDockLayout } from "./dockLayoutSchema";
import { useDockLayoutStore, type DockController, type DockSnapshot } from "./dockLayoutStore";
import {
  PANEL_DEFINITIONS,
  PANEL_IDS,
  isPanelId,
  panelsInZone,
  type PanelDefinition,
  type PanelId,
} from "./panelRegistry";
import "./dock.css";
import { menuClasses } from "../ui/menuStyle";

const PERSIST_DEBOUNCE_MS = 250;

type Slots = Partial<Record<PanelId, HTMLElement>>;

interface SlotsContextValue {
  slots: Slots;
  registerSlot: (id: PanelId, element: HTMLElement | null) => void;
}

const SlotsContext = createContext<SlotsContextValue | null>(null);

function useSlots(): SlotsContextValue {
  const value = useContext(SlotsContext);
  if (!value) throw new Error("Dock.Panel must be rendered inside Dock.Root");
  return value;
}

/** The element dockview mounts for a panel; Dock.Panel portals the real content into it. */
function PanelSlot({ api }: IDockviewPanelProps) {
  const { registerSlot } = useSlots();
  const id = api.id;
  const collapsed = useDockLayoutStore(state => isPanelId(id) && (state.collapsedZones?.includes(PANEL_DEFINITIONS[id].zone) ?? false));
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      if (isPanelId(id)) registerSlot(id, element);
    },
    [id, registerSlot],
  );
  return <div ref={ref} data-dock-panel={id} inert={collapsed} style={collapsed ? { display: "none" } : undefined} className="h-full w-full min-h-0 min-w-0 overflow-hidden" />;
}

const COMPONENTS = { [DOCK_PANEL_COMPONENT]: PanelSlot };

function snapshot(api: DockviewApi): DockSnapshot {
  const openPanels = new Set<PanelId>();
  const visiblePanels = new Set<PanelId>();
  for (const panel of api.panels) {
    if (!isPanelId(panel.id)) continue;
    openPanels.add(panel.id);
    if (panel.api.isVisible && panel.group.api.isVisible) visiblePanels.add(panel.id);
  }
  const groupActivePanels = api.groups.flatMap((group) => {
    const id = group.activePanel?.id;
    return isPanelId(id) ? [id] : [];
  });
  const active = api.activePanel?.id;
  return {
    openPanels,
    visiblePanels,
    activePanel: isPanelId(active) ? active : null,
    groupActivePanels,
    collapsedZones: api.groups.filter(isSideCollapsed).flatMap(group => {
      const id = group.panels[0]?.id;
      return isPanelId(id) ? [PANEL_DEFINITIONS[id].zone] : [];
    }),
  };
}

interface DockOptions {
  panels: readonly PanelId[];
  storageKey?: string | undefined;
  dockWidth: () => number;
  fixedLayout?: boolean;
  preferredWidths?: Partial<SideWidths>;
}

function createController(api: DockviewApi, options: DockOptions): DockController & { dispose: () => void; finishTransitions: () => void; reflowSides: () => void; hasResponsiveFit: () => boolean } {
  const motion = createSidePanelMotion();
  const sides = createResponsiveDockSides(api, options.dockWidth, motion, () => useDockLayoutStore.getState().sync(snapshot(api)), options.preferredWidths, options.fixedLayout);
  const setGroupCollapsed = (id: PanelId, collapsed: boolean, animate = false) => {
    if (options.fixedLayout) sides.setCollapsed(id, collapsed, animate);
  };
  const open = (id: PanelId) => {
    if (!options.panels.includes(id) || api.getPanel(id)) return;
    if (id === "preview") {
      // The timeline spans the whole workspace. Anchoring above it creates a new
      // row; anchor to a side column to put a closed preview back in the centre.
      const side = (["left", "right"] as const).flatMap((zone) =>
        panelsInZone(zone).flatMap((panelId) => {
          const panel = api.getPanel(panelId);
          return panel && !panel.group.panels.some((p) => p.id === "timeline")
            ? [{ panel, zone, panelId }]
            : [];
        }),
      )[0];
      if (side) {
        addRegisteredPanel(api, id, {
          referencePanel: side.panelId,
          direction: side.zone === "left" ? "right" : "left",
        });
        const widths = defaultSideWidths(options.dockWidth());
        for (const group of api.groups) {
          const ids = group.panels.map((panel) => panel.id);
          if (ids.includes("preview") || ids.includes("timeline")) continue;
          const zone = isPanelId(ids[0]) ? PANEL_DEFINITIONS[ids[0]].zone : "center";
          if (zone !== "center" && group.width > widths[zone]) {
            group.api.setSize({ width: widths[zone] });
          }
        }
        return;
      }
    }
    if (id === "timeline" && api.panels.length) {
      addRegisteredPanel(api, id, { direction: "below" });
      return;
    }
    const { zone, reopen: preferred } = PANEL_DEFINITIONS[id];
    const reopen: PanelDefinition["reopen"] =
      zone === "center" || (options.panels.includes(preferred.near) && api.getPanel(preferred.near))
        ? preferred
        : { near: "preview", direction: zone };
    // Side columns are tab groups; preview and timeline are separate groups in the centre.
    const sibling =
      zone === "center"
        ? undefined
        : panelsInZone(zone).find((other) => other !== id && api.getPanel(other));
    if (sibling) {
      addRegisteredPanel(api, id, { referencePanel: sibling, direction: "within" });
      return;
    }
    const hasAnchor = api.getPanel(reopen.near) !== undefined;
    const position = { referencePanel: reopen.near, direction: reopen.direction };
    const fallback = zone === "center" ? undefined : api.getPanel("timeline")
      ? { referencePanel: "timeline" as const, direction: "above" as const }
      : { direction: zone };
    addRegisteredPanel(api, id, hasAnchor ? position : fallback);
  };
  return {
    dispose: () => { motion.dispose(); sides.dispose(); },
    finishTransitions: motion.finishAll,
    reflowSides: () => { if (options.fixedLayout) sides.reflow(); },
    open,
    setGroupCollapsed,
    canExpandSide: sides.canExpand,
    hasResponsiveFit: sides.hasResponsiveFit,
    setPreviewVisible: sides.setPreviewVisible,
    resetSideWidths: sides.resetWidths,
    activate: (id) => {
      if (options.fixedLayout && !sides.canExpand(id)) return;
      open(id);
      const panel = api.getPanel(id);
      if (!panel?.group.api.isMaximized()) api.exitMaximizedGroup();
      if (options.fixedLayout && id === "preview") sides.setPreviewVisible(true);
      setGroupCollapsed(id, false);
      if (panel && !panel.group.api.isVisible) panel.group.api.setVisible(true);
      panel?.api.setActive();
    },
    close: (id) => {
      if (options.fixedLayout) return;
      const panel = api.getPanel(id);
      if (panel) api.removePanel(panel);
    },
    setTitle: (id, title) => api.getPanel(id)?.api.setTitle(title),
    setGroupVisible: (id, visible) => {
      if (options.fixedLayout && visible && !sides.canExpand(id)) return;
      const group = api.getPanel(id)?.group;
      if ((!options.fixedLayout || visible) && group && group.api.isVisible !== visible) group.api.setVisible(visible);
    },
    reset: () => {
      motion.finishAll();
      buildEditLayout(api, options.dockWidth(), options.panels);
      const timeline = api.getPanel("timeline");
      if (options.fixedLayout && timeline) timeline.group.header.hidden = true;
      if (options.fixedLayout && options.dockWidth() < COMPACT_DOCK_WIDTH) {
        for (const id of options.panels) setGroupCollapsed(id, true);
      }
      applySideMinimums(api, options.dockWidth(), options.fixedLayout);
      if (options.fixedLayout) sides.resetWidths();
    },
  };
}

function restoreOrBuild(api: DockviewApi, projectId: string | null, options: DockOptions) {
  const { dockLayout } = readStudioUiPreferences(undefined, projectId, options.storageKey);
  const stored = parseDockLayout(dockLayout, options.panels);
  if (stored) {
    try {
      // Expanded preview is a temporary viewing mode, not a saved workspace layout.
      api.fromJSON(stored);
      if (options.fixedLayout && api.hasMaximizedGroup()) api.exitMaximizedGroup();
      return stored;
    } catch {
      /* a layout the schema accepted but dockview cannot load: start over */
    }
  }
  buildEditLayout(api, options.dockWidth(), options.panels);
}

const windowWidth = () => window.innerWidth;

function Root({
  projectId,
  panels = PANEL_IDS,
  storageKey,
  fixedLayout = false,
  initialCompactLayout = false,
  dockWidth = windowWidth,
  children,
}: {
  projectId: string | null;
  panels?: readonly PanelId[];
  storageKey?: string;
  fixedLayout?: boolean;
  initialCompactLayout?: boolean;
  dockWidth?: () => number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const translateRef = useRef(t);
  translateRef.current = t;
  const [slots, setSlots] = useState<Slots>({});
  const registerSlot = useCallback((id: PanelId, element: HTMLElement | null) => {
    setSlots((prev) => {
      if (prev[id] === (element ?? undefined)) return prev;
      const next = { ...prev };
      if (element) next[id] = element;
      else delete next[id];
      return next;
    });
  }, []);

  const disposeRef = useRef<() => void>(() => {});
  useEffect(() => () => disposeRef.current(), []);

  const onReady = useCallback(
    ({ api }: DockviewReadyEvent) => {
      disposeRef.current();
      const options = { panels, storageKey, dockWidth, fixedLayout };
      const restored = restoreOrBuild(api, projectId, options);
      const controller = createController(api, { ...options, preferredWidths: savedSideWidths(restored) });
      if (fixedLayout) for (const id of panels) controller.open(id);
      const timeline = api.getPanel("timeline");
      if (fixedLayout && timeline) timeline.group.header.hidden = true;
      applySideMinimums(api, dockWidth(), fixedLayout);
      const root = api.groups[0]?.element.closest<HTMLElement>(".hf-dock");
      const disposeAccessibility = root ? installDockAccessibility(api, root, (message) => translateRef.current(message)) : () => {};
      const disposeTabFill = root ? installTabFill(api, root) : () => {};
      // Sides size against dockWidth, the window by default; the dock's own box lags a resize.
      let workspace: ReturnType<typeof installDockWorkspace> | undefined;
      const store = useDockLayoutStore.getState();
      store.attach(controller, panels);
      const fitHostWidth = () => {
        if (dockWidth() <= 0) return;
        controller.finishTransitions();
        controller.reflowSides();
        applySideMinimums(api, dockWidth(), fixedLayout);
        workspace?.schedule();
      };
      const resizeObserver = new ResizeObserver(fitHostWidth);
      if (root) resizeObserver.observe(root);
      if (fixedLayout && initialCompactLayout) {
        for (const zone of ["left", "right"] as const) {
          const id = panels.find(id => PANEL_DEFINITIONS[id].zone === zone);
          if (id) controller.setGroupCollapsed?.(id, true);
        }
        workspace?.schedule();
      }
      if (fixedLayout && root) workspace = installDockWorkspace(api, controller, root, projectId, storageKey, dockWidth);
      store.sync(snapshot(api));
      const pending = store.takePendingActivation();
      if (pending) store.activatePanel(pending);
      fitHostWidth();

      let timer: ReturnType<typeof setTimeout> | undefined;
      const persist = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (fixedLayout && (controller.hasResponsiveFit() || api.hasMaximizedGroup() || api.groups.some(group => isSideCollapsed(group) || group.element.hasAttribute("data-side-motion")))) return;
          writeStudioUiPreferences({ dockLayout: api.toJSON() }, undefined, projectId, storageKey);
        }, PERSIST_DEBOUNCE_MS);
      };
      // dockview does not fire onDidLayoutChange for add/remove/activate,
      // so every event class is wired to the same sync+persist pair.
      const onDockChange = () => {
        workspace?.schedule();
        useDockLayoutStore.getState().sync(snapshot(api));
        persist();
      };
      const subscriptions = [
        api.onDidAddPanel(() => {
          applySideMinimums(api, dockWidth(), fixedLayout);
          onDockChange();
        }),
        api.onDidMovePanel(() => {
          applySideMinimums(api, dockWidth(), fixedLayout);
          onDockChange();
        }),
        api.onDidRemovePanel(onDockChange),
        api.onDidActivePanelChange(onDockChange),
        api.onDidLayoutChange(onDockChange),
        api.onDidMaximizedGroupChange(onDockChange),
      ];
      disposeRef.current = () => {
        clearTimeout(timer);
        workspace?.dispose();
        controller.dispose();
        for (const subscription of subscriptions) subscription.dispose();
        disposeAccessibility();
        disposeTabFill();
        resizeObserver.disconnect();
        useDockLayoutStore.getState().detach();
      };
    },
    [projectId, panels, storageKey, dockWidth, fixedLayout, initialCompactLayout],
  );

  return (
    <DockHeaderSlotsProvider>
      <SlotsContext.Provider value={{ slots, registerSlot }}>
        <DockviewReact
          key={projectId ?? ""}
          className="hf-dock flex-1 min-h-0"
          components={COMPONENTS}
          defaultTabComponent={DockTab}
          rightHeaderActionsComponent={DockStripActions}
          defaultRenderer="always"
          disableDnd={fixedLayout}
          disableFloatingGroups
          disableTabsOverflowList
          messages={{
            panelOpened: title => t('{title} opened', { title: t(title) }),
            panelClosed: title => t('{title} closed', { title: t(title) }),
            groupMaximized: title => t('{title} maximized', { title: t(title) }),
            groupRestored: title => t('{title} restored', { title: t(title) }),
          }}
          onReady={onReady}
        />
        {children}
      </SlotsContext.Provider>
    </DockHeaderSlotsProvider>
  );
}

function Panel({ id, title, children }: { id: PanelId; title?: string; children: ReactNode }) {
  const { t } = useI18n();
  const element = useSlots().slots[id];
  const visible = useDockLayoutStore((state) => state.visiblePanels.has(id));
  const controller = useDockLayoutStore((state) => state.controller);
  const open = useDockLayoutStore((state) => state.openPanels.has(id));
  const label = title ?? t(PANEL_DEFINITIONS[id].title);
  useEffect(() => {
    if (open) controller?.setTitle(id, label);
  }, [controller, id, label, open]);
  const definition: PanelDefinition = PANEL_DEFINITIONS[id];
  const shown = visible || definition.keepMounted;
  return element && shown ? createPortal(children, element) : null;
}

function WindowMenu() {
  const { t } = useI18n();
  const openPanels = useDockLayoutStore((state) => state.openPanels);
  const panels = useDockLayoutStore((state) => state.panels);
  const togglePanel = useDockLayoutStore((state) => state.togglePanel);
  const resetLayout = useDockLayoutStore((state) => state.resetLayout);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button variant="plain"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="h-7 px-2.5 rounded-md text-[11px] font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
      >
        {t("Window")}</Button>
      {open && (
        <div role="menu" className={`${menuClasses.panel} absolute right-0 top-8 z-50 w-44`}>
          {panels.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={openPanels.has(id)}
              onClick={() => togglePanel(id)}
              className={`${menuClasses.row} ${menuClasses.rowEnabled} flex items-center gap-2`}
            >
              <span className="w-3 text-accent-ink">{openPanels.has(id) && <Check size={12} />}</span>
              {t(PANEL_DEFINITIONS[id].title)}
            </button>
          ))}
          <div className={menuClasses.divider} />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              resetLayout();
              setOpen(false);
            }}
            className={`${menuClasses.row} ${menuClasses.rowEnabled}`}
          >
            {t("Reset layout")}</button>
        </div>
      )}
    </div>
  );
}

export const Dock = { Root, Panel, WindowMenu };
