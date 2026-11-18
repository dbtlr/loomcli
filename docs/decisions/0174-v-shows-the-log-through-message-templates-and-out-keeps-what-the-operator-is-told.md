---
type: adr
title: ADR-0174 - -v shows the log through message templates, and out keeps what the operator is told
description: One call per job. Out keeps print, info, success, warn, and error, which tell the operator, and loses debug and trace. Log records, and core shows each log event as a log line on stderr when the run's verbosity asks for it, debug and above at -v and trace too at -vv, with or without an onLog hook, never a failure event, through the declared view @loomcli/core/log/line. A message is a Message Template from messagetemplates.org, whose {name} placeholders the line fills from the event's fields, trailing the rest as dim name=value, every value escaped, while the record keeps the template as written. A log call creates its event when a hook hears it or the verbosity shows it. Log lines follow the outermost run's verbosity. A log destination's out becomes log, whose events reach every other hook and never the hook itself, so the logging plugin's lines do not recurse. The first-party plugins' -v and -vv lines and core's dropped-fill line move onto log.debug and log.trace with constant templates. It supersedes ADR-0090's debug and trace lanes and its rule that verbose output renders no log event, ADR-0165's lanes and the out members it added, ADR-0069's rule that core creates no event without an onLog hook where the verbosity shows one, and ADR-0070's rejection of a readable console line.
status: proposed
created: 2026-11-17
modified: 2026-11-18
---

# ADR-0174 - -v shows the log through message templates, and out keeps what the operator is told

## Context

Loom has two ways to say a thing an operator sees only at `-v`. [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md) gave `out` a `debug` and a `trace` lane, and [ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) gave every context a `log` with `debug` and `trace` levels. An author who wants to say "read the configuration from this file" picks one, and the other misses it: an `out.debug` line never reaches a log file, and a `log.debug` event never reaches the screen. [ADR-0165](0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) then wrote the first-party plugins' `-v` lines through `out` and their change events through `log`, and gave three more contexts `out.debug` and `out.trace` to do it.

The owner ruled on 2026-11-17 (LM-372, LM-542) that the duplication is confusing, after a survey of cargo, uv, oclif, pip, consola, Charm log, npm's proc-log, cleo, and gh. The ruling takes uv's model: `out` tells the operator, `log` records, and `-v` lets the operator read the log as it is made. With no flag no log event shows; `-v` shows `debug` and above, `-vv` adds `trace`, and `-q` shows none; a failure event never shows, because core already rendered the failure. A `-v` line fills the message's Message Template placeholders from its fields and trails the rest as dim `key=value`, every value escaped, and the record keeps the template as written, with no rendered copy. A later task declares redaction once on the Application and applies it at core's copy of the fields, so the line must render from the same copy every `onLog` hook receives.

## Decision

### One call per job

- **Out tells the operator.** `Out` keeps `print`, `info`, `success`, `warn`, and `error`, the five semantic methods, and loses `debug` and `trace`. `lanes` holds five lane views, and `Lane` names five. Every context that carried `out.debug` and `out.trace`, an `onEnvironment` hook's `out`, a log destination's `out`, the self-update plugin's `AfterReplaceContext`, and the refresh plugins' `RefreshContext`, loses them: the environment hook's `out` holds `warn` alone, the destination's `out` becomes `log`, and both refresh contexts lose `out`, because each already carries `log`.
- **Log records.** `log` keeps its five levels and its event, and the event's bytes under [ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md) are unchanged. Detail an operator reads only when they ask for it is logged.

### What -v shows

- **The verbosity decides.** At verbosity 1 core shows each log event at `debug`, `info`, `warn`, and `error` as one log line on stderr, and at verbosity 2 it adds `trace`. At 0 and -1 it shows none. A failure event, which carries `failure`, never shows, and neither does a `fatal` event, which only a failure carries.
- **With or without a hook.** Core shows the line whether or not an `onLog` hook is installed. A `log` call creates its event when a hook hears it or the verbosity shows its level, and otherwise creates none and reads nothing from the call, as before.
- **Before the hooks.** Core shows the line, then hands the same frozen event to each hook in installation order, inside the call. The line reads the copied fields every hook reads, so a redaction applied at the copy reaches the line too.
- **The outermost run.** A log line follows the outermost run's verbosity and goes to its stderr, in call order among its other writes, above any open live region. Under an action's `invoke`, an MCP tool call included, the line follows the parent run and never enters the call's `messages`; under `app.invoke`, its own outermost run, the line lands in `messages` when the call's values ask for it.
- **A view that throws.** A replaced log-line view that throws never reaches the `log` call, which returns `undefined`. Core hands the write as an output call no code observes, so the throw takes the ordinary failure path once the chain settles, and a stream that refuses the write is a broken destination.

### Message templates

- **The standard.** A log message is a [Message Template](https://messagetemplates.org), as Serilog reads one. `{name}`, where the name is ASCII letters, digits, and underscores, fills from the field of that name: a string as written, and any other value as its JSON text. `{{` and `}}` write one brace. Any other brace is written as it stands, and so is a placeholder whose field the event does not hold, as Serilog renders a missing property.
- **What core reads.** Core fills named placeholders alone. The standard's `@` and `$` operators and its format and alignment parts are not placeholders to core, so their braces are written as they stand; a later record may read them.
- **The record keeps the template.** The event's `message` is the text as written, and core stores no filled copy, so a reader searches the constant message and fills it from `fields`.

### The log line

- **The view.** Core declares `logLine`, `@loomcli/core/log/line`, a `DeclaredView<LogLine>` an application replaces through `views` and a theme restyles through its tokens. `LogLine` holds `level`, `text`, the message filled, `fields`, the fields the message does not place in the event's order as `{ name, value }`, and `event`, the frozen event. Core adds one line break after the view's text unless it ends with one, and writes nothing for the empty string, so an override can drop a line.
- **The text.** A trailing field shows as `name=value`: a string as written, or as its JSON text when it is empty or holds whitespace, a double quote, or an equals sign, and any other value as its JSON text. Every character of the message, each name, and each value passes through `escapeControlCharacters` and then `style.escape`, and each placed value without whitespace and each `name=value` pair is kept on one row with `nowrap`; placed sentences wrap under the gutter.
- **The look.** A `debug`, `info`, `warn`, or `error` line opens with `glyph.pointerSmall` in its level's style, `dim`, `info`, `warning`, or `error`, keeps its text in the terminal's own style, and dims its trailing fields. A `trace` line nests two spaces deeper under `glyph.lineVerticalDashed0` and fades whole, `dim.faint`. A long line wraps under its gutter as a lane does. Off a terminal, a debug line reads as ADR-0090's did, `› Read configuration from .notes.json.`, and a trace line `  ┆ Looked for notes.json: not found.`.

An Error-shaped field shows only its name and message, escaped onto one line, whether placed or trailing; it never shows its stack or cause. The record keeps the full copy. This narrows ADR-0047's No leaks clause: log lines are the record the operator asked for at `-v`.

### A hook's own log

- **The destination's `log`.** `LogDestination` loses `out` and gains `log`, bound to the identity of the plugin whose hook receives it. An event it records shows as a log line at the outermost run's verbosity and reaches every other installed hook before the call returns, and it never reaches the hook whose destination it is. Each hook receives one destination object for the outermost run and every run nested in it, as before, so a hook keys what it remembers about a run by its destination.
- **The logging plugin.** The plugin logs `Logging to {path}.` at `debug` and `Rotated {path}.` at `trace` through the destination's `log`, so the lines reach the screen and any other recording plugin, and never its own file, and a line about a record never leads to another record.
- **Recursion elsewhere.** A `log` captured from another context still delivers to every hook, so a hook that logs through it on every event, and two hooks that each log on every event the other raises, recurse until the stack overflows, as ADR-0069 states.

### The first-party lines

- **Onto `log`.** Every first-party `-v` and `-vv` line under ADR-0165 moves to `log.debug` or `log.trace`, and core's line for a dropped configuration fill under [ADR-0117](0117-a-configuration-value-its-validator-rejects-falls-back-and-validates-against-its-files-directory.md) moves to `log.debug`. Each message is a constant template worded in its package's `messages.ts` under [ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md), with the values it shows in fields, so each line reads at `-v` as the plugin's page shows it and the record keeps the template. A line that says what one of the plugin's change events already says for the same act is removed rather than moved, because `-v` now shows that change event: `Replaced {path}.`, `Ran {call}.` for a service manager call that changes something, `Refreshed completion after the update.`, `Refreshed the man pages after the update.`, and `Refreshed the skills after the update.`. A `Ran` line for a read or a refused call stays, because no change event records it. Each surface logs through the `log` it already receives: a source, a provider, an `onEnvironment` hook, a middleware, an action, the `afterReplace` context, and the destination.
- **Change events show.** A change event is an `info` event, so `-v` shows it as a log line beside the plugin's own lines.

## Considered options

- **One stream, as pip and consola run it.** Rejected. `out.info`, `warn`, and `error` would become log events, which reworks core's whole message model, and an operator message and a record have different readers.
- **Keeping both, renamed.** Rejected. Two calls for one job is the confusion the ruling ends.
- **A rendered copy of the message in the record.** Rejected. The record keeps the template so a reader searches a constant message, as Serilog's records do.
- **A placeholder whose field is absent reads empty, or throws.** Rejected. Writing it as it stands is what the standard's libraries do, and a log call never throws to its caller.
- **Quoting a placed string, as Serilog's text rendering does.** Rejected. The first-party lines read as sentences, `Read configuration from .notes.json.`, and a trailing field quotes what a reader could misparse.
- **Reusing `lanes.debug` and `lanes.trace` for the line.** Rejected. A log line carries a level, a template, and fields, which a view over one string cannot read, and one view over the line lets an application restyle every level in one place.
- **The logging plugin skipping events its own plugin logged.** Rejected. A plugin with a middleware and a hook could no longer record its middleware's events; excluding only the hook whose destination logged keeps every other record.

## Consequences

`Out` loses `debug` and `trace`, `Lane` and `lanes` lose them, `LogDestination` swaps `out` for `log`, `EnvironmentContext['out']` narrows to `warn`, and `AfterReplaceContext` and `RefreshContext` lose `out`, which ADR-0165 added and 0.19.0 shipped. Core exports `logLine`, `LogLine`, `LogLineField`, and `LogLineLevel`. `@loomcli/testing`'s `logDestination` fills `log` with levels that do nothing, and its `environmentContext` and every builder's `out` drop `debug` and `trace`. Each removal is breaking: an author's `out.debug(x)` becomes `log.debug(x)`, and the type checker reports each site.

At run time, an application with the verbose mark shows its own `log` events at `-v`, which it did not before, and the first-party plugins' change events show at `-v` beside their lines. An action's `invoke` and an MCP tool call no longer show plugin lines in their own run; the lines follow the parent run. Every byte at the default verbosity is unchanged.

It narrows ADR-0047's No leaks clause for log lines, the record the operator asked for at `-v`: an Error-shaped field shows only its escaped name and message, never its stack or cause.

This supersedes, by name: [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md)'s Two lanes clause and its rule that "verbose output is not logging, and it never renders a log event", its The lines clause, which the log line replaces, its Every writer clause's `out` members, and its rejection of verbose output rendering log events; [ADR-0165](0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md)'s The lanes clause, its Where a line is written table, the `debug` and `trace` it adds to an `onEnvironment` hook's `out`, the `out` it adds to `LogDestination`, `AfterReplaceContext`, and `RefreshContext`, its rule that the logging plugin records no log event of its own, and its rejection of leaving the lines to `log`; [ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md)'s rule that with no installed `onLog` core creates no event, where the verbosity shows one, and its Records, not renders clause, so far as core now shows events as log lines, while `out` still never routes through `log`; and [ADR-0070](0070-the-logging-plugin-writes-one-json-record-per-event-to-a-size-rotated-file-or-stderr.md)'s rejection of a readable console line, which core's log line now is, while the plugin's console destination stays JSON lines. It narrows [ADR-0008](0008-rendered-output-is-a-neutral-call.md)'s semantic methods back to five and [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md)'s lane views to five, beside one declared log-line view. It replaces the `out.debug` lines of ADR-0117, ADR-0118, and ADR-0154 with `log.debug`, extends ADR-0164's gathering rule to log-line templates in place of `out.debug` and `out.trace` sentences, and widens ADR-0063's stderr rule to include core's log lines at `mcp -v`, every tool call's events included. ADR-0008, ADR-0021, ADR-0047, ADR-0063, ADR-0069, ADR-0070, ADR-0076, ADR-0079, ADR-0090, ADR-0101, ADR-0117, ADR-0118, ADR-0154, ADR-0164, and ADR-0165 carry dated entries.

The glossary rewrites Verbosity, Semantic output, Lane view, Log, Log destination, and Log record, and gains Message template and Log line.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-17: Proposed with the contract and the implementation (LM-372). The builder settled what the task left open: the view `@loomcli/core/log/line` and its look, a new view rather than `lanes.debug` and `lanes.trace`, the destination's `log` that skips its own hook, `out` removed from the destination, and a placeholder whose field is absent written as it stands.
- 2026-11-18: [ADR-0176](0176-a-log-binds-fields-with-with-and-an-application-redacts-field-paths-from-every-log-event-at-the-copy.md), proposed, applies the redaction this record's context names: the Application declares `log: { redact }`, core writes `"[Redacted]"` for each listed path when it copies the fields, and the log line reads that copy, a placeholder included. A field `log.with` binds fills a placeholder and trails as a call's field does. It binds when that record is accepted.
