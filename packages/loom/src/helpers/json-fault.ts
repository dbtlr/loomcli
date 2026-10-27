/** Where a JSON text first breaks, and what JSON needs at that point. */
interface JsonFault {
  readonly column: number;
  readonly expected: string;
  readonly line: number;
}

/** A failed scan, thrown at the offset of the first character JSON cannot accept. */
class Fault {
  readonly offset: number;
  readonly expected: string;

  constructor(offset: number, expected: string) {
    this.offset = offset;
    this.expected = expected;
  }
}

const whitespace = new Set([' ', '\t', '\n', '\r']);
const escapes = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const literals = ['true', 'false', 'null'];

/**
 * A scan of a JSON text under RFC 8259 that stops at its first fault. It reads only far enough to
 * find where the text breaks, so it builds no value.
 */
class Scanner {
  private index = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  /** Scans the whole text: one value, with only whitespace around it. */
  document() {
    this.value();
    this.skipWhitespace();
    if (this.index < this.text.length) {
      throw new Fault(this.index, 'the end of the file');
    }
  }

  private peek() {
    return this.text[this.index];
  }

  private skipWhitespace() {
    while (whitespace.has(this.peek() ?? '')) {
      this.index += 1;
    }
  }

  private value() {
    this.skipWhitespace();
    const character = this.peek();
    if (character === '{') {
      this.object();
    } else if (character === '[') {
      this.array();
    } else if (character === '"') {
      this.string();
    } else if (character === '-' || /\d/u.test(character ?? '')) {
      this.number();
    } else {
      const literal = literals.find((word) => this.text.startsWith(word, this.index));
      if (literal === undefined) {
        throw new Fault(this.index, 'a value');
      }
      this.index += literal.length;
    }
  }

  private object() {
    this.index += 1;
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.index += 1;
      return;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') {
        throw new Fault(this.index, 'a property name in double quotes');
      }
      this.string();
      this.skipWhitespace();
      if (this.peek() !== ':') {
        throw new Fault(this.index, 'a colon');
      }
      this.index += 1;
      this.value();
      if (this.closes('}')) {
        return;
      }
    }
  }

  private array() {
    this.index += 1;
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.index += 1;
      return;
    }
    for (;;) {
      this.value();
      if (this.closes(']')) {
        return;
      }
    }
  }

  /** Reads the comma before another member, or the bracket that closes the container. */
  private closes(bracket: '}' | ']') {
    this.skipWhitespace();
    const character = this.peek();
    this.index += 1;
    if (character === bracket) {
      return true;
    }
    if (character !== ',') {
      throw new Fault(this.index - 1, `a comma or ${bracket}`);
    }
    return false;
  }

  private string() {
    this.index += 1;
    for (;;) {
      const character = this.peek();
      if (character === undefined) {
        throw new Fault(this.index, 'a closing quote');
      }
      if (character === '"') {
        this.index += 1;
        return;
      }
      if (character === '\\') {
        this.escape();
      } else if ((character.codePointAt(0) ?? 0) < 0x20) {
        throw new Fault(this.index, String.raw`a closing quote or an escape such as \n`);
      } else {
        this.index += 1;
      }
    }
  }

  private escape() {
    const next = this.text[this.index + 1] ?? '';
    if (escapes.has(next)) {
      this.index += 2;
    } else if (
      next === 'u' &&
      /^[\dA-Fa-f]{4}$/u.test(this.text.slice(this.index + 2, this.index + 6))
    ) {
      this.index += 6;
    } else {
      throw new Fault(this.index, String.raw`an escape such as \n or \t`);
    }
  }

  private number() {
    if (this.peek() === '-') {
      this.index += 1;
    }
    if (this.peek() === '0') {
      this.index += 1;
    } else {
      this.digits();
    }
    if (this.peek() === '.') {
      this.index += 1;
      this.digits();
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.index += 1;
      if (this.peek() === '+' || this.peek() === '-') {
        this.index += 1;
      }
      this.digits();
    }
  }

  /** Reads one or more digits. */
  private digits() {
    if (!/\d/u.test(this.peek() ?? '')) {
      throw new Fault(this.index, 'a digit');
    }
    while (/\d/u.test(this.peek() ?? '')) {
      this.index += 1;
    }
  }
}

/**
 * Where a JSON text first breaks, as the line and column an editor shows, both counted from 1, with
 * the column in characters; `undefined` for valid JSON. The runtime's own parse error is not
 * portable, because Bun's message names no position, so a reader that reports the place finds it
 * here.
 */
function jsonFault(text: string): JsonFault | undefined {
  try {
    new Scanner(text).document();
    return undefined;
  } catch (error) {
    if (!(error instanceof Fault)) {
      throw error;
    }
    const before = text.slice(0, error.offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    return {
      column: (before.slice(lineStart).match(/./gsu)?.length ?? 0) + 1,
      expected: error.expected,
      line: (before.match(/\n/gu)?.length ?? 0) + 1,
    };
  }
}

export { jsonFault };
export type { JsonFault };
