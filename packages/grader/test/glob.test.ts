import { describe, expect, it } from 'vitest';

import { globMatch } from '../src/index.js';

describe('globMatch', () => {
  it('** matches across slashes', () => {
    expect(globMatch('**iana.org**', 'https://www.iana.org/help/example-domains')).toBe(true);
    expect(
      globMatch('**/wiki/Claude_Shannon**', 'https://en.wikipedia.org/wiki/Claude_Shannon'),
    ).toBe(true);
    expect(globMatch('**/order/confirmed**', 'https://shop.example.com/order/confirmed?id=9')).toBe(
      true,
    );
  });

  it('* does not cross a slash', () => {
    expect(globMatch('https://example.com/*', 'https://example.com/pricing')).toBe(true);
    expect(globMatch('https://example.com/*', 'https://example.com/a/b')).toBe(false);
  });

  it('is full-match anchored', () => {
    expect(globMatch('**/api/orders', 'https://x.com/api/orders')).toBe(true);
    expect(globMatch('**/api/orders', 'https://x.com/api/orders?q=1')).toBe(false); // need trailing **
  });

  it('escapes regex metacharacters in the literal parts', () => {
    expect(globMatch('**example.com/a.b**', 'https://example.com/a.b/c')).toBe(true);
    expect(globMatch('**example.com/a.b**', 'https://example.com/aXb/c')).toBe(false);
  });

  it('? matches a single character', () => {
    expect(globMatch('**/v?/orders', 'https://x.com/v2/orders')).toBe(true);
  });
});
