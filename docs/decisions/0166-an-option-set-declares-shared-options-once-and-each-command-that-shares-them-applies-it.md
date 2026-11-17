---
type: adr
title: ADR-0166 - An option set declares shared options once, and each Command that shares them applies it
description: optionSet() takes a record of option name to option settings and checks each entry as option() would, with the same constraints in the types and the same declaration faults at the call. A set may carry exclusive, oneRequired, and requiredTogether groups over its own members, and each group call returns a new set. options(set) on a Command and on the Application root declares the set's options in the record's order, then its groups, exactly as one option() call per option and one group call per group would, and the action's options type gains each option. A name the receiver already declares, locally or as a global option, is a compile error. Nothing inherits: a parent that applies a set gives its children nothing, and each Command applies the set itself. Inspection, the manifest, and every other projection show nothing about the set. There is no set form for global options, and a set holds options only. It supersedes nothing, ADR-0026's rule that nothing inherits stands, and it narrows ADR-0085's clause that a group call names already-declared local options and returns a new Command.
status: accepted
created: 2026-11-16
modified: 2026-11-17
---

# ADR-0166 - An option set declares shared options once, and each Command that shares them applies it

## Context

`.option(name, config)` declares one option on a Command or on the Application root, and the action's `options` type grows by that option's value type. Each option of a subtree that several Commands share is repeated call by call on every leaf. For one option, an author shares the settings as a constant: the jsonkit example's `src/document-input.ts` exports `documentInput`, and seven Commands call `.option('file', documentInput)`. For several options, and for an option group over them, there is no shared unit: each Command repeats every `.option()` call and every `.exclusive()`, `.oneRequired()`, or `.requiredTogether()` call, and a Command that misses one of them drifts from the others without a compile error. The docs say nothing about reuse.

Other parsers share options by inheritance. Cobra's persistent flags and clap's `global(true)` arguments reach every Command below the one that declares them. [ADR-0026](0026-applications-declare-global-options-through-a-fluent-method.md) carries [ADR-0003](0003-globals-are-application-owned-and-nothing-inherits.md)'s rule that nothing inherits along a path: a global option is one Application-owned declaration, and a local option reaches its own Command's action alone. [ADR-0152](0152-routing-reads-a-groups-own-options-as-it-reads-a-parents-own-options.md) lets routing read a parent's own option, so when a parent and the routed Command both declare an option, the operator may type it at either position, and it binds to the routed Command's option. [ADR-0010](0010-one-graph-serves-runtime-and-projections.md) keeps authoring provenance out of every projection.

The owner settled the shape in grooming (LM-384): a set value built by `optionSet()`, applied per Command by `options(set)`, carrying its own groups, never inherited, invisible to every projection, with no set form for globals, and covered by the existing discarded-declaration lint rule.

## Decision

- **The set.** `optionSet(configs)` takes a record of option name to option settings, the configuration `option()` takes, and returns an `OptionSet`. Each key is an option's declared name, and the set's order is the record's key order as `Object.keys` reads it. The call keeps its own copy of the record and of each entry's keys, as `option()` keeps its config's, so a key the author adds to or replaces on either object later changes nothing the set holds. A set may be empty, and applying an empty set declares nothing.
- **Each entry is checked as `option()` checks it.** The types apply to each entry the constraints `option()` applies to one option: a literal name, no run-wide mark, a default and an implied value in the validator's input type, a validator of several values that accepts one string, and the `validateOmitted` rules. An entry `option()` would refuse at compile time fails to compile at `optionSet()`. At the call, `optionSet()` raises every declaration fault `option()` raises at its call that the set's own entries prove, judged as if each entry were declared in order on a Command that declares nothing else: an invalid name or alias ([`@loomcli/core/declared-name`](../core/diagnostics.md#loomclicoredeclared-name)), two entries that share a spelling, a generated negative form and an alias included ([`@loomcli/core/spelling-taken`](../core/diagnostics.md#loomclicorespelling-taken)), two entries that bind one variable ([`@loomcli/core/variable-bound-twice`](../core/diagnostics.md#loomclicorevariable-bound-twice)), an empty `envDelimiter` ([`@loomcli/core/env-delimiter`](../core/diagnostics.md#loomclicoreenv-delimiter)), an arity that is not a whole number of 2 or more ([`@loomcli/core/option-arity`](../core/diagnostics.md#loomclicoreoption-arity)), two content entries that claim stdin ([`@loomcli/core/stdin-claimed-twice`](../core/diagnostics.md#loomclicorestdin-claimed-twice)), and, for an entry that carries `extensions`, a value its schema rejects or does not answer synchronously ([`@loomcli/core/invalid-extension-value`](../core/diagnostics.md#loomclicoreinvalid-extension-value)), an output that is not plain data ([`@loomcli/core/extension-output`](../core/diagnostics.md#loomclicoreextension-output)), a value another installed copy of `@loomcli/core` built ([`@loomcli/core/foreign-value`](../core/diagnostics.md#loomclicoreforeign-value)), and two entries whose values name two descriptors under one identity ([`@loomcli/core/two-package-copies`](../core/diagnostics.md#loomclicoretwo-package-copies)). Each sentence and correction reads as the one `option()` raises, with `an option set` where `option()` names its Command: `Variable "AT" is bound by an option set option "from" and an option set option "to".`, and for stdin `An option set declares more than one stdin target.`, corrected by `Keep one stdin target in the set.` The finding rebuilds the entry alone in the set's record, `optionSet({ verbose: { … } })`, and marks the part at fault, the entry itself standing for its name, as the entry in a plugin's `options` record does; a fault between two entries carries a finding for each. A declared default and an implied value pass their validators when `run()` starts, as they do for an option `option()` declares.
- **Groups on a set.** A set has `exclusive(...names)`, `oneRequired(...names)`, and `requiredTogether(...names)`, typed over the set's own names, so a group that names a non-member, or fewer than two names, fails to compile. Each call returns a new set that also holds the group, after the groups the receiver holds, and leaves the receiver unchanged. The call applies the [`@loomcli/core/option-group`](../core/diagnostics.md#loomclicoreoption-group) rules no type expresses over the set's own members, at the call: a repeated member, an exclusive group with an individually required member, and an exclusive group and a required-together group that share two or more members, in either declaration order. The types already reject a member the set does not hold and fewer than two members, so under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md) the call judges neither. The sentences read as a Command's do, with `An option set` as their subject: `An option set exclusive repeats option "json".` and `An option set exclusive group contains required option "json".` The finding rebuilds the group call on its set, `optionSet({ … }).exclusive('json', 'yaml')`.
- **A set is a value.** A set never changes. One set applies to any number of Commands, in one Application or several, and a group call or an `options()` call leaves every set it reads as it was.
- **Applying a set.** `options(set)` declares each of the set's options as a local option of its receiver, in the set's order, then each of the set's groups, in the order the set holds them, at the position of the call among the receiver's other calls. The result is the declaration that one `option(name, config)` call per option and one group call per group, in that order, would return. The action's `options` type gains each option's value type, the same `OptionValue` one `option()` call adds. A later group call on the Command may name a set's option beside one of the Command's own, and every group rule judges the set's groups and the Command's together, as one-by-one declarations would.
- **What applying refuses.** A name the receiver already declares as a local option, or one its global options hold, is a compile error at `options()`, which names the fault: `'This option name is already declared on this Command'` or `'This option name is already declared as a global option'`, with the names. At the call, `options()` runs each of the set's options through the one judgment `option()` runs for an option against its receiver, so it raises every fault `option()` would: a spelling the receiver's own options hold ([`@loomcli/core/spelling-taken`](../core/diagnostics.md#loomclicorespelling-taken)), a variable they bind ([`@loomcli/core/variable-bound-twice`](../core/diagnostics.md#loomclicorevariable-bound-twice)), a second stdin claim ([`@loomcli/core/stdin-claimed-twice`](../core/diagnostics.md#loomclicorestdin-claimed-twice)), an extension value whose descriptor and one the receiver already names share an identity ([`@loomcli/core/two-package-copies`](../core/diagnostics.md#loomclicoretwo-package-copies)), and, on the Application root, a key, spelling, or variable a global option holds. A key the receiver's own options hold ([`@loomcli/core/option-declared-twice`](../core/diagnostics.md#loomclicoreoption-declared-twice)) is a compile error for a TypeScript author; the same judgment still sees it, and no rule or sentence is added for it. The sentences read as `option()`'s do, and a fault carries a finding for the receiver's own declaration and one that rebuilds `.options(optionSet({ file: { … } }))` with the set's entry alone and its part marked. The attach and build rules apply to a set's options as to the same options declared one by one, a collision with a global option at attach and the rules for what a group declares included.
- **Findings after the call.** Every later finding about one of a set's options rebuilds the `options()` call that declared it, as the findings at that call do: `.options(optionSet({ json: { … } }))` on its Command, with that entry alone and the part at fault marked. It holds for a later `option()` that repeats the option's key or spelling, whose finding for the first declaration is the `options()` call, for a collision with a global option at attach, for a default or implied value its validator rejects when `run()` starts, and for every other finding that rebuilds the call that declared an input. The author wrote that call and no `option()` call. Core keeps which options a set applied beside the declaration, outside the graph and every projection, so ADR-0010's rule holds. A set another installed copy of `@loomcli/core` built carries no facts this copy can read, so `options()` refuses it with [`@loomcli/core/foreign-value`](../core/diagnostics.md#loomclicoreforeign-value), whose explanation lists an option set beside a provider.
- **Nothing inherits.** Applying a set to a parent declares its options on the parent alone, and its children gain nothing, under ADR-0026's rule. Each Command that shares the options applies the set itself. A set applied to a group gives the group options of its own, which reach no action, as any author's option on a group reaches none. When a parent and a child each apply one set, each declares its own options, so an operator may type such an option before the child's name, and under ADR-0152 it binds to the child's option, exactly as it does when both declare it one by one.
- **Where it exists.** `options(set)` exists on a Command and on the Application root, wherever `option()` does, and the types close it at `action()`, as they close `option()`. `CommandMethod`, and with it `ApplicationMethod`, gains `'options'`. There is no set form for global options: `globalOption()` takes one option, and no `globalOptions()` exists. The erased attached Command a lifecycle hook receives gains no `options()`; a hook declares its options one by one. A set holds options only, never arguments, stdin, or the passthrough mode.
- **Projections.** Inspection, the manifest, help, the man page, completion, and MCP show nothing about a set, under ADR-0010. A Command built with a set is the same in every projection as one that declared the same options and groups one by one, in the same order: the same `options`, the same `optionGroups`, and the same order in each. No graph node, manifest entry, or help line names a set.
- **The types.** The declarations read:

  ```ts
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
  export interface OptionSet<
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
  export function optionSet<const Configs extends Readonly<Record<string, OptionConfig>>>(
    configs: Configs & NoInfer<OptionSetConstraint<Configs>>,
  ): OptionSet<Configs>;
  ```

  The Command builder gains `options()` beside `option()`:

  ```ts
  /**
   * Declares each option of a set as a local option, in the set's order, then each of the set's
   * option groups, as one `option()` call per option and one group call per group would. The
   * action reads each option under `options`. Nothing inherits: a child that shares the options
   * applies the set itself.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#sharing-options
   */
  options<Configs extends Readonly<Record<string, OptionConfig>>>(
    set: OptionSet<Configs> & NoInfer<OptionSetNameConstraint<Configs, Options, Globals>>,
  ): Command<
    Args,
    Options & { [Name in Extract<keyof Configs, string>]: OptionValue<Configs[Name]> },
    Globals,
    State,
    Result,
    Stdin,
    Provided
  >;
  ```

  The Application builder gains the same method for the root, with the same doc comment, which says `local option of the root`:

  ```ts
  options<Configs extends Readonly<Record<string, OptionConfig>>>(
    set: OptionSet<Configs> & NoInfer<OptionSetNameConstraint<Configs, Options, Globals>>,
  ): Application<
    Args,
    Options & { [Name in Extract<keyof Configs, string>]: OptionValue<Configs[Name]> },
    Globals,
    State,
    Plugins,
    Result,
    Stdin,
    Provided,
    Requires
  >;
  ```

  `CommandMethod` gains `'options'` after `'option'`. `@loomcli/core` exports `optionSet` and the type `OptionSet`; `OptionSetConstraint` and `OptionSetNameConstraint` are unexported, so the API report's listed declarations carry them. Each stands only in a parameter, which no inferred type of the author's names. The values `options()` adds are written in its return type as a mapped type in place, not through a named alias: TypeScript keeps an alias by name in the inferred type of a declaration that applies a set, so an unexported alias there would leave a consumer that emits declarations unable to name an exported Command or Application built with a set (`TS2883`), while the mapped type resolves to the option names and their value types, as the `Record` `option()` adds does. The action's types read through it equal, member by member, those of one-by-one declarations, and each is assignable to the other.
- **Lint.** The existing [`discarded-declaration`](../libs/eslint-plugin.md#discarded-declaration) rule of `@loomcli/eslint-plugin` reports a discarded `options()` call on a declaration, and a discarded group call on a set. A value the source builds with `optionSet(...)`, imported from `@loomcli/core`, is a declaration the rules trace, and so is a group call on one. No other rule changes, and no rule is added.

The contract is in [Sharing options](../core/options.md#sharing-options), [Application declarations](../core/application.md), [Commands and global options](../core/commands.md), [Declaration faults](../core/declaration-faults.md#at-the-call), the [lint plugin](../libs/eslint-plugin.md), and the [glossary](../glossary.md#inputs).

## Considered options

- **Inheritance along the path, as Cobra's persistent flags read.** Rejected by the owner's ruling. ADR-0026's rule that nothing inherits stands, so a reader of one Command's declaration sees every option it takes.
- **A plain record passed to `options()`.** Not taken. A record carries no groups, so a set's `exclusive` would be repeated on every Command again, and a record's entries would be checked only where they are applied.
- **A function the author writes that takes a Command and returns it with the options declared.** Possible today, but its signature must restate the Command's type parameters, which an author should not have to write, and its result loses the receiver's exact type state unless the author writes it. A set needs no generic code in the author's module.
- **A set form for global options.** Rejected by the owner's ruling. Global options are already declared once, on the Application.
- **A projection that names the set, such as a help section per set.** Rejected by the owner's ruling. A projection excludes authoring provenance under ADR-0010, and an author who wants the set's options under one heading gives each entry the same `helpInput({ section })` value, which the set carries like any other setting.

## Consequences

A declaration that compiled before compiles and runs the same. `@loomcli/core` gains `optionSet` and `OptionSet`, `Command` and `Application` gain `options()`, an opt-in authoring method, and `CommandMethod` and `ApplicationMethod` gain `'options'`, a string-literal union gaining a member in output position, so none of them breaks an author's code. Core gains no failure class and no rule identity: `optionSet()`, a set's group calls, and `options()` raise the rules `option()` and the group calls already raise, and `@loomcli/core/foreign-value`'s explanation adds an option set. The graph, the manifest, and every projection are unchanged. `discarded-declaration` traces one more value and two more kinds of call.

The jsonkit example adopts a set. Its four Commands that print a JSON value, `get`, the deprecated `fetch`, `select`, and the hidden `debug`, apply one set, `jsonLayout`, which holds `--compact` and `--indent <spaces>`, the two layout settings jq spells `--compact-output` and `--indent n`, with an exclusive group over them. `get` and `fetch` share one action, so the set is what keeps their option types one. `--file` stays a settings constant, because it is one option.

[ADR-0085](0085-a-command-declares-option-groups-over-supplied-local-options.md)'s clause that each group call returns a new Command and names at least two already-declared local options is narrowed: a set's group call returns a new set and names the set's own members, and `options()` declares those groups on the Command, where every rule of ADR-0085 applies to them. ADR-0085 carries a dated entry. ADR-0026's rule that nothing inherits along a path is unchanged.

## Status

Accepted in 0.19.0.

## Changelog

- 2026-11-16: Proposed with the contract (LM-384). It supersedes nothing, and narrows ADR-0085's clause that a group call returns a new Command over already-declared local options. ADR-0085 carries a dated entry.
- 2026-11-16: Amended with the implementation (LM-384). `options()` writes the values it adds as a mapped type in place, so an exported Command built with a set emits declarations. A set's group call judges no member outside the set and no group of fewer than two, which the types reject, under ADR-0093. A set's entry raises the extension faults `option()` raises. Every finding about a set's option rebuilds the `options()` call that declared it, at the call and after it. jsonkit adopts a set.
- 2026-11-16: Amended on the owner's ruling of 2026-11-16, which replaces "No other rule changes" in the Lint decision. The `undescribed` and `name-shape` rules of `@loomcli/eslint-plugin` read the entries of an `optionSet({...})` record, so an option moved into a set keeps the checks it had: `undescribed` reports an entry whose settings leave out `description`, and `name-shape` checks each entry's key and `aliases` as it checks an `option()` call. Both recognise `optionSet` as `discarded-declaration` does. No rule is added.
- 2026-11-16: [ADR-0167](0167-a-command-declares-that-one-option-requires-others-and-the-others-alone-are-accepted.md), proposed, adds `requires(option, ...needed)` to a set's group calls, typed over the set's own members, returning a new set that holds the requirement after the receiver's groups; at the call it judges a repeated name, an option that requires itself, and an exclusive group and a requirement that share two or more members. `options(set)` declares a set's requirements with its other groups. It binds when that record is accepted.
