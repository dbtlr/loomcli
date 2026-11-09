---
description: Which names Loom's published libraries promise to authors, how each export's tag says whether it is an input type or an output type, and what a change to each kind breaks.
---

# Public exports

This page states which names Loom's published libraries promise, and how to tell from an export whether you hand it to Loom or Loom hands it to you. An author reads it to know what an upgrade can break. A maintainer reads it before adding, removing, or reshaping an export. [ADR-0137](../decisions/0137-a-published-export-is-public-and-its-tag-says-whether-it-is-an-input-type-or-an-output-type.md) records the decision.

## Every published export is public

The published libraries are `@loomcli/core`, `@loomcli/plugins` with each of its subpaths, `@loomcli/validators`, `@loomcli/prompts` with `@loomcli/prompts/views`, `@loomcli/testing`, and `@loomcli/eslint-plugin`. Every name their entry points export is public, and you may rely on it. A name that only Loom's tests use is not exported, and a name another Loom package imports is public.

Each covered library's surface is complete. A type you plausibly use to build the input of an exported function, or to check the value it returns, is exported, so a helper you write can name it:

```ts
import { style, type Ansi16Color } from '@loomcli/core';

function badge(text: string, color: Ansi16Color): string {
  return style[color](text);
}
```

In a covered library, a schema in a published type is a [Standard Schema](https://standardschema.dev) over an exported interface, never a validation library's own type.

## Which libraries carry the tags

`check:api` covers `@loomcli/core`, whose every export carries the tags below and whose API report is committed at `packages/core/api/index.api.md`. `@loomcli/plugins` is being tagged a group of subpaths at a time, and its pack views (`box`, `heading`, `list`, `prose`, `records`, `rule`, and `table`), output plugins (`format`, `format/views`, `theme`, `color`, `verbose`, and `background`), and input plugins (`interaction`, `dotenv`, `config`, `config/extension`, and `suggestions`) are covered, with reports under `packages/plugins/api/`. The other plugins subpaths and the other published libraries carry no tags yet and have no report, so a change to one is judged by the position of the changed member alone. The rule on which modules a declaration may import already holds for every plugins subpath.

## Each type is an input type or an output type

Every type you meet is one of two kinds, named after GraphQL's input and output types:

- An **input type** is one you may hand to a Loom function: a parameter, a declaration's options, a definition, a view, a validator, a value your callback returns to Loom, or the input a testing builder takes. You may have created any value you hand to Loom, so a new required member on an input type breaks your code.
- An **output type** is one Loom hands to your code: a parameter of a callback you write, a context member, or a function's result. You read it, and you may pass it to your own functions, such as a helper that reads the `CancellationReason` a cancelled run's signal carries. A new member on an output type breaks nothing.
- A type that goes both ways is an input type, unless only a Loom function can create its values. A `Plugin`, which only `plugin()` makes, or a `Command` stays an output type when you hand it back, because you cannot have created it. Plain data you could write by hand, such as the slice of an action context you hand to `validateLinkedValue`, is an input type wherever a Loom function takes it. A graph node counts as made only by Loom, because core freezes every node and `locate` rejects a graph `inspect()` did not return.

Every export carries the TSDoc tag `@public`. An output type, and a class you must not subclass, also carries `@sealed`. A type Loom re-exports from another package, such as `StandardSchemaV1` from `@standard-schema/spec`, carries that package's own declarations instead of Loom's tags, and follows that package's versions.

| Tag | What it means | Examples |
| --- | --- | --- |
| `@public` on a function or constant | You call it or read it. | `plugin`, `style`, `width`, `glyph` |
| `@public @sealed` on a type | An output type: Loom hands it to your code. | `Command`, `Plugin` |
| `@public` on a type without `@sealed` | An input type: you may hand it to Loom. | `CommandOptions`, `PluginDefinition`, `View`, `Translator`, `ProcessHandle` |
| `@public @sealed` on a class | You must not subclass it. | `UnknownOptionError`, which core throws for you to catch |
| `@public` on a class without `@sealed` | You may subclass it. | `LoomError`, `FatalError` |

`@loomcli/testing` builds the contexts a test passes to your function, so the contexts stay output types: you write the testing builder's input, never the context itself. Building an output type by hand is outside the supported surface, because a release may add a required member to it in a feature.

TSDoc defines `@sealed` for classes and their members. Loom also puts it on interfaces and type aliases to mark an output type, a named deviation, because the API report writes it beside each name, where a reviewer reads it. The promise it carries, that Loom may add members, is the one Rust's `#[non_exhaustive]` attribute states.

Your editor shows the tags on hover. Each covered entry point's API report, committed beside its package as `api/<entry>.api.md`, lists every export with its tags. A public type written over an unexported declaration, such as `Command`, which is `Pick<CommandBuilder, ...>`, shows only that outer text there, so a companion file, `api/<entry>.listed.md`, records the shape of each such declaration and of the unexported types it uses, and a change to a method you call shows in the diff.

## What a change to each kind breaks

The tag and the position of the changed member decide.

- Removing or renaming any export breaks.
- A new member on an output type does not break, because you only read it.
- A new required member on an input type breaks, because code that creates one must change.
- A member you read, such as a callback's parameter, breaks when it widens or its string-literal union loses a member. A string-literal union core produces may gain a member, so handle a value you do not know; a union of object variants gaining a variant breaks. A member you supply, such as a callback's return value, breaks when it narrows.
- A new or changed member on a class you may subclass breaks, because it can collide with your subclass's own.

The [changelog guide](../../.changes/README.md#explain-a-breaking-change) holds the full table that each release's breaking changes follow.

## The check

`pnpm check` runs `check:api`, which compares each entry point's emitted declarations with its committed API report. It fails on:

- an export without a release tag, other than a re-exported external type the check lists;
- a re-exported external type the check does not list;
- an undefined tag, or `@internal`, `@beta`, or `@alpha`;
- an emitted surface that differs from its committed report;
- a listed declaration, or a type it uses, whose shape differs from its committed companion file, or a companion file for an entry that lists nothing;
- a type a public signature uses that the entry point does not export, unless the check lists it with its reason;
- a declaration that imports a module outside its package's list, such as a library the package uses only in its implementation;
- an entry in the check's lists that the surface no longer needs, lists for an entry the check does not run, or a covered entry that the package's exports map does not name;
- any other API Extractor message, except a missing doc comment, which a later check covers, and a dependency's typings importing a source file, which Loom cannot change.

After a surface change, `pnpm check:api --update` rewrites the reports and their companion files, and the pull request carries their diff.
