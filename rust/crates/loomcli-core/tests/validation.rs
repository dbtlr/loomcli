//! Ports `validate-omitted.test.ts`, `validation-context.test.ts`, `validation-options.test.ts`,
//! the validation cases of `multiple.test.ts`, `implied-values.test.ts`, and
//! `optional-arguments.test.ts`, and the `invalid-default` and `invalid-implied` rows of
//! `input-diagnostics.test.ts`, a plugin's included: validators reached through a run on the mock
//! process, their contexts, absence and defaults, and the declared-value faults.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Background, Command, Context, Done, InputIdentity, InputKind, Issue,
    NoInputs, NoResult, Opt, PathSegment, Plugin, ReleaseFacts, SuppliedInputs, SuppliedValue,
    ValidationFacts, ValidationPhase, WorkingDirectoryError, validation_context,
};
use loomcli_testing::{MockFields, MockTerminal, mock_process};
use serde_json::{Value, json};
use support::validators::{
    Calls, Digits, Echo, NonEmpty, Number, OneOf, Rejecting, Source, Upper, calls, seen,
};
use support::{Ran, fields, run_with, values};

type App = Application<NoInputs, NoResult, Done>;

fn printed(ran: &Ran) -> Value {
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""), "{ran:?}");
    serde_json::from_str(ran.stdout.lines().next().unwrap_or_default()).unwrap_or(Value::Null)
}

// validate-omitted.test.ts

fn omitted(scenario: &str, recorded: &Calls) -> App {
    let source = |message| Source {
        message,
        calls: Arc::clone(recorded),
    };
    let app = Application::new("omitted");
    let app = match scenario {
        "option" => app.option(
            "file",
            Opt::string().short('f').validate_omitted(source(None)),
        ),
        "option-issue" => app.option(
            "file",
            Opt::string()
                .short('f')
                .validate_omitted(source(Some("Supply a file or pipe JSON to stdin."))),
        ),
        "argument" => {
            return app
                .argument("path", Arg::string().validate_omitted(source(None)))
                .action(values);
        }
        _ => {
            return app
                .argument(
                    "path",
                    Arg::string()
                        .validate_omitted(source(Some("Supply a path or pipe JSON to stdin."))),
                )
                .action(values);
        }
    };
    app.action(values)
}

#[tokio::test]
async fn an_omitted_option_with_validate_omitted_reaches_its_validator_in_the_invocation_phase() {
    let recorded = calls();
    let ran = run_with(&omitted("option", &recorded), fields(&[], &[])).await;
    assert_eq!(
        printed(&ran),
        json!({ "args": {}, "options": { "file": "stdin" } })
    );
    assert_eq!(
        seen(&recorded),
        [json!({
            "absent": true,
            "input": { "global": false, "kind": "option", "name": "file" },
            "phase": "invocation",
            "supplied": { "args": {}, "options": {} },
        })]
    );
}

#[tokio::test]
async fn a_supplied_value_still_reaches_the_same_validator_as_its_own_string() {
    let recorded = calls();
    let ran = run_with(
        &omitted("option", &recorded),
        fields(&["--file", "doc.json"], &[]),
    )
    .await;
    assert_eq!(
        printed(&ran),
        json!({ "args": {}, "options": { "file": "file:doc.json" } })
    );
    assert_eq!(
        seen(&recorded),
        [json!({
            "absent": false,
            "input": { "global": false, "kind": "option", "name": "file" },
            "phase": "invocation",
            "supplied": { "args": {}, "options": { "file": "doc.json" } },
        })]
    );
}

#[tokio::test]
async fn an_issue_from_the_omitted_call_is_an_input_error_naming_the_options_long_form() {
    let app = omitted("option-issue", &calls());
    assert_eq!(
        run_with(&app, fields(&[], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "omitted: Option \"--file\": Supply a file or pipe JSON to stdin.\n".to_owned(),
        }
    );
    let ran = run_with(&app, fields(&["-f", "doc.json"], &[])).await;
    assert_eq!(printed(&ran)["options"]["file"], json!("file:doc.json"));
}

#[tokio::test]
async fn an_omitted_scalar_argument_with_validate_omitted_reaches_its_validator() {
    let recorded = calls();
    let app = omitted("argument", &recorded);
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_eq!(
        printed(&ran),
        json!({ "args": { "path": "stdin" }, "options": {} })
    );
    assert_eq!(
        seen(&recorded),
        [json!({
            "absent": true,
            "input": { "global": false, "kind": "argument", "name": "path" },
            "phase": "invocation",
            "supplied": { "args": {}, "options": {} },
        })]
    );
    let ran = run_with(&app, fields(&["doc.json"], &[])).await;
    assert_eq!(printed(&ran)["args"], json!({ "path": "file:doc.json" }));
}

#[tokio::test]
async fn an_issue_from_an_omitted_argument_names_the_argument() {
    assert_eq!(
        run_with(&omitted("argument-issue", &calls()), fields(&[], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "omitted: Argument \"path\": Supply a path or pipe JSON to stdin.\n".to_owned(),
        }
    );
}

// validation-context.test.ts

const CONTEXT_CWD: &str = "/loom/context";

fn echo(label: &'static str, recorded: &Calls) -> Echo {
    Echo {
        label,
        calls: Arc::clone(recorded),
    }
}

/// An action that prints every record and whether the validators read the action's own host.
fn records(
    recorded: &Calls,
) -> impl Fn(
    Context,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = loomcli_core::Outcome> + Send>>
+ Send
+ Sync
+ 'static {
    let recorded = Arc::clone(recorded);
    move |ctx: Context| {
        let line = json!({ "records": seen(&recorded) });
        Box::pin(async move { ctx.out.print(&line.to_string()).await })
    }
}

async fn context_run(app: &App, argv: &[&str]) -> Value {
    let ran = run_with(
        app,
        MockFields::new()
            .argv(argv.iter().copied())
            .cwd(CONTEXT_CWD),
    )
    .await;
    printed(&ran)
}

#[tokio::test]
async fn every_invocation_validator_call_reads_the_routed_path_passthrough_and_supplied_tokens() {
    let recorded = calls();
    let app = Application::new("context")
        .global_option("mode", Opt::string().validate(echo("mode", &recorded)))
        .argument(
            "name",
            Arg::string().required().validate(echo("name", &recorded)),
        )
        .argument(
            "files",
            Arg::string().variadic().validate(echo("files", &recorded)),
        )
        .option("single", Opt::string().validate(echo("single", &recorded)))
        .option(
            "multi",
            Opt::string().multiple().validate(echo("multi", &recorded)),
        )
        .option("absent", Opt::string())
        .option("pending", Opt::string().multiple())
        .option("flag", Opt::boolean())
        .option(
            "color",
            Opt::boolean().polarity(loomcli_core::Polarity::Both),
        )
        .option("quiet", Opt::boolean())
        .action(records(&recorded));
    let argv = [
        "--mode",
        "fast",
        "one",
        "two",
        "three",
        "--single",
        "s",
        "--multi",
        "a",
        "--multi",
        "b",
        "--flag",
        "--no-color",
        "--",
        "tail",
    ];
    let shared = |input: Value| {
        json!({
            "command": [],
            "host": { "argv": argv, "cwd": CONTEXT_CWD },
            "input": input,
            "passthrough": ["tail"],
            "phase": "invocation",
            "supplied": {
                "args": { "files": ["two", "three"], "name": "one" },
                "options": {
                    "color": false, "flag": true, "mode": "fast", "multi": ["a", "b"],
                    "pending": [], "single": "s",
                },
            },
            "suppliedKey": true,
        })
    };
    let input = |global: bool, kind: &str, name: &str| json!({ "global": global, "kind": kind, "name": name });
    assert_eq!(
        context_run(&app, &argv).await,
        json!({ "records": [
            { "context": shared(input(true, "option", "mode")), "label": "mode", "value": "fast" },
            { "context": shared(input(false, "argument", "name")), "label": "name", "value": "one" },
            { "context": shared(input(false, "argument", "files")), "label": "files", "value": "two" },
            { "context": shared(input(false, "argument", "files")), "label": "files", "value": "three" },
            { "context": shared(input(false, "option", "single")), "label": "single", "value": "s" },
            { "context": shared(input(false, "option", "multi")), "label": "multi", "value": "a" },
            { "context": shared(input(false, "option", "multi")), "label": "multi", "value": "b" },
        ] })
    );
}

fn nested(recorded: &Calls) -> App {
    let clear = Command::new("clear")
        .alias("cl")
        .option("force", Opt::string().validate(echo("force", recorded)))
        .action(records(recorded));
    let cache = Command::new("cache").alias("c").command(clear);
    Application::new("context")
        .global_option("mode", Opt::string().validate(echo("mode", recorded)))
        .command(cache)
        .action(records(recorded))
}

#[tokio::test]
async fn a_nested_command_reports_its_whole_route_and_canonical_names_through_aliases() {
    for argv in [
        ["cache", "clear", "--force", "yes", "--mode", "fast"],
        ["c", "cl", "--force", "yes", "--mode", "fast"],
    ] {
        let recorded = calls();
        let shared = |input: Value| {
            json!({
                "command": ["cache", "clear"],
                "host": { "argv": argv, "cwd": CONTEXT_CWD },
                "input": input,
                "passthrough": [],
                "phase": "invocation",
                "supplied": { "args": {}, "options": { "force": "yes", "mode": "fast" } },
                "suppliedKey": true,
            })
        };
        assert_eq!(
            context_run(&nested(&recorded), &argv).await,
            json!({ "records": [
                {
                    "context": shared(json!({ "global": true, "kind": "option", "name": "mode" })),
                    "label": "mode",
                    "value": "fast",
                },
                {
                    "context": shared(json!({ "global": false, "kind": "option", "name": "force" })),
                    "label": "force",
                    "value": "yes",
                },
            ] }),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_default_validates_in_its_own_phase_with_the_host_and_no_supplied_inputs() {
    let recorded = calls();
    let app = Application::new("context")
        .option(
            "depth",
            Opt::string()
                .default("1")
                .validate(echo("depth", &recorded)),
        )
        .option("size", Opt::string().validate(echo("size", &recorded)))
        .action(records(&recorded));
    let argv = ["--size", "2"];
    let host = json!({ "argv": argv, "cwd": CONTEXT_CWD });
    assert_eq!(
        context_run(&app, &argv).await,
        json!({ "records": [
            {
                "context": {
                    "host": host,
                    "input": { "global": false, "kind": "option", "name": "depth" },
                    "phase": "default",
                    "suppliedKey": false,
                },
                "label": "depth",
                "value": "1",
            },
            {
                "context": {
                    "command": [],
                    "host": host,
                    "input": { "global": false, "kind": "option", "name": "size" },
                    "passthrough": [],
                    "phase": "invocation",
                    "supplied": { "args": {}, "options": { "size": "2" } },
                    "suppliedKey": true,
                },
                "label": "size",
                "value": "2",
            },
        ] })
    );
}

#[tokio::test]
async fn a_validator_that_converts_its_value_answers_the_action_typed() {
    let app = Application::new("context")
        .option(
            "size",
            Opt::string().validate(Number("Use decimal digits.")),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&["--size", "12"], &[])).await),
        json!({ "args": {}, "options": { "size": 12 } })
    );
    assert_eq!(
        run_with(&app, fields(&["--size", "bad"], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "context: Option \"--size\": Use decimal digits.\n".to_owned(),
        }
    );
}

// validation-options.test.ts

fn at() -> InputIdentity {
    InputIdentity::new(false, InputKind::Option, "at")
}

#[test]
fn a_default_phase_context_holds_the_captured_host_and_the_input_alone() {
    let process = mock_process(MockFields::new().cwd("/work").time_zone("Europe/Paris"));
    let context = validation_context(process, ValidationFacts::default_phase(at()))
        .unwrap_or_else(|_| panic!("the handle captures"));
    assert_eq!(context.phase, ValidationPhase::Default);
    assert_eq!(context.input, at());
    assert_eq!(
        (context.command, context.passthrough, context.supplied),
        (None, None, None)
    );
    assert_eq!(
        (
            context.host.cwd.to_string_lossy().into_owned(),
            context.host.time_zone.clone()
        ),
        ("/work".to_owned(), "Europe/Paris".to_owned())
    );
    // The default phase has no route, so the invocation setters change nothing there.
    let routed = validation_context(
        mock_process(MockFields::new()),
        ValidationFacts::default_phase(at()).command(vec!["deploy".to_owned()]),
    )
    .unwrap_or_else(|_| panic!("the handle captures"));
    assert_eq!(routed.command, None);
}

#[test]
fn an_invocation_context_holds_the_root_no_passthrough_and_nothing_supplied_when_omitted() {
    let context = validation_context(
        mock_process(MockFields::new()),
        ValidationFacts::invocation(at()),
    )
    .unwrap_or_else(|_| panic!("the handle captures"));
    assert_eq!(context.phase, ValidationPhase::Invocation);
    assert_eq!(context.command, Some(Vec::new()));
    assert_eq!(context.passthrough, Some(Vec::new()));
    assert_eq!(context.supplied, Some(SuppliedInputs::default()));
}

#[test]
fn an_invocation_context_holds_the_supplied_route_passthrough_and_record() {
    let mut supplied = SuppliedInputs::default();
    supplied
        .options
        .insert("tag".to_owned(), SuppliedValue::Many(vec!["a".to_owned()]));
    let context = validation_context(
        mock_process(MockFields::new()),
        ValidationFacts::invocation(at())
            .command(vec!["deploy".to_owned()])
            .passthrough(vec!["--".to_owned(), "x".to_owned()])
            .supplied(supplied.clone()),
    )
    .unwrap_or_else(|_| panic!("the handle captures"));
    assert_eq!(context.command, Some(vec!["deploy".to_owned()]));
    assert_eq!(
        context.passthrough,
        Some(vec!["--".to_owned(), "x".to_owned()])
    );
    assert_eq!(context.supplied, Some(supplied));
}

#[test]
fn the_host_background_is_the_one_the_handle_terminal_states_and_no_query_is_written() {
    let terminal = || MockTerminal::new(80, 24).keys(Vec::<&str>::new());
    let stated = mock_process(
        MockFields::new()
            .env("TERM", "xterm-256color")
            .terminal(terminal().background(Background::Light)),
    );
    let unstated = mock_process(
        MockFields::new()
            .env("TERM", "xterm-256color")
            .terminal(terminal()),
    );
    let read = |process: &Arc<loomcli_testing::MockProcess>| {
        validation_context(
            Arc::clone(process) as _,
            ValidationFacts::default_phase(at()),
        )
        .map(|context| context.host.terminal.background)
        .unwrap_or_else(|_| panic!("the handle captures"))
    };
    assert_eq!(
        (read(&stated), read(&unstated)),
        (Some(Background::Light), None)
    );
    assert_eq!(
        (stated.stderr_text(), unstated.stderr_text()),
        (String::new(), String::new())
    );
}

#[test]
fn a_working_directory_the_handle_cannot_read_returns_the_error_a_run_would_report() {
    let process = mock_process(
        MockFields::new().cwd_with(|| Err(std::io::Error::from(std::io::ErrorKind::NotFound))),
    );
    let error = validation_context(process, ValidationFacts::default_phase(at()))
        .err()
        .unwrap_or_else(|| panic!("the capture fails"));
    assert!(error.downcast_failure::<WorkingDirectoryError>().is_some());
}

#[test]
fn each_call_builds_a_fresh_context_with_a_host_of_its_own() {
    let process = mock_process(MockFields::new());
    let one = validation_context(
        Arc::clone(&process) as _,
        ValidationFacts::default_phase(at()),
    )
    .unwrap_or_else(|_| panic!("the handle captures"));
    let two = validation_context(process, ValidationFacts::default_phase(at()))
        .unwrap_or_else(|_| panic!("the handle captures"));
    assert!(!Arc::ptr_eq(&one.host, &two.host));
}

// multiple.test.ts: validation per value.

fn field_name() -> NonEmpty {
    NonEmpty("Supply a field name.")
}

#[tokio::test]
async fn a_run_cancelled_inside_one_values_validator_starts_no_call_for_the_next_value() {
    let token = tokio_util::sync::CancellationToken::new();
    let cancelling = support::validators::Cancelling::new(&token);
    let app = Application::new("multiple")
        .option(
            "field",
            Opt::string().multiple().validate(cancelling.clone()),
        )
        .action(values);
    let process = mock_process(fields(
        &["--field", "a", "--field", "b", "--field", "c"],
        &[],
    ));
    let code = app
        .run(
            loomcli_core::RunOptions::new()
                .process(Arc::clone(&process) as _)
                .signal(token),
        )
        .await;
    assert_eq!(
        (
            cancelling.calls(),
            code.get(),
            process.stdout_text(),
            process.stderr_text()
        ),
        (1, 130, String::new(), String::new())
    );
}

#[tokio::test]
async fn an_omitted_multiple_option_calls_no_validator_and_reads_an_empty_list() {
    let recorded = calls();
    let app = Application::new("multiple")
        .option(
            "field",
            Opt::string()
                .multiple()
                .short('F')
                .validate(echo("field", &recorded)),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&[], &[])).await),
        json!({ "args": {}, "options": { "field": [] } })
    );
    assert!(seen(&recorded).is_empty());
    assert_eq!(
        printed(&run_with(&app, fields(&["--field", "a", "--field=b"], &[])).await),
        json!({ "args": {}, "options": { "field": ["a", "b"] } })
    );
    assert_eq!(seen(&recorded).len(), 2);
}

/// Answers each value's length.
#[derive(Clone)]
struct Length;

impl loomcli_core::Validator for Length {
    type Output = u64;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<u64, Vec<Issue>> {
        Ok(input.len() as u64)
    }
}

#[tokio::test]
async fn the_action_receives_the_list_of_each_values_validator_output() {
    let app = Application::new("multiple")
        .option("field", Opt::string().multiple().validate(Length))
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&["--field", "a", "--field", "abc"], &[])).await),
        json!({ "args": {}, "options": { "field": [1, 3] } })
    );
}

#[tokio::test]
async fn required_is_checked_before_any_validator_so_it_answers_an_omission_first() {
    let app = Application::new("multiple")
        .option(
            "field",
            Opt::string().multiple().required().validate(field_name()),
        )
        .action(values);
    assert_eq!(
        run_with(&app, fields(&[], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "multiple: Option \"--field\" is required. Supply at least one value.\n"
                .to_owned(),
        }
    );
    assert_eq!(
        printed(&run_with(&app, fields(&["--field", "a"], &[])).await),
        json!({ "args": {}, "options": { "field": ["a"] } })
    );
}

#[tokio::test]
async fn a_multiple_validator_reports_each_issue_at_its_position() {
    let app = Application::new("multiple")
        .option(
            "field",
            Opt::string().multiple().short('F').validate(field_name()),
        )
        .action(values);
    assert_eq!(
        run_with(&app, fields(&["-F", "", "--field", "a", "-F", ""], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "multiple: Option \"--field\" at 0: Supply a field name.\n\
                     multiple: Option \"--field\" at 2: Supply a field name.\n"
                .to_owned(),
        }
    );
}

/// Rejects every value but `a` with an issue about its `name` key.
#[derive(Clone)]
struct Pathed;

impl loomcli_core::Validator for Pathed {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<Issue>> {
        if input == "a" {
            Ok(input.to_owned())
        } else {
            Err(vec![
                Issue::new("Unknown name.").at(PathSegment::Key("name".to_owned())),
            ])
        }
    }
}

#[tokio::test]
async fn a_value_issue_with_its_own_path_reads_after_the_value_position() {
    let app = Application::new("multiple")
        .option("field", Opt::string().multiple().validate(Pathed))
        .action(values);
    assert_eq!(
        run_with(&app, fields(&["--field", "a", "--field", "b"], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "multiple: Option \"--field\" at 1.name: Unknown name.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn each_multiple_default_value_passes_the_validator_and_a_supplied_list_replaces_it() {
    let app = Application::new("multiple")
        .option(
            "field",
            Opt::string().multiple().default(["a", "b"]).validate(Upper),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&[], &[])).await)["options"]["field"],
        json!(["A", "B"])
    );
    assert_eq!(
        printed(&run_with(&app, fields(&["--field", "x", "--field", "y"], &[])).await)["options"]["field"],
        json!(["X", "Y"])
    );
    let raw = Application::new("multiple")
        .option("field", Opt::string().multiple().default(["a"]))
        .action(values);
    assert_eq!(
        printed(&run_with(&raw, fields(&[], &[])).await)["options"]["field"],
        json!(["a"])
    );
}

/// Asserts a development build's run reported the declaration fault: its rule, each sentence
/// line, and its correction, with exit 1 and nothing on stdout.
#[track_caller]
fn assert_fault(ran: &Ran, rule: &str, sentence: &[&str], correction: &str) {
    assert_eq!((ran.status, ran.stdout.as_str()), (1, ""), "{}", ran.stderr);
    assert!(
        ran.stderr.contains(&format!(" @loomcli/core/{rule}\n")),
        "{}",
        ran.stderr
    );
    assert!(
        ran.stderr
            .contains(&format!("\n\n{}\n", sentence.join("\n"))),
        "{}",
        ran.stderr
    );
    assert!(ran.stderr.contains(correction), "{}", ran.stderr);
}

#[tokio::test]
async fn a_rejected_default_value_fails_every_run_with_its_position() {
    let app = Application::new("multiple")
        .option(
            "field",
            Opt::string()
                .description("The field option.")
                .multiple()
                .default(["a", ""])
                .validate(field_name()),
        )
        .action(values);
    assert_fault(
        &run_with(&app, fields(&["--field", "fine"], &[])).await,
        "invalid-default",
        &[
            "Option \"field\" has an invalid default.",
            "Option \"field\" at 1: Supply a field name.",
        ],
        "Fix the default or its validator.",
    );
}

#[tokio::test]
async fn a_multiple_global_reads_an_empty_list_when_no_layer_supplies_it() {
    let show = Command::new("show")
        .option("local", Opt::boolean())
        .action(values);
    let app = Application::new("multiple")
        .global_option("field", Opt::string().short('F').multiple())
        .command(show)
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&["show"], &[])).await)["options"],
        json!({ "field": [], "local": false })
    );
    assert_eq!(
        printed(
            &run_with(
                &app,
                fields(
                    &["--field", "a", "show", "-F", "b", "--local", "--field=c"],
                    &[]
                )
            )
            .await
        )["options"],
        json!({ "field": ["a", "b", "c"], "local": true })
    );
}

// implied-values.test.ts: the implied value's validation.

fn copyit(recorded: &Calls) -> App {
    Application::new("copyit")
        .argument("files", Arg::string().variadic())
        .option("total", Opt::boolean().short('t'))
        .option(
            "backup",
            Opt::string()
                .env(["BACKUP"])
                .implied("simple")
                .short('b')
                .validate(Phased {
                    calls: Arc::clone(recorded),
                }),
        )
        .option("suffix", Opt::string().default("~").implied(".bak"))
        .option("tag", Opt::string().implied("all").multiple().short('g'))
        .action(values)
}

/// Accepts `none`, `simple`, or `numbered` uppercased, and records `<phase>:<value>` for each call.
#[derive(Clone)]
struct Phased {
    calls: Calls,
}

impl loomcli_core::Validator for Phased {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        context: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<Issue>> {
        let phase = match context.phase {
            ValidationPhase::Default => "default",
            ValidationPhase::Invocation => "invocation",
            ValidationPhase::Question => "question",
        };
        if let Ok(mut calls) = self.calls.lock() {
            calls.push(json!(format!("{phase}:{input}")));
        }
        OneOf(
            &["none", "simple", "numbered"],
            "Use none, simple, or numbered.",
        )
        .validate(input, context)
        .map(|value| value.to_uppercase())
    }
}

#[tokio::test]
async fn the_implied_value_passes_its_validator_once_before_any_token() {
    let recorded = calls();
    let app = copyit(&recorded);
    let ran = run_with(&app, fields(&["-b"], &[])).await;
    assert_eq!(printed(&ran)["options"]["backup"], json!("SIMPLE"));
    assert_eq!(seen(&recorded), [json!("default:simple")]);
    let recorded = calls();
    let ran = run_with(&copyit(&recorded), fields(&[], &[])).await;
    assert_eq!(ran.status, 0);
    assert_eq!(seen(&recorded), [json!("default:simple")]);
    let recorded = calls();
    let ran = run_with(&copyit(&recorded), fields(&["--backup=t"], &[])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "copyit: Option \"--backup\": Use none, simple, or numbered.\n"
        )
    );
    assert_eq!(
        seen(&recorded),
        [json!("default:simple"), json!("invocation:t")]
    );
}

#[tokio::test]
async fn a_default_fills_an_omitted_option_and_the_implied_value_a_bare_one() {
    let app = copyit(&calls());
    for (argv, suffix) in [
        (&[][..], "~"),
        (&["--suffix"], ".bak"),
        (&["--suffix=.orig"], ".orig"),
    ] {
        assert_eq!(
            printed(&run_with(&app, fields(argv, &[])).await)["options"]["suffix"],
            json!(suffix),
            "{argv:?}"
        );
    }
    for (argv, tag) in [
        (&["--tag", "-g=x", "-g"][..], json!(["all", "x", "all"])),
        (&["-gy", "--tag=", "--tag"], json!(["y", "", "all"])),
        (&[], json!([])),
    ] {
        assert_eq!(
            printed(&run_with(&app, fields(argv, &[])).await)["options"]["tag"],
            tag,
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn an_input_source_supplies_explicit_values_alone_never_the_implied_value() {
    let app = copyit(&calls());
    for (argv, env, backup) in [
        (&[][..], &[("BACKUP", "numbered")][..], json!("NUMBERED")),
        (&[], &[("BACKUP", "")], Value::Null),
        (&["-b"], &[("BACKUP", "numbered")], json!("SIMPLE")),
    ] {
        assert_eq!(
            printed(&run_with(&app, fields(argv, env)).await)["options"]["backup"],
            backup,
            "{argv:?} {env:?}"
        );
    }
}

#[tokio::test]
async fn a_rejected_implied_value_fails_run_before_any_token_with_or_without_a_bare_spelling() {
    let app = Application::new("rejected")
        .option(
            "color",
            Opt::string().implied("rainbow").validate(OneOf(
                &["none", "simple", "numbered"],
                "Use none, simple, or numbered.",
            )),
        )
        .action(values);
    for argv in [&[][..], &["--color"], &["--bogus"]] {
        assert_fault(
            &run_with(&app, fields(argv, &[])).await,
            "invalid-implied",
            &[
                "Option \"color\" has an invalid implied value.",
                "Option \"color\": Use none, simple, or numbered.",
            ],
            "Fix the implied value or its validator.",
        );
    }
}

// optional-arguments.test.ts: validation, defaults, and the empty variadic list.

#[tokio::test]
async fn an_optional_argument_validator_reads_a_supplied_token_and_skips_omission() {
    let recorded = calls();
    let app = Application::new("optional")
        .argument(
            "path",
            Arg::string().validate(Checked {
                calls: Arc::clone(&recorded),
            }),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&[], &[])).await)["args"],
        json!({})
    );
    assert!(seen(&recorded).is_empty());
    assert_eq!(
        printed(&run_with(&app, fields(&["a"], &[])).await)["args"],
        json!({ "path": "a" })
    );
    assert_eq!(seen(&recorded).len(), 1);
    assert_eq!(
        run_with(&app, fields(&[""], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "optional: Argument \"path\": Supply a path.\n".to_owned(),
        }
    );
}

/// Rejects the empty string with `Supply a path.` and counts its calls.
#[derive(Clone)]
struct Checked {
    calls: Calls,
}

impl loomcli_core::Validator for Checked {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        context: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<Issue>> {
        if let Ok(mut calls) = self.calls.lock() {
            calls.push(json!(input));
        }
        NonEmpty("Supply a path.").validate(input, context)
    }
}

#[tokio::test]
async fn a_declared_default_fills_an_omitted_argument_through_its_validator() {
    let app = Application::new("optional")
        .argument(
            "path",
            Arg::string()
                .default("10")
                .validate(Number("Use decimal digits.")),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&[], &[])).await)["args"],
        json!({ "path": 10 })
    );
    assert_eq!(
        printed(&run_with(&app, fields(&["20"], &[])).await)["args"],
        json!({ "path": 20 })
    );
    let invalid = Application::new("optional")
        .argument(
            "path",
            Arg::string()
                .default("ten")
                .validate(Digits("Use decimal digits.")),
        )
        .action(values);
    assert_fault(
        &run_with(&invalid, fields(&["20"], &[])).await,
        "invalid-default",
        &[
            "Argument \"path\" has an invalid default.",
            "Argument \"path\": Use decimal digits.",
        ],
        "Fix the default or its validator.",
    );
}

#[tokio::test]
async fn an_omitted_optional_variadic_argument_calls_no_validator_and_reads_an_empty_list() {
    let recorded = calls();
    let app = Application::new("optional")
        .argument(
            "files",
            Arg::string().variadic().validate(Checked {
                calls: Arc::clone(&recorded),
            }),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&[], &[])).await)["args"],
        json!({ "files": [] })
    );
    assert!(seen(&recorded).is_empty());
    assert_eq!(
        printed(&run_with(&app, fields(&["one", "two"], &[])).await)["args"],
        json!({ "files": ["one", "two"] })
    );
    assert_eq!(seen(&recorded).len(), 2);
}

#[tokio::test]
async fn a_variadic_default_fills_an_omitted_tail_and_a_required_one_rejects_an_empty_tail() {
    let defaulted = Application::new("optional")
        .argument("files", Arg::string().variadic().default(["a", "x"]))
        .action(values);
    assert_eq!(
        printed(&run_with(&defaulted, fields(&[], &[])).await)["args"],
        json!({ "files": ["a", "x"] })
    );
    let required = Application::new("optional")
        .argument("files", Arg::string().variadic().required())
        .action(values);
    assert_eq!(
        run_with(&required, fields(&[], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "optional: Argument \"files\" requires at least one value. Supply a value for \"files\".\n".to_owned(),
        }
    );
    assert_eq!(
        printed(&run_with(&required, fields(&["one"], &[])).await)["args"],
        json!({ "files": ["one"] })
    );
    let invalid = Application::new("optional")
        .argument(
            "files",
            Arg::string()
                .variadic()
                .default(["a", ""])
                .validate(NonEmpty("Supply a file.")),
        )
        .action(values);
    assert_fault(
        &run_with(&invalid, fields(&["one"], &[])).await,
        "invalid-default",
        &[
            "Argument \"files\" has an invalid default.",
            "Argument \"files\" at 1: Supply a file.",
        ],
        "Fix the default or its validator.",
    );
}

#[tokio::test]
async fn a_rejection_with_no_issue_reads_as_cores_placeholder() {
    let app = Application::new("silent")
        .option("value", Opt::string().validate(Rejecting(Vec::new())))
        .action(values);
    assert_eq!(
        run_with(&app, fields(&["--value", "x"], &[])).await.stderr,
        "silent: Option \"--value\": The validator rejected this value without an explanation. Supply a different value.\n"
    );
}

#[tokio::test]
async fn a_distributed_build_reports_an_invalid_default_with_the_generic_message() {
    let app = Application::new("probe")
        .option(
            "limit",
            Opt::string()
                .default("x")
                .validate(Digits("Use a whole number.")),
        )
        .action(values);
    let process = mock_process(
        MockFields::new().release(ReleaseFacts::new(loomcli_core::Build::Distributed)),
    );
    let code = app
        .run(loomcli_core::RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(
        (code.get(), process.stderr_text()),
        (1, "probe: Something went wrong.\n".to_owned())
    );
}

// schema.test.ts: validation through a run.

/// Counts its calls, then answers the value as a number.
#[derive(Clone)]
struct CountedNumber {
    calls: Calls,
}

impl loomcli_core::Validator for CountedNumber {
    type Output = u64;

    fn validate(
        &self,
        input: &str,
        context: &loomcli_core::ValidationContext,
    ) -> Result<u64, Vec<Issue>> {
        if let Ok(mut calls) = self.calls.lock() {
            calls.push(json!(input));
        }
        Number("Use decimal digits.").validate(input, context)
    }
}

#[tokio::test]
async fn a_declared_default_enters_the_transformation_once_per_run_as_a_supplied_value_does() {
    let recorded = calls();
    let app = Application::new("schema")
        .option(
            "size",
            Opt::string().default("10").validate(CountedNumber {
                calls: Arc::clone(&recorded),
            }),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&[], &[])).await)["options"],
        json!({ "size": 10 })
    );
    assert_eq!(seen(&recorded).len(), 1);
    let recorded_twice = calls();
    let app = Application::new("schema")
        .option(
            "size",
            Opt::string().default("10").validate(CountedNumber {
                calls: Arc::clone(&recorded_twice),
            }),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&["--size", "20"], &[])).await)["options"],
        json!({ "size": 20 })
    );
    // The default's call and the supplied value's.
    assert_eq!(seen(&recorded_twice), [json!("10"), json!("20")]);
    // An invalid supplied value never activates a valid default.
    let ran = run_with(&app, fields(&["--size", "bad"], &[])).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (2, "", "schema: Option \"--size\": Use decimal digits.\n")
    );
}

#[tokio::test]
async fn an_invalid_default_is_a_developer_error_even_when_replaced_or_inputs_cannot_parse() {
    let app = Application::new("schema")
        .option(
            "size",
            Opt::string()
                .description("The size option.")
                .default("ten")
                .validate(Number("Use decimal digits.")),
        )
        .action(values);
    for argv in [&[][..], &["--size", "20"], &["--unknown"]] {
        assert_fault(
            &run_with(&app, fields(argv, &[])).await,
            "invalid-default",
            &[
                "Option \"size\" has an invalid default.",
                "Option \"size\": Use decimal digits.",
            ],
            "Fix the default or its validator.",
        );
    }
}

// The plugin-invalid-default and plugin-invalid-implied rows: the finding marks the setter in the
// plugin's own `option` call.

#[tokio::test]
async fn a_plugins_option_with_a_rejected_default_marks_the_default_in_the_plugins_call() {
    let app = Application::new("probe")
        .description("Probe.")
        .plugins([Plugin::new("@acme/log").option(
            "level",
            Opt::string()
                .description("Level.")
                .default("x")
                .validate(Digits("Use a whole number.")),
        )])
        .command(Command::new("get").action(values));
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_fault(
        &ran,
        "invalid-default",
        &[
            "Option \"level\" has an invalid default.",
            "Option \"level\": Use a whole number.",
        ],
        "Fix the default or its validator.",
    );
    assert!(
        ran.stderr.contains(concat!(
            "\n\n    Plugin::new(\"@acme/log\").option(\"level\", Opt::string().description(\"Level.\").default(\"x\").validate(…))\n",
            "                                                                                 ^^^^^^^^^^^^\n\n",
        )),
        "{}",
        ran.stderr
    );
}

#[tokio::test]
async fn a_plugins_option_with_a_rejected_implied_value_marks_implied_in_the_plugins_call() {
    let app = Application::new("probe")
        .description("Probe.")
        .plugins([Plugin::new("@acme/copy").option(
            "backup",
            Opt::string()
                .description("Backup.")
                .implied("x")
                .validate(OneOf(
                    &["none", "simple", "numbered"],
                    "Use none, simple, or numbered.",
                )),
        )])
        .command(Command::new("get").action(values));
    let ran = run_with(&app, fields(&[], &[])).await;
    assert_fault(
        &ran,
        "invalid-implied",
        &[
            "Option \"backup\" has an invalid implied value.",
            "Option \"backup\": Use none, simple, or numbered.",
        ],
        "Fix the implied value or its validator.",
    );
    assert!(
        ran.stderr.contains(concat!(
            "\n\n    Plugin::new(\"@acme/copy\").option(\"backup\", Opt::string().description(\"Backup.\").implied(\"x\").validate(…))\n",
            "                                                                                    ^^^^^^^^^^^^\n\n",
        )),
        "{}",
        ran.stderr
    );
}

#[tokio::test]
async fn omission_reaches_no_validator_while_an_empty_supplied_string_is_validated() {
    let recorded = calls();
    let app = Application::new("schema")
        .option(
            "size",
            Opt::string().validate(Echo {
                label: "size",
                calls: Arc::clone(&recorded),
            }),
        )
        .action(values);
    assert_eq!(
        printed(&run_with(&app, fields(&[], &[])).await)["options"],
        json!({})
    );
    assert!(seen(&recorded).is_empty());
    assert_eq!(
        printed(&run_with(&app, fields(&["--size="], &[])).await)["options"],
        json!({ "size": "" })
    );
    assert_eq!(seen(&recorded).len(), 1);
}

/// Rejects every value with the issues it names.
fn rejecting(messages: &[&str]) -> Rejecting {
    Rejecting(
        messages
            .iter()
            .map(|message| Issue::new(*message))
            .collect(),
    )
}

/// Rejects a value shorter than two characters.
#[derive(Clone)]
struct AtLeastTwo;

impl loomcli_core::Validator for AtLeastTwo {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<Issue>> {
        if input.chars().count() >= 2 {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new("Too short.")])
        }
    }
}

#[tokio::test]
async fn validator_issues_keep_declaration_and_validator_order_kind_and_position() {
    let app = Application::new("schema")
        .option(
            "same",
            Opt::string().validate(rejecting(&["First.", "Second."])),
        )
        .argument(
            "same",
            Arg::string().required().variadic().validate(AtLeastTwo),
        )
        .option("last", Opt::string().validate(rejecting(&["Last."])))
        .action(values);
    assert_eq!(
        run_with(&app, fields(&["--last", "bad", "x", "--same", "bad"], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "schema: Option \"--same\": First.\n\
                     schema: Option \"--same\": Second.\n\
                     schema: Argument \"same\" at 0: Too short.\n\
                     schema: Option \"--last\": Last.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn a_variadic_validator_transforms_each_value_leaving_passthrough_and_argv_intact() {
    let app = Application::new("schema")
        .argument("files", Arg::string().required().variadic().validate(Upper))
        .action(|ctx: Context| async move {
            let files: Vec<String> = ctx.argument("files")?;
            let line = json!({
                "args": { "files": { "count": files.len(), "joined": files.join(":") } },
                "argv": ctx.host.argv,
                "passthrough": ctx.passthrough,
            });
            ctx.out.print(&line.to_string()).await
        });
    let argv = ["one", "two", "--", "--size", "bad"];
    assert_eq!(
        printed(&run_with(&app, fields(&argv, &[])).await),
        json!({
            "args": { "files": { "count": 2, "joined": "ONE:TWO" } },
            "argv": argv,
            "passthrough": ["--size", "bad"],
        })
    );
}

#[tokio::test]
async fn required_value_options_reject_absence_and_defaults_stay_raw_without_a_validator() {
    let required = Application::new("schema")
        .option(
            "size",
            Opt::string()
                .required()
                .validate(Number("Use decimal digits.")),
        )
        .action(values);
    let ran = run_with(&required, fields(&[], &[])).await;
    assert_eq!(ran.status, 2);
    assert!(ran.stderr.contains("Option \"--size\" is required"));
    assert_eq!(
        printed(&run_with(&required, fields(&["--size", "12"], &[])).await)["options"],
        json!({ "size": 12 })
    );
    let raw = Application::new("schema")
        .option("size", Opt::string().default("raw"))
        .action(values);
    assert_eq!(
        printed(&run_with(&raw, fields(&[], &[])).await)["options"],
        json!({ "size": "raw" })
    );
}

// option-aliases.test.ts and spellings.test.ts: what validation reads through a spelling.

fn sizes() -> App {
    Application::new("sizes")
        .option(
            "min-bytes",
            Opt::string()
                .aliases(["minimum", "min"])
                .env(["SIZES_MIN_BYTES"])
                .validate(Digits("Use a whole number.")),
        )
        .option(
            "color",
            Opt::boolean()
                .aliases(["colour"])
                .polarity(loomcli_core::Polarity::Both),
        )
        .option(
            "quiet",
            Opt::boolean()
                .aliases(["silent"])
                .polarity(loomcli_core::Polarity::Negative),
        )
        .option("field", Opt::string().aliases(["column"]).multiple())
        .action(values)
}

#[tokio::test]
async fn an_alias_binds_its_option_beside_the_values_no_word_supplies() {
    let unset = json!({ "color": false, "field": [], "quiet": true });
    let with = |extra: Value| {
        let mut options = unset.clone();
        if let (Some(options), Some(extra)) = (options.as_object_mut(), extra.as_object()) {
            options.extend(extra.clone());
        }
        options
    };
    for (argv, extra) in [
        (&["--minimum", "5"][..], json!({ "min-bytes": "5" })),
        (&["--colour"], json!({ "color": true })),
        (&["--no-silent"], json!({ "quiet": false })),
        (
            &["--field", "a", "--column", "b"],
            json!({ "field": ["a", "b"] }),
        ),
    ] {
        assert_eq!(
            printed(&run_with(&sizes(), fields(argv, &[])).await)["options"],
            with(extra),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_typed_alias_wins_over_the_variable_and_validation_names_the_options_own_spelling() {
    assert_eq!(
        printed(
            &run_with(
                &sizes(),
                fields(&["--minimum", "1"], &[("SIZES_MIN_BYTES", "5")])
            )
            .await
        )["options"]["min-bytes"],
        json!("1")
    );
    assert_eq!(
        run_with(&sizes(), fields(&["--minimum", "x"], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "sizes: Option \"--min-bytes\": Use a whole number.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn one_spelling_reads_its_own_validated_value() {
    let set = loomcli_core::Command::new("set")
        .option("field", Opt::string().short('F').validate(Upper))
        .action(values);
    let app =
        Application::new("spellings").command(loomcli_core::Command::new("cache").command(set));
    assert_eq!(
        printed(&run_with(&app, fields(&["cache", "set", "-F", "x"], &[])).await)["options"],
        json!({ "field": "X" })
    );
}

// commands.test.ts: validation across the global options and the routed Command.

fn order() -> App {
    let rejected = |label: &str| Rejecting(vec![Issue::new(format!("{label} rejected."))]);
    let order = loomcli_core::Command::new("order")
        .option("local", Opt::string().validate(rejected("local")))
        .argument("path", Arg::string().required().validate(rejected("path")))
        .action(values);
    let pair = loomcli_core::Command::new("pair")
        .argument("one", Arg::string().required())
        .argument("two", Arg::string().required())
        .action(values);
    Application::new("order")
        .global_option("alpha", Opt::string().validate(rejected("alpha")))
        .global_option("beta", Opt::string().validate(rejected("beta")))
        .command(order)
        .command(pair)
        .action(values)
}

#[tokio::test]
async fn validation_reports_the_globals_in_authoring_order_then_the_command_declarations() {
    assert_eq!(
        run_with(
            &order(),
            fields(
                &["order", "--alpha", "a", "--beta", "b", "--local", "l", "x"],
                &[]
            )
        )
        .await
        .stderr,
        "order: Option \"--alpha\": alpha rejected.\n\
         order: Option \"--beta\": beta rejected.\n\
         order: Option \"--local\": local rejected.\n\
         order: Argument \"path\": path rejected.\n"
    );
}

#[tokio::test]
async fn scalar_arguments_bind_in_declaration_order_and_an_omitted_one_is_missing() {
    assert_eq!(
        printed(&run_with(&order(), fields(&["pair", "a", "b"], &[])).await)["args"],
        json!({ "one": "a", "two": "b" })
    );
    assert_eq!(
        run_with(&order(), fields(&["pair", "a"], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "order: Argument \"two\" requires a value. Supply a value for \"two\".\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn an_omitted_argument_aggregates_with_a_rejected_global_value() {
    let get = loomcli_core::Command::new("get")
        .argument("path", Arg::string().required())
        .action(values);
    let keys = loomcli_core::Command::new("keys").action(values);
    let app = Application::new("jsonkit")
        .global_option("file", Opt::string())
        .global_option(
            "limit",
            Opt::string().validate(Number("Use decimal digits.")),
        )
        .command(get)
        .command(keys);
    assert_eq!(
        run_with(
            &app,
            fields(&["--file", "data.json", "--limit", "abc", "get"], &[])
        )
        .await
        .stderr,
        "jsonkit: Option \"--limit\": Use decimal digits.\n\
         jsonkit: Argument \"path\" requires a value. Supply a value for \"path\".\n"
    );
    assert_eq!(
        run_with(
            &app,
            fields(&["--file", "data.json", "--limit", "abc", "keys"], &[])
        )
        .await
        .stderr,
        "jsonkit: Option \"--limit\": Use decimal digits.\n"
    );
    assert_eq!(
        printed(
            &run_with(
                &app,
                fields(&["--file", "data.json", "--limit", "12", "keys"], &[])
            )
            .await
        )["options"],
        json!({ "file": "data.json", "limit": 12 })
    );
}
