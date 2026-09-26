- Change `validate` on a multiple option or a variadic argument to name the validator for one value. Core runs it once for each value in order, and the action receives the array of outputs. An issue reads at its value's position, as `Option "--field" at 1: Expected a nonempty value.`
- Change an omitted multiple option or variadic argument to call no validator. The action receives `[]`, and `required: true` remains the rule for at least one value.
- Change a validated default of a multiple option or a variadic argument to an array of the validator's input type. Each default value passes through the validator, and a rejected one names its position.
- Change the input schema of a multiple option or a variadic argument to the validator's own schema, unchanged. Help reads its accepted values from the top of that schema instead of under `items`.
- Change input diagnostics to say "validator" where they said "schema", such as `default must be an array of strings without a validator.`

### Migration

**Affected surface.** A multiple option or a variadic argument that declares `validate` with a validator of the whole array, such as `z.array(...)`, a rule over the list, or a transform of the list. A manifest or help reader that looks for accepted values under `items`. Code that matches the text of the reworded diagnostics.

**Why.** A validator now means the same thing wherever it is declared, so a validator such as `integer()` works on a single option and on a multiple one. See [ADR-0036](docs/decisions/0036-each-value-passes-the-same-validator.md).

**Before and after.**

Before:

```ts
.option('field', {
  multiple: true,
  type: 'string',
  validate: z.array(z.string().min(1)).max(3, 'Supply at most three fields.'),
})
```

After:

```ts
.option('field', { multiple: true, type: 'string', validate: z.string().min(1) })
.action(({ options }) => {
  if (options.field.length > 3) {
    throw new InputError('Option "--field": Supply at most three fields.', [
      {
        input: { global: false, kind: 'option', name: 'field' },
        issues: [{ message: 'Supply at most three fields.' }],
        reason: 'invalid',
        spelling: '--field',
      },
    ]);
  }
  // ...
});
```

**Steps.**

1. Replace each `z.array(value)` validator on a multiple option or a variadic argument with `value`.
2. Move any rule over the whole list, such as a count, uniqueness, or a rule for an empty list, into the action. Throw `InputError` from the action to keep exit code 2.
3. Move any transform of the whole list into the action, which now receives the array of each value's output.
4. Read the accepted values of a multiple option or a variadic argument from the top of its input schema, beside the node's `multiple` or `variadic` flag.

**Validation.** Run the application's type check: TypeScript rejects a validator on a multiple option or a variadic argument whose input does not accept one `string`. Run the application's tests for each migrated input with no values, one value, and a rejected value.
