---
description: The @loomcli/validators reference. The catalog of Standard Schema validators for common input shapes, createValidator, pipe, and the issue codes each rejection carries.
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
3. **`pipe`.** A validator followed by steps that check or transform its value, such as a catalog factory and one more rule. Help and the manifest read the first validator's published input schema.
4. **`createValidator`.** The author's own parse function, built the same way as every catalog factory. It is also how a pipe's first validator states a richer published input schema.
5. **A schema library.** Any Standard Schema value, in the same slot.

## Shared rules

**Values.** Every factory returns a `StandardSchemaV1<string, Output>` that also implements `StandardJSONSchemaV1`, with `vendor` `'@loomcli/validators'`. Its input is one raw string. `validate` is synchronous except under `path`, which probes the filesystem. The value holds no state between calls, so one validator may serve many inputs.

**Multiple options and variadic arguments.** On a multiple option or a variadic argument, the same validator checks each value under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md). `option('tag', { multiple: true, type: 'string', validate: text({ maxLength: 32 }) })` gives the action `string[]`, and the input schema is `text()`'s own.

**Omission.** A catalog validator's input type is `string`, so it cannot sit beside `validateOmitted: true`, whose validator's input type must accept `undefined`. A rule about omission is a hand-written Standard Schema value, as [Absence and defaults](../core/validation.md#absence-and-defaults) shows.

**Defaults.** A default is a raw string in the validator's input type, `default: '8080'` for `port()`, and passes through the validator like a token. Core validates every declared default once per run, before parsing and whether or not the invocation supplies the input, so a default the validator rejects fails every run with a `DeclarationError`, even one that overrides it.

**Published input schemas.** A factory publishes the JSON Schema of the value its token stands for, under the rule of [Input schema](../core/validation.md#input-schema): `integer()` publishes `type: 'integer'`, and `url()` publishes the string. Each factory lists its keywords below, and [createValidator](#createvalidator) states how every validator publishes them.

**Soundness.** A published input schema is sound, not complete. Every token the validator accepts satisfies it, so it may be looser than the validator and never stricter. A constraint the validator applies but cannot state soundly is left out: `path` publishes no existence. The rule binds every factory and every author of a `createValidator` value that declares `inputSchema`.

**Messages.** A rejection returns one issue with no path, carrying its code and parameters under [Issue codes](#issue-codes). Its message states the expectation in one plain sentence, beginning `Expected`, and never repeats the caller's token, because a rejected value may be a secret. Each factory configuration has one message for every way a token can fail, so `integer({ min: 1, max: 10 })` answers `Expected a whole number from 1 through 10.` for `abc` and for `11` alike. Three rejections keep a second sentence, because the token's shape is right and one fact about it is wrong: `text` with a `pattern`, whose length rule and pattern each keep their own sentence, `duration`'s capital `M`, and `cidr`'s host bits. Core prefixes the message with the input's subject under [Issues and validator failures](../core/validation.md#issues-and-validator-failures). Every message follows the rules in [Failure messages](../core/failures.md).

**Faults at the call.** A factory argument that can never work throws a `DeclarationError` from the factory call, under [ADR-0034](../decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md). Each factory lists its faults. A fault's sentence names the factory and the argument and states the problem, and its correction states the fix. TypeScript rejects what its types can express, and a factory checks only what a type cannot, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A value that bypasses the types meets the platform's own error.

Each fault carries a [diagnostic rule](../core/declaration-faults.md#developer-diagnostics) the package declares through `diagnosticRule()`, as a third-party validator package does, and its Developer Diagnostic rebuilds the call, such as `integer({ max: 1, min: 5 })`, and marks the argument or the key at fault. A value listed twice marks both entries. The package declares these rules:

- **`oneOf` values.** Every `oneOf` fault: [`@loomcli/validators/one-of-values`](../core/diagnostics.md#loomclivalidatorsone-of-values).
- **Bound values.** A `min` or `max` of `integer`, `number`, `duration`, `bytes`, or `time`, or a `minLength` or `maxLength` of `text`, is a value of its kind: [`@loomcli/validators/bound-value`](../core/diagnostics.md#loomclivalidatorsbound-value).
- **Bounds order.** `min` is not above `max`, and `minLength` is not above `maxLength`: [`@loomcli/validators/bounds-order`](../core/diagnostics.md#loomclivalidatorsbounds-order).
- **Time zone.** A `dateTime` `timeZone` is an IANA time zone name the runtime knows: [`@loomcli/validators/time-zone`](../core/diagnostics.md#loomclivalidatorstime-zone).
- **`url` protocols.** Every `url` fault: [`@loomcli/validators/url-protocols`](../core/diagnostics.md#loomclivalidatorsurl-protocols).
- **Layouts.** Every fault of a `date`, `dateTime`, or `time` layout: [`@loomcli/validators/layout`](../core/diagnostics.md#loomclivalidatorslayout).
- **`keyValue` separator.** A `keyValue` separator is nonempty and holds no whitespace: [`@loomcli/validators/key-value-separator`](../core/diagnostics.md#loomclivalidatorskey-value-separator).
- **Pattern.** A `text` pattern carries no flag other than `u` and compiles under `u`: [`@loomcli/validators/invalid-pattern`](../core/diagnostics.md#loomclivalidatorsinvalid-pattern).
- **Input schema.** An `inputSchema` declares no `$schema` of its own: [`@loomcli/validators/input-schema`](../core/diagnostics.md#loomclivalidatorsinput-schema).
- **Context.** A validator reads the validation context only inside a run, or under the options [`validationOptions`](../core/validation.md#validation-options-outside-a-run) builds: [`@loomcli/validators/context-outside-run`](../core/diagnostics.md#loomclivalidatorscontext-outside-run).
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

A negative number is a plain word, not an option word, because an option word after one hyphen starts with an ASCII letter ([String values and token consumption](../core/options.md#string-values-and-token-consumption)). So a negative value needs no escape: `--offset -5`, `--offset=-5`, and an argument such as `-5` in `shift -5` each reach the validator.

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
date(options?: { layouts?: readonly [string, ...string[]] }): Validator<string>
```

- **Accepts** `YYYY-MM-DD` naming a real day of the proleptic Gregorian calendar, years 0000 through 9999, so `2024-02-29` passes and `2026-02-29` and `2026-13-01` fail. With `layouts`, it also accepts each layout under [Layouts](#layouts).
- **Output** is the date as `YYYY-MM-DD`, whichever form the token took, so `25/09/2026` under `'%d/%m/%Y'` gives `2026-09-25`. A calendar date has no time and no zone, and any `Date` would fix a midnight in some zone, so the action builds the type it needs.
- **Publishes** `{ type: 'string', format: 'date' }`, or, with `layouts`, the `anyOf` [Layouts](#layouts) states, its first member `{ format: 'date' }`.
- **Message.** `Expected a date as YYYY-MM-DD, such as 2026-09-25.`, or, with `layouts`, `Expected a date as YYYY-MM-DD or DD/MM/YYYY, such as 2026-09-25.`, listing every form.
- **Faults.** A layout under [Layouts](#layouts).

### dateTime

```ts
dateTime(options?: { timeZone?: string; layouts?: readonly [string, ...string[]] }): Validator<Date>
```

- **Accepts** an ISO 8601 or RFC 3339 date and time: `YYYY-MM-DD`, then `T`, `t`, or one space, then `hh:mm` with optional `:ss` and, after seconds, an optional fraction of one or more digits, then an optional `Z`, `z`, or an offset of `+` or `-` and `hh:mm`, `hhmm`, or the hour-only `hh` that PostgreSQL prints for `timestamptz`, such as `+05`, each naming the same instant as its `hh:mm` form. The date names a real day under `date()`'s rule, the hour runs 0 through 23, the minute and second 0 through 59, and an offset's hour and minute stay within the same bounds. A date alone is `date()`'s job, and relative forms such as `now+2h` are rejected. With `layouts`, it also accepts each layout under [Layouts](#layouts); a layout with `%z` names that instant, and one without reads as a token with no offset does.
- **Reads** a token with an offset or `Z` as that instant. A token with neither is a local time, read in `timeZone` when the option names one and otherwise in `host.timeZone`, so only a zone-less token under an unpinned validator reads the [validation context](../core/validation.md#validation-context), so it runs inside a Loom run or under the options [`validationOptions`](../core/validation.md#validation-options-outside-a-run) builds. A local time that a clock change skips moves forward by the length of the gap, and one it repeats takes the earlier instant, as Temporal's `compatible` disambiguation does. The offsets come from `Intl.DateTimeFormat`, because `Temporal` is not on every supported runtime.
- **Output** is a `Date`. A fraction beyond milliseconds is truncated, not rounded.
- **Publishes** `{ type: 'string', pattern }`, where the pattern admits the zone-less form and every offset spelling and states no range. `format: 'date-time'` requires an offset, so it would be stricter than the validator. With `layouts`, it publishes the `anyOf` [Layouts](#layouts) states, its first member that pattern.
- **Message.** `Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.`, or, with `layouts`, `Expected a date and time as YYYY-MM-DDThh:mm or DD/MM/YYYY hh:mm, such as 2026-09-25T14:30:00Z.`, listing every form.
- **Faults.** A `timeZone` that the runtime does not know as an IANA time zone name, under `@loomcli/validators/time-zone`, and a layout under [Layouts](#layouts).

### time

```ts
time(options?: { min?: string; max?: string; layouts?: readonly [string, ...string[]] }): Validator<number>
```

- **Accepts** a time of day as RFC 3339's partial time writes it, with seconds optional as ISO 8601 writes a local time: two-digit hours from 00 through 23, `:`, two-digit minutes, then optional `:` and two-digit seconds and, after seconds, an optional `.` and one or more digits, so `09:30`, `17:45:30`, and `23:59:59.5` pass. `9:30`, `24:00`, a leap second such as `23:59:60`, and an offset such as `09:30Z` are rejected; a zoned time is `dateTime()`'s. With `layouts`, it also accepts each layout under [Layouts](#layouts), such as `'%I:%M%p'` for `9:30pm`.
- **Output** is the number of milliseconds since midnight, the unit `duration()` uses, so `09:30` is 34,200,000 and a time and a duration add. A fraction beyond milliseconds is truncated, not rounded.
- **Bounds.** `min` and `max` are times in the default grammar, such as `'09:00'`, both inclusive. A range that wraps past midnight, such as 22:00 to 06:00, is a [pipe](#pipe) step.
- **Publishes** `{ type: 'string', pattern }`, the default grammar whole, or, with `layouts`, the `anyOf` [Layouts](#layouts) states, its first member that pattern. It does not publish `format: 'time'`, which requires an offset the validator rejects. The bounds are not stated, because a pattern cannot carry them.
- **Message.** `Expected a time of day, such as 09:30 or 17:45:30.`, or, with `layouts`, `Expected a time of day as hh:mm or hh:mm AM, such as 09:30.`, listing every form. With bounds, `Expected a time from 09:00 through 17:00.`, `Expected a time of at least 09:00.`, or `Expected a time of at most 17:00.`, whatever the layouts. A bound prints as `hh:mm`, with `:ss` when its seconds or milliseconds are not zero, and a fraction of its milliseconds with trailing zeros dropped when they are not zero, so `'09:00:00.50'` prints as `09:00:00.5`.
- **Faults.** A `min` or `max` that the default grammar rejects, under `@loomcli/validators/bound-value`, `min` above `max`, and a layout under [Layouts](#layouts).

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
- **The context.** `path` reads `host.cwd` from the [validation context](../core/validation.md#validation-context), so it runs inside a Loom run, or in a test given the options core's [`validationOptions`](../core/validation.md#validation-options-outside-a-run) builds.
- **Publishes** `{ type: 'string', minLength: 1 }`. Existence, kind, and access are runtime state, not a shape of the token, so none is published.
- **Message.** One sentence per configuration: `Expected a nonempty path with no NUL character.`, `Expected a readable file that exists.`, `Expected a readable directory that exists.`, `Expected a readable file or directory that exists.`, `Expected a writable file, or a new file in a writable directory.`, `Expected a writable directory, or a new directory in a writable directory.`, and `Expected a writable path, or a new path in a writable directory.`
- **Faults.** None: the type rejects `kind` without `access`, and an `access` or `kind` outside its set.

### bytes

```ts
bytes(options?: { min?: string; max?: string }): Validator<number>
```

- **Accepts** a number, written as `duration` writes one, digits with an optional fraction, so `1.` passes, followed by an optional unit, with whitespace allowed between them and around the token, whitespace being what `String.prototype.trim` removes, so `512`, `10MB`, `1.5 GB`, and `.5KiB` pass. `B` is a byte; `kB`, `MB`, `GB`, `TB`, and `PB` are powers of 1000; and `KiB`, `MiB`, `GiB`, `TiB`, and `PiB` are powers of 1024, under IEC 80000-13. Units are case-sensitive, except that the decimal kilo prefix may be written `k` or `K`, so `kB` and `KB` are 1000 bytes, while `kiB` and `mb` are rejected. A bare number counts bytes. A binary prefix may stand without `B`, as Kubernetes writes it, so `512Mi` is 536,870,912 bytes. A decimal prefix without `B`, such as `10M`, is rejected, because it reads two ways. One number and one unit make a size, so `1GB 500MB` is rejected, and so is a sign.
- **Output** is the number of bytes, computed in exact decimal arithmetic rather than by multiplying a float, so `2.01kB` is 2,010. A fraction is accepted only when the bytes come out whole, so `1.5GB` is 1,500,000,000, `0.5KiB` is 512, and `1.5B` is rejected. A size beyond the safe integers is rejected, so `8PiB`, which is exactly 2⁵³, is rejected and `7PiB` passes.
- **Bounds.** `min` and `max` are sizes in the same grammar, such as `'1MB'` or `'10GiB'`, both inclusive.
- **Publishes** `{ type: 'string', pattern }`, the grammar whole. The bounds are not stated, because a pattern cannot carry them.
- **Message.** `Expected a size, such as 512KiB, 10MB, or 1.5GB.`, `Expected a size from 1MB through 10GiB.`, `Expected a size of at least 1MB.`, or `Expected a size of at most 10GiB.` A bound prints as the whole-number spelling with the fewest digits, the decimal prefix on a tie, no prefix for 0, and a binary prefix always with `B`, so 1,048,576 prints as `1MiB`, 1,000,000 as `1MB`, 1,000 as `1kB`, 1,500 as `1500B`, and 0 as `0B`; the decimal kilo prefix prints as `k`.
- **Faults.** A `min` or `max` that `bytes()` itself would reject, such as `'10M'`, `'1.5B'`, or `'9PiB'`, under `@loomcli/validators/bound-value`, and `min` above `max`.

### host

```ts
host(options?: { ip?: boolean }): Validator<string>
```

- **Accepts** a host name under RFC 1123: labels joined by `.`, each of ASCII letters, digits, and hyphens, from 1 through 63 characters, neither starting nor ending with a hyphen, at most 253 characters in all, the longest text form RFC 1035's 255-octet name allows, with no trailing dot, so `example.com.` is rejected. A name whose last label is a number under the WHATWG URL standard's ends-in-a-number rule is rejected: a last label of ASCII digits alone, or of `0x` or `0X` followed by zero or more hexadecimal digits, so `1.2.3.4`, `0x7f000001`, and `127.0.0.0x1` are never host names, because a resolver reads each as an IPv4 address, and neither is `foo.0x`, which a URL parser rejects as a malformed one. A name outside ASCII is rejected; the operator writes its Punycode form, such as `xn--bcher-kva.example` for `bücher.example`, because the published `hostname` format admits ASCII alone. An underscore is rejected.
- **With `ip: true`** it also accepts an IPv4 address as [ip](#ip) reads it, and an IPv6 address in brackets, as a URL writes one, such as `[2001:db8::1]`. A bare IPv6 address and a bracketed IPv4 address are rejected, so a host never reads as an address with a port, and brackets hold IPv6 alone, as in a URL.
- **Output** is the name in lowercase, because DNS names compare without regard to case, or, under `ip: true`, the address in the canonical form `ip()` writes, without brackets.
- **Publishes** `{ type: 'string', format: 'hostname' }`, or, with `ip: true`, `{ type: 'string', anyOf: [{ format: 'hostname' }, { format: 'ipv4' }, { pattern }] }`, whose pattern admits `[`, then hexadecimal digits in either case, `:`, and `.`, then `]`.
- **Message.** `Expected a host name, such as example.com.`, or, with `ip: true`, `Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].`

### ip

```ts
ip(options?: { version?: 4 | 6 }): Validator<string>
```

- **Accepts** an IPv4 address as four decimal parts joined by `.`, each from 0 through 255 and written with no leading zero, because some tools read a leading zero as octal, so `192.0.2.1` passes and `192.0.2.01` is rejected. It accepts an IPv6 address in the text forms of RFC 4291: eight groups of one to four hexadecimal digits in any letter case, one run of groups compressed to `::`, and a last 32 bits that may be written as an IPv4 address under the same rule, leading zeros rejected, so `2001:DB8::1` and `::ffff:192.0.2.1` pass. A zone identifier, such as `fe80::1%eth0`, and brackets are rejected. `version` accepts one family alone.
- **Output** is the canonical address. IPv4 is the token as written. IPv6 is the form RFC 5952 recommends, with mixed notation for IPv4-mapped addresses alone: lowercase, each group without leading zeros, and the longest run of two or more zero groups compressed to `::`, the first on a tie, so `2001:DB8:0:0:0:0:0:1` becomes `2001:db8::1`, and an address in `::ffff:0:0/96`, IPv4-mapped, is written with its last 32 bits dotted however it was written, so `::ffff:c000:201` and `::ffff:192.0.2.1` both give `::ffff:192.0.2.1`. Every other address prints as hexadecimal groups, so `::192.0.2.1` becomes `::c000:201` and `64:ff9b::192.0.2.33` becomes `64:ff9b::c000:221`. Two spellings of one address give one output.
- **Publishes** `{ type: 'string', format: 'ipv4' }` with `version: 4`, `{ type: 'string', format: 'ipv6' }` with `version: 6`, and otherwise `{ type: 'string', anyOf: [{ format: 'ipv4' }, { format: 'ipv6' }] }`.
- **Message.** `Expected an IP address, such as 192.0.2.1 or 2001:db8::1.`, `Expected an IPv4 address, such as 192.0.2.1.`, or `Expected an IPv6 address, such as 2001:db8::1.`

### cidr

```ts
cidr(options?: { version?: 4 | 6 }): Validator<{ address: string; prefix: number }>
```

- **Accepts** an address as [ip](#ip) reads it, a `/`, and a decimal prefix with no leading zero, from 0 through 32 for IPv4 and through 128 for IPv6, so `10.0.0.0/8` and `2001:db8::/32` pass. The address is the network itself: a bit set below the prefix, as in `10.0.0.1/8`, is rejected with its own sentence. `version` accepts one family alone.
- **Output** is `{ address, prefix }`: the address in the canonical form `ip()` writes, and the prefix as a number.
- **Publishes** `{ type: 'string', pattern }`, a pattern that admits an address of hexadecimal digits, `:`, and `.`, then a prefix from 0 through 128. It does not state the family or the host bits, because a pattern cannot carry them soundly.
- **Message.** `Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.`, `Expected an IPv4 CIDR block, such as 192.0.2.0/24.`, or `Expected an IPv6 CIDR block, such as 2001:db8::/32.` A block of the accepted family with host bits set earns `Expected a network address with no bits set below the prefix.`; a block of the wrong family earns the family's sentence, whatever its bits.

### keyValue

```ts
keyValue(options?: { separator?: string }): Validator<{ key: string; value: string }>
```

- **Accepts** a token holding its separator, `=` unless `separator` names another, after at least one character. The token splits at the first separator, so `a=b=c` has the key `a` and the value `b=c`, and an empty value, as in `a=`, is accepted. A token with no separator, or one that starts with it, is rejected.
- **Output** is `{ key, value }`, both strings, as written. On a multiple option the action receives the pairs in the order given, repeated keys kept, so `--label a=1 --label a=2` gives two pairs. Folding pairs into a record, and choosing whether a later key wins, is the author's, in a [pipe](#pipe) step or the action. A rule for the key or the value, such as a key pattern, is a `pipe` step too.
- **Publishes** `{ type: 'string', pattern }`, a pattern that requires one character or more, line terminators included, before the separator, with each ECMAScript syntax character in the separator, ``^ $ \ . * + ? ( ) [ ] { } |``, escaped by a backslash. Every other character stays bare, `-` and `/` included: neither is a syntax character, and `\-` outside a class is a syntax error under the `u` flag, as `url` notes.
- **Message.** `Expected a key and a value as key=value.`, with the separator in place of `=`.
- **Faults.** A `separator` that is empty or holds whitespace, whitespace being what `String.prototype.trim` removes, under `@loomcli/validators/key-value-separator`.

### email

```ts
email(): Validator<string>
```

- **Accepts** what the WHATWG HTML standard's valid email address production accepts, the rule browsers apply to `<input type="email">`: one or more of the letters, digits, and ``.!#$%&'*+/=?^_`{|}~-`` before an `@`, and after it one or more labels of letters, digits, and hyphens joined by `.`, each from 1 through 63 characters and neither starting nor ending with a hyphen. So `name@example.com` and `ops@localhost` pass. It is a deliberate departure from RFC 5322, simpler before the `@` and stricter after it: it accepts `a..b@example.com`, which RFC 5322 rejects, and it rejects a quoted local part, such as `"john doe"@example.com`, a comment, an address literal, and a name outside ASCII. An author who needs them passes a schema library's value.
- **Output** is the token as written.
- **Publishes** `{ type: 'string', pattern }`, the WHATWG production. It does not publish `format: 'email'`, because RFC 5321's local part rejects `a..b` and a leading dot, which the WHATWG rule accepts, and the format as validators check it requires a dot in the domain, which the WHATWG rule does not, so the format would be stricter than the validator.
- **Message.** `Expected an email address, such as name@example.com.`

### Layouts

`date`, `dateTime`, and `time` take `layouts`, a nonempty list of POSIX strftime layouts the factory reads beside its default grammar, under [ADR-0144](../decisions/0144-date-and-time-validators-read-strftime-layouts-and-time-reads-a-time-of-day-as-milliseconds-since-midnight.md).

```ts
date({ layouts: ['%d/%m/%Y', '%Y%m%d'] }); // 2026-09-25, 25/09/2026, 25/9/2026, and 20260925
dateTime({ layouts: ['%d/%m/%Y %H:%M'] }); // the ISO forms and 25/09/2026 14:30
time({ layouts: ['%I:%M%p'] }); // 09:30 and 9:30pm
```

- **Order.** The factory tries its default grammar, then each layout in the declared order, and the first that reads the token wins. So `['%d/%m/%Y', '%m/%d/%Y']` reads `03/04/2026` as the 3rd of April; list day-first and month-first layouts together only when that order is the intent.
- **Directives.** `%Y` reads four digits. `%m`, `%d`, `%H`, `%M`, `%S`, and `%I` read one or two digits, leading zeros permitted but not required, as POSIX `strptime` reads them, except that a directive followed directly by another digit-reading directive reads exactly two, so `%Y%m%d` reads `20260304` as the 4th of March. `%z` reads `Z`, `z`, or `+` or `-` followed by `hh`, `hhmm`, or `hh:mm`. `%p` reads `AM` or `PM` in any letter case, as the C locale writes them, and `%I` reads 1 through 12, so `12AM` is midnight and `12PM` is noon. `%%` reads `%`. Every other character matches itself exactly. No directive reads a month or day name, so no layout depends on a locale.
- **Fields.** The hour is one field, whether `%H` or `%I` reads it. A `date` layout holds `%Y`, `%m`, and `%d` once each and no other directive. A `dateTime` layout holds `%Y`, `%m`, `%d`, `%H`, and `%M` once each, and may hold `%S` and `%z` once each. A `time` layout holds `%M` once and either `%H`, or `%I` with `%p`, once each, and may hold `%S` once.
- **Reading.** A date a layout reads names a real day under `date`'s rule, and a time an hour from 0 through 23 once `%p` applies, and a minute and second from 0 through 59. The fields then give the factory's output as its default grammar's would: `date` the `YYYY-MM-DD` string, `dateTime` the instant under its zone rule, and `time` the milliseconds since midnight.
- **Publishes** `{ type: 'string', anyOf: [default, ...layouts] }`: the factory's default schema, then a pattern for each layout that admits every token the layout reads and states no range.
- **Written forms.** A message writes each layout as its directives read: `%Y` as `YYYY`, `%m` as `MM`, `%d` as `DD`, `%H` and `%I` as `hh`, `%M` as `mm`, `%S` as `ss`, `%p` as `AM`, `%z` as `±hh:mm`, and `%%` as `%`, so `'%d/%m/%Y'` writes `DD/MM/YYYY`. The default grammar writes first: `YYYY-MM-DD` for `date`, `YYYY-MM-DDThh:mm` for `dateTime`, and `hh:mm` for `time`. A form that repeats prints once, at its first place, so `time({ layouts: ['%H:%M'] })` writes `hh:mm` alone. A list of forms joins as `A or B`, or `A, B, or C` for three or more.
- **Faults.** An empty layout, an unknown directive, a directive the factory does not read, a required field missing, a field held twice, or `%I` without `%p` or `%p` without `%I`, under `@loomcli/validators/layout`.

## createValidator

```ts
createValidator<Output, Return extends ParseReturn<Output> = ParseReturn<Output>>(definition: {
  parse: (raw: string, context: ValidationContext) => Return;
  inputSchema?: Readonly<Record<string, unknown>>;
}): Validator<AcceptedOutput<Awaited<Return>>> // or StandardSchemaV1<string, ...> without inputSchema

type ParseReturn<Output> = ParseResult<Output> | Promise<ParseResult<Output>>;

// Shown to explain the output, not exported: the value of every branch that is not { issues }.
type AcceptedOutput<Result> = Result extends StandardSchemaV1.FailureResult
  ? never
  : Result extends { readonly value: infer Value } ? Value : never;

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

- **`parse`** receives one raw string and the validation context, and returns the Standard Schema result, `{ value }` or `{ issues }`, directly or as a promise. The output type is the `value` of the branches that accept, so an `{ issues }` branch adds nothing to it under any compiler settings, `exactOptionalPropertyTypes` off included, and a ternary that returns `{ value: metres }` or `{ issues }` gives `number`. A stated `Output`, as in `createValidator<number>(...)`, checks `parse` against it instead.
- **`inputSchema`** is the JSON Schema the validator publishes, stated as plain data. The author owns its soundness and its value, so a later change to the declared object changes what the validator publishes. Without it the value implements no `jsonSchema`, and the input schema reads `null`, unknown, under [Input schema](../core/validation.md#input-schema).
- **Publishing.** With `inputSchema`, `'~standard'.jsonSchema.input({ target: 'draft-2020-12' })` returns a new plain object on every call: `$schema: 'https://json-schema.org/draft/2020-12/schema'` followed by the keywords of `inputSchema`. Any other target throws, as the standard permits. `'~standard'.jsonSchema.output` throws for every target, because the output side is the action's business and core never asks for it. These rules hold for every catalog factory, since each is built with `createValidator`.
- **The context outside a run.** Core attaches the context to every call it makes. When `validate` is called any other way, such as in a unit test that passes no options from `validationOptions`, `parse` receives a context whose every field throws a `DeclarationError` under `@loomcli/validators/context-outside-run` when read, whose sentence reads `This validator reads the validation context, which only exists during a Loom run.` and whose correction reads `Call the validator through an Application run or with the options validationOptions builds, or leave the context unread.` A validator that never reads the context works anywhere; one that reads it fails at the read. A validator that reads the context is tested alone with the options core's [`validationOptions`](../core/validation.md#validation-options-outside-a-run) builds, or through an Application run on a [`mockProcess`](testing.md#mockprocess) handle.
- **Faults.** An `inputSchema` that declares its own `$schema`.

The catalog factories are built with `createValidator`, so a catalog validator and an author's own share every rule above.

## pipe

```ts
pipe(first, ...steps): StandardSchemaV1<Input, Output> // & StandardJSONSchemaV1<Input, Output> when first publishes

// Shown to explain a step, not exported. `Previous` is the output of the validator or step before it.
type Step<Previous> =
  | StandardSchemaV1 // whose input type accepts Previous
  | ((value: Previous, context: ValidationContext) => ParseResult<unknown> | Promise<ParseResult<unknown>>);
```

```ts
import { integer, pipe, text } from '@loomcli/validators';
import { z } from 'zod';

const pairs = pipe(integer({ min: 2 }), (count) =>
  count % 2 === 0 ? { value: count } : { issues: [{ message: 'Expected an even number.' }] },
);

const tags = pipe(text({ maxLength: 200 }), (raw) => ({ value: raw.split(',') }));

const lanes = pipe(
  integer({ min: 1 }),
  z.number().refine((count) => count % 4 === 0, 'Expected a multiple of 4.'),
);
```

`pipe` runs one validator and then each step on the value the stage before it accepted, so an author adds a rule or a transform to a catalog validator without rewriting its parse. `first` and each step are the pipe's stages. The value it returns is a validator pipe: an ordinary Standard Schema value with `vendor` `'@loomcli/validators'` and `version` 1 that, like a catalog validator, carries no `types` and holds no state between calls. When `first` is a `Validator`, as every catalog factory returns, the pipe is a `Validator` of its own output. [ADR-0141](../decisions/0141-a-validator-pipe-runs-a-first-validator-then-steps-that-read-its-output-and-publishes-the-first-validators-input-schema.md) records the decision.

- **`first`** is any Standard Schema value: a catalog validator, a `createValidator` value, a schema library's value, or another pipe. It receives what core hands the input, and the pipe's input type is `first`'s. A `first` whose input type accepts `undefined` may sit beside `validateOmitted: true`.
- **Steps.** A pipe takes one to eight steps. A step is either a Standard Schema value whose input type accepts the previous stage's output, or a parse function with `createValidator`'s `parse` shape whose `value` is that output. TypeScript checks that the previous output is assignable to a schema step's input type, so `pipe(text(), z.enum(['a', 'b']))` is a type error, as is a catalog step after a `first` whose output may be `undefined`. After an output of type `unknown`, such as a bare `StandardSchemaV1` first, a schema step's fit is not checked, because TypeScript reads a step before it infers a function step's output. It types a function step's `value` with no annotation, so `count` above is a `number`. A step may check or transform, and the pipe's output type is the last step's: `pairs` gives the action a `number` and `tags` a `string[]`. A chain longer than eight steps nests a pipe as one step or as `first`.
- **Running.** The first stage that answers `{ issues }` ends the pipe, and the pipe answers that result unchanged, with its messages, codes, and paths; a later stage never runs. A stage that throws, or answers with a promise that rejects, throws or rejects from the pipe unchanged, under [When author code fails](#when-author-code-fails). A schema stage receives the Standard Schema options the pipe received, so core's validation context reaches it, and a parse function receives that context, or the context outside a run that [createValidator](#createvalidator) describes. The pipe answers synchronously when every stage that ran answered synchronously, and with a promise once any stage answers with one, so a pipe whose `first` is `path({ access: 'read' })` answers with a promise for every token it probes, and synchronously for the empty string and a token containing NUL, which `path` rejects before any probe.
- **Multiple options and variadic arguments.** The pipe checks each value, as every validator does under [Shared rules](#shared-rules).
- **Publishing.** When `first` implements Standard JSON Schema, the pipe publishes exactly what `first` publishes: `'~standard'.jsonSchema.input(options)` returns `first`'s answer for the same options, or throws what it throws, so `pairs` publishes `integer({ min: 2 })`'s schema. The schema is as sound as `first`'s, because every token the pipe accepts passed `first`, and it may be looser than the pipe, as `pairs` accepts no odd number its schema admits. `'~standard'.jsonSchema.output` throws for every target. When `first` publishes nothing, neither does the pipe, and the input schema reads `null`. A pipe takes no schema of its own; to publish a richer schema, state it on `first` with `createValidator({ parse, inputSchema })`.
- **Messages and codes.** The pipe adds no message and no issue code. Each catalog stage keeps its own sentence and code, and an author's stage owns its sentence, which follows the rules in [Failure messages](../core/failures.md). One factory configuration answers with one sentence, but a pipe answers with its rejecting stage's sentence, so `pairs` answers `Expected a whole number of at least 2.` for `abc` and `Expected an even number.` for `3`.
- **Faults.** None. A missing step, a step that is neither a schema nor a function, and a schema step whose input type the previous output is not assignable to are type errors.

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
- **Reading a code.** `read(issue)` returns the schema's output for the issue's `params` when the issue's `code` equals the descriptor's code and the parameters pass the schema. It returns `undefined` for any other issue: another package's code, a schema library's own code such as Zod's, no code at all, a value that is not an object, and parameters that are not an object. Core's own issues, the Boolean grammar `Use true, false, yes, no, y, n, on, off, 1, or 0.` and `The validator rejected this value without an explanation. Supply a different value.`, carry no code, and a missing input is a problem with no issue, which `InputProblem.reason` separates.
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
| `date-layouts`      | `dateLayoutsIssue`      | `{ forms: readonly string[] }`              | `Expected a date as {forms}, such as 2026-09-25.`      |
| `date-time-layouts` | `dateTimeLayoutsIssue`  | `{ forms: readonly string[] }`              | `Expected a date and time as {forms}, such as 2026-09-25T14:30:00Z.` |
| `time`              | `timeIssue`             | none                                        | `Expected a time of day, such as 09:30 or 17:45:30.`   |
| `time-layouts`      | `timeLayoutsIssue`      | `{ forms: readonly string[] }`              | `Expected a time of day as {forms}, such as 09:30.`    |
| `time-range`        | `timeRangeIssue`        | `{ min: number; max: number }`              | `Expected a time from {min} through {max}.`            |
| `time-min`          | `timeMinIssue`          | `{ min: number }`                           | `Expected a time of at least {min}.`                   |
| `time-max`          | `timeMaxIssue`          | `{ max: number }`                           | `Expected a time of at most {max}.`                    |
| `duration`          | `durationIssue`         | none                                        | `Expected a duration, such as 90s, 2h30m, or 1.5h.`    |
| `duration-capital-m` | `durationCapitalMIssue` | none                                        | `Expected a duration; write minutes as m or min, because M is ambiguous.` |
| `duration-range`    | `durationRangeIssue`    | `{ min: number; max: number }`              | `Expected a duration from {min} through {max}.`        |
| `duration-min`      | `durationMinIssue`      | `{ min: number }`                           | `Expected a duration of at least {min}.`               |
| `duration-max`      | `durationMaxIssue`      | `{ max: number }`                           | `Expected a duration of at most {max}.`                |
| `path`              | `pathIssue`             | none                                        | `Expected a nonempty path with no NUL character.`      |
| `path-readable`     | `pathReadableIssue`     | `{ kind: 'file' \| 'directory' \| 'any' }`  | `Expected a readable {kind} that exists.`              |
| `path-writable`     | `pathWritableIssue`     | `{ kind: 'file' \| 'directory' \| 'any' }`  | `Expected a writable {kind}, or a new {kind} in a writable directory.` |
| `bytes`             | `bytesIssue`            | none                                        | `Expected a size, such as 512KiB, 10MB, or 1.5GB.`     |
| `bytes-range`       | `bytesRangeIssue`       | `{ min: number; max: number }`              | `Expected a size from {min} through {max}.`            |
| `bytes-min`         | `bytesMinIssue`         | `{ min: number }`                           | `Expected a size of at least {min}.`                   |
| `bytes-max`         | `bytesMaxIssue`         | `{ max: number }`                           | `Expected a size of at most {max}.`                    |
| `host`              | `hostIssue`             | none                                        | `Expected a host name, such as example.com.`           |
| `host-or-ip`        | `hostOrIpIssue`         | none                                        | `Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].` |
| `ip`                | `ipIssue`               | none                                        | `Expected an IP address, such as 192.0.2.1 or 2001:db8::1.` |
| `ip-v4`             | `ipV4Issue`             | none                                        | `Expected an IPv4 address, such as 192.0.2.1.`         |
| `ip-v6`             | `ipV6Issue`             | none                                        | `Expected an IPv6 address, such as 2001:db8::1.`       |
| `cidr`              | `cidrIssue`             | none                                        | `Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.` |
| `cidr-v4`           | `cidrV4Issue`           | none                                        | `Expected an IPv4 CIDR block, such as 192.0.2.0/24.`   |
| `cidr-v6`           | `cidrV6Issue`           | none                                        | `Expected an IPv6 CIDR block, such as 2001:db8::/32.`  |
| `cidr-host-bits`    | `cidrHostBitsIssue`     | none                                        | `Expected a network address with no bits set below the prefix.` |
| `key-value`         | `keyValueIssue`         | `{ separator: string }`                     | `Expected a key and a value as key{separator}value.`   |
| `email`             | `emailIssue`            | none                                        | `Expected an email address, such as name@example.com.` |

The duration codes carry milliseconds, and their sentences print each count in the grammar's units. The bytes codes carry byte counts, and their sentences print each count as the `bytes` message bullet states. The time codes carry milliseconds since midnight, and their sentences print each as the `time` message bullet states. A `forms` parameter holds each distinct written form, the default grammar's first, and joins as [Layouts](#layouts) states. A code with no parameters has the parameters `{}`. A count of 1 reads `character` rather than `characters`. Under `path-readable`, `{kind}` reads `file`, `directory`, or `file or directory`, and under `path-writable` it reads `file`, `directory`, or `path`. `text-pattern`'s one parameter is the author's `message`, the sentence's one blank.

## When author code fails

A `parse` function, a pipe step or a pipe's `first` that the author wrote, or a schema that `issueCode` takes, is author code. Author code that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A `parse` that throws or rejects is not a verdict: core reports it as a validator failure under [Issues and validator failures](../core/validation.md#issues-and-validator-failures). A schema that throws, which `issue` and `read` run synchronously, throws from them as the author's code.

## Package

- The root export holds the eighteen factories, `createValidator`, `pipe`, `issueCode`, the catalog's code descriptors under [Issue codes](#issue-codes), and the `Validator`, `ParseResult`, and `IssueCode` types. `Validator<Output>` is `StandardSchemaV1<string, Output> & StandardJSONSchemaV1<string, Output>`, what every catalog factory returns; `createValidator` returns it when `inputSchema` is given and a plain `StandardSchemaV1<string, Output>` when it is not. The package has no subpath and no plugin.
- `@loomcli/core` is a peer dependency, as it is for `@loomcli/plugins`. The package imports the Standard Schema types, `ValidationContext`, `validationContext`, and `DeclarationError` from core, and adds no runtime dependency of its own.

## Not shipped

- A JSON validator. A JSON value on a command line is better served by a file.
- Reading a file or piped stdin as one stream of content, which is its own feature rather than a check.
- Case-insensitive `oneOf`, a `uuid` version filter, month and day names in a layout, and bounds on anything other than numbers, durations, sizes, times, and length.
