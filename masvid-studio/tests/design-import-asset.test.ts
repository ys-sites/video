import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { DesignError, designProjectsFor } from '../design-projects.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import type { Service } from '../server.ts';
import { readProjectZip } from '../shared/project-zip.ts';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';

async function makePng(dir: string, name = 'sample.png', color = 'purple'): Promise<string> {
  const file = path.join(dir, name);
  const result = await execute(
    verificationBinaries().ffmpeg,
    ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=40x30`, '-frames:v', '1', '-y', file],
    dir,
    20_000,
  );
  assert.equal(result.code, 0, result.stderr);
  return file;
}

test('design import_asset works identically over MCP and HTTP, enforces revision and file limits, and exports in ZIP', () =>
  fixture(async store => {
    const api = transport(store, { runtimeRoot: pluginRoot } as Service);
    const library = new AssetLibrary(store);
    const pngFile = await makePng(store.directory, 'hero-shot.png', 'magenta');
    const pngBytes = await readFile(pngFile);
    const asset = await library.importFile(pngFile, { requestId: 'import-hero-png', name: 'Hero Shot' });

    const service = designProjectsFor(store.directory);
    const created = await service.create({ requestId: 'create-design-1', scenario: 'prototype', title: 'Asset Import Demo' }, 'http://localhost:4173');

    // 1. MCP openmotion_design_edit action=import_asset
    const mcpRes = await api('/motion-api/phase1/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'openmotion_design_edit',
        arguments: {
          action: 'import_asset',
          projectId: created.id,
          requestId: 'shared-import-req',
          expectedRevision: created.revision,
          assetId: asset.id,
          versionId: asset.currentVersionId,
        },
      }),
    });
    const mcpBody = await mcpRes.json();
    assert.equal(mcpRes.status, 200, JSON.stringify(mcpBody));
    assert.match(mcpBody.path, /^assets\/hero-shot-[a-f0-9]{8}\.png$/);
    assert.equal(mcpBody.version.label, 'v2');

    // 2. HTTP POST /motion-api/design/projects/:id/import-asset with same requestId replays identical receipt
    const httpReplayRes = await api(`/motion-api/design/projects/${created.id}/import-asset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'shared-import-req',
        expectedRevision: created.revision,
        assetId: asset.id,
        versionId: asset.currentVersionId,
      }),
    });
    const httpReplayBody = await httpReplayRes.json();
    assert.equal(httpReplayRes.status, 200, JSON.stringify(httpReplayBody));
    assert.equal(httpReplayBody.path, mcpBody.path);
    assert.equal(httpReplayBody.version.id, mcpBody.version.id);
    assert.equal(httpReplayBody.project.revision, mcpBody.project.revision);

    // 3. Stale expectedRevision returns 409 VERSION_CONFLICT over HTTP
    const conflictRes = await api(`/motion-api/design/projects/${created.id}/import-asset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'conflict-import-req',
        expectedRevision: created.revision,
        assetId: asset.id,
        versionId: asset.currentVersionId,
        path: 'assets/second.png',
      }),
    });
    assert.equal(conflictRes.status, 409);
    const conflictBody = await conflictRes.json();
    assert.equal(conflictBody.error.code, 'VERSION_CONFLICT');

    // 4. Fresh HTTP import with current revision writes custom path and creates v3
    const httpSecondRes = await api(`/motion-api/design/projects/${created.id}/import-asset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: 'second-import-req',
        expectedRevision: mcpBody.project.revision,
        assetId: asset.id,
        versionId: asset.currentVersionId,
        path: 'assets/custom-hero.png',
      }),
    });
    const httpSecondBody = await httpSecondRes.json();
    assert.equal(httpSecondRes.status, 200, JSON.stringify(httpSecondBody));
    assert.equal(httpSecondBody.path, 'assets/custom-hero.png');
    assert.equal(httpSecondBody.version.label, 'v3');

    // 5. Non-image/disallowed file and over-limit (>25 MB) file are rejected
    const txtPath = path.join(store.directory, 'notes.txt');
    await writeFile(txtPath, 'plain text not allowed as binary import', 'utf8');
    await assert.rejects(
      () => service.importBinaryFile(created.id, {
        requestId: 'reject-txt',
        expectedRevision: httpSecondBody.project.revision,
        sourcePath: txtPath,
      }),
      (err: unknown) => err instanceof DesignError && err.code === 'INVALID_ARGUMENT',
    );

    const hugePath = path.join(store.directory, 'huge.png');
    await writeFile(hugePath, Buffer.alloc(25 * 1024 * 1024 + 1024, 1));
    await assert.rejects(
      () => service.importBinaryFile(created.id, {
        requestId: 'reject-huge',
        expectedRevision: httpSecondBody.project.revision,
        sourcePath: hugePath,
      }),
      (err: unknown) => err instanceof DesignError && err.code === 'INVALID_ARGUMENT',
    );

    // 6. exportProject('zip') contains the imported binary with exact bytes
    const exported = await service.exportProject(created.id, { format: 'zip' });
    const entries = readProjectZip(exported.data);
    assert.ok(entries.has(mcpBody.path), 'ZIP contains default-path imported image');
    assert.ok(entries.has('assets/custom-hero.png'), 'ZIP contains custom-path imported image');
    assert.deepEqual(entries.get(mcpBody.path), pngBytes);
  }, false));
