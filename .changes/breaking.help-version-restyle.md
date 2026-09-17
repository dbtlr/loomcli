- Style the default help page and version line with semantic theme tokens and explicit bold and italic modifiers. Align help columns by terminal width, including wide and combining characters.
- Include the formatter's declared default in its option description. Keep graph facts, defaults, and authored examples literal.

### Migration

**Affected surface.** Exact-byte consumers of the default help and version views, including snapshots and wrappers that call their `render` functions.

**Why.** These views now return marked strings for core to resolve under the destination's rendering policy. Help columns use terminal width instead of JavaScript string length.

**Before and after.** A capable terminal previously printed an unstyled application name. It now prints a bold highlighted name. The formatter description changes from `Select the output format: records, json, jsonl.` to `Select the output format: records, json, jsonl. Default: records.`

**Steps.**

1. For plain output, set `rendering: { color: 'never', modifiers: 'never' }` on the Application or invocation. `NO_COLOR` alone preserves modifiers at a capable terminal.
2. Update help snapshots for the formatter sentence and Unicode column alignment.
3. Pass default view output through `out.render` so core resolves its markers. Keep custom whole-view overrides when the application requires different output.

**Validation.** Run the application's tests with plain and themed output configured as above. Compare stdout, stderr, exit codes, and final newlines against the updated expectations. This repository checks those policies and installed-package output with:

```sh
pnpm exec vp test --run packages/plugins/tests/help-style.test.ts
LOOM_TEST_RUNTIME=bun pnpm exec vp test --run packages/plugins/tests/help-style.test.ts
pnpm run check:packed
```
