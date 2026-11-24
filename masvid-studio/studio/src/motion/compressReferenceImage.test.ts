// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_DESIGN_MAX_REFERENCE_BYTES, prepareReferenceImage, ReferenceImageError } from './compressReferenceImage';

function makeFile(bytes: number, name: string, type: string): File {
  const buf = new Uint8Array(bytes);
  return new File([buf], name, { type });
}

describe('prepareReferenceImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes through supported PNG/JPEG/WebP files within the 2 MiB limit untouched', async () => {
    const file = makeFile(120_000, 'portrait.png', 'image/png');
    const result = await prepareReferenceImage(file);
    expect(result.compressed).toBe(false);
    expect(result.file).toBe(file);
  });

  it('compresses oversized reference images below 2 MiB and rewrites the extension to match the encoded MIME', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3200, height: 2400, close })));
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const toBlob = vi.fn((cb: BlobCallback, mimeType?: string, quality?: number) => {
      const size = quality && quality <= 0.76 ? 850_000 : 2_300_000;
      cb(new Blob([new Uint8Array(size)], { type: mimeType ?? 'image/webp' }));
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect, drawImage } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob as never);

    const oversized = makeFile(OPEN_DESIGN_MAX_REFERENCE_BYTES + 500_000, 'iphone-photo.png', 'image/png');
    const result = await prepareReferenceImage(oversized);

    expect(result.compressed).toBe(true);
    expect(result.file.size).toBeLessThanOrEqual(OPEN_DESIGN_MAX_REFERENCE_BYTES);
    expect(result.file.type).toBe('image/webp');
    expect(result.file.name).toBe('iphone-photo.webp');
    expect(drawImage).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws ReferenceImageError when an oversized image cannot be decoded or reduced under 2 MiB', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed'); }));
    vi.stubGlobal('Image', undefined);

    const huge = makeFile(OPEN_DESIGN_MAX_REFERENCE_BYTES + 1024, 'huge.png', 'image/png');
    await expect(prepareReferenceImage(huge)).rejects.toBeInstanceOf(ReferenceImageError);
    await expect(prepareReferenceImage(huge)).rejects.toMatchObject({
      code: 'too-large',
      message: 'The reference image is larger than the 2 MiB OpenDesign upload limit.',
    });
  });

  it('converts unsupported image formats like BMP into WebP when decodable', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 640, height: 480, close })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((cb: BlobCallback, mimeType?: string) => {
      cb(new Blob([new Uint8Array(12_000)], { type: mimeType ?? 'image/webp' }));
    }) as never);

    const bmp = makeFile(80_000, 'sketch.bmp', 'image/bmp');
    const result = await prepareReferenceImage(bmp);

    expect(result.compressed).toBe(true);
    expect(result.file.type).toBe('image/webp');
    expect(result.file.name).toBe('sketch.webp');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('throws ReferenceImageError(unsupported) for sub-2 MiB unsupported formats that cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('HEIC unsupported'); }));
    vi.stubGlobal('Image', undefined);

    const heic = makeFile(300_000, 'iphone.heic', 'image/heic');
    await expect(prepareReferenceImage(heic)).rejects.toBeInstanceOf(ReferenceImageError);
    await expect(prepareReferenceImage(heic)).rejects.toMatchObject({
      code: 'unsupported',
      message: 'OpenDesign does not accept this reference image format.',
    });
  });
});
