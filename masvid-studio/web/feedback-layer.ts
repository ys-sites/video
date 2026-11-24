/** Keep transient feedback above native and shared application dialogs.
 * Parent it inside the active modal so its dismiss controls are not inert. */
export function mountFeedbackLayer(element: HTMLElement): () => void {
  const doc = element.ownerDocument;
  const marker = doc.createComment('feedback origin');
  element.before(marker);
  const originalPopover = element.getAttribute('popover');
  const canPopover = typeof element.showPopover === 'function';
  const modalSelector = 'dialog[open], [data-feedback-modal][data-open]';
  let dialogs = Array.from(doc.querySelectorAll<HTMLElement>(modalSelector));
  const isModal = (dialog: HTMLElement) => {
    if (!(dialog instanceof HTMLDialogElement)) return dialog.matches('[data-feedback-modal][data-open]');
    try { return dialog.matches(':modal'); } catch { return dialog.open; }
  };
  const refresh = () => {
    dialogs = dialogs.filter(dialog => dialog.isConnected && dialog.matches(modalSelector));
    const parent = dialogs.filter(isModal).at(-1) ?? doc.fullscreenElement ?? doc.body;
    if (canPopover && element.matches(':popover-open')) element.hidePopover();
    if (element.parentElement !== parent) parent.append(element);
    // Modal libraries may have classified this portal as outside before it moved.
    element.removeAttribute('aria-hidden');
    element.removeAttribute('data-base-ui-inert');
    if (canPopover) element.showPopover();
  };
  if (canPopover) element.setAttribute('popover', 'manual');
  refresh();
  const observer = new MutationObserver(records => {
    let changed = false;
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLElement
        && (record.target instanceof HTMLDialogElement || record.target.hasAttribute('data-feedback-modal'))) {
        const dialog = record.target;
        dialogs = dialogs.filter(item => item !== dialog);
        if (dialog.matches(modalSelector)) dialogs.push(dialog);
        changed = true;
      }
      if (record.type === 'childList') for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const added = [...(node.matches(modalSelector) ? [node] : []), ...node.querySelectorAll<HTMLElement>(modalSelector)];
        for (const dialog of added) if (!dialogs.includes(dialog)) { dialogs.push(dialog); changed = true; }
      }
      if (record.target === element && (element.hasAttribute('aria-hidden') || element.hasAttribute('data-base-ui-inert'))) changed = true;
    }
    if (changed || dialogs.some(dialog => !dialog.isConnected)) refresh();
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'data-open', 'data-feedback-modal', 'aria-hidden', 'data-base-ui-inert'] });
  const onToggle = (event: Event) => {
    const target = event.target;
    // An unrelated popover opened later must not cover existing feedback.
    if (target instanceof HTMLElement && target !== element && !target.hasAttribute('data-feedback-layer')
      && target.hasAttribute('popover') && target.matches(':popover-open')) refresh();
  };
  element.setAttribute('data-feedback-layer', '');
  doc.addEventListener('toggle', onToggle, true);
  doc.addEventListener('fullscreenchange', refresh);
  return () => {
    observer.disconnect();
    doc.removeEventListener('toggle', onToggle, true);
    doc.removeEventListener('fullscreenchange', refresh);
    if (canPopover && element.matches(':popover-open')) element.hidePopover();
    if (originalPopover === null) element.removeAttribute('popover');
    else element.setAttribute('popover', originalPopover);
    element.removeAttribute('data-feedback-layer');
    if (marker.parentNode) marker.replaceWith(element);
    else element.remove();
  };
}
