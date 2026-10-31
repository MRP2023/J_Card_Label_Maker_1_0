/** Colour helpers: hex maths, WCAG contrast, and a deterministic palette extractor for reference images. */

export type RGB = [number, number, number];

export const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
};
export const rgbToHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const mix = (a: string, b: string, t: number): string => {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
};

/** Black or off-white, whichever reads better on `bg`. */
export const readableOn = (bg: string, dark = '#111111', light = '#f4f4f0') => (contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light);

const saturation = ([r, g, b]: RGB) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

export interface ExtractedPalette { background: string; text: string; accent: string; secondary: string; swatches: string[] }

/**
 * Deterministic palette from raw RGBA pixels: quantise to 4 bits per channel, rank buckets by population,
 * merge near-duplicates, then pick a background (dominant), readable text colour, a saturated accent and a secondary.
 */
export function paletteFromPixels(rgba: Uint8ClampedArray | Uint8Array, step = 7): ExtractedPalette {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < rgba.length; i += 4 * step) {
    if (rgba[i + 3] < 128) continue;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += rgba[i]; b.g += rgba[i + 1]; b.b += rgba[i + 2];
    buckets.set(key, b);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map((b): { rgb: RGB; n: number } => ({ rgb: [b.r / b.n, b.g / b.n, b.b / b.n], n: b.n }));
  const picked: { rgb: RGB; n: number }[] = [];
  for (const c of ranked) {
    if (picked.every((p) => Math.hypot(p.rgb[0] - c.rgb[0], p.rgb[1] - c.rgb[1], p.rgb[2] - c.rgb[2]) > 60)) picked.push(c);
    if (picked.length >= 6) break;
  }
  if (!picked.length) return { background: '#f4efe4', text: '#111111', accent: '#c0392b', secondary: '#7a6f5d', swatches: [] };
  const swatches = picked.map((p) => rgbToHex(p.rgb));
  const background = swatches[0];
  const text = readableOn(background);
  const byAccent = picked.slice(1).filter((p) => contrastRatio(rgbToHex(p.rgb), background) >= 1.6).sort((a, b) => saturation(b.rgb) * Math.sqrt(b.n) - saturation(a.rgb) * Math.sqrt(a.n));
  const accent = byAccent[0] ? rgbToHex(byAccent[0].rgb) : mix(background, text, 0.55);
  const secondary = byAccent[1] ? rgbToHex(byAccent[1].rgb) : mix(background, accent, 0.5);
  return { background, text, accent, secondary, swatches };
}

// ---------- HSL helpers (used by the local design-suggestion engine) ----------

/** hex -> [hue 0..360, saturation 0..1, lightness 0..1] */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** hue 0..360, saturation 0..1, lightness 0..1 -> #rrggbb */
export function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = Math.min(1, Math.max(0, s)), ll = Math.min(1, Math.max(0, l));
  if (ss === 0) return rgbToHex([ll * 255, ll * 255, ll * 255]);
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const f = (t: number) => { const x = ((t % 1) + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
  return rgbToHex([f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255]);
}
