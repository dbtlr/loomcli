---
description: Which names Loom's published libraries promise to authors, how each export's tag says whether the author reads it or builds it, and what a change to each kind breaks.
---

# Public exports

This page states which names Loom's published libraries promise, and how to tell from an export whether you read it or build it. An author reads it to know what an upgrade can break. A maintainer reads it before adding, removing, or reshaping an export. [ADR-0137](../decisions/0137-a-published-export-is-public-and-its-tag-says-whether-the-author-reads-it-or-builds-it.md) records the decision.

## Every published export is public

The published libraries are `@loomcli/core`, `@loomcli/plugins` with each of its subpaths, `@loomcli/validators`, `@loomcli/prompts` with `@loomcli/prompts/views`, `@loomcli/testing`, and `@loomcli/eslint-plugin`. Every name their entry points export is public, and you may rely on it. A name that only Loom's tests use is not exported, and a name another Loom package imports is public.

Each library's surface is complete. A type you plausibly use to build the input of an exported function, or to check the value it returns, is exported, so a helper you write can name it:

```ts
import { style, type Ansi16Color } from '@loomcli/core';

function badge(text: string, color: Ansi16Color): string {
  return style[color](text);
}
```

A schema in a published type is a [Standard Schema](https://standardschema.dev) over an exported interface, never a validation library's own type.

## Which libraries carry the tags

Every published library carries the tags below on every export. `check:api` covers the entry points of `@loomcli/core`, every subpath of `@loomcli/plugins`, `@loomcli/validators`, both entries of `@loomcli/prompts`, `@loomcli/testing`, and `@loomcli/eslint-plugin`, whose API reports are committed under each package's `api/` folder.

## Each export's tag says whether you read it or build it

Every export carries the TSDoc tag `@public`. A type you only read, and a class you must not subclass, also carries `@sealed`. A type Loom re-exports from another package, such as `StandardSchemaV1` from `@standard-schema/spec`, carries that package's own declarations instead of Loom's tags, and follows that package's versions.

| Tag | What it means | Examples |
| --- | --- | --- |
| `@public` on a function or constant | You call it or read it. | `plugin`, `style`, `width`, `glyph` |
| `@public @sealed` on a type | A Loom library builds every value, and you read it. | `Out`, `Host`, `ViewContext`, `Command`, `Plugin`, `OptionNode` |
| `@public` on a type without `@sealed` | You build the value and hand it to a library. | `CommandOptions`, `PluginDefinition`, `View`, `Translator`, `ProcessHandle` |
| `@public @sealed` on a class | You must not subclass it. | `UnknownOptionError`, which core throws for you to catch |
| `@public` on a class without `@sealed` | You may subclass it. | `LoomError`, `FatalError` |

`@loomcli/testing` builds the contexts a test passes to your function, so the contexts stay sealed: you build the testing builder's input, never the context itself. Building a sealed type by hand is outside the supported surface, because a release may add a required member to it in a feature.

TSDoc defines `@sealed` for classes and their members. Loom also puts it on interfaces and type aliases, a named deviation, because the API report writes it beside each name, where a reviewer reads it.

Your editor shows the tags on hover. Each entry point's API report, committed beside its package as `api/<entry>.api.md`, lists every export with its tags.

## What a change to each kind breaks

The tag and the position of the changed member decide.

- Removing or renaming any export breaks.
- A new member on a sealed type does not break, because you only read it.
- A new required member on a type without `@sealed` breaks, because the code that builds it must change.
- A member you read, such as a callback's parameter, breaks when it widens or its string-literal union loses a member. A string-literal union core produces may gain a member, so handle a value you do not know; a union of object variants gaining a variant breaks. A member you build, such as a callback's return value, breaks when it narrows.
- A new or changed member on a class you may subclass breaks, because it can collide with your subclass's own.

The [changelog guide](../../.changes/README.md#explain-a-breaking-change) holds the full table that each release's breaking changes follow.

## The check

`pnpm check` runs `check:api`, which compares each entry point's emitted declarations with its committed API report. It fails on:

- an export without a release tag, other than a re-exported external type the check lists;
- a re-exported external type the check does not list;
- an undefined tag, or `@internal`, `@beta`, or `@alpha`;
- an emitted surface that differs from its committed report;
- a type a public signature uses that the entry point does not export, unless the check lists it with its reason;
- a declaration that imports a module outside its package's list, such as a library the package uses only in its implementation;
- an entry in the check's lists that the surface no longer needs;
- any other API Extractor message, except a missing doc comment, which a later check covers.

After a surface change, `pnpm check:api --update` rewrites the reports, and the pull request carries their diff.
