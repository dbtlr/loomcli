# @loomcli/loom

The Loom CLI toolchain. Its public surface is `@loomcli/loom/build`, which exports `packet()`.

`packet()` is a `Bun.build` plugin. A Loom application keeps a `loom.packet.json` that reads `{ "build": "development" }` at its package root and passes it to its `Application` as `packet`. While Bun bundles the application, `packet()` writes `distributed` into the packet the bundle carries, so an operator sees one generic message for a defect, and the source file keeps reading `development`. The plugin also carries the data files core's Unicode tables read at run time, so a bundled application needs it to start.

## Install

```sh
pnpm add -D @loomcli/loom
```

## Build

```ts
// scripts/build.ts, run as `bun scripts/build.ts`; the bundle reads { "build": "distributed" }.
import { packet } from '@loomcli/loom/build';

await Bun.build({ entrypoints: ['src/main.ts'], outdir: 'dist', plugins: [packet()], target: 'node' });
```

Build a compiled binary through the same plugin with the `compile` option of `Bun.build`. The `bun build` command line takes no plugin.

See [Development builds](https://github.com/dbtlr/loomcli/blob/main/docs/core.md#development-builds) for the packet contract.
