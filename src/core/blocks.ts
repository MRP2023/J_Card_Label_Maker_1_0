/** Block builders shared by the planner and the renderer: wrapped text, images, track lists. Coordinates are local to a block. */
import { faceFor, type Face } from './fonts';
import type { Measurer } from './measure';
import { PT_TO_MM, assetById, type BlockId, type Design, type Side, type Style, type Track } from './model';
import { applyCase, bodyFontOf, headingFontOf } from './style';
import type { LibraryTemplate, Rect } from './templates';

export interface RenderWarning { side: Side | 'page'; level: 'error' | 'warning' | 'info'; message: string }

export interface PlacedBlock {
  id: string;
  x: number; y: number; w: number; h: number;
  /** Rectangle actually covered by ink, in label coordinates (used for overlap checks). */
  ink: Rect;
  svg: string;
  overflow?: boolean;
}

export interface Ctx {
  d: Design;
  t: LibraryTemplate;
  side: Side;
  measure: Measurer;
  /** Effective style of this side (shared style + side overrides + Side B variant). */
  s: Style;
}

export interface Blk { w: number; h: number; inkW: number; els: string[]; tooWide?: boolean; inkX?: number }
export interface TextLine { text: string; pt: number; color: string; role: 'heading' | 'body'; bold?: boolean; tracking?: number; case?: Style['titleCase'] }

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const n = (v: number) => +v.toFixed(3);

export const roleFace = (ctx: Ctx, role: 'heading' | 'body', bold: boolean): Face =>
  faceFor(role === 'heading' ? headingFontOf(ctx.s) : bodyFontOf(ctx.s), bold, ctx.d.fonts);

export function textEl(ctx: Ctx, x: number, y: number, text: string, pt: number, color: string, face: Face, tracking = 0, anchor: 'start' | 'middle' | 'end' = 'start') {
  return `<text x="${n(x)}" y="${n(y)}" font-family="${esc(face.css)}" font-size="${n(pt * PT_TO_MM)}"` +
    `${face.svgBold ? ' font-weight="bold"' : ''}${tracking ? ` letter-spacing="${n(tracking * pt * PT_TO_MM)}"` : ''} fill="${color}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(text)}</text>`;
}

export function wrap(text: string, maxW: number, width: (s: string) => number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let tooWide = false;
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (width(trial) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
    if (!cur.includes(' ') && width(cur) > maxW) tooWide = true;
  }
  if (cur) lines.push(cur);
  return { lines: lines.length ? lines : [''], tooWide };
}

/** Wrapped, aligned text block of several styled lines, laid out in a column of width `w`. */
export function textBlock(ctx: Ctx, lines: TextLine[], w: number): Blk {
  const s = ctx.s;
  const els: string[] = [];
  let y = 0;
  let inkW = 0;
  let tooWide = false;
  const ax = s.textAlign === 'left' ? 0 : s.textAlign === 'center' ? w / 2 : w;
  const anchor = s.textAlign === 'left' ? 'start' : s.textAlign === 'center' ? 'middle' : 'end';
  for (const l of lines) {
    const text = applyCase(l.text, l.case ?? 'none');
    if (!text.trim()) continue;
    const face = roleFace(ctx, l.role, l.bold ?? false);
    const tr = l.tracking ?? 0;
    const m = (t: string) => ctx.measure(t, face, l.pt, tr);
    const r = wrap(text, w, m);
    tooWide ||= r.tooWide;
    const size = l.pt * PT_TO_MM;
    const lh = size * s.lineHeight;
    for (const ln of r.lines) {
      els.push(textEl(ctx, ax, y + size * 0.8 + (lh - size) / 2, ln, l.pt, l.color, face, tr, anchor));
      inkW = Math.max(inkW, Math.min(w, m(ln)));
      y += lh;
    }
  }
  const inkX = s.textAlign === 'left' ? 0 : s.textAlign === 'center' ? (w - inkW) / 2 : w - inkW;
  return { w, h: y, inkW, inkX, els, tooWide };
}

export function imageBlock(ctx: Ctx, assetId: string | null, wantH: number, maxW: number, maxH: number): { blk: Blk; reduced: boolean } | null {
  const a = assetById(ctx.d, assetId);
  if (!a) return null;
  const aspect = a.width / a.height;
  let h = wantH;
  let w = h * aspect;
  let reduced = false;
  if (w > maxW) { w = maxW; h = w / aspect; reduced = true; }
  if (h > maxH) { h = maxH; w = h * aspect; reduced = true; }
  const x = ctx.s.textAlign === 'left' ? 0 : ctx.s.textAlign === 'center' ? (maxW - w) / 2 : maxW - w;
  return {
    blk: { w: maxW, h, inkW: w, inkX: x, els: [`<image data-role="${assetId}" x="${n(x)}" y="0" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid meet" href="${a.dataUrl}" xlink:href="${a.dataUrl}"/>`] },
    reduced,
  };
}

/** Track list block. Duration column and numbers are aligned across the whole side (`all`). */
export function trackBlock(ctx: Ctx, tracks: Track[], all: Track[], w: number, pt: number): Blk {
  const s = ctx.s;
  const face = roleFace(ctx, 'body', s.bodyBold);
  const tr = s.bodyTracking;
  const m = (t: string) => ctx.measure(t, face, pt, tr);
  const size = pt * PT_TO_MM;
  const lh = size * s.lineHeight;
  const durW = s.showDurations ? Math.max(0, ...all.map((t) => (t.duration ? m(t.duration) : 0))) : 0;
  const gap = durW ? size * 0.8 : 0;
  const numW = s.showTrackNumbers ? m('0'.repeat(String(all.length || 1).length) + '.') + size * 0.4 : 0;
  const textW = Math.max(1, w - durW - gap - numW);
  const els: string[] = [];
  let y = 0;
  let inkW = 0;
  let tooWide = false;
  tracks.forEach((t, ti) => {
    const r = wrap(applyCase(t.title, s.trackCase), textW, m);
    tooWide ||= r.tooWide;
    r.lines.forEach((ln, i) => {
      const base = y + size * 0.8 + (lh - size) / 2;
      if (i === 0 && s.showTrackNumbers) els.push(textEl(ctx, 0, base, `${t.number}.`, pt, s.accentColor, face, tr));
      els.push(textEl(ctx, numW, base, ln, pt, s.textColor, face, tr));
      if (i === 0 && s.showDurations && t.duration) els.push(textEl(ctx, w, base, t.duration, pt, s.textColor, face, tr, 'end'));
      inkW = Math.max(inkW, numW + m(ln) + (i === 0 && t.duration ? gap + m(t.duration) : 0));
      y += lh;
    });
    if (ti < tracks.length - 1) y += s.trackSpacingMm;
  });
  return { w, h: y, inkW: Math.min(w, durW ? w : inkW), inkX: 0, els, tooWide };
}

export const placeAt = (b: Blk, x: number, y: number, id: BlockId | string, overflow = false): PlacedBlock => ({
  id, x, y, w: b.w, h: b.h, overflow,
  ink: { x: x + (b.inkX ?? 0), y, w: b.inkW, h: b.h },
  svg: `<g data-block="${id}" transform="translate(${n(x)} ${n(y)})">${b.els.join('')}</g>`,
});

export const hit = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.01 && a.x + a.w > b.x + 0.01 && a.y < b.y + b.h - 0.01 && a.y + a.h > b.y + 0.01;

/** Rectangles left over when `k` is removed from `r`. */
export function subtractRect(r: Rect, k: Rect): Rect[] {
  if (!hit(r, k)) return [r];
  const out: Rect[] = [];
  const x0 = Math.max(r.x, k.x), x1 = Math.min(r.x + r.w, k.x + k.w);
  if (k.y > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: k.y - r.y });
  if (k.y + k.h < r.y + r.h) out.push({ x: r.x, y: k.y + k.h, w: r.w, h: r.y + r.h - (k.y + k.h) });
  if (k.x > r.x) out.push({ x: r.x, y: Math.max(r.y, k.y), w: k.x - r.x, h: Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y) });
  if (k.x + k.w < r.x + r.w) out.push({ x: x1, y: Math.max(r.y, k.y), w: r.x + r.w - x1, h: Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y) });
  void x0;
  return out.filter((q) => q.w > 0.01 && q.h > 0.01);
}
