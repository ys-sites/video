import { IconButton } from "open-design-ui/icon-button";
import { useI18n } from "../i18n/I18n";
import { usePlayerStore } from "../player";
import { RemixIcon, Magnet } from "../icons/RemixIcons";
import { Tooltip } from "./ui";
import { flatActive, flatIdle } from "./timelineToolbarStyles";
import { keyHint, useStudioKeys } from "../player/components/studioShortcuts";
import { trackStudioClick } from "../motion/editorTracking";

export function TimelineBehaviorToggles() {
  const { t } = useI18n();
  const keys = useStudioKeys();
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const setTimelineSnapEnabled = usePlayerStore((s) => s.setTimelineSnapEnabled);
  const timelineLinkageEnabled = usePlayerStore((s) => s.timelineLinkageEnabled);
  const setTimelineLinkageEnabled = usePlayerStore((s) => s.setTimelineLinkageEnabled);
  const rippleEditEnabled = usePlayerStore((s) => s.rippleEditEnabled);
  const setRippleEditEnabled = usePlayerStore((s) => s.setRippleEditEnabled);
  return <>
          <Tooltip
            side="bottom"
            label={`${t("Snapping ({value0})", { value0: keyHint("timelineSnap", keys) })} · ${t("Hold ⌘ / Ctrl to drag freely")}`}
          >
            <IconButton variant="plain"
              type="button"
              onClick={() => {
                trackStudioClick("timeline", "snap_toggle", undefined, undefined, timelineSnapEnabled ? "off" : "on");
                setTimelineSnapEnabled(!timelineSnapEnabled);
              }}
              aria-label={t("Snapping")}
              aria-pressed={timelineSnapEnabled}
              className={timelineSnapEnabled ? flatActive : flatIdle}
              icon={<Magnet size={16} weight="bold" aria-hidden="true" />}
            />
          </Tooltip>
<Tooltip
            label={t("Main track magnet: closes gaps after deletion. Undo ({shortcut}) restores the edit; turn this off to keep gaps.", { shortcut: keyHint("undo", keys) })}
          >
            <IconButton variant="plain"
              type="button"
              onClick={() => setRippleEditEnabled(!rippleEditEnabled)}
              aria-label={t("Main track magnet")}
              aria-pressed={rippleEditEnabled}
              className={rippleEditEnabled ? flatActive : flatIdle}
              icon={<RemixIcon name="align-item-left-line" size={16} />}
            />
          </Tooltip>
          <Tooltip label={t("Main track linkage")}>
            <IconButton variant="plain" type="button" aria-label={t("Main track linkage")}
              aria-pressed={timelineLinkageEnabled}
              onClick={() => setTimelineLinkageEnabled(!timelineLinkageEnabled)}
              className={timelineLinkageEnabled ? flatActive : flatIdle} icon={<RemixIcon name="link" size={16} />} />
          </Tooltip>
  </>;
}
