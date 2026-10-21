---
description: "The verbose plugin: the -v and -q counted options."
---

# Verbose plugin

```ts
// @loomcli/plugins/verbose
import type { Plugin, PluginOptions } from '@loomcli/core';

const options = {
  verbose: {
    control: true,
    description: 'Show more detail. Repeat it for more.',
    short: 'v',
    type: 'count',
    verbose: true,
  },
  quiet: {
    control: true,
    description: 'Hide info and success messages.',
    quiet: true,
    short: 'q',
    type: 'count',
  },
} satisfies PluginOptions;
export type VerboseOptions = typeof options;
export declare function verbose(): Plugin<VerboseOptions>;
```

```ts
import { Application } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';

const app = new Application('jsonkit', { plugins: [verbose()] });
// jsonkit -v keys -f doc.json writes "› Reading doc.json." on stderr and the keys on stdout.
```

`@loomcli/plugins/verbose` gives the operator the spellings that set the run's [verbosity](../core/verbosity.md). `verbose()` declares two global counted options: `verbose`, spelled `-v, --verbose`, with the description `Show more detail. Repeat it for more.` and the mark `verbose: true`, and then `quiet`, spelled `-q, --quiet`, with the description `Hide info and success messages.` and the mark `quiet: true`. Both carry `control: true`. It adds no middleware, no Command, no view, and no hook, and it claims no slot. Core settles the verbosity and applies it; the plugin only gives the operator the spellings.

- **No settings.** `verbose()` declares no parameter, as `color()` does, so TypeScript rejects an argument and the factory reads none. `-v` and `-q` are the common standard's spellings, and the marks reject an `env` binding, so there is nothing to set.
- **Its readers.** Help lists `-v, --verbose...` and `-q, --quiet` with their descriptions among the global options. A counted option ends its spellings with `...` because each occurrence adds one, and the quiet-marked option prints none, because a further `-q` adds nothing. [Completion](completion.md) reads the same rule: it stops offering `--quiet` once `-q` is given and `--verbose` once `-vv` is. The [manifest](manifest.md) marks `verbose` with `control` and `verbose`, and `quiet` with `control` and `quiet`, and the [MCP](mcp.md) plugin leaves both out of every tool's input schema, as it leaves out every control option.
- **Another spelling.** An application that wants another spelling, such as `--loud`, or a verbose option without a quiet one, leaves the plugin out and marks its own counted global options. Installing the plugin beside another option with either mark is that mark's two-marks declaration error, and beside an option of its own named `verbose` or `quiet`, or spelled `-v` or `-q`, it is the existing key or spelling collision under [Plugin declaration errors](../core/plugin-contract.md#plugin-declaration-errors).
- **Names.** `verbose` and `VerboseOptions`, the type of its options record, are exported from `@loomcli/plugins/verbose`.

## Verbose plugin acceptance

- jsonkit installs `verbose()` after `color()` and declares no verbose-marked or quiet-marked option of its own, and `jsonkit --help` lists `-v, --verbose...` and `-q, --quiet` with their descriptions after `--[no-]color`, in the pages [The help page](help.md#the-help-page) pins. The manifest marks them `control` with `verbose` and with `quiet`, and a fixture's unmarked counted option reads `false` for both.
- `jsonkit -v keys -f doc.json` and `jsonkit -vv keys -f doc.json` write the `Reading doc.json.` debug line on stderr, `jsonkit keys -f doc.json` and `jsonkit -v -q keys -f doc.json` write none, and `jsonkit -q keys -f doc.json` writes the keys on stdout and nothing on stderr. Piped, the line is `› Reading doc.json.`.
- An application that marks its own verbose option and installs the plugin fails with the two-marks error, and so does one that marks its own quiet option.
- A consumer installs the packed pack, imports `@loomcli/plugins/verbose`, compiles against its declarations, and `pnpm check:packed` resolves the subpath from the packed tarball under Node and Bun.
