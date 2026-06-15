import type { SidecarRunRequest } from './contract.js';

export interface SidecarHealth {
  ready: boolean;
  browserUseVersion?: string;
}

/** Command that starts the sidecar, shown when it's unreachable. */
const START_HINT =
  'start it with: cd packages/adapter-browser-use/sidecar && ' +
  'uv run uvicorn taskproof_sidecar.app:app --port 8765';

/**
 * Classify a fetch rejection so we can give an actionable message. fetch rejects with an opaque
 * `TypeError: fetch failed` on a network failure; the useful detail is in `error.cause.code`.
 * - `unreachable`: nothing is listening / DNS failed → the sidecar isn't running.
 * - `reset`: an established connection was dropped mid-request → the sidecar likely crashed.
 * An AbortError/TimeoutError is the caller's OWN abort or timeout, never a connection problem.
 * We lead with the explicit `cause.code` allowlist and only fall back to the `fetch failed`
 * substring when there's no code at all (so a coded-but-different failure keeps its real error).
 */
export function classifyFetchError(error: unknown): 'unreachable' | 'reset' | undefined {
  if (!(error instanceof Error) || error.name === 'AbortError' || error.name === 'TimeoutError') {
    return undefined;
  }
  const code = (error as { cause?: { code?: string } }).cause?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'unreachable';
  if (code === 'ECONNRESET') return 'reset';
  if (code === undefined && error.message.includes('fetch failed')) return 'unreachable';
  return undefined;
}

/** Thin HTTP client for the browser-use Python/FastAPI sidecar. */
export class SidecarClient {
  constructor(private readonly baseUrl: string) {}

  /** fetch, but a connection failure becomes an actionable message about the sidecar. */
  private async fetchSidecar(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path, this.baseUrl), init);
    } catch (error) {
      const kind = classifyFetchError(error);
      if (kind === 'unreachable') {
        throw new Error(
          `could not reach the browser-use sidecar at ${this.baseUrl} — ${START_HINT}`,
        );
      }
      if (kind === 'reset') {
        throw new Error(
          `lost connection to the browser-use sidecar at ${this.baseUrl} mid-request — ` +
            `it may have crashed or been killed (check the sidecar logs)`,
        );
      }
      throw error;
    }
  }

  async health(signal?: AbortSignal): Promise<SidecarHealth> {
    const response = await this.fetchSidecar('/health', signal ? { signal } : {});
    if (!response.ok) throw new Error(`sidecar /health returned ${response.status}`);
    return (await response.json()) as SidecarHealth;
  }

  /** POST a run request; returns the raw JSON body for the caller to validate. */
  async run(request: SidecarRunRequest, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetchSidecar('/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`sidecar /run returned ${response.status}: ${body.slice(0, 300)}`);
    }
    const data: unknown = await response.json();
    return data;
  }
}
