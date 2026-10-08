// The end of the JSON string that opens at the index, past its closing quote.
function stringEnd(source: string, start: number) {
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    index += source[index] === '\\' ? 2 : 1;
  }
  return index + 1;
}

/**
 * The span of the top-level `version` string in a JSON object's source. Scanning instead of
 * re-serializing keeps every other byte, and a nested `version`, such as a script's, never matches.
 * The last one wins, as it does for `JSON.parse`.
 */
function versionSpan(source: string) {
  let depth = 0;
  let state: 'key' | 'colon' | 'value' | 'other' = 'other';
  let key: unknown = undefined;
  let span: { end: number; start: number } | undefined = undefined;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    let next = index + 1;
    if (character === '"') {
      next = stringEnd(source, index);
      if (depth === 1 && state === 'key') {
        key = JSON.parse(source.slice(index, next));
        state = 'colon';
      } else if (depth === 1 && state === 'value') {
        span = key === 'version' ? { end: next, start: index } : span;
        state = 'other';
      }
    } else if (character === '{' || character === '[') {
      depth += 1;
      state = depth === 1 && character === '{' ? 'key' : 'other';
    } else if (character === '}' || character === ']') {
      depth -= 1;
      state = 'other';
    } else if (depth === 1 && character === ':') {
      state = 'value';
    } else if (depth === 1 && character === ',') {
      state = 'key';
    } else if (depth === 1 && state === 'value' && !/\s/u.test(character ?? '')) {
      state = 'other';
    }
    index = next;
  }
  return span;
}

/**
 * The manifest with its top-level `version` set and every other byte kept, a leading byte order
 * mark included. Both the per-package cut and the synchronized cut set versions through it.
 */
export function withVersion(source: string, version: string) {
  const span = versionSpan(source);
  if (span === undefined) {
    throw new Error('package.json: expected a version string.');
  }
  return source.slice(0, span.start) + JSON.stringify(version) + source.slice(span.end);
}
