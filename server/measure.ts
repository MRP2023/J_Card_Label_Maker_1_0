import PDFDocument from 'pdfkit';
import { PT_TO_MM } from '../src/core/model';
import type { Measurer } from '../src/core/measure';
import { parseFontInfo, type UploadedFont } from '../src/core/fonts';
import { studioFaceBuffer } from './fonts';

const BUILTIN: Record<string, string> = {
  sans: 'Helvetica', 'sans-bold': 'Helvetica-Bold',
  serif: 'Times-Roman', 'serif-bold': 'Times-Bold',
  mono: 'Courier', 'mono-bold': 'Courier-Bold',
};

/** Exact font metrics from PDFKit (AFM for built-ins, the real font files for studio and uploaded faces). */
export function createPdfkitMeasurer(uploaded: UploadedFont[] = []): Measurer {
  const doc = new PDFDocument({ margin: 0 });
  const registered = new Set<string>();
  const upl = new Map(uploaded.map((u) => [`custom-${u.id}`, u]));
  const nameFor = (faceId: string): string => {
    if (BUILTIN[faceId]) return BUILTIN[faceId];
    const reg = `CLS-${faceId}`;
    if (registered.has(reg)) return reg;
    const buf = faceId.startsWith('custom-') ? (upl.has(faceId) ? Buffer.from(upl.get(faceId)!.dataBase64, 'base64') : null) : studioFaceBuffer(faceId);
    if (buf) {
      try { if (!uploadedOk(buf)) throw new Error('bad font'); doc.registerFont(reg, buf); registered.add(reg); return reg; } catch { /* fall through */ }
    }
    return 'Helvetica';
  };
  return (text, face, sizePt, trackingEm = 0) => {
    const w = doc.font(nameFor(face.faceId)).fontSize(sizePt).widthOfString(text, { characterSpacing: trackingEm * sizePt });
    return w * PT_TO_MM;
  };
}

function uploadedOk(buf: Buffer) { try { parseFontInfo(buf); return true; } catch { return false; } }
