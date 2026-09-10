import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { InputIdentity, Renderer } from './types.js';

/** The routed path names the Command a token fault belongs to; an empty path is the root. */
function routedSentence(command: readonly string[]): string {
  const name = command.at(-1);
  return name === undefined ? 'The root Command' : commandSentence(name);
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
 * the trailing newline every renderer's text carries. The four categories are disjoint branches of
 * the hierarchy, so one ordered test reads every class, and a class without a prefix of its own
 * writes the sentence alone. A default rendering is the same kind of value as a custom one, so
 * nothing downstream composes the newline for it.
 */
function defaultText(failure: LoomError): string {
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

/** Every prototype in a failure's chain, most derived first, so one walk reads the registry. */
function chainOf(failure: LoomError): unknown[] {
  const chain: unknown[] = [];
  let prototype: unknown = Object.getPrototypeOf(failure);
  while (prototype !== null) {
    chain.push(prototype);
    prototype = Object.getPrototypeOf(prototype);
  }
  return chain;
}

/** One registration: the class it names, read as the prototype and the name that class holds. */
interface Registration {
  name: string;
  prototype: unknown;
  render: (failure: LoomError) => unknown;
}

/** Authored registrations register here, so the public type publishes nothing to reach. */
const nodes = new WeakMap<object, Registration>();

/** Phantom key. It marks a failure registration and holds no runtime value. */
declare const failureRegistration: unique symbol;

/** The runtime value `renderFailure` returns. Its pair lives in the registry above. */
class RegisteredFailure {
  declare readonly [failureRegistration]: true;

  constructor(registration: Registration) {
    nodes.set(this, registration);
  }
}

/** Reads the pair behind a registered value; anything else is a declaration error. */
function nodeOf(value: object, subject: string): Registration {
  const registration = nodes.get(value);
  if (!registration) {
    throw new DeclarationError(
      `${subject} holds a value that is not a failure renderer. Supply the value returned by renderFailure(type, renderer).`,
    );
  }
  return registration;
}

/** How a diagnostic names one Command inside a sentence: by name, or as the unnamed root. */
export function commandSubject(name: string | null): string {
  return name === null ? 'the root Command' : `Command "${name}"`;
}

/** The same subject at the start of a sentence. */
export function commandSentence(name: string | null): string {
  const subject = commandSubject(name);
  return `${subject.slice(0, 1).toUpperCase()}${subject.slice(1)}`;
}

/**
 * Every failure `run()` reports is an instance of a public class. Each class carries the facts its
 * sentence interpolates, so a renderer reads them instead of parsing prose, and the exit status is
 * a field of the base, so a subclass inherits it. `message` never carries a category prefix; the
 * default renderers add it.
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

/** Exit 1: an unexpected exception, a non-error throw, or a renderer that could not answer. */
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
 * Why a returned value is not the text a renderer owes. A renderer is synchronous, so a returned
 * promise is a non-string return like any other, and its rejection is adopted and swallowed here:
 * an unobserved rejection would end the process before the invocation could report anything.
 */
export function notTextReason(value: unknown): string {
  void Promise.resolve(value).catch(() => undefined);
  return `The renderer returned ${typeof value} instead of a string.`;
}

/** Every thrown value reaches reporting as a failure class; anything else is internal. */
export function toFailure(thrown: unknown): LoomError {
  return thrown instanceof LoomError ? thrown : new InternalError(reasonOf(thrown), thrown);
}

/** An opaque registration pairing one failure class with a renderer for its instances. */
export type FailureRenderer = Pick<RegisteredFailure, typeof failureRegistration>;

/**
 * A registration pairing one failure class with a renderer for its instances. The helper is the
 * typed path for a class-keyed list, because an array literal cannot carry a different type
 * parameter per element.
 */
export function renderFailure<Failure extends LoomError>(
  type: abstract new (...args: never[]) => Failure,
  renderer: Renderer<Failure>,
): FailureRenderer {
  return new RegisteredFailure({
    name: 'name' in type && typeof type.name === 'string' ? type.name : 'a failure class',
    prototype: 'prototype' in type ? type.prototype : undefined,
    // Resolution reaches this registration through the same class, so the test always holds.
    render: (failure) => (failure instanceof type ? renderer.render(failure) : undefined),
  });
}

/** The renderers one application registered, keyed by the class each one names. */
export type FailureRegistry = ReadonlyMap<unknown, Registration>;

/**
 * One class answers to one renderer inside one contributor, so a second registration for it is a
 * declaration fault. The subject names the contributor: the Application, or an installed plugin.
 */
export function buildFailures(
  failures: readonly FailureRenderer[],
  subject = 'The Application',
): FailureRegistry {
  const registry = new Map<unknown, Registration>();
  for (const failure of failures) {
    const registration = nodeOf(failure, subject);
    if (registry.has(registration.prototype)) {
      throw new DeclarationError(
        `${subject} registers two failure renderers for "${registration.name}". Remove one registration.`,
      );
    }
    registry.set(registration.prototype, registration);
  }
  return registry;
}

/**
 * One registry from every contributor's own, resolving first-in-wins: the application's
 * registrations, then each installed plugin's in installation order, then core's text.
 */
export function mergeFailures(registries: readonly FailureRegistry[]): FailureRegistry {
  const merged = new Map<unknown, Registration>();
  for (const registry of registries) {
    for (const [type, registration] of registry) {
      if (!merged.has(type)) {
        merged.set(type, registration);
      }
    }
  }
  return merged;
}

/**
 * The report of one failure: the text core writes, and whether a registered renderer produced it.
 * An unrendered report carries core's own text, which the plain fallback path writes beside the
 * diagnostic naming the renderer that could not answer.
 */
export type FailureReport =
  | { kind: 'rendered'; text: string }
  | { kind: 'unrendered'; text: string; reason: string };

/**
 * The text core writes for one failure. Resolution walks the failure's prototype chain most
 * derived first through the application's registrations, then falls to core's own text, so a
 * registration for a base class brands every failure below it.
 */
export function describeFailure(registry: FailureRegistry, failure: LoomError): FailureReport {
  const registration = chainOf(failure)
    .map((prototype) => registry.get(prototype))
    .find((entry) => entry !== undefined);
  if (!registration) {
    return { kind: 'rendered', text: defaultText(failure) };
  }
  try {
    const text = registration.render(failure);
    return typeof text === 'string'
      ? { kind: 'rendered', text }
      : { kind: 'unrendered', reason: notTextReason(text), text: defaultText(failure) };
  } catch (error) {
    return { kind: 'unrendered', reason: reasonOf(error), text: defaultText(failure) };
  }
}
