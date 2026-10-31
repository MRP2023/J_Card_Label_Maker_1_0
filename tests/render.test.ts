import { describe, expect, it } from 'vitest';
import { defaultDesign, parseTracks, type Design, type LayoutMode } from '../src/core/model';
import { renderLabel, seedManualPositions } from '../src/core/render';
import { getTemplate, isUsable, keepOuts, safeRect, TEMPLATES } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const measure = createPdfkitMeasurer();
const cl4rc = getTemplate('cl4rc-standard-2024')!;
const withMode = (layoutMode: LayoutMode, extra: Partial<Design['style']> = {}): Design => ({ ...defaultDesign, style: { ...defaultDesign.style, layoutMode, ...extra } });
const trackTexts = (svg: string) => (svg.match(/data-block="track-\d+"/g) ?? []).length;

describe('track parsing', () => {
  it('splits optional durations and skips blank lines', () => {
    expect(parseTracks('One | 3:45\n\nTwo\nThree\t10:02')).toEqual([
      { number: 1, title: 'One', duration: '3:45' },
      { number: 2, title: 'Two', duration: '' },
      { number: 3, title: 'Three', duration: '10:02' },
    ]);
  });
});

describe('locked geometry', () => {
  it('embeds the source cut and bleed path strings verbatim, for every vector template', () => {
    for (const t of TEMPLATES.filter(isUsable)) {
      const r = renderLabel({ ...withMode('auto'), exportOpts: defaultDesign.exportOpts }, t, 'A', measure, { guides: { cut: true, bleed: true, safety: true } });
      expect(r.svg).toContain(`d="${t.cut!.d}`);
      if (t.bleed) expect(r.svg).toContain(`d="${t.bleed.d}"`);
      for (const s of t.safety) expect(r.svg).toContain(s.d);
    }
  });

  it('throws for the raster-only template instead of inventing a shape', () => {
    expect(() => renderLabel(defaultDesign, getTemplate('cl4rc-gloss')!, 'A', measure)).toThrow(/no vector geometry/);
  });

  it('clips artwork to the source bleed frame with an even-odd clip path', () => {
    const r = renderLabel(defaultDesign, cl4rc, 'A', measure);
    expect(r.svg).toContain('<clipPath id="clip-A"><path d="' + cl4rc.bleed!.d);
    expect(r.svg).toContain('clip-rule="evenodd"');
  });

  it('removes only cutout-behaviour inner shapes from the artwork', () => {
    const sq = getTemplate('cl-sq')!;
    const clip = (t: typeof sq) => renderLabel(defaultDesign, t, 'A', measure).svg.match(/<clipPath[^>]*><path d="([^"]*)"/)![1];
    expect(clip(sq)).toContain(sq.inner[0].d);
    expect(clip(cl4rc)).not.toContain(cl4rc.inner[0].d);
    const nw = getTemplate('cl-nw')!;
    expect(clip(nw)).not.toContain(nw.inner[0].d);
  });
});

describe('automatic layout', () => {
  it('places header, heading and every track inside the regions with no warnings for a short list', () => {
    for (const t of TEMPLATES.filter(isUsable)) {
      const r = renderLabel(defaultDesign, t, 'B', measure);
      expect(r.warnings.filter((w) => w.level === 'warning')).toEqual([]);
      expect(trackTexts(r.svg)).toBe(3);
      for (const k of keepOuts(t)) for (const b of r.blocks) {
        const ov = b.ink.x < k.x + k.w - 0.01 && b.ink.x + b.ink.w > k.x + 0.01 && b.ink.y < k.y + k.h - 0.01 && b.ink.y + b.ink.h > k.y + 0.01;
        expect(ov).toBe(false);
      }
    }
  });

  const many = Array.from({ length: 40 }, (_, i) => `Track number ${i + 1} | 3:00`).join('\n');
  const crowded = (extra: Partial<Design['style']>): Design => ({ ...withMode('auto', extra), sides: { ...defaultDesign.sides, A: { ...defaultDesign.sides.A, tracksText: many } } });

  it('never drops a track: overflow is warned about, drawn and outlined in the preview', () => {
    const r = renderLabel(crowded({ shrinkToFit: false }), cl4rc, 'A', measure, { preview: true });
    expect(trackTexts(r.svg)).toBe(40);
    expect(r.warnings.some((w) => /do not fit/.test(w.message))).toBe(true);
    expect(r.svg).toContain('fill="#ff0000"');
  });

  it('shrink-to-fit scales text down, reports it, and never goes below 4 pt', () => {
    const few = Array.from({ length: 9 }, (_, i) => `Track ${i + 1} | 3:00`).join('\n');
    const d: Design = { ...withMode('auto', { trackSizePt: 8, shrinkToFit: true }), sides: { ...defaultDesign.sides, A: { ...defaultDesign.sides.A, tracksText: few } } };
    const r = renderLabel(d, cl4rc, 'A', measure);
    expect(r.scale).toBeLessThan(1);
    expect(r.effectiveTrackPt).toBeLessThan(8);
    expect(r.warnings.some((w) => /scaled to/.test(w.message))).toBe(true);
    const hopeless = renderLabel(crowded({ shrinkToFit: true }), cl4rc, 'A', measure);
    expect(hopeless.effectiveTrackPt).toBeGreaterThanOrEqual(4);
    expect(trackTexts(hopeless.svg)).toBe(40);
  });

  it('warns when text is smaller than the legibility threshold', () => {
    const r = renderLabel(withMode('auto', { trackSizePt: 4, shrinkToFit: false, minLegiblePt: 5 }), cl4rc, 'A', measure);
    expect(r.warnings.some((w) => /legibility/.test(w.message))).toBe(true);
  });
});

describe('other layout modes', () => {
  it('separated: big side letter in its own pane, compact artist – title header, all tracks kept', () => {
    const r = renderLabel(withMode('separated'), cl4rc, 'A', measure);
    expect(r.svg).toContain('data-block="heading"');
    expect(r.svg).toContain('Example Artist – Example');
    expect(trackTexts(r.svg)).toBe(4);
    const letter = r.blocks.find((b) => b.id === 'heading')!;
    expect(letter.x).toBeLessThan(cl4rc.inner[0].bbox.x); // left pane, beside the oval
  });

  it('minimal: logo/wordmark and release info only, tracks intentionally absent and reported', () => {
    const r = renderLabel(withMode('minimal', { wordmarkText: 'ARTIST' }), cl4rc, 'A', measure);
    expect(trackTexts(r.svg)).toBe(0);
    expect(r.svg).toContain('ARTIST');
    expect(r.warnings.some((w) => w.level === 'info' && /not printed/.test(w.message))).toBe(true);
  });

  it('manual: uses the stored positions and warns on overlaps with the artwork region and with other blocks', () => {
    const base = withMode('manual');
    const seeded = seedManualPositions(base, cl4rc, 'A', measure);
    expect(seeded.tracks).toBeDefined();
    const k = cl4rc.inner[0].bbox;
    const d: Design = { ...base, manual: { A: { ...seeded, tracks: { x: k.x + 5, y: k.y + 5, w: 40 }, title: { x: k.x + 6, y: k.y + 5, w: 40 } }, B: {} } };
    const r = renderLabel(d, cl4rc, 'A', measure, { preview: true });
    const tracks = r.blocks.find((b) => b.id === 'tracks')!;
    expect(tracks.x).toBeCloseTo(k.x + 5, 2);
    expect(r.warnings.some((w) => /overlaps the artwork\/cut region/.test(w.message))).toBe(true);
    expect(r.warnings.some((w) => /Tracklist overlaps Title|Title overlaps Tracklist/.test(w.message))).toBe(true);
    expect(r.svg).toContain('data-drag="tracks"');
  });

  it('keeps manual blocks inside the source safety guides: they are clamped back in and the user is told', () => {
    const d: Design = { ...withMode('manual'), manual: { A: { tracks: { x: -3, y: 0, w: 40 } }, B: {} } };
    const r = renderLabel(d, cl4rc, 'A', measure);
    const S = safeRect(cl4rc);
    const tb = r.blocks.find((b) => b.id === 'tracks')!;
    expect(tb.ink.x).toBeGreaterThanOrEqual(S.x - 0.01);
    expect(tb.ink.y).toBeGreaterThanOrEqual(S.y - 0.01);
    expect(r.warnings.some((w) => /moved back inside the safe area/.test(w.message))).toBe(true);
    expect(r.warnings.some((w) => /outside the source safety guides/.test(w.message))).toBe(false);
  });
});

describe('separate side artwork', () => {
  it('Side A and Side B can use different background images and colours', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const d: Design = {
      ...defaultDesign,
      assets: [{ id: 'bg', kind: 'art', name: 'a.png', dataUrl: png, width: 1, height: 1 }],
      sides: { A: { ...defaultDesign.sides.A, backgroundAssetId: 'bg', backgroundColor: '#112233' }, B: { ...defaultDesign.sides.B, backgroundColor: '#aabbcc' } },
    };
    const a = renderLabel(d, cl4rc, 'A', measure).svg;
    const b = renderLabel(d, cl4rc, 'B', measure).svg;
    expect(a).toContain('#112233');
    expect(a).toContain('<image');
    expect(b).toContain('#aabbcc');
    expect(b).not.toContain('<image');
  });
});
