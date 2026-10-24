- Remove `RunOptions.host`, the `HostOverrides` type, and `app.invoke`'s `host` option. A run reads every process fact and makes every process effect through one process handle: `run({ process })` and `app.invoke(path, values, { process })` take a `ProcessHandle`, and a run given none binds the real process's handle. See the [host reference](docs/core/host.md#the-process-handle).
- Add `processHandle(fields)`, which builds the real process's handle with each supplied field replacing its whole field, and the types `ProcessHandle`, `ProcessFields`, `ProcessTerminal`, `SignalSource`, `SignalListener`, and `ProcessSignal`. `run()` writes its exit code to the handle's `exitCode`, which `processHandle` writes to `process.exitCode`, and core listens and re-raises on the handle's signal source.
- Add `arch`, `libc`, `uid`, and `raise` to the host. `raise(signal)` raises the signal a key read in raw mode stands for on the run's signal source when stdin is that source's own terminal, and otherwise raises nothing and answers `false`.
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

1. Replace each `run({ host: fields })` with `run({ process: processHandle(fields) })`.
2. Replace each `invoke(path, values, { host: fields })` with `invoke(path, values, { process: processHandle(fields) })`.
3. Replace the `HostOverrides` type with `ProcessFields`, and `HostOverrides['terminal']` with `ProcessTerminal`.
4. Where code read a relative `host.cwd` it supplied, read the absolute directory it resolves to.

**Validation.** Run the TypeScript compiler over the application and its tests: no reference to `HostOverrides` or a `host` run option remains. Run the application's tests, which pass with the same results.
