//! Ports the run cases of `interaction.test.ts` and `linked-value.test.ts`: the interaction
//! decision from the terminal facts, `CI`, and the marked option; conditional requiredness;
//! `missing_input_error`; and linked validation in the question phase. The interaction plugin's
//! marked option is declared here as the Application's own global option, which is what the plugin
//! declares.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, Context, Done, Error, Issue, NoInputs, NoResult, Open, Opt, Polarity,
    ValidationContext, ValidationPhase, Validator, ValueLink, missing_input_error,
    question_validation_context, validate_linked_value,
};
use loomcli_testing::{MockFields, MockTerminal, StreamName};
use serde_json::{Value, json};
use support::validators::Number;
use support::{Ran, record_json, run_with, values_json};

type App = Application<NoInputs, NoResult, Done>;

/// A terminal holding stdin (a keyboard with nothing typed) and both output streams.
fn terminal() -> MockTerminal {
    MockTerminal::new(80, 24).keys(Vec::<&str>::new())
}

/// An action that prints the interaction decision, the validated values, and the supplied record.
async fn decided(ctx: Context) -> loomcli_core::Outcome {
    let line = json!({
        "interactive": ctx.interactive,
        "values": values_json(&ctx),
        "supplied": { "args": record_json(&ctx.supplied.args), "options": record_json(&ctx.supplied.options) },
    });
    ctx.out.print(&line.to_string()).await
}

fn printed(ran: &Ran) -> Value {
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""), "{ran:?}");
    serde_json::from_str(ran.stdout.trim()).unwrap_or(Value::Null)
}

/// `fixtures/interaction.mjs`: a port required when input is not interactive, read as a number.
fn setup() -> App {
    Application::new("setup")
        .description("Configure the service.")
        .option(
            "port",
            Opt::string()
                .description("Service port.")
                .required_when_non_interactive()
                .validate(Number("Use a port number.")),
        )
        .action(decided)
}

#[tokio::test]
async fn conditional_requiredness_rejects_missing_input_before_dispatch_without_interaction() {
    let ran = run_with(&setup(), MockFields::new()).await;
    assert_eq!(
        ran,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "setup: Option \"--port\" is required when input is not interactive. Supply a value.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn actions_see_the_raw_supplied_value_beside_the_validated_value() {
    let ran = run_with(&setup(), MockFields::new().argv(["--port", "8080"])).await;
    let printed = printed(&ran);
    assert_eq!(printed["interactive"], json!(false));
    assert_eq!(printed["values"]["options"]["port"], json!(8080));
    assert_eq!(printed["supplied"]["options"]["port"], json!("8080"));
}

#[tokio::test]
async fn with_stdin_and_stderr_terminals_ci_decides_interaction() {
    for (ci, interactive) in [
        (Some("true"), false),
        (Some(""), true),
        (Some("false"), true),
        (None, true),
    ] {
        let app = Application::new("setup").action(decided);
        let fields = MockFields::new().terminal(terminal());
        let fields = match ci {
            Some(value) => fields.env("CI", value),
            None => fields,
        };
        assert_eq!(
            printed(&run_with(&app, fields).await)["interactive"],
            json!(interactive),
            "CI={ci:?}"
        );
    }
}

#[tokio::test]
async fn under_ci_an_omitted_conditionally_required_option_fails_before_the_action() {
    let app = Application::new("setup")
        .option(
            "port",
            Opt::string()
                .description("Service port.")
                .required_when_non_interactive(),
        )
        .action(|_: Context| async {
            Err(Error::from(std::io::Error::other(
                "The action must not run.",
            )))
        });
    let ran = run_with(
        &app,
        MockFields::new().env("CI", "true").terminal(terminal()),
    )
    .await;
    assert_eq!(ran.status, 2);
    assert!(
        ran.stderr.contains(
            "Option \"--port\" is required when input is not interactive. Supply a value."
        )
    );
}

#[tokio::test]
async fn piped_stdin_or_redirected_stderr_turns_interaction_off_and_stdout_plays_no_part() {
    let app = Application::new("setup").action(decided);
    for (terminal, interactive) in [
        // Stdin on a keyboard, stdout piped: still interactive.
        (terminal().streams([StreamName::Stderr]), true),
        // Stderr redirected.
        (terminal().streams([StreamName::Stdout]), false),
        // Stdin piped.
        (MockTerminal::new(80, 24), false),
    ] {
        assert_eq!(
            printed(&run_with(&app, MockFields::new().terminal(terminal)).await)["interactive"],
            json!(interactive)
        );
    }
}

/// `fixtures/interaction-policy.mjs`: the interaction plugin's marked `--no-input`, bound to
/// `SETUP_INPUT`, beside a conditionally required port.
fn policy() -> App {
    Application::new("setup")
        .description("Configure the service.")
        .global_option(
            "input",
            Opt::boolean()
                .description("Ask no questions, and take every answer from options.")
                .polarity(Polarity::Negative)
                .interaction()
                .env(["SETUP_INPUT"]),
        )
        .option(
            "port",
            Opt::string()
                .description("Service port.")
                .required_when_non_interactive(),
        )
        .action(decided)
}

#[tokio::test]
async fn the_marked_option_can_turn_interaction_off_and_never_on() {
    let terminal = || terminal().streams([StreamName::Stderr]);
    for (argv, env, interactive) in [
        (&[][..], None, true),
        (&["--no-input", "--port", "8080"][..], None, false),
        (&["--port", "8080"][..], Some("false"), false),
    ] {
        let fields = MockFields::new()
            .argv(argv.iter().copied())
            .terminal(terminal());
        let fields = match env {
            Some(value) => fields.env("SETUP_INPUT", value),
            None => fields,
        };
        assert_eq!(
            printed(&run_with(&policy(), fields).await)["interactive"],
            json!(interactive),
            "{argv:?} {env:?}"
        );
    }
    // A marked option that reads true with stdin piped leaves the decision off.
    let ran = run_with(
        &policy(),
        MockFields::new()
            .argv(["--port", "1"])
            .env("SETUP_INPUT", "true"),
    )
    .await;
    assert_eq!(printed(&ran)["interactive"], json!(false));
}

#[tokio::test]
async fn conditional_arguments_and_collected_options_require_input_only_off_a_terminal() {
    let app = Application::new("clone")
        .argument("url", Arg::string().required_when_non_interactive())
        .option(
            "tag",
            Opt::string().multiple().required_when_non_interactive(),
        )
        .action(decided);
    let at_terminal = printed(&run_with(&app, MockFields::new().terminal(terminal())).await);
    assert_eq!(
        json!([at_terminal["values"], at_terminal["supplied"]]),
        json!([
            { "args": {}, "options": { "tag": [] } },
            { "args": {}, "options": { "tag": [] } },
        ])
    );
    let batch = run_with(&app, MockFields::new()).await;
    assert_eq!(batch.status, 2);
    assert_eq!(
        batch.stderr,
        "clone: Argument \"url\" requires a value when input is not interactive. Supply a value for \"url\".\n\
         clone: Option \"--tag\" is required when input is not interactive. Supply at least one value.\n"
    );
    let graph = app.inspect().expect("the graph builds");
    let argument = serde_json::to_value(&graph.root.arguments[0]).expect("the node serializes");
    assert_eq!(
        json!([argument["required"], argument["requiredWhen"]]),
        json!([false, "non-interactive"])
    );
}

#[tokio::test]
async fn a_conditional_variadic_argument_is_an_empty_list_at_a_terminal() {
    let app = Application::new("copy")
        .argument(
            "files",
            Arg::string().variadic().required_when_non_interactive(),
        )
        .action(decided);
    let ran = printed(&run_with(&app, MockFields::new().terminal(terminal())).await);
    assert_eq!(
        json!([ran["values"]["args"], ran["supplied"]["args"]]),
        json!([{ "files": [] }, { "files": [] }])
    );
    let batch = run_with(&app, MockFields::new()).await;
    assert_eq!(
        batch.stderr,
        "copy: Argument \"files\" requires at least one value when input is not interactive. Supply a value for \"files\".\n"
    );
}

/// An application whose action returns `missing_input_error` for `link`.
fn missing<S: Open>(app: Application<NoInputs, NoResult, S>, link: ValueLink) -> App {
    app.action(move |ctx: Context| {
        let error = missing_input_error(&ctx, &link);
        async move { Err(error) }
    })
}

#[tokio::test]
async fn missing_input_error_identifies_an_argument_beside_an_option_of_the_same_name() {
    let app = missing(
        Application::new("clone")
            .argument("url", Arg::string())
            .option("url", Opt::string()),
        ValueLink::argument("url", "Repository URL"),
    );
    let ran = run_with(&app, MockFields::new()).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "clone: Argument \"url\" requires a value when input is not interactive. Supply a value for \"url\".\n"
        )
    );
}

#[tokio::test]
async fn missing_input_error_reads_the_fix_each_option_kind_takes() {
    for (option, fix) in [
        (
            Opt::string().multiple().into(),
            "Supply at least one value.",
        ),
        (Opt::content().multiple().into(), "Supply a value."),
        (Opt::string().into(), "Supply a value."),
    ] {
        let option: loomcli_core::OptionDecl = option;
        let app = missing(
            Application::new("clone").option("tag", option),
            ValueLink::option("tag", "Tags"),
        );
        let ran = run_with(&app, MockFields::new()).await;
        assert_eq!(
            (ran.status, ran.stderr),
            (
                2,
                format!(
                    "clone: Option \"--tag\" is required when input is not interactive. {fix}\n"
                )
            )
        );
    }
}

#[tokio::test]
async fn missing_input_error_names_a_booleans_spellings_and_reads_the_interaction_decision() {
    for (polarity, fix) in [
        (Polarity::Both, "Supply \"--install\" or \"--no-install\"."),
        (Polarity::Positive, "Supply \"--install\"."),
        (Polarity::Negative, "Supply \"--no-install\"."),
    ] {
        let app = missing(
            Application::new("setup").option("install", Opt::boolean().polarity(polarity)),
            ValueLink::option("install", "Install?"),
        );
        let ran = run_with(&app, MockFields::new().terminal(terminal())).await;
        // At a terminal the decision is on, so the sentence has no condition.
        let spelling = if polarity == Polarity::Negative {
            "--no-install"
        } else {
            "--install"
        };
        assert_eq!(
            (ran.status, ran.stderr),
            (
                2,
                format!("setup: Option \"{spelling}\" is required. {fix}\n")
            ),
            "{polarity:?}"
        );
    }
}

#[tokio::test]
async fn missing_input_error_for_a_variadic_argument_asks_for_at_least_one_value() {
    let app = missing(
        Application::new("copy").argument("files", Arg::string().variadic()),
        ValueLink::argument("files", "Files"),
    );
    let ran = run_with(&app, MockFields::new()).await;
    assert_eq!(
        ran.stderr,
        "copy: Argument \"files\" requires at least one value when input is not interactive. Supply a value for \"files\".\n"
    );
}

#[tokio::test]
async fn missing_input_error_rejects_an_input_the_routed_command_does_not_declare() {
    for (link, sentence, correction) in [
        (
            ValueLink::option("port", "Port"),
            "missing_input_error() received option \"port\", which the root Command does not declare.",
            "Supply the name of a local option of the routed Command.",
        ),
        (
            ValueLink::argument("url", "URL"),
            "missing_input_error() received argument \"url\", which the root Command does not declare.",
            "Supply the name of an argument of the routed Command.",
        ),
    ] {
        let app = missing(Application::new("clone").description("Clone."), link);
        let ran = run_with(&app, MockFields::new()).await;
        assert_eq!(ran.status, 1);
        for part in ["@loomcli/core/missing-input-name", sentence, correction] {
            assert!(ran.stderr.contains(part), "{part}: {}", ran.stderr);
        }
    }
}

#[tokio::test]
async fn a_global_option_is_no_local_option_of_the_routed_command() {
    let app = missing(
        Application::new("clone").global_option("port", Opt::string()),
        ValueLink::option("port", "Port"),
    );
    let ran = run_with(&app, MockFields::new()).await;
    assert_eq!(ran.status, 1);
    assert!(ran.stderr.contains("@loomcli/core/missing-input-name"));
}

// linked-value.test.ts

/// Answers each value as a number and records the context of each call.
#[derive(Clone)]
struct Ports {
    contexts: Arc<Mutex<Vec<(ValidationPhase, Value)>>>,
}

impl Validator for Ports {
    type Output = u64;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<u64, Vec<Issue>> {
        if let Ok(mut contexts) = self.contexts.lock() {
            contexts.push((context.phase, json!(context.input)));
        }
        input
            .parse()
            .map_err(|_| vec![Issue::new("Use a port number.")])
    }
}

#[tokio::test]
async fn linked_validation_runs_the_declared_validator_in_the_question_phase() {
    let contexts = Arc::new(Mutex::new(Vec::new()));
    let answers = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&answers);
    let app = Application::new("linked")
        .option(
            "port",
            Opt::string().multiple().validate(Ports {
                contexts: Arc::clone(&contexts),
            }),
        )
        .option("name", Opt::string())
        .action(move |ctx: Context| {
            let link = ValueLink::option("port", "Ports");
            let accepted = validate_linked_value::<u64, _, _>(&ctx, &link, "443");
            let rejected = validate_linked_value::<u64, _, _>(&ctx, &link, "https");
            let mistyped = validate_linked_value::<String, _, _>(&ctx, &link, "443");
            let plain = validate_linked_value::<String, _, _>(
                &ctx,
                &ValueLink::option("name", "Name"),
                "x",
            );
            if let Ok(mut answers) = recorded.lock() {
                answers.push(json!({
                    "accepted": accepted.ok().and_then(Result::ok),
                    "rejected": rejected.ok().and_then(Result::err).map(|issues| issues.len()),
                    "mistyped": mistyped.is_err(),
                    "plain": plain.ok().and_then(Result::ok),
                }));
            }
            async { Ok(()) }
        });
    let ran = run_with(&app, MockFields::new()).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        answers
            .lock()
            .map(|answers| answers.clone())
            .unwrap_or_default(),
        [json!({ "accepted": 443, "rejected": 1, "mistyped": true, "plain": "x" })]
    );
    let seen = contexts
        .lock()
        .map(|contexts| contexts.clone())
        .unwrap_or_default();
    assert!(seen.contains(&(
        ValidationPhase::Question,
        json!({ "global": false, "kind": "option", "name": "port" })
    )));
}

#[tokio::test]
async fn a_question_context_carries_the_run_and_names_an_unlinked_question_by_its_message() {
    let contexts = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&contexts);
    let app = Application::new("ask")
        .argument("name", Arg::string())
        .action(move |ctx: Context| {
            let unlinked = question_validation_context(&ctx, None, "Your name?");
            let linked = question_validation_context(
                &ctx,
                Some(&ValueLink::argument("name", "Name")),
                "Name",
            );
            if let Ok(mut contexts) = recorded.lock() {
                for context in [unlinked, linked] {
                    contexts.push(json!({
                        "phase": format!("{:?}", context.phase),
                        "input": context.input,
                        "command": context.command,
                        "passthrough": context.passthrough,
                        "sameHost": Arc::ptr_eq(&context.host, &ctx.host),
                        "supplied": context.supplied.map(|supplied| record_json(&supplied.args)),
                    }));
                }
            }
            async { Ok(()) }
        });
    let ran = run_with(&app, MockFields::new().argv(["ada", "--", "tail"])).await;
    assert_eq!(ran.status, 0);
    let shared = |input: Value| {
        json!({
            "phase": "Question",
            "input": input,
            "command": [],
            "passthrough": ["tail"],
            "sameHost": true,
            "supplied": { "name": "ada" },
        })
    };
    assert_eq!(
        contexts
            .lock()
            .map(|contexts| contexts.clone())
            .unwrap_or_default(),
        [
            shared(json!({ "global": false, "kind": "question", "name": "Your name?" })),
            shared(json!({ "global": false, "kind": "argument", "name": "name" })),
        ]
    );
}

// interaction.test.ts: the decision by name, cancellation, a conditional input by name, and
// `out.draw`.

#[tokio::test]
async fn an_invocation_by_name_decides_no_interaction() {
    let outcome = policy()
        .invoke(
            &[],
            loomcli_core::InvocationValues::new().option("port", "8080"),
            loomcli_core::InvokeOptions::<Error>::new(),
            Some(loomcli_testing::mock_process(MockFields::new()) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Completed { output, .. } = outcome else {
        panic!("the call completes");
    };
    let printed: Value = serde_json::from_str(output.trim()).unwrap();
    assert_eq!(printed["interactive"], json!(false));
}

#[tokio::test]
async fn action_cancellation_is_silent_and_resolves_the_normal_cancellation_status() {
    let app: App = Application::new("setup")
        .description("Configure the service.")
        .option(
            "port",
            Opt::string()
                .description("Service port.")
                .required_when_non_interactive(),
        )
        .action(|ctx: Context| async move {
            ctx.cancel();
            ctx.signal.throw_if_cancelled()
        });
    let ran = run_with(
        &app,
        MockFields::new().terminal(terminal().streams([StreamName::Stderr])),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (130, ""));
}

#[tokio::test]
async fn a_conditional_variadic_argument_is_missing_by_name() {
    let app = Application::new("copy")
        .argument(
            "files",
            Arg::string().variadic().required_when_non_interactive(),
        )
        .action(decided);
    let outcome = app
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<Error>::new(),
            Some(loomcli_testing::mock_process(MockFields::new()) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Failed { exit_code, .. } = outcome else {
        panic!("the call fails");
    };
    assert_eq!(exit_code.get(), 2);
}

/// What one `out.draw` of `text` between two info lines did on a terminal stderr `columns` wide:
/// the code, the rows it reported, and stderr's bytes.
async fn draw(columns: u16, text: &'static str) -> (u8, usize, String) {
    let rows = Arc::new(Mutex::new(0));
    let app: App = Application::new("draw")
        .description("Draw terminal output.")
        .action({
            let rows = Arc::clone(&rows);
            move |ctx: Context| {
                let rows = Arc::clone(&rows);
                async move {
                    ctx.out.info("before").await?;
                    let drawn = ctx
                        .out
                        .draw(
                            text,
                            &loomcli_core::View::new(|value: &str, _| {
                                format!("\u{1b}[?25l{value}\u{1b}[?25h")
                            }),
                        )
                        .await?;
                    *rows.lock().unwrap() = drawn;
                    ctx.out.info("after").await
                }
            }
        });
    let ran = run_with(
        &app,
        MockFields::new().terminal(MockTerminal::new(columns, 24).streams([StreamName::Stderr])),
    )
    .await;
    let drawn = *rows.lock().unwrap();
    (ran.status, drawn, ran.stderr)
}

#[tokio::test]
async fn draw_preserves_controls_on_terminal_stderr_reports_wrapped_rows_and_keeps_write_order() {
    assert_eq!(
        draw(4, "abcdef\n\u{754c}\u{754c}\n").await,
        (
            0,
            3,
            "\u{2139} before\n\u{1b}[?25labcdef\n\u{754c}\u{754c}\n\u{1b}[?25h\u{2139} after\n"
                .to_owned()
        )
    );
}

#[tokio::test]
async fn draw_counts_wide_graphemes_tab_stops_and_a_standalone_carriage_return() {
    assert_eq!(draw(3, "\u{754c}\u{754c}\u{754c}\n").await.1, 3);
    assert_eq!(draw(10, "ab\tXXX\n").await.1, 2);
    assert_eq!(draw(4, "abc\rdef").await.1, 0);
}

#[tokio::test]
async fn view_plain_text_strips_styles_and_controls_while_retaining_destination_glyph_forms() {
    let app: App = Application::new("view")
        .description("Resolve view text.")
        .rendering(
            loomcli_core::RenderingPolicy::new()
                .color(loomcli_core::Switch::Always)
                .modifiers(loomcli_core::Switch::Always)
                .terminal_controls(loomcli_core::TerminalControls::Preserve),
        )
        .action(|ctx: Context| async move {
            let seen = Arc::new(Mutex::new((String::new(), 0)));
            ctx.out
                .draw(
                    "",
                    &loomcli_core::View::new({
                        let seen = Arc::clone(&seen);
                        move |_: &str, context: &loomcli_core::ViewContext| {
                            let plain = context.plain(&format!(
                                "{} {}\u{1b}[2J",
                                loomcli_core::style().bold().apply("Name"),
                                loomcli_core::Glyph::Pointer.marked()
                            ));
                            let cells = context.width(&context.style.escape(&plain));
                            *seen.lock().unwrap() = (plain, cells);
                            String::new()
                        }
                    }),
                )
                .await?;
            let (plain, cells) = seen.lock().unwrap().clone();
            ctx.out
                .print(&json!({ "cells": cells, "plain": plain }).to_string())
                .await
        });
    let ran = run_with(
        &app,
        MockFields::new().env("TERM", "linux").platform("linux"),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: "{\"cells\":6,\"plain\":\"Name >\"}\n".to_owned(),
            stderr: String::new(),
        }
    );
}
