# Validators reference

`@loomcli/validators` ships the validator catalog: factories that return ordinary [Standard Schema](https://standardschema.dev/) values for the input shapes a command-line author would otherwise need a schema library for. [ADR-0037](decisions/0037-validators-ship-in-their-own-package-as-standard-schema-values.md) records the decision. Core cannot tell a catalog validator from a Zod schema, so an input that needs more than the catalog offers passes a schema library's value in the same `validate` slot.

```ts
import { Application } from '@loomcli/core';
import { integer, oneOf, path, port } from '@loomcli/validators';
import { z } from 'zod';

const app = new Application('serve')
  .option('port', { type: 'string', validate: port(), default: '8080' })
  .option('workers', { type: 'string', validate: integer({ min: 1, max: 64 }) })
  .option('mode', { type: 'string', validate: oneOf(['dev', 'prod']), default: 'dev' })
  .option('root', { type: 'string', validate: path({ access: 'read', kind: 'directory' }) })
  .option('branch', { type: 'string', validate: z.string().regex(/^[a-z0-9-]+$/) })
  .action(({ options }) => {
    const listen: number = options.port;
    const mode: 'dev' | 'prod' = options.mode;
    // ...
  });
```

An author climbs these rungs, and each pays only for itself:

1. **No `validate`.** The action receives the raw string, and the input schema is unknown.
2. **A catalog factory.** The action receives a typed value, a rejected token reads as a plain message, and help and the manifest read the published input schema.
3. **`createValidator`.** The author's own parse function, built the same way as every catalog factory.
4. **A schema library.** Any Standard Schema value, in the same slot.

## Shared rules

**Values.** Every factory returns a `StandardSchemaV1<string, Output>` that also implements `StandardJSONSchemaV1`, with `vendor` `'@loomcli/validators'`. Its input is one raw string. `validate` is synchronous except under `path`, which probes the filesystem. The value is frozen and holds no state between calls, so one validator may serve many inputs.

**Multiple options and variadic arguments.** On a multiple option or a variadic argument, the same validator checks each value under [ADR-0036](decisions/0036-each-value-passes-the-same-validator.md). `option('tag', { multiple: true, type: 'string', validate: text({ maxLength: 32 }) })` gives the action `string[]`, and the input schema is `text()`'s own.

**Omission.** A catalog validator's input type is `string`, so it cannot sit beside `validateOmitted: true`, whose validator's input type must accept `undefined`. A rule about omission is a hand-written Standard Schema value, as [Absence and defaults](core.md#absence-and-defaults) shows.

**Defaults.** A default is a raw string in the validator's input type, `default: '8080'` for `port()`, and passes through the validator like a token. Core validates every declared default once per run, before parsing and whether or not the invocation supplies the input, so a default the validator rejects fails every run with a `DeclarationError`, even one that overrides it.

**Published input schemas.** A factory publishes the JSON Schema of the value its token stands for, under the rule of [Input schema](core.md#input-schema): `integer()` publishes `type: 'integer'`, and `url()` publishes the string. Each factory lists its keywords below, and [createValidator](#createvalidator) states how every validator publishes them.

**Soundness.** A published input schema is sound, not complete. Every token the validator accepts satisfies it, so it may be looser than the validator and never stricter. A constraint the validator applies but cannot state soundly is left out: `path` publishes no existence. The rule binds every factory and every author of a `createValidator` value that declares `inputSchema`.

**Messages.** A rejection returns one issue with no path and no code. Its message states the expectation in one plain sentence, beginning `Expected`, and never repeats the caller's token, because a rejected value may be a secret. Each factory configuration has one message for every way a token can fail, so `integer({ min: 1, max: 10 })` answers `Expected a whole number from 1 through 10.` for `abc` and for `11` alike. `text` with a `pattern` is the one exception: its length rule and its pattern each keep their own sentence. Core prefixes the message with the input's subject under [Issues and validator failures](core.md#issues-and-validator-failures).

**Faults at the call.** A factory argument that can never work throws a `DeclarationError` from the factory call, under [ADR-0034](decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md). Each factory lists its faults. A fault message names the factory and the argument, states the problem, then the correction, as `integer() min 5 is above max 1. Supply a min at or below max.` and `oneOf() lists "dev" twice. List each value once.` TypeScript rejects what its types can express; the runtime check covers the rest for JavaScript callers and widened values.

## Catalog

### text

```ts
text(options?: { minLength?: number; maxLength?: number; pattern?: RegExp; message?: string }): Validator<string>
```

- **Accepts** a string whose length, counted in Unicode code points, is at least `minLength` and at most `maxLength`, and which `pattern` matches when one is given. `minLength` defaults to `1`, so `text()` rejects the empty string; `text({ minLength: 0 })` accepts it.
- **Output** is the token unchanged.
- **Publishes** `{ type: 'string', minLength, maxLength?, pattern? }`, with `minLength` always present and `pattern` as the expression's `source`. JSON Schema counts length in code points as well.
- **The pattern** is matched with the `u` flag whether or not the author wrote it, because JSON Schema reads a `pattern` under Unicode rules. A pattern that is not anchored matches anywhere in the token, in the validator and in the published schema alike, so write `^...$` to constrain the whole value.
- **Messages.** A length failure reads the sentence for the effective bounds, where `min` is `minLength` after its default, and a count of 1 reads `character` rather than `characters`. With no `maxLength` and a `min` of 0, no length failure exists.

| Bounds                          | Sentence                                     |
| ------------------------------- | -------------------------------------------- |
| `min` 1, no `maxLength`         | `Expected a nonempty value.`                 |
| `min` above 1, no `maxLength`   | `Expected at least 2 characters.`            |
| `min` 0, `maxLength`            | `Expected at most 32 characters.`            |
| `min` equal to `maxLength`      | `Expected exactly 8 characters.`             |
| `min` 1 or more, `maxLength` above it | `Expected from 1 through 32 characters.` |

- **Pattern failures.** A pattern failure reads `message`, or `Expected a value that matches the required pattern.` when none is given. A token that fails both reports the length sentence.
- **Faults.** A `minLength` or `maxLength` that is not a non-negative safe integer, `minLength` above `maxLength`, a `pattern` carrying any flag other than `u`, a `pattern` whose source does not compile under `u`, a `message` that is empty or not a string, and a `message` without a `pattern`.

### integer

```ts
integer(options?: { min?: number; max?: number }): Validator<number>
```

- **Accepts** an optional `-` followed by one or more decimal digits, whose value is a safe integer within `min` and `max`, both inclusive. Leading zeros are accepted, so `007` is 7. Whitespace, `+`, `_`, a decimal point, an exponent, and a hexadecimal, octal, or binary prefix are rejected, so `3.0` and `1e3` fail.
- **Output** is the number, with `-0` read as `0`.
- **Publishes** `{ type: 'integer', minimum?, maximum? }`.
- **Message.** `Expected a whole number.`, `Expected a whole number from 1 through 10.`, `Expected a whole number of at least 1.`, or `Expected a whole number of at most 10.`
- **Faults.** A `min` or `max` that is not a safe integer, and `min` above `max`.

The parser reads a separate token that begins with `-` as an option spelling, so a negative value reaches an option only in the attached form, `--offset=-5`, and never reaches an argument.

### number

```ts
number(options?: { min?: number; max?: number }): Validator<number>
```

- **Accepts** an optional `-`, one or more decimal digits, an optional fraction of `.` and one or more digits, and an optional exponent of `e` or `E`, an optional sign, and one or more digits, whose value is finite and within `min` and `max`, both inclusive. So `1`, `-2.5`, `0.5`, and `1e3` are accepted, and `.5`, `5.`, `Infinity`, `NaN`, whitespace, `+` before the number, `_`, and a hexadecimal prefix are rejected.
- **Output** is the number, with `-0` read as `0`.
- **Publishes** `{ type: 'number', minimum?, maximum? }`.
- **Message.** `Expected a number.`, `Expected a number from 0 through 1.`, `Expected a number of at least 0.`, or `Expected a number of at most 1.` Each bound prints as JavaScript prints the number.
- **Faults.** A `min` or `max` that is not a finite number, and `min` above `max`.

### port

```ts
port(): Validator<number>
```

- **Accepts** what `integer({ min: 1, max: 65535 })` accepts. Port 0 asks the operating system for any free port, which an author who wants it declares with `integer({ min: 0, max: 65535 })`.
- **Output** is the number.
- **Publishes** `{ type: 'integer', minimum: 1, maximum: 65535 }`.
- **Message.** `Expected a port number from 1 through 65535.`

### oneOf

```ts
oneOf<const Values extends readonly [string, ...string[]]>(values: Values): Validator<Values[number]>
```

- **Accepts** a token exactly equal to one of `values`. Matching is case-sensitive.
- **Output** is the token, typed as the union of the literals.
- **Publishes** `{ type: 'string', enum: [...values] }` in the declared order, so help prints `One of: bytes, words, lines.` under [Accepted values](core.md#accepted-values) with no authored line.
- **Message.** `Expected one of: bytes, words, lines.` It lists the author's values, never the caller's token.
- **Faults.** An empty list, a value that is not a string, an empty string, and a value listed twice. The values are copied at the call, so a later change to the declared array changes nothing.

### url

```ts
url(options?: { protocols?: readonly [string, ...string[]] }): Validator<URL>
```

- **Accepts** a token that matches the RFC 3986 `URI` production, an absolute URI with a scheme, and that `new URL(token)` also parses. The strict grammar rejects what the WHATWG parser would repair, such as a space or a backslash, because such a token is almost always a quoting mistake, and because `format: 'uri'` names RFC 3986. With `protocols`, the scheme must equal one of them, compared without regard to case.
- **Output** is the parsed `URL`.
- **Publishes** `{ type: 'string', format: 'uri' }`. With `protocols`, it adds a `pattern` anchored at the start that lists each scheme followed by `:`, spelling each letter as a two-case class, and escaping `+`, `-`, and `.` with a backslash, so `['https']` publishes `^(?:[hH][tT][tT][pP][sS]):` and `['https', 'svn+ssh']` publishes `^(?:[hH][tT][tT][pP][sS]|[sS][vV][nN]\+[sS][sS][hH]):`.
- **Message.** `Expected an absolute URL, such as https://example.com.`, or, with `protocols`, `Expected an absolute URL with the scheme https.`, `Expected an absolute URL with the scheme https or http.` for two, and `Expected an absolute URL with the scheme https, http, or ftp.` for three or more, in the declared order.
- **Faults.** An empty `protocols` list, and an entry that is not an RFC 3986 scheme name, one letter followed by letters, digits, `+`, `-`, or `.`, with no trailing `:`.

### uuid

```ts
uuid(): Validator<string>
```

- **Accepts** 32 hexadecimal digits in the groups 8, 4, 4, 4, and 12, joined by `-`, in any letter case and any version, the nil and max values included.
- **Output** is the token in lowercase, so two spellings of one identifier compare equal.
- **Publishes** `{ type: 'string', format: 'uuid' }`.
- **Message.** `Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.`

### date

```ts
date(): Validator<string>
```

- **Accepts** `YYYY-MM-DD` naming a real day of the proleptic Gregorian calendar, years 0000 through 9999, so `2024-02-29` passes and `2026-02-29` and `2026-13-01` fail.
- **Output** is the token unchanged. A calendar date has no time and no zone, and any `Date` would fix a midnight in some zone, so the action builds the type it needs.
- **Publishes** `{ type: 'string', format: 'date' }`.
- **Message.** `Expected a date as YYYY-MM-DD, such as 2026-09-25.`

### path

```ts
path(options?: { access?: 'read' | 'write'; kind?: 'file' | 'directory' | 'any' }): Validator<string>
```

- **Resolves** a nonempty token against `host.cwd` under the path rules of `host.platform`, and normalizes it. It does not resolve symbolic links. The empty string and a token containing the NUL character are rejected before any probe.
- **Output** is the absolute, normalized path.
- **Checks.** With no `access`, nothing on the filesystem is read. `kind` defaults to `'file'` when `access` is set.

| `access`  | Accepts                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent    | Any nonempty path.                                                                                                                                                                       |
| `'read'`  | An entry that exists, is of `kind`, following symbolic links, and the process can read.                                                                                                  |
| `'write'` | An entry that exists, is of `kind`, and the process can write; or, when no entry exists, a path whose parent is an existing directory the process can write. Nothing is created. |

- **The checks are advisory.** The filesystem can change between validation and the action, so the action still handles its own I/O failures. An existing file passes a `'write'` check: whether to replace it is the application's decision.
- **Verdicts and faults.** A probe that fails with `ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, `ELOOP`, `ENAMETOOLONG`, or `EINVAL` is a verdict about the operator's token, and the token is rejected with the configuration's message. A probe that fails any other way, such as `EIO`, throws, and core reports it as a validator failure under [Issues and validator failures](core.md#issues-and-validator-failures).
- **Defaults.** A default beside `access` is probed on every run, like every default, so a missing default file fails every run, even one that supplies another path. Resolve a fallback path in the action instead of declaring one as the default.
- **The context.** `path` reads `host.cwd` and `host.platform` from the [validation context](core.md#validation-context), so it runs only inside a Loom run.
- **Publishes** `{ type: 'string', minLength: 1 }`. Existence, kind, and access are runtime state, not a shape of the token, so none is published.
- **Message.** One sentence per configuration: `Expected a path.`, `Expected a readable file that exists.`, `Expected a readable directory that exists.`, `Expected a readable file or directory that exists.`, `Expected a writable file, or a new file in a writable directory.`, `Expected a writable directory, or a new directory in a writable directory.`, and `Expected a writable path, or a new path in a writable directory.`
- **Faults.** `kind` without `access`, and an `access` or `kind` outside its set.

## createValidator

```ts
createValidator<Output>(definition: {
  parse: (raw: string, context: ValidationContext) => ParseResult<Output> | Promise<ParseResult<Output>>;
  inputSchema?: Readonly<Record<string, unknown>>;
}): Validator<Output> // or StandardSchemaV1<string, Output> without inputSchema

type ParseResult<Output> = StandardSchemaV1.Result<Output>; // { value } or { issues }
```

```ts
const branch = createValidator({
  parse: (raw) =>
    /^[a-z0-9-]+$/u.test(raw)
      ? { value: raw }
      : { issues: [{ message: 'Expected lowercase letters, digits, and hyphens.' }] },
  inputSchema: { type: 'string', pattern: '^[a-z0-9-]+$' },
});
```

- **`parse`** receives one raw string and the validation context, and returns the Standard Schema result, `{ value }` or `{ issues }`, directly or as a promise. The output type is inferred from `value`. A throw or a rejected promise is not a verdict; core reports it as a validator failure.
- **`inputSchema`** is the JSON Schema the validator publishes, stated as plain data and copied and frozen at the call. The author owns its soundness. Without it the value implements no `jsonSchema`, and the input schema reads `null`, unknown, under [Input schema](core.md#input-schema).
- **Publishing.** With `inputSchema`, `'~standard'.jsonSchema.input({ target: 'draft-2020-12' })` returns a new plain object on every call: `$schema: 'https://json-schema.org/draft/2020-12/schema'` followed by the keywords of `inputSchema`. Any other target throws, as the standard permits. `'~standard'.jsonSchema.output` throws for every target, because the output side is the action's business and core never asks for it. These rules hold for every catalog factory, since each is built with `createValidator`.
- **The context outside a run.** Core attaches the context to every call it makes. When `validate` is called any other way, such as in a unit test, `parse` receives a context whose every field throws a `DeclarationError` reading `This validator reads the validation context, which only exists during a Loom run.` when read. A validator that never reads the context works anywhere; one that reads it fails at the read. A validator that reads the context is tested through an Application run with a host override.
- **Faults.** A `definition` that is not a plain object, a `parse` that is not a function, an `inputSchema` that is not a plain object, and an `inputSchema` that declares its own `$schema`.

The catalog factories are built with `createValidator`, so a catalog validator and an author's own share every rule above.

## Package

- The root export holds the nine factories, `createValidator`, and the `Validator` and `ParseResult` types. `Validator<Output>` is `StandardSchemaV1<string, Output> & StandardJSONSchemaV1<string, Output>`, what every catalog factory returns; `createValidator` returns it when `inputSchema` is given and a plain `StandardSchemaV1<string, Output>` when it is not. The package has no subpath and no plugin.
- `@loomcli/core` is a peer dependency, as it is for `@loomcli/plugins`. The package imports the Standard Schema types, `ValidationContext`, `validationContext`, and `DeclarationError` from core, and adds no runtime dependency of its own.
- Under ADR-0037, the package joins the synchronized release set the way `@loomcli/plugins` did under [ADR-0020](decisions/0020-first-party-plugins-ship-in-one-package-as-subpaths.md) and [ADR-0016](decisions/0016-a-release-merge-publishes-through-one-idempotent-workflow.md): it lands with `private: true`, the maintainer publishes a `0.0.0` placeholder from a minimal manifest without `private` and binds the npm trusted publisher, an ordinary pull request removes `private` at the current synchronized version, and the next release cut publishes it. The root `build` script and `scripts/clean.mjs` list it, and the packed-consumer check that installs the published tarballs covers it beside core and plugins.

## Example coverage

- textstat declares `--metric` with `oneOf(['bytes', 'words', 'lines'])` and `--min-bytes` and `--minimum` with `integer({ min: 0 })`, replacing their Zod schemas, so the rejected-value message for `TEXTSTAT_MIN_BYTES` reads `Option "--min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.` `inspect()` reports `metric` with the `enum` and `min-bytes` with `{ type: 'integer', minimum: 0 }` beside `$schema`.
- textstat's `files` rule, a nonempty list or piped stdin, moves into its action under ADR-0036: an empty list with a terminal on stdin throws an `InputError` carrying one `invalid` problem for the argument, as [Example coverage](core.md#example-coverage-1) shows, so stderr still reads `Invalid input: Argument "files": Supply file arguments or pipe text to stdin.` with exit code 2.
- jsonkit's `select` declares `--field` with `text()`, so `--field a -F ''` fails with `Option "--field" at 1: Expected a nonempty value.`, and `inspect()` reports `{ type: 'string', minLength: 1 }` beside `$schema`.
- jsonkit's global `--file` keeps its hand-written validator, because it reads omission through `validateOmitted`.

## Acceptance

- **Soundness.** For each factory, a table of accepted tokens validates, under Ajv's draft 2020-12 validator with `ajv-formats` in full mode and `unicodeRegExp` on, the value the token stands for against the published schema: the number for `integer`, `number`, and `port`, and the token for every other factory. A test fails when any accepted token breaks the schema. The table includes each factory's edges: code points outside the Basic Multilingual Plane for `text`, `-0`, leading zeros, and safe-integer limits for the numbers, the leap day for `date`, including `0000-02-29` accepted and `0100-02-29` rejected, since a `Date.UTC` check maps years below 100 to the 1900s, mixed case for `uuid` and a `protocols` scheme, a `protocols` scheme containing `+`, `-`, or `.`, and for `url` the tokens RFC 3986 rejects and the WHATWG parser repairs.
- **Rejection.** For each factory, a table of rejected tokens pins the one message and shows the token is absent from it.
- **Faults.** Each listed fault throws `DeclarationError` from the factory call.
- **Context.** A context-free factory validates when called directly; `path` called directly throws the context sentence; `path` inside a run resolves against a host override's `cwd`, using temporary directories for the `read` and `write` checks.
- **Multiple options and variadic arguments.** Core runs the validator once per value, reports each issue at its position, validates each default value, publishes the validator's schema unchanged, and calls nothing when no value is supplied, under ADR-0036.
- **Help.** A `oneOf` input of at most eight values prints `One of: ...` with no authored `accepts`, under help's limit of eight.

## Not in 0.5.0

- `dateTime` and `duration`. No settled use shows how an operator would type them; an author who needs one builds it with `createValidator`.
- `email` and a JSON validator. Every simple email rule rejects a real address somewhere, and a JSON value on a command line is better served by a file.
- Reading a file or piped stdin as one stream of content, which is its own feature rather than a check.
- Issue codes, which enter with a reader: custom failure rendering keyed by code.
- Case-insensitive `oneOf`, a `uuid` version filter, custom date layouts, bounds on anything other than numbers and length, and a composition utility.
