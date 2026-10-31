import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('React hook order in the App component', () => {
  it('no hook is called after the early return for the template library (it would crash the editor)', () => {
    const src = readFileSync('src/ui/App.tsx', 'utf8');
    const ret = src.indexOf('if (!usable || changing)');
    expect(ret).toBeGreaterThan(0);
    const after = src.slice(ret);
    // a hook is a call to use<Name>( ; the useCallback/useMemo/useRef/useEffect/useState family and our own use* hooks
    const hooks = [...after.matchAll(/\buse[A-Z][A-Za-z]*\(/g)].map((m) => m[0]);
    expect(hooks).toEqual([]);
    // and the early return must still exist, so this test cannot pass vacuously
    expect(src.slice(0, ret)).toMatch(/useState\(/);
  });
});
