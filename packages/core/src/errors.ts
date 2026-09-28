import type { StandardSchemaV1 } from '@standard-schema/spec';

import { escapeControlCharacters } from './controls.js';
import { isFailureExitCode } from './exit-codes.js';
import type { FailureExitCode } from './exit-codes.js';
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
 * Raw text an operator typed, quoted inside a sentence. It is escaped, so a control character or a
 * bidirectional control in a token cannot reorder or break the line. The failure's public field
 * keeps the raw value.
 */
function quoted(text: string): string {
  return `"${escapeControlCharacters(text)}"`;
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
 * The two short-group faults. A value option that is not last in its group names that option's
 * spelling; a group that mixes scopes names only the two letters that disagree, because the rest
 * of the group may hold an inline value. `token` keeps the whole group as the reported fact.
 */
type ShortGroupFault =
  | { reason: 'value-position'; token: string }
  | { reason: 'mixed-scope'; token: string; global: string; other: string };

function shortGroupMessage(fault: ShortGroupFault): string {
  return fault.reason === 'value-position'
    ? `Value option ${quoted(fault.token)} must be last in its short group. Supply its value in the next token.`
    : `A short group mixes the global option ${quoted(`-${fault.global}`)} with ${quoted(`-${fault.other}`)}, which is not a global option. Supply global options as separate tokens, and local options after their command name.`;
}

/**
 * The sentence for a class whose declared code no failure may exit with. The class is named by its
 * constructor, because the subclass has not yet set the instance's `name`.
 */
function undeclarableMessage(className: string, declared: unknown): string {
  const clause =
    typeof declared === 'number' && Number.isFinite(declared)
      ? `declares exit code ${String(declared)}.`
      : 'declares an exit code that is not a finite number.';
  return `Failure class "${className}" ${clause} Declare a whole number from 1 through 125; 0 means success, and 126 and above belong to the shell and to signals.`;
}

/**
 * Core's own text for one failure: its message under the prefix its class carries, with the
 * trailing newline every view's text carries. The application name opens every line of a usage
 * failure's message, one line for each problem it reports, so the operator reads who is speaking
 * on each; the declaration and internal categories keep their category prefixes on the first
 * line. The four categories are disjoint branches of the hierarchy, so one ordered test reads every
 * class, and a class without a prefix of its own writes the sentence alone, even when it declares a
 * usage error's exit code. It is the default view of every failure class and the text
 * the plain fallback path writes, so it runs no application code and nothing downstream composes
 * its newline.
 */
export function defaultText(failure: LoomError, application: string): string {
  if (failure instanceof UsageError) {
    return failure.message
      .split('\n')
      .map((line) => `${application}: ${line}\n`)
      .join('');
  }
  if (failure instanceof DeclarationError) {
    return `Invalid declaration: ${failure.message}\n`;
  }
  if (failure instanceof InternalError) {
    return `Internal error: ${failure.message}\n`;
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
 * Each failure class's code, captured at the first construction of the class or of a subclass that
 * declares none, so a static changed afterward cannot give one class a second code. Core's own
 * classes are captured when this module loads, so no write to their statics reaches a failure.
 */
const classCodes = new WeakMap<object, FailureExitCode>();

/** Each constructed failure's code, which its `exitCode` reports and `run()` resolves. */
const failureCodes = new WeakMap<LoomError, FailureExitCode>();

/**
 * The code one class exits with: the code captured for it, or else its own static when it declares
 * one, or else its parent's. `constructed` names the class the diagnostic reports, the one the
 * failing construction named.
 */
function classCode(target: object, constructed: { readonly name: string }): FailureExitCode {
  const captured = classCodes.get(target);
  if (captured !== undefined) {
    return captured;
  }
  const parent = Reflect.getPrototypeOf(target);
  const declared: unknown =
    Object.hasOwn(target, 'exitCode') || parent === null
      ? Reflect.get(target, 'exitCode')
      : classCode(parent, constructed);
  if (!isFailureExitCode(declared)) {
    throw new DeclarationError(undeclarableMessage(constructed.name, declared));
  }
  classCodes.set(target, declared);
  return declared;
}

/**
 * The code a failure exits with. A value that inherits from a failure class without having been
 * constructed holds none, and `toFailure` reports it as an internal error, so it reads 1.
 */
export function exitCodeOf(failure: LoomError): FailureExitCode {
  return failureCodes.get(failure) ?? 1;
}

/**
 * Every failure `run()` reports is an instance of a public class. Each class carries the facts its
 * sentence interpolates, so a view reads them instead of parsing prose. The exit code is a static
 * field the class declares, read from the nearest ancestor that declares one and captured at the
 * class's first construction, so one class exits with one code and a projection reads it without
 * an instance. The instance reports the same value through a read-only accessor, and no subclass
 * property or assignment changes the code `run()` resolves. `message` never carries a category
 * prefix; the default views add it.
 */
export abstract class LoomError extends Error {
  static readonly exitCode: FailureExitCode = 1;

  /**
   * Reads the constructed class's code, captured at its first construction. A code outside 1
   * through 125 throws a `DeclarationError` in place of the failure and captures nothing, because
   * core never clamps or replaces a code.
   */
  constructor(message: string) {
    const code = classCode(new.target, new.target);
    super(message);
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
  static override readonly exitCode: FailureExitCode = 2;

  constructor(message: string) {
    super(message);
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
  readonly problems: readonly InputProblem[];

  constructor(message: string, problems: readonly InputProblem[]) {
    super(message);
    this.name = 'InputError';
    this.problems = problems;
  }
}

export class UnknownCommandError extends UsageError {
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
  readonly command: readonly string[];
  readonly candidates: readonly string[];

  constructor(command: readonly string[], candidates: readonly string[]) {
    super(nonCallableMessage(command, candidates));
    this.candidates = candidates;
    this.command = command;
    this.name = 'NonCallableCommandError';
  }
}

export class UnexpectedArgumentError extends UsageError {
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
  readonly spelling: string;

  constructor(spelling: string) {
    super(
      `Unknown option ${quoted(spelling)}. Supply a declared option; prefix a hyphenated path with "./".`,
    );
    this.name = 'UnknownOptionError';
    this.spelling = spelling;
  }
}

export class MissingValueError extends UsageError {
  readonly spelling: string;

  constructor(spelling: string) {
    super(`Option ${quoted(spelling)} requires a value. Supply a value after ${quoted(spelling)}.`);
    this.name = 'MissingValueError';
    this.spelling = spelling;
  }
}

/** A Boolean spelling takes no value, so the token carried one the declaration cannot accept. */
export class UnexpectedValueError extends UsageError {
  readonly spelling: string;
  readonly value: string;

  constructor(spelling: string, value: string) {
    super(`Boolean option ${quoted(spelling)} does not accept a value. Supply the flag alone.`);
    this.name = 'UnexpectedValueError';
    this.spelling = spelling;
    this.value = value;
  }
}

export class RepeatedOptionError extends UsageError {
  readonly spelling: string;

  constructor(spelling: string) {
    super(`Option ${quoted(spelling)} can be supplied only once. Remove the repeated option.`);
    this.name = 'RepeatedOptionError';
    this.spelling = spelling;
  }
}

export class ShortGroupError extends UsageError {
  readonly token: string;
  readonly reason: 'value-position' | 'mixed-scope';

  constructor(fault: ShortGroupFault) {
    super(shortGroupMessage(fault));
    this.name = 'ShortGroupError';
    this.reason = fault.reason;
    this.token = fault.token;
  }
}

/** Exit 1: the declaration is wrong, so the author reads the diagnostic. */
export class DeclarationError extends LoomError {
  constructor(message: string) {
    super(message);
    this.name = 'DeclarationError';
  }
}

/**
 * Exit 1: the application ended the invocation itself. An application may subclass it, and the
 * subclass may declare its own exit code.
 */
export class FatalError extends LoomError {
  constructor(message: string) {
    super(message);
    this.name = 'FatalError';
  }
}

/** Exit 1: an unexpected exception, a non-error throw, or a view that could not answer. */
export class InternalError extends LoomError {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
    this.name = 'InternalError';
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
    super(resultMessage(kind, path), undefined);
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
 * What a diagnostic says about an unexpected value, whether or not it was an Error. Reading it never
 * throws: an Error whose message is not a string or cannot be read, and a value whose prototype
 * cannot be read, such as a proxy whose trap throws, answer one fixed sentence.
 */
export function reasonOf(thrown: unknown): string {
  const unreadableReason = 'The thrown value has no readable message.';
  try {
    if (!(thrown instanceof Error)) {
      return 'An unknown error occurred.';
    }
    const { message }: { message: unknown } = thrown;
    return typeof message === 'string' ? message : unreadableReason;
  } catch {
    return unreadableReason;
  }
}

/**
 * Why a returned value is not the text a view owes. A view is synchronous, so a returned promise is
 * a non-string return like any other: it receives a rejection handler and is otherwise ignored.
 */
export function notTextReason(value: unknown): string {
  if (isThenable(value)) {
    ignoreRejection(value);
  }
  return `The view returned ${typeof value} instead of a string.`;
}

/**
 * Every thrown value reaches reporting as a failure class; anything else is internal. A value that
 * inherits from a failure class without having been constructed holds no code, so it is internal
 * too.
 */
export function toFailure(thrown: unknown): LoomError {
  if (!(thrown instanceof LoomError)) {
    return new InternalError(reasonOf(thrown), thrown);
  }
  return failureCodes.has(thrown)
    ? thrown
    : new InternalError(
        'A thrown value inherits from a failure class but was never constructed as one.',
        thrown,
      );
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
  ShortGroupError,
  DeclarationError,
  FatalError,
  InternalError,
  ResultError,
]) {
  classCodes.set(Class, Class.exitCode);
}
