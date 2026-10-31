/**
 * Font model. Three kinds of font families are available to a design:
 *  - builtin: the PDF base-14 families (Helvetica / Times / Courier), never embedded
 *  - studio:  OFL / Apache fonts bundled in public/fonts (embeddable, subset into the PDF)
 *  - custom:  fonts the user uploads (TTF / OTF). Embedded only when the font's own OS/2 fsType permits it.
 * A FontRef names a family: 'sans' | 'serif' | 'mono' | 'studio:<id>' | 'custom:<slug>'.
 */

export type FontRef = string;
export type BuiltinFont = 'sans' | 'serif' | 'mono';

export const FONT_FAMILY: Record<BuiltinFont, string> = {
  sans: 'Helvetica, Arial, sans-serif',
  serif: 'Times, "Times New Roman", serif',
  mono: 'Courier, "Courier New", monospace',
};

export interface StudioFont {
  id: string;
  name: string;
  category: 'sans' | 'serif' | 'mono' | 'display';
  regular: string; // file name in public/fonts
  bold?: string;
  license: string;
}

export const STUDIO_FONTS: StudioFont[] = [
  { id: 'bebas', name: 'Bebas Neue', category: 'display', regular: 'BebasNeue-Regular.ttf', license: 'OFL 1.1' },
  { id: 'spacemono', name: 'Space Mono', category: 'mono', regular: 'SpaceMono-Regular.ttf', bold: 'SpaceMono-Bold.ttf', license: 'OFL 1.1' },
  { id: 'dmserif', name: 'DM Serif Display', category: 'serif', regular: 'DMSerifDisplay-Regular.ttf', license: 'OFL 1.1' },
  { id: 'archivoblack', name: 'Archivo Black', category: 'sans', regular: 'ArchivoBlack-Regular.ttf', license: 'OFL 1.1' },
  { id: 'righteous', name: 'Righteous', category: 'display', regular: 'Righteous-Regular.ttf', license: 'OFL 1.1' },
  { id: 'specialelite', name: 'Special Elite', category: 'mono', regular: 'SpecialElite-Regular.ttf', license: 'Apache 2.0' },
];

export interface UploadedFont {
  id: string;
  family: string;
  weight: 'regular' | 'bold';
  format: 'ttf' | 'otf';
  dataBase64: string;
  fsType: number;
  /** False when the font's embedding bits forbid embedding / subsetting; such fonts are never written into a PDF. */
  embeddable: boolean;
  embedNote: string;
}

export interface FamilyInfo {
  ref: FontRef;
  name: string;
  source: 'builtin' | 'studio' | 'custom';
  hasBold: boolean;
  embeddable: boolean;
  note: string;
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
export const isBuiltin = (ref: FontRef): ref is BuiltinFont => ref === 'sans' || ref === 'serif' || ref === 'mono';

export function listFamilies(uploaded: UploadedFont[] = []): FamilyInfo[] {
  const out: FamilyInfo[] = [
    { ref: 'sans', name: 'Helvetica (PDF built-in)', source: 'builtin', hasBold: true, embeddable: false, note: 'Standard PDF font, not embedded.' },
    { ref: 'serif', name: 'Times (PDF built-in)', source: 'builtin', hasBold: true, embeddable: false, note: 'Standard PDF font, not embedded.' },
    { ref: 'mono', name: 'Courier (PDF built-in)', source: 'builtin', hasBold: true, embeddable: false, note: 'Standard PDF font, not embedded.' },
    ...STUDIO_FONTS.map((f): FamilyInfo => ({ ref: `studio:${f.id}`, name: f.name, source: 'studio', hasBold: !!f.bold, embeddable: true, note: `${f.license}, embedded as a subset.` })),
  ];
  const fams = new Map<string, UploadedFont[]>();
  for (const u of uploaded) fams.set(slug(u.family), [...(fams.get(slug(u.family)) ?? []), u]);
  for (const [s, faces] of fams) {
    out.push({
      ref: `custom:${s}`, name: `${faces[0].family} (uploaded)`, source: 'custom',
      hasBold: faces.some((f) => f.weight === 'bold'),
      embeddable: faces.every((f) => f.embeddable),
      note: faces.map((f) => f.embedNote).join(' '),
    });
  }
  return out;
}

export interface Face {
  /** Stable id of the concrete font file ('sans', 'studio-bebas-r', 'custom-<id>'). */
  faceId: string;
  /** CSS/SVG font-family string. Custom and studio faces use a unique CLS-* name that is registered in the browser and in the PDF. */
  css: string;
  kind: 'builtin' | 'studio' | 'custom';
  /** Emit font-weight="bold" (only for built-in families; studio/custom bold is a separate face). */
  svgBold: boolean;
  embeddable: boolean;
  /** Set when the requested weight does not exist for this family and the regular face is used instead. */
  missingBold: boolean;
}

const genericFor = (cat: string) => (cat === 'serif' ? 'serif' : cat === 'mono' ? 'monospace' : 'sans-serif');

/** Resolve a family + weight to a concrete face. Unknown refs fall back to Helvetica. */
export function faceFor(ref: FontRef, bold: boolean, uploaded: UploadedFont[] = []): Face {
  if (isBuiltin(ref)) return { faceId: ref + (bold ? '-bold' : ''), css: FONT_FAMILY[ref], kind: 'builtin', svgBold: bold, embeddable: false, missingBold: false };
  if (ref.startsWith('studio:')) {
    const f = STUDIO_FONTS.find((x) => x.id === ref.slice(7));
    if (f) {
      const useBold = bold && !!f.bold;
      const faceId = `studio-${f.id}-${useBold ? 'b' : 'r'}`;
      return { faceId, css: `'CLS-${faceId}', ${genericFor(f.category)}`, kind: 'studio', svgBold: false, embeddable: true, missingBold: bold && !f.bold };
    }
  }
  if (ref.startsWith('custom:')) {
    const faces = uploaded.filter((u) => slug(u.family) === ref.slice(7));
    const face = (bold && faces.find((u) => u.weight === 'bold')) || faces.find((u) => u.weight === 'regular') || faces[0];
    if (face) {
      const faceId = `custom-${face.id}`;
      return { faceId, css: `'CLS-${faceId}', sans-serif`, kind: 'custom', svgBold: false, embeddable: face.embeddable, missingBold: bold && face.weight !== 'bold' };
    }
  }
  return faceFor('sans', bold, uploaded);
}

// ---------- OpenType (sfnt) header parsing: family name and embedding permissions ----------

export interface FontInfo { family: string; subfamily: string; weightClass: number; fsType: number; format: 'ttf' | 'otf'; embeddable: boolean; embedNote: string }

/** Reads the 'name' and 'OS/2' tables of a TTF/OTF. Throws on anything that is not a plain single-font sfnt. */
export function parseFontInfo(bytes: Uint8Array): FontInfo {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 12) throw new Error('File is too small to be a font.');
  const sig = tag(0);
  if (sig === 'ttcf') throw new Error('Font collections (.ttc) are not supported; upload a single TTF or OTF.');
  if (sig === 'wOFF' || sig === 'wOF2') throw new Error('WOFF fonts are not supported; upload a TTF or OTF.');
  const format = sig === 'OTTO' ? 'otf' : v.getUint32(0) === 0x00010000 || sig === 'true' ? 'ttf' : null;
  if (!format) throw new Error('Not a TrueType/OpenType font.');
  const n = v.getUint16(4);
  const tables: Record<string, { off: number; len: number }> = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (o + 16 > bytes.byteLength) throw new Error('Corrupt font table directory.');
    tables[tag(o)] = { off: v.getUint32(o + 8), len: v.getUint32(o + 12) };
  }
  let fsType = 0;
  let weightClass = 400;
  const os2 = tables['OS/2'];
  if (os2 && os2.off + 10 <= bytes.byteLength) { weightClass = v.getUint16(os2.off + 4); fsType = v.getUint16(os2.off + 8); }
  let family = '';
  let subfamily = '';
  const nm = tables['name'];
  if (nm && nm.off + 6 <= bytes.byteLength) {
    const count = v.getUint16(nm.off + 2);
    const strOff = nm.off + v.getUint16(nm.off + 4);
    for (let i = 0; i < count; i++) {
      const r = nm.off + 6 + i * 12;
      if (r + 12 > bytes.byteLength) break;
      const [plat, , , id, len, off] = [v.getUint16(r), v.getUint16(r + 2), v.getUint16(r + 4), v.getUint16(r + 6), v.getUint16(r + 8), v.getUint16(r + 10)];
      if (id !== 1 && id !== 2 && id !== 16 && id !== 17) continue;
      let s = '';
      for (let k = 0; k < len; k += plat === 3 || plat === 0 ? 2 : 1) s += String.fromCharCode(plat === 3 || plat === 0 ? v.getUint16(strOff + off + k) : v.getUint8(strOff + off + k));
      if (!s) continue;
      if ((id === 1 || id === 16) && (plat === 3 || !family)) family = s;
      if ((id === 2 || id === 17) && (plat === 3 || !subfamily)) subfamily = s;
    }
  }
  let embeddable = true;
  let embedNote = 'Embedding permitted by the font.';
  if (fsType & 0x0002) { embeddable = false; embedNote = 'Restricted license: this font forbids embedding, so the PDF falls back to Helvetica.'; }
  else if (fsType & 0x0100) { embeddable = false; embedNote = 'This font forbids subsetting, so it is not embedded and the PDF falls back to Helvetica.'; }
  else if (fsType & 0x0004) embedNote = 'Preview & print embedding permitted.';
  return { family: family || 'Uploaded font', subfamily, weightClass, fsType, format, embeddable, embedNote };
}

/** Uploaded fonts to send with a PDF export. Restricted fonts are left out here AND re-checked on the server. */
export const toFontPayload = (fonts: UploadedFont[]) => fonts.filter((f) => f.embeddable).map((f) => ({ faceId: `custom-${f.id}`, dataBase64: f.dataBase64 }));
