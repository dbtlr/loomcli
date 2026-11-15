- Change `@loomcli/plugins/format` to declare a hidden `--format` on every group, the root of a group application included. A group's own option named `format`, or one with the short spelling `format({ short })` gives, now collides with it under the hook-collision rule, and every run of the application fails with exit 1. See [Formatter](docs/plugins/format.md).

### Migration

**Affected surface.** No compile error: every run of the application exits 1, `--help` and `--version` included, with the build diagnostic. A development build, and a test on `mockProcess`, prints it. For an option named `format`, the rule is `@loomcli/core/option-declared-twice` and the sentence `Plugin "@loomcli/plugins/format" declares option "format" on Command "cache", which is already declared as a local option.` For a short spelling, the rule is `@loomcli/core/spelling-taken` and the sentence `Plugin "@loomcli/plugins/format" declares option "format" with spelling "-f" on Command "cache", which "--force" already uses.` A distributed build prints `<app>: Something went wrong.` in its place. The surface is an application with `format()` installed whose group, a Command with children and no action, the root included, declares its own option named `format`, or, under `format({ short })`, an option with that short spelling. A Command with an action is unaffected.

**Why.** The formatter states at a group the media type the operator asked for, so `tool --version --format json` prints the extended version as one JSON object at the root of a group application, and `tool --format json` writes a group's missing subcommand as the formatter's JSON line. Routing reads the option as the group's own, and two options with one name or one spelling on one Command leave one of them unreadable.

**Before and after.**

Before, a `cache` group declared its own `format` option, and an application that gives the formatter `-f` declared `-f` on a group:

```ts
new Application('notes', { plugins: [format()] }).command(
  new Command('cache').option('format', { type: 'string' }).command(clear),
);

new Application('store', { plugins: [format({ short: 'f' })] }).command(
  new Command('cache').option('force', { short: 'f', type: 'boolean' }).command(clear),
);
```

After, the group's option takes another name, and the other option another short spelling:

```ts
new Application('notes', { plugins: [format()] }).command(
  new Command('cache').option('layout', { type: 'string' }).command(clear),
);

new Application('store', { plugins: [format({ short: 'f' })] }).command(
  new Command('cache').option('force', { short: 'F', type: 'boolean' }).command(clear),
);
```

**Steps.**

1. Run the application once in development, or its tests, under the new release. An affected application exits 1 with one of the two diagnostics, which names the group.
2. For `@loomcli/core/option-declared-twice`, rename the group's option named `format`, and every place that reads it.
3. For `@loomcli/core/spelling-taken`, change the short spelling of the group's option that the sentence names.

**Validation.** Run the application again, such as with `--help` when help is installed. It no longer exits 1 with the diagnostic, and `--help` prints the page and exits 0. Then run the application's test command, such as `vitest run` or `bun test`.
