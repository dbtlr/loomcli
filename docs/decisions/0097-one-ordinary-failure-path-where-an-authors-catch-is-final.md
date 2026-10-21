---
type: adr
title: ADR-0097 - One ordinary failure path, where an author's catch is final
description: When author or plugin code catches a failure and continues, the run's outcome is what that code produces, and Loom adds no rule in either direction. A middleware that catches a held usage fault, an action's failure, or a next() misuse decides the outcome, an action that catches a view's rejection or a second out.results call decides its own, and a throw during unwinding is the middleware's failure like any other. A failure no code caught still fails the run. The fallbacks that keep Loom's own failure output intact stay.
status: proposed
created: 2026-10-20
modified: 2026-10-21
---

# ADR-0097 - One ordinary failure path, where an author's catch is final

## Context

A failure takes one ordinary path. An action's or a middleware's throw leaves the chain, a foreign throw is offered to the translators, `onFailure` hooks add hints, the failure view or a failure encoder writes the report, and `run()` resolves the failure's exit code.

Beside that path, core keeps rules that decide the outcome after the author's code already decided it:

- Under [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md)'s 2026-10-05 failure-precedence entry, core records the held fault the dispatch boundary raises, so a middleware that catches its rejection changes control flow and not the exit code. The core reference applies the same rule to any failure the rest of the chain raised.
- A view failure fails the run even when the action or the middleware caught the rejection.
- A second `next()` call, or one after the middleware settled, rejects and is also reported after the outcome, turning a would-be 0 into 1.
- A second `out.results` call rejects and also turns a would-be 0 into 1.
- A throw during unwinding, after `next()` has settled, is rewritten as an internal error whatever class it carries, and the earlier outcome keeps its code.

Each rule overrides code the author or a plugin wrote on purpose. A middleware that retries an action after a network failure, and whose retry succeeds, still exits 1. Principle 1 says Loom adds no special recovery rule for what an author's code creates, throws, or hands back. JavaScript already says what a caught rejection and a throwing `finally` mean, and an author reads their own code that way.

## Decision

- **An author's catch is final.** When author or plugin code catches a failure and continues, the run's outcome is what that code produces. Loom adds no rule in either direction: it does not record a caught failure to decide the exit code later, and it does not turn a failure that code lets propagate into a success.
- **The outcome is what the chain settles with.** A rejection of the outermost middleware's promise, or of the action's when no middleware wraps it, reports through the ordinary failure path. A fulfilment exits 0 unless a failure no code caught remains.
- **An uncaught failure still fails the run.** Output that an action or a middleware started and never awaited, such as an `out.render` call whose view throws or a row source that throws after the action returned, rejects with no code to catch it. Core reports it through the ordinary failure path after the chain settles, as it does today. A failure that code awaited and caught is final.
- **The middleware chain.**
  - A middleware that catches the held fault the dispatch boundary raises decides the outcome. A middleware that fails before the chain reaches dispatch still reports its failure, and the held fault stays unraised.
  - A middleware that catches the failure the rest of the chain raised and returns decides the outcome. `next()` still resolves `'dispatched'`, `'taken-over'`, or `'cancelled'` as [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) states.
  - A second `next()` call, or one after the middleware settled, still rejects with an internal error and dispatches nothing, because that protects the chain. The rejection is an ordinary failure, and core reports nothing for it after the outcome.
  - A throw during unwinding is that middleware's failure, as a throwing `finally` is in JavaScript, and the chain's outcome is what it settles with. It is offered to translators like any middleware throw.
- **Output and results.**
  - A view failure the action or the middleware catches is final, so the rule that a view failure fails the run even when the code caught the rejection ends.
  - A second `out.results` call still rejects with `ResultError`. An action that catches the rejection decides the outcome.
  - An action that returns without calling `out.results` on a Command that declares a result still fails with `ResultError`, because the result is the Command's promise to every reader of the result. No code caught anything there.
- **Cancellation is the run's state, not a caught failure.** A cancelled run resolves its cancellation code, 130 or 143, even when code catches the cancellation and returns, because under [ADR-0018](0018-one-run-signal-carries-cancellation-and-one-owner-brackets-process-signals.md) the first cause to abort the run signal fixes the reason and the code. An author's catch decides a failure's outcome, not whether the run was cancelled.
- **Fallbacks that keep Loom's output intact stay.** A broken failure view and a broken failure encoder still fall back to the original failure's default text through the plain fallback path and return 1. A broken destination keeps its fallback report. The incomplete-result line still marks a stopped sequence, and cancellation still outranks every failure code. Each protects output Loom writes, not the author's outcome.
- **Broken hooks and translators take the ordinary path.**
  - An `onFailure` hook that throws is one defect reported beside the failure, through the same plain fallback path a broken failure view takes, with exit 1.
  - An `onLog` hook that throws is one defect reported through the ordinary failure path, with exit 1.
  - A translator that throws is reported as a foreign throw from author code, a defect carried by an `InternalError`, through the ordinary failure path with that throw, in place of `@loomcli/core/broken-translator`. Its throw is not offered to translators again, so no translator answers its own failure.
  - An `onEnvironment` hook's throw takes the ordinary failure path: a `LoomError` it throws keeps its class and exit code, in place of the `@loomcli/core/broken-environment-hook` wrap.
  - An `onFailure` hook that throws ends the hooks for that failure: core calls no later hook, no hook's hints reach the report, and the hook's defect is the ordinary `@loomcli/core/foreign-throw` defect carrying its throw, in place of `@loomcli/core/broken-failure-hook`.
  - An `onLog` hook that throws stays installed and receives every later event of the run. Core reports its first throw once, after every other report, as the ordinary `@loomcli/core/foreign-throw` defect, in place of `@loomcli/core/broken-log-hook`, and the run returns 1 outside a cancelled run.
  - Core merges an `onEnvironment` hook's answer as it is, because the hook's type bounds it, and a foreign throw from the hook is the ordinary `@loomcli/core/foreign-throw` defect.
  - An `onGraphBuilt` or `onCommandAttach` hook's throw that is not a `DeclarationError` is a foreign throw from the hook's code, in place of `@loomcli/core/broken-graph-hook` and `@loomcli/core/broken-attach-hook`: `inspect()` and `check()` throw it unchanged, and a run reports it as `@loomcli/core/foreign-throw`. The defect's cause chain names the hook's file and line, so the Developer Diagnostic still shows which plugin's hook threw.

This record replaces ADR-0028's 2026-10-05 failure-precedence entry. That entry's rule that a middleware failing before dispatch reports its failure stands. Its rule that core records a held fault and catching its rejection does not change the exit outcome ends, and so does its rule for failures during unwinding. Its rule for cancellation stands. [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md), [ADR-0023](0023-a-command-declares-its-result-and-core-resolves-its-presentation.md), [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md), [ADR-0046](0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md), [ADR-0049](0049-a-translator-turns-a-foreign-throw-into-a-failure-class.md), [ADR-0060](0060-ongraphbuilt-judges-the-built-graph-and-never-contributes.md), [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md), and [ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) carry dated entries for what changes in each, and [ADR-0102](0102-dotenv-imports-every-variable-the-process-has-not-set.md) carries the `onEnvironment` rule forward from [ADR-0084](0084-dotenv-prepares-an-allowlisted-environment-before-inputs.md).

## Considered options

- **Keep recording a caught failure.** Rejected. It makes a deliberate retry, fallback, or recovery in a middleware or an action impossible to write, and the author reads their own `try` and `catch` as JavaScript defines them.
- **Recover from a broken failure view by rendering nothing.** Rejected. The broken-view fallback is Loom's own output: an operator still reads the failure the run hit.

## Consequences

An application whose code never catches a failure exits as it does today. One that catches a failure on purpose now exits with the outcome its code produced, which can turn a 1 or a 2 into a 0. The implementing phase classifies its fragment, which may be breaking because an exit code changes where code catches deliberately.

## Status

Proposed. It moves to accepted with the release that folds these side paths into the ordinary failure path, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
- 2026-10-21: The implementing phase settles the remaining hook detail: what the other hooks' hints do when one `onFailure` hook throws, whether core calls a throwing `onLog` hook again, which checks remain on an `onEnvironment` hook's answer, and the throws of `onGraphBuilt` and `onCommandAttach`.
