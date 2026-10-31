/**
 * Export composer. Pages are authored in millimetres (SVG viewBox in mm) and are never scaled:
 *  - desktop: both labels at 1:1 on A4 / US Letter, calibration square + instructions on the same page
 *  - single:  one page per side at the vendor's own 1-up artboard size (cut/bleed/safety from the source)
 *  - sheet:   the vendor's original 12-up Letter sheet, labels at the source slot positions
 * Single and sheet modes can append a paper-size calibration page (10 mm square + 100 mm ruler).
 */
import { FONT_FAMILY, type Measurer } from './measure';
import { PT_TO_MM, type Design, type PaperKey, type Side } from './model';
import { renderLabel, type RenderWarning } from './render';
import { isUsable, type LibraryTemplate } from './templates';

export const PAPER_MM: Record<PaperKey, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  Letter: { w: 215.9, h: 279.4 },
};
export const MM_TO_PT = 72 / 25.4;
export const CALIBRATION_MM = 10;
const PAGE_MARGIN = 10;
const FOOTER_H = 30;

/** Where one label's local frame origin sits on a page (mm). The cut path is at (x + cut.x, y + cut.y). */
export interface Placement { side: Side; x: number; y: number }
export interface ExportPage { svg: string; wMm: number; hMm: number; label: string; kind: 'artwork' | 'calibration'; placements?: Placement[] }
export interface ComposedExport { pages: ExportPage[]; warnings: RenderWarning[]; fits: boolean }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function root(wMm: number, hMm: number, inner: string, target: 'svg' | 'pdf') {
  const size = target === 'pdf' ? `width="${+(wMm * MM_TO_PT).toFixed(4)}" height="${+(hMm * MM_TO_PT).toFixed(4)}"` : `width="${wMm}mm" height="${hMm}mm"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${size} viewBox="0 0 ${wMm} ${hMm}">${inner}</svg>`;
}

const label = (x: number, y: number, pt: number, text: string, extra = '') =>
  `<text x="${x}" y="${y}" font-family="${esc(FONT_FAMILY.sans)}" font-size="${+(pt * PT_TO_MM).toFixed(3)}" fill="#000000"${extra}>${esc(text)}</text>`;

function instructionLines(d: Design, t: LibraryTemplate): string[] {
  const o = d.exportOpts;
  const c = t.cut!.bbox;
  return [
    `Template: ${t.name}. Cut path ${c.w.toFixed(3)} × ${c.h.toFixed(3)} mm (copied from the source file). Source status: ${t.verification === 'source-vector' ? 'vector source' : 'UNVERIFIED'}.`,
    `PRINT AT 100% / "Actual size". Do NOT use "Fit to page" or "Shrink to fit". Paper: ${o.mode === 'desktop' ? o.paper : 'as shown'}.`,
    'Measure the square with a ruler: it must be exactly 10 mm. If not, fix the printer scaling first.',
    o.showCut ? 'Red hairline = cut path from the source template. Cut along it; artwork extends to the bleed frame.' : 'Cut path hidden.',
  ];
}

/** 10 mm calibration square plus a 100 mm ruler with 10 mm ticks and the print instructions. */
function calibrationBlock(x: number, y: number, lines: string[], withRuler: boolean) {
  let s = `<g id="calibration"><rect x="${x}" y="${y}" width="${CALIBRATION_MM}" height="${CALIBRATION_MM}" fill="none" stroke="#000000" stroke-width="0.2"/>`;
  s += label(x, y + CALIBRATION_MM + 4, 6, '10 mm × 10 mm calibration square');
  if (withRuler) {
    const ry = y + CALIBRATION_MM + 14;
    s += `<line x1="${x}" y1="${ry}" x2="${x + 100}" y2="${ry}" stroke="#000000" stroke-width="0.2"/>`;
    for (let i = 0; i <= 10; i++) {
      s += `<line x1="${x + i * 10}" y1="${ry}" x2="${x + i * 10}" y2="${ry + 2}" stroke="#000000" stroke-width="0.2"/>`;
      s += label(x + i * 10 - 2, ry + 5.5, 5, String(i * 10));
    }
    s += label(x, ry + 9, 6, '100 mm ruler (ticks every 10 mm)');
  }
  lines.forEach((l, i) => { s += label(x + CALIBRATION_MM + 8, y + 3 + i * 4.2, 6, l, i === 0 ? ' font-weight="bold"' : ''); });
  return s + '</g>';
}

export function composeExport(d: Design, t: LibraryTemplate, measure: Measurer, target: 'svg' | 'pdf' = 'svg'): ComposedExport {
  const o = d.exportOpts;
  const warnings: RenderWarning[] = [];
  const pages: ExportPage[] = [];
  if (!isUsable(t)) {
    return { pages, fits: false, warnings: [{ side: 'page', level: 'error', message: `Template "${t.name}" has no vector geometry (${t.verificationNote})` }] };
  }
  if (t.verification !== 'source-vector') warnings.push({ side: 'page', level: 'warning', message: 'Template geometry is not verified.' });
  const guides = { cut: o.showCut, bleed: o.showBleedGuide, safety: o.showSafetyGuide };
  const frame = t.frame;
  const paper = PAPER_MM[o.paper];
  let fits = true;

  const render = (side: Side, suffix = '') => {
    const r = renderLabel(d, t, side, measure, { guides, idSuffix: suffix });
    return r;
  };
  const rA = render('A');
  const rB = render('B');
  warnings.push(...rA.warnings, ...rB.warnings);

  const calibrationPage = (): ExportPage => ({
    wMm: paper.w, hMm: paper.h, label: 'Calibration', kind: 'calibration',
    svg: root(paper.w, paper.h, `<rect width="${paper.w}" height="${paper.h}" fill="#ffffff"/>` + label(PAGE_MARGIN, PAGE_MARGIN + 3, 8, 'Print calibration page', ' font-weight="bold"') + calibrationBlock(PAGE_MARGIN, PAGE_MARGIN + 8, instructionLines(d, t), true), target),
  });

  if (o.mode === 'desktop') {
    const gap = 4;
    const usableW = paper.w - 2 * PAGE_MARGIN;
    const side = 2 * frame.w + gap <= usableW;
    const top = PAGE_MARGIN + 8;
    const pos = [0, 1].map((i) => (side ? { x: PAGE_MARGIN + i * (frame.w + gap), y: top } : { x: PAGE_MARGIN, y: top + i * (frame.h + gap) }));
    const bottom = Math.max(...pos.map((p) => p.y + frame.h));
    if (frame.w > usableW) {
      fits = false;
      warnings.push({ side: 'page', level: 'error', message: `Label frame (${frame.w.toFixed(1)} mm) is wider than the usable ${o.paper} width (${usableW.toFixed(1)} mm). It will not be scaled; use a larger paper size.` });
    }
    if (bottom > paper.h - PAGE_MARGIN - FOOTER_H) {
      fits = false;
      warnings.push({ side: 'page', level: 'error', message: `Both labels do not fit on one ${o.paper} page with the calibration footer. They will not be scaled.` });
    }
    let inner = `<rect width="${paper.w}" height="${paper.h}" fill="#ffffff"/>`;
    inner += label(PAGE_MARGIN, PAGE_MARGIN + 3, 8, `${d.release.artist} – ${d.release.title}${d.release.catalogNumber ? ' [' + d.release.catalogNumber + ']' : ''}`, ' font-weight="bold"');
    inner += `<g id="label-A" transform="translate(${pos[0].x} ${pos[0].y})">${rA.svg}</g>`;
    inner += `<g id="label-B" transform="translate(${pos[1].x} ${pos[1].y})">${rB.svg}</g>`;
    inner += calibrationBlock(PAGE_MARGIN, paper.h - PAGE_MARGIN - FOOTER_H + 6, instructionLines(d, t), false);
    pages.push({ svg: root(paper.w, paper.h, inner, target), wMm: paper.w, hMm: paper.h, label: `${o.paper} desktop sheet`, kind: 'artwork', placements: [{ side: 'A', ...pos[0] }, { side: 'B', ...pos[1] }] });
    return { pages, warnings, fits };
  }

  if (o.mode === 'single') {
    const ab = t.artboardMm ?? { w: frame.w, h: frame.h };
    const org = t.artboardMm && t.frameOrigin ? t.frameOrigin : { x: 0, y: 0 };
    (['A', 'B'] as const).forEach((sd) => {
      const r = sd === 'A' ? rA : rB;
      pages.push({
        svg: root(ab.w, ab.h, `<g transform="translate(${org.x} ${org.y})">${r.svg}</g>`, target),
        wMm: ab.w, hMm: ab.h, label: `Side ${sd} (1-up, ${ab.w} × ${ab.h} mm)`, kind: 'artwork', placements: [{ side: sd, x: org.x, y: org.y }],
      });
    });
    if (!t.artboardMm) warnings.push({ side: 'page', level: 'info', message: 'The source has no 1-up file; pages are sized to the label frame.' });
    if (o.calibrationPage) pages.push(calibrationPage());
    return { pages, warnings, fits };
  }

  // sheet
  const sheet = t.sheet;
  if (!sheet) {
    return { pages, fits: false, warnings: [...warnings, { side: 'page', level: 'error', message: 'This template has no original 12-up sheet.' }] };
  }
  const sideFor = (i: number): Side => (o.sheetFill === 'A' ? 'A' : o.sheetFill === 'B' ? 'B' : i % 2 === 0 ? 'A' : 'B');
  let defs = '';
  let uses = '';
  (['A', 'B'] as const).forEach((sd) => {
    if (sheet.slots.some((_, i) => sideFor(i) === sd)) defs += `<g id="art-${sd}">${(sd === 'A' ? rA : rB).svg}</g>`;
  });
  sheet.slots.forEach((p, i) => { uses += `<use xlink:href="#art-${sideFor(i)}" href="#art-${sideFor(i)}" transform="translate(${p.x} ${p.y})"/>`; });
  const inner = `<defs>${defs}</defs><rect width="${sheet.paperMm.w}" height="${sheet.paperMm.h}" fill="#ffffff"/>${uses}`;
  pages.push({ svg: root(sheet.paperMm.w, sheet.paperMm.h, inner, target), wMm: sheet.paperMm.w, hMm: sheet.paperMm.h, label: `12-up sheet (${sheet.paperMm.w} × ${sheet.paperMm.h} mm)`, kind: 'artwork', placements: sheet.slots.map((sl, i) => ({ side: sideFor(i), x: sl.x, y: sl.y })) });
  if (o.calibrationPage) pages.push(calibrationPage());
  return { pages, warnings, fits };
}
