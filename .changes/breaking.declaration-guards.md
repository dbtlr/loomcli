- Remove `checkPluginSettings` and `checkShortSetting` from `@loomcli/core`. A plugin factory's typed settings already reject what they judged, and every first-party plugin stops calling them.
- Remove the declaration rules that re-checked what TypeScript rejects at the call, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): `option-type`, `short-alias`, `flag-not-boolean`, `short-only-without-short`, `short-only-with-aliases`, `boolean-option-multiple`, `count-option-multiple`, `polarity-on-count`, `implied-on-boolean-or-count`, `implied-not-a-string`, `polarity-on-string`, `option-polarity`, `short-only-both-polarities`, `global-presence-rule`, `global-option-after-command`, `env-on-multiple`, `env-name`, `env-on-argument`, `omission-already-decided`, `omission-without-validator`, `boolean-option-value-rule`, `count-option-value-rule`, `required-with-default`, `not-a-validator`, `default-shape`, and `content-declaration`, each under `@loomcli/core/`. A value that bypasses the types now meets the platform's own error.
- Remove `@loomcli/core/not-an-object` and `@loomcli/core/unreadable-declaration`. A declaring call no longer reads its config, options, or definition through a guarded one-time copy, so a getter or proxy that throws reports its own error.
- Remove `@loomcli/core/default-depth`. A declared default nests as deep as the author writes it, and core no longer freezes a copy of it: the graph and the default's validator read the value the author declared, and each invocation still receives its own copy of an array default.
- Remove `@loomcli/core/not-one-line`. Help, the manifest, and MCP print a description or a deprecated message on one line and read each line break in it as a space.
- Change the interaction, color, verbose, quiet, and background marks to check only two marked options in one Application and a configuration binding on a marked option. The types place each mark.
- Allow an option alias that repeats the option's name, another of its aliases, or a spelling the option already accepts; it adds nothing. Allow an `env` list that names one variable twice; it binds once.
- Change stdin declared on a Command with no action to report `@loomcli/core/command-without-action`.
- Remove the Command, result, and plugin rules that re-checked what TypeScript rejects at the call: `command-globals`, `declared-after-action`, `multiple-actions`, `alias-without-names`, `group-option`, `multiple-results`, `views-without-result`, `view-shape`, `row-view-on-value`, `media-type`, `view-name`, `result-without-action`, `misplaced-listing-fact`, `not-a-list`, `not-a-function`, `middleware-activation`, `unknown-signal`, `source-bound-own-option`, `extension-without-schema`, `extension-target`, `override-key`, `translation-key`, `retired-application-option`, `rendering-policy`, `theme-name-taken`, `rule-prose`, and `rule-docs`, each under `@loomcli/core/`. A value passed to `command()` or listed under a plugin's `commands` that is not a Command throws a plain `TypeError`, and so does a theme entry that is not a style chain.
- Remove `@loomcli/core/nesting-depth`. A Command path nests to any depth, and routing, help, completion, the manifest, MCP, and man pages serve it. jsonkit gains `stats depth max`, three levels below the root.
- Remove `@loomcli/core/invalid-identity` under [ADR-0096](docs/decisions/0096-the-identity-grammar-is-a-naming-convention.md). `plugin()`, `extension()`, and `view()` take any string as an identity, and a hand-built descriptor's identity is not checked either. An identity installed twice and two distinct descriptors or declared views under one identity stay declaration faults, and `diagnosticRule()` keeps its rule-identity check.
- Allow an optional argument after another optional one. Bare words fill optional arguments left to right, and an argument that receives no word is omitted; `@loomcli/core/optional-argument-last` keeps only a required argument after an optional one.
- Allow a repeated declaration of one thing: a Command alias that repeats its own name or another of its aliases is skipped, a signal claimed twice is claimed once, a second value of one extension in one layer replaces the first whole, and a second override of one key in one contributor loses to the first, as overrides across contributors do. This removes `repeated-alias`, `signal-claimed-twice`, `extension-value-twice`, and `override-twice`.
- Allow a configuration source binding that the plugin does not list under `extensions`; core admits its descriptor itself, and `@loomcli/core/source-binding` goes.
- Change a schema that does not answer synchronously to report `@loomcli/core/invalid-extension-value`, which replaces `async-extension-schema`.
- Change a views record that names no view to fail where the result renders, in place of `result-without-views`.
- Change `@loomcli/core/foreign-value` to report a plugin, extension value, view, override, translation, or failure encoding that another installed copy of `@loomcli/core` built, with a correction to install one copy.
- Change the `default` option of `views()`, on a Command, on the Application, and on the value a lifecycle hook receives, to take one of the keys the same call supplies, so a misspelled default is a compile error. `@loomcli/core/unknown-default-view` goes.

### Migration

**Affected surface.** A third-party plugin that imports `checkPluginSettings` or `checkShortSetting` from `@loomcli/core`, and TypeScript code that passes `views()` a `default` naming a view the same call does not supply.

**Why.** Each check judged a value that the plugin factory's settings type already rejects at compile time, so core no longer exports them. A `views()` default is now typed from the record the call supplies, so a misspelled view name fails to compile in place of failing at attach.

**Before and after.**

Before:

```ts
import { checkPluginSettings, plugin } from '@loomcli/core';

export function notes(settings?: NotesSettings) {
  checkPluginSettings(settings, { call: 'notes', plugin: '@acme/notes' });
  return plugin('@acme/notes', { options: notesOptions(settings) });
}

const listed = paths.views({}, { default: 'table' });
```

After:

```ts
import { plugin } from '@loomcli/core';

export function notes(settings?: NotesSettings) {
  return plugin('@acme/notes', { options: notesOptions(settings) });
}

const listed = paths.views({ table: table({ columns: ['path', 'kind'] }) }, { default: 'table' });
```

**Steps.**

1. Delete each call to `checkPluginSettings` or `checkShortSetting`.
2. Remove both names from the `@loomcli/core` import.
3. Type the factory's settings parameter, such as `short?: NonNullable<BooleanOption['short']>`, so the compiler rejects a value the check rejected.
4. For each `views()` call whose `default` names a view an earlier call declared, supply that view again in the same call's record, or declare the views in the order that makes the first key the default.

**Validation.** Run `tsc --noEmit` in the plugin package and in the application, and run their tests.
