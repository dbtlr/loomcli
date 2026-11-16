- Add `requires(option, ...needed)` on a Command, on the Application root, on the attached Command a lifecycle hook receives, and on an option set, so supplying one option requires others while the others alone are accepted: `.requires('password', 'user')` accepts `--user` alone and fails `--password` alone with exit 2 and `Option "--password" requires option "--user". Supply it as well, or remove "--password".` The names are typed as the declared options. The command line, the environment, and the configuration source supply an option, a default does not, and a Boolean at its absent value triggers nothing. The sentence names only the options still lacking, and no option sets another's value. See [A one-way requirement](docs/core/options.md#a-one-way-requirement).
- Change `OptionGroup`, the type of each `CommandNode.optionGroups` entry and of the manifest's `optionGroups`, to a union that adds `{ kind: 'requires', option, requires }`, and add `'requires'` to the `reason` of `InputProblem`'s group variant. The manifest's stability rule now states that an `optionGroups` entry may arrive with a new `kind` that carries its own fields in place of `options`, which a consumer skips when it does not know the kind.
- Print a requirement on the help page and the man page as `Use --password only with --user.`, and project it into an MCP tool's input schema as `dependentRequired`. The man page now prints every option-group sentence the help page prints. An MCP tool that excludes an option a requirement needs, while it does not exclude the requirement's option, is a build fault under `@loomcli/plugins/mcp/required-input-excluded`.
- Report a discarded `requires()` call under `@loomcli/eslint-plugin`'s `discarded-declaration` rule.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is code that reads `options` from an entry of `CommandNode.optionGroups`, or of the manifest's `optionGroups`, without narrowing its `kind` first.

**Why.** A requirement names one option and the options it needs, so its entry carries `option` and `requires` in place of `options`, and `OptionGroup` became a union of the two shapes.

**Before and after.**

Before:

```ts
const members = command.optionGroups.flatMap((group) => group.options);
```

After:

```ts
const members = command.optionGroups.flatMap((group) =>
  group.kind === 'requires' ? [group.option, ...group.requires] : group.options,
);
```

**Steps.**

1. Run the type checker and find each site that reads `options` from an option group.
2. Narrow `kind` at each site, and read `option` and `requires` for a `requires` entry.
3. Where code reads a manifest as JSON, handle an `optionGroups` entry whose `kind` is `requires`, which carries no `options` key, and skip an entry whose `kind` the code does not know, as the manifest's stability rule now states.

**Validation.** Run `tsc --noEmit` on the application, then its test command.
