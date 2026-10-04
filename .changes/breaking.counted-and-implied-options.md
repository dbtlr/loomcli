- Add counted options. `type: 'count'` declares an option that takes no value and reads, as a `number`, how many times it was supplied across every spelling, alias, and word, so `-vvv`, `-v -v -v`, and `--verbose -vv` each read `3` and an omitted one reads `0`. A global counted option adds its occurrences on both sides of the Command name. A value attached to a counted spelling, as in `--verbose=3`, is the unexpected-value error, worded to tell the operator to repeat the spelling instead. An environment variable of ASCII decimal digits and a configuration answer of a whole number of 0 or more fill it when no occurrence did. A counted option declares no `validate`, `default`, `required`, `validateOmitted`, `multiple`, `polarity`, or `implied`, which TypeScript rejects and the call rejects under `@loomcli/core/count-option-value-rule`, `@loomcli/core/count-option-multiple`, `@loomcli/core/polarity-on-count`, and `@loomcli/core/implied-on-boolean-or-count`. Help prints its row as `-v, --verbose...`. See [Counted options](docs/core.md#counted-options) in the [core reference](docs/core.md).
- Add `implied` to a string option, the value a bare spelling supplies. `--backup` and `-b` supply it, an explicit value is attached as `--backup=numbered`, `-bnumbered`, or `-b=numbered`, and a bare spelling never takes the next word. Each run passes the implied value through the option's validator before it reads a token, and a rejected one is the declaration error `@loomcli/core/invalid-implied`. Input sources never supply it. `implied` on a Boolean or counted option and an `implied` that is not a string are rejected under `@loomcli/core/implied-on-boolean-or-count` and `@loomcli/core/implied-not-a-string`. Help prints the option as `-b, --backup[=<control>]` with the fact `implied: <value>`, and completion offers its values only after `=` or the letter. See [Implied values](docs/core.md#implied-values) in the [core reference](docs/core.md).
- Change `OptionNode`, `OptionConfig`, and the manifest's option entry type to unions of three kinds: each gains a `count` variant, which carries no `negative`, `polarity`, `required`, `multiple`, or `default`, and the string variants gain `implied`, the implied value or `null`. `SuppliedInputs.options` and `SourceAnswer.value` admit a `number` for a counted option. TypeScript code that narrows one of these unions by `type` in two ways, or that types a validator's `context.supplied.options` values, no longer compiles until it handles the third kind.

### Migration

**Affected surface.** TypeScript code that reads `OptionNode` from `inspect()`, a lifecycle hook, a configuration source's `requests`, or a failure hook, or that reads an option entry of the manifest document, and narrows by `type` in two ways, such as `option.type === 'boolean' ? option.negative : option.default`. A validator that types the values of `context.supplied.options` as `string | readonly string[] | boolean | undefined`. Code that assigns `OptionConfig` to a type that names only `StringOption` and `BooleanOption`.

**Why.** A counted option is a third kind of option under [ADR-0057](docs/decisions/0057-a-counted-option-counts-its-occurrences-and-an-implied-value-fills-a-bare-spelling.md). It has no default, polarity, or negative spelling, so code that treats every option that is not Boolean as a string option reads fields a counted option does not have, and its token is a number.

**Before and after.**

Before, every option that was not Boolean was a string option:

```ts
const facts = (option: OptionNode) =>
  option.type === 'boolean' ? option.negative : option.default;

const supplied: string | readonly string[] | boolean | undefined = context.supplied.options.verbose;
```

After, the string variant is narrowed by its own tag, and a supplied count is a number:

```ts
const facts = (option: OptionNode) => {
  switch (option.type) {
    case 'boolean':
      return option.negative;
    case 'string':
      return option.default;
    case 'count':
      return undefined;
  }
};

const supplied: string | readonly string[] | boolean | number | undefined =
  context.supplied.options.verbose;
```

**Steps.**

1. Find each narrowing of `OptionNode`, `OptionConfig`, or a manifest option entry by `type` that assumes two kinds, such as a conditional on `'boolean'` or `'string'` alone.
2. Narrow the string variant by `type === 'string'`, and handle `type === 'count'`, whose node carries `long`, `short`, `aliases`, `env`, and `schema: null` and no value facts.
3. Add `number` to any type that holds a value of `SuppliedInputs.options` or of a configuration source's `SourceAnswer.value`.
4. A consumer of the manifest JSON reads an entry whose `type` it does not know by the fields it knows, under the manifest's stability rule, so JSON consumers need no change.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and expect no error at a narrowing of `OptionNode` or a manifest option entry. Run `inspect()` on an application that declares a counted option and check that each projection the application builds reads its node.
