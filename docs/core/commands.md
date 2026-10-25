---
description: Commands, nesting and groups, aliases, hidden and deprecated members, control options, modular authoring, and how global options are consumed and routed.
---

# Commands and global options

This page states how an author declares Commands and global options. Commands cover groups, nesting, aliases, hidden and deprecated members, and modular authoring. A global option is shared by every action, and the page states how core consumes and routes it.

`Application.globalOption(name, config)` declares an option shared by every action. It accepts string, Boolean, and counted option configs, except the presence rules `required` and `validateOmitted`, and returns a new Application with the global output type added. Content options remain local. Keep the returned value; the receiver is unchanged. Declare all globals before the first `command()` or `action()` call. An Application with no global declarations has no application-owned global options.

```ts
import { Application } from '@loomcli/core';

const configured = new Application('jsonkit')
  .globalOption('verbose', { short: 'v', type: 'count' })
  .globalOption('quiet', { type: 'boolean' });
```

Global names, aliases, kinds, polarity, implied values, defaults, and validators follow the [local-option rules](options.md). A global value reaches every action, so `options.verbose` has one type in the root action and in each Command action. A plugin declares global options too, under [Global options from plugins](plugin-contract.md#global-options-from-plugins), and they are global options in every respect: the same configuration, the same parse, the same validation, and values that reach every action typed.

A global option declares no presence rule. Its validation runs on every Command, plugin Commands included, so a rule that it must be supplied would fail the Commands that never read it. `required` and `validateOmitted` are a compile error at `globalOption()`, under [ADR-0044](../decisions/0044-a-global-option-declares-no-presence-rule.md). An omitted global follows its kind's absence rule: `undefined`, a declared default, or `[]` for a string option, a Boolean's polarity, or `0` for a count. A Command that needs an ordinary global value checks for it in its action. A required content source belongs to that Command's local declaration.

`new Command(name, options?)` declares a named Command with `argument()`, `option()`, `alias()`, `command()`, `action()`, and `extend()`. A Command name is a portable name, the rule [Application declarations](application.md) states, because an operator types it at the prompt the way the application name is typed. Names stay plain strings; no handler object is keyed by command name. `configured.command(child)` attaches one child to the root, and `command()` on a named Command attaches one child to it, so a graph nests to any depth, as [Nested Commands and groups](#nested-commands-and-groups) states. A Command takes one options object like the Application does: `description` is the core fact every projection reads under the rule [Extensions](extensions.md) states, `hidden` and `deprecated` are the two core facts [Hidden and deprecated members](#hidden-and-deprecated-members) describes, and `extensions` carries the [extension values](extensions.md) plugins define. Globals are declared on the Application, which registers its environment as shown below.

```ts
interface CommandOptions {
  description?: string;
  hidden?: boolean;
  deprecated?: string;
  extensions?: readonly ExtensionValue<'command'>[];
  uses?: readonly AnyProvider[]; // see Providers
}
```

`uses` lists the [providers](providers.md) whose values the Command's action reads under `provided`, and adds the global options those providers read to the Command's global requirements.

The action `options` object is the intersection of the global values and the selected Command's local values. A sibling Command's local options never appear in it. `.option()` rejects a name the globals already own. `.globalOption()` rejects a name already declared as a root-local option. Both checks apply at compile time and at the call.

## Nested Commands and groups

`command()` belongs to a named Command and to the unnamed root alike, and a Command path nests to any depth. A child of the root is at level 1 and its child is at level 2, so `store cache clear` is two levels below the root, and a Command attached below `clear` sits at level 3. A plugin's [Commands](plugin-contract.md#plugin-commands) are root children at level 1. Core sets no depth limit. A projection that cannot serve a path reports it in a Developer Diagnostic that names the projection and the path, and [ADR-0094](../decisions/0094-core-sets-no-structural-limit-and-a-projection-reports-its-own-limits.md) records the decision.

The Application supplies its globals throughout the graph. Every per-Command rule applies at every level, and a diagnostic that names a parent names the Command that holds the fault, so a nested parent reads as `Command "cache"`. The graph is a tree: one Command value attaches at one point in an Application's graph, and a value reached through two paths is rejected when its subtree joins the Application, so a Command that belongs in two places comes from a function that returns a fresh value for each placement. A separate Application may attach the same value, because each Application claims its nodes anew.

A Command with children and no action is a group. The unnamed root may be a group too. A group holds children alone: a local option on it reaches no handler, because locals never inherit, and core reports nothing for it. A Command with children and an action keeps its options for that action and runs it when routing selects no child. A Command with neither children nor an action keeps the no-action declaration error.

```ts
import { Application, Command } from '@loomcli/core';

import { clearCache, listCache, summarize } from './actions.js';

const clear = new Command('clear').option('force', { type: 'boolean' }).action(clearCache);
const list = new Command('list').action(listCache);
const cache = new Command('cache').command(clear).command(list);

export const store = new Application('store')
  .globalOption('quiet', { type: 'boolean' })
  .command(cache)
  .action(summarize);
```

Routing reads a nested graph the way it reads a flat one. Plain words descend from the root, an own option of a Command with an action and children is read there and carried on to the Command routing reaches, and any other option word no global option declares stops routing at the Command reached, so `store cache clear --force` dispatches `clear` with the global values and its own locals, and `store cache --force clear` names `clear` as the Command that declares `--force`. An unknown child lists the children of the Command that holds it, at every depth.

An invocation that routes to a group fails with code 2 unless a middleware takes it over. The missing subcommand ranks after the structural faults, under [Global consumption and routing](#global-consumption-and-routing), so `store cache --verbose` reports the unknown option and `store cache` reports the missing subcommand.

## Aliases

`alias(...names)` on a named Command declares one or more aliases: other bare tokens that route to that Command. An alias changes routing alone. The routed path, every diagnostic, and the validation context report the canonical name, and the candidate list of an unknown-command or missing-subcommand error holds canonical names alone. An alias is an unadvertised synonym for a common mistype or inference, so `get` reaches a Command named `fetch` for an operator or an agent that guessed; it is never a second name the application advertises, and no projection lists it. It is not an option's short alias, which is a spelling of one option and appears in every projection, and it is not a [hidden Command](#hidden-and-deprecated-members), which is a full Command kept off every listing. An option declares unadvertised synonyms of its own under [Option aliases](options.md#option-aliases).

Aliases belong to the Command value, so a group carries them like any other named Command, and the unnamed root declares none. The call is variadic and repeatable: `.alias('ls', 'list')` and `.alias('ls').alias('list')` declare the same set, in that order. A call with no names does not compile. An alias is a portable name like a Command name, and every canonical name and alias under one parent shares one namespace. An alias that repeats another alias of its own Command or its own Command's canonical name adds no name, so `alias()` skips it, and attach rejects one that repeats a sibling's name or a sibling's alias. The types close `alias()` once `action()` is called.

```ts
const list = new Command('list').alias('ls').action(listCache);
const cache = new Command('cache').command(clear).command(list);
```

`store cache ls` and `store cache list` both dispatch `list`, and the validation context reports `['cache', 'list']` for either spelling. `store cache nope` still lists `clear, list`.

## Hidden and deprecated members

A named Command and an option carry two core facts beside `description`, declared on the Command's options object and on the option config. `hidden` is a Boolean, and an omitted `hidden` reads `false`. `hidden: true` keeps the member off every listing: a help page, a manifest, a completion script, and the candidate list of a routing error omit it, and the member otherwise behaves as any other. A hidden Command routes, runs, and has its own help page when it is routed to directly, and that page lists its own visible children like any other page; a listing that starts from a visible ancestor never reaches them. A hidden option parses and reaches every reader its declaration reaches. When every child of a Command is hidden or deprecated, a routing error at that Command offers no candidates, and its diagnostic ends `Supply the name of a declared command.` or `Supply the name of a declared subcommand.` in place of the `Use one of` clause.

`deprecated` marks a member the application still accepts but no longer advertises as the way to do its job, and its value is the migration message, a string such as `'Use get instead.'`. The type takes a string and no bare `true`, because a deprecation with no migration path leaves an operator or an agent with nothing to do. A projection shows the message beside the member, so a reader learns what to use instead at the point where they choose. A member that is both hidden and deprecated is omitted, because hidden decides what a listing shows.

Both facts apply to a local option and to a global option, whichever declarer declares it. Neither applies to an argument, because a positional cannot leave the grammar it sits in, and neither applies to the root, which is every page's entry point. The types place the facts, and core checks no placement at run time, as [Declaration faults](declaration-faults.md) states. `ApplicationOptions` names neither key, so an options literal that carries one fails to compile. Every `argument()` declarer rejects both keys at compile time, and rejects every other key `ArgumentConfig` does not declare, such as `multiple`, `env`, and `control`, because core reads no such key from an argument. On a Command and on the Application a constraint on the inferred config names each stray key in its message, such as `An argument declares no hidden key`, and on the attached Command a lifecycle hook receives, the `ArgumentConfig` parameter rejects the literal's extra keys. Core never reads either fact on an argument, and `ArgumentNode` carries neither. Routing selects and parsing binds without reading either fact. They are facts for the projections that read the graph, and `inspect()` reports both on every `CommandNode` and `OptionNode`.

```ts
const fetch = new Command('fetch', { deprecated: 'Use get instead.', description: 'Read one value at a path.' }).action(readValue);
const debug = new Command('debug', { description: 'Dump the parsed document.', hidden: true }).action(dump);
```

## Control options

```ts
interface StringOption {
  // ...the keys under Local options...
  control?: boolean; // the option controls the invocation; omitted reads false
}
// BooleanOption and CountOption take the same key.
// So OptionConfig, GlobalOptionConfig, a plugin's options record, and a hook's option() call accept it.
type OptionNode =
  | { readonly type: 'string'; readonly control: boolean /* ...the fields under Graph inspection... */ }
  | { readonly type: 'boolean'; readonly control: boolean /* ... */ }
  | { readonly type: 'count'; readonly control: boolean /* ... */ };
```

```ts
// The help plugin's own option: it asks for a page about the Command, not the Command's work.
const options = {
  help: { control: true, description: 'Show this help.', short: 'h', type: 'boolean' },
} satisfies PluginOptions;
```

A control option controls the invocation rather than feeding the Command's work: `--help`, `--version`, `--manifest`, and `--format` say what the run prints or how it prints it, `--config` says where the run reads its configuration, and an action never reads them as its inputs. Whoever declares the option marks it with `control: true`, and a projection that lists what a Command needs, such as the [MCP](../plugins/mcp.md) tool listing, reads the mark. [ADR-0062](../decisions/0062-a-control-option-is-marked-by-the-plugin-that-declares-it-and-core-never-reads-the-fact.md) records the decision.

- **Options alone.** `control` applies to an option: a local option, a global option, an option a plugin declares, and an option a lifecycle hook declares, under one rule. An argument is always the Command's input, so its config type carries no `control`, as it carries no `hidden` or `deprecated`, and `argument()` rejects the key at the call. The type takes a Boolean, and an omitted `control` reads `false`.
- **Core never reads it.** Routing, parsing, the input-source stage, validation, activation, and dispatch behave as they would without it, as they do for `hidden`. [`invoke()`](invocation.md#invocation-by-name) accepts a control option like any other, so an invocation by name still behaves as the argv that spells it.
- **The declarer marks it.** The graph names no plugin as the source of an option under [ADR-0055](../decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md), so a projection cannot tell a plugin's control option from an application's by origin. Help, version, the manifest, the formatter, the configuration plugin, the interaction plugin, the color plugin, the verbose plugin, and the background plugin set `control: true` on `--help`, `--version`, `--manifest`, `--format`, `--config`, `--no-input`, `--[no-]color`, `--verbose`, `--quiet`, and `--background`, the private example plugin `@loom/explain` sets it on `--explain`, and an application sets it on an option of its own that does the same kind of job.
- **Its readers.** `inspect()` publishes `control` on every `OptionNode` variant, and the [manifest](../plugins/manifest.md) copies it into each option entry. The MCP plugin leaves a control option out of every tool's input schema. Help lists a control option as it lists any other option, so no help page changes.

## Modular authoring

The Application declares globals once and registers its shallow environment in the same TypeScript project. Commands import neither the Application nor its globals. Registration supplies their global output types, including validator transformations.

```ts
// src/application.ts
import { Application } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { get } from './commands/get.js';

const configured = new Application('jsonkit')
  .globalOption('verbose', { type: 'count' });

declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const jsonkit = configured.command(get);
```

Register the configured Application before attaching Commands or registering its action. Registering the completed Application creates a circular dependency through the Commands that consume its types. `EnvironmentOf` reads a type-only marker containing global outputs and the installed plugin tuple. It contains no Command graph or root-local inputs and exposes no runtime property.

Keep one registration per TypeScript compilation context. Separate applications with different registrations need separate compiler projects, including examples and tests. Ensure the registration module is included in each application's project. A reusable library compiles without the consumer's registration. Its emitted Commands retain their own action types and can attach when the Application satisfies their global requirements and their local keys do not collide. A Command's global requirements include those of the [providers](providers.md) it opts in to, and `command()` passes a child's requirements up to its parent, so a library's group requires what its children require. Public `Command` type annotations have neutral defaults; only construction reads the registration.

An extracted action type-imports its own declaration. Keep that declaration's initializer ending in `action(handler)`: TypeScript resolves its outermost call before checking the handler. Appending `extend()` in the same self-referencing initializer makes that action call an inner call and creates circular inference. Derive an enriched value from the completed declaration instead. Inline handlers have no such self-reference.

```ts
// src/commands/get.ts
import { Command } from '@loomcli/core';

import { getValue } from '../actions/get-value.js';

export const get = new Command('get')
  .argument('path', { required: true })
  .action(getValue);

// src/actions/get-value.ts
import type { ActionHandler } from '@loomcli/core';

import type { get } from '../commands/get.js';

export const getValue: ActionHandler<typeof get> = async ({ args, options, out }) => {
  const path: string = args.path;
  const verbose: number = options.verbose;
  if (verbose > 0) await out.info(`Reading ${path}.`);
  return out.print(path);
};
```

`ActionHandler<typeof declaration>` works for a Command and for the root alike. `ActionArgs<typeof declaration>` and `ActionOptions<typeof declaration>` derive the same two objects for a handler that names its parameters separately, as `textstat` does. A handler written inline in `action()` needs no helper, because it infers its context from the declaration it receives.

## Global consumption and routing

```ts
const jsonkit = new Application('jsonkit', { plugins: [help()] })
  .globalOption('verbose', { short: 'v', type: 'count' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .option('file', { short: 'f', type: 'content', stdin: true, required: true })
  .option('raw', { short: 'r', type: 'boolean' })
  .command(
    new Command('get')
      .argument('path', { required: true })
      .option('file', { short: 'f', type: 'content', stdin: true, required: true })
      .option('pretty', { short: 'p', type: 'boolean' })
      .option('raw', { short: 'r', type: 'boolean' })
      .action(readValue),
  )
  .action(summarize);

// jsonkit -f data.json get a.b -qp      routes to get; -q is global, -p is get's own
// jsonkit get a.b -qph                  -h is help's global option, so help renders get's page
// jsonkit -qp -f data.json get a.b      jsonkit: Option "-p" belongs to command "get". Supply it after "get".
// jsonkit -r get a.b -f data.json       the root's own -r carries routing on to get, which receives it
// jsonkit -r -f data.json               the root's action runs with raw set
```

Core reads an invocation in three layers, under [ADR-0055](../decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md). An option word and a plain word are defined in [String values and token consumption](options.md#string-values-and-token-consumption).

1. **Routing** reads the words before the first bare `--` from the root downward.
   - A plain word that names a child, or one of its [aliases](#aliases), descends into that child.
   - A plain word that names no child, while the current Command has children, is an unknown-command error that lists the children's canonical names.
   - A plain word under a Command with no children ends routing, and it is that Command's first argument.
   - An option word is read against the global options, and at a Command with an action and children against that Command's own options too, with the ordinary value rules, so its declaration says whether the next word is its value, and routing continues. Values win over route names: in `jsonkit --file keys get name`, the value of `--file` is `keys`, and routing sees `get name`.
   - A Command with children takes no arguments, under [ADR-0004](../decisions/0004-arguments-and-children-are-exclusive.md), so a plain word after a parent's own option can only name a child: `jsonkit --format json paths` reads the root's own `--format` and routes to `paths`, and `jsonkit --format json` runs the root's action with it. A parent's own option read this way binds to the Command routing finally reaches, at every depth, and its letters in a short group do the same. It binds by the spelling the operator typed, not by declared name, so with the root's Boolean `-v` for `verbose` and `get`'s Boolean `-v` for `values`, `app -v get a` sets `values`, as `app get a -v` does. When that Command does not declare the spelling, the fault is held as for any spelling its table lacks, the unknown-option error unless a visible Command below it declares the spelling. When it declares the spelling with another value class than the parent's declaration routing read it by, the fault is held as the misplaced-option error that names it, because the words the parent's declaration read are never read again. The [value class](../glossary.md#inputs) is the kind of option together with the rule for whether it takes the next word, so there are four: a string option that takes the next word as its value when nothing is attached, a string option with an [implied value](options.md#implied-values), which never takes the next word, a Boolean option, and a [counted option](options.md#counted-options). A content option shares the class of a string option that takes the next word. A held occurrence rebinds only to an option of the same class, so the root's own Boolean `-v` before `get` is misplaced when `get` declares `-v` as a counted option, and the root's own `--backup` with an implied value is misplaced when `get` declares `--backup` as a string option without one. A rebound bare spelling supplies the implied value of the option it binds, so the root's own `--backup` implying `simple` gives `get`'s `--backup` implying `numbered` the value `numbered`. That holds when the parent's declaration found a fault in the word too, such as a missing value or a value after a Boolean, and a declaration of the same class keeps the fault the parent's declaration found. A rebound counted occurrence adds to the count, so the root's own counted `-v` and `get`'s counted `-v` read `app -v get a -v` as `2`.
   - An option word whose walk meets a spelling those options do not declare stops routing at the Command reached, so at a group `-qp` stops when `p` is not global. At a parent with its own `-f` content option, `-fp` instead supplies the path `p` and routing continues. When that Command's table holds the spelling, as a local option of a Command with no children, it is that Command's option. Otherwise the fault is held: a misplaced-option error when a visible Command below the one reached declares the spelling, and an unknown-option error when none does.
   - Routing also ends where the words run out or reach `--`.
2. **The routed Command's words**, up to the first bare `--`, are read against that Command's table. Graph build gives each Command one table, after every [lifecycle hook](lifecycle-hooks.md) has run: its local options, hook-declared ones included, and every global option, each entry referencing its one declaration. A group declares no local option, so its table holds the global options alone. A later plain word is the Command's argument, even when it matches a child's name. An option word the table does not hold is the misplaced-option error when a visible Command below the routed one declares it, and the unknown-option error otherwise, wherever it sits.
3. **Each owner reads its values.** Global values reach every action and every middleware's `options`. Local values reach the routed Command's action and the [request](middleware.md).

A global option that is neither multiple nor counted, supplied more than once, fails as a repeated option at any placement, whichever layer read each occurrence. A global counted option counts every occurrence at any placement, so `jsonkit -v get a.b -v` reads `verbose` as `2`. Words at and after `--` are never inspected, so a `--file` in the passthrough tail stays in the tail.

- **The unknown command is raised.** It is the one fault core raises before the chain, because no Command was reached to render help for. Its `path` is the partial path routing walked.
- **Every other fault is held.** A structural fault on a global option, a misplaced or unknown option, a missing value, a repeated option, an unexpected argument, a group's missing subcommand, and a validation problem are held and raised at the [dispatch boundary](middleware.md), so a middleware can take any of them over: `jsonkit -qp -f data.json get a.b --help` renders the root's page.
- **Parsing continues past a fault.** After the first fault, the rest of the words are still read against the same table, so every global option is found wherever it sits. The first fault in word order is the one held, and later faults are dropped. An unknown or misplaced option word takes no value.
- **A faulted occurrence supplies nothing.** It sets no value, records no spelling, activates nothing, and leaves its option to the [input sources](input-sources.md). An earlier well-formed occurrence of a repeated option stands, so `jsonkit --help --help` renders help.
- **Precedence.** The unknown command comes first. Then the first structural fault in word order, then a group's missing subcommand, then the validation problems. So `store cache --verbose` reports the unknown option, and `store cache` alone reports the missing subcommand.
- **Validation.** One validation pass checks the global options in authoring order, whatever was held, then the routed Command's own declarations in authoring order, only when no structural fault is held and the Command is not a group. Under any held fault, structural, input-source, or validation, core still validates each of a plugin's own options whose tokens parsed and that no pass reached, its global options and the local options its hook declared on a routed Command that is not a group, so that plugin's middleware reads its value under [`ownOptions`](middleware.md); the held fault stays the one raised. A validator runs at most once per run: that pass reuses every value and problem an earlier pass settled, those the validation pass settled before a validator threw included, never calls a validator a second time, and leaves the option whose validator threw absent from `ownOptions`.

A missing required input is a validation-phase problem, so it loses to every structural fault: `jsonkit nope` reports the unknown command and validates nothing. Inside the phase, problems aggregate in authoring order, the global options first, so an invocation that omits both a required `path` argument and a required `--depth` option on the same Command reports every omission in one failure.

The misplaced-option error is `MisplacedOptionError` under [Failure classes](failures.md#failure-classes). For a parent's own option the routed Command declares with another value class, it names the routed Command, which the operator typed. Otherwise it names the visible Commands below the one routing reached that declare the spelling, in authoring order and by their path from the root, and it leaves out a hidden or deprecated Command, as every routing error's candidates do. When only such Commands declare it, the error is the unknown-option error, so it never names a Command a listing hides.

| Invocation for a `get` and `keys` graph            | Diagnostic                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `--file data.json nope`                            | `Unknown command "nope". Use one of: get, keys.`                                           |
| `--file data.json get`                             | `Argument "path" requires a value. Supply a value for "path".`                             |
| `--file data.json keys extra`                      | `Command "keys" accepts no arguments. Remove the supplied values.`                         |
| `-r get a.b` with `-r` local to `get`              | `Option "-r" belongs to command "get". Supply it after "get".`                             |
| `-r get a.b` with `-r` local to `get` and `keys`   | `Option "-r" belongs to commands get, keys. Supply it after the command name.`             |
| `-r get a.b` with `-r` declared nowhere            | `Unknown option "-r". Supply a declared option; prefix a hyphenated path with "./".`       |
| `-r get a.b` with `-r` local to the root and to `get` | None: `get` runs with its own `raw` set                                                 |
| `--verbose get a.b` with `--verbose` local to the root alone | `Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".` |
| `-n x get a.b` with a string `-n` on the root and a Boolean `-n` on `get` | `Option "-n" belongs to command "get". Supply it after "get".`        |
| `-v get a.b` with a Boolean `-v` on the root and a counted `-v` on `get` | `Option "-v" belongs to command "get". Supply it after "get".`        |
| `--backup get a.b` with `--backup` implying a value on the root and taking the next word on `get` | `Option "--backup" belongs to command "get". Supply it after "get".` |
| `-qp --file data.json get a.b` with `-p` on `get`  | `Option "-p" belongs to command "get". Supply it after "get".`                             |
| `--file one.json get a.b -f two.json`              | `Option "-f" can be supplied only once. Remove the repeated option.`                       |
| `get a.b` with a required `--depth` on `get`       | `Option "--depth" is required. Supply a value.`                                            |
| no tokens with an actionless root                  | `A command is required. Use one of: get, keys.`                                            |
| `cache` for a `cache` group                        | `Command "cache" requires a subcommand. Use one of: clear, list.`                          |
| `cache --verbose` for a `cache` group              | `Unknown option "--verbose". Supply a declared option; prefix a hyphenated path with "./".` |

## Command declaration errors

Each rule below is a `DeclarationError` with code 1 that names both sides with a correction, and it throws at the moment [Declaration faults](declaration-faults.md) assigns it. Each rule's identity links to its headline and explanation in the [diagnostics reference](diagnostics.md). The rules cover names, the arguments' order, the collisions between global and local options, the siblings under one parent, and a Command with nothing to run, at every level of the tree. [Result declaration errors](results.md#result-declaration-errors), [Input source declaration errors](input-sources.md#input-source-declaration-errors), and [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) list the rules for results, for environment bindings and the configuration source, and for plugins. Each rule here is a plausible mistake the types cannot express, or one the parser cannot serve. The types reject the rest at the call, such as a second action, a declaration call after the action, an `alias()` call with no names, or a fact in a place that does not carry it, and core adds no rule for a value that bypasses them, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A plugin's [Commands](plugin-contract.md#plugin-commands) join the root outside the types, so arguments beside children and a local option that repeats a global option's key reach every author when a plugin brings them. Every rule applies at every level, and a diagnostic names the Command that holds the fault. The closures `action()` applies are judged against the author's own calls; a call a plugin's [lifecycle hook](lifecycle-hooks.md) issues is exempt from them and from nothing else. [`inspect()`](graph-inspection.md) applies every build rule `run()` applies, so the only faults it leaves to `run()` are a declared default and an implied value that their validator rejects. In a [development build](release-facts.md#development-builds) a converter that fails is a build fault from both, under [Checks only development runs](release-facts.md#development-builds); a distributed build reads its schema as `null` under both, as [Input schema](validation.md#input-schema) states.

- **Arguments or children.** A Command declares arguments or attaches children, never both: [`@loomcli/core/arguments-beside-children`](diagnostics.md#loomclicorearguments-beside-children).
- **Child names.** Two children of one parent never share a name, and an alias never repeats a sibling's name or a sibling's alias: [`@loomcli/core/sibling-name-taken`](diagnostics.md#loomclicoresibling-name-taken).
- **One placement.** A Command value attaches under one parent. Attach a Command value at one point, and create a new Command for each placement: [`@loomcli/core/command-attached-twice`](diagnostics.md#loomclicorecommand-attached-twice).
- **Portable names.** The application name, a Command name, and an alias name are [portable names](../glossary.md#names-and-routing). `new Application()` throws the fault before it reads any option, and `new Command()` throws it before any parent exists, so its sentence names the Command alone: [`@loomcli/core/portable-name`](diagnostics.md#loomclicoreportable-name).
- **Argument names.** An argument name is nonempty and has no leading hyphen, whitespace, or `=`: [`@loomcli/core/declared-name`](diagnostics.md#loomclicoredeclared-name).
- **Global and local option keys.** A global option and a local option never share a key. A local option a plugin's hook declared reports through the hook-collision rule of [Plugin declaration errors](plugin-contract.md#plugin-declaration-errors) instead: [`@loomcli/core/option-declared-twice`](diagnostics.md#loomclicoreoption-declared-twice).
- **Global and local option spellings.** A global option and a local option never share a spelling: [`@loomcli/core/spelling-taken`](diagnostics.md#loomclicorespelling-taken).
- **Something to run.** A Command has children or an action: [`@loomcli/core/command-without-action`](diagnostics.md#loomclicorecommand-without-action).
- **One copy of a package.** Two distinct objects under one identity, such as an override key from a second copy of a package, are a fault. One rule reports every identity collision, whichever lists hold the two objects: [`@loomcli/core/two-package-copies`](diagnostics.md#loomclicoretwo-package-copies).
- **Variadic last.** A variadic argument is the Command's last argument: [`@loomcli/core/variadic-argument-last`](diagnostics.md#loomclicorevariadic-argument-last).
- **Optional after required.** A required argument never follows an optional one. Two optional arguments in a row are valid: bare words fill them left to right, and one that receives no word is omitted: [`@loomcli/core/optional-argument-last`](diagnostics.md#loomclicoreoptional-argument-last).
- **One declaration per argument.** A Command declares each argument name once: [`@loomcli/core/argument-declared-twice`](diagnostics.md#loomclicoreargument-declared-twice).

Local options on separate Commands can reuse names and spellings, with a different value shape on each one, so `--field` and `-F` can collect strings on one Command, read as a Boolean with `--no-field` on a sibling, and carry a validated scalar on a nested leaf. Each action sees only its own Command's declarations and the global options. A Command's table references each global option's one declaration and never copies it, so a diagnostic names the declarer.
