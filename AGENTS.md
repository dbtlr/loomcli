---
description: Project principles, plus conventions for the domain glossary, decision records, TypeScript assertions, review findings, and pull request changelog decisions.
---

# Loom CLI

## Principles

Loom is a toolkit, not the application: the author ships the application. Read the
[principles](docs/principles.md) before you design a change, write a test, or judge a review
finding. They rank above the decision records and the core reference, and they set how deep a
solution goes by its reach.

## Glossary and decision records

The [glossary](docs/glossary.md) is the domain model. Use its terms in code, documentation, diagnostics, and reviews, and update it in the same change that sharpens or adds a term.

The [decision records](docs/decisions/README.md) are constraints on the work, not an archive. Check a plan against the index before building, and open the records that govern the area under change. An `accepted` record is load-bearing: a change that conflicts with it supersedes it with a new record rather than editing it.

A record that rejected an approach, such as ADR-0066's rejection of a configuration file, which ADR-0099 carried forward and ADR-0130 supersedes, still leaves that approach open. When it is the best design, present it on its merits and name the record a new one would supersede, rather than steering to a weaker design the record allows.

## Pull requests

Before opening or updating a PR, read [.changes/README.md](.changes/README.md). It defines when to add a fragment, when to apply `skip-changelog`, and how to document breaking changes or correct an earlier unreleased entry. Apply those rules to the final diff and state the fragment path or skip reason in the PR description.

During an upgrade, read the [changelog](CHANGELOG.md) breaking sections between the installed and target versions and follow their migration instructions.

## Conventions

### Running tools

Run a package's tool with `pnpm exec <tool>`. `devEngines` in `package.json` pins pnpm, so `npx <tool>` fails with `EBADDEVENGINES`. A script that rebuilds before it measures, such as a mutation run, keeps the rebuild's exit status, because a failed rebuild leaves stale `dist` that every later step reads as current.

`pnpm check:fix`, which the pre-commit hook also runs, rewrites source in two ways a diff can hide:

- `eslint/sort-keys` sorts object literal keys, in source and in tests' expected objects alike. A module whose key order is a contract turns the rule off in a per-file override in `vite.config.ts` with a comment that says why, as the existing overrides do, and pins the order with a test the fixer cannot rewrite, such as a golden file or an `Object.keys` assertion.
- Each `//` line gains a capital first letter, so a sentence wrapped across two `//` lines comes back with a capital mid-sentence. Write each `//` line as a whole sentence, or use a `/** */` block for longer prose, and reread wrapped comments in the diff after a fix run.

### Tests stay inside their sandbox

A test that walks up from a temporary directory, looking for `.git` or a configuration file, sets a ceiling at its sandbox root. Without one, a stray marker above the sandbox, such as an empty `/tmp/.git` another tool left behind, ends the walk outside it: the test fails intermittently and can write outside its sandbox. `packages/plugins/tests/fixtures/skills-run.mjs` shows the pattern. To reproduce such a failure, point `TMPDIR` at a private directory that holds a `.git`.

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
A finding is a defect only when it passes both tests, which apply principles 1 and 8:

1. **Loom produces it.** The bad value comes from something Loom ships (core, `@loomcli/plugins`,
   `@loomcli/validators`, the configuration plugin's files) or from operator input that reaches core
   through one of them. A value the author's own code creates, such as a hand-written validator's
   output, a declared default, or an action's result, belongs to the author. When the author's code
   is wrong, the run fails through the ordinary failure path, and a finding that asks Loom for a
   guard, a limit, a timer, or a special rule fails this test.
2. **It plausibly happens.** The input fits how a command-line application is used. A construction
   built only to break the code, such as a default of a million shared paths, is a probe result.

The first test covers the author's project layout too. Beyond the paths `loom.config.json` names,
the toolchain does not adapt to how an author lays out their project. A solution-style
`tsconfig.json` (`"files": []` with `references`) gives the `check` script's `tsc --noEmit` no files,
so it passes without checking any. That layout is the author's, so a finding that asks for build mode
(`tsc -b`) or other handling for one layout fails the first test.

The controlling agent is the gate between a review and the board. A review seat, a fix round, or a
bot never creates a task or a seed. The controlling agent judges each finding first, and only a
finding that passes both tests is fixed, or filed as a task. A finding that fails either is
dismissed with that reason in the review record, and the review record is where it ends. A seed
records an ask someone made or a defect someone hit; a question an agent imagines, such as whether a
middleware should ever emit a result, is a finding and passes both tests before it becomes a seed.
A finding where either test is uncertain is held: once the task has settled, bring it to the user
with what it is and the reason it is uncertain, and decide together whether to fix it, file it, or
dismiss it.

A finding that a lint rule could catch is not a review fix. A new lint rule is a contract change:
the controlling agent brings it to the user as a proposal, and it goes through the same contract
process as any other change to Loom's public surface.

Brief every review seat with both tests, and aim it at what Loom ships and what an operator can
reach, not at values only an author's code can construct.
