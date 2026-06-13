/**
 * Computer-use key names follow X11/xdotool conventions (e.g. "Return", "Page_Down",
 * "ctrl+s"). Playwright's keyboard uses its own names ("Enter", "PageDown",
 * "Control+S"). This module translates between them.
 */

const MODIFIERS: Readonly<Record<string, string>> = {
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  win: 'Meta',
};

// Named keys whose xdotool spelling differs from Playwright's.
const NAMED_KEYS: Readonly<Record<string, string>> = {
  return: 'Enter',
  kp_enter: 'Enter',
  enter: 'Enter',
  backspace: 'Backspace',
  bcksp: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  space: 'Space',
  page_up: 'PageUp',
  prior: 'PageUp',
  page_down: 'PageDown',
  next: 'PageDown',
  home: 'Home',
  end: 'End',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  insert: 'Insert',
  print: 'PrintScreen',
};

/** Map a single key token to its Playwright name. Single chars pass through as-is. */
export function toPlaywrightKey(token: string): string {
  const key = token.trim();
  if (key === '') return key;
  const lower = key.toLowerCase();
  if (lower in MODIFIERS) return MODIFIERS[lower] as string;
  if (lower in NAMED_KEYS) return NAMED_KEYS[lower] as string;
  // Function keys: f1..f24 -> F1..F24
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  // Single printable character — Playwright wants the literal char.
  if (key.length === 1) return key;
  // Unknown multi-char token: title-case as a best effort (Playwright is case-sensitive).
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Map a key combination like "ctrl+shift+t" to a Playwright shortcut "Control+Shift+T".
 * A literal "+" key is written as "plus" by the model, so a trailing empty token from a
 * split on "+" is treated as the "+" character.
 */
export function toPlaywrightShortcut(combo: string): string {
  // A trailing "+" means the literal plus key (e.g. "ctrl++" = Control + "+").
  if (combo.length > 1 && combo.endsWith('+')) {
    const modifiers = combo
      .slice(0, -1)
      .split('+')
      .filter((token) => token !== '')
      .map(toPlaywrightKey);
    return [...modifiers, '+'].join('+');
  }
  return combo
    .split('+')
    .filter((token) => token !== '')
    .map(toPlaywrightKey)
    .join('+');
}

/** Translate a click/scroll `text` modifier string into Playwright modifier names. */
export function modifiersFromText(text: string | undefined): string[] {
  if (text === undefined || text.trim() === '') return [];
  return text
    .split('+')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token in MODIFIERS)
    .map((token) => MODIFIERS[token] as string);
}
