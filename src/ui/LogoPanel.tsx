import { useEffect, useMemo, useState } from 'react';
import type { ArtDirection } from '../core/direction';
import { logoIssues, analyzeLogoPixels, recolorPixels, removeBackgroundPixels, type LogoIssue, type LogoTreatment } from '../core/logo';
import type { Asset, Design, Side } from '../core/model';
import { styleFor } from '../core/style';

export interface SideLogoReport { side: Side; assetId: string; background: string; printWidthMm: number; issues: LogoIssue[] }

const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });

/** Analyses the logo each side actually uses against that side's background colour. The uploaded file is only read. */
export function useLogoReports(design: Design): SideLogoReport[] {
  const [reports, setReports] = useState<SideLogoReport[]>([]);
  const key = JSON.stringify([
    (['A', 'B'] as const).map((sd) => { const s = styleFor(design, sd); return [s.logoAssetId, s.backgroundColor, s.logoHeightMm]; }),
    design.assets.filter((a) => a.kind === 'logo').map((a) => a.id),
  ]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: SideLogoReport[] = [];
      const cache = new Map<string, ReturnType<typeof analyzeLogoPixels>>();
      for (const side of ['A', 'B'] as const) {
        const s = styleFor(design, side);
        const a = design.assets.find((x) => x.id === s.logoAssetId);
        if (!a) continue;
        try {
          if (!cache.has(a.id)) {
            const img = await load(a.dataUrl);
            const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
            const ctx = c.getContext('2d')!;
            ctx.drawImage(img, 0, 0, c.width, c.height);
            const st = analyzeLogoPixels(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
            cache.set(a.id, { ...st, width: a.width, height: a.height }); // resolution is judged on the real pixel size
          }
          const printWidthMm = s.logoHeightMm * (a.width / a.height);
          out.push({ side, assetId: a.id, background: s.backgroundColor, printWidthMm, issues: logoIssues(cache.get(a.id)!, { background: s.backgroundColor, printWidthMm, side }) });
        } catch { /* unreadable image: nothing to report */ }
      }
      if (alive) setReports(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return reports;
}

/** Creates a NEW asset from a treated copy of `src`. The original asset and file are never modified. */
export async function deriveLogo(src: Asset, treatment: LogoTreatment): Promise<Asset> {
  const img = await load(src.dataUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  let px: Uint8ClampedArray;
  let suffix: string;
  if (treatment === 'remove-background') { px = removeBackgroundPixels(data.data, c.width, c.height).data; suffix = 'no background'; }
  else { px = recolorPixels(data.data, treatment === 'recolor-light' ? '#f4f4f0' : '#111111'); suffix = treatment === 'recolor-light' ? 'light' : 'dark'; }
  ctx.putImageData(new ImageData(px as unknown as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
  return { id: 'a' + Math.random().toString(36).slice(2, 9), kind: 'logo', name: src.name.replace(/\.[^.]+$/, '') + ` (${suffix}).png`, dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height, derivedFrom: src.id, treatment };
}

const LABEL: Record<LogoTreatment, string> = { 'recolor-light': 'Make a light copy', 'recolor-dark': 'Make a dark copy', 'remove-background': 'Remove the background' };

export function LogoPanel({ design, reports, direction, busy, onTreat, onUseAsset }: {
  design: Design;
  reports: SideLogoReport[];
  direction: ArtDirection | null;
  busy: boolean;
  onTreat: (side: Side, assetId: string, t: LogoTreatment) => void;
  onUseAsset: (side: Side, assetId: string | null) => void;
}) {
  const logos = useMemo(() => design.assets.filter((a) => a.kind === 'logo'), [design.assets]);
  if (!logos.length && !design.style.logoAssetId) return <p className="hint">Upload an artist logo to get contrast, resolution and transparency checks for each side.</p>;
  const sug = direction && direction.logo.treatment !== 'keep' ? direction.logo : null;
  return (
    <>
      <p className="hint">Each side's logo is checked against that side's background. Treatments create a <b>separate copy</b>; your uploaded file is never changed.</p>
      {sug && <p className="rec">Automatic suggestion: <b>{sug.treatment}</b>. {sug.reason}</p>}
      {reports.length === 0 && <p className="hint">No logo selected.</p>}
      {reports.map((r) => (
        <div key={r.side} className="side-box">
          <b>Side {r.side}</b> <small>on {r.background}, printed {r.printWidthMm.toFixed(1)} mm wide</small>
          {r.issues.length === 0 && <p className="ok">The logo looks fine on this side.</p>}
          {r.issues.map((i, k) => (
            <div key={k} className={'issue ' + i.severity}>
              <p>{i.message}</p>
              <div className="row gap wrap">{i.suggestions.map((t) => <button key={t} disabled={busy} onClick={() => onTreat(r.side, r.assetId, t)}>{LABEL[t]}</button>)}</div>
            </div>
          ))}
          <label className="field"><span>Logo used on Side {r.side}</span>
            <select value={design.sides[r.side].logoAssetId ?? ''} onChange={(e) => onUseAsset(r.side, e.target.value || null)}>
              <option value="">Shared logo</option>
              {design.assets.filter((a) => a.kind === 'logo').map((a) => <option key={a.id} value={a.id}>{a.name}{a.derivedFrom ? ' (derived copy)' : ' (original)'}</option>)}
            </select>
          </label>
        </div>
      ))}
    </>
  );
}
