import { Fragment, useState } from 'react';
import type { ProofReport } from '../core/proof';

export interface ExportCheckSummary { ok: boolean; summary: string; passed: number; total: number; failed: { id: string; label: string; detail: string }[] }

const ICON = { ok: '✔', warn: '⚠', error: '✖' } as const;

/** Pre-export print proof: previews with the source guides, true dimensions, fonts, checks and print instructions. */
export function ProofScreen({ proof, busy, lastExport, onExportPdf, onExportSvg, onAutoFix, onClose }: {
  proof: ProofReport;
  busy: boolean;
  lastExport: ExportCheckSummary | null;
  onExportPdf: () => void;
  onExportSvg: () => void;
  onAutoFix?: () => void;
  onClose: () => void;
}) {
  const [ack, setAck] = useState(false);
  const f = proof.dims.frame;
  const pad = 2;
  const errors = proof.checks.filter((c) => c.level === 'error');
  return (
    <div className="modal">
      <div className="modal-card wide proof">
        <div className="row gap wrap">
          <h3 style={{ margin: 0 }}>Print proof</h3>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>

        <div className="banner fit">
          <b>Do not use "Fit to page".</b> {proof.fitToPageWarning}
        </div>

        {errors.length > 0 && <div className="banner err"><b>Fix before exporting:</b><ul>{errors.map((c, i) => <li key={i}>{c.text}</li>)}</ul></div>}

        <div className="proof-sides">
          {proof.sides.map((s) => (
            <div key={s.side}>
              <h4>Side {s.side} <small>{s.tracksPlaced} of {s.tracksExpected} tracks placed</small></h4>
              <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox={`${-pad} ${-pad} ${f.w + 2 * pad} ${f.h + 2 * pad}`} className="proofsvg" dangerouslySetInnerHTML={{ __html: s.svg }} />
              {s.warnings.some((w) => w.level === 'warning') && <p className="warn">⚠ {s.warnings.filter((w) => w.level === 'warning').length} layout warning(s): see Checks below.</p>}
            </div>
          ))}
        </div>
        <div className="legend">
          <span><i style={{ borderTop: '2px solid #ed1c24' }} /> Cut line</span>
          <span><i style={{ borderTop: '2px solid currentColor' }} /> Bleed line</span>
          <span><i style={{ borderTop: '2px dashed #00aeef' }} /> Safety line</span>
        </div>

        <div className="proof-grid">
          <div>
            <h4>Actual physical dimensions</h4>
            <dl>
              <dt>Cut line</dt><dd>{proof.dims.cut.w.toFixed(3)} × {proof.dims.cut.h.toFixed(3)} mm</dd>
              <dt>Bleed frame</dt><dd>{f.w.toFixed(3)} × {f.h.toFixed(3)} mm{proof.dims.bleedMm ? ` (${proof.dims.bleedMm.left.toFixed(2)} / ${proof.dims.bleedMm.top.toFixed(2)} / ${proof.dims.bleedMm.right.toFixed(2)} / ${proof.dims.bleedMm.bottom.toFixed(2)} mm beyond the cut)` : ' (none in the source)'}</dd>
              <dt>Safety area</dt><dd>{proof.dims.safe.w.toFixed(3)} × {proof.dims.safe.h.toFixed(3)} mm</dd>
              {proof.dims.pages.map((p, i) => <Fragment key={i}><dt>Page {i + 1}</dt><dd>{p.wMm} × {p.hMm} mm · {p.label}{p.kind === 'calibration' ? ' (calibration)' : ''}</dd></Fragment>)}
            </dl>
            <p className="hint">All sizes come from the original template files and are exported 1:1.</p>
          </div>
          <div>
            <h4>Font embedding</h4>
            <ul className="fonts">{proof.fonts.map((x) => <li key={x.faceId} className={x.status}><b>{x.name}</b>: {x.status === 'embedded' ? 'embedded' : x.status === 'standard' ? 'standard PDF font' : 'NOT embedded (fallback)'}<br /><small>{x.detail}</small></li>)}</ul>
          </div>
        </div>

        <h4>Checks</h4>
        <ul className="checks">{proof.checks.map((c, i) => <li key={i} className={c.level}>{ICON[c.level]} {c.text}</li>)}</ul>
        {onAutoFix && proof.checks.some((c) => /overlaps the artwork\/cut region/.test(c.text)) && (
          <div className="row gap"><button className="primary" onClick={onAutoFix}>Auto-fix overlaps</button><small className="hint">Moves only the text that touches a window, hub or artwork focal area to the nearest free spot. Undoable.</small></div>
        )}

        <h4>How to print</h4>
        <ol className="hint">{proof.instructions.map((t, i) => <li key={i}>{t}</li>)}</ol>

        {lastExport && (
          <div className={'banner ' + (lastExport.ok ? 'ok' : 'err')}>
            <b>Last exported PDF was verified:</b> {lastExport.summary} ({lastExport.passed}/{lastExport.total} checks)
            {lastExport.failed.length > 0 && <ul>{lastExport.failed.map((x, i) => <li key={i}>{x.label}: {x.detail}</li>)}</ul>}
          </div>
        )}

        <label className="check ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I will print at 100% / Actual size (Fit to page OFF) and measure the 10 mm calibration square before cutting.</label>
        <div className="row gap wrap">
          <button className="primary" onClick={onExportPdf} disabled={!ack || !proof.canExport || busy}>{busy ? 'Building PDF…' : 'Export PDF'}</button>
          <button onClick={onExportSvg} disabled={!proof.canExport}>Export SVG</button>
          {!proof.canExport && <small className="warn">Export is blocked until the errors above are fixed.</small>}
        </div>
        <p className="hint">Physical fit on the cassette is <b>not verified</b> until a printed label has been tried on the real shell. See docs/PRINT_TESTING.md.</p>
      </div>
    </div>
  );
}
