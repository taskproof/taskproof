/**
 * Compile a glob pattern to an anchored RegExp for matching URLs. `**` matches any
 * characters (including `/`); `*` matches within a path segment (no `/`); `?` matches a
 * single character. Patterns are full-match anchored — use a trailing `**` to match a
 * prefix (e.g. `**\/api/orders**` to tolerate query strings).
 */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i] as string;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '.';
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** Whether `value` fully matches the glob `pattern`. */
export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}
