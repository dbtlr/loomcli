import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { InputIdentity } from './types.js';

/** The same subject at the start of a sentence, where a token fault names its Command. */
function routedSentence(command: readonly string[]): string {
  const subject = routedSubject(command);
  return `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`;
}

/**
 * The clause that offers the candidates, which is absent when there are none: every child of the
 * Command is hidden, so the diagnostic ends after the sentence that names the fault.
 */
function offering(candidates: readonly string[]): string {
  return candidates.length === 0 ? '' : ` Use one of: ${candidates.join(', ')}.`;
}

/**
 * The two short-group faults. A value option that is not last in its group names that option's
 * spelling; a group that mixes scopes names the whole group and the two letters that disagree.
 * The extra letters shape the sentence alone, so `token` and `reason` are the reported facts.
 */
type ShortGroupFault =
  | { reason: 'value-position'; token: string }
  | { reason: 'mixed-scope'; token: string; global: string; other: string };

function shortGroupMessage(fault: ShortGroupFault): string {
  return fault.reason === 'value-position'
    ? `Value option "${fault.token}" must be last in its short group. Supply its value in the next token.`
    : `Short group "${fault.token}" mixes the global option "-${fault.global}" with "-${fault.other}", which is not a global option. Supply global options as separate tokens, and local options after their command name.`;
}

/**
 * Core's own text for one failure: its message under the category prefix its class carries, with
 * the trailing newline every view's text carries. The four categories are disjoint branches of the
 * hierarchy, so one ordered test reads every class, and a class without a prefix of its own writes
 * the sentence alone. It is the default view of every failure class and the text the plain
 * fallback path writes, so it runs no application code and nothing downstream composes its newline.
 */
export function defaultText(failure: LoomError): string {
  if (failure instanceof UsageError) {
    return `Invalid input: ${failure.message}\n`;
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
 * Every failure `run()` reports is an instance of a public class. Each class carries the facts its
 * sentence interpolates, so a view reads them instead of parsing prose, and the exit status is
 * a field of the base, so a subclass inherits it. `message` never carries a category prefix; the
 * default views add it.
 */
export abstract class LoomError extends Error {
  readonly exitCode: 1 | 2;

  constructor(message: string, exitCode: 1 | 2) {
    super(message);
    this.exitCode = exitCode;
    this.name = 'LoomError';
  }
}

/** Exit 2: the invocation, not the application, is wrong. */
export abstract class UsageError extends LoomError {
  constructor(message: string) {
    super(message, 2);
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
    super(`Unknown command "${token}".${offering(candidates)}`);
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
    super(`${routedSentence(command)} requires a subcommand.${offering(candidates)}`);
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
      `Unknown option "${spelling}". Supply a declared option; prefix a hyphenated path with "./".`,
    );
    this.name = 'UnknownOptionError';
    this.spelling = spelling;
  }
}

export class MissingValueError extends UsageError {
  readonly spelling: string;

  constructor(spelling: string) {
    super(`Option "${spelling}" requires a value. Supply a value after "${spelling}".`);
    this.name = 'MissingValueError';
    this.spelling = spelling;
  }
}

/** A Boolean spelling takes no value, so the token carried one the declaration cannot accept. */
export class UnexpectedValueError extends UsageError {
  readonly spelling: string;
  readonly value: string;

  constructor(spelling: string, value: string) {
    super(`Boolean option "${spelling}" does not accept a value. Supply the flag alone.`);
    this.name = 'UnexpectedValueError';
    this.spelling = spelling;
    this.value = value;
  }
}

export class RepeatedOptionError extends UsageError {
  readonly spelling: string;

  constructor(spelling: string) {
    super(`Option "${spelling}" can be supplied only once. Remove the repeated option.`);
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
    super(message, 1);
    this.name = 'DeclarationError';
  }
}

/** Exit 1: the application ended the invocation itself. An application may subclass it. */
export class FatalError extends LoomError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'FatalError';
  }
}

/** Exit 1: an unexpected exception, a non-error throw, or a view that could not answer. */
export class InternalError extends LoomError {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message, 1);
    this.cause = cause;
    this.name = 'InternalError';
  }
}

/** What a diagnostic says about an unexpected value, whether or not it was an Error. */
export function reasonOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : 'An unknown error occurred.';
}

/**
 * Why a returned value is not the text a view owes. A view is synchronous, so a returned promise is
 * a non-string return like any other, and its rejection is adopted and swallowed here: an
 * unobserved rejection would end the process before the invocation could report anything.
 */
export function notTextReason(value: unknown): string {
  void Promise.resolve(value).catch(() => undefined);
  return `The view returned ${typeof value} instead of a string.`;
}

/** Every thrown value reaches reporting as a failure class; anything else is internal. */
export function toFailure(thrown: unknown): LoomError {
  return thrown instanceof LoomError ? thrown : new InternalError(reasonOf(thrown), thrown);
}
