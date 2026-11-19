---
description: "Localization: the operator's locale, the phrasebooks that hold Loom's sentences in another language, the phrases Loom says, where a phrase renders in the run's language, and what stays English."
---

# Localization

Loom's own sentences are English, held in [message modules](failures.md#where-looms-messages-live). An author who installs phrasebooks has core render those sentences in the operator's language wherever it renders text for a person, while every surface a machine reads stays English. Loom ships English alone; a phrasebook is the author's or a community's. [ADR-0200](../decisions/0200-loom-says-its-own-sentences-in-the-operators-language-through-phrasebooks-the-localization-plugin-installs.md) records the decision, and [the localization plugin](../plugins/localization.md) is how an application installs phrasebooks.

```ts
import { escapeControlCharacters, phrasebook } from '@loomcli/core';

const shown = (value: string) => `„${escapeControlCharacters(value)}“`;

export const coreDe = phrasebook('@loomcli/core', {
  failures: {
    genericDefect: 'Etwas ist schiefgelaufen.',
    unknownOption: (spelling) =>
      `Unbekannte Option ${shown(spelling)}. Gib eine deklarierte Option an; stelle einem Pfad mit Bindestrich "./" voran.`,
  },
  inputs: {
    silentRejection: 'Der Wert wurde abgelehnt.',
  },
});
```

## The locale

`host.locale` is the operator's locale as a canonical BCP 47 tag, such as `de-AT`. Core resolves it once, at entry, from the [process handle](host.md#the-process-handle), and sets it on every run's host. It is optional on the `Host` type, as `runtime` is, so a host a test states whole compiles without it.

- **Where it comes from.** The first of `LC_ALL`, `LC_MESSAGES`, and `LANG` in the handle's `env` that is set and not empty decides, or the handle's own `locale` when it holds one, read as an `LC_ALL` value. A handle's `locale` that is the empty string reads as none, as POSIX reads an empty variable, so the environment decides.
- **How it reads.** `C` and `POSIX`, with or without a codeset, read `en`. A script modifier becomes a script subtag, `@latin` as `Latn`, `@cyrillic` as `Cyrl`, and `@devanagari` as `Deva`, so `sr_RS@latin` reads `sr-Latn-RS`; `@valencia` becomes the variant `valencia`; any other modifier drops. A codeset drops, `_` reads as `-`, and the tag is the one `Intl.getCanonicalLocales` returns, so `de_AT.UTF-8` reads `de-AT` and `iw_IL` reads `he-IL`. No variable, and a value `Intl` refuses, read `en`. `LANGUAGE` is not read.
- **`resolveLocale`.** `resolveLocale(env: Readonly<Record<string, string | undefined>>): string`, exported from `@loomcli/core`, is that rule.
- **Once per run.** Core resolves the locale before [environment preparation](plugin-contract.md#environment-preparation), so a `LANG` an `onEnvironment` hook adds changes nothing. An action's `invoke` keeps its run's locale, and `app.invoke` resolves its own. No invocation takes a locale of its own.
- **In a test.** `mockProcess({ locale: 'de_DE' })`, `mockProcess({ locale: 'de-DE' })`, and `mockProcess({ env: { LANG: 'de_DE.UTF-8' } })` all give a run the locale `de-DE`, because a supplied locale is normalized by the same rule.
- **The run's language.** The language core matches phrasebooks against is the canonical locale's first subtag, so `de-AT` and `de` both read `de`.

## Phrasebooks

A phrasebook is one package's sentences in one language: a partial set of the sentences its message modules export, each a constant or a function of the same values as the English export, returning text. `phrasebook(packageName, sentences)` makes one.

```ts sketch
interface MessagePackages {
  '@loomcli/core': CoreMessageModules; // each joining package merges its own member
}
type PhrasebookSentences<Package extends keyof MessagePackages> = {
  readonly [Module in keyof MessagePackages[Package]]?: {
    readonly [Name in SentenceNames<MessagePackages[Package][Module]>]?: SentenceEntry<
      MessagePackages[Package][Module][Name]
    >;
  };
};
declare class Phrasebook {
  private constructor();
  readonly package: keyof MessagePackages;
}
function phrasebook<Package extends keyof MessagePackages>(
  packageName: Package,
  sentences: PhrasebookSentences<Package>,
): Phrasebook;
```

- **By module, then by name.** `sentences` holds one object per message module, under the name of the concept module that holds it, such as `failures`, `inputs`, `invocation`, `output`, or `plugins`, and in it one entry per export. A message module at the top of a package's `src` takes the key `common`.
- **Checked where it is made.** `phrasebook()` checks the package name against `MessagePackages` and `sentences` against that package's message modules, so a misspelled package, module, or sentence, a parameter of the wrong type, or a function where the export is a constant fails to compile. That holds for a phrasebook bound to a name and one written inline in the plugin's settings. An object shaped like a phrasebook is not one, so the plugin refuses it at compile time.
- **What stays unchecked.** TypeScript reports an excess property on an object literal alone. A module's sentences declared apart without an annotation and passed by name, or spread into the argument, has its shared entries checked but a misspelled extra name not reported. Annotate such an object with `PhrasebookSentences<'@loomcli/core'>['failures']` to have it checked whole.
- **Partial.** Every entry is optional. A sentence a phrasebook leaves out renders in English.
- **Escaping.** An entry receives the values the English export receives, unescaped, apart from a nested phrase, which it receives rendered, and escapes each value it repeats as the English export does, through `escapeControlCharacters`, with its own language's quotation marks. A value the English export repeats as written, such as an issue's sentence, is repeated as written. An entry returns the kind of text its English export returns, plain or marked.
- **Public names.** A sentence's export name and parameters are part of its package's public types. A change to either is a breaking change for a phrasebook that holds the sentence, and a reworded English sentence keeps its type, so a phrasebook's maintainer follows the changelog.
- **The packages.** `@loomcli/core` declares its own member of `MessagePackages`. Each other first-party package adds its member when it joins.

## Phrases

A phrase is one sentence said with its values: the English text the English export returns for them, computed on first read, and where a phrasebook finds the sentence. Core raises its failures, writes its lines, logs its templates, returns its hints, and reports its issues through phrases. A package that joins localization does the same, and renders its views' labels through `ViewContext.localize`.

```ts sketch
declare class Phrase {
  private constructor();
  readonly text: string; // the English text, computed on first read
  toJSON(): string; // the English text
}
function phrases<Package extends keyof MessagePackages>(packageName: Package): PhraseSource<Package>;
interface PhraseSource<Package extends keyof MessagePackages> {
  module<Key extends keyof MessagePackages[Package] & string>(
    key: Key,
    sentences: MessagePackages[Package][Key],
  ): PhraseMaker<MessagePackages[Package][Key]>;
}
type PhraseMaker<Module> = <Name extends SentenceNames<Module> & string>(
  name: Name,
  ...values: PhraseValues<Module[Name]> // a phrase may stand where the export takes a string
) => Phrase;
function phrasedIssue<Fields extends object>(
  phrase: Phrase,
  fields?: Fields & { readonly path?: StandardSchemaV1.Issue['path'] },
): StandardSchemaV1.Issue & Omit<Fields, 'message'>;
function issuePhrase(issue: StandardSchemaV1.Issue): Phrase | undefined;
function failureLines(failure: LoomError): readonly (string | Phrase)[] | undefined;
function replaceValue(phrase: Phrase, from: string | Phrase, to: string | Phrase): Phrase | undefined;
```

- **What takes one.** A failure class's constructor takes `message: string | Phrase | readonly (string | Phrase)[]`: a string or a phrase is one line, and a list is the failure's lines, one entry per line, so a failure of several lines passes a list rather than one joined string. The failure's `message` is the lines' English text joined by line breaks. `out.print`, `info`, `success`, `warn`, `error`, and `fatal` take a phrase as their text. A log call takes a phrase as its template, and as the value of a top-level field of the call, and the event's `message` and fields hold the English text, so the record and every `onLog` hook read strings. An `onFailure` hook may return a phrase, or a list that holds phrases. `phrasedIssue` makes a Standard Schema issue whose `message` is the English text and registers the phrase for it in a `WeakMap` core keeps, so the issue holds `message` and the members `fields` gives it and no other: deep equality reads it as equal to the literal issue. Its key order is not promised: `message` follows the members of `fields`, so `util.inspect`, a snapshot, and JSON of an issue built with fields list `message` last. Core registers the phrase again wherever it copies an issue; a copy core does not make, such as an author's spread or a `structuredClone`, carries no phrase and renders English. A view renders a phrase through `context.localize`.
- **Composition.** Where an export takes a string, a phrase may stand, so an input's line can repeat a phrase for its issue. Core renders the nested phrase first, and the outer entry receives a string. Each phrase falls back on its own.
- **Lines.** A failure keeps one entry per line, each a phrase or a string. An `InputError` core raises keeps one line per issue of an invalid problem and one per other problem, in the order of its problems, and each line's issue is the issue's phrase when it carries one. A failure a plugin raises keeps the lines it passed.
- **Reading and rebuilding.** A hook or a view that rebuilds Loom's text reads it on public surface: `issuePhrase(issue)` returns an issue's phrase while the issue's `message` equals its English text and `undefined` otherwise, `failureLines(failure)` a failure's lines, one entry per line, while its `message` reads their joined English text, and `replaceValue(phrase, from, to)` a copy of a phrase with one value replaced, unchecked against the export's values, so a hook swaps the issue inside an input's line for its own fix phrase and keeps core's subject. A sentence that repeats an issue passes `issuePhrase(issue) ?? issue.message`. The hook records its replacement as a phrase and its view renders it with `context.localize`.
- **Lazy.** Making a phrase runs no export, so a log call no hook hears and no verbosity shows reads nothing from it.
- **An application's own.** An application may add its own member to `MessagePackages` and say its own sentences through `phrases()`, and `phrasebook()` under its own package name translates them. Nothing requires it.

## Where a phrase renders

A phrase renders in the run's language where core renders text for a person, and nowhere else.

- **Resolution.** On the first phrase a run renders, core gathers every phrasebook the installed plugins hold for the run's language, in installation order and each plugin's list order. A phrase renders as the first of its package's phrasebooks that holds its sentence; one no phrasebook holds renders its English export. A language with no phrasebook renders English. `en` is a language like any other, so an `en` phrasebook rewords Loom's English sentences.
- **Failures.** Core's default failure text renders the failure's lines, and the generic defect message from its own phrase, with the application-name prefix as before. The [failure view context](failure-views.md#failure-view-context)'s `message` holds that text, so an override that prints `context.message` prints the localized sentence and one that prints `failure.message` prints English. A failure whose `message` an author's code assigned after construction, so it no longer reads its lines' English text joined by line breaks, renders that `message` as written; core's own rewrites replace the phrase with the message.
- **Lines and hints.** An `out` call renders its phrase where the line is written. Hints a failure view receives render each hint phrase.
- **`app.invoke`'s messages.** The lines, the failure report, and the hints `messages` captures are rendered for a person, so they read in the run's language beside the outcome's English failure form.
- **Log lines.** A `-v` or `-vv` log line fills the phrase's template in the run's language from the event's fields, each top-level field the log call gave a phrase rendered in the run's language, under [Logging](logging.md). The record keeps the English template and the English field values.
- **Views.** `ViewContext.localize(phrase)` renders a phrase in the run's language, so a view that composes a label in its own function says it as a phrase. A context core builds outside a run renders English.
- **The plain fallback.** The plain fallback path of [the ordinary failure path](failures.md#the-ordinary-failure-path) renders English and runs no phrasebook.
- **A phrasebook that throws.** An entry is the author's code. Its throw takes the path a throw at that point already takes: where a failure's text renders, a broken failure view, so core writes the original failure's English default text through the plain fallback path and reports the defect; in an `out` call or `localize`, the call throws; in a log line, a log-line view that throws. The defect reports in English.

## What stays English

- **The failure form.** `FailureForm.message` and `hints` are English, so `invoke`'s outcome, a failure encoder's line, and the MCP plugin's `structuredContent` read the same in every locale.
- **Identities and data.** Failure codes, class names, exit codes, option and Command spellings, validator issue codes, an issue's `message` on `InputError.problems`, every JSON view and schema, the manifest, the installation record, and the log record.
- **Protocol text.** The MCP protocol's own error text. A failed tool call's `content` is the failure's report, so it follows the server's locale, while its `structuredContent` holds the English form.
- **Relayed text.** Text that carries no phrase, such as an issue an author's validator wrote, a `FatalError`'s authored message, or another program's output, repeats as written inside a localized sentence. An issue that carries a phrase renders in the run's language while its `message` equals the phrase's English text; a reworded issue, such as `` { ...issue, message: `Tag: ${issue.message}` } ``, repeats its `message` as written.
- **Declared descriptions.** A Command's or an option's `description`, a first-party plugin's included, is declaration data the manifest, MCP's tool listings, completion, man pages, and skill references read, so it stays as declared. Help shows its headings over declared descriptions, and the headings localize once `@loomcli/plugins` joins.
- **Developer Diagnostics.** They address the author, and so does a defect's sentence.

## Which sentences localize

Core's own sentences localize. `@loomcli/plugins`, `@loomcli/validators`, `@loomcli/prompts`, and `@loom/mcp` join package by package. A package joins by exporting sentences alone from its message modules, adding its member to `MessagePackages`, saying its sentences through `phrases()`, reporting its issues through `phrasedIssue`, rendering the fixed labels an operator reads, headings, table and record labels, and key hints, through `ViewContext.localize`, with those labels moved into its message modules, and rebuilding Loom's text in its hooks and views through `failureLines`, `issuePhrase`, and `replaceValue`. Core renders no fixed label.

## Testing

`viewContext()` from [`@loomcli/testing`](../libs/testing.md#viewcontext) answers an unstated `localize` with the phrase's English text, so a view test reads English unless it states its own `localize`. A run test sets the locale with `mockProcess({ locale: 'de-DE' })` or the mock's `env`, and installs `localization()` on the Application under test.
