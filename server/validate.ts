/**
 * Programmatic verification of an exported PDF against what it must contain (ExportExpectation, from src/core/proof.ts).
 * It reads the real file: page sizes, painted cut paths and artwork frames at their exact positions, the calibration square,
 * embedded fonts, glyph counts (no missing text) and layout-level checks (all tracks placed, nothing clipped).
 */
import { PDFDocument } from 'pdf-lib';
import type { ExportExpectation } from '../src/core/proof';
import { MM_TO_PT } from '../src/core/page';
import { paintedBoxes, pdfFonts, textShowCount } from './pdfinspect';

export interface ValidationCheck { id: string; ok: boolean; label: string; detail: string }
export interface ValidationReport { ok: boolean; checks: ValidationCheck[]; summary: string }

const TOL = 0.01; // mm

export async function validateExportPdf(pdf: Buffer, exp: ExportExpectation): Promise<ValidationReport> {
  const checks: ValidationCheck[] = [];
  const add = (id: string, ok: boolean, label: string, detail: string) => checks.push({ id, ok, label, detail });

  let doc: PDFDocument;
  try { doc = await PDFDocument.load(pdf); } catch (e) { return { ok: false, checks: [{ id: 'parse', ok: false, label: 'PDF can be read', detail: (e as Error).message }], summary: 'The PDF could not be read.' }; }

  add('page-count', doc.getPageCount() === exp.pages.length, 'Page count', `${doc.getPageCount()} page(s), expected ${exp.pages.length}`);
  const sizes = doc.getPages().map((p) => ({ w: p.getSize().width / MM_TO_PT, h: p.getSize().height / MM_TO_PT }));
  exp.pages.forEach((ep, i) => {
    const s = sizes[i];
    const ok = !!s && Math.abs(s.w - ep.wMm) < TOL && Math.abs(s.h - ep.hMm) < TOL;
    add(`page-size-${i + 1}`, ok, `Page ${i + 1} physical size`, s ? `${s.w.toFixed(3)} × ${s.h.toFixed(3)} mm, expected ${ep.wMm} × ${ep.hMm} mm` : 'missing');
  });

  exp.pages.forEach((ep, i) => {
    if (!sizes[i]) return;
    const H = sizes[i].h;
    let boxes: { x: number; y: number; w: number; h: number }[] = [];
    try { boxes = paintedBoxes(pdf, i).map((b) => ({ x: b.x / MM_TO_PT, y: H - (b.y + b.h) / MM_TO_PT, w: b.w / MM_TO_PT, h: b.h / MM_TO_PT })); } catch (e) { add(`content-${i + 1}`, false, `Page ${i + 1} content readable`, (e as Error).message); return; }
    const find = (x: number, y: number, w: number, h: number) => boxes.some((b) => Math.abs(b.x - x) < TOL && Math.abs(b.y - y) < TOL && Math.abs(b.w - w) < TOL && Math.abs(b.h - h) < TOL);
    if (ep.kind === 'artwork') {
      const frameOrCut = exp.hasBleedFrame ? exp.frame : { w: exp.cut.w, h: exp.cut.h };
      const missingCut: string[] = [];
      const missingFrame: string[] = [];
      for (const pl of ep.placements) {
        if (exp.cutDrawn && !find(pl.x + exp.cut.x, pl.y + exp.cut.y, exp.cut.w, exp.cut.h)) missingCut.push(`(${(pl.x + exp.cut.x).toFixed(3)}, ${(pl.y + exp.cut.y).toFixed(3)})`);
        const fx = exp.hasBleedFrame ? pl.x : pl.x + exp.cut.x, fy = exp.hasBleedFrame ? pl.y : pl.y + exp.cut.y;
        if (!find(fx, fy, frameOrCut.w, frameOrCut.h)) missingFrame.push(`(${fx.toFixed(3)}, ${fy.toFixed(3)})`);
      }
      if (exp.cutDrawn) add(`cut-${i + 1}`, !missingCut.length, `Page ${i + 1}: cut path ${exp.cut.w.toFixed(3)} × ${exp.cut.h.toFixed(3)} mm at the correct position${ep.placements.length > 1 ? ` (${ep.placements.length} labels)` : ''}`, missingCut.length ? `not found at ${missingCut.join(', ')}` : `${ep.placements.length} of ${ep.placements.length} found, within ${TOL} mm`);
      add(`frame-${i + 1}`, !missingFrame.length, `Page ${i + 1}: artwork fills the ${exp.hasBleedFrame ? 'source bleed frame' : 'cut outline'} (${frameOrCut.w.toFixed(3)} × ${frameOrCut.h.toFixed(3)} mm)`, missingFrame.length ? `not found at ${missingFrame.join(', ')}` : 'positions match');
    }
    if (ep.hasCalibrationSquare) add(`calibration-${i + 1}`, boxes.some((b) => Math.abs(b.w - 10) < TOL && Math.abs(b.h - 10) < TOL), `Page ${i + 1}: 10 mm calibration square is exactly 10 mm`, 'measured in the PDF');
    // no missing text: PDFKit shows SVG text character by character, so the number of text-show operators equals the character count
    let shown = -1;
    try { shown = textShowCount(pdf, i); } catch { /* reported below */ }
    add(`text-${i + 1}`, shown === ep.textGlyphs, `Page ${i + 1}: every character of text is in the PDF`, `${shown} character(s) drawn, expected ${ep.textGlyphs}`);
  });

  const f = pdfFonts(pdf);
  const wantEmbedded = exp.embeddedFaces.length;
  add('fonts-embedded', wantEmbedded === 0 ? f.embeddedSubsets.length === 0 : f.embeddedSubsets.length >= 1 && f.embeddedSubsets.length <= wantEmbedded && f.fontFileCount >= f.embeddedSubsets.length,
    'Fonts embedded as expected', wantEmbedded ? `${f.embeddedSubsets.length} embedded subset(s) in the PDF (${f.embeddedSubsets.join(', ') || 'none'}), ${wantEmbedded} font face(s) expected` : `no embeddable fonts in use; PDF fonts: ${f.baseFonts.join(', ')}`);
  if (exp.fallbackFaces.length) add('fonts-fallback', f.embeddedSubsets.every((s) => !/Locked|Restricted/i.test(s)), 'Restricted fonts are not embedded', `${exp.fallbackFaces.length} face(s) use the Helvetica fallback`);

  for (const side of ['A', 'B'] as const) {
    const tk = exp.tracks[side];
    add(`tracks-${side}`, tk.intentionallyHidden || tk.placed === tk.expected, `Side ${side}: no missing tracks`, tk.intentionallyHidden ? 'tracks intentionally not printed (minimal layout)' : `${tk.placed} of ${tk.expected} tracks placed`);
  }
  add('clipping', exp.clipping.length === 0, 'No unintended clipping of text', exp.clipping.length ? exp.clipping.join(' ') : 'all text lies inside the cut path and outside cutouts');

  const failed = checks.filter((c) => !c.ok);
  return { ok: !failed.length, checks, summary: failed.length ? `${failed.length} of ${checks.length} checks FAILED: ${failed.map((c) => c.label).join('; ')}` : `All ${checks.length} checks passed.` };
}
