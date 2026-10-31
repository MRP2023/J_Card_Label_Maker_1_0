import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commit, createHistory, LIMIT, redo, undo } from '../src/core/history';
import { defaultCrop, defaultDesign, defaultSide, type Design } from '../src/core/model';
import { renderLabel, seedManual, seedManualPositions } from '../src/core/render';
import { clampCrop, focalToFrame, imagePlacement } from '../src/core/style';
import { getTemplate, isUsable, keepOuts, safeRect, TEMPLATES } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const measure = createPdfkitMeasurer();
const cl4rc = getTemplate('cl4rc-standard-2024')!;
const vector = TEMPLATES.filter(isUsable);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const manual = (extra: Partial<Design> = {}): Design => ({ ...defaultDesign, style: { ...defaultDesign.style, layoutMode: 'manual' }, ...extra });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;

describe('undo / redo', () => {
  it('commits, undoes and redoes', () => {
    let h = createHistory('a');
    h = commit(h, 'b'); h = commit(h, 'c');
    expect(h.present).toBe('c');
    h = undo(h); expect(h.present).toBe('b');
    h = undo(h); expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h); // nothing to undo is a no-op
    h = redo(h); expect(h.present).toBe('b');
    h = redo(h); expect(h.present).toBe('c');
    expect(canRedo(h)).toBe(false);
  });

  it('a new edit after an undo discards the redo branch', () => {
    let h = commit(commit(createHistory(1), 2), 3);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = commit(h, 9);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(9);
  });

  it('rapid edits with the same key (drag, typing, slider) collapse into one undo step', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 20; i++) h = commit(h, i, 'drag:tracks', 1000 + i * 10);
    expect(h.past.length).toBe(1);
    expect(undo(h).present).toBe(0);
    // a different key, or a pause, starts a new step
    h = commit(h, 100, 'other', 1300);
    expect(h.past.length).toBe(2);
    h = commit(h, 101, 'other', 9000);
    expect(h.past.length).toBe(3);
  });

  it('ignores no-op commits and caps memory', () => {
    const h = createHistory({ a: 1 });
    expect(commit(h, h.present)).toBe(h);
    let big = createHistory(0);
    for (let i = 1; i <= LIMIT + 50; i++) big = commit(big, i, null);
    expect(big.past.length).toBe(LIMIT);
  });
});

describe('artwork cropping and opacity', () => {
  it('the artwork always covers the whole frame, for any zoom and focus', () => {
    const F = { w: 91.86, h: 44 };
    for (const [iw, ih] of [[400, 200], [200, 400], [1000, 1000], [1, 1]]) {
      for (const zoom of [1, 1.7, 3, 9, 0.2]) for (const cx of [-1, 0, 0.3, 0.5, 1, 2]) for (const cy of [-1, 0, 0.5, 1, 2]) {
        const p = imagePlacement(F.w, F.h, iw, ih, { zoom, cx, cy });
        expect(p.x).toBeLessThanOrEqual(1e-9);
        expect(p.y).toBeLessThanOrEqual(1e-9);
        expect(p.x + p.w).toBeGreaterThanOrEqual(F.w - 1e-9);
        expect(p.y + p.h).toBeGreaterThanOrEqual(F.h - 1e-9);
        expect(p.w / p.h).toBeCloseTo(iw / ih, 6); // never distorted
      }
    }
    expect(clampCrop({ zoom: 99, cx: -3, cy: 4 })).toEqual({ zoom: 4, cx: 0, cy: 1 });
  });

  it('zooming in makes the artwork larger, and the focus point moves with the crop', () => {
    const a = imagePlacement(90, 40, 400, 200, { zoom: 1, cx: 0.5, cy: 0.5 });
    const b = imagePlacement(90, 40, 400, 200, { zoom: 2, cx: 0.5, cy: 0.5 });
    expect(b.w).toBeCloseTo(a.w * 2, 6);
    const left = imagePlacement(90, 40, 400, 200, { zoom: 2, cx: 0, cy: 0.5 });
    const right = imagePlacement(90, 40, 400, 200, { zoom: 2, cx: 1, cy: 0.5 });
    expect(left.x).toBeGreaterThan(right.x);
  });

  it('maps the focal area of the artwork into the label frame under the crop', () => {
    const f = focalToFrame({ x: 0.5, y: 0, w: 0.5, h: 1 }, 90, 40, 400, 200, defaultCrop)!;
    expect(f.x).toBeGreaterThan(30);
    expect(f.x + f.w).toBeLessThanOrEqual(90 + 1e-9);
    expect(focalToFrame({ x: 0, y: 0, w: 0.1, h: 0.1 }, 90, 40, 400, 200, { zoom: 3, cx: 1, cy: 1 })).toBeNull(); // cropped out
  });

  it('crop and per-side opacity reach the SVG; the two sides stay independent', () => {
    const d: Design = {
      ...defaultDesign,
      assets: [{ id: 'art', kind: 'art', name: 'a', dataUrl: PNG, width: 400, height: 200 }],
      sides: { A: { ...defaultSide('SIDE A', 'x | 1:00'), backgroundAssetId: 'art', bgOpacity: 0.35, bgCrop: { zoom: 2, cx: 0.2, cy: 0.5 } }, B: { ...defaultSide('SIDE B', 'y | 1:00'), backgroundAssetId: 'art' } },
    };
    const a = renderLabel(d, cl4rc, 'A', measure).svg;
    const b = renderLabel(d, cl4rc, 'B', measure).svg;
    expect(a).toContain('opacity="0.35"');
    expect(b).toContain('opacity="1"');
    const wOf = (svg: string) => +svg.match(/<image x="[-\d.]+" y="[-\d.]+" width="([\d.]+)"/)![1];
    expect(wOf(a)).toBeGreaterThan(wOf(b) * 1.9);
  });
});

describe('manual editing stays inside the valid artwork area', () => {
  for (const t of vector) {
    it(`${t.id}: any position, however wild, is clamped into the safe area`, () => {
      const S = safeRect(t);
      const wild = { x: -50, y: 500, w: 30 };
      const d = manual({ manual: { A: { title: wild, artist: { x: 500, y: -50, w: 30 }, meta: { x: 90, y: 90, w: 30 }, heading: wild, tracks: { x: 400, y: 400, w: 30 } }, B: {} } });
      const r = renderLabel(d, t, 'A', measure);
      for (const b of r.blocks) {
        expect(b.ink.x).toBeGreaterThanOrEqual(S.x - 0.02);
        expect(b.ink.y).toBeGreaterThanOrEqual(S.y - 0.02);
        expect(b.ink.x + b.ink.w).toBeLessThanOrEqual(S.x + S.w + 0.02);
        expect(b.ink.y + b.ink.h).toBeLessThanOrEqual(S.y + S.h + 0.02);
      }
      expect(r.warnings.some((w) => /moved back inside the safe area/.test(w.message))).toBe(true);
    });
  }

  it('seeding manual mode from the planner keeps every element where the planner put it', () => {
    const { manual: m, trackGroups, stylePatch } = seedManual({ ...defaultDesign, sides: { A: defaultSide('SIDE A', 'a | 1:00\nb | 1:00\nc | 1:00\nd | 1:00\ne | 1:00\nf | 1:00'), B: defaultSide('SIDE B', 'a | 1:00\nb | 1:00\nc | 1:00') } }, cl4rc, measure);
    expect(trackGroups.A.reduce((x, y) => x + y, 0)).toBe(6);
    expect(trackGroups.B.reduce((x, y) => x + y, 0)).toBe(3);
    const d: Design = { ...manual({ manual: m, trackGroups, style: { ...defaultDesign.style, ...stylePatch, layoutMode: 'manual' } }), sides: { A: defaultSide('SIDE A', 'a | 1:00\nb | 1:00\nc | 1:00\nd | 1:00\ne | 1:00\nf | 1:00'), B: defaultSide('SIDE B', 'a | 1:00\nb | 1:00\nc | 1:00') } };
    const auto = renderLabel({ ...d, style: { ...d.style, layoutMode: 'auto' } }, cl4rc, 'A', measure);
    const man = renderLabel(d, cl4rc, 'A', measure);
    for (const id of ['title', 'artist', 'meta', 'heading']) {
      const x = auto.blocks.find((b) => b.id === id), y = man.blocks.find((b) => b.id === id);
      if (!x) { expect(y).toBeUndefined(); continue; } // the planner may merge the side heading into the catalogue line
      if (!y) throw new Error(`manual layout lost the ${id} block`);
      expect(y.x).toBeCloseTo(x.x, 1);
      expect(y.y).toBeCloseTo(x.y, 1);
    }
    expect(man.groups).toEqual(trackGroups.A);
    expect(man.blocks.filter((b) => b.id.startsWith('tracks')).length).toBe(trackGroups.A.length);
    expect(man.warnings.filter((w) => w.level === 'warning')).toEqual([]);
    expect(Object.keys(seedManualPositions(d, cl4rc, 'A', measure)).length).toBeGreaterThan(4);
  });

  it('track groups are independent draggable blocks that follow edits to the tracklist', () => {
    const d = manual({ trackGroups: { A: [2, 2], B: [] }, manual: { A: { tracks: { x: 4, y: 4, w: 30 }, tracks2: { x: 50, y: 4, w: 30 } }, B: {} } });
    const r = renderLabel(d, cl4rc, 'A', measure);
    const g1 = r.blocks.find((b) => b.id === 'tracks')!, g2 = r.blocks.find((b) => b.id === 'tracks2')!;
    expect(g2.x).toBeGreaterThan(g1.x + 20);
    // the user adds a track: the extra track joins the last group, nothing is dropped
    const longer = { ...d, sides: { ...d.sides, A: { ...d.sides.A, tracksText: d.sides.A.tracksText + '\nFifth | 1:00' } } };
    expect(renderLabel(longer, cl4rc, 'A', measure).svg).toContain('Fifth');
    // the user removes tracks: groups shrink to match
    const shorter = { ...d, sides: { ...d.sides, A: { ...d.sides.A, tracksText: 'Only | 1:00' } } };
    expect(renderLabel(shorter, cl4rc, 'A', measure).svg).toContain('Only');
  });

  it('resizing a logo changes its size, and a text block width changes its wrapping', () => {
    const asset = { id: 'logo', kind: 'logo' as const, name: 'l', dataUrl: PNG, width: 300, height: 100 };
    const small = renderLabel(manual({ assets: [asset], style: { ...manual().style, logoAssetId: 'logo' }, manual: { A: { logo: { x: 5, y: 5, w: 12 } }, B: {} } }), cl4rc, 'A', measure);
    const big = renderLabel(manual({ assets: [asset], style: { ...manual().style, logoAssetId: 'logo' }, manual: { A: { logo: { x: 5, y: 5, w: 24 } }, B: {} } }), cl4rc, 'A', measure);
    const wOf = (svg: string) => +svg.match(/<image data-role="logo"[^>]* width="([\d.]+)"/)![1];
    expect(wOf(big.svg)).toBeCloseTo(wOf(small.svg) * 2, 1);
    const narrow = renderLabel(manual({ release: { ...defaultDesign.release, title: 'A Very Long Album Title Indeed' }, manual: { A: { title: { x: 5, y: 5, w: 20 } }, B: {} } }), cl4rc, 'A', measure);
    const wide = renderLabel(manual({ release: { ...defaultDesign.release, title: 'A Very Long Album Title Indeed' }, manual: { A: { title: { x: 5, y: 5, w: 70 } }, B: {} } }), cl4rc, 'A', measure);
    expect(narrow.blocks.find((b) => b.id === 'title')!.h).toBeGreaterThan(wide.blocks.find((b) => b.id === 'title')!.h);
  });

  it('locked elements are marked in the editor and offer no resize handle; unlocked selected ones do', () => {
    const base = manual({ manual: { A: { title: { x: 5, y: 5, w: 30 } }, B: {} } });
    const locked = renderLabel({ ...base, locked: { A: { title: true }, B: {} } }, cl4rc, 'A', measure, { preview: true, selected: 'title' });
    const free = renderLabel(base, cl4rc, 'A', measure, { preview: true, selected: 'title' });
    expect(locked.svg).toMatch(/data-drag="title"[^>]*cursor:not-allowed/);
    expect(locked.svg).not.toContain('data-resize="title"');
    expect(free.svg).toContain('data-resize="title"');
    expect(free.svg).toMatch(/data-drag="title"[^>]*cursor:move/);
  });

  it('editor-only overlays never reach the exported artwork', () => {
    const r = renderLabel(manual(), cl4rc, 'A', measure);
    for (const marker of ['data-drag', 'data-resize', '#ff9900', '#b05bff']) expect(r.svg).not.toContain(marker);
  });

  it('every element can be dragged from automatic layout too (hit areas exist for every block and track group)', () => {
    const r = renderLabel({ ...defaultDesign }, cl4rc, 'A', measure, { preview: true });
    for (const id of ['title', 'artist', 'meta', 'heading', 'tracks']) expect(r.svg).toContain(`data-drag="${id}"`);
  });
});

describe('ornaments, scrim and background colour', () => {
  const withOrnament = (kind: Design['style']['ornament']['kind']): Design => ({ ...defaultDesign, style: { ...defaultDesign.style, ornament: { kind, opacity: 0.6, color: 'accent' } } });

  for (const kind of ['frame', 'rules', 'stripes', 'grid', 'dots', 'scanlines'] as const) {
    for (const t of vector) {
      it(`${kind} on ${t.id}: drawn inside the clipped artwork group, never moves the template geometry, never touches the window`, () => {
        const r = renderLabel(withOrnament(kind), t, 'A', measure, { guides: { cut: true, bleed: true, safety: true } });
        const group = r.svg.match(/<g id="artwork-A"[\s\S]*?<\/g><\/g>|<g id="artwork-A"[\s\S]*$/)![0];
        const S = safeRect(t), C = t.cut!.bbox;
        const margin = Math.max(S.y - C.y, C.y + C.h - (S.y + S.h));
        if (kind === 'stripes' && margin < 0.45) expect(group).not.toContain('data-ornament'); // no room outside the text area: skipped, not forced
        else expect(group).toContain(`data-ornament="${kind}"`);
        expect(r.svg).toContain(`d="${t.cut!.d}`); // cut path untouched
        // ornaments are part of the clipped artwork, so the source bleed frame still bounds them
        if (r.svg.includes('data-ornament')) expect(r.svg.indexOf('data-ornament')).toBeLessThan(r.svg.indexOf('id="cut-A"'));
        expect(r.warnings.filter((w) => w.level === 'warning')).toEqual([]);
        for (const k of keepOuts(t)) expect(k.w).toBeGreaterThan(0);
      });
    }
  }

  it('the edge stripes sit entirely in the margin outside the safe area, so they never collide with text', () => {
    for (const t of vector) {
      const r = renderLabel(withOrnament('stripes'), t, 'A', measure);
      const S = safeRect(t);
      const stripes = [...r.svg.matchAll(/<rect x="-5" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)].map((m) => ({ x: S.x, w: S.w, y: +m[1], h: +m[2] }));
      for (const st of stripes) {
        expect(overlaps(st, S)).toBe(false);
        for (const b of r.blocks) expect(overlaps(st, b.ink)).toBe(false);
      }
      expect([0, 3]).toContain(stripes.length);
    }
  });

  it('a backing plate (scrim) appears behind text only when artwork is present', () => {
    const d: Design = { ...defaultDesign, assets: [{ id: 'art', kind: 'art', name: 'a', dataUrl: PNG, width: 400, height: 200 }], sides: { A: { ...defaultSide('SIDE A', 'a | 1:00'), backgroundAssetId: 'art' }, B: defaultSide('SIDE B', 'b | 1:00') }, style: { ...defaultDesign.style, textScrim: 0.5 } };
    expect(renderLabel(d, cl4rc, 'A', measure).svg).toContain('data-scrim=');
    expect(renderLabel(d, cl4rc, 'B', measure).svg).not.toContain('data-scrim=');
    expect(renderLabel({ ...d, style: { ...d.style, textScrim: 0 } }, cl4rc, 'A', measure).svg).not.toContain('data-scrim=');
  });

  it('per-side background colours and contrast warnings', () => {
    const d: Design = { ...defaultDesign, sides: { A: { ...defaultSide('SIDE A', 'a | 1:00'), backgroundColor: '#123456' }, B: defaultSide('SIDE B', 'b | 1:00') } };
    expect(renderLabel(d, cl4rc, 'A', measure).svg).toContain('fill="#123456"');
    const poor = renderLabel({ ...defaultDesign, style: { ...defaultDesign.style, textColor: '#777777', backgroundColor: '#808080' } }, cl4rc, 'A', measure);
    expect(poor.warnings.some((w) => /Low contrast/.test(w.message))).toBe(true);
  });
});

describe('dragging stays responsive and is one undo step', () => {
  const art = { id: 'art', kind: 'art' as const, name: 'a', dataUrl: PNG, width: 400, height: 200 };
  const base: Design = {
    ...defaultDesign, assets: [art],
    sides: { A: { ...defaultSide('SIDE A', 'a | 1:00\nb | 1:00\nc | 1:00\nd | 1:00\ne | 1:00'), backgroundAssetId: 'art', bgFocal: { x: 0.6, y: 0.1, w: 0.3, h: 0.5 }, bgFocalMore: [{ x: 0.05, y: 0.5, w: 0.2, h: 0.3 }] }, B: defaultSide('SIDE B', 'a | 1:00') },
    style: { ...defaultDesign.style, layoutMode: 'manual' },
  };

  it('the automatic plan is reused when only manual positions, locks or export options change', async () => {
    const { planBoth } = await import('../src/core/plan');
    const a = planBoth({ ...base, manual: { A: { title: { x: 5, y: 5, w: 30 } }, B: {} } }, cl4rc, measure);
    const b = planBoth({ ...base, manual: { A: { title: { x: 9, y: 7, w: 33 } }, B: {} }, locked: { A: { title: true }, B: {} } }, cl4rc, measure);
    expect(b).toBe(a); // same cached result object: nothing was re-planned
    const changed = planBoth({ ...base, sides: { ...base.sides, A: { ...base.sides.A, tracksText: base.sides.A.tracksText + '\nf | 1:00' } } }, cl4rc, measure);
    expect(changed).not.toBe(a); // a real layout input changed, so it is planned again
    const restyled = planBoth({ ...base, style: { ...base.style, trackSizePt: 7 } }, cl4rc, measure);
    expect(restyled).not.toBe(a);
  });

  it('every pointer-move of a manual drag renders quickly (no re-planning)', () => {
    renderLabel(base, cl4rc, 'A', measure); // warm the plan
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) renderLabel({ ...base, manual: { A: { title: { x: 3 + i * 0.5, y: 4 + (i % 10), w: 30 } }, B: {} } }, cl4rc, 'A', measure, { preview: true });
    expect(performance.now() - t0).toBeLessThan(1500); // 60 moves in under 1.5 s, about 25 ms each at the very worst
  });

  it('a slow drag is still one undo step; a second drag of the same element is a separate step', () => {
    let h = createHistory({ x: 0 });
    h = commit(h, { x: 1 }, 'drag:A:title:7', 0, true);
    h = commit(h, { x: 2 }, 'drag:A:title:7', 5000, true); // 5 s later: a slow render
    h = commit(h, { x: 3 }, 'drag:A:title:7', 12000, true);
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toEqual({ x: 0 });
    h = commit(h, { x: 9 }, 'drag:A:title:8', 12100, true); // new pointer-down = new gesture
    expect(h.past).toHaveLength(2);
    // without sticky, the old behaviour applies: coalesce only inside the time window
    let g = createHistory(0);
    g = commit(g, 1, 'k', 0); g = commit(g, 2, 'k', 5000);
    expect(g.past).toHaveLength(2);
  });
});
