- Change how core reads an invocation. Routing reads the words before the first bare `--` against the global options alone, the routed Command's words are read against one table of its own options and every global option, and each owner reads its values, under [ADR-0055](docs/decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md). See [Global consumption and routing](docs/core.md#global-consumption-and-routing).
- Allow a short group to mix a global option's letter with a letter of the routed Command, so `textstat -ht` renders help and `get a.b -qp` reads a global `-q` and `get`'s own `-p`. Read a short group under the POSIX `getopt` rule: a value letter takes the rest of its word with one leading `=` stripped, so `-mwords`, `-m=words`, `-tmwords`, and `-m=` are accepted. A word that is neither `--` and at least one character nor `-` and an ASCII letter, such as `-5`, `-.5`, `-1e3`, or `-`, is a value or an argument.
- Change a short group whose value letter is followed by more characters, such as `-mt` where `m` takes a value, to give that option the rest of the word, `t`, instead of failing. The option's validator is where such a typo surfaces.
- Add `MisplacedOptionError`, a `UsageError` with exit code 2 and the facts `spelling` and `commands`, for an option word the routed Command's table does not hold while a visible Command below it declares it, such as a Command's own option typed before the Command's name: `Option "-F" belongs to command "select". Supply it after "select".` Such an invocation reported `UnknownOptionError` before.
- Remove `ShortGroupError`. An undeclared letter of a short group is an `UnknownOptionError` that names that letter, a `=` after a Boolean letter is an `UnexpectedValueError`, and a repeated letter is a `RepeatedOptionError`. The walk stops at the first letter that faults, so the characters after it supply nothing.
- Change every fault except an unknown command to be held to the dispatch boundary, so a middleware such as help can take it over. A structural fault on a global option, such as a missing value, a repeated option, or a value after a Boolean, was raised before the chain and is now held, so `jsonkit --file --help` and `jsonkit --help --help` render help. Parsing continues past a fault to find every global option, the first fault in word order is reported, and an occurrence that faulted supplies no value and activates no plugin. A failure view's `path` is the path routing reached.
- Change the order in which faults rank: an unknown command, then the first structural fault in word order, then a group's missing subcommand, then validation problems. `store cache --verbose` reports the unknown option instead of the missing subcommand, and `jsonkit --file --quiet nope` reports the unknown command instead of the missing value.
- Add the attached form to the missing-value sentence when the word after a value option is an option word or `--`: `Option "--pattern" requires a value. Supply a value after "--pattern", or attach one that starts with a hyphen as "--pattern=<value>".` `MissingValueError` takes an optional second constructor argument, `'attached'` or `'separate'`, which selects the sentence.

### Migration

**Affected surface.** Code that imports `ShortGroupError`, overrides its view, or reads its `reason` or `token`. Code that matches `UnknownOptionError` for an option typed before its Command's name. A middleware or a test that expects a structural fault on a global option to be raised before the middleware chain, or that pins which failure an invocation with several faults reports. An application whose operators rely on `-mt` failing when `m` takes a value.

**Why.** The global pre-scan read one table of global options before routing, so it rejected a short group that mixed a global letter with a local one, and it raised a global option's fault before help could take it over. Core now routes on the global options and reads the routed Command's words against one table, under [ADR-0055](docs/decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md).

**Before and after.**

Before, a view override matched the short-group fault:

```ts
import { override, ShortGroupError } from '@loomcli/core';

const views = [override(ShortGroupError, { render: (failure) => `app: ${failure.message}\n` })];
```

After, the override matches the misplaced-option fault, and a short-group fault reaches the view of its own class:

```ts
import { MisplacedOptionError, override } from '@loomcli/core';

const views = [
  override(MisplacedOptionError, {
    render: (failure) => `app: Run "${failure.commands[0]?.join(' ')} --help" for ${failure.spelling}.\n`,
  }),
];
```

**Steps.**

1. Remove each import and `override()` of `ShortGroupError`. Match `UnknownOptionError`, `UnexpectedValueError`, or `RepeatedOptionError` for a fault inside a short group.
2. Match `MisplacedOptionError` where code matched `UnknownOptionError` for an option typed before its Command's name, and read `commands` for the paths of the Commands that declare it.
3. In a middleware that runs on every invocation, handle a run whose global option faulted: `options` and `request` are `null`, and core raises the fault after the chain unless the middleware takes the invocation over.
4. Update tests that pin the failure an invocation reports to the new ranking: an unknown command, the first structural fault in word order, a group's missing subcommand, then validation problems.
5. Give a value option a validator where a mistyped group such as `-mt` must fail.

**Validation.** Run the application's type check, such as `tsc --noEmit`, to find each use of `ShortGroupError`. Run the application's tests, then run it with a mixed short group such as `app -h<letter>` for a local Boolean letter, and check that it renders help with exit code 0.
