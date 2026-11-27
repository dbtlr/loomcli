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
use loomcli_plugins::config::toml::TOML;
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
            .formats(&[TOML])
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

That application needs the features `background`, `color`, `completion`, `config-toml`, `dotenv`, `format`, `help`, `interaction`, `logging`, `manifest`, `manpage`, `mcp`, `self-update`, `service`, `skills`, `suggestions`, `theme`, `verbose`, and `version`. A plugin with settings returns a settings builder (`Help`, `Format`, `Version`, `Manifest`, `Mcp`) that converts into a plugin in the list. `.plugin()` converts it explicitly. A root with an action may declare arguments beside the Commands its plugins attach.

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

- **Operator:** `-v` shows log events from `debug` through `error`. `-vv` adds `trace` events. `-q` hides `out.info` and `out.success` messages. `out.warn`, `out.error`, and the result always print.

### Background

Feature `background`; `background()`.

- **Operator:** `--background dark` or `--background light` states the terminal's background, so the theme picks its colors without asking the terminal.

### Plain

Feature `plain`; `plain()`.

- **Operator:** `--plain` turns off every redraw: progress prints plain start and end lines, and questions ask line by line. A nonempty `ACCESSIBLE` variable does the same, and core reads it even when the application leaves this plugin out.

## Inputs

### Interaction

Feature `interaction`; `interaction()`, with `.env(variables)`.

- **Operator and agent:** `--no-input` turns questions off for one run: a question linked to an input answers from it or fails with the input's missing-input error, exit 2. `.env(["NOTES_INPUT"])` binds a variable, so `NOTES_INPUT=false` does the same for every run. A run asks only when stdin and stderr are both terminals and `CI` is unset, empty, or `false`, so a pipe, CI, and every MCP tool call ask nothing without the option.

### Configuration

Feature `config`; `configuration::<T>(ConfigurationSettings)` returns the plugin and a provider of the parsed file.

- **Operator:** the run reads one configuration file in JSON with comments or in a format the application opted in to with a reader: the one `--config <file>` names, else the one a variable names, else the first match of the file pattern from the working directory up to the project's root marker, then in the home and XDG folders. `--no-config` reads none. A value the type rejects is dropped and reported at `-v` by default. With strict enabled, covered values and unknown keys fail the run with exit code 2, as does an unusable file.
- **Author:** enable `config-toml` or `config-yaml` and pass the corresponding reader in `.formats()` to accept TOML or YAML. An option links to a key with `CONFIG_INPUT.value(ConfigInputFacts::path("minBytes"))`, so the file fills it below the command line and the environment. A Command that needs the whole file opts in to `config.provider` with `uses` and reads it with `context.provided(&config.provider)`. [textstat](../../examples/textstat/src/application.rs) links two options to its `.textstat.{toml,json}` file.
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

### External commands

Enable the `external-commands` feature and install `external_commands()`.

When the first word of argv is an unknown Command, the plugin looks for an executable
named `<app>-<word>` on `PATH`. For example, `notes sync --all` runs `notes-sync` with
`--all` and uses its exit code. On Linux, if an executable script without a shebang fails
to start with `ENOEXEC`, the plugin runs it through `/bin/sh` with the same separate arguments.

```rust
use loomcli_core::{Application, Command, Context};
use loomcli_plugins::external_commands::external_commands;

let notes = Application::new("notes")
    .plugins([external_commands()])
    .command(Command::new("list").action(|_: Context| async { Ok(()) }));

loomcli_testing::assert_assembles(&notes);
```

## Projections for agents and tools

The [agents guide](agents.md) shows each of these with captured output.

### Manifest

Feature `manifest`; `manifest()`, with `.short(letter)`.

- **Agent:** `--manifest` prints the routed Command's machine-readable description as JSON: the application, the exit codes and their meanings, the encodings, the global options, the configuration schema, and the Command with its result, failures, details, examples, arguments, options, and children, each input with its JSON Schema.
- **Author:** `MANIFEST_COMMAND` is a collecting extension: the author, and other plugins such as help, add details, examples, and the failures a Command declares. `DeclaredFailure::of::<F>(meaning)` lists a failure class with its code and exit code.

### MCP

Feature `mcp`; `mcp()`, with `.authorize(hook)`, `.max_body_bytes(limit)`, and `.session_idle(interval)` for the HTTP server.

- **Agent:** `app mcp` serves every Command that carries an `MCP_COMMAND` value as a tool of a Model Context Protocol server over stdin and stdout. Each tool call runs the Command through `invoke`, and its result answers as text; the output of a JSON view also answers as structured content when it is an object, or always under the per-request revision; and a failure answers with its failure form and exit code. The server speaks the per-request revision `2026-07-28` and the handshake revisions `2025-11-25` and `2025-06-18`.
  A client can set the time zone for one tool call by passing an IANA zone name in `params._meta` under `io.github.dbtlr.loomcli/timeZone`. See [MCP tool call time zones](../design/core-api.md#mcp-tool-call-time-zone).
- **Operator:** `app mcp --http <address>` serves the same tools over the protocol's streamable HTTP transport at `/mcp`. The address is a port such as `8080`, which listens on 127.0.0.1, or `host:port`. Port 0 takes any free port. The endpoint URL, such as `http://127.0.0.1:8080/mcp`, is the only line on stdout. A non-loopback bind first warns on stderr. The warning depends on whether the application installed an authorize hook.
  - Without a hook, for `0.0.0.0:8080`, it says “Serving at 0.0.0.0:8080, which other hosts can reach, with no authorize hook, so any host that reaches it can call the tools without credentials. Serve on 127.0.0.1, or put the server behind something that authenticates.”
  - With a hook, for `10.1.2.3:8080`, it says “Serving at 10.1.2.3:8080 over plain HTTP, so requests and their credentials cross the network unencrypted, where anyone on the path can read and replay them. Put TLS in front of the server, such as a reverse proxy that terminates it.”
- **Operator:** `app mcp install` registers the server with Claude Code and Codex through each agent's own CLI and records it in the installation record, `app mcp uninstall` removes the registration, and `app mcp config` prints a client configuration.
- **Author:** `mcp().authorize(|request: McpHttpRequest| async move { … })` judges each HTTP request from its headers. A `true` serves it, a `false` answers 401, and an `Err` answers 500 and is reported once the server stops. The hook compares credentials the author reads from their own sources: a comparison of a secret takes the same time whether or not the values match, and refuses an empty secret, as the example in the rustdoc of `authorize` does. `.max_body_bytes(limit)` sets the largest POST body the server reads, with a default of 4 MiB. `.session_idle(interval)` sets how long a handshake session may sit idle before it ends, with a default of 30 minutes. See [MCP over HTTP](../design/core-api.md#mcp-over-http).
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
  By default, `<APP>_LOG_LEVEL` sets the minimum level for every file and `<APP>_LOG_FILE` changes the first file's path. For `my-tool`, the names are `MY_TOOL_LOG_LEVEL` and `MY_TOOL_LOG_FILE`. When the plugin records a runtime failure and adds a hint, the report includes `Read the log of this run in <path> (run <id>).`
- **Author:** `.destinations(list)` replaces the shorthand with file, console, or OpenTelemetry destinations, each with its own level. `.level_env(binding)` names or disables the variable that overrides file levels. `.file_env(binding)` names or disables the variable that overrides the first file's path. `.failure_hint(mode)` selects which failures point the operator to their log records. See the [logging plugin contract](../design/core-api.md#logging-plugin).

#### Forward records to OpenTelemetry

Pass a logger from your OpenTelemetry provider to the destination closure. Configure the
provider's resource, exporters, and shutdown in your application. This example uses the
no-op logger from `opentelemetry` 0.33 with the `logs` feature. The Rust API's
`AnyValue` has no null variant, so the example leaves out an attribute whose value is null,
such as `loom.plugin` on a core event, and uses the string `"null"` for a null nested in an
array or an object, to keep array positions. Unsigned integers outside the signed 64-bit range
keep their decimal digits as strings.

```rust
use loomcli_core::{Application, Context, LogFields, LogLevel};
use loomcli_plugins::logging::{OpenTelemetryDestination, logging};
use opentelemetry::logs::{AnyValue, LogRecord, Logger, LoggerProvider, NoopLoggerProvider, Severity};
use serde_json::Value;

fn json_attribute(value: Value) -> AnyValue {
	match value {
		Value::Null => AnyValue::from("null"),
		Value::Bool(value) => AnyValue::from(value),
		Value::Number(value) => {
			if let Some(integer) = value.as_i64() {
				AnyValue::from(integer)
			} else if let Some(double) = value.as_f64().filter(|_| value.is_f64()) {
				AnyValue::from(double)
			} else {
				AnyValue::from(value.to_string())
			}
		}
		Value::String(value) => AnyValue::from(value),
		Value::Array(values) => values.into_iter().map(json_attribute).collect(),
		Value::Object(values) => values
			.into_iter()
			.map(|(key, value)| (key, json_attribute(value)))
			.collect(),
	}
}

fn destination(logger: impl Logger + Send + Sync + 'static) -> OpenTelemetryDestination {
	OpenTelemetryDestination::new(move |record| {
		let mut output = logger.create_log_record();
		output.set_timestamp(record.timestamp);
		output.set_severity_text(record.severity_text);
		let severity = match record.severity_number {
			1 => Some(Severity::Trace),
			5 => Some(Severity::Debug),
			9 => Some(Severity::Info),
			13 => Some(Severity::Warn),
			17 => Some(Severity::Error),
			21 => Some(Severity::Fatal),
			_ => None,
		};
		if let Some(severity) = severity {
			output.set_severity_number(severity);
		}
		output.set_body(AnyValue::from(record.body));
		output.add_attributes(
			record
				.attributes
				.into_iter()
				.filter(|(_, value)| !value.is_null())
				.map(|(key, value)| (key, json_attribute(value))),
		);
		logger.emit(output);
	})
}

let provider = NoopLoggerProvider::new();
let logger = provider.logger("notes");
let app = Application::new("notes")
	.plugins((logging().destinations((destination(logger).level(LogLevel::Debug),)),))
	.action(|ctx: Context| async move {
		ctx.log.info("Indexed {count} notes.", LogFields::new().field("count", 3));
		Ok(())
	});
# let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
# let process = loomcli_testing::mock_process(loomcli_testing::MockFields::new());
# let exit = runtime.block_on(async {
#     app.run(loomcli_core::RunOptions::new().process(process)).await
# });
# assert_eq!(exit.get(), 0);
```

### Self-update

Feature `self-update`; `self_update()`, with `.after_replace(hook)`, `.notices(on)`, `.notice_env(variable)`, and `.transport(transport)`, then `.plugin()`. The [shipping guide](shipping.md#self-update) describes it.

### Service

Feature `service`. `service(label, run)` declares a per-user service.

- **Author:** `.environment(callback)` writes the environment values returned by the callback to the unit file only. `.output(path)` puts stdout and stderr on the same file in the unit. `.stop_timeout(milliseconds)` puts the manager's stop timeout in the unit. `.probe(probe)` adds rows to `status`.
- **Operator:** `service status` shows an `output` row when the unit has an output file and one `log` row per file the logging plugin writes. When the logging plugin is installed but writes to no file, and the unit has no output file, one `log` row says where the service manager sends the console output: to journald under systemd, and nowhere under launchd.

See [the service plugin in the shipping guide](shipping.md#the-service-plugin).
