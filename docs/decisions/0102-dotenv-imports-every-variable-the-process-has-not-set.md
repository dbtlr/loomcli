---
type: adr
title: ADR-0102 - Dotenv imports every variable the process has not set
description: The dotenv plugin imports every variable its .env file defines that the process has not set, as the dotenv package, Node's --env-file, and Bun do, and an allow list or a deny list narrows the import. The bounded onEnvironment hook, core's ownership of merging and process writes, the file format, and the warning and recovery rules carry forward. It supersedes ADR-0084.
status: accepted
created: 2026-10-20
modified: 2026-10-22
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
- **The hook's failure rules.** A throw takes the ordinary failure path under [ADR-0097](0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md), so a `LoomError` the hook throws keeps its class and exit code in place of the `@loomcli/core/broken-environment-hook` wrap, and any other throw is a foreign throw. No check remains on a hook's answer: core merges the record it returns, whose type bounds it, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md), so ADR-0084's rules that core accepts only plain records of valid variable names and strings without NUL, and validates the whole answer before merging, end. ADR-0084's other failure rules stand.
- **The plugin.** It reads only `.env` in `host.cwd`, once per outer run, with no custom filename, parent or home search, mode sibling, or layered file. It returns the values it imports, and core alone applies the merge and the process-write rules.
- **The file format and recovery.** They stand as ADR-0084 states them: UTF-8 with an ignored leading byte order mark, CRLF normalized, the assignment, quoting, comment, and duplicate rules, the unterminated-quote rules, silent missing files and `.env` directories, and one warning for any other read error.
- **The color narrowing.** [ADR-0089](0089-an-operators-color-or-no-color-settles-the-runs-color-right-after-host-capture.md)'s narrowing of imported `NO_COLOR` and `FORCE_COLOR` stands.

## Considered options

- **Keep the required allow list.** Rejected. It departs from the tools operators know, and every application pays a list for a case that a deny list covers when it arises.
- **Import every name and override the process.** Rejected, as ADR-0084 rejected it: an operator's shell or CI value, an empty one included, always wins.

## Consequences

`dotenv()` takes no required setting. An application that passes a `variables` list keeps an allow list through whichever setting name the implementing phase gives it, and that phase's fragment states the migration. An application that installs `dotenv()` with no list now imports every name its operators' `.env` files define.

## Status

Accepted in 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
- 2026-10-21: The implementing phase of ADR-0097 removes every check on an `onEnvironment` hook's answer, so the hook's failure rules name none.
- 2026-10-21: The implementing phase settles the setting names. `only` is the allow list and `except` is the deny list. The settings type is a union of the two, so one call that gives both is a compile error, with no run-time check. `variables` goes, and its migration is to rename it `only`. A listed name keeps the variable-name grammar, because no assignment could match a name of another form, and the check that the names are distinct goes. A single-quoted value may span physical lines as a double-quoted one does, keeping every character with no escape, as the dotenv package, Node's `--env-file`, and Bun read one, so a multi-line private key is one value. ADR-0084's rule that a single quote ends on its physical line would, under the import-everything default, read each later line of such a key as an assignment, print a fragment as a name in a warning, or import a variable named after one. An unterminated single quote now consumes the rest of the file and warns once for its starting line when its name would be imported, as an unterminated double quote does.
