import { OverflowText } from "../ui/OverflowText";
import { useMvpEditor } from "../../motion/StudioHost";
import { useCallback, useSyncExternalStore } from "react";
import { useI18n } from '../../i18n/I18n';
import {
  Aperture,
  BracketsCurly,
  ChartBarHorizontal,
  ClockCounterClockwise,
  Code,
  ClosedCaptioning,
  FileTxt,
  Comment,
  FilmSlate,
  FilmStrip,
  Image,
  Monitor,
  Presentation,
  SlidersHorizontal,
  Sparkle,
  Stack,
  X,
  type Icon,
} from "../../icons/RemixIcons";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import { isPanelId, PANEL_DEFINITIONS, type PanelId } from "./panelRegistry";
import { trackStudioClick } from "../../motion/editorTracking";

export const TAB_CLICKS = {
  compositions: ["left_panel", "tab_clips"],
  assets: ["left_panel", "tab_assets"],
  catalog: ["left_panel", "tab_catalog"],
  design: ["right_panel", "tab_properties"],
  layers: ["right_panel", "tab_layers"],
  renders: ["right_panel", "tab_export"],
} as const;

export const TAB_ICONS: Record<PanelId, Icon> = {
  preview: Monitor,
  timeline: ChartBarHorizontal,
  compositions: FilmStrip,
  assets: Image,
  transcript: FileTxt,
  captions: ClosedCaptioning,
  code: Code,
  catalog: Sparkle,
  design: SlidersHorizontal,
  layers: Stack,
  comments: Comment,
  renders: FilmSlate,
  variables: BracketsCurly,
  slideshow: Presentation,
  motionBlur: Aperture,
  history: ClockCounterClockwise,
  claude: Sparkle,
};

/**
 * A dock tab. dock.css shows the type icon and close glyph on the shown tab only, keyed on
 * dockview's own tab class, so they swap in the frame the tab changes rather than a render later.
 * MVP asset-side tabs stack their icons above labels; the inspector and preview keep text-only titles.
 */
export function DockTab({ api }: IDockviewPanelHeaderProps) {
  const { t } = useI18n();
  const mvp = useMvpEditor();
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = api.onDidTitleChange(onChange);
      return () => subscription.dispose();
    },
    [api],
  );
  const title = useSyncExternalStore(subscribe, () => api.title ?? "");
  const iconNavigation = mvp && isPanelId(api.id) && PANEL_DEFINITIONS[api.id].zone === "left";
  const TypeIcon = isPanelId(api.id) && (!mvp || iconNavigation || (PANEL_DEFINITIONS[api.id].zone === "center" && api.id !== "preview"))
    ? TAB_ICONS[api.id]
    : null;
  return (
    <div
      className="hf-dock-tab"
      data-icon-navigation={iconNavigation || undefined}
      data-preview-heading={mvp && api.id === "preview" || undefined}
      data-panel-zone={isPanelId(api.id) ? PANEL_DEFINITIONS[api.id].zone : undefined}
      // Capture runs before the dock activates the tab, so a press on the shown tab is not a switch.
      onPointerDownCapture={(event) => {
        const click = mvp && event.button === 0 && !api.isVisible ? TAB_CLICKS[api.id as keyof typeof TAB_CLICKS] : undefined;
        if (click) trackStudioClick(click[0], click[1], undefined, "pointer");
      }}
    >
      {TypeIcon ? <TypeIcon className="hf-dock-tab-icon" size={iconNavigation ? 16 : 14} aria-hidden /> : null}
      <OverflowText text={title} className="hf-dock-tab-label" />
      {/* Same shape as dockview's own close control: a tab cannot hold a focusable button. */}
      {!mvp && (
        <div
          role="button"
          tabIndex={-1}
          aria-label={t('Close {title}', { title })}
          className="hf-dock-tab-close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            api.close();
          }}
        >
          <X size={12} aria-hidden />
        </div>
      )}
    </div>
  );
}
