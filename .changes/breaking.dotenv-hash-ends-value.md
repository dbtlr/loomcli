- Change the dotenv plugin to end an unquoted value at its first `#`, wherever it stands, as Node's `--env-file`, the `dotenv` package, and Bun read one. `URL=a#b` now reads `a`, and `PASSWORD=ab#cd` reads `ab`. Before, a `#` started a comment only at the start of a value or after whitespace.

### Migration

**Affected surface.** Applications that install `dotenv()` from `@loomcli/plugins/dotenv`, and any `.env` file whose unquoted value holds a `#` that follows another character, such as a URL fragment or a password.

**Why.** Node's `--env-file`, the `dotenv` package, and Bun end an unquoted value at any `#`, so one file read two ways. The plugin now reads the value they read.

**Before and after.**

Before, in `.env`, the value read `https://example.test/docs#intro`:

```sh
DOCS_URL=https://example.test/docs#intro
```

After, the same line reads `https://example.test/docs`. Quote the value to keep the `#`:

```sh
DOCS_URL="https://example.test/docs#intro"
```

**Steps.**

1. Find the unquoted values that hold a `#` after other text in every dotenv file the application reads: `.env`, `.env.local`, and the mode files.
2. Wrap each such value in double quotes, or in single quotes when it also holds a `$`.
3. Leave a value that holds no `#`, and a value that is already quoted, as it is.

**Validation.** Run the application and check that each variable holds its whole value, for example by printing the option the variable feeds. A value that stops at its first `#` was not quoted.
