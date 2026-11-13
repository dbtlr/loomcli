- Add an optional view to each semantic method, so a message keeps its level and takes another look: `out.info(text, view)` writes where `info` writes and hides under `-q` as `info` does, and the view replaces the lane view for that call, glyph and gutter included. Any view over a string works, bare, declared, or from the pack, and `out.debug(text, lanes.warn)` draws a warning's look at `-v`. The `out` an `onEnvironment` hook receives takes the same view on `warn`. See [Output](docs/core/output.md#a-messages-own-view).
- Change how a semantic method ends a message: it appends a line break only when the text its view drew does not already end with one, so every message ends with exactly one. A pack view such as `box({ title })` passed to a message writes no blank line after it, and a message that ends with a line break no longer prints a blank line after it, through the default lanes or an override.
- Add `step()` at `@loomcli/plugins/step`, a view over a string that marks a stage of the work with a `primary` pointer and the text in bold, wrapped under its gutter on a terminal. Write it at a level, as in `out.info('Building 3 packages', step())`. A note is a box with a title at a level, `out.info(text, box({ title: 'Next steps' }))`. See [Pack views](docs/plugins/pack-views.md#step).

### Migration

**Affected surface.** Calls to `out.print`, `out.info`, `out.success`, `out.warn`, `out.error`, `out.debug`, and `out.trace` whose message ends with a line break, and lane overrides under `views` whose text ends with one. A message that ends with no line break, which is how a message is usually written, writes the same bytes as before.

**Why.** A semantic method now ends every message with exactly one line break, whichever view drew it, so a pack view that owns its last line break can draw a message without a blank line after it. One rule covers the lane views and a passed view alike.

**Before and after.**

Before, `out.print('done\n')` wrote `done`, a line break, and an empty line:

```ts
await out.print(summary); // summary ends with '\n'; stdout held a blank line after it
```

After, it writes `done` and one line break. To keep the blank line, end the message with two:

```ts
await out.print(`${summary}\n`); // summary ends with '\n'; the blank line stays
```

**Steps.**

1. Search the application for semantic calls whose message can end with a line break, such as a printed file or a template literal that ends with a new line, and for lane overrides whose text ends with one.
2. Where the blank line after such a message is wanted, add one more `\n` to the message or to the override's text.
3. Where the blank line was unwanted and trimmed away, remove the trim if you like: the message now ends with one line break either way.

**Validation.** Run the application's output tests, and compare its stdout and stderr for the affected commands against the bytes they wrote before the upgrade.
