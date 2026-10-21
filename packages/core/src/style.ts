import type { ApplicationEnvironment, RegisteredEnvironment } from './environment.js';
import { isPlainObject } from './plain.js';
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

/** The brand an adaptive style carries, which no export names, so only `style.adaptive` makes one. */
const adaptiveStyle: unique symbol = Symbol('adaptiveStyle');

/**
 * A theme entry that holds one concrete style for each background. Core resolves it to the side
 * that matches the run's background when it emits the token. It styles no text and chains no
 * further, so it belongs in a theme mapping alone.
 */
interface AdaptiveStyle {
  readonly [adaptiveStyle]: true;
}

/** The two sides `style.adaptive` takes: an unapplied concrete chain for each background. */
interface AdaptiveSides {
  readonly dark: ConcreteStyle;
  readonly light: ConcreteStyle;
}

/** The exported style: the root chain, which alone carries `adaptive`. */
type RootStyle = Style & {
  readonly adaptive: (sides: AdaptiveSides) => AdaptiveStyle;
};

type ThemeMapping = Readonly<Record<string, ConcreteStyle | AdaptiveStyle | undefined>>;
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

/** The operations of each side of every adaptive style `style.adaptive` made, by its value. */
const adaptives = new WeakMap<
  object,
  { readonly dark: readonly Operation[]; readonly light: readonly Operation[] }
>();

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

/**
 * The operations of one unapplied concrete chain without semantic tokens, or `undefined` for any
 * other value. A theme entry and each side of an adaptive style follow this one rule.
 */
function concreteOperations(value: unknown): readonly Operation[] | undefined {
  const operations = typeof value === 'function' ? chains.get(value) : undefined;
  return operations?.some((entry) => entry[0] === 'token') === false ? operations : undefined;
}

/** The one fault `style.adaptive` throws for every argument it rejects. */
function adaptiveFault(): TypeError {
  return new TypeError(
    'Adaptive styles take an unapplied concrete style chain for dark and for light.',
  );
}

/**
 * An adaptive style over two unapplied concrete chains, checked when it is called. It keeps each
 * side's operations, so a later change to the object passed changes nothing.
 */
function adaptive(sides: AdaptiveSides): AdaptiveStyle {
  if (
    !isPlainObject(sides) ||
    Reflect.ownKeys(sides).some((key) => key !== 'dark' && key !== 'light')
  ) {
    throw adaptiveFault();
  }
  const dark = concreteOperations(sides.dark);
  const light = concreteOperations(sides.light);
  if (dark === undefined || light === undefined) {
    throw adaptiveFault();
  }
  const value = Object.freeze({ [adaptiveStyle]: true as const });
  adaptives.set(value, { dark, light });
  return value;
}

/**
 * A root chain whose properties are generated from the same catalogs the wire parser validates.
 * `root` holds members of the root alone, which no chain built from it carries.
 */
function styleRoot<Root extends object>(
  names: ReadonlySet<string>,
  root: Root,
): ContextualStyle & Root {
  function chain<Members extends object>(
    operations: readonly Operation[],
    members: Members,
  ): ContextualStyle & Members {
    const callable = (text: string) => frame(['style', operations], textOnly(text));
    const next = (operation: Operation) => chain([...operations, operation], {});
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
    for (const [name, member] of Object.entries(members)) {
      properties.set(name, () => member);
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
    // It holds because the catalogs above supply every declared helper and token, and members supplies its own keys.
    // Chains retain operations for validation.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as ContextualStyle & Members;
  }
  return chain([], root);
}

/** A root chain over `names`, the tokens its chains carry, with no member of the root alone. */
function createStyle(names: ReadonlySet<string> = new Set(tokens)): ContextualStyle {
  return styleRoot(names, {});
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

/**
 * Text that line breaking keeps whole, such as a path that holds spaces. The frame resolves to its
 * body exactly and measures as its body; only the view context's `wrap` and `splitLines` read it.
 */
function nowrap(text: string): string {
  return frame(['nowrap'], textOnly(text));
}

/** The exported style, whose root alone carries `adaptive`, so a theme may name a token `adaptive`. */
const style: RootStyle = styleRoot(new Set(tokens), { adaptive });

export type {
  AdaptiveSides,
  AdaptiveStyle,
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
  adaptives,
  colorFallbacks,
  concreteOperations,
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
  nowrap,
  open,
  pad,
  style,
  textOnly,
  tokens,
};
