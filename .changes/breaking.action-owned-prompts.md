- Add `@loomcli/prompts`, an optional library for action-owned text, secret, confirm, and select questions. Questions render on stderr, can link local options, and return validated supplied values silently when skipped.
- Add one run-wide interaction decision, the `@loomcli/plugins/interaction` plugin's `--no-input` switch, and `required: 'non-interactive'` for single-value local string options. Help, the manifest, and MCP schemas expose conditional requiredness.
- Pass the captured run context to question validators, including the working directory and time zone used by `path()` and `dateTime()`.
- Add `ViewContext.plain(text)` to resolve marked text without styles or controls while preserving destination glyph forms. Select frames use it to fit short or narrow terminals while preserving complete returned choice values.
- Add `supplied`, `interactive`, and `cancel()` to action contexts, `missingInputError()` for action-owned missing inputs, and `out.draw(data, view)` for ordered terminal drawing on stderr with resolved row counts.

### Migration

**Affected surface.** Applications that construct `Out`, `ViewContext`, or `ActionContext` objects, including wrappers and test harnesses. Applications that only consume the context core produces need no code change.

**Why.** `Out` now requires `draw`, `ViewContext` requires the destination-aware `plain` helper, and `ActionContext` carries the run's `supplied`, `interactive`, and `cancel` members. Questions need core's ordered output and shared interaction and cancellation decisions.

**Before and after.** A wrapper that copies each output method must preserve `draw` too. Copying the runtime channel preserves its full contract:

Before:

```ts
function copyOutput(out: Out): Out {
  return {
    error: out.error,
    fatal: out.fatal,
    info: out.info,
    print: out.print,
    render: out.render,
    results: out.results,
    success: out.success,
    warn: out.warn,
  };
}
```

After:

```ts
function copyOutput(out: Out): Out {
  return { ...out };
}
```

**Steps.**

1. Update the first-party packages together to the same version.
2. Preserve the runtime channel's `draw` in output wrappers and the runtime view context's `plain` in view-context wrappers. A custom channel implements the [drawing contract](docs/core.md#output-and-failures), including stderr ordering and row measurement.
3. Run test actions through `Application.run()` with host overrides or `Application.invoke()` to obtain a complete action context. Hand-built contexts must provide `supplied`, `interactive`, and `cancel` with the same run semantics.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's test command. Verify that supplied linked answers resolve without question output and that cancellation restores terminal input.
