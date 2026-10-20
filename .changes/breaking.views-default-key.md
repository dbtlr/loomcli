- Change the `default` option of `views()`, on a Command, on the Application, and on the Command a lifecycle hook receives, to take one of the keys the same call supplies, so a misspelled default is a compile error. `@loomcli/core/unknown-default-view` goes.

### Migration

**Affected surface.** TypeScript code that passes `views()` a `default` naming a view the same call's record does not supply, such as a view an earlier `result()`, `rows()`, or `views()` call declared.

**Why.** A `views()` default is typed from the record the call supplies, so a misspelled view name fails to compile in place of failing at attach.

**Before and after.**

Before:

```ts
const listed = paths.views({}, { default: 'table' });
```

After:

```ts
const listed = paths.views({ table: table({ columns: ['path', 'kind'] }) }, { default: 'table' });
```

**Steps.**

1. Find each `views()` call whose `default` names a view the call's own record does not hold.
2. Supply that view again in the same call's record, or declare the views in the order that makes the wanted view the first key.

**Validation.** Run `tsc --noEmit` in the application, and run its tests.
