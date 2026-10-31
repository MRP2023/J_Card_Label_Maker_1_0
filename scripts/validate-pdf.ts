/**
 * Verifies an exported PDF against the original template, from the command line:
 *
 *   npm run validate-pdf -- my-labels.pdf --template cl4rc-standard-2024 --mode single
 *   npm run validate-pdf -- sheet.pdf --template cl-wide --mode sheet --fill pairs
 *   npm run validate-pdf -- desk.pdf --template cl-sq --mode desktop --paper Letter --no-cut
 *
 * Checks page sizes, cut-path size and position (every 12-up slot), the artwork frame and the calibration square, to 0.01 mm.
 * Text, fonts and track checks need the design itself; add --design design.json (the saved design JSON) to include them.
 * Exit code 0 = all checks passed, 1 = a check failed, 2 = bad usage.
 */
import { readFileSync } from 'node:fs';
import { defaultDesign, type Design, type ExportMode, type PaperKey, type SheetFill } from '../src/core/model';
import { composeExport } from '../src/core/page';
import { buildExpectation } from '../src/core/proof';
import { getTemplate, isUsable, TEMPLATES } from '../src/core/templates';
import { createPdfkitMeasurer } from '../server/measure';
import { validateExportPdf } from '../server/validate';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a) => !a.startsWith('--') && a.toLowerCase().endsWith('.pdf'));
const usage = (msg: string) => { console.error(msg + '\n\nUsage: npm run validate-pdf -- file.pdf --template <id> --mode desktop|single|sheet [--paper A4|Letter] [--fill pairs|A|B] [--no-cut] [--design design.json]\nTemplates: ' + TEMPLATES.filter(isUsable).map((t) => t.id).join(', ')); process.exit(2); };

if (!file) usage('Give the PDF to check.');
const template = getTemplate(flag('--template'));
if (!template || !isUsable(template)) usage('Unknown or unusable --template.');
const mode = (flag('--mode') ?? 'desktop') as ExportMode;
if (!['desktop', 'single', 'sheet'].includes(mode)) usage('--mode must be desktop, single or sheet.');

let design: Design = { ...defaultDesign };
const designFile = flag('--design');
if (designFile) design = { ...defaultDesign, ...JSON.parse(readFileSync(designFile, 'utf8')) };
design = { ...design, templateId: template!.id, exportOpts: { ...design.exportOpts, mode, paper: (flag('--paper') as PaperKey) ?? design.exportOpts.paper, sheetFill: (flag('--fill') as SheetFill) ?? design.exportOpts.sheetFill, showCut: !args.includes('--no-cut'), calibrationPage: !args.includes('--no-calibration-page') } };

const measure = createPdfkitMeasurer(design.fonts);
const composed = composeExport(design, template!, measure, 'pdf');
if (!composed.fits) { console.error('This template cannot be exported in that mode:', composed.warnings.map((w) => w.message).join(' ')); process.exit(2); }
const exp = buildExpectation(design, template as never, measure, composed);
const report = await validateExportPdf(readFileSync(file!), exp);

const geometryOnly = !designFile;
let failed = 0;
for (const c of report.checks) {
  const skipped = geometryOnly && /^(text-|fonts-|tracks-|clipping)/.test(c.id);
  if (!skipped && !c.ok) failed++;
  console.log(`${skipped ? 'SKIP' : c.ok ? 'PASS' : 'FAIL'}  ${c.label}  (${c.detail})`);
}
console.log(failed ? `\n${failed} check(s) FAILED.` : `\nAll geometry checks passed${geometryOnly ? ' (text, fonts and tracks need --design)' : ''}. This does NOT verify physical fit on the cassette.`);
process.exit(failed ? 1 : 0);
