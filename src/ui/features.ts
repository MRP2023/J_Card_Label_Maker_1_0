/** Browser side of the automatic suggestions: reads pixels from the uploaded images (locally, on a canvas). Nothing leaves the computer. */
import { analyzeImagePixels, type ImageFeatures } from '../core/art';
import { analyzeLogoPixels, type LogoStats } from '../core/logo';
import type { Asset } from '../core/model';
import type { SuggestInput } from '../core/suggest';

const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('An image could not be read.')); i.src = url; });

const pixelsOf = async (a: Asset, maxDim: number) => {
  const img = await load(a.dataUrl);
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
};

const featureCache = new Map<string, ImageFeatures>();
export async function featuresOf(a: Asset): Promise<ImageFeatures> {
  const hit = featureCache.get(a.id);
  if (hit) return hit;
  const { data, w, h } = await pixelsOf(a, 320);
  const f = analyzeImagePixels(data, w, h);
  featureCache.set(a.id, f);
  return f;
}

export async function logoStatsOf(a: Asset): Promise<LogoStats> {
  const { data, w, h } = await pixelsOf(a, 400);
  return { ...analyzeLogoPixels(data, w, h), width: a.width, height: a.height }; // resolution is judged on the real pixel size
}

/** Collects everything the rule-based engine needs from the current design. Throws a readable error if an image cannot be read. */
export async function buildSuggestInput(design: import('../core/model').Design, logoAssetId: string | null, available: string[]): Promise<SuggestInput> {
  const assets = design.assets;
  const art = assets.find((a) => a.kind === 'art');
  const refs = assets.filter((a) => a.kind === 'reference').slice(0, 3);
  const logo = assets.find((a) => a.id === logoAssetId) ?? assets.find((a) => a.kind === 'logo');
  const parse = (t: string) => t.split(/\r?\n/).filter((l) => l.trim()).length;
  return {
    release: { title: design.release.title, artist: design.release.artist },
    tracks: { A: parse(design.sides.A.tracksText), B: parse(design.sides.B.tracksText) },
    art: art ? await featuresOf(art) : null,
    refs: await Promise.all(refs.map(featuresOf)),
    logo: logo ? { stats: await logoStatsOf(logo), aspect: logo.width / logo.height, heightMm: design.style.logoHeightMm } : null,
    available,
  };
}
