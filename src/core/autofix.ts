/**
 * Automatic fix for "overlaps the artwork/cut region" warnings.
 *
 * Moves only the blocks that touch a window/hub keep-out or an artwork focal area to the nearest free spot inside the
 * safety guides that overlaps nothing else. It never resizes text, never touches locked blocks and never changes the
 * template geometry. Whatever it cannot place is reported, not hidden.
 */
import { hit } from './blocks';
import type { Measurer } from './measure';
import type { BlockId, Design, Side } from './model';
import { renderLabel, seedManual } from './render';
import { focalZones } from './style';
import { keepOuts, safeRect, type LibraryTemplate, type Rect } from './templates';

export interface AutoFixResult {
  design: Design;
  /** Blocks that were moved. */
  moved: { side: Side; id: string }[];
  /** Blocks that still overlap, with the reason. */
  remaining: { side: Side; id: string; reason: string }[];
  /** True when the design had to be switched from an automatic layout to manual to move blocks. */
  switchedToManual: boolean;
}

const STEP = 0.5;
const GAP = 0.3;
const inflate = (r: Rect, g: number): Rect => ({ x: r.x - g, y: r.y - g, w: r.w + 2 * g, h: r.h + 2 * g });
const NAMES: Record<string, string> = { title: 'Title', artist: 'Artist', meta: 'Meta line', heading: 'Side heading', logo: 'Logo', wordmark: 'Wordmark' };
export const blockName = (id: string) => NAMES[id] ?? (id.startsWith('tracks') ? 'Tracklist' : id);

interface Item { id: BlockId; x: number; y: number; w: number; ink: Rect }

function offenders(items: Item[], hard: Rect[], soft: Rect[]) {
  return items.filter((b) => [...hard, ...soft].some((k) => hit(b.ink, k)));
}

/** True when any block on either side overlaps a keep-out or focal area. */
export function hasKeepOutOverlap(d: Design, t: LibraryTemplate, measure: Measurer): boolean {
  if (!t.frame) return false;
  return (['A', 'B'] as const).some((side) => {
    const ko = [...keepOuts(t), ...focalZones(d, side, t.frame!)];
    return renderLabel(d, t, side, measure).blocks.some((b) => ko.some((k) => hit(b.ink, k)));
  });
}

export function autoFixOverlaps(d0: Design, t: LibraryTemplate, measure: Measurer): AutoFixResult {
  const none: AutoFixResult = { design: d0, moved: [], remaining: [], switchedToManual: false };
  if (!t.frame || !hasKeepOutOverlap(d0, t, measure)) return none;

  let d = d0;
  let switched = false;
  if (d.style.layoutMode !== 'manual') {
    const seeded = seedManual(d, t, measure);
    d = { ...d, manual: seeded.manual, trackGroups: seeded.trackGroups, style: { ...d.style, ...seeded.stylePatch, layoutMode: 'manual' } };
    switched = true;
  }
  const S = safeRect(t);
  const hardKO = keepOuts(t);
  const moved: AutoFixResult['moved'] = [];
  const remaining: AutoFixResult['remaining'] = [];

  for (const side of ['A', 'B'] as const) {
    const soft = focalZones(d, side, t.frame);
    const items: Item[] = renderLabel(d, t, side, measure).blocks.map((b) => ({ id: b.id as BlockId, x: b.x, y: b.y, w: b.w, ink: b.ink }));
    const man = { ...d.manual[side] };
    // the biggest offenders first: they are the hardest to place
    const todo = offenders(items, hardKO, soft).sort((a, b) => b.ink.w * b.ink.h - a.ink.w * a.ink.h);
    for (const b of todo) {
      if (d.locked[side][b.id]) { remaining.push({ side, id: b.id, reason: 'it is locked' }); continue; }
      const ox = b.ink.x - b.x, oy = b.ink.y - b.y;
      const others = items.filter((o) => o !== b).map((o) => inflate(o.ink, GAP));
      const x0 = S.x - ox, x1 = S.x + S.w - ox - b.ink.w, y0 = S.y - oy, y1 = S.y + S.h - oy - b.ink.h;
      const search = (avoidSoft: boolean) => {
        let best: { x: number; y: number; cost: number } | null = null;
        for (let y = y0; y <= y1 + 1e-6; y += STEP) for (let x = x0; x <= x1 + 1e-6; x += STEP) {
          const r = { x: x + ox, y: y + oy, w: b.ink.w, h: b.ink.h };
          if (hardKO.some((k) => hit(r, k)) || (avoidSoft && soft.some((k) => hit(r, k))) || others.some((o) => hit(r, o))) continue;
          const cost = (x - b.x) ** 2 + (y - b.y) ** 2;
          if (!best || cost < best.cost) best = { x, y, cost };
        }
        return best;
      };
      const spot = search(true) ?? search(false);
      if (!spot) { remaining.push({ side, id: b.id, reason: 'there is no free space large enough inside the safety guides at this text size' }); continue; }
      man[b.id] = { x: +spot.x.toFixed(2), y: +spot.y.toFixed(2), w: +b.w.toFixed(2) };
      b.ink = { ...b.ink, x: spot.x + ox, y: spot.y + oy }; b.x = spot.x; b.y = spot.y;
      moved.push({ side, id: b.id });
    }
    d = { ...d, manual: { ...d.manual, [side]: man } };
  }
  // a block that was moved clear of the cutout may still sit on the focal area: say so
  for (const side of ['A', 'B'] as const) {
    const ko = [...hardKO, ...focalZones(d, side, t.frame)];
    for (const b of renderLabel(d, t, side, measure).blocks) {
      if (ko.some((k) => hit(b.ink, k)) && !remaining.some((r) => r.side === side && r.id === b.id)) remaining.push({ side, id: b.id, reason: 'it still touches the artwork focal area' });
    }
  }
  return { design: d, moved, remaining, switchedToManual: switched };
}
