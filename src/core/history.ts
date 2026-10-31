/** Undo/redo history. Rapid edits with the same key (typing, dragging, sliders) coalesce into one undo step. */

export interface History<T> { past: T[]; present: T; future: T[]; lastKey: string | null; lastAt: number }

export const LIMIT = 100;
const WINDOW_MS = 800;

export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [], lastKey: null, lastAt: 0 });

/**
 * `sticky` keys (a drag or resize gesture) coalesce for as long as the key stays the same, however slowly the edits arrive.
 * Ordinary keys (typing, sliders) coalesce only within a short time window.
 */
export function commit<T>(h: History<T>, next: T, key: string | null = null, now = Date.now(), sticky = false): History<T> {
  if (Object.is(next, h.present)) return h;
  const coalesce = key !== null && key === h.lastKey && (sticky || now - h.lastAt < WINDOW_MS) && h.past.length > 0;
  const past = coalesce ? h.past : [...h.past, h.present].slice(-LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null, lastAt: 0 };
}

export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;
