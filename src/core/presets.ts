/**
 * Creative design directions. A preset is a STARTING POINT: it sets palette, typography, ornament and Side B variant,
 * and nothing else. Release text, assets, template, export options and manual positions are never touched, and everything
 * a preset sets can be edited afterwards.
 */
import { defaultStyle, type Design, type Style } from './model';

export interface Preset {
  id: string;
  name: string;
  tagline: string;
  patch: Partial<Style>;
}

const base: Partial<Style> = {
  layoutMode: 'auto', shrinkToFit: true, minLegiblePt: 5, showDurations: true, showTrackNumbers: true,
  textAlign: 'left', headerEmphasis: 'album', textScrim: 0, titleBold: true, bodyBold: false, trackCase: 'none', titleCase: 'none',
  titleTracking: 0, bodyTracking: 0, lineHeight: 1.2, trackSpacingMm: 0.2, headingFont: null, bodyFont: null, font: 'sans',
};

export const PRESETS: Preset[] = [
  {
    id: 'minimal-underground', name: 'Minimal underground label', tagline: 'Quiet grey paper, lowercase type, hairline rules.',
    patch: { ...base, backgroundColor: '#ecebe6', textColor: '#121212', accentColor: '#121212', secondaryColor: '#8a8a84', titleBold: false, titleCase: 'lower', titleTracking: 0.08, bodyTracking: 0.04, titleSizePt: 8, trackSizePt: 6, metaSizePt: 5, lineHeight: 1.3, ornament: { kind: 'rules', opacity: 0.7, color: 'text' }, sideBVariant: 'inverted' },
  },
  {
    id: 'vintage-80s', name: 'Vintage 1980s cassette', tagline: 'Cream stock, retro display face, three-colour edge stripes.',
    patch: { ...base, backgroundColor: '#f3e6cc', textColor: '#2b1d3a', accentColor: '#e4572e', secondaryColor: '#17a2a5', headingFont: 'studio:righteous', bodyFont: 'sans', titleBold: false, titleCase: 'upper', titleTracking: 0.06, titleSizePt: 10, trackSizePt: 6.5, metaSizePt: 5.5, ornament: { kind: 'stripes', opacity: 1, color: 'accent' }, sideBVariant: 'tinted' },
  },
  {
    id: 'indie-90s', name: '1990s independent record label', tagline: 'Heavy grotesque caps, typewriter body, thin keyline frame.',
    patch: { ...base, backgroundColor: '#d8d2c2', textColor: '#1a1a1a', accentColor: '#b3261e', secondaryColor: '#3b5b7a', headingFont: 'studio:archivoblack', bodyFont: 'mono', titleBold: false, titleCase: 'upper', titleSizePt: 9, trackSizePt: 6, metaSizePt: 5, ornament: { kind: 'frame', opacity: 0.8, color: 'text' }, sideBVariant: 'matched' },
  },
  {
    id: 'city-pop', name: 'Japanese city pop', tagline: 'Sunset pink and midnight navy, rounded display type, dot screen.',
    patch: { ...base, backgroundColor: '#f9c9dc', textColor: '#1b2a6b', accentColor: '#0098b3', secondaryColor: '#ff7e5f', headingFont: 'studio:righteous', bodyFont: 'sans', titleBold: false, titleSizePt: 10, trackSizePt: 6.5, metaSizePt: 5.5, titleTracking: 0.03, ornament: { kind: 'dots', opacity: 0.8, color: 'secondary' }, sideBVariant: 'inverted' },
  },
  {
    id: 'experimental-electronic', name: 'Experimental electronic', tagline: 'Black field, monospaced lowercase, signal-green accent, grid.',
    patch: { ...base, backgroundColor: '#0e0f11', textColor: '#e9ece9', accentColor: '#35f28a', secondaryColor: '#7a7f87', headingFont: 'studio:spacemono', bodyFont: 'studio:spacemono', titleBold: true, titleCase: 'lower', titleSizePt: 8, trackSizePt: 6, metaSizePt: 5, bodyTracking: 0.02, ornament: { kind: 'grid', opacity: 0.8, color: 'accent' }, sideBVariant: 'inverted' },
  },
  {
    id: 'industrial-techno', name: 'Industrial / techno', tagline: 'Condensed caps, hazard-red stripes, scanline texture.',
    patch: { ...base, backgroundColor: '#151515', textColor: '#f1f1f1', accentColor: '#ff4a1c', secondaryColor: '#8c8c8c', headingFont: 'studio:bebas', bodyFont: 'studio:spacemono', titleBold: false, titleCase: 'upper', trackCase: 'upper', titleTracking: 0.08, titleSizePt: 12, trackSizePt: 6, metaSizePt: 5, ornament: { kind: 'stripes', opacity: 1, color: 'accent' }, sideBVariant: 'tinted' },
  },
  {
    id: 'punk-diy', name: 'Punk / DIY photocopy', tagline: 'Typewriter caps on photocopy white, hard rules, inverted flip side.',
    patch: { ...base, backgroundColor: '#f2f1ec', textColor: '#0d0d0d', accentColor: '#0d0d0d', secondaryColor: '#d4202a', headingFont: 'studio:specialelite', bodyFont: 'studio:specialelite', titleBold: false, titleCase: 'upper', trackCase: 'upper', titleSizePt: 9, trackSizePt: 6, metaSizePt: 5, ornament: { kind: 'rules', opacity: 1, color: 'text' }, sideBVariant: 'inverted' },
  },
  {
    id: 'modern-editorial', name: 'Modern editorial typography', tagline: 'Warm paper, high-contrast serif title, clean sans body.',
    patch: { ...base, backgroundColor: '#f4f1ea', textColor: '#161616', accentColor: '#b0412c', secondaryColor: '#6b6b66', headingFont: 'studio:dmserif', bodyFont: 'sans', titleBold: false, titleSizePt: 11, trackSizePt: 6.5, metaSizePt: 5.5, lineHeight: 1.25, ornament: { kind: 'rules', opacity: 0.9, color: 'accent' }, sideBVariant: 'matched' },
  },
];

export const CUSTOM_REFERENCE_ID = 'custom-reference';
export const getPreset = (id: string | null | undefined) => PRESETS.find((p) => p.id === id) ?? null;

/** Applies a preset's visual settings; content, assets, template, export options and per-element settings are kept. */
export function applyPreset(d: Design, id: string): Design {
  const p = getPreset(id);
  if (!p) return d;
  const style: Style = { ...d.style, ...defaultStyleKeys(p.patch) };
  return {
    ...d,
    presetId: id,
    style,
    // per-side typography overrides belong to the previous direction
    sides: { A: { ...d.sides.A, typo: {}, backgroundColor: null }, B: { ...d.sides.B, typo: {}, backgroundColor: null } },
  };
}

const defaultStyleKeys = (patch: Partial<Style>): Partial<Style> => {
  const out: Partial<Style> = {};
  for (const k of Object.keys(patch) as (keyof Style)[]) if (k in defaultStyle) (out as Record<string, unknown>)[k] = patch[k];
  return out;
};
