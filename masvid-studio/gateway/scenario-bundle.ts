import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanDesignPath } from '../design-projects.ts';
import { atomicJson, jsonFile } from '../phase1-versions.ts';
import { zip } from '../scripts/zip.mjs';
import { foldProjectName } from '../shared/project-name.ts';
import { readProjectZip } from '../shared/project-zip.ts';
import { withProcessLock } from '../shared/process-lock.ts';
import { mediaFilename } from '../shared/render-name.ts';
import { briefMarkdown, runReadme, socialPostsMarkdown } from '../shared/scenario-content.ts';
import { localizedScenarioDraftTitle, localizedScenarioMediaLabel } from '../shared/scenario-media-names.ts';
import { findOutputIteration, SCENARIO_LIMITS, type ScenarioBundleReceipt, type ScenarioRun, type SocialPost } from '../shared/scenario-runs.ts';
import { findScenarioStep, type ScenarioDefinition } from '../shared/scenarios.ts';
import { sessionPath } from '../shared/workspace-url.ts';
import type { ScenarioHost } from './scenario-runs.ts';

export type ScenarioBundleOptions = {
  requestId: string;
  locale?: string;
  stepIds?: string[];
  poolItemIds?: string[];
  activeOnly?: boolean;
  includeStandaloneHtml?: boolean;
  includeMotionSource?: boolean;
};

type BundleReceiptFile = { inputHash: string; result: ScenarioBundleReceipt };

export class BundleBuildError extends Error {
  readonly code: 'INVALID_ARGUMENT' | 'STEP_NOT_FOUND' | 'POOL_ITEM_NOT_FOUND' | 'LIMIT_EXCEEDED';
  constructor(
    code: 'INVALID_ARGUMENT' | 'STEP_NOT_FOUND' | 'POOL_ITEM_NOT_FOUND' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function slugify(raw: string, fallback = 'workflow'): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

function formatDateStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatPlatformText(post: SocialPost): string {
  const tags = post.hashtags.map(tag => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
  return [post.title, post.text, tags, post.link].filter(Boolean).join('\n\n') + '\n';
}

export async function buildScenarioBundle(
  dataDirectory: string,
  host: ScenarioHost,
  run: ScenarioRun,
  scenario: ScenarioDefinition,
  options: ScenarioBundleOptions,
): Promise<ScenarioBundleReceipt> {
  if (typeof options.requestId !== 'string' || !/^[\w-]{1,100}$/.test(options.requestId)) {
    throw new BundleBuildError('INVALID_ARGUMENT', 'Stable requestId is required for export');
  }
  const activeOnly = options.activeOnly ?? true;
  const locale = options.locale ?? run.locale;
  const includeStandaloneHtml = options.includeStandaloneHtml ?? true;
  const includeMotionSource = options.includeMotionSource ?? false;

  const hasPoolFilter = Array.isArray(options.poolItemIds) && options.poolItemIds.length > 0;
  const selectedPoolIds: string[] = [];
  if (hasPoolFilter) {
    const poolById = new Map(run.pool.map(item => [item.id, item]));
    const seenPool = new Set<string>();
    for (const poolItemId of options.poolItemIds!) {
      if (!poolById.has(poolItemId)) {
        throw new BundleBuildError('POOL_ITEM_NOT_FOUND', `Pool item ${poolItemId} not found`);
      }
      if (!seenPool.has(poolItemId)) {
        seenPool.add(poolItemId);
        selectedPoolIds.push(poolItemId);
      }
    }
  }

  const hasStepFilter = !hasPoolFilter && Array.isArray(options.stepIds) && options.stepIds.length > 0;
  const selectedSteps: string[] = [];
  if (hasStepFilter) {
    const seen = new Set<string>();
    for (const stepId of options.stepIds!) {
      if (!findScenarioStep(scenario, stepId)) {
        throw new BundleBuildError('STEP_NOT_FOUND', `Unknown step ${stepId}`);
      }
      if (!seen.has(stepId)) {
        seen.add(stepId);
        selectedSteps.push(stepId);
      }
    }
  } else if (!hasPoolFilter) {
    for (const step of scenario.steps) selectedSteps.push(step.id);
  }
  const selectedSet = new Set(selectedSteps);
  const contentStepIds = scenario.steps.map(step => step.id);
  const coversAllContent = hasStepFilter && contentStepIds.every(id => selectedSet.has(id));
  const filtered = hasStepFilter && !coversAllContent;

  const root = path.join(path.resolve(dataDirectory), 'scenarios');
  const bundlesDir = path.join(root, 'bundles');
  const requestsDir = path.join(root, 'requests');
  await mkdir(bundlesDir, { recursive: true, mode: 0o700 });
  await mkdir(requestsDir, { recursive: true, mode: 0o700 });

  const receiptPath = path.join(requestsDir, `${sha256(`bundle:${run.id}:${options.requestId}`)}.json`);
  const inputHash = sha256(JSON.stringify({
    runId: run.id,
    revision: run.revision,
    stepIds: hasPoolFilter ? null : filtered ? selectedSteps : null,
    poolItemIds: hasPoolFilter ? selectedPoolIds : null,
    locale: options.locale,
    activeOnly,
    includeStandaloneHtml,
    includeMotionSource,
  }));

  return withProcessLock(`${receiptPath}.lock`, async () => {
    const existing = await jsonFile<BundleReceiptFile | null>(receiptPath, null);
    if (existing) {
      if (existing.inputHash !== inputHash) {
        throw new BundleBuildError('INVALID_ARGUMENT', 'requestId already used with different export arguments');
      }
      const existingStat = await stat(existing.result.archivePath).catch(() => null);
      if (existingStat?.isFile()) {
        return existing.result;
      }
    }

    const title = localizedScenarioDraftTitle(run.title || scenario.title, scenario.title, locale);
    const rootDir = `${mediaFilename(title, '')} · ${formatDateStamp(new Date())}`;
    const entries: { name: string; data: Buffer }[] = [];
    const usedNames = new Set<string>();
    let totalBytes = 0;

    const allocateRelPath = (rawRel: string): string => {
      const cleaned = cleanDesignPath(rawRel);
      const key = foldProjectName(cleaned);
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return cleaned;
      }
      const ext = path.posix.extname(cleaned);
      const base = ext ? cleaned.slice(0, -ext.length) : cleaned;
      for (let i = 2; i < 10_000; i += 1) {
        const candidate = `${base}-${i}${ext}`;
        const candidateKey = foldProjectName(candidate);
        if (!usedNames.has(candidateKey)) {
          usedNames.add(candidateKey);
          return candidate;
        }
      }
      throw new BundleBuildError('LIMIT_EXCEEDED', `Too many duplicate bundle paths for ${cleaned}`);
    };

    const addEntry = (rawRel: string, data: Buffer): string => {
      totalBytes += data.length;
      if (totalBytes > SCENARIO_LIMITS.bundleBytes) {
        throw new BundleBuildError('LIMIT_EXCEEDED', 'Scenario bundle exceeds 500 MB limit');
      }
      const rel = allocateRelPath(rawRel);
      entries.push({ name: `${rootDir}/${rel}`, data });
      return rel;
    };

    const stepOutputs: Record<string, string[]> = Object.fromEntries(selectedSteps.map(id => [id, []]));
    const poolExportPaths = new Map<string, string>();
    const recordStepOutput = (stepId: string, rel: string) => {
      if (stepOutputs[stepId] && !stepOutputs[stepId].includes(rel)) {
        stepOutputs[stepId].push(rel);
      }
    };

    const addMediaPoolItem = async (
      item: ScenarioRun['pool'][number],
    ): Promise<string | null> => {
      if (item.ref.type !== 'asset') return null;
      const resolved = await host.resolveAsset({ assetId: item.ref.assetId, versionId: item.ref.versionId });
      const data = await readFile(resolved.filename);
      const folder = item.kind === 'image' ? 'images' : item.kind === 'video' ? 'video' : 'audio';
      const ext = path.extname(resolved.filename).toLowerCase() || '.bin';
      const label = localizedScenarioMediaLabel(item, run, scenario, locale);
      const storedRel = addEntry(`media/${folder}/${mediaFilename(label, ext)}`, data);
      poolExportPaths.set(item.id, storedRel);
      return storedRel;
    };

    const addDesignProjectFiles = async (
      projectId: string,
      versionId: string | null | undefined,
      folderSlug: string,
      onPath?: (rel: string) => void,
    ): Promise<{ paths: string[]; entryRel: string }> => {
      const projectDetail = await host.design.get(projectId, host.origin());
      const zipExport = await host.design.exportProject(projectId, { format: 'zip', versionId });
      const unpacked = readProjectZip(zipExport.data);
      const paths: string[] = [];
      let entryRel = `web/${folderSlug}/${projectDetail.entry}`;
      for (const [relPath, buf] of unpacked.entries()) {
        const storedRel = addEntry(`web/${folderSlug}/${cleanDesignPath(relPath)}`, buf);
        paths.push(storedRel);
        if (relPath === projectDetail.entry) entryRel = storedRel;
        onPath?.(storedRel);
      }
      if (includeStandaloneHtml) {
        const htmlExport = await host.design.exportProject(projectId, { format: 'html', versionId });
        const standaloneRel = addEntry(`web/${folderSlug}.standalone.html`, htmlExport.data);
        paths.push(standaloneRel);
        onPath?.(standaloneRel);
      }
      return { paths, entryRel };
    };

    const addMotionProjectFiles = async (
      projectId: string,
      sessionId: string | null,
      fileSlug: string,
      onPath?: (rel: string) => void,
    ): Promise<string> => {
      const encodedProjectId = encodeURIComponent(projectId);
      const editorPath = sessionId ? sessionPath(sessionId, projectId) : `/editor/${encodedProjectId}#project/${encodedProjectId}`;
      const origin = host.origin().replace(/\/+$/, '');
      const metaRel = addEntry(
        `motion/${fileSlug}.json`,
        Buffer.from(JSON.stringify({ projectId, sessionId, editorUrl: origin ? origin + editorPath : editorPath }, null, 2), 'utf8'),
      );
      onPath?.(metaRel);
      if (includeMotionSource) {
        const rawArchiveReq = `${options.requestId}-motion-${fileSlug}`.replace(/[^A-Za-z0-9_-]/g, '-');
        const archiveReqId = rawArchiveReq.length <= 100 ? rawArchiveReq : `sb-${sha256(`${options.requestId}:${fileSlug}:${projectId}`).slice(0, 48)}`;
        const archive = await host.exportMotionArchive({
          action: 'export',
          requestId: archiveReqId,
          projectIds: [projectId],
        });
        const archiveBytes = await readFile(archive.archivePath);
        const zipRel = addEntry(`motion/${fileSlug}.openmotion.zip`, archiveBytes);
        onPath?.(zipRel);
      }
      return metaRel;
    };

    let manifestPool = run.pool;

    if (hasPoolFilter) {
      const poolById = new Map(run.pool.map(item => [item.id, item]));
      const selectedItems = selectedPoolIds
        .map(id => poolById.get(id))
        .filter((item): item is ScenarioRun['pool'][number] => Boolean(item));
      const exportedDesignByKey = new Map<string, string>();
      const exportedMotionByKey = new Map<string, string>();

      for (const item of selectedItems) {
        if (item.ref.type === 'asset') {
          await addMediaPoolItem(item);
        } else if (item.ref.type === 'design') {
          const designKey = `${item.ref.projectId}:${item.ref.versionId ?? ''}`;
          const cached = exportedDesignByKey.get(designKey);
          if (cached) {
            poolExportPaths.set(item.id, cached);
          } else {
            const folderSlug = slugify(item.label || item.ref.projectId, 'page');
            const { entryRel } = await addDesignProjectFiles(item.ref.projectId, item.ref.versionId, folderSlug);
            exportedDesignByKey.set(designKey, entryRel);
            poolExportPaths.set(item.id, entryRel);
          }
        } else if (item.ref.type === 'motion') {
          const motionKey = `${item.ref.projectId}:${item.ref.sessionId ?? ''}`;
          const cached = exportedMotionByKey.get(motionKey);
          if (cached) {
            poolExportPaths.set(item.id, cached);
          } else {
            const fileSlug = slugify(item.label || item.ref.projectId, 'motion');
            const metaRel = await addMotionProjectFiles(item.ref.projectId, item.ref.sessionId ?? null, fileSlug);
            exportedMotionByKey.set(motionKey, metaRel);
            poolExportPaths.set(item.id, metaRel);
          }
        } else if (item.ref.type === 'text') {
          const textRef = item.ref;
          const textSlug = slugify(item.label || textRef.stepId, 'text');
          const iter = run.steps[textRef.stepId]?.iterations.find(it => it.id === textRef.iterationId);
          const briefOut = iter?.outputs.find((out): out is { type: 'brief'; values: Record<string, string | string[]> } => out.type === 'brief');
          const socialOut = iter?.outputs.find((out): out is { type: 'social'; posts: SocialPost[] } => out.type === 'social');
          const scriptOut = iter?.outputs.find((out): out is { type: 'script'; text: string } => out.type === 'script');
          if (briefOut) {
            const mdRel = addEntry(`text/${textSlug}.md`, Buffer.from(briefMarkdown(scenario, briefOut.values), 'utf8'));
            addEntry(`text/${textSlug}.json`, Buffer.from(JSON.stringify(briefOut.values, null, 2), 'utf8'));
            poolExportPaths.set(item.id, mdRel);
          } else if (socialOut) {
            const mdRel = addEntry(`text/${textSlug}.md`, Buffer.from(socialPostsMarkdown(socialOut.posts), 'utf8'));
            addEntry(`text/${textSlug}.json`, Buffer.from(JSON.stringify(socialOut.posts, null, 2), 'utf8'));
            poolExportPaths.set(item.id, mdRel);
          } else if (scriptOut) {
            const mdRel = addEntry(`text/${textSlug}.md`, Buffer.from(scriptOut.text, 'utf8'));
            poolExportPaths.set(item.id, mdRel);
          } else {
            const txtRel = addEntry(`text/${textSlug}.txt`, Buffer.from(`${item.label}\n`, 'utf8'));
            poolExportPaths.set(item.id, txtRel);
          }
        }
      }
      manifestPool = selectedItems;
    } else {
      // 1. Brief
      for (const stepDef of scenario.steps) {
        if (stepDef.type !== 'brief' || !selectedSet.has(stepDef.id)) continue;
        recordStepOutput(stepDef.id, addEntry('brief/brief.md', Buffer.from(briefMarkdown(scenario, run.brief), 'utf8')));
        recordStepOutput(stepDef.id, addEntry('brief/brief.json', Buffer.from(JSON.stringify(run.brief, null, 2), 'utf8')));

        const scriptOut = findOutputIteration(run.steps[stepDef.id], 'script')?.outputs.find(out => out.type === 'script');
        if (scriptOut?.text.trim()) {
          recordStepOutput(stepDef.id, addEntry('brief/script.md', Buffer.from(scriptOut.text, 'utf8')));
        }
      }

      // 2. Web pages (Design Studio projects)
      const exportedDesignProjects = new Map<string, { targetStepId: string; paths: string[]; entryRel: string }>();
      for (const stepDef of scenario.steps) {
        if (stepDef.type !== 'web-page' || !selectedSet.has(stepDef.id)) continue;
        const stepState = run.steps[stepDef.id];
        const linkedStepId = stepDef.page?.linkedStepId;
        const projectId = stepState?.links.designProjectId ?? (linkedStepId ? run.steps[linkedStepId]?.links.designProjectId : undefined);
        if (!projectId) continue;

        const existingExport = exportedDesignProjects.get(projectId);
        if (existingExport) {
          for (const rel of existingExport.paths) recordStepOutput(stepDef.id, rel);
          continue;
        }

        // If another selected downstream step (like embed-images) targets this project, use the latest version.
        const downstreamEmbedStep = scenario.steps.find(
          other => other.page?.linkedStepId === stepDef.id && selectedSet.has(other.id) && run.steps[other.id]?.iterations.length,
        );
        const sourceStepState = downstreamEmbedStep ? run.steps[downstreamEmbedStep.id] : stepState;
        const activeIter = sourceStepState?.iterations.find(it => it.id === sourceStepState.activeIterationId);
        const versionId = activeIter?.design?.projectId === projectId ? activeIter.design.versionId : undefined;

        const { paths: addedPaths, entryRel } = await addDesignProjectFiles(
          projectId,
          versionId,
          stepDef.id,
          rel => recordStepOutput(stepDef.id, rel),
        );

        exportedDesignProjects.set(projectId, { targetStepId: stepDef.id, paths: addedPaths, entryRel });
        for (const poolItem of run.pool) {
          if (poolItem.ref.type === 'design' && poolItem.ref.projectId === projectId) {
            poolExportPaths.set(poolItem.id, entryRel);
          }
        }
      }

      const selectedAssetPoolIds = new Set<string>();
      // 3. Social posts and their attached workspace assets
      for (const stepDef of scenario.steps) {
        if (stepDef.type !== 'social-pack' || !selectedSet.has(stepDef.id)) continue;
        const socialOut = findOutputIteration(run.steps[stepDef.id], 'social')?.outputs.find(out => out.type === 'social');
        if (!socialOut?.posts.length) continue;

        recordStepOutput(stepDef.id, addEntry('social/posts.json', Buffer.from(JSON.stringify(socialOut.posts, null, 2), 'utf8')));
        recordStepOutput(stepDef.id, addEntry('social/posts.md', Buffer.from(socialPostsMarkdown(socialOut.posts), 'utf8')));
        for (const post of socialOut.posts) {
          recordStepOutput(stepDef.id, addEntry(`social/${post.platform}.txt`, Buffer.from(formatPlatformText(post), 'utf8')));
          for (const poolItemId of post.mediaPoolItemIds) selectedAssetPoolIds.add(poolItemId);
        }
      }

      // 4. Media assets (pinned workspace asset library versions)
      for (const stepId of selectedSteps) {
        const stepState = run.steps[stepId];
        if (!stepState) continue;
        for (const ids of Object.values(stepState.bindings)) {
          for (const id of ids) selectedAssetPoolIds.add(id);
        }
        const itersToScan = activeOnly
          ? stepState.iterations.filter(it => it.id === stepState.activeIterationId || (findScenarioStep(scenario, stepId)?.type === 'web-page' && it.inputs.length > 0))
          : stepState.iterations;
        for (const iter of itersToScan) {
          for (const inputId of iter.inputs) selectedAssetPoolIds.add(inputId);
          for (const out of iter.outputs) {
            if (out.type === 'pool') selectedAssetPoolIds.add(out.poolItemId);
          }
        }
        if (!activeOnly) {
          for (const item of run.pool) {
            if (item.stepId === stepId) selectedAssetPoolIds.add(item.id);
          }
        }
      }
      if (!filtered) {
        for (const item of run.pool) {
          if (item.pinned || item.stepId === null || !activeOnly) selectedAssetPoolIds.add(item.id);
        }
      }

      for (const item of run.pool) {
        if (item.ref.type !== 'asset') continue;
        if (!selectedAssetPoolIds.has(item.id)) continue;
        const storedRel = await addMediaPoolItem(item);
        if (storedRel && item.stepId && selectedSet.has(item.stepId)) {
          recordStepOutput(item.stepId, storedRel);
        }
      }

      // 5. Motion projects
      for (const stepDef of scenario.steps) {
        if (!selectedSet.has(stepDef.id)) continue;
        const stepState = run.steps[stepDef.id];
        const projectId = stepState?.links.motionProjectId;
        if (!projectId) continue;
        const sessionId = stepState.links.motionSessionId ?? null;
        const metaRel = await addMotionProjectFiles(
          projectId,
          sessionId,
          stepDef.id,
          rel => recordStepOutput(stepDef.id, rel),
        );
        for (const poolItem of run.pool) {
          if (poolItem.ref.type === 'motion' && poolItem.ref.projectId === projectId) {
            poolExportPaths.set(poolItem.id, metaRel);
          }
        }
      }

      // 6. README.md (full package)
      if (!filtered) {
        addEntry('README.md', Buffer.from(runReadme(scenario, run, { origin: host.origin() }), 'utf8'));
      }
      manifestPool = run.pool.filter(item => !filtered || poolExportPaths.has(item.id));
    }

    const manifest = {
      schema: 'openmotion.scenario-bundle/1',
      scenario: { id: scenario.id, title: scenario.title, category: scenario.category },
      run: { id: run.id, title: run.title, revision: run.revision },
      exportedAt: new Date().toISOString(),
      ...(hasPoolFilter ? { selection: { poolItemIds: selectedPoolIds } } : {}),
      steps: hasPoolFilter
        ? []
        : scenario.steps
            .filter(step => selectedSet.has(step.id))
            .map(step => ({
              id: step.id,
              type: step.type,
              status: run.steps[step.id]?.status ?? 'todo',
              activeIterationId: run.steps[step.id]?.activeIterationId ?? null,
              outputs: stepOutputs[step.id] ?? [],
            })),
      pool: manifestPool.map(item => ({
        id: item.id,
        kind: item.kind,
        label: localizedScenarioMediaLabel(item, run, scenario, locale),
        source: item.source,
        stepId: item.stepId,
        ref: item.ref,
        ...(poolExportPaths.has(item.id) ? { path: poolExportPaths.get(item.id) } : {}),
      })),
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    totalBytes += manifestBytes.length;
    if (totalBytes > SCENARIO_LIMITS.bundleBytes) {
      throw new BundleBuildError('LIMIT_EXCEEDED', 'Scenario bundle exceeds 500 MB limit');
    }
    entries.unshift({ name: `${rootDir}/manifest.json`, data: manifestBytes });

    const bytes = zip(entries);
    if (bytes.length > SCENARIO_LIMITS.bundleBytes) {
      throw new BundleBuildError('LIMIT_EXCEEDED', 'Scenario bundle exceeds 500 MB limit');
    }

    // Validate the resulting ZIP strictly before persisting.
    readProjectZip(bytes);

    const bundleId = randomUUID();
    const filename = `${rootDir}.zip`;
    const archivePath = path.join(bundlesDir, `${bundleId}.zip`);
    const digest = sha256(bytes);

    await writeFile(archivePath, bytes, { flag: 'wx', mode: 0o600 });
    await atomicJson(path.join(bundlesDir, `${bundleId}.json`), {
      filename,
      sha256: digest,
      bytes: bytes.length,
      runId: run.id,
      revision: run.revision,
      requestId: options.requestId,
    });

    const result: ScenarioBundleReceipt = {
      bundleId,
      filename,
      bytes: bytes.length,
      sha256: digest,
      archivePath,
      downloadUrl: `/motion-api/scenarios/bundles/${bundleId}/file`,
      entries: entries.length,
    };
    await atomicJson(receiptPath, { inputHash, result });
    return result;
  });
}
