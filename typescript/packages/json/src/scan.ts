/**
 * The scan of a JSON text, the one scanner behind every JSON file Loom reads. In `strict` mode it
 * accepts RFC 8259 JSON, as a manifest is. In `comments` mode it also accepts `//` and `/* *\/`
 * comments and a comma after the last item of an object or an array, as tsconfig reads its files.
 * The scan judges the text alone and finds where it stops being valid, because the runtimes' own
 * `JSON.parse` messages differ and name no position the same way. A text that passes comes back
 * with every comment and trailing comma blanked to spaces, so `JSON.parse` builds the value as it
 * builds any JSON value.
 */

/** What a scan accepts: strict JSON, or JSON with comments and trailing commas. */
type JsonMode = 'strict' | 'comments';

/**
 * What the scan found: the text `JSON.parse` reads, or the UTF-16 offset where the text breaks
 * with a description of what JSON needs there.
 */
type Scan = { readonly json: string } | { readonly offset: number; readonly expected: string };

/** One token of the text, by the name of the group that matched it. */
type Kind = 'space' | 'comment' | 'string' | 'number' | 'literal' | 'punctuation';

/** A string's body: any character but a quote, a backslash, or a control character, or an escape. */
const stringBody = String.raw`(?:[^"\\\u0000-\u001F]|\\(?:["\\/bfnrt]|u[\dA-Fa-f]{4}))*`;

/**
 * The tokens of JSON, one at a time from the index the scan reached, with comments in the pattern
 * of the `comments` mode only. A block comment that never closes, a string that breaks, and any
 * other character match nothing.
 */
function tokenPatternOf(comments: boolean): RegExp {
  return new RegExp(
    [
      String.raw`(?<space>[ \t\n\r]+)`,
      ...(comments ? [String.raw`(?<comment>//[^\n\r]*|/\*[\s\S]*?\*/)`] : []),
      `(?<string>"${stringBody}")`,
      String.raw`(?<number>-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[Ee][+-]?\d+)?)`,
      '(?<literal>true|false|null)',
      String.raw`(?<punctuation>[{}[\]:,])`,
    ].join('|'),
    'uy',
  );
}

const tokenPatterns: Readonly<Record<JsonMode, RegExp>> = {
  comments: tokenPatternOf(true),
  strict: tokenPatternOf(false),
};

/** A string's valid start, so a string that breaks is judged at the character that breaks it. */
const stringStart = new RegExp(`"${stringBody}`, 'uy');

const kinds: readonly Kind[] = ['space', 'comment', 'string', 'number', 'literal', 'punctuation'];

/** One token: its kind, its text, and where it starts. */
interface Token {
  readonly kind: Kind;
  readonly text: string;
  readonly start: number;
}

/** Where the text breaks, with what JSON needs there when the text alone decides it. */
interface Break {
  readonly offset: number;
  readonly expected?: string;
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
const pastCharacter = 1;

/** Where a string that matches no token breaks, and what the string needs there. */
function brokenString(text: string, index: number): Break {
  stringStart.lastIndex = index;
  const [valid = ''] = stringStart.exec(text) ?? [];
  const offset = index + valid.length;
  const character = text[offset];
  if (character === undefined) {
    return { expected: 'a closing quote', offset };
  }
  if (character === '\\') {
    return { expected: String.raw`an escape such as \n or \t`, offset };
  }
  return character < ' '
    ? { expected: String.raw`a closing quote or an escape such as \n`, offset }
    : { offset };
}

/** The token at an index, or `undefined` where nothing matches. */
function tokenAt(text: string, index: number, mode: JsonMode): Token | undefined {
  const pattern = tokenPatterns[mode];
  pattern.lastIndex = index;
  const groups = pattern.exec(text)?.groups;
  const kind = kinds.find((name) => groups?.[name] !== undefined);
  const matched = kind === undefined ? undefined : groups?.[kind];
  return kind === undefined || matched === undefined
    ? undefined
    : { kind, start: index, text: matched };
}

/** What a number may continue with when its token ends: a point or an exponent, or an exponent. */
const pointOrExponent = /\.|[Ee][+-]?/uy;
const exponentOnly = /[Ee][+-]?/uy;

/**
 * Where a strict scan finds a number cut short: a point or an exponent with no digit after it. The
 * token holds the longest valid number, so the digit is missing where the next character starts one.
 */
function cutShortNumber(text: string, token: Token): Break | undefined {
  const end = token.start + token.text.length;
  if (/e/iu.test(token.text)) {
    return undefined;
  }
  const pattern = token.text.includes('.') ? exponentOnly : pointOrExponent;
  pattern.lastIndex = end;
  const [started] = pattern.exec(text) ?? [];
  return started === undefined ? undefined : { expected: 'a digit', offset: end + started.length };
}

/** The scan's state: what it expects, the open containers, and the text `JSON.parse` reads. */
class Scanner {
  expect: Expect = 'value';
  readonly open: Container[] = [];
  /** The text so far, one piece per token, with comments and trailing commas blanked. */
  readonly pieces: string[] = [];
  /** The piece of the comma just read, until another token that is not space or a comment follows it. */
  comma: number | undefined;
  readonly mode: JsonMode;

  constructor(mode: JsonMode) {
    this.mode = mode;
  }

  /** Whether the text has ended where it may. */
  get complete(): boolean {
    return this.expect === 'end';
  }

  /** Whether a value may stand at the scan's place: the text's value or an array's item. */
  get takesValue(): boolean {
    return this.expect === 'value' || this.expect === 'item';
  }

  /** Whether a string may stand at the scan's place: a value, an item, or an object's key. */
  get takesString(): boolean {
    return this.takesValue || this.expect === 'member';
  }

  /** What JSON needs at the scan's place. */
  get needed(): string {
    switch (this.expect) {
      case 'value':
      case 'item': {
        return 'a value';
      }
      case 'member': {
        return 'a property name in double quotes';
      }
      case 'colon': {
        return 'a colon';
      }
      case 'after': {
        const innermost = this.open.at(innermostIndex);
        return `a comma or ${innermost === undefined ? '' : closers[innermost]}`;
      }
      default: {
        return 'the end of the file';
      }
    }
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

  /** A close after a value, or right after the open or, with trailing commas allowed, a comma. */
  #closes(text: string, comma: number | undefined): boolean {
    const innermost = this.open.at(innermostIndex);
    const trailing = comma !== undefined && this.mode === 'strict';
    if (
      innermost === undefined ||
      closers[innermost] !== text ||
      trailing ||
      !this.#follows(['after', 'item', 'member'], 'after')
    ) {
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

/**
 * Where the text breaks at an index no token matches. A comments scan judges a broken string inside
 * it and any other character where it stands. A strict scan reads as RFC 8259's grammar does: it
 * enters a string or a number only where one may stand, so it judges a broken string inside it and
 * finds a sign's missing digit after it there, and elsewhere names what the scan needs at the index.
 */
function unmatched(scanner: Scanner, text: string, index: number): Break {
  const character = text[index];
  const strict = scanner.mode === 'strict';
  if (character === '"' && (!strict || scanner.takesString)) {
    return brokenString(text, index);
  }
  return strict && character === '-' && scanner.takesValue
    ? { expected: 'a digit', offset: index + pastCharacter }
    : { offset: index };
}

/** Where a token that matched breaks the scan, or `undefined` when the token may stand. */
function readToken(scanner: Scanner, text: string, token: Token): Break | undefined {
  if (!take(scanner, token)) {
    return { expected: scanner.needed, offset: token.start };
  }
  return scanner.mode === 'strict' && token.kind === 'number'
    ? cutShortNumber(text, token)
    : undefined;
}

/** The failed scan of a break, described by what JSON needs there when the break does not say. */
function faultOf(scanner: Scanner, broken: Break): Scan {
  return { expected: broken.expected ?? scanner.needed, offset: broken.offset };
}

/**
 * The text `JSON.parse` reads for a JSON text, or the offset where it breaks and what JSON needs
 * there.
 */
function scanJson(text: string, mode: JsonMode): Scan {
  const scanner = new Scanner(mode);
  for (let index = 0; index < text.length;) {
    const token = tokenAt(text, index, mode);
    if (token === undefined) {
      return faultOf(scanner, unmatched(scanner, text, index));
    }
    const broken = readToken(scanner, text, token);
    if (broken !== undefined) {
      return faultOf(scanner, broken);
    }
    index += token.text.length;
  }
  return scanner.complete
    ? { json: scanner.pieces.join('') }
    : { expected: scanner.needed, offset: text.length };
}

export { scanJson };
export type { JsonMode, Scan };
