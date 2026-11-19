import type { AppliedSet, OptionSetValues } from '../commands/option-sets.js';
import type { InputProblem } from '../failures/errors.js';
import type { FailureLine } from '../localization/lines.js';
import type { ArgumentInput, InputDeclaration, OptionInput } from './declarations.js';
import type { ArgumentConfig, ArgumentValue, OptionConfig, OptionValue } from './types.js';

/**
 * The validated values of one invocation, keyed by declaration. Only `validateValues` and the
 * validation ledger construct one, and its three readers are the only places where a validated value
 * takes its declared type, so every binder reads through them and none asserts on its own.
 */
export class ValidatedInputs {
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

  /** The record the options one `options(set)` call declared contribute, typed by the set's configs. */
  optionSet<Configs extends Readonly<Record<string, OptionConfig>>>(
    applied: AppliedSet<Configs>,
  ): OptionSetValues<Configs> {
    // Last resort: no typed path exists. The map stores every validated value as `unknown`.
    // A record built from a list of inputs types its keys as `string`, never as the set's names.
    // A typed accessor where a set's entries are stored needs an assertion, and so does this record.
    // It holds because `applied.inputs` copy the entries `optionSet()` built from `Configs`.
    // `AppliedSet` states why they belong to that set, and validation stores each one's output.
    // `Object.fromEntries` defines each name as an own key, a name such as `__proto__` included.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Object.fromEntries(
      applied.inputs.map((input) => [input.name, this.#values.get(input)]),
    ) as OptionSetValues<Configs>;
  }

  /**
   * One validated value read without its declared type, which is what an untyped reader such as a
   * middleware's request receives. The declared types stay with the three readers above.
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

/**
 * Every outcome one run's validation passes settled, which each later pass of the run reads, so a
 * validator runs at most once per run: each value a pass accepted, each input's report, and each
 * input whose validator threw. A pass records its outcomes even when a validator throws, so every
 * value it accepted before the throw stays readable and the input that threw is never validated
 * again.
 */
export class ValidationLedger {
  readonly #reports = new Map<InputDeclaration, Report>();
  readonly #threw = new Set<InputDeclaration>();
  readonly #values = new Map<InputDeclaration, unknown>();

  /** Every value a pass of the run accepted, read as one pass's are. */
  get values(): ValidatedInputs {
    return new ValidatedInputs(this.#values);
  }

  /** Whether a pass of the run reached the declaration: accepted it, reported it, or threw on it. */
  reached(input: InputDeclaration): boolean {
    return this.#values.has(input) || this.#reports.has(input) || this.#threw.has(input);
  }

  /** The report a pass of the run made for the declaration, or `undefined`. */
  report(input: InputDeclaration): Report | undefined {
    return this.#reports.get(input);
  }

  /** Whether the declaration's validator threw in a pass of the run. */
  threw(input: InputDeclaration): boolean {
    return this.#threw.has(input);
  }

  /** One pass's outcomes, and the declaration whose validator threw when the pass stopped on one. */
  record(
    pass: {
      reports: ReadonlyMap<InputDeclaration, Report>;
      values: ReadonlyMap<InputDeclaration, unknown>;
    },
    threw: InputDeclaration | undefined,
  ): void {
    for (const [input, value] of pass.values) {
      this.#values.set(input, value);
    }
    for (const [input, report] of pass.reports) {
      this.#reports.set(input, report);
    }
    if (threw !== undefined) {
      this.#threw.add(threw);
    }
  }
}

/** One validation problem and the lines core's default text holds. */
export interface Report {
  readonly lines: readonly FailureLine[];
  readonly problem: InputProblem;
}
