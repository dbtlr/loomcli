import { glyphForms } from './glyphs.generated.js';
import { applyOperations, emptyAttributes } from './style-state.js';
import type { Attributes, Palette } from './style-state.js';
import { close, escape, headerEnd, isColorName, modifiers, open, tokens } from './style.js';
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
  | { kind: 'pad'; padding: Padding };
type Frame = { kind: 'style'; previous: StyleScope } | { kind: 'pad' };

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
  if (value.length === 2 && value[0] === 'ansi256' && isByte(value[1])) {
    return ['ansi256', value[1]];
  }
  if (
    value.length === 4 &&
    value[0] === 'rgb' &&
    isByte(value[1]) &&
    isByte(value[2]) &&
    isByte(value[3])
  ) {
    return ['rgb', value[1], value[2], value[3]];
  }
  return undefined;
}
function operation(value: unknown, names: ReadonlySet<string>): Operation | undefined {
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
  if (value[0] === 'token' && typeof value[1] === 'string' && names.has(value[1])) {
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
function parseHeader(text: string, names: ReadonlySet<string>): Header | undefined {
  let value: unknown = undefined;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
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

/** Decodes framing once. Rejected headers are opaque, and nesting uses an explicit stack. */
function parseText(input: string, palette: Palette, mainGlyphs: boolean): ParsedText {
  const pieces: string[] = [];
  const scopes: StyleScope[] = [];
  const boundaries = new Map<number, Boundary[]>();
  const stack: Frame[] = [];
  const names = new Set<string>([...tokens, ...palette.keys()]);
  const root: StyleScope = { attributes: emptyAttributes, operations: [], parent: undefined };
  let active = root;
  function append(text: string): void {
    pieces.push(text);
    // Positions are UTF-16 offsets, including both units of surrogate pairs.
    // oxlint-disable-next-line typescript/prefer-for-of
    for (let index = 0; index < text.length; index += 1) {
      scopes.push(active);
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
  function endFrame(): void {
    const ended = stack.pop();
    if (ended?.kind === 'style') {
      active = ended.previous;
    } else if (ended?.kind === 'pad') {
      boundary({ kind: 'close' });
    }
  }
  for (let cursor = 0; cursor < input.length;) {
    const character = input[cursor];
    if (character === open) {
      const end = input.indexOf(headerEnd, cursor + 1);
      const candidate = end === -1 ? undefined : parseHeader(input.slice(cursor + 1, end), names);
      if (candidate === undefined || (candidate.kind === 'glyph' && input[end + 1] !== close)) {
        const until = end === -1 ? input.length : end + 1;
        append(input.slice(cursor, until));
        cursor = until;
        continue;
      }
      cursor = end + 1;
      if (candidate.kind === 'glyph') {
        append(glyphForms[candidate.name][mainGlyphs ? 0 : 1]);
        cursor += 1;
      } else if (candidate.kind === 'style') {
        stack.push({ kind: 'style', previous: active });
        active = {
          attributes: applyOperations(active.attributes, candidate.operations, palette),
          operations: candidate.operations,
          parent: active,
        };
      } else {
        stack.push({ kind: 'pad' });
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
      endFrame();
      cursor += 1;
      continue;
    }
    if (character === escape && /^E00[0-3]$/u.test(input.slice(cursor + 1, cursor + 5))) {
      const digits = input.slice(cursor + 1, cursor + 5);
      append(String.fromCharCode(Number.parseInt(digits, 16)));
      cursor += 5;
      continue;
    }
    append(character ?? '');
    cursor += 1;
  }
  while (stack.length > 0) {
    endFrame();
  }
  return { boundaries, palette, root, scopes, text: pieces.join('') };
}

export type { Alignment, Boundary, Padding, ParsedText, StyleScope };
export { parseText };
