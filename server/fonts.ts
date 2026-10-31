/** Server-side font access: bundled studio fonts from public/fonts, uploaded fonts from the request. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_FONTS, parseFontInfo, toFontPayload, type UploadedFont } from '../src/core/fonts';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/fonts');
const cache = new Map<string, Buffer>();

/** faceId like 'studio-bebas-r' -> font bytes (or null when unknown). */
export function studioFaceBuffer(faceId: string): Buffer | null {
  const m = faceId.match(/^studio-(.+)-([rb])$/);
  if (!m) return null;
  const f = STUDIO_FONTS.find((x) => x.id === m[1]);
  const file = f && (m[2] === 'b' ? f.bold : f.regular);
  if (!file) return null;
  if (!cache.has(file)) cache.set(file, readFileSync(path.join(dir, file)));
  return cache.get(file)!;
}

export interface FontPayload { faceId: string; dataBase64: string }

/**
 * Uploaded fonts the PDF may embed. The embedding bits are re-read from the bytes themselves
 * (never trusted from the client), so a restricted font cannot be embedded by a tampered request.
 */
export function embeddableUploaded(payload: FontPayload[]): { buffers: Map<string, Buffer>; refused: string[] } {
  const buffers = new Map<string, Buffer>();
  const refused: string[] = [];
  for (const p of payload) {
    try {
      const buf = Buffer.from(p.dataBase64, 'base64');
      if (parseFontInfo(buf).embeddable) buffers.set(p.faceId, buf); else refused.push(p.faceId);
    } catch { refused.push(p.faceId); }
  }
  return { buffers, refused };
}

export const toPayload = (fonts: UploadedFont[]): FontPayload[] => toFontPayload(fonts);
