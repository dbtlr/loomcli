- Remove the Application's `packet` option, the `Packet` type, and the `@loomcli/core/invalid-packet` rule. Core reads the build of every run from the [release facts](docs/core.md#release-facts) the build bakes into the `__LOOM_RELEASE__` identifier through a bundler `define`, and `new Application()` given `packet` throws under `@loomcli/core/retired-application-option`.
- Change an application with no baked release facts, run from source or bundled without the define, to read `{ build: 'source' }`, a development build. Such a run shows a defect's Developer Diagnostic, checks every converter, and fails on an undescribed declaration, where an application given no packet was distributed before. A bundle that bakes `{ "build": "distributed" }` shows the operator `<application>: Something went wrong.` as before.
- Change `inspect()` to learn its build from the baked release facts, so from source it checks every validated input's converter.
- Add `release` to the host fields `app.invoke` accepts under `host`, now five. A malformed call reports by the release facts its `host` supplies, which the call now reads first.

### Migration

**Affected surface.** Applications that import `loom.packet.json` and pass it as the Application's `packet` option, code that imports the `Packet` type from `@loomcli/core`, and applications that shipped a bundle with no packet as a distributed build.

**Why.** The release facts say how the running application was built and released, and the build bakes them in, so an author keeps no facts file and wires nothing into the Application. A bundle built without them is unbuilt, so it shows its author the detail of a defect.

**Before and after.**

Before, the entry imported the packet and the build ran the `packet()` plugin:

```ts
// src/application.ts
import packet from '../loom.packet.json' with { type: 'json' };

export const notes = new Application('notes', { description: 'Keep notes.', packet });
```

```ts
// scripts/build.ts
import { packet } from '@loomcli/loom/build';

await Bun.build({ entrypoints: ['src/main.ts'], outdir: 'dist', plugins: [packet()], target: 'node' });
```

After, the Application takes no packet, and the build bakes the release facts through a define:

```ts
// src/application.ts
export const notes = new Application('notes', { description: 'Keep notes.' });
```

```ts
// scripts/build.ts
await Bun.build({
  define: { __LOOM_RELEASE__: JSON.stringify({ build: 'distributed' }) },
  entrypoints: ['src/main.ts'],
  outdir: 'dist',
  target: 'node',
});
```

**Steps.**

1. Delete `loom.packet.json`, its import, the `packet` option, and any `loom.packet.json` entry in `tsconfig.json`.
2. Bake `__LOOM_RELEASE__` into every bundle you ship with your bundler's `define`, `{ "build": "distributed" }` for a distributed build. The bundle must include `@loomcli/core`, so the define reaches it.
3. Run the application from source and describe every member the `@loomcli/core/undescribed` diagnostic lists, because a source run is a development build.
4. In a test that needs a distributed build from source, pass `host: { release: { build: 'distributed' } }` to `run()` or `app.invoke`.

**Validation.** Run the bundle with a command that throws and confirm it prints `<application>: Something went wrong.`. Run the source with `--help` and confirm it prints no diagnostic. Run the application's tests.
