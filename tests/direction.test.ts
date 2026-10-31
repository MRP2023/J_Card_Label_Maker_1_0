import { describe, expect, it } from 'vitest';
import { contrastRatio, paletteFromPixels } from '../src/core/color';
import { applyDirection, sanitizeDirection } from '../src/core/direction';
import { listFamilies } from '../src/core/fonts';
import { defaultDesign } from '../src/core/model';
import { renderLabel } from '../src/core/render';
import { styleFor } from '../src/core/style';
import { getTemplate } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const refs = listFamilies().map((f) => f.ref);
const good = {
  concept: { name: 'Neon Arcade', summary: 'Night-time arcade glow.' }, basePreset: 'city-pop',
  palette: { background: '#101820', text: '#f2f2f2', accent: '#ff5fa2', secondary: '#27e1c1' },
  typography: { headingFont: 'studio:righteous', bodyFont: 'sans', titleCase: 'upper', trackCase: 'none', titleBold: false, bodyBold: false, titleTracking: 0.1, bodyTracking: 0.02, titleSizePt: 10, trackSizePt: 6.5, metaSizePt: 5.5, lineHeight: 1.25, textAlign: 'left' },
  composition: { layoutMode: 'auto', headerEmphasis: 'artist', ornament: 'dots', ornamentOpacity: 0.7, ornamentColor: 'secondary', textScrim: 0.4, sideBVariant: 'inverted' },
  artwork: { use: 'A', opacity: 0.8, zoom: 1.4, cx: 0.6, cy: 0.4, focal: { x: 0.55, y: 0.1, w: 0.4, h: 0.5 } },
  hierarchy: ['artist', 'album', 'tracks'], rationale: 'Because.', risks: ['Dense side A'],
};
describe('direction validation (every direction is validated before use)', () => {
  it('accepts a good direction and normalises it', () => {
    const d = sanitizeDirection(good, refs);
    expect(d.palette.background).toBe('#101820');
    expect(d.typography.headingFont).toBe('studio:righteous');
    expect(d.basePreset).toBe('city-pop');
    expect(d.artwork.focal).toEqual({ x: 0.55, y: 0.1, w: 0.4, h: 0.5 });
  });

  it('clamps out-of-range numbers, falls back on invalid colours, enums and fonts it was not offered', () => {
    const bad = sanitizeDirection({
      palette: { background: 'red', text: '#12', accent: 5, secondary: null },
      typography: { headingFont: 'comic-sans', bodyFont: 'studio:nope', titleSizePt: 400, trackSizePt: 1, titleTracking: 9, lineHeight: -3, titleCase: 'shout', textAlign: 'justify' },
      composition: { layoutMode: 'exploded', ornament: 'confetti', textScrim: 7, sideBVariant: 'weird' },
      artwork: { use: 'everywhere', opacity: 9, zoom: 99, cx: -4, cy: 12, focal: { x: 0.9, y: 0.9, w: 5, h: 5 } },
      basePreset: 'not-a-preset', hierarchy: ['a', 5, 'b'], rationale: 'x'.repeat(5000),
    }, refs);
    expect(bad.palette).toEqual({ background: '#f4efe4', text: '#111111', accent: '#c0392b', secondary: '#7a6f5d' });
    expect(bad.typography.headingFont).toBe('sans');
    expect(bad.typography.bodyFont).toBe('sans');
    expect(bad.typography.titleSizePt).toBe(16);
    expect(bad.typography.trackSizePt).toBe(4.5);
    expect(bad.typography.titleTracking).toBe(0.4);
    expect(bad.typography.lineHeight).toBe(1);
    expect(bad.typography.titleCase).toBe('none');
    expect(bad.typography.textAlign).toBe('left');
    expect(bad.composition).toMatchObject({ layoutMode: 'auto', ornament: 'none', textScrim: 0.8, sideBVariant: 'matched' });
    expect(bad.artwork).toMatchObject({ use: 'none', opacity: 1, zoom: 3, cx: 0, cy: 1 });
    expect(bad.artwork.focal!.x + bad.artwork.focal!.w).toBeLessThanOrEqual(1);
    expect(bad.basePreset).toBe('custom');
    expect(bad.hierarchy).toEqual(['a', 'b']);
    expect(bad.rationale.length).toBe(1200);
  });

  it('survives garbage entirely', () => {
    expect(() => sanitizeDirection(null, refs)).not.toThrow();
    expect(() => sanitizeDirection('nonsense', refs)).not.toThrow();
  });

  it('applyDirection sets style only, shares one design language across both sides, and keeps content and template', () => {
    const base = { ...defaultDesign, templateId: 'cl-sq', assets: [{ id: 'art1', kind: 'art' as const, name: 'a', dataUrl: PNG, width: 10, height: 10 }] };
    const out = applyDirection(base, sanitizeDirection(good, refs), { artworkAssetId: 'art1' });
    expect(out.templateId).toBe('cl-sq');
    expect(out.release).toEqual(base.release);
    expect(out.sides.A.tracksText).toBe(base.sides.A.tracksText);
    expect(out.style.headingFont).toBe('studio:righteous');
    expect(out.style.sideBVariant).toBe('inverted');
    expect(out.sides.A.backgroundAssetId).toBe('art1');
    expect(out.sides.B.backgroundAssetId).toBeNull(); // artwork used on side A only
    expect(out.sides.A.bgFocal).not.toBeNull();
    expect(out.sides.A.bgCrop).toEqual({ zoom: 1.4, cx: 0.6, cy: 0.4 });
    expect(styleFor(out, 'A').headingFont).toBe(styleFor(out, 'B').headingFont);
    expect(styleFor(out, 'B').backgroundColor).toBe('#f2f2f2'); // inverted
    expect(() => renderLabel(out, getTemplate('cl-sq')!, 'A', createPdfkitMeasurer())).not.toThrow();
  });

  it('repairs unreadable text colours instead of trusting the model', () => {
    const dir = sanitizeDirection({ ...good, palette: { background: '#222222', text: '#2a2a2a', accent: '#ff0000', secondary: '#00ff00' } }, refs);
    const out = applyDirection(defaultDesign, dir);
    expect(contrastRatio(out.style.textColor, out.style.backgroundColor)).toBeGreaterThanOrEqual(4);
  });
});

describe('colour tools', () => {
  it('contrast ratios match WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  it('extracts a readable palette from reference pixels', () => {
    const px = new Uint8ClampedArray(4 * 400);
    for (let i = 0; i < 400; i++) { const c = i < 250 ? [20, 30, 80] : i < 330 ? [250, 90, 40] : [40, 200, 180]; px.set([...c, 255], i * 4); }
    const p = paletteFromPixels(px, 1);
    expect(p.background).toMatch(/^#/);
    expect(contrastRatio(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(p.swatches.length).toBeGreaterThanOrEqual(3);
    expect(paletteFromPixels(new Uint8ClampedArray(0)).background).toBe('#f4efe4');
  });
});
