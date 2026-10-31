import { describe, expect, it } from 'vitest';
import { estimateFocalRects } from '../src/core/art';
import { applyDirection, sanitizeDirection } from '../src/core/direction';
import { listFamilies } from '../src/core/fonts';
import { analyzeLogoPixels, effectiveDpi, logoIssues, recolorPixels, removeBackgroundPixels } from '../src/core/logo';
import { defaultDesign, defaultSide, type Design } from '../src/core/model';
import { planBoth } from '../src/core/plan';
import { renderLabel } from '../src/core/render';
import { focalZones, styleFor } from '../src/core/style';
import { getTemplate } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const measure = createPdfkitMeasurer();
const cl4rc = getTemplate('cl4rc-standard-2024')!;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const refs = listFamilies().map((f) => f.ref);

/** Synthetic logo: a filled disc of `ink` on a background that is transparent (alpha 0) or an opaque colour. */
function logo(w: number, h: number, ink: [number, number, number], bg: [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const inside = Math.hypot(x - w / 2, y - h / 2) < Math.min(w, h) * 0.35;
    const px = inside ? [...ink, 255] : bg;
    d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
  }
  return d;
}

describe('logo analysis', () => {
  const black = analyzeLogoPixels(logo(300, 100, [10, 10, 10], [0, 0, 0, 0]), 300, 100);
  const white = analyzeLogoPixels(logo(300, 100, [250, 250, 250], [0, 0, 0, 0]), 300, 100);

  it('measures transparency and ink', () => {
    expect(black.hasAlpha).toBe(true);
    expect(black.opaqueBox).toBe(false);
    expect(black.inkLuminance).toBeLessThan(0.05);
    expect(white.inkLuminance).toBeGreaterThan(0.9);
    expect(black.transparentRatio).toBeGreaterThan(0.4);
  });

  it('detects a black logo on a dark background and suggests a lighter copy', () => {
    const issues = logoIssues(black, { background: '#141414', printWidthMm: 20, side: 'B' });
    const i = issues.find((x) => x.code === 'dark-on-dark')!;
    expect(i).toBeDefined();
    expect(i.severity).toBe('warning');
    expect(i.suggestions).toEqual(['recolor-light']);
    expect(i.message).toMatch(/Side B/);
    expect(i.message).toMatch(/original file is kept/);
  });

  it('detects a white logo on a light background and suggests a darker copy', () => {
    const i = logoIssues(white, { background: '#f4efe4', printWidthMm: 20 }).find((x) => x.code === 'light-on-light')!;
    expect(i.suggestions).toEqual(['recolor-dark']);
  });

  it('flags poor contrast that is neither dark-on-dark nor light-on-light', () => {
    const mid = analyzeLogoPixels(logo(300, 100, [128, 128, 128], [0, 0, 0, 0]), 300, 100);
    expect(logoIssues(mid, { background: '#8a8a8a', printWidthMm: 20 }).some((x) => x.code === 'low-contrast')).toBe(true);
  });

  it('is happy with good contrast', () => {
    expect(logoIssues(black, { background: '#f4efe4', printWidthMm: 20 }).filter((x) => x.severity === 'warning')).toEqual([]);
    expect(logoIssues(white, { background: '#141414', printWidthMm: 20 }).filter((x) => x.severity === 'warning')).toEqual([]);
  });

  it('detects an opaque background box (transparent-image issue) and offers background removal', () => {
    const boxed = analyzeLogoPixels(logo(300, 100, [10, 10, 10], [255, 255, 255, 255]), 300, 100);
    expect(boxed.opaqueBox).toBe(true);
    expect(boxed.boxColor).toBe('#ffffff');
    const i = logoIssues(boxed, { background: '#141414', printWidthMm: 20 }).find((x) => x.code === 'opaque-background')!;
    expect(i.suggestions).toContain('remove-background');
    // the ink inside the box is measured, not the box
    expect(boxed.inkLuminance).toBeLessThan(0.05);
  });

  it('detects low resolution at the printed size', () => {
    expect(effectiveDpi(300, 25.4)).toBe(300);
    const small = analyzeLogoPixels(logo(60, 20, [10, 10, 10], [0, 0, 0, 0]), 60, 20);
    const i = logoIssues(small, { background: '#f4efe4', printWidthMm: 25.4 }).find((x) => x.code === 'low-resolution')!;
    expect(i.severity).toBe('warning');
    expect(i.message).toMatch(/60 dpi/);
    expect(logoIssues(black, { background: '#f4efe4', printWidthMm: 30 }).find((x) => x.code === 'low-resolution')?.severity).toBe('info'); // 254 dpi: advisory only
    expect(logoIssues(analyzeLogoPixels(logo(900, 300, [10, 10, 10], [0, 0, 0, 0]), 900, 300), { background: '#f4efe4', printWidthMm: 30 }).some((x) => x.code === 'low-resolution')).toBe(false);
  });

  it('flags a blank logo', () => {
    const blank = analyzeLogoPixels(new Uint8ClampedArray(100 * 40 * 4), 100, 40);
    expect(logoIssues(blank, { background: '#fff', printWidthMm: 20 }).some((x) => x.code === 'faint-ink')).toBe(true);
  });
});

describe('non-destructive logo treatments', () => {
  it('recolouring returns new pixels, keeps the shape (alpha) and never touches the original', () => {
    const src = logo(40, 20, [10, 10, 10], [0, 0, 0, 0]);
    const copy = new Uint8ClampedArray(src);
    const out = recolorPixels(src, '#f4f4f0');
    expect(src).toEqual(copy); // original untouched
    expect(out).not.toBe(src);
    for (let i = 0; i < src.length; i += 4) {
      expect(out[i + 3]).toBe(src[i + 3]);
      expect([out[i], out[i + 1], out[i + 2]]).toEqual([244, 244, 240]);
    }
    expect(logoIssues(analyzeLogoPixels(out, 40, 20), { background: '#141414', printWidthMm: 20 }).filter((x) => x.code === 'dark-on-dark')).toEqual([]);
  });

  it('removing the background clears the outside but keeps enclosed areas of the same colour', () => {
    // white box, black ring, white centre (enclosed): the centre must survive
    const w = 60, h = 60;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - 30, y - 30);
      const v = r < 10 ? 255 : r < 22 ? 0 : 255;
      const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
    const copy = new Uint8ClampedArray(d);
    const { data, removedRatio } = removeBackgroundPixels(d, w, h);
    expect(d).toEqual(copy); // original untouched
    expect(data[3]).toBe(0); // corner: transparent
    expect(data[(30 * w + 30) * 4 + 3]).toBe(255); // enclosed centre kept
    expect(data[(30 * w + 14) * 4 + 3]).toBe(255); // ring kept
    expect(removedRatio).toBeGreaterThan(0.3);
    expect(analyzeLogoPixels(data, w, h).opaqueBox).toBe(false);
  });

  it('a different logo can be chosen per side, so Side B can use a lighter copy', () => {
    const d: Design = {
      ...defaultDesign,
      assets: [{ id: 'orig', kind: 'logo', name: 'logo.png', dataUrl: PNG, width: 300, height: 100 }, { id: 'light', kind: 'logo', name: 'logo (light).png', dataUrl: PNG, width: 300, height: 100, derivedFrom: 'orig', treatment: 'recolor-light' }],
      style: { ...defaultDesign.style, logoAssetId: 'orig' },
      sides: { A: defaultSide('SIDE A', 'a | 1:00'), B: { ...defaultSide('SIDE B', 'b | 1:00'), logoAssetId: 'light' } },
    };
    expect(styleFor(d, 'A').logoAssetId).toBe('orig');
    expect(styleFor(d, 'B').logoAssetId).toBe('light');
    expect(renderLabel(d, cl4rc, 'A', measure).svg).toContain('data-role="orig"');
    expect(renderLabel(d, cl4rc, 'B', measure).svg).toContain('data-role="light"');
    expect(d.assets[0].dataUrl).toBe(PNG); // the original asset is intact
  });
});

describe('artwork focal detection', () => {
  function scene(w: number, h: number, discs: { x: number; y: number; r: number; c: [number, number, number] }[]) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let c: number[] = [60 + (y / h) * 20, 70, 100];
      for (const s of discs) if (Math.hypot(x - s.x * w, y - s.y * h) < s.r * w) c = s.c;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    return d;
  }

  it('finds a bright subject on the right and keeps the box around it', () => {
    const f = estimateFocalRects(scene(320, 160, [{ x: 0.75, y: 0.45, r: 0.12, c: [255, 220, 90] }]), 320, 160);
    expect(f.length).toBeGreaterThanOrEqual(1);
    const p = f[0];
    expect(p.x).toBeLessThan(0.75); expect(p.x + p.w).toBeGreaterThan(0.75);
    expect(p.y).toBeLessThan(0.45); expect(p.y + p.h).toBeGreaterThan(0.45);
    expect(p.w).toBeLessThan(0.5); // a box around the subject, not the whole image
  });

  it('finds several subjects, most important first', () => {
    const f = estimateFocalRects(scene(320, 160, [{ x: 0.25, y: 0.5, r: 0.14, c: [250, 60, 60] }, { x: 0.8, y: 0.3, r: 0.07, c: [60, 250, 120] }]), 320, 160);
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f[0].x + f[0].w / 2).toBeLessThan(0.5); // the bigger disc comes first
  });

  it('returns nothing for a flat image', () => {
    expect(estimateFocalRects(scene(160, 80, []), 160, 80)).toEqual([]);
    expect(estimateFocalRects(new Uint8ClampedArray(0), 0, 0)).toEqual([]);
  });

  it('every returned rectangle stays inside the image', () => {
    for (const f of estimateFocalRects(scene(320, 160, [{ x: 0.98, y: 0.02, r: 0.1, c: [255, 0, 0] }]), 320, 160)) {
      expect(f.x).toBeGreaterThanOrEqual(0); expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.w).toBeLessThanOrEqual(1.0001); expect(f.y + f.h).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('composition with several focal areas', () => {
  const side = { ...defaultSide('SIDE A', 'One | 1:00\nTwo | 2:00\nThree | 3:00\nFour | 4:00'), backgroundAssetId: 'art', bgFocal: { x: 0.6, y: 0.1, w: 0.3, h: 0.5 }, bgFocalMore: [{ x: 0.05, y: 0.55, w: 0.2, h: 0.35 }] };
  const d: Design = { ...defaultDesign, assets: [{ id: 'art', kind: 'art', name: 'a', dataUrl: PNG, width: 400, height: 200 }], sides: { A: side, B: defaultSide('SIDE B', 'a | 1:00') } };
  const hit = (a: any, b: any) => a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;

  it('turns every focal rectangle into a keep-out zone', () => {
    expect(focalZones(d, 'A', cl4rc.frame!)).toHaveLength(2);
    expect(focalZones(d, 'B', cl4rc.frame!)).toEqual([]);
  });

  it('keeps text off all of them when there is room, and draws them in the editor', () => {
    const zones = focalZones(d, 'A', cl4rc.frame!);
    const plan = planBoth(d, cl4rc, measure).A;
    if (plan.overflow === 0 && plan.layoutNote !== 'focal-relaxed') for (const b of plan.blocks) for (const z of zones) expect(hit(b.ink, z)).toBe(false);
    const r = renderLabel(d, cl4rc, 'A', measure, { preview: true });
    expect((r.svg.match(/stroke="#b05bff"/g) ?? []).length).toBe(2);
  });

  it('ignores focal areas when the side has no artwork', () => {
    expect(focalZones({ ...d, sides: { ...d.sides, A: { ...side, backgroundAssetId: null } } }, 'A', cl4rc.frame!)).toEqual([]);
  });
});

describe('regenerating a direction without losing manual edits', () => {
  const dir = sanitizeDirection({
    concept: { name: 'X', summary: '' }, basePreset: 'custom',
    palette: { background: '#101820', text: '#f2f2f2', accent: '#ff5fa2', secondary: '#27e1c1' },
    typography: { headingFont: 'studio:righteous', bodyFont: 'sans', titleCase: 'upper', trackCase: 'none', titleBold: false, bodyBold: false, titleTracking: 0.1, bodyTracking: 0, titleSizePt: 10, trackSizePt: 6.5, metaSizePt: 5.5, lineHeight: 1.2, textAlign: 'left' },
    composition: { layoutMode: 'auto', headerEmphasis: 'album', ornament: 'dots', ornamentOpacity: 0.7, ornamentColor: 'accent', textScrim: 0.2, sideBVariant: 'inverted' },
    artwork: { use: 'both', opacity: 0.8, zoom: 1.4, cx: 0.6, cy: 0.4, focal: { x: 0.5, y: 0.1, w: 0.4, h: 0.5 }, secondaryFocals: [{ x: 0.05, y: 0.5, w: 0.2, h: 0.3 }] },
    logo: { treatment: 'lighten', reason: 'dark field' },
  }, refs);
  const edited: Design = {
    ...defaultDesign,
    assets: [{ id: 'art', kind: 'art', name: 'a', dataUrl: PNG, width: 10, height: 10 }],
    style: { ...defaultDesign.style, layoutMode: 'manual' },
    manual: { A: { title: { x: 12, y: 8, w: 30 } }, B: {} }, trackGroups: { A: [2, 2], B: [] }, locked: { A: { title: true }, B: {} },
    sides: { A: { ...defaultSide('SIDE A', 'a | 1:00'), typo: { trackSizePt: 7 }, backgroundColor: '#abcdef' }, B: defaultSide('SIDE B', 'b | 1:00') },
  };

  it('keepManual preserves positions, groups, locks, manual mode and per-side edits, while the new look is applied', () => {
    const out = applyDirection(edited, dir, { artworkAssetId: 'art', keepManual: true });
    expect(out.manual).toEqual(edited.manual);
    expect(out.trackGroups).toEqual(edited.trackGroups);
    expect(out.locked).toEqual(edited.locked);
    expect(out.style.layoutMode).toBe('manual');
    expect(out.sides.A.typo).toEqual({ trackSizePt: 7 });
    expect(out.sides.A.backgroundColor).toBe('#abcdef');
    expect(out.style.headingFont).toBe('studio:righteous'); // the new direction is in effect
    expect(out.sides.A.bgFocalMore).toHaveLength(1);
    expect(out.sides.B.backgroundAssetId).toBe('art');
  });

  it('without keepManual the direction replaces them (the original behaviour)', () => {
    const out = applyDirection(edited, dir, { artworkAssetId: 'art' });
    expect(out.manual).toEqual({ A: {}, B: {} });
    expect(out.locked).toEqual({ A: {}, B: {} });
    expect(out.style.layoutMode).toBe('auto');
    expect(out.sides.A.typo).toEqual({});
  });

  it('never mutates the design it is given (so a failed or cancelled apply loses nothing)', () => {
    const before = JSON.stringify(edited);
    applyDirection(edited, dir, { artworkAssetId: 'art', keepManual: true });
    applyDirection(edited, dir, { artworkAssetId: 'art' });
    expect(JSON.stringify(edited)).toBe(before);
  });

  it('parses logo guidance and secondary focals safely', () => {
    expect(dir.logo).toEqual({ treatment: 'lighten', reason: 'dark field' });
    expect(sanitizeDirection({ logo: { treatment: 'explode' }, artwork: { secondaryFocals: [{ x: 5, y: 'a' }, null, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, { x: 0, y: 0, w: 1, h: 1 }] }, palette: {}, typography: {}, composition: {} }, refs).artwork.secondaryFocals).toHaveLength(2);
    expect(sanitizeDirection({ palette: {}, typography: {}, composition: {} }, refs).logo.treatment).toBe('keep');
  });
});
