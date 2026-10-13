- Rename the release facts' `lane` member to `channel`. `host.release.release.channel` holds the release channel: the first prerelease identifier of the version, or `stable` when the version has none. See [release facts](docs/core.md#release-facts).

### Migration

**Affected surface.** Application code that reads `host.release.release.lane`, and tests that pass a `release` host override whose release group holds `lane`.

**Why.** Operators know a release line as a channel, and core already uses lane for its output areas, such as the results lane and the lane views.

**Before and after.**

Before:

```ts
const { release } = host.release;
out.print(`${release.version} (${release.lane})`);
```

After:

```ts
const { release } = host.release;
out.print(`${release.version} (${release.channel})`);
```

**Steps.**

1. Replace each read of `release.lane` with `release.channel`.
2. In each `run({ host: { release } })` or `app.invoke` override that spells a release group, rename `lane` to `channel`.

**Validation.** Run the application's type check: TypeScript reports every remaining read of `lane`. Run the application's tests to cover overrides in JavaScript files.
