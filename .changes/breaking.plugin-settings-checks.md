- Remove `checkPluginSettings` and `checkShortSetting` from `@loomcli/core`. A plugin factory's typed settings already reject what they judged, and every first-party plugin stops calling them.

### Migration

**Affected surface.** A third-party plugin that imports `checkPluginSettings` or `checkShortSetting` from `@loomcli/core`.

**Why.** Each check judged a value that the plugin factory's settings type already rejects at compile time, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md), so core no longer exports them.

**Before and after.**

Before:

```ts
import { checkPluginSettings, plugin } from '@loomcli/core';

export function notes(settings?: NotesSettings) {
  checkPluginSettings(settings, { call: 'notes', plugin: '@acme/notes' });
  return plugin('@acme/notes', { options: notesOptions(settings) });
}
```

After:

```ts
import { plugin } from '@loomcli/core';

export function notes(settings?: NotesSettings) {
  return plugin('@acme/notes', { options: notesOptions(settings) });
}
```

**Steps.**

1. Delete each call to `checkPluginSettings` or `checkShortSetting`.
2. Remove both names from the `@loomcli/core` import.
3. Type the factory's settings parameter, such as `short?: NonNullable<BooleanOption['short']>`, so the compiler rejects a value the check rejected.

**Validation.** Run `tsc --noEmit` in the plugin package, and run its tests.
