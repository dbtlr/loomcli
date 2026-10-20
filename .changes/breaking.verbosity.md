- Add `out.debug(message)` and `out.trace(message)`, two semantic methods beside `info`, `warn`, and `error` that write a debug line and a trace line to stderr, a Command that declares a result included. They render through the new lane views `lanes.debug` (`@loomcli/core/lanes/debug`), a dim `›` gutter and a dim message, and `lanes.trace` (`@loomcli/core/lanes/trace`), nested two spaces deeper behind a `┆` gutter and fainter, and both wrap at the columns right of their gutter. A call creates no log event. See [Verbosity](docs/core.md#verbosity).
- Add the run's verbosity, which core settles right after graph build from argv, read against the built graph with the parser's own word reader, so `-vv`, `-vq`, a short group that holds a Command's own letters, aliases, and occurrences on both sides of the Command name read as the ordinary parse reads them. The verbosity is the verbose-marked option's count, read as 2 above 2, less the quiet-marked option's count, read as 1 above 1. Verbosity 1 writes `debug`, 2 writes `trace` too, and -1 hides `info` and `success`, while `print`, `render`, `draw`, results, `warn`, `error`, the failure report, and the incomplete-result line write at every verbosity. A hidden call still rejects a message that is not a string, and calls no lane view. A middleware's and a configuration source's `out` follow the verbosity, and `app.invoke` and an action's `invoke` settle their own from the values they lower, so `options: { verbose: 2 }` reads as `-vv` does. An Application with neither mark runs at verbosity 0, so `debug` and `trace` write nothing and every other byte is unchanged.
- Add the verbose mark and the quiet mark, `verbose: true` and `quiet: true` on one counted global option each, an application's or a plugin's. Reject a misplaced mark under `@loomcli/core/verbose-mark` and `@loomcli/core/quiet-mark`: a mark on a local option or on a string, content, or Boolean option, a value other than `true`, both marks on one option, a second option with one mark in an Application, and an `env` or configuration binding on a marked option. The types reject each rule except the configuration binding and a second marked option, which depend on what joins the Application. Help and man pages print a quiet-marked option with no `...` after its spellings, as `-q, --quiet`, because a further occurrence adds nothing. Shell completion reads the same rule: it no longer offers the quiet-marked option once given, or the verbose-marked option once given twice, while every other counted option is still offered again.
- Add `counts` to the `option` position `locate` returns, a `ReadonlyMap` from each counted option the earlier words gave to how many times they gave it, so `locate(graph, ['-v', '-vv', '--'])` holds `verbose` at 3.
- Publish `verbose` and `quiet` on each counted `OptionNode` from `inspect()`, `true` on the marked option, and copy both into each counted option entry of the `@loomcli/plugins/manifest` document.
- Add `@loomcli/plugins/verbose`. `verbose()` takes no settings and declares the counted global options `-v, --verbose`, described as `Show more detail. Repeat it for more.`, with the verbose mark, and `-q, --quiet`, described as `Hide info and success messages.`, with the quiet mark, both marked `control`, so MCP tool schemas leave them out. See [Verbose plugin](docs/core.md#verbose-plugin).

### Migration

**Affected surface.** An option declaration that carries a `verbose` or `quiet` key, which earlier releases ignored. Such a key on a local option, on a string, content, or Boolean option, with a value other than `true`, both keys on one option, either key beside `env` or a configuration binding, or a second option of one Application with the same key now throws a `DeclarationError` under `@loomcli/core/verbose-mark` or `@loomcli/core/quiet-mark`. An application that declares neither key needs no change.

**Why.** `verbose: true` and `quiet: true` now mark the counted global options whose occurrences set the run's verbosity, so core reads both keys and rejects a declaration that cannot carry them.

**Before and after.**

Before, a key core ignored, and a count the action checked by hand:

```ts
new Application('app')
  .globalOption('level', { type: 'count', short: 'v' })
  .option('loud', { type: 'boolean', verbose: true })
  .action(async ({ options, out }) => {
    if (options.level > 0) {
      await out.info('Reading doc.json.');
    }
  });
```

After, the key removed, the hand-counted option dropped, and the debug line written through `out.debug` under the verbose plugin's `-v`:

```ts
import { verbose } from '@loomcli/plugins/verbose';

new Application('app', { plugins: [verbose()] })
  .option('loud', { type: 'boolean' })
  .action(async ({ out }) => {
    await out.debug('Reading doc.json.');
  });
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Search the application's option declarations for a `verbose` or `quiet` key. Remove each one, or keep it on one counted global option with no `env` or configuration binding, or install `verbose()` from `@loomcli/plugins/verbose` in place of the application's own options. `verbose()` declares the global options `verbose`, spelled `-v`, and `quiet`, spelled `-q`, so an application that installs it renames or removes its own option with either key or either spelling.
3. Move a message that only an operator's `-v` should reveal from a hand-written count check to `out.debug` or `out.trace`.

**Validation.** Run `pnpm exec tsc --noEmit`, which reports a misplaced `verbose` or `quiet` key, and run the application once with `--help`, which throws any declaration fault the types cannot see. Run it with `-v` and check that its debug lines reach stderr.
