/**
 * Template library. All geometry is the ORIGINAL vector path data extracted from the supplied source PDFs
 * (scripts/extract_templates.py) and stored in millimetres. Nothing here is redrawn or approximated.
 *
 * Local frame: origin = top-left of the source's bleed frame (or of the cut path when the source has no
 * bleed frame), +y down. The app never scales, edits or replaces these paths.
 */
import library from '../templates/library.json';

export interface Rect { x: number; y: number; w: number; h: number }
export interface PathShape { d: string; bbox: Rect }
export interface SafetyShape extends PathShape { kind: 'line' | 'closed'; dashed: boolean }
export type InnerBehavior = 'cutout' | 'cover-art' | 'cut-path' | 'unspecified';
export interface InnerShape extends PathShape { id: string; kind: 'circle' | 'oval'; behavior: InnerBehavior; wording: string }
export interface SheetSpec {
  file: string;
  paperMm: { w: number; h: number };
  /** Absolute page position (mm) of each slot's local-frame origin. */
  slots: { x: number; y: number }[];
  slotCount: number;
}
export type Verification = 'source-vector' | 'unverified-raster-only';

export interface LibraryTemplate {
  id: string;
  name: string;
  family: string;
  verification: Verification;
  verificationNote: string;
  sourceFiles: string[];
  /** The vendor's 1-up page (mm), when the source ships one. */
  artboardMm: { w: number; h: number } | null;
  /** Where the local frame's origin sits on that 1-up page. */
  frameOrigin: { x: number; y: number } | null;
  frame: { w: number; h: number } | null;
  cut: PathShape | null;
  bleed: PathShape | null;
  safety: SafetyShape[];
  inner: InnerShape[];
  instructions: string[];
  sheet: SheetSpec | null;
  innerBehavior?: InnerBehavior;
  innerBehaviorNote?: string;
  rasterPixels?: { w: number; h: number };
  rasterDpi?: number;
}

export const TEMPLATES = library as unknown as LibraryTemplate[];

export const getTemplate = (id: string | null | undefined) => TEMPLATES.find((t) => t.id === id) ?? null;

/** A template is usable only when its source contains real vector geometry. */
export const isUsable = (t: LibraryTemplate): t is LibraryTemplate & { cut: PathShape; frame: { w: number; h: number } } =>
  t.verification === 'source-vector' && !!t.cut && !!t.frame;

export const BEHAVIOR_LABEL: Record<InnerBehavior, string> = {
  cutout: 'Cutout (hole): removed from the artwork and cut',
  'cover-art': 'Artwork-covered region (not a hole)',
  'cut-path': 'Cut path (preserved as a cut line)',
  unspecified: 'Not specified by the source (outline guide only)',
};

// ---------- geometry derived from the source shapes ----------

const contains = (a: Rect, b: Rect) => b.x >= a.x - 0.01 && b.y >= a.y - 0.01 && b.x + b.w <= a.x + a.w + 0.01 && b.y + b.h <= a.y + a.h + 0.01;
const union = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Keep-out areas: the source's blue safety shape wrapped around each inner shape (or the inner shape itself). */
export function keepOuts(t: LibraryTemplate): Rect[] {
  return t.inner.map((i) => {
    const wraps = t.safety.filter((s) => s.kind === 'closed' && contains(s.bbox, i.bbox) && s.bbox.w * s.bbox.h < (t.cut!.bbox.w * t.cut!.bbox.h));
    wraps.sort((a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h);
    return wraps[0]?.bbox ?? i.bbox;
  });
}

/** Safe area for text/logos: bounding box of the blue safety guides that are not keep-outs; the cut bbox if none. */
export function safeRect(t: LibraryTemplate): Rect {
  const ko = keepOuts(t);
  const outer = t.safety.filter((s) => !ko.some((k) => Math.abs(k.x - s.bbox.x) < 0.01 && Math.abs(k.w - s.bbox.w) < 0.01 && Math.abs(k.y - s.bbox.y) < 0.01));
  return outer.length ? union(outer.map((s) => s.bbox)) : t.cut!.bbox;
}

export interface Region extends Rect { name: string }

/** Rectangular free regions inside the safe area around the keep-outs: top band, bottom band, side panes. */
export function textRegions(t: LibraryTemplate): Region[] {
  const S = safeRect(t);
  const K = keepOuts(t).map((k) => ({ ...k })).sort((a, b) => a.x - b.x);
  if (!K.length) return [{ name: 'safe area', ...S }];
  const ky0 = Math.max(S.y, Math.min(...K.map((k) => k.y)));
  const ky1 = Math.min(S.y + S.h, Math.max(...K.map((k) => k.y + k.h)));
  const out: Region[] = [
    { name: 'top band', x: S.x, y: S.y, w: S.w, h: ky0 - S.y },
    { name: 'bottom band', x: S.x, y: ky1, w: S.w, h: S.y + S.h - ky1 },
  ];
  let cursor = S.x;
  K.forEach((k, i) => {
    out.push({ name: i === 0 ? 'left pane' : 'middle pane', x: cursor, y: ky0, w: k.x - cursor, h: ky1 - ky0 });
    cursor = k.x + k.w;
  });
  out.push({ name: 'right pane', x: cursor, y: ky0, w: S.x + S.w - cursor, h: ky1 - ky0 });
  return out.filter((r) => r.w >= 4 && r.h >= 3);
}

/** Clip path for artwork: the source bleed frame (or cut path), with cutout shapes removed (even-odd). */
export function artClipPath(t: LibraryTemplate): string {
  const outer = (t.bleed ?? t.cut!).d;
  return outer + t.inner.filter((i) => i.behavior === 'cutout').map((i) => i.d).join('');
}

/** Everything the blade follows: outer cut path plus every inner cut shape from the source. */
export function cutOverlayPath(t: LibraryTemplate): string {
  return t.cut!.d + t.inner.filter((i) => i.behavior !== 'unspecified').map((i) => i.d).join('');
}

export function hasCutoutBehavior(t: LibraryTemplate) { return t.inner.some((i) => i.behavior === 'cutout'); }

export const GUIDE_COLORS = { cut: '#ed1c24', bleed: '#231f20', safety: '#00aeef' };
