---
description: What Loom CLI for Rust is, a complete small application, what an operator and an agent get from it, the crates, the checks, and where to read next.
---

# Loom CLI for Rust

Loom CLI for Rust is a framework for command-line applications that serve people, agents, and automation from one declaration. An author declares an Application and its Commands once, with typed inputs and declared results, and installs plugins that project that one command graph as help pages, a machine-readable manifest, structured output, MCP tools, and shell completion. It is the Rust implementation of [Loom CLI](../README.md), beside the TypeScript reference implementation in [typescript](../typescript): what an operator or an agent reads matches the TypeScript reference byte for byte, except at a limit of the programming language ([ADR-0217](../docs/decisions/0217-parity-between-looms-implementations-is-the-operators-experience.md)), and [docs/deviations.md](docs/deviations.md) lists every difference the port chooses. The shared conformance cases Rust has yet to match are listed apart, in [conformance/behind.json](conformance/behind.json) ([ADR-0006](docs/decisions/0006-rust-tracks-the-shared-conformance-cases-it-is-behind-on-in-a-list-apart-from-deviations.md)).

## A small application

`wordlen` measures words. Its one Command, `count`, declares a variadic argument and a validated option through `#[derive(Inputs)]`, declares a rows result with a table view, and opts in to MCP. The application installs six plugins:

```rust,no_run
//! wordlen measures words.

use loomcli_core::{
    Application, Command, Context, GroupApplication, Inputs, Outcome, RowViews, RowsResult,
};
use loomcli_plugins::completion::completion;
use loomcli_plugins::format::format;
use loomcli_plugins::help::help;
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpAnnotations, McpCommandFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_plugins::table::{TableConfig, table};
use loomcli_plugins::version::version;
use loomcli_validators::integer;
use serde::Serialize;

/// What `wordlen count` reads.
#[derive(Inputs)]
struct CountInputs {
    /// The words to measure.
    #[argument(required)]
    words: Vec<String>,
    /// Leave out a word shorter than this many characters.
    #[option(short = 'm', default = "1", validate = integer().min(1))]
    min: i64,
}

/// One measured word: a row of the result.
#[derive(Serialize)]
struct Measured {
    word: String,
    length: usize,
}

async fn count(context: Context<CountInputs, RowsResult<Measured>>) -> Outcome {
    let CountInputs { words, min } = &context.inputs;
    let rows: Vec<Measured> = words
        .iter()
        .map(|word| Measured {
            word: word.clone(),
            length: word.chars().count(),
        })
        .filter(|row| i64::try_from(row.length).is_ok_and(|length| length >= *min))
        .collect();
    context.out.results(rows).await
}

fn wordlen() -> GroupApplication {
    Application::new("wordlen")
        .plugins((help(), version(), format(), manifest(), completion(), mcp()))
        .description("Measure words.")
        .version("1.0.0")
        .command(
            Command::new("count")
                .description("Print the length of each word.")
                .extend([MCP_COMMAND.value(McpCommandFacts::annotations(
                    McpAnnotations::new().read_only(true).open_world(false),
                ))])
                .inputs::<CountInputs>()
                .rows(RowViews::new().view("table", table(TableConfig::new())))
                .action(count),
        )
}

fn main() -> std::process::ExitCode {
    wordlen().main()
}
```

The program is [docs/check/examples/wordlen.rs](docs/check/examples/wordlen.rs), and a test keeps this block identical to it. Run it from a checkout with `cargo run -q -p docs-check --example wordlen -- <words>`. An application of its own depends on the crates by path, with the features of the plugins it installs:

```toml
[dependencies]
loomcli-core = { path = "../loomcli/rust/crates/loomcli-core" }
loomcli-plugins = { path = "../loomcli/rust/crates/loomcli-plugins", features = ["completion", "format", "help", "manifest", "mcp", "table", "version"] }
loomcli-validators = { path = "../loomcli/rust/crates/loomcli-validators" }
serde = { version = "1", features = ["derive"] }
```

The crates are at version `0.0.0` and not published yet.

## What an operator gets

The result prints through its default view. The help plugin writes a page for every Command, and the format plugin adds `--format` to every Command that declares a result:

```text
$ wordlen count Ada Grace Hopper
word    length
Ada     3
Grace   5
Hopper  6

$ wordlen count --help
wordlen count · Print the length of each word.

USAGE
  wordlen count <words...> [options]

ARGUMENTS
  words  The words to measure.

OPTIONS
  -m, --min <min>        Leave out a word shorter than this many characters.  (default: 1)
      --format <format>  Select the output format, table by default. One of: table, json, jsonl.

GLOBAL OPTIONS
  -h, --help      Show this help.
  -V, --version   Print the version.
      --manifest  Print this command's manifest as JSON.
```

Core validates every input before the action runs. A usage failure says what went wrong and what to do, on stderr, and exits 2:

```text
$ wordlen count Ada --min 0
wordlen: Option "--min": Expected a whole number of at least 1.
Run "wordlen count --help" to see the usage.
$ echo $?
2
```

## What an agent gets

`--format json` prints the result as one JSON document, and `--format jsonl` as one line per row. Under a JSON format a failure is encoded too, on stderr, with its failure code and exit code:

```text
$ wordlen count Ada Grace Hopper --min 4 --format json
[
  {
    "word": "Grace",
    "length": 5
  },
  {
    "word": "Hopper",
    "length": 6
  }
]

$ wordlen count Ada --min 0 --format json
{"error":{"code":"invalid-input","exitCode":2,"message":"Option \"--min\": Expected a whole number of at least 1.","hints":["Run \"wordlen count --help\" to see the usage."]}}
```

`--manifest` prints the machine-readable description of the routed Command: the application's facts, the exit codes and what each means, the encodings, the global options, and the Command with its result, failures, arguments, and options, each input with its JSON Schema. An excerpt of `wordlen count --manifest`:

```json
    "result": {
      "kind": "rows",
      "views": [
        "table",
        "json",
        "jsonl"
      ],
      "default": "table",
      "mediaTypes": {
        "table": null,
        "json": "application/json",
        "jsonl": "application/jsonl"
      }
    },
```

`wordlen mcp` serves every Command that carries an `MCP_COMMAND` value as a tool of a Model Context Protocol server over stdio. A session, one JSON-RPC line each way, with the requests shortened to the method:

```text
→ initialize, protocolVersion 2025-11-25
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"wordlen","version":"1.0.0","description":"Measure words."}}}
→ tools/list
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"count","description":"Print the length of each word.","inputSchema":{"type":"object","properties":{"words":{"type":"array","items":{"type":"string"},"minItems":1,"description":"The words to measure."},"min":{"type":"integer","minimum":1,"description":"Leave out a word shorter than this many characters.","default":"1"}},"required":["words"],"additionalProperties":false},"annotations":{"readOnlyHint":true,"openWorldHint":false}}]}}
→ tools/call count {"words":["Ada","Grace"],"min":4}
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"[\n  {\n    \"word\": \"Grace\",\n    \"length\": 5\n  }\n]\n"}],"isError":false}}
→ tools/call count {"words":["Ada"],"min":0}
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"wordlen: Option \"min\": Expected a whole number of at least 1.\n"}],"isError":true,"structuredContent":{"exitCode":2,"failure":{"code":"invalid-input","exitCode":2,"message":"Option \"min\": Expected a whole number of at least 1.","hints":[]}}}}
```

`wordlen mcp install` registers the server with Claude Code and Codex, and `wordlen mcp config` prints a client configuration. `wordlen completion bash` (or `zsh`, `fish`, `powershell`) prints a completion script, and `wordlen completion install` installs it. The scripts ask the application itself, which reads the partial command line with the parser's own grammar:

```text
$ wordlen completion __complete -- count --format ''
table
json
jsonl
:4
```

The [agents guide](docs/guide/agents.md) covers each of these end to end.

## The crates

| Crate | What it holds |
| --- | --- |
| [`loomcli-core`](crates/loomcli-core) | Applications and Commands, typed inputs and validation, the run, output, views and results, failures, plugins, providers, and the host. It re-exports `loomcli-derive` and `loomcli-style`. |
| [`loomcli-derive`](crates/loomcli-derive) | `#[derive(Inputs)]` and `#[derive(Failure)]`. |
| [`loomcli-validators`](crates/loomcli-validators) | The validator catalog: `text`, `integer`, `number`, `port`, `one_of`, `url`, `uuid`, `date`, `date_time`, `time`, `duration`, `path`, `bytes`, `host`, `ip`, `cidr`, `key_value`, `email`, plus `create_validator` and `pipe`. |
| [`loomcli-plugins`](crates/loomcli-plugins) | Every first-party plugin and the pack views, one Cargo feature each and no default features. |
| [`loomcli-prompts`](crates/loomcli-prompts) | Questions (`text`, `secret`, `editor`, `confirm`, `select`, `multiselect`) and progress lines. |
| [`loomcli-style`](crates/loomcli-style) | Style markup, themes, color resolution, glyphs, and display width. |
| [`loomcli-mcp`](crates/loomcli-mcp) | The Model Context Protocol server, over stdio and streamable HTTP, that the MCP plugin serves through. It knows nothing of core. |
| [`loomcli-testing`](crates/loomcli-testing) | The assembly checks, the mock process, and the context builders for an application's tests. |

The [examples](examples) are the reference's examples, ported declaration for declaration: `jsonkit` and `textstat` are applications, and `explain` and `doctor` are plugin crates outside the pack.

The toolchain, `cargo loom`, is not in this tree; [Shipping](docs/guide/shipping.md#the-toolchain-is-not-in-this-tree) says what that leaves out.

## Checks

Every command here runs from `rust/`, on the toolchain `rust-toolchain.toml` pins. A change is done when these pass:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

`cargo test --workspace --all-features --doc` runs the doctests alone, the examples of this README and the guides among them.

The conformance harness runs the shared cases against the Rust `jsonkit` and `textstat` examples. It compares stdout, stderr, the exit code, and written files byte for byte.

```sh
cargo build -p jsonkit -p textstat
cargo run -p conformance-harness
```

The [shared conformance cases](../conformance/README.md) document both runners and how to refresh the expectations.

## Guides

- [Declaring an application](docs/guide/application.md): Commands, arguments and options through the derive and the builder, validators, results and views, failures, providers, and tests.
- [The first-party plugins](docs/guide/plugins.md): what each plugin adds for an operator and for an agent, and the feature that compiles it.
- [Writing a plugin](docs/guide/writing-a-plugin.md): a plugin crate from scratch, with the `explain` and `doctor` examples as worked cases.
- [Agents](docs/guide/agents.md): the manifest, formats and failure encoding, non-interactive runs, MCP, skills, and completion.
- [Shipping](docs/guide/shipping.md): `cargo loom`, which is not in this tree, release facts, self-update, and the service plugin.
- [Coming from TypeScript](docs/guide/from-typescript.md): how each concept of the TypeScript Loom maps to Rust, and the deviations in summary.

The [core API design](docs/design/core-api.md) states the authoring contract concept by concept, and the [decision records](docs/decisions/README.md) record why the port is shaped as it is. The rustdoc holds every signature: `cargo doc --workspace --all-features --open`. [AGENTS.md](AGENTS.md) states the conventions for changes to the Rust implementation.
