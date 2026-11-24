---
description: The agent-first features of a Loom application end to end. The manifest, formats and failure encoding, non-interactive runs, MCP serving and registration, skills, and completion, with output captured from the examples.
---

# Agents

A Loom application serves an agent from the same declaration it serves a person from. An agent reads what the application offers from the manifest, asks for structured output with `--format`, reads failures as structured data with stable codes, runs without being asked questions, calls the Commands as MCP tools, and installs the skills the application ships. Each of these is a plugin over the command graph, so the facts never drift from what the application does. The [plugins guide](plugins.md) lists the features that compile each one.

The output on this page is captured from the jsonkit example, run from the repository’s [shared fixtures](../../../conformance/fixtures/) (`cargo build -p jsonkit` from `rust/`, then `../../rust/target/debug/jsonkit` from the fixtures directory), and from the doctests below, which assert it.

## The manifest

`--manifest` prints the routed Command's machine-readable description as one JSON document and exits 0, without validating the Command's other inputs. At the root it describes the application and the root Command with its children; after a path it describes that Command. The document holds:

- `name`, `version`, and `description` of the application, and `tokens`, a sentence that states how an input's schema reads.
- `exitCodes`: every exit code the Command can end with and what it means, the failure codes of declared failures included.
- `encodings`: what `json` and `jsonl` output holds, when the formatter is installed.
- `globals`: every global option, the plugins' included.
- `configuration`: the configuration file's JSON Schema, or `null`.
- `command`: the Command's name, path, description, details, examples, deprecation, result (kind, views, default view, media types), declared failures, arguments, option groups, options, and children. Each input lists its spellings, environment variables, default, and the JSON Schema one token must satisfy.

jsonkit's root declares the failures its document Commands raise, so its exit codes read:

```text
$ jsonkit --manifest
…
  "exitCodes": {
    "0": "Successful execution and core output",
    "1": "Expected action failure, internal failure, or invalid declarations",
    "2": "Invalid invocation inputs",
    "65": "Declared failures: invalid-json, path-not-found",
    "129": "Cancelled by SIGHUP",
    "130": "Cancelled by SIGINT, a caller-supplied abort, or the action's cancel()",
    "131": "Cancelled by SIGQUIT",
    "141": "Stopped because the reader of stdout closed the pipe",
    "143": "Cancelled by SIGTERM"
  },
```

The Command part of `jsonkit get --manifest` carries the details and examples the help plugin restates and the failures the author declared:

```json
{
  "name": "get",
  "path": [
    "get"
  ],
  "description": "Read one value at a path.",
  "details": [
    "Quote a path that holds a shell metacharacter.",
    "A path is a dot-separated walk from the root of the document.\n\n- A **key** reads an object's member, such as `user.name`.\n- A **whole number** reads an array's item, such as `items.0`.\n\nThe document is *JSON*; see [the format](https://www.json.org/json-en.html).\n"
  ],
  "examples": [
    {
      "command": "get name -f doc.json",
      "note": null
    },
    {
      "command": "get nested.deep.value -f doc.json",
      "note": null
    }
  ],
  "failures": [
    {
      "code": "path-not-found",
      "exitCode": 65,
      "meaning": "The path names no value in the document."
    },
    {
      "code": "invalid-json",
      "exitCode": 65,
      "meaning": "The document is not valid JSON."
    }
  ]
}
```

An author adds details, examples, and failures through the manifest's collecting extension, `MANIFEST_COMMAND`:

```rust
use loomcli_core::{Command, Context, EX_DATAERR, Failure, FatalError};
use loomcli_plugins::manifest::extension::{DeclaredFailure, MANIFEST_COMMAND, ManifestCommandFacts};

/// A path the document does not hold.
#[derive(Debug, Failure)]
#[failure(code = "path-not-found", exit_code = EX_DATAERR)]
pub struct PathNotFoundError {
    #[failure(base)]
    base: FatalError,
}

let get = Command::new("get")
    .description("Read one value at a path.")
    .extend([MANIFEST_COMMAND.value(
        ManifestCommandFacts::new()
            .details("Quote a path that holds a shell metacharacter.")
            .failures([DeclaredFailure::of::<PathNotFoundError>(
                "The path names no value in the document.",
            )]),
    )])
    .action(|context: Context| async move { context.out.print("{}").await });
```

## Formats and failure encoding

The formatter adds `json` and `jsonl` views to every Command that declares a result, and `--format` selects one. The result goes to stdout; lane output, such as jsonkit's info line, goes to stderr, so stdout carries the data alone:

```text
$ jsonkit -f doc.json --format jsonl
ℹ object with 8 keys
{"key":"name","kind":"string"}
{"key":"version","kind":"string"}
…
```

Under a format whose view declares `application/json` or `application/jsonl`, a failure is encoded too: one line on stderr holding the failure form, and the exit code of its class.

```text
$ jsonkit -f broken.json --format json
{"error":{"code":"invalid-json","exitCode":65,"message":"The document is not valid JSON. Correct its syntax, or supply another document.","hints":[]}}
$ echo $?
65
```

An agent branches on `code`, never on the message. Core's own failures have fixed codes and exit codes:

| Code | Exit | Raised when |
| --- | --- | --- |
| `invalid-input` | 2 | An input is missing or its validator rejected it. |
| `unknown-command` | 2 | A word names no Command. |
| `missing-subcommand` | 2 | A group with no action was run without a child. |
| `unexpected-argument` | 2 | A Command received more arguments than it declares. |
| `unknown-option`, `missing-value`, `unexpected-value`, `repeated-option`, `misplaced-option` | 2 | An option word does not fit the Command's table. |
| `fatal` | 1 | The action failed with a `FatalError`. |
| `working-directory-unreadable` | 1 | The working directory cannot be read. |
| `internal` | 1 | A defect or an invalid declaration. |

An application's own failure classes declare their codes and exit codes, which the manifest lists. A run cancelled by a signal exits 129, 130, 131, or 143, and a run whose stdout reader closed the pipe exits 141 and writes nothing more.

## Non-interactive runs

A run asks a question only when stdin and stderr are both terminals and `CI` is unset, empty, or `false`. A pipe, a CI job, and every MCP tool call are non-interactive, and the interaction plugin's `--no-input` turns questions off at a terminal too. A non-interactive run never waits for a key:

- A question that `loomcli-prompts` links to an input answers from the supplied input, or fails with that input's missing-input error, exit 2.
- An input declared `non_interactive` (the builder's `required_when_non_interactive()`) is optional at a terminal, where the action may ask for it, and required otherwise.

```rust
use loomcli_core::{Application, Command, Context, Inputs, RunOptions};
use loomcli_testing::{MockFields, mock_process};

/// What `add` reads.
#[derive(Inputs)]
struct AddInputs {
    /// The note's title.
    #[option(non_interactive)]
    title: Option<String>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let notes = Application::new("notes").description("Keep notes.").command(
        Command::new("add")
            .description("Add a note.")
            .inputs::<AddInputs>()
            .action(|context: Context<AddInputs>| async move {
                let title = context.inputs.title.clone().unwrap_or_default();
                context.out.print(&title).await
            }),
    );
    // The mock's streams are pipes, so the run is not interactive.
    let process = mock_process(MockFields::new().argv(["add"]));
    let code = notes.run(RunOptions::new().process(process.clone())).await;
    assert_eq!(code.get(), 2);
    assert_eq!(
        process.stderr_text(),
        "notes: Option \"--title\" is required when input is not interactive. Supply a value.\n"
    );
}
```

Live regions, such as progress lines, draw only at a terminal that redraws in place; elsewhere a progress line writes plain lines, and color follows `NO_COLOR`, `FORCE_COLOR`, and the color plugin's `--color`.

## MCP

`app mcp` serves the application's tools over stdin and stdout, one JSON-RPC message per line. A Command is a tool when it carries an `MCP_COMMAND` value, which also sets its annotations (`read_only`, `destructive`, `idempotent`, `open_world`) and may replace its description:

- **Names.** A tool's name is the Command's path joined by `_`, each `-` written as `_`, and the application's name for the root: jsonkit serves `jsonkit`, `get`, `keys`, `select`, and `stats_depth_max`.
- **Schemas.** A tool's input schema lists the Command's arguments, then its local options, then the global options, leaving out hidden, control, and excluded options. Each property is the input's published JSON Schema with its description and default. `MCP_INPUT.value(McpInputFacts::excluded())` leaves an option out, and `McpInputFacts::described(text)` gives it a description for agents alone.
- **Calls.** A call runs the Command through `invoke`, with no terminal and so no questions, and cancels it when the client sends `notifications/cancelled`. Progress lines become progress notifications when the client sent a progress token. The answer holds the output as text, and a failure answers with `isError: true` and the failure form with its exit code as structured content.
- **Revisions.** The server answers the per-request revision `2026-07-28`, where each request carries its protocol version under `params._meta` and `server/discover` describes the server, and the handshake revisions `2025-11-25` and `2025-06-18`, negotiated by `initialize`.

Two calls of jsonkit's `get` tool under the per-request revision, the request and then the answer of each:

```text
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}},"name":"get","arguments":{"path":"user.address","file":"doc.json"}}}
{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"{\n  \"city\": \"London\",\n  \"geo\": {\n    \"lat\": 51.5,\n    \"lon\": -0.12\n  }\n}\n"}],"isError":false,"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"jsonkit","version":"0.0.0","description":"Read and reshape one JSON document."}}}}

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}},"name":"get","arguments":{"path":"missing","file":"doc.json"}}}
{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"Path not found: \"missing\". Run jsonkit keys to list the keys at the root.\n"}],"isError":true,"structuredContent":{"exitCode":65,"failure":{"code":"path-not-found","exitCode":65,"message":"Path not found: \"missing\". Run jsonkit keys to list the keys at the root.","hints":[]}},"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"jsonkit","version":"0.0.0","description":"Read and reshape one JSON document."}}}}
```

The [README](../../README.md#what-an-agent-gets) shows a session under the `2025-11-25` handshake. The server stops reading when stdin ends, so a client waits for each answer it needs before it closes stdin.

### Registration

- `app mcp install` registers the server with Claude Code and Codex, through each agent's own CLI (`--agent claude` or `--agent codex` picks one), and records each registration in the application's installation record. `--force` replaces a registration of the same name that `mcp install` did not make.
- `app mcp uninstall` removes the registrations the record holds.
- `app mcp config` prints a client configuration for any other client. jsonkit's, with the binary's absolute path where the angle brackets stand:

  ```json
  {
    "mcpServers": {
      "jsonkit": {
        "command": "<path to jsonkit>",
        "args": [
          "mcp"
        ]
      }
    }
  }
  ```

## Skills

The skills plugin ships the application's agent skills inside its binary and installs them where coding agents read them. `skills install` writes each skill's folder to `<claude>/skills/<name>/`, where `<claude>` is an absolute `CLAUDE_CONFIG_DIR` or else `~/.claude`, and to `~/.agents/skills/<name>/`, and records both; `skills install --project` writes them at the repository root instead, with no record. `skills update` rewrites the recorded folders, and `skills uninstall` removes them.

```rust
use loomcli_core::{Application, Context, RunOptions};
use loomcli_plugins::skills::{Skill, SkillFile, skills};
use loomcli_testing::{MockFields, mock_process};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let home = std::env::temp_dir().join(format!("docs-check-skills-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let notes = || {
        // In an application the file's bytes come from include_bytes!, through SkillFile::embedded.
        let skill = Skill::new(
            "notes",
            [SkillFile::new(
                "SKILL.md",
                "---\nname: notes\ndescription: Keep notes with the notes CLI.\n---\n\nRun notes add.\n",
            )],
        );
        Application::new("notes")
            .plugins((skills(vec![skill]).plugin(),))
            .description("Keep notes.")
            .action(|context: Context| async move { context.out.print("notes").await })
    };
    let process = mock_process(MockFields::new().argv(["skills", "install"]).home(&home));
    notes().run(RunOptions::new().process(process.clone())).await;
    let home_text = home.display().to_string();
    assert_eq!(
        process.stderr_text().replace(&home_text, "~"),
        concat!(
            "✔ Installed notes for claude in ~/.claude/skills/notes.\n",
            "✔ Installed notes for agents in ~/.agents/skills/notes.\n",
        )
    );
    assert!(home.join(".claude/skills/notes/SKILL.md").is_file());
    std::fs::remove_dir_all(&home).unwrap();
}
```

`Skills::folder(path)` reads a source folder of skills where it stands during development, so an edit to a `SKILL.md` installs without a rebuild, and `Skills::embedded_folder(list)` gives the same skills as data for a distributed build. An application that installs the self-update plugin passes `refresh_skills` to it, so a new binary brings its skills along ([shipping](shipping.md#self-update)).

## Completion

The completion plugin prints a script for Bash, Zsh, Fish, or PowerShell, and `completion install` installs it for the login shell. The scripts are Cobra's protocol, ported: each one runs the hidden `completion __complete -- <words>`, and the application answers with one candidate per line, a tab and its description where it has one, and a last line of `:` and a directive. The answer comes from core's `locate`, which reads the partial command line with the parser's own grammar, so a candidate never disagrees with what the run would accept. An agent can call the same protocol to list what may come next:

```text
$ jsonkit completion __complete -- g
get	Read one value at a path.
:4
$ wordlen completion __complete -- count --
--help	Show this help.
--version	Print the version.
--manifest	Print this command's manifest as JSON.
--min	Leave out a word shorter than this many characters.
--format	Select the output format, table by default.
:4
$ wordlen completion __complete -- count --format ''
table
json
jsonl
:4
```

Hidden and deprecated Commands are not offered. An input whose published schema names a closed set of values (`enum`, `const`, or `anyOf`), such as a `one_of` validator's values or `--format`'s view names, completes those values.

## Calling Commands by name

Code that embeds an application calls a Command by path with `Application::invoke(path, values, options, process)`, and an action calls a sibling with `context.invoke(...)`. The values are JSON, as an agent sends them; the call validates them as a run validates tokens, captures the output as plain text, and answers `InvocationOutcome::Completed`, `Failed` with the failure form and exit code, or `Cancelled`. The MCP plugin serves every tool call this way.
