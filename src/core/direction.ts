/**
 * Art direction: the structured result of the local suggestion engine (src/core/suggest.ts), built from the artist's logo, typography reference,
 * album artwork, style reference, names and tracklists. This module validates it (no input is trusted),
 * and applies it to a design as a *starting point*: all of it stays editable and undoable.
 * It can only set style values; it has no access to template geometry.
 */
import { contrastRatio, hexToRgb } from './color';
import { type FontRef } from './fonts';
import { PRESETS } from './presets';
import { defaultCrop, type Align, type Design, type OrnamentKind, type Rect01, type SideBVariant, type Style, type TextCase } from './model';

export interface ArtDirection {
  concept: { name: string; summary: string };
  basePreset: string; // a preset id or 'custom'
  palette: { background: string; text: string; accent: string; secondary: string };
  typography: {
    headingFont: FontRef; bodyFont: FontRef; titleCase: TextCase; trackCase: TextCase; titleBold: boolean; bodyBold: boolean;
    titleTracking: number; bodyTracking: number; titleSizePt: number; trackSizePt: number; metaSizePt: number; lineHeight: number; textAlign: Align;
  };
  composition: {
    layoutMode: 'auto' | 'separated' | 'minimal'; headerEmphasis: 'album' | 'artist' | 'balanced';
    ornament: OrnamentKind; ornamentOpacity: number; ornamentColor: 'accent' | 'text' | 'secondary'; textScrim: number; sideBVariant: SideBVariant;
  };
  artwork: { use: 'A' | 'B' | 'both' | 'none'; opacity: number; zoom: number; cx: number; cy: number; focal: Rect01 | null; secondaryFocals: Rect01[] };
  /** Suggested handling of the artist logo against this direction's palette. The original upload is never altered. */
  logo: { treatment: 'keep' | 'lighten' | 'darken' | 'remove-background'; reason: string };
  hierarchy: string[];
  rationale: string;
  risks: string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown, lo: number, hi: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fb);
const hex = (v: unknown, fb: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fb);
const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map((x) => x.slice(0, max)) : []);

/** Validate and clamp every value of a direction. Fonts must be one of the available refs. */
export function sanitizeDirection(raw: any, allowedFonts: FontRef[]): ArtDirection {
  const t = raw?.typography ?? {};
  const c = raw?.composition ?? {};
  const a = raw?.artwork ?? {};
  const p = raw?.palette ?? {};
  const font = (v: unknown, fb: FontRef): FontRef => (typeof v === 'string' && allowedFonts.includes(v) ? v : fb);
  const f = a.focal;
  const rect = (v: any): Rect01 | null => {
    if (!v || ![v.x, v.y, v.w, v.h].every((q: unknown) => typeof q === 'number' && Number.isFinite(q))) return null;
    const r = { x: num(v.x, 0, 1, 0), y: num(v.y, 0, 1, 0), w: num(v.w, 0.05, 1, 0.3), h: num(v.h, 0.05, 1, 0.3) };
    r.w = Math.min(r.w, 1 - r.x); r.h = Math.min(r.h, 1 - r.y);
    return r.w >= 0.02 && r.h >= 0.02 ? r : null;
  };
  const secondaryFocals = (Array.isArray(a.secondaryFocals) ? a.secondaryFocals : []).map(rect).filter((r: Rect01 | null): r is Rect01 => !!r).slice(0, 2);
  const focal: Rect01 | null = f && [f.x, f.y, f.w, f.h].every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
    ? { x: num(f.x, 0, 1, 0), y: num(f.y, 0, 1, 0), w: num(f.w, 0.05, 1, 0.3), h: num(f.h, 0.05, 1, 0.3) } : null;
  if (focal) { focal.w = Math.min(focal.w, 1 - focal.x); focal.h = Math.min(focal.h, 1 - focal.y); }
  const basePreset = typeof raw?.basePreset === 'string' && PRESETS.some((x) => x.id === raw.basePreset) ? raw.basePreset : 'custom';
  return {
    concept: { name: str(raw?.concept?.name, 60) || 'Untitled direction', summary: str(raw?.concept?.summary, 400) },
    basePreset,
    palette: { background: hex(p.background, '#f4efe4'), text: hex(p.text, '#111111'), accent: hex(p.accent, '#c0392b'), secondary: hex(p.secondary, '#7a6f5d') },
    typography: {
      headingFont: font(t.headingFont, 'sans'), bodyFont: font(t.bodyFont, 'sans'),
      titleCase: pick(t.titleCase, ['none', 'upper', 'lower'] as const, 'none'), trackCase: pick(t.trackCase, ['none', 'upper', 'lower'] as const, 'none'),
      titleBold: bool(t.titleBold, true), bodyBold: bool(t.bodyBold, false),
      titleTracking: num(t.titleTracking, -0.05, 0.4, 0), bodyTracking: num(t.bodyTracking, -0.03, 0.2, 0),
      titleSizePt: num(t.titleSizePt, 6, 16, 9), trackSizePt: num(t.trackSizePt, 4.5, 9, 6.5), metaSizePt: num(t.metaSizePt, 4.5, 8, 5.5),
      lineHeight: num(t.lineHeight, 1, 1.6, 1.2), textAlign: pick(t.textAlign, ['left', 'center', 'right'] as const, 'left'),
    },
    composition: {
      layoutMode: pick(c.layoutMode, ['auto', 'separated', 'minimal'] as const, 'auto'),
      headerEmphasis: pick(c.headerEmphasis, ['album', 'artist', 'balanced'] as const, 'album'),
      ornament: pick(c.ornament, ['none', 'frame', 'rules', 'stripes', 'grid', 'dots', 'scanlines'] as const, 'none'),
      ornamentOpacity: num(c.ornamentOpacity, 0.1, 1, 0.6), ornamentColor: pick(c.ornamentColor, ['accent', 'text', 'secondary'] as const, 'accent'),
      textScrim: num(c.textScrim, 0, 0.8, 0), sideBVariant: pick(c.sideBVariant, ['matched', 'inverted', 'tinted'] as const, 'matched'),
    },
    artwork: { use: pick(a.use, ['A', 'B', 'both', 'none'] as const, 'none'), opacity: num(a.opacity, 0.1, 1, 0.8), zoom: num(a.zoom, 1, 3, 1), cx: num(a.cx, 0, 1, 0.5), cy: num(a.cy, 0, 1, 0.5), focal, secondaryFocals },
    logo: { treatment: pick(raw?.logo?.treatment, ['keep', 'lighten', 'darken', 'remove-background'] as const, 'keep'), reason: str(raw?.logo?.reason, 300) },
    hierarchy: list(raw?.hierarchy, 8, 60),
    rationale: str(raw?.rationale, 1200),
    risks: list(raw?.risks, 5, 200),
  };
}

/** Make sure text is readable on the chosen background; flips to a readable colour instead of trusting the input. */
function ensureReadable(bg: string, text: string): string {
  const lum = (h: string) => { const [r, g, b] = hexToRgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [hi, lo] = [lum(bg), lum(text)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05) >= 4 ? text : lum(bg) > 0.4 ? '#111111' : '#f4f4f0';
}

export interface ApplyContext {
  artworkAssetId?: string | null;
  /** Keep the user's manual work (positions, track groups, locks, per-side typography and colours) when applying. */
  keepManual?: boolean;
}

/** Applies a direction to a design (a new Design object; the caller commits it to history). */
export function applyDirection(d: Design, dir: ArtDirection, ctx: ApplyContext = {}): Design {
  const { palette: pal, typography: ty, composition: co, artwork: aw } = dir;
  const keep = !!ctx.keepManual;
  const wasManual = keep && d.style.layoutMode === 'manual';
  const style: Style = {
    ...d.style,
    backgroundColor: pal.background, textColor: ensureReadable(pal.background, pal.text), accentColor: pal.accent, secondaryColor: pal.secondary,
    headingFont: ty.headingFont, bodyFont: ty.bodyFont, font: ty.bodyFont,
    titleCase: ty.titleCase, trackCase: ty.trackCase, titleBold: ty.titleBold, bodyBold: ty.bodyBold, titleTracking: ty.titleTracking, bodyTracking: ty.bodyTracking,
    titleSizePt: ty.titleSizePt, trackSizePt: ty.trackSizePt, metaSizePt: ty.metaSizePt, lineHeight: ty.lineHeight, textAlign: ty.textAlign,
    layoutMode: wasManual ? 'manual' : co.layoutMode, headerEmphasis: co.headerEmphasis, ornament: { kind: co.ornament, opacity: co.ornamentOpacity, color: co.ornamentColor },
    textScrim: co.textScrim, sideBVariant: co.sideBVariant, shrinkToFit: true,
  };
  const sides = { A: { ...d.sides.A, ...(keep ? {} : { typo: {} }) }, B: { ...d.sides.B, ...(keep ? {} : { typo: {} }) } };
  const art = ctx.artworkAssetId ?? null;
  for (const sd of ['A', 'B'] as const) {
    const on = art && (aw.use === 'both' || aw.use === sd);
    sides[sd] = {
      ...sides[sd],
      backgroundColor: keep ? sides[sd].backgroundColor : null,
      backgroundAssetId: on ? art : aw.use === 'none' ? null : sides[sd].backgroundAssetId,
      bgOpacity: on ? aw.opacity : null,
      bgCrop: on ? { zoom: aw.zoom, cx: aw.cx, cy: aw.cy } : defaultCrop,
      bgFocal: on ? aw.focal : null,
      bgFocalMore: on ? aw.secondaryFocals : [],
    };
  }
  return {
    ...d, style, sides,
    presetId: dir.basePreset === 'custom' ? 'custom-reference' : dir.basePreset,
    manual: keep ? d.manual : { A: {}, B: {} },
    trackGroups: keep ? d.trackGroups : { A: [], B: [] },
    locked: keep ? d.locked : { A: {}, B: {} },
  };
}

// ---------- variations ----------

/** How different two directions are, 0 (identical) to 1 (nothing in common). Used to make sure variations are genuinely distinct. */
export function directionDistance(a: ArtDirection, b: ArtDirection): number {
  const colour = (x: string, y: string) => { const p = hexToRgb(x), q = hexToRgb(y); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 441; };
  const pal = (colour(a.palette.background, b.palette.background) * 0.5 + colour(a.palette.accent, b.palette.accent) * 0.3 + colour(a.palette.text, b.palette.text) * 0.2);
  let d = 0;
  d += a.typography.headingFont !== b.typography.headingFont ? 0.2 : 0;
  d += a.typography.bodyFont !== b.typography.bodyFont ? 0.1 : 0;
  d += a.typography.titleCase !== b.typography.titleCase ? 0.05 : 0;
  d += Math.min(0.05, Math.abs(a.typography.titleTracking - b.typography.titleTracking) / 2);
  d += a.composition.ornament !== b.composition.ornament ? 0.15 : 0;
  d += a.composition.layoutMode !== b.composition.layoutMode ? 0.05 : 0;
  d += a.composition.headerEmphasis !== b.composition.headerEmphasis ? 0.05 : 0;
  d += a.composition.sideBVariant !== b.composition.sideBVariant ? 0.05 : 0;
  d += Math.min(0.1, Math.abs(a.typography.titleSizePt - b.typography.titleSizePt) / 20);
  d += pal * 0.3;
  return Math.min(1, d);
}

export const MIN_VARIATION_DISTANCE = 0.3;

/** Short, prompt-friendly description of a direction (used to ask for something different from it). */
export function directionSummary(dir: ArtDirection): string {
  const t = dir.typography, c = dir.composition;
  return `"${dir.concept.name}": background ${dir.palette.background}, accent ${dir.palette.accent}, ${t.headingFont} + ${t.bodyFont}, ${t.titleCase} titles, ornament ${c.ornament}, side B ${c.sideBVariant}`;
}

/** Readability of a direction's own palette (text on background); a direction that fails this is flagged to the user. */
export const directionContrast = (dir: ArtDirection) => contrastRatio(dir.palette.text, dir.palette.background);
