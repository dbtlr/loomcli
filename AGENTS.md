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

## Judging review findings

A review seat, a bot, or a probe reports what it can break, which is wider than what is a defect.
A finding is a defect only when it passes both tests:

1. **Loom produces it.** The bad value comes from something Loom ships (core, `@loomcli/plugins`,
   `@loomcli/validators`, the configuration plugin's files) or from operator input that reaches core
   through one of them. A value the author's own code creates, such as a hand-written validator's
   output, a declared default, or an action's result, belongs to the author, and its failure is a
   defect in their application that core already reports as one. A failure is a failure: when the
   author's code is wrong, such as a middleware that throws or an action that omits its declared
   result, the run fails through the ordinary failure path, and Loom adds no special rule for
   that author's mistake. Loom does not protect authors from their own code. Loom deliberately ships no JSON
   validator, because a command-line application has no reason to parse JSON from arguments or
   options.
2. **It plausibly happens.** The input fits how a command-line application is used. Command-line
   length bounds what an operator types, and an author declares ordinary values for a command-line
   interface. A construction built only to break the code, such as a default of a million shared
   paths, is a probe result.

Loom is a general-purpose framework, so it does not decide how an application behaves. An action
may stream a response from a service, or run a terminal interface that an operator works in for
twelve hours. Loom cannot know which, and it does not guess. Core adds no time limit, no size limit,
and no guard on how long an author's code runs, what it does, or what values it creates, throws, or
hands back, and a finding that asks for one fails test 1. An application that needs a timeout or a
limit gets it from its author, in the author's own action. Brief review seats to probe what Loom
ships and what an operator can reach, not values only an author's code can construct.

A finding that passes both is fixed, or filed as a task. A finding that fails either is dismissed
with that reason in the review record, and the review record is where it ends. A seed records an
ask someone made or a defect someone hit; a question an agent imagines, such as whether a
middleware should ever emit a result, is a finding and passes both tests before it becomes a seed.
A finding where either test is uncertain is held: once the task has settled, bring it to the user
with what it is and the reason it is uncertain, and decide together whether to fix it, file it, or
dismiss it. Brief every review seat with both tests, and triage each finding against them before
acting on it.
