/** Floating action feedback for self-contained, non-React host documents. */
export function createInlineFeedback(root: HTMLElement) {
  const doc = root.ownerDocument, win = doc.defaultView!;
  const node = doc.createElement('div');
  node.className = 'motion-inline-toast'; node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite'); node.setAttribute('popover', 'manual'); node.hidden = true;
  let timer: number | undefined;
  function clear() {
    win.clearTimeout(timer); timer = undefined;
    try { node.hidePopover?.(); } catch { /* Hosts without a popover layer use fixed positioning. */ }
    node.hidden = true;
  }
  return {
    show(text: string) {
      clear(); if (!node.isConnected) root.append(node);
      node.textContent = text; node.hidden = false;
      try { node.showPopover?.(); } catch { /* Keep the fixed-position fallback visible. */ }
      timer = win.setTimeout(clear, 3000);
    },
    clear,
    destroy() { clear(); node.remove(); },
  };
}
