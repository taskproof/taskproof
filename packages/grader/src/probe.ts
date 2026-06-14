import type { NetworkEvent, RunArtifact } from '@taskproof/core';

/** The outcome of inspecting a DOM selector against the final page state. */
export interface DomProbeResult {
  /** At least one element matched the selector. */
  exists: boolean;
  /** The first match is visible (laid out, not hidden). */
  visible: boolean;
  /** The first match's text content ('' if the element has none); null only when no element matched. */
  text: string | null;
  /** Set when the selector itself could not be evaluated (e.g. invalid CSS). */
  error?: string;
  /**
   * Whether the page rendered real content (body has child elements) — false on a blank /
   * failed-navigation / error page. Lets `absent` reject a vacuous pass: a missing element on a
   * dead page is not a dismissal. Optional; when undefined the grader can't tell, so it does not
   * block (older probes / artifacts). It does NOT prove the *right* page loaded — pair `absent`
   * with a positive anchor (url/visible/network) for that.
   */
  pageReady?: boolean;
}

/**
 * The surface the assertion evaluator needs to grade a run. `url` and `network` come
 * straight from the recorded run; `dom` requires a live page, so a probe backed only by
 * an artifact returns an error result for dom checks.
 */
export interface Probe {
  finalUrl: string | undefined;
  network: NetworkEvent[];
  dom(selector: string): Promise<DomProbeResult>;
}

/**
 * Build a probe from a completed artifact. url and network grade from the record; dom
 * cannot be re-evaluated offline (no live page), so it reports an error — re-run to
 * re-grade dom assertions, or read the dom results already embedded in the artifact.
 */
export function artifactProbe(artifact: RunArtifact): Probe {
  return {
    finalUrl: artifact.finalUrl,
    network: artifact.network,
    dom: () =>
      Promise.resolve({
        exists: false,
        visible: false,
        text: null,
        error: 'dom assertions cannot be evaluated from an artifact; evaluate live during the run',
      }),
  };
}
