import type { StandardSchemaV1 } from '@standard-schema/spec';

import { schemaOptions } from './context.js';
import { DeclarationError, InputError } from './errors.js';
import type { InputProblem } from './errors.js';
import type { OptionValues } from './options.js';
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

/**
 * Authoring's snapshot of one config. An array default is the one declared value core hands to an
 * action as its own value, so the declaration keeps a copy and the caller keeps its array. Every
 * other property is captured as declared, because core clones no library object.
 */
export function captureConfig<Config extends ArgumentConfig | OptionConfig>(
  config: Config,
): Config {
  const value = config.default;
  return Array.isArray(value) ? { ...config, default: [...value] } : { ...config };
}

/**
 * A declaration error names the declaration, because the author reads the declaration to fix it.
 * An argument declares and reads under one name, so the two namings differ for options alone.
 */
function declaredName(input: InputDeclaration) {
  return input.kind === 'argument' ? `Argument "${input.name}"` : `Option "${input.name}"`;
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
  return config.shortOnly === true && config.short !== undefined
    ? `-${config.short}`
    : `--${input.name}`;
}

/** An input diagnostic names the declaration by kind and by the spelling that reaches it. */
function suppliedName(input: InputDeclaration, spelling: string) {
  return input.kind === 'argument' ? `Argument "${spelling}"` : `Option "${spelling}"`;
}

/**
 * The default sentence for an omitted required input. An argument and an option keep the wording
 * each phase used before omission became one problem, and a collected input asks for one value
 * more than a scalar does.
 */
function missingMessage(input: InputDeclaration, spelling: string, collected: boolean) {
  return input.kind === 'argument'
    ? `Argument "${spelling}" requires ${collected ? 'at least one value' : 'a value'}. Supply a value for "${spelling}".`
    : `Option "${spelling}" is required. Supply ${collected ? 'at least one value' : 'a value'}.`;
}

/**
 * A multiple option collects its occurrences and a variadic argument collects the remaining
 * tokens, so either one carries the whole `string[]` as its raw value.
 */
function collects(input: InputDeclaration) {
  return input.kind === 'option' ? input.config.multiple === true : input.config.variadic === true;
}

/**
 * The declaration flag that sends an omitted value to its own schema. Every declaration reads it
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

/** Without a schema the raw shape is the declared default's only contract. */
function holdsRawDefault(input: InputDeclaration) {
  const value = input.config.default;
  return collects(input)
    ? Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
    : typeof value === 'string';
}

/**
 * `validateOmitted: true` is the one way an omitted scalar reaches its schema, so every other rule
 * that already decides absence rejects it, and the flag needs a schema to receive the omission.
 */
function checkOmissionValidation(input: InputDeclaration) {
  const { config } = input;
  const subject = declaredName(input);
  if (config.required) {
    throw new DeclarationError(
      `${subject} is required and declares validateOmitted. Remove validateOmitted or make the input optional.`,
    );
  }
  if (hasDefault(input)) {
    throw new DeclarationError(
      `${subject} declares a default and validateOmitted. Remove one; the default already fills an omitted value.`,
    );
  }
  if (collects(input)) {
    throw new DeclarationError(
      `${subject} collects its values and declares validateOmitted. Remove validateOmitted; an omitted collection reaches the schema as an empty array.`,
    );
  }
  if (config.validate === undefined) {
    throw new DeclarationError(
      `${subject} declares validateOmitted without a schema. Add validate or remove validateOmitted.`,
    );
  }
}

function checkDeclaration(input: InputDeclaration) {
  const { config } = input;
  if (input.kind === 'option' && input.config.type === 'boolean') {
    if (
      'validate' in config ||
      'default' in config ||
      'required' in config ||
      'validateOmitted' in config
    ) {
      throw new DeclarationError(
        `${declaredName(input)} is Boolean. Remove validate, default, required, and validateOmitted; use polarity to control its absent value.`,
      );
    }
    return;
  }
  if (config.required !== undefined && typeof config.required !== 'boolean') {
    throw new DeclarationError(
      `${declaredName(input)} required must be Boolean. Use true or false.`,
    );
  }
  if (
    input.kind === 'argument' &&
    input.config.variadic !== undefined &&
    typeof input.config.variadic !== 'boolean'
  ) {
    throw new DeclarationError(
      `${declaredName(input)} variadic must be Boolean. Use true or false.`,
    );
  }
  // The test reads presence, not truth, so a declared `undefined` is a declaration to reject.
  if ('validateOmitted' in config && typeof config.validateOmitted !== 'boolean') {
    throw new DeclarationError(
      `${declaredName(input)} validateOmitted must be Boolean. Use true or false.`,
    );
  }
  if (config.required && Object.hasOwn(config, 'default')) {
    throw new DeclarationError(
      `${declaredName(input)} is required and declares a default. Remove the default or make the input optional.`,
    );
  }
  if (validatesOmission(input)) {
    checkOmissionValidation(input);
  }
  const schema = config.validate;
  if (
    schema !== undefined &&
    (schema === null ||
      (typeof schema !== 'object' && typeof schema !== 'function') ||
      !schema['~standard'] ||
      schema['~standard'].version !== 1 ||
      typeof schema['~standard'].vendor !== 'string' ||
      typeof schema['~standard'].validate !== 'function')
  ) {
    throw new DeclarationError(
      `${declaredName(input)} validate must be a Standard Schema v1 object. Supply a compatible schema.`,
    );
  }
}

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
    return { message };
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
  return { message, path };
}

/**
 * A broken validator is a fault in the declaration, whichever value reached it, so its diagnostic
 * names the declaration. Returned issues belong to the value, so the caller names those.
 */
async function validate(
  input: InputDeclaration,
  raw: unknown,
  context: ValidationContext,
): Promise<StandardSchemaV1.Result<unknown>> {
  const schema = input.config.validate;
  if (schema === undefined) {
    return { value: raw };
  }
  try {
    const result: unknown = await schema['~standard'].validate(raw, schemaOptions(context));
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
    const reason = error instanceof Error ? error.message : 'Unknown validator failure.';
    throw new DeclarationError(
      `${declaredName(input)} validator failed unexpectedly: ${reason} Fix the validator.`,
    );
  }
}

/**
 * The dotted path an issue names inside a value, or `undefined` when the issue names the value
 * itself. Core's default text and an application's own renderer read a position through this one
 * helper, so a rejected item reads alike wherever its diagnostic is written.
 */
export function issuePath(issue: StandardSchemaV1.Issue): string | undefined {
  const path = issue.path
    ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
  return path === undefined || path === '' ? undefined : path;
}

/**
 * The issues one rejection reports. A schema that returned none still rejected the value, so the
 * placeholder stands in for its silence. Reporting takes this list once: the reported problem
 * carries it and the default text is derived from it, so a renderer and core read the same issues.
 */
function reported(issues: readonly StandardSchemaV1.Issue[]): readonly StandardSchemaV1.Issue[] {
  return issues.length === 0
    ? [{ message: 'The schema rejected this value without an explanation.' }]
    : issues;
}

function messages(subject: string, issues: readonly StandardSchemaV1.Issue[]) {
  return issues.map((issue) => {
    const path = issuePath(issue);
    return `${subject}${path === undefined ? '' : ` at ${path}`}: ${issue.message}`;
  });
}

/** A declared `default: undefined` is a default, so presence is the key, never the value. */
function hasDefault(input: InputDeclaration) {
  return Object.hasOwn(input.config, 'default');
}

/**
 * Every declaration rule that reads the declaration alone. It is synchronous, so `inspect()` and
 * `run()` apply exactly the same rules, and only validating a default through its schema, which
 * can be asynchronous, is left to `run()`.
 */
export function checkDeclarations(inputs: readonly InputDeclaration[]): void {
  for (const input of inputs) {
    checkDeclaration(input);
  }
  for (const input of inputs.filter((entry) => hasDefault(entry))) {
    if (input.config.validate === undefined && !holdsRawDefault(input)) {
      const subject = declaredName(input);
      throw new DeclarationError(
        collects(input)
          ? `${subject} default must be an array of strings without a schema. Supply a string array default.`
          : `${subject} default must be a string without a schema. Supply a string default.`,
      );
    }
  }
}

/**
 * Every declared default, validated before any token is read. The host is captured by then, so a
 * default's schema reads the same Host its action will, under the `default` phase.
 */
export async function prepareInputs(inputs: ScopedInputs, host: Host): Promise<DefaultValues> {
  const declarations = scoped(inputs);
  checkDeclarations(declarations.map((entry) => entry.input));
  const defaults = new Map<InputDeclaration, unknown>();
  for (const entry of declarations.filter(({ input }) => hasDefault(input))) {
    const { input } = entry;
    const subject = declaredName(input);
    const result = await validate(input, input.config.default, {
      host,
      input: identityOf(entry),
      phase: 'default',
    });
    if (result.issues !== undefined) {
      throw new DeclarationError(
        `${subject} has an invalid default. Fix the default or its schema.\n${messages(subject, reported(result.issues)).join('\n')}`,
      );
    }
    defaults.set(input, result.value);
  }
  return defaults;
}

/**
 * An array default reaches the action as its own copy, so an action that mutates its collection
 * rewrites neither the declaration nor the next invocation. A schema that returns a new array is
 * copied too, because a pass-through schema returns the declared array itself and cannot be told
 * apart from one that built its own. Every other output passes through unchanged.
 */
function freshDefault(value: unknown) {
  return Array.isArray(value) ? [...value] : value;
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

export async function validateValues(invocation: Invocation): Promise<ValidatedInputs> {
  const { defaults, supplied } = invocation;
  const declarations = scoped(invocation.inputs);
  /**
   * One reading of the tokens and the route, built anew for each schema call. The route, the
   * tail, and every collected value are copies, so a schema that writes to them reaches neither
   * the parser's collections, nor the tail the action receives, nor the next schema of this
   * invocation. The host is the captured object itself, the one the action receives.
   */
  const facts = () => ({
    command: [...invocation.command],
    host: invocation.host,
    passthrough: [...invocation.passthrough],
    supplied: suppliedInputs(
      declarations.map((entry) => entry.input),
      supplied,
    ),
  });
  const values = new Map<InputDeclaration, unknown>();
  const lines: string[] = [];
  const problems: InputProblem[] = [];
  /** One path for every value the schema reads, so a raw shape and its issues meet it once. */
  const accept = async (entry: ScopedInput, raw: unknown, spelling: string) => {
    const result = await validate(entry.input, raw, {
      ...facts(),
      input: identityOf(entry),
      phase: 'invocation',
    });
    if (result.issues === undefined) {
      values.set(entry.input, result.value);
      return;
    }
    const issues = reported(result.issues);
    problems.push({ input: identityOf(entry), issues, reason: 'invalid', spelling });
    lines.push(...messages(suppliedName(entry.input, spelling), issues));
  };
  for (const entry of declarations) {
    const { input } = entry;
    if (input.kind === 'option' && input.config.type === 'boolean') {
      values.set(
        input,
        supplied.options.booleans.get(input.name) ?? input.config.polarity === 'negative',
      );
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
          lines.push(missingMessage(input, spelling, collected));
        } else if (collected && !defaults.has(input)) {
          // No occurrence is an accurate empty collection, so it reads like a supplied value.
          await accept(entry, [], spelling);
        } else if (validatesOmission(input)) {
          // The flag sends the omission itself to the schema.
          // An absence rule reads the context a supplied value reads, and reports input issues.
          await accept(entry, undefined, spelling);
        } else {
          values.set(input, freshDefault(defaults.get(input)));
        }
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
