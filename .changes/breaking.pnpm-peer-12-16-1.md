- Change the optional peer dependency of `@loomcli/loom` from `pnpm` 12.8.1 to 12.16.1, the version that prepares `pnpm-lock.yaml` for a release. The error for a missing pnpm now asks for 12.16.1.

### Migration

**Affected surface.** An application that installs `pnpm` beside `@loomcli/loom` to prepare `pnpm-lock.yaml` for a release, and whose `pnpm` is 12.8.1.

**Why.** The peer is exact, because the pnpm that prepares `pnpm-lock.yaml` must be the version Loom was tested with. A project that keeps 12.8.1 now has an unmet peer.

**Before and after.**

Before:

```json
{ "devDependencies": { "pnpm": "12.8.1" } }
```

After:

```json
{ "devDependencies": { "pnpm": "12.16.1" } }
```

**Steps.**

1. Change the `pnpm` dependency that sits beside `@loomcli/loom` to `12.16.1`.
2. Run `pnpm install` to refresh `pnpm-lock.yaml`.
3. Update any pnpm version your CI or tool manager pins to match.

**Validation.** Run `pnpm install` and confirm it reports no unmet peer for `pnpm`. Then run `pnpm loom changelog check` and confirm it exits 0.
