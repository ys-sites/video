import { PropertyLabel } from "./PropertyLabel";
import { useI18n } from "../../i18n/I18n";
/* ------------------------------------------------------------------ */
/*  FlatToggle — inspector switch row                                  */
/*  (split out of propertyPanelFlatPrimitives.tsx to stay under the    */
/*  600-line file-size gate)                                           */
/* ------------------------------------------------------------------ */

import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";

export function FlatToggle({
  label,
  checked,
  disabled,
  size = "compact",
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  size?: "compact" | "standard";
  onChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const track = useTrackDesignInput();
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-2">
      <PropertyLabel data-flat-toggle-label="true" label={t(label)} className={checked ? "text-panel-text-2" : "text-panel-text-3"} />
      <button
        type="button"
        data-flat-toggle="true"
        role="switch"
        aria-checked={checked}
        aria-label={t(label)}
        disabled={disabled}
        onClick={() => {
          track("toggle", label);
          onChange(!checked);
        }}
        className={size === "standard" ? "om-switch" : `relative h-[14px] w-6 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-panel-accent/35" : "bg-panel-hover"
        }`}
      >
        {size === "compact" && <span
          data-flat-toggle-knob="true"
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${
            checked ? "right-0.5 bg-panel-accent" : "left-0.5 bg-panel-text-4"
          }`}
        />}
      </button>
    </div>
  );
}
