import type { SerializedDockview } from "dockview-react";
import { PANEL_IDS, isPanelId, type PanelId } from "./panelRegistry";

export const DOCK_PANEL_COMPONENT = "panel";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectLeafViews(node: unknown, into: unknown[]): boolean {
  if (!isRecord(node)) return false;
  if (node.type === "leaf") {
    if (!isRecord(node.data) || !Array.isArray(node.data.views)) return false;
    into.push(...node.data.views);
    return true;
  }
  if (node.type === "branch") {
    return Array.isArray(node.data) && node.data.every((child) => collectLeafViews(child, into));
  }
  return false;
}

function hasGridShape(grid: Record<string, unknown>): boolean {
  const oriented = grid.orientation === "HORIZONTAL" || grid.orientation === "VERTICAL";
  return oriented && typeof grid.width === "number" && typeof grid.height === "number";
}

function panelsAreRegistered(
  panels: Record<string, unknown>,
  allowed: readonly PanelId[],
): boolean {
  const ids = Object.keys(panels);
  return (
    ids.length > 0 &&
    ids.every((id) => {
      const state = panels[id];
      return (
        isPanelId(id) &&
        allowed.includes(id) &&
        isRecord(state) &&
        state.id === id &&
        state.contentComponent === DOCK_PANEL_COMPONENT
      );
    })
  );
}

function collectFloatingViews(floating: unknown, into: unknown[]): boolean {
  if (floating === undefined) return true;
  if (!Array.isArray(floating)) return false;
  return floating.every((group) => {
    if (!isRecord(group) || !isRecord(group.data) || !Array.isArray(group.data.views)) return false;
    into.push(...group.data.views);
    return true;
  });
}

/** Retire the duplicate Text tab without resetting saved editor widths. */
function migrateTextPanel(value: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(value.panels) || !('text' in value.panels)) return value;
  const legacy = value.panels.text;
  if (!isRecord(legacy) || legacy.id !== 'text' || legacy.contentComponent !== DOCK_PANEL_COMPONENT) return null;
  const originalViews: unknown[] = [];
  if (!isRecord(value.grid) || !collectLeafViews(value.grid.root, originalViews) || !collectFloatingViews(value.floatingGroups, originalViews) || !originalViews.includes('text')) return null;
  const next = structuredClone(value);
  const panels = next.panels as Record<string, unknown>, grid = next.grid as Record<string, unknown>;
  const replace = !panels.captions;
  if (replace) panels.captions = { ...legacy, id: 'captions', title: 'Captions' };
  delete panels.text;
  const groupIds: unknown[] = [];
  let captionGroup: unknown;
  const group = (data: unknown): boolean => {
    if (!isRecord(data) || !Array.isArray(data.views)) return false;
    const wasActive = data.activeView === 'text';
    data.views = data.views.flatMap(id => id === 'text' ? replace ? ['captions'] : [] : [id]);
    if (!(data.views as unknown[]).length) return false;
    if (wasActive) data.activeView = (data.views as unknown[]).includes('captions') ? 'captions' : (data.views as unknown[])[0];
    groupIds.push(data.id);
    if ((data.views as unknown[]).includes('captions')) captionGroup = data.id;
    return true;
  };
  const prune = (node: unknown): unknown => {
    if (!isRecord(node)) return null;
    if (node.type === 'leaf') return group(node.data) ? node : null;
    if (node.type !== 'branch' || !Array.isArray(node.data)) return null;
    node.data = node.data.map(prune).filter(Boolean);
    return (node.data as unknown[]).length ? node : null;
  };
  grid.root = prune(grid.root);
  if (!grid.root) return null;
  if (Array.isArray(next.floatingGroups)) next.floatingGroups = next.floatingGroups.filter(item => isRecord(item) && group(item.data));
  if (!groupIds.includes(next.activeGroup)) next.activeGroup = captionGroup || groupIds[0];
  return next;
}

/** Parses a stored layout at the trust boundary; null (stale or foreign shape) means use the default preset. */
export function parseDockLayout(
  value: unknown,
  allowed: readonly PanelId[] = PANEL_IDS,
): SerializedDockview | null {
  if (!isRecord(value) || !isRecord(value.grid) || !isRecord(value.panels)) return null;
  value = migrateTextPanel(value);
  if (!isRecord(value) || !isRecord(value.grid) || !isRecord(value.panels)) return null;
  const { grid, panels } = value;
  if (!hasGridShape(grid) || !panelsAreRegistered(panels, allowed)) return null;

  const views: unknown[] = [];
  if (!collectLeafViews(grid.root, views)) return null;
  if (!collectFloatingViews(value.floatingGroups, views)) return null;
  const everyViewIsAPanel = views.every((id) => typeof id === "string" && id in panels);
  const everyPanelIsPlaced = Object.keys(panels).every((id) => views.includes(id));
  return everyViewIsAPanel && everyPanelIsPlaced ? (value as unknown as SerializedDockview) : null;
}
