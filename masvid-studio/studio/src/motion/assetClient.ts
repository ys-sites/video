import { gatewayRequest } from './gatewayClient';
import type { LibraryAsset } from '../../../shared/asset-library';
import { MAX_ASSET_BYTES } from '../../../shared/asset-limits';
import { AssetUploadError, uploadResponseError } from './assetUploadError';
export async function assetRequest<T>(args: Record<string, unknown>): Promise<T> {
  return gatewayRequest<T>('phase1/call', 'POST', { name: 'openmotion_assets_use', arguments: args });
}
export async function uploadLibraryAsset(file: File, { assetId, parentVersionId, modality }: { assetId?: string; parentVersionId?: string; modality?: 'video' } = {}) {
  if (file.size > MAX_ASSET_BYTES) throw new AssetUploadError('rejected', 'size');
  if (!file.size) throw new AssetUploadError('rejected', 'unreadable');
  if (file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name)) {
    throw new AssetUploadError('rejected', 'unsupported');
  }
  const query = new URLSearchParams({ requestId: crypto.randomUUID() });
  if (assetId) query.set('assetId', assetId);
  if (parentVersionId) query.set('parentVersionId', parentVersionId);
  if (modality) query.set('modality', modality);
  try {
    const response = await fetch('/motion-api/assets/upload?' + query, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
    if (response.status === 413) throw uploadResponseError(413);
    const data = await response.json();
    if (!response.ok) throw uploadResponseError(response.status, data);
    if ((modality && data?.asset?.modality !== modality) || !data?.asset?.id || !data.asset.currentVersionId || !Array.isArray(data.asset.versions)
      || !data.asset.versions.some((version: { id?: string }) => version?.id === data.asset.currentVersionId)) throw new AssetUploadError('unknown');
    return data.asset as LibraryAsset;
  } catch (error) {
    if (error instanceof AssetUploadError) throw error;
    throw new AssetUploadError('unknown');
  }
}
