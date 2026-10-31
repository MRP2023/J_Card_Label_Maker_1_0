/**
 * Automatic design suggestions: a fully local, rule-based design engine. No network, no API key, no external service.
 *
 * It measures your references (colour, brightness, warmth, contrast, busyness, subject position, logo condition) and applies
 * explicit design rules for three different schools of design to produce complete, validated design directions. The same
 * inputs always give the same suggestions. Every suggestion is a starting point that stays editable and undoable.
 *
 * What it cannot do (compared with a human or an AI art director): understand what an image depicts, read lettering from a
 * typography reference, or reason about the artist's genre or story. It measures pixels and applies rules.
 */
import type { ImageFeatures } from './art';
import { contrastRatio, hexToHsl, hsl, readableOn } from './color';
import { MIN_VARIATION_DISTANCE, directionDistance, sanitizeDirection, type ArtDirection } from './direction';
import { listFamilies, type FontRef } from './fonts';
import { logoIssues, type LogoStats } from './logo';
import type { OrnamentKind, Rect01, SideBVariant, TextCase } from './model';

export interface SuggestInput {
  release: { title: string; artist: string };
  tracks: { A: number; B: number };
  /** Features of the album artwork (first one used for cropping and focal areas). */
  art: ImageFeatures | null;
  /** Features of style references; they influence mood and palette together with the artwork. */
  refs: ImageFeatures[];
  /** Logo pixel statistics and its aspect ratio, for the logo recommendation. */
  logo: { stats: LogoStats; aspect: number; heightMm: number } | null;
  /** Fonts the design may use; anything else falls back to Helvetica. Defaults to every built-in and studio font. */
  available?: FontRef[];
}

interface Alt {
  name: string;
  heading: FontRef; body: FontRef;
  titleCase: TextCase; trackCase: TextCase; titleBold: boolean; bodyBold: boolean;
  titleTracking: number; bodyTracking: number;
  titleSize: number; trackSize: number; metaSize: number; lineHeight: number;
  ornament: OrnamentKind; ornamentOpacity: number; ornamentColor: 'accent' | 'text' | 'secondary';
  sideB: SideBVariant; emphasis: 'album' | 'artist' | 'balanced';
  concept: string;
}

interface School { id: string; name: string; basePreset: string; hierarchy: string[]; alts: Alt[] }

export const SCHOOLS: School[] = [
  {
    id: 'minimal-editorial', name: 'Minimal editorial', basePreset: 'modern-editorial', hierarchy: ['album title', 'artist', 'tracks'],
    alts: [
      { name: 'Quiet Pages', concept: 'Paper, a high-contrast serif title and a single restrained accent, with hairline rules.', heading: 'studio:dmserif', body: 'sans', titleCase: 'none', trackCase: 'none', titleBold: false, bodyBold: false, titleTracking: 0, bodyTracking: 0.02, titleSize: 11, trackSize: 6.5, metaSize: 5.5, lineHeight: 1.25, ornament: 'rules', ornamentOpacity: 0.8, ornamentColor: 'accent', sideB: 'matched', emphasis: 'album' },
      { name: 'Paper & Ink', concept: 'A calm all-sans system: lowercase titles, generous spacing and a thin keyline frame.', heading: 'sans', body: 'sans', titleCase: 'lower', trackCase: 'none', titleBold: true, bodyBold: false, titleTracking: 0.04, bodyTracking: 0.03, titleSize: 9.5, trackSize: 6.3, metaSize: 5.2, lineHeight: 1.3, ornament: 'frame', ornamentOpacity: 0.7, ornamentColor: 'text', sideB: 'matched', emphasis: 'artist' },
      { name: 'Monograph', concept: 'Serif title over typewriter-clean body, no decoration beyond one rule, almost monochrome.', heading: 'studio:dmserif', body: 'mono', titleCase: 'none', trackCase: 'none', titleBold: false, bodyBold: false, titleTracking: 0.01, bodyTracking: 0, titleSize: 10.5, trackSize: 6, metaSize: 5, lineHeight: 1.25, ornament: 'rules', ornamentOpacity: 0.9, ornamentColor: 'text', sideB: 'inverted', emphasis: 'balanced' },
    ],
  },
  {
    id: 'vintage-analog-underground', name: 'Vintage analog underground', basePreset: 'vintage-80s', hierarchy: ['artist', 'album title', 'tracks'],
    alts: [
      { name: 'Dubbed Tape', concept: 'Typewriter capitals on tape-stock paper with a three-colour stripe, like a dubbed demo.', heading: 'studio:specialelite', body: 'studio:specialelite', titleCase: 'upper', trackCase: 'upper', titleBold: false, bodyBold: false, titleTracking: 0.12, bodyTracking: 0.05, titleSize: 9, trackSize: 6, metaSize: 5, lineHeight: 1.2, ornament: 'stripes', ornamentOpacity: 1, ornamentColor: 'accent', sideB: 'tinted', emphasis: 'artist' },
      { name: 'Back-Room Bootleg', concept: 'A rounded retro display face over plain body text, with a dotted screen like a photocopied insert.', heading: 'studio:righteous', body: 'sans', titleCase: 'upper', trackCase: 'none', titleBold: false, bodyBold: false, titleTracking: 0.06, bodyTracking: 0.02, titleSize: 10, trackSize: 6.3, metaSize: 5.3, lineHeight: 1.2, ornament: 'dots', ornamentOpacity: 0.7, ornamentColor: 'secondary', sideB: 'tinted', emphasis: 'album' },
      { name: 'Pressing Plant', concept: 'Heavy grotesque capitals and a typewriter body inside a keyline frame, like a 1990s pressing-plant label.', heading: 'studio:archivoblack', body: 'mono', titleCase: 'upper', trackCase: 'none', titleBold: false, bodyBold: false, titleTracking: 0.03, bodyTracking: 0, titleSize: 9, trackSize: 6, metaSize: 5, lineHeight: 1.2, ornament: 'frame', ornamentOpacity: 0.8, ornamentColor: 'text', sideB: 'matched', emphasis: 'artist' },
    ],
  },
  {
    id: 'experimental-contemporary', name: 'Experimental contemporary', basePreset: 'experimental-electronic', hierarchy: ['tracks', 'album title', 'artist'],
    alts: [
      { name: 'Signal Noise', concept: 'A dark field, condensed lowercase titles over monospaced tracks, a faint grid, and an inverted flip side.', heading: 'studio:bebas', body: 'studio:spacemono', titleCase: 'lower', trackCase: 'none', titleBold: false, bodyBold: false, titleTracking: 0.2, bodyTracking: 0.02, titleSize: 11, trackSize: 6, metaSize: 5, lineHeight: 1.2, ornament: 'grid', ornamentOpacity: 0.8, ornamentColor: 'accent', sideB: 'inverted', emphasis: 'album' },
      { name: 'Dead Channel', concept: 'All monospace, scanlines and an electric accent, like a terminal readout.', heading: 'studio:spacemono', body: 'studio:spacemono', titleCase: 'lower', trackCase: 'none', titleBold: true, bodyBold: false, titleTracking: 0.02, bodyTracking: 0.02, titleSize: 8.5, trackSize: 6, metaSize: 5, lineHeight: 1.2, ornament: 'scanlines', ornamentOpacity: 0.8, ornamentColor: 'accent', sideB: 'inverted', emphasis: 'artist' },
      { name: 'Grid Lock', concept: 'A heavy display title, uppercase mono tracks and hazard-style edge stripes on a black field.', heading: 'studio:archivoblack', body: 'studio:spacemono', titleCase: 'upper', trackCase: 'upper', titleBold: false, bodyBold: false, titleTracking: 0.04, bodyTracking: 0.03, titleSize: 9, trackSize: 6, metaSize: 5, lineHeight: 1.2, ornament: 'stripes', ornamentOpacity: 1, ornamentColor: 'accent', sideB: 'tinted', emphasis: 'album' },
    ],
  },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const avg = (xs: number[], fb = 0) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fb);

interface Mood { hue: number; sat: number; luminance: number; warmth: number; contrast: number; busyness: number; hasImages: boolean }

/** Collapses the artwork and style references into one description of the mood to design for. */
export function moodOf(input: SuggestInput): Mood {
  const all = [...(input.art ? [input.art] : []), ...input.refs];
  if (!all.length) return { hue: 20, sat: 0.4, luminance: 0.6, warmth: 0.2, contrast: 0.4, busyness: 0.2, hasImages: false };
  const lead = input.art ?? input.refs[0];
  const [h, s] = hexToHsl(lead.palette.accent);
  const [bh, bs] = hexToHsl(lead.palette.background);
  return {
    hue: s > 0.15 ? h : bs > 0.1 ? bh : 20,
    sat: avg(all.map((f) => f.saturation)),
    luminance: avg(all.map((f) => f.meanLuminance)),
    warmth: avg(all.map((f) => f.warmth)),
    contrast: avg(all.map((f) => f.contrast)),
    busyness: avg(all.map((f) => f.busyness)),
    hasImages: true,
  };
}

function paletteFor(school: School, altIdx: number, m: Mood) {
  const h0 = m.hue;
  switch (school.id) {
    case 'minimal-editorial':
      return {
        background: hsl(h0, 0.05 + 0.04 * altIdx, 0.95), text: hsl(h0, 0.2, 0.09),
        accent: altIdx === 2 ? hsl(h0, 0.15, 0.2) : hsl(h0, clamp(0.35 + m.sat * 0.5, 0.4, 0.8), 0.4), secondary: hsl(h0, 0.08, 0.45),
      };
    case 'vintage-analog-underground': {
      const hw = h0 >= 0 && h0 <= 55 ? h0 : [18, 30, 8][altIdx];
      return { background: hsl(hw, 0.42, 0.86 - 0.04 * altIdx), text: hsl(hw + 260, 0.35, 0.15), accent: hsl(hw, 0.75, 0.5), secondary: hsl(hw + 180, 0.6, 0.38) };
    }
    default: {
      const he = h0 + [150, 30, 200][altIdx];
      return { background: hsl(he, 0.18, 0.07), text: hsl(he, 0.08, 0.92), accent: hsl(he, 0.9, 0.58), secondary: hsl(he, 0.1, 0.55) };
    }
  }
}

/** Logo advice from measured pixels and the palette (never alters the file). */
function logoAdvice(input: SuggestInput, background: string): ArtDirection['logo'] {
  if (!input.logo) return { treatment: 'keep', reason: 'No logo uploaded.' };
  const printW = input.logo.heightMm * input.logo.aspect;
  const issues = logoIssues(input.logo.stats, { background, printWidthMm: printW });
  if (issues.some((i) => i.code === 'opaque-background')) return { treatment: 'remove-background', reason: 'The logo sits in an opaque box; removing the background lets it sit cleanly on this palette.' };
  const poor = issues.find((i) => i.code === 'dark-on-dark' || i.code === 'light-on-light' || i.code === 'low-contrast');
  if (poor) {
    const darkBg = hexToHsl(background)[2] < 0.4;
    return { treatment: darkBg ? 'lighten' : 'darken', reason: `Contrast between the logo and this background is low; a ${darkBg ? 'light' : 'dark'} copy will read better.` };
  }
  return { treatment: 'keep', reason: 'The logo has enough contrast against this palette.' };
}

/** Chooses artwork use, crop and focal areas from the measured artwork. */
function artworkPlan(school: School, input: SuggestInput): { use: 'none' | 'A' | 'both'; opacity: number; zoom: number; cx: number; cy: number; focal: Rect01 | null; secondaryFocals: Rect01[] } {
  const art = input.art;
  if (!art) return { use: 'none' as const, opacity: 1, zoom: 1, cx: 0.5, cy: 0.5, focal: null as Rect01 | null, secondaryFocals: [] as Rect01[] };
  const [primary, ...more] = art.focals;
  const cx = primary ? clamp(primary.x + primary.w / 2, 0.2, 0.8) : 0.5;
  const cy = primary ? clamp(primary.y + primary.h / 2, 0.2, 0.8) : 0.5;
  const base = { cx, cy, focal: primary ?? null, secondaryFocals: more.slice(0, 2) };
  if (school.id === 'minimal-editorial') return { use: 'both' as const, opacity: +clamp(0.95 - art.busyness * 0.45, 0.45, 0.95).toFixed(2), zoom: 1.1, ...base };
  if (school.id === 'vintage-analog-underground') return { use: 'both' as const, opacity: +clamp(0.8 - art.busyness * 0.3, 0.45, 0.8).toFixed(2), zoom: 1.35, ...base };
  // experimental: strong, dark artwork works as a field; otherwise a clean black field is better than a washed-out image
  return art.meanLuminance < 0.45 || art.contrast > 0.5
    ? { use: 'both' as const, opacity: +clamp(0.6 - art.busyness * 0.15, 0.35, 0.6).toFixed(2), zoom: 1.2, ...base }
    : { use: 'none' as const, opacity: 1, zoom: 1, cx: 0.5, cy: 0.5, focal: null as Rect01 | null, secondaryFocals: [] as Rect01[] };
}

function describe(school: School, alt: Alt, m: Mood, input: SuggestInput, palette: ArtDirection['palette'], art: ReturnType<typeof artworkPlan>): { rationale: string; risks: string[] } {
  const mood = !m.hasImages ? 'No references were provided, so the palette comes from the school\'s default rules.'
    : `Measured from your references: ${m.luminance < 0.4 ? 'dark' : m.luminance > 0.65 ? 'light' : 'mid-tone'}, ${m.warmth > 0.12 ? 'warm' : m.warmth < -0.12 ? 'cool' : 'neutral'}, ${m.sat > 0.5 ? 'saturated' : m.sat < 0.2 ? 'muted' : 'moderately saturated'}, ${m.busyness > 0.5 ? 'busy' : m.busyness < 0.2 ? 'calm' : 'moderately detailed'} (dominant hue ${Math.round(m.hue)}°).`;
  const parts = [mood, `${school.name} rules applied: ${alt.concept}`];
  if (art.use !== 'none') parts.push(`The artwork is used on ${art.use === 'both' ? 'both sides' : 'Side ' + art.use} at ${Math.round(art.opacity * 100)}% opacity${art.focal ? ', cropped around its detected subject, and text is kept off that area' : ''}.`);
  else if (input.art) parts.push('The artwork is not used as a background in this direction; the flat palette keeps the tracklist cleaner.');
  const risks: string[] = [];
  if (Math.max(input.tracks.A, input.tracks.B) > 8) risks.push(`Long tracklist (${Math.max(input.tracks.A, input.tracks.B)} tracks on one side): text will be small; check legibility in the proof.`);
  if (input.art && art.use !== 'none' && input.art.busyness > 0.5) risks.push('The artwork is busy; tracklist text may need the backing plate (Artwork section).');
  if (alt.trackCase === 'upper' && Math.max(input.tracks.A, input.tracks.B) > 6) risks.push('Uppercase tracks on a long list are harder to scan.');
  if (contrastRatio(palette.text, palette.background) < 4.5) risks.push('Text contrast is below 4.5:1; check the proof.');
  return { rationale: parts.join(' '), risks };
}

/** One suggestion for one school. `round` rotates through the school's alternatives (used by "regenerate"). */
export function suggestVariation(input: SuggestInput, schoolIndex: number, round = 0): ArtDirection {
  const school = SCHOOLS[((schoolIndex % SCHOOLS.length) + SCHOOLS.length) % SCHOOLS.length];
  const altIdx = ((round % school.alts.length) + school.alts.length) % school.alts.length;
  const alt = school.alts[altIdx];
  const m = moodOf(input);
  const avail = new Set(input.available ?? listFamilies().map((f) => f.ref));
  const font = (r: FontRef): FontRef => (avail.has(r) ? r : 'sans');
  const palette = paletteFor(school, altIdx, m);
  if (contrastRatio(palette.text, palette.background) < 4.5) palette.text = readableOn(palette.background);
  const art = artworkPlan(school, input);
  const maxTracks = Math.max(input.tracks.A, input.tracks.B);
  const longTitle = input.release.title.length > 22 || input.release.artist.length > 22;
  const textScrim = art.use !== 'none' ? +(school.id === 'vintage-analog-underground' ? 0.3 : 0.15 + (input.art?.busyness ?? 0) * 0.4).toFixed(2) : 0;
  const { rationale, risks } = describe(school, alt, m, input, palette, art);
  const raw = {
    concept: { name: alt.name, summary: alt.concept },
    basePreset: school.basePreset,
    palette,
    typography: {
      headingFont: font(alt.heading), bodyFont: font(alt.body), titleCase: alt.titleCase, trackCase: maxTracks > 8 ? 'none' : alt.trackCase,
      titleBold: alt.titleBold, bodyBold: alt.bodyBold, titleTracking: alt.titleTracking, bodyTracking: alt.bodyTracking,
      titleSizePt: +(alt.titleSize - (longTitle ? 1.5 : 0)).toFixed(2), trackSizePt: maxTracks > 12 ? 5.5 : maxTracks > 8 ? 5.8 : alt.trackSize,
      metaSizePt: alt.metaSize, lineHeight: alt.lineHeight, textAlign: 'left',
    },
    composition: {
      layoutMode: 'auto', headerEmphasis: alt.emphasis, ornament: alt.ornament, ornamentOpacity: alt.ornamentOpacity, ornamentColor: alt.ornamentColor,
      textScrim, sideBVariant: alt.sideB,
    },
    artwork: art,
    logo: logoAdvice(input, palette.background),
    hierarchy: school.hierarchy,
    rationale, risks,
  };
  // the same validation every direction goes through: clamps numbers, checks fonts and colours
  return sanitizeDirection(raw, [...avail]);
}

export interface Suggestion { index: number; school: { id: string; name: string }; direction: ArtDirection; round: number; distance?: number }

/**
 * The three suggestions (one per school). `rounds` picks which alternative each school shows; `avoid` (directions the user keeps)
 * makes a regenerated suggestion rotate until it is clearly different from them.
 */
export function suggestVariations(input: SuggestInput, rounds: number[] = [0, 0, 0], only?: number[], avoid: ArtDirection[] = []): Suggestion[] {
  const idx = only ?? [0, 1, 2];
  return idx.map((i) => {
    let round = rounds[i] ?? 0;
    let dir = suggestVariation(input, i, round);
    for (let tries = 0; tries < SCHOOLS[i].alts.length && avoid.some((a) => directionDistance(a, dir) < MIN_VARIATION_DISTANCE); tries++) dir = suggestVariation(input, i, ++round);
    return { index: i, school: { id: SCHOOLS[i].id, name: SCHOOLS[i].name }, direction: dir, round };
  });
}

/** One suggestion chosen by the measured mood of the references. */
export function suggestSingle(input: SuggestInput): Suggestion {
  const m = moodOf(input);
  const i = !m.hasImages ? 0 : m.luminance < 0.38 || m.contrast > 0.6 ? 2 : m.warmth > 0.1 && m.sat < 0.6 ? 1 : m.busyness < 0.35 || m.luminance > 0.6 ? 0 : 1;
  const direction = suggestVariation(input, i, 0);
  const why = !m.hasImages ? 'No references: the calm editorial school is the safest default.' : `Chosen because your references measure ${m.luminance < 0.38 ? 'dark' : m.luminance > 0.6 ? 'light' : 'mid-tone'}, ${m.warmth > 0.1 ? 'warm' : 'neutral/cool'} and ${m.busyness > 0.5 ? 'busy' : 'fairly calm'}.`;
  return { index: i, school: { id: SCHOOLS[i].id, name: SCHOOLS[i].name }, direction: { ...direction, rationale: `${why} ${direction.rationale}` }, round: 0 };
}
