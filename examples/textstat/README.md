# textstat

textstat is an example application that counts the bytes, words, or lines of files and piped text and prints one row per source, with an optional total. It shows Loom's validation, input sources, result views, and formatter on a small, familiar command.

## What it covers

The tests under [`tests/`](tests) hold what this example alone shows, such as a behavior that only assembly reveals. [`src/application.ts`](src/application.ts) is the declaration to read first.

### Arguments and content inputs

- **Native content** ([reference](../../docs/core/validation.md#content-inputs)). `files` is a required native content variadic argument with `stdin: true` ([`src/application.ts`](src/application.ts)). Core checks source presence before middleware and gives the action an ordered array of handles. Available nonterminal stdin follows supplied files unless an explicit `-` places it. With no source, the run fails with a missing-input problem and exit 2 before the action: at a terminal, `textstat: Argument "files": Expected at least 1 readable source.` The action counts each handle incrementally through its stream ([`src/count-source.ts`](src/count-source.ts)) and names a stdin row `stdin`. A word or multibyte character split across chunks is counted once.

### Options, validators, and input sources

- **Validators** ([reference](../../docs/libs/validators.md#catalog)). `--metric` is declared with the catalog's `oneOf(['bytes', 'words', 'lines'])` and the default `'bytes'`. `--min-bytes` and `--minimum` are declared with `integer({ min: 0 })` and the default `'0'`, so the rejected-value message reads `Option "--min-bytes" (from TEXTSTAT_MIN_BYTES): Expected a whole number of at least 0.` The action uses the inferred values directly.
- **Option aliases** ([reference](../../docs/core/options.md#option-aliases)). `--minimum` is an alias of `--min-bytes`, the name the threshold had before, so it binds the same option and appears in no listing.
- **Hidden options** ([reference](../../docs/core/commands.md#hidden-and-deprecated-members)). `--timing` is a hidden Boolean. When set, the action writes one `ℹ elapsed: <n>ms` info line to stderr after the rows.
- **Input schema** ([reference](../../docs/core/validation.md#input-schema)). `inspect()` reports `metric` with `{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', enum: ['bytes', 'words', 'lines'] }` beside its default, `min-bytes` with `{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'integer', minimum: 0 }`, `--timing` with `null`, `files` with `{ type: 'string', minLength: 1 }` because it is native content, and the `--format` option the formatter's hook declares with `enum: ['table', 'json', 'jsonl']`.
- **Input sources** ([reference](../../docs/core/input-sources.md)). `min-bytes` binds `TEXTSTAT_MIN_BYTES` and `--total` binds `TEXTSTAT_TOTAL`, so `TEXTSTAT_MIN_BYTES=4 textstat one.txt` filters as `textstat --min-bytes 4 one.txt` does and the flag wins over the variable. A typed alias is the flag, so `TEXTSTAT_MIN_BYTES=5 textstat --minimum 1 one.txt` applies 1.
- **Filtering and totals.** The action keeps a row for each source at or above the byte threshold and totals only retained sources. A selection the threshold filters entirely still prints the header, and a `total` row of zero when the invocation asked for one.
- **Configuration and logging** ([configuration](../../docs/plugins/config.md), [logging](../../docs/plugins/logging.md)). `configuration({ file: '.textstat.{toml,json}', schema, short: 'c' })` reads `minBytes` and `total` through `configInput`, and `logging()` appends each run's records to `textstat.jsonl`.

### Results and views

- **Results** ([reference](../../docs/core/results.md#declaring-a-result)). textstat declares `rows<Row>` over `{ count: number; source: string }` with one whole view under the key `table`, and prints the table bytes shown below with its `--timing` line still on stderr. Its action appends `{ count: total, source: 'total' }` when `--total` was supplied ([`src/count-files.ts`](src/count-files.ts)). Stdout carries the rows and nothing else the action writes, and a read failure on any source leaves stdout empty.
- **Table view** ([reference](../../docs/plugins/pack-views.md#table)). The `table` view names the `COUNT` and `SOURCE` headers. Counts right-align in a column as wide as the header or the widest count, a two-space gutter separates the columns, a table wider than a terminal shrinks as the reference states, and the source column has no trailing padding. The total row is present only with `--total` and its source is `total`, so a selection that the byte threshold filters entirely still prints the header and one `total` row.

  ```text
  COUNT  SOURCE
      6  one.txt
      2  two words.txt
      8  total
  ```

- **The formatter** ([reference](../../docs/plugins/format.md)). textstat installs `format({ short: 'f' })` after `help()` and `version()` and ahead of the example plugin. `textstat -f json one.txt` and `textstat --format json one.txt` print the rows as one indented array, with the `--timing` line still on stderr. `textstat --format jsonl one.txt` prints one line per row, and `textstat one.txt` prints its table. `inspect()` reports `['table', 'json', 'jsonl']` on the root.
- **Failure views** ([reference](../../docs/core/failure-views.md#failure-views)). [`src/views.ts`](src/views.ts) overrides the literal `FatalError` view, so a read failure prints its escaped message and nothing else.

### Help and plugins

- **Help** ([reference](../../docs/plugins/help.md#help-extensions)). textstat installs `help()` and `version()` from `@loomcli/plugins` ahead of the example plugin, so help and version win a tie. The root carries a `helpCommand` value with the `details` and `examples` the page shows, where each `command` omits the application name. The example plugin keeps its own descriptor and values, because the two are separate facts. `textstat --help` prints the page with its `--format` row, whose description names the declared default, as the [help restyle](../../docs/plugins/help.md#help-and-version-restyle) specifies, and whose [accepted values](../../docs/plugins/help.md#accepted-values) list the view names.
- **Shared example plugin** ([reference](../../docs/core/extensions.md)). The [explain plugin](../explain/README.md) contributes `--explain`, which prints the command's name, its description, and the details its declaration carries, then ends the invocation without reading a file.
- **Other plugins.** textstat also installs `suggestions()`, `manifest({ short: 'M' })`, and `loomTheme()` ([`src/application.ts`](src/application.ts)).

## Run it

Run these commands from the repository root. Bundling needs [Bun](https://bun.sh), because each example is bundled with [`loom build --target node`](../../docs/toolchain/build.md#loom-build), which runs `bun build` and bakes the [release facts](../../docs/core/release-facts.md) of a distributed build into the bundle through the `__LOOM_RELEASE__` define. Install dependencies, build the packages, and bundle the examples:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm run build:examples
node examples/textstat/dist/main.js README.md
```

The output is one table: a `COUNT` and `SOURCE` header, then one line per source with a right-aligned count and the supplied file path. The example reads files in argument order. Bytes are the default metric.

To count words and add a combined total:

```sh
node examples/textstat/dist/main.js --metric words --total README.md docs/glossary.md
node examples/textstat/dist/main.js -tm words README.md docs/glossary.md
```

`--metric` accepts `bytes`, `words`, or `lines`. Bytes count file bytes. Words are runs of non-whitespace characters after UTF-8 decoding, using JavaScript whitespace rules. Lines count LF characters; an unterminated final line adds no LF. Empty files count as zero for every metric.

`--total` or `-t` appends a `total` row, including for one file. Unsupported metrics fail before file access. The table renders once, after every source is counted, so a read error prints no table at all.

To keep only files with at least 100 bytes:

```sh
node examples/textstat/dist/main.js --min-bytes 100 --total README.md docs/glossary.md
```

`--min-bytes` uses a schema to transform decimal digits into a non-negative safe integer. Its declared default is `'0'`, which becomes numeric `0`. Filtered files do not contribute to the total. Invalid inputs report all schema issues before the action reads any files.

`--explain` prints the command's name, its description, and the details its declaration carries, then ends the invocation without reading a file.

The first bare `--` starts a separate passthrough tail. textstat ignores that tail; it does not treat tail tokens as file paths.

The same built application runs with Bun:

```sh
bun examples/textstat/dist/main.js README.md
```

The bundle is a distributed build, so a defect prints `textstat: Something went wrong.`. The source is a development build, because nothing baked release facts into it, so they read `{ build: 'source' }`, and a defect prints its Developer Diagnostic when the source runs under Bun:

```sh
bun examples/textstat/src/main.ts README.md
```
