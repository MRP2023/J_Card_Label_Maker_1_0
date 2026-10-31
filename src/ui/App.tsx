import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { estimateFocalRects } from '../core/art';
import { applyDirection, directionSummary, type ArtDirection } from '../core/direction';
import { injectFonts, usedFaceIds } from '../core/fontcss';
import { listFamilies, parseFontInfo, toFontPayload, slug, type UploadedFont } from '../core/fonts';
import { canRedo, canUndo, commit, createHistory, redo, undo } from '../core/history';
import { createCanvasMeasurer } from '../core/measure';
import { BLOCK_IDS, TRACK_BLOCKS, defaultDesign, parseTracks, type BlockId, type Design, type ExportMode, type LayoutMode, type Side, type SideContent, type Style, type Typography } from '../core/model';
import { composeExport } from '../core/page';
import { buildExpectation, buildProof } from '../core/proof';
import type { LogoTreatment } from '../core/logo';
import { applyPreset, CUSTOM_REFERENCE_ID } from '../core/presets';
import { autoFixOverlaps, blockName } from '../core/autofix';
import { reseedTracks, seedManual, tracksStale } from '../core/render';
import { styleFor } from '../core/style';
import { BEHAVIOR_LABEL, getTemplate, isUsable, safeRect, textRegions } from '../core/templates';
import { Field, Num, Section } from './controls';
import { ensureFonts, faceBytes } from './fontLoader';
import { LogoPanel, deriveLogo, useLogoReports } from './LogoPanel';
import { buildSuggestInput } from './features';
import { SCHOOLS, suggestSingle, suggestVariations } from '../core/suggest';
import { ProofScreen, type ExportCheckSummary } from './Proof';
import { VariationsDialog, type VariationState } from './VariationsDialog';
import { downscaleDataUrl, download, fileToAsset, paletteFromDataUrl } from './image';
import { ArtDirectionPanel, ElementPanel, SideLookPanel, TypographyPanel, type Scope } from './Panels';
import { LabelPreview } from './Preview';
import { TemplateLibrary, TemplatePreview } from './TemplateLibrary';

const STORE_KEY = 'cassette-label-studio/v3';

function load(): Design {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Design;
      const side = (k: Side): SideContent => ({ ...defaultDesign.sides[k], ...s.sides?.[k], typo: s.sides?.[k]?.typo ?? {} });
      return {
        ...defaultDesign, ...s,
        style: { ...defaultDesign.style, ...s.style, ornament: { ...defaultDesign.style.ornament, ...s.style?.ornament } },
        exportOpts: { ...defaultDesign.exportOpts, ...s.exportOpts },
        sides: { A: side('A'), B: side('B') },
        fonts: s.fonts ?? [],
        manual: { A: s.manual?.A ?? {}, B: s.manual?.B ?? {} },
        trackGroups: { A: s.trackGroups?.A ?? [], B: s.trackGroups?.B ?? [] },
        locked: { A: s.locked?.A ?? {}, B: s.locked?.B ?? {} },
      };
    }
  } catch { /* corrupt or unavailable storage */ }
  return defaultDesign;
}

const bytesToB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };

export default function App() {
  const [hist, setHist] = useState(() => createHistory(load()));
  const design = hist.present;
  const [zoom, setZoom] = useState(3);
  const [guides, setGuides] = useState({ cut: true, bleed: true, safety: true, regions: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [direction, setDirection] = useState<ArtDirection | null>(null);
  const [scope, setScope] = useState<Scope>('both');
  const [lookSide, setLookSide] = useState<Side>('A');
  const [sel, setSel] = useState<{ side: Side; id: string } | null>(null);
  const [fontVersion, setFontVersion] = useState(0);
  const [fontError, setFontError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [variations, setVariations] = useState<VariationState[] | null>(null);
  const [varSel, setVarSel] = useState<number | null>(null);
  const [showProof, setShowProof] = useState(false);
  const [lastExport, setLastExport] = useState<ExportCheckSummary | null>(null);
  const variationsRef = useRef<VariationState[] | null>(null);
  variationsRef.current = variations;
  const rounds = useRef<number[]>([0, 0, 0]); // which alternative each school currently shows (hooks stay above the early return)
  const logoReports = useLogoReports(design); // hooks must run before the early return below
  const measure = useMemo(() => createCanvasMeasurer(), [fontVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- state helpers (every edit goes through history) -----
  const update = useCallback((fn: (d: Design) => Design, key: string | null = null, sticky = false) => setHist((h) => commit(h, fn(h.present), key, Date.now(), sticky)), []);
  const gesture = useRef(0); // incremented on every pointer-down so each drag or resize is its own undo step
  const setDesign = (patch: Partial<Design>) => update((d) => ({ ...d, ...patch }), 'design:' + Object.keys(patch).join());
  const setStyle = (patch: Partial<Style>) => update((d) => ({ ...d, style: { ...d.style, ...patch } }), 'style:' + Object.keys(patch).join());
  const setExport = (patch: Partial<Design['exportOpts']>) => update((d) => ({ ...d, exportOpts: { ...d.exportOpts, ...patch } }), 'export:' + Object.keys(patch).join());
  const setSide = (side: Side, patch: Partial<SideContent>) => update((d) => {
    const next = { ...d, sides: { ...d.sides, [side]: { ...d.sides[side], ...patch } } };
    // Manual mode remembers how each tracklist was split around the window/hubs: when the tracks change, re-split that side from the automatic plan.
    if (patch.tracksText === undefined || d.style.layoutMode !== 'manual' || !usable) return next;
    return reseedTracks(next, usable, side, measure);
  }, `side${side}:` + Object.keys(patch).join());
  const doUndo = useCallback(() => setHist(undo), []);
  const doRedo = useCallback(() => setHist(redo), []);

  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(design)); } catch { /* storage full or blocked */ } }, [design]);
  useEffect(() => { ensureFonts(design).then((changed) => { if (changed) setFontVersion((v) => v + 1); }); }, [design.fonts, design.style.font, design.style.headingFont, design.style.bodyFont, design.sides.A.typo, design.sides.B.typo]); // eslint-disable-line react-hooks/exhaustive-deps

  const template = getTemplate(design.templateId);
  const usable = template && isUsable(template) ? template : null;
  const s = design.style;
  const families = useMemo(() => listFamilies(design.fonts), [design.fonts]);
  const flash = (kind: 'ok' | 'err', text: string) => setMessage({ kind, text });
  const autoFix = () => {
    if (!usable) return;
    const r = autoFixOverlaps(design, usable, measure);
    if (!r.moved.length && !r.remaining.length) { flash('ok', 'Nothing to fix: no text touches a window, hub or artwork focal area.'); return; }
    if (r.moved.length) update(() => r.design, null);
    const list = (xs: { side: Side; id: string }[]) => xs.map((m) => `${blockName(m.id)} (Side ${m.side})`).join(', ');
    flash(r.remaining.length ? 'err' : 'ok',
      (r.moved.length ? `Moved ${list(r.moved)} clear of the window/hub area${r.switchedToManual ? '; the layout is now manual (undo restores the automatic one)' : ''}. ` : '')
      + (r.remaining.length ? `Could not fix ${r.remaining.map((m) => `${blockName(m.id)} (Side ${m.side}: ${m.reason})`).join('; ')}. Shorten the text, lower the text size or move it by hand.` : ''));
  };
  const composed = useMemo(() => (usable ? composeExport(design, usable, measure, 'svg') : null), [design, usable, measure, fontVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlapWarn = !!composed?.warnings.some((w) => /overlaps the artwork\/cut region/.test(w.message));

  // ----- manual editing -----
  const startManual = useCallback(() => {
    if (!usable) return;
    update((d) => { const seeded = seedManual(d, usable, measure); return { ...d, manual: seeded.manual, trackGroups: seeded.trackGroups, style: { ...d.style, ...seeded.stylePatch, layoutMode: 'manual' } }; }, null);
  }, [usable, measure, update]);
  // a design saved before the tracks changed can carry a stale split: repair it once, so the tracklist can be selected and moved like any other box
  useEffect(() => {
    if (!usable) return;
    for (const sd of ['A', 'B'] as const) if (tracksStale(design, sd)) { update((d) => (tracksStale(d, sd) ? reseedTracks(d, usable, sd, measure) : d), null); break; }
  }, [design, usable, measure, update]);
  const setLayout = (m: LayoutMode) => (m === 'manual' ? startManual() : setStyle({ layoutMode: m }));
  const nudge = useCallback((side: Side, id: BlockId, dx: number, dy: number) => update((d) => {
    const p = d.manual[side][id];
    if (!p || d.locked[side][id]) return d;
    return { ...d, manual: { ...d.manual, [side]: { ...d.manual[side], [id]: { ...p, x: +(p.x + dx).toFixed(2), y: +(p.y + dy).toFixed(2) } } } };
  }, `nudge:${side}:${id}`), [update]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
      if (sel && s.layoutMode === 'manual' && BLOCK_IDS.includes(sel.id as BlockId) && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1;
        nudge(sel.side, sel.id as BlockId, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo, sel, s.layoutMode, nudge]);

  if (!usable || changing) {
    return (
      <div className="app">
        <header><h1>Cassette Label Studio</h1><span className="spacer" />{usable && <button onClick={() => setChanging(false)}>Back to design</button>}</header>
        <div className="library-wrap">
          <TemplateLibrary current={usable?.id ?? null} onSelect={(id) => {
            if (usable && id !== usable.id && !confirm('Switching template re-flows your design onto a different outline and clears manual positions. Continue?')) return;
            update((d) => ({ ...d, templateId: id, ...(id === d.templateId ? {} : { manual: { A: {}, B: {} }, trackGroups: { A: [], B: [] }, exportOpts: { ...d.exportOpts, mode: 'desktop' as ExportMode } }) }));
            setChanging(false);
          }} />
        </div>
      </div>
    );
  }

  // ----- uploads -----
  const upload = async (files: FileList | null, kind: 'logo' | 'wordmark' | 'art' | 'reference') => {
    if (!files) return;
    try {
      const assets = await Promise.all([...files].map((f) => fileToAsset(f, kind)));
      update((d) => ({
        ...d, assets: [...d.assets, ...assets],
        style: { ...d.style, ...(kind === 'logo' && !d.style.logoAssetId ? { logoAssetId: assets[0].id } : {}), ...(kind === 'wordmark' && !d.style.wordmarkAssetId ? { wordmarkAssetId: assets[0].id } : {}) },
      }));
    } catch (e) { flash('err', (e as Error).message); }
  };
  const removeAsset = (id: string) => update((d) => ({
    ...d, assets: d.assets.filter((a) => a.id !== id),
    style: { ...d.style, logoAssetId: d.style.logoAssetId === id ? null : d.style.logoAssetId, wordmarkAssetId: d.style.wordmarkAssetId === id ? null : d.style.wordmarkAssetId },
    sides: {
      A: { ...d.sides.A, backgroundAssetId: d.sides.A.backgroundAssetId === id ? null : d.sides.A.backgroundAssetId, bgFocal: d.sides.A.backgroundAssetId === id ? null : d.sides.A.bgFocal },
      B: { ...d.sides.B, backgroundAssetId: d.sides.B.backgroundAssetId === id ? null : d.sides.B.backgroundAssetId, bgFocal: d.sides.B.backgroundAssetId === id ? null : d.sides.B.bgFocal },
    },
  }));

  // ----- fonts -----
  const uploadFonts = async (files: FileList | null) => {
    if (!files) return;
    setFontError(null);
    for (const f of [...files]) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const info = parseFontInfo(bytes);
        const weight: UploadedFont['weight'] = info.weightClass >= 600 || /bold/i.test(info.subfamily) ? 'bold' : 'regular';
        const font: UploadedFont = { id: 'f' + Math.random().toString(36).slice(2, 9), family: info.family, weight, format: info.format, dataBase64: bytesToB64(bytes), fsType: info.fsType, embeddable: info.embeddable, embedNote: info.embedNote };
        update((d) => ({ ...d, fonts: [...d.fonts.filter((x) => !(slug(x.family) === slug(font.family) && x.weight === font.weight)), font] }));
        if (!info.embeddable) flash('err', `"${info.family}": ${info.embedNote}`);
      } catch (e) { setFontError(`${f.name}: ${(e as Error).message}`); }
    }
  };
  const removeFont = (id: string) => update((d) => {
    const gone = d.fonts.find((x) => x.id === id);
    const fonts = d.fonts.filter((x) => x.id !== id);
    if (!gone) return d;
    const ref = `custom:${slug(gone.family)}`;
    const stillThere = fonts.some((x) => slug(x.family) === slug(gone.family));
    const fix = (v: string | null) => (v === ref && !stillThere ? 'sans' : v);
    const typo = (t: Partial<Typography>) => ({ ...t, ...(t.font ? { font: fix(t.font) as string } : {}), ...(t.headingFont ? { headingFont: fix(t.headingFont) } : {}), ...(t.bodyFont ? { bodyFont: fix(t.bodyFont) } : {}) });
    return { ...d, fonts, style: { ...d.style, font: fix(d.style.font) as string, headingFont: fix(d.style.headingFont), bodyFont: fix(d.style.bodyFont) }, sides: { A: { ...d.sides.A, typo: typo(d.sides.A.typo) }, B: { ...d.sides.B, typo: typo(d.sides.B.typo) } } };
  });
  const onTypo = (patch: Partial<Typography>) => {
    if (scope === 'both') setStyle(patch);
    else update((d) => ({ ...d, sides: { ...d.sides, [scope]: { ...d.sides[scope], typo: { ...d.sides[scope].typo, ...patch } } } }), `typo${scope}:` + Object.keys(patch).join());
  };

  // ----- automatic design suggestions (rule-based, computed locally) -----
  const failAi = (e: unknown) => { const m = e as Error; setAiError({ message: m.message, retryable: true }); flash('err', m.message); };
  const artworkId = design.assets.find((a) => a.kind === 'art')?.id ?? null;
  const hasManualWork = s.layoutMode === 'manual' || Object.keys(design.manual.A).length + Object.keys(design.manual.B).length > 0;
  const availableRefs = () => families.map((f) => f.ref);

  const runSuggestOne = async () => {
    setBusy('direct'); setAiError(null);
    try {
      const input = await buildSuggestInput(design, s.logoAssetId, availableRefs());
      const sg = suggestSingle(input);
      setDirection(sg.direction);
      flash('ok', `Automatic suggestion ready: "${sg.direction.concept.name}" (${sg.school.name}). Review it below and apply it (undoable). Template geometry is untouched.`);
    } catch (e) { failAi(e); } finally { setBusy(null); }
  };

  const BRIEF_NAMES = SCHOOLS.map((x) => x.name);
  /** Three suggestions, or only some of them (regenerate): each regenerated one rotates to a different alternative that stays clearly different from the kept ones. */
  const runVariations = async (only?: number[]) => {
    const idx = only ?? [0, 1, 2];
    setAiError(null);
    setBusy('direct');
    setVariations((cur) => BRIEF_NAMES.map((name, i): VariationState => (idx.includes(i) || !cur?.[i] ? { index: i, brief: { id: String(i), name }, status: 'loading' } : cur[i])));
    try {
      const input = await buildSuggestInput(design, s.logoAssetId, availableRefs());
      if (only) for (const i of only) rounds.current[i] = (rounds.current[i] ?? 0) + 1; else rounds.current = [0, 0, 0];
      const keep = (variationsRef.current ?? []).filter((v) => !idx.includes(v.index) && v.direction).map((v) => v.direction!);
      const out = suggestVariations(input, rounds.current, only, keep);
      for (const o of out) rounds.current[o.index] = o.round;
      setVariations((cur) => BRIEF_NAMES.map((name, i) => { const o = out.find((x) => x.index === i); return o ? { index: i, brief: { id: o.school.id, name: o.school.name }, status: 'ok', direction: o.direction } : cur?.[i] ?? { index: i, brief: { id: String(i), name }, status: 'error', error: { code: 'unknown', message: 'Not generated.', retryable: true } }; }));
      if (!only) setVarSel(null);
      for (const o of out) ensureFonts(applyDirection(design, o.direction, { artworkAssetId: artworkId })).then((c) => c && setFontVersion((n) => n + 1));
    } catch (e) {
      failAi(e);
      setVariations((cur) => (cur ?? []).map((v) => (idx.includes(v.index) ? { ...v, status: 'error', error: { code: 'unknown', message: (e as Error).message, retryable: true } } : v)));
    } finally { setBusy(null); }
  };

  const applyDir = (keepManual: boolean, dir: ArtDirection | null = direction) => {
    if (!dir) return;
    update((d) => applyDirection(d, dir, { artworkAssetId: d.assets.find((a) => a.kind === 'art')?.id ?? null, keepManual }));
    flash('ok', 'Suggestion applied' + (keepManual ? ', keeping your manual edits' : '') + '. Undo with Ctrl+Z if you prefer the previous look.');
  };
  const applyVariation = (i: number, keep: boolean) => {
    const v = variations?.find((x) => x.index === i);
    if (!v?.direction) return;
    setDirection(v.direction);
    applyDir(keep, v.direction);
    setVariations(null);
  };

  // ----- logo checks and non-destructive treatments -----
  const treatLogo = async (side: Side, assetId: string, t: LogoTreatment) => {
    const src = design.assets.find((a) => a.id === assetId);
    if (!src) return;
    setBusy('logo');
    try {
      const derived = await deriveLogo(src, t);
      update((d) => ({ ...d, assets: [...d.assets, derived], sides: { ...d.sides, [side]: { ...d.sides[side], logoAssetId: derived.id } } }));
      flash('ok', `Created "${derived.name}" for Side ${side}. The original upload "${src.name}" is untouched and can be selected again.`);
    } catch (e) { flash('err', `Could not treat the logo: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  const detectFocal = async (side: Side) => {
    const a = design.assets.find((x) => x.id === design.sides[side].backgroundAssetId);
    if (!a) return;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = a.dataUrl; });
    const k = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, c.width, c.height);
    const rects = estimateFocalRects(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if (!rects.length) { flash('err', 'No clear subject was found in this artwork (it looks flat). Add a focal area by hand if there is one.'); return; }
    setSide(side, { bgFocal: rects[0], bgFocalMore: rects.slice(1, 3) });
    flash('ok', `Found ${rects.length} focal area(s) in the artwork. Text now avoids them where there is room; adjust the rectangles if needed.`);
  };
  const paletteOffline = async () => {
    const a = design.assets.find((x) => x.kind === 'art') ?? design.assets.find((x) => x.kind === 'reference');
    if (!a) return;
    const p = await paletteFromDataUrl(a.dataUrl);
    update((d) => ({ ...d, presetId: CUSTOM_REFERENCE_ID, style: { ...d.style, backgroundColor: p.background, textColor: p.text, accentColor: p.accent, secondaryColor: p.secondary } }));
    flash('ok', 'Palette taken from your artwork. Typography is unchanged; pick a preset or use the automatic suggestions for a full direction.');
  };

  // ----- export -----
  const baseName = `${design.release.artist}-${design.release.title}`.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'cassette-labels';
  const guard = (): boolean => {
    if (!composed || !composed.fits) { flash('err', composed?.warnings.filter((w) => w.level === 'error').map((w) => w.message).join(' ') || 'Nothing to export.'); return false; }
    return true; // layout warnings are shown on the proof screen before export
  };
  const exportSvg = async () => {
    if (!guard()) return;
    const out = composeExport(design, usable, measure, 'svg');
    const pages = out.pages.filter((p) => p.kind === 'artwork');
    for (const [i, p] of pages.entries()) {
      const bytes = new Map<string, NonNullable<Awaited<ReturnType<typeof faceBytes>>>>();
      for (const id of usedFaceIds(p.svg)) { const b = await faceBytes(id, design); if (b) bytes.set(id, b); }
      const svg = injectFonts(p.svg, (id) => bytes.get(id) ?? null);
      const name = `${baseName}-${p.label.replace(/[^\w]+/g, '_').replace(/_+$/, '')}.svg`;
      setTimeout(() => download(new Blob([svg], { type: 'image/svg+xml' }), name), i * 250);
    }
  };
  const exportPdf = async () => {
    if (!guard()) return;
    setBusy('pdf');
    try {
      const out = composeExport(design, usable, measure, 'pdf');
      const expectation = buildExpectation(design, usable, measure, out);
      const res = await fetch('/api/export-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: out.pages.map((p) => ({ svg: p.svg, wMm: p.wMm, hMm: p.hMm })), title: `${design.release.artist} – ${design.release.title}`, fonts: toFontPayload(design.fonts), expectation }),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const refused = (res.headers.get('X-Fonts-Refused') ?? '').split(',').filter(Boolean);
      const embedded = (res.headers.get('X-Fonts-Embedded') ?? '').split(',').filter(Boolean);
      let v: ExportCheckSummary | null = null;
      try { const h = res.headers.get('X-Export-Validation'); if (h) v = JSON.parse(atob(h)); } catch { /* validation header unreadable */ }
      setLastExport(v);
      download(await res.blob(), `${baseName}-${design.exportOpts.mode}.pdf`);
      const verified = v ? (v.ok ? ` Verified: ${v.passed}/${v.total} automatic checks passed on the file.` : ` VERIFICATION FAILED: ${v.summary}`) : '';
      flash(refused.length || (v && !v.ok) ? 'err' : 'ok', `PDF exported: ${out.pages.length} page(s) at exact physical size${embedded.length ? `, ${embedded.length} font(s) embedded` : ''}.${verified}${refused.length ? ` Not embedded (licence/format): ${refused.join(', ')}; Helvetica was used instead.` : ''} Print at 100% / Actual size.`);
    } catch (e) { flash('err', (e as Error).message); } finally { setBusy(null); }
  };

  const eo = design.exportOpts;
  const hasSheet = !!usable.sheet;
  const widthOf = (side: Side, id: BlockId) => design.manual[side][id]?.w ?? null;
  const setManualPos = (side: Side, id: string, patch: Partial<{ x: number; y: number; w: number }>, key: string, sticky = false) =>
    update((d) => {
      const cur = d.manual[side][id as BlockId];
      if (!cur) return d;
      return { ...d, manual: { ...d.manual, [side]: { ...d.manual[side], [id]: { ...cur, ...patch } } } };
    }, key, sticky);

  return (
    <div className="app">
      <header>
        <h1>Cassette Label Studio</h1>
        <span className="badge ok">🔒 {usable.name}</span>
        <button onClick={() => setChanging(true)}>Change template</button>
        <span className="spacer" />
        <button onClick={doUndo} disabled={!canUndo(hist)} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button onClick={doRedo} disabled={!canRedo(hist)} title="Redo (Ctrl+Y)">↷ Redo</button>
        <button className="primary" onClick={() => setShowProof(true)} disabled={!composed?.fits}>Print proof &amp; export…</button>
      </header>

      <div className="body">
        <aside>
          <Section title="1. Release" open>
            <Field label="Album title"><input value={design.release.title} onChange={(e) => setDesign({ release: { ...design.release, title: e.target.value } })} /></Field>
            <Field label="Artist"><input value={design.release.artist} onChange={(e) => setDesign({ release: { ...design.release, artist: e.target.value } })} /></Field>
            <div className="two">
              <Field label="Catalog no."><input value={design.release.catalogNumber} onChange={(e) => setDesign({ release: { ...design.release, catalogNumber: e.target.value } })} /></Field>
              <Field label="Year (optional)"><input value={design.release.year} onChange={(e) => setDesign({ release: { ...design.release, year: e.target.value } })} /></Field>
            </div>
          </Section>

          <Section title="2. Logo, typography image & references" open>
            <Field label="Artist logo"><input type="file" accept="image/*" onChange={(e) => { upload(e.target.files, 'logo'); e.target.value = ''; }} /></Field>
            <Field label="Typography reference / font logo (image of the lettering)"><input type="file" accept="image/*" onChange={(e) => { upload(e.target.files, 'wordmark'); e.target.value = ''; }} /></Field>
            <Field label="Album artwork"><input type="file" accept="image/*" multiple onChange={(e) => { upload(e.target.files, 'art'); e.target.value = ''; }} /></Field>
            <Field label="Art-style reference"><input type="file" accept="image/*" multiple onChange={(e) => { upload(e.target.files, 'reference'); e.target.value = ''; }} /></Field>
            {design.assets.length > 0 && (
              <ul className="assets">
                {design.assets.map((a) => (
                  <li key={a.id}><img src={a.dataUrl} alt="" /><div><b>{a.name}</b><small>{a.kind} · {a.width}×{a.height}px</small></div><button onClick={() => removeAsset(a.id)} title="Remove">✕</button></li>
                ))}
              </ul>
            )}
            <div className="two">
              <Field label="Logo image"><select value={s.logoAssetId ?? ''} onChange={(e) => setStyle({ logoAssetId: e.target.value || null })}><option value="">None</option>{design.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
              <Field label="Typography image"><select value={s.wordmarkAssetId ?? ''} onChange={(e) => setStyle({ wordmarkAssetId: e.target.value || null })}><option value="">None (text wordmark)</option>{design.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            </div>
            <Field label="Font-based wordmark text (used when no typography image)"><input value={s.wordmarkText} onChange={(e) => setStyle({ wordmarkText: e.target.value })} placeholder="e.g. EXAMPLE ARTIST" /></Field>
            <div className="three">
              <Field label="Logo height (mm)"><Num value={s.logoHeightMm} min={1} max={40} onChange={(v) => setStyle({ logoHeightMm: v })} /></Field>
              <Field label="Typography height (mm)"><Num value={s.wordmarkHeightMm} min={1} max={40} onChange={(v) => setStyle({ wordmarkHeightMm: v })} /></Field>
              <Field label="Wordmark size (pt)"><Num value={s.wordmarkSizePt} min={4} max={48} step={0.5} onChange={(v) => setStyle({ wordmarkSizePt: v })} /></Field>
            </div>
          </Section>

          <Section title="Logo checks (per side)" open>
            <LogoPanel design={design} reports={logoReports} direction={direction} busy={busy === 'logo'} onTreat={treatLogo}
              onUseAsset={(sd, id) => setSide(sd, { logoAssetId: id })} />
          </Section>

          <Section title="3. Tracklists" open>
            {(['A', 'B'] as const).map((side) => (
              <div key={side} className="side-box">
                <Field label={`Side ${side} heading`}><input value={design.sides[side].heading} onChange={(e) => setSide(side, { heading: e.target.value })} /></Field>
                <Field label={`Side ${side} tracks (one per line, optional "| m:ss")`}><textarea rows={6} value={design.sides[side].tracksText} onChange={(e) => setSide(side, { tracksText: e.target.value })} /></Field>
              </div>
            ))}
          </Section>

          <Section title="4. Art direction & presets" open>
            <ArtDirectionPanel design={design} busy={busy === 'direct'} direction={direction} error={aiError}
              onPreset={(id) => update((d) => applyPreset(d, id))} onSuggestOne={runSuggestOne} onVariations={() => { setVarSel(null); void runVariations(); }} onPalette={paletteOffline} onApplyDirection={(k) => applyDir(k)} />
          </Section>

          <Section title="5. Typography" open>
            <TypographyPanel design={design} scope={scope} setScope={setScope} families={families} onTypo={onTypo}
              onClearOverrides={(sd) => setSide(sd, { typo: {} })} onUploadFont={uploadFonts} onRemoveFont={removeFont} fontError={fontError} />
          </Section>

          <Section title="6. Artwork, colour & both sides" open>
            <SideLookPanel design={design} side={lookSide} setSide={setLookSide} onSide={setSide} onStyle={setStyle} onDetectFocal={detectFocal} />
          </Section>

          <Section title="7. Layout & manual editing" open>
            <Field label="Layout mode">
              <select value={s.layoutMode} onChange={(e) => setLayout(e.target.value as LayoutMode)}>
                <option value="auto">1. Automatic (planned composition)</option>
                <option value="separated">2. Side A / Side B separated (big side letter)</option>
                <option value="minimal">3. Minimal (logo and release info only)</option>
                <option value="manual">4. Custom manual positioning</option>
              </select>
            </Field>
            {s.layoutMode === 'manual' && <button onClick={startManual}>Reset all positions from the automatic composition</button>}
            <label className="check"><input type="checkbox" checked={s.showDurations} onChange={(e) => setStyle({ showDurations: e.target.checked })} /> Show durations</label>
            <label className="check"><input type="checkbox" checked={s.showTrackNumbers} onChange={(e) => setStyle({ showTrackNumbers: e.target.checked })} /> Show track numbers</label>
            <label className="check"><input type="checkbox" checked={s.shrinkToFit} onChange={(e) => setStyle({ shrinkToFit: e.target.checked })} /> Shrink to fit (header first, tracks never below the legibility limit)</label>
            <Field label="Legibility limit (pt): text is never shrunk below this"><Num value={s.minLegiblePt} min={4} max={10} step={0.5} onChange={(v) => setStyle({ minLegiblePt: v })} /></Field>
            <h4>Selected element</h4>
            <ElementPanel design={design} sel={sel} widthOf={widthOf} onEnterManual={startManual}
              onLock={(sd, id, v) => update((d) => ({ ...d, locked: { ...d.locked, [sd]: { ...d.locked[sd], [id]: v } } }))}
              onWidth={(sd, id, w) => setManualPos(sd, id, { w }, `resize:${sd}:${id}`)}
              onReset={(sd, id) => update((d) => { const m = { ...d.manual[sd] }; delete m[id]; return { ...d, manual: { ...d.manual, [sd]: m } }; })} />
          </Section>

          <Section title="8. Template (locked source geometry)">
            <div className="locked">
              <TemplatePreview t={usable} width={240} />
              <dl>
                <dt>Cut path</dt><dd>{usable.cut.bbox.w.toFixed(3)} × {usable.cut.bbox.h.toFixed(3)} mm</dd>
                <dt>Bleed frame</dt><dd>{usable.bleed ? `${usable.bleed.bbox.w.toFixed(3)} × ${usable.bleed.bbox.h.toFixed(3)} mm (from source)` : 'not specified in the source'}</dd>
                <dt>Safe area</dt><dd>{(() => { const r = safeRect(usable); return `${r.w.toFixed(2)} × ${r.h.toFixed(2)} mm`; })()}</dd>
                <dt>Source</dt><dd>{usable.sourceFiles.join('; ')}</dd>
              </dl>
            </div>
            {usable.inner.length > 0 && (
              <div className="behavior"><b>Inner shape cutting behaviour (from the source, read-only)</b>
                {usable.inner.map((i) => <p key={i.id}><u>{i.kind} {i.bbox.w.toFixed(2)} × {i.bbox.h.toFixed(2)} mm</u>: {BEHAVIOR_LABEL[i.behavior]}.<br /><span className="hint">{i.wording}</span></p>)}
              </div>
            )}
            <p className="hint">{usable.verificationNote} Geometry cannot be edited or scaled.</p>
          </Section>

          <Section title="9. Export" open>
            <Field label="Export mode">
              <select value={eo.mode} onChange={(e) => setExport({ mode: e.target.value as ExportMode })}>
                <option value="desktop">Desktop printer: both labels 1:1 on A4/Letter + calibration</option>
                <option value="single">Individual labels: one page per side at the original 1-up size</option>
                <option value="sheet" disabled={!hasSheet}>{hasSheet ? 'Original 12-up Letter sheet' : 'Original 12-up sheet (not available for this template)'}</option>
              </select>
            </Field>
            {eo.mode === 'desktop' && <Field label="Paper"><select value={eo.paper} onChange={(e) => setExport({ paper: e.target.value as Design['exportOpts']['paper'] })}><option value="A4">A4 (210×297)</option><option value="Letter">US Letter (215.9×279.4)</option></select></Field>}
            {eo.mode === 'sheet' && <Field label="12-up fill"><select value={eo.sheetFill} onChange={(e) => setExport({ sheetFill: e.target.value as Design['exportOpts']['sheetFill'] })}><option value="pairs">A | B pairs per row (6 + 6)</option><option value="A">Side A in all 12 slots</option><option value="B">Side B in all 12 slots</option></select></Field>}
            {eo.mode !== 'desktop' && (
              <>
                <Field label="Calibration page paper"><select value={eo.paper} onChange={(e) => setExport({ paper: e.target.value as Design['exportOpts']['paper'] })}><option value="A4">A4</option><option value="Letter">US Letter</option></select></Field>
                <label className="check"><input type="checkbox" checked={eo.calibrationPage} onChange={(e) => setExport({ calibrationPage: e.target.checked })} /> Append calibration page (10 mm square + 100 mm ruler)</label>
              </>
            )}
            <label className="check"><input type="checkbox" checked={eo.showCut} onChange={(e) => setExport({ showCut: e.target.checked })} /> Cut lines (source red path, incl. inner cuts)</label>
            <label className="check"><input type="checkbox" checked={eo.showBleedGuide} onChange={(e) => setExport({ showBleedGuide: e.target.checked })} /> Bleed frame guide (source black frame)</label>
            <label className="check"><input type="checkbox" checked={eo.showSafetyGuide} onChange={(e) => setExport({ showSafetyGuide: e.target.checked })} /> Safety guides (source blue lines)</label>
            <p className="hint">Exports are always 1:1 and never scaled. Print at <b>100% / Actual size</b> and check the 10 mm square with a ruler.</p>
          </Section>
        </aside>

        <main>
          {message && <div className={'toast ' + message.kind} onClick={() => setMessage(null)}>{message.text}</div>}
          <div className="toolbar">
            <label>Zoom <input type="range" min={2} max={9} step={0.5} value={zoom} onChange={(e) => setZoom(+e.target.value)} /> {zoom.toFixed(1)}×</label>
            {(['cut', 'bleed', 'safety', 'regions'] as const).map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={guides[k]} onChange={(e) => setGuides({ ...guides, [k]: e.target.checked })} /> {k === 'regions' ? 'text regions' : k}</label>
            ))}
          </div>
          <div className="legend">
            <span><i style={{ borderTop: '2px solid #ed1c24' }} /> Cut path</span>
            <span><i style={{ borderTop: '2px solid currentColor' }} /> Bleed frame</span>
            <span><i style={{ borderTop: '2px dashed #00aeef' }} /> Safety</span>
            <span><i style={{ borderTop: '2px dashed #ff9900' }} /> Keep-out</span>
            <span><i style={{ borderTop: '2px dashed #b05bff' }} /> Artwork focal area</span>
            <span className="hint">Click an element to select it; dragging switches to manual layout. Guides are not exported unless enabled.</span>
          </div>

          {composed && composed.warnings.length > 0 && (
            <>
              <ul className="issues panel">{composed.warnings.map((w, i) => <li key={i} className={w.level}>{w.side !== 'page' ? `Side ${w.side}: ` : ''}{w.message}</li>)}</ul>
              {overlapWarn && <div className="row gap"><button className="primary" onClick={autoFix}>Auto-fix overlaps</button><small className="hint">Moves only the text that touches a window, hub or artwork focal area to the nearest free spot. Undoable.</small></div>}
            </>
          )}

          {(['A', 'B'] as const).map((side) => (
            <LabelPreview key={side} side={side} design={design} template={usable} measure={measure} fontVersion={fontVersion} zoom={zoom} guides={guides}
              selected={sel?.side === side ? sel.id : null}
              onSelect={(id) => { gesture.current++; setSel(id ? { side, id } : null); }}
              onEnterManual={startManual}
              onDrag={(id, x, y, w) => update((d) => ({ ...d, manual: { ...d.manual, [side]: { ...d.manual[side], [id]: { x, y, w } } } }), `drag:${side}:${id}:${gesture.current}`, true)}
              onResize={(id, w) => setManualPos(side, id, { w }, `resize:${side}:${id}:${gesture.current}`, true)} />
          ))}

          {composed && composed.pages.length > 0 && (
            <div className="page-preview">
              <h3>Export preview</h3>
              <div className="sheets">
                {composed.pages.map((p, i) => (
                  <div key={i} className="sheet-item">
                    <small>{p.label}: {p.wMm} × {p.hMm} mm (shown reduced; exported 1:1)</small>
                    <div className="sheet" style={{ width: Math.min(520, p.wMm * 2.4) }} dangerouslySetInnerHTML={{ __html: p.svg.replace(/width="[^"]*mm" height="[^"]*mm"/, 'style="width:100%;height:auto"') }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
      {variations && (
        <VariationsDialog design={design} template={usable} measure={measure} fontVersion={fontVersion} variations={variations} selectedIndex={varSel}
          onSelect={setVarSel} onApply={applyVariation} onRegenerate={(i) => void runVariations([i])} onRegenerateAll={() => void runVariations()}
          onClose={() => setVariations(null)} artworkAssetId={artworkId} hasManualWork={hasManualWork} />
      )}
      {showProof && (
        <ProofScreen proof={buildProof(design, usable, measure)} busy={busy === 'pdf'} lastExport={lastExport} onExportPdf={exportPdf} onExportSvg={exportSvg} onAutoFix={autoFix} onClose={() => setShowProof(false)} />
      )}
    </div>
  );
}

