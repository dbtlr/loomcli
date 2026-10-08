- Remove `packet()` and the `@loomcli/loom/build` subpath. `@loomcli/loom` exports no module. Bake the [release facts](docs/core.md#release-facts) through a bundler `define` instead.

### Migration

**Affected surface.** Build scripts that import `packet` from `@loomcli/loom/build` and pass `packet()` to `Bun.build`.

**Why.** Core reads the build from the release facts a `define` bakes in, which any bundler and the `bun build` command line accept, so no plugin answers a facts file any longer.

**Before and after.**

Before:

```ts
import { packet } from '@loomcli/loom/build';

await Bun.build({ entrypoints: ['src/main.ts'], outdir: 'dist', plugins: [packet()], target: 'node' });
```

After:

```ts
await Bun.build({
  define: { __LOOM_RELEASE__: JSON.stringify({ build: 'distributed' }) },
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  target: 'node',
});
```

**Steps.**

1. Remove the `@loomcli/loom/build` import and the `packet()` plugin from each build script.
2. Add the `__LOOM_RELEASE__` define to each build, as the core migration for the release facts describes.

**Validation.** Run each build script, then run the bundle with a command that throws and confirm it prints `<application>: Something went wrong.`.
