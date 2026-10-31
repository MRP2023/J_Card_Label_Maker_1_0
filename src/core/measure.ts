import { PT_TO_MM } from './model';
import { FONT_FAMILY, type Face } from './fonts';

export { FONT_FAMILY };

/** Returns the rendered width in millimetres of `text` set in `face` at `sizePt` with `trackingEm` letter-spacing. */
export type Measurer = (text: string, face: Face, sizePt: number, trackingEm?: number) => number;

/** Average advance (em) used only when no real measurer is available. Deliberately a little wide. */
const AVG_EM = 0.54;

export const estimateMeasurer: Measurer = (text, face, sizePt, trackingEm = 0) =>
  text.length * (AVG_EM * (face.svgBold ? 1.06 : 1) + trackingEm) * sizePt * PT_TO_MM;

/** Browser measurer using canvas. Studio/custom faces must be loaded (see ui/fontLoader) for exact widths. */
export function createCanvasMeasurer(): Measurer {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return estimateMeasurer;
  const REF = 100; // measure at a large size to avoid hinting rounding
  return (text, face, sizePt, trackingEm = 0) => {
    ctx.font = `${face.svgBold ? 'bold ' : ''}${REF}px ${face.css}`;
    return ((ctx.measureText(text).width / REF) + trackingEm * text.length) * sizePt * PT_TO_MM;
  };
}
