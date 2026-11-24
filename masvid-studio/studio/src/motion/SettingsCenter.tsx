import { Button } from 'open-design-ui/button';
import * as tracking from './pageTracking';
import type { McpEntry } from './pageTracking';
import { useEffect, useState, type ReactNode } from 'react';
import { modelKinds } from '../../../shared/provider-directory';
import { RemixIcon } from '../icons/RemixIcons';
import { languages, useI18n, type Locale } from '../i18n/I18n';
import { Select } from '../components/ui/Select';
import { AppearanceSettings } from './AppearanceSettings';
import { ModelSettings, modelKindLabel } from './ModelSettings';
import { AccountSettings } from './AccountSettings';
import { PrivacySettings } from './PrivacySettings';
import { clickMethod, clickOption, trackStudioClick } from './editorTracking';
import { ModelSwitcher } from './ModelSwitcher';
import { useProviderDirectory } from './useProviderDirectory';
import { gatewayRequest } from './gatewayClient';
import { SettingsError, SettingsLoading } from './settingsPrimitives';
import { AgentSettings, DefaultAgentCard } from './AgentSettings';
import { discord, feishu } from './CommunityLink';
import { GITHUB_REPOSITORY, repositorySupportLinks } from './githubRepository';
import { SettingsSurfaceBoundary } from './SettingsSurfaceBoundary';

import type { SettingsSection } from './workspacePageRouting';
export type { SettingsSection } from './workspacePageRouting';
import { settingsCenterSections as sections, settingsSectionLabel } from './settingsMeta';

export function SettingsCenter({ section, onSection: onSectionRaw, onBack, openConnections, providerId, onProviderChange, mcp, hasProject = false }: { hasProject?: boolean; section: SettingsSection; onSection: (section: SettingsSection) => void; onBack?: () => void; openConnections: (entry: McpEntry) => void; providerId?: string | null; onProviderChange?: (id: string | null) => void; mcp?: ReactNode }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const filtered = sections.filter(item => t(item.label).toLowerCase().includes(search.toLowerCase()));
  // One view per section shown; the section is remounted for each route.
  useEffect(() => { tracking.reportSettingsPageView(section, hasProject); }, [section]);
  const onSection = (next: SettingsSection) => { if (next !== section) tracking.reportSettingsClick('settings_nav', 'section_select', { settings_section: next }); onSectionRaw(next); };
  return <div className="om-settings-center" onKeyDown={event => event.stopPropagation()}>
    <div className="om-settings-navigation-slot"><div className="om-settings-navigation-clip"><aside className="om-settings-navigation">
      <div className="om-settings-heading">
        {onBack
          ? <Button variant="plain" type="button" className="om-nav-item" onClick={onBack}><RemixIcon name="arrow-left-line" size={16} />{t('Go back')}</Button>
          : <h1 className="om-navigation-title">{t('Settings')}</h1>}
        <div className="om-settings-mobile-navigation"><Select label={t('Settings')} value={section} onCommit={value => onSection(value as SettingsSection)} options={sections.map(item => ({ value: item.id, label: t(item.label), icon: <RemixIcon name={item.icon} size={16} /> }))} /></div>
      </div>
      <label className="om-field"><RemixIcon name="search-line" size={16} /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Search settings…')} aria-label={t('Search settings')} /></label>
      <nav aria-label={t('Settings')} className="om-settings-sections">{filtered.map((item, index) => <div key={item.id}>{filtered[index - 1]?.group !== item.group && <p className="om-eyebrow">{t(item.group)}</p>}<Button variant="plain" className="om-nav-item" aria-current={section === item.id ? 'page' : undefined} onClick={event => { if (item.id === 'privacy' && section !== 'privacy') trackStudioClick('settings', 'privacy_settings', undefined, clickMethod(event)); onSection(item.id); }}><RemixIcon name={item.icon} size={16} /><span>{t(item.label)}</span></Button></div>)}{!filtered.length && <p className="om-muted">{t('No matching settings')}</p>}</nav>
    </aside></div></div>
    <main key={section} className="om-settings-main" aria-label={t(settingsSectionLabel(section))}>
      <SettingsSurfaceBoundary>
      {section === 'mcp' ? mcp : section === 'local' ? <AgentSettings /> : section === 'providers' ? <ModelSettings key={section} openAccount={() => onSection('account')} providerId={providerId} onProviderChange={onProviderChange} />
        : section === 'account' || section === 'subscription' ? <AccountSettings key={section} subscription={section === 'subscription'} openProviders={() => onSection('providers')} />
        : section === 'models' ? <DefaultModels openProviders={() => onSection('providers')} />
        : section === 'appearance' ? <AppearanceSettings />
        : section === 'privacy' ? <div className="om-settings-page"><h1 className="om-title">{t('Privacy & data')}</h1><PrivacySettings embedded onClose={() => {}} /></div>
        : section === 'general' ? <GeneralSettings openConnections={() => openConnections('settings_general')} />
        : <ResourceSettings about={section === 'about'} openConnections={() => openConnections('settings_resources')} />}
      </SettingsSurfaceBoundary>
    </main>
  </div>;
}
function DefaultModels({ openProviders }: { openProviders: () => void }) {
  const { t, locale } = useI18n(), directory = useProviderDirectory();
  return <div className="om-settings-page"><h1 className="om-title">{t('Default Agent & models')}</h1><p className="om-muted">{t('Choose a provider and model for each capability. Account models and BYOK work together.')}</p><DefaultAgentCard />
    {directory.error ? <SettingsError retry={directory.refresh} /> : !directory.data ? <SettingsLoading /> : <div className="om-card">{modelKinds.map(kind => {
      const model = directory.data?.models.find(model => model.id === directory.data?.defaults[kind]);
      const provider = directory.data?.providers.find(provider => provider.id === model?.provider);
      return <div className="om-preference-row" key={kind}><div><h2 className="om-subtitle">{modelKindLabel(kind, t, locale)}</h2><p className="om-muted">{model ? `${provider?.label} · ${model.label}${!provider?.available || !model.enabled ? ' · ' + t('Unavailable') : ''}` : t(directory.data?.defaults[kind] ? 'Unavailable model' : 'No default selected')}</p></div><ModelSwitcher capability={kind} label={t('Choose model')} openSettings={openProviders} /></div>;
    })}</div>}
    <p className="om-muted">{t('Language and embedding selections are saved for Agent integrations. Editing is performed by your connected Agent.')}</p>
  </div>;
}
function GeneralSettings({ openConnections }: { openConnections: () => void }) {
  const { t, locale, setLocale } = useI18n();
  return <div className="om-settings-page"><h1 className="om-title">{t('General')}</h1><div className="om-card"><div className="om-preference-row"><div><h2 className="om-subtitle">{t('Language')}</h2><p className="om-muted">{t('Display language for the workspace')}</p></div><div className="om-preference-control"><Select label={t('Language')} value={locale} onCommit={value => { if (value !== locale) trackStudioClick('settings', 'language_change', undefined, undefined, clickOption(value)); setLocale(value as Locale); }} options={languages.map(item => ({ value: item.locale, label: item.label }))} /></div></div><div className="om-preference-row"><div><h2 className="om-subtitle">{t('Connect Agent')}</h2><p className="om-muted">{t('Connect your preferred Agent to this workspace.')}</p></div><Button variant="ghost" className="om-button h-auto" onClick={openConnections}>{t('Set up connection')}</Button></div></div><section className="om-card om-card-stack"><h2 className="om-subtitle">{t('Keyboard shortcuts')}</h2><div className="om-preference-row"><span>{t('Open settings')}</span><kbd>⌘ / Ctrl + ,</kbd></div><div className="om-preference-row"><span>{t('Toggle project list')}</span><kbd>Alt + B</kbd></div><div className="om-preference-row"><span>{t('Close menu or dialog')}</span><kbd>Esc</kbd></div></section></div>;
}
function ResourceSettings({ about, openConnections }: { about: boolean; openConnections: () => void }) {
  const { t, locale } = useI18n();
  const communityLinks = locale === 'zh-CN' ? [feishu, discord] : [discord, feishu];
  const [version, setVersion] = useState<string>();
  useEffect(() => { let active = true; void gatewayRequest<{ version: string }>('health').then(data => { if (active) setVersion(data.version); }).catch(() => {}); return () => { active = false; }; }, []);
  const links = [{ label: 'Documentation', href: `${GITHUB_REPOSITORY}/tree/main/docs`, icon: 'file-text-line' }, ...repositorySupportLinks, { label: 'View source code', href: GITHUB_REPOSITORY, icon: 'code-s-slash-line' }];
  return <div className="om-settings-page"><h1 className="om-title">{t(about ? 'About OpenMotion' : 'Help')}</h1>{about && <section className="om-card om-about-identity"><h2 className="om-product-brand" aria-label="OpenMotion" /><p className="om-muted">{t('An editable workspace for AI video and motion.')}</p><span className="om-badge">{version ? `${t('Version')} ${version}` : t('Version unavailable')}</span></section>}
    <div className="om-card om-resource-links">{links.map((link, index) => <a className="om-nav-item om-resource-link" key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => tracking.reportSettingsClick('help_resources', 'open_resource', { position: index + 1 })}><span className="om-menu-label"><RemixIcon name={link.icon} size={16} />{t(link.label)}</span><RemixIcon name="external-link-line" size={16} /></a>)}<Button variant="plain" className="om-nav-item om-resource-link" onClick={openConnections}><span className="om-menu-label"><RemixIcon name="plug-line" size={16} />{t('Connect Agent')}</span><RemixIcon name="arrow-right-line" size={16} /></Button></div>
    {!about && <section className="om-card om-resource-links" aria-labelledby="om-community-heading">
      <h2 id="om-community-heading" className="om-subtitle">{t('Community')}</h2>
      {communityLinks.map((link, index) => <a key={link.href} className="om-nav-item om-resource-link" href={link.href} target="_blank" rel="noopener noreferrer" onClick={() => tracking.reportSettingsClick('help_resources', 'community', { position: index + 1 })}>
        <span>{link === feishu ? t('Feishu group') : link.platform}</span><RemixIcon name="external-link-line" size={16} />
      </a>)}
    </section>}
    {about && <section className="om-card om-card-stack"><h2 className="om-subtitle">{t('Acknowledgements')}</h2><p className="om-muted">{t('Built with Hyperframes and the OpenMotion design system. Provider presets include the MIT-licensed Cherry Studio registry. Account connections use OpenDesign.')}</p><a className="om-text-link" href="https://github.com/nexu-io/openmotion/blob/main/shared/provider-registry-NOTICE.md" target="_blank" rel="noreferrer">{t('Licenses & acknowledgements')}</a></section>}
  </div>;
}
