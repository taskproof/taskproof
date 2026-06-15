/** USD pricing for a model, per million tokens. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

/**
 * Per-MTok pricing for the computer-use-capable models, verified 2026-06 from the
 * claude-api reference. Cache reads/writes are priced as multiples of the input rate
 * (Anthropic prompt-caching economics), so only input/output base rates live here.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-7': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-6': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Cache reads bill at ~0.1x the input rate; cache writes at ~1.25x (5-minute TTL). */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the prompt cache (billed at the read multiplier). */
  cacheReadTokens?: number;
  /** Tokens written to the prompt cache (billed at the write multiplier). */
  cacheCreationTokens?: number;
}

/** Cost in USD of a single usage delta, given a model's pricing. */
export function priceUsage(usage: TokenUsage, pricing: ModelPricing): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreation = usage.cacheCreationTokens ?? 0;
  const billableInput =
    usage.inputTokens + cacheCreation * CACHE_WRITE_MULTIPLIER + cacheRead * CACHE_READ_MULTIPLIER;
  const inputCost = (billableInput / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
  return inputCost + outputCost;
}

/** Look up published pricing for a model id, or `undefined` if it isn't known. */
export function getModelPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING[model];
}

export class BudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly capUsd: number;

  constructor(spentUsd: number, capUsd: number) {
    super(`run cost $${spentUsd.toFixed(4)} exceeded the cap of $${capUsd.toFixed(4)}`);
    this.name = 'BudgetExceededError';
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}

export interface CostMeterOptions {
  /** Model id used to resolve pricing from the published table. */
  model?: string;
  /** Explicit pricing; overrides the table lookup (required for unknown models). */
  pricing?: ModelPricing;
  /** Soft per-run budget cap in USD (see {@link CostMeter}); omitted means unbounded. */
  maxCostUsd?: number;
}

type Totals = Required<TokenUsage>;

/**
 * Accumulates token usage across an agent run and tracks cost against an optional budget cap.
 * The cap is SOFT, not hard: a turn's cost is unknown until it's billed, so callers gate the
 * next turn via `wouldExceed()` / `remainingUsd()` (stop before paying) — but a turn that spikes
 * past the running estimate can still exceed the cap by up to one turn's cost. `record()` throws
 * only on a non-finite turn cost (a data error that would otherwise poison the budget); after a
 * clean record, `enforce()` throws once the total is already over.
 */
export class CostMeter {
  readonly pricing: ModelPricing;
  readonly maxCostUsd: number | undefined;
  private total = 0;
  private readonly running: Totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  constructor(options: CostMeterOptions) {
    const pricing = options.pricing ?? (options.model ? getModelPricing(options.model) : undefined);
    if (pricing === undefined) {
      throw new Error(
        options.model === undefined
          ? 'CostMeter requires either a known `model` or explicit `pricing`'
          : `no published pricing for model "${options.model}"; pass explicit \`pricing\``,
      );
    }
    this.pricing = pricing;
    if (
      options.maxCostUsd !== undefined &&
      (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0)
    ) {
      // A NaN cap (e.g. from `--max-cost garbage` → parseFloat) would make every `> cap`
      // comparison false, silently disabling the budget. A 0 cap reads as "spend nothing" but
      // still bills one turn under the soft-cap model — a footgun — so reject ≤ 0 too. This
      // matches the schema's `.positive()` and the CLI's `> 0` check; the only callers that pass
      // a cap go through one of those, so legitimate runs are unaffected.
      throw new Error(`maxCostUsd must be a finite, positive number, got ${options.maxCostUsd}`);
    }
    this.maxCostUsd = options.maxCostUsd;
  }

  /** Add one turn's usage to the running totals and return its and the cumulative cost. */
  record(usage: TokenUsage): { costUsd: number; totalUsd: number } {
    const costUsd = priceUsage(usage, this.pricing);
    if (!Number.isFinite(costUsd)) {
      // A non-finite turn cost (NaN/Infinity from a malformed usage object) would poison `total`
      // for the rest of the run — every `wouldExceed`/`enforce` comparison against NaN is false,
      // silently defeating the budget cap. Reject it rather than corrupt the meter. Symmetric
      // with the constructor's guard on `maxCostUsd`.
      throw new Error(
        `CostMeter.record: turn cost must be finite, got ${costUsd} from usage ${JSON.stringify(usage)}`,
      );
    }
    this.total += costUsd;
    this.running.inputTokens += usage.inputTokens;
    this.running.outputTokens += usage.outputTokens;
    this.running.cacheReadTokens += usage.cacheReadTokens ?? 0;
    this.running.cacheCreationTokens += usage.cacheCreationTokens ?? 0;
    return { costUsd, totalUsd: this.total };
  }

  get totalUsd(): number {
    return this.total;
  }

  get totals(): Readonly<Totals> {
    return this.running;
  }

  /** USD left under the cap, or `undefined` when there is no cap. Never negative. */
  remainingUsd(): number | undefined {
    return this.maxCostUsd === undefined ? undefined : Math.max(0, this.maxCostUsd - this.total);
  }

  /** Whether spending `costUsd` more would push the total past the cap. */
  wouldExceed(costUsd: number): boolean {
    return this.maxCostUsd !== undefined && this.total + costUsd > this.maxCostUsd;
  }

  /** Throw `BudgetExceededError` if the cumulative total is already over the cap. */
  enforce(): void {
    if (this.maxCostUsd !== undefined && this.total > this.maxCostUsd) {
      throw new BudgetExceededError(this.total, this.maxCostUsd);
    }
  }
}
