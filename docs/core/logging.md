---
description: "The log events core publishes from the log member of each context, and the onLog hook through which a plugin observes them."
---

# Logging

This page states the log events core publishes from the `log` member of each context, and the `onLog` hook through which a plugin observes them. An author calls `log` from an action or a middleware, and the [logging plugin](../plugins/logging.md) writes the records.

```ts
interface ActionContext<Args, Options = {}, Result = unknown> {
  readonly log: Log;
  // ...
}
// MiddlewareContext, SourceContext, and FailureHookContext carry the same member.

interface Log {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}
type LogFields = Readonly<Record<string, unknown>>; // any value: the copy turns it into JSON
type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEvent {
  readonly time: string; // ISO 8601 UTC with milliseconds, read at the call
  readonly level: LogLevel; // fatal is core's alone
  readonly message: string;
  readonly fields: Readonly<Record<string, JsonValue>>; // the frozen copy
  readonly application: { readonly name: string; readonly version: string };
  readonly run: string; // 32 lowercase hex characters, one per run
  readonly path: readonly string[];
  readonly plugin: string | null;
  readonly failure?: FailureForm; // core's failure events alone
  readonly defect?: LogDefect; // fatal events alone
}
interface LogDefect {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}
```

```ts
// src/commands/index.ts, a Command whose action records what it did
import { Command } from '@loomcli/core';

import { readTranscripts } from '../transcripts.js';

export const index = new Command('index')
  .argument('harness', { description: 'Name the harness whose transcripts to index.', required: true })
  .action(async ({ args, log }) => {
    const { sessions, skipped } = await readTranscripts(args.harness);
    for (const path of skipped) {
      log.debug('Skipped a transcript with no session id.', { path });
    }
    log.info('Indexed sessions.', { count: sessions.length, harness: args.harness });
  });
```

Core gives author and plugin code a `log` and delivers each call as a frozen log event to every installed plugin's [`onLog`](lifecycle-hooks.md#observing-log-events) hook. Core writes no log record of its own: with no plugin that declares `onLog`, a call does nothing, and the [logging plugin](../plugins/logging.md) is the first-party plugin that writes records. `out` writes for the person at the terminal and `log` records for whoever reads later, and neither routes through the other. [ADR-0069](../decisions/0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md) records the decision.

- **Where.** The action, middleware, [configuration source](input-sources.md), and [`onFailure`](lifecycle-hooks.md#failure-hints) contexts carry `log`, in every run, an action's `invoke` and `app.invoke` included. `onCommandAttach` and `onGraphBuilt` receive none: they run at graph build, under `inspect()` and `check()` as well, where no run exists. Each context's `log` is bound to it: a middleware's, a source's, and an `onFailure` hook's name the plugin core is calling, and an action's names none, a [plugin Command](plugin-contract.md#plugin-commands)'s action included, because nothing records which plugin attached a Command.
- **A call.** `log.info(message, fields)` and its siblings create one event and deliver it to every installed `onLog` before they return. A call returns `undefined`, and a hook's throw never reaches its caller, under [Observing log events](lifecycle-hooks.md#observing-log-events). A message or a field whose value the types reject gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). With no installed plugin that declares `onLog`, core creates no event and reads nothing from the call, `fields` included.
- **The copy.** Core copies `fields` at the call into plain JSON data and freezes the copy, so a later change to the caller's object changes nothing. The copy is the value `JSON.stringify` produces, `toJSON()` included, so a `Date` reads its ISO string, `undefined`, a function, and a symbol are omitted from an object and read `null` inside an array, a number that is not finite reads `null`, and a class instance keeps its own enumerable properties. Three values differ: an `Error` reads `{ name, message, stack, cause }` with whichever of them it holds, its `cause` copied by the same rule; a `bigint` reads its decimal string; and a value that holds itself reads `"[Circular]"` where it repeats. A property whose read throws throws from the call. Omitted fields read `{}`.
- **The event.** `time` is `new Date().toISOString()` at the call. `application` is the graph's `name` and `version`, `0.0.0` when the Application declares none. `run` is 16 random bytes from `crypto.getRandomValues`, written as 32 lowercase hex characters: the same on every event of one run and new for each run, each `invoke` and `app.invoke` included, in the format of an OpenTelemetry trace id. `path` is the path a [failure view](failure-views.md#failure-view-context) reads: `[]` before routing, the partial path before an unknown Command, and the routed Command's path after. `plugin` is the identity of the plugin whose `log` it is, or `null`. The event and everything it holds are frozen.
- **Failure events.** Core logs one event for each failure it reports in a run, the primary failure, each fault reported after the outcome, and a host stream that fails a write (`@loomcli/core/broken-destination`), once translators and `onFailure` hooks have run: `message` is the failure form's `message`, `failure` is the [failure form](failures.md#the-failure-form) the run reports, and `plugin` is `null`. A defect, which is an `InternalError`, a `ResultError`, or a `DeclarationError` met during a run, logs at `fatal` and also carries `defect`, in both builds: the name and message of the value the run caught, read as a [Developer Diagnostic](declaration-faults.md#developer-diagnostics) reads a cause, from an `InternalError`'s `cause` or from the failure itself, and its `stack` as the runtime formats it, absent when the value has none. Every other failure logs at `error`. What the run writes to stderr is unchanged, so a distributed build still prints the generic defect message. A cancelled run that reports its cancellation silently logs no failure event, and a failure a cancelled run still renders logs like any other. A declaration fault raised at graph build logs none, as no hook runs for it. `fatal` is a level core alone logs: `Log` has no `fatal`, because `out.fatal()` throws and ends the run.
- **Shutdown handler failures.** A run-scoped `onShutdown` handler that throws, under [A handler that fails](signals.md#onshutdown), logs one `error` event: `message` is `A shutdown handler failed.`, `fields` holds `error`, the thrown value copied by the rule above, and `plugin` is the identity of the plugin whose middleware registered the handler, or `null` for an action's. Core delivers it to each `onLog` synchronously, as any call does, and the process ends once the shutdown returns. A process-scoped handler's throw is dropped, because no run is there to log it.
- **Names.** `Log`, `LogFields`, `JsonValue`, `LogLevel`, `LogEvent`, and `LogDefect` are exported.

## When author code fails

An `onLog` hook that throws takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Its timing differs: the throw never reaches the caller of `log`, core keeps calling the hook for every later event, and core reports the hook's first throw once, after the outcome, under [Observing log events](lifecycle-hooks.md#observing-log-events). A `log` call an `onLog` hook makes is an ordinary call that delivers its own event to every hook, so a hook that logs on every event recurses until the runtime's stack overflows, and its throw reports as any hook's throw.
