export const OPEN_DESIGN_MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
export const OPEN_DESIGN_TARGET_REFERENCE_BYTES = 1_940_000;

const SUPPORTED_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const SUPPORTED_EXTENSION_PATTERN = /\.(png|jpe?g|webp)$/i;
const ALPHA_EXTENSION_PATTERN = /\.(png|webp|gif|avif)$/i;
const MAX_EDGES = [2048, 1600, 1280, 1024];
const QUALITIES = [0.86, 0.76, 0.66, 0.54];

export type ReferenceImageErrorCode = 'too-large' | 'unsupported';

export class ReferenceImageError extends Error {
  readonly code: ReferenceImageErrorCode;

  constructor(code: ReferenceImageErrorCode, message: string) {
    super(message);
    this.name = 'ReferenceImageError';
    this.code = code;
  }
}

export interface PrepareReferenceImageOptions {
  maxBytes?: number;
  targetBytes?: number;
  preserveAlpha?: boolean;
}

export interface PreparedReferenceImage {
  file: File;
  compressed: boolean;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

export function isSupportedReferenceMime(mimeType?: string, filename = ''): boolean {
  if (mimeType) return SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType.toLowerCase());
  return SUPPORTED_EXTENSION_PATTERN.test(filename);
}

function hasPotentialAlpha(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif' || mime === 'image/avif') return true;
  if (!mime && ALPHA_EXTENSION_PATTERN.test(file.name)) return true;
  return false;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  return 'webp';
}

function replaceExtension(name: string, mimeType: string): string {
  const ext = extensionForMime(mimeType);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name || 'reference';
  return `${stem}.${ext}`;
}

async function decodeImage(file: File): Promise<DecodedImage | undefined> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          cleanup: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // Fall through to HTMLImageElement decoding.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        cleanup: () => URL.revokeObjectURL(objectUrl),
      };
    }
    URL.revokeObjectURL(objectUrl);
    return undefined;
  } catch {
    URL.revokeObjectURL(objectUrl);
    return undefined;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    try {
      canvas.toBlob(blob => resolve(blob), mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}

function tooLargeError(): ReferenceImageError {
  return new ReferenceImageError('too-large', 'The reference image is larger than the 2 MiB OpenDesign upload limit.');
}

function unsupportedFormatError(): ReferenceImageError {
  return new ReferenceImageError('unsupported', 'OpenDesign does not accept this reference image format.');
}

export async function prepareReferenceImage(
  file: File,
  options?: PrepareReferenceImageOptions,
): Promise<PreparedReferenceImage> {
  const maxBytes = options?.maxBytes ?? OPEN_DESIGN_MAX_REFERENCE_BYTES;
  const targetBytes = Math.min(options?.targetBytes ?? OPEN_DESIGN_TARGET_REFERENCE_BYTES, maxBytes);
  const supported = isSupportedReferenceMime(file.type, file.name);

  if (file.size <= maxBytes && supported) {
    return { file, compressed: false };
  }
  if (file.type && !file.type.startsWith('image/')) {
    return { file, compressed: false };
  }
  if (typeof document === 'undefined') {
    throw !supported ? unsupportedFormatError() : tooLargeError();
  }

  const decoded = await decodeImage(file);
  if (!decoded) {
    throw !supported ? unsupportedFormatError() : tooLargeError();
  }

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw !supported ? unsupportedFormatError() : tooLargeError();
    }

    const originalMaxEdge = Math.max(decoded.width, decoded.height);
    const edges = Array.from(new Set(MAX_EDGES.map(edge => Math.min(edge, originalMaxEdge))));
    const keepAlpha = Boolean(options?.preserveAlpha || hasPotentialAlpha(file));
    const mimeCandidates = keepAlpha
      ? (options?.preserveAlpha ? ['image/webp', 'image/png'] : ['image/webp', 'image/png', 'image/jpeg'])
      : ['image/webp', 'image/jpeg'];

    let smallest: Blob | undefined;
    for (const edge of edges) {
      const scale = Math.min(1, edge / originalMaxEdge);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);

      for (const mimeType of mimeCandidates) {
        const qualities = mimeType === 'image/png' ? [undefined] : QUALITIES;
        for (const quality of qualities) {
          const blob = await canvasToBlob(canvas, mimeType, quality);
          if (!blob || blob.size === 0 || !SUPPORTED_REFERENCE_MIME_TYPES.has(blob.type)) continue;
          if (!smallest || blob.size < smallest.size) smallest = blob;
          if (blob.size <= targetBytes) {
            return {
              file: new File([blob], replaceExtension(file.name, blob.type), {
                type: blob.type,
                lastModified: file.lastModified,
              }),
              compressed: true,
            };
          }
        }
      }
    }

    if (smallest && smallest.size <= maxBytes) {
      return {
        file: new File([smallest], replaceExtension(file.name, smallest.type), {
          type: smallest.type,
          lastModified: file.lastModified,
        }),
        compressed: true,
      };
    }

    throw !supported ? unsupportedFormatError() : tooLargeError();
  } finally {
    decoded.cleanup();
  }
}
