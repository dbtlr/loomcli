# jsonkit

jsonkit is an example application that reads and reshapes one JSON document. It reports the document's shape, reads a value at a dot-separated path, lists keys and paths, and keeps named fields. Every Loom first-party projection runs over it: help, manifest, MCP, completion, and man pages.

## What it covers

[`src/application.ts`](src/application.ts) is the declaration to read first. [`tests/jsonkit.test.ts`](tests/jsonkit.test.ts) holds one case for each capability below, which shows how the declaration assembles Loom's parts. The packages prove each rule, so the example tests the assembly, not its own functionality.

### Commands and routing

- **Nested Commands and groups** ([reference](../../docs/core/commands.md#nested-commands-and-groups)). `stats depth max` sits three levels below the root under two groups and prints how deeply the document nests under an optional path, so routing, help, completion, the manifest, MCP, and man pages run on a path deeper than two levels ([`src/commands/stats.ts`](src/commands/stats.ts)).
- **Aliases** ([reference](../../docs/core/commands.md#aliases)). `keys` has the alias `ls`, and `jsonkit ls -f doc.json` lists keys exactly as `jsonkit keys -f doc.json` does ([`src/commands/keys.ts`](src/commands/keys.ts)).
- **Hidden and deprecated members** ([reference](../../docs/core/commands.md#hidden-and-deprecated-members)). `fetch` is deprecated in favor of `get`, `debug` is hidden, and `paths` is hidden. `jsonkit typo` offers `doctor, completion, mcp, manpage, get, keys, select, stats`, omitting hidden and deprecated Commands.
- **Modular authoring** ([reference](../../docs/core/commands.md#modular-authoring)). The root summarizes a document. `get` has a required scalar `path`, `keys` has an optional scalar `path`, `select` reshapes top-level keys, and `paths` lists document paths. Each Command is a module under [`src/commands`](src/commands), and each action is a separate module under [`src/actions`](src/actions) typed with `ActionHandler`. An omitted `keys` path lists the document root, and a supplied path uses the resolver shared with `get`.
- **Plugin Commands** ([reference](../../docs/core/plugin-contract.md#plugin-commands)). The private [doctor plugin](../doctor/README.md) attaches `jsonkit doctor` to the root, and its Command leads the root's Commands. The plugin compiles in its own package, outside jsonkit's `Register` augmentation.

### Options and verbosity

- **Repeated values** ([reference](../../docs/core/options.md#repeated-string-values)). `select` declares `--field` as a required multiple option with the short alias `-F` and the catalog's `text()` validator. Its action receives `string[]` and prints the requested keys in supplied order, warning on stderr for missing keys. `--field a -F ''` fails with `Option "--field" at 1: Expected a nonempty value.`
- **Counted options and verbosity** ([options](../../docs/core/options.md#counted-options), [verbosity](../../docs/core/verbosity.md)). jsonkit installs the [verbose plugin](../../docs/plugins/verbose.md), which declares the global counted options `-v, --verbose` and `-q, --quiet`, and declares no verbose-marked or quiet-marked option of its own. The shared reader first writes one `out.debug` line, `Reading doc.json.` for a file or `Reading stdin.` for stdin. The run's verbosity decides whether it prints: `-v` and `-vv` print it, and a run without `-v` or with `-v -q` prints none. The reader reads no option to decide. File names and runtime reasons print with control characters escaped, and the action's `style.escape` protects styled file names ([`src/read-json.ts`](src/read-json.ts)).

### Content inputs and validation

- **Native content** ([reference](../../docs/core/validation.md#content-inputs)). Each document-reading Command, including the root action, declares its own required local native content `--file` with `stdin: true` ([`src/document-input.ts`](src/document-input.ts)). A supplied path wins over stdin; otherwise available nonterminal stdin fills the source. Core checks presence and paths before middleware, and with neither source the run fails with a missing-input problem and exit 2. Commands that read no document, such as `doctor`, have no file option and run at a terminal. Core selects the supplied file or available stdin before dispatch. All document actions call one shared reader with their prepared `Content` handle, and the reader calls the handle's `text()` method when the action needs the document. Source presence and path errors belong to native preparation.
- **Input schema** ([reference](../../docs/core/validation.md#input-schema)). `inspect()` reports `--file` with `validated: true` and `schema: { type: 'string', minLength: 1 }`, `--verbose` as a `count` node with `schema: null`, and `select`'s `--field` with the catalog's nonempty text schema, `{ type: 'string', minLength: 1 }`, beside its `$schema` key.
- **Validators** ([reference](../../docs/libs/validators.md#catalog)). `select` declares `--field` with the catalog's `text()`.

### Results, views, and formats

- **Results and row views** ([results](../../docs/core/results.md#declaring-a-result), [pack views](../../docs/plugins/pack-views.md#records)). The root declares `rows<Member>` over `{ key: string; kind: string }` with `views: { records: records({ identifier: 'key' }) }`, and its line about the document's kind goes to stderr through `out.info`. A scalar document is an empty sequence whose tail prints `0 records`. The `jsonkit --help` page gains an OPTIONS section with its `--format` row because the root declares a result.
- **Sequences** ([reference](../../docs/core/results.md#a-sequence-that-stops-early)). The hidden `paths` Command declares `rows<Entry>` over the document's paths, writes each row as an async generator yields it, and leaves a partial list and the incomplete line behind when the generator throws. It declares `views: { list: records({ identifier: 'path' }), table: table({ columns: ['path', 'kind'] }) }` ([`src/commands/paths.ts`](src/commands/paths.ts)).
- **The formatter** ([reference](../../docs/plugins/format.md)). jsonkit installs `format({ short: 'o' })` after `help()` and `version()` and ahead of the example plugin. `jsonkit paths -o jsonl -f doc.json` and `jsonkit paths --format jsonl -f doc.json` print one line per `Entry`, `--format ndjson` prints the same bytes, and `--format json` prints one indented array. `inspect()` reports `['list', 'table', 'json', 'jsonl']` on `paths`.

### Failures

- **Failure views** ([reference](../../docs/core/failure-views.md#failure-views)). [`src/views.ts`](src/views.ts) overrides one failure view, the literal `FatalError` view, and keeps core's text for every other class. Its usage diagnostics are core's sentences opened by the application name under [Failure classes](../../docs/core/failures.md#failure-classes), with the [suggestions](../../docs/plugins/suggestions.md) plugin's fix where a name is near and help's hint under each.
- **Declared exit codes** ([reference](../../docs/core/failures.md#declared-exit-codes)). `PathNotFoundError` is a `FatalError` subclass that `get` and `keys` throw for a path the document does not hold. It declares `EX_DATAERR`, 65, because the document was read and its data holds no value at the path, which `EX_NOINPUT` would misreport as a missing input file. It renders through the literal `FatalError` view, which escapes the message and adds nothing, so its bytes match core's text for a message that carries no marker.
- **Translators** ([reference](../../docs/core/failures.md#translators)). `InvalidJsonError` is what the translator in [`src/translators.ts`](src/translators.ts) returns for the `SyntaxError` `JSON.parse` throws, so the reader holds no catch. It also declares 65. It names no source, because the translator sees only the `SyntaxError`, and it quotes no engine text.

| Invocation                              | stderr                                                                                                                                              | Code |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `jsonkit select --field '' -f doc.json` | `jsonkit: Option "--field" at 0: Expected a nonempty value.` then `Run "jsonkit select --help" to see the usage.`                                     | 2    |
| `jsonkit get -f doc.json`               | `jsonkit: Argument "path" requires a value. Supply a value for "path".` then `Run "jsonkit get --help" to see the usage.`                           | 2    |
| `jsonkit typo -f doc.json`              | `jsonkit: Unknown command "typo". Use one of: doctor, completion, mcp, manpage, get, keys, select, stats.` then `Run "jsonkit --help" to see the usage.` | 2    |
| `jsonkit gte -f doc.json`               | `jsonkit: Unknown command "gte". Did you mean "get"?` then `Run "jsonkit --help" to see the usage.`                                                 | 2    |
| `jsonkit get missing -f doc.json`       | `Path not found: "missing". Run jsonkit keys to list the keys at the root.`                                                                         | 65   |
| `jsonkit keys missing -f doc.json`      | `Path not found: "missing". Run jsonkit keys to list the keys at the root.`                                                                         | 65   |
| `jsonkit get name -f broken.json`       | `The document is not valid JSON. Correct its syntax, or supply another document.`                                                                   | 65   |

### Plugins

- **First-party plugins** ([reference](../../docs/plugins/README.md)). [`src/application.ts`](src/application.ts) installs `help()`, `suggestions()`, `version()`, `format({ short: 'o' })`, `manifest({ short: 'M' })`, `loomTheme()`, the example [explain plugin](../explain/README.md), `color()`, `verbose()`, the example [doctor plugin](../doctor/README.md), `completion()`, `mcp()`, and `manpage()`. `help()` and `version()` come ahead of the example plugin, so they win a tie.
- **Help and version** ([help](../../docs/plugins/help.md#help-extensions), [version](../../docs/plugins/version.md)). Help's own descriptors carry the prose the pages print. jsonkit's root and `get` carry `helpCommand` values with the `details` and `examples` the pages show, where each `command` omits the application name, and `--file` carries `helpInput({ placeholder: 'path' })`. The example plugin keeps its own descriptor and values, because the two are separate facts. `jsonkit --help`, `jsonkit select --help`, `jsonkit get --help`, the deprecated `jsonkit fetch --help`, and the hidden `jsonkit debug --help` each print a page, and `jsonkit --version` and `jsonkit get --version` print `jsonkit v0.0.0` while the manifest holds `0.0.0`.
- **Shared example plugin** ([reference](../../docs/core/extensions.md)). The same [explain plugin](../explain/README.md) that textstat installs contributes `--explain`, which prints the routed Command's name, its description, and the details its declaration carries, then ends the invocation without reading a document, so it needs no `--file`.
- **Failure messages** ([reference](../../docs/core/failure-views.md#failure-views)). jsonkit overrides one failure view, the literal `FatalError` view, in [src/views.ts](src/views.ts). Every other failure keeps core's default text, which opens a usage failure such as an unknown command with `jsonkit: `.

## Run it

Run these commands from the repository root. Bundling needs [Bun](https://bun.sh), because each example is bundled with [`loom build --target node`](../../docs/toolchain/build.md#loom-build). Install dependencies, build the packages, and bundle the examples:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm run build:examples
node examples/jsonkit/dist/main.js --file package.json
```

The root summary names the kind of the root value on stderr: `object with N keys`, `array with N items`, `string`, `number`, `boolean`, or `null`. One member reads as `1 key` or `1 item`. For an object, a `key` and `kind` record per top-level key follows on stdout in JavaScript property order, which lists integer-like keys first in ascending order and every other key in document order, and `--format json` prints the same members as an indented array. The `keys` command uses the same order.

`--file` accepts a value before, between, or after the command name:

```sh
node examples/jsonkit/dist/main.js get name --file package.json
node examples/jsonkit/dist/main.js keys --file package.json
```

`get` takes one required dot-separated path. A segment of digits indexes an array; on an object every segment is a key.

```sh
node examples/jsonkit/dist/main.js --file package.json get repository.url
node examples/jsonkit/dist/main.js --file package.json get workspaces.1
```

The result prints as JSON text. Objects and arrays use two-space indentation, and scalars stay compact, so a string prints quoted. An unresolved path and invalid JSON each exit 65, `EX_DATAERR`; a file that does not exist is an input error that exits 2. `keys` prints the top-level keys of an object, one per line, and rejects a path that does not hold an object. An unknown command name exits 2 and lists the choices.

`--explain` prints the routed command's name, its description, and the details its declaration carries, then ends the invocation without reading a document.
