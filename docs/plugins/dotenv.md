---
description: "The dotenv plugin: which variables the .env files set for a run, in which order, and how a value reads."
---

# Dotenv plugin

`@loomcli/plugins/dotenv` imports every variable the dotenv files in `host.cwd` define that the process has not set, before defaults, implied values, and inputs validate.
Its identity is `@loomcli/plugins/dotenv`. It declares no options, middleware, configuration source, or Command.

```ts
import { dotenv } from '@loomcli/plugins/dotenv';

const app = new Application('app', {
	plugins: [dotenv()],
});
```

`dotenv()` takes no required setting. `dotenv({ only: ['API_TOKEN'] })` is an allow list that imports only the names it lists, and `dotenv({ except: ['PATH'] })` is a deny list that imports every name but the ones it lists, under [ADR-0102](../decisions/0102-dotenv-imports-every-variable-the-process-has-not-set.md). The settings type is a union, so one call that gives both lists is a compile error.
Names are case-sensitive and match `[A-Za-z_][A-Za-z0-9_]*`. A listed name of another form throws a `DeclarationError` at the call, because no assignment could match it: [`@loomcli/plugins/dotenv/variable-name`](../core/diagnostics.md#loomclipluginsdotenvvariable-name). A name listed twice is listed once. A name the plugin does not import never appears in a warning.
The lists govern imports by this plugin. A runtime or launcher that loads `.env` before application startup has already populated `process.env`.

An existing defined variable wins, including an empty string.
An env-bound option reads imported values through its ordinary environment tier, including an ordered list of names.
An empty variable still supplies no option value, so option resolution can fall through to another name, configuration, or a default.
Failures identify the variable without naming the file it came from.

Only an argv `run()` whose [process handle](../core/host.md#the-process-handle) has a `publishEnv` copies additions out, and a handle `processHandle` builds has one, which copies them into `process.env` for libraries and the programs a library starts itself, only when it was given neither `env` nor `cwd`.
Other supplied fields do not suppress that copy, and it preserves every existing process variable, including an empty one. A hand-built handle's `publishEnv` decides for itself what it does with each addition.
A run whose handle has no `publishEnv` changes only its snapshot, and so does every invocation by name: `app.invoke()` never calls `publishEnv`.
An action's `invoke()` inherits its parent's prepared environment without reading the files again.
Process additions persist after the run. The snapshot is case-sensitive.

## Which files it reads

The plugin reads up to four files in `host.cwd`, under [ADR-0125](../decisions/0125-dotenv-layers-mode-and-local-files-in-buns-order-expands-references-and-ends-an-unquoted-value-at-any-hash.md). Listed from least to most specific, they are the order Bun and Next.js load them in:

| File | Read when |
| --- | --- |
| `.env` | Always. |
| `.env.<mode>` | A mode is set. |
| `.env.local` | The mode is not `test`. |
| `.env.<mode>.local` | A mode is set. |

The mode is the value of `NODE_ENV` in the environment the hook receives, as written and case-sensitive, so `NODE_ENV=production` reads `.env.production` and `.env.production.local`.
A variable a file defines never chooses the mode. With `NODE_ENV` unset or empty there is no mode, and the plugin reads `.env` and `.env.local` alone.
Under `NODE_ENV=test` the plugin skips `.env.local`, so a test run reads `.env`, `.env.test`, and `.env.test.local`.
A file the list names twice, as `NODE_ENV=local` names `.env.local`, is read once, at its more specific place.

A variable more than one file defines takes the value of the most specific file that assigns it validly, and an existing defined variable still beats every file.
The plugin reads the files from the most specific to `.env`, as Bun loads them, so a later file only fills names still unset. That order decides what a [reference](#references) reads.
Bun reads `BUN_ENV` before `NODE_ENV`, loads `.env.development` and `.env.development.local` for any mode but `production` and `test`, `NODE_ENV` unset included, and loads no other mode file. The plugin reads `NODE_ENV` alone and reads `.env.<mode>` for whatever mode it names.

The plugin reads no parent or home directory and no other filename.
A supplied environment does not disable the file read. Isolated tests also supply their fixture's `cwd`.
A missing file and a directory of a listed name, such as a Python virtual environment named `.env`, are silent, each file alone. Any other read error warns once for that file, which contributes no values, while the other files still contribute:

```text
Skipped .env.local: the file could not be read. Make it readable, or remove it.
```

UTF-8 decoding replaces invalid bytes. The reader detects no alternate encoding and follows symbolic links.

## The file format

Each file accepts a leading BOM, LF or CRLF, horizontal whitespace, an optional `export` prefix, and `NAME=value` assignments.
Unquoted values trim surrounding spaces and tabs. An unquoted value ends at its first `#`, wherever it stands, as Node's `--env-file`, the `dotenv` package, and Bun read one, so `URL=a#b` reads `a` and `A=#b` reads an empty value. Quote a value that holds `#`: `URL="a#b"`.
Single quotes preserve literal content, `$` included, with no escape and no expansion, and may span lines, so a private key reads as one value.
Double quotes may span lines and decode `\n`, `\r`, `\t`, `\"`, `\\`, and `\$`; other escapes stay literal.
CRLF normalizes to LF, including inside multiline values. A quoted value permits only whitespace and a comment after its closing quote.
Empty values are valid, and NUL is invalid.
The last valid duplicate assignment wins within a file. A malformed assignment leaves valid assignments intact, earlier in its file and in every other file.

## References

An unquoted or double-quoted value expands `$NAME`, `${NAME}`, and `${NAME:-default}`, under [ADR-0125](../decisions/0125-dotenv-layers-mode-and-local-files-in-buns-order-expands-references-and-ends-an-unquoted-value-at-any-hash.md):

```sh
HOST=localhost
URL=http://${HOST}:${PORT:-8080}/api
```

With `PORT` unset everywhere, `URL` reads `http://localhost:8080/api`.
A reference reads the value the name holds at that point: its value in the hook's environment when it has one, empty included; otherwise the value a more specific file gave it; otherwise the value the last valid assignment above it in the same file gave it.
A reference to a name nothing has given a value reads as empty, and `${NAME:-default}` reads `default` in its place. An empty value is a value, so `${NAME:-default}` reads it rather than the default, as Bun reads one.
A name runs through letters, digits, and underscores, so `$1abc` is a reference to the name `1abc`. The expansion rules are Bun's. Where `dotenv-expand` differs, taking the default for an empty value, reading a name that starts with a digit as literal text, and scanning an expanded value again, the plugin follows Bun. The default may hold references of its own, and a closing brace matches its own `${`.
A value from the environment is never expanded, and an expanded value is never scanned again.
A reference reads every valid assignment the files define, including a name an allow list or a deny list keeps the plugin from importing.

`\$` reads as one `$` in an unquoted and in a double-quoted value, and no other backslash in an unquoted value is an escape.
A `$` followed by anything but a name character or `{`, an unclosed `${`, and a `${` whose inside is neither a name nor a name followed by `:-` stay literal text.
`$(command)` stays literal text, and the plugin runs no command.
Single quotes keep `$` literal, a named deviation from Bun, which expands inside single quotes too. Under Bun, Bun's expanded value is already in the process and wins.
Bun expands a file after reading all of it, so it reads a reference to a name a later line of the same file assigns as that line's unexpanded text, where the plugin reads only what lies above the reference.

## Warnings

A malformed assignment whose name the plugin would import warns once with its name, its starting line, and its file, without printing file text or values:

```text
Skipped API_TOKEN on line 4 of .env.production: the line is not a valid assignment. Correct the line, or remove it.
```

A malformed assignment the plugin would not import stays silent. Quoted regions are consumed for every name.
An unterminated quote of either kind consumes the rest of its file and warns once for its starting line.
Warnings come in the order the plugin reads the files, the most specific first.
These rules and the exact warning-name boundaries are specified in [ADR-0084](../decisions/0084-dotenv-prepares-an-allowlisted-environment-before-inputs.md), [ADR-0102](../decisions/0102-dotenv-imports-every-variable-the-process-has-not-set.md) carries them forward, and [ADR-0125](../decisions/0125-dotenv-layers-mode-and-local-files-in-buns-order-expands-references-and-ends-an-unquoted-value-at-any-hash.md) adds the file to each warning.
Warnings do not change the exit code and are captured in a named invocation's `messages`.
