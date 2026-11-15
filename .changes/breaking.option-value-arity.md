- Add `arity` to string options, so one occurrence takes a fixed number of words: `.option('point', { arity: 2, type: 'string', validate: integer() })` reads `--point 3 4` as `[3, 4]`, typed as a tuple of the validator's output. With `multiple: true`, each occurrence adds one tuple. The words are the separate words after the spelling, so `--point=3 4` and too few words each fail with exit 2 and a sentence that says what to type instead. One validator checks each word and reports an issue at the word's position. A scalar arity option binds `env` beside `envDelimiter`, whose value splits into exactly that many items, the configuration plugin answers it from an array of that many items, and `invoke` takes a tuple. See [Option value arity](docs/core/options.md#option-value-arity).
- Add `arity` to `OptionNode`'s string variant and to the manifest's option entry, `null` on an option without one. Help and the man page print the placeholder once per word, MCP publishes a fixed-length array, and completion offers a value for each word.
- Add `arity` to `MissingValueError`, with an optional third constructor parameter that carries the count, and the `'arity'` kind to `UnexpectedValueError`.
- Change `SuppliedInputs.options`, the type of `supplied.options` in the validation context, the action context, and a question's context, to admit a list of tuples, the raw value of a multiple arity option.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is code that reads a value from `supplied.options` and, after ruling out a string, a Boolean, and a number, treats each element of the remaining array as a string.

**Why.** A multiple arity option's raw value is a list of tuples, one per occurrence, so the supplied record's array values are now either a list of strings or a list of string tuples.

**Before and after.**

Before:

```ts
const fields = context.supplied.options['field'];
if (Array.isArray(fields)) {
  return fields.map((field) => field.toUpperCase());
}
```

After:

```ts
const fields = context.supplied.options['field'];
if (Array.isArray(fields)) {
  return fields.flat().map((field) => field.toUpperCase());
}
```

**Steps.**

1. Run the type checker and find each site that reads an array from `supplied.options`.
2. Where the option is never an arity option, narrow each element with `typeof element === 'string'`, or flatten the array as above.
3. Where the option is a multiple arity option, read each element as one occurrence's tuple of words.

**Validation.** Run `tsc --noEmit` on the application, then its test command.
