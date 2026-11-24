import { McpClientAvatar } from './McpClientAvatar';
import { Button } from 'open-design-ui/button';
import type { GalleryTemplate } from '../../../shared/catalog';
import type { WorkspaceChrome } from './WorkspaceChromeContext';
import { reviewCommentsPrompt } from '../../../shared/review-comments';
import { canvasPresets } from '../../../shared/composition-canvas';
import { PlatformIcon } from '../../../packages/design-system/react/PlatformIcon';
import { platformExportTargets } from '../../../shared/platform-export';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { brand, designSystemAsset } from '../../../packages/design-system/index.js';
import { BrandLogo } from '../../../packages/design-system/react/BrandLogo';
import { manualConnection, setupPrompt, setupGuideUrl, templatePrompt, transcriptExamplePrompt } from '../../../shared/integration';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Tabs, TabsList, Tab, TabPanel } from '../components/ui/Tabs';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { SettingsError, SettingsLoading } from './settingsPrimitives';
import { useIntegrationInfo } from './useIntegrationInfo';
import { GITHUB_REPOSITORY } from './githubRepository';
import { McpTemplateShowcase } from './McpTemplateShowcase';
import { HorizontalRail } from './HorizontalRail';
import { useCommunityLink } from './CommunityLink';
import { findTechniqueStudio } from '../../../shared/studio-catalog';
import { findScenario, scenarioAgentPrompt } from '../../../shared/scenarios';
import { studioSkillDefaults, skillShotPrompt, localizedSkillPrompt, motionSkills } from './skillCatalog';
import { mcpCapabilities, mcpScenarios, searchRecoveryExample, platformExportExample, mcpBenefits, mcpReviewGuide, mcpFaq, mcpWorkflowComparison, mcpClientComparison } from './mcpCapabilities';
import { mcpClients as clients, supportsLocalConnection } from './mcpClients';
import { readWorkspacePage, type WorkspacePage } from './workspacePageRouting';
import * as tracking from './pageTracking';
import './McpConnectionPage.css';

export function McpConnectionPage({ openLibrary: openLibraryRaw, openProviders: openProvidersRaw, previewsEnabled = true, route, onRouteChange, entry = 'direct_link', hasProject = false, projectId, breadcrumb, inSettings = false }: { openLibrary: WorkspaceChrome['openLibrary']; openProviders: () => void; previewsEnabled?: boolean; route?: WorkspacePage; onRouteChange?: (patch: Partial<WorkspacePage>) => void; entry?: tracking.McpEntry; hasProject?: boolean; projectId?: string; breadcrumb?: ReactNode; inSettings?: boolean }) {
  const { t, locale } = useI18n(), toast = useToast();
  const community = useCommunityLink();
  const { info, failed, retry } = useIntegrationInfo();
  const [manualScenario, setManualScenario] = useState<{ id: string; text: string } | null>(null);
  const [localRoute, setLocalRoute] = useState(() => readWorkspacePage(location.search, location.hash, location.pathname));
  const { client: clientId, setup: setupMode } = route ?? localRoute;
  const changeRoute = (patch: Partial<WorkspacePage>) => {
    if (onRouteChange) onRouteChange(patch);
    else setLocalRoute(previous => ({ ...previous, ...patch }));
  };
  const setClientId = (client: string) => changeRoute({ client: clients.find(item => item.id === client)?.id ?? 'codex' });
  const client = clients.find(item => item.id === clientId) ?? clients[0];
  const clientKey = client.id as tracking.McpClient;
  // One page view per opening, with the control that opened it and the client tab it opened on.
  useEffect(() => { tracking.reportMcpPageView(entry, clientKey, hasProject); }, []);
  const click = (area: Parameters<typeof tracking.reportMcpClick>[0], element: Parameters<typeof tracking.reportMcpClick>[1], fields: Parameters<typeof tracking.reportMcpClick>[2] = {}) =>
    tracking.reportMcpClick(area, element, { mcp_client: clientKey, ...fields });
  const openLibrary = (area: 'mcp_start' | 'mcp_templates' | 'mcp_footer') => (trigger?: HTMLElement, template?: GalleryTemplate) => {
    click(area, template ? 'open_detail' : 'open_library', template ? { template: template.id } : {}); openLibraryRaw(trigger, template);
  };
  const openProviders = (area: 'mcp_resources' | 'mcp_footer') => () => { click(area, 'manage_providers'); openProvidersRaw(); };
  const docLink = (area: 'mcp_resources' | 'mcp_footer', doc: 'mcp_tools' | 'skills' | 'agent_adapters' | 'docs_home' | 'repository') => () => click(area, 'view_documentation', { doc_id: doc });
  const docId = (path: string) => path === 'docs/mcp-phase1-tools.md' ? 'mcp_tools' as const : path === 'docs/skills.md' ? 'skills' as const : 'agent_adapters' as const;
  const page = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const example = (route ?? localRoute).mcpExample;
  useEffect(() => {
    const card = example && document.getElementById('mcp-example-' + example);
    if (card && page.current?.contains(card)) {
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'center' });
    } else if (!inSettings) heading.current?.focus({ preventScroll: true });
  }, [example, inSettings]);
  const scrollTo = (id: string) => { click('mcp_footer', 'scroll_to_section', { section_id: id }); page.current?.querySelector<HTMLElement>(`#${id}`)?.scrollIntoView({ block: 'start' }); };
  const supported = supportsLocalConnection(client);
  const language = locale === 'zh-CN' ? 'zh-CN' : 'en';
  const prompt = setupPrompt(info, client.host, language).replace('MCP / CLI', client.name);
  const manual = info ? manualConnection(info, client.host, language) : '';
  type CopyReport = { kind: Parameters<typeof tracking.reportMcpCopyResult>[0]; capability?: string; template?: string; includesSetup?: boolean };
  async function copy(text: string, report: CopyReport) {
    const extra = { setup: setupMode, capability: report.capability, template: report.template, includesSetup: report.includesSetup };
    try { await navigator.clipboard.writeText(text); toast.showToast(t('Copied to clipboard'), 'info', 'feedback'); tracking.reportMcpCopyResult(report.kind, 'clipboard_written', clientKey, extra); }
    catch { toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback'); tracking.reportMcpCopyResult(report.kind, 'failed', clientKey, extra); }
  }
  const copyCreation = (text: string, includeSetup: boolean, kind: 'starter' | 'capability_example', capability: string) =>
    copy(includeSetup ? `${prompt}\n\n${t(text)}` : t(text), { kind, capability, includesSetup: includeSetup });
  const copyButton = (text: string, label: string, kind: 'connection_instruction' | 'manual_config') => <Button variant="ghost" className="om-button h-auto" disabled={!text || !supported} onClick={() => void copy(text, { kind })}><RemixIcon name="file-copy-line" size={16} />{t(label)}</Button>;
  const copyCapability = async (item: (typeof mcpCapabilities)[number] | (typeof mcpScenarios)[number]) => {
    let instruction: string;
    const studio = findTechniqueStudio(item.id === 'spatial-scene' ? '3d' : item.id);
    if (studio) {
      const skill = motionSkills.find(entry => entry.id === studio.techniques[0])!;
      instruction = localizedSkillPrompt(skill, studioSkillDefaults(studio.id), locale, setupGuideUrl(info), t) + '\n\n' + t(item.prompt);
    } else if (item.id === 'studio-shot') {
      const studio = findTechniqueStudio('explainer')!;
      const example = motionSkills.find(entry => entry.id === studio.techniques[0])!;
      instruction = [prompt, t(item.prompt), skillShotPrompt(example, studioSkillDefaults(studio.id), t)].join('\n\n');
    } else if (item.id === 'review-comments') instruction = reviewCommentsPrompt({ projectId, dataDirectory: info?.dataDirectory, previewUrl: info?.previewUrl });
    else if (item.id === 'transcript') instruction = `${prompt}\n\n${transcriptExamplePrompt(info, locale)}`;
    else if (item.id === 'scenario-black-friday') instruction = `${prompt}\n\n${scenarioAgentPrompt(findScenario('black-friday')!, { locale, integration: info })}`;
    else if (item.id === 'scenario-workflows' || item.id === 'scenario-agent-writeback') instruction = `${prompt}\n\n${t(item.prompt)}`;
    else if (item.id === 'anime-opening') instruction = [prompt, t(item.prompt)].join('\n\n');
    else if (item.id === 'search-recovery') instruction = `${prompt}\n\n${searchRecoveryExample(t)}`;
    else if (item.id === 'platform-export') instruction = platformExportExample(locale, info ?? undefined);
    else return copyCreation(item.prompt, item.id !== 'media', 'capability_example', item.id);
    setManualScenario(null);
    try { await navigator.clipboard.writeText(instruction); toast.showToast(t('Copied. Paste into your Agent.'), 'info', 'feedback'); tracking.reportMcpCopyResult('capability_example', 'clipboard_written', clientKey, { capability: item.id, includesSetup: item.id !== 'platform-export' && item.id !== 'review-comments' }); }
    catch { setManualScenario({ id: item.id, text: instruction }); toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback'); tracking.reportMcpCopyResult('capability_example', 'failed', clientKey, { capability: item.id, includesSetup: item.id !== 'platform-export' && item.id !== 'review-comments' }); }
  };
  const Container = inSettings ? 'section' : 'main';
  return <Tabs value={client.id} onValueChange={value => {
    const selected = clients.find(item => item.id === value);
    if (!selected) return;
    setClientId(selected.id);
    click('mcp_client', 'client_tab', { mcp_client: selected.id });
  }} render={<Container ref={page} className="om-mcp-page" data-in-settings={inSettings || undefined} aria-labelledby="mcp-title" onKeyDown={event => event.stopPropagation()} />}>
    {breadcrumb}
    <div className="om-page-back-row om-mcp-client-row">
      <HorizontalRail label="Agent client" viewportClassName="om-mcp-client-viewport" selection={client.id} plainArrows>
        <TabsList className="om-mcp-client-tabs" aria-label={t('Agent client')}>
          {clients.filter(supportsLocalConnection).map(item => <Tab value={item.id} key={item.id}><McpClientAvatar client={item} /><span>{t(item.name)}</span></Tab>)}
        </TabsList>
      </HorizontalRail>
    </div>
    <div className="om-mcp-content">
      <section className="om-mcp-hero om-mcp-section">
        <div className="om-mcp-art" aria-hidden="true">
          <div className="om-mcp-art-tile om-mcp-art-left"><McpClientAvatar key={client.id} client={client} /></div>
          <div className="om-mcp-art-tile om-mcp-art-center"><img key={client.id} src={designSystemAsset(brand.loadingMark)} alt="" /></div>
        </div>
        <p className="om-mcp-eyebrow">OPENMOTION × MCP</p>
        <h1 id="mcp-title" ref={heading} tabIndex={-1}>{t('Create in {agent}', { agent: t(client.name) })}<br /><span>{t('Make it move with OpenMotion.')}</span></h1>
        <p className="om-mcp-lead">{t('Create through MCP in your Agent. Keep projects, assets and versions in OpenMotion, ready to edit and reuse.')}</p>
          {clients.map(item => <TabPanel value={item.id} key={item.id}>
            <div className="om-mcp-setup-tray">
              {!supported ? <div className="om-card om-mcp-unavailable"><RemixIcon name="information-line" size={28} /><h2>{t('Remote connection unavailable')}</h2><p>{t('ChatGPT cloud cannot connect to this local workspace. Choose a local Agent above.')}</p><pre className="om-code-block">{manual}</pre><Button variant="ghost" className="om-button h-auto" onClick={() => { click('mcp_setup', 'use_local_agent'); setClientId('codex'); }}>{t('Use a local Agent')}</Button></div> : <div className="om-mcp-setup-grid">
                <article className="om-card om-mcp-step">
                  <h2><span className="om-mcp-step-number">1</span>{t('Connect your Agent')}</h2>
                  <Tabs value={setupMode} onValueChange={value => { const setup = value === 'manual' ? 'manual' : 'agent'; click('mcp_setup', 'setup_method', { setup_method: setup }); changeRoute({ setup }); }}><TabsList aria-label={t('Setup method')}><Tab value="agent">{t('Let your Agent set it up')}</Tab><Tab value="manual">{t('Manual setup')}</Tab></TabsList>
                    <TabPanel value="agent" className="om-mcp-instruction"><p className="om-muted">{t('Copy this instruction to your Agent to install and connect OpenMotion.')}</p><pre className="om-code-block">{prompt}</pre><div className="om-mcp-actions">{copyButton(prompt, 'Copy connection instruction', 'connection_instruction')}<a className="om-button" href={setupGuideUrl(info)} target="_blank" rel="noreferrer" onClick={() => click('mcp_setup', 'connection_guide', { setup_method: 'agent' })}>{t('Connection guide')}<RemixIcon name="external-link-line" size={14} /></a>{client.host === 'deepseek' && <a className="om-button" href="https://github.com/nexu-io/openmotion/tree/main/integrations/dsh" target="_blank" rel="noreferrer">{t('DSH workspace plugin')}<RemixIcon name="external-link-line" size={14} /></a>}</div></TabPanel>
                    <TabPanel value="manual" className="om-mcp-instruction">{failed ? <SettingsError retry={retry} /> : !info ? <SettingsLoading /> : <><p className="om-muted">{t(client.host === 'mcp' ? 'Merge this configuration into your client’s local MCP settings. Preserve your other servers, then reload the connection.' : 'Run this command in a local terminal, then reload the Agent connection.')}</p><pre className="om-code-block">{manual}</pre><div className="om-mcp-actions">{copyButton(manual, 'Copy configuration', 'manual_config')}<a className="om-button" href={`/connect/config?host=${client.host}`} download onClick={() => click('mcp_setup', 'download_config', { setup_method: 'manual' })}>{t('Download configuration')}</a></div></>}</TabPanel>
                  </Tabs>
                </article>
                <article className="om-card om-mcp-step"><h2><span className="om-mcp-step-number">2</span>{t('Start creating in {agent}', { agent: t(client.name) })}</h2><p className="om-muted">{t('Tell your Agent what you want to make. Start with an idea, your material or a template.')}</p>
                  <div className="om-mcp-starters">{mcpCapabilities.slice(0, 4).map(capability => <Button variant="plain" className="om-nav-item" key={capability.id} onClick={() => void copyCreation(capability.prompt, capability.id !== 'media', 'starter', capability.id)}><RemixIcon name={capability.icon} size={18} />{t(capability.title)}</Button>)}</div>
                  <Button variant="ghost" className="om-button h-auto" data-primary onClick={event => openLibrary('mcp_start')(event.currentTarget)}><RemixIcon name="clapperboard-line" size={16} />{t('Explore templates')}<RemixIcon name="arrow-right-line" size={16} /></Button>
                </article>
              </div>}
            </div>
          </TabPanel>)}
      </section>

      <McpTemplateShowcase scroller={page} enabled={previewsEnabled} canCopy={Boolean(info && supported)} openLibrary={openLibrary('mcp_templates')} onCategory={value => click('mcp_templates', 'category_select', { option: value })} onCopy={template => { if (info) void copy(`${prompt}\n\n${templatePrompt(info, client.host, template, locale)}`, { kind: 'template', template: template.id, includesSetup: true }); }} />

      <section className="om-mcp-section"><h2>{t('Give your Agent a workspace worth keeping')}</h2><div className="om-mcp-benefit-grid">{mcpBenefits.map((item, index) => <article key={item.title} className="om-mcp-feature" data-featured={index === 0}><RemixIcon name={item.icon} size={26} /><h3>{t(item.title)}</h3><p>{t(item.description)}</p></article>)}</div></section>
      <section className="om-mcp-section" id="mcp-capabilities"><h2>{t('Your visual MCP guide')}</h2><p className="om-muted">{t('Choose a task and copy its example into your connected Agent. Projects and assets stay in your workspace; media generation uses your configured providers.')}</p><div className="om-mcp-capability-grid">{[...mcpCapabilities, ...mcpScenarios].map(item => <article className="om-mcp-feature" key={item.id} id={'mcp-example-' + item.id} tabIndex={-1} data-mcp-scenario={item.id}><RemixIcon name={item.icon} size={24} /><h3>{t(item.title)}</h3>{item.id === 'platform-export' && <div className="flex flex-wrap gap-1.5">{platformExportTargets.map(platform => <span key={platform.id} title={t(platform.label)}><PlatformIcon platform={platform.id} /></span>)}</div>}<p>{t(item.description)}</p>{item.id === 'canvas-captions' && <p className="om-muted">{t('Aspect ratio')}: {canvasPresets.map(item => item.ratio).join(' · ')}</p>}{item.id === 'review-comments' && <details className="om-mcp-tool-details w-full" data-review-guide><summary>{t('Review data and Agent actions')}</summary><div className="flex flex-col gap-3 pb-4"><div><h4>{t('Annotation tools')}</h4><p>{['Freehand pen', 'Rectangle', 'Ellipse', 'Arrow', 'Text label'].map(label => t(label)).join(' · ')}</p></div>{mcpReviewGuide.map(([title, description]) => <div key={title}><h4>{t(title)}</h4><p>{t(description)}</p></div>)}</div></details>}{item.id === 'review-comments' && failed && <SettingsError retry={retry} />}<Button variant="plain" className="om-text-link" disabled={!supported || (item.id === 'review-comments' && !info)} onClick={() => void copyCapability(item)}>{t('Copy an example')}<RemixIcon name="file-copy-line" size={14} /></Button>{manualScenario?.id === item.id && <textarea className="om-field w-full" aria-label={t(item.id === 'search-recovery' ? 'Creation instruction' : item.id === 'review-comments' ? 'Review instruction' : item.id === 'platform-export' ? 'Platform export instruction' : 'Complete workflow instruction')} readOnly rows={6} value={manualScenario.text} onFocus={event => event.currentTarget.select()} />}</article>)}</div>
        <details className="om-mcp-tool-details" onToggle={event => click('mcp_capabilities', 'tool_list_open', { expanded: event.currentTarget.open })}><summary>{t('Tools exposed by this installation')}{info && ` · ${info.tools.length}`}</summary><div className="om-mcp-tool-list">{info?.tools.map(tool => <div key={tool.name}><code>{tool.name}</code><p className="om-muted">{t(tool.name === 'openmotion_assets' ? 'Compatibility name for the original nine asset actions. Use openmotion_assets_use to read media content.' : mcpCapabilities.find(item => (item.tools as readonly string[]).includes(tool.name))?.description || tool.description)}</p></div>)}</div></details>
      </section>
      <section className="om-mcp-section" id="mcp-comparison"><div className="om-mcp-section-heading"><div><p className="om-mcp-eyebrow">{t('From a conversation to a reusable project')}</p><h2>{t('Choose the workflow that fits your idea')}</h2><p className="om-muted">{t('Create through MCP, refine in Studio, and keep the project and assets for your next version.')}</p></div></div><ComparisonTable label="Workflow comparison" columns={['Capability', 'OpenMotion + Agent', 'Direct model API', 'Studio by hand']} rows={mcpWorkflowComparison} featured /></section>
      <section className="om-mcp-section" id="mcp-clients"><h2>{t('What each client can do')}</h2><p className="om-muted">{t('Local connection, generation and inline presentation are different capabilities.')}</p><ComparisonTable label="Client compatibility" columns={['Capability', 'Codex / Claude Code / Cursor / DeepSeek', 'Desktop / other MCP clients', 'ChatGPT Cloud']} rows={mcpClientComparison} /><p className="om-mcp-footnote">{t('Support here describes this local installation. Your Agent must expose the tools and resources; media generation also needs an available provider.')}</p></section>
      <section className="om-mcp-section" id="mcp-connections"><h2>{t('MCP, Skills or local API?')}</h2><div className="om-mcp-capability-grid">{[
        ['plug-line', 'MCP', 'MCP connects compatible Agents to your local workspace. Use the same tools to create and edit projects, discover templates and import assets.', 'docs/mcp-phase1-tools.md'],
        ['file-text-line', 'Production Skills', 'Give your Agent the creative workflow, reference guides and verification rules. Installed Skills and MCP resources share the maintained guidance.', 'docs/skills.md'],
        ['code-s-slash-line', 'Local API & CLI', 'For local development and automation. Use the documented application boundary and project safeguards; no hosted public API is provided here.', 'docs/agent-adapters.md'],
      ].map(([icon, title, body, doc]) => <article className="om-mcp-feature" key={title}><RemixIcon name={icon} size={24} /><h3>{t(title)}</h3><p>{t(body)}</p><a className="om-text-link" href={`${GITHUB_REPOSITORY}/blob/main/${doc}`} target="_blank" rel="noreferrer" onClick={docLink('mcp_resources', docId(doc))}>{t('Documentation')}<RemixIcon name="external-link-line" size={14} /></a></article>)}</div></section>
      <section className="om-mcp-section om-mcp-policy-grid"><div><h2>{t('Costs & limits')}</h2><ul>{['Connecting does not run a model or start a render. Agent subscriptions and media-provider charges are separate.', 'Generation depends on provider access, model support and available quota. There is no universal free-generation allowance or fixed completion time.', 'Use the same generation or export job to check progress. Cancellation depends on the task and provider; it does not guarantee a refund.'].map(text => <li key={text}>{t(text)}</li>)}</ul><Button variant="ghost" className="om-button h-auto" onClick={openProviders('mcp_resources')}><RemixIcon name="sparkling-line" size={16} />{t('Manage providers')}</Button></div><div><h2>{t('Privacy & permissions')}</h2><ul>{['The local Agent receives access to workspace tools. Keep your existing MCP servers and connect the correct installation.', 'Provider credentials are stored outside projects and injected by the local service. Never paste API keys into a conversation.', 'Cloud generation sends the required prompt and reference material to the selected provider. Projects and local exports remain in your workspace.'].map(text => <li key={text}>{t(text)}</li>)}</ul></div></section>
      <section className="om-mcp-section om-mcp-faq" id="mcp-faq"><div className="om-mcp-faq-intro"><p className="om-mcp-eyebrow">{t('A little more clarity')}</p><h2>{t('Frequently asked questions')}</h2><p className="om-muted">{t('Connect, create, save and reuse—all in one guide.')}</p><div className="om-mcp-contact"><h3>{t('Contact us')}</h3><p>{t('Need a hand or have an idea? Talk with the community or send us feedback.')}</p><a className="om-text-link" href={community.href} target="_blank" rel="noopener noreferrer" onClick={() => click('mcp_faq', 'community')}>{community.label}<RemixIcon name="arrow-right-line" size={16} /></a><a className="om-text-link" href={`${GITHUB_REPOSITORY}/issues/new/choose`} target="_blank" rel="noreferrer" onClick={() => click('mcp_faq', 'report_issue')}>{t('Report an issue')}<RemixIcon name="external-link-line" size={14} /></a></div></div><div>{mcpFaq.map(([question, answer], index) => <details key={question} onToggle={event => { if (event.currentTarget.open) click('mcp_faq', 'faq_open', { faq_index: index + 1 }); }}><summary>{t(question)}<RemixIcon name="arrow-down-s-line" size={18} /></summary><p className="om-muted">{t(answer)}</p></details>)}</div></section>
      <footer className="om-mcp-footer">
        <div className="om-mcp-footer-intro"><BrandLogo /><p className="om-mcp-eyebrow">{t('The fullstack agentic video editor')}</p><h2>{t('Create in your Agent. Build on it in OpenMotion.')}</h2><p>{t('Connect with MCP. Keep editable projects, finished videos and assets together, ready for your next idea.')}</p><div className="om-mcp-actions"><Button variant="ghost" className="om-button h-auto" data-primary onClick={() => scrollTo('mcp-title')}>{t('Connect your Agent')}<RemixIcon name="arrow-right-line" size={16} /></Button><a className="om-button" href={community.href} target="_blank" rel="noopener noreferrer" onClick={() => click('mcp_footer', 'community')}>{community.label}</a></div></div>
        <nav className="om-mcp-footer-links" aria-label={t('MCP resources')}>
          <div><h3>{t('Create')}</h3><Button variant="plain" onClick={event => openLibrary('mcp_footer')(event.currentTarget)}>{t('Template library')}</Button><Button variant="plain" onClick={() => scrollTo('mcp-capabilities')}>{t('Motion & animation')}</Button><Button variant="plain" onClick={openProviders('mcp_footer')}>{t('Images, video, music and voice')}</Button><Button variant="plain" onClick={() => scrollTo('mcp-comparison')}>{t('Compare workflows')}</Button></div>
          <div><h3>{t('Connect')}</h3><Button variant="plain" onClick={() => scrollTo('mcp-title')}>{t('Agent setup')}</Button><Button variant="plain" onClick={() => scrollTo('mcp-clients')}>{t('Client compatibility')}</Button><a href={`${GITHUB_REPOSITORY}/blob/main/docs/skills.md`} target="_blank" rel="noreferrer" onClick={docLink('mcp_footer', 'skills')}>{t('Production Skills')}</a><a href={`${GITHUB_REPOSITORY}/blob/main/docs/mcp-phase1-tools.md`} target="_blank" rel="noreferrer" onClick={docLink('mcp_footer', 'mcp_tools')}>{t('MCP tool reference')}</a></div>
          <div><h3>{t('Resources')}</h3><a href={`${GITHUB_REPOSITORY}/tree/main/docs`} target="_blank" rel="noreferrer" onClick={docLink('mcp_footer', 'docs_home')}>{t('Documentation')}</a><a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer" onClick={docLink('mcp_footer', 'repository')}>GitHub</a><Button variant="plain" onClick={() => scrollTo('mcp-faq')}>{t('Frequently asked questions')}</Button><a href={`${GITHUB_REPOSITORY}/issues/new/choose`} target="_blank" rel="noreferrer" onClick={() => click('mcp_footer', 'report_issue')}>{t('Contact us')}</a></div>
        </nav>
      </footer>

    </div><StudioToastViewport {...toast} />
  </Tabs>;
}

function ComparisonTable({ label, columns, rows, featured = false }: { label: string; columns: readonly string[]; rows: readonly (readonly string[])[]; featured?: boolean }) {
  const { t } = useI18n();
  return <div className="om-mcp-table-wrap" tabIndex={0} role="region" aria-label={t(label)}><table className="om-mcp-table" data-featured={featured}><thead><tr>{columns.map(column => <th key={column} scope="col">{t(column)}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row[0]}>{row.map((cell, i) => i === 0 ? <th scope="row" key={i}>{t(cell)}</th> : <td key={i}>{featured && i === 1 && <RemixIcon name="check-line" size={16} />}{t(cell)}</td>)}</tr>)}</tbody></table></div>;
}
