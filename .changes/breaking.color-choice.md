- Add the color mark, `color: true` on one Boolean global option of an Application. Core reads the operator's color choice from argv right after host capture: the last spelling of the marked option before the first bare `--` sets the run's `color` policy field to `'always'` for a positive spelling and `'never'` for a negative one, over `NO_COLOR`, `FORCE_COLOR`, and the declared `rendering.color` from the Application and from `run()`. Modifiers, hyperlinks, and terminal controls keep their own policy, so `--no-color` on a terminal keeps bold. Everything the run prints after host capture follows the choice, including graph build's declaration errors, environment and configuration warnings, an unknown command, help, results, and failures. An invocation by name reads no choice and stays plain, and an Application with no marked option prints every byte as before. See [Color](docs/core.md#color).
- Reject a misplaced color mark under `@loomcli/core/color-mark`: `color` on a local or non-Boolean option, a value other than `true`, a short alias or an `env` binding beside the mark, a configuration binding of the installed source on the marked option, and a second marked option in one Application. The types reject each rule except the configuration binding, and they now also reject `interaction` on string, content, and counted options, which the runtime already rejected.
- Publish `color` on each Boolean `OptionNode` from `inspect()`, `true` on the marked option, and copy it into each Boolean option entry of the `@loomcli/plugins/manifest` document.
- Add `@loomcli/plugins/color`. `color()` takes no settings and declares the global Boolean option `--[no-]color`, described as `Turn color on or off, overriding NO_COLOR.`, marked `control` and with the color mark, so the operator turns color on or off for one run. Help lists it among the global options, the manifest marks it `control` and `color`, and MCP tool schemas leave it out. See [Color plugin](docs/core.md#color-plugin).

### Migration

**Affected surface.** An option declaration that carries a `color` key, which earlier releases ignored. A `color` key on a local option, on a string, content, or counted option, with a value other than `true`, beside `short` or `env`, on an option with a configuration binding, or on a second option of one Application now throws a `DeclarationError` under `@loomcli/core/color-mark`. An application that declares no `color` key needs no change.

**Why.** `color: true` now marks the one Boolean global option whose spellings carry the operator's color choice, so core reads the key and rejects a declaration that cannot carry it.

**Before and after.**

Before, a key core ignored:

```ts
app.option('theme', { type: 'string', color: true });
```

After, the key removed, or the color choice declared on a Boolean global option:

```ts
app.option('theme', { type: 'string' });
app.globalOption('color', {
  type: 'boolean',
  polarity: 'both',
  color: true,
  control: true,
  description: 'Turn color on or off, overriding NO_COLOR.',
});
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Search the application's option declarations for a `color` key. Remove each one, or keep it on one Boolean global option with no `short`, `env`, or configuration binding, or install `color()` from `@loomcli/plugins/color` in place of the application's own option.

**Validation.** Run `pnpm exec tsc --noEmit`, which reports a misplaced `color` key, and run the application once with `--help`, which throws any declaration fault the types cannot see.
