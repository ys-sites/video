import { findScenario } from '../../../shared/scenarios';
import { exploreCommunities } from '../../../shared/studio-catalog';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { restoreWorkspaceSource, type WorkspaceSource } from '../utils/workspaceHistory';
import { settingsSectionLabel } from './settingsMeta';
import { readWorkspacePage } from './workspacePageRouting';

function sourceLabel(href: string): string {
  const url = new URL(href);
  const page = readWorkspacePage(url.search, url.hash, url.pathname);
  if (page.creators) return 'Creators';
  if (page.templates || page.template) return 'Template library';
  if (page.settings === 'mcp') return 'MCP';
  if (page.settings === 'brand-kit') return 'Brand Kit';
  if (page.settings) return settingsSectionLabel(page.settings);
  if (page.scenario) return findScenario(page.scenario)?.title ?? 'Workflows';
  if (page.scenarioHub) return 'Workflows';
  if (page.studio) return page.studio.scene.label;
  if (page.designScene) return 'Design Studio';
  if (page.modelOverview || page.modelHub) return 'Model details';
  if (page.specialty) return page.specialty.title;
  if (page.motion) return 'Motion Studio';
  if (page.skills) return 'Skills';
  if (page.assets) return 'Workspace assets';
  if (page.explore) return exploreCommunities.find(community => community.id === page.community)?.label ?? 'Explore';
  return 'Editor';
}

export function WorkspaceBreadcrumb({ source, destination }: { source: WorkspaceSource; destination: string }) {
  const { t } = useI18n();
  return <nav className="om-workspace-breadcrumb om-breadcrumb" aria-label={t('Breadcrumb')}>
    <a className="om-text-link" href={source.href} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (restoreWorkspaceSource(source)) event.preventDefault();
    }}>{t(sourceLabel(source.href))}</a>
    <RemixIcon name="arrow-right-s-line" size={14} aria-hidden="true" />
    <span aria-current="page">{destination}</span>
  </nav>;
}
