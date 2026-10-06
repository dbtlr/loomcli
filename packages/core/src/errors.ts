import type { StandardSchemaV1 } from '@standard-schema/spec';

import { escapeControlCharacters } from './controls.js';
import { diagnosticText, isDiagnosticRule, valueCode } from './diagnostic-text.js';
import type { DiagnosticParts, DiagnosticRule, Finding } from './diagnostic-text.js';
import { isFailureExitCode } from './exit-codes.js';
import type { FailureExitCode } from './exit-codes.js';
import {
  failureCode,
  failureExitCode,
  foreignThrow,
  foreignThrowCorrection,
  resultContract,
  unconstructedFailure,
} from './rules.js';
import { ignoreRejection, isThenable } from './thenable.js';
import type { InputIdentity } from './types.js';

/** The same subject at the start of a sentence, where a token fault names its Command. */
function routedSentence(command: readonly string[]): string {
  const subject = routedSubject(command);
  return `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`;
}

/** The sentence one results-lane fault reports, which names the Command that holds it. */
function resultMessage(kind: ResultFault, command: readonly string[]): string {
  if (kind === 'missing') {
    return `${routedSentence(command)} declares a result and its action returned without emitting one. Call out.results() once.`;
  }
  if (kind === 'repeated') {
    return `${routedSentence(command)} emitted its result twice. Call out.results() once.`;
  }
  if (kind === 'undeclared') {
    return `${routedSentence(command)} declares no result. Declare one with result() or rows() before action().`;
  }
  const caller = kind === 'source' ? 'A configuration source' : 'A middleware';
  return `${caller} called out.results() on ${routedSubject(command)}. Only the action emits a result.`;
}

/**
 * A value a sentence quotes: raw text an operator typed, or a name or identity an author declared.
 * Text is escaped, so a control character or a bidirectional control in it cannot reorder or break
 * the line. A value of any other kind prints as the code a finding prints for it, because a rule
 * that rejects a value that is not a string quotes that value too. The failure's public field
 * keeps the raw value.
 */
export function quoted(value: unknown): string {
  return typeof value === 'string' ? `"${escapeControlCharacters(value)}"` : valueCode(value);
}

/**
 * The clause that states a routing fault's fix: the candidates, or, when the Command offers none
 * because every child is hidden or deprecated, the kind of name to supply.
 */
function offering(candidates: readonly string[], kind: 'command' | 'subcommand'): string {
  return candidates.length === 0
    ? ` Supply the name of a declared ${kind}.`
    : ` Use one of: ${candidates.join(', ')}.`;
}

/**
 * The sentence for a group routed without a subcommand. The root has no name to repeat, and the
 * default text already opens with the application name, so the root's sentence names no Command.
 */
function nonCallableMessage(command: readonly string[], candidates: readonly string[]): string {
  return command.length === 0
    ? `A command is required.${offering(candidates, 'command')}`
    : `${routedSentence(command)} requires a subcommand.${offering(candidates, 'subcommand')}`;
}

/**
 * The sentence for an option word the routed Command's table does not hold, while visible Commands
 * below it declare it. Each Command reads as its path from the root.
 */
function misplacedMessage(spelling: string, commands: readonly (readonly string[])[]): string {
  const names = commands.map((path) => path.join(' '));
  const [only] = names;
  return names.length === 1 && only !== undefined
    ? `Option ${quoted(spelling)} belongs to command ${quoted(only)}. Supply it after ${quoted(only)}.`
    : `Option ${quoted(spelling)} belongs to commands ${names.join(', ')}. Supply it after the command name.`;
}

/**
 * The sentence for a class whose declared code no failure may exit with. The class is named by its
 * constructor, because the subclass has not yet set the instance's `name`.
 */
function undeclarableSentence(className: string, declared: unknown): string {
  const clause =
    typeof declared === 'number' && Number.isFinite(declared)
      ? `declares exit code ${String(declared)}.`
      : 'declares an exit code that is not a finite number.';
  return `Failure class ${quoted(className)} ${clause}`;
}

/**
 * The one message a distributed build shows an operator for a defect or a declaration fault: the
 * application name and a fixed phrase, with no reason, class name, code, or path.
 */
export function genericDefectText(application: string): string {
  return `${application}: Something went wrong.\n`;
}

/**
 * Whether one failure is only the author's to fix: a declaration fault or a defect. A development
 * build shows the author its Developer Diagnostic; a distributed one shows the generic message.
 */
export function isAuthorFault(failure: LoomError): failure is DeclarationError | InternalError {
  return failure instanceof DeclarationError || failure instanceof InternalError;
}

/**
 * Core's own text for one failure, with the trailing newline every view's text carries. The
 * application name opens every line of a usage failure's message, one line for each problem it
 * reports, so the operator reads who is speaking on each. A declaration fault and a defect read
 * the generic defect message, because only the author can act on their detail, and a development
 * build shows that detail ahead of every view. Every other class writes its message alone, even
 * one that declares a usage error's exit code. It is the default view of every failure class and
 * the text the plain fallback path writes, so it runs no application code and nothing downstream
 * composes its newline.
 */
export function defaultText(failure: LoomError, application: string): string {
  if (failure instanceof UsageError) {
    return failure.message
      .split('\n')
      .map((line) => `${application}: ${line}\n`)
      .join('');
  }
  if (isAuthorFault(failure)) {
    return genericDefectText(application);
  }
  return `${failure.message}\n`;
}

/** How a diagnostic names one Command inside a sentence: by name, or as the unnamed root. */
export function commandSubject(name: string | null): string {
  return name === null ? 'the root Command' : `Command "${name}"`;
}

/** The routed path names the Command a sentence speaks of; an empty path is the root. */
export function routedSubject(command: readonly string[]): string {
  const name = command.at(-1);
  return name === undefined ? 'the root Command' : commandSubject(name);
}

/** The same subject at the start of a sentence. */
export function commandSentence(name: string | null): string {
  const subject = commandSubject(name);
  return `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`;
}

/**
 * The sentence for a class whose declared failure code is outside the grammar. The class is named
 * by its constructor, as the exit code's sentence names it.
 */
function invalidCodeSentence(className: string, declared: unknown): string {
  const clause =
    typeof declared === 'string'
      ? `declares failure code ${quoted(declared)}.`
      : 'declares a failure code that is not a string.';
  return `Failure class ${quoted(className)} ${clause}`;
}

/**
 * The grammar of a failure code: one or more words of lowercase ASCII letters and digits joined by
 * single hyphens, the grammar of the rule name that ends a rule identity.
 */
const failureCodeGrammar = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Whether one declared value is a failure code: a string in the grammar. */
function isFailureCode(value: unknown): value is string {
  return typeof value === 'string' && failureCodeGrammar.test(value);
}

/**
 * One static a failure class declares, read as `run()` reads it: captured at the first construction
 * of the class or of a subclass that declares none, so a static changed afterward cannot give one
 * class a second value. Core's own classes are captured when this module loads, so no write to
 * their statics reaches a failure.
 */
interface ClassStatic<Value> {
  readonly key: 'code' | 'exitCode';
  readonly captured: WeakMap<object, Value>;
  readonly accepts: (value: unknown) => value is Value;
  /** The declaration fault a value outside the static's rule throws, naming the constructed class. */
  readonly fault: (className: string, declared: unknown) => DeclarationError;
}

/** Each failure class's exit code. */
const exitCodeStatic: ClassStatic<FailureExitCode> = {
  accepts: isFailureExitCode,
  captured: new WeakMap(),
  // A class declaration is no call, so no finding stands for it.
  fault: (className, declared) =>
    new DeclarationError(failureExitCode, {
      correction: 'Declare a whole number from 1 through 125.',
      sentence: undeclarableSentence(className, declared),
    }),
  key: 'exitCode',
};

/** Each failure class's failure code. */
const failureCodeStatic: ClassStatic<string> = {
  accepts: isFailureCode,
  captured: new WeakMap(),
  fault: (className, declared) =>
    new DeclarationError(failureCode, {
      correction:
        'Declare a kebab-case code of lowercase letters and digits, such as "registry-down".',
      sentence: invalidCodeSentence(className, declared),
    }),
  key: 'code',
};

/** Each constructed failure's exit code, which its `exitCode` reports and `run()` resolves. */
const exitCodes = new WeakMap<LoomError, FailureExitCode>();

/** Each constructed failure's failure code, which its failure form reports. */
const failureCodes = new WeakMap<LoomError, string>();

/**
 * The value one class declares for a static: the value captured for it, or else its own static when
 * it declares one, or else its parent's. `constructed` names the class the diagnostic reports, the
 * one the failing construction named.
 */
function classStatic<Value>(
  target: object,
  constructed: { readonly name: string },
  read: ClassStatic<Value>,
): Value {
  const captured = read.captured.get(target);
  if (captured !== undefined) {
    return captured;
  }
  const parent = Reflect.getPrototypeOf(target);
  const declared: unknown =
    Object.hasOwn(target, read.key) || parent === null
      ? Reflect.get(target, read.key)
      : classStatic(parent, constructed, read);
  if (!read.accepts(declared)) {
    throw read.fault(constructed.name, declared);
  }
  read.captured.set(target, declared);
  return declared;
}

/**
 * The code a failure exits with. A value that inherits from a failure class without having been
 * constructed holds none, and `toFailure` reports it as an internal error, so it reads 1.
 */
export function exitCodeOf(failure: LoomError): FailureExitCode {
  return exitCodes.get(failure) ?? 1;
}

/**
 * The failure code a failure reports. A value that inherits from a failure class without having
 * been constructed holds none, and `toFailure` reports it as an internal error, so it reads
 * `internal`.
 */
export function failureCodeOf(failure: LoomError): string {
  return failureCodes.get(failure) ?? 'internal';
}

/**
 * Every failure `run()` reports is an instance of a public class. Each class carries the facts its
 * sentence interpolates, so a view reads them instead of parsing prose. The exit code is a static
 * field the class declares, read from the nearest ancestor that declares one and captured at the
 * class's first construction, so one class exits with one code and a projection reads it without
 * an instance. The instance reports the same value through a read-only accessor, and no subclass
 * property or assignment changes the code `run()` resolves. The failure code is a static read the
 * same way, a kebab-case word a machine reader branches on, and it stays on the class: an instance
 * carries no `code` of core's. `message` never carries a category prefix; the default views add it.
 */
export abstract class LoomError extends Error {
  static readonly code: string = 'failure';
  static readonly exitCode: FailureExitCode = 1;

  /**
   * Reads the constructed class's exit code and then its failure code, each captured at its first
   * construction. An exit code outside 1 through 125, or a failure code outside its grammar, throws
   * a `DeclarationError` in place of the failure and captures nothing, because core never clamps or
   * replaces a code. `options` is the platform's own, so a failure that
   * replaces another error keeps it as `cause` only when its author passes one.
   */
  constructor(message: string, options?: ErrorOptions) {
    const exitCode = classStatic(new.target, new.target, exitCodeStatic);
    const code = classStatic(new.target, new.target, failureCodeStatic);
    super(message, options);
    exitCodes.set(this, exitCode);
    failureCodes.set(this, code);
    this.name = 'LoomError';
  }

  /**
   * The code this failure exits with. An accessor without a setter, so a TypeScript subclass cannot
   * declare it as a property, and an assignment throws in strict mode code and is ignored in sloppy
   * mode code.
   */
  get exitCode(): FailureExitCode {
    return exitCodeOf(this);
  }
}

/** Exit 2: the invocation, not the application, is wrong. */
export abstract class UsageError extends LoomError {
  static override readonly code: string = 'usage';
  static override readonly exitCode: FailureExitCode = 2;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UsageError';
  }
}

/** One input the validation phase rejected: an omission, or a value its schema refused. */
export type InputProblem =
  | { input: InputIdentity; spelling: string; reason: 'missing' }
  | {
      input: InputIdentity;
      spelling: string;
      reason: 'invalid';
      issues: readonly StandardSchemaV1.Issue[];
    };

/** The whole validation phase in authoring order, so one failure reports every rejected input. */
export class InputError extends UsageError {
  static override readonly code: string = 'invalid-input';

  readonly problems: readonly InputProblem[];

  constructor(message: string, problems: readonly InputProblem[], options?: ErrorOptions) {
    super(message, options);
    this.name = 'InputError';
    this.problems = problems;
  }
}

export class UnknownCommandError extends UsageError {
  static override readonly code: string = 'unknown-command';

  readonly token: string;
  readonly candidates: readonly string[];

  constructor(token: string, candidates: readonly string[]) {
    super(`Unknown command ${quoted(token)}.${offering(candidates, 'command')}`);
    this.candidates = candidates;
    this.name = 'UnknownCommandError';
    this.token = token;
  }
}

/** A group answers no invocation of its own, so the routed path names no callable Command. */
export class NonCallableCommandError extends UsageError {
  static override readonly code: string = 'missing-subcommand';

  readonly command: readonly string[];
  readonly candidates: readonly string[];

  constructor(command: readonly string[], candidates: readonly string[]) {
    super(nonCallableMessage(command, candidates));
    this.candidates = candidates;
    this.command = command;
    this.name = 'NonCallableCommandError';
  }
}

/**
 * How a run received its inputs: as argv words, or by name through `invoke()`. A sentence about an
 * input a caller named reads the name the caller wrote, because no spelling was typed.
 */
export type InvokedBy = 'argv' | 'name';

export class UnexpectedArgumentError extends UsageError {
  static override readonly code: string = 'unexpected-argument';

  readonly command: readonly string[];
  readonly accepted: number;
  readonly extra: readonly string[];

  constructor(command: readonly string[], accepted: number, extra: readonly string[]) {
    super(
      accepted === 0
        ? `${routedSentence(command)} accepts no arguments. Remove the supplied values.`
        : `${routedSentence(command)} accepts ${accepted} ${accepted === 1 ? 'argument' : 'arguments'}. Remove the extra values.`,
    );
    this.accepted = accepted;
    this.command = command;
    this.extra = extra;
    this.name = 'UnexpectedArgumentError';
  }
}

export class UnknownOptionError extends UsageError {
  static override readonly code: string = 'unknown-option';

  readonly spelling: string;

  constructor(spelling: string) {
    super(
      `Unknown option ${quoted(spelling)}. Supply a declared option; prefix a hyphenated path with "./".`,
    );
    this.name = 'UnknownOptionError';
    this.spelling = spelling;
  }
}

/**
 * The unknown option of an invocation by name: `spelling` holds the key the caller wrote, and the
 * sentence asks for a declared name, because the caller typed no spelling.
 */
export function unknownOptionName(name: string): UnknownOptionError {
  const failure = new UnknownOptionError(name);
  failure.message = `Unknown option ${quoted(name)}. Supply the name of a declared option.`;
  return failure;
}

/**
 * An `args` key the routed Command does not declare, in an invocation by name: `extra` holds the
 * key alone, `accepted` the number of arguments the Command declares, and the sentence names the key.
 */
export function undeclaredArgument(
  command: readonly string[],
  accepted: number,
  name: string,
): UnexpectedArgumentError {
  const failure = new UnexpectedArgumentError(command, accepted, [name]);
  failure.message = `${routedSentence(command)} declares no argument ${quoted(name)}. Supply the name of a declared argument.`;
  return failure;
}

/**
 * Where a missing value should have been: the words ran out, or the next word was an option word or
 * the bare `--`, which is never a separate value, so the sentence names the attached form too.
 */
type MissingValueForm = 'attached' | 'separate';

export class MissingValueError extends UsageError {
  static override readonly code: string = 'missing-value';

  readonly spelling: string;

  constructor(spelling: string, form: MissingValueForm = 'separate') {
    super(
      form === 'attached'
        ? `Option ${quoted(spelling)} requires a value. Supply a value after ${quoted(spelling)}, or attach one that starts with a hyphen as ${quoted(`${spelling}=<value>`)}.`
        : `Option ${quoted(spelling)} requires a value. Supply a value after ${quoted(spelling)}.`,
    );
    this.name = 'MissingValueError';
    this.spelling = spelling;
  }
}

/**
 * A Boolean or counted spelling takes no value, so the token carried one the declaration cannot
 * accept. A counted option's sentence tells the operator to repeat the spelling instead, and `kind`
 * chooses the sentence alone.
 */
export class UnexpectedValueError extends UsageError {
  static override readonly code: string = 'unexpected-value';

  readonly spelling: string;
  readonly value: string;

  constructor(spelling: string, value: string, kind: 'boolean' | 'count' = 'boolean') {
    super(
      kind === 'count'
        ? `Counted option ${quoted(spelling)} does not accept a value. Repeat ${quoted(spelling)} to raise its count.`
        : `Boolean option ${quoted(spelling)} does not accept a value. Supply the flag alone.`,
    );
    this.name = 'UnexpectedValueError';
    this.spelling = spelling;
    this.value = value;
  }
}

export class RepeatedOptionError extends UsageError {
  static override readonly code: string = 'repeated-option';

  readonly spelling: string;

  constructor(spelling: string) {
    super(`Option ${quoted(spelling)} can be supplied only once. Remove the repeated option.`);
    this.name = 'RepeatedOptionError';
    this.spelling = spelling;
  }
}

/**
 * An option word the Command routing reached does not declare, while a visible Command below it
 * does, such as a Command's own option typed before its name, or a parent's own option the routed
 * Command declares with another value class. `commands` holds each such Command's path from the
 * root, in authoring order.
 */
export class MisplacedOptionError extends UsageError {
  static override readonly code: string = 'misplaced-option';

  readonly spelling: string;
  readonly commands: readonly (readonly string[])[];

  constructor(spelling: string, commands: readonly (readonly string[])[]) {
    super(misplacedMessage(spelling, commands));
    this.commands = commands;
    this.name = 'MisplacedOptionError';
    this.spelling = spelling;
  }
}

/** The platform's error options one value carries, read without trusting its shape. */
function errorOptions(value: unknown): ErrorOptions | undefined {
  return typeof value === 'object' && value !== null && 'cause' in value
    ? { cause: value.cause }
    : undefined;
}

/** A correction as a caller supplied it: one sentence, a copied list of them, or none. */
function readCorrection(value: unknown): string | readonly string[] | undefined {
  if (typeof value === 'string') {
    return value;
  }
  return Array.isArray(value)
    ? Object.freeze(value.filter((fix): fix is string => typeof fix === 'string'))
    : undefined;
}

/** The findings a caller supplied, copied into a frozen list, or none for a value that holds none. */
function readFindings(value: unknown): readonly Finding[] {
  return Object.freeze(Array.isArray(value) ? value.filter(isFinding) : []);
}

/** Whether one value is a finding a diagnostic can print: an object naming its call and arguments. */
function isFinding(value: unknown): value is Finding {
  return (
    typeof value === 'object' &&
    value !== null &&
    'call' in value &&
    typeof value.call === 'string' &&
    'arguments' in value &&
    Array.isArray(value.arguments)
  );
}

/**
 * The parts one fault carries, read from what its constructor received. A rule is a descriptor
 * `diagnosticRule()` built; any other first argument is the sentence of a fault with no rule. A
 * JavaScript caller reaches the constructor with any values, so each part is read by its shape.
 */
interface FaultParts {
  rule: DiagnosticRule | undefined;
  sentence: string;
  findings: readonly Finding[];
  correction: string | readonly string[] | undefined;
  options: ErrorOptions | undefined;
}

function faultParts(first: unknown, second: unknown, third: unknown): FaultParts {
  if (!isDiagnosticRule(first)) {
    return {
      correction: undefined,
      findings: Object.freeze([]),
      options: errorOptions(second),
      rule: undefined,
      sentence: String(first),
    };
  }
  const parts: Partial<Record<keyof DiagnosticParts, unknown>> =
    typeof second === 'object' && second !== null ? { ...second } : {};
  return {
    correction: readCorrection(parts.correction),
    findings: readFindings(parts.findings),
    options: errorOptions(third),
    rule: first,
    sentence: String(parts.sentence),
  };
}

/**
 * Exit 1: the declaration is wrong, so the author reads its Developer Diagnostic. A rule and the
 * fault's own parts build it, or a sentence alone does for a fault with no rule. `message` holds
 * the whole diagnostic as plain text at 80 columns, so a fault thrown at an authoring call prints
 * it through the runtime's own uncaught-error output, and `sentence` holds the sentence alone.
 */
export class DeclarationError extends LoomError {
  static override readonly code: string = 'internal';

  readonly rule: DiagnosticRule | undefined;
  readonly sentence: string;
  readonly findings: readonly Finding[];
  readonly correction: string | readonly string[] | undefined;

  constructor(rule: DiagnosticRule, parts: DiagnosticParts, options?: ErrorOptions);
  constructor(sentence: string, options?: ErrorOptions);
  constructor(
    first: DiagnosticRule | string,
    second?: DiagnosticParts | ErrorOptions,
    third?: ErrorOptions,
  ) {
    const parts = faultParts(first, second, third);
    super(
      diagnosticText({ ...parts, evidence: [], fallback: 'INVALID DECLARATION' }),
      parts.options,
    );
    this.name = 'DeclarationError';
    this.rule = parts.rule;
    this.sentence = parts.sentence;
    this.findings = parts.findings;
    this.correction = parts.correction;
  }
}

/**
 * Exit 1: the application ended the invocation itself. An application may subclass it, and the
 * subclass may declare its own exit code.
 */
export class FatalError extends LoomError {
  static override readonly code: string = 'fatal';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FatalError';
  }
}

/**
 * Exit 1: a defect, such as an unexpected exception, a non-error throw, or a view that could not
 * answer. A rule and the defect's own parts build it, or a sentence and the thrown value do for a
 * defect with no rule. `message` stays the sentence, because only `run()` reports a defect, and a
 * development build renders its Developer Diagnostic from the parts.
 */
export class InternalError extends LoomError {
  static override readonly code: string = 'internal';

  readonly cause: unknown;
  readonly rule: DiagnosticRule | undefined;
  readonly sentence: string;
  readonly correction: string | readonly string[] | undefined;

  constructor(
    rule: DiagnosticRule,
    parts: Omit<DiagnosticParts, 'findings'> & { readonly cause: unknown },
  );
  constructor(message: string, cause: unknown);
  constructor(
    first: DiagnosticRule | string,
    // The rule form's parts or the sentence form's thrown value, read by shape below.
    second: unknown,
  ) {
    const parts = faultParts(first, second, undefined);
    super(parts.sentence);
    this.cause = parts.rule === undefined ? second : errorOptions(second)?.cause;
    this.name = 'InternalError';
    this.rule = parts.rule;
    this.sentence = parts.sentence;
    this.correction = parts.correction;
  }
}

/** The five ways the results lane is broken, each named where core meets it. */
export type ResultFault = 'missing' | 'repeated' | 'undeclared' | 'middleware' | 'source';

/**
 * Exit 1: the promise a declared result makes was not kept. It wraps no thrown value, so its
 * `cause` is `undefined`, and it extends `InternalError`, so an override of that class brands it
 * and its default text carries the same prefix, while an override keyed by this class reaches it
 * alone.
 */
export class ResultError extends InternalError {
  readonly path: readonly string[];
  readonly kind: ResultFault;
  declare readonly cause: undefined;

  constructor(kind: ResultFault, path: readonly string[]) {
    super(resultContract, { cause: undefined, sentence: resultMessage(kind, path) });
    this.kind = kind;
    this.name = 'ResultError';
    this.path = path;
  }
}

/**
 * One message someone else wrote, as a sentence of its own. A schema or a plugin writes its message
 * with or without a full stop, so a diagnostic supplies one only where the message carries none.
 */
export function asSentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/**
 * What a diagnostic says about an unexpected value, whether or not it was an Error, with every
 * control character escaped. A `DeclarationError` answers its sentence, because its message holds
 * its whole diagnostic. Every sentence that quotes a thrown value reads it here, so a reason stays
 * on one line and no bidirectional control reaches a terminal, whichever rule's sentence carries
 * it, while the author's words around it keep their line breaks. Reading it never throws: an Error
 * whose message is not a string or cannot be read, and a value whose prototype cannot be read, such
 * as a proxy whose trap throws, answer one fixed sentence.
 */
export function reasonOf(thrown: unknown): string {
  return escapeControlCharacters(rawReasonOf(thrown));
}

/** The thrown value's reason as it was written, read without throwing. */
function rawReasonOf(thrown: unknown): string {
  const unreadableReason = 'The thrown value has no readable message.';
  try {
    if (!(thrown instanceof Error)) {
      return 'An unknown error occurred.';
    }
    if (thrown instanceof DeclarationError) {
      return thrown.sentence;
    }
    const { message }: { message: unknown } = thrown;
    return typeof message === 'string' ? message : unreadableReason;
  } catch {
    return unreadableReason;
  }
}

/**
 * Why a returned value is not the text a view or a failure encoder owes. Each is synchronous, so a
 * returned promise is a non-string return like any other: it receives a rejection handler and is
 * otherwise ignored.
 */
export function notTextReason(subject: 'encoder' | 'view', value: unknown): string {
  if (isThenable(value)) {
    ignoreRejection(value);
  }
  return `The ${subject} returned ${typeof value} instead of a string.`;
}

/**
 * Whether a thrown value is a failure class by its prototype chain, read defensively, because a
 * revoked proxy or a proxy whose prototype trap throws answers no chain. Such a value is foreign.
 */
function isLoomError(thrown: unknown): thrown is LoomError {
  try {
    return thrown instanceof LoomError;
  } catch {
    return false;
  }
}

/**
 * Every thrown value reaches reporting as a failure class; anything else is internal. A value that
 * inherits from a failure class without having been constructed holds no code, so it is internal
 * too.
 */
export function toFailure(thrown: unknown): LoomError {
  if (!isLoomError(thrown)) {
    return foreignFailure(thrown);
  }
  return exitCodes.has(thrown)
    ? thrown
    : new InternalError(unconstructedFailure, {
        cause: thrown,
        correction: 'Construct the failure with new before throwing it.',
        sentence: 'A thrown value inherits from a failure class but was never constructed as one.',
      });
}

/**
 * The defect a foreign throw reports: its reason as the sentence, and the thrown value as the
 * cause a development build's diagnostic shows.
 */
export function foreignFailure(thrown: unknown): InternalError {
  return new InternalError(foreignThrow, {
    cause: thrown,
    correction: foreignThrowCorrection,
    sentence: reasonOf(thrown),
  });
}

// Core's own classes are captured now, before any application code can write their statics.
for (const Class of [
  LoomError,
  UsageError,
  InputError,
  UnknownCommandError,
  NonCallableCommandError,
  UnexpectedArgumentError,
  UnknownOptionError,
  MissingValueError,
  UnexpectedValueError,
  RepeatedOptionError,
  MisplacedOptionError,
  DeclarationError,
  FatalError,
  InternalError,
  ResultError,
]) {
  exitCodeStatic.captured.set(Class, Class.exitCode);
  failureCodeStatic.captured.set(Class, Class.code);
}
