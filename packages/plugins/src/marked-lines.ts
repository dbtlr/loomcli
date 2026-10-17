/**
 * The framing characters of marked text, spelled once as the style wire contract defines them:
 * a frame is the open character, a JSON header, the header end, a body, and the close character.
 */
const OPEN = '';
const HEADER_END = '';
const CLOSE = '';
const ESCAPE = '';
const GLYPH_HEADER = `${OPEN}["glyph"`;

const ESCAPE_LENGTH = 5;
const FIRST = 0;
const NEXT = 1;
const NOT_FOUND = -1;

/** One unit of marked text: a frame that stays open, a break, a close, or text taken as it is. */
interface Token {
  readonly kind: 'break' | 'close' | 'frame' | 'text';
  readonly text: string;
}

/** Whether a header's JSON names a frame kind, which is what makes the open character a frame. */
function isFrameHeader(header: string): boolean {
  try {
    const parsed: unknown = JSON.parse(header);
    return (
      Array.isArray(parsed) &&
      ['glyph', 'nowrap', 'pad', 'style'].includes(String(parsed.at(FIRST)))
    );
  } catch {
    return false;
  }
}

/**
 * The unit that starts at an open character. A rejected header is literal text through its header
 * end, as the resolver reads it, and a glyph frame has no body, so it takes its close with it.
 */
function frameAt(text: string, cursor: number): Token {
  const end = text.indexOf(HEADER_END, cursor + NEXT);
  if (end === NOT_FOUND) {
    return { kind: 'text', text: text.slice(cursor) };
  }
  const header = text.slice(cursor, end + NEXT);
  if (!isFrameHeader(header.slice(NEXT, -NEXT))) {
    return { kind: 'text', text: header };
  }
  if (header.startsWith(GLYPH_HEADER)) {
    return { kind: 'text', text: text[end + NEXT] === CLOSE ? `${header}${CLOSE}` : header };
  }
  return { kind: 'frame', text: header };
}

/** The unit that starts at a cursor. */
function tokenAt(text: string, cursor: number): Token {
  const character = text[cursor] ?? '';
  if (character === OPEN) {
    return frameAt(text, cursor);
  }
  if (character === ESCAPE) {
    return { kind: 'text', text: text.slice(cursor, cursor + ESCAPE_LENGTH) };
  }
  if (character === CLOSE) {
    return { kind: 'close', text: character };
  }
  return { kind: character === '\n' ? 'break' : 'text', text: character };
}

/** A finished line: its CR dropped, and every frame still open closed. */
function finished(line: string, open: readonly string[]): string {
  const content = line.endsWith('\r') ? line.slice(FIRST, -NEXT) : line;
  return `${content}${CLOSE.repeat(open.length)}`;
}

/**
 * Marked text cut at its line breaks into lines that each stand alone. A style, padding, or
 * no-wrap frame that spans a break closes at the end of its line and reopens at the start of the
 * next, so a caller can place each line beside other text without the frame leaking onto it. A
 * CRLF ends a line as an LF does. Text without a break comes back as one line, unchanged.
 */
function splitMarkedLines(text: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  const add = (token: Token): void => {
    if (token.kind === 'break') {
      lines.push(finished(current, open));
      current = open.join('');
      return;
    }
    if (token.kind === 'frame') {
      open.push(token.text);
    } else if (token.kind === 'close') {
      open.pop();
    }
    current += token.text;
  };
  for (let cursor = FIRST; cursor < text.length;) {
    const token = tokenAt(text, cursor);
    cursor += token.text.length;
    add(token);
  }
  lines.push(current);
  return lines;
}

export { splitMarkedLines };
