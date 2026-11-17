- Add `task(settings)` to the progress line of `@loomcli/prompts`, so one line groups the steps of a piece of work under it as a task group, to any depth. A task is a full progress line with the same handle, and the action decides what runs when. At a terminal that redraws, the tree draws as one frame, each task indented two columns for each level, in the order the tasks opened, also when another line opened between them, and a finished task shows its end line until its parent ends. A task still open when its parent ends takes the parent's end. A group that ends as a success or a skip leaves its own end line alone and no blank row, and one that fails, warns, or is cancelled keeps its tasks under it in scrollback, each failed task's kept log lines directly above its end line. A tree's rows share the terminal's height, and a finished task's row gives way first. Where the line prints plain lines, each task prints its start and end lines indented under its parent's, and under an invocation by name the same lines land in `messages`. Each task reports its own progress events under its own label. See [Task groups](docs/libs/prompts.md#task-groups).
- Add `keepTasks` to a progress line's settings, which keeps a group's tasks when it succeeds too, and optional `depth` and `tasks` to `ProgressLine`, the progress view's data, so a view override draws the tree, while data you build by hand for `out.draw` draws without them.
- Change `ProgressContext` so its `out` also carries `draw`.
- Change every running progress line of `@loomcli/prompts`, in a task group or not, to keep to one row at a terminal that redraws. A label too wide for the row was wrapped by the terminal, which could leave copies of the frame's rows in scrollback; now, once the rate and the time left have given way, the label is cut and ends with `…`, and on a narrower row the bar, the elapsed time, and the counts drop in turn. A finished task's end line inside a running tree is cut the same way, while a line's end line left in scrollback keeps its whole text. See [Progress view](docs/libs/prompts.md#progress-view).

### Migration

**Affected surface.** The type checker reports every affected site. The surface is a context built by hand, such as a test's object literal, that omits `out.draw` and is passed to `progress()` from `@loomcli/prompts`. A context core hands an action, a middleware, or a configuration source, and one `@loomcli/testing` builds, already carries `draw`.

**Why.** A task group whose tasks stay writes each of its end lines through `out.draw` and the progress view, so an application's override of the view draws them and each failed task's kept log lines stand directly above its own end line.

**Before and after.**

Before:

```ts
const line = progress({ graph, out: { error, info, region, success, warn } }, { label: 'Deploying' });
```

After:

```ts
const line = progress({ graph, out: { draw, error, info, region, success, warn } }, { label: 'Deploying' });
```

**Steps.**

1. Add a `draw` method to each hand-built context passed to `progress()`, with the signature `Out['draw']` gives it, or build the context with `actionContext` from `@loomcli/testing`.

Note, not a break: an override of the `@loomcli/prompts/progress` view written before `depth` and `tasks` draws a tree's root alone while the tree runs, and when a tree's tasks stay at its end, it draws every line of the written tree, flat, with the library's indented kept log lines between them, because the tree is written one line at a time. Draw `depth` and the entries of `tasks` to show a tree's tasks.

Note, not a break: a test that reads a running progress line's long label from stderr now reads it cut with `…` at the terminal's width, and the end line still whole.

**Validation.** Run the application's type check, such as `pnpm exec tsc --noEmit`, and its tests.
