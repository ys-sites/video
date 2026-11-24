import type { OmTracking } from '../shared/tracking.ts';
import path from 'node:path';
import type { WorkspaceStore } from '../workspace.ts';
import { AssetLibrary } from './asset-library.ts';
import { gatewayFor } from './service.ts';
import { requireNativeRuntime } from '../scripts/npm-runtime.mjs';
import { pluginRoot } from '../hyperframes.ts';
import { readLibraryAsset } from './asset-read.ts';

export async function assetOperation(store: WorkspaceStore, args: any, importProject?: (input: any, options?: { receiptName: string; reusePinnedContent: boolean }) => Promise<any>, tracking?: OmTracking) {
  const library = new AssetLibrary(store), gateway = gatewayFor(store, tracking);
  if (args.action === 'list') return library.list(args);
  if (args.action === 'read') return readLibraryAsset(library, args);
  if (args.action === 'get') {
    const asset = await library.get(args.assetId);
    return { asset, ...(args.versionId ? { version: (await library.resolve({ assetId: args.assetId, versionId: args.versionId }, true)).version } : {}) };
  }
  if (args.action === 'update') return { asset: await library.update(args.assetId, args.changes) };
  if (args.action === 'import') {
    await requireNativeRuntime(pluginRoot, 'media');
    return { asset: await library.importFile(args.sourcePath, { requestId: args.requestId, name: args.name || path.basename(args.sourcePath), assetId: args.assetId, parentVersionId: args.parentVersionId }) };
  }
  if (args.action === 'generate') {
    if (!args.requestId || !args.model) throw new Error('Choose a model and supply a stable requestId');
    await requireNativeRuntime(pluginRoot, 'media');
    const job = await gateway.submit({ modality: args.modality, prompt: args.prompt, model: args.model, mode: args.mode,
      idempotencyKey: args.requestId, parameters: args.parameters,
      library: { assetId: args.assetId, title: args.name, parentVersionId: args.parentVersionId, references: args.references, conversationId: args.conversationId } });
    return { job, next: { action: 'status', jobId: job.id } };
  }
  if (args.action === 'jobs') return { jobs: (await gateway.listJobs()).filter(job => (job.library || job.saveToLibrary) && (!args.conversationId || job.library?.conversationId === args.conversationId)).slice(0, 100) };
  if (args.action === 'status' || args.action === 'cancel' || args.action === 'retry_save' || args.action === 'resume') {
    const job = await gateway.getJob(args.jobId);
    if (!job.library && !job.saveToLibrary) throw new Error('ASSET_JOB_NOT_FOUND');
    if (['retry_save', 'resume'].includes(args.action) && !args.requestId) throw new Error('A stable requestId is required');
    if (args.action === 'resume') return { job: await gateway.resume(job.id, args.requestId) };
    return { job: args.action === 'retry_save' ? await gateway.retrySave(job.id) : args.action === 'cancel' ? await gateway.cancel(job.id) : job };
  }
  if (args.action === 'import_to_project') {
    if (!importProject || !args.projectId || !args.requestId) throw new Error('Explicit projectId and requestId are required');
    const { asset, version, filename } = await library.resolve({ assetId: args.assetId, versionId: args.versionId });
    return importProject({ projectId: args.projectId, requestId: args.requestId,
      items: [{ itemId: `library-${asset.id}-${version.id}`, sourcePath: filename, name: args.name ?? asset.name ?? version.name ?? version.filename, expectedSha256: version.sha256 }] },
      { receiptName: args.name ?? version.name ?? version.filename, reusePinnedContent: true });
  }
  throw new Error('Unknown asset operation');
}
