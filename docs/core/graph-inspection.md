---
description: "Reading the built command graph with inspect(), locating a word with locate(), and checking the declarations with check()."
---

# Graph inspection

`inspect()` returns the declared graph as plain data. It answers in every authoring state, as `run()` and `name` do, and it is synchronous. It applies every build rule `run()` applies before it reads a token, in the same order, except one: it does not pass a declared default or an implied value through its validator, because that call can be asynchronous. A fault an authoring call, a constructor, or an attach can detect has already thrown from that call, under [Declaration faults](declaration-faults.md), so `inspect()` never meets it. A rejected build throws the exported `DeclarationError`, which a consumer catches by class. `run()` reports the same message as a diagnostic with exit code 1. A run reports a default or an implied value its validator rejects, which neither `inspect()` nor `check()` reports. In a development build a validator whose converter fails is a build fault from `inspect()` and `run()` alike under `@loomcli/core/schema-converter-failed`; a distributed build reads its schema as `null` under both, as [Input schema](validation.md#input-schema) states. `inspect()` captures no host and reads only the baked release facts, and it caches nothing: each call builds the graph anew. It learns its build from the facts the build baked in, as [Release facts](release-facts.md) states, so `inspect()` in a source run or a development build runs the converter check. Malformed baked facts make `inspect()` throw the `InternalError` of `@loomcli/core/invalid-release-facts`, as [Release facts](release-facts.md) states. [`check()`](#checking-the-declarations) returns every fault a development run reports before routing, except a declared default or implied value its validator rejects, instead of throwing the first.

```ts
import { DeclarationError } from '@loomcli/core';

try {
  const graph = app.inspect();
  process.stdout.write(`${graph.root.children.length} commands\n`);
} catch (error) {
  if (error instanceof DeclarationError) {
    process.stderr.write(`${error.message}\n`);
  }
}
```

```ts
interface CommandGraph {
  readonly name: string;
  readonly version: string;
  readonly description: string | undefined;
  readonly globals: readonly OptionNode[];
  readonly root: CommandNode;
  readonly postInstall: PostInstall | undefined; // see The post-install declaration in Application declarations
  readonly configuration: ConfigurationNode | null;
}
interface ConfigurationNode {
  readonly schema: Readonly<Record<string, unknown>> | null;
}
interface CommandNode {
  readonly name: string | null;
  readonly aliases: readonly string[];
  readonly path: readonly string[];
  readonly description: string | undefined;
  readonly hidden: boolean;
  readonly deprecated: string | undefined;
  readonly hasAction: boolean;
  readonly result: ResultNode | null;
  readonly arguments: readonly ArgumentNode[];
  readonly options: readonly OptionNode[];
  readonly optionGroups: readonly OptionGroup[];
  readonly children: readonly CommandNode[];
  readonly extensions: Readonly<Record<string, unknown>>;
}
interface OptionGroup {
  readonly kind: 'exclusive' | 'oneRequired' | 'requiredTogether';
  readonly options: readonly string[];
}
interface ResultNode {
  readonly kind: 'value' | 'rows';
  readonly views: readonly string[];
  readonly default: string;
  readonly mediaTypes: Readonly<Record<string, string | null>>; // each view's media type, by view name
}
interface ArgumentNode {
  readonly name: string;
  readonly description: string | undefined;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly validated: boolean;
  readonly validateOmitted: boolean;
  readonly schema: Readonly<Record<string, unknown>> | null;
  readonly default: { readonly value: unknown } | undefined;
  readonly extensions: Readonly<Record<string, unknown>>;
}
type OptionNode =
  | {
      readonly type: 'string';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean; // see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly aliases: readonly string[];
      readonly required: boolean;
      readonly requiredWhen: 'non-interactive' | null; // see Interaction
      readonly multiple: boolean;
      readonly validated: boolean;
      readonly validateOmitted: boolean;
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: readonly string[];
      readonly envDelimiter: string | null; // see Input sources
      readonly envAllowEmpty: boolean; // see Input sources
      readonly default: { readonly value: unknown } | undefined;
      readonly implied: string | null;
      readonly background: boolean; // see Background
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'boolean';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean; // see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly negative: string | null;
      readonly aliases: readonly string[];
      readonly polarity: 'positive' | 'negative' | 'both';
      readonly interaction: boolean; // see Interaction
      readonly color: boolean; // see Color
      readonly schema: Readonly<Record<string, unknown>> | null;
      readonly env: readonly string[];
      readonly extensions: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'count';
      readonly name: string;
      readonly description: string | undefined;
      readonly hidden: boolean;
      readonly deprecated: string | undefined;
      readonly control: boolean; // see Control options
      readonly long: string | null;
      readonly short: string | null;
      readonly aliases: readonly string[];
      readonly verbose: boolean; // see Verbosity
      readonly quiet: boolean; // see Verbosity
      readonly schema: null;
      readonly env: readonly string[];
      readonly extensions: Readonly<Record<string, unknown>>;
    };
```

- `name` is `null` for the root, and `path` is the route from the root: `[]` for the root and `['cache', 'clear']` for a nested leaf. Children and declarations appear in authoring order.
- `aliases` holds the Command's [aliases](commands.md#aliases) in declaration order, and `[]` for the root and for a Command that declares none. A Command appears once, under its canonical name, so `path` never holds an alias. Help, the manifest, and [completion](../plugins/completion.md) omit them, because an alias is unadvertised; routing and [`locate`](#locating-a-word) resolve them.
- `hidden` and `deprecated` are the core facts [Hidden and deprecated members](commands.md#hidden-and-deprecated-members) describes: `hidden` is `false` unless the declaration says `true`, and `deprecated` is the declared message or `undefined`. The root reads `hidden: false` and `deprecated: undefined`. A listing projection omits a hidden node and marks a deprecated one; the candidate list of a routing error omits both, as completion does; routing selects and parsing binds without reading either.
- The globals appear once on the graph and never inside a `CommandNode`. A help or manifest consumer combines the two sets for display.
- Spellings are the accepted CLI forms, read from the table the parser reads. `long` is `'--dry-run'` for the declared name `dry-run` and `null` under `shortOnly`, `short` is `'-f'`, and `negative` is `'--no-total'` for `both` and `negative` polarity alone, and each reports the spelling the declared name derives, never an alias's. `aliases` holds the option's declared [aliases](options.md#option-aliases) as bare names in declaration order, such as `['minimum']`, and `[]` when it declares none. Help, the manifest, and completion omit them, because an alias is unadvertised; parsing and `locate` resolve them. `env` holds the variables the option's [environment binding](input-sources.md) names, in declaration order, and is `[]` when it declares none, whoever declared the option. A binding declared as one name publishes a one-element array. `envDelimiter`, on the string variant and the content variant, is the delimiter a multiple option's binding declares, under [Environment lists](input-sources.md), and `null` when the option declares none. `envAllowEmpty`, on the string variant alone, is `true` when the binding lets a defined empty variable supply the option, under [Empty values](input-sources.md), and otherwise `false`.
- A content option's node is the string variant with `type: 'content'`, `stdin`, `min`, and `max`, and without `background` and `envAllowEmpty`. [Content inputs](validation.md#content-inputs) describe it.
- `control` is the fact [Control options](commands.md#control-options) describes: `true` when the declaration marks the option as controlling the invocation, and `false` otherwise. Routing, parsing, and validation read it nowhere.
- `type` is the option's kind. A string option's `implied` is the [implied value](options.md#implied-values) a bare spelling supplies, or `null` when it declares none, and its `background` is `true` on the option that carries the [background mark](background.md) and `false` on every other. A [counted option](options.md#counted-options) has no negative spelling, no polarity, no default, and no validator, so its node carries none of those fields, and its `schema` is always `null`. Its `verbose` and `quiet` are the [verbose mark and the quiet mark](verbosity.md), `true` on the option that carries one.
- Validator objects stay private. `validated` says whether a validator exists, `validateOmitted` says whether the declaration sends its omission to that validator, and `schema` is the plain [input schema](validation.md#input-schema) that validator publishes through its converter, or `null` where the graph holds no published shape. `default` wraps the declared input value, so an explicit `default: undefined` reads apart from no default at all. The wrapped value is the default as declared, the one value every reader sees: a run passes that same value to the default's validator, and an array default still reaches the action as its own mutable copy.
- `version` is the string the Application declares, or `0.0.0` when it declares none, so it is never `undefined`. Every `description` is the core fact the declaration carries, or `undefined` when omitted. The root `CommandNode` reports the Application's description, the value `CommandGraph.description` holds, so a projection that walks nodes never special-cases the root. The graph names no plugin as the source of anything: which plugin contributed an option is provenance, and a projection describes the built product alone. An extension key carries its defining plugin's identity because that identity is the fact's name, the way a package name is part of an import, not a record of who installed what.
- `globals` holds every global option in one list: the application's declarations, then each plugin's in installation order. Nothing in an entry tells an application's global option from a plugin's, because the two are one kind under [ADR-0055](../decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md), and the graph names no plugin as the source of anything. Every string entry reads `required: false` and `validateOmitted: false`, because a global option declares no presence rule, so a projection does not branch on them.
- `result` is `null` on a Command that declares none, and otherwise the kind, the view names in record order, the default, and the media type each view declares, keyed by view name, under [Results](results.md) and [Media types](results.md#media-types). The names include every view a plugin's `onCommandAttach` hook added, and an option such a hook declared appears under the node's `options` like any local option, because the graph names no plugin as the source of anything.
- `configuration` is `null` when no installed plugin claims the [configuration source](input-sources.md) slot. Otherwise it is `{ schema }`, where `schema` is the input-side JSON Schema the source's `schema` publishes through its converter, derived at build as an [input schema](validation.md#input-schema) is, or `null` when the source declares no schema, its schema publishes no converter, or its converter fails, which is never a fault. It describes the configuration the source reads, not the plugin that reads it, so the graph still names no plugin. [ADR-0121](../decisions/0121-the-configuration-source-publishes-its-files-json-schema-as-a-core-graph-fact.md) records the decision.
- `extensions` holds each [extension value](extensions.md) the declaration carries, keyed by extension identity, as the frozen plain-data output of its schema. A [collecting extension](extensions.md#collecting-extensions) holds the frozen array of its values' outputs in collection order, and a declaration that carries none of its values has no key for it. `readExtension(node, descriptor)` is the typed read; the record is the projection-neutral form.
- The result is frozen, except each `default`'s wrapped value, which is the value the author declared, and each `schema`, which is the object the validator's converter returned, `configuration.schema` included. Its types are read-only, so a consumer reads it without copying it.

```ts
const graph = app.inspect();
const names = graph.root.children.map((child) => child.path.join(' '));
```

## Locating a word

```ts
declare function locate(graph: CommandGraph, words: readonly string[]): WordPosition;

type WordPosition =
  | { readonly kind: 'command'; readonly command: CommandNode; readonly prefix: string }
  | {
      readonly kind: 'option';
      readonly command: CommandNode;
      readonly prefix: string;
      readonly supplied: readonly string[];
      readonly counts: ReadonlyMap<string, number>;
      readonly booleans: ReadonlyMap<string, boolean>;
    }
  | {
      readonly kind: 'value';
      readonly command: CommandNode;
      readonly option: OptionNode;
      readonly lead: string;
      readonly prefix: string;
    }
  | { readonly kind: 'argument'; readonly command: CommandNode; readonly argument: ArgumentNode; readonly prefix: string }
  | { readonly kind: 'passthrough'; readonly command: CommandNode; readonly prefix: string }
  | { readonly kind: 'none' };
```

```ts
import { locate } from '@loomcli/core';

const graph = jsonkit.inspect();
locate(graph, ['g']); // { kind: 'command', command: <root>, prefix: 'g' }
locate(graph, ['ls', '--']); // { kind: 'option', command: <keys>, prefix: '--', supplied: [], counts: Map(0) {}, booleans: Map(0) {} }
locate(graph, ['paths', '--format=j']); // { kind: 'value', option: <format>, lead: '--format=', prefix: 'j', ... }
```

`locate(graph, words)` reads an unfinished invocation against a graph and reports where its last word sits. [ADR-0042](../decisions/0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md) records the decision. `words` holds the tokens after the application name, and the last one is the word being completed, which may be empty; an empty list reads as one empty word.

- **One grammar.** Core's parser and `locate` read tokens through one implementation of the grammar under [Local options](options.md) and [Global consumption and routing](commands.md#global-consumption-and-routing): routing through canonical names and [aliases](commands.md#aliases) while it reads the global options and the own options of a Command with an action and children, those own options binding to the Command routing reaches, routing stopping at an option word none of those options declares, the routed Command's one table, every [option alias](options.md#option-aliases) included, option words and plain words, values after `=`, in the next word, or attached to a short value letter, short groups under the `getopt` rule, Boolean and counted options taking no value, a counted option's occurrences never repeating it, a string option's [implied value](options.md#implied-values) never taking the next word, variadic arguments, and passthrough. A change to the grammar changes both.
- **Structure alone.** The words before the last are read with the grammar's structural rules alone. No validator, input source, or middleware runs, and no requirement is checked, because the line is unfinished. A structural fault among them, such as an unknown command, an unknown or misplaced option, a repeated option that is neither multiple nor counted, a missing value, a value after a Boolean or counted option, or an unexpected argument, gives `{ kind: 'none' }`. A string option at the end of the earlier words that is still waiting for its value is not a missing value, because the last word is its value. A string option with an implied value never waits for one, so a bare spelling of it at the end of the earlier words has supplied its implied value. Routing to a group is not a fault here either, because a middleware may take such an invocation over: the group is the routed Command. When the earlier words end at a Command with children, the last word may still continue routing, whatever it holds, so routing has not ended and a parent's own option among the earlier words binds to no Command yet, unless it already faulted: the last word reads by the rules below at the Command reached, so `--format json cache ''` reads as `command` for the children of `cache`, and `--format json cache --h` as `option` there.
- **The last word.** It is read as the parser would read the next token:
  - after a bare `--` among the earlier words, `passthrough`;
  - when the word before the last ends with a string option that takes its value from the next token, as a spelling alone or as the last letter of a short group, `value` for that option with `lead: ''`, unless the last word is an option word or the bare `--`, which the grammar never consumes as a separate value, giving `none`; a string option with an implied value never takes the next token, so after a bare `--backup` the last word reads by the rules below;
  - a word that starts with `--` and holds `=`, when the part before the first `=` is a long spelling of a string option in scope, an [alias](options.md#option-aliases)'s included, `value` for that option, with `lead` holding that part and the `=` and `prefix` holding the rest, so `--backup=` and `--backup=n` read as `value` for an option with an implied value too; a Boolean, counted, or unknown spelling before the `=` gives `none`;
  - a short group whose walk reaches a value letter with characters after it, `value` for that option, with `lead` holding the group through that letter and one `=` if one follows, and `prefix` holding the rest, a letter whose option declares an implied value included; a group the walk cannot read gives `none`;
  - a last word whose `=` value or short group repeats an option that is neither multiple nor counted, supplied by an earlier word or an earlier letter of the same group, `none`, because the parser holds that repeat; a long spelling with no `=` may still grow into another spelling, so it reads as the next rule says;
  - any other option word, and `-` and `--`, which may still become one, `option`;
  - any other word, `command` while routing has not ended and the current Command has children, `argument` for the next positional the routed Command accepts, a variadic argument accepting every later one, and `none` when neither applies.
- **The members.** `command` is the routed `CommandNode`, reached through a canonical name or an alias alike; for `command`, it is the node whose children the word would name. `prefix` is the part of the word being completed, the whole word except under `value` after an `=` or a short value letter. The options in scope are the graph's `globals` and the routed Command's `options`. `supplied` lists, in supplied order, the name of each option in scope that an earlier word supplied. A parent's own option that routing still holds unbound lists under the name the routed Command's own entry gives its spelling, and lists nothing when that Command does not hold the spelling, so a root's own `-p` lists as `plain` when the routed Command declares `-p` as `plain`. `counts` holds how many times the earlier words gave each counted option in scope, across every spelling, keyed by name, so `-v -vv --` holds `verbose` at 3; a counted option no earlier word gave, and a parent's own option routing still holds unbound, has no entry. `booleans` holds the value the earlier words gave each Boolean option in scope, keyed by name, so `--no-json` holds `json` at `false`, which tells a reader whether a member of an [exclusive option group](options.md#declared-option-groups) gave its absent value and so claims nothing. A Boolean option no earlier word gave has no entry, and a parent's own Boolean option routing still holds unbound holds the value its spelling gives the routed Command's own entry, under the name `supplied` lists it. Every node is the graph's own, so a reader compares by identity.
- **Pure.** `locate` is synchronous, reads no host fact, and, given a graph `inspect()` returned, throws nothing for any array of strings. Any other graph, such as a spread copy or a `structuredClone` of one, throws an `InternalError`, because `locate` reads the parser's tables through that graph's identity. It reads neither `hidden` nor `deprecated`, because routing selects and parsing binds without reading either; the reader decides what to offer.

## Checking the declarations

```ts
import type { DeclarationError } from '@loomcli/core';

declare class Application {
  // ...the members under Application declarations; published in every state, as inspect() is...
  check(): readonly DeclarationError[]; // every fault a development run reports before routing, except a rejected default, unthrown
}
```

```ts
// src/application.test.ts: the assembly check reads every fault and fails the test with their diagnostics.
/// <reference types="bun" />
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';

import { store } from './application.js';

test('the application assembles', () => {
  assertAssembles(store);
});
```

`check()` builds the graph with nothing run and returns every declaration fault a development run would report before routing, except a declared default or implied value its validator rejects, as values. The assembly check of `@loomcli/testing`, `assertAssembles`, reads them all without running an action, as the [testing reference](../libs/testing.md) describes. [ADR-0066](../decisions/0066-the-toolchain-acts-on-one-package-directory.md) records the decision, and [ADR-0099](../decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) carries it forward with the assembly check.

- **What it checks.** It builds the graph as `inspect()` does and runs the checks a development run makes before routing that need no host and no await: the build rules under [At build](declaration-faults.md#at-build), the converter check of [Input schema](validation.md#input-schema), the routing check of the [post-install command](application.md#the-post-install-declaration), and every [`onGraphBuilt`](lifecycle-hooks.md#judging-the-built-graph) hook. It returns each `DeclarationError` they raise, in the order a run meets them, and throws none of them. An empty list means a development run reports no declaration fault before routing other than a rejected default.
- **Every fault it can reach.** A fault in the build rules ends the build, because the graph a later rule reads does not exist, so the list holds that fault alone. Once the graph builds, `check()` continues past each fault: one fault for each converter that fails, one for a post-install command that routes to no Command with an action, and one fault for each `onGraphBuilt` hook that rejects the graph or breaks. Every hook receives the same frozen graph, whatever an earlier check found. An input whose converter failed reads its `schema` as `null` in that graph, as a distributed build reads it.
- **Whatever the build.** It runs the development checks whatever the [release facts](release-facts.md) read, and it reads no host and no baked facts, so it answers the same from source and from a bundle.
- **Not the defaults.** It does not pass a declared default or an implied value through its validator, as `inspect()` does not. That call may be asynchronous, and its [validation context](validation.md#validation-context) carries the run's host, so its verdict belongs to the machine that runs the application. `run()` still reports a rejected default.
- **Not a call or an attach.** A fault at an authoring call or an attach throws while the module loads, before any `check()` call, under [Declaration faults](declaration-faults.md). A tool that imports the module catches that throw itself.
- **Nothing runs.** It routes no words but the post-install command's, which it routes against the built graph and never runs, validates no value, and runs no middleware, input source, or action. It caches nothing, so each call builds the graph anew.
- **The faults.** Each is the `DeclarationError` a run would report. Its `message` holds the whole [Developer Diagnostic](declaration-faults.md#developer-diagnostics) as plain text at 80 columns, and its `rule`, `sentence`, `findings`, and `correction` hold the parts.

## When author code fails

An [`onGraphBuilt`](lifecycle-hooks.md#judging-the-built-graph) hook and a validator's converter are author code, and one that throws takes the [ordinary failure path](failures.md#the-ordinary-failure-path) in a run, where an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A hook that throws anything but a `DeclarationError` is the build fault [`@loomcli/core/broken-graph-hook`](diagnostics.md#loomclicorebroken-graph-hook), and a converter that fails in a [development build](release-facts.md#development-builds) is the build fault [`@loomcli/core/schema-converter-failed`](diagnostics.md#loomclicoreschema-converter-failed). `inspect()` throws the first build fault and `run()` reports it, while `check()` returns every one as a value and continues past each.
