import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import type { ExploreCommunity } from '../../../shared/studio-catalog';
import { BrandLogo } from '../../../packages/design-system/react/BrandLogo';
import { brand } from '../../../packages/design-system/index.js';
import { RemixIcon } from '../icons/RemixIcons';
import { Menu, MenuItem, MenuSeparator, MenuSubmenu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { Tooltip } from '../components/ui/Tooltip';
import { languages, useI18n, type Locale } from '../i18n/I18n';
import { setStudioTheme, useStudioThemePreference } from '../utils/studioTheme';
import { useWorkspaceChrome } from './WorkspaceFrame';
import { useAccountSummary } from './AccountSettings';
import { clickMethod, clickOption, trackStudioClick } from './editorTracking';
import { repositorySupportLinks } from './githubRepository';
import type { SettingsSection } from './workspacePageRouting';
import { useLayoutEffect, useRef, useState } from 'react';

import { CreativeNavigation, type CreativeNavigationProps } from './CreativeNavigation';
import { WorkspaceResourceActions } from './WorkspaceResourceActions';
import { WorkspaceSearch } from './WorkspaceSearch';
import { preloadWorkspacePage } from '../router/lazyPages';

const avatarSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const themeLabels = { light: 'Light', dark: 'Dark', system: 'System' } as const;

export function ApplicationHeader({ settings, atExploreHome, onSkill, openAsset, onCommunity, openSettings, ...navigation }: CreativeNavigationProps & {
  onSkill: (id: string) => void;
  atExploreHome: boolean;
  settings: SettingsSection | null;
  openSettings: (section: SettingsSection) => void;
  openAsset: (assetId: string, version: string) => void;
  onCommunity: (community: ExploreCommunity) => void;
}) {
  const { t } = useI18n();
  const { openAssets, openHome } = useWorkspaceChrome();
  const homeHint = atExploreHome ? undefined : t('Back to Explore');
  const header = useRef<HTMLElement>(null);
  const [compactActions, setCompactActions] = useState(false);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setCompactActions(entry.contentRect.width <= 560));
    observer.observe(header.current!);
    return () => observer.disconnect();
  }, []);

  function workspaceActions(closeMenu?: () => void) {
    return <>
      <WorkspaceSearch onChoose={closeMenu} onSkill={onSkill} destination={navigation.destination} onLibrary={openAssets} onAccount={() => openSettings('account')} onAsset={openAsset} onScene={navigation.onNavigate} onStudio={navigation.onChooseStudio} onCommunity={onCommunity} />
      <WorkspaceResourceActions onBrandKit={() => openSettings('brand-kit')} brandKitOpen={settings === 'brand-kit'} closeMenu={closeMenu} />
    </>;
  }

  return <header ref={header} className="om-app-header">
    <Tooltip label={homeHint} side="bottom"><Button variant="plain" type="button" className="om-nav-item om-app-brand" onPointerEnter={() => preloadWorkspacePage('explore')} onFocus={() => preloadWorkspacePage('explore')} onClick={openHome} aria-label={homeHint ? `${brand.editorName} · ${homeHint}` : brand.editorName}><BrandLogo variant="editor" compact /></Button></Tooltip>
    <CreativeNavigation {...navigation} overflowActions={compactActions ? workspaceActions : undefined} />
    <div className="om-app-header-actions">
      {!compactActions && workspaceActions()}
      {/* Masvid Studio: upstream community, GitHub and Pricing links removed. */}
      <ApplicationAccountMenu settings={settings} openSettings={openSettings} />
    </div>
  </header>;
}
export function WorkspaceUtilityActions({ openSettings }: { openSettings: (section: SettingsSection) => void }) {
  const { t } = useI18n();
  const item = (label: string, icon: string, action: () => void) => (
    <Tooltip label={t(label)} side="top">
      <IconButton variant="ghost" className="motion-icon-button" aria-label={t(label)} onPointerEnter={() => preloadWorkspacePage('settings')} onFocus={() => preloadWorkspacePage('settings')} onClick={action} icon={<RemixIcon name={icon} size={18} />} />
    </Tooltip>
  );
  return <nav className="motion-sidebar-utilities" aria-label={t('Application navigation')}>
    {item('Settings', 'settings-3-line', () => openSettings('general'))}
    {item('Model providers', 'brain-line', () => openSettings('providers'))}
    {item('Help', 'question-line', () => openSettings('help'))}
  </nav>;
}

export function ApplicationAccountMenu({ settings, openSettings }: { settings: SettingsSection | null; openSettings: (section: SettingsSection) => void }) {
  const { t, locale, setLocale } = useI18n();
  const { account } = useAccountSummary();
  const theme = useStudioThemePreference();
  const userName = account?.user?.name?.trim() || account?.user?.email?.trim() || t('Account');
  const avatarInitial = avatarSegmenter.segment(userName)[Symbol.iterator]().next().value?.segment;
  return <Menu tooltip={t('Account menu')} modal={false} side="bottom" align="end" aria-label={t('Account menu')} className="om-account-menu om-selection-panel om-menu-panel" trigger={<Button variant="plain" type="button" className="om-nav-item om-account-trigger" aria-current={settings === 'account' || settings === 'subscription' ? 'page' : undefined} aria-label={t('Account menu')} onPointerEnter={() => preloadWorkspacePage('settings')} onFocus={() => preloadWorkspacePage('settings')}><span className="om-avatar" aria-hidden="true">{account?.state === 'signed-in' ? avatarInitial : <><RemixIcon className="om-default-avatar-icon om-default-avatar-icon-outline" name="user-3-line" size={14} /><svg className="om-default-avatar-icon om-default-avatar-icon-solid" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 22H4V20C4 17.2386 6.23858 15 9 15H15C17.7614 15 20 17.2386 20 20V22ZM12 13C8.68629 13 6 10.3137 6 7C6 3.68629 8.68629 1 12 1C15.3137 1 18 3.68629 18 7C18 10.3137 15.3137 13 12 13Z" /></svg></>}</span></Button>}>
      <MenuItem onClick={() => openSettings('account')}><span className="om-menu-label"><RemixIcon name="user-3-line" size={16} /><strong>{userName}</strong></span></MenuItem><MenuSeparator />
      <MenuItem onClick={() => openSettings('subscription')}><span className="om-menu-label"><RemixIcon name="bank-card-line" size={16} />{t('Subscription & usage')}</span></MenuItem>
      <MenuSeparator />
      <MenuItem onClick={() => openSettings('general')}><span className="om-menu-label"><RemixIcon name="settings-3-line" size={16} />{t('Settings')}</span></MenuItem>
      <MenuSubmenu aria-label={t('Appearance')} className="om-selection-panel om-menu-panel" label={<span className="om-menu-label"><RemixIcon name="sun-line" size={16} />{t('Appearance')}</span>} detail={t(themeLabels[theme])}>
        <MenuRadioGroup value={theme}>
          {(['light', 'dark', 'system'] as const).map(value => (
            <MenuRadioItem key={value} value={value} closeOnClick onClick={event => {
              if (theme === value) return;
              trackStudioClick('settings', 'theme_toggle', undefined, clickMethod(event), clickOption(value));
              setStudioTheme(value);
            }}>
              {t(themeLabels[value])}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubmenu>
      <MenuSubmenu aria-label={t('Language')} className="om-selection-panel om-menu-panel" label={<span className="om-menu-label"><RemixIcon name="global-line" size={16} />{t('Language')}</span>} detail={languages.find(language => language.locale === locale)?.label}>
        <MenuRadioGroup value={locale} onValueChange={value => setLocale(value as Locale)}>{languages.map(language => <MenuRadioItem key={language.locale} value={language.locale} closeOnClick>{language.label}</MenuRadioItem>)}</MenuRadioGroup>
      </MenuSubmenu>
      <MenuSeparator />
      {repositorySupportLinks.map(link => <MenuItem key={link.href} render={<a href={link.href} target="_blank" rel="noopener noreferrer" />}><span className="om-menu-label"><RemixIcon name={link.icon} size={16} />{t(link.label)}<RemixIcon className="om-menu-external" name="external-link-line" size={14} /></span></MenuItem>)}
      <MenuItem onClick={() => openSettings('help')}><span className="om-menu-label"><RemixIcon name="question-line" size={16} />{t('Help')}</span></MenuItem>
    </Menu>;
}
