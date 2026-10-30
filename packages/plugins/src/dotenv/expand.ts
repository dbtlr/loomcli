/** How a value was written, which decides what the plugin does with `$` and backslashes in it. */
type ValueQuote = 'double' | 'single' | 'unquoted';

/** The value a name holds at the point a reference reads it, or `undefined` when nothing set it. */
type Lookup = (name: string) => string | undefined;

/** How a value reads its references: what a name holds, and how a default's text reads. */
interface Reading {
  readonly lookup: Lookup;
  readonly expandText: (text: string) => string;
  readonly quote: ValueQuote;
}

/** What one place in a value reads as, and how many characters of the value it consumes. */
interface Step {
  readonly text: string;
  readonly width: number;
}

const none = 0;
const one = 1;
const afterDollar = 1;
const afterBrace = 2;
const escapeWidth = 2;
const notFound = -1;

const braced = /^(?<name>[A-Za-z0-9_]+)(?::-(?<fallback>[\s\S]*))?$/u;
const bareName = /^[A-Za-z0-9_]+/u;

const doubleQuoteEscapes: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['"', '"'],
  ['\\', '\\'],
]);

/** How one place before the closing brace moves the nesting depth, and how wide it is. */
function braceStep(text: string, offset: number) {
  if (text.startsWith(String.raw`\$`, offset)) {
    return { delta: none, width: escapeWidth };
  }
  if (text.startsWith('${', offset)) {
    return { delta: one, width: afterBrace };
  }
  return { delta: text.charAt(offset) === '}' ? -one : none, width: 1 };
}

/** The index of the brace that closes the `${` before `from`, matching nested `${`, or -1. */
function closingBrace(text: string, from: number): number {
  let depth = 1;
  for (let offset = from; offset < text.length;) {
    const step = braceStep(text, offset);
    depth += step.delta;
    if (depth === none) {
      return offset;
    }
    offset += step.width;
  }
  return notFound;
}

/** A `$NAME` at `offset`, or `undefined` when no name follows the dollar. */
function bareReference(text: string, offset: number, lookup: Lookup): Step | undefined {
  const name = bareName.exec(text.slice(offset + afterDollar))?.at(none);
  return name === undefined
    ? undefined
    : { text: lookup(name) ?? '', width: afterDollar + name.length };
}

/** A `${` construct read as its own text, through its closing brace or the end of the value. */
function literalConstruct(text: string, offset: number, close: number): Step {
  const end = close === notFound ? text.length : close + one;
  return { text: text.slice(offset, end), width: end - offset };
}

/**
 * A `${NAME}` or `${NAME:-default}` at `offset`. A `${` whose inside is neither, or that never
 * closes, reads as its own text through its closing brace or the end of the value, so no reference
 * inside it expands, as Bun reads it.
 */
function bracedReference(text: string, offset: number, reading: Reading): Step {
  const { expandText, lookup } = reading;
  const inside = offset + afterBrace;
  const close = closingBrace(text, inside);
  const groups = close === notFound ? undefined : braced.exec(text.slice(inside, close))?.groups;
  if (groups?.name === undefined) {
    return literalConstruct(text, offset, close);
  }
  const fallback = groups.fallback;
  const found = lookup(groups.name);
  const replacement = found ?? (fallback === undefined ? '' : expandText(fallback));
  return { text: replacement, width: close + afterDollar - offset };
}

/** A backslash that escapes the character after it, or `undefined` when it is a plain backslash. */
function escape(text: string, offset: number, quote: ValueQuote): Step | undefined {
  const following = text.charAt(offset + afterDollar);
  const decoded = following === '$' ? '$' : undefined;
  const replacement =
    decoded ?? (quote === 'double' ? doubleQuoteEscapes.get(following) : undefined);
  return replacement === undefined ? undefined : { text: replacement, width: escapeWidth };
}

/** A reference or an escape at `offset`, or `undefined` when the character reads as itself. */
function specialAt(text: string, offset: number, reading: Reading): Step | undefined {
  const character = text.charAt(offset);
  if (character === '\\') {
    return escape(text, offset, reading.quote);
  }
  if (character !== '$') {
    return undefined;
  }
  return text.charAt(offset + afterDollar) === '{'
    ? bracedReference(text, offset, reading)
    : bareReference(text, offset, reading.lookup);
}

/**
 * A value's text as the plugin reads it: `\$` reads as a dollar, a double-quoted value decodes its
 * escapes, and `$NAME`, `${NAME}`, and `${NAME:-default}` read what `lookup` gives their name. A
 * single-quoted value is literal. An expanded value is never scanned again.
 */
function expandValue(text: string, quote: ValueQuote, lookup: Lookup): string {
  if (quote === 'single') {
    return text;
  }
  const reading: Reading = {
    expandText: (inner) => expandValue(inner, quote, lookup),
    lookup,
    quote,
  };
  let result = '';
  for (let offset = none; offset < text.length;) {
    const step = specialAt(text, offset, reading) ?? { text: text.charAt(offset), width: one };
    result += step.text;
    offset += step.width;
  }
  return result;
}

export { expandValue };
export type { Lookup, ValueQuote };
