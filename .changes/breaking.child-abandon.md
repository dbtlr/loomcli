- Add `Child.abandon()` to release a spawned child's connections so the host can exit while the child runs. Abandoning sends no signal and can settle `exited` with the new `abandoned` kind and the output captured so far.

### Migration

**Affected surface.** The type checker reports reads of `ChildExit.code` or `ChildExit.error` that no longer narrow to one kind, exhaustive switches that omit `abandoned`, and hand-built `ProcessHandle` children without `abandon()`.

**Why.** A caller can stop waiting before the child reports an exit or a failed start.

**Before and after.**

Before, ruling out `unstarted` also narrowed to an exit code:

```ts sketch
const exit = await child.exited;
if (exit.kind === 'unstarted') throw exit.error;
return exit.code;
```

After, handle each kind:

```ts sketch
const exit = await child.exited;
switch (exit.kind) {
  case 'unstarted':
    throw exit.error;
  case 'exited':
    return exit.code;
  case 'abandoned':
    return undefined;
}
```

**Steps.**

1. Narrow on `kind === 'exited'` before reading `code`, and on `kind === 'unstarted'` before reading `error`.
2. Handle `abandoned` in exhaustive switches over `ChildExit.kind`.
3. Implement `abandon()` on children returned by a hand-built `ProcessHandle`. While `exited` is pending, `abandon()` settles it at once and stops waiting for the child: as `{ kind: 'exited', code, stdout, stderr }` when the child's exit has already been reported, and otherwise as `{ kind: 'abandoned', stdout, stderr }`, each with the output captured so far. Once `exited` has settled, it does nothing.

**Validation.** Run the application's type check, such as `tsc --noEmit`: every read of `code` or `error` and every exhaustive `switch` on `kind` compiles. Run the application's test command, such as `pnpm test`, including the tests of code that starts child programs through `host.spawn` or a `mockProcess` script. If your code calls `abandon()`, check that it handles the captured output without expecting an exit code.
