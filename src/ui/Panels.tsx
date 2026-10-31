import { useState } from 'react';
import type { ArtDirection } from '../core/direction';
import type { FamilyInfo } from '../core/fonts';
import { BLOCK_IDS, type Align, type BlockId, type Design, type OrnamentKind, type Side, type SideBVariant, type SideContent, type Style, type TextCase, type Typography } from '../core/model';
import { CUSTOM_REFERENCE_ID, PRESETS } from '../core/presets';
import { styleFor } from '../core/style';
import { Field, Num, Slider } from './controls';

// ---------------------------------------------------------------- art direction

export function ArtDirectionPanel({ design, busy, direction, error, onPreset, onSuggestOne, onVariations, onPalette, onApplyDirection }: {
  design: Design;
  busy: boolean;
  direction: ArtDirection | null;
  error: { message: string; retryable: boolean } | null;
  onPreset: (id: string) => void;
  onSuggestOne: () => void;
  onVariations: () => void;
  onPalette: () => void;
  onApplyDirection: (keepManual: boolean) => void;
}) {
  const hasManual = design.style.layoutMode === 'manual' || Object.keys(design.manual.A).length + Object.keys(design.manual.B).length > 0 || Object.values(design.locked.A).some(Boolean);
  const [keepManual, setKeepManual] = useState(true);
  const have = (k: string) => design.assets.filter((a) => a.kind === k).length;
  return (
    <>
      <p className="hint">Pick a starting direction. Everything it sets (palette, fonts, ornament, Side B treatment) stays editable and undoable; your text, artwork and the template are never touched.</p>
      <div className="presets">
        {PRESETS.map((p) => (
          <button key={p.id} className={'preset' + (design.presetId === p.id ? ' on' : '')} onClick={() => onPreset(p.id)} title={p.tagline}>
            <span className="sw">{[p.patch.backgroundColor, p.patch.textColor, p.patch.accentColor, p.patch.secondaryColor].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
            <b>{p.name}</b>
            <small>{p.tagline}</small>
          </button>
        ))}
      </div>
      <div className={'preset custom' + (design.presetId === CUSTOM_REFERENCE_ID ? ' on' : '')}>
        <b>Automatic design suggestions</b>
        <small>Generated on this computer by built-in design rules (no internet, no account). The app measures your artwork and references (colour, brightness, warmth, contrast, how busy it is, where the subject is), your logo and the tracklist length, then applies the rules of three schools of design.</small>
        <small>It does not understand what an image shows or read lettering from a typography reference; it measures pixels. Treat suggestions as starting points.</small>
        <small>References available: {have('logo')} logo · {have('wordmark')} typography · {have('art')} artwork · {have('reference')} style reference</small>
        <div className="row gap wrap">
          <button className="primary" onClick={onVariations} disabled={busy}>{busy ? 'Working…' : 'Suggest 3 variations'}</button>
          <button onClick={onSuggestOne} disabled={busy}>Suggest one from my references</button>
          <button onClick={onPalette} disabled={!design.assets.some((a) => a.kind === 'art' || a.kind === 'reference')}>Palette from my artwork only</button>
        </div>
        {error && <div className="issue warning"><p><b>Suggestion failed.</b> {error.message}</p><small>Nothing in your design was changed.</small></div>}
      </div>
      {direction && (
        <div className="rec">
          <small className="hint">Automatic suggestion (rule-based)</small>
          <b>{direction.concept.name}</b>
          <p>{direction.concept.summary}</p>
          <div className="swatches">{Object.values(direction.palette).map((c) => <span key={c} style={{ background: c }} title={c} />)}</div>
          <p>{direction.typography.headingFont} + {direction.typography.bodyFont} · {direction.composition.ornament} · Side B {direction.composition.sideBVariant}</p>
          {direction.hierarchy.length > 0 && <p>Hierarchy: {direction.hierarchy.join(' → ')}</p>}
          <p>{direction.rationale}</p>
          {direction.risks.length > 0 && <ul className="issues">{direction.risks.map((r, i) => <li key={i} className="warning">{r}</li>)}</ul>}
          {direction.logo.treatment !== 'keep' && <p className="hint">Logo: {direction.logo.treatment}. {direction.logo.reason}</p>}
          {hasManual && <label className="check"><input type="checkbox" checked={keepManual} onChange={(e) => setKeepManual(e.target.checked)} /> Keep my manual edits (positions, locks, per-side tweaks)</label>}
          <button className="primary" onClick={() => onApplyDirection(hasManual && keepManual)}>Apply this suggestion (undoable)</button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- typography

export type Scope = 'both' | Side;

export function TypographyPanel({ design, scope, setScope, families, onTypo, onClearOverrides, onUploadFont, onRemoveFont, fontError }: {
  design: Design;
  scope: Scope;
  setScope: (s: Scope) => void;
  families: FamilyInfo[];
  onTypo: (patch: Partial<Typography>) => void;
  onClearOverrides: (side: Side) => void;
  onUploadFont: (files: FileList | null) => void;
  onRemoveFont: (id: string) => void;
  fontError: string | null;
}) {
  const s: Style = scope === 'both' ? design.style : styleFor(design, scope);
  const heading = s.headingFont ?? s.font;
  const body = s.bodyFont ?? s.font;
  const fam = (ref: string) => families.find((f) => f.ref === ref);
  const overrides = (sd: Side) => Object.keys(design.sides[sd].typo).length;
  const FontSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {families.map((f) => <option key={f.ref} value={f.ref}>{f.name}</option>)}
    </select>
  );
  return (
    <>
      <div className="seg">
        {(['both', 'A', 'B'] as const).map((k) => (
          <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{k === 'both' ? 'Both sides' : `Side ${k}${overrides(k) ? ` (${overrides(k)} overrides)` : ''}`}</button>
        ))}
      </div>
      {scope !== 'both' && <p className="hint">Changes here apply to Side {scope} only. <button onClick={() => onClearOverrides(scope)} disabled={!overrides(scope)}>Reset to shared typography</button></p>}
      <div className="two">
        <Field label="Heading font (title, side heading)"><FontSelect value={heading} onChange={(v) => onTypo({ headingFont: v })} /></Field>
        <Field label="Body font (artist, tracks, catalogue)"><FontSelect value={body} onChange={(v) => onTypo({ bodyFont: v })} /></Field>
      </div>
      {[fam(heading), fam(body)].some((f) => f && f.source === 'custom' && !f.embeddable) && <p className="warn">An uploaded font forbids embedding. The preview uses it, but the PDF falls back to Helvetica.</p>}
      <div className="two">
        <label className="check"><input type="checkbox" checked={s.titleBold} disabled={!fam(heading)?.hasBold} onChange={(e) => onTypo({ titleBold: e.target.checked })} /> Heading bold {!fam(heading)?.hasBold && <small>(no bold face)</small>}</label>
        <label className="check"><input type="checkbox" checked={s.bodyBold} disabled={!fam(body)?.hasBold} onChange={(e) => onTypo({ bodyBold: e.target.checked })} /> Body bold {!fam(body)?.hasBold && <small>(no bold face)</small>}</label>
        <Field label="Heading case"><select value={s.titleCase} onChange={(e) => onTypo({ titleCase: e.target.value as TextCase })}><option value="none">As typed</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option></select></Field>
        <Field label="Track case"><select value={s.trackCase} onChange={(e) => onTypo({ trackCase: e.target.value as TextCase })}><option value="none">As typed</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option></select></Field>
        <Field label="Heading letter-spacing (em)"><Num value={s.titleTracking} min={-0.05} max={0.4} step={0.01} onChange={(v) => onTypo({ titleTracking: v })} /></Field>
        <Field label="Body letter-spacing (em)"><Num value={s.bodyTracking} min={-0.03} max={0.2} step={0.01} onChange={(v) => onTypo({ bodyTracking: v })} /></Field>
        <Field label="Title size (pt)"><Num value={s.titleSizePt} min={3} max={30} step={0.25} onChange={(v) => onTypo({ titleSizePt: v })} /></Field>
        <Field label="Track size (pt)"><Num value={s.trackSizePt} min={3} max={16} step={0.25} onChange={(v) => onTypo({ trackSizePt: v })} /></Field>
        <Field label="Meta size (pt)"><Num value={s.metaSizePt} min={3} max={14} step={0.25} onChange={(v) => onTypo({ metaSizePt: v })} /></Field>
        <Field label="Line height (×)"><Num value={s.lineHeight} min={0.9} max={2} step={0.05} onChange={(v) => onTypo({ lineHeight: v })} /></Field>
        <Field label="Track spacing (mm)"><Num value={s.trackSpacingMm} min={0} max={5} step={0.1} onChange={(v) => onTypo({ trackSpacingMm: v })} /></Field>
        <Field label="Alignment"><select value={s.textAlign} onChange={(e) => onTypo({ textAlign: e.target.value as Align })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></Field>
      </div>
      <h4>Upload a font</h4>
      <Field label="TTF or OTF (upload regular and bold faces separately with the same family name)"><input type="file" accept=".ttf,.otf,font/ttf,font/otf" multiple onChange={(e) => { onUploadFont(e.target.files); e.target.value = ''; }} /></Field>
      {fontError && <p className="warn">{fontError}</p>}
      {design.fonts.length > 0 && (
        <ul className="assets">
          {design.fonts.map((f) => (
            <li key={f.id}>
              <span className="fontchip" style={{ fontFamily: `'CLS-custom-${f.id}', sans-serif` }}>Aa</span>
              <div><b>{f.family}</b><small>{f.weight} · {f.format.toUpperCase()} · {f.embeddable ? 'embeds in PDF' : 'NOT embeddable'}</small><small className={f.embeddable ? '' : 'warn'}>{f.embedNote}</small></div>
              <button onClick={() => onRemoveFont(f.id)} title="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Studio fonts (OFL / Apache) and uploaded fonts that allow it are embedded in the PDF as subsets. Helvetica, Times and Courier are standard PDF fonts and are not embedded. Only upload fonts you are licensed to use.</p>
    </>
  );
}

// ---------------------------------------------------------------- artwork, sides, ornament

export function SideLookPanel({ design, side, setSide, onSide, onStyle, onDetectFocal }: {
  design: Design;
  side: Side;
  setSide: (s: Side) => void;
  onSide: (side: Side, patch: Partial<SideContent>) => void;
  onStyle: (patch: Partial<Style>) => void;
  onDetectFocal: (side: Side) => void;
}) {
  const sc = design.sides[side];
  const s = design.style;
  const asset = design.assets.find((a) => a.id === sc.backgroundAssetId);
  const focal = sc.bgFocal;
  const pct = (v: number) => Math.round(v * 100);
  const setFocal = (patch: Partial<NonNullable<SideContent['bgFocal']>>) => {
    const f = { ...(focal ?? { x: 0.35, y: 0.2, w: 0.3, h: 0.5 }), ...patch };
    f.x = Math.min(1 - 0.05, Math.max(0, f.x)); f.y = Math.min(1 - 0.05, Math.max(0, f.y));
    f.w = Math.min(1 - f.x, Math.max(0.05, f.w)); f.h = Math.min(1 - f.y, Math.max(0.05, f.h));
    onSide(side, { bgFocal: f });
  };
  return (
    <>
      <div className="seg">{(['A', 'B'] as const).map((k) => <button key={k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>Side {k}</button>)}</div>
      <Field label={`Side ${side} artwork`}>
        <select value={sc.backgroundAssetId ?? ''} onChange={(e) => onSide(side, { backgroundAssetId: e.target.value || null, bgFocal: null })}>
          <option value="">None</option>
          {design.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      {asset && (
        <>
          <Field label={`Opacity: ${pct(sc.bgOpacity ?? s.backgroundOpacity)}%`}><Slider min={0.05} max={1} value={sc.bgOpacity ?? s.backgroundOpacity} onChange={(v) => onSide(side, { bgOpacity: v })} /></Field>
          <Field label={`Crop zoom: ${sc.bgCrop.zoom.toFixed(2)}×`}><Slider min={1} max={4} step={0.05} value={sc.bgCrop.zoom} onChange={(v) => onSide(side, { bgCrop: { ...sc.bgCrop, zoom: v } })} /></Field>
          <div className="two">
            <Field label={`Crop centre x: ${pct(sc.bgCrop.cx)}%`}><Slider min={0} max={1} value={sc.bgCrop.cx} onChange={(v) => onSide(side, { bgCrop: { ...sc.bgCrop, cx: v } })} /></Field>
            <Field label={`Crop centre y: ${pct(sc.bgCrop.cy)}%`}><Slider min={0} max={1} value={sc.bgCrop.cy} onChange={(v) => onSide(side, { bgCrop: { ...sc.bgCrop, cy: v } })} /></Field>
          </div>
          <p className="hint">Focal area: the important part of the artwork (a face, a subject). Text is kept away from it and the editor shows it in purple.</p>
          {focal ? (
            <div className="four">
              {(['x', 'y', 'w', 'h'] as const).map((k) => <Field key={k} label={`${k} %`}><Num value={pct(focal[k])} min={0} max={100} step={1} onChange={(v) => setFocal({ [k]: v / 100 })} /></Field>)}
            </div>
          ) : null}
          <div className="row gap wrap"><button onClick={() => onDetectFocal(side)}>Detect focal area from the artwork</button><button onClick={() => setFocal({})}>{focal ? 'Reset focal area' : 'Add focal area'}</button>{(focal || sc.bgFocalMore.length > 0) && <button onClick={() => onSide(side, { bgFocal: null, bgFocalMore: [] })}>Remove all</button>}</div>
          {sc.bgFocalMore.length > 0 && <p className="hint">{sc.bgFocalMore.length} more focal area(s) are protected too.</p>}
          <Field label={`Text backing plate: ${pct(s.textScrim)}%`}><Slider min={0} max={0.8} value={s.textScrim} onChange={(v) => onStyle({ textScrim: v })} /></Field>
        </>
      )}
      <div className="two">
        <Field label={`Side ${side} album title (blank = shared)`}><input value={sc.title ?? ''} placeholder={design.release.title} onChange={(e) => onSide(side, { title: e.target.value })} /></Field>
        <Field label={`Side ${side} artist (blank = shared)`}><input value={sc.artist ?? ''} placeholder={design.release.artist} onChange={(e) => onSide(side, { artist: e.target.value })} /></Field>
      </div>
      <Field label={`Side ${side} background colour`}>
        <div className="row gap"><input type="color" value={sc.backgroundColor ?? styleFor(design, side).backgroundColor} onChange={(e) => onSide(side, { backgroundColor: e.target.value })} />
          <button onClick={() => onSide(side, { backgroundColor: null })} disabled={!sc.backgroundColor}>use shared</button></div>
      </Field>
      <h4>One release, two sides</h4>
      <div className="two">
        <Field label="Side B treatment"><select value={s.sideBVariant} onChange={(e) => onStyle({ sideBVariant: e.target.value as SideBVariant })}><option value="matched">Matched to side A</option><option value="inverted">Inverted colours</option><option value="tinted">Tinted with the accent</option></select></Field>
        <Field label="Header leads with"><select value={s.headerEmphasis} onChange={(e) => onStyle({ headerEmphasis: e.target.value as Style['headerEmphasis'] })}><option value="album">Album title</option><option value="artist">Artist name</option><option value="balanced">Balanced</option></select></Field>
        <Field label="Ornament"><select value={s.ornament.kind} onChange={(e) => onStyle({ ornament: { ...s.ornament, kind: e.target.value as OrnamentKind } })}>
          {(['none', 'frame', 'rules', 'stripes', 'grid', 'dots', 'scanlines'] as const).map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
        <Field label="Ornament colour"><select value={s.ornament.color} onChange={(e) => onStyle({ ornament: { ...s.ornament, color: e.target.value as Style['ornament']['color'] } })}><option value="accent">Accent</option><option value="text">Text</option><option value="secondary">Secondary</option></select></Field>
      </div>
      <Field label={`Ornament opacity: ${pct(s.ornament.opacity)}%`}><Slider min={0.1} max={1} value={s.ornament.opacity} onChange={(v) => onStyle({ ornament: { ...s.ornament, opacity: v } })} /></Field>
      <div className="four">
        <Field label="Background"><input type="color" value={s.backgroundColor} onChange={(e) => onStyle({ backgroundColor: e.target.value })} /></Field>
        <Field label="Text"><input type="color" value={s.textColor} onChange={(e) => onStyle({ textColor: e.target.value })} /></Field>
        <Field label="Accent"><input type="color" value={s.accentColor} onChange={(e) => onStyle({ accentColor: e.target.value })} /></Field>
        <Field label="Secondary"><input type="color" value={s.secondaryColor} onChange={(e) => onStyle({ secondaryColor: e.target.value })} /></Field>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- selected element

export function ElementPanel({ design, sel, widthOf, onLock, onWidth, onReset, onEnterManual }: {
  design: Design;
  sel: { side: Side; id: string } | null;
  widthOf: (side: Side, id: BlockId) => number | null;
  onLock: (side: Side, id: BlockId, locked: boolean) => void;
  onWidth: (side: Side, id: BlockId, w: number) => void;
  onReset: (side: Side, id: BlockId) => void;
  onEnterManual: () => void;
}) {
  if (!sel || !BLOCK_IDS.includes(sel.id as BlockId)) return <p className="hint">Click an element in a preview to select it. Dragging it switches to manual layout; every element stays inside the template's safe area.</p>;
  const id = sel.id as BlockId;
  const manual = design.style.layoutMode === 'manual';
  const w = widthOf(sel.side, id);
  const locked = !!design.locked[sel.side][id];
  return (
    <>
      <p><b>Side {sel.side} · {id}</b></p>
      {!manual && <p className="hint">Automatic layout is active. <button onClick={onEnterManual}>Switch to manual editing</button></p>}
      <label className="check"><input type="checkbox" checked={locked} onChange={(e) => onLock(sel.side, id, e.target.checked)} /> Lock this element (no dragging, resizing or nudging)</label>
      {manual && w !== null && (
        <Field label={`${id === 'logo' || id === 'wordmark' ? 'Image width' : 'Column width'}: ${w.toFixed(1)} mm`}>
          <Slider min={4} max={90} step={0.5} value={Math.min(90, w)} onChange={(v) => !locked && onWidth(sel.side, id, v)} />
        </Field>
      )}
      {manual && <div className="row gap"><button onClick={() => onReset(sel.side, id)} disabled={locked}>Back to automatic position</button></div>}
      {manual && <p className="hint">Arrow keys nudge by 0.1 mm (Shift: 1 mm). Ctrl+Z / Ctrl+Y undo and redo.</p>}
    </>
  );
}
