import { elided, spelled } from '../diagnostics/diagnostic-text.js';
import type { Finding } from '../diagnostics/diagnostic-text.js';
import { siteFinding } from '../diagnostics/facts.js';
import type { InputSite } from '../diagnostics/facts.js';
import { DeclarationError, quoted } from '../failures/errors.js';
import { claimsStdin, stdinClaimedTwice } from '../inputs/content-rules.js';
import { declareSetGroup } from '../inputs/option-groups.js';
import type { OptionGroup } from '../inputs/option-groups.js';
import { compileNext } from '../inputs/options.js';
import type { CompiledOptions, CompileScope } from '../inputs/options.js';
import type {
  DefaultConstraint,
  ImpliedConstraint,
  OptionConfig,
  OptionValue,
  PerValueConstraint,
  Unmarked,
  ValidateOmittedConstraint,
} from '../inputs/types.js';
import type { OptionInput } from '../inputs/validation.js';
import type { AdmittedDescriptor } from '../plugins/extension.js';
import { admitLocalOption, copyLocalOption } from './globals.js';
import type { GlobalTable } from './globals.js';
import type { NameConstraint } from './types.js';

/** Phantom key. It carries a set's option configurations in a read position and holds no value. */
declare const optionSetConfigs: unique symbol;

/**
 * A typed set of options declared once and applied to each Command that shares them, through
 * `options(set)` on a Command or on the Application root. A set is a value: each group call returns
 * a new set and leaves its receiver unchanged, and one set applies to any number of Commands.
 * Nothing inherits, so a parent that applies a set gives its children nothing.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#sharing-options
 * @public
 * @sealed
 */
interface OptionSet<
  Configs extends Readonly<Record<string, OptionConfig>> = Readonly<Record<string, OptionConfig>>,
> {
  /** Type-only: the configuration of each option the set holds, by name. It holds no runtime value. */
  readonly [optionSetConfigs]: Configs;
  /**
   * Returns a new set that also declares that at most one of the named members may be supplied.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  exclusive(
    ...names: [
      Extract<keyof Configs, string>,
      Extract<keyof Configs, string>,
      ...Extract<keyof Configs, string>[],
    ]
  ): OptionSet<Configs>;
  /**
   * Returns a new set that also declares that at least one of the named members must be supplied.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  oneRequired(
    ...names: [
      Extract<keyof Configs, string>,
      Extract<keyof Configs, string>,
      ...Extract<keyof Configs, string>[],
    ]
  ): OptionSet<Configs>;
  /**
   * Returns a new set that also declares that the named members are supplied all together or not
   * at all.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  requiredTogether(
    ...names: [
      Extract<keyof Configs, string>,
      Extract<keyof Configs, string>,
      ...Extract<keyof Configs, string>[],
    ]
  ): OptionSet<Configs>;
}

/**
 * Each entry of a set meets the constraints `option()` applies to one option, so an entry
 * `option()` would refuse fails to compile at `optionSet()` the same way. A global option's name
 * is judged where the set is applied, because only the receiver knows its globals.
 */
type OptionSetConstraint<Configs> = {
  readonly [Name in keyof Configs]: Unmarked &
    NameConstraint<Name & string> &
    DefaultConstraint<Configs[Name]> &
    ImpliedConstraint<Configs[Name]> &
    PerValueConstraint<Configs[Name]> &
    ValidateOmittedConstraint<Configs[Name]>;
};

/** The values a set's options add to an action's `options`, each the `OptionValue` one `option()` call adds. */
type OptionSetValues<Configs extends Readonly<Record<string, OptionConfig>>> = {
  [Name in Extract<keyof Configs, string>]: OptionValue<Configs[Name]>;
};

/**
 * A set applies only options its receiver does not hold yet: a name the receiver's own options or
 * its global options already hold names the fault, the way the other declaration constraints do.
 */
type OptionSetNameConstraint<Configs, Options, Globals> = ([
  Extract<keyof Configs, keyof Options>,
] extends [never]
  ? unknown
  : {
      'This option name is already declared on this Command': Extract<keyof Configs, keyof Options>;
    }) &
  ([Extract<keyof Configs, keyof Globals>] extends [never]
    ? unknown
    : {
        'This option name is already declared as a global option': Extract<
          keyof Configs,
          keyof Globals
        >;
      });

/** What one set holds: its options in the record's order, each copied, and its groups in call order. */
interface SetFacts {
  readonly entries: readonly OptionInput[];
  readonly groups: readonly OptionGroup[];
}

/**
 * The options one `options(set)` call declared, under the set that typed them, which the action's
 * binder reads as the set's values. Nothing in the types ties `inputs` to `set`: the pairing is a
 * claim the set reader's assertion in `ValidatedInputs` rests on, and it holds because
 * `declareOptionSet` builds each one, from copies of the entries that set's own facts hold.
 */
interface AppliedSet<Configs extends Readonly<Record<string, OptionConfig>>> {
  readonly inputs: readonly OptionInput[];
  readonly set: OptionSet<Configs>;
}

/** Each set this copy of core built registers its facts here, so the value carries none to replace. */
const facts = new WeakMap<object, SetFacts>();

/** The facts behind a set this copy of core built, or `undefined` for any other value. */
function setFacts(value: unknown): SetFacts | undefined {
  return typeof value === 'object' && value !== null ? facts.get(value) : undefined;
}

/** A set's sentences open with this subject, and its phrases name it after a preposition. */
const setSentence = 'An option set';
const setPhrase = 'an option set';

/**
 * Where one entry was declared: its key in the set's record, rebuilt as `optionSet({ name: config })`
 * with that entry alone. The entry stands for the name, as an entry of a plugin's `options` does.
 */
function entrySite(input: OptionInput): InputSite {
  const at = `0.${input.name}`;
  // `Object.fromEntries` defines the key as an own property whatever its name.
  const record = Object.fromEntries([[input.name, input.config]]);
  return {
    at,
    declaration: { arguments: [record], call: 'optionSet' },
    named: at,
    subject: `${setSentence} option ${quoted(input.name)}`,
  };
}

/** The same site with the entry's config elided, for a name judged before the config is read. */
function entryUnread(input: OptionInput): InputSite {
  const site = entrySite(input);
  const record = Object.fromEntries([[input.name, spelled(elided)]]);
  return { ...site, declaration: { ...site.declaration, arguments: [record] } };
}

/** The scope a set's own entries compile under, as a Command's own options compile under its. */
const setScope: CompileScope<OptionInput> = { siteOf: entrySite, subject: setPhrase };

/** The table a set's entries meet, which holds no option: a set has no globals of its own. */
const noGlobals: GlobalTable = { names: new Map(), options: new Map(), variables: new Map() };

/** A set's stdin claims, of which at most one entry may make one, as on a Command. */
function checkSetStdin(entries: readonly OptionInput[]): void {
  const claimed = entries.filter((entry) => claimsStdin(entry));
  if (claimed.length > 1) {
    throw new DeclarationError(stdinClaimedTwice, {
      correction: 'Keep one stdin target in the set.',
      findings: claimed.map((entry) => {
        const site = entrySite(entry);
        return siteFinding(site, site.named, 'claims stdin');
      }),
      sentence: `${setSentence} declares more than one stdin target.`,
    });
  }
}

/**
 * The entries admitted so far, their compile, and the descriptors their extension values name.
 * Each later entry's extension values meet those descriptors, so two copies of one meet in the set.
 */
interface Admitted {
  readonly compiled: CompiledOptions<OptionInput>;
  readonly descriptors: ReadonlyMap<string, AdmittedDescriptor>;
  readonly entries: readonly OptionInput[];
}

/**
 * One entry, judged at `optionSet()` as `option()` judges one option on a Command that declares the
 * entries before it and nothing else: what it proves on its own through `admitLocalOption`, its
 * extension values and each rule its settings answer alone or with an earlier entry, then the stdin
 * claim. Its name is judged before this, by `copyLocalOption`, when the entry is copied.
 */
function admitEntry(admitted: Admitted, input: OptionInput): Admitted {
  let { compiled } = admitted;
  const entries = [...admitted.entries, input];
  const { descriptors } = admitLocalOption(
    input,
    {
      compile: () => {
        compiled = compileNext(compiled, input, setScope);
        return compiled.table;
      },
      declarations: entries,
      descriptors: admitted.descriptors,
      extensions: {
        phrase: `on ${setPhrase} option ${quoted(input.name)}`,
        sentence: `${setSentence} option ${quoted(input.name)}`,
      },
      scope: setScope,
    },
    noGlobals,
  );
  checkSetStdin(entries);
  return { compiled, descriptors, entries };
}

/**
 * The runtime set. Its facts sit in the registry, so the value publishes only its group calls, and
 * each call builds a new set from the facts it reads. It is the set of some record, because its
 * facts hold untyped inputs, so one runtime class serves every set: `optionSet()` types each value
 * by its record with the one assertion there, and the interface carries that type to each group call.
 */
class OptionSetValue implements OptionSet {
  /** Type-only: it holds no runtime value. */
  declare readonly [optionSetConfigs]: Readonly<Record<string, OptionConfig>>;
  readonly #facts: SetFacts;

  constructor(held: SetFacts) {
    this.#facts = held;
    facts.set(this, held);
  }

  exclusive(...names: [string, string, ...string[]]): OptionSetValue {
    return this.#group('exclusive', names);
  }

  oneRequired(...names: [string, string, ...string[]]): OptionSetValue {
    return this.#group('oneRequired', names);
  }

  requiredTogether(...names: [string, string, ...string[]]): OptionSetValue {
    return this.#group('requiredTogether', names);
  }

  /** A new set that holds one more group, after the groups this set holds. */
  #group(kind: OptionGroup['kind'], names: readonly string[]): OptionSetValue {
    const { entries, groups } = this.#facts;
    const finding: Finding = { arguments: names, call: `optionSet({ ${elided} }).${kind}` };
    const group = declareSetGroup({ groups, inputs: entries, kind, names }, finding);
    return new OptionSetValue({ entries, groups: [...groups, group] });
  }
}

/**
 * Declares a set of options once, to apply to each Command that shares them through
 * `options(set)`. Each entry takes the configuration `option()` takes and is checked as `option()`
 * checks it, in the types and at the call. The set's order is the record's key order.
 *
 * @example
 * ```ts
 * import { Command, optionSet } from '@loomcli/core';
 *
 * const output = optionSet({
 *   json: { description: 'Print JSON.', type: 'boolean' },
 *   yaml: { description: 'Print YAML.', type: 'boolean' },
 * }).exclusive('json', 'yaml');
 *
 * export const list = new Command('list', { description: 'List the entries.' })
 *   .options(output)
 *   .action(({ options, out }) => out.print(options.yaml ? 'yaml' : 'json'));
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#sharing-options
 * @public
 */
function optionSet<const Configs extends Readonly<Record<string, OptionConfig>>>(
  configs: Configs & NoInfer<OptionSetConstraint<Configs>>,
): OptionSet<Configs> {
  let admitted: Admitted = {
    compiled: { claims: new Map(), names: new Map(), table: new Map() },
    descriptors: new Map(),
    entries: [],
  };
  // The set keeps its own copy of each entry, so a later change to the record changes nothing.
  // Each entry is judged whole in the record's order, so an earlier entry's fault reports first.
  // Its name is judged before its config is read, so a name fault reads none of that config.
  const inputs: OptionInput[] = [];
  for (const [name, config] of Object.entries(configs)) {
    const entry: OptionInput = { config, kind: 'option', name };
    const input = copyLocalOption(entry, () => entryUnread(entry));
    admitted = admitEntry(admitted, input);
    inputs.push(input);
  }
  const set: OptionSet = new OptionSetValue({ entries: Object.freeze(inputs), groups: [] });
  // Last resort: no typed path exists. The facts hold each entry as an untyped input.
  // So the value types as the set of some record, and only a claim names `Configs`.
  // It holds because this call built the facts from `configs`, one entry per key in its order.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return set as OptionSet<Configs>;
}

export type { AppliedSet, OptionSet, OptionSetNameConstraint, OptionSetValues };
export { optionSet, setFacts };
