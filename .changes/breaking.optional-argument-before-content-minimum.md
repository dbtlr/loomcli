- Change `@loomcli/core/optional-argument-last` to refuse an optional argument declared before a content argument whose `min` is positive. Such a content argument must receive a source, so it counts as required. Bare words fill arguments left to right, so a lone file word bound to the optional argument and left the content argument short.

### Migration

**Affected surface.** Applications that declare an optional argument before a content argument with a positive `min`, such as `app lint [profile] <files...>`.

**Why.** `app lint a.ts` bound `a.ts` to `profile` and then failed for want of a file, so `profile` could not be omitted whenever files were named on the line. The declaration is now refused when it is written. A content argument with a positive `min` is variadic, and a variadic argument is last, so the optional argument cannot move after it: it becomes an option.

**Before and after.**

Before:

```ts
new Application('lint')
  .argument('profile', {})
  .argument('files', { min: 1, type: 'content', variadic: true });
```

After, with `profile` as an option:

```ts
new Application('lint')
  .option('profile', { type: 'string' })
  .argument('files', { min: 1, type: 'content', variadic: true });
```

An operator who typed `app lint strict a.ts` now types `app lint --profile strict a.ts`.

**Steps.**

1. Find each Command that declares an optional argument before a content argument with a positive `min`.
2. Make the optional argument an option. If a positional value is always expected, declare it `required: true` instead, so it stays an argument before the content argument.
3. Update scripts and documentation that passed the value as a bare word.

**Validation.** Run the application's test command, such as `vitest run` or `bun test`, with a test that builds each changed Command and expects no `DeclarationError`. Start the application and run each changed Command with its new option.
