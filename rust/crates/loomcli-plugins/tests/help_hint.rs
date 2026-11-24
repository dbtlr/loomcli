//! Help's failure hint, ported from the reference's `suggestions.test.ts` (the case of the
//! suggestions plugin installed before `help()`, and the nine cases of `help's failure hint`) and
//! from the three help cases of `builders.test.ts`. The fixture application mirrors
//! `fixtures/suggestions.ts`; a hinted case runs the same argv on a baseline application without
//! the plugin and reads that help added its line, and nothing else, under core's text.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use std::sync::Arc;

use help_support::{Outcome, run_with};
use loomcli_core::{
    AnyPlugin, Application, Arg, Build, Command, Context, FatalError, GroupApplication, InputError,
    InvocationOutcome, InvocationValues, InvokeOptions, Issue, NoInputs, NoResult, Opt,
    ProcessHandle, ReleaseFacts, SuppliedValue, ValidationContext, Validator,
};
use loomcli_plugins::help::help;
use loomcli_testing::{MockFields, mock_process};

type Kit = GroupApplication<NoInputs, NoResult>;

async fn dispatch(ctx: Context) -> loomcli_core::Outcome {
    ctx.out.print("dispatched").await
}

fn leaf(name: &str) -> Command {
    Command::new(name).action(dispatch)
}

/// Ends the `work` action the way its `--end` value names: a fatal error, an input error, a
/// foreign error core reports as a defect, or the ordinary print.
async fn work(ctx: Context) -> loomcli_core::Outcome {
    let ending = match ctx.supplied.options.get("end") {
        Some(SuppliedValue::One(text)) => text.clone(),
        _ => String::new(),
    };
    match ending.as_str() {
        "fatal" => Err(FatalError::new("The store is locked. Close the other session.").into()),
        "input" => Err(InputError::new("Supply a shorter name.", Vec::new()).into()),
        "internal" => Err(std::io::Error::other("boom").into()),
        _ => ctx.out.print("dispatched").await,
    }
}

/// The reference's `kit`, with no root action: groups for routing, `opts` for option faults, and
/// `work` for an omitted argument and the failures an action raises.
fn kit(plugins: Vec<AnyPlugin>) -> Kit {
    Application::new("kit")
        .plugins(plugins)
        .global_option("file", Opt::string())
        .command(
            Command::new("edits")
                .command(leaf("get"))
                .command(leaf("lane"))
                .command(leaf("Build")),
        )
        .command(
            Command::new("rank")
                .command(leaf("tap"))
                .command(leaf("tip"))
                .command(leaf("top"))
                .command(leaf("tup")),
        )
        .command(
            Command::new("opts")
                .option("field", Opt::string())
                .option("xy", Opt::boolean())
                .option("keep", Opt::boolean().short('k'))
                .action(dispatch),
        )
        .command(
            Command::new("work")
                .argument("name", Arg::string().required())
                .option("end", Opt::string())
                .action(work),
        )
}

/// A plugin whose only contribution is one hint for every failure, so a test reads hint order.
#[cfg(feature = "suggestions")]
fn pointer(name: &str) -> AnyPlugin {
    let hint = format!("{name} hint.");
    loomcli_core::Plugin::new(format!("fixture/{}", name.to_lowercase()))
        .on_failure(move |_, _| hint.clone())
        .into()
}

/// One argv run on a mock process that reports a distributed build.
async fn run<I, R, S: loomcli_core::State>(
    application: &Application<I, R, S>,
    argv: &[&str],
) -> Outcome {
    let fields = MockFields::new()
        .argv(argv.iter().copied())
        .release(ReleaseFacts::new(Build::Distributed));
    run_with(application, fields, None).await.0
}

/// The run without help, which must fail.
async fn baseline(argv: &[&str]) -> Outcome {
    let core = run(&kit(Vec::new()), argv).await;
    assert_ne!(core.status, 0, "the baseline run of {argv:?} succeeded");
    core
}

/// The run under help equals the baseline's code and stderr with `line` added as its last line.
async fn hinted(argv: &[&str], line: &str) {
    let core = baseline(argv).await;
    let helped = run(&kit(vec![help().into()]), argv).await;
    assert_eq!(
        helped,
        Outcome {
            status: core.status,
            stdout: core.stdout,
            stderr: format!("{}{line}\n", core.stderr),
        },
        "{argv:?}"
    );
}

/// The run under help equals the baseline's code and output.
async fn unchanged(argv: &[&str]) {
    let core = baseline(argv).await;
    assert_eq!(run(&kit(vec![help().into()]), argv).await, core, "{argv:?}");
}

// suggestions.test.ts: help's failure hint.

#[tokio::test]
async fn an_unknown_command_names_the_page_of_the_command_routing_reached() {
    assert_eq!(
        baseline(&["nope"]).await.stderr,
        "kit: Unknown command \"nope\". Use one of: edits, rank, opts, work.\n"
    );
    hinted(&["nope"], "Run \"kit --help\" to see the usage.").await;
    hinted(
        &["rank", "nope"],
        "Run \"kit rank --help\" to see the usage.",
    )
    .await;
}

#[tokio::test]
async fn a_group_with_no_subcommand_names_the_group_page() {
    hinted(&["rank"], "Run \"kit rank --help\" to see the usage.").await;
}

#[tokio::test]
async fn an_option_fault_on_a_nested_command_names_its_page() {
    hinted(
        &["edits", "get", "--bogus"],
        "Run \"kit edits get --help\" to see the usage.",
    )
    .await;
    hinted(
        &["opts", "--xy=1"],
        "Run \"kit opts --help\" to see the usage.",
    )
    .await;
    hinted(
        &["opts", "--field", "a", "--field", "b"],
        "Run \"kit opts --help\" to see the usage.",
    )
    .await;
}

#[tokio::test]
async fn a_missing_global_value_before_any_command_name_names_the_root_page() {
    hinted(&["--file"], "Run \"kit --help\" to see the usage.").await;
}

#[tokio::test]
async fn an_extra_argument_names_the_page() {
    hinted(
        &["edits", "get", "extra"],
        "Run \"kit edits get --help\" to see the usage.",
    )
    .await;
}

#[tokio::test]
async fn a_misplaced_option_names_the_page_of_the_command_routing_reached() {
    hinted(&["-k", "opts"], "Run \"kit --help\" to see the usage.").await;
}

#[tokio::test]
async fn an_omitted_argument_and_an_input_error_an_action_returns_name_the_page() {
    hinted(&["work"], "Run \"kit work --help\" to see the usage.").await;
    hinted(
        &["work", "x", "--end", "input"],
        "Run \"kit work --help\" to see the usage.",
    )
    .await;
}

#[tokio::test]
async fn a_fatal_error_and_an_internal_error_gain_no_line() {
    assert_eq!(
        baseline(&["work", "x", "--end", "fatal"]).await,
        Outcome {
            status: 1,
            stdout: String::new(),
            stderr: "The store is locked. Close the other session.\n".to_owned(),
        }
    );
    unchanged(&["work", "x", "--end", "fatal"]).await;
    assert_eq!(
        baseline(&["work", "x", "--end", "internal"]).await.stderr,
        "kit: Something went wrong.\n"
    );
    unchanged(&["work", "x", "--end", "internal"]).await;
}

/// A validator that rejects every value, so a declared default fails after the graph is built.
struct Refuses;

impl Validator for Refuses {
    type Output = String;

    fn validate(&self, _: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        Err(vec![Issue::new("No.")])
    }
}

#[tokio::test]
async fn a_declaration_error_a_run_reports_gains_no_line() {
    let plugins: Vec<AnyPlugin> = vec![
        help().into(),
        #[cfg(feature = "suggestions")]
        loomcli_plugins::suggestions::suggestions().into(),
    ];
    let application = Application::new("kit")
        .plugins(plugins)
        .option("level", Opt::string().default("loud").validate(Refuses))
        .action(dispatch);
    assert_eq!(
        run(&application, &[]).await,
        Outcome {
            status: 1,
            stdout: String::new(),
            stderr: "kit: Something went wrong.\n".to_owned(),
        }
    );
}

// suggestions.test.ts: the suggestions plugin installed before help.

#[cfg(feature = "suggestions")]
#[tokio::test]
async fn installed_before_help_suggestions_changes_neither_the_help_takeover_nor_the_hint_order() {
    use loomcli_plugins::suggestions::suggestions;
    let early = || kit(vec![suggestions().into(), help().into(), pointer("Later")]);
    let helped = || kit(vec![help().into(), suggestions().into(), pointer("Later")]);
    let early_page = run(&early(), &["--help"]).await;
    assert_eq!(early_page.status, 0);
    assert_eq!(early_page, run(&helped(), &["--help"]).await);
    assert_eq!(
        run(&early(), &["edits", "gte"]).await,
        Outcome {
            status: 2,
            stdout: String::new(),
            stderr: "kit: Unknown command \"gte\". Did you mean \"get\"?\n\
                     Run \"kit edits --help\" to see the usage.\n\
                     Later hint.\n"
                .to_owned(),
        }
    );
}

// builders.test.ts: the help plugin's hint.

/// The reference's `notes` application of the builder cases: a `db` group with one Command.
fn notes(plugins: Vec<AnyPlugin>) -> Kit {
    Application::new("notes").plugins(plugins).command(
        Command::new("db").command(
            Command::new("list")
                .option("keep", Opt::boolean())
                .action(dispatch),
        ),
    )
}

#[tokio::test]
async fn a_usage_error_points_at_the_routed_command_help_page() {
    assert_eq!(
        run(&notes(vec![help().into()]), &["db", "lsit"]).await,
        Outcome {
            status: 2,
            stdout: String::new(),
            stderr: "notes: Unknown command \"lsit\". Use one of: list.\n\
                     Run \"notes db --help\" to see the usage.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn an_invocation_by_name_gets_no_hint() {
    let process = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let outcome = notes(vec![help().into()])
        .invoke(
            &["db", "list"],
            InvocationValues::new().option("kepe", true),
            InvokeOptions::new(),
            Some(process as Arc<dyn ProcessHandle>),
        )
        .await;
    match outcome {
        InvocationOutcome::Failed {
            exit_code,
            output,
            messages,
            ..
        } => {
            assert_eq!(exit_code.get(), 2);
            assert_eq!(output, "");
            assert_eq!(
                messages,
                "notes: Unknown option \"kepe\". Supply the name of a declared option.\n"
            );
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn a_failure_that_is_not_a_usage_error_gets_no_hint() {
    let application = || {
        Application::new("notes")
            .plugins(vec![AnyPlugin::from(help())])
            .command(
                Command::new("db").command(
                    Command::new("list")
                        .action(|_: Context| async { Err(FatalError::new("broken").into()) }),
                ),
            )
    };
    assert_eq!(
        run(&application(), &["db", "list"]).await,
        Outcome {
            status: 1,
            stdout: String::new(),
            stderr: "broken\n".to_owned(),
        }
    );
}
