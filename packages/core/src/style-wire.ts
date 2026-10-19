import { glyphForms } from './glyphs.generated.js';
import { isPlainObject } from './plain.js';
import { applyOperations, emptyAttributes } from './style-state.js';
import type { Attributes, Palette } from './style-state.js';
import {
  close,
  colorFallbacks,
  escape,
  headerEnd,
  isColorName,
  modifiers,
  open,
  tokens,
} from './style.js';
import type { Color, Operation } from './style.js';

type Alignment = 'left' | 'right' | 'center';
interface Padding {
  width: number;
  align: Alignment;
}
type Boundary =
  | { kind: 'open'; padding: Padding; attributes: Attributes; scope: StyleScope }
  | { kind: 'close' };
interface ParsedText {
  text: string;
  scopes: StyleScope[];
  root: StyleScope;
  palette: Palette;
  boundaries: Map<number, Boundary[]>;
}
interface StyleScope {
  attributes: Attributes;
  parent: StyleScope | undefined;
  operations: readonly Operation[];
}
type Header =
  | { kind: 'style'; operations: readonly Operation[] }
  | { kind: 'glyph'; name: keyof typeof glyphForms }
  | { kind: 'pad'; padding: Padding }
  | { kind: 'nowrap' };
type Frame = { kind: 'style'; previous: StyleScope } | { kind: 'pad' } | { kind: 'nowrap' };
/**
 * A style, padding, or no-wrap frame opening or closing in the input, placed before the decoded
 * character at `at`. An open keeps its header as written, and whether it starts a style scope.
 */
type FrameMark =
  | { at: number; kind: 'open'; header: string; scoped: boolean }
  | { at: number; kind: 'close' };
/**
 * Where each decoded character came from, which line breaking reads: its offset in the input, and
 * whether it is whole, inside a padding or no-wrap frame, or a glyph form or rejected header. When
 * `frames` is supplied, it records each frame the input opens and each close character it holds.
 */
interface WireTrace {
  origins: number[];
  whole: boolean[];
  frames?: FrameMark[];
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}
function color(value: unknown): Color | undefined {
  if (isColorName(value)) {
    return value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  if ((value.length === 2 || value.length === 3) && value[0] === 'ansi256' && isByte(value[1])) {
    if (value.length === 2) {
      return ['ansi256', value[1]];
    }
    if (!isPlainObject(value[2])) {
      return undefined;
    }
    try {
      return ['ansi256', value[1], colorFallbacks(value[2], false)];
    } catch {
      return undefined;
    }
  }
  if (
    (value.length === 4 || value.length === 5) &&
    value[0] === 'rgb' &&
    isByte(value[1]) &&
    isByte(value[2]) &&
    isByte(value[3])
  ) {
    if (value.length === 4) {
      return ['rgb', value[1], value[2], value[3]];
    }
    if (!isPlainObject(value[4])) {
      return undefined;
    }
    try {
      return ['rgb', value[1], value[2], value[3], colorFallbacks(value[4], true)];
    } catch {
      return undefined;
    }
  }
  return undefined;
}
/** Whether a token name is one a style header may reference. */
type TokenCheck = (name: string) => boolean;
function operation(value: unknown, names: TokenCheck): Operation | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (
    value.length === 1 &&
    (value[0] === 'reset' || value[0] === 'resetForeground' || value[0] === 'resetBackground')
  ) {
    return [value[0]];
  }
  if (value.length !== 2) {
    return undefined;
  }
  if (value[0] === 'token' && typeof value[1] === 'string' && names(value[1])) {
    return ['token', value[1]];
  }
  if (value[0] === 'modifier') {
    const modifier = modifiers.find((name) => name === value[1]);
    return modifier === undefined ? undefined : ['modifier', modifier];
  }
  if (value[0] === 'foreground' || value[0] === 'background') {
    const parsed = color(value[1]);
    return parsed === undefined ? undefined : [value[0], parsed];
  }
  return undefined;
}
function glyphName(value: unknown): value is keyof typeof glyphForms {
  return typeof value === 'string' && Object.hasOwn(glyphForms, value);
}
function parseHeader(text: string, names: TokenCheck): Header | undefined {
  let value: unknown = undefined;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 1 && value[0] === 'nowrap') {
    return { kind: 'nowrap' };
  }
  if (value.length === 2 && value[0] === 'glyph' && glyphName(value[1])) {
    return { kind: 'glyph', name: value[1] };
  }
  if (
    value.length === 3 &&
    value[0] === 'pad' &&
    typeof value[1] === 'number' &&
    Number.isSafeInteger(value[1]) &&
    value[1] >= 0 &&
    (value[2] === 'left' || value[2] === 'right' || value[2] === 'center')
  ) {
    return { kind: 'pad', padding: { align: value[2], width: value[1] } };
  }
  if (value.length !== 2 || value[0] !== 'style' || !Array.isArray(value[1])) {
    return undefined;
  }
  const operations: Operation[] = [];
  for (const item of value[1]) {
    const parsed = operation(item, names);
    if (parsed === undefined) {
      return undefined;
    }
    operations.push(parsed);
  }
  return { kind: 'style', operations };
}

/** The code units that open a frame, close one, or start an escape: where literal text may end. */
const frameBytes = new Set([open, close, escape].map((byte) => byte.charCodeAt(0)));

/**
 * Decodes framing once. Rejected headers are opaque, and nesting uses an explicit stack. A trace,
 * when supplied, records where each decoded character came from. With `anyToken`, a style header
 * may name any token, so the framing reads the same whatever palette resolves it later.
 */
function parseText(
  input: string,
  palette: Palette,
  {
    anyToken = false,
    mainGlyphs,
    trace,
  }: { anyToken?: boolean; mainGlyphs: boolean; trace?: WireTrace | undefined },
): ParsedText {
  const pieces: string[] = [];
  const scopes: StyleScope[] = [];
  const boundaries = new Map<number, Boundary[]>();
  const stack: Frame[] = [];
  const known = new Set<string>([...tokens, ...palette.keys()]);
  const names: TokenCheck = anyToken ? () => true : (name) => known.has(name);
  const root: StyleScope = { attributes: emptyAttributes, operations: [], parent: undefined };
  let active = root;
  // Frames whose body line breaking keeps whole: padding and no-wrap frames.
  let unbroken = 0;
  /**
   * Decoded text and where it came from. A literal run keeps one origin per unit and a rejected
   * header does too, though it is whole. A glyph form or an escape is one whole unit at its origin.
   */
  function append(text: string, origin: number, form: 'atom' | 'literal' | 'rejected'): void {
    pieces.push(text);
    const whole = form !== 'literal';
    // Positions are UTF-16 offsets, including both units of surrogate pairs.
    // oxlint-disable-next-line typescript/prefer-for-of
    for (let index = 0; index < text.length; index += 1) {
      scopes.push(active);
      trace?.origins.push(form === 'atom' ? origin : origin + index);
      trace?.whole.push(whole || unbroken > 0);
    }
  }
  function boundary(value: Boundary): void {
    const at = scopes.length;
    const current = boundaries.get(at);
    if (current) {
      current.push(value);
    } else {
      boundaries.set(at, [value]);
    }
  }
  function endFrame(written: boolean): void {
    if (written) {
      trace?.frames?.push({ at: scopes.length, kind: 'close' });
    }
    const ended = stack.pop();
    if (ended?.kind === 'style') {
      active = ended.previous;
    } else if (ended?.kind === 'pad') {
      unbroken -= 1;
      boundary({ kind: 'close' });
    } else if (ended?.kind === 'nowrap') {
      unbroken -= 1;
    }
  }
  for (let cursor = 0; cursor < input.length;) {
    const character = input[cursor];
    if (character === open) {
      const end = input.indexOf(headerEnd, cursor + 1);
      const candidate = end === -1 ? undefined : parseHeader(input.slice(cursor + 1, end), names);
      if (candidate === undefined || (candidate.kind === 'glyph' && input[end + 1] !== close)) {
        const until = end === -1 ? input.length : end + 1;
        append(input.slice(cursor, until), cursor, 'rejected');
        cursor = until;
        continue;
      }
      const start = cursor;
      cursor = end + 1;
      if (candidate.kind !== 'glyph') {
        trace?.frames?.push({
          at: scopes.length,
          header: input.slice(start, cursor),
          kind: 'open',
          scoped: candidate.kind === 'style',
        });
      }
      if (candidate.kind === 'glyph') {
        append(glyphForms[candidate.name][mainGlyphs ? 0 : 1], start, 'atom');
        cursor += 1;
      } else if (candidate.kind === 'nowrap') {
        stack.push({ kind: 'nowrap' });
        unbroken += 1;
      } else if (candidate.kind === 'style') {
        stack.push({ kind: 'style', previous: active });
        active = {
          attributes: applyOperations(active.attributes, candidate.operations, palette),
          operations: candidate.operations,
          parent: active,
        };
      } else {
        stack.push({ kind: 'pad' });
        unbroken += 1;
        boundary({
          attributes: active.attributes,
          kind: 'open',
          padding: candidate.padding,
          scope: active,
        });
      }
      continue;
    }
    if (character === close && stack.length > 0) {
      endFrame(true);
      cursor += 1;
      continue;
    }
    if (character === escape && /^E00[0-3]$/u.test(input.slice(cursor + 1, cursor + 5))) {
      const digits = input.slice(cursor + 1, cursor + 5);
      append(String.fromCharCode(Number.parseInt(digits, 16)), cursor, 'atom');
      cursor += 5;
      continue;
    }
    // The literal characters that follow are literal too, up to the next byte a frame may start at.
    let end = cursor + 1;
    while (end < input.length && !frameBytes.has(input.charCodeAt(end))) {
      end += 1;
    }
    append(input.slice(cursor, end), cursor, 'literal');
    cursor = end;
  }
  // The input ends every frame still open, with no close character of its own.
  while (stack.length > 0) {
    endFrame(false);
  }
  return { boundaries, palette, root, scopes, text: pieces.join('') };
}

export type { Alignment, Boundary, FrameMark, Padding, ParsedText, StyleScope, WireTrace };
export { parseText };
