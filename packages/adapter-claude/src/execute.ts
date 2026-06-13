import type { Page } from 'playwright';

import type { ComputerAction } from './actions.js';
import { toPlaywrightKey, toPlaywrightShortcut } from './keymap.js';

/** Pixels scrolled per unit of the model's `scroll_amount`. */
const SCROLL_PIXELS_PER_UNIT = 100;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Hold the given modifier keys down for the duration of `fn`. Playwright's mouse API
 * has no `modifiers` option for coordinate clicks, so we press them around the action. */
async function withModifiers(
  page: Page,
  modifiers: string[],
  fn: () => Promise<void>,
): Promise<void> {
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try {
    await fn();
  } finally {
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  }
}

/**
 * Apply a parsed {@link ComputerAction} to a Playwright page. The virtual display
 * matches the page viewport (see DEFAULT_DISPLAY), so coordinates are used as-is.
 * `zoom` is handled by the caller (it is a screenshot crop, not a page mutation).
 */
export async function executeAction(page: Page, action: ComputerAction): Promise<void> {
  switch (action.type) {
    case 'screenshot':
    case 'zoom':
      return; // the loop captures the (optionally clipped) screenshot afterward

    case 'wait':
      await sleep(action.durationSec * 1000);
      return;

    case 'mouse_move':
      await page.mouse.move(action.coordinate[0], action.coordinate[1]);
      return;

    case 'left_mouse_down':
      if (action.coordinate) await page.mouse.move(action.coordinate[0], action.coordinate[1]);
      await page.mouse.down();
      return;

    case 'left_mouse_up':
      if (action.coordinate) await page.mouse.move(action.coordinate[0], action.coordinate[1]);
      await page.mouse.up();
      return;

    case 'left_click':
    case 'right_click':
    case 'middle_click': {
      const button =
        action.type === 'right_click'
          ? 'right'
          : action.type === 'middle_click'
            ? 'middle'
            : 'left';
      await withModifiers(page, action.modifiers, () =>
        page.mouse.click(action.coordinate[0], action.coordinate[1], { button }),
      );
      return;
    }

    case 'double_click':
      await withModifiers(page, action.modifiers, () =>
        page.mouse.dblclick(action.coordinate[0], action.coordinate[1]),
      );
      return;

    case 'triple_click':
      await withModifiers(page, action.modifiers, () =>
        page.mouse.click(action.coordinate[0], action.coordinate[1], { clickCount: 3 }),
      );
      return;

    case 'left_click_drag':
      await withModifiers(page, action.modifiers, async () => {
        await page.mouse.move(action.start[0], action.start[1]);
        await page.mouse.down();
        await page.mouse.move(action.coordinate[0], action.coordinate[1]);
        await page.mouse.up();
      });
      return;

    case 'type':
      await page.keyboard.type(action.text);
      return;

    case 'key':
      await page.keyboard.press(toPlaywrightShortcut(action.keys));
      return;

    case 'hold_key': {
      const key = toPlaywrightKey(action.keys);
      await page.keyboard.down(key);
      await sleep(action.durationSec * 1000);
      await page.keyboard.up(key);
      return;
    }

    case 'scroll': {
      await page.mouse.move(action.coordinate[0], action.coordinate[1]);
      const distance = action.amount * SCROLL_PIXELS_PER_UNIT;
      const dx =
        action.direction === 'right' ? distance : action.direction === 'left' ? -distance : 0;
      const dy = action.direction === 'down' ? distance : action.direction === 'up' ? -distance : 0;
      for (const modifier of action.modifiers) await page.keyboard.down(modifier);
      try {
        await page.mouse.wheel(dx, dy);
      } finally {
        for (const modifier of action.modifiers) await page.keyboard.up(modifier);
      }
      return;
    }
  }
}

/** Capture a PNG screenshot, optionally clipped to a zoom region [x1, y1, x2, y2]. */
export async function capture(
  page: Page,
  region?: readonly [number, number, number, number],
): Promise<Buffer> {
  if (region) {
    const [x1, y1, x2, y2] = region;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.max(1, Math.abs(x2 - x1));
    const height = Math.max(1, Math.abs(y2 - y1));
    return page.screenshot({ type: 'png', clip: { x, y, width, height } });
  }
  return page.screenshot({ type: 'png' });
}
