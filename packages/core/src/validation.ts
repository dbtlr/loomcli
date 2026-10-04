import type { StandardSchemaV1 } from '@standard-schema/spec';

import { captureDeclaration, elidedRead, unreadableFault } from './capture.js';
import type { CaptureFaults } from './capture.js';
import { schemaOptions } from './context.js';
import { escapeControlCharacters } from './controls.js';
import { elided, spelled } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { asSentence, DeclarationError, InputError, quoted, reasonOf } from './errors.js';
import type { InputProblem } from './errors.js';
import { callSite, factFault, flagFault, partOf, siteFinding } from './facts.js';
import type { InputSite } from './facts.js';
import {
  booleanOptionValueRule,
  countOptionValueRule,
  defaultDepth,
  defaultLevels,
  defaultShape,
  invalidDefault,
  invalidImplied,
  notAValidator,
  omissionAlreadyDecided,
  omissionWithoutValidator,
  requiredWithDefault,
} from './input-rules.js';
import { booleanValue } from './options.js';
import type { OptionValues } from './options.js';
import { boundedSnapshot, NestedTooDeepError, shallowList } from './plain.js';
import { notAnObject } from './plugin-rules.js';
import { validatorFailed } from './rules.js';
import type {
  ArgumentConfig,
  ArgumentValue,
  Host,
  InputIdentity,
  OptionConfig,
  OptionValue,
  SuppliedInputs,
  ValidationContext,
} from './types.js';

/**
 * One declared input, typed by its literal name and its own config. The value type is derived from
 * the config, never claimed apart from it, so a declaration cannot be written under a value type
 * that its config does not produce. Untyped readers use the defaults.
 */
export interface ArgumentInput<
  Name extends string = string,
  Config extends ArgumentConfig = ArgumentConfig,
> {
  readonly kind: 'argument';
  readonly name: Name;
  readonly config: Config;
}
export interface OptionInput<
  Name extends string = string,
  Config extends OptionConfig = OptionConfig,
> {
  readonly kind: 'option';
  readonly name: Name;
  readonly config: Config;
}
export type InputDeclaration<Name extends string = string> =
  | ArgumentInput<Name>
  | OptionInput<Name>;

/**
 * The declared values validated before any token is parsed: each default, and each implied value a
 * bare spelling supplies. Values stay `unknown` here.
 */
export interface PreparedValues {
  readonly defaults: ReadonlyMap<InputDeclaration, unknown>;
  readonly implied: ReadonlyMap<InputDeclaration, unknown>;
}

/** The declarations one pass reads, by the scope that holds them: the graph's, then a Command's. */
export interface ScopedInputs {
  globals: readonly InputDeclaration[];
  locals: readonly InputDeclaration[];
}

/** One declaration under its scope, which the context reports as part of its identity. */
interface ScopedInput {
  global: boolean;
  input: InputDeclaration;
}

/**
 * What the input-source stage leaves for validation's messages, by option name: the label of each
 * value it filled, and the variable of each Boolean or counted option whose value is outside its
 * grammar. `unanswered` holds each option a configuration source would have filled had one of its own
 * options not been rejected; such an option reports no missing value and no absence rule judges it,
 * because the operator's configuration may hold it.
 */
export interface Provenance {
  labels: ReadonlyMap<string, string>;
  rejected: ReadonlyMap<string, string>;
  unanswered?: ReadonlySet<InputDeclaration>;
}

/** The raw tokens one invocation collected, keyed by declaration and by option name. */
interface SuppliedValues {
  args: ReadonlyMap<InputDeclaration, string | string[]>;
  options: OptionValues;
}

/** Everything one invocation validates: its declarations, its tokens, and where they were read. */
export interface Invocation {
  command: readonly string[];
  /** Every declared default and implied value, validated before any token was read. */
  declaredValues: PreparedValues;
  host: Host;
  inputs: ScopedInputs;
  passthrough: readonly string[];
  /**
   * The declarations this pass validates, when it validates only some of `inputs`, such as a
   * configuration source's own options ahead of its call. Every declaration of `inputs` still
   * appears in the validation context's `supplied` record.
   */
  only?: ReadonlySet<InputDeclaration>;
  /** Where each declaration was declared, which a broken validator's finding rebuilds. */
  places: InputPlaces;
  /**
   * An earlier pass of this invocation, such as the one over a configuration source's own options.
   * This pass reads each value it accepted and each problem it reported, in this pass's own order,
   * and never sends those values to their validators a second time.
   */
  prior?: Validation;
  /** The run's cancellation signal, which stops this phase between two validator calls. */
  signal: AbortSignal;
  sources: Provenance;
  supplied: SuppliedValues;
}

/** Every declaration in validation order: the globals first, then the reading Command's own. */
function scoped(inputs: ScopedInputs): ScopedInput[] {
  return [
    ...inputs.globals.map((input) => ({ global: true, input })),
    ...inputs.locals.map((input) => ({ global: false, input })),
  ];
}

function identityOf({ global, input }: ScopedInput): InputIdentity {
  return { global, kind: input.kind, name: input.name };
}

/**
 * The validated values of one invocation, keyed by declaration. Only `validateValues` constructs
 * one, and its two readers are the only places where a validated value takes its declared type, so
 * every binder reads through them and none asserts on its own.
 */
class ValidatedInputs {
  readonly #values: ReadonlyMap<InputDeclaration, unknown>;

  constructor(values: ReadonlyMap<InputDeclaration, unknown>) {
    this.#values = values;
  }

  /** The one-key record this argument contributes to `args`, typed by its own config. */
  argument<Name extends string, Config extends ArgumentConfig>(
    input: ArgumentInput<Name, Config>,
  ): Record<Name, ArgumentValue<Config>> {
    return this.#field(input);
  }

  /** The one-key record this option contributes to `options`, typed by its own config. */
  option<Name extends string, Config extends OptionConfig>(
    input: OptionInput<Name, Config>,
  ): Record<Name, OptionValue<Config>> {
    return this.#field(input);
  }

  /**
   * One validated value read without its declared type, which is what an untyped reader such as a
   * middleware's request receives. The declared types stay with the two readers above.
   */
  read(input: InputDeclaration): unknown {
    return this.#values.get(input);
  }

  /** Whether this pass validated the declaration's value. */
  has(input: InputDeclaration): boolean {
    return this.#values.has(input);
  }

  #field<Name extends string, Value>(input: InputDeclaration<Name>): Record<Name, Value> {
    // Last resort: no typed path exists. The map stores every validated value as `unknown`.
    // An object literal with a generic computed key does not type as `Record<Name, _>` either.
    // So neither the value nor the key can reach `Record<Name, Value>` without this assertion.
    // It holds because validation stores the output the config declares under this declaration.
    // The two callers above derive `Value` from that same config.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { [input.name]: this.#values.get(input) } as Record<Name, Value>;
  }
}
export type { ValidatedInputs };

/** The faults a config's capture raises: those of every capture, and a default nested too deep. */
export interface ConfigFaults extends CaptureFaults {
  /** The default holds a path deeper than `defaultLevels`; the finding prints it elided. */
  readonly tooDeep: () => DeclarationError;
}

/**
 * Authoring's one read of a config, through `captureDeclaration`: the prototype verdict, the copy of
 * every own string key, the copies of its `extensions` and `aliases` lists, and the snapshot of its
 * default, inside one try. Every later check, the registry entry, and every sentence read the copy
 * and never the author's object again, so a getter runs once and the caller's later changes reach
 * nothing. The default is copied and frozen to `defaultLevels` levels, cycles included, and that
 * copy is the value the graph publishes and a run validates; every other property is captured as
 * declared, because core clones no library object. A read that throws, from a getter or a proxy
 * trap, is the unreadable fault, named by the key it threw in, a default nested deeper is the
 * too-deep fault, and a value that is not a plain object is the not-an-object fault.
 */
export function captureConfig<Config extends ArgumentConfig | OptionConfig>(
  config: Config,
  faults: ConfigFaults,
): Config {
  const { notAnObject: notAnObjectFault, tooDeep, unreadable } = faults;
  return captureDeclaration(
    config,
    (copy, read) => {
      // Presence is the key, so a declared `default: undefined` stays a default.
      read.nested(copy, 'default', (value) => boundedSnapshot(value, defaultLevels));
      read.nested(copy, 'extensions', shallowList);
      read.nested(copy, 'aliases', shallowList);
    },
    {
      notAnObject: notAnObjectFault,
      unreadable: (thrown, slot) =>
        thrown instanceof NestedTooDeepError ? tooDeep() : unreadable(thrown, slot),
    },
  );
}

/** The fault of a default nested deeper than `defaultLevels`, declared by `subject`. */
export function defaultDepthFault(subject: string, findings: readonly Finding[]): DeclarationError {
  return new DeclarationError(defaultDepth, {
    correction: `Nest a default at most ${String(defaultLevels)} levels deep.`,
    findings,
    sentence: `${subject} default nests deeper than ${String(defaultLevels)} levels.`,
  });
}

/**
 * The config every `argument()`, `option()`, and `globalOption()` call, and every input a lifecycle
 * hook declares, reads through `captureConfig`. A call in JavaScript that supplies none, or a value
 * of another kind, reports a declaration fault and not a TypeError, and so does a config whose read
 * throws. Each fault marks the config on the call at `place`.
 */
export function captureInputConfig<Config extends ArgumentConfig | OptionConfig>(
  declared: {
    readonly config: Config;
    readonly kind: InputDeclaration['kind'];
    readonly name: string;
  },
  place: InputPlace,
): Config {
  const { config, kind, name } = declared;
  const subject = `${kind === 'argument' ? 'Argument' : 'Option'} ${quoted(name)}`;
  // The finding marks the config, or one key inside it, which `shown` stands for when the call prints.
  const findings = (shown: unknown, keys: readonly string[] = []) => [
    siteFinding(
      callSite(subject, { arguments: [name, shown], ...place }),
      ['1', ...keys].join('.'),
    ),
  ];
  return captureConfig(config, {
    notAnObject: () =>
      new DeclarationError(notAnObject, {
        correction: `Supply ${kind === 'argument' ? 'an argument' : 'an option'} config object, such as ${kind === 'argument' ? '{}' : "{ type: 'string' }"}.`,
        findings: findings(config),
        sentence: `${subject} declares a config that is not an object.`,
      }),
    // The default's walk stopped at the limit, so the finding prints it elided.
    tooDeep: () => {
      const { keys, shown } = elidedRead('default');
      return defaultDepthFault(subject, findings(shown, keys));
    },
    // A part whose read threw is never read again, so the finding prints it elided.
    unreadable: (thrown, slot) => {
      const { keys, shown } = elidedRead(slot);
      return unreadableFault(
        { declared: 'config', findings: findings(shown, keys), subject },
        thrown,
      );
    },
  });
}

/**
 * A declaration error names the declaration, because the author reads the declaration to fix it.
 * An argument declares and reads under one name, so the two namings differ for options alone.
 */
export function declarationSubject(input: InputDeclaration): string {
  return input.kind === 'argument'
    ? `Argument ${quoted(input.name)}`
    : `Option ${quoted(input.name)}`;
}

/** Where the call that declared one input sits: the call's name and the Command it is on. */
export type InputPlace = Pick<Finding, 'call' | 'path'>;

/**
 * Where one Command's own input was declared: its `argument()` or `option()` call on the Command at
 * `path`. A global option's site is the built table's, under `BuiltGlobals.sites`.
 */
export function inputPlace(input: InputDeclaration, path: readonly string[]): InputPlace {
  return { call: input.kind, path };
}

/**
 * The site of the call that declared one input at `place`, rebuilt as `call(name, config)`. Every
 * finding for an input's own call starts from it, so each marks the call the same way. `subject`
 * is the sentence's name for the input.
 */
export function declaringSite(
  input: InputDeclaration,
  place: InputPlace,
  subject: string = declarationSubject(input),
): InputSite {
  return callSite(subject, { arguments: [input.name, input.config], ...place });
}

/**
 * One input's site with its config printed elided, for a fault judged before the config is read,
 * such as an invalid name, so the fault reads none of the config.
 */
export function configUnread(site: InputSite): InputSite {
  const [name, config] = site.declaration.arguments;
  const shown = config === undefined ? [name] : [name, spelled(elided)];
  return { ...site, declaration: { ...site.declaration, arguments: shown } };
}

/**
 * The token an operator would type for one declaration: `--file` for an option, `-F` when the
 * option declares `shortOnly`, and the declared name for an argument. Every input diagnostic and
 * every reported problem names the declaration this way, so an omission and a rejected value read
 * alike and a `shortOnly` option is never named by a long form it does not accept.
 */
function spellingOf(input: InputDeclaration): string {
  if (input.kind === 'argument') {
    return input.name;
  }
  const { config } = input;
  if (config.shortOnly === true && config.short !== undefined) {
    return `-${config.short}`;
  }
  // A negative-only Boolean option accepts its negative form alone.
  return config.type === 'boolean' && config.polarity === 'negative'
    ? `--no-${input.name}`
    : `--${input.name}`;
}

/**
 * An input diagnostic names the declaration by kind and by the spelling that reaches it. A value an
 * input source filled adds its source in parentheses, so the operator learns where it came from.
 */
function suppliedName(input: InputDeclaration, spelling: string, origin?: string) {
  if (input.kind === 'argument') {
    return `Argument "${spelling}"`;
  }
  return origin === undefined ? `Option "${spelling}"` : `Option "${spelling}" (from ${origin})`;
}

/**
 * The default sentence for an omitted required input. An argument and an option keep the wording
 * each phase used before omission became one problem, and a collected input asks for one value
 * more than a scalar does.
 */
function missingMessage(
  input: InputDeclaration,
  spelling: string,
  facts: { collected: boolean; origin?: string | undefined },
) {
  const { collected, origin } = facts;
  return input.kind === 'argument'
    ? `Argument "${spelling}" requires ${collected ? 'at least one value' : 'a value'}. Supply a value for "${spelling}".`
    : `${suppliedName(input, spelling, origin)} is required. Supply ${collected ? 'at least one value' : 'a value'}.`;
}

/**
 * A multiple option collects its occurrences and a variadic argument collects the remaining
 * tokens, so either one carries a `string[]` as its raw value and validates each value alone.
 */
function collects(input: InputDeclaration) {
  return input.kind === 'option' ? input.config.multiple === true : input.config.variadic === true;
}

/**
 * The declaration flag that sends an omitted value to its own validator. Every declaration reads it
 * here, and the declaration rules below reject it wherever another rule already decides absence.
 */
export function validatesOmission(input: InputDeclaration) {
  const { config } = input;
  return 'validateOmitted' in config && config.validateOmitted;
}

/** One accessor for a supplied option value, so the collected and single shapes read alike. */
function suppliedOption(options: OptionValues, name: string, collected: boolean) {
  return collected ? options.lists.get(name) : options.strings.get(name);
}

/** The copy a collected value is handed out as, because the parser's array is the action's. */
function copied(value: string | string[] | undefined) {
  return Array.isArray(value) ? [...value] : value;
}

/**
 * Without a validator the raw shape is the declared default's only contract. With one, a default
 * of several values must still be an array, because each of its values passes the validator.
 */
function holdsRawDefault(input: InputDeclaration) {
  const value = input.config.default;
  if (!collects(input)) {
    return input.config.validate !== undefined || typeof value === 'string';
  }
  return (
    Array.isArray(value) &&
    (input.config.validate !== undefined ||
      value.every((entry: unknown) => typeof entry === 'string'))
  );
}

/**
 * `validateOmitted: true` is the one way an omitted scalar reaches its validator, so every other
 * rule that already decides absence rejects it, and the flag needs a validator to receive the
 * omission.
 */
function checkOmissionValidation(input: InputDeclaration, site: InputSite, subject: string) {
  const { config } = input;
  const decided = (sentence: string, correction: string) =>
    factFault(omissionAlreadyDecided, site, { correction, fact: 'validateOmitted', sentence });
  if (config.required) {
    throw decided(
      `${subject} is required and declares validateOmitted.`,
      'Remove validateOmitted or make the input optional.',
    );
  }
  if (hasDefault(input)) {
    throw decided(
      `${subject} declares a default and validateOmitted.`,
      'Remove one; the default already fills an omitted value.',
    );
  }
  if (collects(input)) {
    throw decided(
      `${subject} takes several values and declares validateOmitted.`,
      'Remove validateOmitted; with no values the action receives an empty array and no validator runs.',
    );
  }
  if (config.validate === undefined) {
    throw factFault(omissionWithoutValidator, site, {
      correction: 'Add validate or remove validateOmitted.',
      fact: 'validateOmitted',
      sentence: `${subject} declares validateOmitted without a validator.`,
    });
  }
}

/** The value rules a Boolean or counted option may not declare, in the order a diagnostic names them. */
const valueRules = ['validate', 'default', 'required', 'validateOmitted'] as const;

/** Whether a `validate` value is a Standard Schema v1 object that core can call. */
function isStandardSchema(validator: unknown): boolean {
  if (validator === null || (typeof validator !== 'object' && typeof validator !== 'function')) {
    return false;
  }
  const props: unknown = Reflect.get(validator, '~standard');
  return (
    typeof props === 'object' &&
    props !== null &&
    Reflect.get(props, 'version') === 1 &&
    typeof Reflect.get(props, 'vendor') === 'string' &&
    typeof Reflect.get(props, 'validate') === 'function'
  );
}

/**
 * The value rules a Boolean or counted option declares, which take a value it never consumes. Each
 * kind names its own absent value in the correction.
 */
function checkValueless(config: OptionConfig, site: InputSite, subject: string) {
  const declared = valueRules.find((key) => key in config);
  if (declared === undefined) {
    return;
  }
  if (config.type === 'count') {
    throw factFault(countOptionValueRule, site, {
      correction: `Remove ${declared}; a counted option reads 0 when no occurrence supplies it.`,
      fact: declared,
      sentence: `${subject} is a counted option and declares ${declared}.`,
    });
  }
  throw factFault(booleanOptionValueRule, site, {
    correction: `Remove ${declared}; use polarity to control its absent value.`,
    fact: declared,
    sentence: `${subject} is Boolean and declares ${declared}.`,
  });
}

function checkDeclaration(input: InputDeclaration, site: InputSite, subject: string) {
  const { config } = input;
  if (input.kind === 'option' && input.config.type !== 'string') {
    checkValueless(input.config, site, subject);
    return;
  }
  if (config.required !== undefined && typeof config.required !== 'boolean') {
    throw flagFault(site, 'required');
  }
  if (
    input.kind === 'argument' &&
    input.config.variadic !== undefined &&
    typeof input.config.variadic !== 'boolean'
  ) {
    throw flagFault(site, 'variadic');
  }
  // The test reads presence, not truth, so a declared `undefined` is a declaration to reject.
  if ('validateOmitted' in config && typeof config.validateOmitted !== 'boolean') {
    throw flagFault(site, 'validateOmitted');
  }
  if (config.required && Object.hasOwn(config, 'default')) {
    throw factFault(requiredWithDefault, site, {
      correction: 'Remove the default or make the input optional.',
      fact: 'default',
      sentence: `${subject} is required and declares a default.`,
    });
  }
  if (validatesOmission(input)) {
    checkOmissionValidation(input, site, subject);
  }
  if (config.validate !== undefined && !isStandardSchema(config.validate)) {
    throw factFault(notAValidator, site, {
      correction: 'Supply a compatible validator.',
      fact: 'validate',
      sentence: `${subject} validate must be a Standard Schema v1 object.`,
    });
  }
}

/**
 * One issue a validator returned, checked where it enters. Core keeps every own enumerable field
 * the issue carries and rewrites only `path`, reducing each segment to its key, so a field core
 * never reads, such as a validator's issue code, reaches a failure view unchanged.
 */
function readIssue(issue: unknown): StandardSchemaV1.Issue {
  if (issue === null || typeof issue !== 'object' || !('message' in issue)) {
    throw new Error('The validator returned an invalid Standard Schema issue.');
  }
  const message = issue.message;
  if (typeof message !== 'string') {
    throw new Error('The validator returned an invalid Standard Schema issue message.');
  }
  const suppliedPath = 'path' in issue ? issue.path : undefined;
  if (suppliedPath === undefined) {
    return { ...issue, message };
  }
  if (!Array.isArray(suppliedPath)) {
    throw new Error('The validator returned an invalid Standard Schema issue path.');
  }
  const path = Array.from(suppliedPath, (segment: unknown) => {
    const key =
      segment !== null && typeof segment === 'object' && 'key' in segment ? segment.key : segment;
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
      throw new Error('The validator returned an invalid Standard Schema path key.');
    }
    return key;
  });
  return { ...issue, message, path };
}

/**
 * A broken validator is a fault in the declaration, whichever value reached it, so its diagnostic
 * names the declaration and its finding marks the validator on the call at `place`. Returned issues
 * belong to the value, so the caller names those.
 */
async function validate(
  input: InputDeclaration,
  raw: unknown,
  call: { context: ValidationContext; site: InputSite | undefined },
): Promise<StandardSchemaV1.Result<unknown>> {
  const { context, site } = call;
  const validator = input.config.validate;
  if (validator === undefined) {
    return { value: raw };
  }
  try {
    const result: unknown = await validator['~standard'].validate(raw, schemaOptions(context));
    if (result === null || typeof result !== 'object') {
      throw new Error('The validator returned an invalid Standard Schema result.');
    }
    const issues = 'issues' in result ? result.issues : undefined;
    if (issues === undefined && 'value' in result) {
      return { value: result.value };
    }
    if (!Array.isArray(issues)) {
      throw new Error('The validator returned an invalid Standard Schema result.');
    }
    return { issues: Array.from(issues, readIssue) };
  } catch (error) {
    // The reason is the author's detail: a distributed build shows the generic defect message.
    throw new DeclarationError(
      validatorFailed,
      {
        correction: 'Fix the validator.',
        findings: site === undefined ? [] : [siteFinding(site, partOf(site, 'validate'))],
        sentence: `${declarationSubject(input)} validator failed unexpectedly: ${asSentence(reasonOf(error))}`,
      },
      { cause: error },
    );
  }
}

/**
 * Where a bare spelling supplied a string option's implied value among the values it collected,
 * and the output its validator gave that value before any token was read.
 */
interface ImpliedPositions {
  readonly output: unknown;
  readonly positions: readonly number[];
}

/**
 * Where a bare spelling supplied one option's implied value, with that value's prepared output, or
 * `undefined` when no bare spelling supplied it.
 */
function impliedPositions(
  input: InputDeclaration,
  read: { declaredValues: PreparedValues; options: OptionValues },
): ImpliedPositions | undefined {
  const positions = input.kind === 'option' ? read.options.implied.get(input.name) : undefined;
  return positions === undefined
    ? undefined
    : { output: read.declaredValues.implied.get(input), positions };
}

/**
 * One validation of a declared value. A multiple option or a variadic argument passes each of its
 * values through the validator in order, and each issue reads at its value's position before its
 * own path, so the action receives the array of outputs. Every other input passes its value once.
 * Each call reads a fresh context whose arrays are copies, so a write to them never reaches the
 * next call. The host is the one captured object that every call and the action share.
 */
async function validateDeclared(
  input: InputDeclaration,
  raw: unknown,
  call: {
    context: () => ValidationContext;
    site: InputSite | undefined;
    signal?: AbortSignal;
    implied?: ImpliedPositions | undefined;
  },
): Promise<StandardSchemaV1.Result<unknown>> {
  const { context, implied, signal, site } = call;
  if (!collects(input) && implied?.positions.includes(0) === true) {
    // A bare spelling supplied the implied value, whose output was prepared before any token.
    return { value: freshDefault(implied.output) };
  }
  if (!collects(input) || input.config.validate === undefined) {
    return validate(input, raw, { context: context(), site });
  }
  if (!Array.isArray(raw)) {
    // The parser, the input sources, and the declaration rules only ever supply an array here.
    throw new TypeError(
      `${declarationSubject(input)} reached validation without an array of values.`,
    );
  }
  const outputs: unknown[] = [];
  const issues: StandardSchemaV1.Issue[] = [];
  for (const [position, value] of raw.entries()) {
    if (signal?.aborted) {
      // A cancelled run starts no further call; the run resolves its cancellation code instead.
      break;
    }
    // A bare occurrence holds the implied value, whose output was prepared before any token.
    const result =
      implied?.positions.includes(position) === true
        ? { value: freshDefault(implied.output) }
        : await validate(input, value, { context: context(), site });
    if (result.issues === undefined) {
      outputs.push(result.value);
    } else {
      // The issue keeps its own fields, and only its path gains the value's position.
      for (const issue of reported(result.issues)) {
        issues.push({ ...issue, path: [position, ...(issue.path ?? [])] });
      }
    }
  }
  return issues.length === 0 ? { value: outputs } : { issues };
}

/**
 * The dotted path an issue names inside a value, or `undefined` when the issue names the value
 * itself. Core's default text and an application's own view read a position through this one
 * helper, so a rejected item reads alike wherever its diagnostic is written.
 */
export function issuePath(issue: StandardSchemaV1.Issue): string | undefined {
  const path = issue.path
    ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
  return path === undefined || path === '' ? undefined : path;
}

/**
 * The issues one rejection reports. A validator that returned none still rejected the value, so the
 * placeholder stands in for its silence. Reporting takes this list once: the reported problem
 * carries it and the default text is derived from it, so a view and core read the same issues.
 */
function reported(issues: readonly StandardSchemaV1.Issue[]): readonly StandardSchemaV1.Issue[] {
  return issues.length === 0
    ? [
        {
          message:
            'The validator rejected this value without an explanation. Supply a different value.',
        },
      ]
    : issues;
}

/**
 * One line per issue under the input's subject. A path segment can hold text the operator typed,
 * such as a key of a record, so the line escapes the path; `issuePath` keeps it raw for a view.
 */
function messages(subject: string, issues: readonly StandardSchemaV1.Issue[]) {
  return issues.map((issue) => {
    const path = issuePath(issue);
    const position = path === undefined ? '' : ` at ${escapeControlCharacters(path)}`;
    return `${subject}${position}: ${issue.message}`;
  });
}

/** The fault a default of the wrong raw shape reports, by the shape its declaration expects. */
function defaultShapeFault(input: InputDeclaration, site: InputSite, subject: string) {
  const fault = (sentence: string, correction: string) =>
    factFault(defaultShape, site, { correction, fact: 'default', sentence });
  if (!collects(input)) {
    return fault(
      `${subject} default must be a string without a validator.`,
      'Supply a string default.',
    );
  }
  return input.config.validate === undefined
    ? fault(
        `${subject} default must be an array of strings without a validator.`,
        'Supply a string array default.',
      )
    : fault(`${subject} default must be an array.`, 'Supply an array of values.');
}

/** A declared `default: undefined` is a default, so presence is the key, never the value. */
function hasDefault(input: InputDeclaration) {
  return Object.hasOwn(input.config, 'default');
}

/** One declaration and where it was declared, which its faults' findings rebuild. */
export interface SitedInput {
  readonly input: InputDeclaration;
  readonly site: InputSite;
}

/**
 * Every declaration rule that reads the declaration alone. It is synchronous, so the call that
 * declares an input applies it, and build applies it to an input a lifecycle hook declared; only
 * validating a default through its validator, which can be asynchronous, is left to `run()`. A
 * contributor that declares under its own name, such as a plugin, supplies the subject its
 * diagnostics read with; every other caller is named by the declaration itself.
 */
export function checkDeclarations(inputs: readonly SitedInput[], named?: string): void {
  for (const { input, site } of inputs) {
    checkDeclaration(input, site, named ?? declarationSubject(input));
  }
  for (const { input, site } of inputs.filter((entry) => hasDefault(entry.input))) {
    if (!holdsRawDefault(input)) {
      throw defaultShapeFault(input, site, named ?? declarationSubject(input));
    }
  }
}

/**
 * The site of the call that declared each input, which a fault about its default or its validator
 * rebuilds: `globalOption()` or a plugin's `options` record for a global option, and the input's
 * own call on its Command for every other input.
 */
export type InputPlaces = ReadonlyMap<InputDeclaration, InputSite>;

/**
 * Every declared default and implied value, validated before any token is read, in declaration
 * order, a declaration's default before its implied value. The host is captured by then, so each
 * validator reads the same Host its action will, under the `default` phase. `places` says where each
 * declaration sits, which a rejected value's finding rebuilds. An implied value is judged whether or
 * not an invocation holds a bare spelling, because the author declared it.
 */
export async function prepareInputs(
  inputs: ScopedInputs,
  host: Host,
  places: InputPlaces,
): Promise<PreparedValues> {
  const defaults = new Map<InputDeclaration, unknown>();
  const implied = new Map<InputDeclaration, unknown>();
  for (const entry of scoped(inputs)) {
    const { input } = entry;
    const call = {
      context: (): ValidationContext => ({ host, input: identityOf(entry), phase: 'default' }),
      site: places.get(input),
    };
    if (hasDefault(input)) {
      const result = await validateDeclared(input, input.config.default, call);
      defaults.set(input, declaredOutput(input, result, { fault: 'default', site: call.site }));
    }
    const value = impliedOf(input);
    if (value !== undefined) {
      // A bare spelling supplies one value, so even a multiple option's validator reads it alone.
      const result = await validate(input, value, { context: call.context(), site: call.site });
      implied.set(input, declaredOutput(input, result, { fault: 'implied', site: call.site }));
    }
  }
  return { defaults, implied };
}

/** How each declared value names itself when its validator rejects it, and the fix. */
const declaredFaults = {
  default: {
    correction: 'Fix the default or its validator.',
    noun: 'default',
    rule: invalidDefault,
  },
  implied: {
    correction: 'Fix the implied value or its validator.',
    noun: 'implied value',
    rule: invalidImplied,
  },
} as const;

/**
 * The output of a declared value its validator accepted, or the declaration fault it is when the
 * validator rejected it, one line per issue under the sentence, marking the key that declares it.
 */
function declaredOutput(
  input: InputDeclaration,
  result: StandardSchemaV1.Result<unknown>,
  declared: { fault: keyof typeof declaredFaults; site: InputSite | undefined },
): unknown {
  if (result.issues === undefined) {
    return result.value;
  }
  const { fault, site } = declared;
  const { correction, noun, rule } = declaredFaults[fault];
  const subject = declarationSubject(input);
  throw new DeclarationError(rule, {
    correction,
    findings: site === undefined ? [] : [siteFinding(site, partOf(site, fault))],
    sentence: [
      `${subject} has an invalid ${noun}.`,
      ...messages(subject, reported(result.issues)),
    ].join('\n'),
  });
}

/** The implied value a string option declares, which a bare spelling supplies, or `undefined`. */
function impliedOf(input: InputDeclaration): string | undefined {
  return input.kind === 'option' && input.config.type === 'string'
    ? input.config.implied
    : undefined;
}

/**
 * An array default reaches the action as its own mutable copy, so an action that mutates its array
 * rewrites neither the declaration nor the next invocation. One prepared default serves every
 * invocation of a run, and an unvalidated default is the frozen snapshot the declaring call took,
 * so each read copies it. The copy keeps a hole where the default has one, as the graph's does.
 * Every other output passes through unchanged.
 */
function freshDefault(value: unknown) {
  // A spread reads a hole as `undefined`, and `slice` keeps it.
  // oxlint-disable-next-line unicorn/prefer-spread
  return Array.isArray(value) ? value.slice() : value;
}

/**
 * The raw tokens of one invocation, keyed by declared name. Every declared input of the routed
 * Command and every global appears, so absence reads as the shape its declaration collects. Each
 * collected value is copied, because the parser's own array is what the action reads.
 */
function suppliedInputs(
  declarations: readonly InputDeclaration[],
  supplied: SuppliedValues,
): SuppliedInputs {
  const args: Record<string, string | readonly string[] | undefined> = {};
  const options: Record<string, string | readonly string[] | boolean | number | undefined> = {};
  for (const input of declarations) {
    const collected = collects(input);
    if (input.kind === 'argument') {
      args[input.name] = copied(supplied.args.get(input)) ?? (collected ? [] : undefined);
    } else if (input.config.type === 'boolean') {
      options[input.name] = supplied.options.booleans.get(input.name);
    } else if (input.config.type === 'count') {
      options[input.name] = supplied.options.counts.get(input.name);
    } else {
      options[input.name] =
        copied(suppliedOption(supplied.options, input.name, collected)) ??
        (collected ? [] : undefined);
    }
  }
  return { args, options };
}

/**
 * The one issue a variable outside its option's grammar reports: the Boolean grammar, or the count
 * grammar of ASCII decimal digits.
 */
function grammarIssues(input: OptionInput): readonly StandardSchemaV1.Issue[] {
  return input.config.type === 'count'
    ? [{ message: 'Use a whole number of 0 or more.' }]
    : [{ message: 'Use true, false, 1, or 0.' }];
}

/** One rejected or missing input: the problem it reports, and the lines core's default text holds. */
interface Report {
  readonly lines: readonly string[];
  readonly problem: InputProblem;
}

/**
 * What one validation pass produced: every value its validator accepted, each input's report in
 * reporting order, and those reports aggregated into one failure, or `undefined` when there were
 * none. A pass that found problems still answers with the values it accepted, so a reader of the
 * global options keeps them when only a local input was rejected.
 */
export interface Validation {
  readonly failure: InputError | undefined;
  readonly reports: ReadonlyMap<InputDeclaration, Report>;
  readonly values: ValidatedInputs;
}

/**
 * Whether a pass rejected a global option, which leaves no global value a middleware may read. A
 * global option declares no presence rule, so every problem it reports is a rejected value.
 */
export function rejectsGlobal(validation: Validation): boolean {
  return validation.failure?.problems.some((problem) => problem.input.global) ?? false;
}

/**
 * Validates one invocation in reporting order: the global options, the application's and then each
 * plugin's, and then the routed Command's own declarations, each in authoring order.
 */
export async function validateValues(invocation: Invocation): Promise<Validation> {
  const { declaredValues, prior, sources, supplied } = invocation;
  const { defaults } = declaredValues;
  const declarations = scoped(invocation.inputs);
  /** Where a filled option's value came from, which its diagnostic names; argv names none. */
  const originOf = (input: InputDeclaration) =>
    input.kind === 'option' ? sources.labels.get(input.name) : undefined;
  /**
   * One reading of the tokens and the route, built anew for each validator call. The route, the
   * tail, and every collected value are copies, so a validator that writes to them reaches neither
   * the parser's collections, nor the tail the action receives, nor the next validator call of
   * this invocation. Each copy is made on its first read and kept for the call, so a validator
   * that never reads one never pays for it, however many values a list holds. The host is the
   * captured object itself, the one the action receives.
   */
  const contextOf = (entry: ScopedInput): ValidationContext => {
    const copies: {
      command?: readonly string[];
      passthrough?: readonly string[];
      supplied?: SuppliedInputs;
    } = {};
    return {
      get command() {
        copies.command ??= [...invocation.command];
        return copies.command;
      },
      host: invocation.host,
      input: identityOf(entry),
      get passthrough() {
        copies.passthrough ??= [...invocation.passthrough];
        return copies.passthrough;
      },
      phase: 'invocation',
      get supplied() {
        copies.supplied ??= suppliedInputs(
          declarations.map((declared) => declared.input),
          supplied,
        );
        return copies.supplied;
      },
    };
  };
  const values = new Map<InputDeclaration, unknown>();
  // Each input reports at most once, so insertion order is the order this phase reaches them.
  const reports = new Map<InputDeclaration, Report>();
  /**
   * One missing input, in the order this phase reaches it, unless a skipped configuration source
   * would have been asked to fill it.
   */
  const omit = (entry: ScopedInput, spelling: string, line: string) => {
    if (sources.unanswered?.has(entry.input) === true) {
      return;
    }
    reports.set(entry.input, {
      lines: [line],
      problem: { input: identityOf(entry), reason: 'missing', spelling },
    });
  };
  /** One rejected input, whatever rejected it, in the order this phase reaches it. */
  const reject = (
    entry: ScopedInput,
    issues: readonly StandardSchemaV1.Issue[],
    subject: string,
  ) => {
    reports.set(entry.input, {
      lines: messages(subject, issues),
      problem: {
        input: identityOf(entry),
        issues,
        reason: 'invalid',
        spelling: spellingOf(entry.input),
      },
    });
  };
  /** One path for every value a validator reads, so a raw shape and its issues meet it once. */
  const accept = async (entry: ScopedInput, raw: unknown, spelling: string) => {
    const result = await validateDeclared(entry.input, raw, {
      context: () => contextOf(entry),
      implied: impliedPositions(entry.input, { declaredValues, options: supplied.options }),
      signal: invocation.signal,
      site: invocation.places.get(entry.input),
    });
    if (result.issues === undefined) {
      values.set(entry.input, result.value);
      return;
    }
    reject(
      entry,
      reported(result.issues),
      suppliedName(entry.input, spelling, originOf(entry.input)),
    );
  };
  const { only } = invocation;
  const validated = only ? declarations.filter(({ input }) => only.has(input)) : declarations;
  for (const entry of validated) {
    if (invocation.signal.aborted) {
      /**
       * A cancelled run starts no further validator call. The one already in flight was awaited
       * above, and whatever this phase collected is never raised, because the run resolves its
       * cancellation code instead.
       */
      break;
    }
    const { input } = entry;
    const variable = sources.rejected.get(input.name);
    const earlier = prior?.reports.get(input);
    if (prior?.values.has(input) === true) {
      // An earlier pass validated this value once, and one value meets its validator once.
      values.set(input, prior.values.read(input));
    } else if (earlier !== undefined) {
      // The earlier pass's problem reports here, in this pass's order.
      reports.set(input, earlier);
    } else if (input.kind === 'option' && variable !== undefined) {
      // A variable outside its option's grammar filled nothing, so it is the option's problem.
      reject(entry, grammarIssues(input), suppliedName(input, spellingOf(input), variable));
    } else if (input.kind === 'option' && input.config.type === 'boolean') {
      values.set(input, booleanValue(supplied.options, input.name, input.config));
    } else if (input.kind === 'option' && input.config.type === 'count') {
      // A count passes no validator, and no occurrence and no source reads 0.
      values.set(input, supplied.options.counts.get(input.name) ?? 0);
    } else {
      const collected = collects(input);
      const spelling = spellingOf(input);
      const raw =
        input.kind === 'argument'
          ? supplied.args.get(input)
          : suppliedOption(supplied.options, input.name, collected);
      if (raw === undefined) {
        if (input.config.required) {
          // An omitted required argument arrives here too, so omission has one class.
          // One aggregated diagnostic covers an omitted argument and an omitted option alike.
          omit(entry, spelling, missingMessage(input, spelling, { collected }));
        } else if (collected && !defaults.has(input)) {
          // No occurrence has no value to validate, so the action receives an empty array.
          values.set(input, []);
        } else if (validatesOmission(input) && sources.unanswered?.has(input) !== true) {
          // The flag sends the omission itself to the validator.
          // An option a skipped configuration source would have filled is not judged absent.
          // An absence rule reads the context a supplied value reads, and reports input issues.
          await accept(entry, undefined, spelling);
        } else {
          values.set(input, freshDefault(defaults.get(input)));
        }
      } else if (input.config.required && Array.isArray(raw) && raw.length === 0) {
        // A filled list satisfies the at-least-one rule by its length, so an empty one is missing.
        omit(
          entry,
          spelling,
          missingMessage(input, spelling, { collected, origin: originOf(input) }),
        );
      } else {
        await accept(entry, raw, spelling);
      }
    }
  }
  const found = [...reports.values()];
  return {
    failure:
      found.length > 0
        ? new InputError(
            found.flatMap((report) => report.lines).join('\n'),
            found.map((report) => report.problem),
          )
        : undefined,
    reports,
    values: new ValidatedInputs(values),
  };
}
