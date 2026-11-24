import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AccountAttempt, AccountErrorCode, AccountSummary, DirectoryModel } from '../shared/provider-directory.ts';
import type { GenerationJob, Model } from '../shared/gateway.ts';
import { validField, type EventFields } from '../tracking/core.ts';
import { accountErrorKinds, accountStages, type omEvents } from '../tracking/events.ts';
import { readSettings, writeSettings } from './settings-storage.ts';
import { planMediaEntitlement } from './account-media.ts';
import { registeredProvider } from '../shared/provider-registry.ts';
import { defaultVideoAudioEnabled, resolveGenerationParameters } from '../shared/generation-options.ts';
import { apiJson, ProviderError, retryRead, type Fetcher } from './network.ts';
import { cloudImageParameters, uploadInputs } from './opendesign.ts';
import type { ProviderContext } from './providers.ts';
import { resumableDownload, type DownloadProgress } from './resumable-download.ts';
import { accountDirectory } from './account-directory.ts';
import { withProcessLock } from '../shared/process-lock.ts';
import { connectorRuntime, connectorVersion, ConnectorUnavailable, installConnector, manualInstallCommand, verifyConnector, type ConnectorProblem } from './account-connector.ts';

const execute = promisify(execFile);
/** The launcher for the system default browser, which is also where the connector opens sign-in. */
export function systemBrowserCommand(url: string, platform: string) {
  if (platform === 'darwin') return { command: '/usr/bin/open', args: [url] };
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}
async function openSystemBrowser(url: string) {
  const { command, args } = systemBrowserCommand(url, process.platform);
  await execute(command, args, { timeout: 10_000, windowsHide: true });
}
const consoleUrl = registeredProvider('account')!.website!;
export type SignInRecord = EventFields<typeof omEvents['account_sign_in_result']>;
type Profile = { apiUrl?: string; controlKey?: string; controlKeyId?: string; runtimeKey?: string; pendingLogin?: unknown; user?: { id?: string; name?: string; email?: string } };
/** Connector-owned credentials file. `pendingRevocations` holds keys whose remote revocation has not been confirmed yet. */
type CredentialsFile = { profiles?: Record<string, Profile>; pendingRevocations?: unknown[] };
type AccountOptions = {
  pollMs?: number; binary?: string; authorizationMs?: number; log?: (line: string) => void;
  run?: (args: string[], signal?: AbortSignal) => Promise<string>; spawn?: typeof spawn;
  fetcher?: Fetcher;
  download?: typeof import('./network.ts').streamMedia;
  /** Receives one record per finished sign-in attempt. */
  track?: (record: SignInRecord) => void;
};

// Connector stdout contract for `login --completion-receipt=stdin-v1` with `jsonl-v1` stage lines.
const stagePrefix = 'OPEN_DESIGN_AMR_AUTH_STAGE\t', completionPrefix = 'OPEN_DESIGN_AMR_AUTH_COMPLETION\t';
const stageNames: readonly string[] = accountStages;
const failureMessages: Record<AccountErrorCode, string> = {
  connector_unavailable: "Couldn't download the OpenDesign sign-in component. Check your network or proxy, then select Retry. If it keeps failing, run this command in a terminal, then select Retry:",
  setup_failed: "Can't connect to OpenDesign right now. Check your network and try again.",
  authorization_expired: 'Browser authorization expired or was cancelled. Sign in again.',
  credentials_rejected: 'Account credentials could not be verified. Sign in again, and contact us if this keeps happening.',
};
// A connector that cannot be prepared explains why; each message ends with the manual installation command.
const connectorMessages: Record<ConnectorProblem, string> = {
  npm_missing: "OpenMotion couldn't find npm to set up the OpenDesign sign-in component. Run this command in a terminal, then select Retry:",
  install_failed: failureMessages.connector_unavailable,
  start_failed: "The OpenDesign sign-in component couldn't start on this device. Run this command in a terminal to reinstall it, then select Retry:",
};
// A connector named by OPENMOTION_ACCOUNT_CLI is used as is, so no install command is offered for it.
const explicitConnectorMessage = "The OpenDesign sign-in component set by OPENMOTION_ACCOUNT_CLI couldn't start. Check or clear that path, then select Retry.";
/** Sign-in failure messages Studio translates by exact text. */
export const accountSignInMessages = [...new Set([...Object.values(failureMessages), ...Object.values(connectorMessages), explicitConnectorMessage])];
// Billing, media and sign-out use the control key; models use the runtime key. Accept only a complete pair.
const hasCredentials = (profile?: Profile) => Boolean(profile?.controlKey && profile.controlKeyId && profile.runtimeKey && profile.user?.id);
const signedInProfile = (profile?: Profile) => hasCredentials(profile) && !profile!.pendingLogin;

// Service error codes the connector reports, mapped to fixed (translatable) messages.
const requestMessages: Record<string, string> = {
  // A media 401 does not change the account state, so the user has to sign out before signing in again.
  unauthorized: 'Your OpenDesign sign-in is no longer accepted. Sign out, then sign in again.',
  invalid_request: 'OpenDesign rejected this request for the selected model. Choose another model or change the options, then try again.',
  tier_model_not_entitled: 'Your OpenDesign plan does not include this model. Choose another model or upgrade your plan.',
  tier_request_kind_not_entitled: 'Your OpenDesign plan does not include this model. Choose another model or upgrade your plan.',
  model_access_denied: 'Your OpenDesign plan does not include this model. Choose another model or upgrade your plan.',
  insufficient_balance: 'Your OpenDesign balance is too low for this request. Top up, then try again.',
  tier_limit_exceeded: 'OpenDesign media rate or concurrency limit reached. Wait for running tasks to finish, then try again.',
  provider_error: 'The model provider could not complete this request. Try again later or choose another model.',
  request_state_unknown: 'OpenDesign could not confirm whether this request ran, so it was not resubmitted. Check your OpenDesign history before retrying.',
  media_execution_unknown: 'OpenDesign could not confirm whether this request ran, so it was not resubmitted. Check your OpenDesign history before retrying.',
  asset_too_large: 'The reference image is larger than the 2 MiB OpenDesign upload limit.',
  unsupported_media_type: 'OpenDesign does not accept this reference image format.',
};
const jobMessages = {
  connection: 'OpenDesign account request failed. Check your connection and sign in again if needed.',
  service: 'OpenDesign could not complete this request. Try again later, and contact us if this keeps happening.',
  resultUnreadable: 'OpenDesign accepted this task, but its result could not be read. Check the original task before retrying.',
  resultUnauthorized: 'OpenDesign accepted this task, but your sign-in was rejected while reading its result. Sign out, then sign in again, and check the original task before retrying.',
  taskFailed: 'Account media task failed. Check the original task before retrying.',
  accountChangedBeforeSubmit: 'Account changed; the queued task was not submitted',
  accountChangedAfterSubmit: 'Account changed; check the original task before retrying',
  unknownTaskStatus: 'OpenDesign reported a task status this version does not recognize. Check the original task before retrying.',
};
/** Account media failures from the service or an accepted task (submit validates parameters earlier). Studio translates them by exact text, so each must stay a dictionary key. */
export const accountMediaMessages = [...new Set([...Object.values(requestMessages), ...Object.values(jobMessages)])];
/** Connector request failure. Keeps only the HTTP status and service error code; CLI stderr can contain account data. */
export class AccountRequestError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(stderr: string) {
    // Generic API errors read `API request failed with status 403: code`; media commands read `<text> (code, HTTP 400)`.
    const api = /API request failed with status (\d{3})(?:: ([a-z0-9_]{1,64})(?=\s|$))?/.exec(stderr);
    // A response without a JSON body has an empty code: `(, HTTP 502)`.
    const media = api ? undefined : [...stderr.matchAll(/\(([^,()]{0,64}), HTTP (\d{3})\)/g)].at(-1);
    const status = api ? Number(api[1]) : media ? Number(media[2]) : undefined;
    const code = api ? api[2] : media && /^[a-z0-9_]{1,64}$/.test(media[1]) ? media[1] : undefined;
    // Local CLI flag/argument rejections exit without an HTTP status; do not misreport them as connection or sign-in failures.
    const cliInvalid = !status && !code && /(?:^|\n)Error: (?:if any flags in the group |unknown (?:shorthand )?flag:|invalid argument |required flag\(s\) |flag needs an argument:)/.test(stderr);
    super((code && requestMessages[code]) || (cliInvalid ? requestMessages.invalid_request : status === 401 ? requestMessages.unauthorized : status ? jobMessages.service : jobMessages.connection));
    this.status = status; this.code = code;
  }
}
class SignInFailure extends Error {
  readonly code: AccountErrorCode;
  readonly connector?: ConnectorUnavailable;
  constructor(code: AccountErrorCode, connector?: ConnectorUnavailable) {
    super(connector ? connectorMessages[connector.problem] : failureMessages[code]); this.code = code; this.connector = connector;
  }
}
/**
 * Classifies an attempt by the furthest point it reached. Credentials that reached disk count as rejected; `authorize`
 * reports `setup_failed` instead when the connector kept them unconfirmed because the service was unreachable.
 */
function failureCode(attempt: AccountAttempt, cancelled: boolean): AccountErrorCode {
  if (attempt.persisted) return 'credentials_rejected';
  const [stage, , errorKind] = attempt.stages.findLast(entry => entry.split(':')[1] === 'failed' && !entry.startsWith('browser_open_result'))?.split(':') ?? [];
  // Exchanging or storing the authorization rejected nothing when the service was unreachable or the credentials could
  // not be written locally: nothing was accepted or persisted, so the attempt is retryable instead of a rejection.
  const unreachable = errorKind === 'network_error' || errorKind === 'credential_persist_error';
  if ((stage === 'token_exchange_result' || stage === 'credential_persist_result') && !unreachable) return 'credentials_rejected';
  if (cancelled || (stage === 'device_authorization_result' && errorKind !== 'network_error')) return 'authorization_expired';
  // Approved in the browser, then stopped before reporting a later stage (for example incomplete issued credentials).
  if (!stage && attempt.stages.includes('device_authorization_result:success')) return 'credentials_rejected';
  return 'setup_failed';
}

const productionApi = 'https://amr-api.open-design.ai';
/** The account media catalogue does not list these audio models yet, though `audio speech` and `audio music` accept them. */
const builtinAccountAudioModels: readonly DirectoryModel[] = [
  { id: 'account:elevenlabs-v3', provider: 'account', modelId: 'elevenlabs-v3', label: 'ElevenLabs Voice', kind: 'audio', enabled: true, source: 'builtin', mode: 'text-to-speech' },
  { id: 'account:byteplus-tts-2', provider: 'account', modelId: 'byteplus-tts-2', label: 'BytePlus Voice', kind: 'audio', enabled: true, source: 'builtin', mode: 'text-to-speech' },
  { id: 'account:elevenlabs-music-v2', provider: 'account', modelId: 'elevenlabs-music-v2', label: 'ElevenLabs Music', kind: 'audio', enabled: true, source: 'builtin', mode: 'text-to-audio' },
];
const withBuiltinAudio = (models: DirectoryModel[]): DirectoryModel[] => {
  const existing = new Set(models.map(model => model.id));
  return [...models, ...builtinAccountAudioModels.filter(model => !existing.has(model.id)).map(model => ({ ...model }))];
};

/** OpenDesign's versioned CLI owns device authorization and credentials. */
export class OpenDesignAccount {
  readonly home: string;
  private child?: ChildProcess;
  private connecting = false;
  private signingOut = false;
  private stateWrites: Promise<void> = Promise.resolve();
  private generation = 0;
  private authorizationUrl?: string;
  private userCode?: string;
  private error?: string;
  private errorCode?: AccountErrorCode;
  /** Why the connector could not be prepared, while `errorCode` is `connector_unavailable`. */
  private connectorProblem?: ConnectorProblem;
  private attempt?: AccountAttempt;
  // Retain the last verified plan internally through transient billing failures to detect upgrades on recovery.
  private billing?: { plan: string; balance: string | null; keyId?: string };
  private billingRequestId = 0;
  private billingModelRefresh?: Promise<unknown>;
  private billingUnavailable = false;
  private billingError?: { status: number; code?: string };
  /** Control key the account service rejected; cleared by a successful read or a new sign-in. */
  private rejectedKeyId?: string;
  private cachedModels: DirectoryModel[] = [];
  private cachedIdentity?: string;
  private modelRequestId = 0;
  /** In-flight `logout --retry-pending`. The connector rewrites the credentials file, so sign-in and sign-out wait for it. */
  private revoking?: Promise<void>;
  private revocationChecked = false;
  /** The connector exited with confirmed credentials and the session and model catalogue are being set up. */
  private syncing = false;
  /** Times since the sign-in click, for the attempt record. */
  private clock?: { start: number; entryId: string; occurredAt: string; prepared?: number; link?: number; approved?: number };
  private preparing?: Promise<string>;
  /** Attempts already reported; two cancels racing each other must not count one attempt twice. */
  private reported = new WeakSet<AccountAttempt>();
  /** Stops a connector installation still running when the service shuts down. */
  private closing = new AbortController();
  private runtime?: string;
  readonly directory: string;
  /** Account state shared by every workspace of this user (see account-directory.ts). */
  readonly root: string;
  readonly options: AccountOptions;
  private adoption?: Promise<void>;
  constructor(directory: string, options: AccountOptions = {}) {
    this.directory = directory; this.options = options; this.root = accountDirectory(directory); this.home = path.join(this.root, 'credentials');
  }
  /**
   * Workspaces used to keep their own sign-in. Once per process, a workspace that still holds one hands it to the shared
   * directory when nothing is signed in there and it is newer than the shared directory's last sign-in or sign-out, and
   * drops its copy either way, so neither a sign-out nor an older sign-in of another workspace can bring it back.
   */
  private adopt() {
    return this.adoption ??= (async () => {
      const own = path.join(path.resolve(this.directory), 'account'), legacy = path.join(own, 'credentials', 'config.json');
      const profile = (await readSettings<CredentialsFile>(legacy, {}).catch(() => ({} as CredentialsFile))).profiles?.prod;
      if (!hasCredentials(profile) && !profile?.pendingLogin) return;
      // The same directory spelled differently (case, links, short names) must not be taken for a legacy copy and removed.
      const same = await Promise.all([stat(own, { bigint: true }), stat(this.root, { bigint: true })])
        .then(([a, b]) => a.dev === b.dev && a.ino === b.ino, () => false);
      if (same) return;
      await withProcessLock(path.join(this.root, 'adopt.lock'), async () => {
        // Every sign-in, cancel and sign-out writes the shared session file. A workspace sign-in made after that last
        // change is newer than whatever the shared directory decided; an older one was already superseded or signed out.
        const missing = () => undefined;
        const [session, shared, workspace] = await Promise.all([stat(path.join(this.root, 'session.json')).catch(missing),
          stat(path.join(this.home, 'config.json')).catch(missing), stat(legacy).catch(missing)]);
        if (!workspace) return;
        if (!shared && (!session || workspace.mtimeMs > session.mtimeMs) && hasCredentials(profile)) {
          await this.moveLegacyAccount(own, legacy);
        }
        for (const file of [legacy, path.join(own, 'session.json'), path.join(own, 'models.json')]) await rm(file, { force: true });
      });
    })().catch(error => { (this.options.log ?? console.error)('OpenDesign account could not be moved to the shared directory: ' + (error as Error).message); });
  }
  /**
   * Copies a workspace's legacy account files into temporary paths under the shared directory before renaming them into
   * place, rolling back any committed file on error so the workspace keeps its only copy and no shared marker is left.
   */
  private async moveLegacyAccount(own: string, legacy: string) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    const suffix = '.' + randomUUID() + '.tmp';
    const plan = [
      { source: path.join(own, 'session.json'), target: path.join(this.root, 'session.json'), optional: true },
      { source: path.join(own, 'models.json'), target: path.join(this.root, 'models.json'), optional: true },
      { source: legacy, target: path.join(this.home, 'config.json'), optional: false },
    ];
    const staged: Array<{ temp: string; target: string; backup?: string }> = [];
    const committed: Array<{ target: string; backup?: string }> = [];
    try {
      for (const entry of plan) {
        const temp = entry.target + suffix;
        try { await copyFile(entry.source, temp); }
        catch (error) {
          await rm(temp, { force: true }).catch(() => {});
          if (entry.optional && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        staged.push({ temp, target: entry.target });
        await chmod(temp, 0o600);
      }
      // The session and catalogue go first, so a reader that finds the credentials also finds their session.
      for (const item of staged) {
        const backup = item.target + '.bak' + suffix;
        const backedUp = await rename(item.target, backup).then(() => true, (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
        if (backedUp) item.backup = backup;
        try { await rename(item.temp, item.target); }
        catch (error) {
          if (backedUp) await rename(backup, item.target).catch(() => {});
          throw error;
        }
        committed.push({ target: item.target, backup: item.backup });
      }
    } catch (error) {
      for (const item of committed.reverse()) {
        if (item.backup) await rename(item.backup, item.target).catch(() => {});
        else await rm(item.target, { force: true }).catch(() => {});
      }
      for (const item of staged) {
        await rm(item.temp, { force: true }).catch(() => {});
        if (item.backup) await rm(item.backup, { force: true }).catch(() => {});
      }
      throw error;
    }
    for (const item of committed) {
      if (item.backup) await rm(item.backup, { force: true }).catch(() => {});
    }
  }
  private env() {
    // A different application's environment keys must not override this account session.
    const env: NodeJS.ProcessEnv = { ...process.env, AMR_HOME: this.home, OPEN_DESIGN_AMR_PROFILE: 'prod', VELA_PROFILE: 'prod' };
    for (const key of ['VELA_RUNTIME_KEY', 'VELA_CONTROL_KEY', 'VELA_LINK_URL', 'VELA_API_URL', 'OD_AMR_ENDPOINT_BINDING']) delete env[key];
    return env;
  }
  private async credentials() {
    await this.adopt();
    return readSettings<CredentialsFile>(path.join(this.home, 'config.json'), {});
  }
  private async profile(): Promise<Profile | undefined> { return (await this.credentials()).profiles?.prod; }
  /** Retries revocations the connector could not deliver at sign-out; the file is removed once nothing is left to revoke. */
  private retryRevocations() {
    if (this.revoking || this.connecting || this.signingOut) return;
    this.revocationChecked = true;
    const generation = this.generation;
    this.revoking = this.run(['logout', '--retry-pending', '--json']).then(async output => {
      if (JSON.parse(output).revocationPending !== false || generation !== this.generation || this.connecting || this.signingOut) return;
      const file = await this.credentials(), profile = file.profiles?.prod;
      if (!file.pendingRevocations?.length && !profile?.controlKey && !profile?.runtimeKey && !profile?.pendingLogin) await rm(path.join(this.home, 'config.json'), { force: true });
    }).catch(() => { /* Still queued; retried on the next refresh. */ }).finally(() => { this.revoking = undefined; });
  }
  /** Support logs omit identities; only successful telemetry may carry the confirmed account ID. */
  private finish(attempt: AccountAttempt, outcome: SignInRecord['outcome'], errorCode?: AccountErrorCode, amrUserId?: string, connector?: ConnectorUnavailable) {
    if (this.reported.has(attempt)) return;
    this.reported.add(attempt);
    // The connector detail (npm output or start error) stays in the local log for support; telemetry gets only the problem.
    if (errorCode)(this.options.log ?? console.error)('OpenDesign sign-in failed ' + JSON.stringify({ errorCode, ...attempt, ...(connector ? { connectorProblem: connector.problem, connectorDetail: connector.detail } : {}) }));
    if (!this.options.track || !this.clock) return;
    const { start, prepared, link, approved } = this.clock, since = (mark?: number) => mark === undefined ? undefined : Math.round(mark - start);
    const [lastStage, lastResult] = attempt.stages.at(-1)?.split(':') ?? [];
    // Whether the browser opened is its own field; the error kind belongs to the stage that stopped the attempt.
    const errorKind = attempt.stages.findLast(entry => entry.split(':')[1] === 'failed' && !entry.startsWith('browser_open_result'))?.split(':')[2];
    const browser = attempt.stages.find(entry => entry.startsWith('browser_open_result:'))?.split(':')[1];
    const record = { attempt_id: attempt.id, outcome, error_code: errorCode, connector_problem: connector?.problem, connector_version: connectorVersion, resumed: Boolean(attempt.resumed),
      source_product: 'openmotion', source_detail: 'openmotion_editor_login', entry_id: this.clock.entryId, entry_occurred_at: this.clock.occurredAt,
      ...(outcome === 'success' && validField('code', amrUserId) ? { amr_user_id: amrUserId } : {}),
      last_stage: lastStage, last_result: lastResult, browser_opened: browser === undefined ? undefined : browser === 'success', receipt: attempt.receipt,
      error_kind: errorKind === undefined ? undefined : (accountErrorKinds as readonly string[]).includes(errorKind) ? errorKind : 'unknown',
      exit_code: typeof attempt.exitCode === 'number' && attempt.exitCode >= 0 ? attempt.exitCode : undefined,
      duration_ms: since(performance.now()), prepare_ms: since(prepared), link_ms: since(link), approved_ms: since(approved) };
    try { this.options.track(Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as SignInRecord); }
    catch { /* Telemetry never affects sign-in. */ }
  }
  private commit(generation: number, task: () => Promise<void>) {
    this.stateWrites = this.stateWrites.catch(() => {}).then(async () => { if (generation === this.generation) await task(); });
    return this.stateWrites;
  }
  private explicitBinary() { return this.options.binary || process.env.OPENMOTION_ACCOUNT_CLI; }
  private async resolveRuntime(install = false) {
    if (this.explicitBinary()) return this.explicitBinary()!;
    // A sign-in retry must rediscover a connector replaced since startup.
    if (!install && this.runtime) return this.runtime;
    // Source installations receive the locked connector with their dependencies; application artifacts omit it.
    try { return this.runtime = await verifyConnector(import.meta.url); } catch { /* Try an installed CLI. */ }
    try { const { stdout } = await execute('vela', ['--version'], { timeout: 5000 }); if (stdout.trim() === connectorVersion) return this.runtime = 'vela'; } catch { /* Try the private managed installation. */ }
    const root = connectorRuntime(this.directory);
    if (!install) return this.runtime = await verifyConnector(path.join(root, 'package.json')).catch(() => { throw new Error('Connect your OpenDesign account to prepare the account service.'); });
    return this.runtime = await installConnector(root, { signal: this.closing.signal });
  }
  /** Locates or installs the connector. Background preparation and sign-in share one installation. */
  private prepare() {
    return this.preparing ??= this.resolveRuntime(true).finally(() => { this.preparing = undefined; });
  }
  /** Prepares the connector after startup so the first sign-in does not wait for it. A failure stays silent; sign-in tries again. */
  prefetch() { void this.prepare().catch(() => {}); }
  async run(args: string[], signal?: AbortSignal) {
    if (this.options.run) return this.options.run(args, signal);
    // A workspace can be signed in through the shared account before its own connector is prepared.
    try { const { stdout } = await execute(await this.resolveRuntime().catch(() => this.prepare()), args, { env: this.env(), timeout: 120_000, signal, maxBuffer: 2 * 1024 * 1024 }); return stdout; }
    catch (error) { throw new AccountRequestError(String((error as { stderr?: unknown }).stderr ?? '')); }
  }
  async summary(refresh = false): Promise<AccountSummary> {
    const generation = this.generation;
    const file = await this.credentials(), profile = file.profiles?.prod;
    // Undelivered revocations are retried once after startup and on every refresh.
    if (file.pendingRevocations?.length && (refresh || !this.revocationChecked)) this.retryRevocations();
    const signedIn = signedInProfile(profile) && Boolean(await this.identity());
    if (refresh && signedIn && !this.connecting) {
      await this.readBilling(generation, profile!);
      await this.billingModelRefresh;
    }
    if (generation !== this.generation) return this.summary();
    const rejected = signedIn && this.rejectedKeyId === profile!.controlKeyId;
    const browser = this.attempt?.stages.find(entry => entry.startsWith('browser_open_result:'))?.split(':')[1];
    return { state: this.connecting ? 'authorizing' : rejected ? 'reauth-required' : signedIn ? 'signed-in' : 'signed-out',
      ...(signedIn ? { user: { name: profile?.user?.name, email: profile?.user?.email }, ...(rejected || this.billingUnavailable || this.billing?.keyId !== profile!.controlKeyId ? {} : { plan: this.billing!.plan, balance: this.billing!.balance }), billingUnavailable: this.billingUnavailable, ...(this.billingError ? { billingError: { ...this.billingError } } : {}) } : {}),
      ...(this.connecting ? { authorizationUrl: this.authorizationUrl, userCode: this.userCode, ...(browser ? { browserOpened: browser === 'success' } : {}), ...(this.syncing ? { syncing: true } : {}) } : {}),
      ...(this.attempt ? { attempt: { ...this.attempt, stages: [...this.attempt.stages] } } : {}),
      error: this.error, errorCode: this.errorCode, consoleUrl,
      // An explicit connector path is used as is, so installing into the private directory would not help it.
      ...(!this.connecting && this.errorCode === 'connector_unavailable' && !this.explicitBinary() ? { connectorInstall: { command: manualInstallCommand(connectorRuntime(this.directory)) } } : {}) };
  }
  private async billingSummary(profile: Profile) {
    // Other connector environments retain their own endpoint and credential handling.
    if (profile.apiUrl?.replace(/\/$/, '') !== productionApi) {
      return JSON.parse(await this.run(['billing', 'summary', '--format', 'json']));
    }
    const response = await fetch(productionApi + '/api/v1/billing/summary', {
      headers: { Authorization: 'Bearer ' + profile.controlKey, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = typeof data?.error === 'string' && /^[a-z0-9_]{1,64}$/.test(data.error) ? ': ' + data.error : '';
      throw new AccountRequestError('API request failed with status ' + response.status + code);
    }
    if (!data || !Object.hasOwn(data, 'membershipTier') ||
        (data.membershipTier !== null && typeof data.membershipTier !== 'string') ||
        (typeof data.balanceUsd !== 'string' && typeof data.totalAvailableCreditsUsd !== 'string')) {
      throw new Error('Invalid billing summary');
    }
    return data;
  }
  private async readBilling(generation: number, profile: Profile) {
    if (generation !== this.generation) return;
    const requestId = ++this.billingRequestId;
    const isCurrent = () => generation === this.generation && requestId === this.billingRequestId;
    try {
      const data = await this.billingSummary(profile);
      if (!isCurrent()) return;
      // The account service leaves the tier empty for accounts without a subscription.
      const tier = typeof data.membershipTier === 'string' ? data.membershipTier.trim() : '';
      const balance = typeof data.totalAvailableCreditsUsd === 'string' ? data.totalAvailableCreditsUsd
        : typeof data.balanceUsd === 'string' ? data.balanceUsd : null;
      const plan = tier || 'free';
      // A plan read for another key (another workspace signed in again) is not an upgrade of this one.
      const previous = this.billing?.keyId === profile.controlKeyId ? this.billing?.plan : undefined;
      const upgraded = planMediaEntitlement(previous) === 'not-included' && planMediaEntitlement(plan) === 'included';
      this.billing = { plan, balance, keyId: profile.controlKeyId };
      this.billingUnavailable = false; this.billingError = undefined; this.rejectedKeyId = undefined;
      if (upgraded) {
        const sync = this.models(true).catch(() => {}).finally(() => {
          if (this.billingModelRefresh === sync) this.billingModelRefresh = undefined;
        });
        this.billingModelRefresh = sync;
      }
    } catch (error) {
      if (!isCurrent()) return;
      const { status, code } = error instanceof AccountRequestError ? error : {};
      // 401 means the control key itself is no longer accepted. Other 4xx responses come after authentication, so they
      // clear that judgement; timeouts, rate limits, 5xx and failures without a response leave it unchanged.
      if (status === 401) this.rejectedKeyId = profile.controlKeyId;
      else if (status && status < 500 && status !== 408 && status !== 429) this.rejectedKeyId = undefined;
      this.billingUnavailable = status !== 401;
      this.billingError = status ? { status, ...(code ? { code } : {}) } : undefined;
    }
  }
  async login() {
    const current = await this.summary();
    if (this.signingOut) throw new Error('Wait for sign-out to finish before connecting an account');
    if (this.connecting || current.state === 'signed-in') return this.summary();
    this.connecting = true; this.error = undefined; this.errorCode = undefined; this.connectorProblem = undefined; this.cachedModels = [];
    this.billing = undefined; this.billingModelRefresh = undefined; this.billingUnavailable = false; this.billingError = undefined; this.rejectedKeyId = undefined;
    this.authorizationUrl = undefined; this.userCode = undefined; this.syncing = false;
    const generation = ++this.generation;
    this.attempt = { id: randomUUID(), stages: [], persisted: false };
    this.clock = { start: performance.now(), entryId: randomUUID(), occurredAt: new Date().toISOString() };
    void this.authorize(generation).catch(error => {
      if (this.generation !== generation) return;
      this.connecting = false; this.syncing = false; this.child = undefined; this.authorizationUrl = undefined; this.userCode = undefined;
      this.errorCode = error instanceof SignInFailure ? error.code : failureCode(this.attempt!, false);
      this.connectorProblem = error instanceof SignInFailure ? error.connector?.problem : undefined;
      // The message offers the manual command only when the summary shows one.
      this.error = !this.connectorProblem ? failureMessages[this.errorCode] : this.explicitBinary() ? explicitConnectorMessage : connectorMessages[this.connectorProblem];
      this.finish(this.attempt!, 'failure', this.errorCode, undefined, error instanceof SignInFailure ? error.connector : undefined);
    });
    return this.summary();
  }
  private async authorize(generation: number) {
    await mkdir(this.home, { recursive: true, mode: 0o700 });
    if (generation !== this.generation) return;
    await this.commit(generation, async () => {
      await writeSettings(path.join(this.root, 'session.json'), {});
      await writeSettings(path.join(this.root, 'models.json'), []);
    });
    const binary = await this.prepare().catch(error => {
      throw new SignInFailure('connector_unavailable', error instanceof ConnectorUnavailable ? error : new ConnectorUnavailable('start_failed', error));
    });
    if (generation !== this.generation) return;
    this.clock!.prepared = performance.now();
    await this.revoking;
    if (generation !== this.generation) return;
    let attempt = this.attempt!, result = await this.connect(binary, generation, attempt);
    if (generation !== this.generation) return;
    const rolledBack = result.exitCode !== 0 && attempt.resumed && !(await this.profile())?.pendingLogin;
    if (generation !== this.generation) return;
    if (rolledBack) {
      // The service no longer accepts the interrupted attempt and the connector rolled it back: authorize again.
      this.finish(attempt, 'replaced', failureCode(attempt, result.cancelled));
      attempt = this.attempt = { id: randomUUID(), stages: [], persisted: false };
      result = await this.connect(binary, generation, attempt);
      if (generation !== this.generation) return;
    }
    // The connector keeps saved credentials unconfirmed only when the service could not be reached (5xx, 408, 429,
    // network). The next sign-in confirms them, so this is reported as a connection failure, not a rejection.
    if (result.exitCode !== 0) throw new SignInFailure((await this.profile())?.pendingLogin ? 'setup_failed' : failureCode(attempt, result.cancelled));
    const profile = await this.profile();
    if (!signedInProfile(profile)) throw new SignInFailure('credentials_rejected');
    if (generation !== this.generation) return;
    this.syncing = true;
    await this.commit(generation, () => writeSettings(path.join(this.root, 'session.json'), { id: randomUUID() }));
    if (generation !== this.generation) return;
    await this.models(true).catch(() => { this.error = 'Signed in, but the model catalogue could not be synced. Retry in Model providers.'; });
    if (generation !== this.generation) return;
    this.connecting = false; this.syncing = false;
    this.finish(attempt, 'success', undefined, profile?.user?.id);
    await this.summary(true);
  }
  /** Runs `vela login` once. Saved but unconfirmed credentials make the connector confirm them again, without an activation link. */
  private async connect(binary: string, generation: number, attempt: AccountAttempt) {
    const resumed = Boolean((await this.profile())?.pendingLogin);
    // A cancel during the read above must not leave a connector running.
    if (generation !== this.generation) return { exitCode: null, cancelled: true };
    if (resumed) attempt.resumed = true;
    const clock = this.clock!;
    clock.link = clock.approved = undefined;
    const env = { ...this.env(), OPEN_DESIGN_AMR_AUTH_STAGE_FORMAT: 'jsonl-v1', OPEN_DESIGN_AMR_AUTH_ATTEMPT_ID: attempt.id };
    const child = (this.options.spawn ?? spawn)(binary, ['login', '--completion-receipt=stdin-v1'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    let output = '', partial = '', protocol = false, cancelled = false;
    const record = (line: string) => {
      if (line.startsWith(stagePrefix)) {
        try {
          const entry = JSON.parse(line.slice(stagePrefix.length));
          if (entry.auth_attempt_id !== attempt.id || !stageNames.includes(entry.stage) || !['started', 'success', 'failed'].includes(entry.result) || attempt.stages.length >= 20) return;
          attempt.stages.push([entry.stage, entry.result, ...(typeof entry.error_kind === 'string' && /^[a-z_]{1,40}$/.test(entry.error_kind) ? [entry.error_kind] : [])].join(':'));
          if (entry.stage === 'activation_ready' && entry.result === 'success') clock.link = performance.now();
          if (entry.stage === 'device_authorization_result' && entry.result === 'success') clock.approved = performance.now();
        } catch { /* Malformed diagnostics never decide the session. */ }
      } else if (line === completionPrefix + 'stdin-v1') protocol = true;
      else if (line === completionPrefix + 'cancelled') cancelled = true;
      else if (line === completionPrefix + 'credentials_persisted' && protocol && !attempt.persisted) {
        attempt.persisted = true;
        void this.profile().then(async profile => {
          if (generation !== this.generation) return;
          await chmod(path.join(this.home, 'config.json'), 0o600);
          attempt.receipt = hasCredentials(profile) ? 'accepted' : 'rejected';
          child.stdin?.write(`credentials_${attempt.receipt}\n`);
        }).catch(() => child.kill());
      }
    };
    const capture = (chunk: Buffer) => {
      if (generation !== this.generation) return;
      const text = chunk.toString();
      output = (output + text).slice(-32_768);
      const lines = (partial + text).split(/\r?\n/);
      partial = lines.pop()!.slice(-8192);
      for (const line of lines) record(line);
      const match = /Open this URL to continue:\s*\r?\n\s*(\S+)/i.exec(output);
      if (match) {
        try { const url = new URL(match[1]); if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'open-design.ai' || url.hostname.endsWith('.open-design.ai'))) this.authorizationUrl = url.href; } catch { /* Do not expose malformed or untrusted activation links. */ }
      }
      this.userCode = /^[^\S\r\n]*Code:\s*([A-Z0-9-]{3,40})/im.exec(output)?.[1];
    };
    child.stdout?.on('data', capture);
    // A receipt written while the connector exits fails with EPIPE; the exit itself decides the attempt.
    child.stdin?.on('error', () => {});
    // CLI stderr is private: it can include account details and request bodies.
    child.stderr?.on('data', () => {});
    attempt.exitCode = await new Promise<number | null>((resolve, reject) => {
      // The connector waits until the service's own authorization expiry (15 minutes) and exits; this is only a backstop.
      // A shorter limit here would cancel authorizations the user is still completing in the browser.
      const timer = setTimeout(() => { child.kill(); reject(new SignInFailure(attempt.persisted ? 'credentials_rejected' : 'authorization_expired')); }, this.options.authorizationMs ?? 16 * 60_000);
      child.once('error', error => { clearTimeout(timer); reject(child.pid === undefined ? new SignInFailure('connector_unavailable', new ConnectorUnavailable('start_failed', error)) : new SignInFailure(failureCode(attempt, cancelled))); });
      child.once('close', code => { clearTimeout(timer); resolve(code); });
    });
    if (generation === this.generation) {
      if (partial) record(partial);
      this.child = undefined; this.authorizationUrl = undefined; this.userCode = undefined;
    }
    return { exitCode: attempt.exitCode, cancelled };
  }
  /**
   * Opens the subscription page in the system browser, the one the connector used for sign-in, so its OpenDesign session
   * carries over. A one-time account intent makes the page confirm it is the account signed in here before any purchase.
   */
  async openSubscription(launch: (url: string) => Promise<void> = openSystemBrowser) {
    const target = '/dashboard?' + new URLSearchParams({ billing: 'plan', od_origin: 'openmotion', od_entry_source: 'openmotion_manage_subscription',
      od_entry_id: randomUUID(), od_entry_at: new Date().toISOString() });
    let url = consoleUrl + target;
    const profile = await this.profile();
    if (signedInProfile(profile) && profile!.apiUrl?.replace(/\/$/, '') === productionApi && await this.identity()) {
      try {
        const response = await (this.options.fetcher ?? fetch)(productionApi + '/api/v1/auth/intents', {
          method: 'POST', headers: { Authorization: 'Bearer ' + profile!.controlKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ target }), redirect: 'error', signal: AbortSignal.timeout(10_000),
        });
        const intentId = response.ok ? (await response.json().catch(() => null))?.intentId : undefined;
        if (typeof intentId === 'string' && /^[\w-]{1,128}$/.test(intentId)) url = consoleUrl + '/login?' + new URLSearchParams({ intentId });
      } catch { /* Without an intent the page still opens and asks the browser to sign in when needed. */ }
    }
    const opened = await launch(url).then(() => true, () => false);
    return { url, opened };
  }
  async cancel() {
    const connecting = this.connecting, generation = ++this.generation;
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null) {
      await new Promise<void>(resolve => { child.once('close', () => { clearTimeout(timer); resolve(); }); const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.kill(); });
    }
    if (connecting) {
      if (this.attempt) this.finish(this.attempt, 'cancelled');
      await this.commit(generation, async () => {
        await writeSettings(path.join(this.root, 'session.json'), {});
        await writeSettings(path.join(this.root, 'models.json'), []);
        this.cachedModels = [];
      });
    }
    this.connecting = false; this.syncing = false; this.authorizationUrl = undefined; this.userCode = undefined;
    return this.summary();
  }
  async logout() {
    if (this.signingOut) throw new Error('Sign-out is already in progress');
    this.signingOut = true;
    try {
      await this.cancel();
      this.billing = undefined; this.billingModelRefresh = undefined; this.cachedModels = []; this.error = undefined; this.errorCode = undefined; this.connectorProblem = undefined; this.attempt = undefined;
      this.billingUnavailable = false; this.billingError = undefined; this.rejectedKeyId = undefined;
      await this.commit(this.generation, async () => {
        await writeSettings(path.join(this.root, 'session.json'), {});
        await writeSettings(path.join(this.root, 'models.json'), []);
      });
      await this.revoking;
      let revocationPending = false;
      try { const result = JSON.parse(await this.run(['logout', '--json'])); revocationPending = result.ok === true && result.revocationPending === true; }
      catch { /* Removing the file below still signs this installation out. */ }
      // Offline, the connector clears this account's keys and keeps only a revocation record; keep the file so the
      // revocation is retried. Otherwise (or if the connector could not run) remove this installation's credentials.
      const profile = await this.profile();
      if (revocationPending && !profile?.controlKey && !profile?.runtimeKey) this.revocationChecked = true;
      else await rm(path.join(this.home, 'config.json'), { force: true });
      return this.summary();
    } finally { this.signingOut = false; }
  }
  async models(refresh = false): Promise<DirectoryModel[]> {
    const generation = this.generation;
    const identity = await this.identity();
    if (!(await this.profile())?.runtimeKey || !identity || generation !== this.generation) return [];
    if (!refresh) {
      // Another workspace may have signed in again since this catalogue was cached.
      const stored = this.cachedModels.length && this.cachedIdentity === identity ? this.cachedModels : await readSettings<DirectoryModel[]>(path.join(this.root, 'models.json'), []);
      return generation === this.generation ? withBuiltinAudio(stored) : [];
    }
    const requestId = ++this.modelRequestId;
    const data = JSON.parse(await this.run(['model', 'list', '--all', '--format', 'json']));
    if (data.source !== 'remote' || !Array.isArray(data.data)) throw new Error('OpenDesign model catalogue is unavailable');
    const models: DirectoryModel[] = data.data.filter((row: any) => typeof row.id === 'string' && /^[\w./:-]{1,180}$/.test(row.id)).map((row: any) => ({
      id: 'account:' + row.id, provider: 'account', modelId: row.id, label: String(row.label || row.id), kind: 'text', enabled: row.enabled !== false, source: 'live',
    }));
    const media = JSON.parse(await this.run(['media', 'models', '--json']));
    if (!Array.isArray(media.models)) throw new Error('OpenDesign media catalogue is unavailable');
    for (const row of media.models) {
      // The connector reports speech and music models as `audio_speech` and `audio_music`.
      const kind = ({ image: 'image', video: 'video', audio_speech: 'audio', audio_music: 'audio' } as const)[row.kind as 'image' | 'video' | 'audio_speech' | 'audio_music'];
      if (typeof row.model !== 'string' || !/^[\w./:-]{1,180}$/.test(row.model) || !kind) continue;
      const mode = row.kind === 'audio_speech' ? 'text-to-speech' : row.kind === 'audio_music' ? 'text-to-audio' : `text-to-${kind}`;
      // An image model publishes `edits` only when this account is entitled to edit input images.
      const capabilities = row.capabilities && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities) ? row.capabilities as Record<string, unknown> : undefined;
      const editable = kind === 'image' && capabilities?.edits === true;
      const maxInputs = capabilities && Number.isInteger(capabilities.max_input_images) && (capabilities.max_input_images as number) > 0 ? capabilities.max_input_images as number : undefined;
      models.push({
        id: 'account:' + row.model, provider: 'account', modelId: row.model, label: row.model, kind, enabled: row.enabled !== false, source: 'live', mode,
        ...(editable ? { supportsImageReference: true, ...(Number.isInteger(capabilities?.max_input_images) && (capabilities!.max_input_images as number) > 0 ? { maxInputImages: capabilities!.max_input_images as number } : {}) } : {}),
        ...(kind === 'video' && maxInputs ? { maxInputImages: 1 } : {}),
        ...(capabilities ? { nativeOptions: capabilities } : {}),
      });
    }
    if (generation !== this.generation) return [];
    await this.commit(generation, async () => {
      // A sync started before the upgrade must not replace the newly entitled catalogue.
      // Nor may a catalogue read before another workspace signed in again replace the new account's.
      if (requestId !== this.modelRequestId || await this.identity() !== identity) return;
      this.cachedModels = [...new Map(models.map(model => [model.id, model])).values()]; this.cachedIdentity = identity;
      await writeSettings(path.join(this.root, 'models.json'), this.cachedModels);
    });
    return generation === this.generation ? withBuiltinAudio(this.cachedModels) : [];
  }
  async identity() { await this.adopt(); return (await readSettings<{ id?: string }>(path.join(this.root, 'session.json'), {})).id; }
  async mediaModels(): Promise<Model[]> {
    return (await this.models()).filter(model => model.enabled && ['image', 'video', 'audio'].includes(model.kind)).map(model => {
      const maxInputs = model.kind === 'video' && model.maxInputImages === undefined && Number.isInteger(model.nativeOptions?.max_input_images) && (model.nativeOptions!.max_input_images as number) > 0 ? 1 : model.maxInputImages;
      return { ...model, ...(maxInputs !== undefined ? { maxInputImages: maxInputs } : {}), modality: model.kind as Model['modality'], mode: model.mode! };
    });
  }
  /** `reference` is the job's snapshotted input image; it edits an image or sets a video's first frame. `references` holds every
   * snapshotted input image for image jobs submitted directly to the media API. */
  async generate(job: GenerationJob, directory: string, signal: AbortSignal, progress: (phase: string, id?: string, download?: DownloadProgress) => Promise<void>,
    reference?: string, references: NonNullable<ProviderContext['references']> = []) {
    const kind = job.modality, params = resolveGenerationParameters(job.model, job.parameters, !!reference || references.length > 0);
    if (job.providerOrigin !== await this.identity() || (await this.summary()).state !== 'signed-in') throw new Error(jobMessages.accountChangedBeforeSubmit);
    const music = kind === 'audio' && job.model.mode === 'text-to-audio';
    if ((reference || references.length) && kind !== 'image' && kind !== 'video') throw new Error('Account reference images are supported for image editing and video first frames only');
    const allowed = kind === 'image' ? ['aspect_ratio', 'resolution', 'quality', 'size', 'background'] : kind === 'video' ? ['ratio', 'resolution', 'duration', 'generate_audio'] : music ? ['duration'] : ['voice'];
    if (Object.keys(params).some(key => !allowed.includes(key))) throw new Error('Unsupported account model parameter');
    if (kind === 'audio' && !music && (typeof params.voice !== 'string' || !params.voice)) throw new Error('Choose a voice in parameters.voice');
    // The connector has no background flag and sends one input image; those image jobs go to the same media API with the account key.
    const direct = kind === 'image' && (params.background !== undefined || references.length > 1);
    const operation = kind === 'audio' ? music ? 'music' : 'speech' : kind === 'image' && reference ? 'edit' : 'gen';
    const referenceArgs = reference ? [kind === 'video' ? '--first-frame' : '--image', reference] : [];
    const args = [kind, operation, '--model', job.model.modelId, '--prompt', job.prompt, ...referenceArgs, '--no-wait', '--json'];
    const generateAudio = kind === 'video' && params.generate_audio === undefined && defaultVideoAudioEnabled(job.model) ? true : params.generate_audio;
    for (const [key, value] of Object.entries(direct ? {} : params)) {
      if (key === 'generate_audio') continue;
      if (typeof value === 'string' || typeof value === 'number') args.push('--' + key.replaceAll('_', '-'), String(value));
      else throw new Error('Invalid account model parameter');
    }
    if (generateAudio !== undefined) {
      if (generateAudio === true) args.push('--generate-audio');
      else if (generateAudio === false) args.push('--generate-audio=false');
      else throw new Error('Invalid account model parameter');
    }
    // Recovery never submits again, even when the draft or reference file has changed.
    const submitted = job.remoteId ? { task_id: job.remoteId } : direct ? await this.submitImage(job, params, references, signal, progress) : JSON.parse(await this.run(args, signal));
    if (typeof submitted.task_id !== 'string' || !/^[\w-]{1,180}$/.test(submitted.task_id)) throw new Error('Account provider did not return a task ID');
    const taskId = submitted.task_id;
    await progress('submitted', taskId);
    if (kind === 'image') return [await this.imageResult(job, taskId, directory, signal, progress)];
    const output = path.join(directory, 'account-output.bin');
    for (;;) {
      await delay(this.options.pollMs ?? 2000, undefined, { signal });
      if (job.providerOrigin !== await this.identity()) throw new Error(jobMessages.accountChangedAfterSubmit);
      // The task already exists and may be billed; a failed read or download must not suggest submitting it again.
      const task = JSON.parse(await this.run([kind, 'get', taskId, '--output', output, '--json'], signal).catch(error => {
        // A rejected sign-in still needs its sign-out hint: the account keeps reporting signed-in after a media 401.
        if (error instanceof AccountRequestError) throw new Error(error.status === 401 || error.code === 'unauthorized' ? jobMessages.resultUnauthorized : jobMessages.resultUnreadable);
        throw error;
      }));
      if (task.task_id !== taskId) throw new Error('Account provider returned an unexpected task');
      if (task.status === 'succeeded') {
        const info = await lstat(output);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 * 1024) throw new Error('Invalid account media output');
        return [await readFile(output)];
      }
      if (['failed', 'cancelled', 'canceled'].includes(task.status)) throw new Error(jobMessages.taskFailed);
      if (!['queued', 'pending', 'running', 'processing', 'submitted'].includes(task.status)) throw new Error(jobMessages.unknownTaskStatus);
      await progress('generating');
    }
  }
  private async submitImage(job: GenerationJob, parameters: Record<string, unknown>, references: NonNullable<ProviderContext['references']>, signal: AbortSignal,
    progress: (phase: string) => Promise<void>) {
    const profile = await this.profile();
    if (!signedInProfile(profile)) throw new Error(requestMessages.unauthorized);
    const fetcher = this.options.fetcher ?? fetch, api = productionApi + '/api/v1/media';
    const headers = { Authorization: `Bearer ${profile!.controlKey}`, 'Content-Type': 'application/json' };
    const images = await uploadInputs(fetcher, api, headers, job.id, { references, progress, signal }).catch(error => {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) throw new Error(requestMessages.unauthorized);
      if (status === 413) throw new Error(requestMessages.asset_too_large);
      throw error instanceof ProviderError ? new Error(jobMessages.service) : error;
    });
    let response: Response;
    try {
      response = await fetcher(api + (images.length ? '/images/edits' : '/images/generations'), {
        method: 'POST', headers: { ...headers, 'Idempotency-Key': job.id }, redirect: 'error', signal,
        body: JSON.stringify({ ...cloudImageParameters(parameters), model: job.model.modelId, prompt: job.prompt, ...(images.length ? { images } : {}) }),
      });
    } catch (error) { if (signal.aborted) throw error; throw new Error(jobMessages.connection); }
    // Only the service error code is kept; the response text can echo the prompt.
    const body = await response.json().catch(() => undefined) as { task_id?: unknown; error?: { code?: unknown }; code?: unknown } | undefined;
    if (!response.ok) {
      const code = String(body?.error?.code ?? body?.code ?? '');
      throw new Error((Object.hasOwn(requestMessages, code) ? requestMessages[code] : undefined) ?? (response.status === 401 ? requestMessages.unauthorized : jobMessages.service));
    }
    return body ?? {};
  }
  private async imageResult(job: GenerationJob, taskId: string, directory: string, signal: AbortSignal,
    progress: (phase: string, id?: string, download?: DownloadProgress) => Promise<void>) {
    const read = async () => {
      if (job.providerOrigin !== await this.identity()) throw new Error(jobMessages.accountChangedAfterSubmit);
      const profile = await this.profile();
      if (!signedInProfile(profile)) throw new Error(jobMessages.resultUnauthorized);
      try {
        const task = await retryRead(() => apiJson(this.options.fetcher ?? fetch,
          `${productionApi}/api/v1/media/images/tasks/${encodeURIComponent(taskId)}`,
          { headers: { Authorization: `Bearer ${profile!.controlKey}` }, signal }, { timeoutMs: 15_000, maxBytes: 1024 * 1024 }), signal, 3);
        if (job.providerOrigin !== await this.identity()) throw new Error(jobMessages.accountChangedAfterSubmit);
        if (task.task_id !== taskId || task.model && task.model !== job.model.modelId) throw new Error(jobMessages.resultUnreadable);
        return task;
      } catch (error) {
        if ((error as { status?: number }).status === 401) throw new Error(jobMessages.resultUnauthorized);
        throw new Error(jobMessages.resultUnreadable);
      }
    };
    const assetFrom = (task: any) => {
      if (!Array.isArray(task.assets) || task.assets.length !== 1) throw new Error(jobMessages.resultUnreadable);
      const asset = task.assets[0];
      if (asset.status !== 'ready' || typeof asset.asset_id !== 'string' || !/^[\w-]{1,180}$/.test(asset.asset_id)
        || typeof asset.url !== 'string' || typeof asset.mime_type !== 'string') throw new Error(jobMessages.resultUnreadable);
      return { assetId: asset.asset_id, size: asset.size_bytes, mime: asset.mime_type, url: asset.url };
    };
    for (;;) {
      const task = await read();
      if (['failed', 'cancelled', 'canceled'].includes(task.status)) { await progress('remote_failed'); throw new Error(jobMessages.taskFailed); }
      if (task.status === 'succeeded') break;
      if (!['queued', 'pending', 'running', 'processing', 'submitted'].includes(task.status)) throw new Error(jobMessages.unknownTaskStatus);
      await progress('generating'); await delay(this.options.pollMs ?? 2000, undefined, { signal });
    }
    return resumableDownload(directory, async () => {
      const task = await read();
      if (['failed', 'cancelled', 'canceled'].includes(task.status)) { await progress('remote_failed'); throw new Error(jobMessages.taskFailed); }
      if (task.status !== 'succeeded') throw new Error(jobMessages.resultUnreadable);
      return assetFrom(task);
    }, signal, download => progress('downloading', undefined, download), this.options.download);
  }
  close() { this.generation++; this.child?.kill(); this.closing.abort(); }
}
