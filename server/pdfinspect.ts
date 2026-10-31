/**
 * Minimal PDF content inspection, enough to verify what PDFKit wrote: page boxes, painted path boxes (through the
 * full transform chain and form XObjects), text-show operators and fonts. Handles Flate-compressed streams.
 */
import { inflateSync } from 'node:zlib';

export interface Box { w: number; h: number; x: number; y: number }
type M = [number, number, number, number, number, number];

// PDF row-vector convention: a new `cm` matrix is applied first, then the current CTM.
const mul = (m: M, c: M): M => [
  m[0] * c[0] + m[1] * c[2], m[0] * c[1] + m[1] * c[3],
  m[2] * c[0] + m[3] * c[2], m[2] * c[1] + m[3] * c[3],
  m[4] * c[0] + m[5] * c[2] + c[4], m[4] * c[1] + m[5] * c[3] + c[5],
];

/** Inflate every FlateDecode stream so the text-based reader can walk it. Image streams are left alone. */
export function inflatePdf(buf: Buffer): Buffer {
  const s = buf.toString('latin1');
  const out = s.replace(/(<<(?:(?!endobj)[\s\S])*?>>\s*stream\r?\n)([\s\S]*?)(\r?\nendstream)/g, (all, head: string, body: string, tail: string) => {
    if (!/FlateDecode/.test(head) || /\/Subtype\s*\/Image/.test(head)) return all;
    try { return head.replace(/\/Filter\s*\/FlateDecode/, '') + inflateSync(Buffer.from(body, 'latin1')).toString('latin1') + tail; } catch { return all; }
  });
  return Buffer.from(out, 'latin1');
}

interface Parsed { text: string; objects: Map<number, { dict: string; stream: string }>; named: Map<string, number>; kids: number[] }

function parse(pdf: Buffer): Parsed {
  const text = inflatePdf(pdf).toString('latin1');
  const objects = new Map<number, { dict: string; stream: string }>();
  for (const m of text.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) {
    const s = m[2].match(/^([\s\S]*?)stream\r?\n([\s\S]*?)endstream/);
    objects.set(Number(m[1]), { dict: s ? s[1] : m[2], stream: s ? s[2] : '' });
  }
  const named = new Map<string, number>();
  for (const m of text.matchAll(/\/([A-Za-z]+\d+) (\d+) 0 R/g)) named.set(m[1], Number(m[2]));
  const kids = (text.match(/\/Kids \[([^\]]*)\]/)?.[1].match(/(\d+) 0 R/g) ?? []).map((r) => parseInt(r, 10));
  return { text, objects, named, kids };
}

const NUM = /^-?\d*\.?\d+(e-?\d+)?$/i;

/** Walks a page's content (and the form XObjects it draws) and calls `visit` for every operator. */
function walkPage(p: Parsed, pageIndex: number, visit: (op: string, nums: number[], ctm: M, path: [number, number][]) => [number, number][] | void) {
  const contents = p.objects.get(p.kids[pageIndex])?.dict.match(/\/Contents (\d+) 0 R/);
  if (!contents) throw new Error(`page ${pageIndex + 1} not found`);
  const run = (stream: string, start: M) => {
    const tokens = stream.split(/\s+/).filter(Boolean);
    const stack: M[] = [];
    let ctm = start;
    let path: [number, number][] = [];
    const nums: number[] = [];
    let prev = '';
    const pt = (x: number, y: number): [number, number] => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    for (const tk of tokens) {
      if (NUM.test(tk)) { nums.push(parseFloat(tk)); prev = tk; continue; }
      switch (tk) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() ?? ctm; break;
        case 'cm': ctm = mul(nums.slice(-6) as M, ctm); break;
        case 'm': case 'l': path.push(pt(nums[nums.length - 2], nums[nums.length - 1])); break;
        case 'c': for (let i = 0; i < 3; i++) path.push(pt(nums[nums.length - 6 + 2 * i], nums[nums.length - 5 + 2 * i])); break;
        case 're': { const [x, y, w, h] = nums.slice(-4); path.push(pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)); break; }
        case 'Do': {
          const obj = p.objects.get(p.named.get(prev.replace(/^\//, '')) ?? -1);
          if (obj?.stream) run(obj.stream, ctm);
          break;
        }
        default: break;
      }
      const r = visit(tk, nums, ctm, path);
      if (Array.isArray(r)) path = r;
      nums.length = 0;
      prev = tk;
    }
  };
  run(p.objects.get(Number(contents[1]))!.stream, [1, 0, 0, 1, 0, 0]);
}

/** Bounding boxes (PDF points, origin bottom-left) of every painted path on a page. */
export function paintedBoxes(pdf: Buffer, pageIndex = 0): Box[] {
  const p = parse(pdf);
  const boxes: Box[] = [];
  walkPage(p, pageIndex, (op, _n, _c, path) => {
    if (['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(op)) {
      if (path.length) {
        const xs = path.map((q) => q[0]), ys = path.map((q) => q[1]);
        boxes.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
      }
      return [];
    }
    if (op === 'n') return [];
    return undefined;
  });
  return boxes;
}

/** Number of text-show operators (Tj / TJ) on a page. PDFKit shows text glyph by glyph for SVG text, so this tracks the glyph count. */
export function textShowCount(pdf: Buffer, pageIndex = 0): number {
  const p = parse(pdf);
  let n = 0;
  walkPage(p, pageIndex, (op) => { if (op === 'Tj' || op === 'TJ') n++; });
  return n;
}

export interface PdfFontInfo { baseFonts: string[]; embeddedSubsets: string[]; fontFileCount: number }

/** Fonts named in the document and how many have an embedded font program. */
export function pdfFonts(pdf: Buffer): PdfFontInfo {
  const text = pdf.toString('latin1');
  const baseFonts = [...new Set([...text.matchAll(/\/BaseFont \/([A-Za-z0-9+_-]+)/g)].map((m) => m[1]))];
  return { baseFonts, embeddedSubsets: baseFonts.filter((f) => /^[A-Z]{6}\+/.test(f)), fontFileCount: (text.match(/\/FontFile[23]?\b/g) ?? []).length };
}
