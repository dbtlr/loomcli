- Change the `out` lanes, `out.fatal`, `MessageArguments`, and the `log` levels to take `string | Phrase` where they took `string`, so Loom's own code can hand core a sentence it renders in the operator's language. A test double an author states for one of these members, through `@loomcli/testing`'s builders, now receives a parameter that may be a `Phrase`.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is a test that states an `out` lane, `out.fatal`, or a `log` level whose parameter is typed from the context and used as a string, such as `log: { info: (message) => { lines.push(message); } }`, and a stated lane written `(...call: MessageArguments)` that narrows a streamed message with `typeof message === 'string'` and then iterates it.

**Why.** Core renders a phrase in the run's language where it writes text for a person, and the failure form and the log record keep its English text, so the members that carry Loom's text to core take a phrase as well as a string.

**Before and after.**

Before, a stated `log` level typed from the context:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  log: { info: (message) => { lines.push(message); } },
  options: {},
  provided: {},
});
```

After, the parameter is annotated, because the action under test passes strings:

```ts
const lines: string[] = [];
const context = actionContext(handler, {
  args: {},
  log: { info: (message: string) => { lines.push(message); } },
  options: {},
  provided: {},
});
```

A stated lane that takes `(...call: MessageArguments)` reads a phrase's English text before it narrows a stream:

```ts
import { Phrase, type MessageArguments } from '@loomcli/core';

const print = async (...[message]: MessageArguments) => {
  if (message instanceof Phrase) lines.push(message.text);
  else if (typeof message === 'string') lines.push(message);
  else for await (const part of message) lines.push(part);
};
```

**Steps.**

1. Run the project's type check, such as `tsc --noEmit`, and note each stated lane or level it reports.
2. Annotate the parameter `(message: string)` where the code under test passes only strings. Where it may pass a phrase, type the parameter `string | Phrase` and narrow with `message instanceof Phrase` to read `message.text`: a double annotated `(message: string)` still compiles there, because the builder hands the argument through unchanged, and fails only when it runs.

**Validation.** Run the type check again and confirm it reports no stated lane or level, then run the tests that state them.
