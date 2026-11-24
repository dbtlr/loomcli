//! The `#[derive(Inputs)]` expansion against the builder calls it stands for: each derived struct
//! declares the graph its hand-written builder chain declares, and reads back what a run validated.
//! The `#[derive(Failure)]` expansion against the class facts it states.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Command, Content, Context, EX_DATAERR, Error, Failure, FailureFacts,
    FatalError, Inputs, Issue, NoInputs, Opt, Outcome, Polarity, RunOptions, Stdin,
    ValidationContext, Validator,
};
use loomcli_testing::{MockFields, mock_process};

/// A port: digits from 1 through 65535, read as a `u16`.
#[derive(Clone)]
struct Port;

impl Validator for Port {
    type Output = u16;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<u16, Vec<Issue>> {
        input
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .ok_or_else(|| vec![Issue::new("Expected a port from 1 through 65535.")])
    }
}

/// The derived inputs of every kind the field types declare.
#[derive(Inputs)]
#[inputs(exclusive("json", "plain"))]
struct ServeInputs {
    /// The folder to serve.
    ///
    /// Defaults to the working directory's `public`.
    #[argument(default = "public")]
    root: String,
    /// Extra folders.
    #[argument]
    extra: Vec<String>,
    /// The port to listen on.
    #[option(short = 'p', validate = Port, default = "8080", env = "SERVE_PORT")]
    port: u16,
    /// A host name.
    #[option(name = "bind-host", aliases = ["host"])]
    bind: Option<String>,
    /// Headers to add.
    #[option(short = 'H', env = ["SERVE_HEADERS"], env_delimiter = ",")]
    header: Vec<String>,
    /// Watch for changes.
    #[option(polarity = "both")]
    watch: bool,
    /// Print JSON.
    #[option]
    json: bool,
    /// Print plain text.
    #[option(hidden)]
    plain: bool,
    /// The configuration file.
    #[option(short = 'c', stdin)]
    config: Option<Content>,
    /// How much to say.
    #[option(count, short = 'v')]
    loud: u8,
}

/// The same declarations, written as the builder calls the derive stands for.
fn serve_by_hand() -> Command {
    Command::new("serve")
        .argument(
            "root",
            Arg::string()
                .description("The folder to serve. Defaults to the working directory's `public`.")
                .default("public"),
        )
        .argument(
            "extra",
            Arg::string().description("Extra folders.").variadic(),
        )
        .option(
            "port",
            Opt::string()
                .description("The port to listen on.")
                .short('p')
                .env(["SERVE_PORT"])
                .validate(Port)
                .default("8080"),
        )
        .option(
            "bind-host",
            Opt::string().description("A host name.").aliases(["host"]),
        )
        .option(
            "header",
            Opt::string()
                .description("Headers to add.")
                .short('H')
                .env(["SERVE_HEADERS"])
                .env_delimiter(",")
                .multiple(),
        )
        .option(
            "watch",
            Opt::boolean()
                .description("Watch for changes.")
                .polarity(Polarity::Both),
        )
        .option("json", Opt::boolean().description("Print JSON."))
        .option(
            "plain",
            Opt::boolean().description("Print plain text.").hidden(),
        )
        .option(
            "config",
            Opt::content()
                .description("The configuration file.")
                .short('c')
                .stdin(),
        )
        .option(
            "loud",
            Opt::count().description("How much to say.").short('v'),
        )
        .exclusive(&["json", "plain"])
        .action(|_ctx: Context| async { Ok(()) })
}

fn graph_json<I, R, S: loomcli_core::State>(application: &Application<I, R, S>) -> String {
    serde_json::to_string(&application.inspect().expect("the application builds"))
        .expect("the graph serializes")
}

#[test]
fn a_derived_struct_declares_the_graph_its_builder_calls_declare() {
    let derived = Application::new("app").command(
        Command::new("serve")
            .inputs::<ServeInputs>()
            .action(|_ctx: Context<ServeInputs>| async { Ok(()) }),
    );
    let by_hand = Application::new("app").command(serve_by_hand());
    assert_eq!(graph_json(&derived), graph_json(&by_hand));
}

/// A required option, a required multiple option, a required argument, and the required stdin.
#[derive(Inputs)]
struct ImportInputs {
    #[argument(validate = Port)]
    port: u16,
    #[option(required)]
    tag: Vec<String>,
    #[option(non_interactive)]
    token: Option<String>,
    #[stdin(description = "The records to import.")]
    records: Content,
}

#[test]
fn the_field_type_decides_presence() {
    let derived = Application::new("app").command(
        Command::new("import")
            .inputs::<ImportInputs>()
            .action(|_ctx: Context<ImportInputs>| async { Ok(()) }),
    );
    let by_hand = Application::new("app").command(
        Command::new("import")
            .argument("port", Arg::string().validate(Port).required())
            .option("tag", Opt::string().multiple().required())
            .option("token", Opt::string().required_when_non_interactive())
            .stdin(
                Stdin::new()
                    .description("The records to import.")
                    .required(),
            )
            .action(|_ctx: Context| async { Ok(()) }),
    );
    assert_eq!(graph_json(&derived), graph_json(&by_hand));
}

async fn served(argv: &[&str], stdin: Option<&str>) -> (u8, String, String) {
    let application = Application::new("app").command(
        Command::new("serve")
            .inputs::<ServeInputs>()
            .action(|ctx: Context<ServeInputs>| async move {
                let inputs = &ctx.inputs;
                let config = match &inputs.config {
                    Some(config) => config.text().await?,
                    None => "none".to_owned(),
                };
                ctx.out
                    .print(&format!(
                        "root={} extra={:?} port={} bind={:?} header={:?} watch={} json={} plain={} config={} loud={}",
                        inputs.root,
                        inputs.extra,
                        inputs.port,
                        inputs.bind,
                        inputs.header,
                        inputs.watch,
                        inputs.json,
                        inputs.plain,
                        config.trim_end(),
                        inputs.loud,
                    ))
                    .await
            }),
    );
    let mut fields = MockFields::new().argv(argv.iter().copied());
    if let Some(stdin) = stdin {
        fields = fields.stdin(stdin.as_bytes().to_vec());
    }
    let process = mock_process(fields.env("SERVE_HEADERS", "a,b"));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn the_action_reads_each_field_typed_from_the_validated_values() {
    assert_eq!(
        served(
            &[
                "serve", "site", "x", "y", "-p", "9000", "--host", "example.org", "--no-watch",
                "--json", "-c", "-", "-vv",
            ],
            Some("debug = true\n"),
        )
        .await,
        (
            0,
            "root=site extra=[\"x\", \"y\"] port=9000 bind=Some(\"example.org\") header=[\"a\", \"b\"] watch=false json=true plain=false config=debug = true loud=2\n".to_owned(),
            String::new(),
        )
    );
    // The mock's stdin is an empty pipe, which an omitted stdin option reads.
    assert_eq!(
        served(&["serve"], None).await,
        (
            0,
            "root=public extra=[] port=8080 bind=None header=[\"a\", \"b\"] watch=false json=false plain=false config= loud=0\n".to_owned(),
            String::new(),
        )
    );
}

#[tokio::test]
async fn the_derived_rules_reject_as_the_builder_calls_do() {
    assert_eq!(
        served(&["serve", "-p", "0"], None).await,
        (
            2,
            String::new(),
            "app: Option \"--port\": Expected a port from 1 through 65535.\n".to_owned(),
        )
    );
    assert_eq!(
        served(&["serve", "--json", "--plain"], None).await,
        (
            2,
            String::new(),
            "app: Options \"--json\" and \"--plain\" cannot be used together. Supply only one of them.\n"
                .to_owned(),
        )
    );
}

/// The global options of an application, and the plugin-free read of them.
#[derive(Inputs)]
struct Globals {
    /// Print what would change.
    #[option(short = 'n')]
    dry_run: bool,
    /// The profile to use.
    #[option(default = "default", env = "APP_PROFILE")]
    profile: String,
}

#[tokio::test]
async fn global_inputs_declare_through_globals_and_read_back_typed() {
    let application =
        Application::new("app")
            .globals::<Globals>()
            .action(|ctx: Context| async move {
                let globals = ctx.globals::<Globals>()?;
                ctx.out
                    .print(&format!("{} {}", globals.dry_run, globals.profile))
                    .await
            });
    let process = mock_process(MockFields::new().argv(["-n"]).env("APP_PROFILE", "work"));
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(
        (code.get(), process.stdout_text()),
        (0, "true work\n".to_owned())
    );
}

#[test]
fn into_values_is_the_inverse_of_extract() {
    let globals = Globals {
        dry_run: true,
        profile: "work".to_owned(),
    };
    let read = Globals::extract(&globals.into_values()).expect("the values read back");
    assert_eq!((read.dry_run, read.profile.as_str()), (true, "work"));
    let empty = NoInputs::extract(&NoInputs.into_values());
    assert!(empty.is_ok());
}

/// A unit struct declares nothing and reads back as itself.
#[derive(Inputs)]
struct Nothing;

#[test]
fn a_unit_struct_declares_nothing() {
    let derived = Application::new("app")
        .inputs::<Nothing>()
        .action(|_ctx: Context<Nothing>| async { Ok(()) });
    let by_hand = Application::new("app").action(|_ctx: Context| async { Ok(()) });
    assert_eq!(graph_json(&derived), graph_json(&by_hand));
    assert!(Nothing::extract(&Nothing.into_values()).is_ok());
}

/// A class under `FatalError` with its own code and exit code.
#[derive(Debug, Failure)]
#[failure(code = "path-not-found", exit_code = EX_DATAERR)]
struct PathNotFoundError {
    #[failure(base)]
    base: FatalError,
}

/// A class that inherits both codes, from a literal exit code's parent.
#[derive(Debug, Failure)]
#[failure(exit_code = 3)]
struct ConflictError {
    #[failure(base)]
    base: FatalError,
}

/// An abstract class: never reported bare, so it converts into no `Error`.
#[derive(Debug, Failure)]
#[failure(abstract, code = "remote")]
struct RemoteError {
    #[failure(base)]
    base: FatalError,
}

/// A class under the abstract one.
#[derive(Debug, Failure)]
struct TimeoutError {
    #[failure(base)]
    base: RemoteError,
}

#[test]
fn a_derived_failure_class_states_its_facts_and_walks_its_parents() {
    let found = PathNotFoundError {
        base: FatalError::new("Path not found: \"a\"."),
    };
    assert_eq!(found.class().name(), "PathNotFoundError");
    assert_eq!(found.code(), "path-not-found");
    assert_eq!(found.exit_code().get(), 65);
    assert_eq!(found.message(), "Path not found: \"a\".");
    let conflict = ConflictError {
        base: FatalError::new("Conflict."),
    };
    assert_eq!((conflict.code(), conflict.exit_code().get()), ("fatal", 3));
    let timeout = TimeoutError {
        base: RemoteError {
            base: FatalError::new("Timed out."),
        },
    };
    assert_eq!((timeout.code(), timeout.exit_code().get()), ("remote", 1));
    let error: Error = timeout.into();
    let failure = error.failure().expect("a failure");
    assert!(failure.is::<RemoteError>());
    assert!(failure.is::<FatalError>());
    assert!(!failure.is::<PathNotFoundError>());
    assert!(error.downcast_failure::<TimeoutError>().is_some());
}

async fn failed_with(error: fn() -> Error) -> (u8, String) {
    let application = Application::new("app").action(move |_ctx: Context| async move {
        let outcome: Outcome = Err(error());
        outcome
    });
    let process = mock_process(MockFields::new());
    let code = application
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    (code.get(), process.stderr_text())
}

#[tokio::test]
async fn a_derived_class_reports_with_its_exit_code() {
    // A `FatalError` and the classes under it print their message with no prefix.
    assert_eq!(
        failed_with(|| PathNotFoundError {
            base: FatalError::new("Path not found: \"a\"."),
        }
        .into())
        .await,
        (65, "Path not found: \"a\".\n".to_owned())
    );
}
