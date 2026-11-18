---
type: adr
title: ADR-0168 - A Command or an option may declare a visible alias, which every listing shows beside its canonical name
description: "visibleAlias(...names) on a named Command and visibleAliases on an option config declare an alias that is visible, beside alias() and aliases, which stay unadvertised and unchanged. A visible alias is an alias in every other respect, with one namespace, the same routing, the same name rules, and the same declaration faults, and a name declared both ways is one visible alias. Inspection keeps aliases as every alias and gains visibleAliases on CommandNode and OptionNode. Help prints it as the first fact of a row, (alias: ls) or (alias: --minimum), and a Command's own page prints Alias: ls in its masthead before its deprecation line, while usage lines and failure sentences keep the canonical name; the man page follows help. Completion offers a visible alias only where the canonical name does not match what was typed. The manifest lists visible aliases in an aliases field on the Command entry and the option entry, never as an entry of their own. MCP, suggestions, and routing-error candidates are unchanged, and an alias carries no migration message. It supersedes in part ADR-0002's rejection of advertised aliases and its rule that a report showing an alias is a bug, ADR-0056's rule that no listing shows an option alias, and ADR-0043's rule that completion never offers an alias, each for a visible alias."
status: accepted
created: 2026-11-16
modified: 2026-11-18
---

# ADR-0168 - A Command or an option may declare a visible alias, which every listing shows beside its canonical name

## Context

An alias is another name an operator can type. A Command declares one with `.alias('ls')` under [ADR-0002](0002-command-graph-is-a-tree-with-hidden-aliases.md), and an option with `aliases: ['minimum']` under [ADR-0056](0056-an-option-alias-is-an-unadvertised-long-spelling-of-one-option.md). Both records make every alias unadvertised. ADR-0002 rejected advertised aliases with deprecation messages, because "an advertised second name is a second contract to keep", and states that a report that shows an alias is a bug. [ADR-0043](0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) never offers an alias in completion, and it rejected offering one when no canonical name matches, because the menu would advertise a synonym as a name. ADR-0056 carries the same doctrine to options: help, the manifest, completion, and suggestions never list an option alias.

An unadvertised alias serves a mistype, an inference, and a former name. It does not serve a short form that the author wants operators to learn, such as `ls` for `list` or `--minimum` for `--min-bytes`. Today no projection can tell an operator or an agent about such a name, so the author writes it into a description, where no projection reads it as a fact. Other command-line frameworks list aliases: clap's `visible_alias` beside its hidden `alias`, the Aliases block on a Cobra Command's help, and the aliases that oclif and Stricli declare.

The owner settled the shape in grooming (LM-368), on 2026-11-16: a visible counterpart beside each existing form, `.visibleAlias()` and `visibleAliases`, that is an alias in every other respect; inspection keeps `aliases` as every alias and gains `visibleAliases`; help prints a visible alias as a fact and in a Command's own heading, and the man page follows help; completion offers one only where the canonical name does not match; the manifest lists one under its canonical member; MCP, suggestions, and routing-error candidates are unchanged; and no alias carries a migration message.

## Decision

- **The declaration.** `.visibleAlias(...names)` on a named Command declares one or more visible aliases, and `visibleAliases: [...]` on an option's config declares visible aliases of that option. `alias()` and `aliases` are unchanged and stay the default: an alias they declare is unadvertised, as ADR-0002 and ADR-0056 state.
- **An alias in every other respect.** A visible alias is an alias: the same routing, the same name rules, the same namespace, and the same declaration faults.
  - **A Command's.** `visibleAlias()` is variadic and repeatable, and a call with no names does not compile. A visible alias is a portable name, and every canonical name and alias of either kind under one parent shares one namespace. The types close `visibleAlias()` once `action()` is called, as they close `alias()`. The unnamed root has neither call, so `ApplicationMethod` excludes both, and the attached Command a lifecycle hook receives has neither.
  - **An option's.** Every option config that takes `aliases` takes `visibleAliases`, a local option, a global option, an option a plugin declares, an option a lifecycle hook declares, and an entry of an [option set](0166-an-option-set-declares-shared-options-once-and-each-command-that-shares-them-applies-it.md) alike, and `shortOnly` rejects it in the types as it rejects `aliases`. A visible alias follows the declared-name rule and gains every long form the option's polarity generates, `--no-<alias>` included where the option has a negative form, so a visible alias of a `both` Boolean option `color` named `colour` accepts `--colour` and `--no-colour`.
  - **Repeats.** A visible alias that repeats its own Command's name, or its own option's name or a spelling that option already accepts, adds nothing, as an alias does. A name declared both ways, on a Command by both calls in either order or on an option in both lists, is one alias, and it is visible: the explicit visible declaration is what the author asked the listings to show. It keeps the place of its first declaration.
- **Routing, parsing, and reports.** A visible alias routes and parses as an alias does. The routed path, the validation context, every usage line, every failure sentence that names the member by its reported spelling, and every Developer Diagnostic report the canonical name, as they do for an alias. A fault the parser finds names the spelling the operator typed, as it does for any alias.
- **Declaration faults.** A visible alias raises the rules an alias raises, at the same moments and with the same sentences: [`@loomcli/core/portable-name`](../core/diagnostics.md#loomclicoreportable-name) and [`@loomcli/core/sibling-name-taken`](../core/diagnostics.md#loomclicoresibling-name-taken) for a Command's, so a visible alias that repeats a sibling's name, a sibling's alias, or a sibling's visible alias fails at the `command()` call that attaches it, and [`@loomcli/core/declared-name`](../core/diagnostics.md#loomclicoredeclared-name) and [`@loomcli/core/spelling-taken`](../core/diagnostics.md#loomclicorespelling-taken) for an option's, its generated negative form included. A finding marks an alias in the declaration of its kind. A portable-name finding at the call rebuilds the failing `alias()` or `visibleAlias()` call from that call's own names. A sibling-name-taken finding rebuilds a visible alias's `visibleAlias()` call from every visible alias the Command holds, and any other alias's `alias()` call from every alias that is not visible, with that alias marked, so a name declared both ways, which is visible, is marked in the `visibleAlias()` call. For an option, a spelling-taken finding marks a visible alias at its first place in `visibleAliases` and any other alias at its first place in `aliases`, as `aliases.0` is marked today, so a name both lists hold is marked in `visibleAliases`, and a declared-name finding marks the failing name in the list that holds it, `aliases` read first. Core adds no rule identity.
- **Inspection.** `CommandNode.aliases` and `OptionNode.aliases` keep every declared alias, visible ones included, as bare names, and each node gains `visibleAliases`, the visible ones in the order `aliases` holds them, `[]` when there is none. A Command's `aliases` follow call order across `alias()` and `visibleAlias()`. An option's `aliases` hold its config's `aliases` and then its `visibleAliases`, each in its list's order, without a repeat. `aliases` without `visibleAliases` is what no listing shows.
- **Help.** A visible alias is a fact in the right cell of its member's row, in the COMMANDS block, the option blocks, the global option block, and every [ordered help section](../plugins/help.md#ordered-help-sections). It is the first fact in the parenthesis: `alias: <name>` for one, and `aliases: <names>` for several, joined with a comma and a space, in the order `visibleAliases` holds them. A Command's fact names the alias, so `(alias: ls)` and `(aliases: ls, dir)`. An option's fact names each alias's positive long spelling, `(alias: --minimum)`, so a `both` option's alias reads `--colour` and not `--[no-]colour`; a `negative` Boolean option, whose only long spellings are negative, names `--no-<alias>`, the alias's one spelling. The facts after it keep their order, and `deprecated` stays last, so a deprecated Command reads `(alias: ls, deprecated: Use get instead.)`. The routed Command's own page prints `  Alias: ls`, or `  Aliases: ls, dir` for several, as a line of its masthead block before its deprecation line. Usage lines, the hints, and every failure sentence keep the canonical name. Help's restyle styles the alias fact `dim`, as it styles every other fact but `deprecated`, and the whole `Alias:` line `dim`. A hidden member's alias appears nowhere a listing omits the member.
- **The man page.** The man page follows help. An entry's text is help's right cell, so a COMMANDS entry and an OPTIONS entry carry the alias fact, and a Command's DESCRIPTION opens with the paragraph `Alias: <name>` or `Aliases: <names>` before its `Deprecated: <message>` paragraph. An alias of either kind has no page of its own.
- **Completion.** A visible alias is offered only where its member's canonical name does not match what was typed, and an alias that is not visible is never offered, as ADR-0043 states. At a `command` position, a visible child whose canonical name does not start with the prefix offers each of its visible aliases that does, with the child's description, in the child's place. At an `option` position, an option none of whose own offered spellings starts with the prefix offers each spelling of its visible aliases that does, its negative form included, with the option's description, in the option's place; an option that completion leaves out, because the line already gave it or an exclusive group rules it out, is left out under every spelling. So `app l<Tab>` offers `list`, `app ls<Tab>` offers `ls`, `--min<Tab>` offers `--min-bytes`, and `--mini<Tab>` offers `--minimum`. No alias is ever rewritten to its canonical name.
- **The manifest.** A Command entry and an option entry gain `aliases`, which holds the member's `visibleAliases` as bare names, so an alias that is not visible never appears and no alias appears as an entry of its own, and an agent never reads an alias as a second Command. On a Command entry it follows `name`; on an option entry it follows `short`, or `negative` on the Boolean variant, the place `aliases` holds on the node. Under the manifest's Absence rule it is present on every entry of those shapes and reads `[]` when there is none, and under its Stability rule a consumer that does not know the field ignores it.
- **MCP.** A tool's identity is unchanged: a visible alias adds no tool and changes no tool name, and an option's visible alias adds no property to a tool's input schema, whose properties stay keyed by declared name. A tool call names an option by its declared name, as it does today.
- **Suggestions and candidates.** The [suggestions](../plugins/suggestions.md) plugin, the candidates a failure hook reads, and the `candidates` of `UnknownCommandError` and `NonCallableCommandError` hold canonical names alone, a visible alias never among them.
- **No migration message.** An alias of either kind carries no message. A renamed member keeps its old spelling as an alias that is not visible, as today, and a member that is itself retired declares `deprecated`.
- **Lint.** The `@loomcli/eslint-plugin` rules read the visible forms as they read the others. [`name-shape`](../libs/eslint-plugin.md#name-shape) checks each literal name of a `visibleAlias(...)` call against the portable-name rule and each literal in an option's `visibleAliases` array, an option set entry's included, against the declared-name rule, and [`discarded-declaration`](../libs/eslint-plugin.md#discarded-declaration) counts `visibleAlias` among the authoring calls. No rule is added.
- **The types.** The Command builder gains `visibleAlias()` after `alias()`:

  ```ts
  /**
   * Visible aliases are other portable names that route to this Command, as `alias()` declares,
   * and that help, the man page, completion, and the manifest show beside its canonical name:
   * `.visibleAlias('ls')` on `list` prints `(alias: ls)` on its row. They invalidate no call, and
   * the tuple rest parameter rejects a call that names none.
   *
   * @example
   * ```ts
   * import { Command } from '@loomcli/core';
   *
   * export const list = new Command('list', { description: 'List the cache.' })
   *   .visibleAlias('ls')
   *   .action(({ out }) => out.print('cache.db'));
   * ```
   *
   * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/commands.md#visible-aliases
   */
  visibleAlias(
    ...names: [string, ...string[]]
  ): Command<Args, Options, Globals, State, Result, Stdin, Provided>;
  ```

  `CommandMethod` gains `'visibleAlias'` after `'alias'`, and `ApplicationMethod` reads:

  ```ts
  /**
   * Every authoring call an Application can publish, beside `inspect()`, `check()`, `run()`,
   * `invoke()`, and `name`, which always remain.
   * An Application's type state is a subset of these, and each call removes the names it invalidates.
   * The unnamed root declares what a named Command declares, except for `alias()` and
   * `visibleAlias()`: the root answers to no bare token, so it has no name to alias.
   *
   * @public
   * @sealed
   */
  export type ApplicationMethod = Exclude<CommandMethod, 'alias' | 'visibleAlias'> | 'globalOption';
  ```

  The option config types gain `visibleAliases` wherever they declare `aliases`. `OptionSpelling` reads:

  ```ts
  /**
   * The spellings an option declares beyond its long form. `aliases` and `visibleAliases` each add
   * a long spelling for each name, and a visible alias is one that help, completion, and the
   * manifest show beside the option, so `shortOnly`, which removes every long spelling, declares
   * neither.
   */
  type OptionSpelling =
    | {
        short?: ShortAlias;
        shortOnly?: false;
        aliases?: readonly string[];
        visibleAliases?: readonly string[];
      }
    | { short: ShortAlias; shortOnly: true; aliases?: never; visibleAliases?: never };
  ```

  `BackgroundOption`, the `both` variant of `BooleanOption`, and its color-marked variant each gain the member after their `aliases`:

  ```ts
  visibleAliases?: readonly string[];
  ```

  `CommandNode` reads its alias fields as:

  ```ts
  /** The declared aliases, visible ones included, in declaration order. */
  readonly aliases: readonly string[];
  /** The aliases declared visible, in the order `aliases` holds them, which every listing shows. */
  readonly visibleAliases: readonly string[];
  ```

  `StringOptionNode`, which the content variant of `OptionNode` carries through, reads:

  ```ts
  /** The declared aliases as bare names, visible ones included, in declaration order. */
  readonly aliases: readonly string[];
  /** The aliases declared visible, as bare names in the order `aliases` holds them. */
  readonly visibleAliases: readonly string[];
  ```

  The Boolean and counted variants of `OptionNode` gain the member after their `aliases`:

  ```ts
  readonly visibleAliases: readonly string[];
  ```

  No export is added, and none is removed.

The contract is in [Commands and global options](../core/commands.md#aliases), [Option aliases](../core/options.md#option-aliases), [Application declarations](../core/application.md), [Declaration faults](../core/declaration-faults.md#at-the-call), [Graph inspection](../core/graph-inspection.md), [Failures](../core/failures.md), [Lifecycle hooks](../core/lifecycle-hooks.md), the [help page](../plugins/help-page.md), the [help plugin](../plugins/help.md#help-and-version-restyle), the [man page plugin](../plugins/manpage.md), the [completion plugin](../plugins/completion.md), the [manifest plugin](../plugins/manifest.md), the [MCP plugin](../plugins/mcp.md), the [suggestions plugin](../plugins/suggestions.md), the [lint plugin](../libs/eslint-plugin.md), and the [glossary](../glossary.md#names-and-routing).

## Considered options

- **A setting on the existing call, such as `.alias('ls', { visible: true })`.** Rejected by the owner's ruling. A counterpart beside each form keeps `alias()` variadic over names and reads as clap's `visible_alias` beside `alias`.
- **Every alias visible by default.** Rejected by the owner's ruling. An alias that exists for a mistype or a former name would then appear in every listing, and every application that declares one would change its pages.
- **A visible alias as a row or an entry of its own.** Rejected by the owner's ruling. A row per alias doubles the listing, and an agent that reads a manifest entry per alias reads a second Command.
- **A migration message on an alias.** Rejected by the owner's ruling, as ADR-0002 and ADR-0056 rejected it.
- **Offering every visible alias in completion.** Rejected by the owner's ruling. The menu would offer `list` and `ls` side by side on every Tab.
- **Spellings in the manifest's `aliases`, such as `--minimum`.** Not taken. The manifest copies the facts inspection publishes, and `visibleAliases` holds bare names, as `aliases` does.
- **The alias fact last, before `deprecated`.** Not taken. A list of aliases holds commas, and as the first fact it ends where the next fact's opening word starts, so a reader still splits the facts between it and `deprecated` on the comma.
- **A name declared both ways keeps its first declaration's visibility.** Not taken. It would drop an explicit visible declaration in silence.

## Consequences

A declaration that compiled before compiles and runs the same, and an application that declares no visible alias shows the same in every projection but the manifest, whose Command entries and option entries gain `aliases: []`. `Command` gains `visibleAlias()`, an opt-in authoring method; `CommandMethod` gains `'visibleAlias'`, a string-literal union gaining a member in output position; `ApplicationMethod` is unchanged in what it holds; the option config types, which are input types, gain an optional member; and `CommandNode` and the three `OptionNode` variants, which are output types, gain a member. Under the [change-fragment rules](../../.changes/README.md) none of these breaks an author's code. Core gains no failure class and no rule identity.

ADR-0002's considered option that rejects advertised aliases with deprecation messages is superseded in part: a visible alias is declared with `visibleAlias()`, while an alias's deprecation message stays rejected. Its consequence that a report that shows an alias is a bug holds for an alias that is not visible, and a candidate list or a path still never shows a visible one. ADR-0056's sentence that help, the manifest, completion, and suggestions never list an alias is superseded for a visible alias, which help, the man page, completion, and the manifest list, while suggestions still never list one. ADR-0002's entry that no projection reads `aliases` holds for every listing, which reads `visibleAliases` and lists no other alias; the help plugin's help Command resolves each typed word against every alias, as routing does and as it did before this record. ADR-0043's clause that an alias is never offered, and its rejection of offering an alias when no canonical name matches, are superseded for a visible alias, which completion offers exactly then; no alias is ever rewritten. ADR-0010's rule that a Command appears once, under its canonical name, with its aliases in a separate field, holds. ADR-0063's rule that an alias is never a tool and ADR-0079's rule that an alias has no page hold. ADR-0002, ADR-0043, and ADR-0056 carry dated entries.

## Status

Accepted in 0.19.0.

## Changelog

- 2026-11-16: Proposed with the contract (LM-368). It supersedes in part ADR-0002's rejection of advertised aliases and its rule that a report that shows an alias is a bug, ADR-0056's rule that no listing shows an option alias, and ADR-0043's rule that completion never offers an alias, each for a visible alias. ADR-0002, ADR-0043, and ADR-0056 carry dated entries.
- 2026-11-16: The code now follows the Names rule: an option's alias whose long spelling the option already accepts, such as `no-color` on a `both` option `color`, is dropped from `aliases` and `visibleAliases` as a repeat, so it adds no spelling and no listing shows it.
- 2026-11-18: [ADR-0188](0188-the-skills-plugin-generates-each-skills-command-references-from-the-graph-at-install.md), proposed, narrows this record's rule that every listing shows a visible alias, for one listing: a command reference the skills plugin generates shows a Command's visible alias and leaves out an option's, so each option reads as its one long spelling. Help, the man page, completion, and every other listing stand. It binds when that record is accepted.
