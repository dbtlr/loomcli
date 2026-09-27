- Remove presence rules from global options. `Application.globalOption()` rejects `required` and `validateOmitted`, whatever their value: TypeScript reports a compile error, and the call throws a `DeclarationError` for a JavaScript caller. An omitted global option is `undefined`, its default, or `[]`, so a Command that reads no such value, a plugin Command included, runs without it. See [ADR-0044](docs/decisions/0044-a-global-option-declares-no-presence-rule.md).

### Migration

**Affected surface.** Applications that pass `required` or `validateOmitted` to `Application.globalOption()`.

**Why.** A global option's validation runs on every Command, so a rule that the value must be supplied failed Commands that never read it, such as a plugin's `doctor` or shell completion Command.

**Before and after.**

Before:

```ts
const configured = new Application('jsonkit').globalOption('file', {
  required: true,
  type: 'string',
});

export const getValue: ActionHandler<typeof get> = async ({ options, out }) =>
  out.print(options.file);
```

After, the global is optional and each action that needs the value checks for it:

```ts
const configured = new Application('jsonkit').globalOption('file', { type: 'string' });

export const getValue: ActionHandler<typeof get> = async ({ options, out }) => {
  if (options.file === undefined) {
    throw new InputError('Option "--file": Supply a file.', [
      {
        input: { global: true, kind: 'option', name: 'file' },
        issues: [{ message: 'Supply a file.' }],
        reason: 'invalid',
        spelling: '--file',
      },
    ]);
  }
  return out.print(options.file);
};
```

**Steps.**

1. Remove `required` and `validateOmitted` from every `globalOption()` call.
2. Where the omission rule lived in a validator under `validateOmitted`, remove that validator or keep only the part that checks a supplied value.
3. In each action that needs the value, check for `undefined` and throw an `InputError`, or declare a default when one value fits every Command.
4. Update the type of each read from `string` to `string | undefined` where no default was added.

**Validation.** Run the application's type check; any remaining `required` or `validateOmitted` on a global is a compile error. Run each Command that does not read the global with the global omitted, and confirm it exits 0. Run each Command that does read it with the global omitted, and confirm it reports the input error with exit code 2.
