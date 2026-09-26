import { asSentence, InputError, InternalError, reasonOf, ResultError } from './errors.js';
import type { ExtensionRecords } from './extension.js';
import { isPlainObject, isProseLine } from './facts.js';
import type { CommandGraph, OptionNode } from './inspect.js';
import { isSupplied } from './options.js';
import type { OptionValues } from './options.js';
import { loadDefault, pluginSentence, pluginValues } from './plugin.js';
import type { BuiltPlugin, BuiltSource, SourceContext } from './plugin.js';
import type { ContextualStyle } from './style.js';
import type { Host, Out } from './types.js';
import type { OptionInput } from './validation.js';

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
  host: Host;
  /** The graph `inspect()` would return for the run, built on its first read. */
  inspected: () => CommandGraph;
  /** The routed Command's own options, or `undefined` while local parsing holds a fault. */
  locals: StageScope | undefined;
  /** The channel a source writes through, whose results call names the source. */
  out: Out;
  plugins: readonly BuiltPlugin[];
  /** The `OptionNode` of one option, read from the graph `inspect()` would return for the run. */
  request: (input: OptionInput, global: boolean) => OptionNode;
  signal: AbortSignal;
  /** The contextual style an action receives, so a source escapes raw data before it warns. */
  style: ContextualStyle;
}

/**
 * What the stage found beside the values it filled. `labels` names where each filled option's value
 * came from, by option name, and `rejected` names the variable of each Boolean option whose value
 * is outside the grammar. Both are internal to core's failure messages. `fault` is a configuration
 * source's own fault, or the `InputError` its resolver threw, which stops the stage and takes the
 * place of every validation problem.
 */
interface SourceOutcome {
  fault: InternalError | InputError | undefined;
  labels: ReadonlyMap<string, string>;
  rejected: ReadonlyMap<string, string>;
}

/** The Boolean grammar a bound variable is read through: the whole value, case-insensitive. */
const truths: ReadonlyMap<string, boolean> = new Map([
  ['0', false],
  ['1', true],
  ['false', false],
  ['true', true],
]);

/** The raw value an option takes: a string, a Boolean, or a list for a multiple option. */
type RawFill = string | boolean | readonly string[];

/** One option's value under the environment rules: a fill, a value outside the grammar, or unset. */
type VariableReading = { kind: 'fill'; value: string | boolean } | { kind: 'rejected' } | undefined;

/**
 * Reads one option's bound variable. An empty variable is unset and falls through, a string option
 * receives the raw string, and a Boolean option reads the whole value through the grammar, so the
 * value states the option's value and not a spelling.
 */
function readVariable(input: OptionInput, env: Host['env']): VariableReading {
  const variable = input.config.env;
  const raw = variable !== undefined && Object.hasOwn(env, variable) ? env[variable] : undefined;
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (input.config.type === 'string') {
    return { kind: 'fill', value: raw };
  }
  const value = truths.get(raw.toLowerCase());
  return value === undefined ? { kind: 'rejected' } : { kind: 'fill', value };
}

/** Writes one filled value where the option's own shape keeps it, a list as the run's own copy. */
function fill(values: OptionValues, name: string, value: RawFill): void {
  if (typeof value === 'boolean') {
    values.booleans.set(name, value);
  } else if (typeof value === 'string') {
    values.strings.set(name, value);
  } else {
    values.lists.set(name, [...value]);
  }
}

/** One option the stage asks the configuration source about, with the scope that holds it. */
interface Requested {
  input: OptionInput;
  scope: StageScope;
}

/** The shape one option's raw value takes, which decides what an answer must hold. */
type RawKind = 'boolean' | 'list' | 'string';

/** How a fault names the value an answer owed, by the shape the option takes. */
const owed: Readonly<Record<RawKind, string>> = {
  boolean: 'a Boolean',
  list: 'an array of strings',
  string: 'a string',
};

function rawKind(input: OptionInput): RawKind {
  if (input.config.type === 'boolean') {
    return 'boolean';
  }
  return input.config.multiple === true ? 'list' : 'string';
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
function rawValue(kind: RawKind, value: unknown): RawFill | undefined {
  if (kind === 'list') {
    return stringList(value);
  }
  if (kind === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * The faults the answers rule names. Reading the answers runs the plugin's own code, such as a
 * getter, so a throw of any other kind while reading them is the plugin's failure.
 */
const ruleFaults = new WeakSet<InternalError>();

/** A fault the answers rule names, recorded so that reading the answers rethrows it unframed. */
function ruleFault(message: string): InternalError {
  const fault = new InternalError(message, undefined);
  ruleFaults.add(fault);
  return fault;
}

/** One answer read under the answers rule: an object that holds a one-line label and a value. */
function readAnswer(
  sentence: string,
  input: OptionInput,
  answer: unknown,
): { label: string; value: RawFill } {
  const shape = isPlainObject(answer) ? answer : undefined;
  const label = shape?.label;
  if (!shape || !isProseLine(label)) {
    throw ruleFault(
      `${sentence} answered option "${input.name}" with an answer that is not { value, label }.`,
    );
  }
  const kind = rawKind(input);
  const value = rawValue(kind, shape.value);
  if (value === undefined) {
    throw ruleFault(
      `${sentence} answered option "${input.name}" with a value that is not ${owed[kind]}.`,
    );
  }
  return { label, value };
}

/** One answer read under the answers rule, with the requested option it fills. */
interface Answer {
  label: string;
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
      throw ruleFault(`${sentence} answered option "${name}", which core did not request.`);
    }
    const { label, value } = readAnswer(sentence, target.input, answer);
    return { label, target, value };
  });
}

/**
 * The default export a source loader must resolve to. A loaded module is data core never declared,
 * so the check is the one runtime fact that decides it: the export is callable.
 */
function isResolverExport(value: unknown): value is (context: SourceContext) => unknown {
  return typeof value === 'function';
}

/** The one installed plugin that declares a configuration source, and the options to ask it. */
interface SourceCall {
  owner: BuiltPlugin & { source: BuiltSource };
  requested: readonly Requested[];
}

/** The fault of a source that threw, while it ran or while core read what it returned. */
function sourceFailure(sentence: string, error: unknown): InternalError {
  return new InternalError(
    `${sentence} failed in its configuration source: ${asSentence(reasonOf(error))}`,
    error,
  );
}

/**
 * Asks the one configuration source about every requested option, and answers with what it said.
 * Core loads the source here and calls it once, awaiting it; one cancelled during the call awaits
 * it. The run checks its signal and then reaches the load with no await between, so a run
 * cancelled before the load starts neither step, and one cancelled during the load calls nothing.
 * Core builds the context before the call, so a fault of its own is never the plugin's.
 */
async function askSource(stage: SourceStage, call: SourceCall): Promise<Answer[]> {
  const { owner, requested } = call;
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
    options: pluginValues(owner.inputs, stage.globals.values),
    out: stage.out,
    requests: requested.map(({ input, scope }) => stage.request(input, scope.global)),
    style: stage.style,
  };
  let answers: unknown = undefined;
  try {
    answers = await resolver(context);
  } catch (error) {
    // The resolver's own InputError is a usage failure.
    // Its out.results() call is the results fault that names it.
    // Every other throw is the plugin's fault.
    if (error instanceof InputError || error instanceof ResultError) {
      throw error;
    }
    throw sourceFailure(sentence, error);
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
 * filled option is labeled with its variable, and a Boolean one outside the grammar is recorded
 * as rejected, which fills nothing.
 */
function fillFromEnvironment(
  scopes: readonly StageScope[],
  env: Host['env'],
): { labels: Map<string, string>; rejected: ReadonlyMap<string, string> } {
  const labels = new Map<string, string>();
  const rejected = new Map<string, string>();
  for (const scope of scopes) {
    for (const input of scope.inputs) {
      const reading = isSupplied(scope.values, input.name) ? undefined : readVariable(input, env);
      const variable = input.config.env ?? '';
      if (reading?.kind === 'fill') {
        fill(scope.values, input.name, reading.value);
        labels.set(input.name, variable);
      } else if (reading?.kind === 'rejected') {
        rejected.set(input.name, variable);
      }
    }
  }
  return { labels, rejected };
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
          Object.hasOwn(bound.extensions.get(input) ?? {}, bound.binding),
      )
      .map((input) => ({ input, scope })),
  );
}

/**
 * The input-source stage: the environment, then the configuration source, for every option in
 * scope that argv left unfilled. When no option is left to ask, the source never loads. A source
 * fault stops the stage and fills nothing more.
 */
async function fillInputs(stage: SourceStage): Promise<SourceOutcome> {
  const scopes = stage.locals ? [stage.globals, stage.locals] : [stage.globals];
  const { labels, rejected } = fillFromEnvironment(scopes, stage.host.env);
  const owner = stage.plugins.find(
    (installed): installed is BuiltPlugin & { source: BuiltSource } =>
      installed.source !== undefined,
  );
  const requested = owner
    ? requestedOf(scopes, rejected, { binding: owner.source.binding, extensions: stage.extensions })
    : [];
  if (!owner || requested.length === 0) {
    return { fault: undefined, labels, rejected };
  }
  try {
    for (const { label, target, value } of await askSource(stage, { owner, requested })) {
      fill(target.scope.values, target.input.name, value);
      labels.set(target.input.name, label);
    }
    return { fault: undefined, labels, rejected };
  } catch (error) {
    // The resolver's InputError reports as a usage failure.
    // Every other fault above is raised as an internal error, and anything else is wrapped the same way.
    const fault =
      error instanceof InternalError || error instanceof InputError
        ? error
        : new InternalError(reasonOf(error), error);
    return { fault, labels, rejected };
  }
}

export type { SourceOutcome, SourceStage, StageScope };
export { fillInputs };
