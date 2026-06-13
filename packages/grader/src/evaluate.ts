import type { AssertionResult } from '@taskproof/core';
import type { Assertion } from '@taskproof/spec';

import { globMatch } from './glob.js';
import type { Probe } from './probe.js';

function statusMatches(observed: number, expected: number | string): boolean {
  if (typeof expected === 'number') return observed === expected;
  // class like "2xx" — first digit must match
  return String(Math.floor(observed / 100)) === expected[0];
}

/** Evaluate a single assertion against the probe, producing a typed result. */
export async function evaluateAssertion(
  assertion: Assertion,
  probe: Probe,
): Promise<AssertionResult> {
  const base = assertion.description !== undefined ? { description: assertion.description } : {};

  if (assertion.type === 'url') {
    const url = probe.finalUrl ?? '';
    const ok = url !== '' && globMatch(assertion.pattern, url);
    return {
      type: 'url',
      ok,
      detail: ok
        ? `final URL ${url} matched ${assertion.pattern}`
        : `final URL ${url || '(none)'} did not match ${assertion.pattern}`,
      ...base,
    };
  }

  if (assertion.type === 'network') {
    const matches = probe.network.filter((event) => {
      if (!globMatch(assertion.urlPattern, event.url)) return false;
      if (assertion.method !== undefined && event.method.toUpperCase() !== assertion.method)
        return false;
      if (assertion.status !== undefined) {
        if (event.status === undefined) return false;
        if (!statusMatches(event.status, assertion.status)) return false;
      }
      return true;
    });
    const ok = matches.length > 0;
    const criteria = [
      assertion.method ? `${assertion.method} ` : '',
      assertion.urlPattern,
      assertion.status !== undefined ? ` [${String(assertion.status)}]` : '',
    ].join('');
    return {
      type: 'network',
      ok,
      detail: ok
        ? `${matches.length} request(s) matched ${criteria}`
        : `no request matched ${criteria}`,
      ...base,
    };
  }

  // dom
  const result = await probe.dom(assertion.selector);
  if (result.error !== undefined) {
    return {
      type: 'dom',
      ok: false,
      detail: `selector "${assertion.selector}": ${result.error}`,
      ...base,
    };
  }
  if (assertion.state === 'attached') {
    return {
      type: 'dom',
      ok: result.exists,
      detail: result.exists
        ? `"${assertion.selector}" is attached`
        : `"${assertion.selector}" not found`,
      ...base,
    };
  }
  if (assertion.state === 'visible') {
    return {
      type: 'dom',
      ok: result.visible,
      detail: result.visible
        ? `"${assertion.selector}" is visible`
        : `"${assertion.selector}" is ${result.exists ? 'attached but not visible' : 'not found'}`,
      ...base,
    };
  }
  // state 'text' (assertion.text is guaranteed present by the spec schema)
  const needle = assertion.text ?? '';
  const haystack = result.text ?? '';
  const ok = result.exists && haystack.includes(needle);
  return {
    type: 'dom',
    ok,
    detail: ok
      ? `"${assertion.selector}" text contains "${needle}"`
      : result.exists
        ? `"${assertion.selector}" text did not contain "${needle}"`
        : `"${assertion.selector}" not found`,
    ...base,
  };
}

/** Evaluate every assertion in order. */
export async function evaluateAssertions(
  assertions: readonly Assertion[],
  probe: Probe,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  for (const assertion of assertions) {
    results.push(await evaluateAssertion(assertion, probe));
  }
  return results;
}

/** A run passes the deterministic gate when it has results and all of them hold. */
export function deterministicPass(results: readonly AssertionResult[]): boolean {
  return results.length > 0 && results.every((result) => result.ok);
}
