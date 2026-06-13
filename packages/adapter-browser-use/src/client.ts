import type { SidecarRunRequest } from './contract.js';

export interface SidecarHealth {
  ready: boolean;
  browserUseVersion?: string;
}

/** Thin HTTP client for the browser-use Python/FastAPI sidecar. */
export class SidecarClient {
  constructor(private readonly baseUrl: string) {}

  async health(signal?: AbortSignal): Promise<SidecarHealth> {
    const response = await fetch(new URL('/health', this.baseUrl), signal ? { signal } : {});
    if (!response.ok) throw new Error(`sidecar /health returned ${response.status}`);
    return (await response.json()) as SidecarHealth;
  }

  /** POST a run request; returns the raw JSON body for the caller to validate. */
  async run(request: SidecarRunRequest, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(new URL('/run', this.baseUrl), {
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
