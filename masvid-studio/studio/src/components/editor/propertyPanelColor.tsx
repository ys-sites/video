import { FieldInput, FieldTrigger } from "../ui/FormField";
import { MenuPanel } from "../ui/MenuPanel";
import { Popover } from "../ui/Popover";
import { Select } from "../ui/Select";
import { PropertyLabel } from "./PropertyLabel";
import { useI18n } from "../../i18n/I18n";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  formatCssColor,
  hsvToRgb,
  parseCssColor,
  rgbToHsv,
  toHexColor,
  type ParsedColor,
} from "./colorValue";
import { colorFromCss } from "./propertyPanelHelpers";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useInspectorGestureTransaction } from "./useInspectorGestureTransaction";

const COLOR_FORMATS = [{ label: "RGBA", value: "rgba" }, { label: "HEX", value: "hex" }];
const CSS_COLOR_FORMATS = [...COLOR_FORMATS, { label: "CSS", value: "css" }];
const OPAQUE_COLOR_FORMATS = [{ label: "RGB", value: "rgba" }, COLOR_FORMATS[1]!];
const COLOR_CHANNELS = [
  { key: "red", label: "Red", max: 255 },
  { key: "green", label: "Green", max: 255 },
  { key: "blue", label: "Blue", max: 255 },
  { key: "alpha", label: "Alpha", max: 1 },
] as const;

function ColorChannelInput({ label, value, max, disabled, onCommit }: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <FieldInput
      density="compact"
      aria-label={label}
      disabled={disabled}
      inputMode={max === 1 ? "decimal" : "numeric"}
      className="w-full tabular-nums"
      value={draft ?? String(value)}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={event => {
        const raw = event.currentTarget.value.trim();
        const next = Number(raw);
        setDraft(null);
        if (!raw || !Number.isFinite(next) || next === value) return;
        onCommit(Math.min(max, Math.max(0, next)));
      }}
      onKeyDown={event => {
        if (event.key === "Escape") event.currentTarget.value = String(value);
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  ColorSlider                                                        */
/* ------------------------------------------------------------------ */

function ColorSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  background,
  thumbColor,
  transparency,
  disabled,
  onPreview,
  onInteractionStart,
  onInteractionEnd,
  onInteractionCancel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  background: string;
  thumbColor: string;
  transparency?: boolean;
  disabled?: boolean;
  onPreview: (nextValue: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onInteractionCancel: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const percent = ((value - min) / (max - min)) * 100;

  const previewFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const rawValue = min + ((clientX - rect.left) / rect.width) * (max - min);
    const stepped = Math.round(rawValue / step) * step;
    onPreview(Math.max(min, Math.min(max, stepped)));
  };

  const previewKeyboardValue = (nextValue: number) => {
    onPreview(Math.max(min, Math.min(max, nextValue)));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={displayValue}
      aria-disabled={disabled}
      className={`relative h-5 touch-none rounded-sm ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-ew-resize"
      }`}
      onPointerDown={(event) => {
        if (disabled) return;
        onInteractionStart();
        event.currentTarget.setPointerCapture(event.pointerId);
        previewFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        onInteractionEnd();
        event.currentTarget.blur();
      }}
      onPointerCancel={onInteractionCancel}
      onPointerMove={(event) => {
        if (disabled || event.buttons !== 1) return;
        previewFromClientX(event.clientX);
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onInteractionCancel();
          return;
        }
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onInteractionStart();
          previewKeyboardValue(value + step);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onInteractionStart();
          previewKeyboardValue(value - step);
        } else if (event.key === "Home") {
          event.preventDefault();
          onInteractionStart();
          previewKeyboardValue(min);
        } else if (event.key === "End") {
          event.preventDefault();
          onInteractionStart();
          previewKeyboardValue(max);
        }
      }}
      onKeyUp={(event) => {
        if (
          ["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Home", "End"].includes(event.key)
        ) {
          onInteractionEnd();
        }
      }}
      onBlur={onInteractionEnd}
    >
      <div aria-hidden="true" className={`motion-color-picker-track ${transparency ? "motion-color-checkerboard" : ""}`}>
        <span className="absolute inset-0" style={{ background }} />
      </div>
      <div
        aria-hidden="true"
        className="motion-color-picker-marker size-3.5"
        style={{ top: "50%", left: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: thumbColor }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ColorField                                                         */
/* ------------------------------------------------------------------ */

export function ColorField({
  label,
  value,
  disabled,
  layout = "row",
  opaque = false,
  allowCssValue = false,
  mixed,
  swatchBackground,
  onPickerOpenChange,
  onPreview,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  layout?: "row" | "stacked" | "trigger";
  opaque?: boolean;
  allowCssValue?: boolean;
  mixed?: boolean;
  swatchBackground?: string;
  onPickerOpenChange?: (open: boolean) => void;
  onPreview?: (nextValue: string) => void;
  onCommit: (nextValue: string) => void | Promise<unknown>;
}) {
  const { t } = useI18n();
  const track = useTrackDesignInput();
  const pickerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("rgba");
  const [lastHue, setLastHue] = useState(0);
  const [cssDraft, setCssDraft] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState<ParsedColor>(() => colorFromCss(value));
  const draftColorRef = useRef(draftColor);
  draftColorRef.current = draftColor;
  const [hexDraft, setHexDraft] = useState(() => toHexColor(colorFromCss(value)).toUpperCase());
  const hsv = rgbToHsv(draftColor);
  const hue = hsv.saturation === 0 ? lastHue : hsv.hue;
  const hueColor = formatCssColor({
    ...hsvToRgb({ hue, saturation: 1, value: 1 }),
    alpha: 1,
  });
  const opaqueColor = formatCssColor({ ...draftColor, alpha: 1 });
  const currentColor = formatCssColor(draftColor);
  const displayColor = open ? draftColor : parseCssColor(value);
  const displayHex = displayColor ? toHexColor(displayColor).toUpperCase() : value;
  const displayAlpha = displayColor ? Math.round(displayColor.alpha * 100) : 100;
  const alphaPercent = Math.round(draftColor.alpha * 100);

  const updateColorDraft = useCallback((nextValue: string, source: "hex" | "picker") => {
    const nextColor = parseCssColor(nextValue);
    if (!nextColor) return;
    setDraftColor(nextColor);
    if (source === "picker") setHexDraft(toHexColor(nextColor).toUpperCase());
  }, []);
  const resolveColorGestureValue = useCallback((nextValue: string) => {
    const source = nextValue.startsWith("#") ? "hex" : "picker";
    // Only a COMPLETE hex resolves, so a half-typed one neither previews nor
    // commits. 3 and 6 digits count as complete (the field edits RGB only): gating on
    // 6 alone silently dropped #F00 and friends, which the old onBlur committed.
    if (source === "hex" && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(nextValue)) return null;
    const nextColor = parseCssColor(nextValue);
    if (!nextColor) return null;
    return {
      source,
      value: formatCssColor({
        ...nextColor,
        alpha: source === "hex" ? draftColorRef.current.alpha : nextColor.alpha,
      }),
    } as const;
  }, []);
  const persistColorValue = useCallback(
    (nextValue: string) => {
      if (nextValue !== value) track("color", label);
      return onCommit(nextValue);
    },
    [label, onCommit, track, value],
  );
  const {
    begin: beginColorGesture,
    preview: previewColorGesture,
    settle: settleColorGesture,
    cancel: cancelColorGesture,
  } = useInspectorGestureTransaction({
    sourceValue: parseCssColor(value) ? formatCssColor(colorFromCss(value)) : value,
    onPreview: (nextValue) => {
      const resolved = resolveColorGestureValue(nextValue);
      if (!resolved) return;
      updateColorDraft(resolved.value, resolved.source);
      onPreview?.(resolved.value);
    },
    onCommit: (nextValue) => {
      const resolved = resolveColorGestureValue(nextValue);
      if (!resolved) return;
      // Source parameters and palettes also consume color strings in code.
      const color = colorFromCss(resolved.value);
      const next = opaque || (allowCssValue && color.alpha === 1)
        ? toHexColor(color)
        : resolved.value;
      return persistColorValue(next);
    },
  });

  useEffect(() => {
    const nextColor = colorFromCss(value);
    setDraftColor(nextColor);
    setHexDraft(toHexColor(nextColor).toUpperCase());
  }, [value]);

  const previewColor = (nextColor: ParsedColor) => {
    previewColorGesture(formatCssColor(nextColor));
  };

  const commitHsv = (nextHsv: { hue?: number; saturation?: number; value?: number }) => {
    const nextHue = nextHsv.hue ?? hue;
    setLastHue(nextHue);
    const rgb = hsvToRgb({
      hue: nextHue,
      saturation: nextHsv.saturation ?? hsv.saturation,
      value: nextHsv.value ?? hsv.value,
    });
    previewColor({ ...rgb, alpha: draftColorRef.current.alpha });
  };

  const updateSaturationValue = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    const saturation = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextValue = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    commitHsv({ saturation, value: nextValue });
  };

  const handleHexChange = (nextHex: string) => {
    setHexDraft(nextHex);
    const normalized = nextHex.trim().startsWith("#") ? nextHex.trim() : `#${nextHex.trim()}`;
    beginColorGesture();
    previewColorGesture(normalized);
  };

  const renderPicker = (trigger: ReactElement) => (
    <Popover
      trigger={trigger}
      open={open}
      modal
      side={onPickerOpenChange ? "bottom" : "left"}
      align="start"
      initialFocus={false}
      finalFocus={onPickerOpenChange ? false : undefined}
      aria-label={t("{label} color picker", { label })}
      className="motion-color-picker motion-positioned-menu"
      renderPanel={<MenuPanel ref={pickerRef} data-menu-layout="custom" />}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) {
          setHexDraft(toHexColor(draftColorRef.current).toUpperCase());
        } else if (details.reason === "escape-key") {
          cancelColorGesture();
          setCssDraft(null);
        } else {
          // Channel inputs commit on blur. Flush them while an inline text
          // selection is still retained by the picker owner.
          pickerRef.current?.querySelector<HTMLElement>(":focus")?.blur();
          settleColorGesture();
        }
        setOpen(nextOpen);
        onPickerOpenChange?.(nextOpen);
      }}
    >
      <div
        className="motion-color-picker-spectrum relative shrink-0 touch-none cursor-crosshair"
        style={{ backgroundColor: hueColor }}
        onPointerDown={(event) => {
          beginColorGesture();
          event.currentTarget.setPointerCapture(event.pointerId);
          updateSaturationValue(event.clientX, event.clientY, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateSaturationValue(event.clientX, event.clientY, event.currentTarget);
        }}
        onPointerUp={settleColorGesture}
        onPointerCancel={cancelColorGesture}
      >
        <div
          aria-hidden="true"
          className="motion-color-picker-marker size-3.5"
          style={{
            left: `${hsv.saturation * 100}%`,
            top: `${(1 - hsv.value) * 100}%`,
            backgroundColor: opaqueColor,
          }}
        />
      </div>

      <div className="flex shrink-0 flex-col gap-0.5">
        <ColorSlider
          label={t("Hue")}
          value={hue}
          min={0}
          max={360}
          step={1}
          displayValue={`${Math.round(hue)}°`}
          background="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
          thumbColor={hueColor}
          disabled={disabled}
          onInteractionStart={beginColorGesture}
          onPreview={(nextHue) => commitHsv({ hue: nextHue })}
          onInteractionEnd={settleColorGesture}
          onInteractionCancel={cancelColorGesture}
        />
        {!opaque && (
          <ColorSlider
            label={t("Alpha")}
            value={draftColor.alpha}
            min={0}
            max={1}
            step={0.01}
            displayValue={`${alphaPercent}%`}
            background={`linear-gradient(90deg, transparent, ${opaqueColor})`}
            thumbColor={currentColor}
            transparency
            disabled={disabled}
            onInteractionStart={beginColorGesture}
            onPreview={(nextAlpha) =>
              previewColor({ ...draftColorRef.current, alpha: nextAlpha })
            }
            onInteractionEnd={settleColorGesture}
            onInteractionCancel={cancelColorGesture}
          />
        )}
      </div>

      <Select
        appearance="boxed"
        className="shrink-0 self-start"
        label={t("Color format")}
        value={format}
        options={opaque ? OPAQUE_COLOR_FORMATS : allowCssValue ? CSS_COLOR_FORMATS : COLOR_FORMATS}
        onCommit={setFormat}
      />

      {format === "css" ? (
        <FieldInput
          density="compact"
          aria-label="CSS"
          disabled={disabled}
          value={cssDraft ?? value}
          onChange={(event) => setCssDraft(event.currentTarget.value)}
          onBlur={() => {
            if (cssDraft !== null && cssDraft !== value) persistColorValue(cssDraft);
            setCssDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-full font-mono"
          spellCheck={false}
        />
      ) : format === "rgba" ? (
        <div className={`grid shrink-0 gap-2 ${opaque ? "grid-cols-3" : "grid-cols-4"}`}>
          {COLOR_CHANNELS.slice(0, opaque ? 3 : 4).map(({ key, label: channelLabel, max }) => (
            <ColorChannelInput
              key={key}
              label={t(channelLabel)}
              value={draftColor[key]}
              max={max}
              disabled={disabled}
              onCommit={next => {
                previewColor({ ...draftColorRef.current, [key]: next });
                settleColorGesture();
              }}
            />
          ))}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <FieldInput
            density="compact"
            value={hexDraft}
            disabled={disabled}
            aria-label={t("Hex")}
            onChange={(event) => handleHexChange(event.target.value)}
            onBlur={settleColorGesture}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="min-w-0 w-full font-mono"
            spellCheck={false}
          />
          {!opaque && <output aria-label={t("Alpha")} className="min-w-10 text-right text-[11px] tabular-nums">{alphaPercent}%</output>}
        </div>
      )}
    </Popover>
  );

  const picker = renderPicker(
    <FieldTrigger
      data-flat-color-trigger="true"
      data-color-field-layout={layout}
      disabled={disabled}
      aria-label={t("Pick {value0} color", { value0: label.toLowerCase() })}
      className="flex h-8 min-w-0 shrink-0 items-center px-2 text-xs"
    >
      <span aria-hidden="true" className="motion-color-checkerboard relative size-3.5 shrink-0 overflow-hidden rounded-[3px] border border-panel-hairline">
        <span
          data-color-field-swatch
          className="absolute inset-0"
          style={open || !swatchBackground
            ? { backgroundColor: open ? currentColor : value || "transparent" }
            : { background: swatchBackground }}
        />
      </span>
      <span
        data-color-mixed-indicator={mixed && !open ? "true" : undefined}
        className="min-w-0 flex-1 truncate px-1 text-left tabular-nums"
      >
        {mixed && !open ? t("Mixed") : displayHex.replace(/^#/, "")}
      </span>
      <span className="flex h-5 shrink-0 items-center gap-1 border-l border-panel-hairline pl-1 tabular-nums">
        <span className="min-w-5 text-right">{displayAlpha}</span>
        <span className={disabled ? undefined : "text-panel-text-4"}>%</span>
      </span>
    </FieldTrigger>,
  );

  if (layout === "trigger") return picker;
  return (
    <div className={layout === "stacked" ? "grid min-w-0 gap-1.5" : "flex items-center justify-between gap-2"}>
      <PropertyLabel label={label} className="text-panel-text-2" />
      {picker}
    </div>
  );
}
