/** Resolves the effective style of one side: shared style + side typography overrides + Side B colour variant. */
import { mix, readableOn, contrastRatio } from './color';
import { TYPO_KEYS, assetById, type Design, type Rect01, type Crop, type Side, type Style } from './model';

export function styleFor(d: Design, side: Side): Style {
  const base = d.style;
  const sc = d.sides[side];
  const s: Style = { ...base };
  for (const k of TYPO_KEYS) {
    const v = sc.typo?.[k];
    if (v !== undefined) (s as unknown as Record<string, unknown>)[k] = v;
  }
  if (sc.bgOpacity !== null && sc.bgOpacity !== undefined) s.backgroundOpacity = sc.bgOpacity;
  if (sc.logoAssetId) s.logoAssetId = sc.logoAssetId;
  // Side B colour variant: same design language, different mood.
  if (side === 'B' && base.sideBVariant !== 'matched' && !sc.backgroundColor) {
    if (base.sideBVariant === 'inverted') {
      s.backgroundColor = base.textColor;
      s.textColor = base.backgroundColor;
      // keep the accent legible on the swapped background
      if (contrastRatio(s.accentColor, s.backgroundColor) < 3) s.accentColor = readableOn(s.backgroundColor, base.accentColor, base.backgroundColor);
    } else {
      s.backgroundColor = mix(base.backgroundColor, base.accentColor, 0.16);
      s.textColor = readableOn(s.backgroundColor, base.textColor, base.backgroundColor);
    }
  }
  if (sc.backgroundColor) { s.backgroundColor = sc.backgroundColor; if (contrastRatio(s.textColor, s.backgroundColor) < 3) s.textColor = readableOn(s.backgroundColor); }
  return s;
}

/** Resolved heading/body font refs. */
export const headingFontOf = (s: Style) => s.headingFont ?? s.font;
export const bodyFontOf = (s: Style) => s.bodyFont ?? s.font;

export const applyCase = (text: string, c: Style['titleCase']) => (c === 'upper' ? text.toUpperCase() : c === 'lower' ? text.toLowerCase() : text);

// ---------- artwork cropping ----------

export const clampCrop = (c: Crop): Crop => ({ zoom: Math.min(4, Math.max(1, c.zoom)), cx: Math.min(1, Math.max(0, c.cx)), cy: Math.min(1, Math.max(0, c.cy)) });

/**
 * Where to draw an image so that it always covers the frame (cover fit), zoomed by `crop.zoom`
 * and centred on the image point (cx, cy). Never leaves a gap inside the frame.
 */
export function imagePlacement(frameW: number, frameH: number, imgW: number, imgH: number, crop: Crop) {
  const c = clampCrop(crop);
  const k = Math.max(frameW / imgW, frameH / imgH) * c.zoom;
  const w = imgW * k;
  const h = imgH * k;
  const x = Math.min(0, Math.max(frameW - w, frameW / 2 - c.cx * w));
  const y = Math.min(0, Math.max(frameH - h, frameH / 2 - c.cy * h));
  return { x, y, w, h };
}

/** Maps a normalised image rectangle (the artwork's focal area) to frame millimetres under the current crop. */
export function focalToFrame(f: Rect01, frameW: number, frameH: number, imgW: number, imgH: number, crop: Crop) {
  const p = imagePlacement(frameW, frameH, imgW, imgH, crop);
  const x0 = Math.max(0, p.x + f.x * p.w), y0 = Math.max(0, p.y + f.y * p.h);
  const x1 = Math.min(frameW, p.x + (f.x + f.w) * p.w), y1 = Math.min(frameH, p.y + (f.y + f.h) * p.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** All areas of this side's artwork that text must stay clear of, in frame millimetres (under the current crop). */
export function focalZones(d: Design, side: Side, frame: { w: number; h: number }) {
  const sc = d.sides[side];
  const a = assetById(d, sc.backgroundAssetId);
  if (!a) return [];
  return [sc.bgFocal, ...(sc.bgFocalMore ?? [])]
    .filter((f): f is Rect01 => !!f)
    .map((f) => focalToFrame(f, frame.w, frame.h, a.width, a.height, sc.bgCrop))
    .filter((r): r is NonNullable<typeof r> => !!r);
}
