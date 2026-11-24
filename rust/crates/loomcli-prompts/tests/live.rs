//! Ports the mock-terminal cases of `live.test.ts`: the input region each kind draws in, a lane
//! message written while a question asks, a question whose region a failure closes, and two
//! questions started at once, read through a headless screen.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{Application, Context, Error};
use loomcli_prompts::{
    Choice, ConfirmSettings, SecretSettings, SelectSettings, TextSettings, Verbatim, confirm,
    secret, select, text,
};
use loomcli_testing::{KeyEntry, MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use support::screen::{replay, written};
use support::{App, entry, reads, run};

fn terminal(keys: Vec<KeyEntry>) -> Arc<MockProcess> {
    mock_process(
        MockFields::new().terminal(
            MockTerminal::new(40, 24)
                .streams([StreamName::Stderr])
                .keys(keys),
        ),
    )
}

#[tokio::test]
async fn each_kind_asks_in_turn_and_hides_the_cursor_and_turns_paste_on_while_it_asks() {
    let mock = terminal(vec![entry("\r"), entry("\r"), entry("\r"), entry("\r")]);
    let answers = Arc::new(Mutex::new(String::new()));
    let kept = Arc::clone(&answers);
    let app: App = Application::new("live")
        .description("Ask on a recorded terminal.")
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let first = text(&ctx, TextSettings::new("Text").default("a"), Verbatim).await?;
                let second = secret(&ctx, SecretSettings::new("Secret"), Verbatim).await?;
                let third = confirm(&ctx, ConfirmSettings::new("Confirm").default(true)).await?;
                let fourth = select(
                    &ctx,
                    SelectSettings::new("Select", vec![Choice::text("one"), Choice::text("two")]),
                )
                .await?;
                *kept.lock().unwrap() = format!("{first}|{second}|{third}|{fourth}");
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answers.lock().unwrap(), "a||true|one");
    assert_eq!(mock.stdout_text(), "");
    assert!(!mock.is_raw());
    let stderr = mock.stderr_text();
    assert_eq!(stderr.matches("\u{1b}[?25l\u{1b}[?2004h").count(), 4);
    assert_eq!(stderr.matches("\u{1b}[?25h\u{1b}[?2004l").count(), 4);
    // Each question hides the cursor on its own after its first frame, as well as at the hold.
    assert_eq!(stderr.matches("\u{1b}[?25l").count(), 8);
    for message in ["Text", "Secret", "Confirm", "Select"] {
        let asked = stderr.find(message).unwrap();
        assert!(
            stderr[asked..].starts_with(&format!("{message}\u{1b}[22m"))
                && stderr[asked..]
                    .split_once("\u{1b}[?25l")
                    .is_some_and(|(before, _)| !before.contains("\u{1b}[?25h")),
            "{message}: {stderr:?}"
        );
    }
}

#[tokio::test]
async fn a_lane_message_written_while_a_question_asks_lands_above_the_whole_frame() {
    let mock = terminal(vec![reads(&["\u{1b}[D", "8080\r"])]);
    let mark = Arc::new(Mutex::new(0));
    let (marking, watched) = (Arc::clone(&mark), Arc::clone(&mock));
    let app: App = Application::new("live")
        .description("Ask on a recorded terminal.")
        .action(move |ctx: Context| {
            let mark = Arc::clone(&marking);
            let mock = Arc::clone(&watched);
            async move {
                let timer = async {
                    while !mock.stderr_text().contains("Port") {
                        tokio::time::sleep(Duration::from_millis(1)).await;
                    }
                    ctx.out.info("from a timer").await?;
                    *mark.lock().unwrap() = mock.transcript().len();
                    Ok::<(), Error>(())
                };
                let (answer, timed) =
                    tokio::join!(text(&ctx, TextSettings::new("Port"), Verbatim), timer);
                timed?;
                assert_eq!(answer?, "8080");
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    let transcript = mock.transcript();
    let at = *mark.lock().unwrap();
    assert_eq!(
        replay(&transcript[..at], 40, false).lines,
        ["ℹ from a timer", "? Port ›"]
    );
    assert_eq!(
        replay(&transcript, 40, false).lines,
        ["ℹ from a timer", "? Port · 8080"]
    );
}

#[tokio::test]
async fn a_question_whose_region_a_failure_closes_leaves_raw_mode_and_shows_the_cursor_after_its_cancelled_line()
 {
    let mock = terminal(vec![KeyEntry::reads(Vec::<String>::new())]);
    let watched = Arc::clone(&mock);
    let asked: Arc<Mutex<Option<tokio::task::JoinHandle<Result<String, Error>>>>> =
        Arc::new(Mutex::new(None));
    let kept = Arc::clone(&asked);
    let app: App = Application::new("live")
        .description("Ask on a recorded terminal.")
        .action(move |ctx: Context| {
            let mock = Arc::clone(&watched);
            let kept = Arc::clone(&kept);
            async move {
                // The question keeps reading after the action fails, as a sibling promise does.
                let ctx = Arc::new(ctx);
                let asking = Arc::clone(&ctx);
                *kept.lock().unwrap() = Some(tokio::spawn(async move {
                    text(&asking, TextSettings::new("Name?"), Verbatim).await
                }));
                while !mock.stderr_text().contains("Name?") {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
                Err::<(), Error>(ctx.out.fatal("The lookup failed."))
            }
        });
    assert_eq!(run(app, &mock).await, 1);
    let handle = asked.lock().unwrap().take().unwrap();
    let answered = tokio::time::timeout(Duration::from_secs(5), handle)
        .await
        .expect("the question settles once its region closes")
        .unwrap();
    assert!(answered.is_err());
    assert!(!mock.is_raw());
    let transcript = mock.transcript();
    let bytes = written(&transcript, false);
    assert!(
        bytes.rfind("\u{1b}[?25h").unwrap() > bytes.find("· cancelled").unwrap(),
        "{bytes:?}"
    );
    assert_eq!(
        replay(&transcript, 40, false).lines,
        ["? Name? · cancelled", "The lookup failed."]
    );
}

#[tokio::test]
async fn a_question_dropped_for_a_timeout_closes_its_region_so_the_next_question_asks_with_its_own_keys()
 {
    let mock = terminal(vec![KeyEntry::reads(Vec::<String>::new()), entry("two\r")]);
    let answers = Arc::new(Mutex::new(Vec::new()));
    let (kept, watched) = (Arc::clone(&answers), Arc::clone(&mock));
    let app: App = Application::new("live")
        .description("Ask on a recorded terminal.")
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            let mock = Arc::clone(&watched);
            async move {
                let timeout = async {
                    while !mock.stderr_text().contains("First") {
                        tokio::time::sleep(Duration::from_millis(1)).await;
                    }
                };
                tokio::select! {
                    answered = text(&ctx, TextSettings::new("First"), Verbatim) => {
                        kept.lock().unwrap().push(answered?);
                    }
                    () = timeout => {}
                }
                let second = text(&ctx, TextSettings::new("Second"), Verbatim).await?;
                kept.lock().unwrap().push(second);
                Ok(())
            }
        });
    let code = tokio::time::timeout(Duration::from_secs(5), run(app, &mock))
        .await
        .expect("the second question asks");
    assert_eq!(code, 0);
    assert_eq!(*answers.lock().unwrap(), ["two"]);
    assert!(!mock.is_raw());
    let frame = |message: &str, typed: &str| {
        format!(
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1m{message}\u{1b}[22m › {typed}\u{1b}[7m \u{1b}[27m\r\u{1b}[J"
        )
    };
    let hold = "\u{1b}[?25l\u{1b}[?2004h";
    let release = "\u{1b}[?25h\u{1b}[?2004l";
    let expected = [
        hold.to_owned(),
        frame("First", ""),
        "\u{1b}[?25l".to_owned(),
        frame("First", ""),
        "? First · cancelled\n".to_owned(),
        release.to_owned(),
        hold.to_owned(),
        frame("Second", ""),
        "\u{1b}[?25l".to_owned(),
        frame("Second", ""),
        frame("Second", "t"),
        frame("Second", "tw"),
        frame("Second", "two"),
        "? Second · two\n".to_owned(),
        release.to_owned(),
    ]
    .concat();
    assert_eq!(written(&mock.transcript(), false), expected);
    assert_eq!(
        replay(&mock.transcript(), 40, false).lines,
        ["? First · cancelled", "? Second · two"]
    );
}

#[tokio::test]
async fn two_questions_started_at_once_ask_one_after_the_other_each_with_its_own_keys() {
    let mock = terminal(vec![entry("one\rtwo\r")]);
    let answers = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answers);
    let app: App = Application::new("live")
        .description("Ask on a recorded terminal.")
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let (first, second) = tokio::join!(
                    text(&ctx, TextSettings::new("First"), Verbatim),
                    text(&ctx, TextSettings::new("Second"), Verbatim)
                );
                *kept.lock().unwrap() = vec![first?, second?];
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answers.lock().unwrap(), ["one", "two"]);
    assert_eq!(
        replay(&mock.transcript(), 40, false).lines,
        ["? First · one", "? Second · two"]
    );
}

#[tokio::test]
async fn a_question_dropped_while_it_waits_for_its_turn_draws_nothing() {
    let mock = terminal(vec![reads(&["o", "ne\r"])]);
    let answers = Arc::new(Mutex::new(Vec::new()));
    let (kept, watched) = (Arc::clone(&answers), Arc::clone(&mock));
    let app: App = Application::new("live")
        .description("Ask on a recorded terminal.")
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            let mock = Arc::clone(&watched);
            async move {
                let waiting = async {
                    let shown = async {
                        while !mock.stderr_text().contains("First") {
                            tokio::time::sleep(Duration::from_millis(1)).await;
                        }
                    };
                    tokio::select! {
                        _ = text(&ctx, TextSettings::new("Second"), Verbatim) => {}
                        () = shown => {}
                    }
                };
                let (first, ()) =
                    tokio::join!(text(&ctx, TextSettings::new("First"), Verbatim), waiting);
                kept.lock().unwrap().push(first?);
                Ok(())
            }
        });
    let code = tokio::time::timeout(Duration::from_secs(5), run(app, &mock))
        .await
        .expect("the first question answers");
    assert_eq!(code, 0);
    assert_eq!(*answers.lock().unwrap(), ["one"]);
    let frame = |typed: &str| {
        format!(
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1mFirst\u{1b}[22m › {typed}\u{1b}[7m \u{1b}[27m\r\u{1b}[J"
        )
    };
    let expected = [
        "\u{1b}[?25l\u{1b}[?2004h".to_owned(),
        frame(""),
        "\u{1b}[?25l".to_owned(),
        frame(""),
        frame("o"),
        frame("on"),
        frame("one"),
        "? First · one\n".to_owned(),
        "\u{1b}[?25h\u{1b}[?2004l".to_owned(),
    ]
    .concat();
    assert_eq!(written(&mock.transcript(), false), expected);
}
