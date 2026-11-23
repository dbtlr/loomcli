import { isAbsolute } from 'node:path';

import { frozenValues } from '../commands/globals.js';
import { isProseLine } from '../diagnostics/facts.js';
import {
  foreignThrow,
  foreignThrowCorrection,
  sourceAnswers,
  sourceAnswersCorrection,
} from '../diagnostics/rules.js';
import {
  asSentence,
  foreignFailure,
  InternalError,
  LoomError,
  reasonOf,
} from '../failures/errors.js';
import type { InvokedBy } from '../failures/errors.js';
import { quoted } from '../failures/wording.js';
import type { Host } from '../host/types.js';
import type { CommandGraph, OptionNode } from '../inspection/inspect.js';
import type { LogBinder } from '../output/log.js';
import type { Out } from '../output/types.js';
import { carriesBinding } from '../plugins/extension.js';
import type { ExtensionRecords } from '../plugins/extension.js';
import { loadDefault, pluginSentence } from '../plugins/plugin.js';
import type { BuiltPlugin, BuiltSource, SourceContext } from '../plugins/plugin.js';
import type { ContextualStyle } from '../style/style.js';
import { isPlainObject } from '../support/plain.js';
import { envNames } from './bindings.js';
import type { OptionInput, Provenance } from './declarations.js';
import { absentBooleans, claims, losingMembers } from './option-groups.js';
import type { OptionGroup, Tier } from './option-groups.js';
import { arityOf, isSupplied, withdrawFill } from './options.js';
import type { OptionValues } from './options.js';
import type { Validation } from './validation.js';

/**
 * One scope the stage fills: its options in declaration order, and the values argv supplied them.
 * The stage writes each fill into `values`, so the caller hands it the run's own copy.
 */
interface StageScope {
  global: boolean;
  inputs: readonly OptionInput[];
  values: OptionValues;
}

/** Everything one input-source stage reads. */
interface SourceStage {
  extensions: ExtensionRecords;
  /** The globals table: the application's global options, then each plugin's in install order. */
  globals: StageScope;
  /** The routed Command's option groups, which decide a member by the highest tier that supplies one. */
  groups: readonly OptionGroup[];
  host: Host;
  /** The graph `inspect()` would return for the run, built on its first read. */
  inspected: () => CommandGraph;
  /** Gives the source its `log`, bound to the plugin that declared it. */
  log: LogBinder;
  /** How the run received its inputs, which the source reads to name an option as core does. */
  invokedBy: InvokedBy;
  /** The routed Command's own options, or `undefined` while local parsing holds a fault. */
  locals: StageScope | undefined;
  /** Offers the resolver's foreign throw to the translators, ahead of the plugin-fault wrap. */
  offer: (thrown: unknown) => LoomError | undefined;
  /** The channel a source writes through, whose results call names the source. */
  out: Out;
  plugins: readonly BuiltPlugin[];
  /** The `OptionNode` of one option, read from the graph `inspect()` would return for the run. */
  request: (input: OptionInput, global: boolean) => OptionNode;
  signal: AbortSignal;
  /** The contextual style an action receives, so a source escapes raw data before it warns. */
  style: ContextualStyle;
  /**
   * Validates the listed options alone, from the values the stage has filled so far, with what the
   * environment tier found about them, under the context every validator of the run reads. A
   * configuration source's own options pass through it before the source loads, and the run's
   * ledger keeps what that pass settled, which the run's later passes read.
   */
  validate: (inputs: readonly OptionInput[], provenance: Provenance) => Promise<Validation>;
}

/**
 * What the stage found beside the values it filled. `labels` names where each filled option's value
 * came from, by option name, and `rejected` names the variable of each Boolean or counted option
 * whose value is outside its grammar. Both are internal to core's failure messages. `fault` is a configuration
 * source's own fault, or the failure its resolver threw, which stops the stage and takes the place
 * of every validation problem.
 */
interface SourceOutcome extends Provenance {
  fault: LoomError | undefined;
}

/** The Boolean grammar a bound variable is read through: the whole value, case-insensitive. */
const truths: ReadonlyMap<string, boolean> = new Map([
  ['0', false],
  ['1', true],
  ['false', false],
  ['n', false],
  ['no', false],
  ['off', false],
  ['on', true],
  ['true', true],
  ['y', true],
  ['yes', true],
]);

/**
 * The raw value an option takes: a string, a Boolean, a count, a list for a multiple option, or
 * the tuples of an arity option's occurrences, one for a scalar option.
 */
type RawFill =
  | string
  | boolean
  | number
  | readonly string[]
  | { readonly tuples: readonly (readonly string[])[] };

/** What one variable holds under the environment rules: a fill, or a value outside the grammar. */
type VariableReading = { kind: 'fill'; value: RawFill } | { kind: 'rejected' };

/** The count grammar a bound variable is read through: the whole value, one or more ASCII digits. */
const countText = /^[0-9]+$/u;

/** The reading of the first variable that holds a value, and that variable, or unset. */
type NamedReading = { reading: VariableReading; variable: string } | undefined;

/**
 * Reads one option's bound variables in list order. The first variable holding a non-empty value
 * supplies the option, and an empty variable is unset and falls through to the next, unless a
 * string option's binding declares `envAllowEmpty`, under which the first defined variable supplies
 * the option, its value empty or not. A string
 * option receives the raw string, never its implied value, and a multiple option receives the
 * list its declared delimiter splits the raw string into, every item kept. An arity option's value
 * splits the same way and must give exactly its count of items. A Boolean option reads the whole value
 * through the grammar, so the value states the option's value and not a spelling, and a counted
 * option reads the whole value as decimal digits. A value outside the grammar stops at its
 * variable and never falls through.
 */
function readVariable(input: OptionInput, env: Host['env']): NamedReading {
  const allowEmpty = input.config.envAllowEmpty === true;
  const variable = envNames(input.config).find((name) => {
    const raw = Object.hasOwn(env, name) ? env[name] : undefined;
    return raw !== undefined && (allowEmpty || raw !== '');
  });
  const raw = variable === undefined ? undefined : env[variable];
  if (variable === undefined || raw === undefined) {
    return undefined;
  }
  if (input.config.type === 'string' || input.config.type === 'content') {
    const { multiple, envDelimiter } = input.config;
    const arity = arityOf(input.config);
    if (arity !== undefined) {
      const words = envDelimiter === undefined ? [raw] : raw.split(envDelimiter);
      const reading: VariableReading =
        words.length === arity
          ? { kind: 'fill', value: { tuples: [words] } }
          : { kind: 'rejected' };
      return { reading, variable };
    }
    const value = multiple === true && envDelimiter !== undefined ? raw.split(envDelimiter) : raw;
    return { reading: { kind: 'fill', value }, variable };
  }
  if (input.config.type === 'count') {
    const reading: VariableReading = countText.test(raw)
      ? { kind: 'fill', value: Number(raw) }
      : { kind: 'rejected' };
    return { reading, variable };
  }
  const value = truths.get(raw.toLowerCase());
  return {
    reading: value === undefined ? { kind: 'rejected' } : { kind: 'fill', value },
    variable,
  };
}

/** Writes one filled value where the option's own shape keeps it, a list as the run's own copy. */
function fill(values: OptionValues, name: string, value: RawFill): void {
  if (typeof value === 'boolean') {
    values.booleans.set(name, value);
  } else if (typeof value === 'number') {
    values.counts.set(name, value);
  } else if (typeof value === 'string') {
    values.strings.set(name, value);
  } else if ('tuples' in value) {
    values.tuples.set(
      name,
      value.tuples.map((words) => [...words]),
    );
  } else {
    values.lists.set(name, [...value]);
  }
}

/** One option the stage asks the configuration source about, with the scope that holds it. */
interface Requested {
  input: OptionInput;
  scope: StageScope;
}

/**
 * The shape one option's raw value takes, which decides what an answer must hold: an arity option's
 * tuple of its count of strings, or a multiple one's list of such tuples.
 */
type RawKind =
  | { kind: 'boolean' | 'count' | 'list' | 'string' }
  | { kind: 'tuple' | 'tuples'; arity: number };

/** How a fault names the value an answer owed, by the shape the option takes. */
function owed(shape: RawKind): string {
  switch (shape.kind) {
    case 'boolean': {
      return 'a Boolean';
    }
    case 'count': {
      return 'a whole number of 0 or more';
    }
    case 'list': {
      return 'an array of strings';
    }
    case 'string': {
      return 'a string';
    }
    case 'tuple': {
      return `an array of ${String(shape.arity)} strings`;
    }
    case 'tuples': {
      return `an array of arrays, each of ${String(shape.arity)} strings`;
    }
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}

function rawKind(input: OptionInput): RawKind {
  if (input.config.type !== 'string' && input.config.type !== 'content') {
    return { kind: input.config.type };
  }
  const multiple = input.config.multiple === true;
  const arity = arityOf(input.config);
  if (arity !== undefined) {
    return { arity, kind: multiple ? 'tuples' : 'tuple' };
  }
  return { kind: multiple ? 'list' : 'string' };
}

/** The run's own copy of an answered tuple, or `undefined` when it is not `arity` strings. */
function stringTuple(arity: number, value: unknown): string[] | undefined {
  const list = stringList(value);
  return list?.length === arity ? list : undefined;
}

/** The run's own copy of an answered list of tuples, or `undefined` when one is not a tuple. */
function tupleList(arity: number, value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tuples: string[][] = [];
  // Iteration visits a hole as undefined, which is no tuple.
  for (const entry of value) {
    const tuple = stringTuple(arity, entry);
    if (tuple === undefined) {
      return undefined;
    }
    tuples.push(tuple);
  }
  return tuples;
}

/**
 * The run's own copy of an answered list, or `undefined` when it is not a list of strings. Every
 * index is read, so a hole fails the check as any entry that is not a string does.
 */
function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list: string[] = [];
  // Iteration visits a hole as undefined, where every() skips it.
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    list.push(entry);
  }
  return list;
}

/** One answered value as the raw type its option takes, or `undefined` when it holds another. */
function rawValue(shape: RawKind, value: unknown): RawFill | undefined {
  switch (shape.kind) {
    case 'list': {
      return stringList(value);
    }
    case 'boolean': {
      return typeof value === 'boolean' ? value : undefined;
    }
    case 'count': {
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
    }
    case 'string': {
      return typeof value === 'string' ? value : undefined;
    }
    case 'tuple': {
      const tuple = stringTuple(shape.arity, value);
      return tuple && { tuples: [tuple] };
    }
    case 'tuples': {
      const tuples = tupleList(shape.arity, value);
      return tuples && { tuples };
    }
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}

/**
 * The faults the answers rule names. Reading the answers runs the plugin's own code, such as a
 * getter, so a throw of any other kind while reading them is the plugin's failure.
 */
const ruleFaults = new WeakSet<InternalError>();

/** A fault the answers rule names, recorded so that reading the answers rethrows it unframed. */
function ruleFault(message: string): InternalError {
  const fault = new InternalError(sourceAnswers, {
    cause: undefined,
    correction: sourceAnswersCorrection,
    sentence: message,
  });
  ruleFaults.add(fault);
  return fault;
}

/** One answer read under the answers rule: an object that holds a one-line label and a value. */
function readAnswer(
  sentence: string,
  input: OptionInput,
  answer: unknown,
): { directory: string | undefined; label: string; strict: boolean; value: RawFill } {
  const shape = isPlainObject(answer) ? answer : undefined;
  const label = shape?.label;
  if (!shape || !isProseLine(label)) {
    throw ruleFault(
      `${sentence} answered option ${quoted(input.name)} with an answer that is not { value, label }.`,
    );
  }
  const kind = rawKind(input);
  const value = rawValue(kind, shape.value);
  if (value === undefined) {
    throw ruleFault(
      `${sentence} answered option ${quoted(input.name)} with a value that is not ${owed(kind)}.`,
    );
  }
  const { directory } = shape;
  if (directory !== undefined && (typeof directory !== 'string' || !isAbsolute(directory))) {
    throw ruleFault(
      `${sentence} answered option ${quoted(input.name)} with a directory that is not an absolute path.`,
    );
  }
  const { strict = false } = shape;
  if (typeof strict !== 'boolean') {
    throw ruleFault(
      `${sentence} answered option ${quoted(input.name)} with a strict flag that is not true or false.`,
    );
  }
  return { directory, label, strict, value };
}

/** One answer read under the answers rule, with the requested option it fills. */
interface Answer {
  directory: string | undefined;
  label: string;
  /** Whether a value the option's validator rejects fails the run instead of falling back. */
  strict: boolean;
  target: Requested;
  value: RawFill;
}

/**
 * Every answer the resolver returned, read before any is filled, so an answer the rule rejects
 * leaves every requested option unfilled. A key core did not request is the source's fault.
 */
function readAnswers(
  sentence: string,
  answers: unknown,
  requested: readonly Requested[],
): Answer[] {
  if (!isPlainObject(answers)) {
    throw ruleFault(`${sentence} returned configuration answers that are not a record.`);
  }
  const byName = new Map(requested.map((target) => [target.input.name, target]));
  return Object.entries(answers).map(([name, answer]) => {
    const target = byName.get(name);
    if (!target) {
      throw ruleFault(`${sentence} answered option ${quoted(name)}, which core did not request.`);
    }
    const { directory, label, strict, value } = readAnswer(sentence, target.input, answer);
    return { directory, label, strict, target, value };
  });
}

/**
 * The default export a source loader must resolve to. A loaded module is data core never declared,
 * so the check is the one runtime fact that decides it: the export is callable.
 */
function isResolverExport(value: unknown): value is (context: SourceContext) => unknown {
  return typeof value === 'function';
}

/**
 * The one installed plugin that declares a configuration source, its own option values, which
 * passed their validators before the call, and the options to ask it.
 */
interface SourceCall {
  options: Readonly<Record<string, unknown>>;
  owner: BuiltPlugin & { source: BuiltSource };
  requested: readonly Requested[];
}

/** The fault of a source that threw, while it ran or while core read what it returned. */
function sourceFailure(sentence: string, error: unknown): InternalError {
  return new InternalError(foreignThrow, {
    cause: error,
    correction: foreignThrowCorrection,
    sentence: `${sentence} failed in its configuration source: ${asSentence(reasonOf(error))}`,
  });
}

/**
 * Asks the one configuration source about every requested option, and answers with what it said.
 * Core loads the source here and calls it once, awaiting it; one cancelled during the call awaits
 * it. The run checks its signal and then reaches the load with no await between, so a run
 * cancelled before the load starts neither step, and one cancelled during the load calls nothing.
 * Core builds the context before the call, so a fault of its own is never the plugin's.
 */
async function askSource(stage: SourceStage, call: SourceCall): Promise<Answer[]> {
  const { options, owner, requested } = call;
  const resolver = await loadDefault(owner.identity, owner.source.load, {
    guard: isResolverExport,
    noun: 'source',
  });
  if (stage.signal.aborted) {
    return [];
  }
  const sentence = pluginSentence(owner.identity);
  const context: SourceContext = {
    graph: stage.inspected(),
    host: stage.host,
    invokedBy: stage.invokedBy,
    log: stage.log(owner.identity),
    // Validation produced the record the plugin's option types describe.
    options,
    out: stage.out,
    requests: requested.map(({ input, scope }) => stage.request(input, scope.global)),
    style: stage.style,
  };
  let answers: unknown = undefined;
  try {
    answers = await resolver(context);
  } catch (error) {
    // The resolver's own failure reports with its class's code, as an action's does.
    // That covers an InputError, the FatalError out.fatal() throws, and its out.results() fault.
    // A foreign throw is offered to the translators.
    // One that no translator answers is the plugin's fault.
    if (error instanceof LoomError) {
      throw error;
    }
    throw stage.offer(error) ?? sourceFailure(sentence, error);
  }
  try {
    return readAnswers(sentence, answers, requested);
  } catch (error) {
    if (error instanceof InternalError && ruleFaults.has(error)) {
      throw error;
    }
    throw sourceFailure(sentence, error);
  }
}

/**
 * The environment tier: each option in scope that argv left unfilled reads its bound variable. A
 * filled option is labeled with the variable that supplied it, and a Boolean or counted one outside its grammar,
 * or an arity one whose variable splits into another count of items, is recorded as rejected,
 * which fills nothing.
 */
function fillFromEnvironment(
  scopes: readonly StageScope[],
  env: Host['env'],
): { labels: Map<string, string>; rejected: ReadonlyMap<string, string> } {
  const labels = new Map<string, string>();
  const rejected = new Map<string, string>();
  for (const scope of scopes) {
    for (const input of scope.inputs) {
      const read = isSupplied(scope.values, input.name) ? undefined : readVariable(input, env);
      if (read?.reading.kind === 'fill') {
        fill(scope.values, input.name, read.reading.value);
        labels.set(input.name, read.variable);
      } else if (read?.reading.kind === 'rejected') {
        rejected.set(input.name, read.variable);
      }
    }
  }
  return { labels, rejected };
}

/** The one installed plugin that declares a configuration source, or none. */
function installedSource(
  plugins: readonly BuiltPlugin[],
): (BuiltPlugin & { source: BuiltSource }) | undefined {
  return plugins.find(
    (installed): installed is BuiltPlugin & { source: BuiltSource } =>
      installed.source !== undefined,
  );
}

/**
 * The options the configuration source is asked about: those still unfilled that carry its
 * binding and hold no environment fault, the globals table first and then the routed Command's own,
 * each in declaration order.
 */
function requestedOf(
  scopes: readonly StageScope[],
  excluded: ReadonlyMap<string, string>,
  bound: { binding: string; extensions: ExtensionRecords },
): Requested[] {
  return scopes.flatMap((scope) =>
    scope.inputs
      .filter(
        (input) =>
          !isSupplied(scope.values, input.name) &&
          !excluded.has(input.name) &&
          carriesBinding(bound.extensions.get(input), bound.binding),
      )
      .map((input) => ({ input, scope })),
  );
}

/**
 * The input-source stage: the environment, then the configuration source, for every option in
 * scope that argv left unfilled. When no option is left to ask, the source never loads. The
 * source's own options pass their validators before it loads, and when one is rejected the source
 * is never called and the problem reports with every other validation problem, while each option
 * the source would have been asked to fill reports no missing value. A source fault stops the
 * stage and fills nothing more.
 */
async function fillInputs(stage: SourceStage): Promise<SourceOutcome> {
  return withdrawLosers(stage, await fillTiers(stage));
}

/**
 * Right after the stage fills and before validation, withdraws each member of an exclusive option
 * group that a lower tier claimed beside a sibling a higher tier claimed. The option reads as
 * unfilled by every tier: its value is removed, and so are its label and its file, and nothing
 * validates it. Its name joins `withdrawn`, which settles the other groups that hold it. A
 * rejected variable of a member beside a sibling argv claimed is forgotten too. A Boolean supplied
 * at its absent value claims nothing, so it never withdraws and never makes a sibling withdraw.
 */
function withdrawLosers(stage: SourceStage, outcome: SourceOutcome): SourceOutcome {
  const { locals } = stage;
  if (outcome.fault || !locals || stage.groups.length === 0) {
    return outcome;
  }
  const absent = absentBooleans(locals.inputs);
  const tierOf = (name: string): Tier | undefined => {
    if (!claims(locals.values, name, absent)) {
      return undefined;
    }
    if (outcome.fills?.has(name) === true) {
      return 'configuration';
    }
    return outcome.labels.has(name) ? 'environment' : 'argv';
  };
  const losers = losingMembers(stage.groups, {
    rejected: new Set(outcome.rejected.keys()),
    tierOf,
  });
  if (losers.size === 0) {
    return outcome;
  }
  const withdrawn = new Set<string>();
  const labels = new Map(outcome.labels);
  const fills = outcome.fills && new Map(outcome.fills);
  const rejected = new Map(outcome.rejected);
  for (const name of losers) {
    if (isSupplied(locals.values, name)) {
      withdrawFill(locals.values, name);
      withdrawn.add(name);
    }
    labels.delete(name);
    fills?.delete(name);
    rejected.delete(name);
  }
  return { ...outcome, ...(fills ? { fills } : {}), labels, rejected, withdrawn };
}

/** The environment, then the configuration source, filling every option in scope that argv left unfilled. */
async function fillTiers(stage: SourceStage): Promise<SourceOutcome> {
  const scopes = stage.locals ? [stage.globals, stage.locals] : [stage.globals];
  const { labels, rejected } = fillFromEnvironment(scopes, stage.host.env);
  const owner = installedSource(stage.plugins);
  const requested = owner
    ? requestedOf(scopes, rejected, { binding: owner.source.binding, extensions: stage.extensions })
    : [];
  if (!owner || requested.length === 0) {
    return { fault: undefined, labels, rejected };
  }
  try {
    const validated = await stage.validate(owner.inputs, { labels, rejected });
    // A rejected own option skips the source, and the options it would have filled report no omission.
    if (validated.failure) {
      const unanswered = new Set(requested.map(({ input }) => input));
      return { fault: undefined, labels, rejected, unanswered };
    }
    // A run cancelled while the source's own options were validated loads nothing.
    if (stage.signal.aborted) {
      return { fault: undefined, labels, rejected };
    }
    const options = frozenValues(owner.inputs, validated.values);
    const fills = new Map<string, { directory: string | undefined; strict: boolean }>();
    for (const { directory, label, strict, target, value } of await askSource(stage, {
      options,
      owner,
      requested,
    })) {
      fill(target.scope.values, target.input.name, value);
      labels.set(target.input.name, label);
      fills.set(target.input.name, { directory, strict });
    }
    return { fault: undefined, fills, labels, rejected };
  } catch (error) {
    // The resolver's own failure keeps its class, and so its code.
    // Every other fault above is raised as an internal error, and anything else is wrapped the same way.
    const fault = error instanceof LoomError ? error : foreignFailure(error);
    return { fault, labels, rejected };
  }
}

export type { SourceOutcome, SourceStage, StageScope };
export { fillInputs, installedSource };
