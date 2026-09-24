import { pad, readExtension } from '@loomcli/core';
import type { ArgumentNode, OptionNode, ViewContext } from '@loomcli/core';

import { terminators } from '../lines.js';
import { helpInput } from './extension.js';

/** One option that takes a value, the only kind the action form and the fact list ever narrow to. */
type StringOption = Extract<OptionNode, { type: 'string' }>;

/** One row of a section: the two cells the column rule pads and joins. */
interface Row {
  left: string;
  right: string;
}

/** The spaces that separate the two columns of one section, and a description from its facts. */
const gutter = '  ';

/**
 * Whether a list holds nothing. No list a page renders holds an `undefined` member, so the first
 * member answers the question without a length comparison.
 */
function isEmpty(list: readonly unknown[]): boolean {
  const [first] = list;
  return first === undefined;
}

/**
 * The long spelling one option publishes. A Boolean option's follows its polarity: the positive
 * form, the negative form, or the combined `--[no-]name` when both spellings set a value.
 */
function longSpelling(option: OptionNode): string | null {
  if (option.type === 'string') {
    return option.long;
  }
  if (option.polarity === 'both' && option.long !== null) {
    return `--[no-]${option.long.slice('--'.length)}`;
  }
  return option.long ?? option.negative;
}

/** The word a string option shows for its value: help's own fact, or the declared name. */
function placeholder(option: OptionNode): string {
  return readExtension(option, helpInput)?.placeholder ?? option.name;
}

/**
 * The spellings one option row opens with: both of them, the long one alone indented four spaces so
 * the long spellings align, or the short one alone for a `shortOnly` option.
 */
function spellings(option: OptionNode, { style }: ViewContext): string {
  const long = longSpelling(option);
  if (long === null) {
    return style.highlight(style.escape(option.short ?? ''));
  }
  const highlighted = style.highlight(style.escape(long));
  return option.short === null
    ? `    ${highlighted}`
    : `${style.highlight(style.escape(option.short))}${style.dim(',')} ${highlighted}`;
}

/** The left cell of one option row. A Boolean option takes no value, so it shows no placeholder. */
function optionCell(option: OptionNode, context: ViewContext): string {
  const { style } = context;
  const cell = spellings(option, context);
  return option.type === 'string'
    ? `${cell} ${style.dim.italic(style.escape(`<${placeholder(option)}>`))}`
    : cell;
}

/**
 * How the action form names one required option, with `...` for a multiple option. Only an option
 * that takes a value reaches this, because core rejects `required` on a Boolean option.
 */
function optionForm(option: StringOption, { style }: ViewContext): string {
  const spelling = longSpelling(option) ?? option.short ?? '';
  return `${style.highlight(style.escape(spelling))} ${style.dim.italic(style.escape(`<${placeholder(option)}>${option.multiple ? '...' : ''}`))}`;
}

/** How the action form names one argument: required or optional, and variadic or scalar. */
function argumentForm(argument: ArgumentNode, { style }: ViewContext): string {
  const name = argument.variadic ? `${argument.name}...` : argument.name;
  return style.dim.italic(style.escape(argument.required ? `<${name}>` : `[${name}]`));
}

/** The JSON escape each line terminator prints as, in code point order. */
const escapes: Readonly<Record<string, string>> = {
  '\n': String.raw`\n`,
  '\v': String.raw`\u000b`,
  '\f': String.raw`\f`,
  '\r': String.raw`\r`,
  '\u0085': String.raw`\u0085`,
  '\u2028': String.raw`\u2028`,
  '\u2029': String.raw`\u2029`,
};

/** A line terminator inside a rendered default prints as its escape, so a row stays one line. */
function oneLine(text: string): string {
  return text.replaceAll(terminators, (found) => escapes[found] ?? found);
}

/** Whether a value is a list of strings, which prints as its elements separated by a space. */
function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

/**
 * Whether `String` is the rule for this value, because JSON does not represent it. `JSON.stringify`
 * throws on a bigint, drops a symbol and a function, and renders a non-finite number as `null`, so
 * asking it first would crash the page or print the wrong word. A finite number, a Boolean, and
 * `null` are the scalars JSON does represent, and each of those prints as JSON renders it.
 */
function isText(value: unknown): boolean {
  const kind = typeof value;
  if (kind === 'number') {
    return !Number.isFinite(value);
  }
  return kind === 'bigint' || kind === 'symbol' || kind === 'function';
}

/**
 * How JSON renders one composite value, and how `String` renders it when JSON cannot: a member that
 * is itself unrepresentable throws, and a value JSON drops altogether answers `undefined`.
 */
function jsonOrText(value: unknown): string {
  try {
    const json: string | undefined = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * How one declared default prints: a string as it is, a list of strings separated by a space, any
 * other value JSON can represent as `JSON.stringify` renders it, and anything else as `String`.
 */
function renderDefault(value: unknown): string {
  if (typeof value === 'string') {
    return oneLine(value);
  }
  if (isStrings(value)) {
    return oneLine(value.join(' '));
  }
  return oneLine(isText(value) ? String(value) : jsonOrText(value));
}

/**
 * The right cell of one row: the description when the member has one, then the facts that apply in
 * one parenthesis. Two spaces separate the two, a member with no description has the parenthesis as
 * its whole cell, and a member with neither has no right cell at all.
 */
function rightCell(
  description: string | undefined,
  facts: readonly string[],
  { style }: ViewContext,
): string {
  const parenthesis = isEmpty(facts)
    ? ''
    : `${style.dim('(')}${facts.join(`${style.dim(',')} `)}${style.dim(')')}`;
  if (description === undefined) {
    return parenthesis;
  }
  const text = style.primary(style.escape(description));
  return parenthesis === '' ? text : `${text}${gutter}${parenthesis}`;
}

/** The fact one declared default contributes, which an explicit `undefined` default does not. */
function defaultFacts(
  declared: { readonly value: unknown } | undefined,
  { style }: ViewContext,
): string[] {
  if (declared === undefined || declared.value === undefined) {
    return [];
  }
  return [style.dim(style.escape(`default: ${renderDefault(declared.value)}`))];
}

/** The facts one string option row carries, in the order the right-cell rule names them. */
function stringFacts(option: StringOption, context: ViewContext): string[] {
  const { style } = context;
  return [
    ...(option.required ? [style.dim('required')] : []),
    ...(option.multiple ? [style.dim('repeatable')] : []),
    ...defaultFacts(option.default, context),
  ];
}

/** The facts one Boolean option row carries. Its absent value is its only possible one. */
function booleanFacts(
  option: Extract<OptionNode, { type: 'boolean' }>,
  { style }: ViewContext,
): string[] {
  // A negative polarity means the absent value is `true` and both spellings set it to `false`.
  return option.polarity === 'negative' ? [style.dim('default: true')] : [];
}

/**
 * The fact a deprecated member contributes: its migration message. The right-cell rule prints it
 * last, so a reader takes everything after `deprecated: ` as the message.
 */
function deprecatedFacts(
  member: { readonly deprecated: string | undefined },
  { style }: ViewContext,
): string[] {
  return member.deprecated === undefined
    ? []
    : [style.warning(style.escape(`deprecated: ${member.deprecated}`))];
}

/** The facts one option row carries, in the order the right-cell rule names them. */
function optionFacts(option: OptionNode, context: ViewContext): string[] {
  const declared =
    option.type === 'string' ? stringFacts(option, context) : booleanFacts(option, context);
  return [...declared, ...deprecatedFacts(option, context)];
}

/** An argument's one possible fact. Its presence and arity are read from the usage line instead. */
function argumentFacts(argument: ArgumentNode, context: ViewContext): string[] {
  return defaultFacts(argument.default, context);
}

/**
 * One section's rows as page lines. The left cell is padded to the longest one in that section plus
 * two spaces, and a row with no right cell has no trailing padding. Nothing wraps.
 */
function column(rows: readonly Row[], context: ViewContext): string[] {
  const width = Math.max(...rows.map((row) => context.width(row.left))) + gutter.length;
  return rows.map(
    (row) => `${gutter}${row.right === '' ? row.left : pad(row.left, width) + row.right}`,
  );
}

export type { Row, StringOption };
export {
  argumentFacts,
  argumentForm,
  column,
  deprecatedFacts,
  isEmpty,
  optionCell,
  optionFacts,
  optionForm,
  rightCell,
};
