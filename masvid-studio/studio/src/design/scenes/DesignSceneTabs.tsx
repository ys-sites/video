import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../../packages/design-system/react/RemixIcons';
import { designScenarios, type DesignScenarioId } from '../../../../shared/design-project';
import { useI18n } from '../../i18n/I18n';
import '../design.css';

export type DesignTabId = DesignScenarioId | 'projects';

export function DesignSceneTabs({
  activeTab,
  showProjects = true,
  onSelectDesignScene,
}: {
  activeTab: DesignTabId | null;
  showProjects?: boolean;
  onSelectDesignScene: (scene: DesignTabId) => void;
}) {
  const { t } = useI18n();

  return (
    <span className="om-design-scene-tabs">
      {showProjects && <Button
        type="button"
        size="sm"
        variant="plain"
        className="om-nav-item"
        icon={<RemixIcon name="folder-open-line" size={14} />}
        aria-current={activeTab === 'projects' ? 'page' : undefined}
        onClick={() => onSelectDesignScene('projects')}
      >
        {t('Projects')}
      </Button>}
      {designScenarios.map(scenario => (
        <Button
          key={scenario.id}
          type="button"
          size="sm"
          variant="plain"
          className="om-nav-item"
          icon={<RemixIcon name={scenario.icon} size={14} />}
          aria-current={activeTab === scenario.id ? 'page' : undefined}
          onClick={() => onSelectDesignScene(scenario.id)}
        >
          {t(scenario.label)}
        </Button>
      ))}
    </span>
  );
}
