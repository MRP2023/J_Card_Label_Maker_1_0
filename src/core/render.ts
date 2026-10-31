/**
 * Rendering engine: turns (design, locked template, side) into an SVG fragment in millimetres.
 * Pure string functions, so it runs identically in the browser and in Node (tests / server).
 *
 * The template geometry is never modified here. Artwork is clipped to the source bleed frame (or cut path),
 * with source cutouts removed; text is placed by the planner (plan.ts) inside regions derived from the source's own safety guides.
 */
import { n, hit, imageBlock, placeAt, textBlock, trackBlock, type Blk, type Ctx, type PlacedBlock, type RenderWarning, type TextLine } from './blocks';
import { contrastRatio } from './color';
import { faceFor } from './fonts';
import type { Measurer } from './measure';
import { assetById, parseTracks, releaseOf, TRACK_BLOCKS, type BlockId, type Design, type Side } from './model';
import { ornamentSvg } from './ornaments';
import { planBoth } from './plan';
import { focalZones, imagePlacement, styleFor } from './style';
import { GUIDE_COLORS, artClipPath, cutOverlayPath, keepOuts, safeRect, textRegions, type LibraryTemplate, type Rect } from './templates';

export type { RenderWarning, PlacedBlock } from './blocks';
export type { Side } from './model';

export interface RenderOptions {
  /** Editor overlays (keep-outs, overflow outlines, draggable hit areas). Never used for export. */
  preview?: boolean;
  guides?: { cut: boolean; bleed: boolean; safety: boolean };
  showRegions?: boolean;
  /** Appended to the clipPath id so several labels can share one SVG document. */
  idSuffix?: string;
  /** Block to highlight in the editor. */
  selected?: string | null;
}

export interface RenderedLabel {
  svg: string;
  warnings: RenderWarning[];
  blocks: PlacedBlock[];
  effectiveTrackPt: number;
  scale: number;
  /** Tracks per placed group, in order. */
  groups: number[];
}

interface Layout { blocks: PlacedBlock[]; overflow: number; minPt: number; hidden: number; logoReduced: boolean; wordTooWide: boolean; scale: number; headerScale: number; trackPt: number; groups: number[]; notes: string[] }

/** Clamp a block so its ink stays inside the safe rectangle (the source's own safety guides). */
export function clampInto(b: Blk, x: number, y: number, S: Rect) {
  const ix = b.inkX ?? 0;
  const minX = S.x - ix, maxX = S.x + S.w - (ix + b.inkW);
  const minY = S.y, maxY = S.y + S.h - b.h;
  return { x: maxX < minX ? minX : Math.min(maxX, Math.max(minX, x)), y: maxY < minY ? minY : Math.min(maxY, Math.max(minY, y)) };
}

const cap = (id: string) => id[0].toUpperCase() + id.slice(1);

/** Manual mode: stored positions (clamped into the safe area); unset blocks start where the automatic layout puts them. */
function manualLayout(ctx: Ctx, measure: Measurer): Layout {
  const { d, side, t, s } = ctx;
  const man = d.manual[side];
  const S = safeRect(t);
  const auto = planBoth({ ...d, style: { ...d.style, layoutMode: 'auto' } }, t, measure)[side];
  const seedOf = (id: BlockId) => auto.blocks.find((b) => b.id === id || (id === 'tracks' && b.id.startsWith('track-')));
  const tracks = parseTracks(d.sides[side].tracksText);
  const blocks: PlacedBlock[] = [];
  const notes: string[] = [];
  let reduced = false;
  const pos = (id: BlockId, fw: number) => {
    const m = man[id]; const sd = seedOf(id);
    return { x: m?.x ?? sd?.x ?? S.x, y: m?.y ?? sd?.y ?? S.y, w: m?.w ?? sd?.w ?? fw };
  };
  const add = (id: BlockId, b: Blk | null, p: { x: number; y: number }) => {
    if (!b) return;
    const c = clampInto(b, p.x, p.y, S);
    if (Math.abs(c.x - p.x) > 0.01 || Math.abs(c.y - p.y) > 0.01) notes.push(`${cap(id)} was moved back inside the safe area.`);
    blocks.push(placeAt(b, c.x, c.y, id));
  };
  /** Images are sized by their stored width (resize handle) or, if never resized, by the style's height. */
  const imageAt = (id: BlockId, assetId: string | null, styleH: number, fw: number) => {
    const a = assetById(d, assetId);
    const p = pos(id, fw);
    if (!a) return null;
    const wantH = man[id]?.w ? man[id]!.w / (a.width / a.height) : styleH;
    const r = imageBlock(ctx, assetId, wantH, p.w, Infinity);
    if (r) { reduced ||= r.reduced; add(id, r.blk, p); }
    return r;
  };
  const heading = d.sides[side].heading.trim();
  // when the planner merged the side heading into the catalogue line, manual mode keeps it there (until the user places it)
  const headMerged = !!heading && !auto.blocks.some((b) => b.id === 'heading') && !man.heading;
  const meta = [d.release.catalogNumber, d.release.year, headMerged ? heading : ''].filter((x) => x.trim()).join(' · ');
  const hd = (text: string, pt: number, bold = s.titleBold): TextLine => ({ text, pt, bold, color: s.textColor, role: 'heading', tracking: s.titleTracking, case: s.titleCase });
  const bd = (text: string, pt: number): TextLine => ({ text, pt, color: s.textColor, role: 'body', tracking: s.bodyTracking, case: s.titleCase });
  imageAt('logo', s.logoAssetId, s.logoHeightMm, 30);
  if (!imageAt('wordmark', s.wordmarkAssetId, s.wordmarkHeightMm, 40) && s.wordmarkText.trim()) {
    const pw = pos('wordmark', 40);
    add('wordmark', textBlock(ctx, [hd(s.wordmarkText.trim(), s.wordmarkSizePt, true)], pw.w), pw);
  }
  const e = s.headerEmphasis;
  const tp = pos('title', 40); add('title', textBlock(ctx, [hd(releaseOf(d, side).title, s.titleSizePt * (e === 'artist' ? 0.8 : e === 'balanced' ? 0.9 : 1))], tp.w), tp);
  const ap = pos('artist', 40); add('artist', textBlock(ctx, [bd(releaseOf(d, side).artist, s.titleSizePt * (e === 'artist' ? 1 : e === 'balanced' ? 0.9 : 0.8))], ap.w), ap);
  const mp = pos('meta', 40); add('meta', textBlock(ctx, [bd(meta, s.metaSizePt)], mp.w), mp);
  if (heading && !headMerged) { const hp = pos('heading', 40); add('heading', textBlock(ctx, [hd(heading, s.metaSizePt * 1.3, true)], hp.w), hp); }
  // track groups: counts come from the planner when manual mode was seeded; a single group otherwise
  let counts = (d.trackGroups[side] ?? []).filter((c) => c > 0);
  const total = counts.reduce((a, b) => a + b, 0);
  // The stored split no longer matches the tracklist (tracks were added or removed after manual mode started): a single
  // stretched block would run straight over the window or hubs, so start this side's tracklist again from the automatic plan.
  const stale = !!tracks.length && auto.groups.length > 0 && (counts.length ? total !== tracks.length : !man.tracks);
  let trackPt = s.trackSizePt;
  const seedAt = new Map<BlockId, { x: number; y: number; w: number }>();
  if (stale) {
    const tb = auto.blocks.filter((b) => b.id.startsWith('track-'));
    counts = auto.groups.slice(0, TRACK_BLOCKS.length);
    if (auto.groups.length > TRACK_BLOCKS.length) counts[TRACK_BLOCKS.length - 1] += auto.groups.slice(TRACK_BLOCKS.length).reduce((a, b) => a + b, 0);
    let k = 0;
    counts.forEach((c, gi) => {
      const grp = tb.slice(k, k + c); k += c;
      if (grp.length) seedAt.set(TRACK_BLOCKS[gi], { x: Math.min(...grp.map((b) => b.x)), y: Math.min(...grp.map((b) => b.y)), w: grp[0].w });
    });
    trackPt = Math.min(s.trackSizePt, auto.trackPt);
    notes.push('The tracklist changed after manual mode started, so its groups were re-placed around the window/hubs. Use "Reset all positions" to re-seed everything.');
  } else if (!counts.length || total > tracks.length) counts = [tracks.length];
  else if (total < tracks.length) counts = [...counts.slice(0, -1), counts[counts.length - 1] + tracks.length - total];
  let at = 0;
  counts.slice(0, TRACK_BLOCKS.length).forEach((c, gi) => {
    const id = TRACK_BLOCKS[gi];
    const slice = tracks.slice(at, at + c);
    at += c;
    if (!slice.length) return;
    const p = seedAt.get(id) ?? pos(id, 40);
    add(id, trackBlock(ctx, slice, tracks, p.w, trackPt), p);
  });
  const minPt = Math.min(s.titleSizePt, s.metaSizePt, trackPt);
  return { blocks, overflow: 0, minPt, hidden: 0, logoReduced: reduced, wordTooWide: false, scale: 1, headerScale: 1, trackPt, groups: counts, notes };
}

export function renderLabel(d: Design, t: LibraryTemplate, side: Side, measure: Measurer, opts: RenderOptions = {}): RenderedLabel {
  if (!t.cut || !t.frame) throw new Error(`Template "${t.id}" has no vector geometry and cannot be used.`);
  const s = styleFor(d, side);
  const ctx: Ctx = { d, t, side, measure, s };
  const warnings: RenderWarning[] = [];
  const frame = t.frame;
  const S = safeRect(t);
  const sideC = d.sides[side];
  const bgAsset = assetById(d, sideC.backgroundAssetId);
  const focal = focalZones(d, side, frame);
  const KO = [...keepOuts(t), ...focal];

  let layout: Layout;
  if (s.layoutMode === 'manual') layout = manualLayout(ctx, measure);
  else {
    const p = planBoth(d, t, measure)[side];
    layout = { blocks: p.blocks, overflow: p.overflow, minPt: p.minPt, hidden: p.hidden, logoReduced: p.logoReduced, wordTooWide: p.wordTooWide, scale: p.scale, headerScale: p.headerScale, trackPt: p.trackPt, groups: p.groups, notes: [] };
  }
  const tracksN = parseTracks(sideC.tracksText).length;

  if (layout.scale < 1) warnings.push({ side, level: 'info', message: `Text scaled to ${Math.round(layout.scale * 100)}% (tracks ${layout.trackPt} pt) to fit the available regions.` });
  if (layout.headerScale < 1) warnings.push({ side, level: 'info', message: `Header text scaled to ${Math.round(layout.headerScale * 100)}% so the tracks can stay readable.` });
  if (layout.overflow > 0) {
    warnings.push({ side, level: 'warning', message: `${layout.overflow} item(s) do not fit inside the available text regions${s.shrinkToFit ? ' at a readable size' : ''}. They are still drawn (outlined in red), never removed. Shorten the text, relax the legibility limit, or use Manual layout.` });
  }
  if (layout.minPt < s.minLegiblePt - 0.001) warnings.push({ side, level: 'warning', message: `Text is as small as ${Math.round(layout.minPt * 100) / 100} pt, below your ${s.minLegiblePt} pt legibility threshold.` });
  if (layout.hidden) warnings.push({ side, level: 'info', message: `Minimal layout: the ${layout.hidden} track(s) of this side are intentionally not printed.` });
  if (layout.logoReduced) warnings.push({ side, level: 'info', message: 'A logo/wordmark image was reduced to fit its space.' });
  if (layout.wordTooWide) warnings.push({ side, level: 'warning', message: 'A word is wider than its column and will extend past it.' });
  for (const note of layout.notes) warnings.push({ side, level: 'info', message: note });
  if (!tracksN && s.layoutMode !== 'minimal') warnings.push({ side, level: 'warning', message: 'No tracks entered.' });
  if (s.logoAssetId && !assetById(d, s.logoAssetId)) warnings.push({ side, level: 'warning', message: 'Selected logo asset no longer exists.' });

  // typography checks
  const used = new Map<string, ReturnType<typeof faceFor>>();
  for (const [ref, bold] of [[s.headingFont ?? s.font, s.titleBold], [s.bodyFont ?? s.font, s.bodyBold]] as const) { const f = faceFor(ref, bold, d.fonts); used.set(f.faceId, f); }
  for (const f of used.values()) {
    if (f.missingBold) warnings.push({ side, level: 'info', message: 'The chosen font has no bold face, so the regular face is used.' });
    if (f.kind === 'custom' && !f.embeddable) warnings.push({ side, level: 'warning', message: 'An uploaded font forbids embedding; the PDF will use Helvetica instead of it.' });
  }
  // contrast against the flat background colour (skipped when artwork shows through)
  if (!bgAsset || s.backgroundOpacity < 0.5) {
    const cr = contrastRatio(s.textColor, s.backgroundColor);
    if (cr < 4) warnings.push({ side, level: 'warning', message: `Low contrast between text and background (${cr.toFixed(1)}:1; aim for 4.5:1 or more).` });
  }

  // Overlap / safety checks against the source guides
  const reported = new Set<string>();
  const label = (id: string) => (id.startsWith('track') ? 'Tracklist' : cap(id));
  for (const b of layout.blocks) {
    const key = label(b.id);
    for (const k of KO) if (hit(b.ink, k) && !reported.has(key + 'ko')) { reported.add(key + 'ko'); warnings.push({ side, level: 'warning', message: `${key} overlaps the artwork/cut region (source keep-out or the artwork's focal area) and may be hidden or cut.` }); }
    const out = b.ink.x < S.x - 0.01 || b.ink.y < S.y - 0.01 || b.ink.x + b.ink.w > S.x + S.w + 0.01 || b.ink.y + b.ink.h > S.y + S.h + 0.01;
    if (out && !reported.has(key + 'safe')) { reported.add(key + 'safe'); warnings.push({ side, level: 'warning', message: `${key} extends outside the source safety guides.` }); }
  }
  if (s.layoutMode === 'manual') {
    for (let i = 0; i < layout.blocks.length; i++) for (let j = i + 1; j < layout.blocks.length; j++) {
      const a = layout.blocks[i], b = layout.blocks[j];
      if (hit(a.ink, b.ink)) warnings.push({ side, level: 'warning', message: `${label(a.id)} overlaps ${label(b.id)}.` });
    }
  }

  // ----- SVG assembly -----
  const clipD = artClipPath(t);
  const clipId = `clip-${side}${opts.idSuffix ?? ''}`;
  const body: string[] = [];
  body.push(`<path d="${clipD}" fill="${s.backgroundColor}" fill-rule="evenodd"/>`);
  if (bgAsset) {
    const p = imagePlacement(frame.w, frame.h, bgAsset.width, bgAsset.height, sideC.bgCrop);
    body.push(`<image x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none" opacity="${s.backgroundOpacity}" href="${bgAsset.dataUrl}" xlink:href="${bgAsset.dataUrl}"/>`);
  }
  body.push(ornamentSvg(t, s));
  if (bgAsset && s.textScrim > 0) {
    const wmImage = !!assetById(d, s.wordmarkAssetId);
    for (const b of layout.blocks) {
      if (b.id === 'logo' || (b.id === 'wordmark' && wmImage)) continue;
      body.push(`<rect data-scrim="${b.id}" x="${n(b.ink.x - 0.8)}" y="${n(b.ink.y - 0.5)}" width="${n(b.ink.w + 1.6)}" height="${n(b.ink.h + 1)}" rx="0.8" fill="${s.backgroundColor}" fill-opacity="${s.textScrim}"/>`);
    }
  }
  body.push(...layout.blocks.map((b) => b.svg));

  let svg = `<defs><clipPath id="${clipId}"><path d="${clipD}" clip-rule="evenodd"/></clipPath></defs>`;
  svg += `<g id="artwork-${side}" clip-path="url(#${clipId})">${body.join('')}</g>`;

  const g = opts.guides ?? { cut: false, bleed: false, safety: false };
  if (g.safety) for (const sh of t.safety) svg += `<path d="${sh.d}" fill="none" stroke="${GUIDE_COLORS.safety}" stroke-width="0.15"${sh.dashed ? ' stroke-dasharray="1.2 0.8"' : ''}/>`;
  if (g.bleed && t.bleed) svg += `<path d="${t.bleed.d}" fill="none" stroke="${GUIDE_COLORS.bleed}" stroke-width="0.15"/>`;
  if (g.cut) svg += `<path id="cut-${side}${opts.idSuffix ?? ''}" d="${cutOverlayPath(t)}" fill="none" stroke="${GUIDE_COLORS.cut}" stroke-width="0.15"/>`;

  if (opts.preview) {
    for (const k of keepOuts(t)) svg += `<rect x="${n(k.x)}" y="${n(k.y)}" width="${n(k.w)}" height="${n(k.h)}" fill="#ff9900" fill-opacity="0.10" stroke="#ff9900" stroke-width="0.1" stroke-dasharray="0.8 0.6"/>`;
    for (const fz of focal) svg += `<rect x="${n(fz.x)}" y="${n(fz.y)}" width="${n(fz.w)}" height="${n(fz.h)}" fill="#b05bff" fill-opacity="0.12" stroke="#b05bff" stroke-width="0.12" stroke-dasharray="0.8 0.6"/>`;
    if (opts.showRegions) for (const r of textRegions(t)) svg += `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="#2a7fff" fill-opacity="0.06" stroke="#2a7fff" stroke-width="0.08"/>`;
    for (const b of layout.blocks) if (b.overflow) svg += `<rect x="${n(b.ink.x)}" y="${n(b.ink.y)}" width="${n(b.ink.w)}" height="${n(b.ink.h)}" fill="#ff0000" fill-opacity="0.18" stroke="#ff0000" stroke-width="0.15"/>`;
    // draggable hit areas: one per element; track blocks are grouped the way the planner grouped them
    const targets: { id: string; r: Rect }[] = [];
    if (s.layoutMode === 'manual') for (const b of layout.blocks) targets.push({ id: b.id, r: { x: b.x, y: b.y, w: b.w, h: b.h } });
    else {
      let at = 0;
      for (const b of layout.blocks.filter((x) => !x.id.startsWith('track-'))) targets.push({ id: b.id, r: { x: b.x, y: b.y, w: b.w, h: b.h } });
      const tb = layout.blocks.filter((x) => x.id.startsWith('track-'));
      layout.groups.forEach((c, gi) => {
        const grp = tb.slice(at, at + c); at += c;
        if (!grp.length) return;
        const x0 = Math.min(...grp.map((b) => b.x)), y0 = Math.min(...grp.map((b) => b.y));
        targets.push({ id: TRACK_BLOCKS[gi] ?? 'tracks', r: { x: x0, y: y0, w: Math.max(...grp.map((b) => b.x + b.w)) - x0, h: Math.max(...grp.map((b) => b.y + b.h)) - y0 } });
      });
    }
    const man = s.layoutMode === 'manual';
    const lockedSet = d.locked[side];
    for (const tg of targets) {
      const sel = opts.selected === tg.id;
      const lk = !!lockedSet[tg.id as BlockId];
      svg += `<rect data-drag="${tg.id}" x="${n(tg.r.x)}" y="${n(tg.r.y)}" width="${n(tg.r.w)}" height="${n(tg.r.h)}" fill="${sel ? '#2a7fff' : '#000'}" fill-opacity="${sel ? 0.08 : 0}" stroke="${sel || man ? '#2a7fff' : 'none'}" stroke-width="${sel ? 0.2 : 0.1}" stroke-dasharray="${lk ? '0.3 0.3' : '0.6 0.6'}" style="cursor:${lk ? 'not-allowed' : man ? 'move' : 'pointer'}"/>`;
      if (man && sel && !lk) svg += `<rect data-resize="${tg.id}" x="${n(tg.r.x + tg.r.w - 0.8)}" y="${n(tg.r.y + tg.r.h - 0.8)}" width="1.6" height="1.6" fill="#2a7fff" style="cursor:nwse-resize"/>`;
    }
  }
  return { svg, warnings, blocks: layout.blocks, effectiveTrackPt: layout.trackPt, scale: layout.scale, groups: layout.groups };
}

/** Where the automatic planner places each element: used to seed manual mode (positions and track groups). */
export function seedManual(d: Design, t: LibraryTemplate, measure: Measurer) {
  const plan = planBoth({ ...d, style: { ...d.style, layoutMode: 'auto' } }, t, measure);
  const manual = { A: {}, B: {} } as Design['manual'];
  const trackGroups = { A: [], B: [] } as Design['trackGroups'];
  for (const sd of ['A', 'B'] as const) {
    const p = plan[sd];
    const tb = p.blocks.filter((b) => b.id.startsWith('track-'));
    for (const b of p.blocks.filter((x) => !x.id.startsWith('track-'))) manual[sd][b.id as BlockId] = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.w.toFixed(2) };
    let at = 0;
    p.groups.forEach((c, gi) => {
      const grp = tb.slice(at, at + c); at += c;
      if (grp.length && TRACK_BLOCKS[Math.min(gi, TRACK_BLOCKS.length - 1)] && gi < TRACK_BLOCKS.length) {
        manual[sd][TRACK_BLOCKS[gi]] = { x: +Math.min(...grp.map((b) => b.x)).toFixed(2), y: +Math.min(...grp.map((b) => b.y)).toFixed(2), w: +grp[0].w.toFixed(2) };
      }
    });
    const groups = p.groups.slice(0, TRACK_BLOCKS.length);
    if (p.groups.length > TRACK_BLOCKS.length) groups[TRACK_BLOCKS.length - 1] += p.groups.slice(TRACK_BLOCKS.length).reduce((a, b) => a + b, 0);
    trackGroups[sd] = groups;
  }
  // Carry over the sizes the planner actually used, so manual mode starts from exactly the composition on screen.
  const st = d.style;
  const hs = Math.min(plan.A.headerScale, plan.B.headerScale);
  const tp = Math.min(plan.A.trackPt, plan.B.trackPt);
  const f = (v: number) => +Math.max(v * hs, Math.min(v, st.minLegiblePt)).toFixed(2);
  const stylePatch: Partial<Design['style']> = {};
  if (tp < st.trackSizePt) stylePatch.trackSizePt = tp;
  if (hs < 1) {
    stylePatch.titleSizePt = f(st.titleSizePt); stylePatch.metaSizePt = f(st.metaSizePt); stylePatch.wordmarkSizePt = f(st.wordmarkSizePt);
    stylePatch.logoHeightMm = +Math.max(Math.min(st.logoHeightMm, 5), st.logoHeightMm * hs).toFixed(2);
    stylePatch.wordmarkHeightMm = +Math.max(Math.min(st.wordmarkHeightMm, 4), st.wordmarkHeightMm * hs).toFixed(2);
  }
  return { manual, trackGroups, stylePatch };
}

/** True when manual mode's stored tracklist split no longer matches the tracks of that side (so it would run straight over the window/hubs). */
export function tracksStale(d: Design, side: Side): boolean {
  if (d.style.layoutMode !== 'manual') return false;
  const n = parseTracks(d.sides[side].tracksText).length;
  const counts = (d.trackGroups[side] ?? []).filter((c) => c > 0);
  return n > 0 && (counts.length ? counts.reduce((a, b) => a + b, 0) !== n : !d.manual[side].tracks);
}

/** Re-splits one side's tracklist (and its heading) from the automatic plan, leaving every other manual position alone. */
export function reseedTracks(d: Design, t: LibraryTemplate, side: Side, measure: Measurer): Design {
  const seeded = seedManual(d, t, measure);
  const man = { ...d.manual[side] };
  for (const id of [...TRACK_BLOCKS, 'heading' as const]) { delete man[id]; if (seeded.manual[side][id]) man[id] = seeded.manual[side][id]; }
  return { ...d, manual: { ...d.manual, [side]: man }, trackGroups: { ...d.trackGroups, [side]: seeded.trackGroups[side] } };
}

/** Positions only (for callers that do not need the groups). */
export function seedManualPositions(d: Design, t: LibraryTemplate, side: Side, measure: Measurer) {
  return seedManual(d, t, measure).manual[side];
}
