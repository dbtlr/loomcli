- Change core's default text for every `UsageError` to open with the application name and a colon in place of `Invalid input: `, so `jsonkit nope` prints `jsonkit: Unknown command "nope". Use one of: get, keys.` `Invalid declaration: ` and `Internal error: ` are unchanged. See [Failure messages](docs/failure-messages.md).
- Change `candidates` on `UnknownCommandError` and `NonCallableCommandError` to leave out deprecated children, as completion does. A deprecated Command typed in full still routes. With no candidates, the sentence ends with its fix: `Supply the name of a declared command.` or `Supply the name of a declared subcommand.` See [Failure classes](docs/core.md#failure-classes).
- Change the root's failure with no subcommand to `A command is required.`, followed by its candidates or its fix, and the issue for a validator that rejects with no issues to `The validator rejected this value without an explanation. Supply a different value.`
- Change core's failure sentences to escape every typed token, option spelling, and issue path they quote through `escapeControlCharacters`, so a quoted token cannot reorder the line. The failure's public fields keep the raw values.
- Change the mixed-scope `ShortGroupError` sentence to name only the two letters that disagree, `A short group mixes the global option "-q" with "-m", which is not a global option. Supply global options as separate tokens, and local options after their command name.`, because the rest of the group may hold an inline value such as a secret. `ShortGroupError.token` still holds the whole group.
- Change the configuration plugin's `--config` failures to end with their fix: `File "<path>" does not exist. Supply the path of an existing file.`, `could not be read. Supply a file this process can read.`, `is not valid JSON. Correct its syntax, or supply another file.`, and `does not hold a JSON object. Write its settings as one JSON object.` Each warning about a discovered file ends with its fix too: `Make it readable, or remove it.`, `Correct its syntax, or remove it.`, or `Write its settings as one JSON object, or remove it.` See [Configuration](docs/core.md#configuration).
- Change the formatter's `json()` and `jsonl()` encode failure to `The value cannot be encoded as JSON. Emit plain JSON data from the action.`, and for an `undefined` value to `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.` The message no longer includes the engine's reason, which differs between Node.js and Bun; the thrown error keeps the engine's error as its `cause`.
- Add `issueCode(code, { schema, message })` to `@loomcli/validators`. It declares one namespaced issue code with its parameter schema and its sentence, and returns a frozen descriptor whose `issue(params)` builds a coded issue and whose `read(issue)` returns the typed parameters, or `undefined` for any other issue. See [Issue codes](docs/validators.md#issue-codes).
- Add the catalog's 23 code descriptors, such as `integerRangeIssue` for `@loomcli/validators/integer-range`. Every catalog rejection now carries `code` and `params` beside its message, so an `InputError` view override can reword one catalog sentence with `integerRangeIssue.read(issue)`.
- Change `path()` with no `access` to reject with `Expected a nonempty path with no NUL character.` in place of `Expected a path.`
- Change `text()` to require `message` whenever `pattern` is given, and remove the default sentence `Expected a value that matches the required pattern.` See [text](docs/validators.md#text).

### Migration

**Affected surface.** Every `text()` call from `@loomcli/validators` that passes `pattern` without `message`.

**Why.** The default sentence told the operator that a pattern exists without saying what it accepts. Only the author can say that, so the sentence for a pattern failure is now the author's `message`. See [ADR-0048](docs/decisions/0048-a-validator-package-declares-one-issue-code-per-sentence.md).

**Before and after.**

Before:

```ts
import { text } from '@loomcli/validators';

app.option('slug', { type: 'string', validate: text({ pattern: /^[a-z0-9-]+$/ }) });
```

After:

```ts
import { text } from '@loomcli/validators';

app.option('slug', {
  type: 'string',
  validate: text({
    pattern: /^[a-z0-9-]+$/,
    message: 'Expected lowercase letters, digits, and hyphens.',
  }),
});
```

**Steps.**

1. Find each `text()` call that passes `pattern`.
2. Add `message`: one sentence, beginning `Expected`, that states what the pattern accepts. Do not repeat the operator's value in it.

**Validation.** Run the application's type check. A remaining call without `message` reports TS2345, `Property 'message' is missing`, and throws a `DeclarationError` at the call when it runs: `text() pattern has no message to describe it. Supply a message that states what the pattern accepts.` Run a Command with a value the pattern rejects and confirm that stderr prints the new `message` after the input's name.
