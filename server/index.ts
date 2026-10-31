import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { svgPagesToPdfDetailed } from './pdf';
import { validateExportPdf } from './validate';

/**
 * Local server: PDF export (with font embedding) and verification of the exported PDF.
 * It makes no network calls and needs no API key or account; everything runs on this computer.
 */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '60mb' }));

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  app.post('/api/validate-pdf', async (req, res) => {
    const { pdfBase64, expectation } = req.body ?? {};
    if (typeof pdfBase64 !== 'string' || !expectation?.pages) { res.status(400).json({ error: 'Expected { pdfBase64, expectation }.' }); return; }
    try { res.json(await validateExportPdf(Buffer.from(pdfBase64, 'base64'), expectation)); }
    catch (e) { res.status(500).json({ error: 'Validation failed: ' + (e as Error).message }); }
  });

  app.post('/api/export-pdf', async (req, res) => {
    const { pages, title, fonts, expectation } = req.body ?? {};
    const ok = Array.isArray(pages) && pages.length > 0 && pages.length <= 8 &&
      pages.every((p: any) => typeof p?.svg === 'string' && p.svg.startsWith('<svg') && p.wMm > 10 && p.wMm < 1000 && p.hMm > 10 && p.hMm < 1000) &&
      (fonts === undefined || (Array.isArray(fonts) && fonts.length <= 12 && fonts.every((f: any) => typeof f?.faceId === 'string' && typeof f?.dataBase64 === 'string')));
    if (!ok) {
      res.status(400).json({ error: 'Expected { pages: [{ svg, wMm, hMm }], fonts?: [{ faceId, dataBase64 }] }.' });
      return;
    }
    try {
      const out = await svgPagesToPdfDetailed(pages, { title, fonts });
      res.set('X-Fonts-Embedded', out.embedded.join(',')).set('X-Fonts-Refused', out.refused.join(',')).set('Access-Control-Expose-Headers', 'X-Fonts-Embedded, X-Fonts-Refused, X-Export-Validation');
      // verify the real file right away; the summary travels with the PDF so the UI can show it
      if (expectation?.pages) {
        try {
          const v = await validateExportPdf(out.pdf, expectation);
          const summary = { ok: v.ok, summary: v.summary, passed: v.checks.filter((c) => c.ok).length, total: v.checks.length, failed: v.checks.filter((c) => !c.ok).map((c) => ({ id: c.id, label: c.label, detail: c.detail })).slice(0, 12) };
          res.set('X-Export-Validation', Buffer.from(JSON.stringify(summary)).toString('base64'));
        } catch (e) { console.error('[validate]', (e as Error).message); }
      }
      res.type('application/pdf').send(out.pdf);
    } catch (e) {
      console.error('[pdf]', (e as Error).message);
      res.status(500).json({ error: 'PDF generation failed: ' + (e as Error).message });
    }
  });

  // Serve the built front-end if present (npm run build && npm start).
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Malformed or oversized request bodies get a clean JSON error instead of an HTML stack trace.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err?.status === 413 ? 413 : err?.type === 'entity.parse.failed' ? 400 : err?.status ?? 500;
    res.status(status).json({ error: status === 413 ? 'The request is too large (images or fonts are too big).' : status === 400 ? 'The request was not valid JSON.' : 'Unexpected server error.' });
  });
  return app;
}

// Start listening only when run directly (npm run dev / npm start), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT) || 8787;
  createApp().listen(port, () => console.log(`Cassette Label Studio on http://localhost:${port} (local, no external services)`));
}
