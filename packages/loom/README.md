# @loomcli/loom

The Loom CLI toolchain. It exports no module, and its public commands, `loom build` and `loom check` among them, ship in a later release, as the [toolchain reference](https://github.com/dbtlr/loomcli/blob/main/docs/toolchain.md) describes.

## Install

```sh
pnpm add -D @loomcli/loom
```

## Build

Core fills `host.release` from the release facts the build bakes into the `__LOOM_RELEASE__` identifier through a bundler `define`. Until `loom build` ships, bake them with your bundler:

```ts
// scripts/build.ts, run as `bun scripts/build.ts`; the bundle reads { build: 'distributed' }.
await Bun.build({
  define: { __LOOM_RELEASE__: JSON.stringify({ build: 'distributed' }) },
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  target: 'node',
});
```

The define reaches core only when the bundle includes `@loomcli/core`. A bundle built without it reads `{ build: 'source' }`, as the source run does, so a defect prints its Developer Diagnostic. See [Release facts](https://github.com/dbtlr/loomcli/blob/main/docs/core.md#release-facts) for the contract.
