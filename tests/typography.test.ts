import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_FAMILY, STUDIO_FONTS, faceFor, listFamilies, parseFontInfo, slug, type UploadedFont } from '../src/core/fonts';
import { injectFonts, usedFaceIds } from '../src/core/fontcss';
import { defaultDesign, defaultSide, type Design } from '../src/core/model';
import { MM_TO_PT, composeExport } from '../src/core/page';
import { renderLabel } from '../src/core/render';
import { styleFor } from '../src/core/style';
import { getTemplate } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';
import { toPayload } from '../server/fonts';
import { svgPagesToPdfDetailed } from '../server/pdf';
import { paintedBoxes } from './pdfBounds';

const t = getTemplate('cl4rc-standard-2024')!;
const measure = createPdfkitMeasurer();
const file = (n: string) => readFileSync(`public/fonts/${n}`);
const b64 = (b: Buffer) => b.toString('base64');

/** Copy of a font with its OS/2 fsType overwritten, to simulate a licence that forbids embedding. */
function withFsType(buf: Buffer, fsType: number): Buffer {
  const c = Buffer.from(buf);
  const n = c.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (c.toString('latin1', o, o + 4) === 'OS/2') c.writeUInt16BE(fsType, c.readUInt32BE(o + 8) + 8);
  }
  return c;
}

function uploaded(buf: Buffer, id: string, family?: string, weight: 'regular' | 'bold' = 'regular'): UploadedFont {
  const info = parseFontInfo(buf);
  return { id, family: family ?? info.family, weight, format: info.format, dataBase64: b64(buf), fsType: info.fsType, embeddable: info.embeddable, embedNote: info.embedNote };
}

const design = (style: Partial<Design['style']> = {}, over: Partial<Design> = {}): Design => ({ ...defaultDesign, templateId: t.id, style: { ...defaultDesign.style, ...style }, ...over });
const pdfOf = async (d: Design, opts: { fonts?: ReturnType<typeof toPayload> } = {}) => {
  const out = composeExport({ ...d, exportOpts: { ...d.exportOpts, mode: 'single', calibrationPage: false } }, t, createPdfkitMeasurer(d.fonts), 'pdf');
  return { out, ...(await svgPagesToPdfDetailed(out.pages, { compress: false, fonts: opts.fonts ?? toPayload(d.fonts) })) };
};

describe('font library and licence reading', () => {
  it('reads family names and embedding permission from the bundled fonts', () => {
    const names: Record<string, string> = { 'BebasNeue-Regular.ttf': 'Bebas Neue', 'SpaceMono-Bold.ttf': 'Space Mono', 'DMSerifDisplay-Regular.ttf': 'DM Serif Display', 'Righteous-Regular.ttf': 'Righteous', 'ArchivoBlack-Regular.ttf': 'Archivo Black', 'SpecialElite-Regular.ttf': 'Special Elite' };
    for (const [f, n] of Object.entries(names)) {
      const info = parseFontInfo(file(f));
      expect(info.family).toBe(n);
      expect(info.embeddable).toBe(true);
      expect(info.format).toBe('ttf');
    }
  });

  it('flags fonts whose licence forbids embedding or subsetting', () => {
    const r = parseFontInfo(withFsType(file('BebasNeue-Regular.ttf'), 0x0002));
    expect(r.embeddable).toBe(false);
    expect(r.embedNote).toMatch(/forbids embedding/);
    expect(parseFontInfo(withFsType(file('BebasNeue-Regular.ttf'), 0x0100)).embeddable).toBe(false);
    expect(parseFontInfo(withFsType(file('BebasNeue-Regular.ttf'), 0x0004)).embeddable).toBe(true); // preview & print is fine
  });

  it('rejects things that are not a usable font', () => {
    expect(() => parseFontInfo(Buffer.from('hello world, not a font'))).toThrow(/Not a TrueType/);
    expect(() => parseFontInfo(Buffer.from('wOFF0000000000000000'))).toThrow(/WOFF/);
    expect(() => parseFontInfo(new Uint8Array(4))).toThrow();
  });

  it('lists built-in, studio and uploaded families, grouping uploaded weights', () => {
    const regular = uploaded(file('SpaceMono-Regular.ttf'), 'u1', 'My Mono');
    const bold = uploaded(file('SpaceMono-Bold.ttf'), 'u2', 'My Mono', 'bold');
    const fams = listFamilies([regular, bold]);
    expect(fams.filter((f) => f.source === 'builtin').length).toBe(3);
    expect(fams.filter((f) => f.source === 'studio').length).toBe(STUDIO_FONTS.length);
    const mine = fams.find((f) => f.ref === 'custom:my-mono')!;
    expect(mine.hasBold).toBe(true);
    expect(faceFor('custom:my-mono', true, [regular, bold]).faceId).toBe('custom-u2');
    expect(faceFor('custom:my-mono', false, [regular, bold]).faceId).toBe('custom-u1');
    expect(slug('Space Mono!')).toBe('space-mono');
  });

  it('falls back safely for unknown fonts and missing bold faces', () => {
    expect(faceFor('studio:nope', false).kind).toBe('builtin');
    expect(faceFor('custom:ghost', false, []).css).toBe(FONT_FAMILY.sans);
    expect(faceFor('studio:bebas', true).missingBold).toBe(true);
    expect(faceFor('studio:spacemono', true).faceId).toBe('studio-spacemono-b');
  });
});

describe('typography controls', () => {
  const svgOf = (d: Design, side: 'A' | 'B' = 'A') => renderLabel(d, t, side, measure).svg;

  it('letter spacing is written to the SVG and widens the measured text', () => {
    expect(svgOf(design({ titleTracking: 0.2 }))).toContain('letter-spacing=');
    expect(svgOf(design({ titleTracking: 0, bodyTracking: 0 }))).not.toContain('letter-spacing=');
    const face = faceFor('sans', false);
    expect(measure('Example Album', face, 9, 0.2)).toBeGreaterThan(measure('Example Album', face, 9, 0));
  });

  it('case, weight and alignment', () => {
    expect(svgOf(design({ titleCase: 'upper' }))).toContain('EXAMPLE ALBUM');
    expect(svgOf(design({ titleCase: 'lower' }))).toContain('example album');
    expect(svgOf(design({ trackCase: 'upper' }))).toContain('OPENING THEME');
    expect(svgOf(design({ titleBold: true }))).toContain('font-weight="bold"');
    expect(svgOf(design({ titleBold: false, bodyBold: false, headingFont: 'studio:bebas', bodyFont: 'studio:bebas' }))).not.toContain('font-weight="bold"');
    expect(svgOf(design({ textAlign: 'center' }))).toContain('text-anchor="middle"');
    expect(svgOf(design({ textAlign: 'right' }))).toContain('text-anchor="end"');
  });

  it('line height changes the vertical rhythm of the tracklist', () => {
    const ys = (lh: number) => renderLabel(design({ lineHeight: lh }), t, 'A', measure).blocks.filter((b) => b.id.startsWith('track-')).map((b) => b.y);
    const tight = ys(1.0), loose = ys(1.5);
    expect(loose[1] - loose[0]).toBeGreaterThan(tight[1] - tight[0]);
  });

  it('heading and body fonts are independent, and a missing bold face is reported', () => {
    const d = design({ headingFont: 'studio:dmserif', bodyFont: 'studio:spacemono', titleBold: true });
    const svg = svgOf(d);
    expect(svg).toContain('CLS-studio-dmserif-r');
    expect(svg).toContain('CLS-studio-spacemono-r');
    expect(renderLabel(d, t, 'A', measure).warnings.some((w) => /no bold face/.test(w.message))).toBe(true);
    expect(svgOf(design({ headingFont: 'studio:spacemono', titleBold: true }))).toContain('CLS-studio-spacemono-b');
  });

  it('each side can have its own typography, independent of the other side', () => {
    const d = design({}, { sides: { A: defaultSide('SIDE A', 'One | 1:00\nTwo | 2:00'), B: { ...defaultSide('SIDE B', 'One | 1:00\nTwo | 2:00'), typo: { headingFont: 'studio:righteous', titleCase: 'upper', trackSizePt: 7, textAlign: 'right' } } } });
    expect(styleFor(d, 'A').headingFont).toBeNull();
    expect(styleFor(d, 'B').headingFont).toBe('studio:righteous');
    const a = svgOf(d, 'A'), b = svgOf(d, 'B');
    expect(a).not.toContain('righteous');
    expect(b).toContain('CLS-studio-righteous-r');
    expect(b).toContain('EXAMPLE ALBUM');
    expect(a).toContain('Example Album');
    const titleBlock = (svg: string) => svg.match(/<g data-block="title"[^>]*>(.*?)<\/g>/)![1];
    expect(titleBlock(b)).toContain('text-anchor="end"');
    expect(titleBlock(a)).not.toContain('text-anchor');
  });

  it('a font that is missing from the PDF base set never changes the physical layout size', () => {
    const o = composeExport({ ...design({ headingFont: 'studio:bebas' }), exportOpts: { ...defaultDesign.exportOpts, mode: 'single' } }, t, measure, 'svg');
    expect(o.pages[0].wMm).toBe(t.artboardMm!.w);
  });
});

describe('font embedding in the PDF', () => {
  it('built-in fonts only: nothing is embedded', async () => {
    const { pdf, embedded } = await pdfOf(design());
    expect(embedded).toEqual([]);
    expect(pdf.toString('latin1')).not.toMatch(/\/FontFile/);
  });

  it('studio fonts are embedded as subsets and the text stays real text', async () => {
    const { pdf, embedded, refused } = await pdfOf(design({ headingFont: 'studio:bebas', bodyFont: 'studio:spacemono' }));
    expect(embedded.sort()).toEqual(['studio-bebas-r', 'studio-spacemono-r']);
    expect(refused).toEqual([]);
    const s = pdf.toString('latin1');
    expect(s).toMatch(/\/BaseFont \/[A-Z]{6}\+BebasNeue/);
    expect(s).toMatch(/\/BaseFont \/[A-Z]{6}\+SpaceMono/);
    expect((s.match(/\/FontFile2/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('uploaded fonts whose licence allows it are embedded', async () => {
    const u = uploaded(file('ArchivoBlack-Regular.ttf'), 'up1', 'My Heavy');
    const d = design({ headingFont: 'custom:my-heavy' }, { fonts: [u] });
    const { pdf, embedded } = await pdfOf(d);
    expect(embedded).toContain('custom-up1');
    expect(pdf.toString('latin1')).toMatch(/\/BaseFont \/[A-Z]{6}\+ArchivoBlack/);
  });

  it('uploaded fonts whose licence forbids embedding are not embedded, and the user is warned', async () => {
    const bad = withFsType(file('ArchivoBlack-Regular.ttf'), 0x0002);
    const u = uploaded(bad, 'up2', 'Locked');
    expect(u.embeddable).toBe(false);
    const d = design({ headingFont: 'custom:locked' }, { fonts: [u] });
    expect(renderLabel(d, t, 'A', measure).warnings.some((w) => /forbids embedding/.test(w.message))).toBe(true);
    const { pdf, refused } = await pdfOf(d);
    expect(refused).toContain('custom-up2');
    const s = pdf.toString('latin1');
    expect(s).not.toMatch(/ArchivoBlack/);
    expect(s).toMatch(/\/BaseFont \/Helvetica/); // safe fallback
  });

  it('a tampered request cannot embed a restricted font: the server re-reads the licence bits', async () => {
    const bad = withFsType(file('ArchivoBlack-Regular.ttf'), 0x0002);
    const u = uploaded(bad, 'up3', 'Locked');
    const d = design({ headingFont: 'custom:locked' }, { fonts: [{ ...u, embeddable: true, fsType: 0 }] }); // client lies
    const { pdf, refused, embedded } = await pdfOf(d, { fonts: [{ faceId: 'custom-up3', dataBase64: b64(bad) }] });
    expect(embedded).not.toContain('custom-up3');
    expect(refused).toContain('custom-up3');
    expect(pdf.toString('latin1')).not.toMatch(/ArchivoBlack/);
  });

  it('embedding fonts never changes the physical dimensions of the output', async () => {
    const { pdf, out } = await pdfOf(design({ headingFont: 'studio:bebas', bodyFont: 'studio:spacemono', titleTracking: 0.2 }));
    const H = out.pages[0].hMm;
    const boxes = paintedBoxes(pdf, 0).map((b) => ({ w: b.w / MM_TO_PT, h: b.h / MM_TO_PT, y: H - (b.y + b.h) / MM_TO_PT }));
    expect(boxes.some((b) => Math.abs(b.w - t.cut!.bbox.w) < 0.01 && Math.abs(b.h - t.cut!.bbox.h) < 0.01)).toBe(true);
    expect(out.pages[0].wMm).toBe(t.artboardMm!.w);
  });

  it('measures studio and uploaded fonts with their real metrics', () => {
    const u = uploaded(file('ArchivoBlack-Regular.ttf'), 'm1', 'Heavy');
    const m = createPdfkitMeasurer([u]);
    const w = (face: ReturnType<typeof faceFor>) => m('Example Album', face, 9);
    expect(w(faceFor('studio:bebas', false))).toBeLessThan(w(faceFor('studio:archivoblack', false))); // condensed vs heavy
    expect(w(faceFor('custom:heavy', false, [u]))).toBeCloseTo(w(faceFor('studio:archivoblack', false)), 5);
    expect(w(faceFor('sans', false))).not.toBeCloseTo(w(faceFor('studio:archivoblack', false)), 1);
  });
});

describe('fonts inside a standalone SVG', () => {
  it('injects @font-face rules for the embeddable faces the SVG uses', () => {
    const d = design({ headingFont: 'studio:bebas' });
    const svg = composeExport({ ...d, exportOpts: { ...defaultDesign.exportOpts, mode: 'single' } }, t, measure, 'svg').pages[0].svg;
    expect(usedFaceIds(svg)).toContain('studio-bebas-r');
    const out = injectFonts(svg, (id) => (id === 'studio-bebas-r' ? { bytes: new Uint8Array(file('BebasNeue-Regular.ttf')), format: 'ttf' } : null));
    expect(out).toContain("@font-face{font-family:'CLS-studio-bebas-r'");
    expect(out).toContain('base64,');
    expect(out.indexOf('<style>')).toBeLessThan(out.indexOf('<text'));
    expect(injectFonts(svg, () => null)).toBe(svg); // nothing supplied, nothing injected
  });
});
