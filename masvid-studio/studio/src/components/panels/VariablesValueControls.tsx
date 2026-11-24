/**
 * Per-type preview-value inputs for the Variables panel. Text-like inputs
 * draft locally and commit on blur/Enter so the preview doesn't reload per
 * keystroke; discrete inputs (checkbox, select, color swatch, range) commit
 * immediately.
 */

import { ColorField } from "../editor/propertyPanelColor";
import { FieldInput, NativeSelect } from "../ui/FormField";
import { useState } from "react";
import type {
  CompositionVariable,
  EnumVariable,
  NumberVariable,
} from "@hyperframes/sdk";

export const VARIABLES_INPUT_CLASS =
  "w-full bg-neutral-900 border border-neutral-800 rounded-sm px-2 py-1 text-[10px] text-neutral-200 focus:outline-hidden focus:border-neutral-700";

export function variableDefaultText(decl: CompositionVariable): string {
  if (decl.type === "font" && typeof decl.default === "object") return decl.default.name;
  if (decl.type === "image" && typeof decl.default === "object") return decl.default.url;
  return String(decl.default);
}

/** Text input that drafts locally and commits on blur/Enter. */
function DraftTextInput({
  value,
  onCommit,
  type = "text",
  className = VARIABLES_INPUT_CLASS,
  maxLength,
  placeholder,
  min,
  max,
  step,
}: {
  value: string;
  onCommit: (raw: string) => void;
  type?: "text" | "number";
  className?: string;
  maxLength?: number;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <FieldInput
      type={type}
      value={draft ?? value}
      maxLength={maxLength}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={className}
    />
  );
}

function EnumControl({
  decl,
  current,
  onCommit,
}: {
  decl: EnumVariable;
  current: unknown;
  onCommit: (value: unknown) => void;
}) {
  return (
    <NativeSelect
      value={String(current)}
      onChange={(e) => onCommit(e.target.value)}
      className={VARIABLES_INPUT_CLASS}
    >
      {decl.options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </NativeSelect>
  );
}

// fallow-ignore-next-line complexity
function NumberControl({
  decl,
  current,
  onCommit,
}: {
  decl: NumberVariable;
  current: unknown;
  onCommit: (value: unknown) => void;
}) {
  const numberValue = typeof current === "number" ? current : Number(current) || 0;
  const hasRange = decl.min !== undefined && decl.max !== undefined;
  // Drag ticks stay local; commit once on release — each commit reloads the
  // whole preview iframe, so per-tick commits would thrash it.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const commitDrag = () => {
    if (dragValue !== null && dragValue !== numberValue) onCommit(dragValue);
    setDragValue(null);
  };
  const commitRaw = (raw: string) => {
    const n = Number(raw);
    onCommit(Number.isFinite(n) ? n : raw);
  };
  return (
    <div className="flex items-center gap-2">
      {hasRange && (
        <input
          type="range"
          min={decl.min}
          max={decl.max}
          step={decl.step ?? 1}
          value={dragValue ?? numberValue}
          onChange={(e) => setDragValue(Number(e.target.value))}
          onPointerUp={commitDrag}
          onKeyUp={commitDrag}
          onBlur={commitDrag}
          className="flex-1"
        />
      )}
      <DraftTextInput
        type="number"
        value={String(numberValue)}
        onCommit={commitRaw}
        min={decl.min}
        max={decl.max}
        step={decl.step}
        className={`${VARIABLES_INPUT_CLASS} ${hasRange ? "w-16" : "flex-1"} tabular-nums`}
      />
      {decl.unit && <span className="text-[9px] text-neutral-500">{decl.unit}</span>}
    </div>
  );
}

// Per-type dispatcher — one branch per variable type, same shape as BlockParamsPanel.
// fallow-ignore-next-line complexity
export function PreviewValueControl({
  decl,
  value,
  onCommit,
}: {
  decl: CompositionVariable;
  value: unknown;
  onCommit: (value: unknown) => void;
}) {
  const current = value === undefined ? decl.default : value;

  switch (decl.type) {
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={current === true}
          onChange={(e) => onCommit(e.target.checked)}
          className="h-3.5 w-3.5 accent-neutral-400"
        />
      );
    case "enum":
      return <EnumControl decl={decl} current={current} onCommit={onCommit} />;
    case "color":
      return (
        <ColorField
          layout="trigger"
          label={decl.label}
          value={typeof current === "string" ? current : "#000000"}
          allowCssValue
          onCommit={onCommit}
        />
      );
    case "number":
      return <NumberControl decl={decl} current={current} onCommit={onCommit} />;
    default: {
      // string / font (family name) / image (URL) — plain text input for v1.
      const textValue = typeof current === "string" ? current : JSON.stringify(current);
      return (
        <DraftTextInput
          value={textValue}
          onCommit={onCommit}
          maxLength={decl.type === "string" ? decl.maxLength : undefined}
          placeholder={decl.type === "string" ? decl.placeholder : undefined}
        />
      );
    }
  }
}
