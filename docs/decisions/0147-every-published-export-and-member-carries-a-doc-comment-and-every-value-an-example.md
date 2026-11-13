---
type: adr
title: ADR-0147 - Every published export and member carries a doc comment, and every value an example
description: Every export of a published library, every member API Extractor reports, and every public member of a declaration a public type is written over carries a doc comment with a summary. Every function, class, constant, enum, and namespace also carries an @example block that holds a fenced ts code block. check:api enforces both; it does not compile examples. A comment states the export's use in the glossary's terms and links its governing page rather than restating that page's rules, which review enforces. It supersedes ADR-0137's exception for the missing-comment rule.
status: proposed
created: 2026-11-13
modified: 2026-11-13
---

# ADR-0147 - Every published export and member carries a doc comment, and every value an example

## Context

Authors, and agents writing Loom applications, read Loom's API through editor hovers. `tsc` keeps doc comments in the packed `.d.ts` files, so what a declaration's comment says is what a hover shows. On 2026-11-13 the six published libraries exported 543 distinct names: 223 values, 213 input types, and 107 output types. 443 exports carried a comment with a summary, and one carried an `@example`. Of the 658 members API Extractor reports on those exports, such as an interface's properties, 208 carried a comment.

[ADR-0137](0137-a-published-export-is-public-and-its-tag-says-whether-it-is-an-input-type-or-an-output-type.md) made `check:api` run API Extractor over every published entry point, and exempted API Extractor's missing-comment message, `ae-undocumented`, for a later check. That message covers exports and the members API Extractor reports. It does not cover a declaration the entry point does not export. `Command` is `Pick<CommandBuilder, ...>` over an unexported class, so a hover on `.option()` shows `CommandBuilder`'s member comment, which `ae-undocumented` never reads. The listed declarations that ADR-0137's companion files record are exactly these declarations. 90 of the 110 public members of the listed classes and interfaces carried no comment.

A link in a hover resolves only as an absolute URL: a relative `docs/` path in a published `.d.ts` names no file in the author's project.

## Decision

- **Every export and every member carries a doc comment.** A comment counts as API Extractor counts it: its summary, the text before the first block tag, holds at least ten characters other than whitespace, or it carries an `@inheritDoc` that points outside the package. A comment that holds only tags, such as `/** @public */`, does not count. `check:api` raises `ae-undocumented` to an error, so it fails on an export, a member API Extractor reports, or an overload without such a comment. API Extractor reports the members of a class, an interface, and an enum, and not a class's constructor or its `private` members.
- **A declaration a public type is written over carries comments on its public members.** For every class and interface the entry's companion file lists, each member carries a comment that counts, apart from a class's constructor, an index signature, a `private` or `protected` member, and a member with a private name such as `#private`. An interface's call and construct signatures need one, because `new Application(...)` reads `ApplicationConstructor`'s. `check:api` reads these members through the same walk that writes the companion file and applies the same test. The listed declaration itself needs no comment, because an author never names it.
- **A member of an object type literal needs no comment.** Neither rule reads one, as API Extractor's does not: a field of an inline options parameter, or of a union variant written inline, such as `ChildExit`'s. On 2026-11-13 the published declarations held 815 such members without a comment, nearly all type-level machinery, such as a builder's type state and the fault messages a declaration fault is keyed by. An author may still comment one.
- **A re-exported external type follows its own package.** The names a package's policy lists in `externalExports`, such as `StandardSchemaV1`, carry their own package's comments, and neither rule applies to them.
- **Every value carries an example.** A function, class, variable, enum, or namespace an entry point exports carries an `@example` block whose content holds a fenced code block tagged `ts`. For an overloaded function, the first overload carries it, and each other overload carries a comment that counts. A type may carry an example and need not: its use shows at the value that takes or returns it.
- **The check reads examples and does not compile them.** `check:api` writes API Extractor's doc model for each entry point into its temporary folder, reads each value's parsed comment from it, and fails a value without the block. It does not type-check or run the code.
- **Review judges what a comment says.** A comment states what the export or member is for in the [glossary](../glossary.md)'s terms. Where a page in `docs/` governs it, the comment links that page with `@see` and an absolute `https://github.com/dbtlr/loomcli/blob/main/docs/...` URL, and does not restate that page's rules. An example is a complete module: it imports what it uses from the published specifier, such as `@loomcli/plugins/help`, so the hover also shows where the name lives. No check reads these rules.
- **A pending list covers the libraries one pass at a time.** Each package's policy in `scripts/api-surface.mjs` may name `pendingDocumentation`: paths of emitted declaration files under the package's `dist`, relative to the package directory, such as `dist/` or `dist/application/`, whose comments and examples the check does not judge yet. A path covers every file it names or that lies under it. A path under which no entry point of the package has a missing comment or example fails as an unneeded entry, as every other list in the check does. The list ends empty, and the last pass removes it.

## Considered options

- **Exports only, filtering `ae-undocumented` down to top-level names.** Rejected. A hover on an option's field is where an author reads what a setting does, and the filter would be a second rule to keep beside API Extractor's.
- **Exports, plus members of input types only.** Rejected. It covers the fields an author writes but adds a boundary the check would keep beside the input and output tags, and an author reads an output type's members too.
- **An example on every value and on every input type.** Rejected. It would require about 436 examples, and many input types' examples would repeat the example on the function that takes them, as `CommandOptions`' would repeat `command()`'s.
- **Examples type-checked against the packed packages.** Rejected. `check:types` would extract about 220 blocks into its consumer project and compile each one, and every example would have to compile alone, with its imports and every value it names.
- **A check that a comment links its docs page.** Rejected. Not every export has a governing page, so the check could not tell a missing link from a correct absence.

## Consequences

- An export, member, or value added to a published library arrives with its comment and, for a value, its example, or `check:api` fails.
- A hover on a field of an object type literal can show nothing; the rule reaches it only when the type is written as an interface.
- A docs page renamed or moved leaves its `@see` links in comments pointing at the old path until review finds them.
- The [public exports](../core/public-exports.md) page states the rules for maintainers.

## Status

Proposed. It moves to accepted in the release PR of the release that ships every library's comments, with `pendingDocumentation` empty.

## Changelog

- 2026-11-13: Proposed with the check (LM-219). It supersedes ADR-0137's exception for the missing-comment rule; ADR-0137 carries a dated entry.
