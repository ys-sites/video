import path from 'node:path';
import { saveInstallationSource } from '../tracking/node.ts';
import { createAppTracking, closeTracking, trackingLocked, trackingPreference } from './tracking.ts';

async function recordInstallationEvent(directory: string, host: string, source: string | undefined, event: 'installation_started' | 'installation_result'): Promise<void> {
  if (trackingLocked() || !trackingPreference(directory)) return;
  await saveInstallationSource(path.join(directory, 'tracking'), source);
  const tracking = await createAppTracking(directory, 'installer');
  const hostProduct = (['codex', 'claude', 'deepseek', 'workbuddy'] as const).find(product => product === host) ?? 'other';
  if (event === 'installation_result') tracking.track(event, { outcome: 'success', host_product: hostProduct });
  else tracking.track(event, { host_product: hostProduct });
  await closeTracking(tracking);
}

export async function recordInstallationStart(directory: string, host: string, source?: string): Promise<void> {
  await recordInstallationEvent(directory, host, source, 'installation_started');
}

export async function recordInstallation(directory: string, host: string, source?: string): Promise<void> {
  await recordInstallationEvent(directory, host, source, 'installation_result');
}
