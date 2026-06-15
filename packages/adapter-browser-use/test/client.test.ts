import { describe, expect, it } from 'vitest';

import { classifyFetchError } from '../src/client.js';

/** Build a fetch-style rejection: a TypeError('fetch failed') whose cause carries a code. */
function fetchFailed(code?: string): Error {
  return new TypeError('fetch failed', code !== undefined ? { cause: { code } } : undefined);
}

function named(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe('classifyFetchError', () => {
  it('treats "not listening" / DNS failures as unreachable (sidecar not running)', () => {
    expect(classifyFetchError(fetchFailed('ECONNREFUSED'))).toBe('unreachable');
    expect(classifyFetchError(fetchFailed('ENOTFOUND'))).toBe('unreachable');
    expect(classifyFetchError(fetchFailed('EAI_AGAIN'))).toBe('unreachable');
  });

  it('treats a mid-flight connection drop (ECONNRESET) as a reset, not "not running"', () => {
    expect(classifyFetchError(fetchFailed('ECONNRESET'))).toBe('reset');
  });

  it('falls back to unreachable for a coded-less "fetch failed" only', () => {
    expect(classifyFetchError(fetchFailed())).toBe('unreachable');
  });

  it('does NOT classify the caller’s own abort or client timeout as a connection error', () => {
    // AbortError = caller cancel; TimeoutError = our AbortSignal.timeout backstop. Both must
    // propagate as-is, never be rewrapped as "sidecar not running".
    expect(classifyFetchError(named('AbortError', 'aborted'))).toBeUndefined();
    expect(
      classifyFetchError(named('TimeoutError', 'The operation was aborted due to timeout')),
    ).toBeUndefined();
  });

  it('leaves a coded-but-unrecognized failure to propagate with its real message', () => {
    // A different cause.code (e.g. a TLS or protocol error) keeps its own error rather than
    // being mislabeled "start the sidecar".
    expect(classifyFetchError(fetchFailed('CERT_HAS_EXPIRED'))).toBeUndefined();
    expect(classifyFetchError(new Error('some unrelated failure'))).toBeUndefined();
    expect(classifyFetchError('not even an error')).toBeUndefined();
  });
});
