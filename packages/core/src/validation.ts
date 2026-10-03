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
  defaultDepth,
  defaultLevels,
  defaultShape,
  invalidDefault,
  notAValidator,
  omissionAlreadyDecided,
  omissionWithoutValidator,
  requiredWithDefault,
} from './input-rules.js';
import { booleanValue } from './options.js';
import type { OptionValues } from './options.js';
import { boundedSnapshot, NestedTooDeepError, shallowList } from './plain.js';
import { notAnObject } from './plugin-rules.js';
import { isInstance } from './prototypes.js';
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

/** Validated defaults, read before any token is parsed. Values stay `unknown` here. */
export type DefaultValues = ReadonlyMap<InputDeclaration, unknown>;

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
 * value it filled, and the variable of each Boolean option whose value is outside the grammar.
 */
interface Provenance {
  labels: ReadonlyMap<string, string>;
  rejected: ReadonlyMap<string, string>;
}

/** The raw tokens one invocation collected, keyed by declaration and by option name. */
interface SuppliedValues {
  args: ReadonlyMap<InputDeclaration, string | string[]>;
  options: OptionValues;
}

/** Everything one invocation validates: its declarations, its tokens, and where they were read. */
export interface Invocation {
  command: readonly string[];
  defaults: DefaultValues;
  host: Host;
  inputs: ScopedInputs;
  passthrough: readonly string[];
  /**
   * The plugin options, which are never validated. A Boolean one whose variable is outside the
   * grammar is still a problem of this phase, reported after the globals and before the locals.
   */
  plugins: readonly OptionInput[];
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
 * every own string key, the copy of its `extensions` list, and the snapshot of its default, inside
 * one try. Every later check, the registry entry, and every sentence read the copy and never the
 * author's object again, so a getter runs once and the caller's later changes reach nothing. The
 * default is copied and frozen to `defaultLevels` levels, cycles included, and that copy is the
 * value the graph publishes and a run validates; every other property is captured as declared,
 * because core clones no library object. A read that throws, from a getter or a proxy trap, is the
 * unreadable fault, named by the key it threw in, a default nested deeper is the too-deep fault,
 * and a value that is not a plain object is the not-an-object fault.
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
    },
    {
      notAnObject: notAnObjectFault,
      unreadable: (thrown, slot) =>
        isInstance(thrown, NestedTooDeepError) ? tooDeep() : unreadable(thrown, slot),
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
 * Where one input was declared: a global option at its `globalOption()` call, and every other input
 * at its own `argument()` or `option()` call on the Command at `path`.
 */
export function inputPlace(
  input: InputDeclaration,
  scope: { readonly global: boolean; readonly path: readonly string[] },
): InputPlace {
  return scope.global ? { call: 'globalOption', path: [] } : { call: input.kind, path: scope.path };
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

/** The value rules a Boolean option may not declare, in the order its diagnostic names them. */
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

function checkDeclaration(input: InputDeclaration, site: InputSite, subject: string) {
  const { config } = input;
  if (input.kind === 'option' && input.config.type === 'boolean') {
    const declared = valueRules.find((key) => key in config);
    if (declared !== undefined) {
      throw factFault(booleanOptionValueRule, site, {
        correction: `Remove ${declared}; use polarity to control its absent value.`,
        fact: declared,
        sentence: `${subject} is Boolean and declares ${declared}.`,
      });
    }
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
  call: { context: ValidationContext; place: InputPlace | undefined },
): Promise<StandardSchemaV1.Result<unknown>> {
  const { context, place } = call;
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
    const site = place === undefined ? undefined : declaringSite(input, place);
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
 * One validation of a declared value. A multiple option or a variadic argument passes each of its
 * values through the validator in order, and each issue reads at its value's position before its
 * own path, so the action receives the array of outputs. Every other input passes its value once.
 * Each call reads a fresh context whose arrays are copies, so a write to them never reaches the
 * next call. The host is the one captured object that every call and the action share.
 */
async function validateDeclared(
  input: InputDeclaration,
  raw: unknown,
  call: { context: () => ValidationContext; place: InputPlace | undefined; signal?: AbortSignal },
): Promise<StandardSchemaV1.Result<unknown>> {
  const { context, place, signal } = call;
  if (!collects(input) || input.config.validate === undefined) {
    return validate(input, raw, { context: context(), place });
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
    const result = await validate(input, value, { context: context(), place });
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

/** The call that declared one input and the Command it sits on, which a default's fault rebuilds. */
export type InputPlaces = ReadonlyMap<InputDeclaration, InputPlace>;

/**
 * Every declared default, validated before any token is read. The host is captured by then, so a
 * default's validator reads the same Host its action will, under the `default` phase. `places`
 * says where each declaration sits, which a rejected default's finding rebuilds.
 */
export async function prepareInputs(
  inputs: ScopedInputs,
  host: Host,
  places: InputPlaces,
): Promise<DefaultValues> {
  const declarations = scoped(inputs);
  const defaults = new Map<InputDeclaration, unknown>();
  for (const entry of declarations.filter(({ input }) => hasDefault(input))) {
    const { input } = entry;
    const subject = declarationSubject(input);
    const place = places.get(input);
    const result = await validateDeclared(input, input.config.default, {
      context: () => ({ host, input: identityOf(entry), phase: 'default' }),
      place,
    });
    if (result.issues !== undefined) {
      const site = place === undefined ? undefined : declaringSite(input, place);
      throw new DeclarationError(invalidDefault, {
        correction: 'Fix the default or its validator.',
        findings: site === undefined ? [] : [siteFinding(site, partOf(site, 'default'))],
        sentence: [
          `${subject} has an invalid default.`,
          ...messages(subject, reported(result.issues)),
        ].join('\n'),
      });
    }
    defaults.set(input, result.value);
  }
  return defaults;
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
  const options: Record<string, string | readonly string[] | boolean | undefined> = {};
  for (const input of declarations) {
    const collected = collects(input);
    if (input.kind === 'argument') {
      args[input.name] = copied(supplied.args.get(input)) ?? (collected ? [] : undefined);
    } else if (input.config.type === 'boolean') {
      options[input.name] = supplied.options.booleans.get(input.name);
    } else {
      options[input.name] =
        copied(suppliedOption(supplied.options, input.name, collected)) ??
        (collected ? [] : undefined);
    }
  }
  return { args, options };
}

/** The Boolean grammar's one issue, which a variable outside it reports. */
const grammarIssues: readonly StandardSchemaV1.Issue[] = [{ message: 'Use true, false, 1, or 0.' }];

/**
 * Every declaration in the order this phase reports its problems: the globals, then each plugin
 * option whose variable is outside the grammar, then the routed Command's own declarations.
 */
function reportingOrder(invocation: Invocation): ScopedInput[] {
  const declarations = scoped(invocation.inputs);
  const globals = declarations.filter((entry) => entry.global);
  const rejected = invocation.plugins
    .filter((input) => invocation.sources.rejected.has(input.name))
    .map((input) => ({ global: true, input }));
  return [...globals, ...rejected, ...declarations.filter((entry) => !entry.global)];
}

export async function validateValues(invocation: Invocation): Promise<ValidatedInputs> {
  const { defaults, sources, supplied } = invocation;
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
  const lines: string[] = [];
  const problems: InputProblem[] = [];
  /** One rejected input, whatever rejected it, in the order this phase reaches it. */
  const reject = (
    entry: ScopedInput,
    issues: readonly StandardSchemaV1.Issue[],
    subject: string,
  ) => {
    problems.push({
      input: identityOf(entry),
      issues,
      reason: 'invalid',
      spelling: spellingOf(entry.input),
    });
    lines.push(...messages(subject, issues));
  };
  /** One path for every value a validator reads, so a raw shape and its issues meet it once. */
  const accept = async (entry: ScopedInput, raw: unknown, spelling: string) => {
    const result = await validateDeclared(entry.input, raw, {
      context: () => contextOf(entry),
      place: inputPlace(entry.input, { global: entry.global, path: invocation.command }),
      signal: invocation.signal,
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
  for (const entry of reportingOrder(invocation)) {
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
    if (input.kind === 'option' && variable !== undefined) {
      // A Boolean variable outside the grammar filled nothing, so it is the option's problem.
      reject(entry, grammarIssues, suppliedName(input, spellingOf(input), variable));
    } else if (input.kind === 'option' && input.config.type === 'boolean') {
      values.set(input, booleanValue(supplied.options, input.name, input.config));
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
          problems.push({ input: identityOf(entry), reason: 'missing', spelling });
          lines.push(missingMessage(input, spelling, { collected }));
        } else if (collected && !defaults.has(input)) {
          // No occurrence has no value to validate, so the action receives an empty array.
          values.set(input, []);
        } else if (validatesOmission(input)) {
          // The flag sends the omission itself to the validator.
          // An absence rule reads the context a supplied value reads, and reports input issues.
          await accept(entry, undefined, spelling);
        } else {
          values.set(input, freshDefault(defaults.get(input)));
        }
      } else if (input.config.required && Array.isArray(raw) && raw.length === 0) {
        // A filled list satisfies the at-least-one rule by its length, so an empty one is missing.
        problems.push({ input: identityOf(entry), reason: 'missing', spelling });
        lines.push(missingMessage(input, spelling, { collected, origin: originOf(input) }));
      } else {
        await accept(entry, raw, spelling);
      }
    }
  }
  if (problems.length > 0) {
    throw new InputError(lines.join('\n'), problems);
  }
  return new ValidatedInputs(values);
}
