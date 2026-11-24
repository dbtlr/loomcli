//! Ports `interactive.test.ts`, whose cases drive a fixture on a real pseudo-terminal, onto the
//! mock keyboard: the same scenarios, keys, answers, and lines, read from the mock's stderr.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::collections::BTreeMap;
use std::sync::Arc;

use loomcli_core::{
    AnyExtension, Application, ConfigurationSource, Context, Error, Extension, Issue, NoInputs,
    Opt, OptionTarget, Plugin, SourceAnswer, SourceContext, SourceValue, ValidationContext,
    Validator,
};
use loomcli_prompts::{
    Choice, ConfirmSettings, SecretSettings, SelectSettings, TextSettings, Verbatim, confirm,
    secret, select, text,
};
use loomcli_testing::{KeyEntry, MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use support::{App, entry, reads, run, strip};

/// A number, as the fixture's port validators read it.
#[derive(Clone, Copy)]
struct Number;

impl Validator for Number {
    type Output = f64;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<f64, Vec<Issue>> {
        input.parse().map_err(|_| vec![Issue::new("Use digits.")])
    }
}

/// Digits only, as the fixture's retry validator reads them.
#[derive(Clone, Copy)]
struct Digits;

impl Validator for Digits {
    type Output = f64;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<f64, Vec<Issue>> {
        if !input.is_empty() && input.chars().all(|c| c.is_ascii_digit()) {
            Ok(input.parse().unwrap_or_default())
        } else {
            Err(vec![Issue::new("Use digits.")])
        }
    }
}

/// The binding of the fixture's configuration source: the settings key an option reads.
const SETTINGS_KEY: Extension<OptionTarget, String> = Extension::new("@fixture/settings/key");

/// The fixture's configuration plugin: a settings file holding `{"port":"006050"}`, which answers
/// each option bound to a key it holds with that key's raw value.
fn settings_file() -> Plugin {
    Plugin::new("@fixture/settings")
        .extensions([AnyExtension::from(SETTINGS_KEY)])
        .source(ConfigurationSource::new(
            &SETTINGS_KEY,
            |context: SourceContext<NoInputs>| async move {
                let mut answers = BTreeMap::new();
                for request in &context.requests {
                    if request.name() == "port" {
                        answers.insert(
                            request.name().to_owned(),
                            SourceAnswer::new(
                                SourceValue::String("006050".to_owned()),
                                "port in settings.json",
                            ),
                        );
                    }
                }
                Ok::<_, Error>(answers)
            },
        ))
}

/// The fixture: one scenario of the setup application, which prints its answer.
fn setup(scenario: &'static str) -> App {
    setup_with(scenario, false)
}

/// The fixture, with the settings file installed and its port bound to it when `configured`.
fn setup_with(scenario: &'static str, configured: bool) -> App {
    let port = Opt::string()
        .description("Service port.")
        .default("4000")
        .env(["PROMPT_PORT"])
        .validate(Number);
    let (port, plugins) = if configured {
        (
            port.extend([SETTINGS_KEY.value("port".to_owned())]),
            vec![settings_file()],
        )
    } else {
        (port, Vec::new())
    };
    Application::new("setup")
        .description("Configure the service.")
        .plugins(plugins)
        .option("port", port)
        .option(
            "install",
            Opt::boolean().description("Install the service."),
        )
        .action(move |ctx: Context| async move {
            let line = match scenario {
                "select" => {
                    let choices = (0..10)
                        .map(|index| Choice::text(format!("choice-{index}")))
                        .collect();
                    let answer = select(
                        &ctx,
                        SelectSettings::new("Backend", choices).default("choice-3".to_owned()),
                    )
                    .await?;
                    format!("ANSWER:\"{answer}\"")
                }
                "confirm" => {
                    let first = confirm(&ctx, ConfirmSettings::new("Install service?")).await?;
                    let second =
                        confirm(&ctx, ConfirmSettings::new("Continue?").default(true)).await?;
                    format!("ANSWERS:[{first},{second}]")
                }
                "secret" => {
                    let value = secret(&ctx, SecretSettings::new("Postgres URL"), Verbatim).await?;
                    format!("SECRET:{}", value == "password-sentinel")
                }
                "linked" | "skip" => {
                    let mut settings = TextSettings::new("Service port")
                        .default("5000")
                        .option("port");
                    if scenario == "skip" {
                        settings = settings.skip_if_supplied();
                    }
                    let answer = text(&ctx, settings, Number).await?;
                    format!("ANSWER:{answer}")
                }
                "typeahead" => {
                    let first = text(&ctx, TextSettings::new("Service port"), Verbatim).await?;
                    let second = confirm(&ctx, ConfirmSettings::new("Install service?")).await?;
                    format!("ANSWERS:[\"{first}\",{second}]")
                }
                "confirm-no" => {
                    let answer = confirm(
                        &ctx,
                        ConfirmSettings::new("Install service?").default(false),
                    )
                    .await?;
                    format!("ANSWER:{answer}")
                }
                "retry" => {
                    let answer = text(&ctx, TextSettings::new("Service port"), Digits).await?;
                    format!("ANSWER:{answer}")
                }
                "blank" => {
                    let answer = text(&ctx, TextSettings::new("Service port"), Verbatim).await?;
                    format!("ANSWER:\"{answer}\"")
                }
                _ => {
                    let answer = text(
                        &ctx,
                        TextSettings::new("Service port").default("4317"),
                        Verbatim,
                    )
                    .await?;
                    format!("ANSWER:\"{answer}\"")
                }
            };
            ctx.out.print(&line).await
        })
}

/// One run of a scenario with `keys`, under `env` and `argv`, with stdout piped beside the terminal.
async fn terminal(
    scenario: &'static str,
    keys: Vec<KeyEntry>,
    env: &[(&str, &str)],
    argv: &[&str],
) -> (u8, Arc<MockProcess>) {
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .env("NO_COLOR", "1");
    for (name, value) in env {
        fields = fields.env(name, value);
    }
    let mock = mock_process(
        fields.terminal(
            MockTerminal::new(80, 24)
                .streams([StreamName::Stderr])
                .keys(keys),
        ),
    );
    (run(setup(scenario), &mock).await, mock)
}

#[tokio::test]
async fn text_replaces_its_default_hint_and_leaves_one_answered_line() {
    let (code, mock) = terminal("text", vec![entry("8080\r")], &[], &[]).await;
    assert_eq!(code, 0);
    let stderr = strip(&mock.stderr_text());
    assert!(stderr.contains("Service port › 4317"));
    assert!(stderr.contains("Service port · 8080"));
    assert_eq!(mock.stdout_text(), "ANSWER:\"8080\"\n");
    assert!(!mock.is_raw());
}

#[tokio::test]
async fn secret_never_sends_entered_text_to_a_frame_or_its_answered_line() {
    let (code, mock) = terminal("secret", vec![entry("password-sentinel\r")], &[], &[]).await;
    assert_eq!(code, 0);
    assert!(!mock.stderr_text().contains("password-sentinel"));
    assert_eq!(mock.stdout_text(), "SECRET:true\n");
}

#[tokio::test]
async fn confirm_retries_invalid_input_and_retains_typed_ahead_answers_for_the_next_question() {
    let (code, mock) = terminal(
        "confirm",
        vec![reads(&["x\r", "\u{7f}yes\rNO\r"])],
        &[],
        &[],
    )
    .await;
    assert_eq!(code, 0);
    let stderr = strip(&mock.stderr_text());
    assert!(stderr.contains("Install service? [y/n]"));
    assert!(stderr.contains("Type y or n."));
    assert!(stderr.contains("Install service? · yes"));
    assert!(stderr.contains("Continue? · no"));
    assert_eq!(mock.stdout_text(), "ANSWERS:[true,false]\n");
}

#[tokio::test]
async fn select_scrolls_seven_choices_without_wrapping_and_honors_a_matching_default() {
    let (code, mock) = terminal(
        "select",
        vec![entry(&format!("{}\r", "\u{1b}[B".repeat(11)))],
        &[],
        &[],
    )
    .await;
    assert_eq!(code, 0);
    let stderr = strip(&mock.stderr_text());
    assert!(stderr.contains("↓ 3 more"));
    assert!(stderr.contains("↑ 3 more"));
    assert!(stderr.contains("Backend · choice-9"));
    assert_eq!(mock.stdout_text(), "ANSWER:\"choice-9\"\n");
}

#[tokio::test]
async fn ctrl_c_cancels_each_kind_shows_the_cursor_and_restores_cooked_mode() {
    for scenario in ["text", "secret", "confirm", "select"] {
        let (code, mock) = terminal(scenario, vec![entry("\u{3}")], &[], &[]).await;
        assert_eq!(code, 130, "{scenario}");
        assert!(mock.stderr_text().contains("cancelled"), "{scenario}");
        assert!(mock.stderr_text().contains("\u{1b}[?25h"), "{scenario}");
        assert!(!mock.is_raw());
    }
}

#[tokio::test]
async fn enter_submits_the_agreed_default_or_blank_value() {
    for (scenario, keys, answer) in [
        ("blank", "\r", "ANSWER:\"\""),
        ("default", "\r", "ANSWER:\"4317\""),
        ("clear", "xx\u{7f}\u{7f}\r", "ANSWER:\"4317\""),
        ("confirm-no", "\r", "ANSWER:false"),
    ] {
        let (code, mock) = terminal(scenario, vec![entry(keys)], &[], &[]).await;
        assert_eq!(code, 0, "{scenario}");
        assert_eq!(mock.stdout_text(), format!("{answer}\n"), "{scenario}");
    }
}

#[tokio::test]
async fn text_retries_entered_answers_and_applies_its_own_transformation() {
    let (code, mock) = terminal(
        "retry",
        vec![reads(&["bad\r", "\u{7f}\u{7f}\u{7f}8080\r"])],
        &[],
        &[],
    )
    .await;
    assert_eq!(code, 0);
    assert!(mock.stderr_text().contains("Use digits."));
    assert_eq!(mock.stdout_text(), "ANSWER:8080\n");
}

#[tokio::test]
async fn a_chunk_typed_ahead_answers_text_then_confirm() {
    let (code, mock) = terminal("typeahead", vec![entry("8080\ryes\r")], &[], &[]).await;
    assert_eq!(code, 0);
    assert_eq!(mock.stdout_text(), "ANSWERS:[\"8080\",true]\n");
}

#[tokio::test]
async fn an_asked_link_uses_raw_supplied_input_before_the_question_default() {
    let cases: Vec<(Vec<(&str, &str)>, Vec<&str>, &str, &str)> = vec![
        (vec![], vec![], "5000", "5000"),
        (vec![("PROMPT_PORT", "06000")], vec![], "06000", "6000"),
        (
            vec![("PROMPT_PORT", "6000")],
            vec!["--port", "07000"],
            "07000",
            "7000",
        ),
    ];
    for (env, argv, hint, answer) in cases {
        let (code, mock) = terminal("linked", vec![entry("\r")], &env, &argv).await;
        assert_eq!(code, 0);
        assert!(
            strip(&mock.stderr_text()).contains(&format!("Service port › {hint}")),
            "{hint}"
        );
        assert_eq!(mock.stdout_text(), format!("ANSWER:{answer}\n"));
    }
}

#[tokio::test]
async fn a_configuration_file_supplies_the_raw_prefill_before_the_option_transformation() {
    let mock = mock_process(
        MockFields::new().env("NO_COLOR", "1").terminal(
            MockTerminal::new(80, 24)
                .streams([StreamName::Stderr])
                .keys([entry("\r")]),
        ),
    );
    assert_eq!(run(setup_with("linked", true), &mock).await, 0);
    assert_eq!(
        mock.stderr_text(),
        [
            "\u{1b}[?25l\u{1b}[?2004h",
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1mService port\u{1b}[22m › \u{1b}[7m0\u{1b}[27m06050\r\u{1b}[J",
            "\u{1b}[?25l",
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1mService port\u{1b}[22m › \u{1b}[7m0\u{1b}[27m06050\r\u{1b}[J",
            "? Service port · 006050\n",
            "\u{1b}[?25h\u{1b}[?2004l",
        ]
        .concat()
    );
    assert_eq!(mock.stdout_text(), "ANSWER:6050\n");
}

#[tokio::test]
async fn a_skipped_supplied_link_prints_no_question_or_answered_line() {
    let (code, mock) = terminal("skip", vec![], &[("PROMPT_PORT", "6000")], &[]).await;
    assert_eq!(code, 0);
    assert_eq!(mock.stdout_text(), "ANSWER:6000\n");
    assert!(!mock.stderr_text().contains("Service port"));
}

#[tokio::test]
async fn ctrl_d_on_empty_input_cancels_the_run_at_each_kind() {
    for scenario in ["text", "secret", "confirm", "select"] {
        let (code, mock) = terminal(scenario, vec![entry("\u{4}")], &[], &[]).await;
        assert_eq!(code, 130, "{scenario}");
        assert!(mock.stderr_text().contains("cancelled"), "{scenario}");
    }
}

#[tokio::test]
async fn piping_stdout_still_asks_while_the_pipe_holds_only_action_output() {
    let (code, mock) = terminal("text", vec![entry("\r")], &[], &[]).await;
    assert_eq!(code, 0);
    assert!(strip(&mock.stderr_text()).contains("Service port"));
    assert_eq!(mock.stdout_text(), "ANSWER:\"4317\"\n");
}

#[tokio::test]
async fn escape_reads_alt_keys_and_malformed_sequences() {
    for (keys, answer) in [
        ("ab\u{1b}\u{1b}[A\r", "ab"),
        ("\u{1b}x\r", ""),
        ("ab\u{1b}\r", "ab"),
        ("ab\u{1b}[\r", "ab"),
    ] {
        let (code, mock) = terminal("blank", vec![entry(keys)], &[], &[]).await;
        assert_eq!(code, 0, "{keys:?}");
        assert_eq!(
            mock.stdout_text(),
            format!("ANSWER:\"{answer}\"\n"),
            "{keys:?}"
        );
    }
}

#[tokio::test]
async fn ctrl_c_cancels_after_an_incomplete_escape_sequence() {
    for keys in ["\u{1b}[\u{3}", "\u{1b}O\u{3}"] {
        let (code, mock) = terminal("blank", vec![entry(keys)], &[], &[]).await;
        assert_eq!(code, 130, "{keys:?}");
        assert!(mock.stderr_text().contains("cancelled"));
    }
}
