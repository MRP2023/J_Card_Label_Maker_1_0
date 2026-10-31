import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultDesign } from '../src/core/model';
import { composeExport } from '../src/core/page';
import { buildExpectation } from '../src/core/proof';
import { getTemplate } from '../src/core/templates';
import { createApp } from '../server/index';
import { createPdfkitMeasurer } from '../server/measure';

describe('local HTTP API (no external services, no API key)', () => {
  let base = '';
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  const post = (path: string, body: unknown, raw = false) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });

  it('reports health and nothing about any AI service', async () => {
    const j = await (await fetch(base + '/api/health')).json();
    expect(j).toEqual({ ok: true });
  });

  it('the former AI endpoints are gone', async () => {
    expect((await post('/api/art-direct', {})).status).toBe(404);
    expect((await post('/api/art-direct/variations', {})).status).toBe(404);
  });

  it('exports a PDF and returns its own verification, with no key configured', async () => {
    const saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (/KEY|TOKEN|ANTHROPIC/i.test(k)) delete process.env[k];
    const t = getTemplate('cl4rc-standard-2024')! as never;
    const d = { ...defaultDesign, templateId: 'cl4rc-standard-2024', exportOpts: { ...defaultDesign.exportOpts, mode: 'single' as const } };
    const m = createPdfkitMeasurer();
    const composed = composeExport(d, t, m, 'pdf');
    const expectation = buildExpectation(d, t, m, composed);
    const r = await post('/api/export-pdf', { pages: composed.pages.map((p) => ({ svg: p.svg, wMm: p.wMm, hMm: p.hMm })), title: 'x', expectation });
    Object.assign(process.env, saved);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    const v = JSON.parse(Buffer.from(r.headers.get('x-export-validation')!, 'base64').toString());
    expect(v.ok).toBe(true);
    const pdf = Buffer.from(await r.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // the same PDF verified through the separate endpoint
    const v2 = await (await post('/api/validate-pdf', { pdfBase64: pdf.toString('base64'), expectation })).json();
    expect(v2.ok).toBe(true);
  });

  it('rejects bad requests cleanly', async () => {
    expect((await post('/api/export-pdf', { pages: [] })).status).toBe(400);
    expect((await post('/api/validate-pdf', {})).status).toBe(400);
    const bad = await post('/api/export-pdf', '{not json', true);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/valid JSON/);
  });
});
