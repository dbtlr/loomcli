import { elided, spelled } from '../diagnostics/diagnostic-text.js';
import type { Finding } from '../diagnostics/diagnostic-text.js';
import { siteFinding } from '../diagnostics/facts.js';
import type { InputSite } from '../diagnostics/facts.js';
import { DeclarationError, quoted } from '../failures/errors.js';
import { stdinClaimedTwice } from '../inputs/content-rules.js';
import { declareSetGroup } from '../inputs/option-groups.js';
import type { OptionGroup } from '../inputs/option-groups.js';
import { checkOptionName, compileNext } from '../inputs/options.js';
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
import { buildExtensions } from '../plugins/extension.js';
import type { DescriptorRegistry } from '../plugins/extension.js';
import { checkLocalOptions } from './globals.js';
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
 * binder reads as the set's values.
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
  const claimed = entries.filter(
    (entry) => entry.config.type === 'content' && entry.config.stdin === true,
  );
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
 * One entry, judged at `optionSet()` as `option()` judges one option on a Command that declares the
 * entries before it and nothing else: its name, its extension values, and each rule its settings
 * answer alone or with an earlier entry.
 */
function admitEntry(
  admitted: { compiled: CompiledOptions<OptionInput>; entries: readonly OptionInput[] },
  input: OptionInput,
  descriptors: DescriptorRegistry,
): { compiled: CompiledOptions<OptionInput>; entries: readonly OptionInput[] } {
  checkOptionName(input.name, () => entryUnread(input));
  const site = entrySite(input);
  // The descriptors the set's entries name register together, so two copies of one meet here.
  buildExtensions({
    declared: input.config.extensions,
    descriptors,
    site: { ...site, at: `${site.at}.extensions` },
    subject: { phrase: `on ${setPhrase} option ${quoted(input.name)}`, sentence: site.subject },
  });
  let { compiled } = admitted;
  const entries = [...admitted.entries, input];
  checkLocalOptions(
    {
      compile: () => {
        compiled = compileNext(compiled, input, setScope);
        return compiled.table;
      },
      declarations: entries,
    },
    noGlobals,
    setScope,
  );
  checkSetStdin(entries);
  return { compiled, entries };
}

/**
 * The runtime set. Its facts sit in the registry, so the value publishes only its group calls, and
 * each call builds a new set from the facts it reads. Its phantom configuration is `never`, which
 * holds no value, so one runtime class answers to the `OptionSet` of every record: the record's
 * types travel from `optionSet()`'s argument through its return type, never through this class.
 */
class OptionSetValue implements OptionSet<never> {
  /** Type-only: it holds no runtime value. */
  declare readonly [optionSetConfigs]: never;
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
  // The set keeps its own copy of each entry, so a later change to the record changes nothing.
  const inputs = Object.entries(configs).map(([name, config]): OptionInput => ({
    config: { ...config },
    kind: 'option',
    name,
  }));
  const descriptors: DescriptorRegistry = new Map();
  let admitted: { compiled: CompiledOptions<OptionInput>; entries: readonly OptionInput[] } = {
    compiled: { claims: new Map(), names: new Map(), table: new Map() },
    entries: [],
  };
  for (const input of inputs) {
    admitted = admitEntry(admitted, input, descriptors);
  }
  return new OptionSetValue({ entries: Object.freeze(inputs), groups: [] });
}

export type { AppliedSet, OptionSet, OptionSetNameConstraint, OptionSetValues };
export { optionSet, setFacts };
