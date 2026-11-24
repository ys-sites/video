import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { SOUND_TABS, type SoundTabId } from './soundTabs';

export function SoundSceneTabs({
  activeTab,
  onSelectTab,
}: {
  activeTab: SoundTabId;
  onSelectTab: (tabId: SoundTabId) => void;
}) {
  const { t } = useI18n();
  const liveTabs = SOUND_TABS.filter(tab => tab.status === 'live');
  const soonTabs = SOUND_TABS.filter(tab => tab.status === 'soon');

  const renderTab = (tab: (typeof SOUND_TABS)[number]) => {
    const active = tab.id === activeTab;
    return (
      <Button
        key={tab.id}
        type="button"
        variant="plain"
        className="om-nav-item om-sound-tab"
        data-sound-tab={tab.id}
        data-status={tab.status}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          if (!active) onSelectTab(tab.id);
        }}
      >
        <RemixIcon name={tab.icon} size={14} className="om-sound-tab-icon" />
        <span>{t(tab.label)}</span>
      </Button>
    );
  };

  return (
    <div className="om-sound-tabs-strip">
      <div className="om-sound-tabs-group" data-group="live">
        {liveTabs.map(renderTab)}
      </div>
      {soonTabs.length > 0 && (
        <>
          <span className="om-sound-tabs-divider" aria-hidden="true" />
          <div className="om-sound-tabs-group" data-group="soon">
            {soonTabs.map(renderTab)}
            <span className="om-sound-soon-tag">{t('Soon')}</span>
          </div>
        </>
      )}
    </div>
  );
}
