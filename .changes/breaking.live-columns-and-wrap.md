- Add `columns` and `wrap(text, columns)` to `ViewContext`, and so to `FailureViewContext`. `columns` is the effective width of the destination the view writes to, read just before each render call: the terminal's real width, or `undefined` on a pipe, a redirect, an invocation by name, and an MCP tool call. `wrap` breaks marked text at spaces so each line fits, measured as `width` measures, keeps a word wider than the width whole on its own line, and returns the text unchanged when `columns` is `undefined`. The idiom is `context.wrap(text, context.columns)`. See [width, padding, and multiline lanes](docs/core.md#width-padding-and-multiline-lanes).
- Add `expandTabs(text)` to `ViewContext`, and so to `FailureViewContext`. It replaces each tab in marked text with the spaces that reach the next multiple of eight, counted from the start of its input line as `width` counts, so text a view places after a gutter, a label, or another column shows as it measured. Frames, escapes, and ANSI commands keep their bytes, and a tab inside `pad` is left to the frame.
- Read `host.terminal.stdout` and `host.terminal.stderr` `columns` and `rows` live, so a window resized during a run reaches the next render. A host override's plain numbers stay fixed, and a getter it supplies is read each time. `isTTY` is still read once.
- Narrow `columns` on a terminal by a valid POSIX `COLUMNS` variable, a positive integer, which never widens it past the terminal's real width. A terminal that reports no width takes `COLUMNS` alone, and a destination that is not a terminal ignores it. `host.terminal` keeps the real reading.
- Wrap the `info`, `success`, `warn`, and `error` lanes at the columns right of their glyph gutter, with the gutter on every continuation line. On a terminal they expand the message's tabs to spaces first, so a tab after the gutter no longer pushes a line past the width. Off a terminal their output is unchanged, tabs included, and `print` never wraps. A long self-update notice now wraps on an 80-column terminal.
- Add `nowrap(text)`, which keeps text such as a path that holds spaces whole when a line wraps. It adds no bytes to the printed text: ``out.info(`Wrote ${nowrap(path)}`)``.
- Add `splitLines(text)`, which splits marked text at its line breaks into lines that each stand alone. A style, a `pad` or `nowrap` frame, an embedded SGR color, or an OSC 8 hyperlink that spans a break closes at the line's end and opens again on the next, so a view can place wrapped lines side by side: `splitLines(context.wrap(text, width))`.
- Fill the Developer Diagnostic's banner and wrap its explanation at stderr's effective width, narrowed by `COLUMNS`, measured in terminal display columns. It keeps 80 columns off a terminal and in a thrown error's message.

### Migration

**Affected surface.** Code that builds a `ViewContext` or `FailureViewContext` object itself, such as a test harness that calls a view function directly, and wrappers that rebuild the context core passes. A view function that only reads the context core passes needs no change.

**Why.** Views now read the destination's width and break lines through the context, so `ViewContext` requires the `columns`, `wrap`, and `expandTabs` members.

**Before and after.** A hand-built context in a test must supply all three members.

Before:

```ts
const context: ViewContext = { plain: (text) => text, style, width: () => 0 };
```

After:

```ts
const context: ViewContext = {
  columns: undefined,
  expandTabs: (text) => text,
  plain: (text) => text,
  style,
  width: () => 0,
  wrap: (text) => text,
};
```

A wrapper that rebuilds the context keeps the runtime context's members, for example with `{ ...context, style: myStyle }`.

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Add `columns`, `wrap`, and `expandTabs` to every `ViewContext` or `FailureViewContext` your code builds. Keep the runtime context's `columns`, `wrap`, and `expandTabs` in wrappers, or spread the runtime context.
3. Review any test that runs on a terminal host override with output wider than its `columns`. Lane messages now wrap there and expand their tabs, and so does other output: a table shrinks its columns or prints records blocks, a records value wraps under its key, and the Developer Diagnostic fills and wraps at stderr's width. Re-pin the golden output of such tests, or supply `isTTY: false`, or a wider `columns`, where a test expects the unwrapped bytes.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's test command. Run the application on a narrow terminal and check that a long `out.warn` message wraps under its glyph, and pipe it to `cat` to check that the message stays on one line.
