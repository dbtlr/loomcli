- Fix the `FatalError` view that [Failure views](../docs/core/failure-views.md#failure-views) recommended, which escaped the whole message with `style.escape(failure.message)`. A first-party plugin's message wraps a path in a `nowrap` frame, so through that view a failure such as a completion install that cannot reach its folder printed `Cannot reach ["nowrap"]/…` with the frame's delimiters as text, and, under a phrasebook, printed in English. A `FatalError`'s message is marked text its author wrote, so the documented view now prints the context's `message` as it is, and code that puts an operator's value into the message escapes that value where it raises the failure. The jsonkit and textstat examples and the `results-and-failures` reference of the authoring skill that `loom init` installs follow the new pattern. An application that copied the old view makes its view print `message`, and escapes each operator value at the site that raises the failure, wrapping in `style.escape` each value it already passes through `escapeControlCharacters`:

  ```ts
  override(FatalError, { render: (_failure, { message }) => `${message}\n` });
  new FatalError(
    `Path not found: "${style.escape(escapeControlCharacters(path))}". Run reader keys to list the keys at the root.`,
  );
  ```
