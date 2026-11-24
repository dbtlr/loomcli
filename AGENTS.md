---
description: Where each language lives, the project principles, and the rules every language follows - the domain glossary, decision records, pull request changelog decisions, and judging review findings.
---

# Loom CLI

## Layout

Each language is a root of its own, with its own conventions. Before you change files under a root, read its `AGENTS.md`:

- `typescript/`: the TypeScript workspace, the reference implementation, in [typescript/AGENTS.md](typescript/AGENTS.md).
- `rust/`: the Rust port, unpublished, in [rust/AGENTS.md](rust/AGENTS.md).

The shared documentation (`docs/`), the conformance cases both languages check (`conformance/`), the GitHub workflows (`.github/`), and the agent skills stay at the repository root, and bind every language.

## Principles

Loom is a toolkit, not the application: the author ships the application. Read the
[principles](docs/principles.md) before you design a change, write a test, or judge a review
finding. They rank above the decision records and the core reference, and they set how deep a
solution goes by its reach.

## Glossary and decision records

The [glossary](docs/glossary.md) is the domain model. Use its terms in code, documentation, operator messages, diagnostics, and reviews, and update it in the same change that sharpens or adds a term.

The [decision records](docs/decisions/README.md) are constraints on the work, not an archive. Check a plan against the index before building, and open the records that govern the area under change. An `accepted` record is load-bearing: a change that conflicts with it supersedes it with a new record rather than editing it.

A record that rejected an approach, such as ADR-0066's rejection of a configuration file, which ADR-0099 carried forward and the proposed ADR-0130 supersedes, still leaves that approach open. When it is the best design, present it on its merits and name the record a new one would supersede, rather than steering to a weaker design the record allows.

## Pull requests

Before opening or updating a PR, read [typescript/.changes/README.md](typescript/.changes/README.md). It defines when to add a fragment, when to apply `skip-changelog`, and how to document breaking changes or correct an earlier unreleased entry. Apply those rules to the final diff and state the fragment path or skip reason in the PR description.

## Judging review findings

A review seat, a bot, or a probe reports what it can break, which is wider than what is a defect.
A finding is a defect only when it passes both tests, which apply principles 1 and 8:

1. **Loom produces it.** The bad value comes from something Loom ships (an implementation's core,
   plugins, validators, or toolchain, or a file one of them writes) or from operator input that
   reaches core through one of them. A value the author's own code creates belongs to the author.
   When the author's code is wrong, the run fails through the ordinary failure path, and a finding
   that asks Loom for a guard, a limit, a timer, or a special rule fails this test.
2. **It plausibly happens.** The input fits how a command-line application is used. A construction
   built only to break the code, such as a default of a million shared paths, is a probe result.

The first test covers the author's project layout too: beyond the paths its configuration names, a
toolchain does not adapt to how an author lays out their project. Each root's `AGENTS.md` names what
its implementation ships, and any layout case it has.

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
