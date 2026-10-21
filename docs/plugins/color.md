---
description: "The color plugin: the operator's --color option."
---

# Color plugin

```ts
import { Application } from '@loomcli/core';
import { color } from '@loomcli/plugins/color';

const app = new Application('jsonkit', { plugins: [color()] });
```

`@loomcli/plugins/color` gives the operator the standard pair that sets the run's [color choice](../core/color.md). `color()` declares one global Boolean option, `color`, with `polarity: 'both'`, so the operator types `--color` or `--no-color`, the description `Turn color on or off, overriding NO_COLOR.`, `control: true`, and the [mark](../core/color.md) `color: true`. It adds no middleware, no Command, no view, and no hook, and it claims no slot. Core reads the choice and applies it; the plugin only gives the operator the spellings.

- **No settings.** `color()` declares no parameter, as `help()` and `mcp()` do, so TypeScript rejects an argument and the factory reads none. The mark rejects the two keys a setting could carry, a short alias and an `env` binding, and the pair's spelling is the standard's, so there is nothing to set.
- **Its readers.** Help lists `--[no-]color` with its description among the global options, as it lists any Boolean option of `both` polarity. The [manifest](manifest.md) marks it `control` and `color`, and the [MCP](mcp.md) plugin leaves it out of every tool's input schema, as it leaves out every control option.
- **Another spelling.** An application that wants another spelling, such as `--colour`, or a positive or negative option alone, leaves the plugin out and marks its own Boolean global option. Installing the plugin beside another marked option is the two-marks declaration error.
- **Names.** `color` and `ColorOptions`, the type of its options record, are exported from `@loomcli/plugins/color`.

## Color plugin acceptance

- jsonkit installs `color()` after its example plugin, and `jsonkit --help` lists `--[no-]color` with its description after `--explain` among the global options, in the pages [The help page](help.md#the-help-page) pins. The manifest marks it `control` and `color`, and every other Boolean option node reads `color: false`.
- On a capable terminal with `FORCE_COLOR=1`, `jsonkit --help --no-color` prints the page with no color escape, and piped, `jsonkit --help --color` prints it with color escapes.
- An application that marks its own option and installs the plugin fails with the two-marks error.
- A consumer installs the packed pack, imports `@loomcli/plugins/color`, compiles against its declarations, and `pnpm check:packed` resolves the subpath from the packed tarball under Node and Bun.
