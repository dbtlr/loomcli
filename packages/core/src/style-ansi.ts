import type { Capabilities } from './rendering.js';
import { applyOperations, emptyAttributes } from './style-state.js';
import type { Attributes, Palette } from './style-state.js';
import type { Boundary, ParsedText, StyleScope } from './style-wire.js';
import { colors, isColorName } from './style.js';
import type { Color, Modifier } from './style.js';

interface TextUnit {
  kind: 'text' | 'control' | 'hyperlink';
  text: string;
  attributes: Attributes;
}
type Unit = TextUnit | Boundary;
interface AnsiCommand {
  end: number;
  kind: 'sgr' | 'osc' | 'control' | 'incomplete';
  body: string;
}

/** Control strings are opaque through their terminator; payload bytes are never rescanned. */
function controlString(text: string, start: number, osc: boolean): AnsiCommand {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text.charCodeAt(cursor);
    if ((osc && character === 7) || character === 156) {
      return { body: text.slice(start, cursor), end: cursor + 1, kind: osc ? 'osc' : 'control' };
    }
    if (character === 27 && text[cursor + 1] === '\\') {
      return { body: text.slice(start, cursor), end: cursor + 2, kind: osc ? 'osc' : 'control' };
    }
  }
  return { body: '', end: text.length, kind: 'incomplete' };
}
function csi(text: string, start: number): AnsiCommand {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text.charCodeAt(cursor);
    if (character >= 64 && character <= 126) {
      return {
        body: text.slice(start, cursor),
        end: cursor + 1,
        kind: character === 109 ? 'sgr' : 'control',
      };
    }
    if (character < 32 || character > 63) {
      return { body: '', end: cursor, kind: 'incomplete' };
    }
  }
  return { body: '', end: text.length, kind: 'incomplete' };
}
function command(text: string, cursor: number): AnsiCommand | undefined {
  const code = text.charCodeAt(cursor);
  if (code === 27) {
    const next = text[cursor + 1];
    if (next === '[') {
      return csi(text, cursor + 2);
    }
    if (next === ']') {
      return controlString(text, cursor + 2, true);
    }
    if (next === 'P' || next === 'X' || next === '^' || next === '_') {
      return controlString(text, cursor + 2, false);
    }
    for (let end = cursor + 1; end < text.length; end += 1) {
      const value = text.charCodeAt(end);
      if (value >= 48 && value <= 126) {
        return { body: '', end: end + 1, kind: 'control' };
      }
      if (value < 32 || value > 47) {
        return { body: '', end, kind: 'incomplete' };
      }
    }
    return { body: '', end: text.length, kind: 'incomplete' };
  }
  if (code === 155) {
    return csi(text, cursor + 1);
  }
  if (code === 157) {
    return controlString(text, cursor + 1, true);
  }
  if (code === 144 || code === 152 || code === 158 || code === 159) {
    return controlString(text, cursor + 1, false);
  }
  if (
    (code < 32 && code !== 9 && code !== 10 && !(code === 13 && text[cursor + 1] === '\n')) ||
    (code >= 127 && code <= 159)
  ) {
    return { body: '', end: cursor + 1, kind: 'control' };
  }
  return undefined;
}
const enableModifiers = new Map<number, Modifier>([
  [1, 'bold'],
  [2, 'faint'],
  [3, 'italic'],
  [4, 'underline'],
  [7, 'inverse'],
  [8, 'hidden'],
  [9, 'strikethrough'],
  [53, 'overline'],
]);
const disableModifiers = new Map<number, readonly Modifier[]>([
  [22, ['bold', 'faint']],
  [23, ['italic']],
  [24, ['underline']],
  [27, ['inverse']],
  [28, ['hidden']],
  [29, ['strikethrough']],
  [55, ['overline']],
]);

/** Raw ANSI overrides participate in Loom's scoped attributes, and resets restore their base. */
class AnsiState {
  base = emptyAttributes;
  foreground: Color | undefined;
  background: Color | undefined;
  readonly modifiers = new Map<Modifier, boolean>();

  private scope: StyleScope;
  private readonly saved = new WeakMap<StyleScope, Attributes>();

  private readonly palette: Palette;

  constructor(root: StyleScope, palette: Palette) {
    this.palette = palette;
    this.scope = root;
    this.saved.set(root, emptyAttributes);
  }

  sync(scope: StyleScope): void {
    if (scope === this.scope) {
      return;
    }
    this.saved.set(this.scope, this.attributes());
    const entering: StyleScope[] = [];
    let ancestor: StyleScope | undefined = scope;
    while (ancestor && !this.saved.has(ancestor)) {
      entering.push(ancestor);
      ancestor = ancestor.parent;
    }
    let effective = ancestor ? (this.saved.get(ancestor) ?? emptyAttributes) : emptyAttributes;
    for (let index = entering.length - 1; index >= 0; index -= 1) {
      const next = entering[index];
      if (next) {
        effective = applyOperations(effective, next.operations, this.palette);
        this.saved.set(next, effective);
      }
    }
    this.scope = scope;
    this.base = scope.attributes;
    this.foreground = effective.foreground;
    this.background = effective.background;
    this.modifiers.clear();
    for (const key of this.base.modifiers) {
      this.modifiers.set(key, false);
    }
    for (const key of effective.modifiers) {
      this.modifiers.set(key, true);
    }
  }
  attributes(): Attributes {
    if (
      this.foreground === undefined &&
      this.background === undefined &&
      this.modifiers.size === 0
    ) {
      return this.base;
    }
    const modifiers = new Set(this.base.modifiers);
    for (const [name, on] of this.modifiers) {
      if (on) {
        modifiers.add(name);
      } else {
        modifiers.delete(name);
      }
    }
    return {
      background: this.background ?? this.base.background,
      foreground: this.foreground ?? this.base.foreground,
      modifiers,
    };
  }
  sgr(body: string): string {
    if (!/^[\d;:]*$/u.test(body)) {
      return '';
    }
    const parameters = body.split(';');
    const unknown: string[] = [];
    for (let index = 0; index < parameters.length; index += 1) {
      const raw = parameters[index] ?? '';
      const colon = raw.split(':');
      const code = Number(colon[0]);
      if (code === 0) {
        this.foreground = undefined;
        this.background = undefined;
        this.modifiers.clear();
        continue;
      }
      if (code === 39 || code === 49) {
        this[code === 39 ? 'foreground' : 'background'] = undefined;
        continue;
      }
      const enabled = enableModifiers.get(code);
      if (enabled) {
        this.modifiers.set(enabled, true);
        continue;
      }
      const disabled = disableModifiers.get(code);
      if (disabled) {
        for (const name of disabled) {
          this.modifiers.delete(name);
        }
        continue;
      }
      const background = (code >= 40 && code <= 47) || (code >= 100 && code <= 107) || code === 48;
      const paletteIndex =
        code >= 30 && code <= 47
          ? code - (background ? 40 : 30)
          : code - (background ? 100 : 90) + 8;
      if (
        (code >= 30 && code <= 37) ||
        (code >= 40 && code <= 47) ||
        (code >= 90 && code <= 97) ||
        (code >= 100 && code <= 107)
      ) {
        const name = Object.keys(colors).find(
          (key) => isColorName(key) && colors[key] === paletteIndex,
        );
        if (isColorName(name)) {
          this[background ? 'background' : 'foreground'] = name;
        }
        continue;
      }
      if (code === 38 || code === 48) {
        const mode = Number(colon.length > 1 ? colon[1] : parameters[index + 1]);
        const count = mode === 2 ? 3 : mode === 5 ? 1 : 0;
        const values =
          colon.length > 1
            ? colon.slice(colon.length - count).map(Number)
            : parameters.slice(index + 2, index + 2 + count).map(Number);
        if (colon.length === 1) {
          index += 1 + count;
        }
        if (
          values.length !== count ||
          !values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
        ) {
          continue;
        }
        const [red, green, blue] = values;
        const color: Color | undefined =
          mode === 5 && red !== undefined
            ? ['ansi256', red]
            : mode === 2 && red !== undefined && green !== undefined && blue !== undefined
              ? ['rgb', red, green, blue]
              : undefined;
        if (color !== undefined) {
          this[background ? 'background' : 'foreground'] = color;
        }
        continue;
      }
      unknown.push(raw);
    }
    return unknown.length ? `\u001b[${unknown.join(';')}m` : '';
  }
}

/** Scans the full decoded stream before emitting padding or generated terminal bytes. */
function scanAnsi(parsed: ParsedText, caps: Capabilities): Unit[] {
  const result: Unit[] = [];
  const state = new AnsiState(parsed.root, parsed.palette);
  let hyperlinkOpen = false;
  function boundaries(start: number, end: number): void {
    for (let cursor = start; cursor < end; cursor += 1) {
      for (const boundary of parsed.boundaries.get(cursor) ?? []) {
        if (boundary.kind === 'open') {
          state.sync(boundary.scope);
          result.push({ ...boundary, attributes: state.attributes() });
        } else {
          result.push(boundary);
        }
      }
    }
  }
  for (let cursor = 0; cursor < parsed.text.length;) {
    state.sync(parsed.scopes[cursor] ?? parsed.root);
    const found = command(parsed.text, cursor);
    if (found) {
      boundaries(cursor, found.end);
      state.sync(parsed.scopes[found.end - 1] ?? parsed.root);
      const raw = parsed.text.slice(cursor, found.end);
      if (found.kind === 'sgr') {
        const unknown = state.sgr(found.body);
        if (caps.terminalControls && unknown) {
          result.push({ attributes: state.attributes(), kind: 'control', text: unknown });
        }
      } else if (found.kind === 'osc' && found.body.startsWith('8;')) {
        const separator = found.body.indexOf(';', 2);
        if (separator !== -1 && caps.hyperlinks) {
          hyperlinkOpen = found.body.slice(separator + 1) !== '';
          result.push({ attributes: state.attributes(), kind: 'hyperlink', text: raw });
        }
      } else if (found.kind !== 'incomplete' && caps.terminalControls) {
        result.push({ attributes: state.attributes(), kind: 'control', text: raw });
      }
      cursor = found.end;
      continue;
    }
    boundaries(cursor, cursor + 1);
    state.sync(parsed.scopes[cursor] ?? parsed.root);
    const character = parsed.text[cursor] ?? '';
    // The LF owns the complete line-ending atom, so deferred spaces cannot split CRLF.
    if (!(character === '\r' && parsed.text[cursor + 1] === '\n')) {
      const text = character === '\n' && parsed.text[cursor - 1] === '\r' ? '\r\n' : character;
      result.push({ attributes: state.attributes(), kind: 'text', text });
    }
    cursor += 1;
  }
  boundaries(parsed.text.length, parsed.text.length + 1);
  if (hyperlinkOpen) {
    result.push({ attributes: emptyAttributes, kind: 'hyperlink', text: '\u001b]8;;\u001b\\' });
  }
  return result;
}

export type { TextUnit, Unit };
export { scanAnsi };
