- Add accepted values to help pages. An option or argument row states the values its input accepts after its description: an authored `accepts` line, or `One of: …` derived from a closed set of strings in the input schema, up to eight values, when nothing beside the set could narrow it. See [Accepted values](docs/core.md#accepted-values).
- Add `accepts` to `helpInput`, and add `helpArgument`, the argument-targeted help extension that carries `accepts`, both from `@loomcli/plugins/help/extension`.
- Change the formatter's `--format` description to `Select the output format, <default> by default.` The help page lists up to eight view names as the row's accepted values, and the option's schema carries every name.

### Migration

**Affected surface.** Exact-byte consumers of the default help view, including help snapshots, for any option or argument whose schema is a closed set of strings. Consumers that read the view names from the `--format` option's description through `inspect()` or the manifest.

**Why.** A help row now states the values an input accepts, so a reader chooses a valid value before the first run, and the formatter's description stops repeating the view names the row now lists.

**Before and after.** textstat's `--metric` row changes from `What each row counts.  (default: bytes)` to `What each row counts. One of: bytes, words, lines.  (default: bytes)`. The formatter description changes from `Select the output format: table, json, jsonl. Default: table.` to `Select the output format, table by default.`

**Steps.**

1. Update help snapshots for the accepted-values sentences and the new formatter description.
2. Read the view names from the `--format` option's `schema.enum` in `inspect()` or the manifest instead of parsing its description.
3. Where a derived list reads poorly, give the input an `accepts` line through `helpInput` or `helpArgument`.

**Validation.** Run the application's help snapshots and any reader of the format option. This repository checks the pages and the installed packages with:

```sh
pnpm exec vp test --run packages/plugins/tests/help-accepted.test.ts
LOOM_TEST_RUNTIME=bun pnpm exec vp test --run packages/plugins/tests/help-accepted.test.ts
pnpm run check:packed
```
