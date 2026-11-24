import type { AudioKind } from './audio-kind.ts';
import type { Modality } from './gateway.ts';

// Common extensions for the containers accepted by probeLibraryMedia.
// The server still validates the file contents and codecs.
export const assetUploadFormats = {
  image: ['PNG', 'JPG', 'JPEG', 'WebP', 'GIF', 'AVIF'],
  video: ['MP4', 'MOV', 'M4V', 'WebM', 'MKV'],
  audio: ['MP3', 'WAV', 'M4A', 'AAC', 'OGG', 'Opus', 'FLAC', 'WebM'],
} as const satisfies Record<Modality, readonly string[]>;

export function assetUploadAccept(modality?: Modality): string {
  const formats = modality ? assetUploadFormats[modality] : Object.values(assetUploadFormats).flat();
  return [...new Set(formats)].map(format => `.${format.toLowerCase()}`).join(',');
}

/** A reference always pins immutable bytes, never the asset's changing current version. */
export type AssetReference = { assetId: string; versionId: string };
export type AssetVersion = {
  id: string; createdAt: number; source: 'upload' | 'generated'; filename: string; name?: string;
  mimeType: string; bytes: number; sha256: string; width?: number; height?: number; duration?: number;
  waveform?: number[];
  audioKind?: AudioKind;
  prompt?: string; model?: string; parameters?: Record<string, unknown>;
  references: AssetReference[]; parentVersionId?: string; jobId?: string; conversationId?: string;
  requestId?: string; requestHash?: string;
  result?: Record<string, unknown>;
};
export type LibraryAsset = {
  id: string; name: string; modality: Modality; createdAt: number; updatedAt: number;
  currentVersionId: string; versions: AssetVersion[]; trashedAt?: number;
};
export type LibraryGeneration = {
  assetId?: string; title?: string; parentVersionId?: string;
  references?: AssetReference[]; conversationId?: string;
};
export type AssetListInput = {
  modality?: Modality; audioKind?: AudioKind; source?: 'upload' | 'generated'; query?: string; trash?: boolean;
  sort?: 'newest' | 'oldest' | 'name'; offset?: number; limit?: number;
};
export const assetVersion = (asset: LibraryAsset, versionId = asset.currentVersionId) => asset.versions.find(version => version.id === versionId);
export const assetMediaUrl = (assetId: string, versionId: string) => `/motion-api/assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/file`;
export const assetDownloadUrl = (assetId: string, versionId: string, title: string) =>
  `${assetMediaUrl(assetId, versionId)}?${new URLSearchParams({ download: '', title })}`;

export type AssetReadContent = { type: 'text'; text: string } | { type: 'image' | 'audio'; mimeType: string; data: string };
export type AssetReadResult = {
  assetId: string; versionId: string; modality: Modality; version: AssetVersion;
  previews: { mimeType: string; bytes: number; width?: number; height?: number; timestamp?: number; start?: number; duration?: number }[];
  content: AssetReadContent[];
};
/** Media belongs in native content, never duplicated in JSON metadata or persisted chat messages. */
export function assetReadToolResult(value: AssetReadResult) {
  const { content, ...metadata } = value;
  return { content: [{ type: 'text' as const, text: JSON.stringify(metadata) }, ...content], structuredContent: metadata };
}
