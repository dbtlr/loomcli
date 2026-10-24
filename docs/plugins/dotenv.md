---
description: "The dotenv plugin: which variables a .env file sets for a run."
---

# Dotenv plugin

`@loomcli/plugins/dotenv` imports every variable `.env` in `host.cwd` defines that the process has not set, before defaults, implied values, and inputs validate.
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
Failures identify the variable without `.env` provenance.

Only an argv `run()` whose [process handle](../core/host.md#the-process-handle) has a `publishEnv` copies additions out, and a handle `processHandle` builds has one, which copies them into `process.env` for libraries and the programs a library starts itself, only when it was given neither `env` nor `cwd`.
Other supplied fields do not suppress that copy, and it preserves every existing process variable, including an empty one. A hand-built handle's `publishEnv` decides for itself what it does with each addition.
A run whose handle has no `publishEnv` changes only its snapshot, and so does every invocation by name: `app.invoke()` never calls `publishEnv`.
An action's `invoke()` inherits its parent's prepared environment without reading the file again.
Process additions persist after the run. The snapshot is case-sensitive.

The plugin reads no parent or home directory, alternate filename, mode sibling, or layered file.
A supplied environment does not disable the file read. Isolated tests also supply their fixture's `cwd`.
Missing files and directories named `.env` are silent. Other read errors warn once and contribute no values.
UTF-8 decoding replaces invalid bytes. The reader detects no alternate encoding and follows symbolic links.

The file accepts a leading BOM, LF or CRLF, horizontal whitespace, an optional `export` prefix, and `NAME=value` assignments.
Unquoted values trim surrounding spaces and tabs. A hash starts a comment at the start of a value or after a space or tab.
Single quotes preserve literal content, with no escape, and may span lines, so a private key reads as one value.
Double quotes may span lines and decode `\n`, `\r`, `\t`, `\"`, and `\\`; other escapes stay literal.
CRLF normalizes to LF, including inside multiline values. A quoted value permits only whitespace and a comment after its closing quote.
There is no variable expansion. Empty values are valid, and NUL is invalid.
The last valid duplicate assignment wins within the file. A malformed duplicate leaves earlier valid assignments intact.

A malformed assignment whose name the plugin would import warns once with its name and starting line, without printing file text or values:

```text
Skipped API_TOKEN on line 4 of .env: the line is not a valid assignment. Correct the line, or remove it.
```

A malformed assignment the plugin would not import stays silent. Quoted regions are consumed for every name.
An unterminated quote of either kind consumes the rest of the file and warns once for its starting line.
These rules and the exact warning-name boundaries are specified in [ADR-0084](../decisions/0084-dotenv-prepares-an-allowlisted-environment-before-inputs.md), and [ADR-0102](../decisions/0102-dotenv-imports-every-variable-the-process-has-not-set.md) carries them forward.
Warnings do not change the exit code and are captured in a named invocation's `messages`.
