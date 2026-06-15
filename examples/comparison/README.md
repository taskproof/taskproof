# The headline comparison: Claude computer-use vs. browser-use

The same model (`claude-opus-4-8`) driving the same five tasks through **two different agent
harnesses** — Claude's computer-use loop (screenshots + pixel actions) and
[browser-use](https://github.com/browser-use/browser-use) (accessibility/DOM tree). Holding
the model constant means every difference in the matrix is attributable to the **harness's
perception layer**, not model capability. That's the thesis: _same brain, two pairs of eyes._

## Run it

```bash
# 1. Build taskproof + the Claude adapter's Chromium (see ../../docs/TESTING.md "Setup").
# 2. Start the browser-use sidecar in another terminal (it also drives claude-opus-4-8):
cd ../../packages/adapter-browser-use/sidecar
uv sync && uv run browser-use install
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY uv run uvicorn taskproof_sidecar.app:app --port 8765

# 3. Run the matrix (from the repo root), then open the report:
export ANTHROPIC_API_KEY=sk-ant-…
taskproof run examples/comparison/*.yaml --models claude-opus-4-8,browser-use --out taskproof-runs
taskproof report --dir taskproof-runs && open taskproof-runs/report.html
```

The report's **"Where the harnesses diverged"** callout names any task the two harnesses
disagreed on, with both cells' pass@k, step count, cost, and the failing cell's reason —
the demo frame.

A **baseline** from a real 10/10 run is committed at `baseline.json` (Claude vs browser-use,
2026-06-14). After a re-run, diff against it to see what moved:

```bash
taskproof diff --dir taskproof-runs --baseline examples/comparison/baseline.json --markdown
```

## The five tasks (a demo arc, not a flat benchmark)

| Spec                          | Role                          | What it shows                                                             |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `wikipedia-shannon-baseline`  | Control                       | Both pass; the cost/step floor. Proves the matrix isn't rigged.           |
| `books-find-upc`              | Control (docs/search surface) | Both pass on static HTML; the DOM-native harness is cheaper.              |
| `saucedemo-buy-tshirt`        | E-commerce centerpiece        | "Buy a t-shirt": long SPA checkout; the cost/step gap, likely divergence. |
| `scrapingcourse-cart-network` | Network-assertion showcase    | All three assertion types (url + dom + network) on a real backend.        |
| `dynamic-loading-wait`        | Behavioral probe              | Async wait: does the harness initiate-then-wait, or act too early?        |

## Cost

Assuming pass@k `k=3` (the comparison default): **5 tasks × 2 harnesses × 3 runs = 30 runs**.
Estimated **~$4.74 point, ~$3.50–$9.00 range** — the Claude column dominates (~$3.40; computer-use
pays for a screenshot every step), browser-use is ~$1.40. Per-spec `maxCostUsd` caps bound any
runaway (saucedemo $2.50, others $0.75–$1.00). Far under the $15–75 full nightly matrix; this
is a focused headline set, not the whole grid.

**How cost is computed (so the comparison is apples-to-apples):** both columns are priced
through taskproof's one shared cost meter (`@taskproof/core`'s `CostMeter` over `MODEL_PRICING`)
from each harness's own Anthropic token usage — not from each library's separate cost estimate.
The browser-use sidecar's own estimate is used only as a fallback for a model not in
`MODEL_PRICING`. If an LLM-judge rubric is set, its call is metered the same way and added to the
cell total. (Caveat: the harnesses count tokens slightly differently — computer-use sends a
screenshot per step; browser-use sends a DOM/AX tree — so equal-task cost differences reflect the
harness, which is the point of the comparison.)

## Before you record: calibrate

These specs are designed from live HTTP checks of each target, **not** a full browser
click-through, so treat the first paid run as a calibration pass:

- **Selectors / URLs** (`.complete-header`, `[data-test=back-to-products]`, `article.product_page`,
  `#finish h4`) are the documented stable hooks for each site, but confirm them against the real
  DOM if a cell fails for a surprising reason.
- **`scrapingcourse-cart-network` was recalibrated** after the first run failed on both harnesses:
  the original product was _variable_ (needs size/color before add) and the cart is _block-based_
  (Store API), so the old `.woocommerce-cart-form` selector never existed. It now adds a **simple**
  product (Affirm Water Bottle) **from the shop listing**, whose `ajax_add_to_cart` button fires
  the same-origin `?wc-ajax=add_to_cart` POST the network assertion matches; the cart is checked
  via the block-cart wrapper. If the network assertion is the sole failure on re-run, broaden it to
  `**wc-ajax=*` or the Store API path `**/wp-json/wc/store/**`.
- **browser-use captures same-origin network only** — every network assertion here targets a
  same-origin endpoint on purpose.
- **Cold starts**: `the-internet.herokuapp.com` (dynamic-loading) can sleep on free-tier hosting;
  warm it before a timed run.

## The overlay task

Grading "the agent cleared the overlay" needs a **negative DOM assertion** — and as of
2026-06-14 the spec has one: `state: absent` (no element matches) and `state: hidden` (present
but not visible). `entry-ad-overlay.yaml` exercises `hidden` on a blocking modal.

A negative check can pass _vacuously_, and this fixture shows exactly why: the-internet's
`#modal` is rendered `display:none` and only revealed ~500ms after load, then dismissing hides
it again — so `#modal state:hidden` is true both before the ad appears and after it's dismissed.
The non-vacuous gate is the paired **network** assertion: dismissing fires `POST /entry_ad`,
which only a real dismiss triggers (and which both harnesses capture same-origin). Together they
grade an actual dismissal, not a no-op. (Caveat: on this page a click _anywhere_ dismisses, so
it validates dismiss-detection rather than "could the agent find the Close control"; the brief's
true "stumbled at the consent banner" shot wants a stricter fixture — a TODO.) It isn't in
`baseline.json`, which predates it.
