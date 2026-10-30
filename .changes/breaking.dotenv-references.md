- Add variable references to a dotenv value. An unquoted or double-quoted value expands `$NAME`, `${NAME}`, and `${NAME:-default}` against the process environment and the values read before it, and `\$` reads as a literal dollar. Single quotes stay literal, and `$(command)` is never run. A value that held a `$` before now expands it, so `PASSWORD=pa$$word` reads `pa$`, and `\$` reads `$` where it read `\$`.

### Migration

**Affected surface.** Applications that install `dotenv()` from `@loomcli/plugins/dotenv`, and any unquoted or double-quoted value in a dotenv file the application reads that holds a `$`, such as a password or a URL.

**Why.** Bun's own loader expands references in every value, so one file read two ways. The plugin now expands them as Bun does.

**Before and after.**

Before, in `.env`, the value read `pa$$word`:

```sh
PASSWORD=pa$$word
```

After, the same line reads `pa$`, because `$$word` holds no name after its first `$` and `$word` is a reference to an unset name. Quote the value in single quotes to keep every `$`:

```sh
PASSWORD='pa$$word'
```

**Steps.**

1. Find the unquoted and double-quoted values that hold a `$` in every dotenv file the application reads: `.env`, `.env.local`, and the mode files.
2. Wrap each value that must keep its `$` literal in single quotes, or write each such `$` as `\$`.
3. Wrap a value that holds `\$` in single quotes, so its backslash stays.
4. Leave a value that holds no `$`, and a single-quoted value, as it is.

**Validation.** Run the application and check that each variable holds its whole value, for example by printing the option the variable feeds. A value that lost the text after a `$` was not quoted.
