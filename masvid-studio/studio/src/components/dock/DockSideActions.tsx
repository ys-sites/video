import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { IDockviewHeaderActionsProps } from "dockview-react";
import { RemixIcon } from "../../icons/RemixIcons";
import { useI18n } from "../../i18n/I18n";
import { IconButton, Tooltip } from "../ui";
import { TAB_CLICKS, TAB_ICONS } from "./DockTab";
import { clickMethod, trackStudioClick } from "../../motion/editorTracking";
import { useDockLayoutStore } from "./dockLayoutStore";
import { isPanelId, PANEL_DEFINITIONS } from "./panelRegistry";

/** A collapsed side keeps its Dockview group, tabs and preview sibling intact. */
export function DockSideActions({ group, panels }: Pick<IDockviewHeaderActionsProps, "group" | "panels" | "activePanel">) {
  const { t } = useI18n();
  const first = panels.find(panel => isPanelId(panel.id))?.id;
  const zone = isPanelId(first) ? PANEL_DEFINITIONS[first].zone : "center";
  const collapsedZones = useDockLayoutStore(state => state.collapsedZones);
  const collapsed = collapsedZones?.includes(zone) ?? false;
  const controller = useDockLayoutStore(state => state.controller);
  const activatePanel = useDockLayoutStore(state => state.activatePanel);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previous = useRef(collapsed);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (previous.current !== collapsed && restoreFocus.current) buttonRef.current?.focus({ preventScroll: true });
    restoreFocus.current = false;
    previous.current = collapsed;
  }, [collapsed]);
  if (!isPanelId(first) || zone === "center") return null;
  const label = t(zone === "left"
    ? collapsed ? "Expand left panel" : "Collapse left panel"
    : collapsed ? "Expand right panel" : "Collapse right panel");
  const unavailable = collapsed && controller?.canExpandSide?.(first) === false;
  const expandHint = t("Screen too small to expand this panel");
  const toggle = (
    <Tooltip label={unavailable ? expandHint : t(collapsed ? "Expand" : "Collapse")} side={collapsed ? zone === "left" ? "right" : "left" : "bottom"}>
      <IconButton ref={buttonRef} size={collapsed ? "lg" : "sm"} aria-label={label} disabled={unavailable}
        aria-expanded={!collapsed} icon={<RemixIcon name="arrow-right-s-line" size={16} mirrored={zone === "left" ? !collapsed : collapsed} />}
        onClick={event => { restoreFocus.current = true; controller?.setGroupCollapsed?.(first, !collapsed, event.detail > 0); controller?.rememberWorkspace?.(); }} />
    </Tooltip>
  );
  if (!collapsed) return <div className="hf-dock-side-actions">{toggle}</div>;
  return createPortal(
    <nav className="hf-dock-side-rail" aria-label={t(zone === "left" ? "Left panels" : "Right panels")}>
      <div className="hf-dock-side-rail-header">{toggle}</div>
      <div className="hf-dock-side-rail-divider" role="separator" />
      <div className="hf-dock-side-rail-items">
        {panels.map(panel => {
          if (!isPanelId(panel.id)) return null;
          const id = panel.id;
          const Icon = TAB_ICONS[id];
          const title = panel.title || t(PANEL_DEFINITIONS[id].title);
          return <Tooltip key={id} label={unavailable ? expandHint : title} side={zone === "left" ? "right" : "left"}>
            <IconButton size="lg" aria-label={title} aria-expanded={false} disabled={unavailable}
              icon={<Icon size={16} />} onClick={event => {
                // The rail opens a panel without going through its tab, so it reports the same tab click.
                const click = TAB_CLICKS[id as keyof typeof TAB_CLICKS];
                if (click) trackStudioClick(click[0], click[1], undefined, clickMethod(event));
                restoreFocus.current = true;
                controller?.setGroupCollapsed?.(id, false, event.detail > 0);
                activatePanel(id);
                controller?.rememberWorkspace?.();
              }} />
          </Tooltip>;
        })}
      </div>
    </nav>, group.element,
  );
}
