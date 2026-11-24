import { Button } from "open-design-ui/button";
import { FieldInput } from "../ui/FormField";
import { useI18n } from "../../i18n/I18n";
import { useEffect, useRef, useState } from "react";

/** Editable slider values commit on Enter or blur. */
export function FlatSliderReadout({
  label,
  displayValue,
  appearance,
  tier,
  disabled,
  onCommitText,
  onCommitted,
}: {
  label: string;
  displayValue: string;
  appearance?: "input";
  tier: "default" | "explicitCustom";
  disabled?: boolean;
  /** Receives the raw text; return false to refuse it and keep the field open. */
  onCommitText?: (text: string) => boolean | void;
  /** Fires after an accepted commit, for telemetry. */
  onCommitted?: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editable = Boolean(onCommitText) && !disabled;
  const alwaysInput = appearance === "input";
  const editing = text !== null;

  useEffect(() => {
    if (!editing || alwaysInput) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [alwaysInput, editing]);

  const begin = () => {
    setText(displayValue);
    setInvalid(false);
  };
  // Enter and blur both commit, so a value typed and then clicked away from is
  // not silently dropped. A refused value stays open on Enter (the author is
  // still there to fix it) and is discarded on blur (they have moved on).
  const commit = (keepOpenIfRefused: boolean) => {
    if (text === null) return;
    if (alwaysInput && text.trim() === displayValue) {
      setText(null);
      setInvalid(false);
      return;
    }
    const accepted = onCommitText?.(text.trim());
    if (accepted === false && keepOpenIfRefused) {
      setInvalid(true);
      inputRef.current?.select();
      return;
    }
    setText(null);
    setInvalid(false);
    if (accepted !== false) onCommitted?.();
  };

  if (alwaysInput || editing) {
    return (
      <FieldInput density={alwaysInput ? "compact" : "intrinsic"}
        ref={inputRef}
        data-flat-slider-input={alwaysInput ? undefined : "true"}
        aria-label={t("{label} value", { label: label })}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        readOnly={alwaysInput && !onCommitText}
        value={text ?? displayValue}
        spellCheck={false}
        onFocus={alwaysInput ? (event) => event.currentTarget.select() : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) {
            e.stopPropagation();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            commit(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setText(null);
            setInvalid(false);
          }
          // Keep the timeline's own shortcuts from firing on every keystroke.
          e.stopPropagation();
        }}
        onBlur={() => commit(false)}
        style={alwaysInput ? { inlineSize: `clamp(56px, calc(${(text ?? displayValue).length}ch + var(--motion-space-20)), 88px)` } : undefined}
        className={alwaysInput ? "shrink-0 text-right font-mono tabular-nums" : `w-11 shrink-0 rounded-[3px] border bg-panel-surface px-1 text-right font-mono text-[10px] text-panel-text-0 outline-none ${
          invalid ? "border-dashed border-danger-ink" : "border-panel-accent"
        }`}
      />
    );
  }

  const valueClass = `w-11 shrink-0 text-right font-mono text-[10px] ${tier === "explicitCustom" ? "text-panel-text-0" : "text-panel-text-3"}`;
  if (!editable) return <span data-flat-slider-value="true" className={valueClass}>{displayValue}</span>;
  return (
    <Button type="button" variant="plain" data-flat-slider-value="true"
      className={`${valueClass} cursor-text rounded-[3px] hover:bg-panel-hover hover:text-panel-text-0`}
      title={t("Click to type a value")} onClick={begin}>
      {displayValue}
    </Button>
  );
}
