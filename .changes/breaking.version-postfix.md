- Add `postfix` to the version plugin's settings, so `version({ postfix: '(Report schema v1)' })` prints `app v1.2.0 (Report schema v1)`: the standard line, one space, and the postfix, dim and escaped. A postfix that is not one line of prose throws `@loomcli/plugins/version/postfix` from `version()`. See [Version](docs/core.md#version).
- Change the data `versionLine` renders from the `CommandGraph` to `VersionLine`, `{ graph, postfix }`, so an override reads the postfix beside the graph. `VersionSettings` and `VersionLine` are exported.
- Add `isProseLine` to `@loomcli/core`, the one-line rule every core fact string follows, so a plugin judges a setting printed inside one line against core's rule. See [Plugin settings](docs/core.md#plugin-settings).

### Migration

**Affected surface.** Applications that override `versionLine` from `@loomcli/plugins/version/views`.

**Why.** The version line now carries the postfix the application gave `version()`, so its view receives the graph and the postfix together, as the help page receives the graph, the routed Command, and the variant.

**Before and after.**

Before:

```ts
override(versionLine, {
  render: (graph, context) => `${graph.name} ${graph.version}\n`,
});
```

After:

```ts
override(versionLine, {
  render: ({ graph }, context) => `${graph.name} ${graph.version}\n`,
});
```

An override that calls the default passes the data through unchanged, so only the parameter's name reads differently:

```ts
override(versionLine, {
  render: (line, context) => `build\n${versionLine.render(line, context)}`,
});
```

**Steps.**

1. Find each `override(versionLine, ...)` in the application.
2. Read the graph from the data's `graph` field, and the postfix from its `postfix` field when the override prints it.

**Validation.** Run the application's type check, which rejects a replacement that still reads the graph as its data, and run `<app> --version` to confirm the line.
