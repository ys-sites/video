import { ASSET_NAME_ERROR } from '../../../../shared/asset-names';
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18n";
import { filename } from "./assetHelpers";

/** Edits the existing caption without opening another floating surface. */
export function InlineAssetRename({ asset, displayName, onRename, onDone }: {
  asset: string;
  displayName?: string;
  onRename: (assetPath: string, displayName: string) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const original = displayName ?? filename(asset);
  const [draft, setDraft] = useState(original);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(0, original.length);
  }, [original, displayName]);
  const finish = () => {
    if (finished.current) return;
    const name = draft.trim();
    if (name && (name.length > 200 || /[\x00-\x1f\x7f]/.test(name))) {
      setInvalid(true);
      return;
    }
    finished.current = true;
    // Empty or unchanged names simply restore the existing caption.
    if (name && name !== original) {
      onRename(asset, name);
    }
    onDone();
  };
  return <div className="min-w-0 flex-1" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDragStart={e => { e.preventDefault(); e.stopPropagation(); }} onContextMenu={e => e.stopPropagation()}>
    <input ref={input} value={draft} maxLength={200} aria-label={t("Rename {value0}", { value0: original })} aria-invalid={invalid || undefined}
      className="motion-asset-name-input"
      onChange={e => { setDraft(e.target.value); setInvalid(false); }}
      onBlur={finish}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") { e.preventDefault(); finish(); }
        if (e.key === "Escape") { e.preventDefault(); finished.current = true; onDone(); }
      }} />
    {invalid && <span role="alert" className="text-[10px] text-danger-ink">{t(ASSET_NAME_ERROR)}</span>}
  </div>;
}
