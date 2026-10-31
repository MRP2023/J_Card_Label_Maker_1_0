import { useMemo, useState } from 'react';
import { applyDirection, type ArtDirection } from '../core/direction';
import type { Measurer } from '../core/measure';
import type { Design, Side } from '../core/model';
import { renderLabel } from '../core/render';
import type { LibraryTemplate } from '../core/templates';

export interface VariationState {
  index: number;
  brief: { id: string; name: string };
  status: 'loading' | 'ok' | 'error';
  direction?: ArtDirection;
  error?: { code: string; message: string; retryable: boolean };
  similarTo?: number;
}

type T = LibraryTemplate & { frame: { w: number; h: number } };

function MiniLabel({ design, template, side, measure, fontVersion }: { design: Design; template: T; side: Side; measure: Measurer; fontVersion: number }) {
  const r = useMemo(() => renderLabel(design, template, side, measure), [design, template, side, measure, fontVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = template.frame;
  return (
    <div>
      <small>Side {side}</small>
      <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox={`-1 -1 ${f.w + 2} ${f.h + 2}`} className="mini" dangerouslySetInnerHTML={{ __html: r.svg }} />
      {r.warnings.some((w) => w.level === 'warning') && <small className="warn">⚠ {r.warnings.filter((w) => w.level === 'warning').length} layout warning(s)</small>}
    </div>
  );
}

/** Compares the three art directions side by side with live previews on the locked template. */
export function VariationsDialog({ design, template, measure, fontVersion, variations, selectedIndex, onSelect, onApply, onRegenerate, onRegenerateAll, onClose, artworkAssetId, hasManualWork }: {
  design: Design;
  template: T;
  measure: Measurer;
  fontVersion: number;
  variations: VariationState[];
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  onApply: (i: number, keepManual: boolean) => void;
  onRegenerate: (i: number) => void;
  onRegenerateAll: () => void;
  onClose: () => void;
  artworkAssetId: string | null;
  hasManualWork: boolean;
}) {
  const [keep, setKeep] = useState(hasManualWork);
  const busy = variations.some((v) => v.status === 'loading');
  return (
    <div className="modal">
      <div className="modal-card wide">
        <div className="row gap wrap">
          <h3 style={{ margin: 0 }}>Three automatic design suggestions</h3>
          <span className="spacer" />
          <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep my manual edits when I apply one</label>
          <button onClick={onRegenerateAll} disabled={busy}>Regenerate all three</button>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="hint">Generated on this computer by built-in design rules; each suggestion follows a different school of design (not just a different colour). Previews use your release text and tracklists on the locked template. Nothing changes in your design until you apply one, and you can undo it.</p>
        <div className="variations">
          {variations.map((v) => {
            const preview = v.direction ? applyDirection(design, v.direction, { artworkAssetId, keepManual: keep }) : null;
            return (
              <div key={v.index} className={'variation' + (selectedIndex === v.index ? ' on' : '')} onClick={() => v.status === 'ok' && onSelect(v.index)}>
                <h4>{v.brief.name}</h4>
                {v.status === 'loading' && <p className="hint">Art directing…</p>}
                {v.status === 'error' && (
                  <div className="issue warning">
                    <p>{v.error?.message}</p>
                    <button onClick={(e) => { e.stopPropagation(); onRegenerate(v.index); }} disabled={busy}>{v.error?.retryable ? 'Try again' : 'Retry'}</button>
                  </div>
                )}
                {v.status === 'ok' && v.direction && preview && (
                  <>
                    <b>{v.direction.concept.name}</b>
                    <p className="hint">{v.direction.concept.summary}</p>
                    <MiniLabel design={preview} template={template} side="A" measure={measure} fontVersion={fontVersion} />
                    <MiniLabel design={preview} template={template} side="B" measure={measure} fontVersion={fontVersion} />
                    <div className="swatches">{Object.values(v.direction.palette).map((c) => <span key={c} style={{ background: c }} title={c} />)}</div>
                    <p className="hint">{v.direction.typography.headingFont} + {v.direction.typography.bodyFont} · {v.direction.composition.ornament} · Side B {v.direction.composition.sideBVariant}</p>
                    {v.similarTo !== undefined && <p className="warn">Similar to variation {v.similarTo + 1}. Regenerate this one for more contrast.</p>}
                    {v.direction.risks.length > 0 && <ul className="issues">{v.direction.risks.slice(0, 3).map((r, i) => <li key={i} className="warning">{r}</li>)}</ul>}
                    <details><summary>Why this direction</summary><p className="hint">{v.direction.rationale}</p>{v.direction.hierarchy.length > 0 && <p className="hint">Hierarchy: {v.direction.hierarchy.join(' → ')}</p>}</details>
                    <div className="row gap wrap">
                      <button className="primary" onClick={(e) => { e.stopPropagation(); onApply(v.index, keep); }}>Use this suggestion</button>
                      <button onClick={(e) => { e.stopPropagation(); onRegenerate(v.index); }} disabled={busy}>Regenerate this one</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
