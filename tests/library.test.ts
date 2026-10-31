import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATES, artClipPath, cutOverlayPath, getTemplate, isUsable, keepOuts, safeRect, textRegions } from '../src/core/templates';
import { pathBounds } from './pathBounds';

/**
 * Independent oracle: these numbers were read straight from the source PDFs with PyMuPDF (pt -> mm) before
 * the app was written. The library must reproduce them.
 */
const EXPECTED: Record<string, { cut: [number, number]; inner: [number, number][]; behavior: string; artboard?: [number, number] }> = {
  'cl-nw': { cut: [90.0, 41.152], inner: [[14.5, 14.5], [14.5, 14.5]], behavior: 'cut-path', artboard: [105.858, 62.135] },
  'cl-sq': { cut: [88.556, 40.248], inner: [[61.351, 15.67]], behavior: 'cutout', artboard: [105.858, 62.135] },
  'cl-wide': { cut: [94.912, 40.912], inner: [[58.609, 15.87]], behavior: 'cutout', artboard: [110.0, 62.135] },
  'cl4rc-standard-2024': { cut: [88.9, 40.919], inner: [[60.325, 15.875]], behavior: 'cover-art', artboard: [92.2, 44.2] },
  'casslabela-roundbottom-2021': { cut: [88.905, 41.451], inner: [[60.333, 15.557]], behavior: 'cover-art', artboard: [101.6, 50.8] },
  'cass-labela-2017': { cut: [88.905, 41.451], inner: [[60.333, 15.557]], behavior: 'unspecified' },
};
const TOL = 0.01;
const vectorTemplates = TEMPLATES.filter(isUsable);

describe('template library (original source geometry)', () => {
  it('contains every supplied family, with Gloss present but unverified', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual([...Object.keys(EXPECTED), 'cl4rc-gloss'].sort());
    const gloss = getTemplate('cl4rc-gloss')!;
    expect(gloss.verification).toBe('unverified-raster-only');
    expect(isUsable(gloss)).toBe(false);
    expect(gloss.cut).toBeNull();
  });

  for (const [id, exp] of Object.entries(EXPECTED)) {
    describe(id, () => {
      const t = getTemplate(id)!;

      it('cut-path size matches the source file', () => {
        expect(Math.abs(t.cut!.bbox.w - exp.cut[0])).toBeLessThan(TOL);
        expect(Math.abs(t.cut!.bbox.h - exp.cut[1])).toBeLessThan(TOL);
      });

      it('path data really spans the recorded bounding boxes (no edits, no scaling)', () => {
        for (const s of [t.cut!, ...(t.bleed ? [t.bleed] : []), ...t.inner, ...t.safety.filter((x) => x.kind === 'closed')]) {
          const b = pathBounds(s.d);
          expect(Math.abs(b.x - s.bbox.x)).toBeLessThan(0.02);
          expect(Math.abs(b.y - s.bbox.y)).toBeLessThan(0.02);
          expect(Math.abs(b.w - s.bbox.w)).toBeLessThan(0.02);
          expect(Math.abs(b.h - s.bbox.h)).toBeLessThan(0.02);
        }
      });

      it('inner shapes match the source and keep the decided cutting behaviour', () => {
        expect(t.inner.length).toBe(exp.inner.length);
        t.inner.forEach((s, i) => {
          expect(Math.abs(s.bbox.w - exp.inner[i][0])).toBeLessThan(TOL);
          expect(Math.abs(s.bbox.h - exp.inner[i][1])).toBeLessThan(TOL);
          expect(s.behavior).toBe(exp.behavior);
          expect(s.wording.length).toBeGreaterThan(10);
        });
      });

      it('cut path lies inside the bleed frame, and the frame is the local origin', () => {
        const f = t.frame!;
        const c = t.cut!.bbox;
        expect(c.x).toBeGreaterThanOrEqual(-0.001);
        expect(c.y).toBeGreaterThanOrEqual(-0.001);
        expect(c.x + c.w).toBeLessThanOrEqual(f.w + 0.001);
        expect(c.y + c.h).toBeLessThanOrEqual(f.h + 0.001);
        if (t.bleed) { expect(t.bleed.bbox.x).toBeCloseTo(0, 3); expect(t.bleed.bbox.y).toBeCloseTo(0, 3); }
      });

      if (exp.artboard) {
        it('records the vendor 1-up artboard', () => {
          expect(Math.abs(t.artboardMm!.w - exp.artboard![0])).toBeLessThan(TOL);
          expect(Math.abs(t.artboardMm!.h - exp.artboard![1])).toBeLessThan(TOL);
          expect(t.frameOrigin).not.toBeNull();
        });
      }

      it('derives non-empty text regions inside the safe area that avoid the keep-outs', () => {
        const S = safeRect(t);
        const regions = textRegions(t);
        expect(regions.length).toBeGreaterThan(0);
        for (const r of regions) {
          expect(r.x).toBeGreaterThanOrEqual(S.x - 0.01);
          expect(r.x + r.w).toBeLessThanOrEqual(S.x + S.w + 0.01);
          for (const k of keepOuts(t)) {
            const overlap = r.x < k.x + k.w - 0.01 && r.x + r.w > k.x + 0.01 && r.y < k.y + k.h - 0.01 && r.y + r.h > k.y + 0.01;
            expect(overlap).toBe(false);
          }
        }
      });

      it('clips artwork with holes only for cutout behaviour; cut overlay carries the source inner cuts', () => {
        const subpaths = (d: string) => (d.match(/M/g) ?? []).length;
        expect(subpaths(artClipPath(t))).toBe(1 + (exp.behavior === 'cutout' ? t.inner.length : 0));
        expect(subpaths(cutOverlayPath(t))).toBe(1 + (exp.behavior === 'unspecified' ? 0 : t.inner.length));
      });

      if (t.sheet) {
        it('has the original 12-up slots inside the sheet', () => {
          expect(t.sheet!.slots.length).toBe(12);
          expect(t.sheet!.paperMm).toEqual({ w: 215.9, h: 279.4 });
          for (const p of t.sheet!.slots) {
            expect(p.x + t.cut!.bbox.x + t.cut!.bbox.w).toBeLessThanOrEqual(215.9);
            expect(p.y + t.cut!.bbox.y + t.cut!.bbox.h).toBeLessThanOrEqual(279.4);
          }
        });
      }
    });
  }

  it('has an inventory covering every supplied file and verification status', () => {
    const inv = JSON.parse(readFileSync('template_inventory.json', 'utf8'));
    expect(inv.files.length).toBeGreaterThanOrEqual(21);
    const exts = new Set(inv.files.map((f: { format: string }) => f.format));
    for (const e of ['pdf', 'psd', 'png']) expect(exts.has(e)).toBe(true);
    expect(inv.templates.find((t: { id: string }) => t.id === 'cl4rc-gloss').verification).toBe('unverified-raster-only');
    expect(vectorTemplates.length).toBe(6);
  });
});
