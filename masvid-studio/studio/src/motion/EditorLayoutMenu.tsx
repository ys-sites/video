import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { IconButton, Menu, MenuRadioGroup, MenuRadioItem } from "../components/ui";
import { useDockLayoutStore } from "../components/dock/dockLayoutStore";
import { RemixIcon } from "../icons/RemixIcons";

type LayoutPreset = "fit" | "preview" | "edit";

export function EditorLayoutMenu() {
  const { t } = useI18n();
  const controller = useDockLayoutStore(state => state.controller);
  const [selectedPreset, setSelectedPreset] = useState<LayoutPreset>("edit");
  const selectPreset = (preset: LayoutPreset) => {
    if (!controller) return;
    setSelectedPreset(preset);
    if (preset === "fit") controller.fitTimeline?.();
    else controller.applyWorkspacePreset?.(preset);
  };

  return <Menu tooltip={t("Panels and layout")} modal={false} aria-label={t("Panels and layout")} align="end" className="motion-context-menu motion-editor-layout-menu"
    trigger={<IconButton aria-label={t("Panels and layout")} disabled={!controller} icon={<RemixIcon name="layout-2-line" size={16} />} />}>
    <div className="motion-menu-label">{t("Layout presets")}</div>
    <MenuRadioGroup value={selectedPreset} onValueChange={value => selectPreset(value as LayoutPreset)}>
      <MenuRadioItem value="fit">{t("Fit timeline to content")}</MenuRadioItem>
      <MenuRadioItem value="preview">{t("Focus preview")}</MenuRadioItem>
      <MenuRadioItem value="edit">{t("Restore default layout")}</MenuRadioItem>
    </MenuRadioGroup>
  </Menu>;
}
