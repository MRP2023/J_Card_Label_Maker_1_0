/** Loads the fonts a design uses into the browser (studio fonts from /fonts, uploaded fonts from their bytes). */
import { STUDIO_FONTS, faceFor, type Face, type UploadedFont } from '../core/fonts';
import type { Design } from '../core/model';

const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Every concrete face the design refers to (shared style + per-side overrides, both weights). */
export function facesUsed(d: Design): Face[] {
  const refs = new Set<string>();
  const add = (o: Partial<Design['style']>) => { for (const r of [o.font, o.headingFont, o.bodyFont]) if (r) refs.add(r); };
  add(d.style);
  add(d.sides.A.typo); add(d.sides.B.typo);
  const out = new Map<string, Face>();
  for (const r of refs) for (const bold of [false, true]) { const f = faceFor(r, bold, d.fonts); if (f.kind !== 'builtin') out.set(f.faceId, f); }
  return [...out.values()];
}

function loadFace(face: Face, fonts: UploadedFont[]): Promise<void> {
  if (loaded.has(face.faceId)) return Promise.resolve();
  const existing = loading.get(face.faceId);
  if (existing) return existing;
  const name = `CLS-${face.faceId}`;
  let source: ArrayBuffer | string | null = null;
  if (face.kind === 'studio') {
    const m = face.faceId.match(/^studio-(.+)-([rb])$/)!;
    const f = STUDIO_FONTS.find((x) => x.id === m[1]);
    const file = f && (m[2] === 'b' ? f.bold : f.regular);
    if (file) source = `url(/fonts/${file})`;
  } else {
    const u = fonts.find((x) => `custom-${x.id}` === face.faceId);
    if (u) source = b64ToBytes(u.dataBase64).buffer as ArrayBuffer;
  }
  if (!source) return Promise.resolve();
  const p = new FontFace(name, source as string)
    .load()
    .then((ff) => { document.fonts.add(ff); loaded.add(face.faceId); })
    .catch(() => { /* a font that fails to load simply falls back; measurement stays approximate */ })
    .finally(() => loading.delete(face.faceId));
  loading.set(face.faceId, p);
  return p;
}

/** Loads whatever is missing; resolves true when something new became available (so layout should be recomputed). */
export async function ensureFonts(d: Design): Promise<boolean> {
  const before = loaded.size;
  await Promise.all(facesUsed(d).map((f) => loadFace(f, d.fonts)));
  return loaded.size !== before;
}

/** Bytes of a face for embedding into an exported SVG (studio fonts are fetched; uploaded ones must permit embedding). */
export async function faceBytes(faceId: string, d: Design): Promise<{ bytes: Uint8Array; format: 'ttf' | 'otf' } | null> {
  if (faceId.startsWith('custom-')) {
    const u = d.fonts.find((x) => `custom-${x.id}` === faceId);
    return u && u.embeddable ? { bytes: b64ToBytes(u.dataBase64), format: u.format } : null;
  }
  const m = faceId.match(/^studio-(.+)-([rb])$/);
  const f = m && STUDIO_FONTS.find((x) => x.id === m[1]);
  const file = f && (m![2] === 'b' ? f.bold : f.regular);
  if (!file) return null;
  const res = await fetch(`/fonts/${file}`);
  return res.ok ? { bytes: new Uint8Array(await res.arrayBuffer()), format: 'ttf' } : null;
}
