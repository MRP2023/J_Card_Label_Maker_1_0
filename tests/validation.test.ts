import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFontInfo, toFontPayload, type UploadedFont } from '../src/core/fonts';
import { defaultDesign, defaultSide, type Design, type ExportMode } from '../src/core/model';
import { composeExport } from '../src/core/page';
import { FIT_TO_PAGE_WARNING, PRINT_INSTRUCTIONS, buildExpectation, buildProof, svgGlyphCount, type ExportExpectation } from '../src/core/proof';
import { TEMPLATES, getTemplate, isUsable } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';
import { svgPagesToPdf } from '../server/pdf';
import { pdfFonts, textShowCount } from '../server/pdfinspect';
import { validateExportPdf } from '../server/validate';

const measure = createPdfkitMeasurer();
const vector = TEMPLATES.filter(isUsable);
const font = (n: string) => readFileSync(`public/fonts/${n}`);
const withFsType = (buf: Buffer, v: number) => { const c = Buffer.from(buf); const n = c.readUInt16BE(4); for (let i = 0; i < n; i++) { const o = 12 + i * 16; if (c.toString('latin1', o, o + 4) === 'OS/2') c.writeUInt16BE(v, c.readUInt32BE(o + 8) + 8); } return c; };
const upl = (buf: Buffer, id: string, family: string): UploadedFont => { const i = parseFontInfo(buf); return { id, family, weight: 'regular', format: i.format, dataBase64: buf.toString('base64'), fsType: i.fsType, embeddable: i.embeddable, embedNote: i.embedNote }; };

const design = (t: string, mode: ExportMode, over: Partial<Design> = {}, opts: Partial<Design['exportOpts']> = {}): Design => ({ ...defaultDesign, templateId: t, exportOpts: { ...defaultDesign.exportOpts, mode, ...opts }, ...over });

async function exportAndValidate(d: Design, tweak?: (e: ExportExpectation) => void) {
  const t = getTemplate(d.templateId)! as ReturnType<typeof getTemplate> & { cut: any; frame: any };
  const m = createPdfkitMeasurer(d.fonts);
  const composed = composeExport(d, t!, m, 'pdf');
  const pdf = await svgPagesToPdf(composed.pages, { fonts: toFontPayload(d.fonts) }); // compressed, like the real export
  const exp = buildExpectation(d, t as never, m, composed);
  tweak?.(exp);
  return { pdf, exp, report: await validateExportPdf(pdf, exp), composed };
}

describe('the exported PDF is verified programmatically', () => {
  for (const t of vector) {
    for (const mode of ['desktop', 'single', 'sheet'] as const) {
      if (mode === 'sheet' && !t.sheet) continue;
      it(`${t.id} / ${mode}: every check passes on the real PDF`, async () => {
        const { report } = await exportAndValidate(design(t.id, mode));
        expect(report.checks.filter((c) => !c.ok)).toEqual([]);
        expect(report.ok).toBe(true);
        const ids = report.checks.map((c) => c.id);
        for (const need of ['page-count', 'page-size-1', 'text-1', 'tracks-A', 'tracks-B', 'clipping', 'fonts-embedded']) expect(ids).toContain(need);
        if (mode !== 'single' || true) expect(ids.some((i) => i.startsWith('cut-'))).toBe(true);
      });
    }
  }

  it('covers Letter desktop, hidden cut lines, and the calibration page', async () => {
    const a = await exportAndValidate(design('cl4rc-standard-2024', 'desktop', {}, { paper: 'Letter' }));
    expect(a.report.ok).toBe(true);
    expect(a.report.checks.find((c) => c.id === 'page-size-1')!.detail).toMatch(/215\.900 × 279\.400/);
    const b = await exportAndValidate(design('cl4rc-standard-2024', 'single', {}, { showCut: false }));
    expect(b.report.ok).toBe(true);
    expect(b.report.checks.some((c) => c.id.startsWith('cut-'))).toBe(false); // cut lines were not drawn, so none are demanded
    const c = await exportAndValidate(design('cl4rc-standard-2024', 'single', {}, { calibrationPage: true }));
    expect(c.report.checks.find((x) => x.id === 'calibration-3')!.ok).toBe(true);
  });

  it('verifies 12-up positioning: 12 cut paths at the original slots', async () => {
    const r = await exportAndValidate(design('cl-wide', 'sheet'));
    const cut = r.report.checks.find((c) => c.id === 'cut-1')!;
    expect(cut.ok).toBe(true);
    expect(cut.label).toMatch(/12 labels/);
  });

  it('every glyph of every track is in the PDF (text-show count equals the visible characters)', async () => {
    const d = design('cl4rc-standard-2024', 'single', { sides: { A: defaultSide('SIDE A', 'Neon Rain | 3:42\nVending Machine Love | 4:10\nLast Train to Shibuya | 3:55'), B: defaultSide('SIDE B', 'Arcade Heart | 3:30') } });
    const r = await exportAndValidate(d);
    expect(r.exp.pages[0].textGlyphs).toBe(svgGlyphCount(r.composed.pages[0].svg));
    expect(textShowCount(r.pdf, 0)).toBe(r.exp.pages[0].textGlyphs);
    expect(r.report.ok).toBe(true);
  });

  it('with embedded studio fonts and letter-spacing the glyphs still match, and fonts are verified as embedded', async () => {
    const d = design('cl4rc-standard-2024', 'single', {}, {});
    d.style = { ...d.style, headingFont: 'studio:bebas', bodyFont: 'studio:spacemono', titleTracking: 0.2, bodyTracking: 0.05, titleCase: 'upper' };
    const r = await exportAndValidate(d);
    expect(r.report.ok).toBe(true);
    expect(r.exp.embeddedFaces.sort()).toEqual(['studio-bebas-r', 'studio-spacemono-r']);
    expect(pdfFonts(r.pdf).embeddedSubsets.length).toBe(2);
  });

  it('a restricted uploaded font falls back to Helvetica; the validator and proof say so', async () => {
    const u = upl(withFsType(font('ArchivoBlack-Regular.ttf'), 2), 'u1', 'Locked');
    const d = design('cl4rc-standard-2024', 'single', { fonts: [u] });
    d.style = { ...d.style, headingFont: 'custom:locked' };
    const r = await exportAndValidate(d);
    expect(r.exp.fallbackFaces).toEqual(['custom-u1']);
    expect(r.report.ok).toBe(true);
    expect(pdfFonts(r.pdf).embeddedSubsets).toEqual([]);
    const proof = buildProof(d, getTemplate('cl4rc-standard-2024') as never, createPdfkitMeasurer(d.fonts));
    expect(proof.fonts.find((f) => f.status === 'fallback')!.detail).toMatch(/forbids embedding/);
    expect(proof.checks.some((c) => c.id === 'font' && c.level === 'warn')).toBe(true);
  });
});

describe('the validator really catches mistakes', () => {
  const base = () => exportAndValidate(design('cl4rc-standard-2024', 'single'));
  const failedIds = (r: Awaited<ReturnType<typeof base>>) => r.report.checks.filter((c) => !c.ok).map((c) => c.id);

  it('wrong page size', async () => {
    const r = await exportAndValidate(design('cl4rc-standard-2024', 'single'), (e) => { e.pages[0].wMm += 0.1; });
    expect(failedIds(r)).toContain('page-size-1');
  });

  it('cut path of the wrong size', async () => {
    const r = await exportAndValidate(design('cl4rc-standard-2024', 'single'), (e) => { e.cut.w += 0.05; });
    expect(failedIds(r)).toContain('cut-1');
  });

  it('a label placed 0.2 mm away from where it should be', async () => {
    const r = await exportAndValidate(design('cl-nw', 'sheet'), (e) => { e.pages[0].placements[3].x += 0.2; });
    expect(failedIds(r)).toContain('cut-1');
    expect(r.report.checks.find((c) => c.id === 'cut-1')!.detail).toMatch(/not found at/);
  });

  it('a 12-up sheet with a missing slot', async () => {
    const r = await exportAndValidate(design('cl-sq', 'sheet'), (e) => { e.pages[0].placements.push({ side: 'A', x: 150, y: 250 }); });
    expect(failedIds(r)).toContain('cut-1');
  });

  it('missing text (the PDF lacks glyphs the layout expects)', async () => {
    const r = await exportAndValidate(design('cl4rc-standard-2024', 'single'), (e) => { e.pages[0].textGlyphs += 7; });
    expect(failedIds(r)).toContain('text-1');
  });

  it('a missing track at layout level', async () => {
    const r = await exportAndValidate(design('cl4rc-standard-2024', 'single'), (e) => { e.tracks.A.placed -= 1; });
    expect(failedIds(r)).toContain('tracks-A');
  });

  it('a calibration square that is not on the page', async () => {
    const r = await exportAndValidate(design('cl4rc-standard-2024', 'single'), (e) => { e.pages[0].hasCalibrationSquare = true; });
    expect(failedIds(r)).toContain('calibration-1');
  });

  it('fonts that should have been embedded but were not', async () => {
    const r = await exportAndValidate(design('cl4rc-standard-2024', 'single'), (e) => { e.embeddedFaces.push('studio-bebas-r'); });
    expect(failedIds(r)).toContain('fonts-embedded');
  });

  it('a PDF made for a different template or mode', async () => {
    const a = await exportAndValidate(design('cl4rc-standard-2024', 'single'));
    const other = await exportAndValidate(design('cl-wide', 'single'));
    expect((await validateExportPdf(a.pdf, other.exp)).ok).toBe(false);
    const sheet = await exportAndValidate(design('cl-wide', 'sheet'));
    expect((await validateExportPdf(sheet.pdf, other.exp)).ok).toBe(false);
  });

  it('text that is clipped by a cutout is reported', async () => {
    const t = getTemplate('cl-sq')!; // the oval window is a real cutout here
    const hole = t.inner[0].bbox;
    const d = design('cl-sq', 'single', { manual: { A: { title: { x: hole.x + 8, y: hole.y + 4, w: 30 } }, B: {} } });
    d.style = { ...d.style, layoutMode: 'manual' };
    const r = await exportAndValidate(d);
    expect(r.exp.clipping.some((c) => /inside a cutout/.test(c))).toBe(true);
    expect(failedIds(r)).toContain('clipping');
    expect(buildProof(d, t as never, measure).canExport).toBe(false);
  });

  it('garbage input is rejected without throwing', async () => {
    const r = await validateExportPdf(Buffer.from('not a pdf'), (await base()).exp);
    expect(r.ok).toBe(false);
  });
});

describe('print proof', () => {
  const t = getTemplate('cl4rc-standard-2024')! as never;

  it('reports dimensions, bleed, safe area, pages, fonts and the print instructions', () => {
    const p = buildProof(design('cl4rc-standard-2024', 'single'), t, measure);
    expect(p.dims.cut.w).toBeCloseTo(88.9, 3);
    expect(p.dims.cut.h).toBeCloseTo(40.919, 3);
    expect(p.dims.frame.w).toBeCloseTo(91.856, 3);
    expect(p.dims.bleedMm!.left).toBeCloseTo(1.472, 3);
    expect(p.dims.safe.w).toBeCloseTo(85.725, 3);
    expect(p.dims.pages.map((x) => x.kind)).toEqual(['artwork', 'artwork', 'calibration']);
    expect(p.sides.map((s) => s.side)).toEqual(['A', 'B']);
    expect(p.sides[0].svg).toContain('id="cut-A"');
    expect(p.sides[0].svg).toContain('#00aeef'); // safety guide drawn in the proof
    expect(p.fonts.every((f) => f.status === 'standard')).toBe(true);
    expect(p.instructions).toEqual(PRINT_INSTRUCTIONS);
    expect(p.instructions.join(' ')).toMatch(/100%/);
    expect(p.instructions.join(' ')).toMatch(/10 mm square/);
  });

  it('warns clearly about Fit to Page', () => {
    const p = buildProof(design('cl4rc-standard-2024', 'desktop'), t, measure);
    expect(p.fitToPageWarning).toBe(FIT_TO_PAGE_WARNING);
    for (const word of ['Fit to page', 'Actual size', 'physical size', '100%']) expect(FIT_TO_PAGE_WARNING).toContain(word);
  });

  it('never claims physical fit is verified', () => {
    const p = buildProof(design('cl4rc-standard-2024', 'desktop'), t, measure);
    const c = p.checks.find((x) => x.id === 'physical-fit')!;
    expect(c.level).toBe('warn');
    expect(c.text).toMatch(/NOT verified/);
  });

  it('shows tracks placed per side, and blocks export when text does not fit', () => {
    const ok = buildProof(design('cl4rc-standard-2024', 'desktop'), t, measure);
    expect(ok.checks.filter((c) => c.id.startsWith('tracks-')).every((c) => c.level === 'ok')).toBe(true);
    expect(ok.canExport).toBe(true);
    const many = Array.from({ length: 40 }, (_, i) => `Song ${i + 1} | 3:00`).join('\n');
    const bad = buildProof(design('cl4rc-standard-2024', 'desktop', { sides: { A: defaultSide('SIDE A', many), B: defaultSide('SIDE B', 'b | 1:00') } }), t, measure);
    expect(bad.checks.some((c) => c.id === 'overflow-A' && c.level === 'error')).toBe(true);
    expect(bad.canExport).toBe(false);
  });

  it('shows embedded fonts', () => {
    const d = design('cl4rc-standard-2024', 'desktop');
    d.style = { ...d.style, headingFont: 'studio:bebas' };
    const p = buildProof(d, t, measure);
    expect(p.fonts.find((f) => f.name.includes('Bebas'))!.status).toBe('embedded');
  });

  it('minimal layout states that tracks are intentionally not printed instead of failing', () => {
    const d = design('cl4rc-standard-2024', 'desktop');
    d.style = { ...d.style, layoutMode: 'minimal' };
    const p = buildProof(d, t, measure);
    expect(p.checks.find((c) => c.id === 'tracks-A')!.level).toBe('warn');
    expect(p.canExport).toBe(true);
  });

  it('the raster-only template cannot be proofed or exported', () => {
    const composed = composeExport(design('cl4rc-gloss', 'single'), getTemplate('cl4rc-gloss')!, measure);
    expect(composed.fits).toBe(false);
  });

  it('text printed on top of other text blocks export; a logo over something only warns', () => {
    const t2 = getTemplate('cl4rc-standard-2024')! as never;
    const d = design('cl4rc-standard-2024', 'desktop', { manual: { A: { title: { x: 10, y: 8, w: 30 }, artist: { x: 10, y: 8.5, w: 30 } }, B: {} } });
    d.style = { ...d.style, layoutMode: 'manual' };
    const p = buildProof(d, t2, measure);
    expect(p.checks.some((c) => c.id === 'overlap-A' && c.level === 'error' && /Title overlaps Artist|Artist overlaps Title/.test(c.text))).toBe(true);
    expect(p.canExport).toBe(false);
    // fixing it unblocks export
    const fixed = { ...d, manual: { A: { title: { x: 3.1, y: 3, w: 40 }, artist: { x: 3.1, y: 8, w: 40 }, meta: { x: 3.1, y: 12.2, w: 40 }, heading: { x: 47.4, y: 3, w: 40 }, tracks: { x: 47.4, y: 7, w: 40 } }, B: {} } };
    expect(buildProof(fixed, t2, measure).checks.filter((c) => c.id === 'overlap-A')).toEqual([]);
  });
});
