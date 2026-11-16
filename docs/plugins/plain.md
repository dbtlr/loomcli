---
description: "The plain plugin: the operator's --plain option, which turns off redrawing in place."
---

# Plain plugin

This page documents the plain plugin's option, `--plain`, which lets the operator turn off redrawing in place for a run, so a progress line and a streamed message only ever append to the screen. [The plain switch](../core/output.md#the-plain-switch) states the core rule for what the switch turns off.

```ts
import { Application } from '@loomcli/core';
import { plain } from '@loomcli/plugins/plain';

const app = new Application('notes', { plugins: [plain()] });
```

`@loomcli/plugins/plain` gives the operator the spelling that turns the run's [plain switch](../core/output.md#the-plain-switch) on. `plain()` declares one global Boolean option, `plain`, spelled `--plain`, with the description `Never redraw: print progress and streamed messages as plain lines.`, `control: true`, and the mark `plain: true`. It adds no middleware, no Command, no view, and no hook, and it claims no slot. Core reads the switch and applies it; the plugin only gives the operator the spelling.

```text
$ notes sync --plain
ℹ Fetching notes
✔ Fetched 12 notes
✔ Synced.
```

- **What it turns off.** With `--plain`, no live region without input draws: a [progress line](../libs/prompts.md#progress) prints its start and end lines and nothing between, and a [streamed message](../core/output.md#a-streamed-message) is written a line at a time. Messages, color, the verbosity, and whether a question asks at all are unchanged, so `-q`, `--no-input`, and `NO_COLOR` each still do their own job beside it.
- **`ACCESSIBLE` without the plugin.** Core turns the same switch on when `ACCESSIBLE` is set and not empty, in every application, with or without the plugin. So the plugin gives the operator a spelling for one run, and `ACCESSIBLE` serves an operator who wants every Loom application plain.
- **No way off.** The option has a positive spelling alone, because nothing turns the switch off. An operator whose shell exports `ACCESSIBLE` unsets it, or runs with it empty, for a run that redraws.
- **No settings.** `plain()` declares no parameter, as `color()` does, so TypeScript rejects an argument and the factory reads none. The mark rejects a short alias and an `env` binding, because core reads the spelling from argv right after host capture and `ACCESSIBLE` is the environment's word for the switch, so there is nothing to set.
- **Its readers.** Help lists `--plain` with its description among the global options, and [completion](completion.md) offers it. The [manifest](manifest.md) marks it `control` and `plain`, and the [MCP](mcp.md) plugin leaves it out of every tool's input schema, as it leaves out every control option. An invocation by name has no terminal, so the switch changes nothing it writes.
- **Another spelling.** An application that wants another spelling, such as `--accessible`, leaves the plugin out and marks its own Boolean global option with `plain: true`. Installing the plugin beside another marked option is a declaration error under the rule [`@loomcli/core/plain-mark`](../core/diagnostics.md#loomclicoreplain-mark), and beside an option of its own named `plain` or spelled `--plain` it is the existing key or spelling collision: [`@loomcli/core/option-declared-twice`](../core/diagnostics.md#loomclicoreoption-declared-twice) or [`@loomcli/core/spelling-taken`](../core/diagnostics.md#loomclicorespelling-taken).
- **Names.** `plain` and `PlainOptions`, the type of its options record, are exported from `@loomcli/plugins/plain`.
