import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskLedger } from '../tracking/task-ledger.ts';
import { createTracker, validProperties } from '../tracking/core.ts';
import type { PendingEvent } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';
import { fixture } from './fixtures.ts';

test('task ledger persists accepted and terminal export state across instances', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-task-ledger-'));
  try {
    const taskId = crypto.randomUUID(), accepted = new Date().toISOString(), deadline = new Date(Date.now() + 1_000).toISOString();
    const first = new TaskLedger(directory);
    await first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: deadline });
    await first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: deadline });
    await assert.rejects(first.accept({ task_id: taskId, task_type: 'export', project_id: 'project', accepted_at: accepted, deadline_at: new Date(Date.now() + 2_000).toISOString() }), /TASK_LEDGER_CONFLICT/);
    await first.terminal(taskId, 'success', 'true');
    const second = new TaskLedger(directory), snapshot = await second.snapshot();
    assert.equal(snapshot[taskId].outcome, 'success');
    assert.equal(snapshot[taskId].applied, 'true');
    assert.ok(snapshot[taskId].terminal_at);
    const evidence = await readFile(path.join(directory, 'tracking', 'tasks.json'), 'utf8');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await first.terminal(taskId, 'success', 'true')).terminal_at, snapshot[taskId].terminal_at);
    assert.equal(await readFile(path.join(directory, 'tracking', 'tasks.json'), 'utf8'), evidence, 'a repeated identical terminal result keeps the recorded evidence');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('task ledger rejects malformed or conflicting terminal transitions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'openmotion-task-ledger-'));
  try {
    const taskId = crypto.randomUUID(), ledger = new TaskLedger(directory), now = new Date().toISOString();
    await assert.rejects(ledger.accept({ task_id: 'bad', task_type: 'export', accepted_at: now, deadline_at: now }), /TASK_LEDGER_INVALID/);
    await ledger.accept({ task_id: taskId, task_type: 'export', accepted_at: now, deadline_at: now });
    await ledger.terminal(taskId, 'failure', 'unknown', 'EXPORT_FAILED');
    const terminal = await ledger.snapshot();
    await new Promise(resolve => setTimeout(resolve, 2));
    const repeated = await ledger.terminal(taskId, 'failure', 'unknown', 'EXPORT_FAILED');
    assert.equal(repeated.terminal_at, terminal[taskId].terminal_at);
    await assert.rejects(ledger.terminal(taskId, 'success', 'true'), /TASK_LEDGER_CONFLICT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the shared export entry accepts the task before the worker closes it', () => fixture(async store => {
  const current = await store.get();
  const job = await store.requestExport(current.revision, { requestId: crypto.randomUUID() });
  const task = (await new TaskLedger(store.directory).snapshot())[job.id];
  assert.equal(task.task_type, 'export');
  assert.equal(task.project_id, store.projectId);
  assert.equal(task.accepted_at, new Date(job.acceptedAt!).toISOString());
  assert.equal(task.deadline_at, new Date(job.deadlineAt!).toISOString());
  await assert.doesNotReject(new TaskLedger(store.directory).terminal(job.id, 'cancelled', 'unknown'));
}));

test('an interrupted export is reconciled with a terminal ledger outcome', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0,
    send: async batch => { events.push(...batch); return 'accepted'; } });
  store.tracking = tracking;
  const current = await store.get();
  const job = await store.requestExport(current.revision);
  const stale = (await store.job(job.id))!;
  // A crashed worker leaves the job past its deadline with an open accepted task.
  await store.saveJob({ ...stale, expiresAt: Date.now() - 1 });
  const status = await store.status(job.id);
  assert.equal(status.exportJob!.state, 'failed');
  const task = (await new TaskLedger(store.directory).snapshot())[job.id];
  assert.equal(task.outcome, 'unknown');
  assert.equal(task.applied, 'unknown');
  assert.ok(task.terminal_at);
  // The read that closed the task is the one owner of its terminal evidence.
  await tracking.flush();
  const terminal = events.filter(event => event.event === 'task_terminal');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].entrypoint, 'worker');
  assert.equal(terminal[0].properties.outcome, 'unknown');
  assert.equal(terminal[0].properties.terminal_at, task.terminal_at, 'the evidence keeps the ledger terminal time');
  await store.status(job.id);
  await tracking.flush();
  assert.equal(events.filter(event => event.event === 'task_terminal').length, 1, 'a later read does not restate the terminal outcome');
  tracking.close();
}));

test('an unreadable task ledger never fails an accepted export', () => fixture(async store => {
  await mkdir(path.join(store.directory, 'tracking'), { recursive: true });
  await writeFile(path.join(store.directory, 'tracking', 'tasks.json'), 'corrupted');
  const current = await store.get();
  const job = await store.requestExport(current.revision);
  assert.equal(job.state, 'pending');
  assert.equal((await store.job(job.id))!.state, 'pending');
  await assert.rejects(new TaskLedger(store.directory).snapshot(), /TASK_LEDGER_UNREADABLE/);
  // Reconciling an interrupted export keeps the degraded ledger from failing the read path.
  await store.saveJob({ ...(await store.job(job.id))!, expiresAt: Date.now() - 1 });
  assert.equal((await store.status(job.id)).exportJob!.state, 'failed');
}));

test('north-star evidence events keep closed, content-free schemas', () => {
  const projectId = crypto.randomUUID(), versionId = crypto.randomUUID(), runId = crypto.randomUUID(), checkId = crypto.randomUUID(), instanceId = crypto.randomUUID();
  // Native history entry ids are the public version identity, so a check never requires a v4 UUID.
  const nativeVersion = 'history-entry-7';
  assert.equal(validProperties(omEvents, 'host_run_started', { run_id: runId, entry_type: 'mcp', task_type: 'create' }), true);
  assert.equal(validProperties(omEvents, 'host_preview_observed', { run_id: runId, project_id: 'project', revision: 'a'.repeat(64), version_id: versionId, visibility: 'visible', content_verified: true, observation_source: 'host_reported' }), true);
  assert.equal(validProperties(omEvents, 'check_completed', { check_id: checkId, check_type: 'technical_export', project_id: projectId, version_id: versionId, subject_id: checkId.slice(0, 32), checklist_version: 'export-v1', checker_type: 'automated', result: 'pass' }), true);
  assert.equal(validProperties(omEvents, 'check_required', { check_id: checkId, check_type: 'preview_observed', project_id: 'project', version_id: nativeVersion, subject_id: checkId.slice(0, 32), checklist_version: 'preview-v1', checker_type: 'host', required: true }), true);
  assert.equal(validProperties(omEvents, 'host_preview_observed', { run_id: runId, project_id: 'project', revision: 'a'.repeat(64), version_id: nativeVersion, visibility: 'visible', content_verified: true, observation_source: 'host_reported' }), true);
  assert.equal(validProperties(omEvents, 'queue_snapshot', { instance_id: instanceId, task_type: 'export', queued_count: 0, running_count: 1, available_slots: 0, counts_complete: true }), true);
  assert.equal(validProperties(omEvents, 'incident_confirmed', { incident_id: crypto.randomUUID(), incident_type: 'false_success', severity: 'sev2', subject_id: checkId.slice(0, 32) }), true);
  assert.equal(validProperties(omEvents, 'host_preview_observed', { run_id: runId, project_id: 'project', revision: 'private/path', version_id: versionId, visibility: 'visible', content_verified: true, observation_source: 'host_reported' }), false);
  assert.equal(validProperties(omEvents, 'check_completed', { check_id: checkId, check_type: 'technical_export', project_id: projectId, version_id: 'native-history-id', subject_id: checkId.slice(0, 32), checklist_version: 'export-v1', checker_type: 'automated', result: 'pass' }), true);
});
