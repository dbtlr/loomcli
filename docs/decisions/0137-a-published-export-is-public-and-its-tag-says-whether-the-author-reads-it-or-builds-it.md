---
type: adr
title: ADR-0137 - A published export is public, and its tag says whether the author reads it or builds it
description: Every name a published library's entry points export is public. A name no other package and no author uses is not exported, and a type an author plausibly needs to build an input or check a result is. Each export carries TSDoc's @public, and a type whose every value a Loom library builds, or a class the author must not subclass, also carries @sealed. API Extractor checks the tags against committed API reports, and the changelog guide classifies a breaking change by the tag and the position of the changed member.
status: proposed
created: 2026-11-04
modified: 2026-11-04
---

# ADR-0137 - A published export is public, and its tag says whether the author reads it or builds it

## Context

Six published libraries reach authors through their exports maps: `@loomcli/core`, `@loomcli/plugins` (33 subpaths), `@loomcli/validators`, `@loomcli/prompts` (two entries), `@loomcli/testing`, and `@loomcli/eslint-plugin`. Together they export about 412 names. Loom has never stated which of them an author may rely on, nor, for a type, whether the author reads it from a value a Loom library built or builds it and hands it to a library. The [changelog guide](../../.changes/README.md#explain-a-breaking-change) judges a breaking change by exactly that difference: a new member on an object core builds is not breaking, and a new required member on something the author builds is. Without a mark in the code, reviewers guessed, and earlier guesses treated `Out` and the view context as author-built. [ADR-0110](0110-a-test-calls-one-author-function-with-a-context-the-testing-package-builds.md) already rules that the five contexts are public for use: Loom's testing package builds them, and an author never does.

The surface also has gaps. API Extractor finds 60 types in core's public signatures that core does not export, among them `Alignment`, `SwitchPolicy`, and `GlobalOptionConfig`, so an author who writes a helper that takes an alignment or a plugin's global option cannot name its type. Five `@loomcli/plugins` declaration files type their extensions' schemas as valibot's `ObjectSchema<...>`, so an author's `tsc` with `skipLibCheck: false` loads all of valibot's declarations: jsonkit's check grows from 0.08 s and 77 MB to 1.27 s and 238 MB.

The repository builds with TypeScript 7, whose compiler API differs from the TypeScript 6 API that API Extractor bundles. API Extractor 7.60.1 reads core's emitted declarations with no errors, takes one main entry point per run, shares one compiler state across entry points through `CompilerState.create` with `additionalEntryPoints`, and writes `@sealed` into its report on interfaces and type aliases alike.

## Decision

- **Published means public.** Every name a published library's entry points export is a public export: an author may rely on it, and the changelog guide classifies every change to it. A name exported only so that a test can import it is not exported; the test imports it from its source module. A name another first-party package imports is public, because that package is an author of the same contract.
- **The surface is complete.** A type an author plausibly uses to build the input of an exported function, or to check the value it returns, is exported. Type machinery an author has no plausible reason to name, such as a conditional type that computes a parameter, stays unexported, and the check lists it with its reason.
- **Two tags state the category, both TSDoc standard tags.**
  - `@public` goes on every export. It records that the export was judged.
  - `@sealed` goes on a type whose every value a Loom library builds, `@loomcli/testing`'s builders included, so the author only reads it, as with `Out`, the host, a node, every context, `Command`, `Plugin`, or a produced union. Building one by hand is outside the supported surface.
  - A type without `@sealed` is one the author builds and hands to a library, as with `CommandOptions`, `PluginDefinition`, a view, a validator, `ProcessHandle`, or the input a testing builder takes.
  - On a class, `@sealed` keeps TSDoc's meaning: the author must not subclass it. A class without `@sealed`, such as `LoomError` or `FatalError`, is one the author may extend.
  - A function or constant the author calls or reads carries `@public` alone.
  - No other release tag is used. Loom has no `@internal`, `@beta`, or `@alpha` export, and no Loom-only tag.
- **Loom extends `@sealed` beyond classes.** TSDoc defines `@sealed` only for classes and their members. Loom also puts it on interfaces and type aliases, meaning that the author does not build their values. This is a named deviation: a Loom-only tag would say the same, but API Extractor writes `@sealed` into each report line's header, where a reviewer reads it in the diff, and drops a custom tag.
- **API Extractor checks the surface.** `pnpm check` runs `check:api`, which runs API Extractor over every published entry point against its emitted declarations, sharing one compiler state. Each entry point's API report is committed beside its package. A `tsdoc.json` turns off `@internal`, `@beta`, and `@alpha`, and the check raises the forgotten-export message to an error, so it fails on:
  - an export without a release tag;
  - a re-exported external type the check does not list;
  - a tag TSDoc and the configuration do not define, or one the configuration turns off;
  - an emitted surface that differs from its committed report;
  - a type that a public signature uses and the entry point does not export, unless `check:api`'s own list names it with its reason;
  - a declaration that imports a module outside its package's list. That list holds Loom's own packages, Node built-ins, `@standard-schema/spec`, and the tool a package plugs into, such as ESLint or a test runner, and never a library a package uses only in its implementation.
  - an entry in the check's lists of unexported types and external re-exports that the surface no longer needs;
  - any other API Extractor message, except the rule that asks every export for a doc comment, which waits for a later check, and a dependency's typings importing a source file, which Loom cannot change.
- **A re-exported external type follows its own package.** Core re-exports `StandardSchemaV1` and `StandardJSONSchemaV1` from `@standard-schema/spec`, whose declarations Loom cannot tag. The check lists each such re-export with its reason, and a change to it follows the external package's version range: raising that range past a major version is breaking.
- **A schema in a published type is a Standard Schema.** A published type that holds a schema names it as `StandardSchemaV1<...>` over an exported interface, never as a validation library's own type, whatever library implements it.
- **The changelog guide classifies a change by its tag and position.** A reviewer reads the tag on the changed name's line in the API report diff. A member the author reads, including a callback's parameter, follows the sealed rules; a member the author builds, including a callback's return value, follows the author-built rules; a member in both positions breaks on any change but a new optional member. A string-literal union core produces may gain a member without breaking, as the guide already states; a union of object variants gaining a variant breaks. The guide's table states every row. It keeps the rules the guide already states, and ADR-0110's rule for the contexts.
- **Review, not the check, judges an author-built type's new member.** The check guarantees that every surface change arrives with its report diff. It does not compare a report with the base branch to find an author-built type that gained a required member.

## Considered options

- **A check of Loom's own over the emitted declarations.** Rejected. It needs no new tool, but it writes no surface report, so a reviewer would see a surface change only by reading every changed declaration. Principle 6 prefers the ecosystem's tool.
- **A check on TypeScript 7's compiler API.** Rejected for now. That API is not stable and differs from the TypeScript 5 and 6 API.
- **A Loom tag for a type the author builds, such as `@authorBuilt`.** Rejected. API Extractor does not write a custom tag into its report header, so the category would not show in the diff. Extending `@sealed` costs one named deviation instead.
- **Leaving a type unsealed when `@loomcli/testing` builds it.** Rejected. It contradicts ADR-0110: a new required member on a context would become breaking although the testing builders, not the author, build the context, and `FailureViewContext`, which extends `ViewContext`, would get the opposite verdict for the same change.
- **`@internal` on names first-party packages use, kept in the published declarations.** Rejected. An export is the public interface; a tag that asks an author not to rely on an exported name does not make it private. A name another package uses is public, and a name nobody uses publicly is not exported.
- **Exporting every type a public signature reaches.** Rejected. Type machinery would become public, and every change to it would be breaking.
- **Turning off API Extractor's forgotten-export rule.** Rejected. It would hide the gaps that leave an author unable to name a declaration's type.
- **A check that fails an author-built type's new required member without a breaking fragment.** Rejected. It needs a base ref in every run, and parsing type shapes back out of a report misses the cases that matter, such as a member that an intersection or a changed member type makes required.
- **Freezing a schema as a validation library's generic type, such as Zod's `z.ZodType<Facts>` or valibot's `GenericSchema<Facts>`.** Rejected. Any published reference to a validation library loads that library's whole declarations into the author's check.

## Consequences

- A change that adds, removes, or reshapes an export changes a committed API report in the same pull request, and the reviewer reads its classification from the report.
- Removing an export nobody uses publicly is a breaking change with its own fragment; exporting a type the surface was missing is a feature.
- The help, manifest, mcp, and configuration plugins' extension schemas change type to `StandardSchemaV1` over exported interfaces, and valibot leaves every published declaration.
- A doc comment on every export, with an example, extends the same check later.
- The [public exports](../core/public-exports.md) page states the categories for authors.

## Status

Proposed. It moves to accepted with the release that ships the tagged surface and `check:api`.
