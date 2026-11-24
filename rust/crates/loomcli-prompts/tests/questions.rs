//! Ports `questions.test.ts`: the interaction decision a linked and an unlinked question obey, the
//! declaration faults a malformed question returns at its call, invocation by name, cancellation
//! on an embedding host and a mock keyboard, a view override beside a secret, and the validation
//! context a question's validator receives.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::collections::VecDeque;
use std::future::Future;
use std::io;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, BoxFuture, Context, DeclarationError, Error, InputStream, InputTerminal,
    InvocationOutcome, InvocationValues, InvokeOptions, Issue, Opt, OutputStream, OutputTerminal,
    ProcessFields, ProcessSignal, ProcessTerminal, RunOptions, ValidationContext, Validator, View,
    ViewContext, override_view, process_handle,
};
use loomcli_prompts::views::{QuestionFrame, question_frame};
use loomcli_prompts::{
    Choice, ConfirmSettings, SecretSettings, SelectSettings, TextSettings, Verbatim, confirm,
    secret, select, text,
};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, mock_process};
use support::{App, entry, run};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

/// A validator that reads a number.
#[derive(Clone, Copy)]
struct Number;

impl Validator for Number {
    type Output = f64;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<f64, Vec<Issue>> {
        input.parse().map_err(|_| vec![Issue::new("Use digits.")])
    }
}

/// A validator that must never run.
#[derive(Clone, Copy)]
struct Unreached;

impl Validator for Unreached {
    type Output = f64;

    fn validate(&self, _: &str, _: &ValidationContext) -> Result<f64, Vec<Issue>> {
        panic!("Question validation must not run.");
    }
}

/// The application of the linked-question scenarios: a port, a flag, and a question for each.
fn setup(scenario: &'static str) -> App {
    Application::new("setup")
        .description("Set up the service.")
        .option(
            "port",
            Opt::string().description("Service port.").validate(Number),
        )
        .option(
            "install",
            Opt::boolean().description("Install the service."),
        )
        .action(move |ctx: Context| async move {
            match scenario {
                "named-boolean-missing" => {
                    confirm(
                        &ctx,
                        ConfirmSettings::new("Install service?").option("install"),
                    )
                    .await?;
                    Ok(())
                }
                "unlinked" | "named-unlinked" => {
                    text(&ctx, TextSettings::new("Name"), Verbatim).await?;
                    Ok(())
                }
                _ => {
                    let value = text(
                        &ctx,
                        TextSettings::new("Service port").option("port"),
                        Unreached,
                    )
                    .await?;
                    ctx.out.print(&value.to_string()).await
                }
            }
        })
}

async fn run_setup(scenario: &'static str, argv: &[&str]) -> (u8, Arc<MockProcess>) {
    let mock = mock_process(MockFields::new().argv(argv.iter().copied()));
    (run(setup(scenario), &mock).await, mock)
}

async fn run_at_terminal(
    scenario: &'static str,
    env: &[(&str, &str)],
    argv: &[&str],
    keys: &[&str],
) -> (u8, Arc<MockProcess>) {
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .terminal(MockTerminal::new(80, 24).keys(keys.iter().map(|keys| entry(keys))));
    for (name, value) in env {
        fields = fields.env(name, value);
    }
    let mock = mock_process(fields);
    (run(setup(scenario), &mock).await, mock)
}

#[tokio::test]
async fn under_ci_true_at_a_terminal_a_linked_question_returns_its_supplied_option_without_asking()
{
    let (code, mock) = run_at_terminal("linked", &[("CI", "true")], &["--port", "8080"], &[]).await;
    assert_eq!(
        (
            code,
            mock.stdout_text().as_str(),
            mock.stderr_text().as_str()
        ),
        (0, "8080\n", "")
    );
}

#[tokio::test]
async fn under_ci_true_at_a_terminal_a_linked_question_whose_option_is_omitted_fails_with_exit_2() {
    let (code, mock) = run_at_terminal("linked", &[("CI", "true")], &[], &[]).await;
    assert_eq!(code, 2);
    assert!(
        mock.stderr_text().contains(
            "Option \"--port\" is required when input is not interactive. Supply a value."
        )
    );
}

#[tokio::test]
async fn under_ci_false_at_a_terminal_a_question_asks() {
    let (code, mock) = run_at_terminal("unlinked", &[("CI", "false")], &[], &["notes\r"]).await;
    assert_eq!(code, 0);
    assert!(mock.stderr_text().contains("Name"));
}

#[tokio::test]
async fn a_linked_question_returns_the_validated_supplied_option_silently_without_prompt_validation()
 {
    let (code, mock) = run_setup("linked", &["--port", "8080"]).await;
    assert_eq!(code, 0);
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(mock.stdout_text(), "8080\n");
}

/// The rule identity, the sentence, and the correction of the fault the scenario's question
/// returns at its call.
async fn fault(scenario: &'static str) -> (String, String, Vec<String>) {
    let mock = mock_process(MockFields::new());
    let app: App = Application::new("faults")
        .description("Exercise malformed questions.")
        .global_option("global", Opt::string().description("Global value."))
        .option("name", Opt::string().description("Name."))
        .option("tags", Opt::string().description("Tags.").multiple())
        .option("level", Opt::count().description("Level."))
        .option("file", Opt::content().description("File."))
        .action(move |ctx: Context| async move {
            let asked: Result<(), Error> = match scenario {
                "confirm-string" => confirm(&ctx, ConfirmSettings::new("Continue?").option("name"))
                    .await
                    .map(|_| ()),
                "content" => text(&ctx, TextSettings::new("File").option("file"), Verbatim)
                    .await
                    .map(|_| ()),
                "count" => text(&ctx, TextSettings::new("Level").option("level"), Verbatim)
                    .await
                    .map(|_| ()),
                "empty" => select::<_, _, String, _>(&ctx, SelectSettings::new("Mode", vec![]))
                    .await
                    .map(|_| ()),
                "global" => text(&ctx, TextSettings::new("Name").option("global"), Verbatim)
                    .await
                    .map(|_| ()),
                "multiple" => text(&ctx, TextSettings::new("Tags").option("tags"), Verbatim)
                    .await
                    .map(|_| ()),
                _ => text(&ctx, TextSettings::new("Name").option("unknown"), Verbatim)
                    .await
                    .map(|_| ()),
            };
            let error = match asked {
                Ok(()) => return ctx.out.print("accepted").await,
                Err(error) => error,
            };
            let Some(fault) = error.downcast_failure::<DeclarationError>() else {
                return Err(error);
            };
            let line = format!(
                "{} || {} || {}",
                fault.rule().map(|rule| rule.identity()).unwrap_or_default(),
                fault.sentence(),
                fault.correction().join(" && ")
            );
            ctx.out.print(&line).await
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stderr_text(), "");
    let stdout = mock.stdout_text();
    let parts: Vec<&str> = stdout.trim_end().split(" || ").collect();
    assert_eq!(parts.len(), 3, "{stdout:?}");
    (
        parts[0].to_owned(),
        parts[1].to_owned(),
        parts[2]
            .split(" && ")
            .filter(|part| !part.is_empty())
            .map(str::to_owned)
            .collect(),
    )
}

#[tokio::test]
async fn malformed_questions_fail_at_their_call_with_the_question_declaration_rule() {
    for scenario in [
        "empty",
        "unknown",
        "global",
        "multiple",
        "count",
        "content",
        "confirm-string",
    ] {
        assert_eq!(
            fault(scenario).await.0,
            "@loomcli/prompts/link",
            "{scenario}"
        );
    }
}

#[tokio::test]
async fn a_select_question_with_no_choices_states_its_fault_and_its_correction() {
    assert_eq!(
        fault("empty").await,
        (
            "@loomcli/prompts/link".to_owned(),
            "The select question \"Mode\" has no choice that is not disabled.".to_owned(),
            vec!["Supply at least one choice that is not disabled.".to_owned()]
        )
    );
}

#[tokio::test]
async fn a_missing_linked_value_reports_an_ordinary_usage_failure() {
    let (code, mock) = run_setup("missing", &[]).await;
    assert_eq!(code, 2);
    assert!(
        mock.stderr_text().contains(
            "Option \"--port\" is required when input is not interactive. Supply a value."
        )
    );
}

#[tokio::test]
async fn an_unlinked_question_cannot_resolve_without_interaction() {
    let (code, mock) = run_setup("unlinked", &[]).await;
    assert_eq!(code, 1);
    assert!(mock.stderr_text().contains(
        "The question \"Name\" needs an interactive terminal, and this run is not interactive. Run \"setup\" at a terminal."
    ));
}

#[tokio::test]
async fn invocation_by_name_uses_the_same_noninteractive_question_rules() {
    for scenario in [
        "named-linked",
        "named-missing",
        "named-unlinked",
        "named-boolean-missing",
    ] {
        let mock = mock_process(MockFields::new());
        let values = if scenario == "named-linked" {
            InvocationValues::new().option("port", "8080")
        } else {
            InvocationValues::new()
        };
        let outcome = setup(scenario)
            .invoke(
                &[],
                values,
                InvokeOptions::new(),
                Some(Arc::clone(&mock) as _),
            )
            .await;
        assert_eq!(mock.stderr_text(), "", "{scenario}");
        match (scenario, outcome) {
            ("named-linked", InvocationOutcome::Completed { output, .. }) => {
                assert_eq!(output, "8080\n");
            }
            (
                "named-missing",
                InvocationOutcome::Failed {
                    form, exit_code, ..
                },
            ) => {
                assert_eq!(exit_code.get(), 2);
                assert_eq!(
                    form.message,
                    "Option \"port\" is required when input is not interactive. Supply a value."
                );
            }
            (
                "named-unlinked",
                InvocationOutcome::Failed {
                    form, exit_code, ..
                },
            ) => {
                assert_eq!(exit_code.get(), 1);
                assert_eq!(form.code, "interaction-unavailable");
            }
            (
                "named-boolean-missing",
                InvocationOutcome::Failed {
                    form, exit_code, ..
                },
            ) => {
                assert_eq!(exit_code.get(), 2);
                assert_eq!(
                    form.message,
                    "Option \"install\" is required when input is not interactive. Supply a value."
                );
            }
            (scenario, _) => panic!("{scenario} resolved another outcome"),
        }
    }
}

/// An embedding host's stdin: a scripted stream with raw mode, which is not the process's own
/// terminal.
#[derive(Default)]
struct ScriptedStdin {
    reads: Mutex<VecDeque<Option<Vec<u8>>>>,
    modes: Mutex<Vec<bool>>,
    wake: Notify,
}

impl ScriptedStdin {
    fn push(&self, read: Option<&str>) {
        self.reads
            .lock()
            .unwrap()
            .push_back(read.map(|read| read.as_bytes().to_vec()));
        self.wake.notify_waiters();
    }

    fn modes(&self) -> Vec<bool> {
        self.modes.lock().unwrap().clone()
    }
}

impl InputStream for ScriptedStdin {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            loop {
                let woken = self.wake.notified();
                let mut woken = std::pin::pin!(woken);
                woken.as_mut().enable();
                {
                    let mut reads = self.reads.lock().unwrap();
                    match reads.pop_front() {
                        Some(None) => {
                            reads.push_front(None);
                            return Ok(0);
                        }
                        Some(Some(bytes)) => {
                            let count = buffer.len().min(bytes.len());
                            buffer[..count].copy_from_slice(&bytes[..count]);
                            if count < bytes.len() {
                                reads.push_front(Some(bytes[count..].to_vec()));
                            }
                            return Ok(count);
                        }
                        None => {}
                    }
                }
                woken.await;
            }
        })
    }

    fn set_raw_mode(&self, on: bool) -> io::Result<()> {
        self.modes.lock().unwrap().push(on);
        Ok(())
    }

    fn is_raw(&self) -> bool {
        self.modes.lock().unwrap().last() == Some(&true)
    }
}

/// A stream that keeps what it receives.
#[derive(Default)]
struct Kept(Mutex<String>);

impl OutputStream for Kept {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0
            .lock()
            .unwrap()
            .push_str(&String::from_utf8_lossy(bytes));
        Box::pin(async { Ok(()) })
    }
}

/// Stdin and stderr on a terminal of 80 columns and 24 rows, stdout piped.
struct EmbeddedTerminal;

impl ProcessTerminal for EmbeddedTerminal {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::new(true)
    }

    fn stdout(&self) -> OutputTerminal {
        OutputTerminal::new(false, None, None)
    }

    fn stderr(&self) -> OutputTerminal {
        OutputTerminal::new(true, Some(80), Some(24))
    }
}

/// One run of a text question on an embedding host's stdin, which holds `reads`.
async fn embedded(reads: &[Option<&str>]) -> (u8, Arc<ScriptedStdin>, String, String) {
    let stdin = Arc::new(ScriptedStdin::default());
    for read in reads {
        stdin.push(*read);
    }
    let stderr = Arc::new(Kept::default());
    let stdout = Arc::new(Kept::default());
    let handle = process_handle(
        ProcessFields::new()
            .argv(Vec::<String>::new())
            .env(Default::default())
            .stdin(Arc::clone(&stdin) as _)
            .stderr(Arc::clone(&stderr) as _)
            .stdout(Arc::clone(&stdout) as _)
            .terminal(Arc::new(EmbeddedTerminal)),
    );
    let app: App = Application::new("setup")
        .description("Configure the service.")
        .action(|ctx: Context| async move {
            let answer = text(&ctx, TextSettings::new("Port"), Verbatim).await?;
            ctx.out.print(&answer).await
        });
    let code = app.run(RunOptions::new().process(handle)).await.get();
    let messages = stderr.0.lock().unwrap().clone();
    let output = stdout.0.lock().unwrap().clone();
    (code, stdin, messages, output)
}

#[tokio::test]
async fn on_a_stdin_that_is_not_the_process_terminal_ctrl_c_and_ctrl_backslash_cancel_through_the_action()
 {
    for keys in ["\u{3}", "\u{1c}"] {
        let (code, stdin, messages, output) = embedded(&[Some(keys)]).await;
        assert_eq!(code, 130);
        assert_eq!(stdin.modes(), [true, false]);
        assert_eq!(output, "");
        assert!(!stdin.is_raw());
        assert!(messages.contains("cancelled"));
        assert!(messages.contains("\u{1b}[?25h"));
    }
}

#[tokio::test]
async fn ctrl_z_on_a_stdin_that_is_not_the_process_terminal_does_nothing_and_the_question_goes_on()
{
    let (code, stdin, _, output) = embedded(&[Some("\u{1a}8080\r")]).await;
    assert_eq!(code, 0);
    assert_eq!(output, "8080\n");
    assert!(!stdin.is_raw());
}

#[tokio::test]
async fn an_embedding_host_cancels_and_restores_terminal_input_at_the_end_of_input() {
    let (code, stdin, messages, output) = embedded(&[None]).await;
    assert_eq!(code, 130);
    assert_eq!(output, "");
    assert!(!stdin.is_raw());
    assert!(stdin.modes().first() == Some(&true));
    assert!(messages.contains("cancelled"));
    assert!(messages.contains("\u{1b}[?25h"));
}

#[tokio::test]
async fn a_callers_abort_while_a_question_waits_cancels_and_restores_terminal_input() {
    let mock =
        mock_process(MockFields::new().terminal(MockTerminal::new(80, 24).keys([entry("")])));
    let caller = CancellationToken::new();
    let app: App = Application::new("setup")
        .description("Configure the service.")
        .action(|ctx: Context| async move {
            let answer = text(&ctx, TextSettings::new("Port"), Verbatim).await?;
            ctx.out.print(&answer).await
        });
    let watching = {
        let mock = Arc::clone(&mock);
        let caller = caller.clone();
        async move {
            while !mock.stderr_text().contains("Port") {
                tokio::task::yield_now().await;
            }
            caller.cancel();
        }
    };
    let running = app.run(
        RunOptions::new()
            .process(Arc::clone(&mock) as _)
            .signal(caller.clone()),
    );
    let (code, ()) = tokio::join!(running, watching);
    assert_eq!(code.get(), 130);
    assert_eq!(mock.ended_by(), None);
    assert_eq!(mock.stdout_text(), "");
    assert!(!mock.is_raw());
    assert!(mock.stderr_text().contains("cancelled"));
    assert!(mock.stderr_text().contains("\u{1b}[?25h"));
}

#[tokio::test]
async fn ctrl_c_at_a_question_on_a_terminal_whose_term_is_dumb_ends_the_run_with_no_show_cursor_sequence()
 {
    let mock = mock_process(
        MockFields::new()
            .env("NO_COLOR", "1")
            .env("TERM", "dumb")
            .terminal(MockTerminal::new(60, 24).keys([entry("\u{3}")])),
    );
    let app: App = Application::new("ask").action(|ctx: Context| async move {
        text(&ctx, TextSettings::new("Service port"), Verbatim).await?;
        Ok(())
    });
    assert_eq!(run(app, &mock).await, 130);
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert!(mock.stderr_text().contains("Service port"));
    assert!(!mock.stderr_text().contains("\u{1b}[?25h"));
}

#[tokio::test]
async fn a_frame_override_can_add_rows_while_secret_text_stays_out_of_view_data() {
    let visible = Arc::new(Mutex::new(false));
    let seen = Arc::clone(&visible);
    let mock = mock_process(
        MockFields::new().terminal(
            MockTerminal::new(80, 24)
                .streams([loomcli_testing::StreamName::Stderr])
                .keys([entry("secret-value\r")]),
        ),
    );
    let app: App = Application::new("setup")
        .description("Configure the service.")
        .overrides([override_view(
            question_frame(),
            View::new(move |data: &QuestionFrame, context: &ViewContext| {
                if let QuestionFrame::Typed(typed) = data
                    && !typed.typed.is_empty()
                {
                    *seen.lock().unwrap() = true;
                }
                Ok::<_, Error>(format!(
                    "extra row\n{}",
                    question_frame().render(data, context)?
                ))
            }),
        )])
        .action(|ctx: Context| async move {
            let answer = secret(&ctx, SecretSettings::new("Secret"), Verbatim).await?;
            ctx.out.print(&answer).await
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "secret-value\n");
    assert!(!mock.is_raw());
    assert!(!*visible.lock().unwrap());
    let stderr = mock.stderr_text();
    assert!(stderr.contains("extra row"));
    assert!(stderr.contains("\r\u{1b}[1A\u{1b}[J"));
    assert!(!stderr.contains("secret-value"));
}

/// Answers the question the action asks with `ask` on a keyboard typing `keys`, in `/workspace` on
/// Linux in Europe/Berlin.
async fn validated<F, Fut>(keys: &str, ask: F) -> String
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<String, Error>> + Send + 'static,
{
    let answer = Arc::new(Mutex::new(String::new()));
    let kept = Arc::clone(&answer);
    let ask = Arc::new(ask);
    let app: App = Application::new("questions")
        .description("Validate question answers.")
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            let ask = Arc::clone(&ask);
            async move {
                let value = ask(ctx).await?;
                *kept.lock().unwrap() = value;
                Ok(())
            }
        });
    let mock = mock_process(
        MockFields::new()
            .cwd("/workspace")
            .platform("linux")
            .time_zone("Europe/Berlin")
            .terminal(
                MockTerminal::new(80, 24)
                    .streams([loomcli_testing::StreamName::Stderr])
                    .keys([entry(keys)]),
            ),
    );
    assert_eq!(run(app, &mock).await, 0);
    answer.lock().unwrap().clone()
}

/// A validator that answers its value in upper case.
#[derive(Clone, Copy)]
struct Upper;

impl Validator for Upper {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_uppercase())
    }
}

#[tokio::test]
async fn question_validation_passes_the_captured_host_context_to_the_validator() {
    assert_eq!(
        validated("hello\r", |ctx| async move {
            text(&ctx, TextSettings::new("Callable schema"), Upper).await
        })
        .await,
        "HELLO"
    );
    assert_eq!(
        validated("notes.txt\r", |ctx| async move {
            let path = text(&ctx, TextSettings::new("File"), loomcli_validators::path()).await?;
            Ok(path.to_string_lossy().into_owned())
        })
        .await,
        "/workspace/notes.txt"
    );
    assert_eq!(
        validated("2026-10-15T10:30\r", |ctx| async move {
            let when = text(
                &ctx,
                TextSettings::new("When"),
                loomcli_validators::date_time(),
            )
            .await?;
            Ok(when.to_string())
        })
        .await,
        "2026-10-15T08:30:00Z"
    );
}

#[tokio::test]
async fn a_select_question_answers_a_choice_value() {
    let answer = validated("\u{1b}[B\r", |ctx| async move {
        select(
            &ctx,
            SelectSettings::new("Mode", vec![Choice::text("fast"), Choice::text("safe")]),
        )
        .await
    })
    .await;
    assert_eq!(answer, "safe");
}
