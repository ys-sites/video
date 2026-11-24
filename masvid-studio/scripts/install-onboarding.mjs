import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runFile } from './runtime-assets.mjs';
import { onboardingPresentationInstructions } from './inline-onboarding.mjs';
import { prepareCodexHostHandoff } from './codex-host-handoff.mjs';
import { onboardingTemplateIds, recommendationTemplateIds, selectOnboardingTemplateIds } from '../shared/onboarding-templates.ts';
import { installationFallbackWelcome, isLanguage } from '../mcp-ui/template-recommendations/i18n.ts';

export async function installationInstructions(appRoot) {
  const guide = await readFile(path.join(appRoot, 'docs/install.md'), 'utf8');
  const sections = [...guide.matchAll(/<!-- installation-onboarding:start -->([\s\S]*?)<!-- installation-onboarding:end -->/g)];
  assert.equal(sections.length, 1, 'Installation guide must contain one onboarding contract');
  assert(sections[0][1].trim(), 'Installation onboarding contract is empty');
  return sections[0][1].trim();
}

export async function prepareInstallationOnboarding({ appRoot, dataDirectory, templateEnvironment, host = 'codex', onboardingOutput,
  templateIds = selectOnboardingTemplateIds(),
  language = process.env.OPENMOTION_ONBOARDING_LANGUAGE || 'en' }) {
  // A missing canonical contract fails before host registration.
  const instructions = await installationInstructions(appRoot);
  const inline = (async () => {
    // HTML preparation is host-neutral; the Agent selects a supported presentation surface.
    try {
      if (!dataDirectory) {
        const { WorkspaceStore } = await import('../workspace.ts');
        dataDirectory = new WorkspaceStore().directory;
      }
      const { prepareInlineOnboarding } = await import('./inline-onboarding.mjs');
      return await prepareInlineOnboarding({ appRoot, language, templateIds,
        output: onboardingOutput || path.join(dataDirectory, 'onboarding', `welcome-${randomUUID()}.html`) });
    } catch (error) { return { status: 'unavailable', warning: error.message }; }
  })();
  let catalog;
  try {
    catalog = JSON.parse(await runFile(process.execPath, ['--experimental-strip-types', path.join(appRoot, 'scripts/onboarding-catalog.ts'),
      ...(dataDirectory ? [dataDirectory] : []), '--template-ids', JSON.stringify(templateIds), '--language', language], {
      cwd: appRoot, timeout: 5_000, killSignal: 'SIGKILL',
      env: { ...process.env, MOTION_TEMPLATE_ENV: templateEnvironment },
    }));
    assert(Array.isArray(catalog.templates), 'Invalid onboarding catalog');
  } catch {
    catalog = { source: 'unavailable', environment: templateEnvironment, catalogVersion: null,
      catalogTotal: null, included: 0, truncated: false, stale: false, recommendedTemplateId: null,
      warning: 'Approved onboarding recommendations unavailable. Preserve any accepted template ID and report the limitation; do not substitute another template.', templates: [] };
  }
  const inlinePresentation = await inline;
  if (inlinePresentation && host !== 'codex') inlinePresentation.instructions = onboardingPresentationInstructions('host_cards');
  return { host, hostSessionVerified: false, instructions, catalog,
    cardPresentation: { tool: host === 'deepseek' ? 'propose_action' : 'openmotion_show_template_recommendations',
      ...(host === 'deepseek' ? { skill: 'openmotion-template-recommendations' } : {}),
      arguments: host === 'deepseek' ? {
        action: 'openmotion_template_recommendation', title: 'OpenMotion', brief: 'Choose a template to begin',
        details: { onboarding: true, language, templates: catalog.templates.map(template => ({
          id: template.templateId, title: template.name, description: template.summary,
          previewUrl: template.previewUrl, posterUrl: template.posterUrl, duration: template.durationSeconds,
        })) },
      } : { templateIds, language, onboarding: true },
      instructions: 'Show these exact three cards in order using a supported native MCP App, DSH action card or host HTML surface. Use text with the same IDs only when card presentation is unsupported or fails. Do not substitute templates or create a project.' },
    ...(inlinePresentation ? { inlinePresentation } : {}) };
}

export async function prepareInstallationPreview({ appRoot, dataDirectory }) {
  try {
    const preview = JSON.parse(await runFile(process.execPath, ['--experimental-strip-types', path.join(appRoot, 'scripts/open-template-library.ts')], {
      cwd: appRoot, timeout: 30_000, killSignal: 'SIGKILL',
      env: { ...process.env, ...(dataDirectory ? { MOTION_DATA_DIR: dataDirectory } : {}) },
    }));
    assert.equal(preview.target, 'templates');
    assert.equal(preview.projectCreated, false);
    assert.equal(new URL(preview.previewUrl).searchParams.get('templates'), '1');
    return { status: 'ready', ...preview };
  } catch (error) {
    return { status: 'unavailable', openedByHost: false, projectCreated: false,
      warning: 'Template library could not be prepared: ' + error.message,
      nextAction: 'Installation succeeded; report the preview failure and retry openmotion_open_preview with target=templates after connecting MCP. Do not create a placeholder project.' };
  }
}

// Shared by packaged setup, source setup and the plugin's setup Skill. A ready
// artifact is an installation handoff, never proof of visible host delivery.
export async function prepareInstallationFlow(options) {
  options = { ...options, templateIds: options.templateIds ?? selectOnboardingTemplateIds() };
  if (!options.dataDirectory) {
    let configuration;
    try { configuration = JSON.parse(await readFile(path.join(options.appRoot, '.mcp.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const server = configuration?.mcpServers?.openmotion;
    const declared = server?.env?.MOTION_DATA_DIR;
    if (declared !== undefined && declared !== '') {
      const expand = value => {
        assert(typeof value === 'string', 'Invalid installed connection environment value');
        const result = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
          if (key === 'PLUGIN_ROOT' || key === 'CLAUDE_PLUGIN_ROOT') return options.appRoot;
          assert(process.env[key] !== undefined, 'Resolve the installed connection environment before onboarding');
          return process.env[key];
        });
        assert(!result.includes('${'), 'Resolve the installed connection environment before onboarding');
        return result;
      };
      const resolved = expand(declared);
      const cwd = path.isAbsolute(resolved) ? '.' : expand(server.cwd || '.');
      if (resolved) options = { ...options, dataDirectory: path.isAbsolute(resolved) ? path.resolve(resolved) : path.resolve(options.appRoot, cwd, resolved) };
      else {
        const { WorkspaceStore } = await import('../workspace.ts');
        options = { ...options, dataDirectory: new WorkspaceStore().directory };
      }
    } else {
      const { WorkspaceStore } = await import('../workspace.ts');
      options = { ...options, dataDirectory: new WorkspaceStore().directory };
    }
  }
  const [onboarding, preview] = await Promise.all([
    prepareInstallationOnboarding(options), prepareInstallationPreview(options),
  ]);
  let hostHandoff;
  if ((options.host || 'codex') === 'codex') {
    hostHandoff = await prepareCodexHostHandoff({ dataDirectory: options.dataDirectory,
      expectedVersion: options.expectedVersion || JSON.parse(await readFile(path.join(options.appRoot, 'package.json'), 'utf8')).version,
      expectedResourceUri: onboarding.inlinePresentation?.resourceUri,
      requirePresentation: onboarding.inlinePresentation?.status !== 'prepared',
      codex: options.codex, request: options.hostRequest, templateIds: options.templateIds,
      language: onboarding.inlinePresentation?.language || options.language });
  }
  const language = onboarding.inlinePresentation?.language || options.language || process.env.OPENMOTION_ONBOARDING_LANGUAGE || 'en';
  return { ...onboarding, installationStatus: 'installed', applicationRoot: options.appRoot,
    welcomeMarkdown: installationFallbackWelcome(isLanguage(language) ? language : 'en'),
    dataDirectory: options.dataDirectory, preview,
    ...(hostHandoff ? { hostHandoff } : {}),
    onboardingStatus: preview.status !== 'ready' ? 'preview_unavailable'
      : 'awaiting_host_delivery',
    onboardingComplete: false, hostSessionVerified: hostHandoff?.hostSessionVerified || false };
}

// Keep the chat, workspace and three selections fixed across the queued refresh.
export async function persistInstallationOnboarding(result, directory) {
  const detailsFile = path.join(directory, `onboarding-${randomUUID()}.json`);
  const saved = { ...result, detailsFile, ...(result.hostHandoff?.threadId ? { recovery: {
    command: process.execPath,
    args: ['--experimental-strip-types', path.join(result.applicationRoot, 'scripts/install-onboarding.mjs'),
      result.applicationRoot, '--resume', detailsFile, '--verify-only', '--summary'],
  } } : {}) };
  await mkdir(directory, { recursive: true });
  await writeFile(detailsFile, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return saved;
}

export async function resumeInstallationOnboarding(saved, options = {}) {
  const appRoot = options.appRoot || fileURLToPath(new URL('../', import.meta.url));
  assert(saved.installationStatus === 'installed' && saved.onboardingComplete === false, 'Use an incomplete installation receipt');
  assert(typeof saved.applicationRoot === 'string' && realpathSync(saved.applicationRoot) === realpathSync(appRoot),
    'Resume with the original installed application');
  const threadId = options.threadId ?? process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID;
  const savedThreadId = saved.hostHandoff?.threadId
    || saved.hostHandoff?.hostRequests?.find(item => item.method === 'mcpServerStatus/list')?.params?.threadId;
  assert(threadId && savedThreadId === threadId, 'Resume onboarding in its original chat');
  assert(typeof saved.dataDirectory === 'string' && path.isAbsolute(saved.dataDirectory), 'The saved workspace must be absolute');
  const args = saved.hostHandoff.presentation.arguments;
  const requirePresentation = saved.inlinePresentation?.status === 'native_required';
  const allowed = saved.inlinePresentation?.status === 'prepared' ? recommendationTemplateIds : onboardingTemplateIds;
  assert(Array.isArray(args.templateIds) && args.templateIds.length === 3 && new Set(args.templateIds).size === 3
    && args.templateIds.every(id => allowed.includes(id)), 'Preserve three distinct curated template IDs or explicitly prepared builtin IDs');
  let presentation;
  if (['prepared', 'native_required'].includes(saved.inlinePresentation?.status)) {
    const { loadTemplatePresentation } = await import('../shared/mcp-template-recommendations.ts');
    presentation = loadTemplatePresentation({ applicationRoot: appRoot, directory: path.join(appRoot, 'mcp-ui/template-recommendations') });
    assert(saved.inlinePresentation.resourceVersion === presentation.resourceVersion, 'The saved card resource changed');
  }
  const welcomeDelivered = options.welcomeDelivered || saved.welcomeDelivered || false;
  const hostHandoff = await prepareCodexHostHandoff({ ...options, threadId, verifyOnly: true, welcomeDelivered, requirePresentation,
    dataDirectory: saved.dataDirectory, templateIds: args.templateIds, language: args.language,
    expectedResourceUri: presentation?.uri,
    expectedVersion: JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8')).version });
  return { ...saved, hostHandoff, welcomeDelivered,
    welcomeMarkdown: welcomeDelivered ? '' : installationFallbackWelcome(isLanguage(args.language) ? args.language : 'en'),
    ...(welcomeDelivered && saved.recovery ? { recovery: { ...saved.recovery,
      args: saved.recovery.args.includes('--welcome-delivered') ? saved.recovery.args : [...saved.recovery.args, '--welcome-delivered'] } } : {}),
    inlinePresentation: { ...saved.inlinePresentation, presentation: hostHandoff.presentation,
      ...(welcomeDelivered ? { welcomeMarkdown: '' } : {}) },
    onboardingStatus: saved.preview?.status === 'ready' ? 'awaiting_host_delivery' : 'preview_unavailable',
    hostSessionVerified: hostHandoff.hostSessionVerified, onboardingComplete: false };
}

export function installationSummary(result) {
  const lines = [];
  const { hostHandoff, preview, inlinePresentation } = result;
  if (hostHandoff) lines.push('MCP_ACTIVATION: ' + hostHandoff.automaticActivation
    + (hostHandoff.reason ? ' (' + hostHandoff.reason + ')' : '')
    + '. Separate from installation and welcome/card delivery.'
    + (hostHandoff.hostSessionVerified ? ' Reuse this verified read; do not repeat it.' : ' If native tools are available, verify the expected workspace once; otherwise retain the activation blocker.'));
  if (!result.onboardingComplete) {
    lines.push('ONBOARDING_PENDING: ' + result.onboardingStatus
      + '. Installation is registered; presentation remains unverified. '
      + onboardingPresentationInstructions(result.host && result.host !== 'codex' ? 'host_cards' : inlinePresentation?.status));
    if (result.host === 'deepseek') lines.push('DSH_NEXT_ACTION: Refresh the current DSH browser page once if the OpenMotion UI has not loaded; do not kill DSH or restart the conversation. Load cardPresentation.skill and call propose_action with cardPresentation.arguments in this turn. The card opens the template library beside the current chat. Never call an unavailable openmotion_show_template_recommendations tool or report onboarding complete from a prepared receipt or healthy MCP alone.');
  }
  if (hostHandoff?.status === 'refresh_requested') lines.push('After this tool step, run recovery.command/recovery.args once to verify the queued refresh; do not reload or prepare again. This does not block the prepared HTML presentation.');
  if (preview?.status !== 'ready') lines.push('LIBRARY_UNAVAILABLE: ' + (preview?.warning || 'No prepared library URL')
    + '. Installation remains installed. Do not claim the library is open; report the actual result.');
  return lines.join('\n');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    host: { type: 'string' }, summary: { type: 'boolean' }, 'check-contract': { type: 'boolean' }, resume: { type: 'string' },
    'verify-only': { type: 'boolean' }, 'welcome-delivered': { type: 'boolean' },
  } });
  assert(positionals.length <= 1, 'Pass one application root');
  const appRoot = path.resolve(positionals[0] || fileURLToPath(new URL('../', import.meta.url)));
  if (values['check-contract']) {
    await installationInstructions(appRoot);
  } else {
    assert(!values['verify-only'] || values.resume, 'Use --resume RECEIPT with --verify-only to preserve the prepared selection');
    assert(!values['welcome-delivered'] || values.resume, 'Use --welcome-delivered only with an installation receipt');
    let result;
    if (values.resume) {
      assert(path.isAbsolute(values.resume), 'Use an absolute installation receipt path');
      result = await resumeInstallationOnboarding(JSON.parse(await readFile(values.resume, 'utf8')),
        { appRoot, welcomeDelivered: values['welcome-delivered'] });
    } else {
      const defaults = JSON.parse(await readFile(path.join(appRoot, 'shared/template-config.json'), 'utf8'));
      const options = { appRoot, host: values.host || 'codex', dataDirectory: process.env.MOTION_DATA_DIR, templateEnvironment: process.env.MOTION_TEMPLATE_ENV || defaults.environment };
      result = await persistInstallationOnboarding(await prepareInstallationFlow(options), path.join(appRoot, '.artifacts/install'));
    }
    if (values.summary) {
      console.error(installationSummary(result));
      console.log(JSON.stringify({ ...result, instructions: undefined, catalog: undefined }, null, 2));
    } else console.log(JSON.stringify(result, null, 2));
  }
}
