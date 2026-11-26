//! Ports terminal-need.test.ts through argv and the two named invocation entry points.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Command, Context, FailureFacts, FatalError, GroupApplication,
    InvocationOutcome, InvocationValues, InvokeOptions, Opt, Outcome, Plugin, Polarity, RunOptions,
    TerminalUnavailableError,
};
use loomcli_testing::{MockFields, MockTerminal, StreamName, mock_process};

const SENTENCE: &str = "Command \"top\" needs a terminal. Run \"monitor top\" with stdin and stderr at a terminal, outside CI.";

fn terminal() -> MockTerminal {
    MockTerminal::new(80, 24).keys(Vec::<&str>::new())
}

async fn ran(ctx: Context) -> Outcome {
    ctx.out.print("ran").await
}

fn monitor() -> GroupApplication {
    Application::new("monitor")
        .global_option(
            "input",
            Opt::boolean().polarity(Polarity::Negative).interaction(),
        )
        .command(Command::new("top").needs_terminal().action(ran))
        .command(Command::new("list").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(&["top"], InvocationValues::new(), InvokeOptions::new())
                .await;
            let InvocationOutcome::Failed { form, .. } = outcome else {
                panic!("nested invocation should fail");
            };
            ctx.out.print(&form.code).await
        }))
}

async fn run<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    fields: MockFields,
) -> (u8, String, String) {
    let process = mock_process(fields);
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn terminal_readiness_uses_stdin_and_stderr_outside_ci() {
    let app = monitor();
    for (argv, terminal) in [
        (&["top"][..], terminal()),
        (&["top"][..], terminal().streams([StreamName::Stderr])),
        (&["top", "--no-input"][..], terminal()),
    ] {
        assert_eq!(
            run(
                &app,
                MockFields::new()
                    .argv(argv.iter().copied())
                    .terminal(terminal)
            )
            .await,
            (0, "ran\n".to_owned(), String::new())
        );
    }
    for fields in [
        MockFields::new().terminal(MockTerminal::new(80, 24).streams([StreamName::Stderr])),
        MockFields::new().terminal(terminal().streams([StreamName::Stdout])),
        MockFields::new().terminal(terminal()).env("CI", "true"),
    ] {
        assert_eq!(
            run(&app, fields.argv(["top"])).await,
            (1, String::new(), format!("{SENTENCE}\n"))
        );
    }
    let plain = Application::new("monitor").command(Command::new("top").action(ran));
    assert_eq!(
        run(&plain, MockFields::new().argv(["top"])).await,
        (0, "ran\n".to_owned(), String::new())
    );
}

#[tokio::test]
async fn by_name_refuses_terminal_need_even_from_a_run_at_a_terminal() {
    let app = monitor();
    let outcome = app
        .invoke(
            &["top"],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new().terminal(terminal()))),
        )
        .await;
    let InvocationOutcome::Failed {
        form,
        failure,
        exit_code,
        ..
    } = outcome
    else {
        panic!("expected failure");
    };
    let terminal = failure
        .downcast_failure::<TerminalUnavailableError>()
        .unwrap();
    assert_eq!(terminal.command(), ["top"]);
    assert_eq!(terminal.message(), SENTENCE);
    assert!(failure.downcast_failure::<FatalError>().is_some());
    assert_eq!(form.code, "terminal-unavailable");
    assert_eq!(exit_code.get(), 1);

    assert_eq!(
        run(
            &app,
            MockFields::new().argv(["list"]).terminal(self::terminal())
        )
        .await,
        (0, "terminal-unavailable\n".to_owned(), String::new())
    );
}

#[tokio::test]
async fn the_terminal_fault_outranks_collected_input_problems() {
    let codes = Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = Arc::clone(&codes);
    let app = Application::new("monitor")
        .plugins((
            Plugin::new("fixture/terminal-rank").on_log(move |event, _| {
                if let Some(form) = &event.failure {
                    recorded.lock().unwrap().push(form.code.clone());
                }
            }),
        ))
        .command(
            Command::new("top")
                .needs_terminal()
                .argument(
                    "interval",
                    Arg::string()
                        .required()
                        .validate(support::validators::Digits("Use decimal digits.")),
                )
                .action(ran),
        );
    for words in [&["top"][..], &["top", "nope"][..]] {
        let fields = MockFields::new()
            .argv(words.iter().copied())
            .terminal(MockTerminal::new(80, 24).streams([StreamName::Stderr]));
        assert_eq!(
            run(&app, fields).await,
            (1, String::new(), format!("{SENTENCE}\n"))
        );
    }
    assert_eq!(
        *codes.lock().unwrap(),
        ["terminal-unavailable", "terminal-unavailable"]
    );
}

#[tokio::test]
async fn the_root_names_the_application() {
    let app = Application::new("monitor").needs_terminal().action(ran);
    assert_eq!(run(&app, MockFields::new()).await, (
        1, String::new(),
        "The root Command needs a terminal. Run \"monitor\" with stdin and stderr at a terminal, outside CI.\n".to_owned(),
    ));
}

#[test]
fn inspect_publishes_the_terminal_need_on_every_node() {
    let graph = monitor().inspect().unwrap();
    assert!(!graph.root.needs_terminal);
    assert!(graph.command(&["top"]).unwrap().needs_terminal);
    assert!(!graph.command(&["list"]).unwrap().needs_terminal);
}

#[test]
fn a_group_terminal_need_and_a_repeated_setter_fault() {
    let fault = std::panic::catch_unwind(|| {
        let _ = Application::new("monitor").command(
            Command::new("watch")
                .needs_terminal()
                .command(Command::new("cpu").action(ran)),
        );
    })
    .expect_err("expected a fault");
    let fault = fault.downcast::<String>().unwrap();
    assert!(fault.contains("@loomcli/core/command-without-action"));
    assert!(fault.contains("Command \"watch\" needs a terminal but registers no action."));
    assert!(fault.contains(
        "Declare needs_terminal() on the Command whose action needs it, or register an action."
    ));
    let fault = std::panic::catch_unwind(|| {
        let _ = Application::new("monitor")
            .needs_terminal()
            .needs_terminal();
    })
    .expect_err("expected a fault");
    assert!(
        fault
            .downcast::<String>()
            .unwrap()
            .contains("@loomcli/core/terminal-need-declared-twice")
    );
}
