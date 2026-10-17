- Remove `columns` from the select `questionFrame` data, which keeps `rows`. The default select view clips at the view context's `columns`: stderr's width narrowed by a valid `COLUMNS`, or 80 columns when `columns` is `undefined`. The select window's visible count and `rows` are read when each frame draws, so a resize reaches the next frame.

### Migration

**Affected surface.** An override of `questionFrame` from `@loomcli/prompts/views` that reads `data.columns` for a select frame, and code that builds select frame data by hand with a `columns` member.

**Why.** A view now reads the width of its destination from `context.columns`, so the frame data no longer carries a second, stale copy of it.

**Before and after.**

Before:

```ts
override(questionFrame, {
  render: (data, context) =>
    data.kind === 'select' ? clip(data.message, data.columns ?? 80) : questionFrame.render(data, context),
});
```

After:

```ts
override(questionFrame, {
  render: (data, context) =>
    data.kind === 'select' ? clip(data.message, context.columns ?? 80) : questionFrame.render(data, context),
});
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Replace `data.columns` with `context.columns` in every `questionFrame` override, keeping any fallback width you want for `undefined`.
3. Remove the `columns` member from select frame data your code builds by hand.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's test command. Ask a select question on a terminal narrower than its message, with and without `COLUMNS` set, and check that the frame fits the width.
