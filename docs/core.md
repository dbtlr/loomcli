---
description: Public SDK, invocation phases, host capture, output, and failure behavior for root commands with local options and passthrough.
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

TypeScript requires one statically known name for each `argument()` and `option()` declaration. Literal-typed constants such as `const name = 'metric'` are valid. Widened `string` types, unions such as `'left' | 'right'`, and open template types are rejected. One declaration creates one handler key, so its type cannot promise several possible keys at once. JavaScript declarations still undergo graph validation during `run()`.

A root Command accepts one required variadic string argument. Bare tokens before `--` retain their order as positional inputs. Local options can appear before, between, or after these inputs. A hyphenated file path uses an explicit relative path such as `./-notes.txt`.

Application methods use the internal Command declaration implementation. Build produces a graph with that root, and routing selects the Command for normal validation and dispatch. There is no separate root action runner.

Graph build rejects duplicate argument names, competing variadic arguments, multiple actions, and a root with no action. Authoring calls collect declarations before this validation. No action runs after a build or input failure.

## Local options

```ts
import { Application } from '@loom/core';

const app = new Application('textstat')
  .argument('files', { required: true, variadic: true })
  .option('metric', { short: 'm', type: 'string' })
  .option('total', { short: 't', type: 'boolean' })
  .action(({ args, options, passthrough, out }) => {
    const metric: string | undefined = options.metric;
    const total: boolean = options.total;
    const files: string[] = args.files;
    const tail: string[] = passthrough;
    return out.print(JSON.stringify({ metric, total, files, tail }));
  });
```

`option(name, config)` declares a local option on the unnamed root Command. The declared name is the key in `options`. Short aliases and negative spellings do not add handler keys. Options and arguments have separate objects, so they can use the same key without collision.

Declarations infer types through fluent calls and `ActionHandler<typeof app>`. The constructor accepts no caller-supplied input types. `StringOption`, `BooleanOption`, and their union `OptionConfig` support extracted configuration with `satisfies`.

The long spelling uses the exact declared name. `dryRun` produces `--dryRun`; `dry-run` produces `--dry-run`. Names are case-sensitive. They cannot be empty, start with a hyphen, or contain whitespace or `=`. A `short` alias is one ASCII letter and is case-sensitive.

`shortOnly: true` requires `short` and suppresses every long spelling. For example, `.option('metric', { short: 'm', shortOnly: true, type: 'string' })` accepts `-m words` and rejects `--metric`.

### String values and token consumption

| Form                                               | Result                        |
| -------------------------------------------------- | ----------------------------- |
| `--metric words`, `--metric=words`, `-m words`     | `options.metric` is `"words"` |
| `--metric=`, `--metric ""`, `-m ""`                | An empty string               |
| No metric option                                   | `undefined`                   |
| `--metric=-value`                                  | The literal string `"-value"` |
| `--metric --total`, `-m --`, `--metric` at the end | Missing-value error           |
| `-mwords`, `-m=words`                              | Invalid attached short value  |

A separately consumed value cannot start with a hyphen. A long assignment can contain any string, including hyphens and additional `=` characters. Short-only string options cannot receive a hyphen-prefixed value in this increment.

The parser preserves empty values. It does not validate string domains or apply declared defaults. Standard Schema validation and declared defaults are outside this increment.

### Short groups

Boolean aliases can form a group. A string alias must be last and consumes the next token. `-tm words` sets `total` to `true` and `metric` to `"words"`. `-mt words` fails because `m` is not last. Attached short values are never inferred from the remainder of a group.

### Boolean polarity

Boolean options accept `polarity: 'positive' | 'both' | 'negative'`. The default polarity is `positive`.

| Polarity for `total`, with alias `t` | Long forms                                         | Short alias        | Absent value |
| ------------------------------------ | -------------------------------------------------- | ------------------ | ------------ |
| `positive`                           | `--total` gives `true`                             | `-t` gives `true`  | `false`      |
| `both`                               | `--total` gives `true`; `--no-total` gives `false` | `-t` gives `true`  | `false`      |
| `negative`                           | `--no-total` gives `false`                         | `-t` gives `false` | `true`       |

`shortOnly` removes long forms for positive or negative polarity. It cannot combine with `both`, because one alias cannot express both polarities. String options cannot declare polarity.

Boolean options consume no value token. Assignments such as `--total=false` and `-t=false` fail. A following bare `false` remains a positional input.

### Declaration and invocation errors

Graph construction rejects duplicate option keys and spelling collisions, including generated negative forms and short aliases. It also rejects invalid names, aliases, types, polarity, and short-only combinations. These errors occur during `run()`, before input parsing or dispatch. Authoring calls capture configuration values, so later changes to the original configuration object do not change the declaration.

Each option can occur only once per invocation. Repetition fails across every accepted spelling, including `--metric words -m bytes`, `--total -t`, `-tt`, and `--total --no-total`. An unknown option, missing value, or invalid token form also prevents dispatch. Diagnostics identify the affected option and give a correction. Declaration errors return code 1; invocation errors return code 2.

### Passthrough

The first bare `--` ends core parsing. Every following token reaches the action in `passthrough: string[]`, with order, values, and token boundaries intact. The delimiter is excluded. Later `--` tokens are ordinary passthrough values.

Passthrough is always available and is empty when no tail exists. It does not satisfy required positional arguments. Core does not parse it as options or arguments, validate it, or transform it. Parsing leaves `host.argv` intact.

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

An action receives `{ args, options, passthrough, out, host }`. Its return value is ignored, including a resolved promise value. `run()` awaits action completion but does not render its return value.

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

An override replaces its whole field. An environment override replaces the captured map. Terminal facts remain independent of stream overrides. Automatic capture maps missing or zero output dimensions to `undefined`. Supplied terminal overrides retain their values.

The environment snapshot is a plain, case-sensitive map on every operating system, including Windows. Keys retain their original spelling; `Path` and `PATH` are distinct lookups. It does not retain the Windows `process.env` object's case-insensitive lookup.

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

If output or diagnostic rendering fails, core attempts one plain stderr fallback and returns code 1. If fallback setup or writing fails, reporting stops. A broken output pipe follows this same failure path and returns code 1.

Schemas, named commands, global options, stdin selection, custom renderers, and plugins are outside this increment.
