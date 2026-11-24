export type AssetUploadReason = 'size' | 'unreadable' | 'unsupported';

/** Only explicit pre-commit refusals establish that an upload was not saved. */
export class AssetUploadError extends Error {
  constructor(public readonly outcome: 'rejected' | 'unknown', public readonly reason?: AssetUploadReason) {
    super(outcome === 'unknown' ? 'Upload result could not be confirmed.' : 'File was not uploaded.');
  }
}

export function uploadResponseError(status: number, data?: { error?: unknown; applied?: unknown }) {
  if (status === 413 || data?.error === 'Asset exceeds 500 MB') return new AssetUploadError('rejected', 'size');
  if (data?.error === 'This file is not readable image, video or audio media'
    || data?.error === 'The media file could not be decoded') return new AssetUploadError('rejected', 'unreadable');
  if (data?.error === 'Unsupported media type') return new AssetUploadError('rejected', 'unsupported');
  // These are validation failures before the library commits a version. Other
  // server errors can occur after writing, including response/cleanup failures.
  const refused = data?.applied === false || [
    'Asset must be a file of at most 500 MB',
    'A filename and stable requestId are required',
    'Asset name must contain 1–200 characters',
    'Restore this asset before adding a version',
    'Asset versions must have the same media type',
    'ASSET_NOT_FOUND', 'ASSET_VERSION_UNAVAILABLE', 'REQUEST_ID_CONFLICT',
  ].includes(String(data?.error));
  return new AssetUploadError(refused ? 'rejected' : 'unknown');
}
