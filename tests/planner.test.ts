import { describe, expect, it } from 'vitest';
import { defaultDesign, defaultSide, parseTracks, type Design } from '../src/core/model';
import { planBoth } from '../src/core/plan';
import { renderLabel } from '../src/core/render';
import { TEMPLATES, getTemplate, isUsable, keepOuts, safeRect } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const measure = createPdfkitMeasurer();
const vector = TEMPLATES.filter(isUsable);
const cl4rc = getTemplate('cl4rc-standard-2024')!;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const list = (n: number, prefix = 'Song') => Array.from({ length: n }, (_, i) => `${prefix} number ${i + 1} | 3:${String(10 + i).padStart(2, '0')}`).join('\n');
const withTracks = (a: number, b: number, extra: Partial<Design['style']> = {}): Design => ({
  ...defaultDesign, style: { ...defaultDesign.style, ...extra },
  sides: { A: defaultSide('SIDE A', list(a)), B: defaultSide('SIDE B', list(b)) },
});
const trackBlocks = (r: ReturnType<typeof renderLabel>) => r.blocks.filter((b) => b.id.startsWith('track-'));
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;

describe('tracklist composition', () => {
  for (const t of vector) {
    for (const [a, b] of [[4, 3], [6, 6], [9, 7], [12, 10]] as const) {
      it(`${t.id}: ${a}/${b} tracks stay in order, grouped, readable and clear of the window`, () => {
        const d = withTracks(a, b);
        const plan = planBoth(d, t, measure);
        for (const [side, n] of [['A', a], ['B', b]] as const) {
          const p = plan[side];
          const r = renderLabel(d, t, side, measure);
          const tb = trackBlocks(r);
          if (p.overflow === 0) {
            expect(tb.length).toBe(n);
            expect(p.groups.reduce((x, y) => x + y, 0)).toBe(n); // every track belongs to a group
            // no stray single-track group; only on the tightest layouts with long lists is one tolerated (it beats shrinking below the legibility floor)
            if (n > 3) expect(p.groups.filter((g) => g === 1).length).toBeLessThanOrEqual(n > 6 ? 1 : 0);
            let at = 0;
            for (const g of p.groups) {
              const grp = tb.slice(at, at + g); at += g;
              for (let i = 1; i < grp.length; i++) expect(grp[i].y).toBeGreaterThan(grp[i - 1].y); // top to bottom inside a group
              expect(new Set(grp.map((x) => x.x.toFixed(2))).size).toBe(1); // one column per group
            }
            expect(tb.map((x) => x.id)).toEqual(parseTracks(d.sides[side].tracksText).map((x) => `track-${x.number}`)); // reading order kept
          }
          // readability: never below the legibility floor, whatever it takes
          expect(p.trackPt).toBeGreaterThanOrEqual(Math.min(d.style.trackSizePt, d.style.minLegiblePt) - 0.01);
          // nothing collides with the window / hubs or with other blocks
          const placed = r.blocks.filter((x) => !x.overflow);
          for (const k of keepOuts(t)) for (const blk of placed) expect(overlaps(blk.ink, k)).toBe(false);
          for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i].ink, placed[j].ink)).toBe(false);
          const S = safeRect(t);
          for (const blk of placed) {
            expect(blk.ink.x).toBeGreaterThanOrEqual(S.x - 0.02);
            expect(blk.ink.x + blk.ink.w).toBeLessThanOrEqual(S.x + S.w + 0.02);
          }
        }
      });
    }
  }

  it('balances both sides: same text size and header position when the typography matches and both fit', () => {
    for (const t of vector) {
      const plan = planBoth(withTracks(6, 5), t, measure);
      if (plan.A.overflow === 0 && plan.B.overflow === 0) {
        expect(plan.A.trackPt).toBe(plan.B.trackPt);
        expect(plan.A.headerScale).toBe(plan.B.headerScale);
        expect(plan.A.signature.split('|')[0]).toBe(plan.B.signature.split('|')[0]);
      }
    }
  });

  it('never sacrifices readability: when it cannot fit, text stops at the legibility floor, overflows visibly and keeps every track', () => {
    const r = renderLabel(withTracks(40, 3), cl4rc, 'A', measure, { preview: true });
    expect(r.effectiveTrackPt).toBeCloseTo(5, 1); // the 5 pt floor, not 4 pt and not smaller
    expect(trackBlocks(r).length).toBe(40);
    expect(r.warnings.some((w) => /do not fit/.test(w.message))).toBe(true);
    expect(r.svg).toContain('fill="#ff0000"');
  });

  it('a large title is absorbed by the header: it does not make the tracks any smaller', () => {
    const at = (title: number) => planBoth({ ...defaultDesign, style: { ...defaultDesign.style, titleSizePt: title } }, cl4rc, measure).A;
    expect(at(14).scale).toBe(at(9).scale);
    expect(at(14).headerScale).toBeLessThan(1);
    expect(at(9).trackPt).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic', () => {
    const d = withTracks(7, 5);
    expect(renderLabel(d, cl4rc, 'A', measure).svg).toBe(renderLabel({ ...d }, cl4rc, 'A', measure).svg);
  });

  it('considers the artist logo: it gets its own space beside the titles and nothing collides', () => {
    const d: Design = { ...withTracks(4, 3), assets: [{ id: 'logo', kind: 'logo', name: 'l', dataUrl: PNG, width: 300, height: 100 }], style: { ...defaultDesign.style, logoAssetId: 'logo', logoHeightMm: 5 } };
    const r = renderLabel(d, cl4rc, 'A', measure);
    const logo = r.blocks.find((b) => b.id === 'logo')!;
    expect(logo).toBeDefined();
    expect(r.warnings.filter((w) => w.level === 'warning')).toEqual([]);
    for (const b of r.blocks.filter((x) => x !== logo)) expect(overlaps(logo.ink, b.ink)).toBe(false);
    for (const k of keepOuts(cl4rc)) expect(overlaps(logo.ink, k)).toBe(false);
    // when the logo and titles cannot share one column the planner splits them across columns instead of overflowing
    const big = renderLabel({ ...d, style: { ...d.style, logoHeightMm: 9 } }, cl4rc, 'A', measure);
    expect(big.blocks.find((b) => b.id === 'logo')!.x).not.toBe(big.blocks.find((b) => b.id === 'title')!.x);
  });

  it('keeps text away from the artwork focal area', () => {
    const side = { ...defaultSide('SIDE A', list(4)), backgroundAssetId: 'art', bgFocal: { x: 0.62, y: 0.05, w: 0.36, h: 0.55 } };
    const d: Design = { ...defaultDesign, assets: [{ id: 'art', kind: 'art', name: 'a', dataUrl: PNG, width: 400, height: 200 }], sides: { A: side, B: defaultSide('SIDE B', list(3)) } };
    const plan = planBoth(d, cl4rc, measure).A;
    expect(plan.focal).not.toBeNull();
    for (const b of plan.blocks.filter((x) => !x.overflow)) expect(overlaps(b.ink, plan.focal!)).toBe(false);
    expect(renderLabel(d, cl4rc, 'A', measure).warnings.filter((w) => /focal/.test(w.message))).toEqual([]);
  });

  it('layout modes still work with the planner: separated puts the side letter beside the window, minimal prints no tracks', () => {
    const sep = renderLabel(withTracks(4, 3, { layoutMode: 'separated' }), cl4rc, 'A', measure);
    expect(sep.blocks.find((b) => b.id === 'heading')!.x).toBeLessThan(cl4rc.inner[0].bbox.x);
    const min = renderLabel(withTracks(4, 3, { layoutMode: 'minimal' }), cl4rc, 'A', measure);
    expect(trackBlocks(min).length).toBe(0);
  });

  it('plans quickly enough for live editing, even for long tracklists', () => {
    for (const t of vector) for (const [a, b] of [[12, 10], [40, 3]] as const) {
      const t0 = performance.now();
      planBoth(withTracks(a, b), t, measure);
      expect(performance.now() - t0).toBeLessThan(2500);
    }
  });

  it('treats the artwork focal area as a soft preference: readable text beats avoiding it, and the user is told', () => {
    // a focal area covering most of the label leaves no room for text outside it
    const side = { ...defaultSide('SIDE A', list(4)), backgroundAssetId: 'art', bgFocal: { x: 0.02, y: 0.02, w: 0.96, h: 0.96 } };
    const d: Design = { ...defaultDesign, assets: [{ id: 'art', kind: 'art', name: 'a', dataUrl: PNG, width: 400, height: 200 }], sides: { A: side, B: defaultSide('SIDE B', list(3)) } };
    const r = renderLabel(d, cl4rc, 'A', measure);
    const placed = r.blocks;
    expect(planBoth(d, cl4rc, measure).A.overflow).toBe(0); // no overflow just because of the focal area
    expect(r.warnings.some((w) => /focal area/.test(w.message))).toBe(true);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i].ink, placed[j].ink)).toBe(false);
    expect(r.effectiveTrackPt).toBeGreaterThanOrEqual(5 - 0.01);
  });

  it('keeps a tracklist together: it is not read across the window when it can sit in one band', () => {
    const cl = renderLabel(withTracks(5, 4), cl4rc, 'A', measure);
    const ys = trackBlocks(cl).map((b) => b.y);
    const window = cl4rc.inner[0].bbox;
    const above = ys.filter((y) => y < window.y).length, below = ys.filter((y) => y > window.y + window.h).length;
    expect(above === 0 || below === 0).toBe(true); // all on one side of the window
  });
});
