- Change `selfUpdate()` to turn update notices on unless the application passes `notices: false`. An application that installs the self-update plugin and upgrades unchanged now prints a notice after a run at a terminal when a newer release exists on the binary's channel, and about once a day starts a detached copy of itself that asks the binary's GitHub repository for its newest release. See [Update notices](docs/core.md#update-notices).

### Migration

**Affected surface.** Applications that install `selfUpdate()` from `@loomcli/plugins/self-update` and ship a script-installed release binary. A source build, and a binary another installer placed, print no notice and start no lookup.

**Why.** An operator should learn that a newer release exists without running `self-update --check`, so the plugin tells them unless the author or the operator turns it off.

**Before and after.**

Before, an application that wants no notices and no daily lookup:

```ts
selfUpdate();
```

After:

```ts
selfUpdate({ notices: false });
```

**Steps.**

1. Decide whether the application should print update notices. To keep them, change nothing.
2. To keep the earlier behavior, pass `notices: false` to each `selfUpdate()` call. The plugin then declares no notice middleware, reads no cache, and starts no lookup.
3. To let operators turn notices off through a variable of the application's own beside `NO_UPDATE_NOTIFIER`, pass `notices: { env: 'NAME' }` instead.

**Validation.** Run a script-installed release binary at a terminal with an empty cache directory. With `notices: false`, no `update.json` appears in the application's cache directory and no notice prints. Run the application's tests to confirm `selfUpdate()` accepts the setting.
