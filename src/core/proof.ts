/**
 * Print proof and export expectations. Pure functions over the design and the locked template:
 *  - buildProof():       everything the pre-export proof screen shows (dimensions, guides, fonts, tracks, warnings)
 *  - buildExpectation(): what a correct PDF must contain, so the server (and tests) can verify the real file
 */
import { faceFor, listFamilies } from './fonts';
import type { Measurer } from './measure';
import { parseTracks, type Design, type Side } from './model';
import { composeExport, type ComposedExport, type ExportPage } from './page';
import { renderLabel, type RenderWarning } from './render';
import { styleFor } from './style';
import { safeRect, type LibraryTemplate, type Rect } from './templates';

export interface FontStatus { faceId: string; name: string; status: 'embedded' | 'standard' | 'fallback'; detail: string }

export interface ExpectedPage {
  wMm: number; hMm: number; kind: ExportPage['kind'];
  placements: { side: Side; x: number; y: number }[];
  /** Number of characters in the page's SVG text: the PDF must show exactly as many text-show operations. */
  textGlyphs: number;
  hasCalibrationSquare: boolean;
}

export interface ExportExpectation {
  templateId: string;
  cut: { x: number; y: number; w: number; h: number };
  frame: { w: number; h: number };
  hasBleedFrame: boolean;
  /** The red cut path is drawn into the file (export option); otherwise only the artwork frame can be checked. */
  cutDrawn: boolean;
  pages: ExpectedPage[];
  embeddedFaces: string[];
  fallbackFaces: string[];
  tracks: { A: { expected: number; placed: number; intentionallyHidden: boolean }; B: { expected: number; placed: number; intentionallyHidden: boolean } };
  /** Text that would be cut off by the cut path or a cutout, per side. Empty when nothing is clipped. */
  clipping: string[];
}

export interface ProofCheck { id: string; level: 'ok' | 'warn' | 'error'; text: string }

export interface ProofReport {
  sides: { side: Side; svg: string; warnings: RenderWarning[]; tracksExpected: number; tracksPlaced: number }[];
  dims: { cut: { w: number; h: number }; frame: { w: number; h: number }; bleedMm: { left: number; top: number; right: number; bottom: number } | null; safe: Rect; pages: { label: string; wMm: number; hMm: number; kind: string }[] };
  fonts: FontStatus[];
  checks: ProofCheck[];
  /** No blocking errors (warnings still need the user's eyes). */
  canExport: boolean;
  instructions: string[];
  fitToPageWarning: string;
  expectation: ExportExpectation;
}

export const FIT_TO_PAGE_WARNING =
  'Printer "Fit to page", "Scale to fit", "Shrink oversized pages" or any scaling other than 100% / "Actual size" will change the physical size of the labels. ' +
  'Always print at 100% and measure the 10 mm calibration square before cutting.';

export const PRINT_INSTRUCTIONS = [
  'Open the PDF in a viewer you trust (Adobe Reader, Preview, Chrome) and open the Print dialog.',
  'Set scale to 100% / "Actual size". Turn OFF "Fit to page", "Shrink to fit" and "Scale to fit".',
  'Choose the paper size shown on the proof (A4 or US Letter) and disable any "borderless" or "enlarge to fill" option.',
  'Print the calibration page first and measure the 10 mm square and the 100 mm ruler with a metal rule. Both must be exact (within about 0.2 mm).',
  'Only then print the labels on the sticker sheet. Cut along the red cut line; artwork extends to the bleed frame.',
  'Hold a cut label against the cassette shell before peeling. If anything does not fit, record it in the fit record (docs/PRINT_TESTING.md).',
];

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const charsIn = (svg: string) => { let n = 0; for (const m of svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)) n += decode(m[1]).length; return n; };

/**
 * Characters (spaces included) that the PDF must show for an SVG page. PDFKit shows SVG text one character at a time.
 * A 12-up sheet stores each side's artwork once (`<g id="art-A">`) and draws it with `<use>`, so those characters count once per use.
 */
export function svgGlyphCount(svg: string): number {
  const start = { A: svg.indexOf('<g id="art-A">'), B: svg.indexOf('<g id="art-B">') };
  if (start.A < 0 && start.B < 0) return charsIn(svg);
  const end = svg.indexOf('</defs><rect width=');
  const first = Math.min(...[start.A, start.B].filter((v) => v >= 0));
  let total = charsIn(svg.slice(0, first)) + charsIn(svg.slice(end));
  const slice = (side: 'A' | 'B') => {
    const st = start[side];
    if (st < 0) return '';
    const nextStarts = [start.A, start.B, end].filter((v) => v > st);
    return svg.slice(st, Math.min(...nextStarts));
  };
  for (const side of ['A', 'B'] as const) {
    const uses = [...svg.matchAll(/<use\b[^>]*>/g)].filter((m) => m[0].includes(`#art-${side}"`)).length;
    total += charsIn(slice(side)) * uses;
  }
  return total;
}

function fontStatuses(d: Design): FontStatus[] {
  const fam = new Map(listFamilies(d.fonts).map((f) => [f.ref, f]));
  const out = new Map<string, FontStatus>();
  for (const side of ['A', 'B'] as const) {
    const s = styleFor(d, side);
    for (const [ref, bold] of [[s.headingFont ?? s.font, s.titleBold], [s.bodyFont ?? s.font, s.bodyBold]] as const) {
      const f = faceFor(ref, bold, d.fonts);
      const name = (fam.get(ref)?.name ?? ref) + (bold && !f.missingBold ? ' Bold' : '');
      if (out.has(f.faceId)) continue;
      out.set(f.faceId, f.kind === 'builtin'
        ? { faceId: f.faceId, name, status: 'standard', detail: 'Standard PDF font; every PDF viewer and printer has it. Not embedded.' }
        : f.embeddable
          ? { faceId: f.faceId, name, status: 'embedded', detail: 'Embedded in the PDF as a subset; text stays selectable and prints identically anywhere.' }
          : { faceId: f.faceId, name, status: 'fallback', detail: 'The font forbids embedding. The PDF uses Helvetica instead, so the printed look will differ from the preview.' });
    }
  }
  return [...out.values()];
}

/** Text blocks whose ink falls outside the cut path's bounds or into a cutout hole. */
function clippingIssues(d: Design, t: LibraryTemplate, measure: Measurer): string[] {
  const issues: string[] = [];
  const C = t.cut!.bbox;
  const holes = t.inner.filter((i) => i.behavior === 'cutout').map((i) => i.bbox);
  for (const side of ['A', 'B'] as const) {
    const r = renderLabel(d, t, side, measure);
    for (const b of r.blocks) {
      const ink = b.ink;
      const label = b.id.startsWith('track') ? 'Tracklist' : b.id[0].toUpperCase() + b.id.slice(1);
      if (ink.x < C.x - 0.01 || ink.y < C.y - 0.01 || ink.x + ink.w > C.x + C.w + 0.01 || ink.y + ink.h > C.y + C.h + 0.01) issues.push(`Side ${side}: ${label} extends beyond the cut path and would be cut off.`);
      for (const h of holes) if (ink.x < h.x + h.w && ink.x + ink.w > h.x && ink.y < h.y + h.h && ink.y + ink.h > h.y) issues.push(`Side ${side}: ${label} falls inside a cutout and would be removed.`);
    }
  }
  return [...new Set(issues)];
}

export function buildExpectation(d: Design, t: LibraryTemplate & { cut: NonNullable<LibraryTemplate['cut']>; frame: { w: number; h: number } }, measure: Measurer, composed: ComposedExport): ExportExpectation {
  const fonts = fontStatuses(d);
  const sideInfo = (side: Side) => {
    const r = renderLabel(d, t, side, measure);
    // manual layouts group tracks into blocks, so count them from the group sizes; otherwise one block per track
    const placed = d.style.layoutMode === 'manual' ? r.groups.reduce((x, y) => x + y, 0) : r.blocks.filter((b) => b.id.startsWith('track-')).length;
    return { expected: parseTracks(d.sides[side].tracksText).length, placed, intentionallyHidden: styleFor(d, side).layoutMode === 'minimal' };
  };
  return {
    templateId: t.id,
    cut: { ...t.cut.bbox },
    frame: { ...t.frame },
    hasBleedFrame: !!t.bleed,
    cutDrawn: d.exportOpts.showCut,
    pages: composed.pages.map((p) => ({
      wMm: p.wMm, hMm: p.hMm, kind: p.kind,
      placements: (p.placements ?? []).map((x) => ({ ...x })),
      textGlyphs: svgGlyphCount(p.svg),
      hasCalibrationSquare: /id="calibration"/.test(p.svg),
    })),
    embeddedFaces: fonts.filter((f) => f.status === 'embedded').map((f) => f.faceId),
    fallbackFaces: fonts.filter((f) => f.status === 'fallback').map((f) => f.faceId),
    tracks: { A: sideInfo('A'), B: sideInfo('B') },
    clipping: clippingIssues(d, t, measure),
  };
}

export function buildProof(d: Design, t: LibraryTemplate & { cut: NonNullable<LibraryTemplate['cut']>; frame: { w: number; h: number } }, measure: Measurer): ProofReport {
  const composed = composeExport(d, t, measure, 'svg');
  const expectation = buildExpectation(d, t, measure, composed);
  const guides = { cut: true, bleed: true, safety: true };
  const sides = (['A', 'B'] as const).map((side) => {
    const r = renderLabel(d, t, side, measure, { guides });
    return { side, svg: r.svg, warnings: r.warnings, tracksExpected: expectation.tracks[side].expected, tracksPlaced: expectation.tracks[side].placed };
  });
  const fonts = fontStatuses(d);
  const C = t.cut.bbox;
  const bleedMm = t.bleed ? { left: C.x, top: C.y, right: t.frame.w - (C.x + C.w), bottom: t.frame.h - (C.y + C.h) } : null;
  const checks: ProofCheck[] = [];
  for (const e of composed.warnings.filter((w) => w.level === 'error')) checks.push({ id: 'export-error', level: 'error', text: e.message });
  for (const side of ['A', 'B'] as const) {
    const tk = expectation.tracks[side];
    if (tk.intentionallyHidden) checks.push({ id: `tracks-${side}`, level: 'warn', text: `Side ${side}: tracks are intentionally not printed (minimal layout).` });
    else if (tk.placed !== tk.expected) checks.push({ id: `tracks-${side}`, level: 'error', text: `Side ${side}: ${tk.expected} track(s) entered but ${tk.placed} placed.` });
    else checks.push({ id: `tracks-${side}`, level: 'ok', text: `Side ${side}: all ${tk.expected} tracks are on the label.` });
    const ovf = sides.find((s) => s.side === side)!.warnings.filter((w) => w.level === 'warning');
    if (ovf.some((w) => /do not fit/.test(w.message))) checks.push({ id: `overflow-${side}`, level: 'error', text: `Side ${side}: text does not fit at a readable size (drawn in red in the editor).` });
    // text printed on top of other text is unreadable, so it blocks export; other overlaps (e.g. a logo over artwork) stay warnings
    const TEXT = '(Title|Artist|Meta|Heading|Tracklist)';
    const textOverlap = new RegExp(`^${TEXT} overlaps ${TEXT}\\.$`);
    for (const w of ovf.filter((w) => !/do not fit/.test(w.message))) checks.push({ id: textOverlap.test(w.message) ? `overlap-${side}` : `warn-${side}`, level: textOverlap.test(w.message) ? 'error' : 'warn', text: `Side ${side}: ${w.message}` });
  }
  for (const c of expectation.clipping) checks.push({ id: 'clipping', level: 'error', text: c });
  if (!expectation.clipping.length) checks.push({ id: 'clipping', level: 'ok', text: 'No text is clipped by the cut path or a cutout.' });
  for (const f of fonts.filter((x) => x.status === 'fallback')) checks.push({ id: 'font', level: 'warn', text: `${f.name}: ${f.detail}` });
  if (!fonts.some((x) => x.status === 'fallback')) checks.push({ id: 'font', level: 'ok', text: `Fonts: ${fonts.filter((f) => f.status === 'embedded').length} embedded, ${fonts.filter((f) => f.status === 'standard').length} standard PDF font(s).` });
  if (t.verification !== 'source-vector') checks.push({ id: 'template', level: 'warn', text: 'Template geometry is not verified.' });
  checks.push({ id: 'physical-fit', level: 'warn', text: 'Physical fit on the cassette shell is NOT verified until a printed label has been tried on the real shell (see docs/PRINT_TESTING.md).' });
  return {
    sides,
    dims: { cut: { w: C.w, h: C.h }, frame: { ...t.frame }, bleedMm, safe: safeRect(t), pages: composed.pages.map((p) => ({ label: p.label, wMm: p.wMm, hMm: p.hMm, kind: p.kind })) },
    fonts, checks, canExport: composed.fits && !checks.some((c) => c.level === 'error'),
    instructions: PRINT_INSTRUCTIONS, fitToPageWarning: FIT_TO_PAGE_WARNING, expectation,
  };
}
