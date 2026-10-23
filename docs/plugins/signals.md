---
description: "The signals plugin: which process signals cancel a run cooperatively instead of ending the process at once."
---

# Signals plugin

This page documents the signals plugin, which makes chosen process signals cancel the run and let it unwind, instead of ending the process at once. [Signals, cancellation, and cleanup](../core/signals.md) states the core rules it claims a policy under.

```ts
// @loomcli/plugins/signals
import type { CooperativeSignal, Plugin } from '@loomcli/core';

export interface SignalsSettings {
  /** The signals that cancel the run cooperatively. Defaults to SIGINT, SIGTERM, and SIGHUP. */
  readonly cooperative?: readonly CooperativeSignal[];
}
export declare function signals(settings?: SignalsSettings): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';
import { signals } from '@loomcli/plugins/signals';

export const notes = new Application('notes', {
  description: 'Keep notes in sync.',
  plugins: [signals({ cooperative: ['SIGTERM'] }), service({ label: 'com.acme.notes', run: ['serve'] })],
});
```

`signals(settings?)` claims the [signals slot](../core/signals.md#the-cooperative-claim) with the `cooperative` list, so each listed signal cancels the run, and the process stays up while the action and the middleware unwind on their own terms. Core awaits the run's cleanups, renders any failure report, resolves the signal's code, and the process then ends by the signal. A signal the list leaves out takes the immediate path, as it does with no plugin installed: core calls every cleanup synchronously and ends the process at once.

- **The default.** With no settings, the plugin lists `SIGINT`, `SIGTERM`, and `SIGHUP`, so every signal that can cooperate does.
- **`SIGQUIT`.** It is never cooperative, and the type excludes it, because Ctrl-\\ asks for an immediate end with a core dump.
- **Pressing again.** A second signal finds the run already cancelled, so it takes the immediate path. Pressing Ctrl-C twice always ends the process at once, with the terminal restored.
- **A listener outside core.** While a raw `process.on` listener for a signal is installed, core does not re-raise that signal, so that listener decides whether the process ends, and a `SIGQUIT` it absorbs leaves no core dump, under [Listening](../core/signals.md#listening).
- **What it adds.** The plugin claims the slot and nothing else: no option, no middleware, no Command, no view, and no hook.
- **One claim.** Another plugin that claims the signals slot beside it is a declaration error from the Application constructor naming both: [`@loomcli/core/slot-taken`](../core/diagnostics.md#loomclicoreslot-taken). An empty `cooperative` list claims nothing and leaves the slot free.
- **When to install it.** An application that installs nothing already restores the terminal on every signal, because the immediate path calls every cleanup first. Install the plugin when an action has work worth finishing after a signal, such as a write it should complete or a child it should stop cleanly. A daemon under the [service plugin](service.md) lists `SIGTERM` alone, because systemd and launchd send `SIGTERM` and wait before they kill, while Ctrl-C in a terminal still ends it at once.
- **Faults.** The typed settings reject a value of the wrong shape, and the factory judges none, under [Plugin settings](../core/plugin-contract.md#plugin-settings).
