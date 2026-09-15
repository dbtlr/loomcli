- Add composable `style`, independent `glyph`, deferred `pad`, and a destination-aware `ViewContext` on Node and Bun.
- Add one optional theme contribution with inferred custom names and the bare `theme(mapping)` factory at `@loomcli/plugins/theme`.
- Resolve view and semantic output under configurable color, modifier, hyperlink, and terminal-control policies. Add glyph gutters to `info`, `success`, `warn`, and `error`.

### Migration

**Affected surface.** View output, semantic output snapshots, embedded ANSI, marker-bearing raw data, and complete `Host` values.

**Why.** Core now resolves marked output for the destination. The write site owns the newline, while core controls terminal capabilities and prevents formatting from leaking across calls. `out.render` and a failure diagnostic add none, so a view rendered through either owns its trailing newline; a semantic method appends one after its lane view, so a lane view returns none.

**Before and after.**

Before:

```ts
const view = { render: (name: string) => `${name}\n` };
```

After, preserve raw data literally:

```ts
import type { View } from '@loomcli/core';

const fileName: View<string> = {
  render: (name, { style }) => `${style.escape(name)}\n`,
};
```

Previously `out.info('ready')` wrote `ready\n`. It now writes `ℹ ready\n` with main glyphs, or `i ready\n` with compatibility glyphs. `out.print('ready')` remains prefix-free.

**Steps.**

1. Escape raw values before interpolating them into authored output. Preserve existing marked messages without another escape pass.
2. Update semantic-output snapshots for glyph gutters and continuation indentation. `out.render` still adds no newline, and each semantic method still appends exactly one.
3. Review embedded ANSI. Automatic policies evaluate each destination; other terminal controls default to stripping. Use `rendering: { terminalControls: 'preserve' }` for intentional complete terminal commands. Color, modifiers, and hyperlinks each accept `auto`, `always`, or `never`. Incomplete commands are always discarded.
4. Add a `platform` string to complete `Host` values. Partial run overrides can omit it and use process capture.
5. Optionally install `theme(mapping)` and include the shallow Application registration in the TypeScript project to expose custom names. The named `loomTheme` factory is not exported yet.

**Validation.** Run the application's TypeScript check and output tests under Node and Bun. Compare redirected and terminal output, `NO_COLOR=1`, `TERM=linux`, and multiline messages. Use `width(style.escape(value))` to verify literal data alignment. See the [style reference](docs/core.md#styles-and-rendering-policy) for policy precedence and glyph selection.
