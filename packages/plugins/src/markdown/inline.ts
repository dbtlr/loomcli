const notFound = -1;
const lastElementOffset = -1;
const firstElement = 0;
const indexIncrement = 1;
const delimiterDepth = 1;
const balancedDepth = 0;
const singleToken = 1;
const angleBracketWidth = 1;
const pairLength = 2;

/** Inline syntax is local to one authored line; opaque nodes isolate their delimiters. */
type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly content: string; readonly backtickLength: number }
  | { readonly kind: 'address'; readonly text: string }
  | { readonly kind: 'link'; readonly children: readonly Inline[]; readonly destination: string }
  | { readonly kind: 'image'; readonly children: readonly Inline[]; readonly destination: string }
  | { readonly kind: 'emphasis'; readonly children: readonly Inline[]; readonly strong: boolean };

interface Delimiter {
  kind: 'delimiter';
  marker: string;
}
type Token = Inline | Delimiter;
const punctuation = /^[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]$/u;
const alphanumeric = /[\p{L}\p{N}]/u;

/** Coalesces adjacent literal fragments into one text node. */
function literal(tokens: Token[], text: string): void {
  const last = tokens.at(lastElementOffset);
  if (last?.kind === 'text') {
    tokens[tokens.length - indexIncrement] = { kind: 'text', text: last.text + text };
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
  const opening = /^`+/u.exec(source.slice(start))?.[firstElement];
  if (opening === undefined) {
    return undefined;
  }
  const runs = /`+/gu;
  runs.lastIndex = start + opening.length;
  for (let next = runs.exec(source); next !== null; next = runs.exec(source)) {
    if (next[firstElement].length === opening.length) {
      const end = next.index + next[firstElement].length;
      return {
        end,
        node: {
          backtickLength: opening.length,
          content: source.slice(start + opening.length, next.index),
          kind: 'code',
        } satisfies Inline,
      };
    }
  }
  return undefined;
}

function bracketDepth(character: string | undefined, depth: number): number {
  if (character === '[') {
    return depth + delimiterDepth;
  }
  return character === ']' ? depth - delimiterDepth : depth;
}

/** Escapes, code spans, and autolinks hide brackets from the balancing scanner. */
function bracketSkip(source: string, index: number): number | undefined {
  if (source[index] === '\\' && punctuation.test(source[index + indexIncrement] ?? '')) {
    return index + pairLength;
  }
  if (source[index] === '`' || source[index] === '<') {
    return protectedAt(source, index)?.end;
  }
  return undefined;
}

/** Protected inline atoms do not change a link text's bracket depth. */
function textEnd(source: string, start: number): number {
  let depth = delimiterDepth,
    index = start;
  while (index < source.length) {
    const skip = bracketSkip(source, index);
    if (skip !== undefined) {
      index = skip;
    } else {
      depth = bracketDepth(source[index], depth);
      if (depth === balancedDepth) {
        return index;
      }
      index += indexIncrement;
    }
  }
  return notFound;
}

function parenthesisDepth(character: string, depth: number): number {
  if (character === '(') {
    return depth + delimiterDepth;
  }
  return character === ')' ? depth - delimiterDepth : depth;
}

/** Destinations balance parentheses but never interpret escapes or allow whitespace. */
function destinationEnd(source: string, start: number): number {
  let depth = delimiterDepth;
  for (let index = start; index < source.length; index += indexIncrement) {
    const character = source[index] ?? '';
    if (/\s/u.test(character)) {
      return notFound;
    }
    depth = parenthesisDepth(character, depth);
    if (depth === balancedDepth) {
      return index === start ? notFound : index;
    }
  }
  return notFound;
}

/** Links and images retain their identities; links cannot nest in their text. */
function linkAt(source: string, start: number) {
  const bracket = source.startsWith('![', start) ? start + indexIncrement : start;
  if (source[bracket] !== '[') {
    return undefined;
  }
  const closing = textEnd(source, bracket + indexIncrement);
  if (closing === notFound || source[closing + indexIncrement] !== '(') {
    return undefined;
  }
  const end = destinationEnd(source, closing + pairLength);
  return end === notFound
    ? undefined
    : {
        end: end + indexIncrement,
        node: {
          children: parseInline(source.slice(bracket + indexIncrement, closing), false),
          destination: source.slice(closing + pairLength, end),
          kind: bracket === start ? 'link' : 'image',
        } satisfies Inline,
      };
}

/** Finds the nearest surviving opener without requiring an ES2023 array API. */
function matchingOpener(tokens: readonly Token[], marker: string): number {
  for (let index = tokens.length - indexIncrement; index >= firstElement; index -= indexIncrement) {
    const token = tokens[index];
    if (token?.kind === 'delimiter' && token.marker === marker) {
      return index;
    }
  }
  return notFound;
}

/** Closes the nearest matching opener, leaving intervening unmatched markers literal. */
function emphasis(
  tokens: Token[],
  marker: string,
  { before, after }: { before: string; after: string },
): void {
  const underscore = marker.startsWith('_');
  const closes = /\S/u.test(before) && !(underscore && alphanumeric.test(after));
  const opener = closes ? matchingOpener(tokens, marker) : notFound;
  if (opener !== notFound) {
    const children = materialize(tokens.splice(opener + indexIncrement));
    tokens.splice(opener, singleToken, {
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
  if (character === '\\' && punctuation.test(source[index + indexIncrement] ?? '')) {
    return {
      end: index + pairLength,
      node: { kind: 'text', text: source[index + indexIncrement] ?? '' } satisfies Inline,
    };
  }
  if (character === '`') {
    const run = /^`+/u.exec(source.slice(index))?.[firstElement] ?? '`';
    return (
      codeAt(source, index) ?? {
        end: index + run.length,
        node: { kind: 'text', text: run } satisfies Inline,
      }
    );
  }
  const address =
    character === '<'
      ? /^<(?:https?:\/\/|mailto:)[^\s<>]+>/u.exec(source.slice(index))?.[firstElement]
      : undefined;
  return address === undefined
    ? undefined
    : {
        end: index + address.length,
        node: {
          kind: 'address',
          text: address.slice(angleBracketWidth, -angleBracketWidth),
        } satisfies Inline,
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
  const marker = /^(?:\*+|_+)/u.exec(source.slice(index))?.[firstElement] ?? '';
  if (marker.length <= pairLength) {
    emphasis(tokens, marker, {
      after: nextAfter(source, index + marker.length),
      before: /.$/u.exec(source.slice(firstElement, index))?.[firstElement] ?? '',
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
  return index + indexIncrement;
}

/** Reads protected constructs before links and emphasis, from left to right on one line. */
function parseInline(source: string, links = true): Inline[] {
  const tokens: Token[] = [];
  let index = firstElement;
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
