import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeImagePixels, type ImageFeatures } from '../src/core/art';
import { contrastRatio } from '../src/core/color';
import { MIN_VARIATION_DISTANCE, applyDirection, directionDistance, sanitizeDirection } from '../src/core/direction';
import { listFamilies } from '../src/core/fonts';
import { analyzeLogoPixels } from '../src/core/logo';
import { defaultDesign, type Design } from '../src/core/model';
import { buildProof } from '../src/core/proof';
import { renderLabel } from '../src/core/render';
import { SCHOOLS, moodOf, suggestSingle, suggestVariation, suggestVariations, type SuggestInput } from '../src/core/suggest';
import { TEMPLATES, isUsable } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';

const measure = createPdfkitMeasurer();
const refs = listFamilies().map((f) => f.ref);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ---------- synthetic images ----------
type RGB = [number, number, number];
function image(w: number, h: number, base: (x: number, y: number) => RGB, discs: { x: number; y: number; r: number; c: RGB }[] = [], noise = 0) {
  const d = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = base(x, y);
    for (const s of discs) if (Math.hypot(x - s.x * w, y - s.y * h) < s.r * w) c = s.c;
    const n = noise ? (rnd() - 0.5) * noise : 0;
    const o = (y * w + x) * 4;
    d[o] = Math.max(0, Math.min(255, c[0] + n)); d[o + 1] = Math.max(0, Math.min(255, c[1] + n)); d[o + 2] = Math.max(0, Math.min(255, c[2] + n)); d[o + 3] = 255;
  }
  return analyzeImagePixels(d, w, h);
}
const DARK = () => image(320, 160, (_x, y) => [20 + y * 0.1, 22, 40 + y * 0.2], [{ x: 0.7, y: 0.4, r: 0.1, c: [60, 255, 160] }]);
const WARM = () => image(320, 160, (_x, y) => [200 - y * 0.2, 140, 90], [{ x: 0.3, y: 0.5, r: 0.12, c: [230, 90, 40] }]);
const LIGHT = () => image(320, 160, (_x, y) => [236, 232 - y * 0.1, 240], [{ x: 0.5, y: 0.5, r: 0.1, c: [90, 120, 200] }]);
const BUSY = () => image(320, 160, () => [120, 110, 100], [], 180);
const FLAT = () => image(160, 80, () => [128, 128, 128]);

function logo(ink: RGB, bg: [number, number, number, number], w = 600, h = 200) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; const inside = Math.hypot(x - w / 2, y - h / 2) < h * 0.35;
    const p = inside ? [...ink, 255] : bg; d.set(p, o);
  }
  return { stats: { ...analyzeLogoPixels(d, w, h) }, aspect: w / h, heightMm: 8 };
}

const base = (over: Partial<SuggestInput> = {}): SuggestInput => ({ release: { title: 'Midnight Arcade', artist: 'Tokyo Static' }, tracks: { A: 5, B: 4 }, art: null, refs: [], logo: null, ...over });
const INPUTS: [string, SuggestInput][] = [
  ['no references', base()],
  ['dark artwork', base({ art: DARK() })],
  ['warm artwork + reference', base({ art: WARM(), refs: [LIGHT()] })],
  ['light artwork', base({ art: LIGHT() })],
  ['busy artwork', base({ art: BUSY() })],
  ['flat artwork', base({ art: FLAT() })],
  ['references only', base({ refs: [DARK(), WARM()] })],
  ['with a black logo', base({ art: DARK(), logo: logo([10, 10, 10], [0, 0, 0, 0]) })],
];

describe('image features (measured from pixels, offline)', () => {
  it('measures brightness, warmth, busyness and subject position', () => {
    const dark = DARK(), light = LIGHT(), warm = WARM(), cool = DARK();
    expect(dark.meanLuminance).toBeLessThan(light.meanLuminance);
    expect(warm.warmth).toBeGreaterThan(0.1);
    expect(cool.warmth).toBeLessThan(warm.warmth);
    expect(BUSY().busyness).toBeGreaterThan(FLAT().busyness + 0.3);
    const f = warm.focals[0];
    expect(f.x).toBeLessThan(0.3); expect(f.x + f.w).toBeGreaterThan(0.3);
    expect(FLAT().focals).toEqual([]);
    expect(warm.palette.swatches.length).toBeGreaterThan(1);
  });

  it('collapses artwork and references into one mood', () => {
    expect(moodOf(base()).hasImages).toBe(false);
    const m = moodOf(base({ art: DARK(), refs: [DARK()] }));
    expect(m.hasImages).toBe(true);
    expect(m.luminance).toBeLessThan(0.4);
  });
});

describe('rule-based suggestions', () => {
  for (const [label, input] of INPUTS) {
    describe(label, () => {
      for (let s = 0; s < SCHOOLS.length; s++) for (let round = 0; round < 3; round++) {
        it(`${SCHOOLS[s].name}, alternative ${round + 1}: a complete, valid, readable direction`, () => {
          const d = suggestVariation(input, s, round);
          expect(JSON.stringify(sanitizeDirection(d, refs))).toBe(JSON.stringify(d)); // already valid: nothing needed clamping
          expect(contrastRatio(d.palette.text, d.palette.background)).toBeGreaterThanOrEqual(4.5);
          expect(refs).toContain(d.typography.headingFont); expect(refs).toContain(d.typography.bodyFont);
          expect(d.typography.trackSizePt).toBeGreaterThanOrEqual(5);
          expect(d.concept.name.length).toBeGreaterThan(2);
          expect(d.rationale.length).toBeGreaterThan(40);
          expect(d.hierarchy.length).toBeGreaterThan(0);
          expect(d.composition.layoutMode).toBe('auto'); // never hides the tracklist
        });
      }

      it('the three schools are genuinely different directions, for every combination of alternatives', () => {
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
          const [x, y, z] = [suggestVariation(input, 0, a), suggestVariation(input, 1, b), suggestVariation(input, 2, c)];
          for (const [p, q] of [[x, y], [x, z], [y, z]]) expect(directionDistance(p, q)).toBeGreaterThanOrEqual(MIN_VARIATION_DISTANCE);
        }
      });

      it('is deterministic: the same inputs always give the same suggestions', () => {
        expect(JSON.stringify(suggestVariations(input))).toBe(JSON.stringify(suggestVariations(input)));
      });
    });
  }

  it('regenerating one suggestion rotates to a different alternative that still differs from the ones you keep', () => {
    const input = INPUTS[1][1];
    const first = suggestVariations(input);
    const keep = [first[0].direction, first[2].direction];
    const seen = new Set<string>([first[1].direction.concept.name]);
    let rounds = first.map((f) => f.round);
    for (let i = 0; i < 3; i++) {
      const [r] = suggestVariations(input, rounds.map((x, k) => (k === 1 ? x + 1 : x)), [1], keep);
      rounds = rounds.map((x, k) => (k === 1 ? r.round : x));
      expect(r.index).toBe(1);
      for (const k of keep) expect(directionDistance(k, r.direction)).toBeGreaterThanOrEqual(MIN_VARIATION_DISTANCE);
      seen.add(r.direction.concept.name);
    }
    expect(seen.size).toBe(3); // cycles through all three alternatives of the school
  });

  it('adapts to the content: long tracklists get smaller, plainer type; long titles get smaller titles', () => {
    const short = suggestVariation(base({ tracks: { A: 4, B: 3 } }), 1);
    const long = suggestVariation(base({ tracks: { A: 14, B: 12 } }), 1);
    expect(long.typography.trackSizePt).toBeLessThan(short.typography.trackSizePt);
    expect(long.typography.trackCase).toBe('none'); // vintage alt 0 is uppercase; long lists are not
    expect(long.risks.some((r) => /Long tracklist/.test(r))).toBe(true);
    const longTitle = suggestVariation(base({ release: { title: 'An Exceptionally Long Album Title Indeed', artist: 'Tokyo Static' } }), 0);
    expect(longTitle.typography.titleSizePt).toBeLessThan(suggestVariation(base(), 0).typography.titleSizePt);
  });

  it('only uses fonts that are available, falling back to Helvetica otherwise', () => {
    const d = suggestVariation(base({ available: ['sans', 'serif', 'mono'] }), 2);
    expect([d.typography.headingFont, d.typography.bodyFont].every((f) => ['sans', 'serif', 'mono'].includes(f))).toBe(true);
  });

  it('uses the artwork sensibly: calmer art stays stronger, busy art is toned down, the crop follows the subject', () => {
    const calm = suggestVariation(base({ art: LIGHT() }), 0);
    const busy = suggestVariation(base({ art: BUSY() }), 0);
    expect(calm.artwork.opacity).toBeGreaterThan(busy.artwork.opacity);
    const warm = suggestVariation(base({ art: WARM() }), 1);
    expect(warm.artwork.use).toBe('both');
    expect(warm.artwork.focal).not.toBeNull();
    expect(warm.artwork.cx).toBeLessThan(0.5); // the subject is on the left
    expect(suggestVariation(base(), 0).artwork.use).toBe('none');
    expect(busy.composition.textScrim).toBeGreaterThan(0);
    expect(busy.risks.some((r) => /busy/.test(r))).toBe(true);
  });

  it('recommends a logo treatment from measured contrast (the file itself is never changed)', () => {
    const blackOnDark = suggestVariation(base({ logo: logo([10, 10, 10], [0, 0, 0, 0]) }), 2);
    expect(blackOnDark.logo.treatment).toBe('lighten');
    const blackOnPaper = suggestVariation(base({ logo: logo([10, 10, 10], [0, 0, 0, 0]) }), 0);
    expect(blackOnPaper.logo.treatment).toBe('keep');
    expect(suggestVariation(base({ logo: logo([10, 10, 10], [255, 255, 255, 255]) }), 0).logo.treatment).toBe('remove-background');
    expect(suggestVariation(base({ logo: logo([250, 250, 250], [0, 0, 0, 0]) }), 0).logo.treatment).toBe('darken');
    expect(suggestVariation(base(), 0).logo.treatment).toBe('keep');
  });

  it('suggestSingle picks the school that matches the measured mood, and explains why', () => {
    expect(suggestSingle(base({ art: DARK() })).school.id).toBe('experimental-contemporary');
    expect(suggestSingle(base({ art: WARM() })).school.id).toBe('vintage-analog-underground');
    expect(suggestSingle(base({ art: LIGHT() })).school.id).toBe('minimal-editorial');
    const none = suggestSingle(base());
    expect(none.school.id).toBe('minimal-editorial');
    expect(none.direction.rationale).toMatch(/No references/);
    expect(suggestSingle(base({ art: DARK() })).direction.rationale).toMatch(/dark/);
  });

  it('palettes follow the references: different artwork gives different colours', () => {
    expect(suggestVariation(base({ art: WARM() }), 0).palette.accent).not.toBe(suggestVariation(base({ art: DARK() }), 0).palette.accent);
    expect(suggestVariation(base({ art: DARK() }), 2).palette.background).not.toBe(suggestVariation(base({ art: WARM() }), 2).palette.background);
  });
});

describe('suggestions drive the real design engine', () => {
  const art = { id: 'art', kind: 'art' as const, name: 'a', dataUrl: PNG, width: 320, height: 160 };
  for (const t of TEMPLATES.filter(isUsable)) {
    for (let s = 0; s < 3; s++) for (let alt = 0; alt < 3; alt++) {
      it(`${t.id} / ${SCHOOLS[s].name} #${alt + 1}: applies cleanly, both sides readable, export not blocked`, () => {
        const input = INPUTS[2][1];
        const dir = suggestVariation(input, s, alt);
        const d: Design = applyDirection({ ...defaultDesign, templateId: t.id, assets: [art] }, dir, { artworkAssetId: 'art' });
        for (const side of ['A', 'B'] as const) {
          const r = renderLabel(d, t, side, measure);
          expect(r.warnings.filter((w) => w.level === 'warning' && /do not fit|extends outside|overlaps [A-Z]/.test(w.message))).toEqual([]);
        }
        expect(buildProof(d, t as never, measure).checks.filter((c) => c.level === 'error')).toEqual([]);
      });
    }
  }

  it('the geometry is untouched by any suggestion', () => {
    const t = TEMPLATES.filter(isUsable)[3];
    const before = JSON.stringify(t);
    const dir = suggestVariation(INPUTS[1][1], 2, 1);
    applyDirection({ ...defaultDesign, templateId: t.id }, dir);
    expect(JSON.stringify(t)).toBe(before);
    expect(JSON.stringify(dir)).not.toMatch(/"cut"|"bleed"|"outline"|"path"/);
  });
});

describe('works fully offline with no AI service', () => {
  const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === 'dist' ? [] : e.isDirectory() ? files(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const code = [...files('src'), ...files('server'), ...files('scripts'), 'index.html', 'package.json', 'vite.config.ts'].filter((f) => /\.(tsx?|html|json|py)$/.test(f) && !f.endsWith('library.json') && !f.endsWith('template_inventory.json'));

  it('no source file references an AI vendor, API key or hosted model', () => {
    for (const f of code) expect(readFileSync(f, 'utf8'), f).not.toMatch(/anthropic|claude|openai|api[_-]?key|x-api-key|sk-ant-/i);
  });

  it('there is no AI dependency and no environment-based configuration', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((k) => /anthropic|openai|dotenv|langchain|cross-env/.test(k))).toEqual([]);
    for (const f of code.filter((x) => /server|scripts|src/.test(x))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/dotenv|process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/);
  });

  it('the only network requests are to this app itself (relative URLs)', () => {
    for (const f of code.filter((x) => /\.tsx?$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/fetch\(\s*([`'"])([^`'"]*)/g)) expect(m[2].startsWith('/'), `${f}: fetch(${m[2]})`).toBe(true);
      expect(src, f).not.toMatch(/XMLHttpRequest|WebSocket\(|new EventSource|navigator\.sendBeacon/);
    }
  });

  it('the suggestion engine is pure: it needs no I/O at all', () => {
    const src = readFileSync('src/core/suggest.ts', 'utf8');
    expect(src).not.toMatch(/fetch\(|node:|require\(|process\./);
  });
});
