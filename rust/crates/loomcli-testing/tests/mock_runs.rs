//! Ports the cases of `mock-process.test.ts` that run an Application on the mock: a run's output and
//! exit code, the facts it reads, the terminal width, several runs, an invocation by name, a signal,
//! the folders, child programs through `host.spawn`, and a keyboard's interactive run. The cases of
//! the mock alone are in `mock_process.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, ChildExit, ChildStream, Command, Context, Done, EnvironmentAdditions,
    EnvironmentContext, InvocationOutcome, InvocationValues, InvokeOptions, NoInputs, NoResult,
    Plugin, ProcessHandle, ProcessSignal, RunOptions, SpawnOptions,
};
use loomcli_testing::{
    MockFields, MockProcess, MockTerminal, ProgramAnswer, ProgramCall, Write, mock_process,
};

type App = Application<NoInputs, NoResult, Done>;

/// The reference's fixture: a root that prints `hello`, a Command that needs an argument, one that
/// prints stdout's width, and one that prints the facts a run reads.
fn application() -> App {
    Application::new("app")
        .description("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi")
        .command(
            Command::new("need")
                .argument("name", Arg::string().required())
                .action(|ctx: Context| async move { ctx.out.print("x").await }),
        )
        .command(Command::new("width").action(|ctx: Context| async move {
            let columns = ctx
                .host
                .terminal
                .stdout()
                .columns
                .map_or_else(|| "undefined".to_owned(), |columns| columns.to_string());
            ctx.out.print(&format!("columns:{columns}")).await
        }))
        .command(Command::new("facts").action(|ctx: Context| async move {
            let facts = serde_json::json!({
                "cwd": ctx.host.cwd,
                "env": ctx.host.env,
                "platform": ctx.host.platform,
                "uid": ctx.host.uid,
            });
            ctx.out.print(&facts.to_string()).await
        }))
        .action(|ctx: Context| async move { ctx.out.print("hello").await })
}

async fn run(app: &App, mock: &Arc<MockProcess>) -> u8 {
    app.run(RunOptions::new().process(Arc::clone(mock) as Arc<dyn ProcessHandle>))
        .await
        .get()
}

#[tokio::test]
async fn a_run_prints_to_stdout_and_sets_the_exit_code() {
    let mock = mock_process(MockFields::new());
    let code = run(&application(), &mock).await;
    assert_eq!(
        (
            code,
            mock.exit_code().map(|code| code.get()),
            mock.stdout_text(),
            mock.stderr_text()
        ),
        (0, Some(0), "hello\n".to_owned(), String::new())
    );
}

#[tokio::test]
async fn a_usage_error_goes_to_stderr_with_exit_2() {
    let mock = mock_process(MockFields::new().argv(["need"]));
    assert_eq!(run(&application(), &mock).await, 2);
    assert_eq!(mock.exit_code().map(|code| code.get()), Some(2));
    assert_eq!(mock.stdout_text(), "");
    assert_eq!(
        mock.stderr_text(),
        "app: Argument \"name\" requires a value. Supply a value for \"name\".\n"
    );
}

#[tokio::test]
async fn a_run_reads_the_mock_facts_and_not_the_real_process() {
    let mock = mock_process(
        MockFields::new()
            .argv(["facts"])
            .cwd("/work")
            .env("HOME", "/home"),
    );
    run(&application(), &mock).await;
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&mock.stdout_text()).unwrap(),
        serde_json::json!({ "cwd": "/work", "env": { "HOME": "/home" }, "platform": "linux", "uid": 1000 })
    );
}

#[tokio::test]
async fn the_terminal_width_reaches_the_run_and_a_resize_changes_the_next_one() {
    let mock = mock_process(
        MockFields::new()
            .argv(["width"])
            .terminal(MockTerminal::new(70, 20)),
    );
    run(&application(), &mock).await;
    mock.resize(50, 20);
    run(&application(), &mock).await;
    assert_eq!(mock.stdout_text(), "columns:70\ncolumns:50\n");
}

#[tokio::test]
async fn with_no_terminal_the_width_is_undefined() {
    let mock = mock_process(MockFields::new().argv(["width"]));
    run(&application(), &mock).await;
    assert_eq!(mock.stdout_text(), "columns:undefined\n");
}

#[tokio::test]
async fn a_mock_records_several_runs_in_order() {
    let mock = mock_process(MockFields::new());
    run(&application(), &mock).await;
    run(&application(), &mock).await;
    assert_eq!(mock.stdout_text(), "hello\nhello\n");
    assert_eq!(mock.transcript().len(), 2);
}

#[tokio::test]
async fn an_invocation_by_name_reads_the_mock_facts_and_records_nothing_on_it() {
    let mock = mock_process(MockFields::new().cwd("/named").env("HOME", "/named-home"));
    let outcome = application()
        .invoke(
            &["facts"],
            InvocationValues::new(),
            InvokeOptions::<loomcli_core::Error>::new(),
            Some(Arc::clone(&mock) as Arc<dyn ProcessHandle>),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = outcome else {
        panic!("the invocation did not complete");
    };
    let facts: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert_eq!(facts["cwd"], "/named");
    assert_eq!(facts["env"], serde_json::json!({ "HOME": "/named-home" }));
    assert_eq!(
        (
            mock.stdout_text(),
            mock.stderr_text(),
            mock.exit_code(),
            mock.transcript()
        ),
        (String::new(), String::new(), None, Vec::new())
    );
}

#[tokio::test]
async fn a_signal_raised_during_a_run_cancels_it_and_the_re_raise_ends_the_mock() {
    let mock = mock_process(MockFields::new());
    let raiser = Arc::clone(&mock);
    let app = Application::new("app").action(move |ctx: Context| {
        let raiser = Arc::clone(&raiser);
        async move {
            raiser.raise(ProcessSignal::Int);
            ctx.signal.cancelled().await;
            Ok(())
        }
    });
    let code = run(&app, &mock).await;
    assert_eq!(code, 130);
    assert_eq!(mock.exit_code().map(|code| code.get()), Some(130));
    // The last run to leave a shutdown ends it before `run()` returns, a recorded deviation.
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
}

#[tokio::test]
async fn a_run_reads_the_mock_folders_and_environment_preparation_moves_neither() {
    let mock = mock_process(MockFields::new().env("HOME", "/srv/home"));
    let dotenv = Plugin::new("fixture/dotenv").on_environment(|_ctx: EnvironmentContext| async {
        Ok::<EnvironmentAdditions, loomcli_core::Error>(BTreeMap::from([(
            "TMPDIR".to_owned(),
            "/moved/tmp".to_owned(),
        )]))
    });
    let app = Application::new("app")
        .plugins((dotenv,))
        .action(|ctx: Context| async move {
            let line = format!(
                "{} {} {}",
                ctx.host.home.display(),
                ctx.host.tmpdir.display(),
                ctx.host.env.get("TMPDIR").map_or("", String::as_str)
            );
            ctx.out.print(&line).await
        });
    run(&app, &mock).await;
    assert_eq!(mock.stdout_text(), "/srv/home /loom-test/tmp /moved/tmp\n");
}

#[tokio::test]
async fn an_empty_keyboard_is_a_terminal_stdin_so_the_run_is_interactive() {
    let mock = mock_process(
        MockFields::new()
            .terminal(MockTerminal::new(80, 24).keys(Vec::<loomcli_testing::KeyEntry>::new())),
    );
    let app = Application::new("app")
        .action(|ctx: Context| async move { ctx.out.print(&ctx.interactive.to_string()).await });
    assert_eq!(run(&app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "true\n");
}

/// An application whose root action starts one child and prints how it ended.
fn starting(command: &'static str, options: fn() -> SpawnOptions) -> App {
    Application::new("app").action(move |ctx: Context| async move {
        let exit = ctx
            .host
            .spawn(command, ["status"], options())
            .exited()
            .await;
        let line = match exit {
            ChildExit::Exited {
                code,
                stdout,
                stderr,
            } => format!("{code} [{}] [{}]", stdout.text, stderr.text),
            ChildExit::Unstarted { error } => format!("unstarted: {error}"),
            _ => "unknown".to_owned(),
        };
        ctx.out.print(&line).await
    })
}

#[tokio::test]
async fn a_script_answers_the_code_and_the_captured_output_from_the_call_core_filled_in() {
    let calls: Arc<Mutex<Vec<ProgramCall>>> = Arc::default();
    let seen = Arc::clone(&calls);
    let mock = mock_process(MockFields::new().cwd("/work").env("PATH", "/bin").script(
        "git",
        move |call| {
            seen.lock().unwrap().push(call);
            async {
                Ok(ProgramAnswer::new()
                    .code(3)
                    .stdout("answer")
                    .stderr(b"warned".to_vec()))
            }
        },
    ));
    run(
        &starting("git", || SpawnOptions::new().cwd("notes").input("typed")),
        &mock,
    )
    .await;
    assert_eq!(mock.stdout_text(), "3 [answer] [warned]\n");
    let calls = calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    let call = &calls[0];
    assert_eq!(call.args, ["status"]);
    assert_eq!(call.command, "git");
    assert_eq!(call.cwd, std::path::PathBuf::from("/work/notes"));
    assert!(!call.detached);
    assert_eq!(
        call.env,
        BTreeMap::from([("PATH".to_owned(), "/bin".to_owned())])
    );
    assert_eq!(call.input, "typed");
    assert!(!call.signal.is_cancelled());
}

#[tokio::test]
async fn an_answer_that_omits_its_members_exits_0_with_no_output() {
    let mock =
        mock_process(MockFields::new().script("git", |_| async { Ok(ProgramAnswer::new()) }));
    run(&starting("git", SpawnOptions::new), &mock).await;
    assert_eq!(mock.stdout_text(), "0 [] []\n");
}

#[tokio::test]
async fn an_inherited_stream_writes_to_the_mock_and_ignore_drops() {
    let mock = mock_process(MockFields::new().script("git", |_| async {
        Ok(ProgramAnswer::new().stdout("to-stdout").stderr("dropped"))
    }));
    run(
        &starting("git", || {
            SpawnOptions::new()
                .stdout(ChildStream::Inherit)
                .stderr(ChildStream::Ignore)
        }),
        &mock,
    )
    .await;
    assert_eq!(
        mock.transcript(),
        [
            Write::Stdout("to-stdout".to_owned()),
            Write::Stdout("0 [] []\n".to_owned())
        ]
    );
    let ignoring = mock_process(MockFields::new().script("git", |_| async {
        Ok(ProgramAnswer::new().stdout("o").stderr("e"))
    }));
    run(
        &starting("git", || {
            SpawnOptions::new()
                .stdout(ChildStream::Ignore)
                .stderr(ChildStream::Ignore)
        }),
        &ignoring,
    )
    .await;
    assert_eq!(ignoring.stdout_text(), "0 [] []\n");
}

#[tokio::test]
async fn under_an_inherited_stdin_the_calls_input_is_the_mock_stdin_text() {
    let inputs: Arc<Mutex<Vec<String>>> = Arc::default();
    let seen = Arc::clone(&inputs);
    let mock = mock_process(MockFields::new().stdin("piped").script("cat", move |call| {
        seen.lock().unwrap().push(call.input);
        async { Ok(ProgramAnswer::new()) }
    }));
    run(
        &starting("cat", || SpawnOptions::new().inherit_stdin()),
        &mock,
    )
    .await;
    run(&starting("cat", SpawnOptions::new), &mock).await;
    assert_eq!(*inputs.lock().unwrap(), ["piped", ""]);
}

#[tokio::test]
async fn under_an_inherited_stdin_byte_stdin_is_the_calls_input_decoded_as_utf8() {
    let inputs: Arc<Mutex<Vec<String>>> = Arc::default();
    let seen = Arc::clone(&inputs);
    let mock = mock_process(
        MockFields::new()
            .stdin("caf\u{e9}".as_bytes().to_vec())
            .script("cat", move |call| {
                seen.lock().unwrap().push(call.input);
                async { Ok(ProgramAnswer::new()) }
            }),
    );
    run(
        &starting("cat", || SpawnOptions::new().inherit_stdin()),
        &mock,
    )
    .await;
    assert_eq!(*inputs.lock().unwrap(), ["caf\u{e9}"]);
}

#[tokio::test]
async fn under_invoke_an_inherited_stream_reaches_the_outcome_not_the_mock() {
    let mock = mock_process(MockFields::new().script("git", |_| async {
        Ok(ProgramAnswer::new().stdout("through"))
    }));
    let outcome = starting("git", || SpawnOptions::new().stdout(ChildStream::Inherit))
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::<loomcli_core::Error>::new(),
            Some(Arc::clone(&mock) as Arc<dyn ProcessHandle>),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = outcome else {
        panic!("the invocation did not complete");
    };
    assert_eq!(output, "through0 [] []\n");
    assert_eq!(mock.transcript(), []);
}

#[tokio::test]
async fn a_script_that_fails_is_a_program_that_could_not_start() {
    let mock = mock_process(MockFields::new().script("git", |_| async {
        Err(std::io::Error::other("spawn git ENOENT"))
    }));
    run(&starting("git", SpawnOptions::new), &mock).await;
    assert_eq!(mock.stdout_text(), "unstarted: spawn git ENOENT\n");
}
