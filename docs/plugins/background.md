---
description: "The background plugin: the operator's option for the terminal background."
---

# Background plugin

```ts
import { Application } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { loomTheme } from '@loomcli/plugins/theme';

const app = new Application('notes', { plugins: [loomTheme(), background()] });
```

`@loomcli/plugins/background` gives the operator `--background`, which sets the run's [background choice](../core/background.md). `background()` declares one global string option, `background`, with the description `Pick colors for this terminal background instead of detecting it.`, the validator `z.enum(['dark', 'light'], { error: 'Supply dark or light.' })`, `control: true`, and the [mark](../core/background.md) `background: true`. It adds no middleware, no Command, no view, and no hook, and it claims no slot. Core reads the choice and settles the background; the plugin gives the operator the spelling, and its mark makes core [detect](../core/background.md) the background even when no theme entry is adaptive, so an application whose own code reads the background installs it.

- **No settings.** `background()` declares no parameter, as `color()` does, so TypeScript rejects an argument and the factory reads none. The mark rejects the keys a setting could carry, a short alias and an `env` binding, so there is nothing to set.
- **Its readers.** Help lists `--background <background>` among the global options with its description and `One of: dark, light.`, which [Accepted values](help.md#accepted-values) derives from the validator's schema, and [completion](completion.md) offers both values. The [manifest](manifest.md) marks it `control` and `background` and carries the schema, and the [MCP](mcp.md) plugin leaves it out of every tool's input schema, as it leaves out every control option.
- **A wrong value.** `--background=blue` supplies no choice, so the run settles its background from the other sources, and validation fails it with exit 2 and the issue `Supply dark or light.`
- **Another spelling.** An application that wants another spelling leaves the plugin out and marks its own string global option. Installing the plugin beside another marked option is a declaration error: [`@loomcli/core/background-mark`](../core/diagnostics.md#loomclicorebackground-mark).
- **Names.** `background` and `BackgroundOptions`, the type of its options record, are exported from `@loomcli/plugins/background`.
