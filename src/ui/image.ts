import { paletteFromPixels } from '../core/color';
import type { Asset } from '../core/model';

/**
 * Decode any browser-supported image (PNG, JPEG, WebP, SVG, ...) and re-encode as PNG/JPEG so the
 * PDF exporter can embed it. SVG uploads are rasterised (vector logos lose their vector form).
 */
export async function fileToAsset(file: File, kind: Asset['kind'], maxDim = 2400): Promise<Asset> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Could not read "${file.name}" as an image.`));
      i.src = url;
    });
    let w = img.naturalWidth || 1200;
    let h = img.naturalHeight || 1200;
    const k = Math.min(1, maxDim / Math.max(w, h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    // Logos usually need transparency; photos/art compress far better as JPEG.
    const dataUrl = kind === 'logo' || /png|svg|gif|webp/.test(file.type) ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
    return { id: 'a' + Math.random().toString(36).slice(2, 9), kind, name: file.name, dataUrl, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downscale a data URL for upload to the AI service (keeps requests small). */
export async function downscaleDataUrl(dataUrl: string, maxDim = 1400): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Dominant colours of an image, for the offline "palette from my artwork" action. */
export async function paletteFromDataUrl(dataUrl: string) {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const c = document.createElement('canvas');
  const k = Math.min(1, 96 / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return paletteFromPixels(ctx.getImageData(0, 0, c.width, c.height).data, 1);
}
