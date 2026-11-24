import { IconButton } from 'open-design-ui/icon-button';
import { Button } from 'open-design-ui/button';
import * as tracking from './pageTracking';
import { Tooltip } from "../components/ui/Tooltip";
import { useEffect, useState } from 'react';
import { editorProjectIdFromPath } from '../../../shared/spa-routes';
import type { AgentChoice, AgentLaunch, LocalAgent } from '../../../shared/local-agents';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Select } from '../components/ui/Select';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { ProviderAvatar, ModelAvatar, SettingsDialog, SettingsError, SettingsLoading } from './settingsPrimitives';
import { gatewayRequest } from './gatewayClient';
import { notifyAgentsChanged, openAgentSettings, useLocalAgents } from './useLocalAgents';

const authLabel = { 'signed-in': 'Signed in', 'signed-out': 'Sign-in required', unknown: 'Sign-in managed by Agent' };
const agentIcon = (agent: LocalAgent) => ({ id: agent.icon, custom: false });
const projectScope = () => {
  const pathId = editorProjectIdFromPath(location.pathname);
  if (pathId) return `?projectId=${encodeURIComponent(pathId)}`;
  const query = new URLSearchParams(location.search).get('project');
  if (query) return `?projectId=${encodeURIComponent(query)}`;
  try { const id = location.hash.match(/^#project\/([^?]+)/)?.[1]; return id ? `?projectId=${encodeURIComponent(decodeURIComponent(id))}` : ''; }
  catch { return ''; }
};

export function AgentSettings() {
  const { t } = useI18n(), directory = useLocalAgents(), toast = useToast();
  const [selected, setSelected] = useState('codex'), [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [detail, setDetail] = useState(false);
  const agent = directory.data?.agents.find(item => item.id === selected);
  const agents = directory.data?.agents.filter(item => (filter === 'all' || item.installed === (filter === 'installed')) && `${item.label} ${item.bin}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <section className="om-provider-settings" data-detail={detail} aria-label={t('Local Agents')}>
    <aside className="om-provider-list">
      <div className="om-provider-search"><label className="om-field"><RemixIcon name="search-line" size={16} /><input type="search" aria-label={t('Search Agents')} placeholder={t('Search Agents…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <Menu tooltip={t('Filter Agents')} modal={false} trigger={<IconButton variant="ghost" className="motion-icon-button" aria-label={t('Filter Agents')} icon={<RemixIcon name="filter-3-line" size={16} />} />}><MenuRadioGroup value={filter} onValueChange={value => setFilter(String(value))}>{[['all', 'All Agents'], ['installed', 'Installed'], ['missing', 'Not installed']].map(([value, label]) => <MenuRadioItem key={value} value={value}>{t(label)}</MenuRadioItem>)}</MenuRadioGroup></Menu>
      </div>
      <div className="om-provider-list-caption"><span className="om-eyebrow">{t('Local Agents')} · {agents.length}</span><Tooltip label={t('Rescan installation')} wrap><IconButton variant="ghost" className="motion-icon-button" aria-label={t('Rescan installation')} onClick={() => { tracking.reportSettingsClick('local_agents', 'rescan_agents'); directory.refresh(); }} icon={<RemixIcon name="refresh-line" size={14} />} /></Tooltip></div>
      <nav className="om-provider-items" aria-label={t('Agents')}>{agents.map(item => <Tooltip label={`${item.label} · ${t(item.installed ? 'Installed' : 'Not installed')}`} wrap key={item.id}><Button variant="plain" aria-label={`${item.label} · ${t(item.installed ? 'Installed' : 'Not installed')}`} className="om-nav-item om-provider-item" aria-current={selected === item.id ? 'page' : undefined} onClick={() => { tracking.reportSettingsClick('local_agents', 'select_agent', { agent: item.id }); setSelected(item.id); setDetail(true); }}><ProviderAvatar name={item.label} provider={agentIcon(item)} /><span className="om-provider-item-name">{item.label}</span>{directory.data?.default?.agent === item.id ? <RemixIcon name="check-line" size={14} /> : item.installed ? <span className="om-status-dot" aria-label={t('Installed')} /> : null}</Button></Tooltip>)}</nav>
      {!agents.length && directory.data && <p className="om-empty om-muted">{t('No matching Agents')}</p>}
      <p className="om-muted om-agent-list-note">{t('Use the Agents installed on this computer, with their own accounts.')}</p>
    </aside>
    <div className="om-provider-detail"><Button variant="plain" className="om-button om-provider-back" onClick={() => setDetail(false)}><RemixIcon name="arrow-left-line" size={16} />{t('Agents')}</Button>
      {directory.error ? <SettingsError retry={directory.refresh} /> : !directory.data ? <SettingsLoading /> : agent && <AgentDetail key={agent.id} agent={agent} current={directory.data.default} showToast={toast.showToast} />}
    </div><StudioToastViewport {...toast} />
  </section>;
}

function AgentDetail({ agent, current, showToast }: { agent: LocalAgent; current: AgentChoice | null; showToast: ReturnType<typeof useToast>['showToast'] }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false), [query, setQuery] = useState(''), [custom, setCustom] = useState(''), [adding, setAdding] = useState(false);
  const [model, setModel] = useState(current?.agent === agent.id ? current.model : 'default'), [reasoning, setReasoning] = useState(current?.agent === agent.id ? current.reasoning ?? '' : '');
  const [launch, setLaunch] = useState<'login' | 'launch' | null>(null);
  const choice = { agent: agent.id, model, ...(reasoning ? { reasoning } : {}) };
  const modelInfo = agent.models.find(item => item.id === model);
  async function act(action: () => Promise<unknown>, message?: string, report?: 'refresh_status' | 'refresh_models' | 'add_model' | 'set_default_agent') {
    setBusy(true); try { await action(); notifyAgentsChanged(); if (message) showToast(t(message), 'info'); if (report) tracking.reportAgentSetting(agent.id, report, 'success'); }
    catch (error) { if (report) tracking.reportAgentSetting(agent.id, report, 'failure'); showToast(error instanceof Error ? error.message : t('Could not save settings'), 'error'); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (agent.installed && !agent.checkedAt) void act(() => gatewayRequest(`settings/agents/${agent.id}/inspect`, 'POST', {})); }, [agent.id, agent.installed]); // Only inspect an installed selection, never every CLI at startup.
  const selected = current?.agent === agent.id && current.model === model && (current.reasoning ?? '') === reasoning;
  return <div className="om-provider-detail-inner">
    <header className="om-settings-row"><div className="om-provider-heading"><ProviderAvatar name={agent.label} provider={agentIcon(agent)} /><div><h1 className="om-title">{agent.label}</h1><p className="om-muted">{t('Local Agent')}{agent.version ? ` · v${agent.version}` : ''}</p></div></div><span className="om-badge" data-active={agent.installed}>{t(agent.installed ? 'Installed' : 'Not installed')}</span></header>
    <section className="om-card om-card-stack"><div className="om-settings-row"><h2 className="om-subtitle">1 · {t('Install Agent')}</h2>{agent.installed && <RemixIcon name="check-line" size={16} />}</div><p className="om-muted">{t(agent.installed ? 'Agent found on this computer. Updates are managed by the Agent.' : 'Install the official CLI, then return here to check its status.')}</p><div className="om-settings-actions"><a className="om-button" href={agent.website} target="_blank" rel="noreferrer"><RemixIcon name="external-link-line" size={14} />{t(agent.installed ? 'Official guide' : 'Download & install')}</a><Button variant="ghost" className="om-button h-auto" disabled={busy} onClick={() => void act(() => gatewayRequest(`settings/agents/${agent.id}/inspect`, 'POST', {}), 'Agent status refreshed', 'refresh_status')}><RemixIcon name="refresh-line" size={14} />{t(busy ? 'Checking…' : 'Check again')}</Button></div></section>
    <section className="om-card om-card-stack"><div className="om-settings-row"><h2 className="om-subtitle">2 · {t('Sign in')}</h2><span className="om-badge" data-active={agent.auth === 'signed-in'}>{t(authLabel[agent.auth])}</span></div><p className="om-muted">{t('Sign in in the Agent’s own terminal. OpenMotion never copies your login credentials.')}</p>{agent.loginHint && <p className="om-muted">{t(agent.loginHint)}</p>}<Button variant="ghost" className="om-button h-auto" disabled={!agent.installed || busy} onClick={() => setLaunch('login')}><RemixIcon name="terminal-box-line" size={15} />{t(agent.auth === 'signed-in' ? 'Manage sign-in' : 'Open sign-in')}</Button></section>
    <section className="om-settings-section"><div className="om-settings-row"><h2 className="om-subtitle">3 · {t('Agent model')}</h2><div className="om-settings-actions"><Button variant="ghost" className="om-button h-auto" disabled={!agent.installed || busy} onClick={() => void act(() => gatewayRequest(`settings/agents/${agent.id}/inspect`, 'POST', {}), 'Models refreshed', 'refresh_models')}>{t('Refresh models')}</Button><Tooltip label={t('Add model ID')} wrap><IconButton variant="ghost" className="motion-icon-button" disabled={!agent.installed} aria-label={t('Add model ID')} onClick={() => setAdding(!adding)} icon={<RemixIcon name="add-line" size={16} />} /></Tooltip></div></div>
      {agent.discoveryError && <p className="om-muted">{t(agent.discoveryError)}</p>}
      <label className="om-field"><RemixIcon name="search-line" size={15} /><input type="search" aria-label={t('Search Agent models')} placeholder={t('Search models…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {adding && <form className="om-settings-actions" onSubmit={event => { event.preventDefault(); void act(async () => { await gatewayRequest(`settings/agents/${agent.id}/models`, 'POST', { model: custom }); setCustom(''); setAdding(false); }, 'Model added', 'add_model'); }}><label className="om-field"><input value={custom} onChange={event => setCustom(event.target.value)} aria-label={t('Exact model ID')} placeholder={t('Exact model ID')} required maxLength={200} /></label><Button variant="ghost" className="om-button h-auto" disabled={busy || !custom.trim()}>{t('Add model')}</Button></form>}
      <div className="om-agent-model-list" role="group" aria-label={t('Agent model')}><Button variant="plain" className="om-nav-item" aria-pressed={model === 'default'} onClick={() => { setModel('default'); setReasoning(''); }}><ProviderAvatar name={agent.label} provider={agentIcon(agent)} /><span className="om-model-choice-label">{t('Follow Agent default')}</span>{model === 'default' && <RemixIcon name="check-line" size={15} />}</Button>{agent.models.filter(item => `${item.label} ${item.id}`.toLowerCase().includes(query.toLowerCase())).map(item => <Button variant="plain" key={item.id} className="om-nav-item" aria-pressed={model === item.id} onClick={() => { setModel(item.id); setReasoning(''); }}><ModelAvatar name={item.label} modelId={item.id} provider={agentIcon(agent)} /><span className="om-model-choice-label"><strong>{item.label}</strong><small className="om-muted">{item.id} · {t(item.source === 'cli' ? 'Discovered' : item.source === 'alias' ? 'Agent alias' : 'Custom')}</small></span>{model === item.id && <RemixIcon name="check-line" size={15} />}</Button>)}</div>
      {!agent.models.length && <p className="om-muted">{t('No model catalogue yet. Follow the Agent default, or add an exact model ID after sign-in.')}</p>}
      {modelInfo?.reasoning?.length ? <label className="om-label"><span>{t('Reasoning effort')}</span><Select label={t('Reasoning effort')} value={reasoning} onCommit={setReasoning} options={[{ value: '', label: t('Follow Agent default') }, ...modelInfo.reasoning.map(value => ({ value, label: value }))]} /></label> : null}
      {model !== 'default' && !agent.modelFlag && <p className="om-muted">{t('This Agent selects models inside its own UI. The connection instruction includes your selection.')}</p>}
      <div className="om-settings-actions"><Button variant="ghost" className="om-button h-auto" data-primary disabled={busy || !agent.installed || agent.auth === 'signed-out' || selected} onClick={() => void act(() => gatewayRequest('settings/default-agent', 'PUT', { choice }), 'Default Agent updated', 'set_default_agent')}>{t(selected ? 'Default Agent selected' : 'Set as default Agent')}</Button><Button variant="ghost" className="om-button h-auto" disabled={!agent.installed || busy || agent.auth === 'signed-out'} onClick={() => setLaunch('launch')}><RemixIcon name="terminal-box-line" size={15} />{t('Use in this project')}</Button></div>
    </section>
    {launch && <AgentLaunchDialog choice={choice} agent={agent} action={launch} onClose={() => { setLaunch(null); void act(() => gatewayRequest(`settings/agents/${agent.id}/inspect`, 'POST', {})); }} />}
  </div>;
}

export function AgentLaunchDialog({ choice, agent, action, onClose }: { choice: AgentChoice; agent: LocalAgent; action: 'login' | 'launch'; onClose: () => void }) {
  const { t } = useI18n(), toast = useToast();
  const [plan, setPlan] = useState<AgentLaunch | null>(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const body = { ...choice, action }, scope = projectScope();
  useEffect(() => { let active = true; setFailed(false); void gatewayRequest<AgentLaunch>(`settings/agents/${choice.agent}/prepare${scope}`, 'POST', body).then(value => { if (active) setPlan(value); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [attempt]);
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); toast.showToast(t('Copied to clipboard'), 'info'); } catch { toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error'); } }
  async function open() { setBusy(true); try { await gatewayRequest(`settings/agents/${choice.agent}/open${scope}`, 'POST', body); tracking.reportAgentSetting(choice.agent, 'open_terminal', 'success'); toast.showToast(t('Terminal opened. Continue in your Agent, then check its status here.'), 'info'); } catch (error) { tracking.reportAgentSetting(choice.agent, 'open_terminal', 'failure'); toast.showToast(error instanceof Error ? error.message : t('Could not open Agent'), 'error'); } finally { setBusy(false); } }
  return <SettingsDialog title={`${agent.label} · ${t(action === 'login' ? 'Sign in' : 'Use in this project')}`} onClose={onClose}><div className="om-agent-connection">{failed ? <SettingsError retry={() => setAttempt(value => value + 1)} /> : !plan ? <SettingsLoading /> : <>
    <p className="om-muted">{t(action === 'login' ? agent.loginHint || 'Complete sign-in in the terminal, then return here and check again.' : 'Open your Agent in this project and paste the connection instruction. Your selected model is included.')}</p><pre className="om-code-block">{plan.command}</pre><div className="om-settings-actions"><Button variant="ghost" className="om-button h-auto" data-primary disabled={busy} onClick={() => void open()}>{t('Open terminal')}</Button><Button variant="ghost" className="om-button h-auto" onClick={() => void copy(plan.command)}>{t('Copy command')}</Button></div>
    {action === 'launch' && <><h3 className="om-subtitle">{t('Connect this workspace')}</h3><pre className="om-code-block">{plan.instruction}</pre><Button variant="ghost" className="om-button h-auto" onClick={() => void copy(plan.instruction)}>{t('Copy connection instruction')}</Button></>}
    <p className="om-muted">{t('Opening a terminal does not confirm login or an MCP connection. Check the Agent’s response before starting work.')}</p><Button variant="ghost" className="om-button h-auto" onClick={onClose}>{t('Done · check status')}</Button>
  </>}</div><StudioToastViewport {...toast} /></SettingsDialog>;
}

export function DefaultAgentCard({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n(), directory = useLocalAgents(), toast = useToast();
  const [id, setId] = useState(''), [model, setModel] = useState('default'), [reasoning, setReasoning] = useState(''), [busy, setBusy] = useState(false), [launch, setLaunch] = useState(false);
  const selectedId = id || directory.data?.default?.agent || '';
  const agent = directory.data?.agents.find(item => item.id === selectedId);
  const selectedModel = id ? model : directory.data?.default?.model || 'default';
  const selectedReasoning = id ? reasoning : directory.data?.default?.reasoning || '';
  const modelInfo = agent?.models.find(item => item.id === selectedModel);
  const choice: AgentChoice = { agent: selectedId, model: selectedModel, ...(selectedReasoning ? { reasoning: selectedReasoning } : {}) };
  useEffect(() => {
    if (!agent?.installed || agent.checkedAt) return;
    let active = true; setBusy(true);
    void gatewayRequest(`settings/agents/${agent.id}/inspect`, 'POST', {}).then(() => { if (active) notifyAgentsChanged(); }).catch(() => { if (active) toast.showToast(t('Could not load Agent models'), 'error'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [agent?.id, agent?.installed]);
  async function selectAgent(value: string) {
    tracking.reportSettingsClick('default_agent', 'select_agent', { agent: value });
    setId(value); setModel('default'); setReasoning(''); setBusy(true);
    try { await gatewayRequest(`settings/agents/${value}/inspect`, 'POST', {}); notifyAgentsChanged(); }
    catch { toast.showToast(t('Could not load Agent models'), 'error'); } finally { setBusy(false); }
  }
  async function save(value: string, effort = value === selectedModel ? selectedReasoning : '') {
    setModel(value); setReasoning(effort); setId(selectedId); setBusy(true);
    try { await gatewayRequest('settings/default-agent', 'PUT', { choice: { agent: selectedId, model: value, ...(effort ? { reasoning: effort } : {}) } }); notifyAgentsChanged(); tracking.reportAgentSetting(selectedId, 'set_default_agent', 'success'); toast.showToast(t('Default Agent updated'), 'info'); }
    catch (error) { tracking.reportAgentSetting(selectedId, 'set_default_agent', 'failure'); toast.showToast(error instanceof Error ? error.message : t('Could not save settings'), 'error'); } finally { setBusy(false); }
  }
  return <section className={compact ? 'om-settings-section' : 'om-card om-settings-section'} aria-label={t('Default Agent')}><div className="om-settings-row"><h2 className="om-subtitle">{t('Default Agent')}</h2><Button variant="ghost" className="om-button h-auto" onClick={openAgentSettings}>{t('Manage Agents')}</Button></div>
    {directory.error ? <SettingsError retry={directory.refresh} /> : !directory.data ? <SettingsLoading /> : <>
      <div className="om-agent-choice-fields" data-compact={compact || undefined}>
        <div className="om-label"><span>{t('Choose Agent')}</span><Select label={t('Choose Agent')} disabled={busy} value={selectedId} onCommit={value => void selectAgent(value)} options={[{ value: '', label: t('Choose Agent'), disabled: true }, ...[...directory.data.agents].sort((a, b) => Number(b.installed) - Number(a.installed)).map(item => ({ value: item.id, label: item.label, description: t(item.installed ? authLabel[item.auth] : 'Not installed'), icon: <ProviderAvatar name={item.label} provider={agentIcon(item)} />, disabled: !item.installed }))]} /></div>
        {agent && <div className="om-label"><span>{t('Agent model')}</span><Select label={t('Agent model')} disabled={busy} value={selectedModel} onCommit={value => void save(value)} options={[{ value: 'default', label: t('Follow Agent default'), icon: <ProviderAvatar name={agent.label} provider={agentIcon(agent)} /> }, ...agent.models.map(item => ({ value: item.id, label: item.label, description: item.id !== item.label ? item.id : undefined, icon: <ModelAvatar name={item.label} modelId={item.id} provider={agentIcon(agent)} /> })), ...(selectedModel !== 'default' && !agent.models.some(item => item.id === selectedModel) ? [{ value: selectedModel, label: selectedModel, description: t('Unavailable'), disabled: true }] : [])]} /></div>}
        {modelInfo?.reasoning?.length ? <div className="om-label"><span>{t('Reasoning effort')}</span><Select label={t('Reasoning effort')} disabled={busy} value={selectedReasoning} onCommit={value => void save(selectedModel, value)} options={[{ value: '', label: t('Follow Agent default'), icon: <RemixIcon name="flashlight-line" size={16} /> }, ...modelInfo.reasoning.map(value => ({ value, label: value, icon: <RemixIcon name="flashlight-line" size={16} /> }))]} /></div> : null}
      </div>
      {agent && <div className="om-settings-actions"><Button variant="ghost" className="om-button h-auto" disabled={busy || !agent.installed || agent.auth === 'signed-out'} onClick={() => void save(selectedModel)}>{t('Save default')}</Button><Button variant="ghost" className="om-button h-auto" disabled={busy || !agent.installed || agent.auth === 'signed-out'} onClick={() => setLaunch(true)}><RemixIcon name="terminal-box-line" size={15} />{t('Use in this project')}</Button></div>}
      {!compact && <p className="om-muted">{t('The Agent edits your project. Media models below generate images, video and audio independently.')}</p>}
    </>}{launch && agent && <AgentLaunchDialog agent={agent} choice={choice} action="launch" onClose={() => setLaunch(false)} />}<StudioToastViewport {...toast} />
  </section>;
}
