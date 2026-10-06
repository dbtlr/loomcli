- Change a `manifestCommand` failure entry to read its failure code from the class: an entry is `{ failure, meaning }`, and the manifest document lists `{ code, exitCode, meaning }` in place of `{ name, exitCode, meaning }`. A stale `name` key is dropped, not rejected, and `exitCodes` rows name failure codes. A class whose code is outside the grammar is rejected at the call with core's own sentence. See [Manifest failures](docs/core.md#manifest-failures).
- Rename the manifest's conflict rule to `@loomcli/plugins/manifest/failure-code-conflict`, keyed on the failure code. Its sentence reads `Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "select".` with the correction `Declare one exit code and one meaning for each failure code.`
- Reject a failure class whose static `code` is not a kebab-case string at its first construction, under `@loomcli/core/failure-code`, such as `Failure class "RegistryDownError" declares failure code "Registry_Down".` A class that used `static code` for another purpose now declares a failure code.

### Migration

**Affected surface.** Applications and plugins that pass `failures` to `manifestCommand()` from `@loomcli/plugins/manifest/extension`, consumers that read `name` on the manifest document's failure entries or key on `@loomcli/plugins/manifest/failure-name-conflict`, and failure classes that declare a static `code` outside the kebab-case grammar.

**Why.** A failure's identity now lives on its class as a static `code`, which survives a minifying build and which `invoke()`'s outcome, a failure encoder, and the manifest all report, so a hand-written name would be a second spelling of it.

**Before and after.**

Before:

```ts
export class PathNotFoundError extends FatalError {
  static override readonly exitCode = EX_DATAERR;
  // ...
}

manifestCommand({
  failures: [
    { failure: PathNotFoundError, meaning: 'The path names no value in the document.', name: 'path-not-found' },
  ],
});
```

After:

```ts
export class PathNotFoundError extends FatalError {
  static override readonly code = 'path-not-found';
  static override readonly exitCode = EX_DATAERR;
  // ...
}

manifestCommand({
  failures: [{ failure: PathNotFoundError, meaning: 'The path names no value in the document.' }],
});
```

**Steps.**

1. For each `manifestCommand()` failure entry, move its `name` to the class it names as `static override readonly code`, and remove `name` from the entry.
2. Give two classes that shared an inherited code, such as two `FatalError` subclasses with different exit codes or meanings, codes of their own, or `--manifest` reports `@loomcli/plugins/manifest/failure-code-conflict`.
3. Rename a static `code` that is not lowercase letters and digits joined by single hyphens, such as `ENOENT` or a number, so it follows the grammar, or move the value to another static name.
4. Read `code` in place of `name` on each manifest failure entry, and key on `@loomcli/plugins/manifest/failure-code-conflict` in place of `@loomcli/plugins/manifest/failure-name-conflict`.

**Validation.** Run the application's type check and tests, then run `<app> --manifest` and confirm that each Command's `failures` entries list the codes the classes declare and that the run exits 0.
