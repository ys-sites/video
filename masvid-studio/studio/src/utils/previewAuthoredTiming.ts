/** Mounted scenes can consume public timing attributes. Keep their preserved
 * authoring values current so a later runtime manifest cannot undo a hand edit. */
export function syncPreservedPreviewTiming(element: Element, name: string, value: string | null): void {
  if (name !== "data-duration" && name !== "data-end") return;
  const preserved = name.replace("data-", "data-hf-authored-");
  if (!element.hasAttribute(preserved)) return;
  if (value === null) element.removeAttribute(preserved);
  else element.setAttribute(preserved, value);
}
