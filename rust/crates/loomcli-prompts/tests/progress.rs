//! Ports `progress.test.ts`: progress lines on a terminal read through a headless screen, off a
//! terminal as plain lines, under invocation by name as messages and events, their style, their
//! view, tracking work, and how a failing, returning, or cancelled run closes them.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use loomcli_core::{
    Activation, Application, Context, Error, FatalError, InvocationOutcome, InvocationValues,
    InvokeOptions, MiddlewareContext, Next, Plugin, ProcessSignal, ProgressEvent, ProgressState,
    RunOptions, View, ViewContext, ViewOverride, override_view,
};
use loomcli_prompts::views::{BarCells, ProgressLine, ProgressState as LineState, progress_line};
use loomcli_prompts::{
    ProgressSettings, ProgressStyleSettings, ProgressUpdate, Spinner, TextSettings, TrackMessages,
    Verbatim, progress, progress_style, text,
};
use loomcli_testing::{KeyEntry, MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use support::screen::replay;
use support::{App, reads};
use tokio_util::sync::CancellationToken;

/// A spinner that never advances while a test reads the screen.
fn still() -> Spinner {
    Spinner::new(["◐", "◓", "◑", "◒"], 60_000)
}

fn still_style() -> Plugin {
    progress_style(ProgressStyleSettings::new().spinner(still()))
}

/// A mock on a 60-column terminal holding stderr when `tty`, with no color unless `env` clears it.
fn mock_for(tty: bool, env: &[(&str, &str)], keys: Vec<KeyEntry>) -> Arc<MockProcess> {
    let mut fields = MockFields::new();
    let mut plain = vec![("NO_COLOR", "1"), ("TERM", "xterm")];
    for (name, value) in env {
        plain.retain(|(own, _)| own != name);
        plain.push((name, value));
    }
    for (name, value) in plain {
        if !value.is_empty() {
            fields = fields.env(name, value);
        }
    }
    let streams: Vec<StreamName> = if tty {
        vec![StreamName::Stderr]
    } else {
        vec![]
    };
    mock_process(fields.terminal(MockTerminal::new(60, 24).streams(streams).keys(keys)))
}

/// The points a scenario marks in the transcript.
#[derive(Clone, Default)]
struct Marks(Arc<Mutex<Vec<(String, usize)>>>);

impl Marks {
    fn mark(&self, mock: &MockProcess, name: &str) {
        self.0
            .lock()
            .unwrap()
            .push((name.to_owned(), mock.transcript().len()));
    }

    /// The rows the screen shows once it took every write up to `name`, or all of them.
    fn screen(&self, mock: &MockProcess, name: Option<&str>) -> Vec<String> {
        let transcript = mock.transcript();
        let end = name.map_or(transcript.len(), |name| {
            self.0
                .lock()
                .unwrap()
                .iter()
                .find(|(own, _)| own == name)
                .unwrap()
                .1
        });
        replay(&transcript[..end], 60, false).lines
    }
}

async fn run_on(app: App, mock: &Arc<MockProcess>, caller: Option<CancellationToken>) -> u8 {
    let mut options = RunOptions::new().process(Arc::clone(mock) as _);
    if let Some(caller) = caller {
        options = options.signal(caller);
    }
    app.run(options).await.get()
}

/// Whether `line` is `prefix` followed by an elapsed time under a minute.
fn timed(line: &str, prefix: &str) -> bool {
    line.strip_prefix(prefix)
        .is_some_and(|rest| regex::Regex::new(r"^\d+\.\ds$").unwrap().is_match(rest))
}

/// The look scenario: a counted line, a spinner line, and a count without a total, a lane line,
/// then each end.
async fn look(env: &[(&str, &str)]) -> (Arc<MockProcess>, Marks) {
    let mock = mock_for(true, env, vec![]);
    let marks = Marks::default();
    let (marking, watched) = (marks.clone(), Arc::clone(&mock));
    let app: App = Application::new("progress")
        .plugins([still_style()])
        .action(move |ctx: Context| {
            let marks = marking.clone();
            let mock = Arc::clone(&watched);
            async move {
                let counted = progress(&ctx, ProgressSettings::new("Fetching records").total(10.0));
                counted.update(ProgressUpdate::new().completed(6.0));
                let spinning = progress(&ctx, ProgressSettings::new("Building the index"));
                let reading = progress(&ctx, ProgressSettings::new("Reading rows"));
                reading.update(ProgressUpdate::new().completed(1204.0));
                ctx.out.info("lane line").await?;
                marks.mark(&mock, "running");
                counted.end_with("Fetched 10 records").await?;
                spinning.fail().await?;
                reading.end().await?;
                marks.mark(&mock, "ended");
                Ok(())
            }
        });
    assert_eq!(run_on(app, &mock, None).await, 0);
    (mock, marks)
}

#[tokio::test]
async fn a_counted_line_a_spinner_line_and_a_count_without_a_total_draw_below_a_lane_line() {
    let (mock, marks) = look(&[]).await;
    let shown = marks.screen(&mock, Some("running"));
    assert_eq!(shown[0], "ℹ lane line");
    assert!(
        timed(&shown[1], "◐ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · "),
        "{shown:?}"
    );
    assert!(timed(&shown[2], "◐ Building the index · "), "{shown:?}");
    assert!(timed(&shown[3], "◐ Reading rows 1204 · "), "{shown:?}");
    assert_eq!(shown.len(), 4);
}

#[tokio::test]
async fn each_success_and_failure_line_replaces_its_frame_and_stays_in_scrollback() {
    let (mock, marks) = look(&[]).await;
    let shown = marks.screen(&mock, Some("ended"));
    assert_eq!(shown.len(), 4);
    assert!(timed(&shown[1], "✔ Fetched 10 records · "), "{shown:?}");
    assert!(timed(&shown[2], "✘ Building the index · "), "{shown:?}");
    assert!(timed(&shown[3], "✔ Reading rows · "), "{shown:?}");
}

#[tokio::test]
async fn on_a_host_that_takes_compat_glyph_forms_the_failure_line_opens_with_a_cross() {
    let (mock, marks) = look(&[("TERM", "linux")]).await;
    assert!(marks.screen(&mock, Some("ended"))[2].starts_with("× Building the index · "));
}

#[tokio::test]
async fn with_color_the_spinner_frame_and_the_complete_cells_are_styled_and_the_text_is_the_same() {
    let (mock, marks) = look(&[("NO_COLOR", "")]).await;
    assert!(mock.stderr_text().contains('\u{1b}'));
    let shown = marks.screen(&mock, Some("running"));
    assert!(
        timed(&shown[1], "◐ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · "),
        "{shown:?}"
    );
}

#[tokio::test]
async fn a_line_open_when_the_run_is_cancelled_draws_its_cancelled_line_and_writes_no_report() {
    let mock = mock_for(true, &[], vec![]);
    let caller = CancellationToken::new();
    let cancelling = caller.clone();
    let app: App = Application::new("progress")
        .plugins([still_style()])
        .action(move |ctx: Context| {
            let caller = cancelling.clone();
            async move {
                let _line = progress(&ctx, ProgressSettings::new("Waiting"));
                ctx.out.info("started").await?;
                caller.cancel();
                Ok(())
            }
        });
    assert_eq!(run_on(app, &mock, Some(caller)).await, 130);
    assert_eq!(
        Marks::default().screen(&mock, None),
        ["ℹ started", "■ Waiting (cancelled)"]
    );
}

/// An override of the progress view that notes each frame it draws.
fn noting(seen: Arc<Mutex<Vec<ProgressLine>>>) -> ViewOverride {
    override_view(
        progress_line(),
        View::new(move |data: &ProgressLine, context: &ViewContext| {
            seen.lock().unwrap().push(data.clone());
            progress_line().render(data, context)
        }),
    )
}

#[tokio::test]
async fn a_line_opened_after_the_runs_cancellation_draws_no_frame_and_starts_no_frame_timer() {
    let mock = mock_for(true, &[], vec![]);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let caller = CancellationToken::new();
    let cancelling = caller.clone();
    let app: App = Application::new("progress")
        .overrides([noting(Arc::clone(&seen))])
        .action(move |ctx: Context| {
            let caller = cancelling.clone();
            async move {
                caller.cancel();
                // The run's cancellation reaches the context once core polls it again.
                tokio::task::yield_now().await;
                let _line = progress(
                    &ctx,
                    ProgressSettings::new("Late").spinner(Spinner::new(["a", "b"], 10)),
                );
                tokio::time::sleep(Duration::from_millis(100)).await;
                Ok(())
            }
        });
    assert_eq!(run_on(app, &mock, Some(caller)).await, 130);
    assert!(seen.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn the_spinner_advances_one_frame_each_interval_in_order() {
    let mock = mock_for(true, &[], vec![]);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let app: App = Application::new("progress")
        .overrides([noting(Arc::clone(&seen))])
        .action(|ctx: Context| async move {
            let line = progress(
                &ctx,
                ProgressSettings::new("Spinning").spinner(Spinner::new(["a", "b", "c"], 15)),
            );
            for _ in 0..4 {
                tokio::time::sleep(Duration::from_millis(15)).await;
                // The line's timer, due at the same instant, draws its frame before the next step.
                for _ in 0..4 {
                    tokio::task::yield_now().await;
                }
            }
            line.end().await
        });
    assert_eq!(run_on(app, &mock, None).await, 0);
    let frames: Vec<String> = seen
        .lock()
        .unwrap()
        .iter()
        .map(|line| line.frame.clone())
        .collect();
    assert_eq!(frames[..frames.len() - 1], ["a", "b", "c", "a", "b"]);
}

/// The frame each label drew first, with the style plugin or without it.
async fn styled(with_plugin: bool) -> Vec<(String, String)> {
    let mock = mock_for(true, &[], vec![]);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let plugins: Vec<Plugin> = if with_plugin {
        vec![progress_style(
            ProgressStyleSettings::new().spinner(Spinner::new(["⠋", "⠙"], 60_000)),
        )]
    } else {
        vec![]
    };
    let app: App = Application::new("progress")
        .plugins(plugins)
        .overrides([noting(Arc::clone(&seen))])
        .action(|ctx: Context| async move {
            let styled = progress(&ctx, ProgressSettings::new("Styled"));
            let own = progress(
                &ctx,
                ProgressSettings::new("Own").spinner(Spinner::new(["+"], 60_000)),
            );
            styled.end().await?;
            own.end().await
        });
    assert_eq!(run_on(app, &mock, None).await, 0);
    let mut firsts: Vec<(String, String)> = Vec::new();
    for line in seen.lock().unwrap().iter() {
        if !firsts.iter().any(|(label, _)| *label == line.label) {
            firsts.push((line.label.clone(), line.frame.clone()));
        }
    }
    firsts.sort();
    firsts
}

#[tokio::test]
async fn the_styles_spinner_draws_and_a_calls_own_spinner_wins_for_its_line() {
    assert_eq!(
        styled(true).await,
        [
            ("Own".to_owned(), "+".to_owned()),
            ("Styled".to_owned(), "⠋".to_owned())
        ]
    );
}

#[tokio::test]
async fn without_the_style_plugin_a_line_draws_the_default_circle_halves() {
    assert_eq!(
        styled(false).await,
        [
            ("Own".to_owned(), "+".to_owned()),
            ("Styled".to_owned(), "◐".to_owned())
        ]
    );
}

#[tokio::test]
async fn an_override_of_the_progress_view_draws_every_frame_and_its_data_carries_the_lines_facts() {
    let mock = mock_for(true, &[], vec![]);
    let marks = Marks::default();
    let (marking, watched) = (marks.clone(), Arc::clone(&mock));
    let app: App = Application::new("progress")
        .plugins([progress_style(
            ProgressStyleSettings::new()
                .bar(BarCells::new("#", "-"))
                .spinner(still()),
        )])
        .overrides([override_view(
            progress_line(),
            View::new(|data: &ProgressLine, _: &ViewContext| {
                let state = match data.state {
                    LineState::Running => "running",
                    LineState::Ended => "ended",
                    LineState::Failed => "failed",
                    _ => "cancelled",
                };
                let count = |value: Option<f64>| value.map_or_else(String::new, |v| v.to_string());
                format!(
                    "{state}|{}|{}|{}|{}|{}{}|number",
                    data.label,
                    count(data.completed),
                    count(data.total),
                    data.frame,
                    data.bar.complete,
                    data.bar.incomplete
                )
            }),
        )])
        .action(move |ctx: Context| {
            let marks = marking.clone();
            let mock = Arc::clone(&watched);
            async move {
                let line = progress(&ctx, ProgressSettings::new("Counting").total(4.0));
                line.update(ProgressUpdate::new().completed(1.0));
                tokio::time::sleep(Duration::from_millis(10)).await;
                marks.mark(&mock, "running");
                line.end_with("Counted").await
            }
        });
    assert_eq!(run_on(app, &mock, None).await, 0);
    assert_eq!(
        marks.screen(&mock, Some("running")),
        ["running|Counting|1|4|◐|#-|number"]
    );
    assert_eq!(marks.screen(&mock, None), ["ended|Counted|1|4|◐|#-|number"]);
}

/// The question scenario: two lines that a question asked meanwhile holds still, each catching up
/// once it is answered.
async fn question(env: &[(&str, &str)]) -> (Arc<MockProcess>, Marks, bool) {
    let mock = mock_for(true, env, vec![reads(&["\u{1b}[D", "yes\r"])]);
    let marks = Marks::default();
    let asked = Arc::new(Mutex::new(false));
    let (marking, watched, noted) = (marks.clone(), Arc::clone(&mock), Arc::clone(&asked));
    let app: App = Application::new("progress")
        .plugins([still_style()])
        .action(move |ctx: Context| {
            let marks = marking.clone();
            let mock = Arc::clone(&watched);
            let asked = Arc::clone(&noted);
            async move {
                let first = progress(&ctx, ProgressSettings::new("First"));
                let second = progress(&ctx, ProgressSettings::new("Second").total(4.0));
                let watching = async {
                    while !mock.stderr_text().contains("Continue") {
                        tokio::time::sleep(Duration::from_millis(1)).await;
                    }
                    *asked.lock().unwrap() = true;
                    first.update(ProgressUpdate::new().label("First moved"));
                    second.update(ProgressUpdate::new().completed(3.0));
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    marks.mark(&mock, "asking");
                };
                let (answer, ()) = tokio::join!(
                    text(&ctx, TextSettings::new("Continue"), Verbatim),
                    watching
                );
                answer?;
                marks.mark(&mock, "answered");
                first.end().await?;
                second.end().await
            }
        });
    assert_eq!(run_on(app, &mock, None).await, 0);
    let asked = *asked.lock().unwrap();
    (mock, marks, asked)
}

#[tokio::test]
async fn a_question_asked_while_two_lines_run_holds_them_still_and_lets_each_catch_up_once() {
    let (mock, marks, _) = question(&[]).await;
    let asking = marks.screen(&mock, Some("asking"));
    assert!(asking[0].starts_with("◐ First · "), "{asking:?}");
    assert!(
        asking[1].starts_with("◐ Second ▱▱▱▱▱▱▱▱▱▱ 0/4 · "),
        "{asking:?}"
    );
    assert_eq!(asking[2], "? Continue ›");
    let answered = marks.screen(&mock, Some("answered"));
    assert_eq!(answered[0], "? Continue · yes");
    assert!(answered[1].starts_with("◐ First moved · "), "{answered:?}");
    assert!(
        answered[2].starts_with("◐ Second ▰▰▰▰▰▰▰▱▱▱ 3/4 · "),
        "{answered:?}"
    );
}

#[tokio::test]
async fn on_a_terminal_stderr_whose_term_is_dumb_a_question_asked_beside_two_plain_lines_still_asks()
 {
    let (mock, marks, asked) = question(&[("TERM", "dumb")]).await;
    assert!(asked);
    assert_eq!(
        marks.screen(&mock, None)[..5],
        [
            "ℹ First",
            "ℹ Second",
            "? Continue · yes",
            "✔ First moved",
            "✔ Second"
        ]
    );
}

#[tokio::test]
async fn the_default_view_draws_the_bar_cells_the_counts_and_the_elapsed_time() {
    let mock = mock_for(false, &[], vec![]);
    let app: App = Application::new("progress").action(|ctx: Context| async move {
        let row = |completed: Option<f64>, total: Option<f64>, elapsed: u64| {
            ProgressLine::new(LineState::Running, "Work")
                .counts(completed, total)
                .frame("*")
                .bar(BarCells::new("#", "-"))
                .elapsed(elapsed)
        };
        let rows = [
            row(Some(1.0), Some(3.0), 0),
            row(Some(12.0), Some(10.0), 0),
            row(Some(0.0), Some(0.0), 0),
            row(Some(1.5), Some(4.5), 0),
            row(None, Some(5.0), 0),
            row(None, None, 59_999),
            row(None, None, 65_999),
            row(None, None, 3_779_999),
        ];
        let view = View::new(|data: &ProgressLine, context: &ViewContext| {
            Ok::<_, Error>(format!("{}\n", progress_line().render(data, context)?))
        });
        for row in &rows {
            ctx.out.render(row, &view).await?;
        }
        Ok(())
    });
    assert_eq!(run_on(app, &mock, None).await, 0);
    assert_eq!(mock.stderr_text(), "");
    assert_eq!(
        mock.stdout_text().split('\n').take(8).collect::<Vec<_>>(),
        [
            "* Work ###------- 1/3 · 0.0s",
            "* Work ########## 12/10 · 0.0s",
            "* Work ########## 0/0 · 0.0s",
            "* Work ###------- 33% · 0.0s",
            "* Work ---------- 0/5 · 0.0s",
            "* Work · 59.9s",
            "* Work · 1m 05s",
            "* Work · 1h 02m",
        ]
    );
}

/// Runs `act` on a 60-column terminal with the still style, answering the code and the screen.
async fn screen_of<F, Fut>(act: F) -> (u8, Vec<String>)
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<(), Error>> + Send + 'static,
{
    let mock = mock_for(true, &[], vec![]);
    let app: App = Application::new("progress")
        .plugins([still_style()])
        .action(act);
    let code = run_on(app, &mock, None).await;
    (code, Marks::default().screen(&mock, None))
}

#[tokio::test]
async fn track_returns_the_value_and_ends_with_done_from_a_function_of_it() {
    let value = Arc::new(Mutex::new(0));
    let kept = Arc::clone(&value);
    let (code, shown) = screen_of(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let count = progress(&ctx, ProgressSettings::new("Indexing"))
                .track(
                    async { Ok::<_, Error>(812) },
                    TrackMessages::new().done(|count: &i32| format!("Indexed {count} records")),
                )
                .await?;
            *kept.lock().unwrap() = count;
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(*value.lock().unwrap(), 812);
    assert!(timed(&shown[0], "✔ Indexed 812 records · "), "{shown:?}");
}

#[tokio::test]
async fn a_rejection_fails_the_line_with_failed_from_a_function_of_it_and_returns_the_same_error() {
    let same = Arc::new(Mutex::new(false));
    let kept = Arc::clone(&same);
    let (code, shown) = screen_of(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let outcome = progress(&ctx, ProgressSettings::new("Fetching"))
                .track(
                    async { Err::<(), _>(Error::from(FatalError::new("the host is down"))) },
                    TrackMessages::new().failed(|error: &Error| {
                        format!(
                            "Could not fetch: {}",
                            error
                                .failure()
                                .map_or("", loomcli_core::FailureFacts::message)
                        )
                    }),
                )
                .await;
            *kept.lock().unwrap() = outcome
                .err()
                .and_then(|error| {
                    error
                        .downcast_failure::<FatalError>()
                        .map(|f| loomcli_core::FailureFacts::message(f) == "the host is down")
                })
                .unwrap_or(false);
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0);
    assert!(*same.lock().unwrap());
    assert!(
        timed(&shown[0], "✘ Could not fetch: the host is down · "),
        "{shown:?}"
    );
}

#[tokio::test]
async fn a_line_closed_before_its_work_settles_draws_nothing_more_and_track_returns_the_value() {
    let value = Arc::new(Mutex::new(String::new()));
    let kept = Arc::clone(&value);
    let (code, shown) = screen_of(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let line = progress(&ctx, ProgressSettings::new("Settling"));
            line.end_with("Ended early").await?;
            let late = line
                .track(
                    async {
                        tokio::time::sleep(Duration::from_millis(5)).await;
                        Ok::<_, Error>("late".to_owned())
                    },
                    TrackMessages::new().done(|_: &String| "Never drawn".to_owned()),
                )
                .await?;
            *kept.lock().unwrap() = late;
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(*value.lock().unwrap(), "late");
    assert_eq!(shown.len(), 1);
    assert!(shown[0].starts_with("✔ Ended early · "));
}

#[tokio::test]
async fn an_action_that_fails_with_two_lines_open_writes_both_failure_lines_above_the_report() {
    let (code, shown) = screen_of(|ctx: Context| async move {
        let _first = progress(&ctx, ProgressSettings::new("First"));
        let _second = progress(&ctx, ProgressSettings::new("Second"));
        ctx.out.info("working").await?;
        Err(ctx.out.fatal("It failed."))
    })
    .await;
    assert_eq!(code, 1);
    assert_eq!(shown[0], "ℹ working");
    assert!(shown[1].starts_with("✘ First · "), "{shown:?}");
    assert!(shown[2].starts_with("✘ Second · "), "{shown:?}");
    assert_eq!(shown[3], "It failed.");
    assert_eq!(shown.len(), 4);
}

#[tokio::test]
async fn an_action_that_returns_with_a_line_open_writes_its_success_line() {
    let (code, shown) = screen_of(|ctx: Context| async move {
        let _line = progress(&ctx, ProgressSettings::new("Left open"));
        ctx.out.info("returning").await
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(shown[0], "ℹ returning");
    assert!(shown[1].starts_with("✔ Left open · "), "{shown:?}");
}

#[tokio::test]
async fn a_middlewares_line_stays_open_through_the_action_and_ends_once_the_chain_has_unwound() {
    let mock = mock_for(true, &[], vec![]);
    let around = Plugin::new("@fixture/around").middleware(
        Activation::Always,
        |ctx: MiddlewareContext<loomcli_core::NoInputs>, next: Next| async move {
            let _line = progress(&ctx, ProgressSettings::new("Around the run"));
            next.run().await?;
            ctx.out.info("after next").await?;
            Ok(())
        },
    );
    let app: App = Application::new("progress")
        .plugins([still_style(), around])
        .action(|ctx: Context| async move { ctx.out.info("action ran").await });
    assert_eq!(run_on(app, &mock, None).await, 0);
    let shown = Marks::default().screen(&mock, None);
    assert_eq!(shown[..2], ["ℹ action ran", "ℹ after next"]);
    assert!(shown[2].starts_with("✔ Around the run · "), "{shown:?}");
}

/// The plain scenario: the documented example's lines and a failing line.
fn plain_app() -> App {
    Application::new("progress").action(|ctx: Context| async move {
        let fetching = progress(&ctx, ProgressSettings::new("Fetching records").total(10.0));
        for index in 0..10 {
            fetching.update(ProgressUpdate::new().completed(f64::from(index + 1)));
        }
        fetching.end_with("Fetched 10 records").await?;
        progress(&ctx, ProgressSettings::new("Building the index"))
            .track(
                async { Ok::<_, Error>(812) },
                TrackMessages::new().done(|count: &i32| format!("Indexed {count} records")),
            )
            .await?;
        progress(&ctx, ProgressSettings::new("Uploading"))
            .fail()
            .await
    })
}

const PLAIN: &str = "ℹ Fetching records\n✔ Fetched 10 records\nℹ Building the index\n✔ Indexed 812 records\nℹ Uploading\n✘ Uploading\n";

#[tokio::test]
async fn with_stderr_piped_the_run_writes_one_start_line_and_one_end_line_per_progress_line() {
    let mock = mock_for(false, &[], vec![]);
    assert_eq!(run_on(plain_app(), &mock, None).await, 0);
    assert_eq!(mock.stderr_text(), PLAIN);
}

#[tokio::test]
async fn on_a_terminal_stderr_whose_term_is_dumb_or_under_ci_the_run_writes_the_plain_lines() {
    for env in [("TERM", "dumb"), ("CI", "true")] {
        let mock = mock_for(true, &[env], vec![]);
        assert_eq!(run_on(plain_app(), &mock, None).await, 0);
        assert_eq!(mock.stderr_text(), PLAIN, "{env:?}");
    }
}

/// The plain scenario under invocation by name: its messages and its progress events.
async fn invoked(app: App) -> (String, Vec<ProgressEvent>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let noted = Arc::clone(&events);
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new()
                .on_progress(move |event| noted.lock().unwrap().push(event.clone())),
            Some(mock_for(false, &[], vec![]) as _),
        )
        .await;
    let messages = match outcome {
        InvocationOutcome::Completed { messages, .. }
        | InvocationOutcome::Failed { messages, .. } => messages,
        _ => String::new(),
    };
    let events = events.lock().unwrap().clone();
    (messages, events)
}

#[tokio::test]
async fn under_invoke_the_lines_land_in_messages() {
    assert_eq!(invoked(plain_app()).await.0, PLAIN);
}

#[tokio::test]
async fn under_invoke_the_observer_reads_every_progress_event_of_every_line_in_order() {
    let (_, events) = invoked(plain_app()).await;
    let read: Vec<(u64, ProgressState, Option<f64>)> = events
        .iter()
        .map(|event| (event.id, event.state, event.completed))
        .collect();
    let mut expected = vec![(1, ProgressState::Started, Some(0.0))];
    for completed in 1..=10 {
        expected.push((1, ProgressState::Updated, Some(f64::from(completed))));
    }
    expected.extend([
        (1, ProgressState::Ended, Some(10.0)),
        (2, ProgressState::Started, None),
        (2, ProgressState::Ended, None),
        (3, ProgressState::Started, None),
        (3, ProgressState::Failed, None),
    ]);
    assert_eq!(read, expected);
    let labels: Vec<&str> = events.iter().map(|event| event.label.as_str()).collect();
    let mut expected = vec!["Fetching records"; 11];
    expected.extend([
        "Fetched 10 records",
        "Building the index",
        "Indexed 812 records",
        "Uploading",
        "Uploading",
    ]);
    assert_eq!(labels, expected);
}

#[tokio::test]
async fn under_invoke_a_lines_fail_and_tracks_failed_message_is_its_failed_events_label() {
    let app: App = Application::new("progress").action(|ctx: Context| async move {
        progress(&ctx, ProgressSettings::new("Uploading"))
            .fail_with("Upload refused")
            .await?;
        let _ = progress(&ctx, ProgressSettings::new("Syncing"))
            .track(
                async { Err::<(), _>(Error::from(FatalError::new("offline"))) },
                TrackMessages::new().failed(|error: &Error| {
                    format!(
                        "Sync failed: {}",
                        error
                            .failure()
                            .map_or("", loomcli_core::FailureFacts::message)
                    )
                }),
            )
            .await;
        Ok(())
    });
    let (_, events) = invoked(app).await;
    let read: Vec<(u64, ProgressState, String)> = events
        .iter()
        .map(|event| (event.id, event.state, event.label.clone()))
        .collect();
    assert_eq!(
        read,
        [
            (1, ProgressState::Started, "Uploading".to_owned()),
            (1, ProgressState::Failed, "Upload refused".to_owned()),
            (2, ProgressState::Started, "Syncing".to_owned()),
            (2, ProgressState::Failed, "Sync failed: offline".to_owned()),
        ]
    );
}

#[tokio::test]
async fn sigint_writes_the_lines_cancelled_line_the_run_resolves_130_and_the_process_dies_by_it() {
    let mock = mock_for(true, &[], vec![]);
    let app: App = Application::new("progress")
        .plugins([still_style()])
        .action(|ctx: Context| async move {
            let _line = progress(&ctx, ProgressSettings::new("Waiting for SIGINT"));
            ctx.signal.cancelled().await;
            ctx.signal.throw_if_cancelled()
        });
    let raising = {
        let mock = Arc::clone(&mock);
        async move {
            while !mock.stderr_text().contains("Waiting") {
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
            mock.raise(ProcessSignal::Int);
        }
    };
    let (code, ()) = tokio::join!(run_on(app, &mock, None), raising);
    assert_eq!(code, 130);
    for _ in 0..4 {
        tokio::task::yield_now().await;
    }
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Int));
    assert_eq!(
        Marks::default().screen(&mock, None),
        ["■ Waiting for SIGINT (cancelled)"]
    );
}
