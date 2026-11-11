- Change `loom changelog write` so a feature fragment advances the minor below `1.0.0`, as a breaking fragment does. A feature cut from `0.4.7` now takes `0.5.0` instead of `0.4.8`, and a fix-only cut still takes `0.4.8`. The bump from `1.0.0` is unchanged, as [ADR-0145](docs/decisions/0145-below-1-0-0-a-feature-fragment-advances-the-minor.md) records.

### Migration

**Affected surface.** `loom changelog write` in a package below `1.0.0` with a feature fragment pending, when it passes `--target` at a patch version, or when its version is a prerelease of a patch version, such as `0.4.8-rc.1`.

**Why.** The fragment minimum for a feature fragment below `1.0.0` is now the next minor, so a target or a prerelease's release part below that minor no longer meets it, and the cut fails and names the minimum.

**Before and after.**

Before, from `0.4.7` with `feature.tags.md` pending:

```sh
loom changelog write --target 0.4.8
```

After:

```sh
loom changelog write --target 0.5.0
```

**Steps.**

1. Run `loom changelog write --dry-run` and read the next version it prints.
2. Change any `--target` in release scripts or workflows to that version or higher.
3. For a prerelease such as `0.4.8-rc.1` with a feature fragment pending, cut a new prerelease with `loom changelog write --target 0.5.0-rc.1`, or finalize with `--target 0.5.0`.

**Validation.** Run `loom changelog write --dry-run` and check that it prints the expected version and exits 0, then run the release command with its `--target`, if any, under `--dry-run`.
