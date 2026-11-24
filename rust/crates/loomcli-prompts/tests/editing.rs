//! Ports `editing.test.ts`: the keys a typed line edits with, the sequences the reader reads across
//! reads, a held Escape, the typeahead an accepted secret discards, the bracketed paste controls,
//! and the typed frame's styles.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::sync::Arc;
use std::time::Duration;

use loomcli_core::{
    Application, Arg, Context, InputIdentity, InputKind, Issue, Plugin, ThemeMapping,
    ValidationContext, ValidationPhase, Validator, style, width,
};
use loomcli_prompts::views::{QuestionFrame, QuestionKind, TypedFrame, question_frame};
use loomcli_prompts::{
    ConfirmSettings, SecretSettings, TextSettings, Verbatim, confirm, secret, text,
};
use loomcli_testing::{KeyEntry, MockFields, MockTerminal, key, mock_process};
use support::{App, entry, keyboard, reads, run, run_action, slot, stderr_terminal, strip, taken};

/// The answer a text question with the default `localhost` takes from `keys` and Enter.
async fn edited(keys: &str) -> String {
    let answer = slot::<String>();
    let kept = Arc::clone(&answer);
    let mock = keyboard(40, 24, vec![entry(&format!("{keys}{}", key::ENTER))]);
    let code = run_action(&mock, move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let value = text(
                &ctx,
                TextSettings::new("Name").default("localhost"),
                Verbatim,
            )
            .await?;
            *kept.lock().unwrap() = Some(value);
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0, "{keys:?}");
    taken(&answer).unwrap()
}

#[tokio::test]
async fn typed_line_edits_each_key_sequence_into_its_line() {
    let cases: Vec<(String, &str)> = vec![
        (format!("abcd{}{}X", key::LEFT, key::BACKSPACE), "abXd"),
        (
            format!(
                "{}{}{}{}",
                "postgres://db.local:5432/app",
                key::alt('b'),
                key::alt('b'),
                key::ctrl('k')
            ),
            "postgres://db.local:",
        ),
        (format!("abc{}{}X", key::HOME, key::DELETE), "Xbc"),
        (format!("{}{}db.", key::TAB, key::HOME), "db.localhost"),
        ("\u{1b}[200~first\nsecond\t\u{1b}[201~".to_owned(), "first"),
        (
            format!("connect postgres://db.local:5432/app{}", key::ctrl('w')),
            "connect ",
        ),
        (
            format!(
                "connect postgres://db.local:5432/app{}{}",
                key::ESCAPE,
                key::BACKSPACE
            ),
            "connect postgres://db.local:5432/",
        ),
        (format!("abc{}{}", key::ctrl('b'), key::ctrl('d')), "ab"),
        (format!("abc{}{}X", key::ctrl('a'), key::ctrl('f')), "aXbc"),
        (format!("abc{}{}", key::LEFT, key::ctrl('u')), "c"),
        (format!("abc{}{}X", key::HOME, key::ctrl('e')), "abcX"),
        (format!("one two{}\u{1b}[1;5CX", key::HOME), "oneX two"),
        (format!("one two{}\u{1b}OcX", key::HOME), "oneX two"),
        ("one two\u{1b}\u{1b}[DX".to_owned(), "one Xtwo"),
        (format!("é👨‍👩‍👧‍👦{}{}X", key::LEFT, key::BACKSPACE), "X👨‍👩‍👧‍👦"),
        (format!("a{}é{}X", key::LEFT, key::RIGHT), "éaX"),
        (format!("{}X", key::RIGHT), "localhostX"),
        (format!("{}X", key::ctrl('f')), "localhostX"),
        (format!("abc{}", key::ctrl('h')), "ab"),
        ("ab\u{1b}[1éc".to_owned(), "abéc"),
        ("ab\u{1b}]x\u{7f}c".to_owned(), "ac"),
        ("ab\u{1b}[[Ac".to_owned(), "abc"),
        ("ab\u{1b}OPc\u{1b}O2Pd".to_owned(), "abcd"),
        (format!("ab{}\u{1b}O3~", key::LEFT), "ab"),
        ("one two\u{1b}OdX".to_owned(), "one Xtwo"),
        ("ab\u{1b}[dX".to_owned(), "abX"),
        ("ab\u{1b}\u{1b}bX".to_owned(), "Xab"),
        ("ab\u{1b}\u{1b}xc".to_owned(), "abc"),
        ("ab\u{1b}[27uc".to_owned(), "abc"),
        ("\u{1b}[200~a\tb\u{1b}[201~".to_owned(), "a b"),
        ("\u{1b}[200~first\rsecond\u{1b}[201~".to_owned(), "first"),
        ("\u{1b}[200~a\u{1b}b\u{1b}[201~".to_owned(), "ab"),
        ("bc\u{1b}[1~a\u{1b}[4~d".to_owned(), "abcd"),
        ("bc\u{1b}[7~a\u{1b}[8~d".to_owned(), "abcd"),
        ("bc\u{1b}OHa\u{1b}OFd".to_owned(), "abcd"),
        ("bc\u{1b}[Ha\u{1b}[Fd".to_owned(), "abcd"),
    ];
    for (keys, expected) in cases {
        assert_eq!(edited(&keys).await, expected, "{keys:?}");
    }
}

#[tokio::test]
async fn a_protocol_sequence_spans_reads() {
    let cases: Vec<Vec<&str>> = vec![
        vec!["ab\u{1b}[", "D", "X\r"],
        vec!["ab\u{1b}O", "D", "X\r"],
        vec!["ab\u{1b}]late report", "\u{7}", "\u{1b}[D", "X\r"],
        vec!["ab\u{1b}[200~", "X\nignored", "\u{1b}[20", "1~\r"],
    ];
    for chunks in cases {
        let answer = slot::<String>();
        let kept = Arc::clone(&answer);
        let mock = keyboard(40, 24, vec![reads(&chunks)]);
        let code = run_action(&mock, move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                *kept.lock().unwrap() =
                    Some(text(&ctx, TextSettings::new("Name"), Verbatim).await?);
                Ok(())
            }
        })
        .await;
        assert_eq!(code, 0);
        let expected = if chunks[0].contains("200~") {
            "abX"
        } else {
            "aXb"
        };
        assert_eq!(taken(&answer).unwrap(), expected, "{chunks:?}");
        assert!(mock.stderr_text().contains("\u{1b}[?2004h"));
        assert!(mock.stderr_text().contains("\u{1b}[?2004l"));
    }
}

/// A port validator that reads the answer as a number, noting the validation context it sees.
#[derive(Clone, Default)]
struct Port {
    seen: Arc<std::sync::Mutex<Vec<(InputIdentity, ValidationPhase)>>>,
}

impl Validator for Port {
    type Output = f64;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<f64, Vec<Issue>> {
        self.seen
            .lock()
            .unwrap()
            .push((context.input.clone(), context.phase));
        input
            .parse::<f64>()
            .map_err(|_| vec![Issue::new("Use digits.")])
    }
}

#[tokio::test]
async fn a_linked_argument_skips_with_its_validated_action_value() {
    let answer = slot::<f64>();
    let kept = Arc::clone(&answer);
    let app: App = Application::new("ask")
        .argument("port", Arg::string().validate(Port::default()))
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value = text(
                    &ctx,
                    TextSettings::new("Port")
                        .argument("port")
                        .skip_if_supplied(),
                    Port::default(),
                )
                .await?;
                *kept.lock().unwrap() = Some(value);
                Ok(())
            }
        });
    let mock = mock_process(MockFields::new().argv(["8080"]));
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(taken(&answer), Some(8080.0));
}

/// The frame a text question with `typed` and `cursor` draws at `columns`, stripped of controls.
async fn drawn(columns: u16, frame: QuestionFrame) -> String {
    let mock = stderr_terminal(columns, 24);
    let code = run_action(&mock, move |ctx: Context| {
        let frame = frame.clone();
        async move {
            ctx.out.draw(&frame, &question_frame()).await?;
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0);
    mock.stderr_text()
}

#[tokio::test]
async fn a_twelve_column_field_draws_the_contract_window() {
    for (cursor, expected) in [
        (0, "? › postgres://…"),
        (14, "? › …/db.local:…"),
        (28, "? › …l:5432/app "),
    ] {
        let frame = TypedFrame::new(QuestionKind::Text, "Name", "postgres://db.local:5432/app")
            .cursor(cursor);
        assert_eq!(strip(&drawn(16, frame.into()).await), expected);
    }
}

#[tokio::test]
async fn a_frame_without_a_cursor_draws_the_cursor_at_the_end_of_the_typed_line() {
    let without = drawn(
        40,
        TypedFrame::new(QuestionKind::Text, "Name", "abc").into(),
    )
    .await;
    let with = drawn(
        40,
        TypedFrame::new(QuestionKind::Text, "Name", "abc")
            .cursor(3)
            .into(),
    )
    .await;
    assert_eq!(without, with);
    assert_eq!(strip(&without), "? Name › abc ");
}

#[tokio::test]
async fn a_typed_frame_stays_on_one_row_at_every_width() {
    for columns in [1, 2, 3, 4, 7, 8, 12, 21, 22, 40, 80] {
        let frame = TypedFrame::new(
            QuestionKind::Text,
            "Repository connection URL",
            "日本語のテキスト".repeat(10),
        )
        .cursor(3);
        let row = strip(&drawn(columns, frame.into()).await);
        assert!(width(&row) <= usize::from(columns), "{columns}: {row:?}");
    }
}

/// Runs an action that asks `ask` on a 40-column keyboard of `keys`, answering the run's code and
/// the answers it pushed.
async fn asked<F, Fut>(
    keys: Vec<KeyEntry>,
    ask: F,
) -> (u8, Vec<String>, Arc<loomcli_testing::MockProcess>)
where
    F: Fn(Context, Arc<std::sync::Mutex<Vec<String>>>) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<(), loomcli_core::Error>> + Send + 'static,
{
    let answers = Arc::new(std::sync::Mutex::new(Vec::new()));
    let kept = Arc::clone(&answers);
    let ask = Arc::new(ask);
    let mock = keyboard(40, 24, keys);
    let code = run_action(&mock, move |ctx: Context| {
        let kept = Arc::clone(&kept);
        let ask = Arc::clone(&ask);
        async move { ask(ctx, kept).await }
    })
    .await;
    let answers = answers.lock().unwrap().clone();
    (code, answers, mock)
}

#[tokio::test]
async fn an_accepted_secret_discards_typeahead_from_its_enter_read() {
    let (code, answers, mock) = asked(
        vec![entry("hidden\rleak\r"), entry("safe\r")],
        |ctx, answers| async move {
            let first = secret(&ctx, SecretSettings::new("Password"), Verbatim).await?;
            answers.lock().unwrap().push(first);
            let second = text(&ctx, TextSettings::new("Name"), Verbatim).await?;
            answers.lock().unwrap().push(second);
            Ok(())
        },
    )
    .await;
    assert_eq!(code, 0);
    assert_eq!(answers, ["hidden", "safe"]);
    assert!(!mock.stderr_text().contains("hidden"));
    assert!(!mock.stderr_text().contains("leak"));
}

#[tokio::test]
async fn a_linked_argument_identifies_question_validation_and_accepts_its_raw_prefill() {
    let port = Port::default();
    let seen = Arc::clone(&port.seen);
    let answer = slot::<f64>();
    let kept = Arc::clone(&answer);
    let app: App = Application::new("ask")
        .argument("port", Arg::string().validate(Port::default()))
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            let port = port.clone();
            async move {
                let value = text(&ctx, TextSettings::new("Port").argument("port"), port).await?;
                *kept.lock().unwrap() = Some(value);
                Ok(())
            }
        });
    let mock = mock_process(
        MockFields::new()
            .argv(["08080"])
            .terminal(MockTerminal::new(40, 24).keys([entry(key::ENTER)])),
    );
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(taken(&answer), Some(8080.0));
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].0.kind, InputKind::Argument);
    assert_eq!(seen[0].0.name, "port");
    assert!(!seen[0].0.global);
    assert_eq!(seen[0].1, ValidationPhase::Question);
}

#[tokio::test]
async fn a_question_rejects_a_variadic_argument_link_at_its_call() {
    let app: App = Application::new("ask")
        .argument("files", Arg::string().variadic())
        .action(|ctx: Context| async move {
            text(&ctx, TextSettings::new("Files").argument("files"), Verbatim).await?;
            Ok(())
        });
    let mock = keyboard(40, 24, vec![]);
    assert_eq!(run(app, &mock).await, 1);
    assert!(
        mock.stderr_text()
            .contains("which is not a string argument that takes one value.")
    );
    assert!(
        mock.stderr_text()
            .contains("Link a string option or argument that takes one value.")
    );
}

/// Two text questions, the second asked once `pause` has passed after the first.
async fn two_questions(keys: Vec<KeyEntry>, pause: Duration) -> Vec<String> {
    let (code, answers, _) = asked(keys, move |ctx, answers| async move {
        {
            let value = text(&ctx, TextSettings::new("First"), Verbatim).await?;
            answers.lock().unwrap().push(value);
        }
        tokio::time::advance(pause).await;
        {
            let value = text(&ctx, TextSettings::new("Second"), Verbatim).await?;
            answers.lock().unwrap().push(value);
        }
        Ok(())
    })
    .await;
    assert_eq!(code, 0);
    answers
}

#[tokio::test(start_paused = true)]
async fn a_held_esc_older_than_the_window_reads_as_escape_at_the_next_question() {
    assert_eq!(
        two_questions(
            vec![entry("x\r\u{1b}"), entry("b\r")],
            Duration::from_millis(200)
        )
        .await,
        ["x", "b"]
    );
}

#[tokio::test(start_paused = true)]
async fn a_held_esc_the_next_question_reads_within_the_window_continues_its_sequence() {
    assert_eq!(
        two_questions(
            vec![entry("x\r\u{1b}"), entry("[Db\r")],
            Duration::from_millis(49)
        )
        .await,
        ["x", "b"]
    );
}

#[tokio::test(start_paused = true)]
async fn a_held_esc_the_next_question_reads_once_the_window_has_passed_reads_as_escape() {
    assert_eq!(
        two_questions(
            vec![entry("x\r\u{1b}"), entry("[Db\r")],
            Duration::from_millis(50)
        )
        .await,
        ["x", "[Db"]
    );
}

#[tokio::test(start_paused = true)]
async fn an_accepted_secret_discards_an_open_paste_sequence_or_escape_until_it_ends() {
    let cases: Vec<Vec<KeyEntry>> = vec![
        vec![
            entry("hidden\r\u{1b}[200~leak"),
            entry("more\u{1b}[201~safe\r"),
        ],
        vec![entry("hidden\r\u{1b}[1"), entry(";5Dsafe\r")],
        vec![entry("hidden\r\u{1b}"), entry("bsafe\r")],
    ];
    for keys in cases {
        let (code, answers, mock) = asked(keys, |ctx, answers| async move {
            {
                let value = secret(&ctx, SecretSettings::new("Password"), Verbatim).await?;
                answers.lock().unwrap().push(value);
            }
            tokio::time::advance(Duration::from_millis(49)).await;
            {
                let value = text(&ctx, TextSettings::new("Name"), Verbatim).await?;
                answers.lock().unwrap().push(value);
            }
            Ok(())
        })
        .await;
        assert_eq!(code, 0);
        assert_eq!(answers, ["hidden", "safe"]);
        assert!(!mock.stderr_text().contains("more"));
        assert!(!mock.stderr_text().contains("5D"));
    }
}

#[tokio::test]
async fn an_accepted_secret_discards_a_paste_that_ends_in_a_later_read_of_the_same_entry() {
    let mock = keyboard(
        40,
        24,
        vec![reads(&["hidden\r\u{1b}[200~leak", "more\u{1b}[201~safe\r"])],
    );
    let code = run_action(&mock, |ctx: Context| async move {
        let (first, second) = tokio::join!(
            secret(&ctx, SecretSettings::new("Password"), Verbatim),
            text(&ctx, TextSettings::new("Name"), Verbatim)
        );
        ctx.out
            .print(&format!("[\"{}\",\"{}\"]", first?, second?))
            .await
    })
    .await;
    assert_eq!(code, 0, "{:?}", mock.stderr_text());
    assert_eq!(mock.stdout_text(), "[\"hidden\",\"safe\"]\n");
}

#[tokio::test]
async fn the_last_question_writes_csi_2004l_with_the_cursor_shown_after_its_answered_line() {
    let (code, _, mock) = asked(vec![entry("a\r")], |ctx, _| async move {
        text(&ctx, TextSettings::new("Name"), Verbatim).await?;
        Ok(())
    })
    .await;
    assert_eq!(code, 0);
    let stderr = mock.stderr_text();
    assert!(stderr.starts_with("\u{1b}[?25l\u{1b}[?2004h"), "{stderr:?}");
    assert!(
        stderr.ends_with("? Name · a\n\u{1b}[?25h\u{1b}[?2004l"),
        "{stderr:?}"
    );
}

#[tokio::test]
async fn ctrl_z_turns_bracketed_paste_off_before_the_suspend_and_on_again_at_the_resume() {
    let (code, _, mock) = asked(
        vec![entry(&key::ctrl('z')), entry("a\r")],
        |ctx, _| async move {
            text(&ctx, TextSettings::new("Name"), Verbatim).await?;
            Ok(())
        },
    )
    .await;
    assert_eq!(code, 0);
    let stderr = mock.stderr_text();
    let modes: Vec<char> = stderr
        .split("\u{1b}[?2004")
        .skip(1)
        .filter_map(|after| after.chars().next())
        .collect();
    assert_eq!(modes, ['h', 'l', 'h', 'l'], "{stderr:?}");
}

#[tokio::test]
async fn a_frame_dims_only_the_separator_glyph_or_the_legend() {
    let cases: Vec<(u16, QuestionFrame, &str)> = vec![
        (
            40,
            TypedFrame::new(QuestionKind::Text, "Name", "abc").into(),
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1mName\u{1b}[22m \u{1b}[2m›\u{1b}[22m abc\u{1b}[7m \u{1b}[27m",
        ),
        (
            10,
            TypedFrame::new(QuestionKind::Text, "Name", "abc").into(),
            "\u{1b}[1m?\u{1b}[22m \u{1b}[2m›\u{1b}[22m abc\u{1b}[7m \u{1b}[27m",
        ),
        (
            40,
            TypedFrame::new(QuestionKind::Confirm, "Ok", "")
                .hint("[Y/n]")
                .into(),
            "\u{1b}[1m?\u{1b}[22m \u{1b}[1mOk\u{1b}[22m \u{1b}[2m[Y/n]\u{1b}[22m \u{1b}[7m \u{1b}[27m",
        ),
    ];
    for (columns, frame, expected) in cases {
        let app: App = Application::new("draw")
            .plugins([Plugin::new("fixture/theme")
                .theme(ThemeMapping::new().entry("dim", style().faint()))])
            .action(move |ctx: Context| {
                let frame = frame.clone();
                async move {
                    ctx.out.draw(&frame, &question_frame()).await?;
                    Ok(())
                }
            });
        let mock = stderr_terminal(columns, 24);
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(mock.stderr_text(), expected);
    }
}

#[tokio::test]
async fn a_carriage_return_and_a_line_feed_together_are_one_enter() {
    let (code, answers, _) = asked(vec![entry("a\r\nb\r")], |ctx, answers| async move {
        {
            let value = text(&ctx, TextSettings::new("First"), Verbatim).await?;
            answers.lock().unwrap().push(value);
        }
        {
            let value = text(&ctx, TextSettings::new("Second"), Verbatim).await?;
            answers.lock().unwrap().push(value);
        }
        Ok(())
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(answers, ["a", "b"]);
}

#[tokio::test]
async fn a_secret_draws_no_frame_per_keystroke_so_its_output_never_depends_on_its_length() {
    let mut written = Vec::new();
    for typed in ["a", "abcdefghijklmnopqrstu"] {
        let (code, _, mock) = asked(
            vec![entry(&format!("{typed}{}{}", key::LEFT, key::ENTER))],
            |ctx, _| async move {
                secret(&ctx, SecretSettings::new("Password"), Verbatim).await?;
                Ok(())
            },
        )
        .await;
        assert_eq!(code, 0);
        written.push(mock.stderr_text());
    }
    assert_eq!(written[0], written[1]);
}

#[tokio::test]
async fn tab_right_and_ctrl_f_copy_nothing_into_a_confirm() {
    let answer = slot::<bool>();
    let kept = Arc::clone(&answer);
    let mock = keyboard(
        40,
        24,
        vec![entry(&format!(
            "{}{}{}{}",
            key::TAB,
            key::RIGHT,
            key::ctrl('f'),
            key::ENTER
        ))],
    );
    let code = run_action(&mock, move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            *kept.lock().unwrap() =
                Some(confirm(&ctx, ConfirmSettings::new("Install").default(true)).await?);
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(taken(&answer), Some(true));
    assert!(!mock.stderr_text().contains("Type y or n."));
}

#[tokio::test]
async fn tab_and_right_insert_nothing_into_a_secret() {
    let (code, answers, _) = asked(
        vec![entry(&format!(
            "{}pw{}{}",
            key::TAB,
            key::RIGHT,
            key::ENTER
        ))],
        |ctx, answers| async move {
            {
                let value = secret(&ctx, SecretSettings::new("Password"), Verbatim).await?;
                answers.lock().unwrap().push(value);
            }
            Ok(())
        },
    )
    .await;
    assert_eq!(code, 0);
    assert_eq!(answers, ["pw"]);
}
