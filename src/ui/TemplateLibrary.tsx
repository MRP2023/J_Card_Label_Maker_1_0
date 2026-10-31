import { BEHAVIOR_LABEL, GUIDE_COLORS, TEMPLATES, isUsable, type LibraryTemplate } from '../core/templates';
import glossPreview from '../templates/cl4rc-gloss-preview.png';

/** Draws the ORIGINAL source paths (cut, bleed, safety, inner shapes), unmodified, at true proportions. */
export function TemplatePreview({ t, width = 260 }: { t: LibraryTemplate; width?: number }) {
  if (!isUsable(t)) {
    return <img src={glossPreview} alt={`${t.name} raster preview`} style={{ width, maxWidth: '100%', border: '1px solid var(--line)' }} />;
  }
  const f = t.frame;
  const pad = 1;
  return (
    <svg viewBox={`${-pad} ${-pad} ${f.w + 2 * pad} ${f.h + 2 * pad}`} style={{ width, maxWidth: '100%' }} role="img" aria-label={`${t.name} outline`}>
      {t.bleed && <path d={t.bleed.d} fill="#fff" stroke={GUIDE_COLORS.bleed} strokeWidth={0.2} />}
      <path d={t.cut.d} fill="#f4efe4" stroke={GUIDE_COLORS.cut} strokeWidth={0.25} />
      {t.safety.map((s, i) => <path key={i} d={s.d} fill="none" stroke={GUIDE_COLORS.safety} strokeWidth={0.2} strokeDasharray={s.dashed ? '1.2 0.8' : undefined} />)}
      {t.inner.map((s) => (
        <path key={s.id} d={s.d} fill={s.behavior === 'cutout' ? '#b9b3a3' : 'none'} stroke={GUIDE_COLORS.cut} strokeWidth={0.25} strokeDasharray={s.behavior === 'cover-art' ? '1 0.6' : undefined} />
      ))}
    </svg>
  );
}

export function TemplateLibrary({ current, onSelect }: { current: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="library">
      <h2>Choose a cassette label template</h2>
      <p className="hint">
        Every outline below is the original vector path from your supplied template files, copied unmodified in millimetres.
        After you choose one, its geometry is locked: it cannot be resized, edited or replaced. Red = cut, black = bleed frame, blue = safety, as in the source files.
      </p>
      <div className="cards">
        {TEMPLATES.map((t) => {
          const ok = isUsable(t);
          return (
            <div key={t.id} className={'card' + (t.id === current ? ' current' : '')}>
              <TemplatePreview t={t} />
              <h3>{t.name}</h3>
              <span className={'badge ' + (t.verification === 'source-vector' ? 'ok' : 'warn')}>
                {t.verification === 'source-vector' ? 'Vector source' : 'UNVERIFIED (raster only)'}
              </span>
              {ok ? (
                <dl>
                  <dt>Cut path</dt><dd>{t.cut.bbox.w.toFixed(3)} × {t.cut.bbox.h.toFixed(3)} mm</dd>
                  <dt>Bleed frame</dt><dd>{t.bleed ? `${t.bleed.bbox.w.toFixed(3)} × ${t.bleed.bbox.h.toFixed(3)} mm` : 'not specified in the source'}</dd>
                  <dt>Inner shapes</dt>
                  <dd>{t.inner.length ? t.inner.map((i) => `${i.kind} ${i.bbox.w.toFixed(2)}×${i.bbox.h.toFixed(2)}`).join(', ') : 'none'}</dd>
                  <dt>Inner behaviour</dt><dd>{t.inner.length ? BEHAVIOR_LABEL[t.inner[0].behavior] : '–'}</dd>
                  <dt>Originals</dt><dd>{t.artboardMm ? `1-up ${t.artboardMm.w} × ${t.artboardMm.h} mm` : 'no 1-up'}{t.sheet ? ` · 12-up sheet ${t.sheet.paperMm.w} × ${t.sheet.paperMm.h}` : ' · no sheet'}</dd>
                </dl>
              ) : (
                <p className="hint">{t.verificationNote} Artboard {t.artboardMm?.w} × {t.artboardMm?.h} mm at {t.rasterDpi} dpi.</p>
              )}
              <button className="primary" disabled={!ok} onClick={() => onSelect(t.id)} title={ok ? '' : 'No vector outline in the source, so it cannot be used as a locked boundary.'}>
                {ok ? (t.id === current ? 'Keep this template' : 'Use this template') : 'Not usable (no vector outline)'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
