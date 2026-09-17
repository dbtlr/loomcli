import type { ApplicationEnvironment, RegisteredEnvironment } from './environment.js';
import { isPlainObject } from './facts.js';
import type { Plugin, ThemeOf } from './plugin.js';
import type { Alignment } from './style-wire.js';
/** Concrete terminal foregrounds; backgrounds use the same palette indices. */
const colors = {
  black: 0,
  blue: 4,
  brightBlack: 8,
  brightBlue: 12,
  brightCyan: 14,
  brightGreen: 10,
  brightMagenta: 13,
  brightRed: 9,
  brightWhite: 15,
  brightYellow: 11,
  cyan: 6,
  green: 2,
  magenta: 5,
  red: 1,
  white: 7,
  yellow: 3,
};

type Ansi16Color = keyof typeof colors;
type ColorName = Ansi16Color;
interface ColorFallbacks {
  readonly ansi256?: number | undefined;
  readonly ansi16?: Ansi16Color | undefined;
}
type Ansi256Fallbacks = Pick<ColorFallbacks, 'ansi16'>;
type RgbArguments = [
  red: number,
  green: number,
  blue: number,
  fallbacks?: ColorFallbacks | undefined,
];
type Color =
  | ColorName
  | readonly ['rgb', number, number, number, ColorFallbacks?]
  | readonly ['ansi256', number, Ansi256Fallbacks?];
const modifiers = [
  'bold',
  'faint',
  'italic',
  'underline',
  'inverse',
  'hidden',
  'strikethrough',
  'overline',
] as const;
type Modifier = (typeof modifiers)[number];
const tokens = ['dim', 'primary', 'highlight', 'success', 'warning', 'error', 'info'] as const;
type CoreToken = (typeof tokens)[number];
type Reset = 'reset' | 'resetForeground' | 'resetBackground';
type Operation =
  | readonly ['foreground' | 'background', Color]
  | readonly ['modifier', Modifier]
  | readonly [Reset]
  | readonly ['token', string];

declare const semanticStyle: unique symbol;
type Style<Names extends string = CoreToken, Semantic extends boolean = false> = {
  (text: string): string;
  readonly [semanticStyle]: Semantic;
  readonly escape: (text: string) => string;
  readonly hex: (color: string, fallbacks?: ColorFallbacks) => Style<Names, Semantic>;
  readonly bgHex: (color: string, fallbacks?: ColorFallbacks) => Style<Names, Semantic>;
  readonly rgb: (...args: RgbArguments) => Style<Names, Semantic>;
  readonly bgRgb: (...args: RgbArguments) => Style<Names, Semantic>;
  readonly ansi256: (index: number, fallbacks?: Ansi256Fallbacks) => Style<Names, Semantic>;
  readonly bgAnsi256: (index: number, fallbacks?: Ansi256Fallbacks) => Style<Names, Semantic>;
} & {
  readonly [Name in ColorName | `bg${Capitalize<ColorName>}` | Modifier | Reset]: Style<
    Names,
    Semantic
  >;
} & { readonly [Name in Names]: Style<Names, true> };

type ThemeNames<Contributor> = Contributor extends Plugin
  ? keyof ThemeOf<Contributor> & string
  : never;
type EnvironmentStyle<Environment extends ApplicationEnvironment<unknown, readonly Plugin[]>> =
  Style<CoreToken | ThemeNames<Environment['plugins'][number]>>;
type ContextualStyle = EnvironmentStyle<RegisteredEnvironment>;
type ConcreteStyle = Style;
type ThemeMapping = Readonly<Record<string, ConcreteStyle | undefined>>;
type ThemeConstraint<Mapping> = {
  readonly [Key in keyof Mapping]: Key extends
    | Exclude<keyof Style, CoreToken>
    | (typeof reservedCallableNames)[number]
    ? never
    : Mapping[Key];
};

const open = '\uE000';
const headerEnd = '\uE001';
const close = '\uE002';
const escape = '\uE003';
const chains = new WeakMap<object, readonly Operation[]>();

const reservedCallableNames = [
  'apply',
  'arguments',
  'bind',
  'call',
  'caller',
  'constructor',
  'length',
  'name',
  'prototype',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'then',
] as const;

const reservedStyleNames = new Set([
  ...Object.keys(colors),
  ...Object.keys(colors).map((name) => `bg${name.charAt(0).toUpperCase()}${name.slice(1)}`),
  ...modifiers,
  'reset',
  'resetForeground',
  'resetBackground',
  'hex',
  'bgHex',
  'rgb',
  'bgRgb',
  'ansi256',
  'bgAnsi256',
  'escape',
  ...reservedCallableNames,
]);

function textOnly(text: string): string {
  if (typeof text !== 'string') {
    throw new TypeError('Style helpers require a string.');
  }
  return text;
}

function frame(header: readonly unknown[], body: string): string {
  const encoded = JSON.stringify(header).replace(
    /[\uE000-\uE003]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16)}`,
  );
  return `${open}${encoded}${headerEnd}${body}${close}`;
}

function escapeText(text: string): string {
  return textOnly(text).replace(
    /[\uE000-\uE003]/gu,
    (character) => `${escape}${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError('Color channels and palette indices must be integers from 0 through 255.');
  }
  return value;
}

/** Copies options at the helper boundary; the wire parser uses the same value rules. */
function colorFallbacks(value: unknown, allow256: boolean): ColorFallbacks {
  if (value === undefined) {
    return {};
  }
  if (
    !isPlainObject(value) ||
    Reflect.ownKeys(value).some((key) => key !== 'ansi16' && !(allow256 && key === 'ansi256'))
  ) {
    throw new TypeError('Color fallbacks must be a plain object with supported depth names.');
  }
  const ansi16 = value.ansi16;
  const ansi256 = value.ansi256;
  if (ansi16 !== undefined && !isColorName(ansi16)) {
    throw new TypeError('The ansi16 fallback must be a terminal foreground color name.');
  }
  if (
    ansi256 !== undefined &&
    (typeof ansi256 !== 'number' || !Number.isInteger(ansi256) || ansi256 < 0 || ansi256 > 255)
  ) {
    throw new RangeError('The ansi256 fallback must be an integer from 0 through 255.');
  }
  return {
    ...(ansi16 === undefined ? {} : { ansi16 }),
    ...(ansi256 === undefined ? {} : { ansi256 }),
  };
}

function rgbColor([red, green, blue, fallbacks]: RgbArguments): Color {
  const rgb = ['rgb', byte(red), byte(green), byte(blue)] as const;
  const copied = colorFallbacks(fallbacks, true);
  return Object.keys(copied).length === 0 ? rgb : [...rgb, copied];
}

function indexedColor(index: number, fallbacks?: Ansi256Fallbacks): Color {
  const color = ['ansi256', byte(index)] as const;
  const copied = colorFallbacks(fallbacks, false);
  return Object.keys(copied).length === 0 ? color : [...color, copied];
}

function hexColor(value: string, fallbacks?: ColorFallbacks): Color {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/iu.test(value)) {
    throw new TypeError('Hex colors must use #RGB or #RRGGBB.');
  }
  const full =
    value.length === 4
      ? value.slice(1).replace(/[\da-f]/giu, (digit) => digit + digit)
      : value.slice(1);
  return rgbColor([
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
    fallbacks,
  ]);
}

/** Properties are generated from the same catalogs the wire parser validates. */
function createStyle(names: ReadonlySet<string> = new Set(tokens)): ContextualStyle {
  function chain(operations: readonly Operation[]): ContextualStyle {
    const callable = (text: string) => frame(['style', operations], textOnly(text));
    const next = (operation: Operation) => chain([...operations, operation]);
    const helpers = {
      ansi256: (index: number, fallbacks?: Ansi256Fallbacks) =>
        next(['foreground', indexedColor(index, fallbacks)]),
      bgAnsi256: (index: number, fallbacks?: Ansi256Fallbacks) =>
        next(['background', indexedColor(index, fallbacks)]),
      bgHex: (value: string, fallbacks?: ColorFallbacks) =>
        next(['background', hexColor(value, fallbacks)]),
      bgRgb: (...args: RgbArguments) => next(['background', rgbColor(args)]),
      escape: escapeText,
      hex: (value: string, fallbacks?: ColorFallbacks) =>
        next(['foreground', hexColor(value, fallbacks)]),
      rgb: (...args: RgbArguments) => next(['foreground', rgbColor(args)]),
    };
    const properties = new Map<string, () => unknown>(
      Object.entries(helpers).map(([name, helper]) => [name, () => helper]),
    );
    for (const name of Object.keys(colors)) {
      if (isColorName(name)) {
        properties.set(name, () => next(['foreground', name]));
        properties.set(`bg${name.charAt(0).toUpperCase()}${name.slice(1)}`, () =>
          next(['background', name]),
        );
      }
    }
    for (const name of modifiers) {
      properties.set(name, () => next(['modifier', name]));
    }
    for (const name of ['reset', 'resetForeground', 'resetBackground'] as const) {
      properties.set(name, () => next([name]));
    }
    for (const name of names) {
      properties.set(name, () => next(['token', name]));
    }
    const value = new Proxy(callable, {
      get: (target, property, receiver) =>
        typeof property === 'string' && properties.has(property)
          ? properties.get(property)?.()
          : Reflect.get(target, property, receiver),
    });
    chains.set(value, operations);
    Object.freeze(value);
    // Last resort: no typed path exists from runtime-generated callable properties to mapped keys.
    // It holds because the catalogs above supply every declared helper and token; chains retain operations for validation.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as ContextualStyle;
  }
  return chain([]);
}

function isColorName(value: unknown): value is ColorName {
  return typeof value === 'string' && Object.hasOwn(colors, value);
}

function pad(text: string, minimumWidth: number, options?: { align?: Alignment }): string {
  textOnly(text);
  if (!Number.isSafeInteger(minimumWidth) || minimumWidth < 0) {
    throw new RangeError('Padding width must be a nonnegative safe integer.');
  }
  const align = options?.align ?? 'left';
  if (align !== 'left' && align !== 'right' && align !== 'center') {
    throw new TypeError('Padding alignment must be left, right, or center.');
  }
  return frame(['pad', minimumWidth, align], text);
}

const style: Style = createStyle();

export type {
  Ansi16Color,
  Ansi256Fallbacks,
  ColorFallbacks,
  ContextualStyle,
  Color,
  ColorName,
  ConcreteStyle,
  CoreToken,
  Modifier,
  Operation,
  Style,
  ThemeConstraint,
  ThemeMapping,
};
export {
  colorFallbacks,
  chains,
  close,
  colors,
  createStyle,
  escape,
  escapeText,
  frame,
  headerEnd,
  isColorName,
  modifiers,
  open,
  pad,
  reservedStyleNames,
  style,
  tokens,
};
