/**
 * Layout planner. Finds the best arrangement of header, side heading and tracklist inside the free text regions that
 * the template's own safety guides leave around the window or hubs, for BOTH sides together.
 *
 *  - Tracks stay in reading order and are split into contiguous, balanced groups (no stray single track).
 *  - The header (logo, wordmark, title, artist, catalogue) goes in the first/top units; tracks follow it.
 *  - Text is only shrunk down to the legibility floor; it is never made unreadable to make everything fit.
 *    If nothing fits at the floor, the overflow is drawn, flagged and reported (never dropped).
 *  - Both sides share a signature (same structure) and, when typography matches, the same text size.
 */
import { PT_TO_MM, assetById, parseTracks, releaseOf, type Design, type Side, type Style, type Track } from './model';
import { imageBlock, placeAt, subtractRect, textBlock, trackBlock, type Blk, type Ctx, type PlacedBlock, type TextLine } from './blocks';
import type { Measurer } from './measure';
import { focalZones, styleFor } from './style';
import { textRegions, type LibraryTemplate, type Rect, type Region } from './templates';

const COL_GAP = 3;
const MIN_COL = 36;
const NARROW_UNIT = 22; // narrower units are not used for track text
const GAP = 1.2;

export interface Unit extends Rect { name: string; idx: number; narrow: boolean; pane: boolean }

export interface PlannedSide {
  blocks: PlacedBlock[];
  overflow: number;
  minPt: number;
  hidden: number;
  logoReduced: boolean;
  wordTooWide: boolean;
  /** Track size relative to the requested size (1 = as requested). */
  scale: number;
  /** Header text size relative to the requested size (1 unless the header had to shrink). */
  headerScale: number;
  trackPt: number;
  /** Structure id, equal on both sides when the arrangement matches. */
  signature: string;
  /** Number of tracks in each placed group (used to seed manual mode). */
  groups: number[];
  /** First extra keep-out rectangle (artwork focal area) that text avoided; null when none applied. */
  focal: Rect | null;
  layoutNote: string;
}

/** Track scale k and header scale h (the header shrinks first, down to 70%, so tracks stay readable). */
export interface Scale { k: number; h: number }

interface Sizes { logo: number; wordmark: number; title: number; artist: number; meta: number; track: number; word: number; heading: number; letter: number }

/** The free regions, minus any extra keep-outs (e.g. the artwork's focal area), split into columns and ordered for reading. */
export function unitsFor(t: LibraryTemplate, extra: Rect[] = []): Unit[] {
  let regions: Region[] = textRegions(t);
  for (const k of extra) regions = regions.flatMap((r) => subtractRect(r, k).map((q) => ({ ...q, name: r.name })));
  regions = regions.filter((r) => r.w >= 4 && r.h >= 3);
  const units: Omit<Unit, 'idx'>[] = [];
  for (const r of regions) {
    const pane = /pane/.test(r.name);
    const cols = pane ? 1 : Math.max(1, Math.floor((r.w + COL_GAP) / (MIN_COL + COL_GAP)));
    const cw = (r.w - (cols - 1) * COL_GAP) / cols;
    for (let c = 0; c < cols; c++) units.push({ name: cols > 1 ? `${r.name} ${c + 1}` : r.name, x: r.x + c * (cw + COL_GAP), y: r.y, w: cw, h: r.h, narrow: cw < NARROW_UNIT, pane });
  }
  units.sort((a, b) => Math.round(a.y * 2) - Math.round(b.y * 2) || a.x - b.x);
  return units.map((u, idx) => ({ ...u, idx }));
}

function sizesFor(s: Style, sc: Scale): Sizes {
  const f = (v: number, k: number) => Math.max(v * k, Math.min(v, s.minLegiblePt)); // never below the legibility floor
  const e = s.headerEmphasis;
  const title = e === 'artist' ? 0.8 : e === 'balanced' ? 0.9 : 1;
  const artist = e === 'artist' ? 1 : e === 'balanced' ? 0.9 : 0.8;
  return { logo: Math.max(Math.min(s.logoHeightMm, 5), s.logoHeightMm * sc.h), wordmark: Math.max(Math.min(s.wordmarkHeightMm, 4), s.wordmarkHeightMm * sc.h), title: f(s.titleSizePt * title, sc.h), artist: f(s.titleSizePt * artist, sc.h), meta: f(s.metaSizePt, sc.h), track: f(s.trackSizePt, sc.k), word: f(s.wordmarkSizePt, sc.h), heading: f(s.metaSizePt * 1.3, sc.h), letter: s.titleSizePt * 2.6 * sc.h };
}

interface Header { items: { id: string; blk: Blk }[]; h: number; reduced: boolean; tooWide: boolean }

function buildHeader(ctx: Ctx, sz: Sizes, w: number, compact: boolean, maxLogoH: number, mergeHeading = false): Header {
  const { d, s } = ctx;
  const items: { id: string; blk: Blk }[] = [];
  let reduced = false;
  const logoId = assetById(d, s.logoAssetId) ? s.logoAssetId : null;
  const wmId = assetById(d, s.wordmarkAssetId) ? s.wordmarkAssetId : null;
  if (logoId) {
    const want = Math.min(sz.logo, maxLogoH);
    const r = imageBlock(ctx, logoId, want, w, Infinity);
    if (r) { items.push({ id: 'logo', blk: r.blk }); reduced ||= r.reduced || want < sz.logo - 0.01; }
  }
  if (wmId) {
    const r = imageBlock(ctx, wmId, Math.min(sz.wordmark, maxLogoH), w, Infinity);
    if (r) { items.push({ id: 'wordmark', blk: r.blk }); reduced ||= r.reduced; }
  } else if (s.wordmarkText.trim()) {
    items.push({ id: 'wordmark', blk: textBlock(ctx, [{ text: s.wordmarkText.trim(), pt: sz.word, bold: true, color: s.accentColor, role: 'heading', tracking: s.titleTracking, case: s.titleCase }], w) });
  }
  const rel = releaseOf(d, ctx.side);
  const sideLabel = mergeHeading && !compact ? d.sides[ctx.side].heading.trim() : '';
  const meta = [d.release.catalogNumber, d.release.year, sideLabel].filter((x) => x.trim()).join(' · ');
  const heading = (text: string, pt: number, bold: boolean): TextLine => ({ text, pt, bold, color: s.textColor, role: 'heading', tracking: s.titleTracking, case: s.titleCase });
  const body = (text: string, pt: number): TextLine => ({ text, pt, color: s.textColor, role: 'body', tracking: s.bodyTracking, case: s.titleCase });
  if (compact) {
    items.push({ id: 'title', blk: textBlock(ctx, [heading([rel.artist, rel.title].filter((x) => x.trim()).join(' – '), sz.title, s.titleBold), body(meta, sz.meta)], w) });
  } else if (s.headerEmphasis === 'artist') {
    items.push({ id: 'artist', blk: textBlock(ctx, [heading(rel.artist, sz.artist, s.titleBold)], w) });
    items.push({ id: 'title', blk: textBlock(ctx, [body(rel.title, sz.title)], w) });
    items.push({ id: 'meta', blk: textBlock(ctx, [body(meta, sz.meta)], w) });
  } else {
    items.push({ id: 'title', blk: textBlock(ctx, [heading(rel.title, sz.title, s.titleBold)], w) });
    items.push({ id: 'artist', blk: textBlock(ctx, [body(rel.artist, sz.artist)], w) });
    items.push({ id: 'meta', blk: textBlock(ctx, [body(meta, sz.meta)], w) });
  }
  const live = items.filter((i) => i.blk.h > 0);
  const h = live.reduce((a, i) => a + i.blk.h, 0) + GAP * Math.max(0, live.length - 1);
  return { items: live, h, reduced, tooWide: live.some((i) => i.blk.tooWide) };
}

export interface Candidate {
  blocks: PlacedBlock[];
  score: number;
  sig: string;
  /** Header structure only (position, split, heading mode): sides that share it look like one release. */
  hsig: string;
  overflow: number;
  groups: number[];
  logoReduced: boolean;
  tooWide: boolean;
}

/** Search passes, tidiest first: the first one that finds any arrangement wins. */
export interface Pass { strict: boolean; modes: (0 | 1 | 2)[] }
export const PASSES: Pass[] = [{ strict: true, modes: [0] }, { strict: true, modes: [0, 1, 2] }, { strict: false, modes: [0, 1, 2] }];

interface Prep {
  ctx: Ctx;
  sz: Sizes;
  tracks: Track[];
  units: Unit[];
  compact: boolean;
  letterUnit: Unit | null;
  /** Strict mode rejects arrangements with a stray single-track group (when there are more than three tracks). */
  strict: boolean;
  /** Heading placements allowed in this pass (0 = above the tracks; 1/2 are fallbacks). */
  modes: (0 | 1 | 2)[];
  heightsFor: (w: number) => number[];
}

export function prepare(ctx: Ctx, scale: Scale, extra: Rect[], pass: Pass): Prep {
  const sz = sizesFor(ctx.s, scale);
  const tracks = parseTracks(ctx.d.sides[ctx.side].tracksText);
  const units = unitsFor(ctx.t, extra);
  const compact = ctx.s.layoutMode === 'separated';
  const letterUnit = compact ? units.find((u) => /left pane/.test(u.name) && u.w >= 6) ?? units.find((u) => u.pane && u.w >= 6) ?? null : null;
  const memo = new Map<string, number[]>();
  const heightsFor = (w: number) => {
    const key = w.toFixed(2);
    if (!memo.has(key)) memo.set(key, tracks.map((tr) => trackBlock(ctx, [tr], tracks, w, sz.track).h));
    return memo.get(key)!;
  };
  return { ctx, sz, tracks, units, compact, letterUnit, strict: pass.strict, modes: pass.modes, heightsFor };
}

const sum = (a: number[], i: number, k: number) => { let s = 0; for (let x = i; x < k; x++) s += a[x]; return s; };

interface Part { cost: number; groups: number[] }

/** Contiguous partition of the tracks over the given slots minimising unbalanced fill and orphans. */
function partition(slots: { w: number; h: number; required: boolean }[], heights: number[][], f: number, headingH: number, n: number, spacing: number): Part | null {
  const memo = new Map<number, Part | null>();
  const go = (i: number, j: number): Part | null => {
    if (i === n && slots.slice(j).every((s) => !s.required)) return { cost: 0, groups: slots.slice(j).map(() => 0) };
    if (j >= slots.length) return null;
    const key = i * 64 + j;
    if (memo.has(key)) return memo.get(key)!;
    let best: Part | null = null;
    const minC = j === f || slots[j].required ? 1 : 0;
    for (let c = minC; i + c <= n; c++) {
      if (j < f && c > 0) break;
      const hh = c ? sum(heights[j], i, i + c) + spacing * (c - 1) + (j === f ? headingH : 0) : 0;
      if (hh > slots[j].h + 0.001) break;
      const rest = go(i + c, j + 1);
      if (!rest) continue;
      const fill = c ? hh / slots[j].h : 0;
      const cost = fill * fill + (c === 1 && n > 3 ? 0.5 : 0) + rest.cost;
      if (!best || cost < best.cost) best = { cost, groups: [c, ...rest.groups] };
    }
    memo.set(key, best);
    return best;
  };
  return go(0, 0);
}

function subsets(arr: number[], maxSize: number): number[][] {
  const out: number[][] = [[]];
  const rec = (start: number, cur: number[]) => {
    if (cur.length >= maxSize) return;
    for (let i = start; i < arr.length; i++) { const nx = [...cur, arr[i]]; out.push(nx); rec(i + 1, nx); }
  };
  rec(0, []);
  return out;
}

function headingBlock(ctx: Ctx, sz: Sizes, w: number): Blk | null {
  const text = ctx.d.sides[ctx.side].heading.trim();
  if (!text || ctx.s.layoutMode === 'separated') return null;
  return textBlock(ctx, [{ text, pt: sz.heading, bold: true, color: ctx.s.accentColor, role: 'heading', tracking: ctx.s.titleTracking, case: ctx.s.titleCase }], w);
}

const IDENTITY = new Set(['logo', 'wordmark']);

/**
 * Evaluate one arrangement. `hi2 >= 0` splits the header: logo/wordmark in unit `hi`, titles in unit `hi2`.
 * Returns null when the header or tracks do not fit at this size.
 */
/** headMode: 0 = side heading above the first track group, 1 = in the header stack, 2 = merged into the catalogue line. */
export function evalCandidate(p: Prep, hi: number, chosen: number[], hi2 = -1, headMode: 0 | 1 | 2 = 0): Candidate | null {
  const { ctx, sz, tracks, units } = p;
  const s = ctx.s;
  const hu = units[hi];
  const blocks: PlacedBlock[] = [];
  let reduced = false;
  let tooWide = false;
  const remainders: { x: number; y: number; w: number; h: number; ord: number; uy: number; uh: number }[] = [];
  const stack = (unit: Unit, items: { id: string; blk: Blk }[]) => {
    let y = unit.y;
    for (const it of items) { blocks.push(placeAt(it.blk, unit.x, y, it.id)); y += it.blk.h + GAP; }
    const used = items.length ? y - unit.y : 0;
    remainders.push({ x: unit.x, y: unit.y + used, w: unit.w, h: Math.max(0, unit.h - used), ord: unit.idx + 0.1, uy: unit.y, uh: unit.h });
  };
  const headInHeader = headMode === 1;
  const merged = headMode === 2;
  const hdBlk = (w: number): { id: string; blk: Blk }[] => { const b = headInHeader ? headingBlock(ctx, sz, w) : null; return b ? [{ id: 'heading', blk: b }] : []; };
  if (hi2 < 0) {
    const mk = (maxLogo: number) => { const h = buildHeader(ctx, sz, hu.w, p.compact, maxLogo, merged); const extra = hdBlk(hu.w); return { ...h, items: [...h.items, ...extra], h: h.h + extra.reduce((a, i) => a + i.blk.h + GAP, 0) }; };
    let header = mk(40);
    if (header.h > hu.h + 0.001) {
      // shrink the logo before giving up on this unit
      const logoH = header.items.find((i) => i.id === 'logo')?.blk.h ?? 0;
      const spare = header.h - hu.h;
      if (!logoH || logoH - spare < 6) return null;
      header = mk(logoH - spare - 0.01);
      if (header.h > hu.h + 0.001) return null;
    }
    reduced = header.reduced; tooWide = header.tooWide;
    stack(hu, header.items);
  } else {
    const u2 = units[hi2];
    const ident = buildHeader(ctx, sz, hu.w, p.compact, Math.max(6, hu.h - 0.01), merged);
    const titles = buildHeader(ctx, sz, u2.w, p.compact, 40, merged);
    const idItems = ident.items.filter((i) => IDENTITY.has(i.id));
    const tItems = [...titles.items.filter((i) => !IDENTITY.has(i.id)), ...hdBlk(u2.w)];
    const hOf = (a: { blk: Blk }[]) => a.reduce((x, i) => x + i.blk.h, 0) + GAP * Math.max(0, a.length - 1);
    if (!idItems.length || hOf(idItems) > hu.h + 0.001 || hOf(tItems) > u2.h + 0.001) return null;
    reduced = ident.reduced; tooWide = ident.tooWide || titles.tooWide;
    stack(hu, idItems);
    stack(u2, tItems);
  }
  if (p.letterUnit && p.letterUnit.idx !== hi) {
    const lb = textBlock(ctx, [{ text: ctx.side, pt: sz.letter, bold: true, color: s.accentColor, role: 'heading', tracking: 0 }], p.letterUnit.w);
    if (lb.h <= p.letterUnit.h + 0.001) blocks.push(placeAt(lb, p.letterUnit.x, p.letterUnit.y, 'heading'));
  }
  const splitCost = (hi2 >= 0 ? 5 : 0) + (headInHeader ? 15 : 0) + (merged ? 25 : 0); // alternatives to the heading above the tracks are fallbacks
  if (!tracks.length || s.layoutMode === 'minimal') {
    return { blocks, score: -12 * hi - splitCost, sig: `h${hi}/${hi2}${headMode ? 'H' + headMode : ''}|-`, hsig: `h${hi}/${hi2}H${headMode}`, overflow: 0, groups: [], logoReduced: reduced, tooWide };
  }
  // track slots in reading order: the free space under the header parts, then the chosen units
  const slots = [
    ...remainders.map((r) => ({ ...r, required: false })),
    ...chosen.map((i) => ({ x: units[i].x, y: units[i].y, w: units[i].w, h: units[i].h, ord: i, uy: units[i].y, uh: units[i].h, required: true })),
  ].sort((a, b) => a.ord - b.ord); // reading order of the units (free space under a header part comes right after that part)
  const heights = slots.map((sl) => p.heightsFor(sl.w));
  let best: { part: Part; f: number; hb: Blk | null } | null = null;
  slots.forEach((_, f) => {
    if (slots.slice(0, f).some((x) => x.required)) return; // required slots cannot be skipped
    const hb = headInHeader || merged ? null : headingBlock(ctx, sz, slots[f].w);
    const part = partition(slots, heights, f, hb ? hb.h + 0.8 : 0, tracks.length, s.trackSpacingMm);
    if (part && (!best || part.cost < best.part.cost)) best = { part, f, hb };
  });
  if (!best) return null;
  const { part, f, hb } = best as { part: Part; f: number; hb: Blk | null };
  let i = 0;
  const groups: number[] = [];
  const fills: number[] = [];
  const usedSlots: typeof slots = [];
  slots.forEach((sl, j) => {
    const c = part.groups[j];
    if (!c) return;
    let yy = sl.y;
    if (j === f && hb) { blocks.push(placeAt(hb, sl.x, yy, 'heading')); yy += hb.h + 0.8; }
    for (let k = 0; k < c; k++) {
      const tb = trackBlock(ctx, [tracks[i + k]], tracks, sl.w, sz.track);
      blocks.push(placeAt(tb, sl.x, yy, `track-${tracks[i + k].number}`));
      yy += tb.h + s.trackSpacingMm;
    }
    fills.push((yy - s.trackSpacingMm - sl.y) / sl.h);
    usedSlots.push(sl);
    groups.push(c);
    i += c;
  });
  const mean = fills.reduce((a, b) => a + b, 0) / fills.length;
  const std = Math.sqrt(fills.reduce((a, b) => a + (b - mean) ** 2, 0) / fills.length);
  const orphans = groups.filter((g) => g === 1).length * (tracks.length > 3 ? 1 : 0);
  if (p.strict && orphans) return null;
  // a tracklist should not be read across the window: penalise consecutive groups separated by a gap (the keep-out)
  let crossings = 0;
  for (let k = 1; k < usedSlots.length; k++) {
    const a = usedSlots[k - 1], b = usedSlots[k];
    if (Math.abs(b.uy - a.uy) > 0.5 && b.uy - (a.uy + a.uh) > 1.5) crossings++;
  }
  if (p.strict && crossings && tracks.length > 3) return null; // tidy pass: a list is never split around the window
  const score = -30 * std - 25 * orphans - 8 * (groups.length - 1) - 25 * crossings - 12 * hi - splitCost + (part.groups[0] > 0 ? 2 : 0);
  return { blocks, score, sig: `h${hi}/${hi2}${headMode ? 'H' + headMode : ''}|${chosen.join(',')}|f${f}`, hsig: `h${hi}/${hi2}H${headMode}`, overflow: 0, groups, logoReduced: reduced, tooWide };
}

/** All feasible arrangements at one size (best first). Split-header arrangements are tried only if the combined header fits nowhere. */
export function enumerate(p: Prep): Candidate[] {
  const eligible = p.units.filter((u) => !u.narrow && u.idx !== p.letterUnit?.idx);
  // Necessary condition: even one line per track must fit in the total free height. Skips hopeless sizes instantly.
  if (p.tracks.length && p.ctx.s.layoutMode !== 'minimal') {
    const oneLine = p.sz.track * PT_TO_MM * p.ctx.s.lineHeight;
    if (p.tracks.length * oneLine > eligible.reduce((a, u) => a + u.h, 0) + 0.5) return [];
  }
  const heads = eligible.slice(0, 3);
  const out: Candidate[] = [];
  for (const hu of heads) {
    const later = eligible.filter((u) => u.idx > hu.idx).map((u) => u.idx);
    for (const sub of subsets(later, 4)) {
      for (const mode of p.modes) { const c = evalCandidate(p, hu.idx, sub, -1, mode); if (c) out.push(c); }
    }
  }
  const hasIdentity = !!(assetById(p.ctx.d, p.ctx.s.logoAssetId) || assetById(p.ctx.d, p.ctx.s.wordmarkAssetId));
  if (!out.length && hasIdentity) {
    for (const hu of heads) {
      for (const u2 of eligible.filter((u) => u.idx > hu.idx).slice(0, 3)) {
        const later = eligible.filter((u) => u.idx > hu.idx && u.idx !== u2.idx).map((u) => u.idx);
        for (const sub of subsets(later, 3)) {
          for (const mode of p.modes) { const c = evalCandidate(p, hu.idx, sub, u2.idx, mode); if (c) out.push(c); }
        }
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Last resort at the smallest allowed size: fill units in reading order; whatever does not fit is drawn and flagged. */
function fallback(p: Prep): Candidate {
  const { ctx, sz, tracks, units } = p;
  const s = ctx.s;
  const eligible = units.filter((u) => !u.narrow && u.idx !== p.letterUnit?.idx);
  const hu = eligible[0] ?? units[0];
  const header = buildHeader(ctx, sz, hu.w, p.compact, 40);
  const blocks: PlacedBlock[] = [];
  let y = hu.y;
  let overflow = header.h > hu.h + 0.001 ? header.items.length : 0;
  for (const it of header.items) { blocks.push(placeAt(it.blk, hu.x, y, it.id, header.h > hu.h + 0.001)); y += it.blk.h + GAP; }
  if (p.letterUnit && p.letterUnit.idx !== hu.idx) blocks.push(placeAt(textBlock(ctx, [{ text: ctx.side, pt: sz.letter, bold: true, color: s.accentColor, role: 'heading' }], p.letterUnit.w), p.letterUnit.x, p.letterUnit.y, 'heading'));
  if (s.layoutMode === 'minimal') return { blocks, score: -1e6, sig: 'fallback', hsig: 'fallback', overflow, groups: [], logoReduced: header.reduced, tooWide: header.tooWide };
  const slots = eligible.map((u) => ({ x: u.x, y: u.y, w: u.w, h: u.h, used: 0 }));
  const first = slots.findIndex((sl) => sl.x === hu.x && sl.y === hu.y);
  if (first >= 0) { slots[first].y = y; slots[first].h = Math.max(0, hu.h - header.h - GAP); }
  let si = Math.max(0, first);
  const hb = headingBlock(ctx, sz, slots[si]?.w ?? hu.w);
  if (hb && slots[si]) { blocks.push(placeAt(hb, slots[si].x, slots[si].y, 'heading', hb.h > slots[si].h)); slots[si].used += hb.h + 0.8; }
  const groups: number[] = [];
  let last = -1;
  for (const tr of tracks) {
    let placed = false;
    for (let j = si; j < slots.length; j++) {
      const tb = trackBlock(ctx, [tr], tracks, slots[j].w, sz.track);
      if (slots[j].used + tb.h <= slots[j].h + 0.001) {
        blocks.push(placeAt(tb, slots[j].x, slots[j].y + slots[j].used, `track-${tr.number}`));
        slots[j].used += tb.h + s.trackSpacingMm;
        si = j; placed = true;
        if (last !== j) { groups.push(0); last = j; }
        groups[groups.length - 1]++;
        break;
      }
    }
    if (!placed) {
      const j = slots.length - 1;
      const tb = trackBlock(ctx, [tr], tracks, slots[j].w, sz.track);
      blocks.push(placeAt(tb, slots[j].x, slots[j].y + slots[j].used, `track-${tr.number}`, true));
      slots[j].used += tb.h + s.trackSpacingMm;
      overflow++;
    }
  }
  return { blocks, score: -1e6, sig: 'fallback', hsig: 'fallback', overflow, groups, logoReduced: header.reduced, tooWide: header.tooWide };
}

/** Candidate (track, header) scales, mildest first: at each track size the header is shrunk before the tracks are. */
const scalesFor = (s: Style): Scale[] => {
  if (!s.shrinkToFit) return [{ k: 1, h: 1 }];
  const floor = Math.max(0.4, Math.min(1, Math.min(s.trackSizePt, s.minLegiblePt) / s.trackSizePt), 4 / s.trackSizePt);
  const ks: number[] = [];
  for (let k = 1; k > floor + 1e-6; k = +(k - 0.05).toFixed(2)) ks.push(k);
  ks.push(+floor.toFixed(3));
  return ks.flatMap((k) => [1, 0.85, 0.7].map((h) => ({ k, h })));
};

const trackKey = (s: Style) => JSON.stringify([s.font, s.bodyFont, s.trackSizePt, s.titleSizePt, s.metaSizePt, s.lineHeight, s.trackSpacingMm, s.bodyBold, s.bodyTracking, s.minLegiblePt, s.shrinkToFit, s.layoutMode]);

function finish(p: Prep, c: Candidate, scale: Scale, extra: Rect | null): PlannedSide {
  const sz = p.sz;
  const tr = p.tracks.length && p.ctx.s.layoutMode !== 'minimal';
  return {
    blocks: c.blocks, overflow: c.overflow,
    minPt: Math.min(sz.title, sz.artist, sz.meta, tr ? sz.track : Infinity),
    hidden: p.ctx.s.layoutMode === 'minimal' ? p.tracks.length : 0,
    logoReduced: c.logoReduced, wordTooWide: c.tooWide,
    scale: +(sz.track / p.ctx.s.trackSizePt).toFixed(3), headerScale: scale.h, trackPt: +sz.track.toFixed(2),
    signature: c.sig, groups: c.groups, focal: extra,
    layoutNote: c.sig === 'fallback' ? 'overflow' : `${c.groups.length || 1} group(s)`,
  };
}

const cache = new WeakMap<Measurer, Map<string, Record<Side, PlannedSide>>>();
const CACHE_LIMIT = 16;

/**
 * Everything that influences the planned composition, and nothing else. Manual positions, locks and export options are not
 * part of it, so dragging in manual mode (which still needs the automatic plan as a reference) never re-plans.
 */
function planKey(d: Design, t: LibraryTemplate): string {
  return JSON.stringify([
    t.id, d.release, d.style, d.sides,
    d.fonts.map((f) => [f.id, f.family, f.weight]),
    d.assets.map((a) => [a.id, a.width, a.height]),
  ]);
}

/** Plan both sides together (memoised per design object). */
export function planBoth(d: Design, t: LibraryTemplate, measure: Measurer): Record<Side, PlannedSide> {
  let store = cache.get(measure);
  if (!store) cache.set(measure, (store = new Map()));
  const key = planKey(d, t);
  const hit = store.get(key);
  if (hit) { store.delete(key); store.set(key, hit); return hit; } // refresh recency

  const sides = ['A', 'B'] as const;
  const ctx = {} as Record<Side, Ctx>;
  const focal = {} as Record<Side, Rect[]>;
  for (const sd of sides) {
    const s = styleFor(d, sd);
    ctx[sd] = { d, t, side: sd, measure, s };
    focal[sd] = t.frame ? focalZones(d, sd, t.frame) : [];
  }
  const out = {} as Record<Side, PlannedSide>;
  const A = ctx.A.s, B = ctx.B.s;
  const common = trackKey(A) === trackKey(B);
  const run = (sd: Side, scale: Scale, pass: Pass) => prepare(ctx[sd], scale, focal[sd], pass);

  if (common) {
    // pass 1 keeps tracks tidily grouped (no stray single track); pass 2 relaxes that only if nothing else fits
    search: for (const pass of PASSES) {
      for (const scale of scalesFor(A)) {
        const pa = run('A', scale, pass), pb = run('B', scale, pass);
        const ca = enumerate(pa).slice(0, 60), cb = enumerate(pb).slice(0, 60);
        if (!ca.length || !cb.length) continue;
        let best: [Candidate, Candidate] | null = null, bs = -Infinity;
        for (const a of ca) for (const b of cb) {
          const sc = a.score + b.score + (a.hsig === b.hsig ? 40 : 0) + (a.sig === b.sig ? 10 : 0);
          if (sc > bs) { bs = sc; best = [a, b]; }
        }
        out.A = finish(pa, best![0], scale, focal.A[0] ?? null);
        out.B = finish(pb, best![1], scale, focal.B[0] ?? null);
        break search;
      }
    }
  }
  for (const sd of sides) {
    if (out[sd]) continue;
    const scales = scalesFor(ctx[sd].s);
    /** Finds a tidy arrangement with the given extra keep-outs; null when none exists at a readable size. */
    const attempt = (extra: Rect[]) => {
      for (const pass of PASSES) {
        for (const scale of scales) {
          const p = prepare(ctx[sd], scale, extra, pass);
          const c = enumerate(p)[0];
          if (c) return finish(p, c, scale, extra[0] ?? null);
        }
      }
      return null;
    };
    // The artwork focal area is a soft preference: readability is not. If text cannot stay clear of it at a readable
    // size, plan again without it (the editor then warns that text overlaps the focal area) before ever overflowing.
    out[sd] = attempt(focal[sd]) ?? (focal[sd].length ? attempt([]) : null) as PlannedSide;
    if (out[sd] && focal[sd].length && out[sd].focal === null) out[sd] = { ...out[sd], focal: null, layoutNote: 'focal-relaxed' };
    if (!out[sd]) {
      const scale = scales[scales.length - 1];
      const p = prepare(ctx[sd], scale, focal[sd], PASSES[2]);
      out[sd] = finish(p, fallback(p), scale, focal[sd][0] ?? null);
    }
  }
  store.set(key, out);
  if (store.size > CACHE_LIMIT) store.delete(store.keys().next().value as string);
  return out;
}

