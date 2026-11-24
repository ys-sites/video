import { IconButton } from 'open-design-ui/icon-button';
import { Tooltip } from "../components/ui/Tooltip";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Popover } from '@base-ui/react/popover';
import { POPUP_LAYER, popupSurface } from '../components/ui/Menu';
import { MotionIcon } from './icons';
import { useI18n } from '../i18n/I18n';

/** A transient project preview never changes the pinned navigation width. */
export function WorkspaceProjectsButton({ expanded, previewEnabled, onToggle, children, applicationRef }: {
  applicationRef: RefObject<HTMLDivElement | null>;
  expanded: boolean;
  previewEnabled: boolean;
  onToggle: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const [previewOpen, setPreviewOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const open = previewEnabled && previewOpen;
  // Anchor to the workspace, so the overlay occupies the pinned sidebar's exact
  // top and bottom bounds even when the viewport or host layout changes.
  const workspaceAnchor = useCallback(() => applicationRef.current?.querySelector<HTMLElement>(':scope > .motion-workspace') ?? null, [applicationRef]);
  useEffect(() => { if (!previewEnabled) setPreviewOpen(false); }, [previewEnabled]);
  return <Popover.Root open={open} modal={false} onOpenChange={(next, details) => {
    // A press pins/unpins the full sidebar; only hover owns this floating view.
    if (details.reason === 'trigger-press') { details.cancel(); return; }
    // Moving the pointer away must not dismiss a search the user is typing in.
    if (!next && details.reason === 'trigger-hover' && popup.current !== document.activeElement && popup.current?.contains(document.activeElement)) {
      details.cancel(); return;
    }
    setPreviewOpen(previewEnabled && next);
  }}>
    <Tooltip label={t(expanded ? 'Close project list' : 'Open project list')} wrap side="bottom"><Popover.Trigger ref={trigger} openOnHover={previewEnabled} delay={180} closeDelay={160}
      render={<IconButton variant="ghost" className="motion-icon-button" aria-label={t(expanded ? 'Close project list' : 'Open project list')} icon={<MotionIcon name="sidebar" size={16} />} />}
      aria-expanded={expanded || open} aria-controls="om-project-navigation"
      onClick={() => { setPreviewOpen(false); onToggle(); }}>
    </Popover.Trigger></Tooltip>
    <Popover.Portal container={applicationRef} style={{ display: 'contents' }}>
      <Popover.Positioner anchor={workspaceAnchor} positionMethod="fixed" side="left" align="start"
        sideOffset={({ positioner }) => -positioner.width} collisionPadding={0}
        collisionAvoidance={{ side: 'none', align: 'none', fallbackAxisSide: 'none' }} className={POPUP_LAYER}>
        <Popover.Popup ref={popup} aria-label={t('Project list')} initialFocus={false}
          finalFocus={() => popup.current?.contains(document.activeElement) ? trigger.current : false}
          className={`${popupSurface} om-project-flyout`}>
          {children(() => setPreviewOpen(false))}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
