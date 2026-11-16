/*
 * The reader every package's voice test shares, under ADR-0164. It reads a package's message
 * modules, the files named `messages.ts` under its `src`, with a small scanner of its own, and
 * scans the package's other source files for the gathering check. It builds no type-checked
 * program: a message module holds functions, constants, imports, and types, and the scanner reads
 * its comments, string literals, and template literals exactly.
 */
import { readdir, readFile } from 'node:fs/promises';

/**
 * One of the four checks a voice test holds over a package's sources.
 *
 * @example
 * ```ts
 * const check: VoiceCheck = 'escaping';
 * ```
 */
type VoiceCheck = 'banned-words' | 'escaping' | 'gathering' | 'outside-text';

/**
 * One known exception: the reason it holds, and how many sites in the file have its source text.
 *
 * @example
 * ```ts
 * const pin: VoicePin = { reason: 'A declared name holds no control character.', sites: 2 };
 * ```
 */
interface VoicePin {
  readonly reason: string;
  readonly sites: number;
}

/**
 * A package's known exceptions: for each check, the files under the package's `src` that hold one,
 * by path under `src`, and in each file the source text of each excepted site with its pin.
 *
 * @example
 * ```ts
 * const exceptions: VoiceExceptions = {
 *   escaping: {
 *     'inputs/messages.ts': {
 *       '${issueSentence}': { reason: "A validator's sentence, repeated by design.", sites: 1 },
 *     },
 *   },
 * };
 * ```
 */
type VoiceExceptions = Readonly<
  Partial<Record<VoiceCheck, Readonly<Record<string, Readonly<Record<string, VoicePin>>>>>>
>;

/**
 * One site a check reports: the check, the file by path under `src`, and the site's source text.
 * The text is the literal for the banned words and gathering, the whole `${...}` for escaping, and
 * the member read, such as `error.message`, for outside text.
 *
 * @example
 * ```ts
 * const site: VoiceSite = { check: 'escaping', file: 'inputs/messages.ts', text: '${name}' };
 * ```
 */
interface VoiceSite {
  readonly check: VoiceCheck;
  readonly file: string;
  readonly text: string;
}

/**
 * The routes beyond failure constructors and out calls by which one package's sentences reach an
 * operator, which the gathering check also reads: calls of the named functions, or of a named
 * member on a named receiver, such as `run.line`; assignments to the named variables or members;
 * object members by the named keys; the named error classes, such as JavaScript's own `Error`,
 * counted as failure constructors; the `return` statements and concise arrow bodies inside the
 * arguments of a call of the named functions, such as the `loom` bin's `report`, which prints what
 * its work returns; and the same inside the body of a function declared with a name in `functions`,
 * whose returned text such a call prints.
 *
 * @example
 * ```ts
 * const sinks: VoiceSinks = { assignments: ['issue'], calls: ['rpcError', 'run.line'] };
 * ```
 */
interface VoiceSinks {
  readonly assignments?: readonly string[];
  readonly calls?: readonly string[];
  readonly classes?: readonly string[];
  readonly functions?: readonly string[];
  readonly properties?: readonly string[];
  readonly returns?: readonly string[];
}

/**
 * What the checks read beside the sources: the banned words, and the package's own sinks.
 *
 * @example
 * ```ts
 * const options: VoiceOptions = { banned: ['presentation'] };
 * ```
 */
interface VoiceOptions {
  readonly banned: readonly string[];
  readonly sinks?: VoiceSinks;
}

/** One token of TypeScript source, comments dropped. A template holds its parts. */
type Token =
  | { readonly kind: 'identifier' | 'number' | 'punctuator' | 'pattern'; readonly text: string }
  | { readonly kind: 'string'; readonly text: string; readonly value: string }
  | {
      readonly kind: 'template';
      readonly text: string;
      readonly quasis: readonly string[];
      readonly expressions: readonly Interpolation[];
    };

/** One `${...}` of a template: its source text and its tokens. */
interface Interpolation {
  readonly text: string;
  readonly tokens: readonly Token[];
}

/** Whether `/` outside a literal may open a pattern, or must open a comment. */
type ScanMode = 'message-module' | 'source';

/** The punctuators the scanner reads, longest first so each matches whole. */
const punctuators = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '%=',
  '&=',
  '|=',
  '^=',
  '**',
  '<<',
  '>>',
];

/** The keywords after which a `/` opens a pattern rather than a division. */
const patternKeywords = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

/** The escaping helpers core exports, which rule 5 accepts around any value. */
const escapingHelpers = new Set(['escapeControlCharacters', 'quoted']);

/** The members rule 6 bars a message module from reading. */
const outsideMembers = new Set(['cause', 'message', 'stack']);

/** The out calls the gathering check reads. */
const outCalls = new Set(['debug', 'error', 'fatal', 'info', 'print', 'success', 'trace', 'warn']);

/** JavaScript's own error classes, which are no failure constructor unless a package names one. */
const platformErrors = new Set([
  'AggregateError',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]);

const identifierStart = /[\p{ID_Start}$_#]/u;
const identifierPart = /[\p{ID_Continue}$‌‍]/u;
const digit = /[0-9]/u;
const numberPart = /[\w.]/u;

/** Reads one file's tokens, keeping the offset of a `/` a message module may not hold. */
class Scanner {
  position = 0;
  readonly source: string;
  readonly mode: ScanMode;
  readonly file: string;

  constructor(source: string, mode: ScanMode, file: string) {
    this.source = source;
    this.mode = mode;
    this.file = file;
  }

  /** The tokens up to the end of the source, or up to the `}` that closes an interpolation. */
  tokens(interpolation: boolean): Token[] {
    const found: Token[] = [];
    let depth = 0;
    const { source } = this;
    while (this.position < source.length) {
      const character = source[this.position] ?? '';
      const next = source[this.position + 1] ?? '';
      if (/\s/u.test(character)) {
        this.position += 1;
      } else if (character === '/' && next === '/') {
        const end = source.indexOf('\n', this.position);
        this.position = end === -1 ? source.length : end;
      } else if (character === '/' && next === '*') {
        const end = source.indexOf('*/', this.position + 2);
        this.position = end === -1 ? source.length : end + 2;
      } else if (interpolation && character === '}' && depth === 0) {
        this.position += 1;
        return found;
      } else if (character === "'" || character === '"') {
        found.push(this.string(character));
      } else if (character === '`') {
        found.push(this.template());
      } else if (character === '/') {
        found.push(this.slash(found.at(-1)));
      } else if (identifierStart.test(character)) {
        found.push({ kind: 'identifier', text: this.run(identifierPart, 1) });
      } else if (digit.test(character) || (character === '.' && digit.test(next))) {
        found.push({ kind: 'number', text: this.run(numberPart, 1) });
      } else {
        const text = punctuators.find((candidate) => source.startsWith(candidate, this.position));
        const token: Token = { kind: 'punctuator', text: text ?? character };
        depth += token.text === '{' || token.text === '}' ? depthChange(token) : 0;
        this.position += token.text.length;
        found.push(token);
      }
    }
    if (interpolation) {
      throw new Error(`${this.file}: an interpolation is not closed.`);
    }
    return found;
  }

  /** The characters from the current one while each matches, after `skip` characters taken whole. */
  run(pattern: RegExp, skip: number): string {
    const start = this.position;
    this.position += skip;
    while (this.position < this.source.length && pattern.test(this.source[this.position] ?? '')) {
      this.position += 1;
    }
    return this.source.slice(start, this.position);
  }

  string(quote: string): Token {
    const start = this.position;
    this.position += 1;
    while (this.position < this.source.length && this.source[this.position] !== quote) {
      this.position += this.source[this.position] === '\\' ? 2 : 1;
    }
    this.position += 1;
    const text = this.source.slice(start, this.position);
    return { kind: 'string', text, value: text.slice(1, -1) };
  }

  template(): Token {
    const start = this.position;
    const quasis: string[] = [];
    const expressions: Interpolation[] = [];
    let quasi = '';
    this.position += 1;
    while (this.position < this.source.length) {
      const character = this.source[this.position] ?? '';
      if (character === '\\') {
        quasi += this.source.slice(this.position, this.position + 2);
        this.position += 2;
      } else if (character === '`') {
        this.position += 1;
        break;
      } else if (character === '$' && this.source[this.position + 1] === '{') {
        quasis.push(quasi);
        quasi = '';
        const opened = this.position;
        this.position += 2;
        const tokens = this.tokens(true);
        expressions.push({ text: this.source.slice(opened, this.position), tokens });
      } else {
        quasi += character;
        this.position += 1;
      }
    }
    quasis.push(quasi);
    return { expressions, kind: 'template', quasis, text: this.source.slice(start, this.position) };
  }

  /**
   * A `/` that opens no comment. A message module holds none, so the scanner never has to tell a
   * pattern from a quotient there. Elsewhere the token before it decides, as a JavaScript parser's
   * own lookahead-free rule does: after a value it divides, and after an operator it opens a pattern.
   */
  slash(previous: Token | undefined): Token {
    if (this.mode === 'message-module') {
      throw new Error(
        `${this.file}: a message module holds no division and no pattern, at offset ${String(this.position)}.`,
      );
    }
    if (!opensPattern(previous)) {
      const text = this.source[this.position + 1] === '=' ? '/=' : '/';
      this.position += text.length;
      return { kind: 'punctuator', text };
    }
    const start = this.position;
    let inClass = false;
    this.position += 1;
    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (character === '\\') {
        this.position += 2;
      } else {
        this.position += 1;
        if (character === '[') {
          inClass = true;
        } else if (character === ']') {
          inClass = false;
        } else if (character === '/' && !inClass) {
          break;
        }
      }
    }
    this.run(/[a-z]/u, 0);
    return { kind: 'pattern', text: this.source.slice(start, this.position) };
  }
}

/** Whether a `/` after this token opens a pattern. */
function opensPattern(previous: Token | undefined): boolean {
  if (previous === undefined) {
    return true;
  }
  if (previous.kind === 'punctuator') {
    return ![')', ']', '}'].includes(previous.text);
  }
  return previous.kind === 'identifier' && patternKeywords.has(previous.text);
}

/** Whether one token is the punctuator `text`. */
function is(token: Token | undefined, text: string): boolean {
  return token?.kind === 'punctuator' && token.text === text;
}

/** Whether one token is the identifier `text`. */
function named(token: Token | undefined, text?: string): boolean {
  return token?.kind === 'identifier' && (text === undefined || token.text === text);
}

/** How one punctuator changes the bracket depth. */
function depthChange(token: Token): number {
  if (token.kind !== 'punctuator') {
    return 0;
  }
  if (['(', '[', '{'].includes(token.text)) {
    return 1;
  }
  return [')', ']', '}'].includes(token.text) ? -1 : 0;
}

/** The index of the bracket that closes the one at `open`, or the last index when none does. */
function closing(tokens: readonly Token[], open: number): number {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index];
    depth += token === undefined ? 0 : depthChange(token);
    if (depth === 0) {
      return index;
    }
  }
  return tokens.length - 1;
}

/** The tokens split at each comma outside brackets. */
function splitTopLevel(tokens: readonly Token[], separators: readonly string[]): Token[][] {
  const parts: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (depth === 0 && token.kind === 'punctuator' && separators.includes(token.text)) {
      parts.push([]);
    } else {
      depth += depthChange(token);
      parts.at(-1)?.push(token);
    }
  }
  return parts.filter((part) => part.length > 0);
}

/** Whether the tokens are exactly the type `number`. */
function isNumberType(tokens: readonly Token[]): boolean {
  return tokens.length === 1 && named(tokens[0], 'number');
}

/** The members an inline object type declares as `number`. */
function numberMembers(tokens: readonly Token[]): Set<string> {
  const numbers = new Set<string>();
  for (const member of splitTopLevel(tokens, [';', ','])) {
    const parts = named(member[0], 'readonly') ? member.slice(1) : member;
    const colon = parts.findIndex((token) => is(token, ':'));
    const [name] = parts;
    if (name?.kind === 'identifier' && colon !== -1 && isNumberType(parts.slice(colon + 1))) {
      numbers.add(name.text);
    }
  }
  return numbers;
}

/**
 * The parameters of one parameter list that are numbers: one declared `name: number`, and one
 * destructured from an object whose inline type declares its member as `number`.
 */
function numberParameters(tokens: readonly Token[]): Set<string> {
  const numbers = new Set<string>();
  for (const parameter of splitTopLevel(tokens, [','])) {
    const [first, second] = parameter;
    if (first?.kind === 'identifier') {
      const colon = is(second, '?') ? 2 : 1;
      if (is(parameter[colon], ':') && isNumberType(parameter.slice(colon + 1))) {
        numbers.add(first.text);
      }
    } else if (is(first, '{')) {
      const end = closing(parameter, 0);
      const typed = parameter.slice(end + 1);
      const members =
        is(typed[0], ':') && is(typed[1], '{') ? numberMembers(typed.slice(2, -1)) : [];
      for (const element of splitTopLevel(parameter.slice(1, end), [','])) {
        const local = is(element[1], ':') ? element[2] : element[0];
        const [key] = element;
        if (key?.kind === 'identifier' && local?.kind === 'identifier') {
          if ([...members].includes(key.text)) {
            numbers.add(local.text);
          }
        }
      }
    }
  }
  return numbers;
}

/** One module-level declaration of a message module, by the range of tokens it spans. */
interface Declaration {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly callable: boolean;
  readonly alias: string | undefined;
  readonly numbers: ReadonlySet<string>;
}

/** The keywords that open a module-level declaration. */
const declarationKeywords = new Set([
  'class',
  'const',
  'function',
  'import',
  'interface',
  'let',
  'type',
  'var',
]);

/** The start of every module-level declaration, by token index. */
function declarationStarts(tokens: readonly Token[]): number[] {
  const starts: number[] = [];
  let depth = 0;
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    if (
      depth === 0 &&
      token.kind === 'identifier' &&
      declarationKeywords.has(token.text) &&
      !is(previous, '.') &&
      !is(previous, '?.') &&
      named(tokens[index + 1])
    ) {
      starts.push(index);
    }
    depth += depthChange(token);
  });
  return starts;
}

/** What one declaration binds: a function with its number parameters, an alias, or a value. */
function declarationOf(tokens: readonly Token[], start: number, end: number): Declaration {
  const keyword = tokens[start];
  const name = tokens[start + 1]?.text ?? '';
  const base = { alias: undefined, callable: false, end, name, numbers: new Set<string>(), start };
  const parameters = (open: number): Declaration => ({
    ...base,
    callable: true,
    numbers: numberParameters(tokens.slice(open + 1, closing(tokens, open))),
  });
  if (named(keyword, 'function')) {
    const open = tokens.findIndex((token, index) => index > start && is(token, '('));
    return parameters(open);
  }
  if (!named(keyword, 'const') && !named(keyword, 'let') && !named(keyword, 'var')) {
    return base;
  }
  let value = start + 2;
  while (value < end && !is(tokens[value], '=')) {
    value += 1;
  }
  value += named(tokens[value + 1], 'async') ? 2 : 1;
  const first = tokens[value];
  if (named(first, 'function')) {
    return parameters(value + 1);
  }
  if (is(first, '(')) {
    const close = closing(tokens, value);
    const arrow = tokens.slice(close + 1, end).findIndex((token) => is(token, '=>'));
    return arrow === -1 ? base : parameters(value);
  }
  if (named(first) && is(tokens[value + 1], '=>')) {
    return { ...base, callable: true };
  }
  const alias = named(first) && value + 1 >= end - (is(tokens[end - 1], ';') ? 1 : 0);
  return alias ? { ...base, alias: first?.text } : base;
}

/** The names a message module imports from another message module of its package. */
function messageImports(tokens: readonly Token[]): Set<string> {
  const names = new Set<string>();
  tokens.forEach((token, index) => {
    if (!named(token, 'import')) {
      return;
    }
    const open = tokens.findIndex((candidate, at) => at > index && is(candidate, '{'));
    const from = tokens.findIndex((candidate, at) => at > index && named(candidate, 'from'));
    const path = tokens[from + 1];
    if (
      open === -1 ||
      from < open ||
      path?.kind !== 'string' ||
      !path.value.endsWith('messages.js')
    ) {
      return;
    }
    for (const specifier of splitTopLevel(tokens.slice(open + 1, closing(tokens, open)), [','])) {
      const local = specifier.at(-1);
      if (local?.kind === 'identifier' && !named(specifier[0], 'type')) {
        names.add(local.text);
      }
    }
  });
  return names;
}

/** What rule 5 reads about one message module: its callables and its declarations' ranges. */
interface ModuleScope {
  readonly callables: ReadonlySet<string>;
  readonly declarations: readonly Declaration[];
}

/** The modifiers that open a declaration before its keyword. */
const modifiers = new Set(['async', 'declare', 'default', 'export']);

/** Where one declaration's range ends: before the next one's keyword and its modifiers. */
function rangeEnd(tokens: readonly Token[], next: number): number {
  let end = next;
  while (end > 0 && named(tokens[end - 1]) && modifiers.has(tokens[end - 1]?.text ?? '')) {
    end -= 1;
  }
  return end;
}

function moduleScope(tokens: readonly Token[]): ModuleScope {
  const starts = declarationStarts(tokens);
  const declarations = starts.map((start, index) =>
    declarationOf(tokens, start, rangeEnd(tokens, starts[index + 1] ?? tokens.length)),
  );
  const callables = new Set([
    ...messageImports(tokens),
    ...declarations.filter((declaration) => declaration.callable).map(({ name }) => name),
  ]);
  for (const declaration of declarations) {
    const { alias } = declaration;
    if (alias !== undefined && (callables.has(alias) || escapingHelpers.has(alias))) {
      callables.add(declaration.name);
    }
  }
  return { callables, declarations };
}

/** The tokens without the parentheses that wrap all of them. */
function unwrapped(tokens: readonly Token[]): readonly Token[] {
  let inner = tokens;
  while (is(inner[0], '(') && closing(inner, 0) === inner.length - 1) {
    inner = inner.slice(1, -1);
  }
  return inner;
}

/** The two branches of a conditional expression, or `undefined` when the tokens hold none. */
function branches(tokens: readonly Token[]): [Token[], Token[]] | undefined {
  let depth = 0;
  let question = -1;
  let nested = 0;
  for (const [index, token] of tokens.entries()) {
    if (depth === 0 && is(token, '?')) {
      if (question === -1) {
        question = index;
      } else {
        nested += 1;
      }
    } else if (depth === 0 && question !== -1 && is(token, ':')) {
      if (nested === 0) {
        return [tokens.slice(question + 1, index), tokens.slice(index + 1)];
      }
      nested -= 1;
    }
    depth += depthChange(token);
  }
  return undefined;
}

/** Whether the tokens are one call of `callee` whose parentheses close at the last token. */
function callOf(tokens: readonly Token[], callee: number): boolean {
  return is(tokens[callee + 1], '(') && closing(tokens, callee + 1) === tokens.length - 1;
}

/** Whether one receiver is a style: a name `style`, or one that ends in `Style`. */
function isStyle(token: Token | undefined): boolean {
  return token?.kind === 'identifier' && (token.text === 'style' || token.text.endsWith('Style'));
}

/** Whether an interpolation repeats a value only as rule 5 allows. */
function escapes(
  expression: readonly Token[],
  scope: ModuleScope,
  numbers: ReadonlySet<string>,
): boolean {
  const tokens = unwrapped(expression);
  const split = branches(tokens);
  if (split) {
    return split.every((branch) => escapes(branch, scope, numbers));
  }
  const [first] = tokens;
  if (tokens.length === 1) {
    return (
      first?.kind === 'string' ||
      first?.kind === 'template' ||
      (first?.kind === 'identifier' && numbers.has(first.text))
    );
  }
  if (first?.kind !== 'identifier') {
    return false;
  }
  if (callOf(tokens, 0)) {
    if (first.text === 'String') {
      const argument = tokens.slice(2, -1);
      return argument.length === 1 && named(argument[0]) && numbers.has(argument[0]?.text ?? '');
    }
    return escapingHelpers.has(first.text) || scope.callables.has(first.text);
  }
  const helper = tokens[4];
  return (
    isStyle(first) &&
    is(tokens[1], '.') &&
    named(tokens[2], 'escape') &&
    callOf(tokens, 2) &&
    helper?.kind === 'identifier' &&
    escapingHelpers.has(helper.text) &&
    callOf(tokens.slice(0, -1), 4)
  );
}

/**
 * Every template among the tokens, nested ones included, in source order, except a template inside
 * an escaping helper's arguments, which the helper escapes whole.
 */
function* templates(tokens: readonly Token[]): Generator<Token & { kind: 'template' }> {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token?.kind === 'identifier' &&
      escapingHelpers.has(token.text) &&
      is(tokens[index + 1], '(')
    ) {
      index = closing(tokens, index + 1);
    } else if (token?.kind === 'template') {
      yield token;
      for (const expression of token.expressions) {
        yield* templates(expression.tokens);
      }
    }
  }
}

/** Every string and template literal among the tokens, nested ones included. */
function* literals(tokens: readonly Token[]): Generator<Token> {
  for (const token of tokens) {
    if (token.kind === 'string') {
      yield token;
    } else if (token.kind === 'template') {
      yield token;
      for (const expression of token.expressions) {
        yield* literals(expression.tokens);
      }
    }
  }
}

/** The literal text of one literal: a string's value, or a template's text between interpolations. */
function literalText(token: Token): string {
  if (token.kind === 'string') {
    return token.value;
  }
  return token.kind === 'template' ? token.quasis.join('') : '';
}

function escapeForPattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** The banned-words sites of one message module: each literal that holds a banned word. */
function bannedSites(tokens: readonly Token[], banned: readonly string[]): string[] {
  const patterns = banned.map(
    (word) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeForPattern(word)}`, 'iu'),
  );
  return [...literals(tokens)]
    .filter((token) => patterns.some((pattern) => pattern.test(literalText(token))))
    .map((token) => token.text);
}

/** The escaping sites of one message module: each interpolation rule 5 does not allow. */
function escapingSites(tokens: readonly Token[]): string[] {
  const scope = moduleScope(tokens);
  const sites: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token?.kind === 'identifier' &&
      escapingHelpers.has(token.text) &&
      is(tokens[index + 1], '(')
    ) {
      // A template among an escaping helper's arguments is escaped whole, as `templates` reads it.
      index = closing(tokens, index + 1);
    } else if (token?.kind === 'template') {
      const holder = scope.declarations.find(({ end, start }) => index >= start && index < end);
      const numbers = holder?.numbers ?? new Set<string>();
      for (const template of templates([token])) {
        for (const expression of template.expressions) {
          if (!escapes(expression.tokens, scope, numbers)) {
            sites.push(expression.text);
          }
        }
      }
    }
  }
  return sites;
}

/** The outside-text sites among the tokens: each read of a member rule 6 bars. */
function outsideSites(tokens: readonly Token[]): string[] {
  const sites: string[] = [];
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const receiver = previous?.kind === 'identifier' ? previous.text : '';
    const member = tokens[index + 1];
    if (
      (is(token, '.') || is(token, '?.')) &&
      named(member) &&
      outsideMembers.has(member?.text ?? '')
    ) {
      sites.push(`${receiver}${token.text}${member?.text ?? ''}`);
    }
    const closer = tokens[index + 2];
    if (
      is(token, '[') &&
      member?.kind === 'string' &&
      outsideMembers.has(member.value) &&
      is(closer, ']')
    ) {
      sites.push(`${receiver}${token.text}${member.text}]`);
    }
    if (token.kind === 'template') {
      for (const expression of token.expressions) {
        sites.push(...outsideSites(expression.tokens));
      }
    }
  });
  return sites;
}

/** The literal sentences among one sink's tokens, outside any bracket: a literal whose text holds a space. */
function sentences(tokens: readonly Token[]): string[] {
  const found: string[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (depth === 0 && (token.kind === 'string' || token.kind === 'template')) {
      const inner =
        token.kind === 'template'
          ? token.expressions.flatMap((expression) => sentences(expression.tokens))
          : [];
      if (literalText(token).includes(' ') || inner.length > 0) {
        found.push(token.text);
      }
    }
    depth += depthChange(token);
  }
  return found;
}

/** The literal sentences a function body's tokens return: a `return` value or a concise arrow body. */
function returnedSentences(tokens: readonly Token[]): string[] {
  let depth = 0;
  return tokens.flatMap((token, at) => {
    const own = depth === 0;
    depth += depthChange(token);
    // A concise arrow counts only outside any bracket, so it is the argument itself, not one nested in it.
    if (named(token, 'return') || (own && is(token, '=>') && !is(tokens[at + 1], '{'))) {
      return sentences(valueAfter(tokens, at + 1));
    }
    return [];
  });
}

/** Whether a `{` after a function's parameters opens its body, not an object type of its return type. */
function opensBody(tokens: readonly Token[], at: number): boolean {
  const before = tokens[at - 1];
  return (
    is(tokens[at], '{') &&
    !(before?.kind === 'punctuator' && [':', '<', '|', '&', ',', '('].includes(before.text))
  );
}

/**
 * The tokens of the body of the function a name at `index` declares, either `function name(...) {}`
 * or `name = (...) => ...`, or none when the name declares neither.
 */
function bodyDeclaredAt(tokens: readonly Token[], index: number): readonly Token[] {
  const next = tokens[index + 1];
  if (named(tokens[index - 1], 'function') && is(next, '(')) {
    const open = tokens.findIndex(
      (candidate, at) =>
        at > closing(tokens, index + 1) && is(candidate, '{') && opensBody(tokens, at),
    );
    return open === -1 ? [] : tokens.slice(open + 1, closing(tokens, open));
  }
  if (is(next, '=')) {
    const arrow = tokens.findIndex(
      (candidate, at) => at > index && (is(candidate, '=>') || is(candidate, ';')),
    );
    if (arrow === -1 || !is(tokens[arrow], '=>')) {
      return [];
    }
    return is(tokens[arrow + 1], '{')
      ? tokens.slice(arrow + 2, closing(tokens, arrow + 1))
      : tokens.slice(arrow, arrow + 1 + valueAfter(tokens, arrow + 1).length);
  }
  return [];
}

/** The tokens of an assigned or member value: up to the comma, semicolon, or bracket that ends it. */
function valueAfter(tokens: readonly Token[], start: number): readonly Token[] {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (depth === 0 && (is(token, ',') || is(token, ';'))) {
      return tokens.slice(start, index);
    }
    depth += depthChange(token);
    if (depth < 0) {
      return tokens.slice(start, index);
    }
  }
  return tokens.slice(start);
}

/** The token ranges of every class that extends a class whose name ends in `Error`. */
function failureClassBodies(tokens: readonly Token[]): [number, number][] {
  const bodies: [number, number][] = [];
  tokens.forEach((token, index) => {
    if (!named(token, 'class') || is(tokens[index - 1], '.')) {
      return;
    }
    const open = tokens.findIndex((candidate, at) => at > index && is(candidate, '{'));
    const heading = tokens.slice(index, open);
    const base = heading[heading.findIndex((candidate) => named(candidate, 'extends')) + 1];
    if (
      open !== -1 &&
      named(heading.at(1)) &&
      base?.kind === 'identifier' &&
      base.text.endsWith('Error') &&
      heading.some((candidate) => named(candidate, 'extends'))
    ) {
      bodies.push([open, closing(tokens, open)]);
    }
  });
  return bodies;
}

/** The gathering sites of one source file that is not a message module. */
function gatheringSites(tokens: readonly Token[], sinks: VoiceSinks): string[] {
  const classes = new Set<string>(sinks.classes);
  const calls = new Set<string>(sinks.calls);
  const assignments = new Set(['message', ...(sinks.assignments ?? [])]);
  const properties = new Set<string>(sinks.properties);
  const returns = new Set<string>(sinks.returns);
  const functions = new Set<string>(sinks.functions);
  const bodies = failureClassBodies(tokens);
  const sites: string[] = [];
  const argumentsAt = (open: number) => sentences(tokens.slice(open + 1, closing(tokens, open)));
  const returnedAt = (open: number) =>
    returnedSentences(tokens.slice(open + 1, closing(tokens, open)));
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    const member = is(previous, '.') || is(previous, '?.');
    if (named(token, 'new') && named(next) && is(tokens[index + 2], '(')) {
      const name = next?.text ?? '';
      if (classes.has(name) || (name.endsWith('Error') && !platformErrors.has(name))) {
        sites.push(...argumentsAt(index + 2));
      }
    } else if (named(token, 'super') && is(next, '(')) {
      if (bodies.some(([start, end]) => index > start && index < end)) {
        sites.push(...argumentsAt(index + 1));
      }
    } else if (token.kind === 'identifier' && is(next, '(') && !named(previous, 'function')) {
      const receiver = tokens[index - 2];
      const outCall =
        member && outCalls.has(token.text) && !isStyle(receiver) && !named(receiver, 'log');
      const memberCall =
        member && receiver?.kind === 'identifier' && calls.has(`${receiver.text}.${token.text}`);
      if (outCall || memberCall || (!member && calls.has(token.text))) {
        sites.push(...argumentsAt(index + 1));
      }
      if (!member && returns.has(token.text)) {
        sites.push(...returnedAt(index + 1));
      }
    } else if (token.kind === 'identifier' && is(next, '=')) {
      const assigned = token.text === 'message' ? member : true;
      if (assigned && assignments.has(token.text)) {
        sites.push(...sentences(valueAfter(tokens, index + 2)));
      }
    } else if (
      token.kind === 'identifier' &&
      is(next, ':') &&
      properties.has(token.text) &&
      (is(previous, '{') || is(previous, ','))
    ) {
      sites.push(...sentences(valueAfter(tokens, index + 2)));
    }
    if (token.kind === 'identifier' && functions.has(token.text)) {
      sites.push(...returnedSentences(bodyDeclaredAt(tokens, index)));
    }
    if (token.kind === 'template') {
      for (const expression of token.expressions) {
        sites.push(...gatheringSites(expression.tokens, sinks));
      }
    }
  });
  return sites;
}

/** Whether one path under `src` names a message module. */
function isMessageModule(path: string): boolean {
  return path === 'messages.ts' || path.endsWith('/messages.ts');
}

/**
 * Every site the four checks report over one package's sources, by path under its `src`: the
 * banned words, escaping, and outside text over its message modules, and gathering over every other
 * file. A message module that holds a `/` outside a comment or a literal throws.
 *
 * @example
 * ```ts
 * const sites = voiceSites(new Map([['inputs/messages.ts', source]]), { banned: ['presentation'] });
 * ```
 */
function voiceSites(files: ReadonlyMap<string, string>, options: VoiceOptions): VoiceSite[] {
  const sites: VoiceSite[] = [];
  const add = (check: VoiceCheck, file: string, texts: readonly string[]) => {
    sites.push(...texts.map((text) => ({ check, file, text })));
  };
  for (const [file, source] of [...files].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (isMessageModule(file)) {
      const tokens = new Scanner(source, 'message-module', file).tokens(false);
      add('banned-words', file, bannedSites(tokens, options.banned));
      add('escaping', file, escapingSites(tokens));
      add('outside-text', file, outsideSites(tokens));
    } else {
      const tokens = new Scanner(source, 'source', file).tokens(false);
      add('gathering', file, gatheringSites(tokens, options.sinks ?? {}));
    }
  }
  return sites;
}

/**
 * One line for each site no pin covers, each pin whose count of sites differs from the sites found,
 * and each pin that covers no site, sorted. A voice test expects it to be empty.
 *
 * @example
 * ```ts
 * expect(unpinnedSites(voiceSites(files, options), exceptions)).toEqual([]);
 * ```
 */
function unpinnedSites(sites: readonly VoiceSite[], exceptions: VoiceExceptions): string[] {
  const counts = new Map<string, { site: VoiceSite; found: number }>();
  const key = (site: VoiceSite) => JSON.stringify([site.check, site.file, site.text]);
  for (const site of sites) {
    const entry = counts.get(key(site)) ?? { found: 0, site };
    counts.set(key(site), { ...entry, found: entry.found + 1 });
  }
  const lines: string[] = [];
  for (const [check, files] of Object.entries(exceptions)) {
    for (const [file, pins] of Object.entries(files ?? {})) {
      for (const [text, pin] of Object.entries(pins)) {
        const site: VoiceSite = { check: checkOf(check), file, text };
        const found = counts.get(key(site))?.found ?? 0;
        counts.delete(key(site));
        if (found !== pin.sites) {
          lines.push(
            `${check} ${file}: ${text} has ${plural(found)} and its pin names ${String(pin.sites)}.`,
          );
        }
      }
    }
  }
  for (const { found, site } of counts.values()) {
    lines.push(`${site.check} ${site.file}: ${site.text} has ${plural(found)} and no pin.`);
  }
  return lines.toSorted();
}

/** A count of sites, as a report line names it. */
function plural(count: number): string {
  return count === 1 ? '1 site' : `${String(count)} sites`;
}

const checks: readonly VoiceCheck[] = ['banned-words', 'escaping', 'gathering', 'outside-text'];

/** The check one key of the exceptions names, read through the list of checks. */
function checkOf(name: string): VoiceCheck {
  const found = checks.find((check) => check === name);
  if (found === undefined) {
    throw new Error(`The exceptions name no check ${name}.`);
  }
  return found;
}

/**
 * The banned words a voice page lists: the first column of the table under its `Banned words`
 * heading, each word without its backticks.
 *
 * @example
 * ```ts
 * bannedWordsOf('### Banned words\n\n| Do not write | Write |\n| --- | --- |\n| `presentation` | view |');
 * // ['presentation']
 * ```
 */
function bannedWordsOf(markdown: string): string[] {
  const start = markdown.indexOf('\n### Banned words\n');
  if (start === -1) {
    throw new Error('The voice page has no Banned words section.');
  }
  const section = markdown.slice(start + 1).split(/\n#{1,6} /u)[0] ?? '';
  const rows = section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
  const [header, , ...body] = rows;
  if (header?.[0] !== 'Do not write' || header[1] !== 'Write') {
    throw new Error('The Banned words table has no "Do not write" and "Write" columns.');
  }
  return body.map(([word]) => (word ?? '').replaceAll('`', ''));
}

/** The voice page, which holds the banned-word table. */
const voicePage = new URL('../docs/core/failures.md', import.meta.url);

/**
 * The banned words of [Failure message voice](../docs/core/failures.md#banned-words), read from the
 * page, so a test that calls it reads docs/ and carries the `docs` tag.
 *
 * @example
 * ```ts
 * const banned = await readBannedWords(); // ['presentation']
 * ```
 */
async function readBannedWords(): Promise<string[]> {
  return bannedWordsOf(await readFile(voicePage, 'utf8'));
}

/**
 * Every TypeScript source file under one package's `src`, by path under `src`.
 *
 * @example
 * ```ts
 * const files = await packageSources(new URL('../src/', import.meta.url));
 * ```
 */
async function packageSources(src: URL): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await readdir(src, { recursive: true });
  for (const entry of entries.filter((path) => path.endsWith('.ts')).toSorted()) {
    files.set(entry.replaceAll('\\', '/'), await readFile(new URL(entry, src), 'utf8'));
  }
  return files;
}

/**
 * What one package's voice test asserts is empty: every unpinned site and stale pin of the four
 * checks over the package's `src`, with the banned words read from the voice page.
 *
 * @example
 * ```ts
 * test('every operator sentence keeps the voice', async () => {
 *   expect(await voiceReport(new URL('../src/', import.meta.url), exceptions)).toEqual([]);
 * });
 * ```
 */
async function voiceReport(
  src: URL,
  exceptions: VoiceExceptions,
  sinks?: VoiceSinks,
): Promise<string[]> {
  const options = { banned: await readBannedWords(), ...(sinks ? { sinks } : {}) };
  return unpinnedSites(voiceSites(await packageSources(src), options), exceptions);
}

export type { VoiceCheck, VoiceExceptions, VoiceOptions, VoicePin, VoiceSinks, VoiceSite };
export { bannedWordsOf, packageSources, readBannedWords, unpinnedSites, voiceReport, voiceSites };
