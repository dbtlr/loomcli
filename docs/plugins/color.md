---
description: "The color plugin: the operator's --color option."
---

# Color plugin

This page documents the color plugin's option, `--color` and `--no-color`, which lets the operator turn color on or off for a run. [Color](../core/color.md) states the core rule for how core settles the run's color.

```ts
import { Application } from '@loomcli/core';
import { color } from '@loomcli/plugins/color';

const app = new Application('jsonkit', { plugins: [color()] });
```

`@loomcli/plugins/color` gives the operator the standard pair that sets the run's [color choice](../core/color.md). `color()` declares one global Boolean option, `color`, with `polarity: 'both'`, so the operator types `--color` or `--no-color`, the description `Turn color on or off, overriding NO_COLOR.`, `control: true`, and the [mark](../core/color.md) `color: true`. It adds no middleware, no Command, no view, and no hook, and it claims no slot. Core reads the choice and applies it; the plugin only gives the operator the spellings.

- **No settings.** `color()` declares no parameter, as `mcp()` does, so TypeScript rejects an argument and the factory reads none. The mark rejects the two keys a setting could carry, a short alias and an `env` binding, and the pair's spelling is the standard's, so there is nothing to set.
- **Its readers.** Help lists `--[no-]color` with its description among the global options, as it lists any Boolean option of `both` polarity. The [manifest](manifest.md) marks it `control` and `color`, and the [MCP](mcp.md) plugin leaves it out of every tool's input schema, as it leaves out every control option.
- **Another spelling.** An application that wants another spelling, such as `--colour`, or a positive or negative option alone, leaves the plugin out and marks its own Boolean global option. Installing the plugin beside another marked option is a declaration error: [`@loomcli/core/color-mark`](../core/diagnostics.md#loomclicorecolor-mark).
- **Names.** `color` and `ColorOptions`, the type of its options record, are exported from `@loomcli/plugins/color`.
