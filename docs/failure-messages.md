---
description: The voice rule every failure message Loom ships follows, with before-and-after examples for contributors and application authors, how a defect and a leaked author fault reach an operator, and the audit of the Loom-owned messages the rule changes.
---

# Failure messages

A failure message tells its reader what went wrong and what to do instead. This page states the rule every message Loom ships follows, and shows an application author how to follow it in their own messages. [ADR-0047](decisions/0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md) records the decision. The record is proposed and the rules are not yet implemented: until the audit lands, Loom's messages keep their current text, and the Current column of the [audit](#9-audit) shows it. [Failure views](core.md#failure-views) describe how core renders a failure, and [Issue codes](validators.md#issue-codes) describe how an author rewords a catalog sentence.

```text
Before: Invalid input: Option "--config": File "settings.json" is not valid JSON.
After:  Invalid input: Option "--config": File "settings.json" is not valid JSON. Correct its syntax, or supply another file.
```

The rules below bind every operator message Loom ships: core, `@loomcli/plugins`, and `@loomcli/validators`. Loom cannot check a message an application writes. For an application, the rules are guidance, and the example applications model rules 2 and 3.

## 1. Know who reads the message

- **Operator message.** Any message that runs after the application is built and shipped: a usage error, a rejected value, a warning, a fatal error an action raises, and a defect. Its reader ran the application and cannot change its code.
- **Author message.** A message that runs while the author develops the application: a declaration fault at a call, an attach, or graph build under [Declaration faults](core.md#declaration-faults), and any other code or build fault. An author message never prints on a shipped application. It follows rule 2 addressed to the author, and each rule's diagnostic under [Declaration faults](core.md#declaration-faults) already does.

## 2. Say what went wrong and what to do instead

Every operator message has two required parts:

- **What went wrong**, naming the specific thing: the input, the file, the position, or the path.
- **What to do instead**: an action, or what is accepted.

For a rejected value, the catalog's `Expected ...` sentence is the second part, because core prefixes the input's name under [Issues and validator failures](core.md#issues-and-validator-failures): `Option "--workers": Expected a whole number from 1 through 64.`

| Before                                   | After                                                                              | What changed                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `Invalid input: Argument "path": Expected a path.` | `Invalid input: Argument "path": Expected a nonempty path with no NUL character.` | The accepted form is specific.       |
| `Unknown command "nope".`                | `Unknown command "nope". Supply the name of a declared command.`                   | The sentence gains its fix.           |
| `Path not found: a.b`                    | `Path not found: a.b. Run jsonkit keys to list the keys at the root.`              | An application names its own Command. |

## 3. Leave plugin pointers to hint lines

A pointer that depends on which plugins are installed, such as `Run with --help.`, an `--explain` option, or a suggested spelling, never appears in core's sentence, because core cannot know the plugin is installed. It arrives as a hint line from a plugin's `onFailure` hook under [Failure hints](core.md#failure-hints), or, for a suggestion, in the sentence a plugin's own failure view writes, as the [suggestions](core.md#suggestions) plugin does.

An application's own message may name its own Commands, as jsonkit's `Path not found` message names `jsonkit keys` above.

## 4. Repeat a value only when it is known not to be secret

- **Core and the catalog** never repeat an input's value, because they cannot know the value is not a secret. They describe what is accepted instead. Core already drops an unknown option's inline value after `=`, so the message for `--tokn=abc123` names `--tokn` alone. A Command word and an option spelling are structure, not an input's value, so core repeats them. A Command that declares children accepts no arguments, under [Application declarations](core.md#application-declarations), so a word in the position after it is a command word, never an input's value, and core may repeat it.
- **A plugin or an application** may repeat a value of an input it owns when it knows the value is not a secret: the configuration plugin repeats the `--config` file path, and jsonkit repeats a document path.

## 5. Escape everything repeated

Everything a message repeats is escaped. Escaping for quoted diagnostic text covers control characters and line separators, and also these format characters:

- the bidirectional embedding, override, and isolate controls U+202A through U+202E and U+2066 through U+2069;
- the marks U+200E, U+200F, and U+061C.

[`escapeControlCharacters`](core.md#strings-and-composition) escapes all of them, and so does every place a Loom failure message quotes raw text. Results output is untouched, because right-to-left text uses these marks legitimately. Other format characters stay as they are: a zero-width joiner inside an emoji and a soft hyphen are ordinary text.

## 6. Quote no text Loom did not write

An operator message Loom ships never includes text Loom did not write: a thrown cause, an engine or Node.js reason, or a stack. Such text is a leak. It can hold a path or a value the operator never supplied, it changes between runtimes and versions, and it gives the operator no step to take.

The rule binds core, `@loomcli/plugins`, and `@loomcli/validators`, and not applications. An application owns its domain and decides for itself: jsonkit may include the `JSON.parse` reason in `Cannot parse JSON in doc.json: ...`, because the reason locates the fault in a document the operator wrote.

## 7. A defect shows one generic message

A defect is a failure only the author can fix: an unexpected exception, a broken view or `onFailure` hook, a broken result contract, or an author fault rule 8 classifies as one. It is the application's equivalent of an HTTP 500. The operator sees one generic, friendly message with no reason, no class name, and no code detail. The run exits 1, or keeps its cancellation code when the run was cancelled, as [Signals and cancellation](core.md#signals-and-cancellation) ranks it.

- **Replacing it.** An author replaces the message with the existing `override(InternalError, view)`, and adds a pointer, such as where to report the defect, through an `onFailure` hint.
- **The author's detail.** The author sees the detail while developing, in a separate author development view. That view, how a run knows it is in development, and the generic wording are a later record's contract. Until it lands, core's current `InternalError` text under [Failure classes](core.md#failure-classes) stands, and it changes when that contract lands.

## 8. Classify an author fault that reaches a shipped application

Some author faults can still reach an operator: a machine-dependent default its validator rejects at `run()`, an out-of-range exit code on a failure class constructed only on a failure path, two copies of one package, a validator that throws or returns a malformed result, and a plugin loader or `next()` fault.

- A fault the operator can fix becomes an operator message under rules 2 through 6.
- A fault only the author can fix is a defect under rule 7, and its message never advises the operator to change the application.
- A validator that rejects with no issues is a fault the operator can fix, by supplying a different value, so it stays an operator message: `The validator rejected this value without an explanation. Supply a different value.`

Moving a check earlier, so the fault cannot reach a shipped application, is separate work under [ADR-0034](decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md).

## 9. Audit

The audit lists every operator message Loom ships and checks it against rules 2 through 6. Author messages are swept mechanically for rule 2. The Loom-owned operator messages below change. Core's defect lines, the `InternalError` default, the broken `onFailure` hook line, and `Rendering the failure failed`, follow rule 7 and change with the author development view, not in this audit.

| Source                                                      | Current                                                                              | Target                                                                                                           | Rule |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---- |
| `UnknownCommandError`, `NonCallableCommandError` candidates | A deprecated child is listed. For example: `Use one of: get, keys, select, fetch.`                | A deprecated child is left out, as [ADR-0043](decisions/0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) leaves it out of completion. For example: `Use one of: get, keys, select.` | 2 |
| Core, every `UsageError`                                    | The category prefix `Invalid input: ` opens the diagnostic.                          | The application name and a colon open it, `jsonkit: Unknown command "nope". Use one of: get, keys.`, the form docker, heroku, and terraform use, so the operator reads who is speaking and not a parser category. `Invalid declaration: ` stays, because it is an author message. | 2 |
| `UnknownCommandError` with no candidates                    | `Unknown command "nope".`                                                            | `Unknown command "nope". Supply the name of a declared command.`                                                 | 2    |
| `NonCallableCommandError` with no candidates                | `Command "cache" requires a subcommand.`                                             | `Command "cache" requires a subcommand. Supply the name of a declared subcommand.`                               | 2    |
| `NonCallableCommandError` at the root                       | `The root Command requires a subcommand.`                                            | `A command is required. Use one of: get, keys.`, or with no candidates, `A command is required. Supply the name of a declared command.`, so the line reads `jsonkit: A command is required. Use one of: get, keys.` under the prefix row above and names the application once. | 2 |
| Core, a validator that returns no issue                     | `The validator rejected this value without an explanation.`                         | `The validator rejected this value without an explanation. Supply a different value.`                            | 2    |
| Configuration plugin, `--config`                            | `File "<path>" does not exist.`                                                      | `File "<path>" does not exist. Supply the path of an existing file.`                                             | 2    |
| Configuration plugin, `--config`                            | `File "<path>" could not be read.`                                                   | `File "<path>" could not be read. Supply a file this process can read.`                                          | 2    |
| Configuration plugin, `--config`                            | `File "<path>" is not valid JSON.`                                                   | `File "<path>" is not valid JSON. Correct its syntax, or supply another file.`                                   | 2    |
| Configuration plugin, `--config`                            | `File "<path>" does not hold a JSON object.`                                         | `File "<path>" does not hold a JSON object. Write its settings as one JSON object.`                              | 2    |
| Configuration plugin, a discovered file                     | `Skipped <file>: the file is not valid JSON.`, and the two other warnings            | Each warning ends with its fix: `Make it readable, or remove it.`, `Correct its syntax, or remove it.`, or `Write its settings as one JSON object, or remove it.` | 2 |
| Formatter plugin, `json()` and `jsonl()`                    | `The value cannot be encoded as JSON: <engine reason>.`                              | `The value cannot be encoded as JSON. Emit plain JSON data from the action.` The thrown error keeps the engine's error as its `cause`. | 6, 7 |
| Formatter plugin, an `undefined` value                      | `The value cannot be encoded as JSON: the value is undefined.`                       | `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.`            | 2    |
| Manifest plugin, an unencodable input default or schema     | `The manifest cannot encode <detail> as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.` | Unchanged; the sentence is the defect's author detail under rule 7. | 7 |
| `path()` with no `access`                                   | `Expected a path.`                                                                   | `Expected a nonempty path with no NUL character.`                                                                | 2    |
| `text()` with a `pattern` and no `message`                  | `Expected a value that matches the required pattern.`                                | No default. `message` is required beside `pattern`, under [text](validators.md#text).                            | 2    |
| Every rule in the validator catalog                         | The issue carries no code.                                                           | The issue carries its code and parameters under [Issue codes](validators.md#issue-codes).                        | -    |
| Quoted diagnostic text: core's routing token and option spellings, and the configuration plugin's paths | Core's tokens are not escaped (the renderer drops C0 controls, and bidirectional controls pass); `escapeControlCharacters` covers control characters and line separators. | Also the format characters under rule 5.                                                                         | 5    |

The formatter's and the manifest's encode faults are defects under rule 7; their rewritten sentences are the author's detail, and the operator sees the generic message once the author development view lands.

The example applications are audited against rules 2 and 3 too: every `fatal`, `warn`, `FatalError`, and view sentence in jsonkit and textstat gains its fix, and jsonkit's `Cannot parse JSON` and textstat's `Cannot read` keep their runtime reasons under rule 6.
