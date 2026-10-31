import { describe, expect, it } from 'vitest';
import { defaultDesign, releaseOf, type Design } from '../src/core/model';
import { renderLabel } from '../src/core/render';
import { getTemplate } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const m = createPdfkitMeasurer();
const t = getTemplate('cl4rc-standard-2024')!;
const base: Design = { ...defaultDesign, templateId: t.id, release: { ...defaultDesign.release, title: 'Shared Album', artist: 'Shared Artist' } };

describe('per-side album title and artist', () => {
  it('falls back to the shared values when blank', () => {
    expect(releaseOf(base, 'A').title).toBe('Shared Album');
    expect(releaseOf({ ...base, sides: { ...base.sides, B: { ...base.sides.B, title: '  ' } } }, 'B').title).toBe('Shared Album');
  });
  for (const mode of ['auto', 'manual'] as const) {
    it(`prints the Side B override on Side B only (${mode} layout)`, () => {
      const d: Design = { ...base, style: { ...base.style, layoutMode: mode }, sides: { ...base.sides, B: { ...base.sides.B, title: 'Flip Title', artist: 'Flip Artist' } } };
      const a = renderLabel(d, t, 'A', m).svg, b = renderLabel(d, t, 'B', m).svg;
      expect(a).toContain('Shared Album');
      expect(a).toContain('Shared Artist');
      expect(b).toContain('Flip Title');
      expect(b).toContain('Flip Artist');
      expect(b).not.toContain('Shared Album');
      expect(b).not.toContain('Shared Artist');
    });
  }
});
