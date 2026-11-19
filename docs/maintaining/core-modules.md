---
description: The map of @loomcli/core's source modules. Which folder under packages/core/src holds each concept, and the conventions that place a new file.
---

# Core source modules

`packages/core/src` groups core's source by concept. Each folder is one module, and the modules follow the sections of the [core reference](../core/README.md). This page tells a maintainer where a concept lives and where a new file goes. The modules do not form layers: a module imports from any other module it needs.

## Modules

| Module | What it holds |
| --- | --- |
| `application/` | The `Application` declaration, `run()`, `check()`, and `inspect()`, and the type-level registration that publishes an application's globals, styles, and Command paths. |
| `commands/` | The Command tree, its declaration rules, and the globals table that global options share. |
| `inputs/` | Options, arguments, option groups, bindings, input sources, Standard Schema validation, and content inputs. |
| `marks/` | The run-wide marks that one global option carries: color, verbosity, interaction, and background. |
| `invocation/` | One run from argv to the action: parsing, lowering an invocation by name, `invoke()` and its typed paths, the middleware chain, and dispatch preparation. |
| `inspection/` | The built Command graph that projections read, and locating a word in an unfinished invocation. |
| `plugins/` | The plugin contract: plugins, extensions, providers, environment preparation, and the graph and failure hooks. |
| `failures/` | Failure classes, exit codes, the plain-data failure form, failure encoders, and translators. |
| `diagnostics/` | Developer Diagnostics: diagnostic rules, defects, declaration facts, rule identities, and how a development build prints them. |
| `output/` | Lanes, views, live regions, progress events, sequences, and logging. |
| `style/` | Marked strings and their wire format, measuring, wrapping, layout, themes, the rendering policy, and the generated glyph and Unicode tables. |
| `host/` | The process handle, the host a run reads, child programs, interrupt keys, and the terminal background query. |
| `localization/` | Phrases, phrasebooks and their types, core's member of `MessagePackages`, `phrasedIssue`, and the resolution of a phrase in the run's language. The locale resolver lives in `host/locale.ts`, beside the time zone's. |
| `signals/` | Signal lanes, cancellation, and shutdown. |
| `shipping/` | Release facts, the installation record, and the application's directories. |
| `support/` | Small helpers with no concept of their own: plain-data checks, control-character escaping, thenables, handed promises, and bounded file reads. |

## Conventions

- `index.ts` is the only barrel and holds every public export. A module folder has no index file, and an internal import names the file it reads.
- A module's `types.ts` holds the shared public types of its concept: the types that no single file's code owns. A type that belongs with one file's code, such as the registration types in `application/environment.ts`, stays in that file. A type lives in the module of the concept it describes, even when other modules import it.
- A rule family sits in its module's `rules.ts`, apart from the code that raises it, so a rule can be imported without loading that code: the Command family in `commands/rules.ts`, the input family in `inputs/rules.ts`, and the plugin family in `plugins/rules.ts`. `diagnostics/rules.ts` holds core's run-time defects and the faults of failure codes and rule identities. `inputs/content-rules.ts` keeps the content rule apart from the input family, whose test pins `inputs/rules.ts` to exactly that family. A rule that one file alone raises, such as a mark's rule or a shutdown budget's, is declared beside the code that raises it.
- A module's `messages.ts` holds every operator message its code raises or writes, each as a named export: a function of the values it repeats, or a constant. `failures/messages.ts` holds the failure classes' sentences and the failure form's, `inputs/messages.ts` the sentences and issues of validation, missing inputs, option groups, and content inputs, `invocation/messages.ts` the issues of a value an invocation by name cannot lower, and `output/messages.ts` the line of a result sequence that stopped early. A message module exports sentences alone, because each export is an entry of a core [phrasebook](../core/localization.md#phrasebooks): every exported function returns `string` and every exported constant is a literal, and the voice test fails on any other export. Phrasing that another module's sentence or a Developer Diagnostic composes lives in the concept module's `wording.ts`: `failures/wording.ts` holds `quoted`, `commandSubject`, `routedSubject`, `commandSentence`, and `routedSentence`, and `inputs/wording.ts` holds `inputSubject`. `missingValues` is unexported, the redaction fault's sentence and correction live beside `output/redaction.ts`, and `ignoredFill` and `ignoredFillAt` are template constants whose fields `inputs/validation.ts` builds. The voice test reads a wording module as it reads a message module. `localization/registry.ts` declares core's member of `MessagePackages`, which the voice test checks against the `messages.ts` files, and the code that raises a failure, writes a line, logs a template, or reports an issue says the sentence through a phrase, made by the maker in its concept module's `phrases.ts`, such as `failurePhrase('unknownOption', spelling)`; the factories that turn a failure's sentence into another replace its phrase with its message through one internal operation. A message function returns a string, constructs no failure, and imports only escaping and text helpers, other message modules, and types, so it adds no import to the module that calls it. A Developer Diagnostic's sentence and correction stay where the code that raises it writes them, and its headline and explanation with its rule. `tests/message-voice.test.ts` holds every message module to the [failure message voice](../core/failures.md#what-the-voice-test-holds), under [ADR-0164](../decisions/0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md).
- `host/process-handle.ts` is the one file that reads the global `process`, asks `node:os` for the user's folders, and starts real children. Lint allows those calls only there.
- `host/types.ts` carries core's `/// <reference types="node" preserve="true" />` directive. The `preserve` attribute keeps the directive in the emitted declarations, so a consumer's type check of the published package finds the Node globals.
- A new file goes in the module of the concept it serves. It goes in `support/` only when it serves no single concept.

## Application runs, command declarations, and inputs

- `application/application.ts` holds the Application builder, declaration calls, `inspect()`, and `check()`.
- `application/types.ts` holds application options, public types, and shared build shapes.
- `application/run.ts` runs argv and named invocations through declaration-owned context.
- `application/doors.ts` supplies the argv and named invocation doors.
- `application/facts.ts` holds application facts and mark-binding checks.
- `commands/command.ts` holds the Command builder and its type-level surface.
- `commands/types.ts` holds built shapes and node-handle types.
- `commands/state.ts` holds declaration state and the handle registry.
- `commands/declaration.ts` holds declaration findings and the alias, extension, action, and result calls.
- `commands/inputs.ts` holds input calls.
- `commands/attach.ts` checks attachments and siblings.
- `commands/attach-hooks.ts` runs plugin attachment hooks.
- `commands/build.ts` builds the command graph.
- `inputs/places.ts` collects declarations and their places.
- `inputs/declarations.ts` holds input and invocation declaration types, declaration places, and sites.
- `inputs/ledger.ts` holds `ValidatedInputs` and its ledger of reports.
- `inputs/supplied.ts` reads supplied values.
- `inputs/declared-values.ts` prepares declared defaults and implied values.
- `inputs/validation.ts` holds Standard Schema validation, reports, and `validateValues`.
- `invocation/prepare.ts` prepares dispatch from a parsed invocation.
- `invocation/paths.ts` types `invoke()`'s literal paths and values from the Command paths.
- `host/time-zone.ts` resolves a time zone name to the runtime's spelling, for the process handle and a per-call zone.
