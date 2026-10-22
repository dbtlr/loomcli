- Change `argument()` on a `Command` and on an `Application` to reject, at compile time, every config key that `ArgumentConfig` does not declare, such as `hidden`, `deprecated`, `multiple`, `env`, `control`, `aliases`, `short`, and `implied`. Core reads none of them on an argument, so a config that set one compiled in 0.14.0 and had no effect.

### Migration

**Affected surface.** Applications and plugins that pass a key `ArgumentConfig` does not declare in the config of `Command.argument()` or `Application.argument()`.

**Why.** Core reads only the keys `ArgumentConfig` declares from an argument. The types now reject the rest, as they already did on the attached Command a lifecycle hook receives.

**Before and after.**

Before, this compiled and had no effect:

```ts
new Command('get').argument('path', { description: 'A path.', multiple: true });
```

After, remove the key:

```ts
new Command('get').argument('path', { description: 'A path.' });
```

**Steps.**

1. Find each `argument()` call that fails with `An argument declares no <key> key`.
2. Remove the key. To read many values, declare the argument `variadic: true`. To bind an environment variable or another option-only behavior, declare an option in place of the argument. To hide or deprecate the work an argument belongs to, set `hidden` or `deprecated` on its Command or on an option.

**Validation.** Run `tsc --noEmit` and confirm that no argument declaration reports the message. Run the application's tests, which behave as before because none of these keys ever had an effect.
