/** Design data model: release metadata, assets, per-side content and style. No physical geometry lives here. */
import type { FontRef, UploadedFont } from './fonts';

export type FontKey = FontRef; // kept for older call sites
export type Align = 'left' | 'center' | 'right';
export type LayoutMode = 'auto' | 'separated' | 'minimal' | 'manual';
export type PaperKey = 'A4' | 'Letter';
export type ExportMode = 'desktop' | 'single' | 'sheet';
export type SheetFill = 'pairs' | 'A' | 'B';
export type Side = 'A' | 'B';
export type TextCase = 'none' | 'upper' | 'lower';
export type OrnamentKind = 'none' | 'frame' | 'rules' | 'stripes' | 'grid' | 'dots' | 'scanlines';
export type SideBVariant = 'matched' | 'inverted' | 'tinted';
export type BlockId = 'logo' | 'wordmark' | 'title' | 'artist' | 'meta' | 'heading' | 'tracks' | 'tracks2' | 'tracks3' | 'tracks4';
export const BLOCK_IDS: BlockId[] = ['logo', 'wordmark', 'title', 'artist', 'meta', 'heading', 'tracks', 'tracks2', 'tracks3', 'tracks4'];
export const TRACK_BLOCKS: BlockId[] = ['tracks', 'tracks2', 'tracks3', 'tracks4'];

export interface Release {
  title: string;
  artist: string;
  catalogNumber: string;
  year: string; // optional, may be empty
}

export interface Asset {
  id: string;
  kind: 'logo' | 'wordmark' | 'art' | 'reference';
  name: string;
  /** PNG or JPEG data URL (uploads are normalised in the browser). */
  dataUrl: string;
  width: number;
  height: number;
  /** Set on assets created from another asset (recoloured / background removed). The original is never modified. */
  derivedFrom?: string;
  treatment?: string;
}

/** Normalised (0..1) rectangle inside an image. */
export interface Rect01 { x: number; y: number; w: number; h: number }
export interface Crop { zoom: number; cx: number; cy: number }

/** Typography settings that can be overridden per side. */
export interface Typography {
  font: FontRef;
  headingFont: FontRef | null; // null = use `font`
  bodyFont: FontRef | null;
  titleSizePt: number;
  trackSizePt: number;
  metaSizePt: number;
  lineHeight: number;
  trackSpacingMm: number;
  textAlign: Align;
  titleBold: boolean;
  bodyBold: boolean;
  titleCase: TextCase;
  trackCase: TextCase;
  titleTracking: number; // em
  bodyTracking: number; // em
}
export const TYPO_KEYS: (keyof Typography)[] = ['font', 'headingFont', 'bodyFont', 'titleSizePt', 'trackSizePt', 'metaSizePt', 'lineHeight', 'trackSpacingMm', 'textAlign', 'titleBold', 'bodyBold', 'titleCase', 'trackCase', 'titleTracking', 'bodyTracking'];

export interface SideContent {
  /** Heading printed on the label, e.g. "SIDE A". */
  heading: string;
  /** One track per line. Optional duration after a tab or " | ", e.g. "Opening Theme | 3:45". */
  tracksText: string;
  /** Per-side artwork, so Side A and Side B can differ. */
  backgroundAssetId: string | null;
  backgroundColor: string | null; // null = use the shared (or variant) colour
  /** Artwork opacity for this side; null = use the shared style value. */
  bgOpacity: number | null;
  bgCrop: Crop;
  /** Important area of the artwork (normalised image coordinates). Text is kept out of it. */
  bgFocal: Rect01 | null;
  /** Additional important areas (up to two more) kept free of text. */
  bgFocalMore: Rect01[];
  /** Logo used on this side; null = the shared logo. Lets Side B use a lighter or darker version. */
  logoAssetId: string | null;
  /** Independent typography for this side; only the keys present override the shared style. */
  typo: Partial<Typography>;
  /** Album title / artist printed on this side only; empty or missing = the shared release value. */
  title?: string;
  artist?: string;
}

/** The release as printed on one side: shared title and artist unless that side has its own. */
export const releaseOf = (d: Design, side: Side) => ({ ...d.release, title: d.sides[side].title?.trim() || d.release.title, artist: d.sides[side].artist?.trim() || d.release.artist });

export interface ManualPos { x: number; y: number; w: number }

export interface Ornament { kind: OrnamentKind; opacity: number; color: 'accent' | 'text' | 'secondary' }

export interface Style extends Typography {
  layoutMode: LayoutMode;
  showDurations: boolean;
  showTrackNumbers: boolean;
  shrinkToFit: boolean;
  /** Text is never scaled below this size by shrink-to-fit; below it a warning is raised. */
  minLegiblePt: number;

  textColor: string;
  accentColor: string;
  secondaryColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  /** Opacity of a backing plate behind text when it sits over artwork (0 = none). */
  textScrim: number;
  ornament: Ornament;
  sideBVariant: SideBVariant;
  /** Which of album / artist leads the header. */
  headerEmphasis: 'album' | 'artist' | 'balanced';

  logoAssetId: string | null;
  logoHeightMm: number;
  wordmarkAssetId: string | null; // uploaded lettering / typography logo (image)
  wordmarkHeightMm: number;
  wordmarkText: string; // font-based wordmark, used when no wordmark image is chosen
  wordmarkSizePt: number;
}

export interface ExportOptions {
  mode: ExportMode;
  paper: PaperKey;
  sheetFill: SheetFill;
  showCut: boolean;
  showBleedGuide: boolean;
  showSafetyGuide: boolean;
  /** Append a paper-size page with the 10 mm calibration square (single/sheet modes). */
  calibrationPage: boolean;
}

export interface Design {
  release: Release;
  assets: Asset[];
  fonts: UploadedFont[];
  sides: Record<Side, SideContent>;
  style: Style;
  templateId: string | null;
  manual: Record<Side, Partial<Record<BlockId, ManualPos>>>;
  /** How many tracks each manual track block holds (set when manual mode is seeded from the planner). */
  trackGroups: Record<Side, number[]>;
  locked: Record<Side, Partial<Record<BlockId, boolean>>>;
  presetId: string | null;
  exportOpts: ExportOptions;
}

export interface Track { number: number; title: string; duration: string }

export const defaultCrop: Crop = { zoom: 1, cx: 0.5, cy: 0.5 };

export const defaultStyle: Style = {
  font: 'sans',
  headingFont: null,
  bodyFont: null,
  titleSizePt: 9,
  trackSizePt: 6.5,
  metaSizePt: 5.5,
  lineHeight: 1.2,
  trackSpacingMm: 0.2,
  textAlign: 'left',
  titleBold: true,
  bodyBold: false,
  titleCase: 'none',
  trackCase: 'none',
  titleTracking: 0,
  bodyTracking: 0,
  layoutMode: 'auto',
  showDurations: true,
  showTrackNumbers: true,
  shrinkToFit: true,
  minLegiblePt: 5,
  textColor: '#111111',
  accentColor: '#c0392b',
  secondaryColor: '#7a6f5d',
  backgroundColor: '#f4efe4',
  backgroundOpacity: 1,
  textScrim: 0,
  ornament: { kind: 'none', opacity: 0.5, color: 'accent' },
  sideBVariant: 'matched',
  headerEmphasis: 'album',
  logoAssetId: null,
  logoHeightMm: 8,
  wordmarkAssetId: null,
  wordmarkHeightMm: 6,
  wordmarkText: '',
  wordmarkSizePt: 12,
};

export const defaultSide = (heading: string, tracksText: string): SideContent => ({
  heading, tracksText, backgroundAssetId: null, backgroundColor: null, bgOpacity: null, bgCrop: defaultCrop, bgFocal: null, bgFocalMore: [], logoAssetId: null, typo: {},
});

export const defaultDesign: Design = {
  release: { title: 'Example Album', artist: 'Example Artist', catalogNumber: 'EX-001', year: '' },
  assets: [],
  fonts: [],
  sides: {
    A: defaultSide('SIDE A', 'Opening Theme | 3:45\nSecond Song | 4:02\nThird Song | 2:58\nFourth Song | 5:10'),
    B: defaultSide('SIDE B', 'Flip Side | 3:30\nAnother One | 4:12\nSlow Closer | 6:01'),
  },
  style: defaultStyle,
  templateId: null,
  manual: { A: {}, B: {} },
  trackGroups: { A: [], B: [] },
  locked: { A: {}, B: {} },
  presetId: null,
  exportOpts: { mode: 'desktop', paper: 'A4', sheetFill: 'pairs', showCut: true, showBleedGuide: false, showSafetyGuide: false, calibrationPage: true },
};

/** Parse "Title | 3:45" / "Title<TAB>3:45" lines. Blank lines are skipped. */
export function parseTracks(text: string): Track[] {
  const out: Track[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)(?:\s*\|\s*|\t+)([0-9]{1,3}:[0-5][0-9](?::[0-5][0-9])?)\s*$/);
    out.push({ number: out.length + 1, title: (m ? m[1] : line).trim(), duration: m ? m[2] : '' });
  }
  return out;
}

export const PT_TO_MM = 25.4 / 72;

export function assetById(d: Design, id: string | null): Asset | undefined {
  return id ? d.assets.find((a) => a.id === id) : undefined;
}
