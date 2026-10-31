import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/core/color';
import { listFamilies } from '../src/core/fonts';
import { defaultDesign, type Design } from '../src/core/model';
import { composeExport } from '../src/core/page';
import { PRESETS, applyPreset } from '../src/core/presets';
import { renderLabel } from '../src/core/render';
import { styleFor } from '../src/core/style';
import { TEMPLATES, getTemplate, isUsable } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const measure = createPdfkitMeasurer();
const vector = TEMPLATES.filter(isUsable);
const withPreset = (id: string): Design => applyPreset(defaultDesign, id);

describe('design presets', () => {
  it('offers the eight directions requested', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['minimal-underground', 'vintage-80s', 'indie-90s', 'city-pop', 'experimental-electronic', 'industrial-techno', 'punk-diy', 'modern-editorial']);
  });

  it('only use fonts that exist in the font library', () => {
    const refs = new Set(listFamilies().map((f) => f.ref));
    for (const p of PRESETS) for (const r of [p.patch.font, p.patch.headingFont, p.patch.bodyFont]) if (r) expect(refs.has(r)).toBe(true);
  });

  it('are starting points: content, assets, template and export settings are never touched', () => {
    const base: Design = { ...defaultDesign, templateId: 'cl-sq', release: { ...defaultDesign.release, title: 'Mine' }, assets: [{ id: 'a', kind: 'logo', name: 'l', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 }], style: { ...defaultDesign.style, logoAssetId: 'a', logoHeightMm: 11 } };
    for (const p of PRESETS) {
      const out = applyPreset(base, p.id);
      expect(out.release).toEqual(base.release);
      expect(out.assets).toEqual(base.assets);
      expect(out.templateId).toBe('cl-sq');
      expect(out.exportOpts).toEqual(base.exportOpts);
      expect(out.style.logoAssetId).toBe('a');
      expect(out.style.logoHeightMm).toBe(11);
      expect(out.sides.A.tracksText).toBe(base.sides.A.tracksText);
      expect(out.presetId).toBe(p.id);
    }
  });

  it('can be edited afterwards (a preset value is just a style value)', () => {
    const d = withPreset('industrial-techno');
    const edited: Design = { ...d, style: { ...d.style, accentColor: '#00ff00', titleCase: 'none' } };
    const r = renderLabel(edited, getTemplate('cl4rc-standard-2024')!, 'A', measure);
    expect(r.svg).toContain('#00ff00');
  });

  for (const t of vector) {
    describe(`on ${t.id}`, () => {
      for (const p of PRESETS) {
        it(`${p.id}: renders both sides readable, within the safe area, no overflow, good contrast`, () => {
          const d = withPreset(p.id);
          for (const side of ['A', 'B'] as const) {
            const r = renderLabel(d, t, side, measure);
            const bad = r.warnings.filter((w) => w.level === 'warning');
            expect(bad.map((w) => w.message)).toEqual([]);
            const s = styleFor(d, side);
            expect(contrastRatio(s.textColor, s.backgroundColor)).toBeGreaterThanOrEqual(4);
            expect(r.blocks.filter((b) => b.id.startsWith('track-')).length).toBe(side === 'A' ? 4 : 3);
          }
        });
      }
    });
  }

  it('Side B keeps the design language of Side A but can differ in colour (inverted / tinted)', () => {
    const inv = styleFor(withPreset('experimental-electronic'), 'B');
    const a = styleFor(withPreset('experimental-electronic'), 'A');
    expect(inv.backgroundColor).toBe(a.textColor);
    expect(inv.headingFont).toBe(a.headingFont);
    expect(inv.ornament).toEqual(a.ornament);
    const tint = styleFor(withPreset('vintage-80s'), 'B');
    expect(tint.backgroundColor).not.toBe(styleFor(withPreset('vintage-80s'), 'A').backgroundColor);
    expect(contrastRatio(tint.textColor, tint.backgroundColor)).toBeGreaterThanOrEqual(4);
  });

  it('never alter the template geometry or physical export, whatever the preset', () => {
    const t = getTemplate('cl4rc-standard-2024')!;
    for (const p of PRESETS) {
      const d: Design = { ...withPreset(p.id), exportOpts: { ...defaultDesign.exportOpts, mode: 'single' } };
      const out = composeExport(d, t, measure, 'svg');
      expect(out.pages[0].wMm).toBe(t.artboardMm!.w);
      expect(out.pages[0].hMm).toBe(t.artboardMm!.h);
      expect(out.pages[0].svg).toContain(`d="${t.cut!.d}`);
      expect(out.pages[0].svg).toContain(t.bleed!.d);
    }
  });

  it('with a realistic 3:1 artist logo: every preset on every template stays clean on both sides', () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const base: Design = { ...defaultDesign, assets: [{ id: 'logo', kind: 'logo', name: 'l', dataUrl: PNG, width: 600, height: 200 }], style: { ...defaultDesign.style, logoAssetId: 'logo' } };
    for (const t of vector) for (const p of PRESETS) for (const side of ['A', 'B'] as const) {
      const r = renderLabel(applyPreset(base, p.id), t, side, measure);
      expect({ t: t.id, p: p.id, side, warnings: r.warnings.filter((w) => w.level === 'warning').map((w) => w.message) }).toEqual({ t: t.id, p: p.id, side, warnings: [] });
      expect(r.blocks.some((b) => b.id === 'logo')).toBe(true);
    }
  }, 60000);
});
