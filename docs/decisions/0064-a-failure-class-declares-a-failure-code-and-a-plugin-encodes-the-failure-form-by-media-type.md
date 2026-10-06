---
type: adr
title: ADR-0064 - A failure class declares a failure code, and a plugin encodes the failure form by media type
description: Every failure class declares a static kebab-case code, read like its exit code, and core's defects read internal in both builds. Core builds one plain-data failure form, { code, exitCode, message, hints }, which invoke's outcome and handler carry and a failure encoder writes. A plugin registers one encoder per media type, and a failed run() whose selected view declares that media type writes the encoder's line to stderr in place of the failure view. The formatter registers application/json and application/jsonl. The manifest's failure entry reads the class's code in place of a hand-written name.
status: proposed
created: 2026-10-06
modified: 2026-10-06
---

# ADR-0064 - A failure class declares a failure code, and a plugin encodes the failure form by media type

## Context

A machine reader can parse a Command's result, because a view declares its media type under [ADR-0061](0061-a-view-declares-its-media-type-and-a-result-publishes-it-by-view-name.md). It cannot parse a failure. `run()` writes a failure to stderr as text through its failure view, `--format json` changes stdout alone, and the only stable fact a script can branch on is the exit code, which many failures share: every usage error exits 2, and every `FatalError` exits 1. An agent driving `textstat --format json` reads a JSON result on success and an English sentence on failure.

Three readers need the same answer. [`invoke`](../core.md#invocation-by-name) hands its caller the failure instance, whose class name does not survive a minifying build. The MCP plugin of [ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) puts `{ exitCode }` in a failed call's `structuredContent` and waits for a stable identity. And a run under `--format json` should write a failure a script can parse.

An earlier milestone left the failure identity out of core because no reader existed with nothing installed, the test [ADR-0019](0019-plugin-facts-are-descriptor-keyed-extension-values-and-core-owns-the-universal-facts.md) applies to a core fact. `invoke`'s outcome is that reader now: it carries the failure with no plugin installed.

The obvious way to write JSON failures is a view override. It does not work. Overrides resolve first-in-wins and none can decline. A formatter override of `LoomError` would capture every failure in text mode too, and an application's own `override(FatalError, …)` would beat the formatter's in JSON mode.

## Decision

- **A failure code on the class.** A failure class declares `static readonly code`, a kebab-case string, read the way [ADR-0045](0045-a-failure-class-declares-its-exit-code.md) reads `exitCode`: from the nearest ancestor that declares one, captured at the class's first construction, with core's classes captured when the package loads. An author class that declares none inherits its parent's code, so a bare `FatalError` subclass reads `fatal`. A code outside the grammar throws a `DeclarationError` under `@loomcli/core/failure-code` at construction, as an undeclarable exit code does.
- **Core's codes are fixed.** Each core class carries one code, such as `unknown-command`, `unknown-option`, and `invalid-input`. `DeclarationError`, `InternalError`, and `ResultError` read `internal` in both builds, so no rule identity and no class name reaches a machine reader.
- **One failure form.** Core builds one plain-data form for a failure: `{ code, exitCode, message, hints }`. `message` is the failure's sentence without the application-name prefix, by build: a distributed defect reads `Something went wrong.`, and no form carries a cause or a stack. `hints` are the `onFailure` lines, in the order the text view receives them. The form has no exit name, because the manifest's `exitCodes` table explains each number, and no per-class data yet, which a later field can add without breaking a reader.
- **The selection reaches the failure contexts.** `FailureViewContext` and `FailureHookContext` gain `view` and `mediaType`, the run's selection when it failed. Neither is the graph, so ADR-0046's rule that a failure view's context carries no graph stands. Both are `undefined` for a build fault, an unknown command, a Command with no result, and a run whose selecting option was itself rejected.
- **A middleware reads its own validated options under a held fault.** The middleware context gains `ownOptions`: each option the middleware's own plugin declared, local options its hook declared included, that validated, whether or not core holds a fault for another input. The formatter reads `--format` there, so a held fault still knows the selection.
- **A failure-encoding stage ahead of view resolution.** A plugin registers a failure encoder for one media type through `encodeFailure(mediaType, encoder)`, listed under its `failureEncoders`, as it lists translations. One media type has one encoder, and a second is a declaration fault. When a failed `run()`'s `mediaType` has an encoder, core writes the encoder's text for the form to stderr, and no failure view resolves. A development build still writes a defect's Developer Diagnostic first. Stdout is untouched.
- **`run()` alone.** `invoke` writes no encoded line: its outcome and its caller's handler carry the form as data, and its `messages` keep the failure view's text, which is what the MCP plugin sends as content.
- **Core owns no JSON.** The formatter registers `application/json` and `application/jsonl`, each writing one line, `{"error":<form>}`, and a newline. [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md) holds: core encodes nothing.
- **The manifest reads the code.** A `manifestCommand` failure entry drops its hand-written `name` and reads the class's `code`, and the rule that one name means one failure is keyed on the code. This is a breaking change for `manifestCommand` values and for the manifest document.
- **MCP carries the form.** A failed call's `structuredContent` is `{ exitCode, failure: <form> }`.

## Considered options

- **A view override for JSON failures.** Rejected. Overrides resolve first-in-wins with no decline, so the formatter's override would capture text mode, and an application's class override would beat it in JSON mode.
- **Core writing JSON failures itself.** Rejected. Core owns no encoding under ADR-0023, and the media types an application serves belong to its plugins.
- **The rule identity as a defect's code.** Rejected. It tells an operator which rule broke, which [ADR-0047](0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md) keeps behind the generic defect message in a distributed build. Every author fault reads `internal`.
- **A hand-written name on each manifest entry.** Rejected now that the class carries its code. Two names for one failure drift, and the code is what `invoke` and the encoded line already report.
- **An exit name in the form, such as `EX_DATAERR`.** Rejected. The manifest's `exitCodes` table explains each number, and a name would be a second spelling of the code.
- **Per-class data in the form.** Deferred. A view already reads a class's facts, and a later field adds them to the form without breaking a reader.
- **Encoding under `invoke` too.** Rejected. A caller of `invoke` receives the form as data, so an encoded line in `messages` would repeat it as text, and MCP content wants the readable report.

## Consequences

A script and an agent branch on a failure's code under `--format json`, and an embedding host reads the same form from `invoke` with no plugin installed. An author who wants a failure told apart declares a code on its class. One who declares none still gets `fatal`, or the code of the class it extends.

A failure under a JSON selection writes one line to stderr, and its operator no longer reads the sentence as prose there. Every other failure, a build fault and an unknown command included, prints its text as before. A held fault on the routed Command's words is text too, because its local options never validate, so the formatter sees no selection.

The manifest document's failure entries change shape, and an author's `manifestCommand` values drop `name`, so the implementation ships a breaking fragment. ADR-0009, ADR-0021, ADR-0023, ADR-0040, ADR-0045, ADR-0046, ADR-0050, ADR-0051, ADR-0059, ADR-0061, and ADR-0063 carry dated entries.

## Status

Proposed 2026-10-06 with the contract in [Failure codes](../core.md#failure-codes), [The failure form](../core.md#the-failure-form), and [Failure encoders](../core.md#failure-encoders). It moves to accepted inside the release PR of the release that ships the implementation: a code on every core class, the form on `invoke`'s outcome and handler, `view` and `mediaType` on both failure contexts, `ownOptions` on the middleware context, the formatter's two encoders, the manifest reading the code, and the acceptance in those sections, under Node and Bun.

## Changelog

- 2026-10-06: Proposed with the contract.
