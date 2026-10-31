import { describe, expect, it } from 'vitest';
import { defaultDesign, type Design } from '../src/core/model';
import { renderLabel, seedManual } from '../src/core/render';
import { getTemplate, keepOuts } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const m = createPdfkitMeasurer();
const mk = (n: number) => Array.from({ length: n }, (_, i) => `Track ${i + 1}`).join('\n');
const hit = (a: { x: number; y: number; w: number; h: number }, k: { x: number; y: number; w: number; h: number }) => a.x < k.x + k.w - 0.05 && a.x + a.w > k.x + 0.05 && a.y < k.y + k.h - 0.05 && a.y + a.h > k.y + 0.05;

describe('manual mode after the tracklist changes', () => {
  for (const id of ['cl-nw', 'cass-labela-2017', 'cl4rc-standard-2024']) {
    it(`${id}: tracks added after manual mode started are re-split around the window, not run straight across it`, () => {
      const t = getTemplate(id)!;
      const base: Design = { ...defaultDesign, templateId: id, sides: { A: { ...defaultDesign.sides.A, tracksText: mk(3) }, B: { ...defaultDesign.sides.B, tracksText: mk(3) } } };
      const seeded = seedManual(base, t, m);
      const manual: Design = { ...base, manual: seeded.manual, trackGroups: seeded.trackGroups, style: { ...base.style, ...seeded.stylePatch, layoutMode: 'manual' } };
      const grown: Design = { ...manual, sides: { ...manual.sides, B: { ...manual.sides.B, tracksText: mk(9) } } };
      const r = renderLabel(grown, t, 'B', m);
      expect(r.groups.reduce((a, b) => a + b, 0)).toBe(9);
      for (const b of r.blocks.filter((x) => x.id.startsWith('tracks'))) for (const k of keepOuts(t)) expect(hit(b, k)).toBe(false);
    });
  }
});
