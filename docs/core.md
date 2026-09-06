---
description: Public SDK, invocation phases, host capture, output, and failure behavior for the first core increment.
---

# Core reference

## Application declarations

`new Application(name)` creates an application with an unnamed root Command. The constructor takes no input type parameter.

```ts
import { Application } from '@loom/core';

const app = new Application('paths')
  .argument('files', { variadic: true, required: true })
  .action(({ args, out }) => out.print(args.files.join('\n')));

await app.run();
```

`argument()` returns a configured application with inferred input types. `action()` registers a handler and returns the application. An extracted handler uses `ActionHandler<typeof app>` and a type-only import of its declaration.

The first increment accepts one required variadic string argument. Bare tokens retain their order. Tokens that start with a hyphen, including `--`, are invalid. A hyphenated file path can use an explicit relative path such as `./-notes.txt`.

Application methods use the internal Command declaration implementation. Build produces a graph with that root, and routing selects the Command for normal validation and dispatch. There is no separate root action runner.

Graph build rejects duplicate argument names, competing variadic arguments, multiple actions, and a root with no action. Authoring calls collect declarations before this validation. No action runs after a build or input failure.

## Invocation

`run(options?)` returns `Promise<ExitCode>` and sets the same `process.exitCode`. It resolves execution failures through the output path.

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| 0    | Successful execution and core output                               |
| 1    | Expected action failure, internal failure, or invalid declarations |
| 2    | Invalid invocation inputs                                          |

Each invocation follows this order:

1. Capture host facts and apply overrides.
2. Build and validate the Command graph.
3. Copy invocation tokens for input processing.
4. Route to the selected Command.
5. Validate its inputs.
6. Await its action.
7. Finish pending core output and set the exit status.

An action receives `{ args, out, host }`. Its return value is ignored, including a resolved promise value. `run()` awaits action completion but does not render its return value.

The application can run again. Each call captures host facts and builds from its declarations. Core does not call `process.exit()`, consume stdin, track unrelated background work, or provide signal and cleanup handlers.

## Host

`run({ host: partialHost })` overrides selected host fields. Omitted fields use process capture at invocation entry, before graph build.

| Field              | Value                                                         |
| ------------------ | ------------------------------------------------------------- |
| `argv`             | Application tokens without the runtime and script prefix      |
| `cwd`              | Working directory                                             |
| `env`              | Map of environment names to strings or `undefined`            |
| `stdin`            | Node `Readable` connection                                    |
| `stdout`, `stderr` | Node `Writable` connections                                   |
| `terminal`         | Each stream's `isTTY` value, plus output `columns` and `rows` |

An override replaces its whole field. An environment override replaces the captured map. Terminal facts remain independent of stream overrides. Missing output dimensions are `undefined`.

Core copies argv, environment values, and terminal facts. It retains the supplied stream connections. Parsing does not modify `host.argv`. Application code owns file access and any stdin reads.

The public declarations include Node stream types. The package supplies their type dependency and an explicit declaration reference.

## Output and failures

| Method                 | Default destination | Return          |
| ---------------------- | ------------------- | --------------- |
| `out.print(message)`   | stdout              | `Promise<void>` |
| `out.info(message)`    | stderr              | `Promise<void>` |
| `out.success(message)` | stderr              | `Promise<void>` |
| `out.warn(message)`    | stderr              | `Promise<void>` |
| `out.error(message)`   | stderr              | `Promise<void>` |
| `out.fatal(message)`   | Failure path        | `never`         |

Messages are strings. The initial renderer appends one newline and preserves all supplied whitespace. Semantic method identity remains distinct inside core.

Nonfatal labels do not change success. Calls can omit `await`; core still accounts for their output and failures before completion. Awaiting a call observes its write completion or rejection. Catching that rejection does not make the invocation successful.

Writes preserve call order within a destination. Separate stdout and stderr captures have no shared observable order. Core does not close host streams.

`out.fatal()` synchronously throws the exported `FatalError` without an eager write. An uncaught `FatalError` prints its message once and returns code 1. A caught fatal error does not itself change success. Other exceptions use an internal-error diagnostic.

If output or diagnostic rendering fails, core attempts one plain stderr fallback and returns code 1. If that write also fails, reporting stops.

Options, schemas, named commands, stdin selection, custom renderers, and plugins are outside this increment.
