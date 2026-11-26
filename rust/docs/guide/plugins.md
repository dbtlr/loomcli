---
description: The first-party plugins of loomcli-plugins, grouped by what they serve. What each adds for an operator and for an agent, the feature that compiles it, and its settings.
---

# The first-party plugins

Core installs no plugin. Help, `--version`, `--format`, the manifest, MCP, and completion are each a plugin in `loomcli-plugins`, built on the same public contract any crate can use ([writing a plugin](writing-a-plugin.md) shows that contract). This page lists the first-party plugins by what they serve, with what each adds for an operator and for an agent. Each plugin's module rustdoc and the reference page under [docs/plugins](../../../docs/plugins) hold the full behavior.

## Installing plugins

`loomcli-plugins` has one Cargo feature per plugin and no default features, so an application compiles only the plugins it names. An application lists them once, first, in `Application::plugins`. The list is a tuple of up to 32 values of mixed types, or a `Vec` of converted values. The order is the precedence: when two plugins contribute to one thing, such as a view override, the one installed first wins.

```rust
use loomcli_core::{Application, Command, Context, GroupApplication, ThemeMapping};
use loomcli_plugins::background::background;
use loomcli_plugins::color::color;
use loomcli_plugins::completion::completion;
use loomcli_plugins::config::{ConfigurationSettings, Scope, configuration};
use loomcli_plugins::dotenv::dotenv;
use loomcli_plugins::format::format;
use loomcli_plugins::help::help;
use loomcli_plugins::interaction::interaction;
use loomcli_plugins::logging::logging;
use loomcli_plugins::manifest::manifest;
use loomcli_plugins::manpage::manpage;
use loomcli_plugins::mcp::mcp;
use loomcli_plugins::self_update::self_update;
use loomcli_plugins::service::service;
use loomcli_plugins::skills::skills;
use loomcli_plugins::suggestions::suggestions;
use loomcli_plugins::theme::loom_theme;
use loomcli_plugins::verbose::verbose;
use loomcli_plugins::version::version;

/// The configuration file's settings.
#[derive(serde::Deserialize, Default)]
struct Settings {
    folder: Option<String>,
}

fn notes() -> GroupApplication {
    let config = configuration::<Settings>(
        ConfigurationSettings::new(None)
            .file(".notes.{toml,json}")
            .scopes(&[Scope::Project { root: vec![".git".into()] }, Scope::User]),
    );
    Application::new("notes")
        .plugins((
            help().command(true).paging(true),
            version(),
            suggestions(),
            format().short('o'),
            manifest(),
            mcp(),
            completion(),
            manpage(),
            skills(Vec::new()).plugin(),
            color(),
            verbose(),
            background(),
            interaction().env(["NOTES_INPUT"]).plugin(),
            loom_theme(ThemeMapping::default()),
            config.plugin,
            dotenv().plugin(),
            logging(),
            self_update().plugin(),
            service("com.acme.notes", ["serve"]),
        ))
        .description("Keep notes in sync.")
        .version("1.0.0")
        .command(
            Command::new("serve")
                .description("Keep the notes in sync until stopped.")
                .action(|context: Context| async move { context.out.print("serving").await }),
        )
}

loomcli_testing::assert_assembles(&notes());
```

That application needs the features `background`, `color`, `completion`, `config`, `dotenv`, `format`, `help`, `interaction`, `logging`, `manifest`, `manpage`, `mcp`, `self-update`, `service`, `skills`, `suggestions`, `theme`, `verbose`, and `version`. A plugin with settings returns a settings builder (`Help`, `Format`, `Version`, `Manifest`) that converts into a plugin in the list. `.plugin()` converts it explicitly. A root with an action may declare arguments beside the Commands its plugins attach.

A plugin that defines extensions keeps their descriptors in its `extension` module behind a feature of its own (`help-extension`, `manifest-extension`, `mcp-extension`, `config-extension`), and a plugin that declares views keeps them in its `views` module (`help-views`, `version-views`, `format-views`). A crate that supplies values to a plugin's extensions, such as a plugin crate that adds help sections, turns on the extension feature alone, and the application that installs the plugin turns on the plugin.

## Help and version

### Help

Feature `help`; `help()`, with `.command(true)` and `.paging(true)`.

- **Operator:** `-h` prints the compact page of the routed Command and `--help` the extended one, then exits 0, even when the other inputs are missing or invalid. With `.command(true)`, `app help <command>` prints the extended page. With `.paging(true)`, a page that outgrows the terminal goes to the operator's pager. Every usage failure of a run from the command line ends with `Run "<app> <path> --help" to see the usage.`
- **Agent:** the hook restates each Command's details and examples under the manifest's collecting extension, so `--manifest` carries them.
- **Author:** `HELP_COMMAND` carries a Command's details (a Markdown subset), examples, section, and the order of its option and Command sections; `HELP_INPUT` and `HELP_ARGUMENT` carry an input's section and placeholder. `help::views::help_page` is the declared view to override when restyling the page. The [jsonkit application](../../examples/jsonkit/src/application.rs) uses each of these.

### Version

Feature `version`; `version()`, with `.postfix(text)`.

- **Operator:** `-V` and `--version` print `<app> v<version>` and the postfix, then exit 0.
- **Author:** Set `.extended(true)` to include the channel, build, asset, installation method, runtime, and platform. See [extended version facts](../design/core-api.md#extended-version-facts).

## Output

### Formatter

Feature `format`; `format()`, with `.short(letter)`.

- **Operator:** `--format <view>` on every Command that declares a result selects one of its views, such as `table` or `records`.
  Use `--fields` to select top-level keys in a formatter-provided JSON view, or use the hidden `--format` on a group root to select JSON or JSON Lines for failures. See [formatter options](../design/core-api.md#formatter-options).
- **Agent:** every result gains `json` (one JSON document) and `jsonl` (one JSON document per line) views with their media types, `application/json` and `application/jsonl`. Under either one, a failure is written to stderr as one line, `{"error":{"code":…,"exitCode":…,"message":…,"hints":[…]}}`, so a machine reads the outcome from the same stream it asked for.
- **Author:** `format::views::json::<D>()` and `format::views::jsonl::<D>()` are the views themselves, and `json_mapped(map)` and `jsonl_mapped(map)` reshape the data first. A Command lists one of them among its own views to choose its JSON shape.
  For a rows result, use `jsonl_rows()` to stream one JSON line per row or `jsonl_rows_mapped()` to reshape each row before writing it. See [formatter views](../design/core-api.md#formatter-views).

### Pack views

Features `table`, `records`, `list`, `heading`, `rule`, `prose`, `step`, and `box`. Each is a view value that installs nothing: `table(TableConfig)`, `records(RecordsConfig)`, `list(ListConfig)`, `heading(HeadingConfig)`, `rule()`, `prose()`, `step()`, and `boxed(BoxConfig)` (`box` is a Rust keyword). A result lists them among its views, or an action writes data through one with `out.render`. Each fits the destination: the table shrinks and wraps its columns to the terminal's width and falls back to records when even the narrowest columns do not fit, and every one prints plain text in a pipe. A semantic message can use a text view through `Message::new(text).view(&step())`. The output method still sets the destination and verbosity.

### Theme

Feature `theme`; `loom_theme(overrides)` installs the named Loom theme, and `theme(mapping)` a theme of the application's own. Either claims the one theme slot. Style tokens such as `primary` and `highlight` resolve through the installed theme, on the terminal's light or dark background.

### Color

Feature `color`; `color()`.

- **Operator:** `--color` and `--no-color` turn color on or off for one run, overriding `NO_COLOR`.

### Verbose

Feature `verbose`; `verbose()`.

- **Operator:** `-v` shows `debug` lines and `-vv` `trace` lines; `-q` hides `info` and `success` lines. Warnings, errors, and the result always print.

### Background

Feature `background`; `background()`.

- **Operator:** `--background dark` or `--background light` states the terminal's background, so the theme picks its colors without asking the terminal.

## Inputs

### Interaction

Feature `interaction`; `interaction()`, with `.env(variables)`.

- **Operator and agent:** `--no-input` turns questions off for one run: a question linked to an input answers from it or fails with the input's missing-input error, exit 2. `.env(["NOTES_INPUT"])` binds a variable, so `NOTES_INPUT=false` does the same for every run. A run asks only when stdin and stderr are both terminals and `CI` is unset, empty, or `false`, so a pipe, CI, and every MCP tool call ask nothing without the option.

### Configuration

Feature `config`; `configuration::<T>(ConfigurationSettings)` returns the plugin and a provider of the parsed file.

- **Operator:** the run reads one configuration file, in JSON with comments, TOML, or YAML: the one `--config <file>` names, else the one a variable names, else the first match of the file pattern from the working directory up to the project's root marker, then in the home and XDG folders. `--no-config` reads none. A value the type rejects is dropped with one `-v` line, and a broken file the operator named fails the run with exit 2.
- **Author:** an option links to a key with `CONFIG_INPUT.value(ConfigInputFacts::path("minBytes"))`, so the file fills it below the command line and the environment. A Command that needs the whole file opts in to `config.provider` with `uses` and reads it with `context.provided(&config.provider)`. [textstat](../../examples/textstat/src/application.rs) links two options to its `.textstat.{toml,json}` file.
- **Agent:** the manifest publishes the file's JSON Schema, which `ConfigurationSettings::new(schema)` supplies.

### Dotenv

Feature `dotenv`; `dotenv()`, with `.only(names)` or `.except(names)`, then `.plugin()`.

- **Operator:** before the inputs validate, the run imports variables the process has not set from `.env.<mode>.local`, `.env.local`, `.env.<mode>`, and `.env` in the working directory, the mode being `NODE_ENV`. A variable the environment holds always wins.

### Suggestions

Feature `suggestions`; `suggestions()`.

- **Operator:** an unknown Command or option suggests the closest declared name in place of core's sentence:

  ```text
  $ jsonkit kyes -f doc.json
  jsonkit: Unknown command "kyes". Did you mean "keys"?
  Run "jsonkit --help" to see the usage.
  ```

## Projections for agents and tools

The [agents guide](agents.md) shows each of these with captured output.

### Manifest

Feature `manifest`; `manifest()`, with `.short(letter)`.

- **Agent:** `--manifest` prints the routed Command's machine-readable description as JSON: the application, the exit codes and their meanings, the encodings, the global options, the configuration schema, and the Command with its result, failures, details, examples, arguments, options, and children, each input with its JSON Schema.
- **Author:** `MANIFEST_COMMAND` is a collecting extension: the author, and other plugins such as help, add details, examples, and the failures a Command declares. `DeclaredFailure::of::<F>(meaning)` lists a failure class with its code and exit code.

### MCP

Feature `mcp`; `mcp()`.

- **Agent:** `app mcp` serves every Command that carries an `MCP_COMMAND` value as a tool of a Model Context Protocol server over stdin and stdout. Each tool call runs the Command through `invoke`, and its result answers as text; the output of a JSON view also answers as structured content when it is an object, or always under the per-request revision; and a failure answers with its failure form and exit code. The server speaks the per-request revision `2026-07-28` and the handshake revisions `2025-11-25` and `2025-06-18`.
- **Operator:** `app mcp install` registers the server with Claude Code and Codex through each agent's own CLI and records it in the installation record, `app mcp uninstall` removes the registration, and `app mcp config` prints a client configuration.
- **Author:** `McpCommandFacts` sets a tool's annotations and description, `MCP_INPUT` and `MCP_ARGUMENT` describe or exclude one input, and an `on_graph_built` check rejects a graph whose tools cannot be served.

### Completion

Feature `completion`; `completion()`.

- **Operator:** `app completion bash`, `zsh`, `fish`, and `powershell` print a completion script; `app completion install` installs the script for the login shell and adds its startup line, and `update` and `uninstall` keep it current or remove it.
- **How it works:** the scripts are Cobra's, ported. Each completion asks the application itself through the hidden `completion __complete -- <words>`, which reads the partial command line with the parser's own grammar, so a candidate never disagrees with the parser.

### Man pages

Feature `manpage`; `manpage()`.

- **Operator:** `app manpage generate --out <folder>` writes one roff page per Command an operator can find; `app manpage install` writes them to `~/.local/share/man/man1` and records them, and `update` and `uninstall` keep them current or remove them. A page reads the graph and the help facts, so one graph gives the same bytes on every host.

### Skills

Feature `skills`; `skills(list)`, with `.folder(path)` and `.embedded_folder(list)`, then `.plugin()`.

- **Agent:** `app skills install` writes the application's agent skills to the Claude folder and the shared agents folder, and `--project` to the repository root; `update` and `uninstall` keep them current or remove them. A skill's files are embedded in the binary with `SkillFile::embedded(path, include_bytes!(…))`.
  `app skills status` reports whether each skill is installed and up to date, and `--project` checks the repository's skills.
- **Author:** Use `Skills::select_commands` to choose which Command references a skill includes, or call `skills::command_references` to generate the Markdown from a built graph. See [skill Command references](../design/core-api.md#skills).

## Lifecycle

### Logging

Feature `logging`; `logging()`, with `.level(level)`, `.target(LogTarget::Stderr)`, `.file(name)`, `.max_bytes(n)`, `.keep(n)`, and `.on_error(hook)`.

- **Operator:** each log event of the run, `info` and above by default, is appended as one JSON line to `<app>.jsonl` in the platform's log directory, rotated past 10,000,000 bytes with 5 copies kept, or written to stderr. The line holds the time, level, message, fields, application, run id, routed path, plugin, failure, and defect.

### Self-update

Feature `self-update`; `self_update()`, with `.after_replace(hook)`, `.notices(on)`, `.notice_env(variable)`, and `.transport(transport)`, then `.plugin()`. The [shipping guide](shipping.md#self-update) describes it.

### Service

Feature `service`; `service(label, run)`, with `.probe(probe)`. The [shipping guide](shipping.md#the-service-plugin) describes it.
