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

A record that rejected an approach, such as ADR-0066's rejection of a configuration file, which ADR-0099 carried forward and the proposed ADR-0130 supersedes, still leaves that approach open. When it is the best design, present it on its merits and name the record a new one would supersede, rather than steering to a weaker design the record allows.

## Pull requests

Before opening or updating a PR, read [.changes/README.md](.changes/README.md). It defines when to add a fragment, when to apply `skip-changelog`, and how to document breaking changes or correct an earlier unreleased entry. Apply those rules to the final diff and state the fragment path or skip reason in the PR description.

During an upgrade, read the [changelog](CHANGELOG.md) breaking sections between the installed and target versions and follow their migration instructions.

## Conventions

### Running tools

Run a package's tool with `pnpm exec <tool>`. `devEngines` in `package.json` pins pnpm, so `npx <tool>` fails with `EBADDEVENGINES`. A script that rebuilds before it measures, such as a mutation run, keeps the rebuild's exit status, because a failed rebuild leaves stale `dist` that every later step reads as current.

Tests read built `dist`. `pnpm test` and `pnpm verify` build first, but a single file run with `pnpm exec vp test` after a source change needs `pnpm run build` before it, and an example's launch tests need `pnpm run build:examples` as well. A `tsc` run that fails on `rootDir` still emits `.js` and `.d.ts` files into `src`; delete them before lint.

`pnpm check:fix`, which the pre-commit hook also runs, rewrites source in two ways a diff can hide:

- `eslint/sort-keys` sorts object literal keys, in source and in tests' expected objects alike. A module whose key order is a contract turns the rule off in a per-file override in `vite.config.ts` with a comment that says why, as the existing overrides do, and pins the order with a test the fixer cannot rewrite, such as a golden file or an `Object.keys` assertion.
- Each `//` line gains a capital first letter, so a sentence wrapped across two `//` lines comes back with a capital mid-sentence. Write each `//` line as a whole sentence, or use a `/** */` block for longer prose, and reread wrapped comments in the diff after a fix run.

### Operator messages

A sentence Loom says to an operator goes in the internal `messages.ts` beside the code that raises or writes it, or in the `loom` bin, beside the command whose work it serves: a failure's sentence, a hint line under a failure, a `-v` or `-vv` line, a log call's message template, which `-v` shows, and a plugin's or the `loom` bin's notice, warning, or confirmation. Write it as a named export, a function of the values it repeats or a constant, and have the raising or writing code call it. Escape every value it repeats with `quoted` or `escapeControlCharacters`, and never read an error's `message`, `stack`, or `cause` in it. Developer Diagnostics stay where they are. Core renders no fixed label; another package's fixed labels, such as help headings, stay with the view that prints them until the package joins localization.

A package that joins localization under [ADR-0200](docs/decisions/0200-loom-says-its-own-sentences-in-the-operators-language-through-phrasebooks-the-localization-plugin-installs.md), as core has, follows four more rules, because each export of its message modules is an entry a phrasebook may hold:

- A message module exports sentences alone: functions that declare the return type `string` and string or template constants, with no overload. Phrasing that other sentences or Developer Diagnostics compose, such as core's `quoted` and Command subjects, goes in the concept module's `wording.ts`, a wording module, which the voice test reads as a message module and no phrasebook covers. A log template is a constant, and the code that logs it builds its fields.
- Code says a sentence through a phrase, not by calling the export: `failurePhrase('unknownOption', spelling)`, from the concept module's `phrases.ts` maker. A failure of several lines takes a list of lines. An issue is built with `phrasedIssue`, and a copy of an issue core makes carries its phrase through `carriedIssue`. A sentence that repeats an issue passes `issuePhrase(issue) ?? issue.message`.
- A new message module joins the package's member of `MessagePackages`, in the package's registry file (core's `localization/registry.ts`, another package's `src/registry.ts`), under its concept module's name, or `common` for a `messages.ts` at the root of `src`. The voice test fails on a `messages.ts` the registry misses and on an export of any other shape.
- A sentence's export name and parameters are public through `MessagePackages`, so renaming one or changing its parameters is a breaking change for a phrasebook, and rewording one is named in the change fragment.

Each package's `tests/message-voice.test.ts` holds these rules, the banned words of [Failure message voice](docs/core/failures.md#banned-words), and the rule that no failure constructor, out call, or log call outside a message module takes a literal sentence. In a package with a registry, the `message-import` check reserves value imports and re-exports from message modules for `phrases.ts`. A site that breaks a check and is right is pinned there, per file, by its source text and its count of sites, with the reason it holds.

The rule 6 check reads every source file, not only message modules, so it reaches the code that calls a message function. Code outside a message module that reads a member named `message`, `stack`, or `cause` reads a fact in its place, such as a system error's `code`, or the read is pinned in that package's voice test with the reason it is right, such as a failure's own message that core prints, a validator's issue sentence, a Developer Diagnostic's text, a log event's field, or a cause read to carry it on or to test what it is. The rule concerns what a sentence says, not what a failure carries. The scan reads no types, so a read of another value's member by one of those names is pinned with that reason too.

The `loom` bin may relay what another program or the author's code said, and its voice test pins each site with its reason:

- Nine sentences repeat text whole, unescaped, as `output`: another program's output in `gitFailed`, `bunCouldNotRead`, whose Bun report carries the error an author's module threw, `bunBuildFailed`, `skillMissing`, `skillInvalidYaml`, `lockfilePreparationFailed`, and `refusedRequest`, the plugin pack's judging of a skills folder in `skillsFolderJudged`, and the bin's own sentence about a skill's frontmatter in `skillVersionUnset`.
- `unloadedApplication` repeats, escaped, the first line of the sentence the read of an author's application module failed with, which carries the error the module threw.

The bin's own sentences never quote a Node.js or engine reason. A sentence about a file the bin cannot write, remove, or read, a program it cannot start, or a request that gets no response takes the system error's code from the code that caught it and names the cause in Loom's words, with a step, as in `Cannot write .changes/README.md, because .changes is a file. Remove or rename it, then run loom init again.` One table in `src/helpers/messages.ts`, `systemCause`, words each cause, so a new site words its cause through it. `report()` names the path, the call, and the cause of any other system error from its facts, or prints a general sentence that names the code when it carries no path. Every failure sentence states a step or what is accepted, under voice rule 2.

[ADR-0164](docs/decisions/0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md) records the decision.

### Tests stay inside their sandbox

A test that walks up from a temporary directory, looking for `.git` or a configuration file, sets a ceiling at its sandbox root. Without one, a stray marker above the sandbox, such as an empty `/tmp/.git` another tool left behind, ends the walk outside it: the test fails intermittently and can write outside its sandbox. `packages/plugins/tests/fixtures/skills-run.mjs` shows the pattern for a child process, and `packages/loom/tests/ceiling.ts` for an in-process run. `childEnvironment` in `scripts/test-process.ts` sets `GIT_CEILING_DIRECTORIES` at the temporary directory, so git's own search stays inside. To reproduce such a failure, point `TMPDIR` at a private directory that holds a `.git`. A fake `package.json` above it needs `"type": "module"`, or core's bundle tests read `.js` files as CommonJS.

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
