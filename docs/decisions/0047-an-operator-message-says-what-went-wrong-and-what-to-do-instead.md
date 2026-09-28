---
type: adr
title: ADR-0047 - An operator message says what went wrong and what to do instead
description: Every operator message Loom ships names what went wrong and says what to do instead, leaves plugin-dependent pointers to hint lines, repeats no value it cannot vouch for, escapes what it repeats, bidirectional controls included, and quotes no text Loom did not write. A defect shows the operator one generic message, and an author fault that reaches a shipped application is classified as an operator message or a defect.
status: proposed
created: 2026-09-28
modified: 2026-09-28
---

# ADR-0047 - An operator message says what went wrong and what to do instead

## Context

Most failure messages Loom ships already name what went wrong and say what to do instead: `Option "-f" can be supplied only once. Remove the repeated option.` Nothing states the rule, so the messages drift. The configuration plugin's `File "settings.json" is not valid JSON.` gives no next step, `Unknown command "nope".` loses its fix when a parent offers no candidates, and the formatter's `The value cannot be encoded as JSON: <reason>` prints whatever reason the JavaScript engine gave.

Two readers see these messages. The author sees a declaration fault while developing, under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md). The operator runs the shipped application and cannot change its code. Some author faults still reach the operator: a default its validator rejects on the operator's machine, an out-of-range exit code on a failure class constructed only on a failure path, two copies of one package, and a plugin loader or `next()` fault. Today these print the author's diagnostic, which advises the operator to change code they do not own.

Some advice depends on what is installed. [ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) gives plugins hint lines for it, so core's sentence does not have to guess whether `--help` or an `--explain` option exists.

A message can also carry text that works against the operator. A repeated value can be a secret. A repeated path can hold bidirectional controls that reorder the rest of the line on a terminal. A thrown cause can hold paths and values the operator never supplied, and it differs between Node.js and Bun.

## Decision

The rules are stated, with examples and the audit of the messages they change, in [Failure messages](../failure-messages.md).

- **Two audiences.** An operator message is any message that runs after the application is built and shipped. An author message runs while the author develops: a declaration or build fault under ADR-0034. An author message never prints on a shipped application.
- **Two parts.** Every operator message Loom ships, from core, `@loomcli/plugins`, and `@loomcli/validators`, names what went wrong, with the specific input, file, position, or path, and says what to do instead, as an action or as what is accepted. For a rejected value the catalog's `Expected ...` sentence is the second part, because core prefixes the input's name.
- **Pointers are hints.** A pointer that depends on which plugins are installed, such as help, an explain option, or a suggestion, arrives only as an `onFailure` hint line, never in core's sentence. An application's own message may name its own Commands.
- **Repeating a value.** Core and the validator catalog never repeat an input's value, because they cannot know it is not a secret, and describe what is accepted instead. A plugin or an application may repeat a value of an input it owns when it knows the value is not a secret, such as a `--config` file path or a document path.
- **Escaping.** Everything a message repeats is escaped. Escaping for quoted diagnostic text also covers the bidirectional controls U+202A through U+202E and U+2066 through U+2069 and the marks U+200E, U+200F, and U+061C, through the public `escapeControlCharacters` and wherever a Loom failure message quotes raw text. Results output is untouched, and other format characters, such as a zero-width joiner or a soft hyphen, stay.
- **No leaks.** An operator message Loom ships never includes text Loom did not write: a thrown cause, an engine or Node.js reason, or a stack. The rule binds core, the plugins, and the catalog. An application owns its domain and decides for itself.
- **Defects.** A defect is a failure only the author can fix. The operator sees one generic, friendly message with no reason, class name, or code detail, and the run exits 1. An author replaces it with `override(InternalError, view)` and adds a pointer through an `onFailure` hint. The author sees the detail in a separate author development view, whose contract, including how a run knows it is in development and the generic wording, is a later record's.
- **Leaked author faults.** An author fault that reaches a shipped application is classified: one the operator can fix becomes an operator message, and one only the author can fix is a defect. Moving a check earlier is separate work.

## Considered options

- **A lint or a runtime check on message text.** Rejected. No check can tell whether a sentence states a fix, and an application's messages are its own. The rule binds what Loom ships, and the examples model it for authors.
- **Advice in core's sentence, such as `Run with --help.`** Rejected. Core cannot know the help plugin is installed, and a pointer to an absent option is a wrong fix. Hints carry advice that depends on installation.
- **Repeat the rejected value, as many CLIs do.** Rejected for core and the catalog. A value can be a secret, and core cannot tell which inputs hold one. The owner of an input knows, so a plugin or an application may.
- **Pass an engine's reason through.** Rejected for Loom's own messages. The reason changes between runtimes and versions, can hold data the operator never supplied, and gives no step to take. An application may still pass a parser's reason when it locates the fault in the operator's own document.
- **Show a defect's detail to the operator.** Rejected. The operator cannot act on a stack or a class name, and the detail can expose the application's internals. The author needs it, so it moves to the author's development view.
- **Escape every format character.** Rejected. A zero-width joiner inside an emoji and a soft hyphen are ordinary text, and escaping them garbles names an operator typed.

## Consequences

The configuration plugin's four `--config` sentences and its warnings gain a next step, core's routing errors keep a fix with no candidates and stop listing a deprecated Command, the formatter drops the engine's reason, and the catalog's vague `path()` sentence and `text()` default pattern sentence go. A text change is not breaking, so these land as ordinary change fragments. The `text()` change is breaking under [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md), because it makes `message` required.

`escapeControlCharacters` escapes more characters, so a diagnostic that quotes a path with a right-to-left mark shows the mark's escape instead of reordering the line.

Core's `InternalError` default text keeps its current form until the author development view lands, and then becomes the generic defect message. [ADR-0007](0007-failures-are-public-classes-with-class-keyed-renderers.md) and [ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) carry dated entries.

## Status

Proposed 2026-09-28. It moves to accepted when the audited messages in [Failure messages](../failure-messages.md#9-audit) ship with the rewritten text, `escapeControlCharacters` escapes the listed format characters, and core's routing candidates leave out deprecated Commands, under Node.js and Bun.

## Changelog

- 2026-09-28: Proposed with the failure message rules.
