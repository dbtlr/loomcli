- Require Bun 1.4.4 or later. Every published package's `engines.bun` is now `>=1.4.4`, and CI tests Bun 1.4.4.

### Migration

**Affected surface.** Applications that run a Loom package, or a bin built with `loom build`, on Bun 1.4.0 to 1.4.3.

**Why.** Bun 1.4.0 renders an error's stack lazily, and when a garbage collection frees the code that created the error before anything reads `stack`, the stack loses its name and message and reads only `Error`. A defect's logged stack and a failure's Developer Diagnostic then lose the sentence that names the failure. Bun 1.4.4 fixes it.

**Before and after.**

Before, in the application's `package.json`:

```json
{ "engines": { "bun": ">=1.4.0" } }
```

After:

```json
{ "engines": { "bun": ">=1.4.4" } }
```

**Steps.**

1. Upgrade development, CI, and deployment Bun runtimes to 1.4.4 or later, for example with `bun upgrade` or the `bun-version` input of `oven-sh/setup-bun`.
2. Update the application's `engines.bun` requirement to `>=1.4.4`.

**Validation.** Run `bun --version` in each environment to check its runtime. Run the application's test command under Bun before deployment.
