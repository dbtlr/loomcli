---
type: adr
title: ADR-0109 - A test scripts keys on the mock's keyboard and measures and validates with core's own functions
description: mockProcess gains terminal.keys, a keyboard that hands one scripted entry each time a reader switches stdin to raw mode, raises interrupt keys on the mock's own signal source, answers the background query as a terminal that reports no background, and fails the run with a sentence when it runs out. Core exports width, which measures written text with the measure core renders with, and validationOptions, which builds a default or invocation validation context over a process handle so a validator is tested with no Application.
status: accepted
created: 2026-10-25
modified: 2026-10-27
---

# ADR-0109 - A test scripts keys on the mock's keyboard and measures and validates with core's own functions

## Context

[ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) gave a test a sealed process handle, `mockProcess`, whose stdin is piped text that is never a terminal. A question therefore cannot be answered in a test's own process: Loom's prompts, draw, and interaction fixtures each hand-write a stdin that accepts raw mode, start the application as a child process, and push keys once stderr shows the question's prompt, which waits on printed text. A run whose stdin is not its signal source's own terminal raises no signal for Ctrl-C, so the 130 path of a question cannot be tested in-process at all.

A test that checks a render fits the screen reads the bytes the run wrote, and core publishes no measure for them: the view context's `width` reads marked text inside a view. A test that measures with another library can disagree with core over grapheme clusters, wide characters, and emoji.

A validator that reads its validation context, such as `path()` reading the working directory or `dateTime()` the time zone, cannot be tested alone, because `validationContext()` answers only for contexts core produced, and the only public builder is the question phase's. Loom's own validator tests start a whole application as a child process to exercise one validator.

## Decision

- **The keyboard.** `mockProcess`'s `terminal.keys` puts stdin on the mock's terminal as its keyboard: stdin is a terminal, accepts raw mode, and is the mock's signal source's own terminal. `keys: []` is a keyboard with nothing typed. The types make `keys` and piped `stdin` exclusive. The mock's `stdin.isRaw` reads whether a reader holds it in raw mode.
- **One entry per raw-mode switch.** The keyboard hands over its next entry each time a reader other than core's background query switches stdin to raw mode: when a question opens, and when a run resumes after Ctrl-Z, because the resume enters raw mode again. An entry holds every key typed while one reader holds the keyboard, an answer a question rejects and the one after it included. Nothing is handed on a timer or in answer to printed text.
- **Interrupt keys raise on the mock.** Because the keyboard is the mock's signal source's own terminal, `host.raise` raises a scripted `Ctrl-C`, `Ctrl-\`, or `Ctrl-Z` on the mock's signal source, so a scripted Ctrl-C starts the run's shutdown and the run resolves 130, as at a real terminal.
- **The background query.** A keyboard mock answers core's background query at once with the DA1 reply alone, as a terminal that reports no background, so the query has no answer and settlement continues at `COLORFGBG`, no entry is used, and nothing waits on the query's deadline. A test that wants a background states it.
- **Running out of keys.** A switch to raw mode with no entry left fails the keyboard with `mockProcess has no keys left for this read. Add an entry to terminal.keys.`: once the switch returns, stdin emits it as an `error`, so the reader's pending read rejects with it, whether the switch opens a question or resumes one after Ctrl-Z, whose handler's throw core would only log. The run fails through the ordinary failure path, as a child program with no script does.
- **`width(text)`.** `@loomcli/core` exports `width`, which counts the columns of written text: it skips every terminal control sequence, emulates no cursor movement, and counts what remains as the view context's `width` does, with the same grapheme widths, tab stops, and widest-line rule. It reads no marked-string frame.
- **`validationOptions(process, context)`.** `@loomcli/core` exports `validationOptions`, which returns the Standard Schema options a run passes to a validator in the `default` or `invocation` phase, with a host captured from the handle as a run captures it at entry, and `[]`, `[]`, and an empty supplied record for an `invocation` context's omitted `command`, `passthrough`, and `supplied`. `validationContext()` recognizes the context it builds.

The rules are stated in the [testing reference](../libs/testing.md#mockprocess), [Measuring written text](../core/styles.md#measuring-written-text), and [Validation options outside a run](../core/validation.md#validation-options-outside-a-run).

## Considered options

- **Hand keys over when a reader waits with no key queued.** Rejected. The prompts reader keeps stdin flowing while a question holds it, so Ctrl-C acts at once during an asynchronous validator, and a stdin cannot see when a read waits. Telling it would need one core keyboard that reports its waits, which is a test seam in the product.
- **Hand every entry over at once, as typeahead.** Rejected. A raised interrupt drops the keys still unread, so a scripted Ctrl-C would drop answers scripted before it, and "Ctrl-C at the second question" would not be deterministic.
- **Fail the test, not the run, when the keys run out, by throwing from the mock's recordings once a gap occurred.** Rejected. A getter that throws is a new rule for a test to learn, and the mock's unscripted-program rule already fails the run with a sentence.
- **Require a stated background beside `keys`.** Rejected. Most keyboard tests never reach the query, and an interaction test does not need colors.
- **A testing subpath with its own `plain` and `width`.** Rejected. Stripping styles is the runtime's `stripVTControlCharacters`, and a second width would be a second measure; core's own is the one that matches what it renders.
- **A builder for a Command's whole input stage, argv to values or issues with no action.** Rejected for this record. A run on a mock already reaches it, and building contexts outside a run belongs with the action and middleware test scopes.

## Consequences

Loom's prompts, draw, and interaction fixtures move in-process onto the keyboard, and its validator fixtures onto `validationOptions`, so their hand-written keyboards and fixture applications go. A real terminal, a pseudo-terminal, and a real signal stay what a process test proves, under [ADR-0103](0103-process-acceptance-comes-from-looms-own-pipeline-and-the-packed-consumer.md). The `@loomcli/validators/context-outside-run` explanation names `validationOptions` as the way a test supplies a context. `MockFields` becomes a union type, so code that extends it as an interface changes to an intersection; `MockTerminal` keeps its members, and the keyboard's `keys` belongs to `MockFields`'s keyboard branch. ADR-0107 carries a dated entry.

## Status

Accepted in 0.16.0.

## Changelog

- 2026-10-25: Proposed. ADR-0107 carries a dated entry.
- 2026-10-25: Amended before release. Running out of keys fails the keyboard through a stdin `error` emitted once the switch returns, for an opening question and a resume alike, because at the switch the keyboard cannot yet tell a question's hold from the background query's, which writes its query after switching. What a test sees is unchanged.
