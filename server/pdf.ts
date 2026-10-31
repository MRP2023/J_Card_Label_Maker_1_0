/** SVG pages -> one PDF. Each page SVG is authored in millimetres; the PDF page is exactly wMm x hMm. */
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { embeddableUploaded, studioFaceBuffer, type FontPayload } from './fonts';

export const MM_TO_PT = 72 / 25.4;

export interface PdfPage { svg: string; wMm: number; hMm: number }
export interface PdfOptions {
  title?: string;
  /** Disable stream compression (tests inspect the content stream). */
  compress?: boolean;
  /** Uploaded fonts to embed (their embedding bits are re-checked here). Studio fonts are read from disk. */
  fonts?: FontPayload[];
}
export interface PdfResult { pdf: Buffer; embedded: string[]; refused: string[] }

/** Fallback standard font from the CSS family list (its last entry is the generic family). */
const builtin = (family: string, bold: boolean) => {
  const last = family.split(',').pop()!.trim().toLowerCase();
  const kind = last === 'monospace' ? 'mono' : last === 'serif' ? 'serif' : 'sans';
  return kind === 'mono' ? (bold ? 'Courier-Bold' : 'Courier') : kind === 'serif' ? (bold ? 'Times-Bold' : 'Times-Roman') : bold ? 'Helvetica-Bold' : 'Helvetica';
};

export async function svgPagesToPdfDetailed(pages: PdfPage[], { title, compress = true, fonts = [] }: PdfOptions = {}): Promise<PdfResult> {
  if (!pages.length) throw new Error('No pages to export.');
  const first = pages[0];
  const doc = new PDFDocument({
    size: [first.wMm * MM_TO_PT, first.hMm * MM_TO_PT],
    margin: 0,
    compress,
    autoFirstPage: false,
    info: { Title: title ?? 'Cassette labels', Producer: 'Cassette Label Studio' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Register every CLS-* face the pages use: studio fonts from disk, uploaded fonts from the request.
  const { buffers, refused } = embeddableUploaded(fonts);
  const embedded: string[] = [];
  const used = new Set<string>();
  for (const p of pages) for (const m of p.svg.matchAll(/CLS-((?:studio|custom)-[\w-]+)/g)) used.add(m[1]);
  for (const faceId of used) {
    const buf = faceId.startsWith('studio-') ? studioFaceBuffer(faceId) : buffers.get(faceId) ?? null;
    if (!buf) { if (!refused.includes(faceId)) refused.push(faceId); continue; }
    try { doc.registerFont(`CLS-${faceId}`, buf); embedded.push(faceId); } catch { refused.push(faceId); }
  }

  const warnings: string[] = [];
  for (const p of pages) {
    const w = p.wMm * MM_TO_PT;
    const h = p.hMm * MM_TO_PT;
    doc.addPage({ size: [w, h], margin: 0 });
    // viewBox is in mm and width/height are the full page in points, so the scale is exactly 72/25.4.
    SVGtoPDF(doc, p.svg, 0, 0, {
      width: w, height: h, assumePt: true, preserveAspectRatio: 'xMinYMin meet',
      warningCallback: (m: string) => warnings.push(m),
      fontCallback: (family: string, bold: boolean) => {
        const m = family.match(/CLS-((?:studio|custom)-[\w-]+)/);
        if (m && embedded.includes(m[1])) return `CLS-${m[1]}`;
        return builtin(family, bold); // unknown or refused font: safe fallback to a standard PDF font
      },
    });
  }
  doc.end();
  const pdf = await done;
  if (warnings.length) console.warn('[pdf]', warnings.slice(0, 5).join(' | '));
  return { pdf, embedded, refused };
}

export const svgPagesToPdf = async (pages: PdfPage[], opts: PdfOptions = {}) => (await svgPagesToPdfDetailed(pages, opts)).pdf;
