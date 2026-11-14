# Results and failures

This reference covers what a Command hands its consumer: a declared result when it succeeds, and a failure class when it does not.

## Declare a result when the output is data

Declare `result<Value>()` or `rows<Row>()` when a script or an agent reads what the Command produces, such as a list, a record, or a computed value. Write through the semantic lanes (`out.info`, `out.success`, `out.warn`) when the Command reports on its work. A Command that only changes something, such as a deploy, declares no result and ends with `out.success`.

A result is one declaration that every projection reads, so declaring it is what makes the Command usable by machines:

- The [formatter](../../../../../docs/plugins/format.md) adds `--format` to every Command that declares a result, and the `json` and `jsonl` views to a record that lacks them.
- The [manifest](../../../../../docs/plugins/manifest.md) publishes the view names and the [media type](../../../../../docs/core/results.md#media-types) of each view.
- An [MCP tool](../../../../../docs/plugins/mcp.md) call selects the first view whose media type is `application/json` and sends its output as structured content. With no such view, the agent receives plain text. Without the formatter installed, list `json: json()` from `@loomcli/plugins/format` yourself.
- [`invoke`](../../../../../docs/core/invocation.md#invocation-by-name) captures the rendered result as the outcome's `output`.

Keep these invariants:

- Emit the result once, through `out.results`, before the action returns. The action's return value is not the result: core ignores it. A return without the call, or a second call, fails the run with `ResultError`, exit 1, under [Emitting a result](../../../../../docs/core/results.md#emitting-a-result).
- On a Command that declares a result, stdout carries the result and nothing else. The action's `out.print` and `out.render` write to stderr, as [Stdout belongs to the result](../../../../../docs/core/results.md#stdout-belongs-to-the-result) states.
- Under `rows<Row>()`, pass any iterable or async iterable. A row view writes each row as it arrives; a whole view, `json()` included, waits for the whole sequence.
- Write through `out`, never through `console.log` or `process.stdout`, and never call `process.exit()`. Under `invoke` and an MCP tool call the run's streams are capture sinks, so a direct write to the process misses the capture, and in the MCP server it corrupts the protocol stream.
- State the row type on a pack view factory that you hoist out of the `views` record, `table<Row>({ … })`, or its columns go unchecked.

## Fail by throwing a failure class

An action that returns has succeeded and exits 0, whatever it wrote: `out.error` reports and does not fail. To fail, throw. Core reads the exit code from the thrown failure's class, so never set `process.exitCode`.

Choose the base by who must act:

- **`FatalError`**: the application could not do what was asked. It exits 1 unless the subclass declares another code, and its default text is the message alone. `out.fatal(message)` throws a plain one.
- **A `UsageError` subclass**: the invocation is wrong in a way no validator could see. It exits 2, and core opens each line with the application name.
- **A validator**: a rule over one input's value belongs in `validate`, not in the action. Returned issues report as an `InputError`, exit 2, before the action runs, beside every other problem, under [Issues and validator failures](../../../../../docs/core/validation.md#issues-and-validator-failures). An action throws `InputError` itself only for a rule over a whole list of values, and builds the failure for an omitted input with `missingInputError`, under [Interaction](../../../../../docs/core/interaction.md).

Declare one class for each failure a reader must tell apart:

- `static override readonly code` is the [failure code](../../../../../docs/core/failures.md#failure-codes) a machine reader branches on. It is kebab-case; a code outside the grammar throws a `DeclarationError` when the class is constructed. The failure form, `invoke`'s outcome, a failure encoder, and an MCP tool error all carry it.
- `static override readonly exitCode` is its [declared exit code](../../../../../docs/core/failures.md#declared-exit-codes), from 1 through 125. Use the `EX_*` constants core exports. Annotate the field as `FailureExitCode` (or `code` as `string`) when a subclass of your class declares another value.
- Facts a view or a script reads are `readonly` fields on the instance, not text to parse.
- List the classes each Command can raise in the `failures` of its `manifestCommand` value, under [Manifest failures](../../../../../docs/plugins/manifest.md#manifest-failures), so an agent reads what each code means before it runs the Command.

A `FatalError`'s message is marked text that core does not escape. Escape each raw value you interpolate with `style.escape`, which `@loomcli/core` exports, or override the `FatalError` view to escape the whole message, as [Failure views](../../../../../docs/core/failure-views.md#failure-views) shows. Do one, not both, because text escaped twice no longer displays as written.

```ts
import { Application, Command, EX_DATAERR, FatalError, translate } from "@loomcli/core";
import { format } from "@loomcli/plugins/format";
import { table } from "@loomcli/plugins/table";

interface Entry {
  key: string;
  kind: string;
}

export class InvalidJsonError extends FatalError {
  static override readonly code = "invalid-json";
  static override readonly exitCode = EX_DATAERR;

  constructor(options?: ErrorOptions) {
    super(
      "The document is not valid JSON. Correct its syntax, or supply another document.",
      options,
    );
    this.name = "InvalidJsonError";
  }
}

export const keys = new Command("keys", {
  description: "List the top-level keys of a JSON document.",
})
  .argument("document", { description: "The JSON text to read.", required: true })
  .rows<Entry>({ views: { table: table({ columns: ["key", "kind"] }) } })
  .action(async ({ args, out }) => {
    // A malformed document throws a SyntaxError here, and the translator below answers it.
    const document: unknown = JSON.parse(args.document);
    const entries: Entry[] =
      typeof document === "object" && document !== null
        ? Object.entries(document).map(([key, value]) => ({ key, kind: typeof value }))
        : [];
    await out.info("Read the document.");
    await out.results(entries);
  });

// format() adds --format json and jsonl, and writes a failed run as JSON when one is selected.
export const app = new Application("doc", {
  plugins: [format()],
  translators: [translate(SyntaxError, (error) => new InvalidJsonError({ cause: error }))],
}).command(keys);
```

## Translate a foreign throw, and let a defect stay a defect

A [translator](../../../../../docs/core/failures.md#translators) turns an error a library or the platform throws into one of your failure classes, so no action repeats the catch. Register it under the Application's `translators`; a plugin that wraps a client ships its own.

- The translator receives the instance typed from its key class and returns a failure, or `undefined` to pass the throw on. Pass `{ cause: error }` to keep the original; core never sets `cause` for you.
- Node's system errors are all `Error` instances told apart by `code`, so key the translation on `Error` and check `error.code` inside.
- The Application's list is consulted before every plugin's, and at each one the whole prototype chain is walked before the next, so your translation keyed on `Error` answers before a plugin's keyed on `SyntaxError`.
- A translator sees the error alone. When the sentence must name something only the call site knows, such as which of several files failed, catch at the call site and throw your class there.
- A throw from an action, a middleware, an input source, a row source, or a write the action awaits reaches the translators. A failure class, a cancellation, and a throw from one of Loom's contracts, such as a validator or a translator, never do.

Every throw no translator answers is a [defect](../../../../../docs/glossary.md#failures): an `InternalError` that exits 1. A development build, such as a source run or a run on a default `mockProcess()`, shows the author its Developer Diagnostic. A distributed build shows the operator `<application>: Something went wrong.` with no reason, under [Development builds](../../../../../docs/core/release-facts.md#development-builds). Do not wrap every throw in a `FatalError` that quotes `error.message`: the defect then reads as something the operator can fix, prints the engine's text, and loses its diagnostic. Translate only what the operator can act on.

The same holds for the rest of your code. A validator that throws, instead of returning issues, is a `DeclarationError`. A view, a translator, or a hook that throws is a defect. When your code catches a failure and goes on, the outcome is what your code produces, under [The ordinary failure path](../../../../../docs/core/failures.md#the-ordinary-failure-path), except that a failed destination write still fails the run.

## Restyle a failure with a failure view

`override(FailureClass, view)` under the Application's `views` replaces how a class renders, typed from its instances. The [failure views](../../../../../docs/core/failure-views.md#failure-views) page states the resolution; these are the points an author gets wrong:

- An override for a base class covers every subclass at once, and the Application's overrides win over every plugin's, so `override(UsageError, …)` restyles every exit-2 failure.
- The view owns its trailing newline, and it prints `context.hints` itself. An override that ignores them drops the lines plugins add, such as a pointer to `--help`.
- Read `context.invokedBy` before pointing at a command line: under `invoke` and an MCP tool call there is none.
- A view cannot change the exit code, which is a fact of the class.
- A defect never reaches an override in a development build. In a distributed build, `override(InternalError, …)` replaces the generic message.
- Under `run()`, when the selected view declares a media type that a [failure encoder](../../../../../docs/core/failure-views.md#failure-encoders) answers, such as the formatter's `application/json`, the encoder writes the failure form on stderr and no view renders. A script that asked for `--format json` reads JSON on failure too.

## Write the message in the failure voice

Every operator message says what went wrong and what to do instead. [Failure message voice](../../../../../docs/core/failures.md#failure-message-voice) states the rules Loom's own messages follow; Loom cannot check yours, so apply them yourself:

- Name the specific thing in the first part, such as the path, the file, or the key, and give an action or the accepted form in the second: `Path not found: "user.nme". Run jsonkit keys to list the keys at the root.`
- Repeat an input's value only when you know it is not a secret, and escape what you repeat.
- Quote no text you did not write, such as a cause's message, an engine reason, or a stack. It can leak a path or a value, it changes between runtimes, and it gives the operator no step to take.
- Give a defect no operator message of your own. The operator cannot fix it, so let core report it.
