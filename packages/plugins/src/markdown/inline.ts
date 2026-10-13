const firstIndex = 0;
const lastIndex = -1;
const step = 1;
const pairLength = 2;

/** Inline syntax is local to one authored line; opaque nodes isolate their delimiters. */
type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'address'; readonly text: string }
  | { readonly kind: 'link'; readonly children: readonly Inline[]; readonly destination: string }
  | { readonly kind: 'emphasis'; readonly children: readonly Inline[]; readonly strong: boolean };

interface Delimiter {
  kind: 'delimiter';
  marker: string;
}
type Token = Inline | Delimiter;
const punctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]$/u;
const alphanumeric = /[\p{L}\p{N}]/u;

/** Coalesces adjacent literal fragments so a plain line remains one styled value. */
function literal(tokens: Token[], text: string): void {
  const last = tokens.at(lastIndex);
  if (last?.kind === 'text') {
    tokens[tokens.length - step] = { kind: 'text', text: last.text + text };
  } else if (text !== '') {
    tokens.push({ kind: 'text', text });
  }
}

/** Unmatched opening delimiters become literal characters, including inside a closed pair. */
function materialize(tokens: readonly Token[]): Inline[] {
  const nodes: Inline[] = [];
  for (const token of tokens) {
    if (token.kind === 'delimiter') {
      literal(nodes, token.marker);
    } else if (token.kind === 'text') {
      literal(nodes, token.text);
    } else {
      nodes.push(token);
    }
  }
  return nodes;
}

/** The next equal-length backtick run closes a span; all other runs are literal inside it. */
function codeAt(source: string, start: number) {
  const opening = /^`+/u.exec(source.slice(start))?.[firstIndex];
  if (opening === undefined) {
    return undefined;
  }
  const runs = /`+/gu;
  runs.lastIndex = start + opening.length;
  for (let next = runs.exec(source); next !== null; next = runs.exec(source)) {
    if (next[firstIndex].length === opening.length) {
      const end = next.index + next[firstIndex].length;
      return { end, node: { kind: 'code', text: source.slice(start, end) } satisfies Inline };
    }
  }
  return undefined;
}

function bracketDepth(character: string | undefined, depth: number): number {
  if (character === '[') {
    return depth + step;
  }
  return character === ']' ? depth - step : depth;
}

/** Escapes, code spans, and autolinks hide brackets from the balancing scanner. */
function bracketSkip(source: string, index: number): number | undefined {
  if (source[index] === '\\' && punctuation.test(source[index + step] ?? '')) {
    return index + pairLength;
  }
  if (source[index] === '`' || source[index] === '<') {
    return protectedAt(source, index)?.end;
  }
  return undefined;
}

/** Protected inline atoms do not change a link text's bracket depth. */
function textEnd(source: string, start: number): number {
  let depth = step,
    index = start;
  while (index < source.length) {
    const skip = bracketSkip(source, index);
    if (skip !== undefined) {
      index = skip;
    } else {
      depth = bracketDepth(source[index], depth);
      if (depth === firstIndex) {
        return index;
      }
      index += step;
    }
  }
  return lastIndex;
}

function parenthesisDepth(character: string, depth: number): number {
  if (character === '(') {
    return depth + step;
  }
  return character === ')' ? depth - step : depth;
}

/** Destinations balance parentheses but never interpret escapes or allow whitespace. */
function destinationEnd(source: string, start: number): number {
  let depth = step;
  for (let index = start; index < source.length; index += step) {
    const character = source[index] ?? '';
    if (/\s/u.test(character)) {
      return lastIndex;
    }
    depth = parenthesisDepth(character, depth);
    if (depth === firstIndex) {
      return index === start ? lastIndex : index;
    }
  }
  return lastIndex;
}

/** Links and images share their printable model; links cannot nest in their text. */
function linkAt(source: string, start: number) {
  const bracket = source.startsWith('![', start) ? start + step : start;
  if (source[bracket] !== '[') {
    return undefined;
  }
  const closing = textEnd(source, bracket + step);
  if (closing < firstIndex || source[closing + step] !== '(') {
    return undefined;
  }
  const end = destinationEnd(source, closing + pairLength);
  return end < firstIndex
    ? undefined
    : {
        end: end + step,
        node: {
          children: parseInline(source.slice(bracket + step, closing), false),
          destination: source.slice(closing + pairLength, end),
          kind: 'link',
        } satisfies Inline,
      };
}

/** Finds the nearest surviving opener without requiring an ES2023 array API. */
function matchingOpener(tokens: readonly Token[], marker: string): number {
  for (let index = tokens.length - step; index >= firstIndex; index -= step) {
    const token = tokens[index];
    if (token?.kind === 'delimiter' && token.marker === marker) {
      return index;
    }
  }
  return lastIndex;
}

/** Closes the nearest matching opener, leaving intervening unmatched markers literal. */
function emphasis(
  tokens: Token[],
  marker: string,
  { before, after }: { before: string; after: string },
): void {
  const underscore = marker.startsWith('_');
  const closes = /\S/u.test(before) && !(underscore && alphanumeric.test(after));
  const opener = closes ? matchingOpener(tokens, marker) : lastIndex;
  if (opener >= firstIndex) {
    const children = materialize(tokens.splice(opener + step));
    tokens.splice(opener, step, {
      children,
      kind: 'emphasis',
      strong: marker.length === pairLength,
    });
  } else if (/\S/u.test(after) && !(underscore && alphanumeric.test(before))) {
    tokens.push({ kind: 'delimiter', marker });
  } else {
    literal(tokens, marker);
  }
}

/** A protected run is read as a whole, so an unclosed backtick run never starts at its middle. */
function protectedAt(source: string, index: number) {
  const character = source[index];
  if (character === '\\' && punctuation.test(source[index + step] ?? '')) {
    return {
      end: index + pairLength,
      node: { kind: 'text', text: source[index + step] ?? '' } satisfies Inline,
    };
  }
  if (character === '`') {
    const run = /^`+/u.exec(source.slice(index))?.[firstIndex] ?? '`';
    return (
      codeAt(source, index) ?? {
        end: index + run.length,
        node: { kind: 'text', text: run } satisfies Inline,
      }
    );
  }
  const address =
    character === '<'
      ? /^<(?:https?:\/\/|mailto:)[^\s<>]+>/u.exec(source.slice(index))?.[firstIndex]
      : undefined;
  return address === undefined
    ? undefined
    : {
        end: index + address.length,
        node: { kind: 'address', text: address.slice(step, lastIndex) } satisfies Inline,
      };
}

/** Inline atoms take precedence over delimiter matching, isolating every link's brackets. */
function atomAt(source: string, index: number, links: boolean) {
  const protectedNode = protectedAt(source, index);
  if (protectedNode !== undefined) {
    return protectedNode;
  }
  return links || source.startsWith('![', index) ? linkAt(source, index) : undefined;
}

/** Only runs of one or two identical characters can delimit emphasis. */
function delimiterAt(source: string, index: number, tokens: Token[]): number {
  const marker = /^(?:\*+|_+)/u.exec(source.slice(index))?.[firstIndex] ?? '';
  if (marker.length <= pairLength) {
    emphasis(tokens, marker, {
      after: nextAfter(source, index + marker.length),
      before: /.$/u.exec(source.slice(firstIndex, index))?.[firstIndex] ?? '',
    });
  } else {
    literal(tokens, marker);
  }
  return index + marker.length;
}

/** Adds an opaque inline construct or merges another literal fragment into the current run. */
function pushNode(tokens: Token[], node: Inline): void {
  if (node.kind === 'text') {
    literal(tokens, node.text);
  } else {
    tokens.push(node);
  }
}

/** One scanner transition always consumes an atom, a marker run, or one literal character. */
function readInline(
  source: string,
  index: number,
  { links, tokens }: { links: boolean; tokens: Token[] },
): number {
  const atom = atomAt(source, index, links);
  if (atom !== undefined) {
    pushNode(tokens, atom.node);
    return atom.end;
  }
  const character = source[index] ?? '';
  if (character === '*' || character === '_') {
    return delimiterAt(source, index, tokens);
  }
  literal(tokens, character);
  return index + step;
}

/** Reads protected constructs before links and emphasis, from left to right on one line. */
function parseInline(source: string, links = true): Inline[] {
  const tokens: Token[] = [];
  let index = firstIndex;
  while (index < source.length) {
    index = readInline(source, index, { links, tokens });
  }
  return materialize(tokens);
}

/** Reads a whole Unicode character for the underscore boundary rule. */
function nextAfter(source: string, index: number): string {
  const point = source.codePointAt(index);
  return point === undefined ? '' : String.fromCodePoint(point);
}

export { parseInline };
export type { Inline };
