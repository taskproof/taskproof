import { describe, expect, it } from 'vitest';

import { ActionParseError, parseAction } from '../src/actions.js';

describe('parseAction', () => {
  it('parses a screenshot', () => {
    expect(parseAction({ action: 'screenshot' })).toEqual({ type: 'screenshot' });
  });

  it('parses a left_click with coordinate and no modifiers', () => {
    expect(parseAction({ action: 'left_click', coordinate: [120, 240] })).toEqual({
      type: 'left_click',
      coordinate: [120, 240],
      modifiers: [],
    });
  });

  it('extracts modifier keys from a click text field', () => {
    const action = parseAction({ action: 'left_click', coordinate: [10, 20], text: 'shift' });
    expect(action).toMatchObject({ type: 'left_click', modifiers: ['Shift'] });
  });

  it('parses type and key actions', () => {
    expect(parseAction({ action: 'type', text: 'hello' })).toEqual({ type: 'type', text: 'hello' });
    expect(parseAction({ action: 'key', text: 'ctrl+s' })).toEqual({ type: 'key', keys: 'ctrl+s' });
  });

  it('parses a scroll with direction and amount', () => {
    expect(
      parseAction({
        action: 'scroll',
        coordinate: [500, 400],
        scroll_direction: 'down',
        scroll_amount: 3,
      }),
    ).toEqual({
      type: 'scroll',
      coordinate: [500, 400],
      direction: 'down',
      amount: 3,
      modifiers: [],
    });
  });

  it('defaults scroll_amount when omitted', () => {
    const action = parseAction({ action: 'scroll', coordinate: [1, 2], scroll_direction: 'up' });
    expect(action).toMatchObject({ type: 'scroll', amount: 3 });
  });

  it('parses left_click_drag with start and end', () => {
    expect(
      parseAction({ action: 'left_click_drag', start_coordinate: [0, 0], coordinate: [100, 100] }),
    ).toEqual({ type: 'left_click_drag', start: [0, 0], coordinate: [100, 100], modifiers: [] });
  });

  it('parses hold_key and wait durations', () => {
    expect(parseAction({ action: 'hold_key', text: 'shift', duration: 2 })).toEqual({
      type: 'hold_key',
      keys: 'shift',
      durationSec: 2,
    });
    expect(parseAction({ action: 'wait', duration: 1.5 })).toEqual({
      type: 'wait',
      durationSec: 1.5,
    });
  });

  it('parses left_mouse_down with and without a coordinate', () => {
    expect(parseAction({ action: 'left_mouse_down' })).toEqual({ type: 'left_mouse_down' });
    expect(parseAction({ action: 'left_mouse_down', coordinate: [5, 6] })).toEqual({
      type: 'left_mouse_down',
      coordinate: [5, 6],
    });
  });

  it('parses a zoom region', () => {
    expect(parseAction({ action: 'zoom', region: [100, 200, 400, 350] })).toEqual({
      type: 'zoom',
      region: [100, 200, 400, 350],
    });
  });

  it('throws on a missing action', () => {
    expect(() => parseAction({})).toThrowError(ActionParseError);
  });

  it('throws on an unsupported action', () => {
    expect(() => parseAction({ action: 'teleport' })).toThrowError(/unsupported computer action/);
  });

  it('throws on a malformed coordinate', () => {
    expect(() => parseAction({ action: 'left_click', coordinate: [1] })).toThrowError(
      ActionParseError,
    );
    expect(() => parseAction({ action: 'left_click', coordinate: ['a', 'b'] })).toThrowError(
      ActionParseError,
    );
  });

  it('throws on a bad scroll direction', () => {
    expect(() =>
      parseAction({ action: 'scroll', coordinate: [1, 2], scroll_direction: 'sideways' }),
    ).toThrowError(/scroll_direction/);
  });
});
