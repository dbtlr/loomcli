---
description: How an author declares a Loom application in Rust. Commands, arguments and options through the derive and through the builder, validators, results and views, failures, providers, and testing with loomcli-testing.
---

# Declaring an application

An application is one value: an `Application` with its Commands, each Command's inputs and result, and the plugins it installs. Core builds the command graph from that value, parses each invocation against it, validates the inputs, runs the action, and renders what the action produces. This guide walks through each part of a declaration. Every example on this page compiles and runs as a doctest of the `docs-check` package.

The [core API design](../design/core-api.md) states each rule this page touches and where it is enforced, and the rustdoc of `loomcli-core` holds every signature.

## Applications and Commands

`Application::new(name)` starts a declaration and `Command::new(name)` starts a Command. Each call consumes the value and returns the next one, and the builder types are `#[must_use]`, so a dropped declaration is a compiler warning. A Command with an action may declare arguments and attach children in either order. An exact child name or alias routes to that child. A Command that declares arguments handles other plain words itself. A group has children and requires the operator to name one.

```rust
use loomcli_core::{Application, Command, Context, GroupApplication, GroupCommand, Outcome};

async fn add(context: Context) -> Outcome {
    context.out.success("Added the note.").await
}

async fn list(context: Context) -> Outcome {
    context.out.print("Buy milk").await
}

/// A group: `notes tag add`.
fn tag() -> GroupCommand {
    Command::new("tag")
        .description("Manage tags.")
        .command(Command::new("add").description("Add a tag.").action(add))
}

fn notes() -> GroupApplication {
    Application::new("notes")
        .description("Keep notes.")
        .version("1.0.0")
        .command(Command::new("add").description("Add a note.").action(add))
        .command(
            Command::new("list")
                .description("List the notes.")
                .alias("ls")
                .action(list),
        )
        .command(
            Command::new("show")
                .description("Show the notes.")
                .deprecated("Use list instead.")
                .action(list),
        )
        .command(tag())
}

loomcli_testing::assert_assembles(&notes());
```

- `alias(name)` adds another name the operator may type; help lists the Command under its own name.
- `hidden()` keeps a Command off help and completion while it still runs.
- `deprecated(message)` keeps a Command working and prints the message wherever it is listed.
- Core sets no depth limit. jsonkit's `stats depth max` routes three levels below the root.

`GroupApplication` and `GroupCommand` name a declaration that has children and no action. One that ends in `action()` is `Application<I, R>` or `Command<I, R>`, where `I` is its inputs type and `R` its result.

### Running

`main()` builds a current-thread tokio runtime, runs the application on the real process, and returns the exit code:

```rust,no_run
use loomcli_core::{Application, Context};

fn main() -> std::process::ExitCode {
    Application::new("hello")
        .description("Say hello.")
        .action(|context: Context| async move { context.out.print("Hello.").await })
        .main()
}
```

An application that runs its own runtime awaits `main_async()` instead. Calling `main()` on a thread that already drives a tokio runtime panics with a diagnostic that names `main_async`.

```rust,no_run
use loomcli_core::{Application, Context};

#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    Application::new("hello")
        .description("Say hello.")
        .action(|context: Context| async move { context.out.print("Hello.").await })
        .main_async()
        .await
}
```

Both entry points call the process's exit listeners after the run, so a process-scoped `on_shutdown` handler runs at a normal end. `run(RunOptions)` runs once on a process handle you choose and calls none; tests use it with a mock process (see [Testing](#testing)).

### Actions

An action is an `async fn` or a closure that takes `Context<I, R>` and returns `Outcome`, which is `Result<(), Error>`. The context carries the typed inputs (`context.inputs`), the output (`context.out`), the captured host facts (`context.host`), the run's cancellation signal (`context.signal`), the log (`context.log`), the style (`context.style`), the command graph and the routed Command, and `context.invoke(...)` to run another Command by name.

A handler and its future are `Send + 'static`. A closure that captures state clones it into the future it returns:

```rust
use std::sync::Arc;

use loomcli_core::{Command, Context};

let banner: Arc<str> = Arc::from("notes 1.0");
let about = Command::new("about")
    .description("Print the banner.")
    .action(move |context: Context| {
        let banner = Arc::clone(&banner);
        async move { context.out.print(&banner).await }
    });
```

## Passthrough and terminal need

A bare `--` ends routing and option parsing. The words after it fill positional arguments. To forward those words unchanged through `ctx.passthrough`, declare `.passthrough(Passthrough::new())` on the Command and add `.description(text)` to describe the forwarded words in help.

An action that needs stdin and stderr at a terminal outside CI declares `.needs_terminal()`. The Command’s help remains available on a pipe. Invoking the action by name fails with `TerminalUnavailableError`.

## Inputs through the derive

`#[derive(Inputs)]` on a struct declares a Command's arguments and local options, and `inputs::<I>()` applies the declaration. Each field carries `#[argument(...)]`, `#[option(...)]`, `#[stdin(...)]`, or `#[passthrough(...)]`. Its doc comment provides the default description. A `#[passthrough]` field is a `Vec<String>` of the words after the first bare `--`. The field type decides the kind of input and whether it is required.

| Field type | Input |
| --- | --- |
| `bool` | A Boolean option. Never required. |
| `u8` through `usize` with `count` | A counted option, such as `-vvv`. |
| `String` | A string input, required unless it has a `default`. |
| `T` with `validate = v` | A string input whose token `v` validates into `T`, its output type. |
| `Option<T>` | An optional input. |
| `Vec<T>` | A multiple option or a variadic argument; `required` asks for at least one value. |
| `Content`, `Option<Content>`, `Vec<Content>` | A content input: a file path, or `-` and piped text with `stdin`. |

```rust
use loomcli_core::{Command, Context, Inputs, Outcome};
use loomcli_validators::{one_of, port, text};

/// What `serve` reads.
#[derive(Inputs)]
#[inputs(exclusive("json", "plain"))]
struct ServeInputs {
    /// The folder to serve.
    #[argument]
    root: String,
    /// The port to listen on.
    #[option(short = 'p', default = "8080", env = "NOTES_PORT", validate = port())]
    port: u16,
    /// A host name to answer to. Repeat it for several.
    #[option(name = "host", validate = text())]
    hosts: Vec<String>,
    /// The color theme.
    #[option(validate = one_of(["light", "dark"]))]
    theme: Option<String>,
    /// Print each request as JSON.
    #[option]
    json: bool,
    /// Print each request as plain text.
    #[option]
    plain: bool,
}

async fn serve(context: Context<ServeInputs>) -> Outcome {
    let ServeInputs { root, port, hosts, .. } = &context.inputs;
    context
        .out
        .print(&format!("Serving {root} on {port} for {} hosts.", hosts.len()))
        .await
}

let command = Command::new("serve")
    .description("Serve a folder.")
    .inputs::<ServeInputs>()
    .action(serve);
```

- An option's name is the field name with `_` as `-`, or `name = "…"`. Its long spelling is `--<name>`; `short = 'p'` adds `-p`, and `aliases = ["…"]` adds long spellings no listing shows.
- `default` and `implied` take raw strings, which the validator judges when the run starts, so a default the validator rejects is reported at once.
- `env = "NOTES_PORT"` binds an environment variable. The precedence is a token, then the environment, then the configuration file (when the [configuration plugin](plugins.md#configuration) links the option), then the default.
- `#[inputs(exclusive(...), one_required(...), required_together(...))]` declares option groups by their declared names.
- `hidden`, `deprecated = "…"`, and `control` mark an option, and `non_interactive` on an `Option` or `Vec` field makes an input required only when the run cannot ask a question.

The derive rejects at compile time what it can read from one field, such as `required` on a non-`Option` field or a short spelling that is not an ASCII letter. Rules that read several declarations, such as a spelling used twice, are faults at the `inputs::<I>()` call: the call panics at your line with a Developer Diagnostic that names the rule and the fix. The full attribute grammar is the rustdoc of `loomcli_core::Inputs` (the derive).

### Content and stdin

A content input reads a file, or piped text when the operator types `-` or omits it and `stdin` is set. Core checks that each source exists and is readable before the action runs, and the action reads it through `text()` or `bytes()`:

```rust
use loomcli_core::{Command, Content, Context, Inputs, Outcome};

/// What `count` reads.
#[derive(Inputs)]
struct CountInputs {
    /// The files to count. Use - for piped text.
    #[argument(stdin, required)]
    files: Vec<Content>,
}

async fn count(context: Context<CountInputs>) -> Outcome {
    for file in &context.inputs.files {
        let text = file.text().await?;
        context
            .out
            .print(&format!("{} {}", text.lines().count(), file.name))
            .await?;
    }
    Ok(())
}

let command = Command::new("count")
    .description("Count lines.")
    .inputs::<CountInputs>()
    .action(count);
```

## Inputs through the builder

The derive expands to builder calls, and the builder is available directly. `Arg::string()` and `Arg::content()` declare arguments; `Opt::string()`, `Opt::boolean()`, `Opt::count()`, and `Opt::content()` declare options. Each builder offers only the setters its kind takes. The action reads an input by name with `context.argument::<T>(name)` and `context.option::<T>(name)`. `T` is `Option<V>` for one value, `Vec<V>` for several, `bool` for a Boolean option, and an unsigned integer for a counted option, where `V` is `String` for an input with no validator and the validator's output type for one with a validator:

```rust
use loomcli_core::{Application, Arg, Command, Context, Opt, RunOptions};
use loomcli_testing::{MockFields, mock_process};
use loomcli_validators::port;

fn serve() -> Command {
    Command::new("serve")
        .description("Serve a folder.")
        .argument("root", Arg::string().description("The folder to serve.").required())
        .option(
            "port",
            Opt::string()
                .description("The port to listen on.")
                .short('p')
                .default("8080")
                .validate(port()),
        )
        .option("json", Opt::boolean().description("Print each request as JSON."))
        .action(|context: Context| async move {
            // Validation ran first, so a required input and an input with a default hold a value.
            let root = context.argument::<Option<String>>("root")?.unwrap_or_default();
            let port = context.option::<Option<u16>>("port")?.unwrap_or(8080);
            let json = context.option::<bool>("json")?;
            context
                .out
                .print(&format!("Serving {root} on {port}, JSON {json}."))
                .await
        })
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let files = Application::new("files").description("Serve files.").command(serve());
    let process = mock_process(MockFields::new().argv(["serve", "site", "-p", "9000"]));
    files.run(RunOptions::new().process(process.clone())).await;
    assert_eq!(process.stdout_text(), "Serving site on 9000, JSON false.\n");
}
```

A read by a name the Command does not declare, or as a type the declaration does not produce, returns the `@loomcli/core/input-read` fault. The derive proves both at compile time, which is why it is the main path; the builder is what a plugin uses for options it declares on Commands it has never seen.

### Global options

A global option belongs to the Application and is accepted before, between, or after Command names. Declare a struct of them with `globals::<G>()` and read it back anywhere with `context.globals::<G>()`. A global option declares no presence rule, so its fields are `bool`, counts, `Option<T>`, or `Vec<T>`:

```rust
use loomcli_core::{Application, Command, Context, GroupApplication, Inputs};

/// The options every Command reads.
#[derive(Inputs)]
struct Globals {
    /// The profile to read settings from.
    #[option(env = "NOTES_PROFILE")]
    profile: Option<String>,
}

fn notes() -> GroupApplication {
    Application::new("notes")
        .description("Keep notes.")
        .globals::<Globals>()
        .command(
            Command::new("list")
                .description("List the notes.")
                .action(|context: Context| async move {
                    let Globals { profile } = context.globals::<Globals>()?;
                    let profile = profile.unwrap_or_else(|| "default".to_owned());
                    context.out.print(&format!("Profile {profile}.")).await
                }),
        )
}

loomcli_testing::assert_assembles(&notes());
```

## Validators

A validator judges one token and returns a typed value or the issues that reject it. It also publishes the JSON Schema of the tokens it accepts, which help, the manifest, and MCP tool schemas read. `loomcli-validators` holds the catalog: `text`, `integer`, `number`, `port`, `one_of`, `url`, `uuid`, `date`, `date_time`, `time`, `duration`, `path`, `bytes`, `host`, `ip`, `cidr`, `key_value`, and `email`. Each is a factory with setters, such as `integer().min(1)`, `text().max_length(40)`, or `duration().min("30s")`; a setting that can never work panics at the call with a Developer Diagnostic.

`pipe` follows a validator with a step that receives its output, and `create_validator` builds one from a parse function. An issue's message says what was expected and never repeats the token, which may be a secret:

```rust
use loomcli_core::{Issue, Opt, ValidationContext};
use loomcli_validators::{create_validator, integer, pipe};
use serde_json::json;

// An integer, then a rule of the application's own.
let even = pipe(integer().min(0), |number: i64, _: &ValidationContext| {
    if number % 2 == 0 {
        Ok(number)
    } else {
        Err(vec![Issue::new("Expected an even number.")])
    }
});

// A parse function, with the schema it publishes.
let schema = json!({ "type": "string", "pattern": "^[a-z]+(-[a-z]+)*$" });
let slug = create_validator(|token: &str, _: &ValidationContext| {
    let valid = !token.is_empty()
        && token.split('-').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_lowercase()));
    if valid {
        Ok(token.to_owned())
    } else {
        Err(vec![Issue::new("Expected lowercase words joined by hyphens.")])
    }
})
.input_schema(schema.as_object().cloned().unwrap_or_default());

let width = Opt::string().description("The width, an even number.").validate(even);
let name = Opt::string().description("The note's slug.").validate(slug);
```

A type of your own implements `loomcli_core::Validator`: `validate(&self, token, context)` returns `Result<Self::Output, Vec<Issue>>`, and `input_schema()` returns the schema or `None`. Validators are synchronous.

## Output, results, and views

`context.out` writes everything an action shows. Each write is `async` and writes when it is awaited.

| Method | Writes to | Shown |
| --- | --- | --- |
| `print(text)` | stdout | always |
| `info`, `success` | stderr, with a glyph | unless the run is quiet (`-q`) |
| `warn`, `error` | stderr, with a glyph | always |
| `debug`, `trace` | stderr | from `-v` and `-vv` |
| `render(data, &view)` | stdout | always |
| `results(value)` | stdout, through the result's views | once per run |

Text an author writes may carry style markup from `context.style`, such as `context.style.bold().apply("Ready")`. Core resolves it for the destination: color on a terminal that takes it, plain text in a pipe or under `NO_COLOR`. Escape text that came from outside the program with `context.style.escape(text)`, so a stray markup character prints as written.

### Results

A Command that produces data declares a result and emits it once with `out.results(...)`. The result's views decide how it prints, and plugins read the declaration: the format plugin adds `json` and `jsonl` views to every result, the manifest publishes the views and their media types, and MCP answers a tool call through the JSON view. While a Command declares a result, its `print` and `render` calls go to stderr, so stdout carries the result alone.

A value result is one value with views over it:

```rust
use loomcli_core::{Command, Context, NoInputs, Outcome, ResultViews, ValueResult, View};
use serde::Serialize;

/// What `stats` reports.
#[derive(Serialize)]
struct Stats {
    notes: usize,
    tags: usize,
}

async fn stats(context: Context<NoInputs, ValueResult<Stats>>) -> Outcome {
    context.out.results(Stats { notes: 3, tags: 1 }).await
}

fn stats_command() -> Command<NoInputs, ValueResult<Stats>> {
    Command::new("stats")
        .description("Count the notes and tags.")
        .result(ResultViews::new().view(
            "text",
            View::new(|stats: &Stats, _| format!("{} notes, {} tags\n", stats.notes, stats.tags)),
        ))
        .action(stats)
}
```

A rows result is a sequence of rows, emitted from a `Vec`, any iterator, or a `Stream` through `RowSource`. Its views are whole views over every row, such as `table`, or row views that print each row as it arrives, such as `records`:

```rust
use loomcli_core::{Command, Context, NoInputs, Outcome, RowViews, RowsResult};
use loomcli_plugins::records::{RecordsConfig, records};
use loomcli_plugins::table::{Alignment, Column, TableConfig, table};
use serde::Serialize;

/// One note.
#[derive(Serialize)]
struct Note {
    id: u32,
    title: String,
}

async fn list(context: Context<NoInputs, RowsResult<Note>>) -> Outcome {
    let notes = vec![
        Note { id: 1, title: "Buy milk".to_owned() },
        Note { id: 2, title: "Call Ada".to_owned() },
    ];
    context.out.results(notes).await
}

fn list_command() -> Command<NoInputs, RowsResult<Note>> {
    Command::new("list")
        .description("List the notes.")
        .rows(
            RowViews::new()
                .view(
                    "table",
                    table(TableConfig::new().columns(vec![
                        Column::new("id").header("ID").align(Alignment::Right),
                        Column::new("title").header("TITLE"),
                    ])),
                )
                .view("records", records(RecordsConfig::new("id"))),
        )
        .action(list)
}
```

The first view is the default unless `default_view(name)` names another. A Command that declares a result and returns without emitting it fails with `ResultError`.

### Rendering views

`out.render(data, &view)` writes data through a view outside a result. The pack views in `loomcli-plugins` (`table`, `records`, `list`, `heading`, `rule`, `prose`, and `boxed`) each sit behind a feature of their own and install nothing:

```rust
use loomcli_core::{Command, Context};
use loomcli_plugins::heading::{HeadingConfig, heading};
use loomcli_plugins::list::{ListConfig, list};

let report = Command::new("report")
    .description("Print a report.")
    .action(|context: Context| async move {
        context.out.render("Checks", &heading(HeadingConfig::new())).await?;
        let lines = vec!["Disk: ok".to_owned(), "Network: ok".to_owned()];
        context.out.render(&lines, &list(ListConfig::<String>::new())).await
    });
```

A view is `View::new(|data, context| text)`: the function returns the text, or a `Result` whose `Err` fails the run like any other failure. `ViewContext` gives the destination's `columns`, `width`, `wrap`, and `style`. `view(identity, definition)` declares a view under an identity such as `@acme/notes/summary`, and an application or a plugin replaces a declared view with `override_view(key, replacement)` in `Application::overrides` or `Plugin::views`. Every byte core and the first-party plugins write passes through such a view, so an application can restyle a help page, a lane, or a failure without forking a plugin.

## Failures

An action fails by returning an `Err`. Core renders the failure on stderr, with any hints the installed plugins add, and exits with the failure's code. Usage failures exit 2, and expected failures of the action exit 1 unless their class says otherwise.

`out.fatal(message)` makes a `FatalError`, the ordinary expected failure:

```rust
use loomcli_core::{Command, Context};

let remove = Command::new("remove")
    .description("Remove a note.")
    .action(|context: Context| async move {
        Err(context.out.fatal("No note is selected. Run notes list to pick one."))
    });
```

A failure the application names is a class: a struct with `#[derive(Failure)]` that holds its parent class in a `#[failure(base)]` field and declares a kebab-case failure code and, optionally, an exit code. Machine readers branch on the code, the manifest lists it, and the class is the key a failure view overrides:

```rust
use loomcli_core::{EX_DATAERR, Failure, FatalError};

/// A note the store does not hold.
#[derive(Debug, Failure)]
#[failure(code = "note-not-found", exit_code = EX_DATAERR)]
pub struct NoteNotFoundError {
    #[failure(base)]
    base: FatalError,
}

impl NoteNotFoundError {
    /// The failure for one note id.
    pub fn new(id: u32) -> Self {
        Self {
            base: FatalError::new(format!("Note {id} does not exist. Run notes list to see the ids.")),
        }
    }
}

fn find(id: u32) -> Result<String, NoteNotFoundError> {
    Err(NoteNotFoundError::new(id))
}

let error: loomcli_core::Error = find(7).unwrap_err().into();
assert!(error.downcast_failure::<NoteNotFoundError>().is_some());
```

An error that is not a failure, such as an `std::io::Error` returned with `?`, is a defect: a distributed build prints `<app>: Something went wrong.` and exits 1, and a development build prints a Developer Diagnostic with the error chain. A translator turns a foreign error type into a failure wherever it is raised, so the action can use `?` freely:

```rust
use loomcli_core::{Application, Context, EX_DATAERR, Failure, FatalError, translate};

/// A document that is not valid JSON.
#[derive(Debug, Failure)]
#[failure(code = "invalid-json", exit_code = EX_DATAERR)]
struct InvalidJsonError {
    #[failure(base)]
    base: FatalError,
}

let app = Application::new("jq-lite")
    .description("Read JSON.")
    .translators([translate(|error: serde_json::Error| {
        Ok(InvalidJsonError {
            base: FatalError::with_cause("The document is not valid JSON.", error),
        })
    })])
    .action(|context: Context| async move {
        let value: serde_json::Value = serde_json::from_str("{")?;
        context.out.print(&value.to_string()).await
    });
```

`override_view(failure::<F>(), FailureView::new(...))` in `Application::overrides` replaces how a class renders. jsonkit and textstat print a `FatalError` without the application-name prefix this way.

## Providers

A provider builds a value an action uses, such as a database connection or a client, once per run, and closes it after the action. A Command opts in with `uses`, and the action reads the value with `context.provided(&provider)`. An ephemeral provider builds per run; a persistent one, from `Provider::persistent`, builds once for the outermost run and every Command it invokes by name. Share a provider through a factory function: two calls of one function name one provider.

```rust
use std::path::PathBuf;
use std::sync::Arc;

use loomcli_core::{Command, Context, Provider, ProviderContext};

/// Where the notes live.
struct Store {
    folder: PathBuf,
}

fn store() -> Provider<Store> {
    Provider::new("store", |context: ProviderContext| async move {
        Ok(Store {
            folder: context.host.home.join(".notes"),
        })
    })
    .close(|_: Arc<Store>| async { Ok(()) })
}

let list = Command::new("list")
    .description("List the notes.")
    .uses([&store()])
    .action(|context: Context| async move {
        let store = context.provided(&store())?;
        context.out.print(&store.folder.display().to_string()).await
    });
```

An opener reads settings from global options through `context.globals::<G>()` rather than capturing them. A test substitutes an opener with `RunOptions::substitute(&provider, opener)`.

## Testing

`loomcli-testing` runs an application through its public surface on a mock process and reads back the exact bytes. The mock reads nothing from the real environment, terminal, clock, or home folder: its working directory is `/loom-test`, its home `/loom-test/home`, and every stream is a pipe unless the test puts it on a `MockTerminal`.

- `assert_assembles(&app)` builds the graph with every development check and panics with each fault's diagnostic. Keep one such test in every application; `cargo loom init` writes it, and that toolchain is not in this tree.
- `assert_described(&app)` panics naming each Command, option, argument, and stdin with no description, which help, agents, MCP tools, and the manifest all read.
- `mock_process(MockFields::new().argv([...]))` is a process handle with argv, env, cwd, stdin, and terminal facts you state. `run(RunOptions::new().process(handle))` runs on it, and `stdout_text()`, `stderr_text()`, and the returned exit code are what to assert.
- `action_context`, `middleware_context`, `failure_hook_context`, `provider_context`, and `view_context` build the context one function receives, with no Application and no run.

In a test file each body below sits in a `#[tokio::test]` function:

```rust
use loomcli_core::{
    Application, Command, Context, GroupApplication, Inputs, NoResult, Outcome, RunOptions,
};
use loomcli_testing::{
    ActionValues, MockFields, action_context, assert_assembles, assert_described, mock_process,
};

/// What `greet` reads.
#[derive(Inputs)]
struct GreetInputs {
    /// The name to greet.
    #[argument]
    name: String,
}

async fn greet(context: Context<GreetInputs>) -> Outcome {
    context.out.print(&format!("Hello, {}.", context.inputs.name)).await
}

fn hello() -> GroupApplication {
    Application::new("hello").description("Greet people.").command(
        Command::new("greet")
            .description("Greet one person.")
            .inputs::<GreetInputs>()
            .action(greet),
    )
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    // The declaration assembles, and every declaration has a description.
    assert_assembles(&hello());
    assert_described(&hello());

    // A run on the mock process: exact stdout, stderr, and exit code.
    let process = mock_process(MockFields::new().argv(["greet", "Ada"]));
    let code = hello()
        .run(RunOptions::new().process(process.clone()))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(process.stdout_text(), "Hello, Ada.\n");
    assert_eq!(process.stderr_text(), "");

    // A usage failure.
    let process = mock_process(MockFields::new().argv(["greet"]));
    let code = hello()
        .run(RunOptions::new().process(process.clone()))
        .await;
    assert_eq!(code.get(), 2);
    assert_eq!(
        process.stderr_text(),
        "hello: Argument \"name\" requires a value. Supply a value for \"name\".\n"
    );

    // The action alone, with a built context.
    let process = mock_process(MockFields::new());
    let context = action_context::<GreetInputs, NoResult>(
        ActionValues::new(GreetInputs { name: "Grace".to_owned() })
            .process(process.clone()),
    );
    greet(context).await.unwrap();
    assert_eq!(process.stdout_text(), "Hello, Grace.\n");
}
```

The examples' own tests show more: [examples/textstat/tests](../../examples/textstat/tests) runs textstat in a folder of files with variables and piped stdin, and [examples/explain/tests](../../examples/explain/tests) tests a plugin on an application of its own.
