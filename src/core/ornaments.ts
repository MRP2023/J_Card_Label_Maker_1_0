/**
 * Deterministic vector ornaments for the art direction (frames, rules, edge stripes, grids, dots, scanlines).
 * They are drawn inside the artwork clip group, so they can never cross the source bleed frame or the cut-outs,
 * and they are placed outside the text regions or kept faint enough not to harm legibility.
 */
import { n } from './blocks';
import type { Style } from './model';
import { keepOuts, safeRect, type LibraryTemplate } from './templates';

export function ornamentSvg(t: LibraryTemplate, s: Style): string {
  const o = s.ornament;
  if (o.kind === 'none' || !t.frame || !t.cut) return '';
  const col = o.color === 'text' ? s.textColor : o.color === 'secondary' ? s.secondaryColor : s.accentColor;
  const F = t.frame;
  const S = safeRect(t);
  const C = t.cut.bbox;
  const op = Math.max(0, Math.min(1, o.opacity));
  const faint = op * 0.3; // background patterns stay behind the text
  const g = (inner: string, opacity = op) => `<g data-ornament="${o.kind}" opacity="${n(opacity)}">${inner}</g>`;
  switch (o.kind) {
    case 'frame': {
      const pad = Math.max(0.3, Math.min(0.9, Math.min(S.x - C.x, S.y - C.y) * 0.5));
      return g(`<rect x="${n(S.x - pad)}" y="${n(S.y - pad)}" width="${n(S.w + 2 * pad)}" height="${n(S.h + 2 * pad)}" rx="1" fill="none" stroke="${col}" stroke-width="0.25"/>`);
    }
    case 'rules': {
      const ko = keepOuts(t);
      const y1 = ko.length ? Math.min(...ko.map((k) => k.y)) - 0.5 : S.y - 0.6;
      const y2 = ko.length ? Math.max(...ko.map((k) => k.y + k.h)) + 0.5 : S.y + S.h + 0.6;
      return g(`<line x1="${n(S.x)}" y1="${n(y1)}" x2="${n(S.x + S.w)}" y2="${n(y1)}" stroke="${col}" stroke-width="0.25"/><line x1="${n(S.x)}" y1="${n(y2)}" x2="${n(S.x + S.w)}" y2="${n(y2)}" stroke="${col}" stroke-width="0.25"/>`);
    }
    case 'stripes': {
      // three stripes inside the margin between the safe area and the cut edge (top or bottom, whichever is larger),
      // so they can never touch text. If that margin is too thin for stripes, none are drawn.
      const topGap = S.y - C.y;
      const bottomGap = C.y + C.h - (S.y + S.h);
      const atTop = topGap > bottomGap;
      const gap = Math.max(topGap, bottomGap);
      if (gap < 0.45) return '';
      const th = Math.min(0.9, (gap - 0.05) / 3);
      const y0 = atTop ? C.y + 0.05 : C.y + C.h - 3 * th - 0.05;
      const cols = [s.accentColor, s.secondaryColor, s.textColor];
      return g(cols.map((c, i) => `<rect x="${n(-5)}" y="${n(y0 + i * th)}" width="${n(F.w + 10)}" height="${n(th)}" fill="${c}"/>`).join(''), Math.max(op, 0.6));
    }
    case 'grid': {
      let d = '';
      for (let x = 0; x <= F.w; x += 4) d += `M${n(x)} 0V${n(F.h)}`;
      for (let y = 0; y <= F.h; y += 4) d += `M0 ${n(y)}H${n(F.w)}`;
      return g(`<path d="${d}" fill="none" stroke="${col}" stroke-width="0.12"/>`, faint);
    }
    case 'dots': {
      let c = '';
      for (let y = 1.2; y < F.h; y += 2.4) for (let x = 1.2 + (Math.round(y / 2.4) % 2 ? 1.2 : 0); x < F.w; x += 2.4) c += `<circle cx="${n(x)}" cy="${n(y)}" r="0.35"/>`;
      return g(`<g fill="${col}">${c}</g>`, faint);
    }
    case 'scanlines': {
      let d = '';
      for (let y = 0.4; y < F.h; y += 0.9) d += `M0 ${n(y)}H${n(F.w)}`;
      return g(`<path d="${d}" fill="none" stroke="${col}" stroke-width="0.18"/>`, faint);
    }
  }
}
