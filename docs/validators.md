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

**Messages.** A rejection returns one issue with no path, carrying its code and parameters under [Issue codes](#issue-codes). Its message states the expectation in one plain sentence, beginning `Expected`, and never repeats the caller's token, because a rejected value may be a secret. Each factory configuration has one message for every way a token can fail, so `integer({ min: 1, max: 10 })` answers `Expected a whole number from 1 through 10.` for `abc` and for `11` alike. `text` with a `pattern` is the one exception: its length rule and its pattern each keep their own sentence. Core prefixes the message with the input's subject under [Issues and validator failures](core.md#issues-and-validator-failures). Every message follows the rules in [Failure messages](failure-messages.md).

**Faults at the call.** A factory argument that can never work throws a `DeclarationError` from the factory call, under [ADR-0034](decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md). Each factory lists its faults. A fault's sentence names the factory and the argument and states the problem, and its correction states the fix, as `integer() min 5 is above max 1.` and `Supply a min at or below max.`, or `oneOf() lists "dev" twice.` and `List each value once.` TypeScript rejects what its types can express; the runtime check covers the rest for JavaScript callers and widened values.

Each fault carries a [diagnostic rule](core.md#developer-diagnostics) the package declares through `diagnosticRule()`, as a third-party validator package does, and its Developer Diagnostic rebuilds the call, such as `integer({ max: 1, min: 5 })`, and marks the argument or the key at fault. A value listed twice marks both entries.

| Rule | Faults |
| --- | --- |
| `@loomcli/validators/factory-options` | Options that are not a plain object, for every factory that takes them |
| `@loomcli/validators/one-of-values` | Every `oneOf` fault |
| `@loomcli/validators/bound-value` | A `min` or `max` of `integer` or `number`, or a `minLength` or `maxLength` of `text`, that is not a number of its kind |
| `@loomcli/validators/bounds-order` | `min` above `max`, and `minLength` above `maxLength` |
| `@loomcli/validators/url-protocols` | Every `url` fault |
| `@loomcli/validators/path-check` | Every `path` fault |
| `@loomcli/validators/invalid-pattern` | A `text` pattern that is not a RegExp, carries a flag other than `u`, or does not compile under `u` |
| `@loomcli/validators/pattern-message` | A `text` message that is not a nonempty string, a message without a pattern, and a pattern without a message |
| `@loomcli/validators/validator-definition` | A `createValidator` definition that is not a plain object, and a `parse` that is not a function |
| `@loomcli/validators/input-schema` | An `inputSchema` that is not a plain object, or that declares its own `$schema` |
| `@loomcli/validators/context-outside-run` | A validator that reads the validation context outside a run |
| `@loomcli/validators/issue-code-name` | An `issueCode` code outside the grammar |
| `@loomcli/validators/issue-code-config` | An `issueCode` config that is not a plain object, a `schema` that is not a Standard Schema, and a `message` that is not a function |
| `@loomcli/validators/issue-code-schema` | A schema that answers with a promise, throws in `issue()`, or answers with a value that is not a Standard Schema result |
| `@loomcli/validators/issue-parameters` | Parameters `issue()` receives that the code's schema rejects |

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
- **Faults.** A `minLength` or `maxLength` that is not a non-negative safe integer, `minLength` above `maxLength`, a `pattern` carrying any flag other than `u`, a `pattern` whose source does not compile under `u`, a `message` that is empty or not a string, a `message` without a `pattern`, and a `pattern` without a `message`, which reads `text() pattern has no message to describe it. Supply a message that states what the pattern accepts.`

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

- **Accepts** a token that matches the RFC 3986 `URI` production, an absolute URI with a scheme, whose part after the scheme's `:` begins with a nonempty path or `//`, and that `new URL(token)` also parses. RFC 3986 allows an empty path, as in `mailto:` or `x:?q=1`, but the published `format: 'uri'` does not, so the soundness rule rejects it. The strict grammar rejects what the WHATWG parser would repair, such as a space or a backslash, because such a token is almost always a quoting mistake, and because `format: 'uri'` names RFC 3986. With `protocols`, the scheme must equal one of them, compared without regard to case.
- **Output** is the parsed `URL`.
- **Publishes** `{ type: 'string', format: 'uri' }`. With `protocols`, it adds a `pattern` anchored at the start that lists each scheme followed by `:`, spelling each letter as a two-case class, and escaping `+` and `.` with a backslash, while `-` stays bare because `\-` outside a class is a syntax error under the `u` flag, so `['https']` publishes `^(?:[hH][tT][tT][pP][sS]):` and `['https', 'svn+ssh']` publishes `^(?:[hH][tT][tT][pP][sS]|[sS][vV][nN]\+[sS][sS][hH]):`.
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
- **Message.** One sentence per configuration: `Expected a nonempty path with no NUL character.`, `Expected a readable file that exists.`, `Expected a readable directory that exists.`, `Expected a readable file or directory that exists.`, `Expected a writable file, or a new file in a writable directory.`, `Expected a writable directory, or a new directory in a writable directory.`, and `Expected a writable path, or a new path in a writable directory.`
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
- **The context outside a run.** Core attaches the context to every call it makes. When `validate` is called any other way, such as in a unit test, `parse` receives a context whose every field throws a `DeclarationError` under `@loomcli/validators/context-outside-run` when read, whose sentence reads `This validator reads the validation context, which only exists during a Loom run.` and whose correction reads `Call the validator through an Application run, or leave the context unread.` A validator that never reads the context works anywhere; one that reads it fails at the read. A validator that reads the context is tested through an Application run with a host override.
- **Faults.** A `definition` that is not a plain object, a `parse` that is not a function, an `inputSchema` that is not a plain object, and an `inputSchema` that declares its own `$schema`.

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

A validator package declares one issue code for each sentence its validators print, and an author rewords a sentence by reading its code in an `InputError` view override. The message rules every code's sentence follows are in [Failure messages](failure-messages.md). [ADR-0048](decisions/0048-a-validator-package-declares-one-issue-code-per-sentence.md) records the decision.

- **Declaring a code.** `issueCode(code, { schema, message })` returns a frozen descriptor. `schema` is a Standard Schema that validates the parameters and answers synchronously. `message` builds the code's one sentence from its parameters. Any package that ships validators built with `createValidator` declares its codes this way; the catalog is the first.
- **The code string.** A code is the declaring package's name, as a plugin identity names its package, then zero or more subpath segments and a rule name, each after a `/` and each of lowercase letters and digits in words joined by single hyphens: `@loomcli/validators/integer-range`, or `@acme/checks/ports/range` for a rule the package's `ports` subpath owns. It is the grammar of a [diagnostic rule's identity](core.md#developer-diagnostics), and `issueCode` checks it with core's `isRuleIdentity`.
- **Rejecting with a code.** `parse` returns `{ issues: [code.issue(params)] }`. `issue` validates `params` through the schema and returns a frozen issue with `message`, the sentence `message` built; `code`, the code string; and `params`, the schema's output. `createValidator` passes the issue through unchanged, and core keeps its fields under [Issues and validator failures](core.md#issues-and-validator-failures).
- **Reading a code.** `read(issue)` returns the schema's output for the issue's `params` when the issue's `code` equals the descriptor's code and the parameters pass the schema. It returns `undefined` for any other issue: another package's code, a schema library's own code such as Zod's, no code at all, a value that is not an object, and parameters that are not an object. Core's own issues, the Boolean grammar `Use true, false, 1, or 0.` and `The validator rejected this value without an explanation. Supply a different value.`, carry no code, and a missing input is a problem with no issue, which `InputProblem.reason` separates.
- **One sentence per code.** A code identifies one sentence, and its parameters are exactly that sentence's blanks, with one fixed shape per code. Parameters hold the rule's settings and never the rejected value.
- **No per-call rewording.** A factory takes no argument that replaces its sentence. `text()`'s `message` describes the pattern and is the sentence of `text-pattern`. Every other rewording is an override keyed on a code.
- **Faults.** `issueCode` throws a `DeclarationError` at the call for a code outside the grammar, a `schema` that is not a Standard Schema, and a `message` that is not a function. A `schema` whose `~standard` field throws when it is read, through a getter or a proxy trap, is not a Standard Schema. `issue` throws one for parameters the schema rejects, for a schema that throws, and for an answer that is not a Standard Schema result, so the issue it returns always holds the schema's output: a success holds its own `value` and no issues, and a failure holds an issues array. `read` returns `undefined` for an answer that is not a Standard Schema result, and lets a throw from the schema propagate. `issue` and `read` throw one when the schema answers with a promise.

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
| `path`              | `pathIssue`             | none                                        | `Expected a nonempty path with no NUL character.`      |
| `path-readable`     | `pathReadableIssue`     | `{ kind: 'file' \| 'directory' \| 'any' }`  | `Expected a readable {kind} that exists.`              |
| `path-writable`     | `pathWritableIssue`     | `{ kind: 'file' \| 'directory' \| 'any' }`  | `Expected a writable {kind}, or a new {kind} in a writable directory.` |

A code with no parameters has the parameters `{}`. A count of 1 reads `character` rather than `characters`. Under `path-readable`, `{kind}` reads `file`, `directory`, or `file or directory`, and under `path-writable` it reads `file`, `directory`, or `path`. `text-pattern`'s one parameter is the author's `message`, the sentence's one blank.

## Package

- The root export holds the nine factories, `createValidator`, `issueCode`, the catalog's code descriptors under [Issue codes](#issue-codes), and the `Validator`, `ParseResult`, and `IssueCode` types. `Validator<Output>` is `StandardSchemaV1<string, Output> & StandardJSONSchemaV1<string, Output>`, what every catalog factory returns; `createValidator` returns it when `inputSchema` is given and a plain `StandardSchemaV1<string, Output>` when it is not. The package has no subpath and no plugin.
- `@loomcli/core` is a peer dependency, as it is for `@loomcli/plugins`. The package imports the Standard Schema types, `ValidationContext`, `validationContext`, and `DeclarationError` from core, and adds no runtime dependency of its own.
- Under ADR-0037, the package joins the synchronized release set the way `@loomcli/plugins` did under [ADR-0020](decisions/0020-first-party-plugins-ship-in-one-package-as-subpaths.md) and [ADR-0016](decisions/0016-a-release-merge-publishes-through-one-idempotent-workflow.md): it lands with `private: true`, the maintainer publishes a `0.0.0` placeholder from a minimal manifest without `private` and binds the npm trusted publisher, an ordinary pull request removes `private` at the current synchronized version, and the next release cut publishes it. The root `build` script and `scripts/clean.mjs` list it, and the packed-consumer check that installs the published tarballs covers it beside core and plugins.

## Example coverage

- textstat declares `--metric` with `oneOf(['bytes', 'words', 'lines'])` and `--min-bytes` and `--minimum` with `integer({ min: 0 })`, replacing their Zod schemas, so the rejected-value message for `TEXTSTAT_MIN_BYTES` reads `Option "--min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.` `inspect()` reports `metric` with the `enum` and `min-bytes` with `{ type: 'integer', minimum: 0 }` beside `$schema`.
- textstat's `files` rule, a nonempty list or piped stdin, moves into its action under ADR-0036: an empty list with a terminal on stdin throws an `InputError` carrying one `invalid` problem for the argument, as [Example coverage](core.md#example-coverage-1) shows, so stderr still reads `textstat: Argument "files": Supply file arguments or pipe text to stdin.` with exit code 2.
- jsonkit's `select` declares `--field` with `text()`, so `--field a -F ''` fails with `Option "--field" at 1: Expected a nonempty value.`, and `inspect()` reports `{ type: 'string', minLength: 1 }` beside `$schema`.
- jsonkit's global `--file` declares no validator. A global option declares no presence rule under [ADR-0044](decisions/0044-a-global-option-declares-no-presence-rule.md), so its file-or-stdin rule lives in the shared document reader, which throws an `InputError` for the option with exit code 2.

## Acceptance

- **Soundness.** For each factory, a table of accepted tokens validates, under Ajv's draft 2020-12 validator with `ajv-formats` in full mode and `unicodeRegExp` on, the value the token stands for against the published schema: the number for `integer`, `number`, and `port`, and the token for every other factory. A test fails when any accepted token breaks the schema. The table includes each factory's edges: code points outside the Basic Multilingual Plane for `text`, `-0`, leading zeros, and safe-integer limits for the numbers, the leap day for `date`, including `0000-02-29` accepted and `0100-02-29` rejected, since a `Date.UTC` check maps years below 100 to the 1900s, mixed case for `uuid` and a `protocols` scheme, a `protocols` scheme containing `+`, `-`, or `.`, and for `url` the tokens RFC 3986 rejects and the WHATWG parser repairs.
- **Rejection.** For each factory, a table of rejected tokens pins the one message and shows the token is absent from it.
- **Issue codes.** Each rejected token's issue carries the code and parameters the table under [Issue codes](#issue-codes) names, and the code's `read` returns those parameters for it and `undefined` for every other code's issue, a Zod issue, and an issue whose parameters fail the schema. An `InputError` override that reads `integerRangeIssue` rewrites that sentence through `run()` and leaves every other issue's sentence as the catalog wrote it. Each listed `issueCode` fault throws a `DeclarationError`, and `text({ pattern })` without `message` is a type error and throws one at the call.
- **Faults.** Each listed fault throws `DeclarationError` from the factory call, under the rule [Shared rules](#shared-rules) names, and each rule pins its rendered Developer Diagnostic.
- **Context.** A context-free factory validates when called directly; `path` called directly throws the context sentence; `path` inside a run resolves against a host override's `cwd`, using temporary directories for the `read` and `write` checks.
- **Multiple options and variadic arguments.** Core runs the validator once per value, reports each issue at its position, validates each default value, publishes the validator's schema unchanged, and calls nothing when no value is supplied, under ADR-0036.
- **Help.** A `oneOf` input of at most eight values prints `One of: ...` with no authored `accepts`, under help's limit of eight.

## Not in 0.5.0

- `dateTime` and `duration`. No settled use shows how an operator would type them; an author who needs one builds it with `createValidator`.
- `email` and a JSON validator. Every simple email rule rejects a real address somewhere, and a JSON value on a command line is better served by a file.
- Reading a file or piped stdin as one stream of content, which is its own feature rather than a check.
- Case-insensitive `oneOf`, a `uuid` version filter, custom date layouts, bounds on anything other than numbers and length, and a composition utility.
