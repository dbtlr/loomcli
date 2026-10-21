- Change `dotenv()` to import every variable `.env` defines that the process has not set when it takes no settings, as the `dotenv` package, Node's `--env-file`, and Bun do, under [ADR-0102](docs/decisions/0102-dotenv-imports-every-variable-the-process-has-not-set.md).
- Add `dotenv({ only })`, an allow list that imports only the names it lists, and `dotenv({ except })`, a deny list that imports every name but the ones it lists. One call that gives both is a compile error.
- Change a single-quoted value in `.env` to span physical lines as a double-quoted one does, keeping every character with no escape, so a multi-line private key reads as one value. An unterminated single quote consumes the rest of the file and warns once for its starting line.
- Remove the `variables` setting, and replace `@loomcli/plugins/dotenv/variables` with `@loomcli/plugins/dotenv/variable-name`, which rejects a listed name that is not an environment variable name. A name listed twice, and an empty list, are no longer faults.

### Migration

**Affected surface.** An application that calls `dotenv({ variables })` from `@loomcli/plugins/dotenv`, or that builds a `DotenvSettings` value with a `variables` key.

**Why.** The allow list is optional now that the plugin imports every variable by default, and it takes the name `only` beside the deny list `except`.

**Before and after.**

Before:

```ts
const app = new Application('notes', {
  plugins: [dotenv({ variables: ['NOTES_TOKEN'] })],
});
```

After:

```ts
const app = new Application('notes', {
  plugins: [dotenv({ only: ['NOTES_TOKEN'] })],
});
```

**Steps.**

1. Rename each `variables` setting passed to `dotenv()` to `only`.
2. To import every variable `.env` defines, remove the setting and call `dotenv()`.

**Validation.** Run the application's type check, which rejects a remaining `variables` key, and run a command that reads an imported variable from a `.env` file in the working directory.
