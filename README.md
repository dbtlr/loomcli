---
description: Build and run the textstat and jsonkit examples with typed schema validation and named commands, then verify the public Loom CLI package.
---

# Loom CLI

Loom CLI is a TypeScript framework for command applications. The current increment runs named Commands under application-global options, with required scalar and variadic arguments, local options, Standard Schema validation, and passthrough.

## Run textstat

Install dependencies and build the core package and example:

```sh
pnpm install --frozen-lockfile
pnpm build
node examples/textstat/dist/main.js README.md
```

The output is one table: a header naming the metric, then one line per source with a right-aligned count and the supplied file path. The example reads files in argument order. Bytes are the default metric.

To count words and add a combined total:

```sh
node examples/textstat/dist/main.js --metric words --total README.md docs/core.md
node examples/textstat/dist/main.js -tm words README.md docs/core.md
```

`--metric` accepts `bytes`, `words`, or `lines`. Bytes count file bytes. Words are runs of non-whitespace characters after UTF-8 decoding, using JavaScript whitespace rules. Lines count LF characters; an unterminated final line adds no LF. Empty files count as zero for every metric.

`--total` or `-t` appends a `total` row, including for one file. Unsupported metrics fail before file access. The table renders once, after every source is counted, so a read error prints no table at all.

To keep only files with at least 100 bytes:

```sh
node examples/textstat/dist/main.js --min-bytes 100 --total README.md docs/core.md
```

`--min-bytes` uses a schema to transform decimal digits into a non-negative safe integer. Its declared default is `'0'`, which becomes numeric `0`. Filtered files do not contribute to the total. Invalid inputs report all schema issues before the action reads any files.

The first bare `--` starts a separate passthrough tail. `textstat` ignores that tail; it does not treat tail tokens as file paths.

The same built application runs with Bun:

```sh
bun examples/textstat/dist/main.js README.md
```

The [example declaration](examples/textstat/src/application.ts) imports the built `@loom/core` package. It attaches Zod schemas directly through `validate`, with no Loom adapter or plugin. Its [separate action](examples/textstat/src/count-files.ts) derives argument and option types from that declaration and writes its [table](examples/textstat/src/table.ts) through one `out.render` call.

## Run jsonkit

The second example reports the shape of one JSON document:

```sh
node examples/jsonkit/dist/main.js --file package.json
```

The first line names the kind of the root value: `object with N keys`, `array with N items`, `string`, `number`, `boolean`, or `null`. One member reads as `1 key` or `1 item`. For an object, one `key<TAB>kind` line per top-level key follows in JavaScript property order, which lists integer-like keys first in ascending order and every other key in document order. The `keys` command uses the same order.

`--file` is a required global option, so it accepts a value before, between, or after the command name:

```sh
node examples/jsonkit/dist/main.js get name --file package.json
node examples/jsonkit/dist/main.js keys --file package.json
```

`get` takes one required dot-separated path. A segment of digits indexes an array; on an object every segment is a key.

```sh
node examples/jsonkit/dist/main.js --file package.json get repository.url
node examples/jsonkit/dist/main.js --file package.json get workspaces.1
```

The result prints as JSON text. Objects and arrays use two-space indentation, and scalars stay compact, so a string prints quoted. An unresolved path, an unreadable file, and invalid JSON each exit 1. `keys` prints the top-level keys of an object, one per line, and rejects a non-object root. An unknown command name exits 2 and lists the choices.

The [command modules](examples/jsonkit/src/commands) share one [globals value](examples/jsonkit/src/globals.ts), and each [action](examples/jsonkit/src/actions) derives its argument and option types from its own declaration. The application registers its own [failure renderers](examples/jsonkit/src/failures.ts) for rejected inputs and unknown commands, so those two diagnostics read `jsonkit: ...`; every other failure keeps core's text.

## Verify the package

```sh
pnpm verify
```

This command builds ESM and declarations, checks source, tests a packed declaration consumer, and runs process integration tests with Node.

To run the process cases with Bun in a POSIX shell:

```sh
LOOM_TEST_RUNTIME=bun pnpm test
```

In PowerShell, set `$env:LOOM_TEST_RUNTIME = 'bun'` before `pnpm test`.

CI tests Node 22.23.2 and Bun 1.4.0 on macOS, Linux, and Windows. These versions define the compatibility baseline for this increment. TypeScript 7.0.2 checks emitted declarations with strict NodeNext resolution. Earlier versions are unverified.

The [core reference](docs/core.md) defines invocation, output, and failure behavior.

## Contribute a change

Read the [change fragment guide](.changes/README.md) before opening a pull request. The [changelog](CHANGELOG.md) records library releases and migration instructions.

The [changelog compiler reference](docs/changelog-compiler.md) describes fragment validation, release previews, and release-file preparation.
