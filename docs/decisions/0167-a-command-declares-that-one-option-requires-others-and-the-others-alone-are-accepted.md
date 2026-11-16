---
type: adr
title: ADR-0167 - A Command declares that one option requires others, and the others alone are accepted
description: requires(option, ...needed) on a Command, on the Application root, on the attached Command a lifecycle hook receives, and on an option set declares a one-way requirement between local options, so --password is accepted only with --user while --user alone is accepted. It is an option group of a fourth kind, named in the types as the declared options are. Supplied means what it means for the other groups on both sides, a Boolean at its absent value triggers nothing, a requirement withdraws nothing, and one that holds a member an exclusive group withdrew is not checked, as ADR-0123 states for requiredTogether. A failure is one InputProblem with reason requires, whose sentence names the option and only the options it still lacks. The declaration faults are the option-group rules, with an option that requires itself, and an exclusive group and a requirement that share two or more members. Inspection and the manifest publish { kind, option, requires }, help and the man page print Use --password only with --user., MCP projects dependentRequired, and completion is unchanged. No option sets another option's value. It supersedes in part ADR-0085's clause that richer relationships remain application logic.
status: proposed
created: 2026-11-16
modified: 2026-11-16
---

# ADR-0167 - A Command declares that one option requires others, and the others alone are accepted

## Context

[ADR-0085](0085-a-command-declares-option-groups-over-supplied-local-options.md) gives a Command three option groups over its own options: `exclusive`, `oneRequired`, and `requiredTogether`. None of them states a relationship that holds one way. A Command whose `--password` is accepted only with `--user`, while `--user` alone is accepted, cannot declare it: `requiredTogether('user', 'password')` refuses `--user` alone. The action checks the rule instead, and help, the manifest, and an MCP tool's schema cannot read the action's check, so an operator and an agent learn the rule only from a failed run.

Other parsers declare this relationship. clap's `requires`, yargs' `implies`, and oclif's `dependsOn` each state that one option needs others, and none of them states the reverse. JSON Schema states it as `dependentRequired`, which an MCP tool's input schema can carry.

ADR-0085 limits groups: "Richer relationships, relationships involving globals or arguments, and rules over one option's values remain application logic." A one-way requirement is a richer relationship, so declaring it supersedes part of that clause. [ADR-0123](0123-in-an-exclusive-option-group-the-highest-input-tier-that-supplies-a-member-wins.md) decides an exclusive group by the highest input tier and states how a group of another kind treats a member an exclusive group withdrew. [ADR-0166](0166-an-option-set-declares-shared-options-once-and-each-command-that-shares-them-applies-it.md) lets an option set carry groups over its own members.

The owner settled the shape in grooming (LM-383): a requirement only, never a value; `.requires('password', 'user')` beside the other group calls, wherever they exist; the groups' meaning of supplied on both sides; a failure sentence that names only what the option still lacks; and the projections below, with completion unchanged.

## Decision

- **The declaration.** `.requires(option, ...needed)` declares that supplying `option` requires each of `needed`, while any of `needed` alone, or all of them without `option`, is accepted: `.requires('password', 'user')` accepts `--user` alone and refuses `--password` alone. The first name is the option that has the requirement, and each further name is another option it needs, at least one. Each name is typed as a declared local option of the receiver, as the other group calls type theirs, so a name the receiver does not declare, a global option, and an argument fail to compile, and so does a call that names no further option. `.requires('password', 'user', 'host')` requires both.
- **Where it exists.** `requires()` exists wherever `exclusive()`, `oneRequired()`, and `requiredTogether()` do: on a Command, on the Application root, on the erased attached Command a [lifecycle hook](../core/lifecycle-hooks.md) receives, and on an [option set](../core/options.md#sharing-options), where it names the set's own members and returns a new set that holds the requirement after the receiver's groups. `options(set)` declares a set's requirements with its other groups, in the order the set holds them. `action()` closes it on a Command and on the root, as it closes the other group calls, and a hook calls it under ADR-0028's exemption. `CommandMethod`, and with it `ApplicationMethod`, gains `'requires'`.
- **A requirement only.** A requirement never fills, sets, or defaults another option, under the scope clause ADR-0085 keeps for that: an option that should take a value when another is supplied stays application logic. The action's option types are unchanged.
- **An option group of a fourth kind.** A requirement is an option group: it is published under `optionGroups` beside the other three, it reports through the same validation pass, and every rule of ADR-0085 that does not name a kind holds for it. It is judged after the individual input problems and reported in group declaration order among the other groups.
- **Supplied, on both sides.** A requirement reads the groups' meaning of supplied. The command line, the environment, and the configuration source supply an option, and a default, automatically attached stdin, a malformed environment value, a named value that lowers to absence, and a fill [ADR-0117](0117-a-configuration-value-its-validator-rejects-falls-back-and-validates-against-its-files-directory.md) drops do not. A supplied value its validator rejects still counts.
  - **The trigger.** The requirement applies when its option is supplied, except a Boolean whose value equals its [absent value](../core/options.md#boolean-polarity), which triggers nothing, as it claims no exclusive group under ADR-0123. So with `.requires('pretty', 'format')` on a `both` Boolean `pretty`, `--no-pretty` and a configured `pretty = false` run without `--format`, while a `negative` Boolean is absent as `true`, so a typed `--no-cache` triggers its requirement. A counted or string option triggers it whatever its value.
  - **The needed options.** A needed option satisfies the requirement when it is supplied, as `oneRequired` and `requiredTogether` count a member, so a filled `false`, zero, or empty list counts.
  - **No tier ranks the two sides.** A requirement withdraws nothing and compares no tiers: a configured `user` satisfies a typed `--password`, and an environment `password` requires `user` from any tier.
- **Beside an exclusive group.** A requirement agrees with ADR-0123: the member that won an exclusive group replaced the withdrawn one in every group of another kind. A requirement that holds a withdrawn member, as its option or as a needed option, is not checked, as a `requiredTogether` group that holds one is not. So with `exclusive('token', 'user')` and `requires('password', 'user')`, a configured `user` beside a typed `--token` and a typed `--password` runs, and `password` still reaches the action. A rejected variable that a typed sibling set aside filled nothing, so it is no withdrawn member, and as a needed option it satisfies nothing.
- **An unanswered configuration request.** A needed option whose configuration request went unanswered is unknown, under ADR-0085. The requirement fails only when some needed option is neither supplied nor unanswered, and its sentence names only those. An option whose own request went unanswered is not supplied, so it triggers nothing.
- **The failure.** A broken requirement adds one `InputProblem` to the exit-2 `InputError`, `invalid-input`, whose `reason` is `'requires'`. `inputs` and `spellings` list the option, then each needed option in declaration order, and `supplied` lists the members that counted: the option, and each needed option that was supplied. Spellings follow the reported-spelling convention, and an invocation by name reports declared names. The sentence names the option and only the needed options it still lacks, then both ways out:

  ```text
  Option "--password" requires option "--user". Supply it as well, or remove "--password".
  Option "--password" requires options "--user" and "--host". Supply them as well, or remove "--password".
  ```

  With `--user` given and `--host` not, the sentence names `--host` alone, in the singular form. Three or more lacking options read `"--user", "--host", and "--port"`. The option carries its source label at its first mention when the environment or the configuration source supplied it, as the other group sentences carry one: `Option "--password" (from APP_PASSWORD) requires option "--user". Supply it as well, or remove "--password".` A lacking option was supplied by no tier, so it carries no label. The sentence sits beside the other group sentences in core.
- **Declaration faults.** A requirement is judged at its call under [`@loomcli/core/option-group`](../core/diagnostics.md#loomclicoreoption-group), with the other group calls' finding, which rebuilds the call. On a Command, on the root, and on the attached Command a hook receives, the call raises the option-group rules over its names, in their order: an undeclared local option, a global option and an argument included, `Command "login" requires names undeclared local option "host".`; a repeated name, `Command "login" requires repeats option "user".`; an option that requires itself, `Command "login" requires names option "password" as its own requirement.`, corrected by `Name only other local options after the first.`; and fewer than two names, the rule every group call keeps. The call judges its names in order, each in full before the next: a later name that repeats the first is the option requiring itself, the repeat's more specific sentence, so `.requires('password', 'user', 'password')` reads the self-requirement; another repeated name is the repeat; and then a name the receiver does not declare is undeclared. A requirement and an exclusive group that share two or more members, in either declaration order, are the direct conflict ADR-0085 states for a required-together group: the option could never be supplied with all it needs in one tier. Its sentence reads `Command "login" exclusive and requires groups share at least two options.`, corrected by `Remove one of the conflicting group rules.` A set's `requires()` judges, at the call, what no type expresses over its own members: a repeated name, an option that requires itself, and the conflict, with sentences that open `An option set`. Other redundancy is allowed: a requirement of an individually required option, a requirement another group already implies, a requirement repeated, and two requirements that need each other. Core infers no transitive requirement.
- **Inspection.** `CommandNode.optionGroups` publishes each requirement in declaration order as a frozen `{ kind: 'requires', option: 'password', requires: ['user'] }`, hidden members included, so the entry names each side. `OptionGroup` becomes a union of the member group and the requirement, written in **The types** below.
- **Help and the man page.** Help prints one sentence per requirement among its option-group sentences, in declaration order, naming each member by its reported spelling: `Use --password only with --user.`, and `Use --password only with --user and --host.` for several, `a, b, and c` for three or more. A requirement that holds a content option that accepts stdin adds ` (piped stdin does not count)` before the period, as the other group sentences do. The man page prints help's option-group sentences, every kind, after the entries of its last option section, each its own paragraph after a `.PP`, in help's order. A group with a hidden member prints no sentence on either page.
- **The manifest.** The manifest's `optionGroups` copies each requirement's entry, less a group that names a hidden option, as for the other groups. The entry carries `option` and `requires` and no `options` key, so the manifest's Absence rule reads per shape, every field of an entry's kind present, and its Stability rule gains that an `optionGroups` entry may arrive with a new `kind` that carries its own fields, which a consumer that does not know the kind skips.
- **MCP.** A tool's input schema projects a requirement where the tool exposes every member, under the conditions the other positive groups project: no member is hidden or a control option, and every member has no environment binding and no extension but the MCP plugin's own. Where property presence states each side, the requirement is JSON Schema's `dependentRequired`, `{ dependentRequired: { password: ['user'] } }`, one entry in the schema's `allOf` per requirement: the option is a scalar string option or a scalar content option, and each needed option is a scalar string option, a scalar content option, or a Boolean of `both` polarity, whose named `false` still counts. Otherwise presence alone does not state the rule, because a named Boolean option at its absent value triggers nothing and a named zero count, empty list, or Boolean value without a matching spelling lowers to absence, so the schema writes the same requirement with the value predicates the other groups use, `{ anyOf: [{ not: <claim of the option> }, { allOf: [<presence of each needed option>] }] }`, where the claim is the one an exclusive group reads. A hidden or control member leaves the requirement a rule the run checks, as for the other groups. A requirement whose option is [excluded](../plugins/mcp.md) constrains nothing, because no call supplies its option. A requirement whose option the tool does not exclude, a hidden option that the server's sources still fill included, and one of whose needed options it excludes is the build fault [`@loomcli/plugins/mcp/required-input-excluded`](../core/diagnostics.md#loomclipluginsmcprequired-input-excluded), under [ADR-0112](0112-an-invocation-by-name-may-exclude-options-and-the-mcp-plugin-excludes-an-option-its-author-keeps-off-the-tool.md)'s rule that a group no call could satisfy is a build fault, because every call that supplies the option fails: `Command "login" makes option "password" require option "user" and excludes "user" from its MCP tool, so a call that supplies "password" always fails.`, corrected by `Exclude "password" from the tool as well, or remove exclude from the mcpInput value of "user".` A requirement of several options names each and the first one the tool excludes, in declaration order: `makes option "password" require options "user" and "host" and excludes "host"`, corrected by `... remove exclude from the mcpInput value of "host".`
- **Completion.** Completion does not change. It offers every option a requirement holds, triggered or not, and suppresses only what an exclusive group rules out.
- **Lint.** The existing [`discarded-declaration`](../libs/eslint-plugin.md#discarded-declaration) rule of `@loomcli/eslint-plugin` counts `requires` among the authoring calls on a Loom declaration and on an option set, so a discarded `.requires()` call is reported. No rule is added.
- **The types.** `OptionGroup` reads:

  ```ts
  /**
   * A relationship over supplied local options, in declaration order: a group that states one rule
   * over all its members, or a requirement of one option on others.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   * @public
   * @sealed
   */
  type OptionGroup =
    | {
        /**
         * Which rule the group states: at most one member, at least one member, or all members or
         * none.
         */
        readonly kind: 'exclusive' | 'oneRequired' | 'requiredTogether';
        /** The names of the local options the group relates, in declaration order. */
        readonly options: readonly string[];
      }
    | {
        /** A one-way requirement: supplying `option` requires each option `requires` names. */
        readonly kind: 'requires';
        /** The name of the local option that has the requirement. */
        readonly option: string;
        /** The names of the local options it needs, in declaration order. */
        readonly requires: readonly string[];
      };
  ```

  The group variant of `InputProblem` widens its `reason`:

  ```ts
  reason: 'exclusive' | 'oneRequired' | 'requiredTogether' | 'requires';
  ```

  The Command builder gains `requires()` after `requiredTogether()`:

  ```ts
  /**
   * Declares that supplying the first named local option requires each further one, while a
   * further option alone is accepted: `.requires('password', 'user')` accepts `--user` alone and
   * refuses `--password` without `--user`.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  requires(
    option: Extract<keyof Options, string>,
    ...needed: [Extract<keyof Options, string>, ...Extract<keyof Options, string>[]]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided>;
  ```

  The Application builder gains the same method for the root, whose doc comment says `local option of the root`:

  ```ts
  requires(
    option: Extract<keyof Options, string>,
    ...needed: [Extract<keyof Options, string>, ...Extract<keyof Options, string>[]]
  ): Application<Args, Options, Globals, State, Plugins, Result, Stdin, Provided, Requires>;
  ```

  `AttachedCommand` gains the erased form:

  ```ts
  /** Declares that supplying the first named local option requires each further one. */
  requires(option: string, ...needed: [string, ...string[]]): AttachedCommand;
  ```

  `OptionSet` gains the set form:

  ```ts
  /**
   * Returns a new set that also declares that supplying the first named member requires each
   * further one, while a further member alone is accepted.
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/options.md#declared-option-groups
   */
  requires(
    option: Extract<keyof Configs, string>,
    ...needed: [Extract<keyof Configs, string>, ...Extract<keyof Configs, string>[]]
  ): OptionSet<Configs>;
  ```

  `CommandMethod` gains `'requires'` after `'requiredTogether'`. No export is added, and none is removed.

The contract is in [Declared option groups](../core/options.md#declared-option-groups), [Sharing options](../core/options.md#sharing-options), [Input sources](../core/input-sources.md), [Failures](../core/failures.md), [Declaration faults](../core/declaration-faults.md#at-the-call), [Graph inspection](../core/graph-inspection.md), the [help page](../plugins/help-page.md), the [man page plugin](../plugins/manpage.md), the [manifest plugin](../plugins/manifest.md), the [MCP plugin](../plugins/mcp.md), the [lint plugin](../libs/eslint-plugin.md), and the [glossary](../glossary.md#inputs).

## Considered options

- **`requiredTogether`, as today.** Rejected. It refuses `--user` alone, which the relationship accepts.
- **A setting on the option, such as `requires: ['user']` in `password`'s config, as clap's `Arg::requires` and oclif's `dependsOn` read.** Rejected by the owner's ruling. A group call beside the others keeps one graph fact, `optionGroups`, that every projection already reads, and names are typed against the options declared before it.
- **Setting a value, as clap's `default_value_if` does.** Rejected by the owner's ruling. A requirement is a rule over presence, and a value that depends on another option stays application logic.
- **A sentence that names every needed option.** Rejected by the owner's ruling. A needed option already supplied is not what the operator must change.
- **Reading a withdrawn needed option as absent.** Rejected. ADR-0123 rejected it for `requiredTogether`: a configured `user` beside a typed `--token` would fail every run that types `--password`, for a member the run never reads.
- **Counting a withdrawn needed option as satisfied and checking the rest, as `oneRequired` counts a withdrawn member.** Not taken in this proposal, and open until the record is accepted. It agrees with the rule above for a requirement of one needed option and differs only for several: with `exclusive('token', 'user')` and `requires('password', 'user', 'host')`, a configured `user`, a typed `--token`, and a typed `--password` run without `--host` under the rule above, and fail naming `--host` under this one. This record keeps the rule ADR-0123 gives `requiredTogether`, so each kind that asks for members together skips a group that holds a withdrawn one.
- **No declaration fault for a requirement an exclusive group defeats.** Not taken. ADR-0085 refuses the same direct conflict between an exclusive and a required-together group, and a Developer Diagnostic at the call costs the author less than an option no operator can use.

## Consequences

A declaration that compiled before compiles and runs the same, and a Command without a requirement shows the same in every projection but the man page, which now prints the option-group sentences help prints. `OptionGroup`, an output type, becomes an object union that gains a variant, which the [change-fragment rules](../../.changes/README.md) class as breaking: code that reads `group.options` without narrowing `kind` fails to compile. The group variant of `InputProblem` gains a member of its string-literal `reason`, which is not breaking. `Command`, `Application`, `AttachedCommand`, and `OptionSet` gain `requires()`, an opt-in authoring method, and `CommandMethod` and `ApplicationMethod` gain `'requires'`. Core gains no failure class and no rule identity, and the MCP plugin gains a sentence under an existing rule.

ADR-0085's clause "Richer relationships, relationships involving globals or arguments, and rules over one option's values remain application logic" is superseded in part: a one-way requirement between a Command's own options is declared with `requires()`. Every other relationship it names, those involving globals or arguments, rules over one option's values, and an option that sets another's value, remains application logic. ADR-0085's list of direct conflicts gains the conflict between an exclusive group and a requirement. ADR-0123's rule that the winning member replaces the withdrawn one in every group of another kind holds for a requirement, which is not checked when it holds a withdrawn member. ADR-0166's set groups gain `requires`. ADR-0085, ADR-0123, and ADR-0166 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-16: Proposed with the contract (LM-383). It supersedes in part ADR-0085's clause that richer relationships remain application logic, extends ADR-0085's direct conflicts, applies ADR-0123's rule for a withdrawn member to a requirement, and adds `requires` to ADR-0166's set groups. ADR-0085, ADR-0123, and ADR-0166 carry dated entries.
- 2026-11-16: Amended with the implementation (LM-383). The manifest's Absence and Stability rules name an `optionGroups` entry of a new kind with its own fields. The MCP build fault reads "whose option the tool does not exclude", a hidden option included, gains its plural sentence, and a hidden or control member leaves a requirement a rule the run checks. `dependentRequired` names a scalar string option or a scalar content option on each side. The call judges its names in order, the self-requirement before the repeat. Counting a withdrawn needed option as satisfied is weighed and left open.
