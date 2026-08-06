/**
 * A tolerant JSON reader for config files.
 *
 * `tsconfig.json` is JSON with comments and trailing commas, and this repo's
 * own tsconfig has both. `JSON.parse` refuses it, and refusing to read the
 * project's module aliases would silently drop real import edges — which is
 * the exact failure mode guardrail 4 exists to prevent.
 */

export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i] ?? '';
    const next = text[i + 1] ?? '';

    if (char === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === '"') break;
        j++;
      }
      out += text.slice(i, Math.min(j + 1, text.length));
      i = j + 1;
      continue;
    }

    if (char === '/' && next === '/') {
      const stop = text.indexOf('\n', i);
      i = stop === -1 ? text.length : stop;
      continue;
    }

    if (char === '/' && next === '*') {
      const stop = text.indexOf('*/', i + 2);
      i = stop === -1 ? text.length : stop + 2;
      continue;
    }

    out += char;
    i++;
  }
  // Trailing commas before a closing brace or bracket.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Returns `null` rather than throwing — a malformed config is not fatal. */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripJsonc(text));
  } catch {
    return null;
  }
}
