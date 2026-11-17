- Allow `out.print`, `info`, `success`, `warn`, `error`, `debug`, and `trace` to take an async iterable of text in place of the message, so text such as a model's answer shows as it arrives. A streamed message keeps its method's destination and verbosity, draws through the lane view, takes no view, and once its iterable ends has written what the method writes for the joined text. On a terminal each chunk shows as it arrives: a streamed `print` writes what each chunk adds at the cursor and holds every other write to the terminal until its line ends, and the other methods redraw their unfinished row above any live region, which `onLiveRegions` reports as it reports a region's frame. On a pipe, a file, or a captured run each line is written once it completes. A hidden streamed message is read to its end, one whose iterable throws keeps its text and rejects the call, and a failed action or a cancelled run ends an open one at once. The [output reference](docs/core/output.md#a-streamed-message) states the contract.
- Add the `MessageArguments` type to `@loomcli/core`, the two argument lists a semantic method takes. Each method keeps its string signature first and gains a second over `MessageArguments`, so a wrapper forwards either form whole.
- Change `@loomcli/testing`'s builders so an unstated semantic lane reads a streamed message to its end before it resolves. A stated lane whose parameter is typed from the context alone, such as `warn: async (message) => { lines.push(message); }`, no longer compiles, whether or not it uses the parameter, because the context types the parameter as either form and a lane typed that way does not fit the method's two signatures. The type checker reports every such site, and annotating the parameter, `(message: string)`, fixes it. See [Testing](docs/libs/testing.md).

### Migration

**Affected surface.** The type checker reports every affected site. The surface is a semantic lane, `print`, `info`, `success`, `warn`, `error`, `debug`, or `trace`, whose parameter has no annotation, whether or not the lane uses it, written where an `Out` method is expected: a lane a test states in the `out` of a `@loomcli/testing` builder, such as `actionContext`, or one in an `out` built by hand, such as a context passed to `progress()` from `@loomcli/prompts`. A lane whose parameter is annotated, such as `vi.fn(async (_message: string) => {})`, and a lane that declares no parameter still compile.

**Why.** Each semantic method now takes a streamed message as well as a string, so the expected type gives a lane's unannotated parameter either form, and a lane typed that way fits neither of the method's two signatures.

**Before and after.**

Before, the parameter took its type from the context:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  options: {},
  out: {
    warn: async (message) => {
      lines.push(message);
    },
  },
  provided: {},
});
```

After, the parameter is annotated:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  options: {},
  out: {
    warn: async (message: string) => {
      lines.push(message);
    },
  },
  provided: {},
});
```

**Steps.**

1. Run the project's type check, such as `tsc --noEmit`, and note each stated lane it reports.
2. Annotate that lane's parameter, `(message: string)`, for an action that passes strings, or write `(...call: MessageArguments)`, imported from `@loomcli/core`, for one that streams.

**Validation.** Run the type check again and confirm it reports no stated lane, then run the tests that state those lanes.
