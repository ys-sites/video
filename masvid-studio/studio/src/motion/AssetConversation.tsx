import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AssetChat } from '../../../shared/asset-chat';
import type { GenerationJob } from '../../../shared/gateway';
import { RemixIcon } from '../icons/RemixIcons';
import { ModelAvatar } from './settingsPrimitives';
import { AssetGenerationCard, CreationEmblem, WorkingIndicator, creationKinds } from './AssetCreationVisuals';
import type { AssetReference } from '../../../shared/asset-library';
import { gatewayRequest } from './gatewayClient';
import { useLocalAgents, openAgentSettings } from './useLocalAgents';
import { useI18n } from '../i18n/I18n';
import { Popover } from '../components/ui/Popover';
import { Skeleton } from '../components/ui/Skeleton';
import { Select } from '../components/ui/Select';
import { useWorkspaceChrome } from './WorkspaceFrame';
export function AssetConversation({ conversationId, onChanged, onStarted, onSending, references, referenceControls, active, jobs, onCancel, onView, onRetrySave, onResume, onError }: { conversationId?: string; onChanged: (chat: AssetChat) => void; onStarted: (id: string) => void; onSending: (sending: boolean) => void; references: AssetReference[]; referenceControls: ReactNode; active: boolean; jobs: GenerationJob[]; onCancel: (job: GenerationJob) => void; onView: (job: GenerationJob) => void; onRetrySave?: (job: GenerationJob) => Promise<void>; onResume?: (job: GenerationJob) => Promise<void>; onError: (message: string) => void }) {
  const { t } = useI18n(), { openConnections } = useWorkspaceChrome(), agents = useLocalAgents();
  const codex = agents.data?.agents.find(a => a.id === 'codex');
  const [chat, setChat] = useState<AssetChat>(), [text, setText] = useState(''), [model, setModel] = useState('default'), [sending, setSending] = useState(false), [reasoning, setReasoning] = useState('default');
  const efforts = codex?.models.find(m => m.id === model)?.reasoning ?? [];
  const listRef = useRef<HTMLDivElement>(null), follow = useRef(true);
  const busy = chat?.state === 'running' || chat?.state === 'waiting';
  const mounted = useRef(true), chatRef = useRef<AssetChat>(undefined);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>(conversationId ? 'loading' : 'ready'), [retry, setRetry] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onSending(sending); }, [sending, onSending]);
  const acceptChat = useCallback((next: AssetChat) => { if (mounted.current) { chatRef.current = next; setChat(next); onChanged(next); } }, [onChanged]);
  useEffect(() => {
    if (!active || !conversationId || chatRef.current?.id === conversationId) return;
    let cancelled = false; setLoadState('loading');
    void gatewayRequest<{ conversation: AssetChat }>(`assets/conversations/${conversationId}`).then(result => {
      if (!cancelled) { acceptChat(result.conversation); setLoadState('ready'); }
    }).catch(() => { if (!cancelled) setLoadState('failed'); });
    return () => { cancelled = true; };
  }, [active, conversationId, retry, acceptChat]);
  useEffect(() => {
    if (!active || !chat?.id || !busy) return;
    let cancelled = false, pending = false;
    const poll = async () => {
      if (pending || document.hidden) return; pending = true;
      try { const result = await gatewayRequest<{ conversation: AssetChat }>(`assets/conversations/${chat.id}`); if (!cancelled) acceptChat(result.conversation); }
      catch (error) { if (!cancelled) onError((error as Error).message); }
      finally { pending = false; }
    };
    const timer = setInterval(() => void poll(), 1200); return () => { cancelled = true; clearInterval(timer); };
  }, [active, chat?.id, busy, onError, acceptChat]);
  useEffect(() => { if (follow.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [chat?.updatedAt, jobs]);
  const action = async (action: string, body: unknown = {}) => {
    if (!chat) return; setSending(true);
    try { acceptChat((await gatewayRequest<{ conversation: AssetChat }>(`assets/conversations/${chat.id}/${action}`, 'POST', body)).conversation); }
    catch (error) { if (mounted.current) onError((error as Error).message); } finally { if (mounted.current) setSending(false); }
  };
  const send = async () => {
    if (loadState !== 'ready' || !text.trim() || sending || busy || !codex?.installed || codex.auth === 'signed-out') return; setSending(true);
    try {
      const current = chat ?? (await gatewayRequest<{ conversation: AssetChat }>('assets/conversations', 'POST', {})).conversation;
      if (!mounted.current) return;
      acceptChat(current); if (!chat) onStarted(current.id);
      const result = await gatewayRequest<{ conversation: AssetChat }>(`assets/conversations/${current.id}/turn`, 'POST', { requestId: crypto.randomUUID(), text, references, ...(model !== 'default' ? { model } : {}), ...(efforts.includes(reasoning) ? { reasoning } : {}) });
      if (mounted.current) { acceptChat(result.conversation); setText(''); follow.current = true; }
    } catch (error) { if (mounted.current) onError((error as Error).message); } finally { if (mounted.current) setSending(false); }
  };
  const conversationJobs = jobs.filter(job => job.library?.conversationId === chat?.id && chat).slice(0, 4);
  return <div className="om-asset-chat">
    <div className="om-asset-chat-messages" ref={listRef} onScroll={() => { const el = listRef.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }} aria-label={t('Conversation')}>
      {loadState === 'loading' && <div className="om-task-chat-loading" role="status"><span className="om-sr-only">{t('Loading conversation…')}</span><Skeleton /><Skeleton /><Skeleton /></div>}
      {loadState === 'failed' && <div className="om-task-history-notice" role="status"><p>{t('Could not load conversation')}</p><Button variant="ghost" className="om-button h-auto" onClick={() => setRetry(value => value + 1)}><RemixIcon name="refresh-line" size={14} />{t('Retry')}</Button></div>}
      {loadState === 'ready' && !chat?.messages.length && <div className="om-creation-agent-intro"><CreationEmblem /><span className="om-creation-kicker">{t('AN IDEA. A CONVERSATION. A CREATION.')}</span><h3>{t('A creative partner,\nfrom the first spark.')}</h3><p className="om-muted">{t('Explore an idea, build on a reference, or create something entirely new.')}</p><div className="om-creation-suggestions">{creationKinds.map(kind => <Button variant="plain" className="om-creation-suggestion" key={kind.id} onClick={() => setText(t('Agent ' + kind.id + ' prompt'))}><span className="om-creation-icon" data-tone={kind.id}><RemixIcon name={kind.icon} size={20} /></span><span><strong>{t('Agent ' + kind.id + ' idea')}</strong><small>{t('Agent ' + kind.id + ' hint')}</small></span><RemixIcon name="arrow-right-up-line" size={16} /></Button>)}</div></div>}
      {chat?.messages.map(message => message.role === 'tool' ? <details className="om-creation-tool" key={message.id}><summary><span className="om-creation-icon" data-tone="agent"><RemixIcon name="stack-line" size={14} /></span><span>{t(toolLabel(message.text))}</span><RemixIcon name="arrow-down-s-line" size={14} /></summary><pre className="om-code-block">{message.text}</pre></details>
        : <div className="om-asset-chat-message om-creation-message" data-role={message.role} key={message.id}>{message.role === 'assistant' && <span className="om-creation-message-avatar om-creation-icon" data-tone="agent"><RemixIcon name="sparkling-fill" size={17} /></span>}<div><span className="om-eyebrow">{t(message.role === 'user' ? 'You' : 'Creative Agent')}</span><p>{message.text}</p></div></div>)}
      {conversationJobs.map(job => <AssetGenerationCard key={job.id} job={job} onCancel={onCancel} onView={onView} onRetrySave={onRetrySave} onResume={onResume} />)}
      {busy && !chat?.approvals.length && <div className="om-creation-thinking" role="status"><WorkingIndicator /><span>{t('Agent is working…')}</span><span className="om-eyebrow">{t('Exploring the possibilities')}</span></div>}
      {chat?.error && <div className="om-card om-asset-chat-message" role="status"><RemixIcon name="error-warning-line" size={20} /><p>{chat.error}</p><span className="om-muted">{t('Send a new message to continue. Generation jobs keep their own status.')}</span></div>}
      {chat?.approvals.map(approval => <section className="om-creation-approval" key={approval.id}><div className="om-creation-row"><span className="om-creation-icon" data-tone="audio"><RemixIcon name="shield-check-line" size={20} /></span><div><h3 className="om-subtitle">{t(approval.title)}</h3><p className="om-muted">{t('Review the plan before it runs.')}</p></div></div><ApprovalDetail detail={approval.detail} generation={approval.kind === 'generation'} /><div className="om-asset-actions"><Button variant="ghost" className="om-button h-auto" disabled={sending} onClick={() => void action('approve', { approvalId: approval.id, accepted: false })}>{t('Decline')}</Button><Button variant="ghost" className="om-button h-auto" data-primary disabled={sending} onClick={() => void action('approve', { approvalId: approval.id, accepted: true })}><RemixIcon name="check-line" size={16} />{t('Approve')}</Button></div></section>)}
    </div>
    <div className="om-asset-chat-compose">
      {codex && (!codex.installed || codex.auth === 'signed-out') && <Button variant="ghost" className="om-button h-auto" onClick={openAgentSettings}><RemixIcon name="plug-line" size={16} />{t('Set up Codex')}</Button>}
      {agents.error && <Button variant="ghost" className="om-button h-auto" onClick={agents.refresh}>{t('Retry Agent discovery')}</Button>}
      <div className="om-creation-prompt om-creation-chat-input"><textarea aria-label={t('Message your Agent')} placeholder={t('What would you love to create?')} disabled={loadState !== 'ready'} value={text} maxLength={20000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} rows={3} />{referenceControls}<div className="om-creation-chat-toolbar"><Select label={t('Agent model')} value={model} onCommit={value => { setModel(value); setReasoning('default'); }} disabled={busy || sending} options={[{ value: 'default', label: t('Codex · default model'), icon: <ModelAvatar name="Codex" modelId="codex" provider={{ id: 'codex', custom: false }} /> }, ...(codex?.models ?? []).map(m => ({ value: m.id, label: m.label, icon: <ModelAvatar name={m.label} modelId={m.id} provider={{ id: 'codex', custom: false }} /> }))]} /><Popover side="top" align="end" aria-label={t('Agent settings')} className="om-agent-settings-popover" trigger={<IconButton variant="plain" className="om-nav-item" aria-label={t('Agent settings')} disabled={busy || sending} icon={<RemixIcon name="equalizer-line" size={17} />} />}><div className="om-creation-row"><span className="om-creation-icon" data-tone="agent"><RemixIcon name="robot-line" size={19} /></span><strong>{t('Agent settings')}</strong></div><p className="om-muted">{t('Codex runs this conversation. Other Agents connect through MCP.')}</p><label className="om-label">{t('Reasoning effort')}<Select label={t('Reasoning effort')} value={efforts.includes(reasoning) ? reasoning : 'default'} onCommit={setReasoning} disabled={!efforts.length} options={[{ value: 'default', label: t('Model default') }, ...efforts.map(value => ({ value, label: t(value) }))]} /></label>{!efforts.length && <p className="om-eyebrow">{t('Choose a model with discovered reasoning options.')}</p>}<Button variant="ghost" className="om-button h-auto" onClick={() => openConnections('asset_chat')}><RemixIcon name="plug-line" size={16} />{t('Connect an external Agent')}</Button></Popover>{busy ? <IconButton variant="plain" className="om-button om-creation-send" disabled={sending} aria-label={t('Stop')} onClick={() => void action('stop')} icon={<RemixIcon name="checkbox-blank-fill" size={16} />} /> : <IconButton variant="plain" className="om-button om-creation-send" data-primary aria-label={t(sending ? 'Working…' : 'Send')} disabled={loadState !== 'ready' || sending || !text.trim() || !codex?.installed || codex.auth === 'signed-out'} onClick={() => void send()} icon={<RemixIcon name={sending ? 'loader-4-line' : 'arrow-up-line'} size={21} />} />}</div></div>
      <div className="om-creation-chat-note"><span className="om-eyebrow">{t('Powered by your local Codex')}</span><Button variant="plain" className="om-nav-item" onClick={() => openConnections('asset_chat')}><RemixIcon name="plug-line" size={14} />{t('Connect an external Agent')}</Button></div>
    </div>
  </div>;
}
function toolLabel(text: string) {
  try {
    const data = JSON.parse(text.slice(text.indexOf(':') + 1));
    return data.error ? 'Asset operation failed' : data.job ? 'Generation request updated' : data.models ? 'Available models explored' : data.assets ? 'Asset library explored' : 'Asset operation completed';
  } catch { return 'Asset operation'; }
}
function ApprovalDetail({ detail, generation }: { detail: string; generation: boolean }) {
  const { t } = useI18n();
  let data: Record<string, unknown> | undefined;
  try { const value = JSON.parse(detail); if (value && typeof value === 'object' && !Array.isArray(value)) data = value; } catch { /* Preserve the original request when it is not structured. */ }
  return generation && typeof data?.prompt === 'string' ? <><p className="om-creation-approval-prompt">{data.prompt}</p><span className="om-badge">{typeof data.model === 'string' ? data.model : t('Generation model')}</span><details><summary className="om-nav-item">{t('Request details')}<RemixIcon name="arrow-down-s-line" size={14} /></summary><pre className="om-code-block">{detail}</pre></details></> : <pre className="om-code-block">{detail}</pre>;
}
