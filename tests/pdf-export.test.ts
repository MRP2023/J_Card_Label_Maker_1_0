import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { defaultDesign, type Design, type ExportMode } from '../src/core/model';
import { composeExport, CALIBRATION_MM, MM_TO_PT, PAPER_MM } from '../src/core/page';
import { getTemplate, isUsable, TEMPLATES, type LibraryTemplate } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';
import { svgPagesToPdf } from '../server/pdf';
import { paintedBoxes } from './pdfBounds';

const measure = createPdfkitMeasurer();
const TOL = 0.01; // mm
const near = (pt: number, mm: number) => Math.abs(pt / MM_TO_PT - mm) < TOL;

function design(t: LibraryTemplate, mode: ExportMode, extra: Partial<Design['exportOpts']> = {}): Design {
  return { ...defaultDesign, templateId: t.id, exportOpts: { ...defaultDesign.exportOpts, mode, ...extra } };
}

async function exportPdf(d: Design, t: LibraryTemplate) {
  const out = composeExport(d, t, measure, 'pdf');
  expect(out.fits).toBe(true);
  expect(out.warnings.filter((w) => w.level === 'error')).toEqual([]);
  const pdf = await svgPagesToPdf(out.pages, { compress: false });
  return { out, pdf, doc: await PDFDocument.load(pdf) };
}

/** Painted boxes converted to mm in a top-left origin, matching the template's coordinate frame. */
function boxesMm(pdf: Buffer, page: number, pageHmm: number) {
  return paintedBoxes(pdf, page).map((b) => ({ x: b.x / MM_TO_PT, y: pageHmm - (b.y + b.h) / MM_TO_PT, w: b.w / MM_TO_PT, h: b.h / MM_TO_PT }));
}
const has = (boxes: ReturnType<typeof boxesMm>, w: number, h: number) => boxes.filter((b) => Math.abs(b.w - w) < TOL && Math.abs(b.h - h) < TOL);

const vector = TEMPLATES.filter(isUsable);

describe('every vector template family exports at exact physical dimensions', () => {
  for (const t of vector) {
    describe(t.id, () => {
      const cut = t.cut!.bbox;
      const frame = t.frame!;

      it('single mode: page = vendor 1-up artboard, cut path and bleed frame at source positions', async () => {
        const d = design(t, 'single', { calibrationPage: false });
        const { out, doc, pdf } = await exportPdf(d, t);
        expect(doc.getPageCount()).toBe(2);
        const ab = t.artboardMm ?? { w: frame.w, h: frame.h };
        for (let i = 0; i < 2; i++) {
          const { width, height } = doc.getPage(i).getSize();
          expect(near(width, ab.w)).toBe(true);
          expect(near(height, ab.h)).toBe(true);
          expect(out.pages[i].wMm).toBe(ab.w);
          const boxes = boxesMm(pdf, i, ab.h);
          const org = t.artboardMm ? t.frameOrigin! : { x: 0, y: 0 };
          const cuts = has(boxes, cut.w, cut.h);
          expect(cuts.length).toBeGreaterThanOrEqual(1);
          expect(cuts.some((b) => Math.abs(b.x - (org.x + cut.x)) < TOL && Math.abs(b.y - (org.y + cut.y)) < TOL)).toBe(true);
          expect(has(boxes, frame.w, frame.h).length).toBeGreaterThanOrEqual(1); // artwork fills the source bleed frame
        }
      });

      it('desktop mode on A4 and Letter: exact page size, 10 mm calibration square, cut path 1:1', async () => {
        for (const paper of ['A4', 'Letter'] as const) {
          const { doc, pdf } = await exportPdf(design(t, 'desktop', { paper }), t);
          const { width, height } = doc.getPage(0).getSize();
          expect(near(width, PAPER_MM[paper].w)).toBe(true);
          expect(near(height, PAPER_MM[paper].h)).toBe(true);
          const boxes = boxesMm(pdf, 0, PAPER_MM[paper].h);
          expect(has(boxes, CALIBRATION_MM, CALIBRATION_MM).length).toBeGreaterThanOrEqual(1);
          expect(has(boxes, cut.w, cut.h).length).toBeGreaterThanOrEqual(2); // side A and side B
        }
      });

      if (t.sheet) {
        it('sheet mode: original Letter 12-up, 12 cut paths at the source slot positions, plus calibration page', async () => {
          const d = design(t, 'sheet');
          const { doc, pdf } = await exportPdf(d, t);
          expect(doc.getPageCount()).toBe(2);
          expect(near(doc.getPage(0).getSize().width, t.sheet!.paperMm.w)).toBe(true);
          expect(near(doc.getPage(0).getSize().height, t.sheet!.paperMm.h)).toBe(true);
          const boxes = boxesMm(pdf, 0, t.sheet!.paperMm.h);
          const cuts = has(boxes, cut.w, cut.h);
          for (const slot of t.sheet!.slots) {
            expect(cuts.some((b) => Math.abs(b.x - (slot.x + cut.x)) < TOL && Math.abs(b.y - (slot.y + cut.y)) < TOL)).toBe(true);
          }
          expect(has(boxesMm(pdf, 1, PAPER_MM.A4.h), CALIBRATION_MM, CALIBRATION_MM).length).toBeGreaterThanOrEqual(1);
        });
      }
    });
  }
});

describe('export safety rules', () => {
  it('refuses the raster-only Gloss template', () => {
    const t = getTemplate('cl4rc-gloss')!;
    const out = composeExport(design(t, 'single'), t, measure);
    expect(out.fits).toBe(false);
    expect(out.pages).toEqual([]);
    expect(out.warnings[0].level).toBe('error');
  });

  it('never scales: refuses sheet mode for a template without an original 12-up', () => {
    const t = getTemplate('casslabela-roundbottom-2021')!;
    const out = composeExport(design(t, 'sheet'), t, measure);
    expect(out.fits).toBe(false);
  });

  it('cut lines can be turned off and embed no cut stroke colour', () => {
    const t = getTemplate('cl4rc-standard-2024')!;
    const on = composeExport(design(t, 'single'), t, measure).pages[0].svg;
    const off = composeExport(design(t, 'single', { showCut: false }), t, measure).pages[0].svg;
    expect(on).toContain('id="cut-A"');
    expect(off).not.toContain('id="cut-A"');
  });

  it('keeps track text as real PDF text and embeds uploaded images', async () => {
    const t = getTemplate('cl-sq')!;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const d: Design = {
      ...design(t, 'desktop'),
      assets: [{ id: 'l', kind: 'logo', name: 'l.png', dataUrl: png, width: 1, height: 1 }, { id: 'b', kind: 'art', name: 'b.png', dataUrl: png, width: 1, height: 1 }],
      style: { ...defaultDesign.style, logoAssetId: 'l' },
      sides: { A: { ...defaultDesign.sides.A, backgroundAssetId: 'b' }, B: defaultDesign.sides.B },
    };
    const { pdf } = await exportPdf(d, t);
    const s = pdf.toString('latin1');
    expect(s).toMatch(/\bTj\b|\bTJ\b/);
    expect(s).toMatch(/\/BaseFont \/Helvetica/);
    expect((s.match(/\/Subtype \/Image/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
