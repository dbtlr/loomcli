import { pad, readExtension } from '@loomcli/core';
import type { ArgumentNode, OptionNode, ViewContext } from '@loomcli/core';

import { isStrings } from '../closed-set.js';
import { terminators } from '../lines.js';
import { unitWidth } from '../text-lines.js';
import { helpInput } from './extension.js';
import { hanging, onTerminal } from './layout.js';
import type { TerminalContext } from './layout.js';

/** One option that takes a value, the only kind the action form and the fact list ever narrow to. */
type StringOption = Extract<OptionNode, { type: 'string' | 'content' }>;

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
  if (option.type !== 'boolean') {
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
 * How a string option's placeholder follows a spelling, in the parts a projection styles: the
 * separator, the text before the placeholder, the placeholder, and the text after it.
 */
interface ValueParts {
  readonly separator: string;
  readonly before: string;
  readonly placeholder: string;
  readonly after: string;
}

/**
 * A separate value follows after a space; an implied value is replaced only by an attached one, so
 * its placeholder sits in brackets, after `=` on a long spelling and after the letter alone on a
 * short one.
 */
function valueParts(option: StringOption, long: boolean): ValueParts {
  const word = placeholder(option);
  if (option.implied === null) {
    return { after: '>', before: '<', placeholder: word, separator: ' ' };
  }
  return { after: '>]', before: long ? '[=<' : '[<', placeholder: word, separator: '' };
}

/** The value parts as one string, such as `<path>` or `[=<control>]`. */
function valueText(parts: ValueParts): string {
  return `${parts.before}${parts.placeholder}${parts.after}`;
}

/**
 * What one option row's left cell shows before a projection styles it: the short spelling, the
 * published long spelling, the value parts of an option that takes a value, and whether the
 * spellings end with `...`, as a counted option's do because each occurrence adds one. The
 * quiet-marked option counts too, but a further occurrence of it adds nothing, so its spellings end
 * without `...`. A Boolean option takes no value, so it shows no placeholder.
 */
interface OptionCellParts {
  readonly short: string | null;
  readonly long: string | null;
  readonly value: ValueParts | undefined;
  readonly trailingEllipsis: boolean;
}

/** The parts of one option row's left cell. */
function optionCellParts(option: OptionNode): OptionCellParts {
  return {
    long: longSpelling(option),
    short: option.short,
    trailingEllipsis: option.type === 'count' && !option.quiet,
    value:
      option.type === 'string' || option.type === 'content'
        ? valueParts(option, option.long !== null)
        : undefined,
  };
}

/**
 * The spellings one option row opens with: both of them, the long one alone indented four spaces so
 * the long spellings align, or the short one alone for a `shortOnly` option.
 */
function spellings({ long, short }: OptionCellParts, { style }: ViewContext): string {
  if (long === null) {
    return style.highlight(style.escape(short ?? ''));
  }
  const highlighted = style.highlight(style.escape(long));
  return short === null
    ? `    ${highlighted}`
    : `${style.highlight(style.escape(short))}${style.dim(',')} ${highlighted}`;
}

/** The left cell of one option row, its parts styled as help prints them. */
function optionCell(option: OptionNode, context: ViewContext): string {
  const { style } = context;
  const parts = optionCellParts(option);
  const cell = spellings(parts, context);
  if (parts.trailingEllipsis) {
    return `${cell}${style.dim.italic('...')}`;
  }
  if (parts.value === undefined) {
    return cell;
  }
  return `${cell}${parts.value.separator}${style.dim.italic(style.escape(valueText(parts.value)))}`;
}

/**
 * How a usage form styles its words: the routed path, an option's spelling, and every other word,
 * such as a placeholder, `[options]`, or `<command>`. Help styles them as its page does, and the
 * man page writes them in roff.
 */
interface UsageWriter {
  readonly path: (text: string) => string;
  readonly spelling: (text: string) => string;
  readonly word: (text: string) => string;
}

/**
 * How the action form names one required option, with `...` for a multiple option. Only an option
 * that takes a value reaches this, because core rejects `required` on a Boolean or counted option.
 */
function optionForm(option: StringOption, writer: UsageWriter): string {
  const long = longSpelling(option);
  const spelling = long ?? option.short ?? '';
  const value = valueParts(option, long !== null);
  return `${writer.spelling(spelling)}${value.separator}${writer.word(`${valueText(value)}${option.multiple ? '...' : ''}`)}`;
}

/** How the action form names one argument: required or optional, and variadic or scalar. */
function argumentForm(argument: ArgumentNode, writer: UsageWriter): string {
  const name = argument.variadic ? `${argument.name}...` : argument.name;
  return writer.word(argument.required && !argument.stdin ? `<${name}>` : `[${name}]`);
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

/**
 * A line terminator inside a rendered default or a listed value prints as its escape, so a row
 * stays one line.
 */
function oneLine(text: string): string {
  return text.replaceAll(terminators, (found) => escapes[found] ?? found);
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
 * is itself unrepresentable, such as a BigInt, throws, and a value JSON drops altogether answers
 * `undefined`.
 */
function jsonOrText(value: unknown): string {
  let json: string | undefined = undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  return json ?? textOf(value);
}

/**
 * How `String` renders one value, or Object's own spelling, such as `[object Object]`, where
 * `String` throws, as it does for an object whose own `toString` throws.
 */
function textOf(value: unknown): string {
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
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

/** One fact of a row's parenthesis, and the tone help prints it in. */
interface Fact {
  readonly text: string;
  readonly tone: 'dim' | 'warning';
}

/** How a right cell styles its parts: the prose, each fact, and the parenthesis and its commas. */
interface CellWriter {
  readonly prose: (text: string) => string;
  readonly fact: (fact: Fact) => string;
  readonly mark: (text: string) => string;
}

/** The text a right cell reads from its member: the description and the accepted-values sentence. */
interface CellText {
  readonly accepts?: string | undefined;
  readonly description: string | undefined;
}

/**
 * The right cell of one row: the description when the member has one, then its accepted-values
 * sentence, then the facts that apply in one parenthesis. One space separates the description from
 * the sentence and two spaces separate the text from the parenthesis; a member with no text has the
 * parenthesis as its whole cell, and a member with none of the three has no right cell at all.
 */
function rightCellWith(text: CellText, facts: readonly Fact[], writer: CellWriter): string {
  const parenthesis = isEmpty(facts)
    ? ''
    : `${writer.mark('(')}${facts.map((fact) => writer.fact(fact)).join(`${writer.mark(',')} `)}${writer.mark(')')}`;
  const written = [text.description, text.accepts]
    .filter((part) => part !== undefined)
    .map((part) => writer.prose(part));
  if (isEmpty(written)) {
    return parenthesis;
  }
  const joined = written.join(' ');
  return parenthesis === '' ? joined : `${joined}${gutter}${parenthesis}`;
}

/** The right cell of one row as help styles it. */
function rightCell(text: CellText, facts: readonly Fact[], { style }: ViewContext): string {
  return rightCellWith(text, facts, {
    fact: (fact) => style[fact.tone](style.escape(fact.text)),
    mark: (mark) => style.dim(mark),
    prose: (prose) => style.primary(style.escape(prose)),
  });
}

/** A fact help prints dim. */
function dimFact(text: string): Fact {
  return { text, tone: 'dim' };
}

/** The fact one declared default contributes, which an explicit `undefined` default does not. */
function defaultFacts(declared: { readonly value: unknown } | undefined): Fact[] {
  if (declared === undefined || declared.value === undefined) {
    return [];
  }
  return [dimFact(`default: ${renderDefault(declared.value)}`)];
}

/** The fact an implied value contributes, which prints and escapes as a string default does. */
function impliedFacts(implied: string | null): Fact[] {
  return implied === null ? [] : [dimFact(`implied: ${oneLine(implied)}`)];
}

const singularSourceCount = 1;

/** The native source routing and count bounds shared by help and man page rows. */
function contentFacts(
  input: { type?: string; stdin?: boolean; min?: number | undefined; max?: number | undefined },
  collected: boolean,
): Fact[] {
  if (input.type !== 'content') {
    return [];
  }
  const routing = collected
    ? 'files and piped stdin; - places stdin'
    : 'file or piped stdin; - selects stdin';
  return [
    dimFact(input.stdin ? routing : 'file path'),
    ...(input.min === undefined
      ? []
      : [dimFact(`min: ${input.min} ${input.min === singularSourceCount ? 'source' : 'sources'}`)]),
    ...(input.max === undefined
      ? []
      : [dimFact(`max: ${input.max} ${input.max === singularSourceCount ? 'source' : 'sources'}`)]),
  ];
}

function stringFacts(option: StringOption): Fact[] {
  return [
    ...contentFacts(option, option.multiple),
    ...(option.required ? [dimFact('required')] : []),
    ...(option.requiredWhen === 'non-interactive'
      ? [dimFact('required when not interactive')]
      : []),
    ...(option.multiple ? [dimFact('repeatable')] : []),
    ...defaultFacts(option.default),
    ...impliedFacts(option.implied),
  ];
}

/** The facts one Boolean option row carries. Its absent value is its only possible one. */
function booleanFacts(option: Extract<OptionNode, { type: 'boolean' }>): Fact[] {
  // A negative polarity means the absent value is `true` and both spellings set it to `false`.
  return option.polarity === 'negative' ? [dimFact('default: true')] : [];
}

/**
 * The fact a deprecated member contributes: its migration message. The right-cell rule prints it
 * last, so a reader takes everything after `deprecated: ` as the message.
 */
function deprecatedFacts(member: { readonly deprecated: string | undefined }): Fact[] {
  return member.deprecated === undefined
    ? []
    : [{ text: `deprecated: ${member.deprecated}`, tone: 'warning' }];
}

/**
 * The facts one option row carries, in the order the right-cell rule names them. A counted option's
 * `...` already says it repeats, and a count has no presence rule or default, so it carries none
 * but its deprecation.
 */
function optionFacts(option: OptionNode): Fact[] {
  return [...kindFacts(option), ...deprecatedFacts(option)];
}

/** The facts one option's kind contributes ahead of its deprecation. */
function kindFacts(option: OptionNode): Fact[] {
  switch (option.type) {
    case 'content':
    case 'string': {
      return stringFacts(option);
    }
    case 'boolean': {
      return booleanFacts(option);
    }
    case 'count': {
      return [];
    }
    default: {
      const exhaustive: never = option;
      return exhaustive;
    }
  }
}

/** An argument's one possible fact. Its presence and arity are read from the usage line instead. */
function argumentFacts(argument: ArgumentNode): Fact[] {
  return [...contentFacts(argument, argument.variadic), ...defaultFacts(argument.default)];
}

/** One row set as a terminal lays it out: its indent, its rows, and its left column's width. */
interface RowSet {
  readonly indent: string;
  readonly rows: readonly Row[];
  readonly leftWidth: number;
}

/** The indent of an outer heading's direct rows. */
const rowIndent = '  ';

/** How far a stacked right cell sits past its set's indent. */
const stackedIndent = '    ';

/**
 * Whether a row set stacks: its indent, its left column, and its floor, the widest unit `wrap`
 * keeps whole in any of its right cells, together exceed the columns.
 */
function stacks(set: RowSet, context: TerminalContext): boolean {
  let floor = 0;
  for (const row of set.rows) {
    floor = Math.max(floor, unitWidth(row.right, context));
  }
  return context.width(set.indent) + set.leftWidth + floor > context.columns;
}

/** Two columns, each right cell wrapped under the right column. */
function wrappedRows({ indent, leftWidth, rows }: RowSet, context: TerminalContext): string[] {
  return rows.flatMap((row) =>
    row.right === ''
      ? [`${indent}${row.left}`]
      : hanging(row.right, { lead: `${indent}${pad(row.left, leftWidth)}` }, context),
  );
}

/**
 * The columns of spaces before a left cell's text, such as the four that align a long-only
 * option's spelling under the long spellings.
 */
function leadingSpaces(left: string, context: ViewContext): number {
  const text = context.plain(left);
  return context.width(text) - context.width(text.trimStart());
}

/**
 * Each left cell alone at the set's indent, its right cell on the lines below. Every right cell
 * starts four columns past the furthest-in start of a left cell's text in the set, so a
 * description never starts in the column of a long-only option's spelling.
 */
function stackedRows({ indent, rows }: RowSet, context: TerminalContext): string[] {
  let furthest = 0;
  for (const row of rows) {
    furthest = Math.max(furthest, leadingSpaces(row.left, context));
  }
  const lead = `${indent}${' '.repeat(furthest)}${stackedIndent}`;
  return rows.flatMap((row) => [
    `${indent}${row.left}`,
    ...(row.right === '' ? [] : hanging(row.right, { lead }, context)),
  ]);
}

/**
 * One row set's lines at `indent`. The left cell is padded to the longest one in the set plus two
 * spaces, and a row with no right cell has no trailing padding. Off a terminal nothing wraps, so a
 * row is one line however long it is. On a terminal each right cell's tabs expand once and it wraps
 * under the right column, and a set whose indent, left column, and floor exceed the columns stacks.
 */
function column(rows: readonly Row[], context: ViewContext, indent = rowIndent): string[] {
  const leftWidth = Math.max(...rows.map((row) => context.width(row.left))) + gutter.length;
  if (!onTerminal(context)) {
    return rows.map(
      (row) => `${indent}${row.right === '' ? row.left : pad(row.left, leftWidth) + row.right}`,
    );
  }
  const set: RowSet = {
    indent,
    leftWidth,
    rows: rows.map((row) => ({ left: row.left, right: context.expandTabs(row.right) })),
  };
  return stacks(set, context) ? stackedRows(set, context) : wrappedRows(set, context);
}

export type {
  CellText,
  CellWriter,
  Fact,
  OptionCellParts,
  Row,
  StringOption,
  UsageWriter,
  ValueParts,
};
export {
  argumentFacts,
  argumentForm,
  column,
  deprecatedFacts,
  isEmpty,
  oneLine,
  optionCell,
  optionCellParts,
  optionFacts,
  optionForm,
  rightCell,
  rightCellWith,
};
