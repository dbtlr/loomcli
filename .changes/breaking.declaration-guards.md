- Remove `checkPluginSettings` and `checkShortSetting` from `@loomcli/core`. A plugin factory's typed settings already reject what they judged, and every first-party plugin stops calling them.
- Remove the declaration rules that re-checked what TypeScript rejects at the call, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): `option-type`, `short-alias`, `flag-not-boolean`, `short-only-without-short`, `short-only-with-aliases`, `boolean-option-multiple`, `count-option-multiple`, `polarity-on-count`, `implied-on-boolean-or-count`, `implied-not-a-string`, `polarity-on-string`, `option-polarity`, `short-only-both-polarities`, `global-presence-rule`, `global-option-after-command`, `env-on-multiple`, `env-name`, `env-on-argument`, `omission-already-decided`, `omission-without-validator`, `boolean-option-value-rule`, `count-option-value-rule`, `required-with-default`, `not-a-validator`, `default-shape`, and `content-declaration`, each under `@loomcli/core/`. A value that bypasses the types now meets the platform's own error.
- Remove `@loomcli/core/not-an-object` and `@loomcli/core/unreadable-declaration`. A declaring call no longer reads its config, options, or definition through a guarded one-time copy, so a getter or proxy that throws reports its own error.
- Remove `@loomcli/core/default-depth`. A declared default nests as deep as the author writes it, and core no longer freezes a copy of it: the graph and the default's validator read the value the author declared, and each invocation still receives its own copy of an array default.
- Remove `@loomcli/core/not-one-line`. Help, the manifest, and MCP print a description or a deprecated message on one line and read each line break in it as a space.
- Change the interaction, color, verbose, quiet, and background marks to check only two marked options in one Application and a configuration binding on a marked option. The types place each mark.
- Allow an option alias that repeats the option's name, another of its aliases, or a spelling the option already accepts; it adds nothing. Allow an `env` list that names one variable twice; it binds once.
- Change stdin declared on a Command with no action to report `@loomcli/core/command-without-action`.

### Migration

**Affected surface.** A third-party plugin that imports `checkPluginSettings` or `checkShortSetting` from `@loomcli/core`.

**Why.** Each check judged a value that the plugin factory's settings type already rejects at compile time, so core no longer exports them.

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
