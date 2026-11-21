---
type: adr
title: ADR-0200 - Loom says its own sentences in the operator's language through phrasebooks the localization plugin installs
description: Core reads the operator's locale into host.locale from LC_ALL, LC_MESSAGES, and LANG as a canonical BCP 47 tag. Each Loom package registers its message modules by package name, and phrasebook(package, sentences) checks a phrasebook against them, namespaced by module, so a wrong name or parameter type fails to compile. The localization() plugin installs phrasebooks per language. A failure, line, log template, hint, issue, or view label Loom says is a phrase, the sentence with its values and a lazily computed English text, and phrases compose, so an issue inside an input line is one too. Core renders a phrase in the run's language where it renders text for a person, falling back per sentence to the English export. The failure form, failure codes, records, and every machine-read surface stay English. Without the plugin no output byte changes. It supersedes ADR-0164's rejection of message keys and a locale provider, its Not localization clause, and its rule that fixed labels stay where they are, and narrows its Internal and Message modules clauses, ADR-0007's default text, ADR-0046's hint lines and failure view context, ADR-0110's view context builder, and ADR-0174's log line, and adds the locale to ADR-0107's facts.
status: accepted
created: 2026-11-19
modified: 2026-11-21
---

# ADR-0200 - Loom says its own sentences in the operator's language through phrasebooks the localization plugin installs

## Context

An author can replace a whole help or failure view today, but cannot translate Loom's own sentences. An operator who reads German sees the application's own text in German and every sentence core, a plugin, or a validator says in English, and an author who wants a German application rewrites every failure view to reword sentences they did not write.

[ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md) gathered every sentence Loom says to an operator into message modules: one `messages.ts` per concept module, each sentence a named export, a function of the values it repeats or a constant. It rejected message keys and a locale provider, because localization was a separate decision and an indirection nothing used would only add a place to look. That decision is now made. The message modules already name each sentence and type its values, so they can be the source of a translation's shape without a second list of keys.

The owner settled the outline on 2026-11-18 (LM-393): a host fact `host.locale` read from the POSIX locale variables and normalized to a BCP 47 tag; a type per package, derived from its message modules, that a translation implements in part; a `localization()` plugin in `@loomcli/plugins` that installs translations per language, matched by language alone, with a fallback per sentence to English; English alone shipped; and a fixed list of things that never change with the locale. The run agreement of 2026-11-19 placed help headings in `@loomcli/plugins`, kept the failure form's `message` English, and made first-party log templates message-module exports under LM-548. LM-393 builds the mechanism and core's registry entry. LM-560 joins `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/prompts`, each with its fixed labels; `@loom/mcp` declares no member, because its text is the MCP protocol's.

Four questions stayed open: how a message call reaches the run's translations when message functions are plain module exports that callers import directly; how a translation's type is shaped when export names repeat across modules; whether `-v` log lines are translated while the record keeps its English template; and what to call a translation, since the glossary's _catalog_ is the validator catalog and its _translator_ turns a foreign throw into a failure.

## Decision

### The locale

- **`host.locale`.** The host gains `locale`, the operator's locale as a canonical BCP 47 language tag, such as `de-AT`, `sr-Latn-RS`, or `en`. Core sets it on every run's host. Core resolves it once, at entry, before [environment preparation](../core/plugin-contract.md#environment-preparation), so a `LANG` an `onEnvironment` hook adds from a `.env` file never changes it. Core resolves it eagerly, as it copies `home`, rather than on first read as it copies `timeZone`: the hooks add to the run's own environment map, so a read deferred past them would see their additions, and the work is one scan of three variables and one `Intl` call, where the time zone defers a formatter's construction. An action's `invoke` keeps its run's locale, and `app.invoke`, its own outermost run, resolves its own. No invocation takes a locale of its own: `InvokeOptions` gains nothing, and [ADR-0193](0193-invoke-takes-a-per-call-time-zone-and-mcp-reads-it-from-request-metadata.md)'s rule that no host fact but the time zone is set per call stands.
- **One resolver.** `resolveLocale(env)`, exported from `@loomcli/core`, reads the first of `LC_ALL`, `LC_MESSAGES`, and `LANG` that is set and not empty, as POSIX orders the variables for message text, and normalizes it:
  1. `C` and `POSIX`, with or without a codeset, read `en`.
  2. A modifier after `@` that names a script becomes the script subtag after the language: `@latin` gives `Latn`, `@cyrillic` gives `Cyrl`, and `@devanagari` gives `Deva`, so `sr_RS@latin` reads `sr-Latn-RS` and `uz_UZ@cyrillic` reads `uz-Cyrl-UZ`. `@valencia` becomes the variant `valencia`, so `ca_ES@valencia` reads `ca-ES-valencia`. Any other modifier, such as `@euro`, which names a currency, drops.
  3. A codeset after `.` drops, and `_` reads as `-`.
  4. The tag is the one `Intl.getCanonicalLocales` returns, so `de_AT.UTF-8` reads `de-AT` and `iw_IL` reads `he-IL`.

  No variable, and a value `Intl` refuses as a tag, read `en`. `LANGUAGE`, GNU's list of fallback languages, is not read.
- **On the handle.** `ProcessHandle` gains an optional `locale`, and `ProcessFields` with it. A handle that holds one gives the run `resolveLocale({ LC_ALL: locale })`, so a supplied value is normalized by the same rule as the environment's: `de_DE` and `de-DE` both give `de-DE`. A handle that holds none, or holds the empty string, gives the run `resolveLocale` of its `env`, as POSIX reads an empty variable as unset; so `locale: ''` defers to the environment rather than meaning English. `processHandle()` and `mockProcess()` pass a supplied `locale` field through and hold none otherwise, so a test sets the locale with `mockProcess({ locale: 'de-DE' })` or `mockProcess({ env: { LANG: 'de_DE.UTF-8' } })`. The member is optional on the handle and on the `Host` type, as [ADR-0150](0150-an-application-opts-in-to-an-extended-version-that-prints-the-release-facts-runtime-and-platform.md) made `runtime` optional on both, so a hand-built handle and a host a test states whole, under [ADR-0110](0110-a-test-calls-one-author-function-with-a-context-the-testing-package-builds.md), compile unchanged. Core always sets it on a run's host, so code that reads `host.locale` in a run reads a tag.
- **Off POSIX.** Windows sets none of the three variables, so a run there reads `en` unless the operator sets one or an embedding host supplies `locale` on the handle.

### Phrasebooks

- **The term.** A _phrasebook_ is one package's sentences in one language, written by an author or a community: a partial set of the package's message-module sentences, each a constant or a function of the same values as the English export, returning text. A phrasebook holds no sentence of another package. Loom ships no phrasebook; English is the message modules themselves.
- **The registry.** `MessagePackages`, an interface core exports, maps each Loom package's name to its message modules: an interface whose members are its module keys and whose types are each message module's own type, read through a type-only namespace import (`import type * as failures from './failures/messages.js'` and `typeof failures`), so the declaration loads nothing at run time. The equivalent `typeof import('./<module>/messages.js')` form is not used, because the API report's extractor cannot read it. Core declares its own member, `'@loomcli/core'`. Another package adds its member through declaration merging, as an application registers its globals on `Register` under [ADR-0194](0194-invoke-types-a-literal-path-and-its-values-from-the-command-paths-the-application-declares.md). A member may be an interface or a type alias: nothing in the mechanism constrains a module set to an index signature.
- **The module key.** The key is the name of the concept module that holds the message module, the folder name ADR-0164 gives it, such as `failures` or `inputs`. A message module at the top of a package's `src`, such as `@loomcli/validators`'s `src/messages.ts` or the plugin pack's shared `src/messages.ts`, takes the key `common`. A package's voice test fails when a `messages.ts` under its `src` is missing from its registry member, so no sentence falls outside the type.
- **Built by `phrasebook()`.** `Phrasebook` is a class with a private member, so no structural copy is one, and `phrasebook(packageName, sentences)` is the one way to make one. The package name is a key of `MessagePackages`, and `sentences` is typed `PhrasebookSentences<Package>`: per module key, per export, a constant export takes an optional `string`, a function export that returns a string takes an optional function of the same parameters that returns `string`, and any other export takes nothing. A phrasebook written inline in `localization()`, or bound to a name, is the argument of that call, so a misspelled package, module, or sentence name is an error, a parameter of the wrong type is an error under `strictFunctionTypes`, and a function where the export is a constant is an error. An object literal shaped like a phrasebook does not compile where a `Phrasebook` is expected, because the class's private member makes it nominal.
- **What stays unchecked.** TypeScript reports an excess property on an object literal alone. A module's sentences declared apart without an annotation and passed by name, `phrasebook('@loomcli/core', { failures: failuresDe })`, or spread into the argument, `{ failures: { ...failuresDe } }`, has each entry it shares with the module checked, but a misspelled extra name in it is not reported. Annotating the object with `PhrasebookSentences<'@loomcli/core'>['failures']` makes it a checked literal again. A value that bypasses the types, from JavaScript or through `any`, gets no rule under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **Exports are sentences.** Every export of a message module is a phrasebook entry, so a message module exports sentences and nothing else: a failure's sentence, an issue, a line, a hint, a notice, warning, or confirmation, a log template, and, under LM-560, a fixed label. Every exported function declares the return type `string`, and every exported constant is a string or template literal. The voice test fails on an export of any other shape, and on an overloaded export, whose phrasebook entry TypeScript would type by its last signature alone, so no export falls out of `PhrasebookSentences` or narrows in it unseen.
- **Wording modules.** Phrasing that a sentence of another module or a Developer Diagnostic composes, and that a translation therefore never shows on its own, moves to a _wording module_, `wording.ts`, in the concept module that owns it. A wording module is internal, covered by no phrasebook, because a translation composes its own phrasing in its own grammar, and the voice test reads it as it reads a message module. A helper a message module keeps unexported stays where it is.
- **Core's moves.** Core's message modules today export these, which are not sentences, and each moves:
  - `quoted`, `commandSubject`, `routedSubject`, `commandSentence`, and `routedSentence` move from `failures/messages.ts` to `failures/wording.ts`. Sentences in `failures/messages.ts` and `output/messages.ts` import them from there, and so do the Developer Diagnostics of `commands/`, `inputs/option-groups.ts`, `invocation/chain.ts`, and `output/sequence.ts`, and every file of `packages/core/src` that imports `quoted`.
  - `inputSubject` moves from `inputs/messages.ts` to `inputs/wording.ts`, which `inputs/declarations.ts` and `commands/inputs.ts` import.
  - `missingValues` stops being exported: only sentences of `inputs/messages.ts` call it.
  - `redactPathSentence` and `redactPathCorrection`, the redaction fault's Developer Diagnostic, move beside `output/redaction.ts`, the code that raises it.
  - `ignoredFill`, which returns a template and its fields, becomes two template constants, `ignoredFill` and `ignoredFillAt`, for a fill without and with a position. `inputs/validation.ts` builds the fields where it logs, and the `LogLineText` type goes.
  - `issueLine` and `stdinIssue` stay: each is a whole line, and the issue it repeats is a value that may be a phrase, under **Composition**.

  `resultMessage` in `failures/errors.ts`, the sentence of a result-contract defect, composes `routedSentence` outside any message module and stays there: it addresses the author, reaches an operator only in a development build, and a distributed build shows the generic defect message in its place, so it is a Developer Diagnostic's text under ADR-0164 and stays English.

### Phrases

- **The term.** A _phrase_ is one sentence of a message module said with its values: the package, the module key, the export name, the values, and its English text, which is what the English export returns for those values. `Phrase` is a class with a private member, so no structural copy is one; only `phrases()` makes one.
- **Making one.** `phrases(packageName)` takes a key of `MessagePackages`, so the string ties to the registry member and a package name no member declares fails to compile. `.module(key, sentences)` binds one message module by its key and its own exports, checked against the registry's type for that key, and the function it returns takes an export name and that export's values, so `say('unknownCommand', token, candidates)` checks the name and every value.
- **The typed path.** The maker reads the module through a mapped type that the module is assignable to, one member per sentence name holding either a string or a function of that sentence's values, and indexes it by the generic name, so it narrows a constant from a function and calls the function with the checked values. This is the path TypeScript checks for an indexed call: bound to a concrete module, as `failures/messages.ts` was checked when this record was written, the maker needs no type assertion and reads nothing as `any`. Three steps have no typed path that this record could name. The implementation keeps no type assertion for any of them: it reads the module's export and the phrasebook's entry as `unknown` through `Reflect.get`, calls them through `Reflect.apply`, and checks at run time that a constant is a string and an entry returns one, converting any other value with `String()`. Had any step needed an assertion, it would have been pinned in `packages/core/tests/assertions.test.ts` with the reason below under the repository's rule for a last-resort assertion. The three steps and why the values they carry are right:
  1. **The registry's member to the maker's bound.** `.module()` receives a module typed by the registry's generic index, `MessagePackages[Package][Key]`, which TypeScript does not prove assignable to the mapped type the maker indexes. It holds because the registry's member for that key is the message module's own type, read through a type-only namespace import (`import type * as failures` and `typeof failures`), and the voice test checks that every export of that module is a string constant or a function returning `string`.
  2. **A phrase's values to the export's values.** The English text calls the export with each nested phrase replaced by its English text. The mapped values are typed as an array, not the export's tuple. It holds because a phrase stands only where the export takes a `string`, under `PhraseValues`, and its replacement is a `string`; a value `replaceValue` placed may be any string or phrase a caller passed, unchecked against the export, and an author's wrong value there fails through the ordinary failure path when the export runs.
  3. **A phrasebook entry to a function of the sentence's values.** Core reads an entry from a phrasebook by the phrase's module key and export name at run time, so the entry is `unknown` until narrowed, and calling it yields no typed result. It holds because `phrasebook()` typed every entry against the export of that module and name, and core passes the phrase's values with each nested phrase rendered to a `string`.
- **Lazy English.** A phrase computes its English text on its first read of `text` and keeps it. Making one allocates the phrase as a call allocates its fields object, and runs no export. So a log call no hook hears and no verbosity shows still reads nothing from its phrase, as [ADR-0174](0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) states of the call, and a failure's constructor reads the text at once for its `message`.
- **Composition.** Where an export takes a `string`, the maker also takes a phrase, so a sentence can repeat another: `say('issueLine', subject, path, silentRejectionPhrase)`. A phrasebook entry's parameter stays `string`. Core renders each nested phrase in the run's language before it calls the outer entry, and the outer entry receives the rendered string. The English text uses each nested phrase's English text. Each phrase falls back on its own, so a frame no phrasebook holds can hold a localized issue, and a localized frame can hold an English one.
- **What carries one.** Every surface where Loom code hands core an operator's text takes a phrase in place of the string:
  - A failure class's constructor, from `LoomError` down, takes `message: string | Phrase | readonly (string | Phrase)[]`. A string or a phrase is the failure's one line. A list is the failure's lines, one entry per line, so a plugin that raises a failure of several lines, such as the configuration plugin's `InputError` for values its strict mode refuses, passes them as a list rather than one joined string. The failure's `message` is the lines' English text joined by line breaks, and core keeps the lines beside the failure.
  - `out.print`, `out.info`, `out.success`, `out.warn`, `out.error`, and `out.fatal` take a phrase as their text.
  - A log call at each level takes a phrase as its message template, and a phrase as the value of a top-level field of that call. The event's `message`, and each such field, is the phrase's English text, so the record a logging plugin writes and the event every `onLog` hook receives hold strings, as before; core keeps those phrases beside the frozen event, and the `-v` line renders them in the run's language. Only those localize. A `Phrase` has `toJSON`, which returns its English text, so a phrase nested inside a field's value, an array of phrases, and a field bound through `log.with()`, which core copies as JSON when it binds, write English in the record, in every `onLog` hook's event, and on the `-v` line. A field the Application redacts shows `"[Redacted]"` on the `-v` line whether or not it held a phrase.
  - An `onFailure` hook may return a phrase, or a list that holds phrases, as a hint.
  - `phrasedIssue(phrase, fields?)` returns a Standard Schema issue whose `message` is the phrase's English text, with the members of `fields` beside it: its `path`, and any other member the issue carries, such as an issue code's `code` and `params` under [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md). It registers the phrase for that issue in a `WeakMap` core keeps, keyed by the issue object, so a package builds the whole issue in the one call: a spread of the returned issue is a copy core does not make and carries no phrase. The issue's own members are unchanged: it holds `message` and the members `fields` gives it, and no other, so deep equality, such as vitest's `toEqual` and `toStrictEqual`, reads it as equal to the literal issue. Its key order is not promised: `phrasedIssue` writes `message` after the members of `fields`, so `util.inspect`, a snapshot, and JSON of an issue built with fields list `message` last, where a literal may list it first. Core registers the phrase again at each place it copies an issue: where it reads a validator's issues and where it rebuilds an issue to place a value's position in `inputs/validation.ts`, and where a content input rebuilds one in `inputs/content.ts`. A copy core does not make, such as an author's spread, a `structuredClone`, or another library that rebuilds issues, carries no phrase and renders its English `message`. It is the channel for an issue Loom's own code reports and, under LM-560 and LM-592, for an issue an issue code reports: `issueCode`'s `message` may return a `Phrase`, and `issueCode` builds the issue through `phrasedIssue`, so `@loomcli/validators`' catalog and a community validator package localize their issues the same way. Run outside Loom, as a plain Standard Schema validator, such an issue is an ordinary issue with an English `message`.
  - `ViewContext.localize(phrase)` renders a phrase in the run's language, under **Where a phrase renders**.
- **What a plugin reads.** A hook or a view that rebuilds Loom's text, such as the suggestions plugin, which splices a fix where an issue's sentence ends, or a sentence that repeats an issue, such as a question's line under a rejected answer or the configuration plugin's line for a dropped value, reads the phrases on public surface:
  - `issuePhrase(issue)` returns the phrase core registered for an issue while the issue's `message` equals that phrase's English text, and `undefined` otherwise: for an issue core registered nothing for, and for one whose `message` was reworded, such as `` { ...issue, message: `Tag: ${issue.message}` } ``, which carries no phrase anyway, or the registered issue itself after code assigned its `message`. So a sentence repeats `issuePhrase(issue) ?? issue.message`. It is the guard a failure's lines have.
  - `failureLines(failure)` returns the lines a failure keeps, one entry per line, each a phrase or a string, or `undefined` when it keeps none or its `message` no longer reads their joined English text. The lines of an `InputError` core raises follow its problems, one per issue of an invalid problem and one per other problem, so a hook walks them beside `problems`. The lines of a failure a plugin raises follow the list it passed.
  - `replaceValue(phrase, from, to)` returns a copy of the phrase with the first of its values that is `from`, the same phrase or an equal string, replaced by `to`, a string or a phrase, or `undefined` when no value is `from`. Neither `from` nor `to` is checked against the values the phrase's export takes, so the copy's values are what the caller passed; an author's wrong value fails through the ordinary failure path when the copy renders. So a hook replaces the issue inside an input's line with its own fix phrase, `replaceValue(line, issuePhrase(issue) ?? issue.message, fix)`, and the line keeps core's subject and position.

  A hook records a replacement as a phrase in its own state, as the suggestions plugin records its sentence today, and its view renders it with `context.localize`, falling back to `context.message`.

  An author may use the same surfaces for an application's own message modules by adding a member to `MessagePackages`, so the mechanism is not Loom's alone; nothing requires it.
- **Lines.** Core keeps beside a failure a list of lines, each a phrase or a string to repeat as written, and the failure's `message` is the lines' English text joined with line breaks. A failure made from a string or a phrase has one line, and one made from a list has one line per entry. An `InputError` core raises keeps one line per issue of an invalid problem and one per other problem, in the order of its problems, and each line's issue is the issue's phrase when it carries one and its `message` otherwise. A line may render as several lines of text, as a multi-line issue does.
- **Core's own rewrites.** Core's factories that turn a failure's sentence into another after construction, `unknownOptionName`, `undeclaredArgument`, `declaredNoPassthrough`, and `unknownOptionBeforeArguments` in `failures/errors.ts`, which parsing and an invocation by name's lowering reach, replace the failure's lines and its `message` together through one internal operation of core, so the failure keeps a phrase for the sentence it states. Core never assigns a failure's `message` on its own.
- **Core's sentences.** Core raises every failure, writes every line, logs every template, and reports every issue of its message modules through a phrase: the issues `silentRejection`, `environmentBoolean`, `environmentCount`, `environmentTuple`, `unreadableFile`, `filePathsOnly`, `pipedStdin`, `tooFewSources`, `tooManySources`, and the `takes…` issues of an invocation by name's lowering among them, each through `phrasedIssue`.

### Where a phrase renders

- **The run's language.** The run's language is the first subtag of `host.locale`, which is canonical, so `de-AT` and `de` both read `de`. On the first phrase a run renders, core gathers, from the Application's installed plugins in installation order, every phrasebook installed for that language, keeping each plugin's own list order. A nested invocation reads its parent's.
- **Resolution.** A phrase renders as the first gathered phrasebook of its package that holds its sentence: a constant as written, a function called with the phrase's values, each nested phrase rendered first. A phrase no phrasebook holds renders its English export, called with each nested phrase rendered. A language with no phrasebook renders every phrase in English, silently. `en` is a language like any other, so an English phrasebook rewords Loom's English sentences without a view override.
- **For a person, and only there.** A phrase renders in the run's language where core renders text for a person:
  - Core's default failure text, which every failure view falls back to, renders the failure's lines, and the generic defect message from its own phrase. The text core prints for a usage failure keeps its application-name prefix on each line.
  - The failure view context gains `message`: the failure's sentence as core's default text renders it, in the run's language, without the application-name prefix. That is the failure's lines, the failure's `message` when it keeps no lines, and the generic defect message for a declaration fault or a defect, so the context never carries an author fault's detail. An override that prints `context.message` in place of `failure.message` prints the localized sentence.
  - Hints a failure view receives render each hint phrase in the run's language.
  - An `out` call renders its phrase where the line is written.
  - Under `app.invoke`, `messages` captures the run's lines, and a failed call's report and hints, as rendered for a person, so they read in the run's language beside the outcome's English failure form.
  - A `-v` or `-vv` log line fills the phrase's template in the run's language from the event's fields, each top-level field the log call gave a phrase rendered in the run's language and a redacted field as `"[Redacted]"`, placing the fields that template names and trailing the rest under ADR-0174's rules, so a placeholder a translation names that the event lacks is written as it stands. `LogLine.text` is the localized line, and `LogLine.event` keeps the event, whose `message` is the English template.
  - `ViewContext.localize(phrase)` renders a phrase for a view, so a view that composes a label inside its own function, a help heading, a key hint under a question, or a table or record label, says it as a phrase of its package and renders it there. A context core builds outside a run renders English.
- **A changed message.** Core renders a failure's lines only while the failure's `message` still reads their English text joined by line breaks. So a failure whose `message` the author's code changed after construction renders that `message` as written. Core's own rewrites replace the lines with the message, so they never trip this rule.
- **The plain fallback.** The plain fallback path of [the ordinary failure path](../core/failures.md#the-ordinary-failure-path) renders English and runs no phrasebook, so a broken phrasebook never leaves a failure unreported.
- **A phrasebook that throws.** A phrasebook entry is the author's code under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write), and core adds no guard for it. Its throw takes the path a throw at that point already takes: where a failure's text renders, it is a broken failure view, so core writes the original failure's English default text through the plain fallback path and reports the defect; in an `out` call or a view's `localize`, the call throws; and in a log line, it is a log-line view that throws. Core reports a phrasebook's defect in English, so the report runs no phrasebook. An entry that returns a value that is not a string bypasses the types and gets no rule under ADR-0093.

### What stays English

- **The failure form.** `FailureForm.message` and `hints` are the English text, so `invoke`'s outcome, its caller's handler, a failure encoder's JSON line, and the MCP plugin's `structuredContent` read the same in every locale. A failure's `message` is English, so an override that prints `failure.message` prints English.
- **Identities and data.** Failure codes, failure class names, exit codes, option and Command spellings, validator issue codes, an issue's own `message` on `InputError.problems`, every JSON view and schema, the manifest, the installation record, the log record and its template, and every record schema never change with the locale.
- **Protocol text.** The MCP protocol's own error text, which `@loom/mcp` writes for the JSON-RPC envelope, stays English. A tool call is an invocation under the server's run, so the text of a failed call's `content`, the failure's report, follows the server's locale, while its `structuredContent` holds the English form.
- **Relayed text.** Text a Loom sentence repeats that carries no phrase, such as an issue an author's validator wrote, a `FatalError`'s authored message, or another program's output, is repeated as written inside a localized frame. An issue that carries a phrase renders in the run's language, and core uses an issue's phrase only while the issue's `message` equals the phrase's English text, so a reworded issue repeats its `message` as written.
- **Declared descriptions.** A Command's or an option's `description`, an application's or a first-party plugin's alike, is declaration data: the manifest, MCP's tool listings, completion, man pages, and the skills plugin's references read it, so it stays as declared. Help shows its headings over declared descriptions, and the headings localize once `@loomcli/plugins` joins. A later record may let a description carry a phrase without changing this mechanism.
- **Developer Diagnostics.** A Developer Diagnostic addresses the author and stays English, and so does a defect's sentence, such as `resultMessage`.

### Escaping

- **The same values, and the same helpers.** A phrasebook entry receives the values the English export receives, unescaped, apart from a nested phrase, which it receives rendered, and escapes each value it repeats as the English export does, through `escapeControlCharacters`, which `@loomcli/core` already exports, with the quotation marks its language uses. Loom does not escape values before an entry receives them, because the English export decides per value: it escapes a token, and repeats an issue's sentence as written so a multi-line issue prints as before. An entry returns the kind of text its English export returns, plain or marked, and core treats it the same way.
- **The voice test.** The voice test reads the English message modules and wording modules alone, and holds rule 5 there as before. It reads no phrasebook, because a phrasebook is the author's.

### The plugin

- **`localization()`.** `@loomcli/plugins/localization` exports `localization(settings)` and `LocalizationSettings`. Its one setting, `locales`, maps a language subtag to the list of phrasebooks for it: `localization({ locales: { de: [coreDe, pluginsDe] } })`. The plugin's whole contribution is that map.
- **Core's contract.** `PluginDefinition` gains `phrasebooks`, the same map, which core gathers from every installed plugin. A community package that ships phrasebooks may wrap them in a plugin of its own beside an author's `localization()`, and the earlier plugin's entry wins for a sentence both hold, under [ADR-0013](0013-core-installs-no-plugins-and-composes-first-in-wins.md)'s first-in-wins composition. A phrasebook another installed copy of core built is refused under the existing foreign-value rule, as a view or a translation is.
- **Language keys.** A key is a canonical language subtag: two or three lowercase ASCII letters that `Intl.getCanonicalLocales` returns unchanged. `plugin()` throws a `DeclarationError` for any other key under the new rule `@loomcli/core/phrasebook-language`, because a run's language is the first subtag of a canonical tag and never equals it. The sentence names the canonical language when the key has one: `iw` is written `he`, `in` is written `id`, and `sh` is written `sr`. Canonical forms come from the runtime's own `Intl` data, which `resolveLocale` reads too, so a key and a run's language agree on each runtime; the data differs between runtimes for a few deprecated codes, such as `tl`, which Node writes `fil` and Bun keeps. A key such as `de-AT`, `DE`, or `german` is refused the same way.
- **Opt-in.** Without a plugin that installs phrasebooks, every phrase renders its English text, so every output byte is unchanged.

### Testing

- **`viewContext()`.** `@loomcli/testing`'s `ViewValues` gains an optional `localize`, which a test states as any other member, `viewContext(view, { localize: (phrase) => phrase.text.toUpperCase() })`. An unstated `localize` returns the phrase's English text, the answer a run with no phrasebook gives, so a view test that states nothing about localization reads the English bytes it reads today. That is a narrow exception to ADR-0110's rule that a function whose answer the unit reads asks to be stated: the English answer is the one every run without the plugin gives, and a test that asks for no language states nothing.
- **Failure views.** `FailureViewContext.message` needs no builder rule, because no builder makes a `FailureViewContext`; a failure view is tested through a run, as today.
- **The view contexts are no breaking change.** `ViewContext` and `FailureViewContext` are output types, marked `@sealed`, which [Public exports](../core/public-exports.md) defines as a type Loom hands to the author's code and may add members to. A new required member breaks no author's code that reads them, so the change fragment records `localize` and `message` as additions. `@loomcli/testing`'s `viewContext()` is the one builder of a `ViewContext` Loom supports, and it gains the member. `Host` is an input type a test states whole, which is why `locale` is optional on it.
- **The widened `out` and `log` members are a breaking change.** The `out` lanes, `out.fatal`, `MessageArguments`, and the `log` levels take `string | Phrase`. `@loomcli/testing`'s builders take `out` and `log` member by member, so these members are in both positions, and a test double an author states whose parameter is typed from the context and used as a string no longer compiles. The type checker reports every such site, and the change fragment records it as breaking, with a migration: annotate the parameter `(message: string)` where the code under test passes only strings, or, where it may pass a phrase, type it `string | Phrase` and narrow with `message instanceof Phrase` to read `message.text`. A double annotated `(message: string)` still compiles when the code passes a phrase, because the builder hands the argument through unchanged, so it fails only when it runs.
- **The rest.** A test sets the run's locale through `mockProcess({ locale })` or its `env`, and installs `localization()` on the Application under test, so a run test reads the localized bytes.

### A package joins

A package joins in five steps, and the mechanism does not change:

1. Its message modules export sentences alone, with shared phrasing in wording modules.
2. It adds its member to `MessagePackages`, which makes `phrasebook('<package>', …)` and `PhrasebookSentences<'<package>'>` available to authors.
3. It raises its failures, a failure of several lines with one list entry per line, writes its lines, logs its templates, returns its hints, reports its issues through `phrasedIssue`, and renders its views' labels through `ViewContext.localize`, each with phrases made by `phrases('<package>')`.
4. A hook or view that rebuilds Loom's text reads `failureLines`, `issuePhrase`, and `replaceValue`, records its replacement as a phrase, and renders it through `localize`, or prints `context.message` where it rebuilds nothing; a sentence that repeats an issue passes `issuePhrase(issue) ?? issue.message`. LM-560 rewrites the suggestions plugin, `@loomcli/prompts`' question, and the configuration plugin's source this way.
5. Its voice test checks its registry member against its `messages.ts` files and the shape of every export. It also checks that only `phrases.ts` files import or re-export values from message modules.

LM-560 takes these steps for `@loomcli/plugins`, `@loomcli/validators`, and `@loomcli/prompts`. `@loom/mcp` takes none: its sentences are the JSON-RPC and HTTP error text it writes for the protocol, which stays English under **What stays English**, so it declares no member of `MessagePackages`. The fixed labels it moves are headings, table and record labels, and key hints, such as help's `USAGE`, the `repeatable` fact, and the key hints under a question: each becomes a constant in its package's message module, said through `localize` in the view that composes it. A declared description is no label and stays as declared. Core renders no fixed label, so LM-393 moves none.

### The public API

```ts
// @loomcli/core
interface ProcessHandle {
  readonly locale?: string | undefined; // normalized through resolveLocale as an LC_ALL value
}
// ProcessFields gains `locale` with the handle.
interface Host {
  readonly locale?: string | undefined; // a canonical BCP 47 tag; core always sets it on a run's host
}
function resolveLocale(env: Readonly<Record<string, string | undefined>>): string;

/** Each Loom package's message modules, by package name. A joining package merges its own member. */
interface MessagePackages {
  '@loomcli/core': CoreMessageModules; // internal: failures, inputs, invocation, output, and plugins, each the `typeof` of a type-only namespace import
}
type MessagePackage = keyof MessagePackages;

/** The names of a module's exports a phrasebook may hold: its constants and its functions that return a string. */
type SentenceNames<Module> = {
  [Name in keyof Module]: Module[Name] extends string | ((...values: never[]) => string)
    ? Name
    : never;
}[keyof Module];
/** The values one sentence takes. */
type SentenceValues<Sentence> = Sentence extends (...values: infer Values) => string ? Values : [];
/** A phrasebook's entry for one sentence. */
type SentenceEntry<Sentence> = Sentence extends string
  ? string
  : Sentence extends (...values: infer Values) => string
    ? (...values: Values) => string
    : never;
/** The sentences a phrasebook of one package may hold, each optional. */
type PhrasebookSentences<Package extends MessagePackage> = {
  readonly [Module in keyof MessagePackages[Package]]?: {
    readonly [Name in SentenceNames<MessagePackages[Package][Module]>]?: SentenceEntry<
      MessagePackages[Package][Module][Name]
    >;
  };
};
/** One package's sentences in one language. */
declare class Phrasebook {
  private constructor();
  readonly package: MessagePackage;
  private readonly sentences: unknown; // a private member makes the class nominal
}
function phrasebook<Package extends MessagePackage>(
  packageName: Package,
  sentences: PhrasebookSentences<Package>,
): Phrasebook;

/** One sentence said with its values. */
declare class Phrase {
  private constructor();
  /** The English text, computed on first read: what the English export returns for these values. */
  readonly text: string;
  /** The English text, so a phrase inside JSON, such as a nested log field's value, writes English. */
  toJSON(): string;
  private readonly values: unknown;
}
/** A sentence's values as a maker takes them: a phrase may stand where the export takes a string. */
type PhraseTuple<Values extends readonly unknown[]> = {
  [Index in keyof Values]: string extends Values[Index] ? Values[Index] | Phrase : Values[Index];
};
type PhraseValues<Sentence> = Sentence extends (...values: infer Values) => string
  ? PhraseTuple<Values>
  : [];
interface PhraseSource<Package extends MessagePackage> {
  module<Key extends keyof MessagePackages[Package] & string>(
    key: Key,
    sentences: MessagePackages[Package][Key],
  ): PhraseMaker<MessagePackages[Package][Key]>;
}
type PhraseMaker<Module> = <Name extends SentenceNames<Module> & string>(
  name: Name,
  ...values: PhraseValues<Module[Name]>
) => Phrase;
function phrases<Package extends MessagePackage>(packageName: Package): PhraseSource<Package>;
function phrasedIssue<Fields extends object>(
  phrase: Phrase,
  fields?: Fields & { readonly path?: StandardSchemaV1.Issue['path'] },
): StandardSchemaV1.Issue & Omit<Fields, 'message'>;
function issuePhrase(issue: StandardSchemaV1.Issue): Phrase | undefined;
function failureLines(failure: LoomError): readonly (string | Phrase)[] | undefined;
function replaceValue(phrase: Phrase, from: string | Phrase, to: string | Phrase): Phrase | undefined;

// Widened members:
// LoomError and every failure class's constructor: message: string | Phrase | readonly (string | Phrase)[]
// Out: print, info, success, warn, error, and fatal take string | Phrase as their text
// Log: each level takes string | Phrase as its message template, and a top-level field value of the call may be a Phrase
// FailureHook: returns string | Phrase | readonly (string | Phrase)[] | undefined
interface ViewContext {
  readonly localize: (phrase: Phrase) => string; // the phrase in the run's language
}
// @loomcli/testing: ViewValues gains an optional `localize`; viewContext() answers an unstated one
// with the phrase's English text.
interface FailureViewContext {
  readonly message: string; // the failure's sentence in the run's language
}
interface PluginDefinition {
  phrasebooks?: Readonly<Record<string, readonly Phrasebook[]>>;
}

// @loomcli/plugins/localization
interface LocalizationSettings {
  readonly locales: Readonly<Record<string, readonly Phrasebook[]>>;
}
function localization(settings: LocalizationSettings): Plugin;
```

`check:api` reports each new export and widened member. `CoreMessageModules` and the message-module declarations it names enter core's rolled-up declarations as forgotten exports, pinned in `scripts/api-surface.mjs` with the reason that `MessagePackages` names them, so core's API report shows every sentence's name and parameters.

The contract is in [Localization](../core/localization.md), [the localization plugin](../plugins/localization.md), [Host](../core/host.md), [Failures](../core/failures.md#where-looms-messages-live), [Failure views and encoders](../core/failure-views.md#failure-view-context), [Views](../core/views.md), [Core source modules](../maintaining/core-modules.md), and the [glossary](../glossary.md).

## Relationships

This record supersedes these clauses of ADR-0164, leaving the rest in force:

- **Not localization**, that a message module is plain functions with no locale provider, no message keys, no lookup indirection, and no extension point. A message module stays plain functions; phrases and phrasebooks are the lookup, and `PluginDefinition.phrasebooks` is the extension point.
- **What moves**, its sentence that fixed labels stay where they are. Core renders none, and LM-560 moves the other packages' labels into their message modules.
- Its rejection of **Message keys and a locale provider** under Considered options. A phrasebook's keys are the export names the message modules already hold, so no second list of keys exists.

It narrows ADR-0164's **Internal** clause: a message module stays internal and no entry point exports one, but each sentence's export name and parameter types become public through `MessagePackages`, and the API reports change with them. It narrows its **Message modules** clause: a message module exports sentences alone, each function typed to return `string` and each constant a literal, and shared phrasing moves to a wording module the voice test also reads.

It narrows [ADR-0007](0007-failures-are-public-classes-with-class-keyed-renderers.md)'s rule that core's default text runs no application code: the default text runs the run's phrasebook entries, while the plain fallback path renders English and runs none. It narrows [ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md)'s **Hint lines**, so a hook may return a phrase, and its **The failure view's context**, which gains `message`. It narrows **The text** of a log line in ADR-0174, which is still proposed: the line fills a phrase's template in the run's language, while **The record keeps the template** stands and a log call that creates no event runs no export. It adds a fact to [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md)'s **The facts**: the handle may hold a `locale`, and the host holds one, as ADR-0150 added `runtime`; ADR-0107's one process handle per run is unchanged. It narrows [ADR-0110](0110-a-test-calls-one-author-function-with-a-context-the-testing-package-builds.md)'s rule that a function whose answer the unit reads asks to be stated, for `ViewContext.localize`, which `viewContext()` answers unstated with the phrase's English text, as a run with no phrasebook answers. ADR-0007, ADR-0046, ADR-0107, ADR-0110, ADR-0164, and ADR-0174 carry dated entries. [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md)'s failure form, [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md)'s voice, which binds the English source, and ADR-0193's per-call time zone are unchanged.

## Considered options

- **Run-scoped ambient state for the message call.** A run would set its phrasebooks in an `AsyncLocalStorage`, or in a slot core sets, and each message function would read it. Rejected. Core carries no ambient state today: every run fact flows from the run's process handle and context. A module-level slot breaks under concurrent runs, such as MCP's concurrent HTTP calls and tests. An async context is lost in a listener registered outside the run, such as a signal listener, so a sentence written there would silently fall back to English. And a failure's `message` must stay English while its rendered text does not, so a failure would carry both texts anyway, which is the phrase.
- **Threading a resolver to every site that raises or writes.** Rejected. A failure class's public constructor cannot take the run's resolver, the parser and validators would carry it through every routine that raises, and an author's failure would never localize.
- **Translating at construction.** Each message call would return the localized text, and the failure's `message` would hold it. Rejected by the run agreement: the failure form, JSON views, and MCP's structured content read `message`, and they stay English.
- **A flat phrasebook with a uniqueness check.** One map of export names per package, with a test that no two modules export one name. Rejected. The plugin pack's message modules already share names: `recordUnreadable` is exported by five of them, completion's, man pages', MCP's, the service plugin's, and the skills plugin's, with different parameters in MCP's, and `removedFile` by two, completion's and the service plugin's. Other lanes add modules such as core's `shipping` and `style`, and a collision would force a rename in a module that has nothing to do with the other. The module key costs one level of nesting and keeps each module's names its own.
- **A phrasebook as a plain object typed by its package.** Each package would export a `<Package>Phrasebook` type, and the plugin would take any object with a `package` and `sentences`. Rejected. The plugin's list cannot name every package's type, so a phrasebook written inline in `localization()` would be checked against `object` alone, and a wrong name or parameter type would compile. A nominal class made by `phrasebook()`, keyed by the registry, checks every phrasebook at the call that makes it.
- **A hand-written key list or generated keys.** Rejected. The message modules already name each sentence and type its values, so a list would be a second source that drifts from them.
- **Escaping values before an entry receives them.** Rejected. The English export decides per value whether to escape it, and repeats an issue's sentence unescaped so a multi-line issue prints as before; Loom cannot make that decision for a value it hands an entry, and an entry already receives what the English export receives.
- **An English text computed when the phrase is made.** Rejected. A log call would run the English export before the log checks whether any hook hears it or the verbosity shows it, against ADR-0174's rule that such a call reads nothing.
- **Keeping `-v` log lines in English.** The log line would repeat the record's English template on the screen. Rejected. ADR-0164 counts a `-v` line as an operator message, and a German operator who asks for `-v` reads Loom's lines beside the localized failures. The record still holds the English template, so a search of the log and a bug report's record read the same words.
- **Message catalogs.** Rejected as a name. The glossary's _validator catalog_ is the validators `@loomcli/validators` ships, and _translator_ and `Translation` already name the error translator, so the new terms are _phrasebook_ and _phrase_.
- **`LANGUAGE` and longer tag matches.** Not taken. `LANGUAGE` is a GNU extension, and the owner settled a match on the language subtag alone, so a phrasebook serves every region and script of its language.
- **A supplied locale taken as given.** Rejected. A test or an embedding host that supplies `de_DE`, a POSIX spelling, would give the run the language `de_de`, which no phrasebook key equals, and the run would stay English without a word.
- **Lazy phrasebooks.** A language's list as a loader the run awaits. Not taken now: the settled option shape is a list, and an author who ships many languages chooses which phrasebooks a build imports.

## Consequences

An operator whose locale has phrasebooks reads Loom's sentences in their language wherever core renders text for a person, and every machine-read surface reads the same as before. Without a phrasebook, nothing changes in what an operator reads. An author's test that states an `out` lane or a `log` level typed from the context changes, because the parameter may now be a phrase; the type checker reports each such site.

A sentence's export name and parameter types are now public. Renaming a sentence or changing its parameters changes the API report and breaks a phrasebook that holds it at compile time, so a change fragment records it as a breaking change. Rewording a sentence in English keeps its type, so a phrasebook entry for it compiles and goes on saying the old meaning; the change fragment names a reworded sentence so a phrasebook's maintainer can follow it.

Core's message modules lose their exported helpers to wording modules and `output/redaction.ts`, as **Core's moves** lists, and `ignoredFill` becomes two templates. Core gains `resolveLocale`, `MessagePackages`, `Phrasebook`, `phrasebook`, `Phrase`, `phrases`, `phrasedIssue`, `issuePhrase`, `failureLines`, `replaceValue`, the sentence types, `ViewContext.localize`, `FailureViewContext.message`, and one declaration rule. Each core site that raises a failure, writes a line, logs a template, or reports an issue from a message module goes through a phrase, and each voice test gains the registry check and the export-shape check.

A launch without the plugin loads no more modules than before: the phrase and phrasebook code ships inside core's own chunk. Measured as the bytes of each unique file a run loads on 2026-11-19, the built `examples/textstat` application's `--help` reads 1,055,091 bytes against 1,038,300 on the base, 16,791 more, with the same 28 files, and `examples/jsonkit`'s `--help` reads 1,015,227 against 998,668, 16,559 more, with the same 29.

A language-only match cannot tell Traditional Chinese from Simplified or Brazilian Portuguese from European; a later record may match a longer tag first. An author who imports phrasebooks for many languages loads all of them at launch.

## Status

Accepted in 0.20.0.

## Changelog

- 2026-11-19: Proposed with the contract (LM-393). ADR-0007, ADR-0046, ADR-0164, and ADR-0174 carry dated entries.
- 2026-11-19: Revised after the document review (LM-393). Phrasebooks are made by `phrasebook()` against the `MessagePackages` registry, so an inline phrasebook is checked, and the forms still unchecked are named. Phrases compose, a failure keeps one phrase per line, core's own issues carry theirs through `phrasedIssue`, and core's message rewrites replace the phrase with the message. A phrase's English text is lazy, so ADR-0174's guarantee holds. `ViewContext.localize` renders a view's labels. Every export of a message module is a sentence of a checked shape, and core's moves are listed in full. The resolver maps script modifiers and normalizes a supplied locale, `host.locale` is required on the host, and a phrasebook key must be canonical.
- 2026-11-19: Revised after the second document review (LM-393). `host.locale` is optional on the `Host` type, as `runtime` is, and an empty supplied locale defers to the environment. `ViewContext.localize` has a testing answer, the phrase's English text, and neither new view member is a breaking change. A plugin reads an issue's phrase, a failure's lines, and replaces a value inside a phrase on public surface, so LM-560 needs no mechanism change. A log field may hold a phrase. An issue keeps its phrase under a symbol-keyed property that survives a spread and stays out of JSON. The three assertions the implementation may keep are named with their reasons. Declared descriptions stay as declared, because they are declaration data every projection reads, and an overloaded export is refused in a message module. ADR-0107 and ADR-0110 carry dated entries.
- 2026-11-19: Revised after the third document review (LM-393). A failure class's constructor takes a list of lines, and the changed-message rule compares the lines' joined English text. An issue's phrase lives in a `WeakMap` core keeps, so an issue's shape is unchanged, core registers the phrase again where it copies an issue, and `issuePhrase` returns it only while the issue's `message` equals its English text. Only a top-level log field localizes; a `Phrase` writes its English text as JSON. `replaceValue` does not check its values against the export.
- 2026-11-19: `phrasedIssue` takes the issue's other members beside its `path`, so an issue code's `code` and `params` are built with the phrase in one call rather than spread onto a returned issue, which a `WeakMap` would not follow (LM-393).
- 2026-11-20: `@loom/mcp` declares no member of `MessagePackages`, because its sentences are protocol text, which stays English; LM-560 joins the other three packages (LM-560).
- 2026-11-20: The `message-import` voice check reserves value imports and re-exports from message modules for `phrases.ts` in packages that join localization (LM-584).
- 2026-11-20: `issueCode`'s `message` may return a `Phrase`, and `issueCode` builds that issue through `phrasedIssue`, so a community validator package localizes its issues with the public API. The catalog's internal `catalogIssueCode` is gone (LM-592).
