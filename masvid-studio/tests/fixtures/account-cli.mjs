#!/usr/bin/env node
// Synthetic account connector. Never contacts an account service or reads user credentials.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const home = process.env.AMR_HOME;
if (!home || !home.includes('motion-')) throw new Error('Use an isolated OpenMotion fixture directory');
mkdirSync(home, { recursive: true, mode: 0o700 });
const args = process.argv.slice(2), json = value => console.log(JSON.stringify(value));
const mode = () => existsSync(path.join(home, 'fixture-mode')) ? readFileSync(path.join(home, 'fixture-mode'), 'utf8') : '';
const target = path.join(home, 'config.json');
const read = () => existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : { profiles: {} };
// Polling readers must see either absent/old credentials or the complete
// new JSON, never the truncate/write interval of a direct overwrite.
const save = file => {
  const temporary = target + '.' + process.pid + '.tmp';
  writeFileSync(temporary, JSON.stringify(file), { mode: 0o600 });
  renameSync(temporary, target);
};
const publish = profile => save({ ...read(), profiles: { prod: profile } });
// Remote revocation of queued keys; while an `offline` marker exists the records stay queued for a later retry.
const revoke = () => {
  const file = read();
  if (!file.pendingRevocations?.length) return false;
  if (existsSync(path.join(home, 'offline'))) return true;
  const log = path.join(home, 'revoked.json');
  writeFileSync(log, JSON.stringify([...(existsSync(log) ? JSON.parse(readFileSync(log, 'utf8')) : []), ...file.pendingRevocations.map(entry => entry.controlKeyId)]));
  delete file.pendingRevocations; save(file);
  return false;
};
// Mirrors the connector's `jsonl-v1` stage lines, emitted only when the caller asks for them.
const stage = (name, result, errorKind) => {
  const id = process.env.OPEN_DESIGN_AMR_AUTH_ATTEMPT_ID;
  if (process.env.OPEN_DESIGN_AMR_AUTH_STAGE_FORMAT === 'jsonl-v1' && id) console.log('OPEN_DESIGN_AMR_AUTH_STAGE\t' + JSON.stringify({ schema_version: 1, auth_attempt_id: id, stage: name, result, ...(errorKind ? { error_kind: errorKind } : {}) }));
};
// A rolled-back attempt queues its issued key for revocation and restores the profile it replaced.
const rollback = (profile, previous) => {
  const file = read();
  if (profile.controlKey && profile.controlKeyId) file.pendingRevocations = [...(file.pendingRevocations ?? []), { controlKeyId: profile.controlKeyId, controlKey: profile.controlKey }];
  if (previous) file.profiles.prod = previous; else delete file.profiles.prod;
  save(file); revoke();
};
// Saves issued credentials as pending, waits for the caller's receipt, then confirms them with the service.
const confirm = (profile, scenario, previous) => {
  publish({ ...profile, pendingLogin: { deviceId: 'fixture-device', ...(previous ? { previous } : {}) } });
  stage('credential_persist_result', 'success');
  console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tcredentials_persisted');
  process.stdin.once('data', data => {
    const accepted = String(data).includes('credentials_accepted');
    // An unreachable service keeps the credentials pending for the next sign-in.
    if (accepted && scenario === 'login-complete-unavailable') process.exit(1);
    // A rejected receipt or a refused service confirmation rolls the attempt back.
    if (!accepted || scenario === 'login-complete-failure') { rollback(profile, previous); process.exit(1); }
    publish(profile); process.exit(0);
  });
};
if (args[0] === 'login') {
  const scenario = mode();
  console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tstdin-v1');
  revoke();
  stage('attempt_started', 'started');
  const saved = read().profiles?.prod;
  if (saved?.pendingLogin) {
    // Resuming an interrupted attempt prints no activation link and confirms the saved credentials again.
    const { pendingLogin, ...profile } = saved;
    stage('device_authorization_result', 'success'); stage('token_exchange_result', 'success');
    confirm(profile, scenario === 'resume-rejected' ? 'login-complete-failure' : scenario, pendingLogin.previous);
  } else if (scenario === 'login-create-failure') {
    stage('device_auth_create_result', 'failed', 'network_error');
    console.error('Error: start device authorization: private upstream data');
    process.exit(1);
  } else {
    stage('device_auth_create_result', 'success');
    console.log('Open this URL to continue:\nhttps://open-design.ai/activate?code=TEST-123\n\nCode: TEST-123');
    stage('activation_ready', 'success'); stage('browser_open_result', 'success');
    const timer = setInterval(() => {
      if (!existsSync(path.join(home, 'authorize'))) return;
      clearInterval(timer);
      if (scenario === 'login-denied') {
        console.log('OPEN_DESIGN_AMR_AUTH_COMPLETION\tcancelled');
        stage('device_authorization_result', 'failed', 'oauth_denied');
        process.exit(1);
      }
      stage('device_authorization_result', 'success');
      // The connector returns without another stage when issued credentials lack their revocation ID.
      if (scenario === 'login-missing-key-id') process.exit(1);
      // A transient service failure while exchanging the approved authorization stores nothing.
      if (scenario === 'login-exchange-failure') {
        stage('token_exchange_result', 'failed', 'network_error');
        console.error('Error: exchange authorization code: private upstream data');
        process.exit(1);
      }
      stage('token_exchange_result', 'success');
      // A local write failure leaves no credentials behind either.
      if (scenario === 'login-persist-failure') {
        stage('credential_persist_result', 'failed', 'credential_persist_error');
        console.error('Error: write credentials: private local path');
        process.exit(1);
      }
      const profile = { controlKey: 'synthetic-private-control-key', controlKeyId: 'fixture-control-key-id', runtimeKey: 'synthetic-private-account-key',
        user: { id: 'fixture-user-id', name: 'Fixture user', email: 'fixture@example.test' } };
      if (scenario === 'login-incomplete') delete profile.controlKey;
      confirm(profile, scenario, saved);
    }, 20);
  }
} else if (args[0] === 'logout') {
  // Sign-out queues this account's key for revocation and clears it locally before trying the service.
  const file = read(), profile = file.profiles?.prod;
  if (args.includes('--retry-pending')) writeFileSync(path.join(home, 'retries'), 'x', { flag: 'a' });
  else if (profile?.controlKey) {
    file.pendingRevocations = [...(file.pendingRevocations ?? []), { controlKeyId: profile.controlKeyId, controlKey: profile.controlKey }];
    file.profiles.prod = {}; save(file);
  }
  json({ ok: true, revocationPending: revoke() });
} else if (args[0] === 'billing') {
  const scenario = mode();
  if (scenario === 'billing-failure') { console.error('private upstream data'); process.exit(1); }
  if (scenario === 'billing-403') { console.error('Error: fetch billing summary: API request failed with status 403: workspace_billing_scope_locked'); process.exit(1); }
  if (scenario === 'billing-401') { console.error('Error: fetch billing summary: API request failed with status 401: invalid_api_key'); process.exit(1); }
  if (scenario === 'billing-502') { console.error('Error: fetch billing summary: API request failed with status 502'); process.exit(1); }
  if (scenario === 'billing-403-text') { console.error('Error: fetch billing summary: API request failed with status 403: rate-limited by edge'); process.exit(1); }
  const summaries = {
    'billing-free': { membershipTier: null, balanceUsd: '0.00' },
    'billing-go': { membershipTier: ' Go ', balanceUsd: '0.00' },
    'billing-plus': { membershipTier: 'PLUS', balanceUsd: '0.00' },
    'billing-topup': { membershipTier: 'free', balanceUsd: '1.2345' },
    'billing-malformed': { membershipTier: 'free', balanceUsd: 'invalid' },
    'billing-missing': { membershipTier: 'go' },
  };
  json(summaries[scenario] ?? { membershipTier: 'pro', balanceUsd: '12.50' });
} else if (args[0] === 'model') json({ source: 'remote', data: [{ id: 'language-one', enabled: true }, { id: 'disabled-one', enabled: false }] });
// The connector reports speech and music models as `audio_speech` / `audio_music`.
// Only `fixture-image` publishes `edits`; `fixture-image-basic` generates without input images.
else if (args[0] === 'media') json({ models: [...['image', 'video', 'audio'].map(kind => ({ model: `fixture-${kind}`, kind: kind === 'audio' ? 'audio_speech' : kind, enabled: true, capabilities: kind === 'image' ? { edits: true, max_input_images: 4 } : {} })),
  { model: 'fixture-i2v', kind: 'video', enabled: true, capabilities: { max_input_images: 1, ratios: { values: ['16:9', 'adaptive'], default: '16:9' } } },
  { model: 'fixture-image-basic', kind: 'image', capabilities: { edits: false, max_input_images: 0 } }, { model: 'fixture-music', kind: 'audio_music', capabilities: {} }, { model: 'elevenlabs-v3', kind: 'audio_speech', capabilities: {} }] });
else if (args[1] === 'get') {
  // A failed result download after the task was accepted.
  if (mode() === 'media-get-502') { console.error('Error: media download failed after 3 attempts: private detail (provider_error, HTTP 502)'); process.exit(1); }
  if (mode() === 'media-get-401') { console.error('Error: perform media request: private detail for fixture-user-id (unauthorized, HTTP 401)'); process.exit(1); }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
  const bytes = args[0] === 'image' ? png : readFileSync(path.join(home, `fixture-${args[0]}`));
  writeFileSync(args[args.indexOf('--output') + 1], bytes);
  // A succeeded `image get` prints the downloaded asset instead of the task.
  json(args[0] === 'image' ? { asset_id: 'fixture-asset', status: 'ready', kind: 'image', mime_type: 'image/png', size_bytes: bytes.length } : { task_id: args[2], status: 'succeeded' });
} else if (['gen', 'edit', 'speech', 'music'].includes(args[1])) {
  // `image edit` and `video gen --first-frame` upload the referenced local file, so it must exist when the command runs.
  if (args[1] === 'edit' && !existsSync(args[args.indexOf('--image') + 1])) { console.error('Error: input image not found'); process.exit(1); }
  if (args.includes('--first-frame') && !existsSync(args[args.indexOf('--first-frame') + 1])) { console.error('Error: first-frame image not found'); process.exit(1); }
  // Media commands report service failures as `<text> (code, HTTP status)`; the leading text stands in for private detail.
  const failures = { 'media-invalid': 'invalid_request, HTTP 400', 'media-plan': 'model_access_denied, HTTP 403', 'media-401': 'unauthorized, HTTP 401', 'media-unknown-code': 'new_service_code, HTTP 409', 'media-empty-code': ', HTTP 502' };
  if (failures[mode()]) { console.error(`Error: private request detail for fixture-user-id (${failures[mode()]})`); process.exit(1); }
  const file = path.join(home, 'submissions.json');
  const calls = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  calls.push(args); writeFileSync(file, JSON.stringify(calls));
  json({ task_id: `fixture-task-${calls.length}` });
} else process.exit(1);
