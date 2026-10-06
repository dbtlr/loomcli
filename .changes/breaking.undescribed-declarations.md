- Change a development build to fail every `run()` and every `app.invoke()` whose graph holds a Command, the root included, a global or local option, or an argument without a description. The run exits 1 with one Developer Diagnostic under `@loomcli/core/undescribed`, which lists each gap with the call that declared it, hidden and deprecated members and what a plugin or its `onCommandAttach` hook declares included. The check runs before routing, so `--help` and a completion request fail too. `inspect()`, an action's `invoke`, and a distributed build run no such check. See [Undescribed declarations](docs/core.md#undescribed-declarations).

### Migration

**Affected surface.** Applications whose `loom.packet.json` reads `development`, run from source or from a bundle built without `packet()`, that leave out `description` on the Application, on a `Command`, on a `globalOption()`, `option()`, or `argument()` call, or on a plugin's `options` entry. A distributed build is unaffected.

**Why.** Agents, MCP tools, help, and the manifest describe a Command and its inputs by their descriptions, so the author meets a gap in development before an operator or an agent meets it in a shipped application.

**Before and after.**

Before, a development run of `store get name` printed the value:

```ts
export const store = new Application('store', { packet })
  .globalOption('verbose', { type: 'boolean' })
  .command(
    new Command('get')
      .argument('path', { required: true })
      .action(({ args, out }) => out.print(args.path)),
  );
```

After, the same run exits 1 with `4 declarations have no description.` and a finding for each gap. Describe each member:

```ts
export const store = new Application('store', { description: 'Read stored values.', packet })
  .globalOption('verbose', { description: 'Print more detail.', type: 'boolean' })
  .command(
    new Command('get', { description: 'Read one value at a path.' })
      .argument('path', { description: 'The path to read.', required: true })
      .action(({ args, out }) => out.print(args.path)),
  );
```

**Steps.**

1. Run the application from source in a development build, such as `bun src/main.ts --help`.
2. For each finding the diagnostic lists, add a one-line `description` to the call it marks: the Application's options for the root, the `Command` constructor's options for a Command, and the config of each option and argument.
3. For a finding noted `declared by plugin "<identity>"`, or one that marks a plugin's `options` entry or `commands` entry, describe the member in the plugin, or report the gap to the plugin's author.

**Validation.** Run the application from source with no arguments and with `--help`, and confirm that neither prints a diagnostic under `@loomcli/core/undescribed`. Run the application's own tests in a development build.
