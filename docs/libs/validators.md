---
description: The @loomcli/validators reference. The catalog of Standard Schema validators for common input shapes, createValidator, and the issue codes each rejection carries.
---

# Validators reference

`@loomcli/validators` ships the validator catalog: factories that return ordinary [Standard Schema](https://standardschema.dev/) values for the input shapes a command-line author would otherwise need a schema library for. [ADR-0037](../decisions/0037-validators-ship-in-their-own-package-as-standard-schema-values.md) records the decision. Core cannot tell a catalog validator from a Zod schema, so an input that needs more than the catalog offers passes a schema library's value in the same `validate` slot.

File-or-stdin inputs use core's [content input type](../core/validation.md#content-inputs), which prepares lazy handles and declares the Command's stdin target. It is separate from this validator catalog.

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

**Values.** Every factory returns a `StandardSchemaV1<string, Output>` that also implements `StandardJSONSchemaV1`, with `vendor` `'@loomcli/validators'`. Its input is one raw string. `validate` is synchronous except under `path`, which probes the filesystem. The value holds no state between calls, so one validator may serve many inputs.

**Multiple options and variadic arguments.** On a multiple option or a variadic argument, the same validator checks each value under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md). `option('tag', { multiple: true, type: 'string', validate: text({ maxLength: 32 }) })` gives the action `string[]`, and the input schema is `text()`'s own.

**Omission.** A catalog validator's input type is `string`, so it cannot sit beside `validateOmitted: true`, whose validator's input type must accept `undefined`. A rule about omission is a hand-written Standard Schema value, as [Absence and defaults](../core/validation.md#absence-and-defaults) shows.

**Defaults.** A default is a raw string in the validator's input type, `default: '8080'` for `port()`, and passes through the validator like a token. Core validates every declared default once per run, before parsing and whether or not the invocation supplies the input, so a default the validator rejects fails every run with a `DeclarationError`, even one that overrides it.

**Published input schemas.** A factory publishes the JSON Schema of the value its token stands for, under the rule of [Input schema](../core/validation.md#input-schema): `integer()` publishes `type: 'integer'`, and `url()` publishes the string. Each factory lists its keywords below, and [createValidator](#createvalidator) states how every validator publishes them.

**Soundness.** A published input schema is sound, not complete. Every token the validator accepts satisfies it, so it may be looser than the validator and never stricter. A constraint the validator applies but cannot state soundly is left out: `path` publishes no existence. The rule binds every factory and every author of a `createValidator` value that declares `inputSchema`.

**Messages.** A rejection returns one issue with no path, carrying its code and parameters under [Issue codes](#issue-codes). Its message states the expectation in one plain sentence, beginning `Expected`, and never repeats the caller's token, because a rejected value may be a secret. Each factory configuration has one message for every way a token can fail, so `integer({ min: 1, max: 10 })` answers `Expected a whole number from 1 through 10.` for `abc` and for `11` alike. `text` with a `pattern` is the one exception: its length rule and its pattern each keep their own sentence. Core prefixes the message with the input's subject under [Issues and validator failures](../core/validation.md#issues-and-validator-failures). Every message follows the rules in [Failure messages](../core/failures.md).

**Faults at the call.** A factory argument that can never work throws a `DeclarationError` from the factory call, under [ADR-0034](../decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md). Each factory lists its faults. A fault's sentence names the factory and the argument and states the problem, and its correction states the fix. TypeScript rejects what its types can express, and a factory checks only what a type cannot, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A value that bypasses the types meets the platform's own error.

Each fault carries a [diagnostic rule](../core/declaration-faults.md#developer-diagnostics) the package declares through `diagnosticRule()`, as a third-party validator package does, and its Developer Diagnostic rebuilds the call, such as `integer({ max: 1, min: 5 })`, and marks the argument or the key at fault. A value listed twice marks both entries. The package declares these rules:

- **`oneOf` values.** Every `oneOf` fault: [`@loomcli/validators/one-of-values`](../core/diagnostics.md#loomclivalidatorsone-of-values).
- **Bound values.** A `min` or `max` of `integer`, `number`, or `duration`, or a `minLength` or `maxLength` of `text`, is a value of its kind: [`@loomcli/validators/bound-value`](../core/diagnostics.md#loomclivalidatorsbound-value).
- **Bounds order.** `min` is not above `max`, and `minLength` is not above `maxLength`: [`@loomcli/validators/bounds-order`](../core/diagnostics.md#loomclivalidatorsbounds-order).
- **Time zone.** A `dateTime` `timeZone` is an IANA time zone name the runtime knows: [`@loomcli/validators/time-zone`](../core/diagnostics.md#loomclivalidatorstime-zone).
- **`url` protocols.** Every `url` fault: [`@loomcli/validators/url-protocols`](../core/diagnostics.md#loomclivalidatorsurl-protocols).
- **Pattern.** A `text` pattern carries no flag other than `u` and compiles under `u`: [`@loomcli/validators/invalid-pattern`](../core/diagnostics.md#loomclivalidatorsinvalid-pattern).
- **Input schema.** An `inputSchema` declares no `$schema` of its own: [`@loomcli/validators/input-schema`](../core/diagnostics.md#loomclivalidatorsinput-schema).
- **Context.** A validator reads the validation context only inside a run: [`@loomcli/validators/context-outside-run`](../core/diagnostics.md#loomclivalidatorscontext-outside-run).
- **Issue code name.** An `issueCode` code stays inside the grammar: [`@loomcli/validators/issue-code-name`](../core/diagnostics.md#loomclivalidatorsissue-code-name).
- **Issue parameters.** The parameters `issue()` receives pass the code's schema: [`@loomcli/validators/issue-parameters`](../core/diagnostics.md#loomclivalidatorsissue-parameters).

## Catalog

### text

```ts
text(
  options?: { minLength?: number; maxLength?: number } & (
    | { pattern?: undefined; message?: undefined }
    | { pattern: RegExp; message: string }
  ),
): Validator<string>
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

- **Pattern failures.** A pattern failure reads `message`, the author's one sentence describing what the pattern accepts, such as `Expected lowercase letters, digits, and hyphens.` `message` is required whenever `pattern` is given, because only the author can say what the pattern accepts. A token that fails both reports the length sentence.
- **Faults.** A `minLength` or `maxLength` that is not a whole number of 0 or more, `minLength` above `maxLength`, a `pattern` carrying any flag other than `u`, and a `pattern` whose source does not compile under `u`. The type pairs a `pattern` with its `message`, so one without the other is a compile error.

### integer

```ts
integer(options?: { min?: number; max?: number }): Validator<number>
```

- **Accepts** an optional `-` followed by one or more decimal digits, whose value is a safe integer within `min` and `max`, both inclusive. Leading zeros are accepted, so `007` is 7. Whitespace, `+`, `_`, a decimal point, an exponent, and a hexadecimal, octal, or binary prefix are rejected, so `3.0` and `1e3` fail.
- **Output** is the number, with `-0` read as `0`.
- **Publishes** `{ type: 'integer', minimum?, maximum? }`.
- **Message.** `Expected a whole number.`, `Expected a whole number from 1 through 10.`, `Expected a whole number of at least 1.`, or `Expected a whole number of at most 10.`
- **Faults.** A `min` or `max` that is not a finite number, because the published schema holds a number, and `min` above `max`.

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
- **Publishes** `{ type: 'string', enum: [...values] }` in the declared order, so help prints `One of: bytes, words, lines.` under [Accepted values](../plugins/help.md#accepted-values) with no authored line.
- **Message.** `Expected one of: bytes, words, lines.` It lists the author's values, never the caller's token.
- **Faults.** A value listed twice. The type requires at least one string value.

### url

```ts
url(options?: { protocols?: readonly [string, ...string[]] }): Validator<URL>
```

- **Accepts** a token that matches the RFC 3986 `URI` production, an absolute URI with a scheme, whose part after the scheme's `:` begins with a nonempty path or `//`, and that `new URL(token)` also parses. RFC 3986 allows an empty path, as in `mailto:` or `x:?q=1`, but the published `format: 'uri'` does not, so the soundness rule rejects it. The strict grammar rejects what the WHATWG parser would repair, such as a space or a backslash, because such a token is almost always a quoting mistake, and because `format: 'uri'` names RFC 3986. With `protocols`, the scheme must equal one of them, compared without regard to case.
- **Output** is the parsed `URL`.
- **Publishes** `{ type: 'string', format: 'uri' }`. With `protocols`, it adds a `pattern` anchored at the start that lists each scheme followed by `:`, spelling each letter as a two-case class, and escaping `+` and `.` with a backslash, while `-` stays bare because `\-` outside a class is a syntax error under the `u` flag, so `['https']` publishes `^(?:[hH][tT][tT][pP][sS]):` and `['https', 'svn+ssh']` publishes `^(?:[hH][tT][tT][pP][sS]|[sS][vV][nN]\+[sS][sS][hH]):`.
- **Message.** `Expected an absolute URL, such as https://example.com.`, or, with `protocols`, `Expected an absolute URL with the scheme https.`, `Expected an absolute URL with the scheme https or http.` for two, and `Expected an absolute URL with the scheme https, http, or ftp.` for three or more, in the declared order.
- **Faults.** An entry of `protocols` that is not an RFC 3986 scheme name, one letter followed by letters, digits, `+`, `-`, or `.`, with no trailing `:`.

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

### dateTime

```ts
dateTime(options?: { timeZone?: string }): Validator<Date>
```

- **Accepts** an ISO 8601 or RFC 3339 date and time: `YYYY-MM-DD`, then `T`, `t`, or one space, then `hh:mm` with optional `:ss` and, after seconds, an optional fraction of one or more digits, then an optional `Z`, `z`, or an offset of `+` or `-` and `hh:mm`, `hhmm`, or the hour-only `hh` that PostgreSQL prints for `timestamptz`, such as `+05`, each naming the same instant as its `hh:mm` form. The date names a real day under `date()`'s rule, the hour runs 0 through 23, the minute and second 0 through 59, and an offset's hour and minute stay within the same bounds. A date alone is `date()`'s job, and relative forms such as `now+2h` are rejected.
- **Reads** a token with an offset or `Z` as that instant. A token with neither is a local time, read in `timeZone` when the option names one and otherwise in `host.timeZone`, so only a zone-less token under an unpinned validator reads the [validation context](../core/validation.md#validation-context) and runs only inside a Loom run. A local time that a clock change skips moves forward by the length of the gap, and one it repeats takes the earlier instant, as Temporal's `compatible` disambiguation does. The offsets come from `Intl.DateTimeFormat`, because `Temporal` is not on every supported runtime.
- **Output** is a `Date`. A fraction beyond milliseconds is truncated, not rounded.
- **Publishes** `{ type: 'string', pattern }`, where the pattern admits the zone-less form and every offset spelling and states no range. `format: 'date-time'` requires an offset, so it would be stricter than the validator.
- **Message.** `Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.`
- **Faults.** A `timeZone` that the runtime does not know as an IANA time zone name, under `@loomcli/validators/time-zone`.

### duration

```ts
duration(options?: { min?: string; max?: string }): Validator<number>
```

- **Accepts** the span spellings of systemd.time(7) without a sign: a sequence of decimal numbers, each followed by a unit, so `90s`, `2h30m`, `1.5h`, `7d`, and `1 hour 30 min` pass. The units are `ms` and `msec`; `s`, `sec`, `second`, and `seconds`; `m`, `min`, `minute`, and `minutes`; `h`, `hr`, `hour`, and `hours`; `d`, `day`, and `days`; and `w`, `week`, and `weeks`. A number is digits with an optional fraction, so `.5s` and `1.s` pass. Units come in any order and may repeat, so `30m2h` is 2 hours 30 minutes and `1h1h` is 2 hours. A bare number with no unit counts seconds, so `30` is 30 seconds and `1.5` is 1500 milliseconds. Whitespace may sit between a number and its unit, between parts, and around the token, so `2 hours` and `90 sec` pass. Units are lowercase and a sign is rejected. A capital `M` is rejected with its own sentence, because systemd reads it as months; write `m` or `min`. Months and years (`month`, `year`, `y`, and their plurals) are rejected because they have no fixed length.
- **Output** is the number of milliseconds. A token that sums beyond the safe integers is rejected.
- **Bounds.** `min` and `max` are durations in the same grammar, such as `'30'`, `'24h'`, or `'1 day'`, both inclusive.
- **Publishes** `{ type: 'string', pattern }`, the grammar whole. The bounds are not stated, because a pattern cannot carry them.
- **Message.** `Expected a duration, such as 90s, 2h30m, or 1.5h.`, `Expected a duration from 30s through 1d.`, `Expected a duration of at least 30s.`, or `Expected a duration of at most 1d.` A capital `M` earns `Expected a duration; write minutes as m or min, because M is ambiguous.` A bound prints in the grammar's largest units, so `24h` prints as `1d`.
- **Faults.** A `min` or `max` outside the grammar, under `@loomcli/validators/bound-value`, and `min` above `max`.

### path

```ts
path(
  options?:
    | { access: 'read' | 'write'; kind?: 'file' | 'directory' | 'any' }
    | { access?: undefined; kind?: undefined },
): Validator<string>
```

- **Resolves** a nonempty token against `host.cwd` under the running process's `node:path` rules, and normalizes it, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md). It does not resolve symbolic links. The empty string and a token containing the NUL character are rejected before any probe.
- **Output** is the absolute, normalized path.
- **Checks.** With no `access`, nothing on the filesystem is read. `kind` narrows the access check and defaults to `'file'`, so the type takes it only beside an `access`.

| `access`  | Accepts                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent    | Any nonempty path.                                                                                                                                                                       |
| `'read'`  | An entry that exists, is of `kind`, following symbolic links, and the process can read.                                                                                                  |
| `'write'` | An entry that exists, is of `kind`, and the process can write; or, when no entry exists, a path whose parent is an existing directory the process can write. Nothing is created. |

- **The checks are advisory.** The filesystem can change between validation and the action, so the action still handles its own I/O failures. An existing file passes a `'write'` check: whether to replace it is the application's decision.
- **Verdicts and faults.** A probe that fails with `ENOENT`, `ENOTDIR`, `EACCES`, `EPERM`, `ELOOP`, `ENAMETOOLONG`, or `EINVAL` is a verdict about the operator's token, and the token is rejected with the configuration's message. A probe that fails any other way, such as `EIO`, throws, and core reports it as a validator failure under [Issues and validator failures](../core/validation.md#issues-and-validator-failures).
- **Defaults.** A default beside `access` is probed on every run, like every default, so a missing default file fails every run, even one that supplies another path. Resolve a fallback path in the action instead of declaring one as the default.
- **The context.** `path` reads `host.cwd` from the [validation context](../core/validation.md#validation-context), so it runs only inside a Loom run.
- **Publishes** `{ type: 'string', minLength: 1 }`. Existence, kind, and access are runtime state, not a shape of the token, so none is published.
- **Message.** One sentence per configuration: `Expected a nonempty path with no NUL character.`, `Expected a readable file that exists.`, `Expected a readable directory that exists.`, `Expected a readable file or directory that exists.`, `Expected a writable file, or a new file in a writable directory.`, `Expected a writable directory, or a new directory in a writable directory.`, and `Expected a writable path, or a new path in a writable directory.`
- **Faults.** None: the type rejects `kind` without `access`, and an `access` or `kind` outside its set.

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

- **`parse`** receives one raw string and the validation context, and returns the Standard Schema result, `{ value }` or `{ issues }`, directly or as a promise. The output type is inferred from `value`.
- **`inputSchema`** is the JSON Schema the validator publishes, stated as plain data. The author owns its soundness and its value, so a later change to the declared object changes what the validator publishes. Without it the value implements no `jsonSchema`, and the input schema reads `null`, unknown, under [Input schema](../core/validation.md#input-schema).
- **Publishing.** With `inputSchema`, `'~standard'.jsonSchema.input({ target: 'draft-2020-12' })` returns a new plain object on every call: `$schema: 'https://json-schema.org/draft/2020-12/schema'` followed by the keywords of `inputSchema`. Any other target throws, as the standard permits. `'~standard'.jsonSchema.output` throws for every target, because the output side is the action's business and core never asks for it. These rules hold for every catalog factory, since each is built with `createValidator`.
- **The context outside a run.** Core attaches the context to every call it makes. When `validate` is called any other way, such as in a unit test, `parse` receives a context whose every field throws a `DeclarationError` under `@loomcli/validators/context-outside-run` when read, whose sentence reads `This validator reads the validation context, which only exists during a Loom run.` and whose correction reads `Call the validator through an Application run, or leave the context unread.` A validator that never reads the context works anywhere; one that reads it fails at the read. A validator that reads the context is tested through an Application run on a [`mockProcess`](testing.md#mockprocess) handle.
- **Faults.** An `inputSchema` that declares its own `$schema`.

The catalog factories are built with `createValidator`, so a catalog validator and an author's own share every rule above.

## Issue codes

```ts
import type { StandardSchemaV1 } from '@loomcli/core';

issueCode<Params>(
  code: string,
  config: {
    schema: StandardSchemaV1<Params>;
    message: (params: Params) => string;
  },
): IssueCode<Params>

interface IssueCode<Params> {
  readonly code: string;
  readonly schema: StandardSchemaV1<Params>;
  issue(this: void, params: Params): StandardSchemaV1.Issue;
  read(this: void, issue: StandardSchemaV1.Issue): Params | undefined;
}
```

The schema's input and output are one type, so `read` validates what `issue` stored. `issue` and `read` declare `this: void`: neither reads its descriptor through `this`, so either can be passed or destructured on its own.

```ts
import { Application, InputError, issuePath, override } from '@loomcli/core';
import { integer, integerRangeIssue } from '@loomcli/validators';

// `serve --workers 99` writes `serve: --workers takes from 1 to 64 workers.` and exits 2.
// Every other issue keeps its catalog sentence.
export const serve = new Application('serve', {
  views: [
    override(InputError, {
      render: (failure, { hints, style }) =>
        [
          ...failure.problems
            .flatMap((problem) =>
              problem.reason === 'missing'
                ? [`${problem.spelling} is required. Supply a value.`]
                : problem.issues.map((issue) => {
                    const at = issuePath(issue);
                    const subject = at === undefined ? problem.spelling : `${problem.spelling} at ${at}`;
                    const range = integerRangeIssue.read(issue);
                    return range === undefined
                      ? `${subject}: ${issue.message}`
                      : `${subject} takes from ${String(range.min)} to ${String(range.max)} workers.`;
                  }),
            )
            .map((line) => `serve: ${style.escape(line)}`),
          ...hints,
        ]
          .map((line) => `${line}\n`)
          .join(''),
    }),
  ],
}).option('workers', { type: 'string', validate: integer({ min: 1, max: 64 }) }).action(() => {});
```

A validator package declares one issue code for each sentence its validators print, and an author rewords a sentence by reading its code in an `InputError` view override. The message rules every code's sentence follows are in [Failure messages](../core/failures.md). [ADR-0048](../decisions/0048-a-validator-package-declares-one-issue-code-per-sentence.md) records the decision.

- **Declaring a code.** `issueCode(code, { schema, message })` returns a descriptor. `schema` is a Standard Schema that validates the parameters and answers synchronously. `message` builds the code's one sentence from its parameters. Any package that ships validators built with `createValidator` declares its codes this way; the catalog is the first.
- **The code string.** A code is the declaring package's name, as a plugin identity names its package, then zero or more subpath segments and a rule name, each after a `/` and each of lowercase letters and digits in words joined by single hyphens: `@loomcli/validators/integer-range`, or `@acme/checks/ports/range` for a rule the package's `ports` subpath owns. It is the grammar of a [diagnostic rule's identity](../core/declaration-faults.md#developer-diagnostics), and `issueCode` checks it with core's `isRuleIdentity`.
- **Rejecting with a code.** `parse` returns `{ issues: [code.issue(params)] }`. `issue` validates `params` through the schema and returns an issue with `message`, the sentence `message` built; `code`, the code string; and `params`, the schema's output. `createValidator` passes the issue through unchanged, and core keeps its fields under [Issues and validator failures](../core/validation.md#issues-and-validator-failures).
- **Reading a code.** `read(issue)` returns the schema's output for the issue's `params` when the issue's `code` equals the descriptor's code and the parameters pass the schema. It returns `undefined` for any other issue: another package's code, a schema library's own code such as Zod's, no code at all, a value that is not an object, and parameters that are not an object. Core's own issues, the Boolean grammar `Use true, false, 1, or 0.` and `The validator rejected this value without an explanation. Supply a different value.`, carry no code, and a missing input is a problem with no issue, which `InputProblem.reason` separates.
- **One sentence per code.** A code identifies one sentence, and its parameters are exactly that sentence's blanks, with one fixed shape per code. Parameters hold the rule's settings and never the rejected value.
- **No per-call rewording.** A factory takes no argument that replaces its sentence. `text()`'s `message` describes the pattern and is the sentence of `text-pattern`. Every other rewording is an override keyed on a code.
- **Faults.** `issueCode` throws a `DeclarationError` at the call for a code outside the grammar. `issue` throws one for parameters the schema rejects, under `@loomcli/validators/issue-parameters`, and so for a schema that answers with a promise, which it cannot read synchronously; `read` returns `undefined` for either.

The catalog declares these codes. Each is exported under the name in the second column, and each code below is written without its `@loomcli/validators/` prefix. A blank in braces is a parameter. A list parameter prints as the factory's message bullet shows it.

| Code                | Export                  | Parameters                                  | Sentence                                               |
| ------------------- | ----------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `text-nonempty`     | `textNonemptyIssue`     | none                                        | `Expected a nonempty value.`                           |
| `text-min-length`   | `textMinLengthIssue`    | `{ min: number }`                           | `Expected at least {min} characters.`                  |
| `text-max-length`   | `textMaxLengthIssue`    | `{ max: number }`                           | `Expected at most {max} characters.`                   |
| `text-exact-length` | `textExactLengthIssue`  | `{ length: number }`                        | `Expected exactly {length} characters.`                |
| `text-length-range` | `textLengthRangeIssue`  | `{ min: number; max: number }`              | `Expected from {min} through {max} characters.`        |
| `text-pattern`      | `textPatternIssue`      | `{ message: string }`                       | `{message}`                                            |
| `integer`           | `integerIssue`          | none                                        | `Expected a whole number.`                             |
| `integer-range`     | `integerRangeIssue`     | `{ min: number; max: number }`              | `Expected a whole number from {min} through {max}.`    |
| `integer-min`       | `integerMinIssue`       | `{ min: number }`                           | `Expected a whole number of at least {min}.`           |
| `integer-max`       | `integerMaxIssue`       | `{ max: number }`                           | `Expected a whole number of at most {max}.`            |
| `number`            | `numberIssue`           | none                                        | `Expected a number.`                                   |
| `number-range`      | `numberRangeIssue`      | `{ min: number; max: number }`              | `Expected a number from {min} through {max}.`          |
| `number-min`        | `numberMinIssue`        | `{ min: number }`                           | `Expected a number of at least {min}.`                 |
| `number-max`        | `numberMaxIssue`        | `{ max: number }`                           | `Expected a number of at most {max}.`                  |
| `port`              | `portIssue`             | none                                        | `Expected a port number from 1 through 65535.`         |
| `one-of`            | `oneOfIssue`            | `{ values: readonly string[] }`             | `Expected one of: {values}.`                           |
| `url`               | `urlIssue`              | none                                        | `Expected an absolute URL, such as https://example.com.` |
| `url-scheme`        | `urlSchemeIssue`        | `{ protocols: readonly string[] }`          | `Expected an absolute URL with the scheme {protocols}.` |
| `uuid`              | `uuidIssue`             | none                                        | `Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.` |
| `date`              | `dateIssue`             | none                                        | `Expected a date as YYYY-MM-DD, such as 2026-09-25.`   |
| `date-time`         | `dateTimeIssue`         | none                                        | `Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.` |
| `duration`          | `durationIssue`         | none                                        | `Expected a duration, such as 90s, 2h30m, or 1.5h.`    |
| `duration-capital-m` | `durationCapitalMIssue` | none                                        | `Expected a duration; write minutes as m or min, because M is ambiguous.` |
| `duration-range`    | `durationRangeIssue`    | `{ min: number; max: number }`              | `Expected a duration from {min} through {max}.`        |
| `duration-min`      | `durationMinIssue`      | `{ min: number }`                           | `Expected a duration of at least {min}.`               |
| `duration-max`      | `durationMaxIssue`      | `{ max: number }`                           | `Expected a duration of at most {max}.`                |
| `path`              | `pathIssue`             | none                                        | `Expected a nonempty path with no NUL character.`      |
| `path-readable`     | `pathReadableIssue`     | `{ kind: 'file' \| 'directory' \| 'any' }`  | `Expected a readable {kind} that exists.`              |
| `path-writable`     | `pathWritableIssue`     | `{ kind: 'file' \| 'directory' \| 'any' }`  | `Expected a writable {kind}, or a new {kind} in a writable directory.` |

The duration codes carry milliseconds, and their sentences print each count in the grammar's units. A code with no parameters has the parameters `{}`. A count of 1 reads `character` rather than `characters`. Under `path-readable`, `{kind}` reads `file`, `directory`, or `file or directory`, and under `path-writable` it reads `file`, `directory`, or `path`. `text-pattern`'s one parameter is the author's `message`, the sentence's one blank.

## When author code fails

A `parse` function, or a schema that `issueCode` takes, is author code. Author code that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A `parse` that throws or rejects is not a verdict: core reports it as a validator failure under [Issues and validator failures](../core/validation.md#issues-and-validator-failures). A schema that throws, which `issue` and `read` run synchronously, throws from them as the author's code.

## Package

- The root export holds the eleven factories, `createValidator`, `issueCode`, the catalog's code descriptors under [Issue codes](#issue-codes), and the `Validator`, `ParseResult`, and `IssueCode` types. `Validator<Output>` is `StandardSchemaV1<string, Output> & StandardJSONSchemaV1<string, Output>`, what every catalog factory returns; `createValidator` returns it when `inputSchema` is given and a plain `StandardSchemaV1<string, Output>` when it is not. The package has no subpath and no plugin.
- `@loomcli/core` is a peer dependency, as it is for `@loomcli/plugins`. The package imports the Standard Schema types, `ValidationContext`, `validationContext`, and `DeclarationError` from core, and adds no runtime dependency of its own.

## Not shipped

- `email` and a JSON validator. Every simple email rule rejects a real address somewhere, and a JSON value on a command line is better served by a file.
- Reading a file or piped stdin as one stream of content, which is its own feature rather than a check.
- Case-insensitive `oneOf`, a `uuid` version filter, custom date layouts, bounds on anything other than numbers, durations, and length, and a composition utility.
