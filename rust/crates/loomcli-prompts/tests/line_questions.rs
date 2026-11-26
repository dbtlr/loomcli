//! The line-based prompt cases of `line-questions.test.ts`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{Application, Context, RenderingPolicy, Switch};
use loomcli_prompts::{TextSettings, Verbatim, text};
use loomcli_testing::{KeyEntry, MockFields, MockProcess, MockTerminal, mock_process};
use std::sync::Arc;
use support::{entry, run};

fn plain_mock(keys: Vec<KeyEntry>) -> Arc<MockProcess> {
    mock_process(
        MockFields::new()
            .env("ACCESSIBLE", "1")
            .terminal(MockTerminal::new(80, 24).keys(keys)),
    )
}

fn rendering() -> RenderingPolicy {
    RenderingPolicy::new()
        .color(Switch::Never)
        .modifiers(Switch::Never)
}

#[tokio::test]
async fn text_with_a_default_asks_on_one_row_and_takes_it_on_enter() {
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let answer = text(
                &ctx,
                TextSettings::new("Project name").default("my-app"),
                Verbatim,
            )
            .await?;
            ctx.out.print(&answer).await
        });
    let mock = plain_mock(vec![entry("\r")]);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "my-app\n");
    assert_eq!(mock.stderr_text(), "Project name [my-app]: \n");
}

#[tokio::test]
async fn selects_print_a_numbered_list_once_and_retry_only_the_asking_row() {
    use loomcli_prompts::{Choice, SelectSettings, select};

    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let settings = SelectSettings::new(
                "Storage backend",
                vec![Choice::new("sqlite".to_owned(), "sqlite")],
            )
            .separator("Hosted")
            .choice(Choice::new("postgres".to_owned(), "PostgreSQL").hint("needs a server"))
            .choice(Choice::new("neon".to_owned(), "Neon").disabled("needs an account"))
            .choice(Choice::new("mysql".to_owned(), "mysql"));
            let value = select(&ctx, settings).await?;
            ctx.out.print(&value).await
        });
    let mock = plain_mock(vec![entry("4\rneon\r1\r")]);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "sqlite\n");
    assert_eq!(
        mock.stderr_text(),
        concat!(
            "Storage backend\n  1. sqlite\n  Hosted\n  2. PostgreSQL · needs a server\n",
            "  Neon (needs an account)\n  3. mysql\n",
            "Enter a number [1]: 4\n✘ Type a number from 1 to 3.\n",
            "Enter a number [1]: neon\n✘ Type a number from 1 to 3.\n",
            "Enter a number [1]: 1\n",
        )
    );
}

#[derive(Clone, Copy)]
struct Port;

impl loomcli_core::Validator for Port {
    type Output = u16;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<u16, Vec<loomcli_core::Issue>> {
        input
            .parse()
            .map_err(|_| vec![loomcli_core::Issue::new("Expected a port number.")])
    }
}

#[tokio::test]
async fn typed_answers_print_only_the_characters_that_are_edited() {
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let value = text(&ctx, TextSettings::new("Name"), Verbatim).await?;
            ctx.out.print(&value).await
        });
    let erase = "\u{8} \u{8}";
    for (keys, value, echo) in [
        ("\r", "", String::new()),
        (
            "ab\u{7f}c\u{1b}[Dd👍🏽\u{7f}\r",
            "acd",
            format!("ab{erase}cd👍🏽{erase}{erase}"),
        ),
        (
            "one two\u{17}three\r",
            "one three",
            format!("one two{}three", erase.repeat(3)),
        ),
        ("ab\u{15}cd\r", "cd", format!("ab{erase}{erase}cd")),
        ("ab\u{1b}OAc\r", "abc", "abc".to_owned()),
        ("ab\u{1b}bc\r", "abc", "abc".to_owned()),
        (
            "a\u{1b}]11;rgb:0000/0000/0000\u{7}b\r",
            "ab",
            "ab".to_owned(),
        ),
    ] {
        let mock = plain_mock(vec![entry(keys)]);
        assert_eq!(run(app.clone(), &mock).await, 0, "{keys:?}");
        assert_eq!(mock.stdout_text(), format!("{value}\n"));
        assert_eq!(mock.stderr_text(), format!("Name: {echo}\n"));
        assert!(!mock.is_raw());
    }
}

#[tokio::test]
async fn validation_prints_the_issue_then_asks_from_an_empty_line() {
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let port = text(&ctx, TextSettings::new("Service port"), Port).await?;
            ctx.out.print(&port.to_string()).await
        });
    let mock = plain_mock(vec![entry("80800x\r8080\r")]);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "8080\n");
    assert_eq!(
        mock.stderr_text(),
        "Service port: 80800x\n✘ Expected a port number.\nService port: 8080\n"
    );
    assert!(!mock.is_raw());
}

#[tokio::test]
async fn confirms_use_the_legend_and_ask_again_after_a_rejection() {
    use loomcli_prompts::{ConfirmSettings, confirm};

    for (default, keys, answer, stderr) in [
        (Some(false), "\r", "false\n", "Deploy now? [y/N]: \n"),
        (Some(false), "YES\r", "true\n", "Deploy now? [y/N]: YES\n"),
        (
            None,
            "\ry\r",
            "true\n",
            "Deploy now? [y/n]: \n✘ Type y or n.\nDeploy now? [y/n]: y\n",
        ),
    ] {
        let app =
            Application::new("ask")
                .rendering(rendering())
                .action(move |ctx: Context| async move {
                    let mut settings = ConfirmSettings::new("Deploy now?");
                    if let Some(default) = default {
                        settings = settings.default(default);
                    }
                    let answer = confirm(&ctx, settings).await?;
                    ctx.out.print(&answer.to_string()).await
                });
        let mock = plain_mock(vec![entry(keys)]);
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(mock.stdout_text(), answer);
        assert_eq!(mock.stderr_text(), stderr);
    }
}

#[derive(Clone, Copy)]
struct LongSecret;

impl loomcli_core::Validator for LongSecret {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        if input.len() < 4 {
            return Err(vec![loomcli_core::Issue::new("Too short.")]);
        }
        Ok(input.to_owned())
    }
}

#[tokio::test]
async fn a_rejected_secret_retries_without_echo_and_discards_its_trailing_keys() {
    use loomcli_prompts::{SecretSettings, secret};

    let mock = plain_mock(vec![entry("ab\rabcd\rleft\r"), entry("name\r")]);
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let token = secret(&ctx, SecretSettings::new("Token"), LongSecret).await?;
            let name = text(&ctx, TextSettings::new("Name"), Verbatim).await?;
            ctx.out.print(&format!("{token}/{name}")).await
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "abcd/name\n");
    assert_eq!(
        mock.stderr_text(),
        "Token: \n✘ Too short.\nToken: \nName: name\n"
    );
    assert!(!mock.is_raw());
}

#[tokio::test]
async fn a_secret_edits_in_raw_mode_and_echoes_only_enter() {
    use loomcli_prompts::{SecretSettings, secret};

    struct WhileRaw(Arc<MockProcess>);
    impl loomcli_core::Validator for WhileRaw {
        type Output = String;

        fn validate(
            &self,
            input: &str,
            _: &loomcli_core::ValidationContext,
        ) -> Result<String, Vec<loomcli_core::Issue>> {
            assert!(self.0.is_raw());
            Ok(input.to_owned())
        }
    }

    for (keys, answer) in [
        ("s3cret\r", "s3cret\n"),
        ("abc\u{15}xyz\r", "xyz\n"),
        ("ab cd\u{17}ef\r", "ab ef\n"),
        ("ab\u{1b}OAc\r", "abc\n"),
        ("ab\u{1b}bc\r", "abc\n"),
        ("a\u{1b}]11;rgb:0000/0000/0000\u{7}b\r", "ab\n"),
    ] {
        let mock = plain_mock(vec![entry(keys)]);
        let watched = mock.clone();
        let app = Application::new("ask")
            .rendering(rendering())
            .action(move |ctx: Context| {
                let watched = watched.clone();
                async move {
                    let token = secret(
                        &ctx,
                        SecretSettings::new("Token"),
                        WhileRaw(watched.clone()),
                    )
                    .await?;
                    assert!(!watched.is_raw());
                    ctx.out.print(&token).await
                }
            });
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(mock.stdout_text(), answer);
        assert_eq!(mock.stderr_text(), "Token: \n");
    }
}

#[tokio::test]
async fn plain_questions_take_turns_and_never_echo_a_typed_ahead_secret() {
    use loomcli_prompts::{SecretSettings, secret};

    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let (one, token, two) = tokio::join!(
                text(&ctx, TextSettings::new("Name"), Verbatim),
                secret(&ctx, SecretSettings::new("Token"), Verbatim),
                text(&ctx, TextSettings::new("After"), Verbatim),
            );
            ctx.out
                .print(&format!("{}/{}/{}", one?, token?, two?))
                .await
        });
    let mock = plain_mock(vec![support::reads(&["bob\rhunter2\r", "after\r"])]);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "bob/hunter2/after\n");
    assert_eq!(mock.stderr_text(), "Name: bob\nToken: \nAfter: after\n");
}

#[tokio::test]
async fn queued_keys_answer_two_plain_questions_in_sequence_or_in_parallel() {
    for parallel in [false, true] {
        let app =
            Application::new("ask")
                .rendering(rendering())
                .action(move |ctx: Context| async move {
                    let first = text(&ctx, TextSettings::new("First"), Verbatim);
                    let (first, second) = if parallel {
                        let (one, two) =
                            tokio::join!(first, text(&ctx, TextSettings::new("Second"), Verbatim));
                        (one?, two?)
                    } else {
                        (
                            first.await?,
                            text(&ctx, TextSettings::new("Second"), Verbatim).await?,
                        )
                    };
                    ctx.out.print(&format!("{first},{second}")).await
                });
        let mock = plain_mock(vec![entry("a\rb\r"), entry("")]);
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(mock.stdout_text(), "a,b\n");
        assert_eq!(mock.stderr_text(), "First: a\nSecond: b\n");
    }
}

#[tokio::test]
async fn an_authors_region_and_a_plain_question_take_turns_in_either_order() {
    use loomcli_core::{EndState, RegionOptions, View, ViewContext};

    for region_first in [true, false] {
        let app =
            Application::new("ask")
                .rendering(rendering())
                .action(move |ctx: Context| async move {
                    let settings = TextSettings::new("Name");
                    let options = RegionOptions::new().input();
                    let (region, question) = if region_first {
                        let region = ctx.out.region(options);
                        (region, text(&ctx, settings, Verbatim))
                    } else {
                        let question = text(&ctx, settings, Verbatim);
                        (ctx.out.region(options), question)
                    };
                    let other = async {
                        let view = View::new(|_: &str, _: &ViewContext| "must not draw".to_owned());
                        region.draw("picker", &view).await?;
                        ctx.out.info("The author’s region took its turn.").await?;
                        region.end(EndState::Ended, None).await
                    };
                    let (question, other) = tokio::join!(question, other);
                    other?;
                    ctx.out.print(&question?).await
                });
        let mock = plain_mock(vec![entry("n\r")]);
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(mock.stdout_text(), "n\n");
        let note = "ℹ The author’s region took its turn.\n";
        let question = "Name: n\n";
        let expected = if region_first {
            format!("{note}{question}")
        } else {
            format!("{question}{note}")
        };
        assert_eq!(mock.stderr_text(), expected);
    }
}

#[tokio::test]
async fn a_short_keyboard_script_fails_instead_of_waiting() {
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            text(&ctx, TextSettings::new("First"), Verbatim).await?;
            text(&ctx, TextSettings::new("Second"), Verbatim).await?;
            Ok(())
        });
    let mock = plain_mock(vec![entry("a\r")]);
    assert_eq!(run(app, &mock).await, 1);
    assert!(
        mock.stderr_text()
            .contains("mockProcess has no keys left for this read."),
        "{}",
        mock.stderr_text()
    );
    assert!(!mock.is_raw());
}

#[tokio::test]
async fn interrupts_finish_an_open_row_before_printing_cancellation() {
    for (keys, code, stderr) in [
        (entry("ab\u{3}"), 130, "Name: \n? Name · cancelled\n"),
        (
            support::reads(&["ab", "\u{3}"]),
            130,
            "Name: ab\n? Name · cancelled\n",
        ),
        (entry("\u{4}"), 130, "Name: \n? Name · cancelled\n"),
        (entry("\u{1c}"), 131, "Name: \n? Name · cancelled\n"),
    ] {
        let app =
            Application::new("ask")
                .rendering(rendering())
                .action(|ctx: Context| async move {
                    text(&ctx, TextSettings::new("Name"), Verbatim).await?;
                    Ok(())
                });
        let mock = plain_mock(vec![keys]);
        assert_eq!(run(app, &mock).await, code);
        assert_eq!(mock.stderr_text(), stderr);
        assert!(!mock.is_raw());
    }
}

#[tokio::test]
async fn suspend_discards_the_typed_line_and_reprints_the_row_on_resume() {
    use loomcli_core::TerminalControls;
    for preserve in [false, true] {
        let policy = if preserve {
            rendering().terminal_controls(TerminalControls::Preserve)
        } else {
            rendering()
        };
        let app = Application::new("ask")
            .rendering(policy)
            .action(|ctx: Context| async move {
                let name = text(&ctx, TextSettings::new("Name"), Verbatim).await?;
                ctx.out.print(&name).await
            });
        for (keys, stderr) in [
            (vec![entry("bob\r")], "Name: bob\n"),
            (
                vec![support::reads(&["ab", "\u{1a}"]), entry("cd\r")],
                "Name: abName: cd\n",
            ),
        ] {
            let mock = plain_mock(keys);
            assert_eq!(run(app.clone(), &mock).await, 0);
            assert_eq!(
                mock.stdout_text(),
                if stderr.contains("bob") {
                    "bob\n"
                } else {
                    "cd\n"
                }
            );
            assert_eq!(mock.stderr_text(), stderr);
            assert!(!mock.is_raw());
        }
    }
}

#[tokio::test]
async fn a_secret_restores_raw_mode_on_every_exit_and_during_suspend() {
    use loomcli_prompts::{SecretSettings, secret};
    use std::sync::atomic::{AtomicBool, Ordering};
    for (keys, code, stdout) in [
        (vec![entry("abcd\r")], 0, "abcd\n"),
        (vec![entry("ab\rabcd\r")], 0, "abcd\n"),
        (vec![entry("\u{4}")], 130, ""),
        (vec![entry("ab\u{1a}"), entry("abcd\r")], 0, "abcd\n"),
        (vec![entry("\u{3}")], 130, ""),
        (vec![entry("\u{1c}")], 131, ""),
    ] {
        let mock = plain_mock(keys);
        let watched = mock.clone();
        let suspended = Arc::new(AtomicBool::new(false));
        let resumed = Arc::new(AtomicBool::new(false));
        let app = Application::new("ask").rendering(rendering()).action({
            let suspended = suspended.clone();
            let resumed = resumed.clone();
            move |ctx: Context| {
                let (suspended, resumed, watched) =
                    (suspended.clone(), resumed.clone(), watched.clone());
                async move {
                    let can_stop = watched.clone();
                    let before = ctx.on_suspend(move || {
                        assert!(!can_stop.is_raw());
                        suspended.store(true, Ordering::SeqCst);
                    });
                    let asking = secret(&ctx, SecretSettings::new("Token"), LongSecret);
                    let after = ctx.on_resume(move || {
                        assert!(watched.is_raw());
                        resumed.store(true, Ordering::SeqCst);
                    });
                    let token = asking.await;
                    before.remove();
                    after.remove();
                    ctx.out.print(&token?).await
                }
            }
        });
        assert_eq!(run(app, &mock).await, code);
        assert_eq!(mock.stdout_text(), stdout);
        assert!(!mock.is_raw());
        assert_eq!(
            suspended.load(Ordering::SeqCst),
            resumed.load(Ordering::SeqCst)
        );
        if suspended.load(Ordering::SeqCst) {
            assert_eq!(mock.stderr_text(), "Token: Token: \n");
        }
        assert!(!mock.stderr_text().contains('\u{1b}'));
    }
}

fn choices(names: &[&str]) -> Vec<loomcli_prompts::Choice<String>> {
    names
        .iter()
        .map(|name| loomcli_prompts::Choice::new((*name).to_owned(), *name))
        .collect()
}

const BACKENDS: &str = "  1. sqlite\n  Hosted\n  2. PostgreSQL · needs a server\n  Neon (needs an account)\n  3. mysql\n";
const FEATURES: &str = "Features\n  1. backups\n  2. telemetry\n  3. metrics\n  4. alerts\n";
const REFINE: &str = "Enter a number, or text to search again";

fn backends() -> loomcli_prompts::SelectSettings<String> {
    use loomcli_prompts::{Choice, SelectSettings};
    SelectSettings::new("Storage backend", choices(&["sqlite"]))
        .separator("Hosted")
        .choice(Choice::new("postgres".to_owned(), "PostgreSQL").hint("needs a server"))
        .choice(Choice::new("neon".to_owned(), "Neon").disabled("needs an account"))
        .choice(Choice::new("mysql".to_owned(), "mysql"))
}

fn features() -> loomcli_prompts::MultiselectSettings<String> {
    loomcli_prompts::MultiselectSettings::new(
        "Features",
        choices(&["backups", "telemetry", "metrics", "alerts"]),
    )
}

#[tokio::test]
async fn a_select_uses_its_numbered_default_and_tolerates_padding() {
    use loomcli_prompts::select;
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let answer = select(&ctx, backends().default("postgres".to_owned())).await?;
            ctx.out.print(&answer).await
        });
    for (typed, answer) in [("", "postgres"), ("3", "mysql"), (" 1 ", "sqlite")] {
        let mock = plain_mock(vec![entry(&format!("{typed}\r"))]);
        assert_eq!(run(app.clone(), &mock).await, 0);
        assert_eq!(mock.stdout_text(), format!("{answer}\n"));
        assert_eq!(
            mock.stderr_text(),
            format!("Storage backend\n{BACKENDS}Enter a number [2]: {typed}\n")
        );
    }
}

#[tokio::test]
async fn a_linked_select_reports_a_disabled_prefill_and_offers_the_first_number() {
    use loomcli_core::Opt;
    use loomcli_prompts::select;
    let app = Application::new("ask")
        .rendering(rendering())
        .option("backend", Opt::string())
        .action(|ctx: Context| async move {
            let answer = select(&ctx, backends().option("backend")).await?;
            ctx.out.print(&answer).await
        });
    let mock = mock_process(
        MockFields::new()
            .env("ACCESSIBLE", "1")
            .argv(["--backend", "neon"])
            .terminal(MockTerminal::new(80, 24).keys(["\r"])),
    );
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "sqlite\n");
    assert_eq!(
        mock.stderr_text(),
        format!(
            "Storage backend\n{BACKENDS}✘ Cannot select \"neon\". Choose from the list.\nEnter a number [1]: \n"
        )
    );
}

#[tokio::test]
async fn a_multiselect_takes_defaults_or_unique_choices_in_the_operators_order() {
    use loomcli_prompts::multiselect;
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let answer = multiselect(
                &ctx,
                features().default(vec!["backups".to_owned(), "metrics".to_owned()]),
            )
            .await?;
            ctx.out.print(&answer.join(",")).await
        });
    for (typed, answer) in [("", "backups,metrics"), ("2, 1,2,", "telemetry,backups")] {
        let mock = plain_mock(vec![entry(&format!("{typed}\r"))]);
        assert_eq!(run(app.clone(), &mock).await, 0);
        assert_eq!(mock.stdout_text(), format!("{answer}\n"));
        assert_eq!(
            mock.stderr_text(),
            format!("{FEATURES}Enter numbers separated by commas [1,3]: {typed}\n")
        );
    }
}

#[tokio::test]
async fn a_multiselect_checks_its_bounds_and_accepts_an_empty_selection_when_allowed() {
    use loomcli_prompts::multiselect;
    for (required, keys, wanted) in [(true, "x\r\r1,2,3\r4\r", "alerts"), (false, "\r", "")] {
        let app =
            Application::new("ask")
                .rendering(rendering())
                .action(move |ctx: Context| async move {
                    let answer =
                        multiselect(&ctx, features().min(usize::from(required)).max(2)).await?;
                    ctx.out.print(&answer.join(",")).await
                });
        let mock = plain_mock(vec![entry(keys)]);
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(mock.stdout_text(), format!("{wanted}\n"));
        let row = "Enter numbers separated by commas: ";
        let tail = if required {
            format!(
                "x\n✘ Type numbers from 1 to 4, separated by commas.\n{row}\n✘ Choose at least 1.\n{row}1,2,3\n✘ Choose at most 2.\n{row}4\n"
            )
        } else {
            "\n".to_owned()
        };
        assert_eq!(mock.stderr_text(), format!("{FEATURES}{row}{tail}"));
    }
}

#[derive(Clone, Copy)]
struct AllowedFeature;

impl loomcli_core::Validator for AllowedFeature {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _: &loomcli_core::ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        if input == "telemetry" {
            return Err(vec![loomcli_core::Issue::new(
                "Not available on this plan.",
            )]);
        }
        Ok(input.to_owned())
    }
}

#[tokio::test]
async fn a_linked_validator_rejects_a_numbered_choice_with_its_label() {
    use loomcli_core::Opt;
    use loomcli_prompts::multiselect;
    let app = Application::new("ask")
        .rendering(rendering())
        .option("feature", Opt::string().multiple().validate(AllowedFeature))
        .action(|ctx: Context| async move {
            let answer = multiselect(&ctx, features().option("feature")).await?;
            ctx.out.print(&answer.join(",")).await
        });
    let mock = plain_mock(vec![entry("1,2\r1\r")]);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "backups\n");
    let row = "Enter numbers separated by commas: ";
    assert_eq!(
        mock.stderr_text(),
        format!("{FEATURES}{row}1,2\n✘ telemetry: Not available on this plan.\n{row}1\n")
    );
}

#[tokio::test]
async fn search_refines_a_term_case_insensitively_and_prints_empty_matches() {
    use loomcli_prompts::{SelectSettings, select};
    let app = Application::new("ask")
        .rendering(rendering())
        .action(|ctx: Context| async move {
            let answer = select(
                &ctx,
                SelectSettings::new(
                    "Feature",
                    choices(&["backups", "telemetry", "metrics", "alerts"]),
                )
                .search(),
            )
            .await?;
            ctx.out.print(&answer).await
        });
    let mock = plain_mock(vec![entry("e\rzzz\rAL\r1\r")]);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "alerts\n");
    assert_eq!(
        mock.stderr_text(),
        format!(
            "Feature\nSearch: e\n  1. telemetry\n  2. metrics\n  3. alerts\n{REFINE}: zzz\n  No matches\n✘ No choice can be selected. Change the search.\nSearch: AL\n  1. alerts\n{REFINE}: 1\n"
        )
    );
}

#[tokio::test]
async fn a_line_search_calls_the_source_for_each_entered_term_and_cancels_its_tokens() {
    use loomcli_prompts::{MultiselectSettings, multiselect};
    use std::sync::Mutex;
    use tokio_util::sync::CancellationToken;
    let calls = Arc::new(Mutex::new(Vec::<(String, CancellationToken)>::new()));
    let recorded = calls.clone();
    let app = Application::new("ask")
        .rendering(rendering())
        .action(move |ctx: Context| {
            let recorded = recorded.clone();
            async move {
                let settings = MultiselectSettings::from_source("Backend", move |term, token| {
                    let mut calls = recorded.lock().unwrap();
                    assert!(calls.iter().all(|(_, earlier)| earlier.is_cancelled()));
                    calls.push((term.clone(), token));
                    Box::pin(async move {
                        Ok(["sqlite", "postgres"]
                            .into_iter()
                            .filter(|name| name.contains(&term))
                            .map(|name| loomcli_prompts::Choice::new(name.to_owned(), name).into())
                            .collect())
                    })
                });
                let answer = multiselect(&ctx, settings).await?;
                ctx.out.print(&answer.join(",")).await
            }
        });
    let mock = plain_mock(vec![entry("\rpost\r1,\r")]);
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "postgres\n");
    assert_eq!(
        mock.stderr_text(),
        format!(
            "Backend\nSearch: \n  1. sqlite\n  2. postgres\n{REFINE} [none]: post\n  1. postgres\n{REFINE} [none]: 1,\n"
        )
    );
    let calls = calls.lock().unwrap();
    assert_eq!(
        calls
            .iter()
            .map(|(term, _)| term.as_str())
            .collect::<Vec<_>>(),
        ["", "post"]
    );
    assert!(calls.iter().all(|(_, token)| token.is_cancelled()));
}

#[tokio::test]
async fn search_offers_defaults_by_label_and_requires_a_term_or_choice_without_one() {
    use loomcli_prompts::{MultiselectSettings, SelectSettings, multiselect, select};
    const FOUND: &str = "Pick\nSearch: \n  1. a\n  2. b\n";
    for (mode, keys, expected, row) in [
        ("select", "\r\r", "b\n", " [b]: \n"),
        ("none", "\r\r", "\n", " [none]: \n"),
        ("many", "\r\r", "b,a\n", " [b,a]: \n"),
        ("source", "\r\r", "b\n", " [b]: \n"),
        ("select required", "\r\r1\r", "a\n", ": \n"),
        ("many required", "\r\r1\r", "a\n", ": \n"),
    ] {
        let app =
            Application::new("ask")
                .rendering(rendering())
                .action(move |ctx: Context| async move {
                    let select_settings =
                        || SelectSettings::new("Pick", choices(&["a", "b"])).search();
                    let multi_settings =
                        || MultiselectSettings::new("Pick", choices(&["a", "b"])).search();
                    let result = match mode {
                        "select" => select(&ctx, select_settings().default("b".to_owned())).await?,
                        "none" => multiselect(&ctx, multi_settings()).await?.join(","),
                        "many" => multiselect(
                            &ctx,
                            multi_settings().default(vec!["b".to_owned(), "a".to_owned()]),
                        )
                        .await?
                        .join(","),
                        "source" => {
                            select(
                                &ctx,
                                SelectSettings::from_source("Pick", |_, _| {
                                    Box::pin(async {
                                        Ok(choices(&["a", "b"])
                                            .into_iter()
                                            .map(Into::into)
                                            .collect())
                                    })
                                })
                                .default("b".to_owned()),
                            )
                            .await?
                        }
                        "select required" => select(&ctx, select_settings()).await?,
                        _ => multiselect(&ctx, multi_settings().min(1)).await?.join(","),
                    };
                    ctx.out.print(&result).await
                });
        let mock = plain_mock(vec![entry(keys)]);
        assert_eq!(run(app, &mock).await, 0, "{mode}");
        assert_eq!(mock.stdout_text(), expected);
        let again = if mode.ends_with("required") {
            format!("  1. a\n  2. b\n{REFINE}: 1\n")
        } else {
            String::new()
        };
        assert_eq!(mock.stderr_text(), format!("{FOUND}{REFINE}{row}{again}"));
    }
}

#[tokio::test]
async fn search_checks_the_minimum_of_its_defaults_and_prefers_a_linked_value() {
    use loomcli_core::Opt;
    use loomcli_prompts::{MultiselectSettings, multiselect, select};
    let list_app =
        Application::new("ask")
            .rendering(rendering())
            .action(|ctx: Context| async move {
                let settings = MultiselectSettings::new("Pick", choices(&["a", "b", "c"]))
                    .search()
                    .default(vec!["a".to_owned()])
                    .min(2);
                let answer = multiselect(&ctx, settings).await?;
                ctx.out.print(&answer.join(",")).await
            });
    let mock = plain_mock(vec![entry("\r\r1,3\r")]);
    assert_eq!(run(list_app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "a,c\n");
    assert_eq!(
        mock.stderr_text(),
        format!(
            "Pick\nSearch: \n  1. a\n  2. b\n  3. c\n{REFINE} [a]: \n✘ Choose at least 2.\n{REFINE} [a]: 1,3\n"
        )
    );
    let linked_app = Application::new("ask")
        .rendering(rendering())
        .option("backend", Opt::string())
        .action(|ctx: Context| async move {
            let answer = select(&ctx, backends().search().option("backend")).await?;
            ctx.out.print(&answer).await
        });
    let mock = mock_process(
        MockFields::new()
            .env("ACCESSIBLE", "1")
            .argv(["--backend", "postgres"])
            .terminal(MockTerminal::new(80, 24).keys(["\r\r"])),
    );
    assert_eq!(run(linked_app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "postgres\n");
    assert_eq!(
        mock.stderr_text(),
        format!("Storage backend\nSearch: \n{BACKENDS}{REFINE} [PostgreSQL]: \n")
    );
    // Under a source, a supplied value is checked against what the source returns, so nothing is
    // reported before the first search.
    let sourced_app = Application::new("ask")
        .rendering(rendering())
        .option("backend", Opt::string())
        .action(|ctx: Context| async move {
            let settings = loomcli_prompts::SelectSettings::from_source("Pick", |_, _| {
                Box::pin(async { Ok(choices(&["a", "b"]).into_iter().map(Into::into).collect()) })
            })
            .option("backend");
            let answer = select(&ctx, settings).await?;
            ctx.out.print(&answer).await
        });
    let mock = mock_process(
        MockFields::new()
            .env("ACCESSIBLE", "1")
            .argv(["--backend", "b"])
            .terminal(MockTerminal::new(80, 24).keys(["\r\r"])),
    );
    assert_eq!(run(sourced_app, &mock).await, 0);
    assert_eq!(mock.stdout_text(), "b\n");
    assert_eq!(
        mock.stderr_text(),
        format!("Pick\nSearch: \n  1. a\n  2. b\n{REFINE} [b]: \n")
    );
}

async fn every_kind(ctx: Context) -> loomcli_core::Outcome {
    use loomcli_prompts::{
        ConfirmSettings, SecretSettings, SelectSettings, confirm, multiselect, secret, select,
    };

    ctx.out.info("Setting up.").await?;
    let name = text(
        &ctx,
        TextSettings::new("Project name").default("my-app"),
        Verbatim,
    )
    .await?;
    let token = secret(&ctx, SecretSettings::new("Token"), Verbatim).await?;
    let deploy = confirm(&ctx, ConfirmSettings::new("Deploy now?").default(false)).await?;
    let backend = select(&ctx, backends()).await?;
    let selected = multiselect(&ctx, features()).await?;
    let found = select(
        &ctx,
        SelectSettings::new(
            "Feature",
            choices(&["backups", "telemetry", "metrics", "alerts"]),
        )
        .search(),
    )
    .await?;
    ctx.out
        .print(&format!(
            "{name}/{token}/{deploy}/{backend}/{}/{found}",
            selected.join(",")
        ))
        .await
}

#[tokio::test]
async fn the_flag_accessible_and_dumb_term_ask_each_kind_alike_and_quiet_hides_only_the_lane() {
    use loomcli_core::Opt;
    let app = Application::new("ask")
        .rendering(rendering())
        .global_option("plain", Opt::boolean().plain())
        .global_option("quiet", Opt::count().quiet().short('q'))
        .action(every_kind);
    let keys = ["\r", "token\r", "y\r", "2\r", "1,4\r", "ics\r1\r"];
    for (argv, name, value) in [
        (&[][..], "ACCESSIBLE", "1"),
        (&["--plain"][..], "TERM", "xterm"),
        (&[][..], "TERM", "dumb"),
        (&["-q"][..], "ACCESSIBLE", "1"),
    ] {
        let mock = mock_process(
            MockFields::new()
                .env(name, value)
                .argv(argv.iter().copied())
                .terminal(MockTerminal::new(80, 24).keys(keys)),
        );
        assert_eq!(run(app.clone(), &mock).await, 0);
        assert_eq!(
            mock.stdout_text(),
            "my-app/token/true/postgres/backups,alerts/metrics\n"
        );
        let intro = if argv == ["-q"] {
            ""
        } else {
            "ℹ Setting up.\n"
        };
        let expected = format!(
            "{intro}Project name [my-app]: \nToken: \nDeploy now? [y/N]: y\nStorage backend\n{BACKENDS}Enter a number [1]: 2\n{FEATURES}Enter numbers separated by commas: 1,4\nFeature\nSearch: ics\n  1. metrics\n{REFINE}: 1\n"
        );
        assert_eq!(mock.stderr_text(), expected, "{argv:?} {name}={value}");
    }
}

#[tokio::test]
async fn ci_and_no_input_still_prevent_questions() {
    use loomcli_core::{Opt, Polarity};
    let app = Application::new("ask")
        .rendering(rendering())
        .global_option(
            "input",
            Opt::boolean().interaction().polarity(Polarity::Negative),
        )
        .action(|ctx: Context| async move {
            text(&ctx, TextSettings::new("Project name"), Verbatim).await?;
            Ok(())
        });
    for ci in [true, false] {
        let mut bytes = Vec::new();
        for accessible in ["", "1"] {
            let fields = MockFields::new()
                .env("ACCESSIBLE", accessible)
                .terminal(MockTerminal::new(80, 24));
            let fields = if ci {
                fields.env("CI", "true")
            } else {
                fields.argv(["--no-input"])
            };
            let mock = mock_process(fields);
            assert_eq!(run(app.clone(), &mock).await, 1);
            assert!(!mock.stderr_text().contains("Project name: "));
            bytes.push(mock.stderr_text());
        }
        assert_eq!(bytes[0], bytes[1]);
    }
}

#[tokio::test]
async fn line_based_issues_follow_the_runs_color_policy() {
    use loomcli_core::{Plugin, ThemeMapping, style};
    let app = Application::new("ask")
        .plugins([
            Plugin::new("@fixture/theme").theme(ThemeMapping::new().entry("error", style().red()))
        ])
        .rendering(RenderingPolicy::new().modifiers(Switch::Never))
        .action(|ctx: Context| async move {
            let port = text(&ctx, TextSettings::new("Service port"), Port).await?;
            ctx.out.print(&port.to_string()).await
        });
    for (name, issue) in [
        ("NO_COLOR", "✘ Expected a port number."),
        (
            "FORCE_COLOR",
            "\u{1b}[31m✘ Expected a port number.\u{1b}[39m",
        ),
    ] {
        let mock = mock_process(
            MockFields::new()
                .env("ACCESSIBLE", "1")
                .env(name, "1")
                .env("COLORTERM", "truecolor")
                .env("TERM", "xterm-256color")
                .terminal(MockTerminal::new(80, 24).keys(["x\r8080\r"])),
        );
        assert_eq!(run(app.clone(), &mock).await, 0);
        assert_eq!(mock.stdout_text(), "8080\n");
        assert_eq!(
            mock.stderr_text(),
            format!("Service port: x\n{issue}\nService port: 8080\n")
        );
    }
}
