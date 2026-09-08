---
description: Project conventions for the domain glossary, decision records, TypeScript assertions, and pull request changelog decisions.
---

# Loom CLI

## Glossary and decision records

The [glossary](docs/glossary.md) is the domain model. Use its terms in code, documentation, diagnostics, and reviews, and update it in the same change that sharpens or adds a term.

The [decision records](docs/decisions/README.md) are constraints on the work, not an archive. Check a plan against the index before building, and open the records that govern the area under change. An `accepted` record is load-bearing: a change that conflicts with it supersedes it with a new record rather than editing it.

## Pull requests

Before opening or updating a PR, read [.changes/README.md](.changes/README.md). It defines when to add a fragment, when to apply `skip-changelog`, and how to document breaking changes or correct an earlier unreleased entry. Apply those rules to the final diff and state the fragment path or skip reason in the PR description.

During an upgrade, read the [changelog](CHANGELOG.md) breaking sections between the installed and target versions and follow their migration instructions.

## Conventions

### Type assertions are a last resort

A type assertion (`as`) makes a call site read as type-safe while its inputs were narrowed by hand,
so a wrong claim surfaces as a JavaScript error instead of a compile error. Before writing one, look
for the typed path: derive a type parameter from the data that determines it instead of claiming it
freely, read runtime values through one typed accessor at the validation boundary, or assign a
generic class to its constructor interface. An explicit type argument over untyped state is an
assertion without a lint directive, not a typed path.

- An assertion survives only when no typed path exists.
- Each surviving assertion carries a comment, directly above its lint disable, that says it is a last
  resort, that no typed path exists, and why the claim holds (`It holds because ...`).
- An existing assertion is never justification for a new one.

`packages/core/tests/assertions.test.ts` pins the surviving sites per file, rejects blanket disables
and compiler escapes, and checks each comment.
