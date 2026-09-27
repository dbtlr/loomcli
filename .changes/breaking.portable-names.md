- Change the rule for the application name, every Command name, and every alias to the portable name: `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-` or `.`. `new Application()`, `new Command()`, and `alias()` throw a `DeclarationError` for any other name: `Application name "bad name" is invalid. Use A-Z, a-z, 0-9, ".", "_", and "-", and do not start with "-" or ".".`, and the Command and alias diagnostics end with the same correction. Argument, option, and view names keep the bare-token rule. See [Application declarations](docs/core.md#application-declarations) and [Command declaration errors](docs/core.md#command-declaration-errors).

### Migration

**Affected surface.** Applications whose application name, Command name, or alias holds a character outside `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, or starts with `.`, such as a name with a slash, a colon, a non-ASCII letter, or a line terminator. The application name was never checked before, and Command names and aliases rejected only whitespace, `=`, and a leading hyphen. Code that matches the text of the Command name or alias diagnostic.

**Why.** Each of these names is typed as a command at a shell prompt, and shell completion writes the application name into a script. One rule shared by all three keeps every name typeable and every script safe without a per-shell escape.

**Before and after.**

Before:

```ts
const app = new Application('my tool').command(new Command('get/all').alias('ls:all').action(run));
```

After:

```ts
const app = new Application('my-tool').command(new Command('get-all').alias('ls-all').action(run));
```

**Steps.**

1. Rename each application name, Command name, and alias that holds a character outside the portable set or starts with `.`.
2. Update any test or code that matches the old Command name or alias diagnostic text.

**Validation.** Import the application's modules; a name outside the rule throws when its module evaluates. Run the application's own test command.
