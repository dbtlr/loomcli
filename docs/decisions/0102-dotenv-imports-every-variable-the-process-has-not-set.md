---
type: adr
title: ADR-0102 - Dotenv imports every variable the process has not set
description: The dotenv plugin imports every variable its .env file defines that the process has not set, as the dotenv package, Node's --env-file, and Bun do, and an allow list or a deny list narrows the import. The bounded onEnvironment hook, core's ownership of merging and process writes, the file format, and the warning and recovery rules carry forward. It supersedes ADR-0084.
status: proposed
created: 2026-10-20
modified: 2026-10-20
---

# ADR-0102 - Dotenv imports every variable the process has not set

## Context

[ADR-0084](0084-dotenv-prepares-an-allowlisted-environment-before-inputs.md) added the `onEnvironment` hook and the dotenv plugin. The plugin requires a nonempty `variables` list and imports only the names it lists. ADR-0084 rejected importing every name because unrelated tools that share the file could change.

The tools an operator already uses import every name. The `dotenv` package, Node's `--env-file`, and Bun's own `.env` loading each set every variable the file defines and leave a variable the process already holds alone. An operator who writes `DATABASE_URL=…` into `.env` expects the application to read it, and an author who installs `dotenv()` expects it to behave as those tools do. Principle 6 has Loom meet that standard, and principle 3 has it forgive where common tools do.

ADR-0084's concern holds only for a variable the process has not set. An operator's shell or CI value always wins under core's merge, an empty one included, so an import never replaces a value someone set on purpose. A file that holds names an application must not import is a case for narrowing the import, not for requiring a list on every application.

## Decision

- **Every variable by default.** `dotenv()` with no setting imports every variable the `.env` file in `host.cwd` defines that the process has not set.
- **A list narrows the import.** An allow list imports only the names it lists, and a deny list imports every name but the ones it lists. Their setting names, and whether one call may give both, are settled in the plugin's implementing phase.
- **Warnings follow what the plugin would import.** A malformed assignment warns, with its name and starting line, when its leading name is one the plugin would import: every valid name by default, a listed name under an allow list, and an unlisted name under a deny list. An assignment the plugin would not import stays silent and is never mentioned in a warning. Its quoted region is still consumed.

This record supersedes ADR-0084 whole. Every other provision of ADR-0084 is incorporated by reference, with its addenda:

- **Environment preparation.** A plugin definition's `onEnvironment(context)` hook receives the run's read-only `cwd` and `env`, its `warn` call, and its `log`. It returns additions synchronously or asynchronously, after graph build and before any declared default, implied value, routing, or input validation, and never under `inspect()` or `check()`. Core checks cancellation around each hook and sets no time limit on it.
- **Core owns the merge.** A defined own variable always wins, an empty string included. Among hooks the first addition wins, and options read the prepared environment through their existing environment tier.
- **The process copy.** Only an argv `run()` with neither `host.cwd` nor `host.env` overridden copies additions to `process.env`, skipping every variable the process already defines. `app.invoke()` never writes it, and an action's `invoke()` inherits the prepared environment.
- **The hook's failure rules.** They stand as ADR-0084 states them. [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md) and [ADR-0097](0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md) decide, in their implementing phases, what remains of the checks on a hook's answer and of the wrapping of its throw.
- **The plugin.** It reads only `.env` in `host.cwd`, once per outer run, with no custom filename, parent or home search, mode sibling, or layered file. It returns the values it imports, and core alone applies the merge and the process-write rules.
- **The file format and recovery.** They stand as ADR-0084 states them: UTF-8 with an ignored leading byte order mark, CRLF normalized, the assignment, quoting, comment, and duplicate rules, the unterminated-quote rules, silent missing files and `.env` directories, and one warning for any other read error.
- **The color narrowing.** [ADR-0089](0089-an-operators-color-or-no-color-settles-the-runs-color-right-after-host-capture.md)'s narrowing of imported `NO_COLOR` and `FORCE_COLOR` stands.

## Considered options

- **Keep the required allow list.** Rejected. It departs from the tools operators know, and every application pays a list for a case that a deny list covers when it arises.
- **Import every name and override the process.** Rejected, as ADR-0084 rejected it: an operator's shell or CI value, an empty one included, always wins.

## Consequences

`dotenv()` takes no required setting. An application that passes a `variables` list keeps an allow list through whichever setting name the implementing phase gives it, and that phase's fragment states the migration. An application that installs `dotenv()` with no list now imports every name its operators' `.env` files define.

## Status

Proposed. It moves to accepted with the release that ships the import-everything default with its allow and deny lists, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
