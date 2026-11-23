import type { Capabilities } from './rendering.js';
import { colors } from './style.js';
import type { Color, Modifier, Operation } from './style.js';

interface Attributes {
  foreground: Color | undefined;
  background: Color | undefined;
  modifiers: ReadonlySet<Modifier>;
}
type Palette = ReadonlyMap<string, readonly Operation[]>;
const emptyAttributes: Attributes = {
  background: undefined,
  foreground: undefined,
  modifiers: new Set(),
};

function applyOperations(
  base: Attributes,
  operations: readonly Operation[],
  palette: Palette,
): Attributes {
  let foreground = base.foreground;
  let background = base.background;
  let active = new Set(base.modifiers);
  const expanded = operations.flatMap((operation) =>
    operation[0] === 'token' ? (palette.get(operation[1]) ?? []) : [operation],
  );
  for (const operation of expanded) {
    switch (operation[0]) {
      case 'foreground': {
        foreground = operation[1];
        break;
      }
      case 'background': {
        background = operation[1];
        break;
      }
      case 'modifier': {
        active.add(operation[1]);
        break;
      }
      case 'reset': {
        foreground = undefined;
        background = undefined;
        active = new Set();
        break;
      }
      case 'resetForeground': {
        foreground = undefined;
        break;
      }
      case 'resetBackground': {
        background = undefined;
        break;
      }
      case 'token': {
        break;
      }
    }
  }
  return { background, foreground, modifiers: active };
}

const ansiModifiers = {
  bold: 1,
  faint: 2,
  hidden: 8,
  inverse: 7,
  italic: 3,
  overline: 53,
  strikethrough: 9,
  underline: 4,
};
const resetModifiers = {
  bold: 22,
  faint: 22,
  hidden: 28,
  inverse: 27,
  italic: 23,
  overline: 55,
  strikethrough: 29,
  underline: 24,
};
const basicPalette: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];
function channel(value: number): number {
  return value === 0 ? 0 : 55 + value * 40;
}
function paletteRgb(index: number): readonly [number, number, number] {
  const basic = basicPalette[index];
  if (basic) {
    return basic;
  }
  if (index >= 232) {
    const value = 8 + (index - 232) * 10;
    return [value, value, value];
  }
  const cube = index - 16;

  return [channel(Math.floor(cube / 36)), channel(Math.floor(cube / 6) % 6), channel(cube % 6)];
}
function nearest(rgb: readonly [number, number, number], limit: number): number {
  let closest = 0;
  let distance = Infinity;
  for (let index = 0; index < limit; index += 1) {
    const candidate = paletteRgb(index);
    const next =
      (rgb[0] - candidate[0]) ** 2 + (rgb[1] - candidate[1]) ** 2 + (rgb[2] - candidate[2]) ** 2;
    if (next < distance) {
      distance = next;
      closest = index;
    }
  }
  return closest;
}
function colorCode(
  color: Color | undefined,
  background: boolean,
  depth: Capabilities['depth'],
): string {
  const offset = background ? 10 : 0;
  if (color === undefined) {
    return String(39 + offset);
  }
  let index = 0;
  if (typeof color === 'string') {
    index = colors[color];
  } else if (color[0] === 'rgb') {
    if (depth === 'truecolor') {
      return `${38 + offset};2;${color[1]};${color[2]};${color[3]}`;
    }
    const fallback = color[4];
    if (depth === 16 && fallback?.ansi16 !== undefined) {
      index = colors[fallback.ansi16];
    } else if (depth === 256 && fallback?.ansi256 !== undefined) {
      index = fallback.ansi256;
    } else {
      index = nearest([color[1], color[2], color[3]], depth);
    }
  } else if (depth !== 16) {
    index = color[1];
  } else {
    const fallback = color[2]?.ansi16;
    index = fallback === undefined ? nearest(paletteRgb(color[1]), 16) : colors[fallback];
  }
  return index < 16
    ? String((index < 8 ? 30 + index : 90 + index - 8) + offset)
    : `${38 + offset};5;${index}`;
}
function sgr(codes: readonly (string | number)[]): string {
  return codes.length ? `\u001b[${codes.join(';')}m` : '';
}

/** Diffs effective attributes, including the shared reset for bold and faint. */
function transition(previous: Attributes, next: Attributes, caps: Capabilities): string {
  const codes: (string | number)[] = [];
  if (caps.color) {
    for (const field of ['foreground', 'background'] as const) {
      const before = colorCode(previous[field], field === 'background', caps.depth);
      const after = colorCode(next[field], field === 'background', caps.depth);
      if (before !== after) {
        codes.push(after);
      }
    }
  }
  if (caps.modifiers) {
    const removed = new Set<number>();
    for (const modifier of previous.modifiers) {
      if (!next.modifiers.has(modifier)) {
        removed.add(resetModifiers[modifier]);
      }
    }
    codes.push(...removed);
    for (const modifier of next.modifiers) {
      if (!previous.modifiers.has(modifier) || removed.has(resetModifiers[modifier])) {
        codes.push(ansiModifiers[modifier]);
      }
    }
  }
  return sgr(codes);
}

export type { Attributes, Palette };
export { applyOperations, emptyAttributes, transition };
