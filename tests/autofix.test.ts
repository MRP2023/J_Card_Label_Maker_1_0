import { describe, expect, it } from 'vitest';
import { autoFixOverlaps, hasKeepOutOverlap } from '../src/core/autofix';
import { defaultDesign, type Design } from '../src/core/model';
import { renderLabel } from '../src/core/render';
import { getTemplate, keepOuts, safeRect } from '../src/core/templates';
import { hit } from '../src/core/blocks';
import { createPdfkitMeasurer } from '../server/measure';

const m = createPdfkitMeasurer();
const t = getTemplate('cl4rc-standard-2024')!;
const ko = keepOuts(t)[0];
const onHub = { x: ko.x + 2, y: ko.y + 2, w: 30 };
const base = (locked = {}): Design => ({
  ...defaultDesign, templateId: t.id,
  style: { ...defaultDesign.style, layoutMode: 'manual' },
  manual: { A: {}, B: { title: onHub, artist: { ...onHub, y: onHub.y + 6 }, meta: { ...onHub, y: onHub.y + 10 } } },
  locked: { A: {}, B: locked },
});

describe('auto-fix overlaps', () => {
  it('moves text that sits on a window/hub to free space, keeping it inside the safety guides and off other text', () => {
    const d = base();
    expect(hasKeepOutOverlap(d, t, m)).toBe(true);
    const r = autoFixOverlaps(d, t, m);
    expect(r.moved.length).toBeGreaterThan(0);
    expect(r.remaining).toEqual([]);
    expect(hasKeepOutOverlap(r.design, t, m)).toBe(false);
    const S = safeRect(t);
    const blocks = renderLabel(r.design, t, 'B', m).blocks;
    for (const b of blocks) {
      expect(b.ink.x).toBeGreaterThanOrEqual(S.x - 0.01);
      expect(b.ink.y + b.ink.h).toBeLessThanOrEqual(S.y + S.h + 0.01);
    }
    const movedIds = new Set(r.moved.map((x) => x.id));
    for (const a of blocks.filter((b) => movedIds.has(b.id))) for (const b of blocks.filter((x) => x !== a)) expect(hit(a.ink, b.ink)).toBe(false);
    expect(renderLabel(r.design, t, 'B', m).warnings.some((w) => /overlaps the artwork\/cut region/.test(w.message))).toBe(false);
  });

  it('does not touch locked blocks, text size or the template, and reports what it could not move', () => {
    const d = base({ title: true });
    const r = autoFixOverlaps(d, t, m);
    expect(r.design.manual.B.title).toEqual(d.manual.B.title);
    expect(r.remaining.some((x) => x.id === 'title' && /locked/.test(x.reason))).toBe(true);
    expect(r.design.style.trackSizePt).toBe(d.style.trackSizePt);
    expect(r.design.templateId).toBe(d.templateId);
  });

  it('does nothing when nothing overlaps', () => {
    const d: Design = { ...defaultDesign, templateId: t.id };
    const r = autoFixOverlaps(d, t, m);
    expect(r.design).toBe(d);
    expect(r.moved).toEqual([]);
  });

  it('works from an automatic layout (switches to manual only when something has to move)', () => {
    const sq = getTemplate('cl-sq')!;
    const many = Array.from({ length: 12 }, (_, i) => `Track number ${i + 1} title`).join('\n');
    const d: Design = { ...defaultDesign, templateId: sq.id, sides: { A: { ...defaultDesign.sides.A, tracksText: many }, B: { ...defaultDesign.sides.B, tracksText: many } } };
    const r = autoFixOverlaps(d, sq, m);
    expect(r.switchedToManual || r.design === d).toBe(true);
    for (const x of r.remaining) expect(x.reason).toBeTruthy();
  });
});
