- Change `argument()` on a `Command` and on an `Application` to reject `hidden` and `deprecated` in its config at compile time. Core never read either fact on an argument, and `ArgumentNode` carries neither, so a config that set one compiled in 0.14.0 and had no effect.

### Migration

**Affected surface.** Applications and plugins that pass `hidden` or `deprecated` in the config of `Command.argument()` or `Application.argument()`.

**Why.** Core reads neither fact on an argument, because a positional cannot leave the grammar it sits in. The types now reject the keys, as they already did on the `Application` constructor and on the attached Command a lifecycle hook receives.

**Before and after.**

Before, this compiled and had no effect:

```ts
new Command('get').argument('path', { description: 'A path.', hidden: true });
```

After, remove the key:

```ts
new Command('get').argument('path', { description: 'A path.' });
```

**Steps.**

1. Find each `argument()` call whose config sets `hidden` or `deprecated`, for example with `tsc` errors on `An argument declares no hidden fact` or `An argument declares no deprecated fact`.
2. Remove the key. To hide or deprecate the work an argument belongs to, set `hidden` or `deprecated` on its Command or on an option instead.

**Validation.** Run `tsc --noEmit` and confirm that no argument declaration reports either message. Run the application's tests, which behave as before because neither key ever had an effect.
