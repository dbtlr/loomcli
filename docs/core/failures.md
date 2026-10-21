---
description: The failure classes, declared exit codes, failure codes, the failure form, translators, the failure contract, and the voice of a failure message.
---

# Failures
## Failure classes

Every failure `run()` reports is an instance of a public class. Each class carries the facts its sentence interpolates, so a view reads them instead of parsing prose. `message` is the sentence without its category prefix, except a `DeclarationError`'s, which holds its whole [Developer Diagnostic](declaration-faults.md#developer-diagnostics) while `sentence` holds the sentence. The exit code is a static field the class declares, so a subclass inherits it and a view reads it on the instance, as [Declared exit codes](#declared-exit-codes) describes. The failure code is a static field too, which a machine reader branches on, as [Failure codes](#failure-codes) describes.

```ts
abstract class LoomError extends Error {
  static readonly code: string; // 'failure'; see Failure codes
  static readonly exitCode: FailureExitCode; // 1
  readonly exitCode: FailureExitCode;
  constructor(message: string, options?: ErrorOptions); // ErrorOptions is the platform's { cause }
}
abstract class UsageError extends LoomError {
  static override readonly code: string; // 'usage'
  static override readonly exitCode: FailureExitCode; // 2: the invocation is wrong
}

type InputProblem =
  | {
      reason: 'exclusive' | 'oneRequired' | 'requiredTogether';
      inputs: readonly InputIdentity[];
      spellings: readonly string[];
      supplied: readonly string[];
    }
  | { input: InputIdentity; spelling: string; reason: 'missing' }
  | {
      input: InputIdentity;
      spelling: string;
      reason: 'invalid';
      issues: readonly StandardSchemaV1.Issue[];
    };

function reportedSpelling(option: OptionNode): string; // '--file', '--no-quiet', or '-F'
```

| Class                     | Base         | Exit code | Facts                             |
| ------------------------- | ------------ | --------- | -------------------------------------- |
| `InputError`              | `UsageError` | 2    | `problems`                             |
| `UnknownCommandError`     | `UsageError` | 2    | `token`, `candidates`                  |
| `NonCallableCommandError` | `UsageError` | 2    | `command`, `candidates`                |
| `UnexpectedArgumentError` | `UsageError` | 2    | `command`, `accepted`, `extra`         |
| `UnknownOptionError`      | `UsageError` | 2    | `spelling`                             |
| `MissingValueError`       | `UsageError` | 2    | `spelling`                             |
| `UnexpectedValueError`    | `UsageError` | 2    | `spelling`, `value`                    |
| `RepeatedOptionError`     | `UsageError` | 2    | `spelling`                             |
| `MisplacedOptionError`    | `UsageError` | 2    | `spelling`, `commands`                 |
| `DeclarationError`        | `LoomError`  | 1    | `rule`, `sentence`, `findings`, `correction`; see [Developer Diagnostics](declaration-faults.md#developer-diagnostics) |
| `FatalError`              | `LoomError`  | 1    | the message `out.fatal()` received     |
| `WorkingDirectoryError`   | `LoomError`  | 1    | `cause`, the value capture threw; see [An unreadable working directory](host.md#an-unreadable-working-directory) |
| `InternalError`           | `LoomError`  | 1    | `cause`, the thrown value core wrapped, and `rule`, `sentence`, `correction` |
| `ResultError`             | `InternalError` | 1 | `path`, `kind`, and an `undefined` `cause`; see [Results](results.md) |

Core's default views open each failure with a prefix: the application name and a colon for every `UsageError`, as in `jsonkit: Unknown command "nope". Use one of: get, keys.`, so the operator reads who is speaking under rule 2 of [Failure messages](#2-say-what-went-wrong-and-what-to-do-instead). The name opens every line of a `UsageError`'s message, so an `InputError` that reports two problems opens both of its lines with it, as in `jsonkit: Option "--limit": Use decimal digits.` above `jsonkit: Argument "path" requires a value. Supply a value for "path".`, and the hint lines an `onFailure` hook adds below them carry no prefix. The failure's `message` holds the lines without the name, so an override reads the problems alone. `FatalError` takes no prefix, and `WorkingDirectoryError` takes the application name, as a usage error's line does. `DeclarationError`, `InternalError`, and `ResultError` take none either, because an operator never reads their sentence: in a distributed build their default text is the generic defect message, `jsonkit: Something went wrong.`, and in a development build core renders their [Developer Diagnostic](declaration-faults.md#developer-diagnostics) without consulting a view, under [Development builds](release-facts.md#development-builds).

`InputError.problems` includes broken [option groups](options.md#declared-option-groups) after the individual problems. A group problem has no singular `input` or `spelling`; readers narrow `reason` before reading those fields. The individual problems carry the validation phase in authoring order: each required input the invocation omitted, and each value a validator rejected with the issues that validator returned. `spelling` is the token an operator would type: `--file` for an option, `--no-quiet` for a negative-only Boolean option, `-F` for a `shortOnly` option, and the declared name for an argument. In an [invocation by name](invocation.md#invocation-by-name) it is the declared name for an option too, the key the caller wrote. An omitted required argument is a `missing` problem like an omitted required option, so omission has one class whichever kind of input it names. An `invalid` problem always carries at least one issue: a validator that rejected a value and returned none reports `The validator rejected this value without an explanation. Supply a different value.`, the sentence core's own text uses. Error precedence is unchanged, because routing and token errors still precede validation. An action may also throw an `InputError` for a rule over a whole list of values under [ADR-0036](../decisions/0036-each-value-passes-the-same-validator.md); it carries the problems the action names, and it reports with exit code 2 after the middleware chain rather than before it.

`issuePath(issue)` returns the dotted path an issue names inside a value, such as `1` for the second value of a multiple option, or `undefined` when the issue names the value itself, so a view positions an issue the way core's default text does.

`reportedSpelling(option)` returns the `spelling` a problem names an [`OptionNode`](graph-inspection.md) by: its long form, else the negative form a negative-only Boolean option publishes, and otherwise its short form, which a `shortOnly` option alone publishes, so a negative `shortOnly` option reports `-k`, not `--no-keep`. An alias is never the reported spelling. Core's validation reads the same rule, so a plugin that builds an `InputProblem` for an option, such as a [configuration source](input-sources.md), names it as core does. An [invocation by name](invocation.md#invocation-by-name) types no spelling, so there every problem core reports, a parser fault's included, names the option by its declared name, and `reportedSpelling` itself is unchanged.

`candidates` on `UnknownCommandError` and `NonCallableCommandError` holds the canonical child names in authoring order. An alias never appears in it, and neither does a hidden or a deprecated Command, the rule [ADR-0043](../decisions/0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) applies to completion; a deprecated Command typed in full still routes, and its migration message lives on the help page. With candidates, the sentence ends `Use one of: get, keys.` With none, it ends `Supply the name of a declared command.` for `UnknownCommandError` and `Supply the name of a declared subcommand.` for `NonCallableCommandError`, so the sentence keeps its fix under [Failure messages](failures.md).

`MisplacedOptionError.spelling` is the spelling as supplied, a letter of a short group as `-p`, and `commands` holds the path from the root of each visible Command below the one routing reached that declares that spelling, in authoring order, such as `[['get']]` or `[['cache', 'clear']]`, or the routed Command's own path alone when it declares a parent's own option with another value class, as [Global consumption and routing](commands.md#global-consumption-and-routing) describes. With one Command the sentence reads `Option "-p" belongs to command "get". Supply it after "get".`, the path joined by single spaces, and with several `Option "-p" belongs to commands get, keys. Supply it after the command name.` It names only Commands a listing shows and repeats the spelling alone, so it repeats no value under [Failure messages](failures.md). A short group raises no class of its own: an undeclared letter is an `UnknownOptionError`, `=` after a Boolean or counted letter an `UnexpectedValueError`, and a repeated letter of an option that is neither multiple nor counted a `RepeatedOptionError`.

In an invocation by name, `UnknownOptionError` names the key the caller wrote and its sentence reads `Unknown option "verbos". Supply the name of a declared option.`, and a key of `args` the routed Command does not declare is an `UnexpectedArgumentError` whose `extra` holds that name, with the sentence `Command "get" declares no argument "pth". Supply the name of a declared argument.`

`UnexpectedValueError` reports a value attached to a spelling that takes none. For a Boolean option its sentence reads `Boolean option "-t" does not accept a value. Supply the flag alone.`, and for a [counted option](options.md#counted-options) `Counted option "-v" does not accept a value. Repeat "-v" to raise its count.`, each naming the spelling typed and repeating no value.

`InternalError` wraps an unexpected exception or a non-error throw that no [translator](#translators) answered. Its message is the thrown error's message, or `An unknown error occurred.` for a thrown value that is not an Error; its `cause` is the thrown value itself. A validator that throws stays a `DeclarationError`, because only a returned issue states a validation verdict. An `InternalError` is a defect under [Failure messages](#7-a-defect-shows-one-generic-message), which shows the operator one generic message with no reason, and so is a `DeclarationError` that `run()` reports.

`LoomError` and the failure classes an author constructs, `FatalError`, `InputError`, and `DeclarationError`, accept the platform's `ErrorOptions` as their last constructor parameter, and `InternalError` keeps `cause` as its second, so a failure keeps the error it replaces as `cause`, as a translator does with `new InvalidJsonError({ cause: error })`. Core reads `cause` for nothing but a defect's findings and sets it on no failure it did not construct.

`FatalError` is the class `out.fatal()` throws. An application can subclass it and override the view for the subclass, which is how one fatal type implies one diagnostic, and the subclass can declare its own exit code.

## Declared exit codes

```ts
type FailureExitCode = 1 | 2 | 3 /* … every whole number through */ | 125; // 1 through 125
type ExitCode = 0 | FailureExitCode | 130 | 141 | 143;

abstract class LoomError extends Error {
  static readonly exitCode: FailureExitCode; // 1
  get exitCode(): FailureExitCode; // the class's code
  constructor(message: string, options?: ErrorOptions);
}

// The sysexits.h names, each with its literal number type.
const EX_USAGE: 64; // the command was used incorrectly
const EX_DATAERR: 65; // the input data was incorrect
const EX_NOINPUT: 66; // an input file did not exist or could not be read
const EX_NOUSER: 67; // an addressee is unknown
const EX_NOHOST: 68; // a host name is unknown
const EX_UNAVAILABLE: 69; // a service is unavailable
const EX_SOFTWARE: 70; // an internal software error
const EX_OSERR: 71; // an operating system error
const EX_OSFILE: 72; // a system file is missing or malformed
const EX_CANTCREAT: 73; // an output file cannot be created
const EX_IOERR: 74; // an input or output error
const EX_TEMPFAIL: 75; // a temporary failure; a retry may succeed
const EX_PROTOCOL: 76; // a remote system broke the protocol
const EX_NOPERM: 77; // permission is insufficient
const EX_CONFIG: 78; // the configuration is wrong
```

```ts
import { Application, EX_UNAVAILABLE, FatalError, override } from '@loomcli/core';

export class RegistryUnavailableError extends FatalError {
  static override readonly exitCode = EX_UNAVAILABLE;
  readonly status: number;

  constructor(status: number) {
    super(`The registry answered ${String(status)}.`);
    this.name = 'RegistryUnavailableError';
    this.status = status;
  }
}

// A failed health check prints `deploy: the registry is unavailable (503); retry later.` and exits 69.
const app = new Application('deploy', {
  views: [
    override(RegistryUnavailableError, {
      render: (failure) => `deploy: the registry is unavailable (${String(failure.status)}); retry later.\n`,
    }),
  ],
}).action(async ({ signal }) => {
  const response = await fetch('https://registry.example/health', { signal });
  if (!response.ok) {
    throw new RegistryUnavailableError(response.status);
  }
});
```

A failure class states its exit code once, on the class, so a script branches on the code the way a view branches on the class. [ADR-0045](../decisions/0045-a-failure-class-declares-its-exit-code.md) records the decision, and [ADR-0095](../decisions/0095-the-type-bounds-a-declared-exit-code.md) carries it forward with the type alone bounding the code.

- **The declaration.** A class declares its code as `static override readonly exitCode`. Core reads the code from the thrown failure's class, walking to the nearest ancestor that declares one, so a subclass that declares none exits with its parent's code and every class reaches `LoomError`'s 1. `failure.exitCode` reports the same value, so a view reads it on the instance, and a projection reads `Class.exitCode` without constructing a failure. Nothing sets a code per throw, so one class never exits with two codes.
- **Read from the class.** Core reads the code from the failure's class and captures nothing. A static the author's code rewrites, a static getter, and an instance field that shadows the accessor are the author's code, and core adds no rule for them, under [ADR-0095](../decisions/0095-the-type-bounds-a-declared-exit-code.md).
- **Read-only on the instance.** The instance's `exitCode` is an accessor without a setter, so TypeScript rejects a subclass that declares it as a property, `'exitCode' is defined as an accessor in class 'FatalError', but is overridden here in 'ShadowError' as an instance property.` (TS2610), and an assignment to it as a read-only property (TS2540).
- **The range.** A class declares 1, 2, or a code from 3 through 125, the members of the exported `FailureExitCode`. 1 and 2 keep core's meanings, an application failure and invalid input. 0 and every code from 126 up are reserved: 0 is success, 126 and 127 belong to the shell, and 128 plus a signal number reports a signal, which covers 130, 141, and 143.
- **Type checks.** `LoomError` types its static as `FailureExitCode`, so TypeScript rejects a literal outside the range and a plain `number` on the class line as a static side that incorrectly extends its base. A `readonly` static with a literal initializer takes that literal as its type, so a class whose own subclasses declare other codes annotates its declaration, `static override readonly exitCode: FailureExitCode = EX_DATAERR;`.
- **No run-time check.** `LoomError`'s constructor reads no exit code to judge it. A class that declares a reserved code through JavaScript or `any` exits with that code, because a value that bypasses the types gets no rule. Core never clamps or replaces a code.
- **The sysexits names.** `@loomcli/core` exports the fifteen constants above as flat names with literal types, the values of `sysexits.h`. `EX_OK` is not exported, because no failure declares 0. `EX_USAGE` serves an author's own usage failure: core raises invalid input as 2 and never 64, and no application setting changes that.
- **Core's classes.** `LoomError` declares 1 and `UsageError` declares 2, and every other core class inherits its code, so the table in [Failure classes](#failure-classes) holds. `LoomError`'s constructor takes the message and the platform's optional `ErrorOptions`, and no code.
- **Wherever it is raised.** The declared code holds for a failure an action throws, a failure a [middleware](middleware.md) throws before its `next()` has settled, and a failure a [configuration source](input-sources.md) throws or rejects with, and it holds for a failure a [translator](#translators) returns for a foreign throw from any of the three. A class that declares 2 without extending `UsageError` exits 2 but takes no application-name prefix, which core's default text adds for a `UsageError` alone, and no `UsageError` override reaches it.
- **What outranks it.** The ordering in [Signals and cancellation](signals.md) is unchanged: a cancelled run resolves its signal's code whatever failure its action raised, and a broken failure view or destination forces 1. A working view cannot change the code.

### Declared exit codes acceptance

Declared exit codes are proven when public APIs alone produce these results under Node and Bun:

- **Declared.** A `FatalError` subclass that declares `EX_UNAVAILABLE`, thrown from an action, exits 69 and renders through its own override, whose view reads `failure.exitCode` as 69.
- **Inherited.** A subclass of that class that declares nothing exits 69, a `FatalError` subclass that declares nothing exits 1, and `LoomError.exitCode`, `UsageError.exitCode`, and `InputError.exitCode` read 1, 2, and 2 without an instance.
- **Reserved.** A JavaScript class that declares 130 exits 130. The negative type checks reject 0, 126, and a plain `number` on the class line, a subclass property override of `exitCode` (TS2610), and an assignment to it (TS2540).
- **Middleware.** A middleware that throws the class before calling `next()` exits 69.
- **Configuration source.** A resolver that throws or rejects with the class exits 69 and reports nothing under `--help`; one that calls `out.fatal()` exits 1 with the message alone; a plain `Error` that no translator answers stays the plugin fault with code 1; and the class thrown from a getter on the answers record or from an answer's `value` getter stays the plugin fault with code 1.
- **Cancellation.** An action that throws the class after a caller abort resolves 130.
- **Broken view.** An override of the class that throws writes the class's default text and the internal-error line through the fallback path, and the run returns 1.
- **Exports.** The fifteen constants hold their `sysexits.h` values, `EX_OK` is absent, and `FailureExitCode` accepts 1 and 125 and rejects 0 and 126.
- **Example.** `jsonkit get missing -f doc.json` and `jsonkit keys missing -f doc.json` exit 65, as the [failure example coverage](output.md#example-coverage) pins.

## Failure codes

```ts
abstract class LoomError extends Error {
  static readonly code: string; // 'failure'; a kebab-case code
  static readonly exitCode: FailureExitCode; // 1
  get exitCode(): FailureExitCode;
  constructor(message: string, options?: ErrorOptions);
}
class FatalError extends LoomError {
  static override readonly code: string; // 'fatal'; each core class annotates its code as string
}
function isFailureCode(value: unknown): value is string;
```

```ts
import { EX_DATAERR, FatalError } from '@loomcli/core';

// `jsonkit get missing -f doc.json` exits 65, and a machine reader branches on `path-not-found`.
export class PathNotFoundError extends FatalError {
  static override readonly code = 'path-not-found';
  static override readonly exitCode = EX_DATAERR;
  readonly path: string;

  constructor(path: string) {
    super(`Path not found: "${path}". Run jsonkit keys to list the keys at the root.`);
    this.name = 'PathNotFoundError';
    this.path = path;
  }
}
```

A failure class states a failure code once, on the class, so a script or an agent tells one failure from another where many share an exit code. The code is read the way [Declared exit codes](#declared-exit-codes) reads the exit code. [ADR-0064](../decisions/0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) records the decision.

| Class                     | Failure code                   |
| ------------------------- | ------------------------------ |
| `LoomError`               | `failure`                      |
| `UsageError`              | `usage`                        |
| `InputError`              | `invalid-input`                |
| `UnknownCommandError`     | `unknown-command`              |
| `NonCallableCommandError` | `missing-subcommand`           |
| `UnexpectedArgumentError` | `unexpected-argument`          |
| `UnknownOptionError`      | `unknown-option`               |
| `MissingValueError`       | `missing-value`                |
| `UnexpectedValueError`    | `unexpected-value`             |
| `RepeatedOptionError`     | `repeated-option`              |
| `MisplacedOptionError`    | `misplaced-option`             |
| `FatalError`              | `fatal`                        |
| `WorkingDirectoryError`   | `working-directory-unreadable` |
| `DeclarationError`        | `internal`                     |
| `InternalError`           | `internal`                     |
| `ResultError`             | `internal`, inherited          |

- **The declaration.** A class declares its code as `static override readonly code`. Core reads the code from the thrown failure's class, walking to the nearest ancestor that declares one, so an author class that declares none reads its parent's: a bare `FatalError` subclass reads `fatal`, and a class that extends jsonkit's `PathNotFoundError` without a code reads `path-not-found`. A projection reads `Class.code` without constructing a failure.
- **The grammar.** A code is one or more words of lowercase ASCII letters and digits joined by single hyphens, the grammar of the rule name that ends a [rule identity](declaration-faults.md#developer-diagnostics), such as `path-not-found` or `http-503`. It has no package part: a code names one failure of the application that raises it. `isFailureCode(value)`, exported from `@loomcli/core`, answers whether a value is a string in this grammar, the check `LoomError`'s constructor runs, so a projection that lists classes no run has constructed, as the [manifest](../plugins/manifest.md#manifest-failures) does, checks a code against core's grammar instead of a copy.
- **Read from the class.** Core reads the code from the failure's class as it reads the exit code, and captures nothing, under [ADR-0095](../decisions/0095-the-type-bounds-a-declared-exit-code.md).
- **On the class alone.** A failure instance carries no `code` member of core's. The [failure form](#the-failure-form) reports the class's code, and an author's own instance field named `code`, such as one copied from a Node system error, keeps its own meaning.
- **Type checks.** `LoomError` types its static as `string`, and every core class annotates its own as `string`, so a subclass declares any literal. A `readonly` static with a literal initializer takes that literal as its type, so an author class whose own subclasses declare other codes annotates its declaration, `static override readonly code: string = 'registry';`. A static that is not a string is a compile error, as a static side that incorrectly extends its base (TS2417). The types do not check the grammar.
- **An invalid code.** `LoomError`'s constructor reads the class's code and, when it is not a string in the grammar, throws a `DeclarationError` under `@loomcli/core/failure-code` in place of the failure: `Failure class "RegistryDownError" declares failure code "Registry_Down".`, with the correction `Declare a kebab-case code of lowercase letters and digits, such as "registry-down".` and an explanation that says a machine reader branches on the code, so it follows one grammar. A value that is not a string reads `declares a failure code that is not a string.` in place of `declares failure code "Registry_Down".` The class is named by `new.target.name`, escaped, and the fault carries no finding, because a class declaration is no call. A failure constructed inside a run reports the fault with code 1, by build as [Development builds](release-facts.md#development-builds) states, and one constructed outside a run throws at that line.
- **Author faults read `internal`.** `DeclarationError`, `InternalError`, and `ResultError` read `internal`, and the failure form reads `internal` for every failure that is an instance of `DeclarationError` or `InternalError`, in both builds, so no rule identity and no class reaches a machine reader. A defect a [translator](#translators) never answered and a build fault both read `internal`.
- **Its readers.** The [failure form](#the-failure-form) carries the code to [`invoke`](invocation.md#invocation-by-name)'s outcome, to a [failure encoder](failure-views.md#failure-encoders), and to the [MCP](../plugins/mcp.md) plugin's failed calls, and the [manifest](../plugins/manifest.md#manifest-failures) lists each declared failure by its class's code.

### Failure codes acceptance

Failure codes are proven when public APIs alone produce these results under Node and Bun:

- **Core's codes.** Each class in the table reads its code without an instance, and a failure core raises for each reaches `invoke`'s `failed.form.code` with it.
- **Inherited.** A `FatalError` subclass that declares nothing reads `fatal`, a subclass of `PathNotFoundError` that declares nothing reads `path-not-found`, and a direct `LoomError` subclass that declares nothing reads `failure`.
- **The example.** jsonkit's `PathNotFoundError` declares `path-not-found` and its `InvalidJsonError` declares `invalid-json`, and `jsonkit.invoke(['get'], { args: { path: 'missing' }, options: { file: 'doc.json' } })` reads `path-not-found` with exit 65.
- **Invalid.** Classes that declare `'Path_Not_Found'`, `''`, `'-x'`, `'a--b'`, `'path not found'`, and `42` each throw `@loomcli/core/failure-code` at construction, and an action that constructs one exits 1 with the Developer Diagnostic from source and the generic defect message from a bundle.
- **Author faults.** A `TypeError` from an action, a `ResultError`, a build fault, and an author's `InternalError` subclass that declares `'oops'` each read `internal` in both builds.
- **Types.** The negative type checks reject a numeric static `code` and a subclass whose literal code conflicts with a literal-typed parent's.

## The failure form

```ts
interface FailureForm {
  readonly code: string; // the class's failure code; 'internal' for a defect or a declaration fault
  readonly exitCode: FailureExitCode; // the failure's declared exit code
  readonly message: string; // the sentence as plain text, without the application-name prefix
  readonly hints: readonly string[]; // the onFailure lines as plain text, in the order the failure view receives them
}
```

```ts
import { textstat } from './application.js';

// `textstat --metric nope one.txt`, run by name: the form is the same data a failure encoder writes.
const outcome = await textstat.invoke([], { args: { files: ['one.txt'] }, options: { metric: 'nope' } });
if (outcome.status === 'failed') {
  // {"code":"invalid-input","exitCode":2,"message":"Option \"metric\": Expected one of: bytes, words, lines.","hints":[]}
  process.stdout.write(`${JSON.stringify(outcome.form)}\n`);
}
```

The failure form is one failure as plain data, so a reader that cannot parse prose reads what went wrong. Core builds it, and the readers that need a failure as data share it: [`invoke`](invocation.md#invocation-by-name)'s outcome and its caller's handler, a [failure encoder](failure-views.md#failure-encoders) under `run()`, and the [MCP](../plugins/mcp.md) plugin. [ADR-0064](../decisions/0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md) records the decision.

- **When.** Core builds one form for each failure it reports, after the [translators](#translators) and the `onFailure` [hooks](lifecycle-hooks.md#failure-hints), so a translated failure reads its own class and the form holds the hooks' hints. It is a frozen plain object whose keys are, in order, `code`, `exitCode`, `message`, and `hints`.
- **`code`.** The class's [failure code](#failure-codes), or `internal` for a defect or a declaration fault.
- **`exitCode`.** The failure's declared exit code, the value `failure.exitCode` reads. The code the run resolves can differ: a broken failure view, `onFailure` or `onLog` hook, or failure encoder forces 1, and a cancelled run keeps its signal's code. `invoke`'s outcome reports that code beside the form.
- **`message`.** For an operator failure, the failure's `message`: the sentence without the application-name prefix, so a usage error that reports two problems holds both lines, separated by one line break, with no trailing newline. Core resolves its markup as plain text, as [`invoke`](invocation.md#invocation-by-name) resolves its captured text, with no color, modifier, or hyperlink. For a defect or a declaration fault, the message follows the build: `Something went wrong.` in a [distributed build](release-facts.md#development-builds), and the fault's `sentence` in a development build. A form never carries a cause, a stack, a finding, or a rule identity.
- **`hints`.** The hints the [failure view context](failure-views.md#failure-view-context) receives, each resolved as plain text, in the same order. It is `[]` when no hook contributed and for a failure no hook runs for, such as a build fault.
- **Nothing else.** The form carries no exit name, because the [manifest](../plugins/manifest.md)'s `exitCodes` table explains each number, and no fact of the class, such as `InputError.problems`. A later field can add class facts without changing the four.
- **Not on the views.** A failure view and an `onFailure` hook receive the failure and their contexts, never the form.
- **Names.** `FailureForm` is exported from `@loomcli/core`.

### The failure form acceptance

The failure form is proven when public APIs alone produce these results under Node and Bun:

- **The example.** The `invoke` above reads the form in its comment, and `jsonkit.invoke(['get'], { args: { path: 'missing' }, options: { file: 'doc.json' } })` reads `{ code: 'path-not-found', exitCode: 65, message: 'Path not found: "missing". Run jsonkit keys to list the keys at the root.', hints: [] }`.
- **Two problems.** An `InputError` with two problems reads both lines in `message`, with no application name and no trailing newline.
- **Plain text.** A `FatalError` whose message carries a style mark, and a hint that carries one, read as plain text with no ANSI and no markup under `FORCE_COLOR=1`.
- **By build.** A `TypeError` from an action reads `Something went wrong.` from a bundle and the defect's sentence from source, and neither form holds a stack frame.
- **Hints.** Two fixture plugins' hints read in installation order, and a build fault reads `[]`.
- **Exit codes.** A usage error whose `onFailure` hook breaks reads `exitCode` 2 in the form and 1 on the outcome.
- **Frozen.** An assignment to a form's member throws in strict mode code.

## Translators

```ts
type ErrorClass<Thrown extends object> = abstract new (...args: never[]) => Thrown;
type Translator<Thrown extends object> = (error: Thrown) => LoomError | undefined;
function translate<Thrown extends object>(key: ErrorClass<Thrown>, translator: Translator<Thrown>): Translation; // Translation is opaque and branded

interface ApplicationOptions {
  translators?: readonly Translation[];
  // ...
}
interface PluginDefinition<Options extends PluginOptions, Theme extends ThemeMapping = ThemeMapping> {
  translators?: readonly Translation[];
  // ...
}
```

```ts
import { Application, EX_DATAERR, FatalError, translate } from '@loomcli/core';

import { summarize } from './actions/summarize.js';

// JSON.parse throws a SyntaxError for a malformed document, and the reader no longer catches it:
// `jsonkit get name -f broken.json` exits 65 and writes the class's sentence.
export class InvalidJsonError extends FatalError {
  static override readonly exitCode = EX_DATAERR;

  constructor(options?: ErrorOptions) {
    super('The document is not valid JSON. Correct its syntax, or supply another document.', options);
    this.name = 'InvalidJsonError';
  }
}

export const jsonkit = new Application('jsonkit', {
  translators: [translate(SyntaxError, (error) => new InvalidJsonError({ cause: error }))],
}).action(summarize);
```

A translator turns a foreign throw, an error a library or the platform raised, into one of the author's failure classes, so the failure exits with the class's code and renders through its view, and no action repeats the catch. [ADR-0049](../decisions/0049-a-translator-turns-a-foreign-throw-into-a-failure-class.md) records the decision.

- **The translation.** `translate(key, translator)` pairs an error class with a function and returns a `Translation`. The function receives the thrown instance, typed from the class with no narrowing, and returns a failure or `undefined`. `undefined` passes the throw on. An error that shares its class with others, such as Node's system errors, which are `Error` instances told apart by `code`, is keyed on that class and checked inside the function.
- **Who registers them.** An application lists its translations under `translators`, and a plugin under its own `translators`, so a plugin that wraps a client ships the translations for that client's errors.
- **Resolution.** The walk [Views](views.md) defines: the application's list first, then each installed plugin's in installation order. At each contributor the thrown value's prototype chain is walked in full, most derived first, before the next contributor is consulted, and a translation matches when its key's `prototype` is the link being walked. Within one contributor, translations for one class run in list order, and one class may hold several. The first translator that returns a failure wins, so an application's translation keyed on `Error` answers before a plugin's keyed on `SyntaxError`.
- **What reaches a translator.** A throw from an action, from a [middleware](middleware.md), or from an [input source](input-sources.md) resolver, the configuration source included. The action's work includes the row source it passes to `out.results` or to `out.render` with a row view, and the write it awaits, so a source's throw and a destination's write failure, such as `ENOSPC`, that the action lets propagate reach the translators too. A write to a stdout whose reader closed the pipe rejects with the run signal's reason, a cancellation echo, so it never reaches them. A `LoomError` is never offered, and neither is a value with no prototype chain a class can match, such as a thrown string or an object with a `null` prototype; those report as today. A chain that a construction built to break the code makes unreadable gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md). A cancellation echo, the signal's reason or an `AbortError` in a cancelled run, is never offered and keeps its signal's code under [Signals and cancellation](signals.md). A throw from Loom's own contracts is never offered: a translator, an `onFailure` hook, a validator, a plugin loader, a `next()` misuse, and the result contract each report a defect in the code that broke the contract. A view's failure that the action or a middleware lets propagate is that code's throw and is offered like it, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md).
- **Where it happens.** Core offers a throw once, at the point it would otherwise wrap it as an `InternalError`: where it leaves the middleware chain, for an action's or a middleware's throw, and where the resolver's call settles, for a source's throw, ahead of the plugin-fault wrap [Input sources](input-sources.md) applies. A row source that throws after the action settled, because the action never awaited its call, is offered once where core reports it as a deferred fault under [Results](results.md); the translated failure, or a throwing translator's defect, takes that internal error's place and its report, and it turns a would-be 0 into its own code, while a failure the run already reported as primary keeps its code. The rows the source yielded before the throw stay written, no `tail` is written, and the incomplete-result line precedes the translated failure's report, as it precedes any fault's. A middleware that awaits `next()` therefore sees the action's own throw, as it does without translators, and one that rethrows it passes the same value on. A middleware's own throw during unwinding, after its `next()` has settled, is that middleware's throw and is offered like any other, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A translated failure or a throwing translator's defect from a source is held like the source's own failure and raised at the dispatch boundary, so a takeover such as `--help` reports neither.
- **The translated failure.** It reports as the failure the action raised would: it exits with its class's code under [Declared exit codes](#declared-exit-codes), each `onFailure` hook receives it, and its view renders it. Cancellation still outranks it. It prints the same text in a development build and a distributed one, because it is an operator failure.
- **The cause.** A failure carries the foreign throw only when the translator passes it, `{ cause: error }`. Core never sets `cause` on the failure a translator returns.
- **A translator that throws.** Its throw is a foreign throw from the author's code: core consults no later translator and reports an `InternalError` under `@loomcli/core/foreign-throw` through the ordinary failure path, with the translator's throw as its `cause`, so the [Developer Diagnostic](declaration-faults.md#developer-diagnostics) shows the translator's own line and its throw. The throw is never offered to a translator, so no translator answers its own failure. A distributed build prints the generic defect message and exits 1. A translator's answer that is not a failure or `undefined`, such as a string or a promise, gets no rule, because its type rejects it, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md).
- **Synchronous.** A translator runs synchronously and receives the thrown value alone.
- **Names and faults.** `translate`, `Translation`, `Translator`, and `ErrorClass` are exported. A translation another installed copy of core built is a `DeclarationError` from the call that holds the list, `plugin()` for a plugin's list and the Application constructor for the application's. The types give `translate()` a class key and a translator function. A key that is a failure class is the author's to avoid: core never offers a failure to a translator, so such a translation never runs.

### Translators acceptance

Translators are proven when public APIs alone produce these results under Node and Bun:

- **Example.** jsonkit's reader holds no `JSON.parse` catch, and its application registers the translation above. `jsonkit get name -f broken.json` and the same document piped to `jsonkit get name` exit 65 and write `The document is not valid JSON. Correct its syntax, or supply another document.`, and an `onFailure` hook in a fixture reads the `SyntaxError` as the failure's `cause`.
- **Untranslated.** A `TypeError` from an action with no translation for it reports as an `InternalError` with exit 1.
- **Order.** An application's translation and a plugin's for one class resolve to the application's; an application's translation keyed on `Error` beats a plugin's keyed on `SyntaxError`; two plugins resolve in installation order; a translator that returns `undefined` passes to the next one, within one contributor in list order and then to the next contributor.
- **Reach.** A foreign throw from an action, from a middleware before it calls `next()`, and from a configuration source's resolver each reaches the translator and exits with the translated class's code, 69 for a class that declares `EX_UNAVAILABLE`. A row source that yields one row and then throws a `SyntaxError` under `out.results()` exits 69 whether the action awaited the call or never awaited it, with the row and the incomplete-result line ahead of the translated failure's report, and an action that caught its rejection exits 0 with the row and the line and calls no translator. A middleware that throws an `Error` after its `next()` has settled reaches the translator and exits 69, and a stdout write that fails with an `ENOSPC`-style error under an awaited `out.print` exits 69 with no fallback line. A throw from a failure view, an `onFailure` hook, a validator, a getter on a validator's output, and a plugin loader, a thrown `FatalError`, a thrown string, and an object with a `null` prototype never reach it. A caller abort whose action rejects with the signal's reason resolves 130 and calls no translator.
- **The raw throw.** A middleware that awaits `next()` around an action that throws a `SyntaxError` catches the `SyntaxError`, not the translated failure.
- **A translator that throws.** It reports a defect with exit 1, and a later translator that would have answered is not called. In a distributed build the text is the generic defect message; in a development build it is the diagnostic of `@loomcli/core/foreign-throw`, which shows the translator's line and its throw, the defect's `cause`.
- **Types.** The translator's parameter types as the key's instance type, and a translator returning a string or an `Error` that is not a `LoomError` is a compile error.

## Failure contract

View and destination failures are internal errors and return code 1, except in a cancelled run as [Signals and cancellation](signals.md) defines it, where the code stays the signal's and the fault is reported as text; every row below reads with that carve-out and one more: a failure the chain or the action raised stays primary over a view failure no code awaited and keeps its own code, so an action that throws an `InputError` after an unawaited broken `out.render` returns 2 and the view failure reports after it. The rows speak of the chain, because a middleware calls `out.render` and the semantic methods under the same output contract an action has, and the help page is rendered by one.

| Failure                                           | Observation                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An output view throws                             | The `out.render` call rejects with the view's error, and nothing is written for that call under a whole view; a row view's pieces before the fault stand, under [Results](results.md). Later output still writes. A rejection the action or a middleware lets propagate is that code's failure: a foreign throw under `@loomcli/core/foreign-throw`, never offered to a translator, and a thrown failure class with its own code. A call no code awaited has no catcher, so after the chain has settled core reports the view's throw through the ordinary failure path the same way, after any failure the chain raised, and a run that would have returned 0 returns 1. A rejection the code caught is final. |
| A lane view throws                                | The semantic call rejects with the view's error, and nothing is written for that call. The rest of the row above applies.                                                                                |
| The reader of stdout closes the pipe              | A write to the run's stdout fails with `EPIPE`, which Node and Bun both report, or with `ENOTCONN`, which Bun reports for a macOS socket stdout. It is the end of the run, not a defect: core aborts the run signal with the closed-pipe reason under [Signals and cancellation](signals.md), the call and every later stdout write reject with that reason, which is silent, and core writes no failure report and no incomplete-result line for it, logs no failure event, and returns 141. Stderr's closed reader, and every write captured by an [invocation by name](invocation.md#invocation-by-name), take the row below. |
| A destination write fails                         | The call rejects, later writes to that destination reject, core reports the broken destination by build through one plain stderr fallback, the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of `@loomcli/core/broken-destination`, whose sentence is `Could not write invocation output.`, in a development build, and returns 1, unless the action awaits the call, lets its rejection propagate, and a [translator](#translators) answers it: the translated failure then reports in place of the fallback report and returns its own code. |
| A failure view throws                             | Core writes the default text of the original failure through the plain fallback path on stderr, bypassing every override whichever contributor made it, then reports the broken view by build: the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of `@loomcli/core/broken-failure-view`, whose sentence is `Rendering the failure failed: <reason>`, in a development build. It returns 1. The original failure stays primary. |
| A failure encoder throws or returns a non-string  | Core writes the default text of the original failure through the plain fallback path on stderr, then reports the broken encoder by build: the generic defect message in a distributed build, at most once per run, and the Developer Diagnostic of `@loomcli/core/broken-failure-encoder` in a development build, under [Failure encoders](failure-views.md#failure-encoders). It returns 1. The original failure stays primary. |
| An `onFailure` hook throws                        | Core calls no later hook and writes the failure's default text with no plugin's hints through the plain fallback path, then reports the throw as a foreign throw by build, and returns 1. The original failure stays primary. [Failure hints](lifecycle-hooks.md#failure-hints) states the report. |
| An `onLog` hook throws                            | Core keeps calling the hook for every later event of the run. It reports the hook's first throw once, after the outcome and every other report, as a foreign throw through the ordinary failure path by build, and returns 1, or the signal's code in a cancelled run, under [Observing log events](lifecycle-hooks.md#observing-log-events). A value the hook returns gets no rule. |
| The fallback write fails                          | Reporting stops. `run()` still resolves 1.                                                                                                                                                                                                                                                                        |

Successful completion requires output completion. A view failure during the chain or the action makes the invocation unsuccessful when the action or the middleware lets the rejection propagate or never awaits the call. When that code catches the rejection, the run's outcome is what the code produces, under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). A value a view returns in place of a string gets no rule, under [ADR-0093](../decisions/0093-a-value-that-bypasses-the-types-gets-no-rule.md): core writes what `String()` reads from it. The fallback path calls no override and no lane; it calls core's default text function. The reason a thrown value gives is its message when it is an Error, and `An unknown error occurred.` when it is not. The plain fallback path writes the reason on one line, with each control character and line separator escaped by [`escapeControlCharacters`](styles.md#strings-and-composition).

## Failure messages

A failure message tells its reader what went wrong and what to do instead. This page states the rule every message Loom ships follows, and shows an application author how to follow it in their own messages. [ADR-0047](../decisions/0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md) records the decision. Loom's messages follow the rules, and the [audit](#9-audit) records each message the rules changed, with its text before and after. [Failure views](failure-views.md#failure-views) describe how core renders a failure, and [Issue codes](../libs/validators.md#issue-codes) describe how an author rewords a catalog sentence.

```text
Before: textstat: Option "--config": File "settings.json" is not valid JSON.
After:  textstat: Option "--config": File "settings.json" is not valid JSON. Correct its syntax, or supply another file.
```

The rules below bind every operator message Loom ships: core, `@loomcli/plugins`, and `@loomcli/validators`. Loom cannot check a message an application writes. For an application, the rules are guidance, and the example applications model rules 2 and 3.

### 1. Know who reads the message

- **Operator message.** Any message that runs after the application is built and shipped: a usage error, a rejected value, a warning, a fatal error an action raises, and a defect. Its reader ran the application and cannot change its code.
- **Author message.** A message that runs while the author develops the application: a declaration fault at a call, an attach, or graph build under [Declaration faults](declaration-faults.md), and any other code or build fault. An author message never prints on a shipped application. It follows rule 2 addressed to the author, and each rule's diagnostic under [Declaration faults](declaration-faults.md) already does.

### 2. Say what went wrong and what to do instead

Every operator message has two required parts:

- **What went wrong**, naming the specific thing: the input, the file, the position, or the path.
- **What to do instead**: an action, or what is accepted.

For a rejected value, the catalog's `Expected ...` sentence is the second part, because core prefixes the input's name under [Issues and validator failures](validation.md#issues-and-validator-failures): `Option "--workers": Expected a whole number from 1 through 64.`

| Before                                   | After                                                                              | What changed                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `app: Argument "path": Expected a path.` | `app: Argument "path": Expected a nonempty path with no NUL character.` | The accepted form is specific. |
| `Unknown command "nope".`                | `Unknown command "nope". Supply the name of a declared command.`                   | The sentence gains its fix.           |
| `Path not found: a.b`                    | `Path not found: "a.b". Run jsonkit keys to list the keys at the root.`          | An application names its own Command. |

### 3. Leave plugin pointers to hint lines

A pointer that depends on which plugins are installed, such as `Run with --help.`, an `--explain` option, or a suggested spelling, never appears in core's sentence, because core cannot know the plugin is installed. It arrives as a hint line from a plugin's `onFailure` hook under [Failure hints](lifecycle-hooks.md#failure-hints), or, for a suggestion, in the sentence a plugin's own failure view writes, as the [suggestions](../plugins/suggestions.md) plugin does.

An application's own message may name its own Commands, as jsonkit's `Path not found` message names `jsonkit keys` above.

### 4. Repeat a value only when it is known not to be secret

- **Core and the catalog** never repeat an input's value, because they cannot know the value is not a secret. They describe what is accepted instead. Core already drops an unknown option's inline value after `=`, so the message for `--tokn=abc123` names `--tokn` alone. A Command word and an option spelling are structure, not an input's value, so core repeats them. A Command that declares children accepts no arguments, under [Application declarations](application.md), so a word in the position after it is a command word, never an input's value, and core may repeat it.
- **A plugin or an application** may repeat a value of an input it owns when it knows the value is not a secret: the configuration plugin repeats the `--config` file path, and jsonkit repeats a document path.

### 5. Escape everything repeated

Everything a message repeats is escaped. Escaping for quoted diagnostic text covers control characters and line separators, and also these format characters:

- the bidirectional embedding, override, and isolate controls U+202A through U+202E and U+2066 through U+2069;
- the marks U+200E, U+200F, and U+061C.

[`escapeControlCharacters`](styles.md#strings-and-composition) escapes all of them, and so does every place a Loom failure message quotes raw text. Results output is untouched, because right-to-left text uses these marks legitimately. Other format characters stay as they are: a zero-width joiner inside an emoji and a soft hyphen are ordinary text.

### 6. Quote no text Loom did not write

An operator message Loom ships never includes text Loom did not write: a thrown cause, an engine or Node.js reason, or a stack. Such text is a leak. It can hold a path or a value the operator never supplied, it changes between runtimes and versions, and it gives the operator no step to take.

The rule binds core, `@loomcli/plugins`, and `@loomcli/validators`, and not applications. An application owns its domain and decides for itself: jsonkit may include a runtime's reason in `Cannot read file: doc.json: ...`, because the reason locates the fault the operator must fix. It reports a malformed document through its [translator](#translators) and its own `InvalidJsonError` sentence, which quotes no engine text.

### 7. A defect shows one generic message

A defect is a failure only the author can fix: an unexpected exception no [translator](#translators) answered, a broken view, `onFailure` or `onLog` hook, or translator, a broken result contract, or an author fault rule 8 classifies as one. It is the application's equivalent of an HTTP 500. A log record that a logging plugin the author installed writes to the console is not an operator message, and may carry the defect's detail. In a distributed build the operator sees one generic message with no reason, no class name, and no code detail:

```text
jsonkit: Something went wrong.
```

The wording follows the status phrase web frameworks show for a 500, such as `Internal Server Error` and Rails' `We're sorry, but something went wrong.`, and claims nothing on the author's behalf: not that the fault is a bug, not where to report it, and not the version. The run exits 1, or keeps its cancellation code when the run was cancelled, as [Signals and cancellation](signals.md) ranks it.

- **The exception to rule 2.** The generic message is the one operator message with no next step, because a defect has none Loom can name honestly. An author who has one adds it.
- **Replacing it.** An author replaces the message with the existing `override(InternalError, view)` for defects and `override(DeclarationError, view)` for declaration faults, and adds a pointer, such as where to report the defect, through an `onFailure` hint.
- **The failure form.** In a distributed build, a defect's [failure form](#the-failure-form) carries the same generic message, `Something went wrong.`, and the code `internal`, so a JSON line or an invocation by name names no rule and no class either.
- **The author's detail.** The author sees what broke and how to fix it in a [Developer Diagnostic](declaration-faults.md#developer-diagnostics), which a [development build](release-facts.md#development-builds) renders in place of the generic message. The run's [release facts](release-facts.md), which the build bakes in, decide which build a run is.

### 8. Classify an author fault that reaches a shipped application

Some author faults can still reach an operator: a machine-dependent default its validator rejects at `run()`, an out-of-range exit code on a failure class constructed only on a failure path, two copies of one package, a validator that throws or returns a malformed result, and a plugin loader or `next()` fault.

- A fault the operator can fix becomes an operator message under rules 2 through 6.
- A fault only the author can fix is a defect under rule 7, and its message never advises the operator to change the application.
- A validator that rejects with no issues is a fault the operator can fix, by supplying a different value, so it stays an operator message: `The validator rejected this value without an explanation. Supply a different value.`

Moving a check earlier, so the fault cannot reach a shipped application, is separate work under [ADR-0034](../decisions/0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md).

### 9. Audit

The audit listed every operator message Loom ships and checked it against rules 2 through 6. Author messages were swept mechanically for rule 2. The table records the Loom-owned operator messages the audit changed, with the text each had before and has now. Core's defect lines, the `InternalError` default, the broken `onFailure` hook line, and `Rendering the failure failed`, follow rule 7 and change with [development builds](release-facts.md#development-builds), not in this audit.

| Source                                                      | Before                                                                               | After                                                                                                            | Rule |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---- |
| `UnknownCommandError`, `NonCallableCommandError` candidates | A deprecated child is listed. For example: `Use one of: get, keys, select, fetch.`                | A deprecated child is left out, as [ADR-0043](../decisions/0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) leaves it out of completion. For example: `Use one of: get, keys, select.` | 2 |
| Core, every `UsageError`                                    | The category prefix `Invalid input: ` opens the diagnostic.                          | The application name and a colon open every problem line, `jsonkit: Unknown command "nope". Use one of: get, keys.`, the form docker, heroku, and terraform use, so the operator reads who is speaking and not a parser category. An `InputError` with two problems prints two lines that each open with the name, and the hint lines under them open with none. `Invalid declaration: ` stays, because it is an author message. | 2 |
| `UnknownCommandError` with no candidates                    | `Unknown command "nope".`                                                            | `Unknown command "nope". Supply the name of a declared command.`                                                 | 2    |
| `NonCallableCommandError` with no candidates                | `Command "cache" requires a subcommand.`                                             | `Command "cache" requires a subcommand. Supply the name of a declared subcommand.`                               | 2    |
| `NonCallableCommandError` at the root                       | `The root Command requires a subcommand.`                                            | `A command is required. Use one of: get, keys.`, or with no candidates, `A command is required. Supply the name of a declared command.`, so the line reads `jsonkit: A command is required. Use one of: get, keys.` under the prefix row above and names the application once. | 2 |
| Core, a validator that returns no issue                     | `The validator rejected this value without an explanation.`                         | `The validator rejected this value without an explanation. Supply a different value.`                            | 2    |
| Configuration plugin, `--config`                            | `File "<path>" does not exist.`                                                      | `File "<path>" does not exist. Supply the path of an existing file.`                                             | 2    |
| Configuration plugin, `--config`                            | `File "<path>" could not be read.`                                                   | `File "<path>" could not be read. Supply a file this process can read.`                                          | 2    |
| Configuration plugin, `--config`                            | `File "<path>" is not valid JSON.`                                                   | `File "<path>" is not valid JSON. Correct its syntax, or supply another file.`                                   | 2    |
| Configuration plugin, `--config`                            | `File "<path>" does not hold a JSON object.`                                         | `File "<path>" does not hold a JSON object. Write its settings as one JSON object.`                              | 2    |
| Configuration plugin, a discovered file                     | `Skipped <file>: the file is not valid JSON.`, and the two other warnings            | Each warning ends with its fix: `Make it readable, or remove it.`, `Correct its syntax, or remove it.`, or `Write its settings as one JSON object, or remove it.` | 2 |
| Formatter plugin, `json()` and `jsonl()`                    | `The value cannot be encoded as JSON: <engine reason>.`                              | `The value cannot be encoded as JSON. Emit plain JSON data from the action.` The thrown error keeps the engine's error as its `cause`. | 6, 7 |
| Formatter plugin, an `undefined` value                      | `The value cannot be encoded as JSON: the value is undefined.`                       | `The value cannot be encoded as JSON, because it is undefined. Emit plain JSON data from the action.`            | 2    |
| Manifest plugin, an unencodable input default or schema     | `The manifest cannot encode <detail> as JSON. Supply a value that is null, a Boolean, a finite number, a string, or an array or plain object of these.` | Unchanged; the sentence is the defect's author detail under rule 7. | 7 |
| `path()` with no `access`                                   | `Expected a path.`                                                                   | `Expected a nonempty path with no NUL character.`                                                                | 2    |
| `text()` with a `pattern` and no `message`                  | `Expected a value that matches the required pattern.`                                | No default. `message` is required beside `pattern`, under [text](../libs/validators.md#text).                            | 2    |
| Every rule in the validator catalog                         | The issue carries no code.                                                           | The issue carries its code and parameters under [Issue codes](../libs/validators.md#issue-codes).                        | -    |
| Quoted diagnostic text: core's routing token and option spellings, and the configuration plugin's paths | Core's tokens are not escaped (the renderer drops C0 controls, and bidirectional controls pass); `escapeControlCharacters` covers control characters and line separators. | Also the format characters under rule 5.                                                                         | 5    |

The formatter's and the manifest's encode faults are defects under rule 7; their rewritten sentences are the author's detail, and the operator of a [distributed build](release-facts.md#development-builds) sees the generic message.

The example applications were audited against rules 2 and 3 too: every `fatal`, `warn`, and `FatalError` sentence in jsonkit and textstat ends with its fix, such as `Field not found: "name". Run jsonkit keys to list the fields.`, each quoting the path or field it repeats so a trailing dot stays inside the quotes, jsonkit's and textstat's `Cannot read` keep their runtime reasons under rule 6, each closed by one period before the fix, and jsonkit's translated `The document is not valid JSON.` quotes none. jsonkit's branded `InputError` and `UnknownCommandError` views keep their text until they give way to core's default text, as [Example coverage](commands.md#example-coverage) describes.
