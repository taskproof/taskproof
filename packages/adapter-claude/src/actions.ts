import { modifiersFromText } from './keymap.js';

export type Coordinate = readonly [number, number];

/**
 * A computer-use action normalized from Claude's raw tool_use input into a typed,
 * validated union. Parsing is separated from execution so it can be unit-tested
 * without a browser.
 */
export type ComputerAction =
  | { type: 'screenshot' }
  | { type: 'wait'; durationSec: number }
  | { type: 'mouse_move'; coordinate: Coordinate }
  | { type: 'left_mouse_down'; coordinate?: Coordinate }
  | { type: 'left_mouse_up'; coordinate?: Coordinate }
  | {
      type: 'left_click' | 'right_click' | 'middle_click' | 'double_click' | 'triple_click';
      coordinate: Coordinate;
      modifiers: string[];
    }
  | { type: 'left_click_drag'; start: Coordinate; coordinate: Coordinate; modifiers: string[] }
  | { type: 'type'; text: string }
  | { type: 'key'; keys: string }
  | { type: 'hold_key'; keys: string; durationSec: number }
  | {
      type: 'scroll';
      coordinate: Coordinate;
      direction: 'up' | 'down' | 'left' | 'right';
      amount: number;
      modifiers: string[];
    }
  | { type: 'zoom'; region: readonly [number, number, number, number] };

export class ActionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionParseError';
  }
}

function asCoordinate(value: unknown, field: string): Coordinate {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  ) {
    return [value[0], value[1]];
  }
  throw new ActionParseError(`${field} must be a [x, y] coordinate of finite numbers`);
}

function asString(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new ActionParseError(`${field} must be a string`);
}

function asDurationSec(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  throw new ActionParseError(`${field} must be a non-negative number of seconds`);
}

const CLICK_TYPES = new Set([
  'left_click',
  'right_click',
  'middle_click',
  'double_click',
  'triple_click',
]);

/**
 * Parse Claude's raw computer tool input (the `input` object of a tool_use block)
 * into a typed {@link ComputerAction}. Throws {@link ActionParseError} on anything
 * malformed so the run loop can return an `is_error` tool result instead of crashing.
 */
export function parseAction(input: Record<string, unknown>): ComputerAction {
  const action = input['action'];
  if (typeof action !== 'string') {
    throw new ActionParseError('tool input is missing a string `action`');
  }

  switch (action) {
    case 'screenshot':
      return { type: 'screenshot' };

    case 'wait':
      return { type: 'wait', durationSec: asDurationSec(input['duration'], 'duration') };

    case 'mouse_move':
      return { type: 'mouse_move', coordinate: asCoordinate(input['coordinate'], 'coordinate') };

    case 'left_mouse_down':
    case 'left_mouse_up': {
      const coord = input['coordinate'];
      return coord === undefined
        ? { type: action }
        : { type: action, coordinate: asCoordinate(coord, 'coordinate') };
    }

    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click':
    case 'triple_click':
      return {
        type: action,
        coordinate: asCoordinate(input['coordinate'], 'coordinate'),
        modifiers: modifiersFromText(input['text'] as string | undefined),
      };

    case 'left_click_drag':
      return {
        type: 'left_click_drag',
        start: asCoordinate(input['start_coordinate'], 'start_coordinate'),
        coordinate: asCoordinate(input['coordinate'], 'coordinate'),
        modifiers: modifiersFromText(input['text'] as string | undefined),
      };

    case 'type':
      return { type: 'type', text: asString(input['text'], 'text') };

    case 'key':
      return { type: 'key', keys: asString(input['text'], 'text') };

    case 'hold_key':
      return {
        type: 'hold_key',
        keys: asString(input['text'], 'text'),
        durationSec: asDurationSec(input['duration'], 'duration'),
      };

    case 'scroll': {
      const direction = input['scroll_direction'];
      if (
        direction !== 'up' &&
        direction !== 'down' &&
        direction !== 'left' &&
        direction !== 'right'
      ) {
        throw new ActionParseError('scroll_direction must be up, down, left, or right');
      }
      const amountRaw = input['scroll_amount'];
      const amount = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : 3;
      return {
        type: 'scroll',
        coordinate: asCoordinate(input['coordinate'], 'coordinate'),
        direction,
        amount,
        modifiers: modifiersFromText(input['text'] as string | undefined),
      };
    }

    case 'zoom': {
      const region = input['region'];
      if (
        Array.isArray(region) &&
        region.length === 4 &&
        region.every((n) => typeof n === 'number' && Number.isFinite(n))
      ) {
        return { type: 'zoom', region: [region[0], region[1], region[2], region[3]] };
      }
      throw new ActionParseError('zoom region must be [x1, y1, x2, y2] of finite numbers');
    }

    default:
      throw new ActionParseError(`unsupported computer action "${action}"`);
  }
}

/** Whether an action type produces a click (used to decide cursor handling). */
export function isClickAction(type: string): boolean {
  return CLICK_TYPES.has(type);
}
