import { offsetGroups, offsetPattern } from './calendar.js';
import type { Groups } from './calendar.js';
import { fault } from './faults.js';
import { escapeSyntax } from './pattern-syntax.js';
import { layout as layoutRule } from './rules.js';

/**
 * The strftime layouts `date()`, `dateTime()`, and `time()` read beside their default grammar.
 * A layout compiles once, at the factory call, into the expression the validator matches, the
 * pattern the factory publishes, and the form its message writes. A layout the factory cannot read
 * faults at the call, marking the entry of `layouts` at fault.
 */

/** Each directive a layout may hold, as the layout writes it. */
type Directive = '%H' | '%I' | '%M' | '%S' | '%Y' | '%d' | '%m' | '%p' | '%z';

/** A field a directive reads. `%H` and `%I` both read the hour. */
type Field = 'day' | 'hour' | 'meridiem' | 'minute' | 'month' | 'offset' | 'second' | 'year';

/** How one directive reads: the field, the written form, and the patterns it compiles to. */
interface DirectiveSpec {
  readonly field: Field;
  readonly form: string;
  /** Whether it reads one or two digits, two exactly when another digit directive follows it. */
  readonly flexible: boolean;
  /** The pattern it publishes, with no capture, for the width it reads. */
  readonly pattern: (exactlyTwo: boolean) => string;
  /** The same pattern with each part captured under the group name the readers use. */
  readonly groups: (exactlyTwo: boolean) => string;
}

/** One or two digits, or exactly two. */
function digits(exactlyTwo: boolean): string {
  return exactlyTwo ? '[0-9]{2}' : '[0-9]{1,2}';
}

/** A directive that reads one or two digits into the field's group. */
function twoDigitField(field: Field, form: string): DirectiveSpec {
  return {
    field,
    flexible: true,
    form,
    groups: (exactlyTwo) => `(?<${field}>${digits(exactlyTwo)})`,
    pattern: digits,
  };
}

const specs: Readonly<Record<Directive, DirectiveSpec>> = {
  '%Y': {
    field: 'year',
    flexible: false,
    form: 'YYYY',
    groups: () => '(?<year>[0-9]{4})',
    pattern: () => '[0-9]{4}',
  },
  '%m': twoDigitField('month', 'MM'),
  '%d': twoDigitField('day', 'DD'),
  '%H': twoDigitField('hour', 'hh'),
  '%I': twoDigitField('hour', 'hh'),
  '%M': twoDigitField('minute', 'mm'),
  '%S': twoDigitField('second', 'ss'),
  '%p': {
    field: 'meridiem',
    flexible: false,
    form: 'AM',
    groups: () => '(?<meridiem>[AaPp][Mm])',
    pattern: () => '[AaPp][Mm]',
  },
  '%z': {
    field: 'offset',
    flexible: false,
    form: '±hh:mm',
    groups: () => `(?:${offsetGroups})`,
    pattern: () => `(?:${offsetPattern})`,
  },
};

/** The directives that read digits, after which a one-or-two-digit directive reads exactly two. */
const digitDirectives: ReadonlySet<string> = new Set(['%H', '%I', '%M', '%S', '%Y', '%d', '%m']);

/** How a sentence names a field held twice. */
const fieldNames: Readonly<Record<Field, string>> = {
  day: 'the day',
  hour: 'the hour',
  meridiem: '%p',
  minute: 'the minute',
  month: 'the month',
  offset: 'the offset',
  second: 'the second',
  year: 'the year',
};

/** One field a factory's layout must hold, as a fault names it and says to add it. */
interface RequiredField {
  readonly field: Field;
  readonly name: string;
  readonly add: string;
}

/** What one factory's layouts may hold, and how its faults word their corrections. */
interface LayoutRules {
  readonly factory: 'date' | 'dateTime' | 'time';
  /** The directives the factory reads. */
  readonly reads: readonly Directive[];
  /** The directives a correction lists, as a sentence writes them. */
  readonly listed: string;
  readonly required: readonly RequiredField[];
  /** Whether a literal `Z` or `z` is a fault, because only `%z` may read a UTC stamp. */
  readonly refusesLiteralZone: boolean;
  /** A layout the factory reads, for the correction of an empty one. */
  readonly example: string;
}

/** The fields every date layout holds. */
const dateFields: readonly RequiredField[] = [
  { add: 'Add %Y.', field: 'year', name: 'year' },
  { add: 'Add %m.', field: 'month', name: 'month' },
  { add: 'Add %d.', field: 'day', name: 'day' },
];

const dateRules: LayoutRules = {
  example: '"%d/%m/%Y"',
  factory: 'date',
  listed: '%Y, %m, and %d',
  reads: ['%Y', '%m', '%d'],
  refusesLiteralZone: false,
  required: dateFields,
};

const dateTimeRules: LayoutRules = {
  example: '"%d/%m/%Y %H:%M"',
  factory: 'dateTime',
  listed: '%Y, %m, %d, %H, %M, %S, and %z',
  reads: ['%Y', '%m', '%d', '%H', '%M', '%S', '%z'],
  refusesLiteralZone: true,
  required: [
    ...dateFields,
    { add: 'Add %H.', field: 'hour', name: 'hour' },
    { add: 'Add %M.', field: 'minute', name: 'minute' },
  ],
};

const timeRules: LayoutRules = {
  example: '"%I:%M%p"',
  factory: 'time',
  listed: '%H, %I, %M, %S, and %p',
  reads: ['%H', '%I', '%M', '%S', '%p'],
  refusesLiteralZone: false,
  required: [
    { add: 'Add %H, or %I with %p.', field: 'hour', name: 'hour' },
    { add: 'Add %M.', field: 'minute', name: 'minute' },
  ],
};

/** One part of a layout: text it matches exactly, or a directive. */
type Piece = { readonly text: string } | { readonly directive: Directive };

/** One compiled layout: what the validator matches, what the factory publishes, and its written form. */
interface Layout {
  readonly expression: RegExp;
  readonly pattern: string;
  readonly form: string;
}

/** Why a layout cannot be read, as its fault states it. */
interface Problem {
  readonly sentence: string;
  readonly correction: string;
}

/** The layout a fault names: its factory, for the sentence, and the layout quoted. */
interface Named {
  readonly rules: LayoutRules;
  readonly quoted: string;
}

/**
 * A layout's parts in order: a `%` and the one character after it, which is empty for a `%` that
 * ends the layout, or a run of text with no `%`. Under `u`, the character after `%` is a whole
 * code point.
 */
const parts = /%(?<letter>[\s\S]?)|(?<text>[^%]+)/gu;

/** A literal UTC designator, which only `%z` may read in a `dateTime()` layout. */
const zoneLetter = /(?<letter>[Zz])/u;

function isDirective(spelling: string): spelling is Directive {
  return Object.hasOwn(specs, spelling);
}

/** The sentence's opening, the factory call and the layout it holds: `date() layout "%d/%m"`. */
function opening({ quoted, rules }: Named): string {
  return `${rules.factory}() layout ${quoted}`;
}

/** A run of text as a piece, or the problem a literal `Z` or `z` poses in a `dateTime()` layout. */
function textPiece(named: Named, text: string): Piece | Problem {
  const letter = named.rules.refusesLiteralZone ? zoneLetter.exec(text)?.groups?.letter : undefined;
  return letter === undefined
    ? { text }
    : {
        correction: 'Write %z, which reads Z as UTC and every other offset as that offset.',
        sentence: `${opening(named)} holds a literal ${letter}, which would read a UTC time as local time.`,
      };
}

/** A `%` and the character after it as a piece, or the problem it poses. */
function directivePiece(named: Named, letter: string): Piece | Problem {
  const { rules } = named;
  const spelling = `%${letter}`;
  if (letter === '') {
    return {
      correction: 'Write %% for a percent sign.',
      sentence: `${opening(named)} ends with a lone %.`,
    };
  }
  if (letter === '%') {
    return { text: '%' };
  }
  if (isDirective(spelling) && rules.reads.includes(spelling)) {
    return { directive: spelling };
  }
  const reader = isDirective(spelling) ? `${rules.factory}() does not read` : 'no layout reads';
  return {
    correction: `Use only ${rules.listed}, with %% for a percent sign.`,
    sentence: `${opening(named)} holds ${spelling}, which ${reader}.`,
  };
}

/** A layout's pieces in order, or the problem the first part that cannot be read poses. */
function scan(named: Named, layout: string): Piece[] | Problem {
  const pieces: Piece[] = [];
  for (const { groups } of layout.matchAll(parts)) {
    const piece =
      groups?.text === undefined
        ? directivePiece(named, groups?.letter ?? '')
        : textPiece(named, groups.text);
    if ('sentence' in piece) {
      return piece;
    }
    pieces.push(piece);
  }
  return pieces;
}

/** The directives the pieces hold, in order. */
function directivesOf(pieces: readonly Piece[]): Directive[] {
  return pieces.flatMap((piece) => ('directive' in piece ? [piece.directive] : []));
}

/** The problem of a field the directives hold twice, or undefined when each is held once. */
function repeatedField(named: Named, directives: readonly Directive[]): Problem | undefined {
  const fields = directives.map((directive) => specs[directive].field);
  const repeated = fields.find((field, index) => fields.indexOf(field) !== index);
  return repeated === undefined
    ? undefined
    : {
        correction: 'Write each field once.',
        sentence: `${opening(named)} holds ${fieldNames[repeated]} twice.`,
      };
}

/** The problem of a field the factory needs and the directives lack, or undefined. */
function missingField(named: Named, directives: readonly Directive[]): Problem | undefined {
  const held = new Set(directives.map((directive) => specs[directive].field));
  const missing = named.rules.required.find(({ field }) => !held.has(field));
  return missing === undefined
    ? undefined
    : { correction: missing.add, sentence: `${opening(named)} holds no ${missing.name}.` };
}

/** The problem of `%I` without `%p`, or `%p` without `%I`, or undefined when they pair. */
function unpairedClock(named: Named, directives: readonly Directive[]): Problem | undefined {
  const twelveHour = directives.includes('%I');
  const meridiem = directives.includes('%p');
  if (twelveHour && !meridiem) {
    return {
      correction: 'Add %p, or write %H for an hour from 0 through 23.',
      sentence: `${opening(named)} holds %I without %p.`,
    };
  }
  if (meridiem && !twelveHour) {
    return {
      correction: 'Write %I for an hour from 1 through 12, or leave out %p.',
      sentence: `${opening(named)} holds %p without %I.`,
    };
  }
  return undefined;
}

const none = 0;

/** The step to the piece after one. */
const nextPiece = 1;

/** Whether the piece after `index` is a directive that reads digits. */
function digitsFollow(pieces: readonly Piece[], index: number): boolean {
  const next = pieces[index + nextPiece];
  return next !== undefined && 'directive' in next && digitDirectives.has(next.directive);
}

/** One piece as the expression's source, the published pattern's, and the written form's. */
function compiledPiece(pieces: readonly Piece[], piece: Piece, index: number) {
  if ('text' in piece) {
    const escaped = escapeSyntax(piece.text);
    return { form: piece.text, groups: escaped, pattern: escaped };
  }
  const spec = specs[piece.directive];
  const exactlyTwo = spec.flexible && digitsFollow(pieces, index);
  return { form: spec.form, groups: spec.groups(exactlyTwo), pattern: spec.pattern(exactlyTwo) };
}

/** The pieces as a compiled layout: the expression, the published pattern, and the written form. */
function compile(pieces: readonly Piece[]): Layout {
  const compiled = pieces.map((piece, index) => compiledPiece(pieces, piece, index));
  const joined = (part: 'form' | 'groups' | 'pattern') =>
    compiled.map((each) => each[part]).join('');
  return {
    expression: new RegExp(`^${joined('groups')}$`, 'u'),
    form: joined('form'),
    pattern: `^${joined('pattern')}$`,
  };
}

/** One layout compiled, or the problem that keeps the factory from reading it. */
function compileLayout(rules: LayoutRules, layout: string): Layout | Problem {
  if (layout === '') {
    return {
      correction: `Supply a layout such as ${rules.example}.`,
      sentence: `${rules.factory}() layouts lists an empty layout.`,
    };
  }
  const named = { quoted: JSON.stringify(layout), rules };
  const pieces = scan(named, layout);
  if (!Array.isArray(pieces)) {
    return pieces;
  }
  const directives = directivesOf(pieces);
  return (
    repeatedField(named, directives) ??
    missingField(named, directives) ??
    unpairedClock(named, directives) ??
    compile(pieces)
  );
}

/** The `layouts` a factory call declares, compiled in order; a fault marks the first it cannot read. */
function readLayouts(
  rules: LayoutRules,
  options: { readonly layouts?: readonly string[] } | undefined,
): readonly Layout[] {
  const layouts = options?.layouts ?? [];
  return layouts.map((layout, index) => {
    const compiled = compileLayout(rules, layout);
    if ('expression' in compiled) {
      return compiled;
    }
    throw fault(
      layoutRule,
      { arguments: [options], factory: rules.factory, mark: `0.layouts.${String(index)}` },
      compiled,
    );
  });
}

/** A factory's default grammar: what it matches, the schema member it publishes, and its form. */
interface DefaultGrammar {
  readonly expression: RegExp;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly form: string;
}

/**
 * How a factory reads its tokens once its layouts compile: the expressions to try in order, the
 * schema it publishes, and each distinct form its message writes, which is undefined with no
 * layouts, because the default sentence names no form.
 */
interface Reading {
  readonly expressions: readonly RegExp[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly forms: readonly string[] | undefined;
}

/**
 * The reading of a factory call: its default grammar, then each layout it declares. With layouts,
 * it publishes `anyOf` its default schema and each layout's pattern, and writes the default form
 * then each layout's form at its first place. A fault marks the first layout it cannot read.
 */
function readingOf(
  rules: LayoutRules,
  options: { readonly layouts?: readonly string[] } | undefined,
  grammar: DefaultGrammar,
): Reading {
  const layouts = readLayouts(rules, options);
  const expressions = [grammar.expression, ...layouts.map((layout) => layout.expression)];
  if (layouts.length === none) {
    return { expressions, forms: undefined, inputSchema: { type: 'string', ...grammar.schema } };
  }
  return {
    expressions,
    forms: [...new Set([grammar.form, ...layouts.map((layout) => layout.form)])],
    inputSchema: {
      type: 'string',
      anyOf: [grammar.schema, ...layouts.map((layout) => ({ pattern: layout.pattern }))],
    },
  };
}

/**
 * The value the first expression to read the token gives: the default grammar's, then each
 * layout's in order. An expression reads a token when it matches and `read` finds every field in
 * range; otherwise the next is tried.
 */
function firstReading<Value>(
  raw: string,
  expressions: readonly RegExp[],
  read: (groups: Groups) => Value | undefined,
): Value | undefined {
  for (const expression of expressions) {
    const groups = expression.exec(raw)?.groups;
    const value = groups === undefined ? undefined : read(groups);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export { dateRules, dateTimeRules, firstReading, readingOf, timeRules };
