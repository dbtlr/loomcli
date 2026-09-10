import { readExtension } from '@loomcli/core';
import type { ArgumentNode, OptionNode } from '@loomcli/core';

import { helpInput } from './extension.js';

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
function spellings(option: OptionNode): string {
  const long = longSpelling(option);
  if (long === null) {
    return option.short ?? '';
  }
  return option.short === null ? `    ${long}` : `${option.short}, ${long}`;
}

/** The left cell of one option row. A Boolean option takes no value, so it shows no placeholder. */
function optionCell(option: OptionNode): string {
  const cell = spellings(option);
  return option.type === 'string' ? `${cell} <${placeholder(option)}>` : cell;
}

/** How the action form names one required option, with `...` for a multiple option. */
function optionForm(option: OptionNode): string {
  const spelling = longSpelling(option) ?? option.short ?? '';
  if (option.type === 'boolean') {
    return spelling;
  }
  return `${spelling} <${placeholder(option)}>${option.multiple ? '...' : ''}`;
}

/** How the action form names one argument: required or optional, and variadic or scalar. */
function argumentForm(argument: ArgumentNode): string {
  const name = argument.variadic ? `${argument.name}...` : argument.name;
  return argument.required ? `<${name}>` : `[${name}]`;
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
const terminators = /[\n\v\f\r\u0085\u2028\u2029]/gu;

/** A line terminator inside a rendered default prints as its escape, so a row stays one line. */
function oneLine(text: string): string {
  return text.replaceAll(terminators, (found) => escapes[found] ?? found);
}

/** Whether a value is a list of strings, which prints as its elements separated by a space. */
function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
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
  const json: string | undefined = JSON.stringify(value);
  return oneLine(json ?? String(value));
}

/**
 * The right cell of one row: the description when the member has one, then the facts that apply in
 * one parenthesis. Two spaces separate the two, a member with no description has the parenthesis as
 * its whole cell, and a member with neither has no right cell at all.
 */
function rightCell(description: string | undefined, facts: readonly string[]): string {
  const parenthesis = isEmpty(facts) ? '' : `(${facts.join(', ')})`;
  if (description === undefined) {
    return parenthesis;
  }
  return parenthesis === '' ? description : `${description}${gutter}${parenthesis}`;
}

/** The fact one declared default contributes, which an explicit `undefined` default does not. */
function defaultFacts(declared: { readonly value: unknown } | undefined): string[] {
  if (declared === undefined || declared.value === undefined) {
    return [];
  }
  return [`default: ${renderDefault(declared.value)}`];
}

/** The facts one string option row carries, in the order the right-cell rule names them. */
function stringFacts(option: Extract<OptionNode, { type: 'string' }>): string[] {
  return [
    ...(option.required ? ['required'] : []),
    ...(option.multiple ? ['repeatable'] : []),
    ...defaultFacts(option.default),
  ];
}

/** The facts one option row carries. A Boolean option's absent value is its only possible fact. */
function optionFacts(option: OptionNode): string[] {
  // `deprecated: <message>` joins each list below, always last, once the graph carries the fact.
  if (option.type === 'string') {
    return stringFacts(option);
  }
  // A negative polarity means the absent value is `true` and both spellings set it to `false`.
  return option.polarity === 'negative' ? ['default: true'] : [];
}

/** An argument's one possible fact. Its presence and arity are read from the usage line instead. */
function argumentFacts(argument: ArgumentNode): string[] {
  return defaultFacts(argument.default);
}

/**
 * One section's rows as page lines. The left cell is padded to the longest one in that section plus
 * two spaces, and a row with no right cell has no trailing padding. Nothing wraps.
 */
function column(rows: readonly Row[]): string[] {
  const width = Math.max(...rows.map((row) => row.left.length)) + gutter.length;
  return rows.map(
    (row) => `${gutter}${row.right === '' ? row.left : row.left.padEnd(width) + row.right}`,
  );
}

export type { Row };
export {
  argumentFacts,
  argumentForm,
  column,
  isEmpty,
  optionCell,
  optionFacts,
  optionForm,
  rightCell,
};
