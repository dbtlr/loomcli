---
type: adr
title: ADR-0084 - Dotenv prepares an allowlisted environment before inputs
description: A bounded onEnvironment hook returns environment additions before declared values and inputs validate. Core merges additions without replacing existing values and writes them to the process only for an argv run with neither cwd nor env overridden.
status: superseded
superseded_by: ADR-0102
created: 2026-10-15
modified: 2026-10-22
---

# ADR-0084 - Dotenv prepares an allowlisted environment before inputs

## Context

A `.env` file must supply both env-bound options and libraries or child processes that read the environment.
An input-source tier would fill only options. Middleware and the configuration source run after declared defaults validate.
Graph hooks receive no host and also run during `inspect()` and `check()`, which must not read `.env`.

`Application.#execute` already joins argv and named runs after host capture and graph build, before `prepareDeclaredValues`.
An action's `invoke()` reuses its parent's graph, declared values, and host fields.
That boundary can prepare one environment without opening the input-source stage or designing the broader lifecycle.

## Decision

### Environment preparation

A plugin definition gains `onEnvironment(context)`. Its context contains:

- `host`: the run's read-only `cwd` and `env`.
- `out`: the run's `warn` call.
- `log`: the logger bound to the plugin's identity.

The hook returns a record of variable names to string values, or nothing, synchronously or asynchronously.
It declares no options, activation, routing, cleanup, or context contributions.
Core calls hooks in installation order after graph build and before any declared default, implied value, routing, or input validation.
Each hook sees the environment including earlier additions.
Neither `inspect()` nor `check()` calls it.
Core checks cancellation before each hook and after awaiting its answer, before merging it.
An already-cancelled run calls no hook. An abort during a hook discards its answer and starts no later hook.
Core awaits started work without interrupting it or imposing a time limit.

Core owns the merge. A defined own variable always wins, including an empty string.
An own property whose value is `undefined` supplies nothing and may be filled, matching process capture and host override conventions.
Among hooks, the first addition wins. The merged snapshot is the environment downstream validators, sources, middleware, actions, and nested invocations read.
The report host and log destination share that map, including when an earlier preparation hook initialized logging.
Log events during preparation see only additions already merged at that moment.
Options still resolve through the existing environment tier, including ordered name lists, with the variable name alone as provenance.
An empty variable still supplies no option value under ADR-0032.

Only an argv `run()` with neither `host.cwd` nor `host.env` overridden copies accepted additions to `process.env`.
Other host overrides do not suppress the copy. Core skips every variable the process already defines, including empty variables.
Supplied-host runs otherwise update only their run snapshot. `app.invoke()` never writes `process.env`.
An action's `invoke()` inherits the prepared environment and calls no preparation hook or file reader again.
Each new outer run prepares its own captured snapshot. Process additions persist after the run, as ordinary environment assignments do.
Core merges and copies each hook's accepted answer before calling the next hook.
A later hook failure does not roll back earlier additions, and a later default or invocation failure does not undo them.
The run snapshot remains case-sensitive on every platform, as ADR-0009 specifies.
On Windows the process lookup is case-insensitive, so an existing differently cased process variable may prevent the copy while the snapshot gains its distinct spelling.

`plugin()` rejects a nonfunction hook at declaration through the existing not-a-function rule.
A throw or malformed return is an `InternalError` with exit code 1 under `@loomcli/core/broken-environment-hook`, before middleware.
The hook is a plugin operation, so its throw is wrapped as its defect rather than offered to application translators.
An option takeover cannot suppress it.
Core accepts only plain records of valid variable names and string values without NUL.
It validates a hook's whole answer before merging any of it and never prints returned values in diagnostics.
The contract adds no timeout or limit on author code.

Host capture still precedes preparation. Captured release facts, time zone, program words, and declared rendering policy overrides do not change retroactively.
Output capability detection reads the current environment at each emission, so imported `NO_COLOR`, `FORCE_COLOR`, and `TERM` affect subsequent output.
Warnings during a hook use the environment before that hook returns its additions.
For example, allowlisting `TZ` can change the process time zone for libraries while `host.timeZone` retains the captured zone for validators.
The hook supplies environment data; general run lifecycle hooks remain deferred.

### Dotenv plugin

`dotenv({ variables: ['DATABASE_URL', 'API_TOKEN'] })` ships from `@loomcli/plugins/dotenv`, without a new dependency.
The factory copies its settings and rejects a missing, non-array, empty, duplicate, or invalid `variables` list at declaration.
Names follow the existing environment grammar, `[A-Za-z_][A-Za-z0-9_]*`, case-sensitively.

The hook reads only `.env` in `host.cwd`, once per outer run.
An `env` override does not disable that read; an isolated fixture supplies its own `cwd` too.
There are no custom filenames, parent or home searches, mode siblings, or layered files.
Unlisted assignments are parsed to respect quoted boundaries but never imported or mentioned in warnings.
The plugin returns allowlisted values. Core alone applies the merge and process-write rules.

### File format

The file is UTF-8. A leading BOM is ignored, and CRLF line endings normalize to LF, including inside multiline values.
Horizontal whitespace means ASCII space or tab. Blank lines and lines beginning with `#` after horizontal whitespace are ignored.
An assignment has optional surrounding horizontal whitespace, an optional `export` followed by horizontal whitespace, a valid name, `=`, and a value.
Horizontal whitespace around `=` is ignored.

- An unquoted value occupies one physical line. Surrounding horizontal whitespace is removed.
  `#` starts a comment at the beginning of the value or after horizontal whitespace. An embedded `#` otherwise stays literal.
  Quotes appearing after the first value character stay literal. There is no unquoted escaping or continuation.
- A single-quoted value occupies one physical line and preserves every character inside its quotes, including backslashes.
  The first following single quote closes it. There is no single-quote escape.
- A double-quoted value may span physical lines. The first unescaped double quote closes it.
  `\n`, `\r`, `\t`, `\"`, and `\\` decode to newline, carriage return, tab, double quote, and backslash.
  Other backslash sequences preserve both characters. A backslash followed by a physical newline preserves both characters.
- After a quoted value, only horizontal whitespace and an optional `#` comment are valid on its closing line.
- NUL is invalid in a value. Empty assignments are valid. `${HOME}` and other substitution syntax stay literal in every quote style.
- For duplicate assignments, the last valid assignment wins within the file. A malformed later assignment never erases an earlier valid one.

These rules use the assignment, whitespace, and `export` conventions documented by
[Node.js](https://nodejs.org/api/environment_variables.html).
Loom specifies its own escape and whitespace-before-comment rules, and only double quotes span lines here.
They do not claim shell evaluation or full compatibility with another dotenv parser.

### Warnings and recovery

A malformed assignment is skipped. It warns only if its leading name, after whitespace and an optional `export`, exactly names an allowlisted variable.
A name must end at whitespace, `=`, or the end of the physical line to count as that variable.
A typo such as `API-TOKEN` does not name `API_TOKEN`.
The warning identifies the declared name and the assignment's starting line, counted from one, but prints no file text or value:

`Skipped API_TOKEN on line 4 of .env: the line is not a valid assignment. Correct the line, or remove it.`

A quoted assignment consumes its entire quoted region, including unlisted assignments.
An unterminated double quote consumes the rest of the file and warns once for its starting line if allowlisted.
An unterminated single quote consumes only its physical line. Parsing then continues at the next physical line.
Trailing text after a closed quoted value invalidates that assignment without consuming subsequent lines.
Every malformed assignment warns at most once per outer run, even when its name already has an environment value.

A normal Node UTF-8 file read follows symbolic links and replaces invalid UTF-8 bytes with replacement characters.
The plugin detects no alternate encoding. `ENOENT`, `ENOTDIR`, and `EISDIR` mean no dotenv file and are silent.
A directory named `.env`, such as a Python virtual environment, contributes nothing and produces no warning.
Any other read error warns once and contributes nothing:

`Skipped .env: the file could not be read. Make it readable, or remove it.`

Neither warning changes the exit code. Warnings use the ordinary output channel in argv runs and captured messages in named runs.

## Alternatives

- A dotenv input-source tier would leave libraries and child processes without the values. The existing tier order stays closed.
- A general `onRunStart` hook would overlap deferred lifecycle design. `onEnvironment` exposes only environment preparation and warnings.
- Direct plugin mutation would duplicate the precedence and process-boundary rules. Returned additions keep both rules in core.
- Importing every name could change unrelated tools that share the file. The explicit allowlist bounds imports and warnings.
- Overriding existing variables would defeat an operator's explicit shell or CI value, including an intentionally empty value.
- Variable expansion, layering, and alternate paths add independent policy and remain outside this contract.

## Consequences

This record narrows ADR-0009's captured snapshot rule for returned environment additions and its process effects for the bounded argv copy.
Its rejection of merging a supplied environment with the process still stands: additions come only from explicitly installed preparation hooks.
It adds one hook to ADR-0028 and specifies that ADR-0032 reads the prepared environment without changing input precedence.
ADR-0059's named-invocation process isolation remains unchanged.
ADR-0063's MCP stderr rule gains dotenv warnings from an installed plugin, alongside its existing log writes and failures.
The hook is additive and follows ADR-0013's installation order.
It narrows that record's blanket hook-composition clause: each hook sees a prepared snapshot and cannot replace earlier additions.
It claims no single-owner slot.
Existing accepted records retain their other rules and carry dated entries referencing this amendment.

The public types are `EnvironmentContext` and `EnvironmentHook`.
The contract and acceptance examples live in [Dotenv](../plugins/dotenv.md).

## Status

Accepted in 0.13.0.

## Changelog

- 2026-10-15: Proposed with the bounded environment preparation hook and dotenv plugin contract.
- 2026-10-19: [ADR-0089](0089-an-operators-color-or-no-color-settles-the-runs-color-right-after-host-capture.md), proposed, narrows the statement that imported `NO_COLOR`, `FORCE_COLOR`, and `TERM` affect subsequent output: once an operator's `--color` or `--no-color` set the run's `color` field, an imported variable no longer turns color on or off, while `FORCE_COLOR` and `TERM` still affect automatic modifiers. Every other rule here stands. It binds when that record is accepted.
- 2026-10-20: [ADR-0102](0102-dotenv-imports-every-variable-the-process-has-not-set.md), proposed, supersedes this record when it is accepted. `dotenv()` imports every variable its file defines that the process has not set, as the `dotenv` package, Node's `--env-file`, and Bun do, and an allow list or a deny list narrows the import, so the required `variables` list and the rejected option of importing every name end. A malformed assignment warns when its name is one the plugin would import. The `onEnvironment` hook, core's merge and process writes, the file format, and the recovery rules carry forward. This record binds as written until then, and its status moves to superseded in an ordinary PR before the release cut that accepts that record, because the release-PR guard admits only acceptances, as ADR-0050's supersession did.
- 2026-10-22: Superseded by [ADR-0102](0102-dotenv-imports-every-variable-the-process-has-not-set.md), which binds when accepted in the 0.15.0 release. `dotenv()` imports every variable the process has not set. The `onEnvironment` hook, core's merge and process writes, the file format, and the recovery rules carry forward, as do its narrowings of ADR-0009, ADR-0013, ADR-0028, ADR-0032, and ADR-0063.
