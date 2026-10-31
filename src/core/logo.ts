/**
 * Logo analysis and non-destructive treatments. Everything here works on raw RGBA pixels and returns NEW pixel data:
 * the uploaded file is never modified. The UI turns a treated result into a separate derived asset next to the original.
 */
import { contrastRatio, luminance, rgbToHex } from './color';

export interface LogoStats {
  width: number;
  height: number;
  /** Share of pixels that are (nearly) transparent. */
  transparentRatio: number;
  /** True when the image has any transparency at all. */
  hasAlpha: boolean;
  /** The four corners are opaque and the same colour: the logo sits in an opaque box. */
  opaqueBox: boolean;
  boxColor: string | null;
  /** Colour of the actual ink (box colour excluded), and its share of the image. */
  inkColor: string;
  inkLuminance: number;
  inkRatio: number;
}

export type LogoIssueCode = 'dark-on-dark' | 'light-on-light' | 'low-contrast' | 'low-resolution' | 'opaque-background' | 'mostly-transparent' | 'faint-ink';
export type LogoTreatment = 'recolor-light' | 'recolor-dark' | 'remove-background';

export interface LogoIssue { code: LogoIssueCode; severity: 'warning' | 'info'; message: string; suggestions: LogoTreatment[] }

const near = (a: number[], b: number[], tol: number) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

/** Measures an image: transparency, an opaque background box, and the colour/luminance of the ink. */
export function analyzeLogoPixels(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): LogoStats {
  const n = width * height;
  const px = (x: number, y: number) => { const i = (y * width + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]; };
  let transparent = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 26) transparent++;
  const corners = [px(0, 0), px(width - 1, 0), px(0, height - 1), px(width - 1, height - 1)];
  const opaqueBox = corners.every((c) => c[3] > 230) && corners.every((c) => near(c, corners[0], 24));
  const box = opaqueBox ? corners[0] : null;
  let r = 0, g = 0, b = 0, w = 0;
  let ink = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = rgba[o + 3] / 255;
    if (a < 0.5) continue;
    if (box && near([rgba[o], rgba[o + 1], rgba[o + 2]], box, 24)) continue; // the box itself is not ink
    r += rgba[o] * a; g += rgba[o + 1] * a; b += rgba[o + 2] * a; w += a; ink++;
  }
  const inkHex = w ? rgbToHex([r / w, g / w, b / w]) : '#808080';
  return {
    width, height, transparentRatio: transparent / n, hasAlpha: transparent > 0, opaqueBox, boxColor: box ? rgbToHex([box[0], box[1], box[2]]) : null,
    inkColor: inkHex, inkLuminance: luminance(inkHex), inkRatio: ink / n,
  };
}

export interface LogoContext {
  /** Background colour the logo sits on. */
  background: string;
  /** Printed width of the logo on the label, in mm. */
  printWidthMm: number;
  /** Side label for messages. */
  side?: string;
}

/** Effective resolution of an image printed `printWidthMm` wide. */
export const effectiveDpi = (pixelWidth: number, printWidthMm: number) => (printWidthMm > 0 ? pixelWidth / (printWidthMm / 25.4) : Infinity);

export function logoIssues(st: LogoStats, ctx: LogoContext): LogoIssue[] {
  const out: LogoIssue[] = [];
  const where = ctx.side ? ` on Side ${ctx.side}` : '';
  const bgLum = luminance(ctx.background);
  if (st.opaqueBox) {
    out.push({ code: 'opaque-background', severity: 'warning', message: `The logo is a rectangle with an opaque ${st.boxColor} background, so it prints as a box${where}. Remove the background for a clean placement.`, suggestions: ['remove-background'] });
  }
  if (st.inkRatio < 0.002) out.push({ code: 'faint-ink', severity: 'warning', message: 'Almost nothing visible was found in the logo (it may be blank or extremely thin).', suggestions: [] });
  else if (st.transparentRatio > 0.985) out.push({ code: 'mostly-transparent', severity: 'info', message: 'The logo is almost entirely transparent; check that it is not a faint or empty file.', suggestions: [] });
  // contrast of the ink against the background it will be printed on (a box logo is judged by its box)
  const fg = st.opaqueBox && st.boxColor ? st.boxColor : st.inkColor;
  const cr = contrastRatio(fg, ctx.background);
  {
    if (cr < 3) {
      const dark = luminance(fg) < 0.15 && bgLum < 0.15;
      const light = luminance(fg) > 0.6 && bgLum > 0.6;
      const code: LogoIssueCode = dark ? 'dark-on-dark' : light ? 'light-on-light' : 'low-contrast';
      const what = dark ? 'A dark logo on a dark background' : light ? 'A light logo on a light background' : 'The logo has poor contrast against the background';
      out.push({
        code, severity: 'warning',
        message: `${what}${where} (contrast ${cr.toFixed(1)}:1, aim for 3:1 or more). The original file is kept; try a recoloured copy.`,
        suggestions: bgLum < 0.4 ? ['recolor-light'] : ['recolor-dark'],
      });
    }
  }
  const dpi = effectiveDpi(st.width, ctx.printWidthMm);
  if (dpi < 200) out.push({ code: 'low-resolution', severity: 'warning', message: `The logo is only ${Math.round(dpi)} dpi at its printed width of ${ctx.printWidthMm.toFixed(1)} mm (about 300 dpi is recommended). It may look soft or pixelated; use a larger file.`, suggestions: [] });
  else if (dpi < 300) out.push({ code: 'low-resolution', severity: 'info', message: `The logo is ${Math.round(dpi)} dpi at ${ctx.printWidthMm.toFixed(1)} mm wide (300 dpi recommended).`, suggestions: [] });
  return out;
}

// ---------- treatments (return new pixel buffers) ----------

/** Solid recolour: keeps the alpha channel and the shape, replaces the colour. */
export function recolorPixels(rgba: Uint8ClampedArray | Uint8Array, hex: string): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const [r, g, b] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  for (let i = 0; i < rgba.length; i += 4) { out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = rgba[i + 3]; }
  return out;
}

/**
 * Removes a uniform background by flood-filling inwards from the image edges (pixels within `tolerance` of the corner
 * colour become transparent, with a soft edge). Interior areas of the same colour that are enclosed by the logo are kept.
 */
export function removeBackgroundPixels(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, tolerance = 28): { data: Uint8ClampedArray; removedRatio: number } {
  const data = new Uint8ClampedArray(rgba);
  const at = (x: number, y: number) => (y * width + x) * 4;
  const c0 = [rgba[0], rgba[1], rgba[2]];
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number) => { if (x < 0 || y < 0 || x >= width || y >= height) return; const k = y * width + x; if (seen[k]) return; seen[k] = 1; stack.push(k); };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  let removed = 0;
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % width, y = (k - x) / width;
    const o = at(x, y);
    if (!(rgba[o + 3] < 26 || near([rgba[o], rgba[o + 1], rgba[o + 2]], c0, tolerance))) continue;
    data[o + 3] = 0; removed++;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  // soften the edge: pixels next to removed ones lose a little alpha so no coloured halo remains
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const o = at(x, y);
    if (data[o + 3] === 0) continue;
    if (data[at(x + 1, y) + 3] === 0 || data[at(x - 1, y) + 3] === 0 || data[at(x, y + 1) + 3] === 0 || data[at(x, y - 1) + 3] === 0) {
      const d = Math.abs(rgba[o] - c0[0]) + Math.abs(rgba[o + 1] - c0[1]) + Math.abs(rgba[o + 2] - c0[2]);
      if (d < tolerance * 4) data[o + 3] = Math.round(data[o + 3] * Math.min(1, d / (tolerance * 4)));
    }
  }
  return { data, removedRatio: removed / (width * height) };
}
