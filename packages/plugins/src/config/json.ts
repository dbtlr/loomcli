/**
 * The scan of a JSON file, which accepts `//` and `/* *\/` comments and a comma after the last item
 * of an object or an array, as tsconfig reads its files. The scan judges the text alone and finds
 * where it stops being valid, because the runtimes' own `JSON.parse` messages differ and name no
 * position the same way. A text that passes comes back with every comment and trailing comma
 * blanked to spaces, so `JSON.parse` builds the value as it builds any JSON value.
 */

/** What the scan found: the text `JSON.parse` reads, or the UTF-16 offset where the text breaks. */
type Scan = { readonly json: string } | { readonly offset: number };

/** One token of the text, by the name of the group that matched it. */
type Kind = 'space' | 'comment' | 'string' | 'number' | 'literal' | 'punctuation';

/** A string's body: any character but a quote, a backslash, or a control character, or an escape. */
const stringBody = String.raw`(?:[^"\\\u0000-\u001F]|\\(?:["\\/bfnrt]|u[\dA-Fa-f]{4}))*`;

/**
 * The tokens of JSON with comments, one at a time from the index the scan reached. A block comment
 * that never closes, a string that breaks, and any other character match nothing.
 */
const tokenPattern = new RegExp(
  [
    String.raw`(?<space>[ \t\n\r]+)`,
    String.raw`(?<comment>//[^\n\r]*|/\*[\s\S]*?\*/)`,
    `(?<string>"${stringBody}")`,
    String.raw`(?<number>-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?)`,
    '(?<literal>true|false|null)',
    String.raw`(?<punctuation>[{}[\]:,])`,
  ].join('|'),
  'uy',
);

/** A string's valid start, so a string that breaks is judged at the character that breaks it. */
const stringStart = new RegExp(`"${stringBody}`, 'uy');

const kinds: readonly Kind[] = ['space', 'comment', 'string', 'number', 'literal', 'punctuation'];

/** One token: its kind, its text, and where it starts. */
interface Token {
  readonly kind: Kind;
  readonly text: string;
  readonly start: number;
}

/**
 * What the scan expects next: a value; an array's item or its close; an object's key or its close;
 * the colon after a key; what follows a value inside a container; or the end of the text.
 */
type Expect = 'value' | 'item' | 'member' | 'colon' | 'after' | 'end';

type Container = 'array' | 'object';

const closers: Readonly<Record<Container, string>> = { array: ']', object: '}' };

const noneOpen = 0;
const innermostIndex = -1;

/** Where a string that matches no token breaks: the first character its body cannot hold. */
function brokenString(text: string, index: number): number {
  stringStart.lastIndex = index;
  const [valid = ''] = stringStart.exec(text) ?? [];
  return index + valid.length;
}

/** The token at an index, or the offset where nothing matches. */
function tokenAt(text: string, index: number): Token | number {
  tokenPattern.lastIndex = index;
  const groups = tokenPattern.exec(text)?.groups;
  const kind = kinds.find((name) => groups?.[name] !== undefined);
  const matched = kind === undefined ? undefined : groups?.[kind];
  if (kind === undefined || matched === undefined) {
    return text[index] === '"' ? brokenString(text, index) : index;
  }
  return { kind, start: index, text: matched };
}

/** The scan's state: what it expects, the open containers, and the text `JSON.parse` reads. */
class Scanner {
  expect: Expect = 'value';
  readonly open: Container[] = [];
  /** The text so far, one piece per token, with comments and trailing commas blanked. */
  readonly pieces: string[] = [];
  /** The piece of the comma just read, until another token that is not space or a comment follows it. */
  comma: number | undefined;

  /** Whether the text has ended where it may. */
  get complete(): boolean {
    return this.expect === 'end';
  }

  /** Reads one token that is not space or a comment, and answers whether it may stand there. */
  read(token: Token): boolean {
    const comma = this.comma;
    this.comma = undefined;
    switch (token.text) {
      case '[':
      case '{': {
        return this.#opens(token.text);
      }
      case ']':
      case '}': {
        return this.#closes(token.text, comma);
      }
      case ',': {
        return this.#separates();
      }
      case ':': {
        return this.#follows(['colon'], 'value');
      }
      default: {
        return token.kind === 'string' && this.expect === 'member'
          ? this.#follows(['member'], 'colon')
          : this.#follows(['value', 'item'], this.#afterValue());
      }
    }
  }

  #follows(expected: readonly Expect[], next: Expect): boolean {
    if (!expected.includes(this.expect)) {
      return false;
    }
    this.expect = next;
    return true;
  }

  #afterValue(): Expect {
    return this.open.length > noneOpen ? 'after' : 'end';
  }

  #opens(text: string): boolean {
    const container = text === '[' ? 'array' : 'object';
    if (!this.#follows(['value', 'item'], container === 'array' ? 'item' : 'member')) {
      return false;
    }
    this.open.push(container);
    return true;
  }

  /** A close after a value, or right after the open or a trailing comma, which is blanked. */
  #closes(text: string, comma: number | undefined): boolean {
    const innermost = this.open.at(innermostIndex);
    if (innermost === undefined || closers[innermost] !== text) {
      return false;
    }
    if (!this.#follows(['after', 'item', 'member'], 'after')) {
      return false;
    }
    if (comma !== undefined) {
      this.pieces[comma] = ' ';
    }
    this.open.pop();
    this.expect = this.#afterValue();
    return true;
  }

  #separates(): boolean {
    const innermost = this.open.at(innermostIndex);
    if (innermost === undefined || !this.#follows(['after'], 'after')) {
      return false;
    }
    this.expect = innermost === 'array' ? 'item' : 'member';
    this.comma = this.pieces.length;
    return true;
  }
}

/**
 * Reads one token into the scan: space and a comment as pieces, a comment blanked, and any other
 * token when it may stand there. Answers whether the text is still valid.
 */
function take(scanner: Scanner, token: Token): boolean {
  if (token.kind === 'space' || token.kind === 'comment') {
    scanner.pieces.push(token.kind === 'comment' ? ' '.repeat(token.text.length) : token.text);
    return true;
  }
  if (!scanner.read(token)) {
    return false;
  }
  scanner.pieces.push(token.text);
  return true;
}

/** The text `JSON.parse` reads for a JSON file with comments, or the offset where it breaks. */
function scanJson(text: string): Scan {
  const scanner = new Scanner();
  for (let index = 0; index < text.length;) {
    const token = tokenAt(text, index);
    if (typeof token === 'number') {
      return { offset: token };
    }
    if (!take(scanner, token)) {
      return { offset: token.start };
    }
    index += token.text.length;
  }
  return scanner.complete ? { json: scanner.pieces.join('') } : { offset: text.length };
}

export { scanJson };
