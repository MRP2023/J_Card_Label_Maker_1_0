/** Test helper: bounding box of an absolute SVG path made of M L C H V Z commands (béziers are sampled). */
export function pathBounds(d: string) {
  const t = d.match(/[MLCHVZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let i = 0, cmd = '', x = 0, y = 0;
  const xs: number[] = [], ys: number[] = [];
  const add = (a: number, b: number) => { xs.push(a); ys.push(b); };
  const num = () => parseFloat(t[i++]);
  while (i < t.length) {
    if (/^[A-Z]$/i.test(t[i])) cmd = t[i++];
    if (cmd === 'M' || cmd === 'L') { x = num(); y = num(); add(x, y); }
    else if (cmd === 'H') { x = num(); add(x, y); }
    else if (cmd === 'V') { y = num(); add(x, y); }
    else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
      for (let k = 1; k <= 40; k++) {
        const u = k / 40, v = 1 - u;
        add(v ** 3 * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u ** 3 * x3, v ** 3 * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u ** 3 * y3);
      }
      x = x3; y = y3;
    } else if (cmd === 'Z') { /* closes to start; no new extent */ }
    else throw new Error('unsupported path command ' + cmd);
  }
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}
