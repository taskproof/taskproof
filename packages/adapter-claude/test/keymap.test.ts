import { describe, expect, it } from 'vitest';

import { modifiersFromText, toPlaywrightKey, toPlaywrightShortcut } from '../src/keymap.js';

describe('toPlaywrightKey', () => {
  it('maps xdotool named keys to Playwright names', () => {
    expect(toPlaywrightKey('Return')).toBe('Enter');
    expect(toPlaywrightKey('Page_Down')).toBe('PageDown');
    expect(toPlaywrightKey('BackSpace')).toBe('Backspace');
    expect(toPlaywrightKey('Escape')).toBe('Escape');
    expect(toPlaywrightKey('Up')).toBe('ArrowUp');
  });

  it('maps modifier tokens', () => {
    expect(toPlaywrightKey('ctrl')).toBe('Control');
    expect(toPlaywrightKey('super')).toBe('Meta');
    expect(toPlaywrightKey('alt')).toBe('Alt');
  });

  it('upper-cases function keys', () => {
    expect(toPlaywrightKey('f5')).toBe('F5');
    expect(toPlaywrightKey('F12')).toBe('F12');
  });

  it('passes single characters through', () => {
    expect(toPlaywrightKey('a')).toBe('a');
    expect(toPlaywrightKey('7')).toBe('7');
  });
});

describe('toPlaywrightShortcut', () => {
  it('maps a combo to a Playwright shortcut', () => {
    expect(toPlaywrightShortcut('ctrl+s')).toBe('Control+s');
    expect(toPlaywrightShortcut('ctrl+shift+t')).toBe('Control+Shift+t');
    expect(toPlaywrightShortcut('alt+Tab')).toBe('Alt+Tab');
    expect(toPlaywrightShortcut('super+l')).toBe('Meta+l');
  });

  it('handles a literal plus key', () => {
    expect(toPlaywrightShortcut('ctrl++')).toBe('Control++');
  });
});

describe('modifiersFromText', () => {
  it('extracts Playwright modifier names', () => {
    expect(modifiersFromText('shift')).toEqual(['Shift']);
    expect(modifiersFromText('ctrl')).toEqual(['Control']);
    expect(modifiersFromText('super')).toEqual(['Meta']);
  });

  it('returns empty for undefined or blank', () => {
    expect(modifiersFromText(undefined)).toEqual([]);
    expect(modifiersFromText('')).toEqual([]);
  });
});
