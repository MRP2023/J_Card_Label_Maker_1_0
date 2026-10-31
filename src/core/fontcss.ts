/** Embeds the fonts an SVG uses (CLS-* faces) into the SVG itself as @font-face rules, so a standalone SVG renders correctly. */

export const usedFaceIds = (svg: string): string[] => [...new Set([...svg.matchAll(/CLS-((?:studio|custom)-[\w-]+)/g)].map((m) => m[1]))];

const toBase64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
};

export interface FaceBytes { bytes: Uint8Array; format: 'ttf' | 'otf' }

/** Returns the SVG with a <defs><style> of @font-face rules inserted after the root tag. Faces `resolve` cannot supply are skipped. */
export function injectFonts(svg: string, resolve: (faceId: string) => FaceBytes | null): string {
  const rules = usedFaceIds(svg).flatMap((id) => {
    const f = resolve(id);
    if (!f) return [];
    const mime = f.format === 'otf' ? 'font/otf' : 'font/ttf';
    return [`@font-face{font-family:'CLS-${id}';src:url(data:${mime};base64,${toBase64(f.bytes)}) format('${f.format === 'otf' ? 'opentype' : 'truetype'}');}`];
  });
  if (!rules.length) return svg;
  return svg.replace(/(<svg\b[^>]*>)/, `$1<defs><style>${rules.join('')}</style></defs>`);
}
