- Fix `instanceof Application`, which now holds for an Application after a declaring call, such as `.action()`, `.command()`, or `.globalOption()`, as it did for a bare `new Application()`. A tool that finds an exported Application by class, as `loom check` does, recognizes it in every authoring state. It narrows the value to an `Application` that publishes `check()`, `inspect()`, `run()`, `invoke()`, `extend()`, and `name`, the members every authoring state keeps.

### Migration

**Affected surface.** Code that narrows a value with `instanceof Application` and then calls an authoring method on it, such as `globalOption()`, `argument()`, `option()`, `command()`, or `action()`.

**Why.** `instanceof` now holds in every authoring state, and most states no longer accept those calls, so the narrowed type publishes only the members every state keeps. Before, it narrowed to a fresh Application, which was correct only because `instanceof` held for a fresh Application alone.

**Before and after.**

Before:

```ts
if (value instanceof Application) {
  value.globalOption('verbose', { description: 'Print more.', type: 'boolean' });
}
```

After, declare on the Application value where it is authored, and narrow only to read it:

```ts
const app = new Application('notes', { description: 'Keep notes.' }).globalOption('verbose', {
  description: 'Print more.',
  type: 'boolean',
});

if (value instanceof Application) {
  const faults = value.check();
}
```

**Steps.**

1. Find each `instanceof Application` check in the application and its tools.
2. Move any authoring call made on the narrowed value to the place the Application is declared.

**Validation.** Run the application's type check, such as `loom check`, and confirm it reports no error at the narrowed calls.
