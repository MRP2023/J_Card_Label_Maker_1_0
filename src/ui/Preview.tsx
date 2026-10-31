import { useMemo, useRef } from 'react';
import type { Measurer } from '../core/measure';
import type { Design, Side } from '../core/model';
import { renderLabel } from '../core/render';
import { safeRect, type LibraryTemplate } from '../core/templates';

export interface Guides { cut: boolean; bleed: boolean; safety: boolean; regions: boolean }

interface Props {
  side: Side;
  design: Design;
  template: LibraryTemplate & { frame: { w: number; h: number } };
  measure: Measurer;
  fontVersion: number;
  zoom: number;
  guides: Guides;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Called when the user starts editing an element while the layout is automatic: switches to manual and seeds it. */
  onEnterManual: () => void;
  onDrag: (id: string, x: number, y: number, w: number) => void;
  onResize: (id: string, w: number) => void;
}

type Drag = { kind: 'move' | 'resize'; id: string; x: number; y: number; ox: number; oy: number; ow: number; k: number; dx0: number; dx1: number; dy0: number; dy1: number };

/** One label, live. Elements can be selected, dragged and resized; everything is clamped into the source safe area. */
export function LabelPreview({ side, design, template, measure, fontVersion, zoom, guides, selected, onSelect, onEnterManual, onDrag, onResize }: Props) {
  const r = useMemo(
    () => renderLabel(design, template, side, measure, { preview: true, guides, showRegions: guides.regions, selected }),
    // fontVersion forces a re-layout when a font finishes loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design, template, side, measure, guides, selected, fontVersion],
  );
  const f = template.frame;
  const pad = 2;
  const vb = [-pad, -pad, f.w + 2 * pad, f.h + 2 * pad];
  const drag = useRef<Drag | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const widthPx = vb[2] * zoom * 4; // 1 mm == zoom * 4 CSS px, so on-screen size is proportional to real size
  const S = safeRect(template);
  const manual = design.style.layoutMode === 'manual';
  const locked = (id: string) => !!design.locked[side][id as keyof Design['locked'][Side]];
  const summary = [r.scale < 1 && `tracks ${r.effectiveTrackPt} pt`, r.blocks.some((b) => b.overflow) && 'overflow'].filter(Boolean).join(', ');

  const start = (e: React.PointerEvent) => {
    const el = (e.target as Element).closest('[data-drag],[data-resize]');
    if (!el) { onSelect(null); return; }
    const resize = el.hasAttribute('data-resize');
    const id = (el.getAttribute('data-drag') ?? el.getAttribute('data-resize'))!;
    onSelect(id);
    if (!manual) { onEnterManual(); return; } // first edit: switch to manual (seeded from the planner), then drag again
    if (locked(id)) return;
    const b = r.blocks.find((x) => x.id === id);
    if (!b) return;
    const box = ref.current!.querySelector('svg')!.getBoundingClientRect();
    // allowed travel so that the ink stays inside the safe area
    const dx0 = S.x - b.ink.x, dx1 = S.x + S.w - (b.ink.x + b.ink.w);
    const dy0 = S.y - b.ink.y, dy1 = S.y + S.h - (b.ink.y + b.ink.h);
    drag.current = { kind: resize ? 'resize' : 'move', id, x: e.clientX, y: e.clientY, ox: b.x, oy: b.y, ow: b.w, k: vb[2] / box.width, dx0, dx1, dy0, dy1 };
    ref.current!.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const ddx = (e.clientX - d.x) * d.k, ddy = (e.clientY - d.y) * d.k;
    if (d.kind === 'resize') { onResize(d.id, +Math.max(4, Math.min(S.w, d.ow + ddx)).toFixed(2)); return; }
    const cx = Math.min(Math.max(ddx, Math.min(d.dx0, d.dx1)), Math.max(d.dx0, d.dx1));
    const cy = Math.min(Math.max(ddy, Math.min(d.dy0, d.dy1)), Math.max(d.dy0, d.dy1));
    onDrag(d.id, +(d.ox + cx).toFixed(2), +(d.oy + cy).toFixed(2), d.ow);
  };

  return (
    <div className="label-preview">
      <h3>Side {side} <small>{summary && `(${summary})`}</small></h3>
      <div ref={ref} className="svg-wrap" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drag.current = null; }}>
        <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox={vb.join(' ')} style={{ width: widthPx, maxWidth: 'none' }}
          dangerouslySetInnerHTML={{ __html: r.svg }} />
      </div>
    </div>
  );
}
