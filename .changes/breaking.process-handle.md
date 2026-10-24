- Remove `RunOptions.host`, the `HostOverrides` type, and `app.invoke`'s `host` option. A run reads every process fact and makes every process effect through one process handle: `run({ process })` and `app.invoke(path, values, { process })` take a `ProcessHandle`, and a run given none binds the real process's handle. See the [host reference](docs/core/host.md#the-process-handle).
- Add `processHandle(fields)`, which builds the real process's handle with each supplied field replacing its whole field, and the types `ProcessHandle`, `ProcessFields`, `ProcessTerminal`, `SignalSource`, `SignalListener`, and `ProcessSignal`. `run()` writes its exit code to the handle's `exitCode`, which `processHandle` writes to `process.exitCode`, and core listens and re-raises on the handle's signal source.
- Add `arch`, `libc`, `uid`, `home`, `tmpdir`, `raise`, and `spawn` to the host. `raise(signal)` raises the signal a key read in raw mode stands for on the run's signal source when stdin is that source's own terminal, and otherwise raises nothing and answers `false`.
- Add `home` and `tmpdir` to the process handle and the host: the operator's home folder and the folder for temporary files. Each follows the handle's absolute `HOME` or `TMPDIR`, a supplied environment's included, and otherwise the user database's home and `/tmp` for the real process; a supplied `home` or `tmpdir` wins. Core copies both at entry, so a `HOME` or `TMPDIR` a `.env` file adds moves neither. See [The home and temporary folders](docs/core/host.md#the-home-and-temporary-folders).
- Add `host.spawn(command, args, options)`, the run's one way to start a child program, with no shell, and the types `SpawnOptions`, `Child`, `ChildExit`, and `ChildOutput`. The child runs in `host.cwd` with `host.env` unless the options name others; `input` or `stdin: 'inherit'` feeds its stdin; each output stream is captured, ignored, inherited from the run's own stream, or piped into a `Writable`; and `detached: true` releases it to outlive the run. `exited` never rejects and answers the exit code, 128 plus the signal's number for a child a signal ended, or that the child could not start. An abort of `signal` ends the child with `SIGTERM`, and `kill(signal)` delivers a signal to it, `SIGKILL` included. Under `app.invoke`, an action's `invoke`, and an MCP tool call, an inherited stream is the call's captured output. See [Child programs](docs/core/host.md#child-programs).
- Change a relative `cwd` given to the process handle to resolve against the process's working directory, so `host.cwd` is absolute.
- Change the background query to raise an interrupt key it read only when stdin is its signal source's own terminal. On any other stdin, Ctrl-C and Ctrl-\ cancel the run with 130 and Ctrl-Z is dropped.

### Migration

**Affected surface.** Code that calls `run({ host })` or `app.invoke(path, values, { host })`, or that imports the `HostOverrides` type from `@loomcli/core`, such as a test or an embedding host that supplies argv, streams, environment, or terminal facts.

**Why.** Host overrides left every fact a caller omitted, and every process effect, on the global `process`. The process handle holds every fact and receives every effect, under [ADR-0107](docs/decisions/0107-a-run-reads-the-process-through-one-process-handle.md).

**Before and after.**

Before:

```ts
import type { HostOverrides } from '@loomcli/core';

const host: HostOverrides = { argv: ['keys', 'user'], stdout: panel };
await jsonkit.run({ host });
const outcome = await jsonkit.invoke(['keys'], values, { host: { cwd: '/srv/doc' } });
```

After:

```ts
import { processHandle } from '@loomcli/core';
import type { ProcessFields } from '@loomcli/core';

const fields: ProcessFields = { argv: ['keys', 'user'], stdout: panel };
await jsonkit.run({ process: processHandle(fields) });
const outcome = await jsonkit.invoke(['keys'], values, {
  process: processHandle({ cwd: '/srv/doc' }),
});
```

**Steps.**

1. Replace each `run({ host: fields })` with `run({ process: processHandle(fields) })`. Where `fields` holds an `env` with no absolute `HOME`, also supply `home`, a temporary folder or `''`, because the handle's home otherwise falls back to the user database's, the operator's real home; a test can use `mockProcess` instead.
2. Replace each `invoke(path, values, { host: fields })` with `invoke(path, values, { process: processHandle(fields) })`.
3. Replace the `HostOverrides` type with `ProcessFields`, and `HostOverrides['terminal']` with `ProcessTerminal`.
4. Where code read a relative `host.cwd` it supplied, read the absolute directory it resolves to.

**Validation.** Run the TypeScript compiler over the application and its tests: no reference to `HostOverrides` or a `host` run option remains. Run the application's tests, which pass with the same results.
