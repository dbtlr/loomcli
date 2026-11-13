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

`check:api` covers every published library: `@loomcli/core`, `@loomcli/plugins`, `@loomcli/validators`, `@loomcli/prompts`, `@loomcli/testing`, and `@loomcli/eslint-plugin`, whose every export carries the tags below. Core's API report is committed at `packages/core/api/index.api.md`, each plugins subpath's report is under `packages/plugins/api/`, the validators report is at `packages/validators/api/index.api.md`, the prompts reports, one for the root export and one for `@loomcli/prompts/views`, are under `packages/prompts/api/`, the testing report is at `packages/testing/api/index.api.md`, and the lint plugin's report is at `packages/eslint-plugin/api/index.api.md`.

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

`@loomcli/testing` builds the contexts a test passes to your function, and the log events, log destinations, and progress events a test passes to a hook, so they stay output types: you write the testing builder's input, never the context or the event itself. Building an output type by hand is outside the supported surface, because a release may add a required member to it in a feature.

TSDoc defines `@sealed` for classes and their members. Loom also puts it on interfaces and type aliases to mark an output type, a named deviation, because the API report writes it beside each name, where a reviewer reads it. The promise it carries, that Loom may add members, is the one Rust's `#[non_exhaustive]` attribute states.

Your editor shows the tags on hover. Each covered entry point's API report, committed beside its package as `api/<entry>.api.md`, lists every export with its tags. A public type written over an unexported declaration, such as `Command`, which is `Pick<CommandBuilder, ...>`, shows only that outer text there, so a companion file, `api/<entry>.listed.md`, records the shape of each such declaration and of the unexported types it uses, and a change to a method you call shows in the diff.

## Doc comments and examples

Your editor's hover shows each declaration's doc comment, because the packed `.d.ts` files keep it. [ADR-0147](../decisions/0147-every-published-export-and-member-carries-a-doc-comment-and-every-value-an-example.md) records the rules.

- Every export, and every member of a class, an interface, or an enum, carries a doc comment with a summary: text before the first block tag, such as `@example`. Each overload carries its own.
- A declaration a public type is written over, such as `CommandBuilder` under `Command`, carries a comment on each member and overload, so a hover on `.option()` has text. A class's constructor and a `private` or `#private` member do not need one. An interface's construct signatures do, because `new Application(...)` reads them.
- A field of an object type literal, such as an inline options parameter's, needs no comment, and a type Loom re-exports from another package, such as `StandardSchemaV1`, keeps that package's comments.
- Every function, class, constant, enum, and namespace carries an `@example` block that holds a fenced `ts` code block. An overloaded function carries it on its first overload. A type may carry one.
- A comment says what the name is for in the [glossary](../glossary.md)'s terms. Where a page governs it, the comment links that page with `@see` and an absolute URL, such as `https://github.com/dbtlr/loomcli/blob/main/docs/core/public-exports.md`, and does not restate the page's rules.
- An example imports what it uses from the published specifier, so it also shows where the name lives:

````ts
/**
 * Pads text with spaces to a minimum display width, measured in terminal cells.
 *
 * @example
 * ```ts
 * import { pad } from '@loomcli/core';
 *
 * const cell = pad('status', 24, { align: 'right' });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/styles.md
 * @public
 */
````

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
- an export, a member, or a listed declaration's public member without a doc comment, or a function, class, constant, enum, or namespace without an `@example` that holds a fenced `ts` block, outside the declaration paths its package's `pendingDocumentation` names;
- any other API Extractor message, except a dependency's typings importing a source file, which Loom cannot change.

The check reads examples and does not compile them, and review judges what a comment says. `pendingDocumentation` in `scripts/api-surface.mjs` names the emitted declaration paths under a package's `dist`, such as `dist/application/`, whose comments a later pass writes; a path with nothing left to write fails as an unneeded entry.

After a surface change, `pnpm check:api --update` rewrites the reports and their companion files, and the pull request carries their diff.
