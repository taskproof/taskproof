import type { NetworkEvent } from '@taskproof/core';
import type { Assertion } from '@taskproof/spec';
import { describe, expect, it } from 'vitest';

import { deterministicPass, evaluateAssertion, evaluateAssertions } from '../src/index.js';
import type { DomProbeResult, Probe } from '../src/index.js';

function probe(opts: {
  finalUrl?: string;
  network?: NetworkEvent[];
  dom?: (selector: string) => DomProbeResult;
}): Probe {
  return {
    finalUrl: opts.finalUrl,
    network: opts.network ?? [],
    dom: (selector) =>
      Promise.resolve(opts.dom?.(selector) ?? { exists: false, visible: false, text: null }),
  };
}

describe('url assertions', () => {
  const assertion: Assertion = { type: 'url', pattern: '**/order/confirmed**' };

  it('passes when the final URL matches', async () => {
    const result = await evaluateAssertion(
      assertion,
      probe({ finalUrl: 'https://s.com/order/confirmed?x=1' }),
    );
    expect(result.ok).toBe(true);
  });

  it('fails when there is no final URL', async () => {
    const result = await evaluateAssertion(assertion, probe({}));
    expect(result.ok).toBe(false);
  });
});

describe('network assertions', () => {
  const events: NetworkEvent[] = [
    { url: 'https://s.com/api/orders', method: 'POST', status: 201, atMs: 10 },
    { url: 'https://s.com/static/app.js', method: 'GET', status: 200, atMs: 5 },
  ];

  it('matches url + method + status class', async () => {
    const a: Assertion = {
      type: 'network',
      urlPattern: '**/api/orders',
      method: 'POST',
      status: '2xx',
    };
    expect((await evaluateAssertion(a, probe({ network: events }))).ok).toBe(true);
  });

  it('matches an exact status code', async () => {
    const a: Assertion = { type: 'network', urlPattern: '**/api/orders', status: 201 };
    expect((await evaluateAssertion(a, probe({ network: events }))).ok).toBe(true);
  });

  it('fails when the method does not match', async () => {
    const a: Assertion = { type: 'network', urlPattern: '**/api/orders', method: 'GET' };
    expect((await evaluateAssertion(a, probe({ network: events }))).ok).toBe(false);
  });

  it('fails when nothing matches the url', async () => {
    const a: Assertion = { type: 'network', urlPattern: '**/api/checkout' };
    expect((await evaluateAssertion(a, probe({ network: events }))).ok).toBe(false);
  });
});

describe('dom assertions', () => {
  it('attached passes when the element exists', async () => {
    const a: Assertion = { type: 'dom', selector: '#x', state: 'attached' };
    const ok = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: false, text: null }) }),
    );
    expect(ok.ok).toBe(true);
  });

  it('visible distinguishes attached-but-hidden from visible', async () => {
    const a: Assertion = { type: 'dom', selector: '#x', state: 'visible' };
    const hidden = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: false, text: null }) }),
    );
    expect(hidden.ok).toBe(false);
    expect(hidden.detail).toContain('attached but not visible');
    const shown = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: true, text: null }) }),
    );
    expect(shown.ok).toBe(true);
  });

  it('text passes only on a substring match', async () => {
    const a: Assertion = { type: 'dom', selector: 'h1', state: 'text', text: 'Thank you' };
    const yes = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: true, text: 'Thank you for your order' }) }),
    );
    expect(yes.ok).toBe(true);
    const no = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: true, text: 'Error' }) }),
    );
    expect(no.ok).toBe(false);
  });

  it('absent passes only when nothing matches the selector', async () => {
    const a: Assertion = { type: 'dom', selector: '.modal', state: 'absent' };
    const gone = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: false, visible: false, text: null }) }),
    );
    expect(gone.ok).toBe(true);
    expect(gone.detail).toContain('absent');
    const present = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: true, text: null }) }),
    );
    expect(present.ok).toBe(false);
    expect(present.detail).toContain('still present');
  });

  it('hidden passes when present-but-not-visible, fails when visible or absent', async () => {
    const a: Assertion = { type: 'dom', selector: '.modal', state: 'hidden' };
    const dismissed = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: false, text: null }) }),
    );
    expect(dismissed.ok).toBe(true);
    const stillVisible = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: true, visible: true, text: null }) }),
    );
    expect(stillVisible.ok).toBe(false);
    expect(stillVisible.detail).toContain('still visible');
    // A selector that matches nothing is NOT "hidden" — it was never shown to be hidden.
    const missing = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: false, visible: false, text: null }) }),
    );
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain('absent');
  });

  it('absent fails (does not silently pass) when the selector cannot be evaluated', async () => {
    const a: Assertion = { type: 'dom', selector: ':::bad', state: 'absent' };
    const result = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: false, visible: false, text: null, error: 'bad selector' }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('bad selector');
  });

  it('surfaces a selector error as a failed result', async () => {
    const a: Assertion = { type: 'dom', selector: 'h1', state: 'attached' };
    const result = await evaluateAssertion(
      a,
      probe({ dom: () => ({ exists: false, visible: false, text: null, error: 'bad selector' }) }),
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('bad selector');
  });
});

describe('evaluateAssertions + deterministicPass', () => {
  it('passes only when every assertion holds', async () => {
    const assertions: Assertion[] = [
      { type: 'url', pattern: '**/done**' },
      { type: 'network', urlPattern: '**/api/x', status: '2xx' },
    ];
    const results = await evaluateAssertions(
      assertions,
      probe({
        finalUrl: 'https://s.com/done',
        network: [{ url: 'https://s.com/api/x', method: 'GET', status: 200, atMs: 1 }],
      }),
    );
    expect(deterministicPass(results)).toBe(true);
  });

  it('fails the gate if any assertion fails', async () => {
    const results = await evaluateAssertions(
      [{ type: 'url', pattern: '**/done**' }],
      probe({ finalUrl: 'https://s.com/error' }),
    );
    expect(deterministicPass(results)).toBe(false);
  });

  it('an empty result set does not pass', () => {
    expect(deterministicPass([])).toBe(false);
  });
});
