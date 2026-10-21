- Change `ResultError.kind` and `ResultFault` to `'missing' | 'repeated'`. The `undeclared`, `middleware`, and `source` kinds go, under [ADR-0093](docs/decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): the types give `out.results` no value it accepts on a Command with no result, in a middleware, and in a configuration source, and a JavaScript call there throws a plain `TypeError`.

### Migration

**Affected surface.** Code that compares `ResultError.kind` or a `ResultFault` value with `'undeclared'`, `'middleware'`, or `'source'`, or that constructs a `ResultError` with one of them.

**Why.** Each kind reported a call the types already reject, so core no longer raises it.

**Before and after.**

Before:

```ts
if (failure instanceof ResultError && failure.kind === 'middleware') {
  return 'A plugin wrote a result.\n';
}
```

After, the branch is deleted, because no failure carries that kind.

**Steps.**

1. Delete each branch on `'undeclared'`, `'middleware'`, or `'source'`.
2. Construct a `ResultError` with `'missing'` or `'repeated'` alone.

**Validation.** Run `tsc --noEmit` in the application, and run its tests.
