import { Button } from 'open-design-ui/button';
import { Tooltip } from '../components/ui/Tooltip';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useWorkspaceChrome } from './WorkspaceChromeContext';
import { preloadWorkspacePage, type LazyPageKey } from '../router/lazyPages';

export function WorkspaceResourceActions({ onBrandKit, brandKitOpen = false, closeMenu }: {
  onBrandKit: () => void; brandKitOpen?: boolean; closeMenu?: () => void;
}) {
  const { t } = useI18n();
  const { openAssets, assetsOpen } = useWorkspaceChrome();
  const actions: Array<{ label: string; icon: string; active: boolean; open: () => void; preload: LazyPageKey }> = [
    { label: t('Brand Kit'), icon: brandKitOpen ? 'palette-fill' : 'palette-line', active: brandKitOpen, open: onBrandKit, preload: 'brandKit' },
    { label: t('Workspace assets'), icon: assetsOpen ? 'folder-open-fill' : 'folder-line', active: assetsOpen, open: openAssets, preload: 'assets' },
  ];
  return actions.map(({ label, icon, active, open, preload }) => {
    const button = <Button key={label} type="button" variant="ghost" className={closeMenu ? 'om-nav-item' : 'om-nav-item om-header-icon'} aria-label={label}
      aria-current={active ? 'page' : undefined} onPointerEnter={() => preloadWorkspacePage(preload)} onFocus={() => preloadWorkspacePage(preload)} onClick={() => { closeMenu?.(); open(); }}>
      <RemixIcon name={icon} size={17} />{closeMenu && label}
    </Button>;
    return closeMenu ? button : <Tooltip key={label} label={label} side="bottom">{button}</Tooltip>;
  });
}
