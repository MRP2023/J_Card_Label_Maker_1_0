import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');

describe('print testing documentation', () => {
  const guide = read('docs/PRINT_TESTING.md');

  it('covers every step: print at 100%, measure the calibration square, cut, compare with the cassette, record discrepancies', () => {
    for (const needle of ['100% / "Actual size"', 'Fit to page', '10 mm square', '100 mm ruler', 'red cut line', 'cassette', 'fit-record-template.md', 'discrepanc']) expect(guide.toLowerCase()).toContain(needle.toLowerCase());
    for (const step of ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6']) expect(guide).toContain(step);
  });

  it('never claims physical fit is verified, and defines the levels', () => {
    expect(guide).toMatch(/Fit-verified/);
    expect(guide).toMatch(/physical fit remains unverified/i);
    expect(guide).not.toMatch(/fit is verified for all|guaranteed to fit/i);
  });

  it('has a fit record template (markdown and csv) with the key fields', () => {
    expect(existsSync('docs/fit-record-template.md')).toBe(true);
    const rec = read('docs/fit-record-template.md');
    for (const f of ['Template', 'Printer', '10 mm square', 'Cassette shell', 'Discrepancies', 'Fit-verified']) expect(rec).toContain(f);
    expect(read('docs/fit-record-template.csv').split('\n')[0]).toMatch(/calibration_square_h_mm.*verdict/);
  });
});

describe('configuration', () => {
  it('.env is still ignored by git (harmless) and no environment setup is required', () => {
    expect(read('.gitignore')).toMatch(/^\.env$/m);
    expect(existsSync('.env.example')).toBe(false);
  });

  it('the README explains that no API key or internet is needed', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/no API key/i);
    expect(readme).toMatch(/without an internet connection|offline/i);
    expect(readme).not.toMatch(/ANTHROPIC_API_KEY=/);
  });
});
