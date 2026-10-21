---
description: "Standard Schema validation of inputs: content inputs, the validation context, absence and defaults, issues and validator failures, and the input schema fact."
---

# Standard Schema validation

## Content inputs

An argument or local option declares `type: 'content'` to accept readable file paths and give its action lazy `Content` handles. A content option consumes words like a string option with a separate value. It remains local to the Command that reads it.

```ts
new Command('count')
	.argument('files', {
		description: 'The files and piped text to count.',
		type: 'content',
		variadic: true,
		stdin: true,
		min: 1,
		max: 3,
	})
	.action(async ({ args }) => {
		for (const source of args.files) {
			const stream = source.stream();
			// Consume the source here.
		}
	});
```

`stdin: true` claims piped or redirected stdin. A Command has at most one stdin target. A collection appends available stdin after its file sources, unless `-` already places it in the list. A scalar uses its supplied path instead of stdin. Environment and configuration bindings fill content options through the ordinary input-source stage; a path from either source counts as supplied.

Only the stdin target accepts `-`. Repeated `-` entries share one stream: a read to EOF leaves later reads empty. A literal file named `-` is spelled `./-`. Terminal stdin is unavailable even for explicit `-`; an action asks through [`@loomcli/prompts`](../libs/prompts.md) for keyboard interaction. Automatic inclusion depends on a command-line run and nonterminal stdin, not on whether bytes are present. An inherited empty pipe or redirected file therefore counts as a source.

`required: true` means at least one source. A content collection can declare inclusive `min` and `max` source counts, as nonnegative safe integers. Bounds apply after stdin is included: three files and appended stdin fail `max: 3`. An omitted optional collection receives `[]` unless a positive minimum rejects it. An optional scalar receives `undefined` when it has no source.

The types reject `default`, `implied`, `validate`, and `validateOmitted` on a content input, `min` and `max` on a scalar one, and content on a global option. Source preparation checks count, existence, and readability without reading contents. A bad path fails with an ordinary input error, exit 2, alongside other input problems. Help and version takeovers can ignore held content faults. A probe cannot guarantee that a later read succeeds after the filesystem changes.

Each frozen handle carries `kind` (`file` or `stdin`), `name` (the original file spelling or `stdin`), and `path` (the absolute file path, or `undefined` for stdin). `text()` reads the remaining contents as UTF-8 text; `stream()` returns a Node readable byte stream. File reads open afresh. Stdin handles borrow the existing stream and neither buffer a replay nor destroy it. The action decides when and how to read, including parsing the contents and closing a file stream it stops consuming. Core adds no size or time limit.

A Command that accepts stdin alone declares it without a positional argument or option:

```ts
new Command('events')
	.stdin({ description: 'The event stream.', required: true })
	.action(async ({ stdin }) => {
		const stream = stdin.stream();
		// Consume the event stream here.
	});
```

The action receives the handle as `stdin`. An optional declaration permits `undefined`. `.stdin()` conflicts with an argument or option that claims stdin, and on a Command with no action it is `@loomcli/core/command-without-action`, because no action receives the stream. Help and man pages describe it in an Input section and show required pipe-only usage. Middleware reads a standalone handle through `request.stdin`; ordinary content handles remain in `request.args` or `request.options`.

`invoke()` and MCP content inputs accept file paths only. Their placeholder or transport stdin is unavailable: `-` and an omitted required source fail with exit 2. A required stdin-only Command also fails a named call; an optional stdin-only handle is absent. Content inputs publish their input-side path schema as `{ type: 'string', minLength: 1 }`, and machine projections describe paths rather than handles. See [ADR-0081](../decisions/0081-content-inputs-prepare-lazy-handles-and-one-command-claims-stdin.md).

Named calls also reject paths resolving to the process stdin pipe or device, including `/dev/stdin` and symlinks when they resolve to that source. Ordinary regular-file paths open independently and remain allowed, even when stdin is redirected from the same file. Other readable FIFO and device sources remain accepted. Preparation probes metadata without reading content; actions control later reads through accepted handles.

Ordinary value options and arguments, scalar and variadic alike, accept a `validate` property containing a [Standard Schema v1](https://standardschema.dev/) object. Core calls the standard interface directly. A compatible library needs no adapter or plugin. Boolean options and counted options do not accept `validate`, `default`, `required`, or `validateOmitted`: a Boolean option's polarity controls its absent value, and a counted option reads `0` when nothing supplies it. A string option's [implied value](options.md#implied-values) passes through its validator as a typed value does.

```ts
import { Application } from '@loomcli/core';
import { z } from 'zod';

const app = new Application('sizes')
  .option('minimum', {
    type: 'string',
    validate: z
      .string()
      .regex(/^[0-9]+$/)
      .transform(Number),
    default: '0',
  })
  .action(({ options, out }) => {
    const minimum: number = options.minimum;
    return out.print(String(minimum));
  });

await app.run();
```

`type`, and `implied` on a string option, control token consumption. The validator receives the supplied string and determines the action's output type. Core awaits synchronous or asynchronous validation before dispatch. Without a validator, supplied values remain strings.

A scalar argument's validator receives its one token. A variadic argument's validator, and a multiple option's, receive one value at a time under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md), and the action receives the array of their outputs. A rule over a plain string list belongs to the action. Native [content collections](#content-inputs) declare source-count bounds. Passthrough never enters this pipeline. The [validators reference](../libs/validators.md) describes `@loomcli/validators`, the catalog of validators for common input shapes.

`ActionHandler<typeof app>` retains these output types for extracted handlers. `ArgumentConfig`, `StringOption`, and `OptionConfig` support configuration declarations with `satisfies`. A broad type annotation can erase validator details; `satisfies` preserves inference.

## Validation context

Core calls every validator through the Standard Schema options argument, under the `libraryOptions` key `validationContextKey`. `validationContext(options)` reads that channel and returns the `ValidationContext` core attached, or `undefined` when another caller ran the same validator. A schema library that ignores the argument, such as Zod, is unaffected: the extra argument changes nothing for a validator that does not read it.

```ts
import { validationContext } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

const upper: StandardSchemaV1<string, string> = {
  '~standard': {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      const name = validationContext(options)?.input.name ?? 'the value';
      return typeof value === 'string'
        ? { value: value.toUpperCase() }
        : { issues: [{ message: `Supply a string for ${name}.` }] };
    },
    vendor: 'example',
    version: 1,
  },
};
```

Core re-exports the `StandardSchemaV1` type, so a custom validator depends on `@loomcli/core` alone. The annotation is what fixes the validator's input and output types; an unannotated object literal widens `version: 1` to `number` and resolves the output to `unknown`. The accessor answers for the contexts core produced alone. A value core did not produce reads as `undefined`.

| Field         | `phase: 'default'`       | `phase: 'invocation'`                                      |
| ------------- | ------------------------ | ---------------------------------------------------------- |
| `host`        | The captured `Host`      | The captured `Host`, the object the action receives        |
| `input`       | `{ kind, name, global }` | The same identity for the declaration under validation     |
| `command`     | absent                   | The routed path of canonical names; `[]` for the root      |
| `passthrough` | absent                   | The tail after the first bare `--`                         |
| `supplied`    | absent                   | The raw tokens, or the raw values input sources filled, of every declared input, before any default |

A [question](../libs/prompts.md) validates its submitted answer with `phase: 'question'`. It carries the captured host, the routed path, the passthrough tail, and a separate copy of the run's supplied inputs. A linked question's `input` identifies its local option. An unlinked question's identity is `{ kind: 'question', name: message, global: false }`. Core's `questionValidationOptions(context, { message, option? })` builds these authenticated Standard Schema options for the prompts library. Context-dependent validators such as `path()` and `dateTime()` therefore use the same working directory and time zone as option validation.

A default and an [implied value](options.md#implied-values) validate before any token is parsed, so their phase, `default`, reports the host and the declaration alone. A configuration source's own options validate before the source is called, so `supplied` holds no value the source fills, and `passthrough` is `[]` while a local fault is held. Every input validator call of one invocation, the globals and the routed Command's own declarations alike, reports the same route, passthrough, and supplied inputs. The route, the passthrough tail, and every collected value are copies made for each call, so a validator that writes to them changes nothing that a later validator or the action reads. `host` is the captured object itself, shared with the action, as the table states.

`supplied` holds the tokens as the parser read them, and the raw values the [input sources](input-sources.md) filled, before any validator runs and before any default applies; a bare spelling with an [implied value](options.md#implied-values) reads as the raw implied string. Every declared name of the routed Command, and every global name, is a key.

| Declared input and invocation                  | `supplied` value               |
| ---------------------------------------------- | ------------------------------ |
| Scalar argument or single option, supplied     | The one string                 |
| Variadic argument or multiple option, supplied | Every token, in supplied order |
| Scalar argument or single option, omitted      | `undefined`                    |
| Variadic argument or multiple option, omitted  | `[]`                           |
| Boolean option, supplied                       | The value of its spelling      |
| Boolean option, omitted                        | `undefined`                    |
| Counted option, supplied                       | The number of occurrences      |
| Counted option, omitted                        | `undefined`                    |
| String option with an implied value, bare      | The raw implied string, in its place in a multiple option's list |
| Option an input source filled                  | The raw value it filled        |

An omitted Boolean or counted option reads as `undefined` here, because the polarity value and `0` are absent values, not supplied tokens. A count an input source filled reads as the number it filled, so `SuppliedInputs.options`, the exported type of `supplied.options`, admits a `number` for a counted option. A bare spelling of a string option with an implied value reads as the raw implied string, before its validator, as a Boolean's entry holds the value of its spelling, because the operator supplied the option. Absence rules do not change: an omitted optional value with no default never reaches its validator, and no context is produced for it, unless its declaration asks for that call with `validateOmitted: true`.

## Absence and defaults

| Declaration and input                           | Action value or failure                           |
| ----------------------------------------------- | ------------------------------------------------- |
| Optional value or argument omitted, no default  | `undefined`; validator is not called               |
| Optional value omitted, `validateOmitted: true` | The validated output of `undefined`               |
| Optional multiple option omitted, no default    | `[]`; validator is not called                     |
| Optional variadic argument omitted, no default  | `[]`; validator is not called                     |
| Optional value omitted, declared default        | The validated default output                      |
| Supplied value, including an empty string       | Its validated output or input issues              |
| Bare spelling of an option with an implied value | The implied value's validated output, judged before any token is read |
| Counted option, no occurrence and no source     | `0`; nothing validates                            |
| `required: true` value option omitted           | Input error; no dispatch                          |
| `required: 'non-interactive'` option omitted, [interaction](interaction.md) off | Input error; no dispatch |
| `required: 'non-interactive'` option omitted, interaction on | `undefined`; validator is not called |

Two declarations in this table are faults, each a `DeclarationError` with code 1:

- **A declared default.** A declared default passes its validator, even when an invocation overrides it: [`@loomcli/core/invalid-default`](diagnostics.md#loomclicoreinvalid-default).
- **An implied value.** An implied value passes its validator, even when the invocation holds no bare spelling: [`@loomcli/core/invalid-implied`](diagnostics.md#loomclicoreinvalid-implied).

For an option, omitted means that no token and no [input source](input-sources.md) supplied it. A value the environment or the configuration source filled is a supplied value in every row above.

A declared default reaches its validator as the value the author declared, the value `inspect()` publishes under `default`. An array default reaches the action as its own mutable copy on every invocation.

A scalar rule about omission, such as "a file or piped stdin", cannot live in a validator by itself, because an omitted optional value never reaches one. `validateOmitted: true` is how that rule reads omission: core calls the validator with `undefined` as the value, in the invocation phase, with the full [validation context](#validation-context). A returned issue is an input issue like any other and returns code 2. No token was supplied, so it names the declaration by the spelling an operator would type: an option under its long form, as in `Option "--file": Supply a file or pipe JSON to stdin.`, a `shortOnly` option under its short spelling, and an argument under its name. The action value is the validator output alone, because the validator always runs.

```ts
import { Command, validationContext } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

/** The rule answers omission too, so the schema's input type accepts `undefined`. */
const fileOrStdin: StandardSchemaV1<string | undefined, string | undefined> = {
  '~standard': {
    validate: (value: unknown, options?: StandardSchemaV1.Options) => {
      if (typeof value === 'string') {
        return { value };
      }
      const context = validationContext(options);
      return context?.phase === 'invocation' && !context.host.terminal.stdin.isTTY
        ? { value: undefined }
        : { issues: [{ message: 'Supply a file or pipe JSON to stdin.' }] };
    },
    vendor: 'jsonkit',
    version: 1,
  },
};

const get = new Command('get').option('file', {
  short: 'f',
  type: 'string',
  validate: fileOrStdin,
  validateOmitted: true,
});
```

The flag belongs to an optional scalar string option or scalar argument that declares a validator and no default. Every other declaration already decides its own absence, so the flag beside `required: true`, beside a `default`, beside `multiple: true` or `variadic: true`, on a Boolean or counted option, or without `validate` is a compile error at the declaration call. The validator's input type must accept `undefined`, the way a declared default must satisfy that same input type. A global option declares the flag under no condition, because its omission is plain absence under [Commands and global options](commands.md). The flag is Boolean, the way `variadic` is, and the way `required` is everywhere except a local string option that takes one value, which also accepts `'non-interactive'` under [Interaction](interaction.md).

Defaults use the validator's input type, not its output type. In the example, `default: '0'` is valid and `default: 0` is a type error. Without a validator, a value default must be a string.

Omission does not invoke validator-internal defaults. An explicitly declared `default: undefined` does enter the validator when its input type accepts `undefined`. Successful validator outputs retain their type, including `undefined`; core does not replace them or validate them a second time.

Every `run()` builds the graph, then validates all declared defaults and [implied values](options.md#implied-values) before parsing invocation tokens. It awaits asynchronous ones and reuses their transformed outputs for that invocation. Invalid defaults and implied values report the affected declaration, the validator explanation, and a correction with exit code 1. Their results are not cached across invocations.

Authoring copies the configuration object's keys. Replacing a property on the original configuration object does not alter the declaration. The default itself is the value the author declared, and each invocation receives its own shallow copy of an array default, so an action that mutates the array it receives reaches neither the declaration nor the next invocation. A validator replaces the default with the value it returns, and an array it returns is copied for that invocation the same way. Validator objects and default objects are retained by reference; core does not clone library objects or enforce validator purity.

## Issues and validator failures

Returned validator issues prevent dispatch and produce exit code 2. Core collects them across supplied inputs in authoring order, preserving each validator's own issue order. Async completion timing does not change diagnostic order. Each message identifies the argument or option and includes the validator explanation and any issue path. A message about a value an input source filled also names that source, under the diagnostics rule of [Input sources](input-sources.md). An empty issues array still denotes failure.

Core keeps an issue's own fields. Where it reads an issue a validator returned, and where it rebuilds one to prefix a value's position on a multiple option or a variadic argument, it keeps every own enumerable field the issue carries and rewrites only `path`: each segment becomes its key, and the value's position goes in front. A validator that returns `{ message: 'Too short.', code: 'too_short' }` for the second value of a variadic argument therefore reaches the failure as `{ message: 'Too short.', code: 'too_short', path: [1] }`. Core reads nothing but `message` and `path`, so another field means nothing to core and reaches a failure view unchanged. `InputProblem.issues` still types each issue as `StandardSchemaV1.Issue`, so a view that reads another field checks it at run time; a validator package's [issue codes](../libs/validators.md#issue-codes) are read that way, through a typed descriptor. [ADR-0046](../decisions/0046-a-failure-view-reads-where-the-run-was-and-plugins-add-hint-lines.md) records the rule.

CLI structure errors, such as unknown options or repeated single-value options, occur before validation. They retain their existing diagnostics.

A validator that throws, rejects, or returns a malformed result is a developer error, not an issue, as [When author code fails](#when-author-code-fails) states.

## Input schema

A validated input carries the JSON Schema its validator publishes as a core fact, `schema` on every `ArgumentNode` and `OptionNode` under [Graph inspection](graph-inspection.md). Build derives it through the [Standard JSON Schema](https://standardschema.dev/json-schema) channel, the converter `@standard-schema/spec` defines beside `validate`, and stores the plain result. The fact reaches every projection with no plugin installed, and it changes nothing at run time: validation is unchanged, and no rule reads the stored schema.

```ts
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';

interface ArgumentNode {
  // ...the fields under Graph inspection...
  readonly schema: Readonly<Record<string, unknown>> | null;
}
// The field is on every `OptionNode` variant, the Boolean and counted ones included.

// The converter core calls, as the standard declares it beside `validate`. A schema library
// implements it once; a hand-written schema implements it with this type or omits it.
type Converter = StandardJSONSchemaV1['~standard']['jsonSchema'];
// `validate` takes a Standard Schema; one that also implements the converter publishes a shape.
type Validator = StandardSchemaV1 | (StandardSchemaV1 & StandardJSONSchemaV1);
```

```ts
// Zod illustrates a library's converter here; textstat itself declares oneOf() from the validator catalog.
const app = new Application('textstat')
  .option('metric', {
    type: 'string',
    default: 'bytes',
    validate: z.enum(['bytes', 'words', 'lines'], { error: 'Use bytes, words, or lines.' }),
  })
  .action(count);

const [metric] = app.inspect().root.options;
metric.schema;
// { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', enum: ['bytes', 'words', 'lines'] }
```

- Build asks every validated argument and option whose `validate` value implements `StandardJSONSchemaV1` for its input-side schema: one call of `'~standard'.jsonSchema.input({ target: 'draft-2020-12' })`, with no `libraryOptions`. `@loomcli/core` re-exports the `StandardJSONSchemaV1` type beside `StandardSchemaV1`, so a hand-written validator can declare the converter with the standard's own type.
- The stored value is the converter's return value, snapshotted with no depth limit and with any cycle kept: arrays and plain objects copied and frozen at every depth, a value that holds itself copied with the same cycle, any other value kept as it is, so a write through the graph fails and the library's own object is never frozen. Core reads nothing inside it and adds, removes, and renames nothing: the `$schema` key the library writes, a `description` or `default` the author set on the schema, and any vendor keyword are the library's words. A projection that wants another form makes it from the fact and never asks core for one.
- The input side alone. The output side describes the value the action receives after the validator's transforms, which is the action's business. So `z.string().regex(/^[0-9]+$/).transform(Number)` publishes `{ type: 'string', pattern: '^[0-9]+$' }` beside `$schema`, and a projection describes what a caller supplies. Every token is a string, and the schema is the value the token must satisfy: `z.coerce.number().int().min(1)` publishes `type: 'integer'` with its bounds. A projection states that rule once and never per input.
- A variadic argument's and a multiple option's validator checks one value under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md), so their input schema is that validator's schema, unchanged, exactly as for a single option. The node's `multiple` or `variadic` flag says the input takes several values.
- On `schema`, `null` has one reading: the graph holds no published shape. An ordinary input without `validate`, a Boolean option, a counted option, a validator without `jsonSchema`, and a converter that fails all read `null`. Native content instead publishes `{ type: 'string', minLength: 1 }` directly, without a validator. A `null` schema never means unconstrained. A projection that needs a shape where the fact is `null` derives it from the node: a Boolean option is exact, a counted option takes no value and reads a whole number of 0 or more, and a string option or an argument is open, one string, or the whole `string[]` under `multiple` or `variadic`. `validated` answers a different question and is unchanged, so `validated: true` beside `schema: null` is an ordinary state. The Boolean and counted variants carry the field, always `null` under this contract, so the node shape and every projection built on it hold unchanged if a later contract lets a Boolean option validate.
- The fact is computed in the projection step: one converter call per validated input, on every `inspect()` call and on every run that has a middleware chain, asks a [configuration source](input-sources.md), or has an action that reads `graph` or `command`, since the graph a middleware, a source, or an action reads is the one `inspect()` returns, built once for the run on its first read. Two inputs that share one validator object each get their own call and their own copy. A run with no middleware that asks no configuration source and whose action reads neither member calls no converter, except in a development build, where build calls every validated input's converter so its check runs on every run. The converter is synchronous by the standard's contract, so `inspect()` stays synchronous, and the [validation context](#validation-context) is never passed to it.
- An option a plugin declares publishes what its validator publishes, a [global option](plugin-contract.md#global-options-from-plugins) under its `options` and a local option a lifecycle hook declares alike, and core never edits the fact, so an alias a validator accepts on its input side is published with the rest. The [formatter](../plugins/format.md)'s `--format` therefore carries the enum of the view names alone: its validator's declared shape is that enum, and the `ndjson` mapping is applied before it reaches the enum, so the alias stays out of the published fact.

## When author code fails

A validator, and the converter it publishes, that throws or rejects takes the [ordinary failure path](failures.md#the-ordinary-failure-path), and an author's catch is final, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Two outcomes differ from an action's.

- **A validator that throws, rejects, or returns a malformed result.** It produces a developer error with exit code 1: a `DeclarationError` under [`@loomcli/core/validator-failed`](diagnostics.md#loomclicorevalidator-failed), whose finding marks `validate` on the call that declared the input and whose `cause` is the thrown value. Only the author can fix it, so a distributed build shows the generic defect message and a development build its Developer Diagnostic, under [Development builds](release-facts.md#development-builds). Validation stops immediately and the action does not run. This failure is distinct from returned operator-input issues. Like every fault validation produces, it is held under [Invocation](invocation.md) and raised at the dispatch boundary, so an invocation a middleware takes over, `--help` included, reports neither the issues nor the developer error.
- **A converter that fails.** A converter fails when it throws, returns anything but a plain object, or answers with an object whose keys throw when core copies them, such as a getter that throws. An answer that holds itself is no failure: the stored copy holds the same cycle. In a distributed build a failure reads `null` under `inspect()` and `run()` alike: the graph holds no published shape, validation is unchanged, and nothing else happens. An operator cannot correct an author's validator, so the diagnostic belongs to development: in a [development build](release-facts.md#development-builds) the failure is a `DeclarationError` at build under [`@loomcli/core/schema-converter-failed`](diagnostics.md#loomclicoreschema-converter-failed), from `run()` and `inspect()`, whose finding marks the input's `validate` and whose `cause` is the thrown value.
