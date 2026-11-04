- Add `editor`, a question that waits for Enter, opens the operator's editor, named by `VISUAL`, `EDITOR`, or `vi`, on a private temporary file that holds the prefill, and answers the text the file holds when the editor exits. It links a string option or a string argument that takes one value, prefills, skips, and validates as `text` does, takes an `extension` for the file, and fails with `EditorError` when the editor cannot start, exits with a code other than 0, or the question cannot write the editor's file.
- Add `out.lendTerminal(work)` to `@loomcli/core`, which holds every live region still while `work` runs a child program that draws on the terminal, and draws them again below whatever the child wrote once it settles.
- Add the `editor` member, `EditorFrame`, to `questionFrame`'s data, and to `answeredLine`'s data the `kind` `'editor'` and an optional `lines`.

### Migration

**Affected surface.** A view override of `questionFrame` from `@loomcli/prompts/views` that switches on its data's `kind`.

**Why.** An editor question draws through `questionFrame` with a frame of its own, `{ kind: 'editor', message, issue, editing }`, so the data's union gains a variant.

**Before and after.**

Before, in a `questionFrame` override with an exhaustive check:

```ts
switch (data.kind) {
  case 'text':
  case 'secret':
  case 'confirm':
    return drawTyped(data);
  case 'select':
  case 'multiselect':
    return drawList(data);
  default:
    return assertNever(data);
}
```

After:

```ts
switch (data.kind) {
  case 'text':
  case 'secret':
  case 'confirm':
    return drawTyped(data);
  case 'select':
  case 'multiselect':
    return drawList(data);
  case 'editor': {
    const hint = data.editing ? 'Waiting for your editor to close the file…' : 'Press Enter to open your editor';
    const line = `? ${data.message} › ${hint}`;
    return data.issue === undefined ? line : `${line}\n  ✘ ${data.issue}`;
  }
  default:
    return assertNever(data);
}
```

**Steps.**

1. In a `questionFrame` override, handle the `'editor'` kind: draw its `message`, its `issue` when it has one, and a hint that reads `editing`, which is `true` while the editor is open.
2. Where an override falls through to a default case for a kind it does not know, check that the default draws a frame an editor question can show.

**Validation.** Run `tsc --noEmit` to type-check every override with an exhaustive check. Run the application's test command, such as `vitest run` or `bun test`, with a test that draws the overridden `questionFrame` through `viewContext` with an `EditorFrame` and asserts the text it draws.
