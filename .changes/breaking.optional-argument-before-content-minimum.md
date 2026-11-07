- Change `@loomcli/core/optional-argument-last` to refuse an optional argument declared before a content argument whose `min` is positive. Such an argument must receive a source, so it counts as required, and at a terminal the optional argument before it took the only bare word and left the content argument short.

### Migration

**Affected surface.** Applications that declare an optional argument before a content argument with a positive `min`, such as `app lint [profile] <files...>`.

**Why.** Bare words fill arguments left to right, so `app lint a.ts` bound `a.ts` to `profile` and then failed for want of a file. The optional argument could never be omitted, so the declaration is refused when it is written.

**Before and after.**

Before:

```ts
new Application('lint')
  .argument('profile', {})
  .argument('files', { min: 1, type: 'content', variadic: true });
```

After, with the optional argument declared last:

```ts
new Application('lint')
  .argument('files', { min: 1, type: 'content', variadic: true })
  .argument('profile', {});
```

Or make `profile` an option: `.option('profile', { type: 'string' })`.

**Steps.**

1. Find each Command that declares an optional argument before a content argument with a positive `min`.
2. Declare the optional argument after the content argument, or make it an option.
3. Run the application and fix any declaration error that names `@loomcli/core/optional-argument-last`.

**Validation.** Run the application's test command, such as `vitest run` or `bun test`, with a test that builds each changed Command. Start the application and check that it no longer throws `Argument "profile" is optional and precedes required argument "files"`.
