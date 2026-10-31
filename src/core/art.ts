/** Offline artwork analysis: where is the subject? Used to keep tracklist text off faces and focal elements. */
import type { Rect01 } from './model';

/**
 * Estimates up to three focal areas (normalised 0..1) from raw RGBA pixels. A cell is "salient" when it differs from
 * the image's typical colour, is locally contrasty or saturated; connected salient cells form a region.
 * Returns [] for flat images. This is a heuristic; manual edits can replace it.
 */
export function estimateFocalRects(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, gridW = 32, gridH = 16): Rect01[] {
  const cw = width / gridW, ch = height / gridH;
  const lumAt = (o: number) => 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
  const cells: { r: number; g: number; b: number; contrast: number; sat: number }[] = [];
  for (let gy = 0; gy < gridH; gy++) for (let gx = 0; gx < gridW; gx++) {
    let r = 0, g = 0, b = 0, n = 0, l1 = 0, l2 = 0, sat = 0;
    const x0 = Math.floor(gx * cw), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cw));
    const y0 = Math.floor(gy * ch), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * ch));
    const sx = Math.max(1, Math.floor((x1 - x0) / 6)), sy = Math.max(1, Math.floor((y1 - y0) / 6));
    for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) {
      const o = (y * width + x) * 4;
      if (rgba[o + 3] < 128) continue;
      r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++;
      const l = lumAt(o); l1 += l; l2 += l * l;
      const mx = Math.max(rgba[o], rgba[o + 1], rgba[o + 2]), mn = Math.min(rgba[o], rgba[o + 1], rgba[o + 2]);
      sat += mx ? (mx - mn) / mx : 0;
    }
    if (!n) { cells.push({ r: 0, g: 0, b: 0, contrast: 0, sat: 0 }); continue; }
    const mean = l1 / n;
    cells.push({ r: r / n, g: g / n, b: b / n, contrast: Math.sqrt(Math.max(0, l2 / n - mean * mean)), sat: sat / n });
  }
  // typical colour = per-channel median across cells
  const med = (k: 'r' | 'g' | 'b') => { const v = cells.map((c) => c[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const m = [med('r'), med('g'), med('b')];
  const score = cells.map((c) => Math.hypot(c.r - m[0], c.g - m[1], c.b - m[2]) / 441 + c.contrast / 128 * 0.5 + c.sat * 0.1);
  const sorted = [...score].sort((a, b) => a - b);
  const thr = Math.max(sorted[Math.floor(sorted.length * 0.78)], 0.12);
  if (sorted[sorted.length - 1] < 0.12) return [];
  const on = score.map((v) => v >= thr);
  const seen = new Array(on.length).fill(false);
  const comps: { x0: number; y0: number; x1: number; y1: number; sum: number }[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || seen[i]) continue;
    const stack = [i]; seen[i] = true;
    const comp = { x0: gridW, y0: gridH, x1: -1, y1: -1, sum: 0 };
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % gridW, y = (k - x) / gridW;
      comp.x0 = Math.min(comp.x0, x); comp.x1 = Math.max(comp.x1, x); comp.y0 = Math.min(comp.y0, y); comp.y1 = Math.max(comp.y1, y); comp.sum += score[k];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
        const nk = ny * gridW + nx;
        if (on[nk] && !seen[nk]) { seen[nk] = true; stack.push(nk); }
      }
    }
    comps.push(comp);
  }
  return comps
    .filter((c) => c.sum >= 2.2) // ignore specks
    .sort((a, b) => b.sum - a.sum).slice(0, 3)
    .map((c) => {
      const x = Math.max(0, c.x0 - 0.5) / gridW, y = Math.max(0, c.y0 - 0.5) / gridH;
      const w = Math.min(1 - x, (c.x1 - c.x0 + 2) / gridW), h = Math.min(1 - y, (c.y1 - c.y0 + 2) / gridH);
      return { x: +x.toFixed(3), y: +y.toFixed(3), w: +w.toFixed(3), h: +h.toFixed(3) };
    });
}

// ---------- image features (mood and character of a reference image) ----------

import { paletteFromPixels, type ExtractedPalette } from './color';

export interface ImageFeatures {
  palette: ExtractedPalette;
  /** Average luminance 0 (black) .. 1 (white). */
  meanLuminance: number;
  /** Average colour saturation 0..1. */
  saturation: number;
  /** Red-vs-blue balance, -1 (cool) .. 1 (warm). */
  warmth: number;
  /** Spread of luminance, 0 (flat) .. 1 (stark). */
  contrast: number;
  /** Amount of fine detail / edges, 0 (calm) .. 1 (busy). */
  busyness: number;
  focals: Rect01[];
  width: number;
  height: number;
}

/**
 * Measures what an image feels like from its pixels, deterministically and offline: dominant colours, brightness, saturation,
 * warmth, contrast, how busy it is, and where the subject is. These numbers drive the rule-based design suggestions.
 */
export function analyzeImagePixels(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): ImageFeatures {
  const n = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(n / 4000)));
  let cnt = 0, lum = 0, lum2 = 0, sat = 0, warm = 0, grad = 0, gcnt = 0;
  const L = (o: number) => 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
  for (let y = 0; y < height - step; y += step) for (let x = 0; x < width - step; x += step) {
    const o = (y * width + x) * 4;
    if (rgba[o + 3] < 128) continue;
    const l = L(o);
    lum += l; lum2 += l * l; cnt++;
    const mx = Math.max(rgba[o], rgba[o + 1], rgba[o + 2]), mn = Math.min(rgba[o], rgba[o + 1], rgba[o + 2]);
    sat += mx ? (mx - mn) / mx : 0;
    warm += (rgba[o] - rgba[o + 2]) / 255;
    grad += Math.abs(l - L(o + step * 4)) + Math.abs(l - L(o + step * width * 4));
    gcnt += 2;
  }
  const palette = paletteFromPixels(rgba, Math.max(1, step * step));
  if (!cnt) return { palette, meanLuminance: 0.5, saturation: 0, warmth: 0, contrast: 0, busyness: 0, focals: [], width, height };
  const mean = lum / cnt;
  return {
    palette,
    meanLuminance: mean / 255,
    saturation: sat / cnt,
    warmth: Math.max(-1, Math.min(1, warm / cnt)),
    contrast: Math.min(1, Math.sqrt(Math.max(0, lum2 / cnt - mean * mean)) / 100),
    busyness: Math.min(1, grad / gcnt / 30),
    focals: estimateFocalRects(rgba, width, height),
    width, height,
  };
}
