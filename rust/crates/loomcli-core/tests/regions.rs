//! Ports `regions.test.ts`: live regions stacked at the bottom of stderr, every other write landing
//! above them, input regions, the closers, the live decision, the shared stdout and stderr order,
//! and `out.draw` beside a region, end to end through `Application::run` on the mock process. A
//! headless terminal in `support::screen` replays what the run wrote, as the reference's fixture
//! does with xterm.js; where the reference's emulator reflows on a resize, the bytes are asserted.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::VecDeque;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;
use std::time::Duration;

use loomcli_core::__private::install_log_hook;
use loomcli_core::{
    Application, Context, Done, EndState, Error, NoInputs, NoResult, Opt, Out, OutputTerminal,
    Region, RegionCloser, RegionOptions, RowSource, RowView, RunOptions, View, ViewContext,
};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use serde_json::{Map, Value, json};
use support::screen::{replay, written};
use support::streams::{Facts, Scripted as ScriptedStream, Seen, Swapped};
use tokio_util::sync::CancellationToken;

type App = Application<NoInputs, NoResult, Done>;

/// The terminal a scenario runs on.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Term {
    /// A stderr that reports a terminal 40 columns wide.
    Tty,
    /// A stdout that is the same terminal too.
    Both,
    /// A stderr that is not a terminal.
    Pipe,
}

/// One scenario's process, the marks it records in the order of its writes, and its notes.
#[derive(Clone)]
struct Fixture {
    process: Arc<MockProcess>,
    term: Term,
    marks: Arc<Mutex<Vec<(String, usize)>>>,
    notes: Arc<Mutex<Map<String, Value>>>,
    caller: CancellationToken,
}

impl Fixture {
    fn new(term: Term, argv: &[&str]) -> Self {
        let mut fields = MockFields::new()
            .argv(argv.iter().copied())
            .env("NO_COLOR", "1")
            .env("TERM", "xterm");
        match term {
            Term::Tty => {
                fields = fields.terminal(MockTerminal::new(40, 24).streams([StreamName::Stderr]));
            }
            Term::Both => fields = fields.terminal(MockTerminal::new(40, 24)),
            Term::Pipe => {}
        }
        Self {
            process: mock_process(fields),
            term,
            marks: Arc::default(),
            notes: Arc::default(),
            caller: CancellationToken::new(),
        }
    }

    /// Records a named point in the write order.
    fn mark(&self, name: &str) {
        let at = self.process.transcript().len();
        self.marks.lock().unwrap().push((name.to_owned(), at));
    }

    fn note(&self, name: &str, value: impl Into<Value>) {
        self.notes
            .lock()
            .unwrap()
            .insert(name.to_owned(), value.into());
    }

    fn notes(&self) -> Value {
        Value::Object(self.notes.lock().unwrap().clone())
    }

    /// Notes the closer a region read as it closed, and runs `then` there.
    fn watch(&self, name: &str, region: &Region, then: impl FnOnce(&Region) + Send + 'static) {
        let fixture = self.clone();
        let name = name.to_owned();
        region.on_close(move |closing| {
            fixture.note(&name, closer(closing.closed_by()));
            then(closing);
        });
    }

    /// The rows the terminal shows once it has taken every write up to the mark, or all of them.
    fn screen(&self, mark: Option<&str>) -> Vec<String> {
        let writes = self.process.transcript();
        let end = mark.map_or(writes.len(), |mark| {
            self.marks
                .lock()
                .unwrap()
                .iter()
                .find(|(name, _)| name == mark)
                .map(|(_, at)| *at)
                .expect("the mark was recorded")
        });
        replay(&writes[..end], 40, self.term == Term::Both).lines
    }

    /// Every byte the terminal received.
    fn written(&self) -> String {
        written(&self.process.transcript(), self.term == Term::Both)
    }

    async fn run(&self, app: &App) -> u8 {
        app.run(
            RunOptions::new()
                .process(Arc::clone(&self.process) as _)
                .signal(self.caller.clone()),
        )
        .await
        .get()
    }
}

fn closer(closer: Option<RegionCloser>) -> &'static str {
    match closer {
        Some(RegionCloser::End) => "end",
        Some(RegionCloser::Completion) => "completion",
        Some(RegionCloser::Failure) => "failure",
        Some(RegionCloser::Cancellation) => "cancellation",
        None => "open",
    }
}

/// A bare view that writes its data as it is.
fn text() -> View<str> {
    View::new(|value: &str, _: &ViewContext| value.to_owned())
}

/// The fixture's Application: the scenario's action under a verbose and a quiet global option.
fn app<F, Fut>(action: F) -> App
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    Application::new("regions")
        .description("Draw live regions.")
        .global_option(
            "verbose",
            Opt::count()
                .description("Show more detail.")
                .short('v')
                .verbose(),
        )
        .global_option(
            "quiet",
            Opt::count().description("Show less.").short('q').quiet(),
        )
        .action(action)
}

/// Runs the scenario `act` builds on `term` with `argv`, and answers the fixture and the code.
async fn scenario<F, Fut>(
    term: Term,
    argv: &[&str],
    act: impl FnOnce(Fixture) -> F,
) -> (Fixture, u8)
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    let fixture = Fixture::new(term, argv);
    let application = app(act(fixture.clone()));
    let code = fixture.run(&application).await;
    (fixture, code)
}

/// A source of rows that awaits each pause it holds before its next row.
enum Step {
    Row(&'static str),
    Pause(Pin<Box<dyn Future<Output = ()> + Send>>),
}

struct Scripted {
    steps: VecDeque<Step>,
    paused: Option<Pin<Box<dyn Future<Output = ()> + Send>>>,
}

impl futures_core::Stream for Scripted {
    type Item = Result<&'static str, Error>;

    fn poll_next(
        mut self: Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        loop {
            if let Some(paused) = self.paused.as_mut() {
                if paused.as_mut().poll(context).is_pending() {
                    return Poll::Pending;
                }
                self.paused = None;
            }
            match self.steps.pop_front() {
                Some(Step::Row(row)) => return Poll::Ready(Some(Ok(row))),
                Some(Step::Pause(pause)) => self.paused = Some(pause),
                None => return Poll::Ready(None),
            }
        }
    }
}

fn scripted(steps: Vec<Step>) -> RowSource<&'static str> {
    RowSource::stream(Scripted {
        steps: steps.into(),
        paused: None,
    })
}

fn rows_view() -> RowView<&'static str> {
    RowView::new(|row: &&'static str, _, _: &ViewContext| format!("{row}\n"))
}

/// Two rows with an info line the source awaits between them, and a print issued behind them.
async fn reported(out: &Out, fixture: &Fixture) -> Result<(), Error> {
    let info = {
        let out = out.clone();
        Box::pin(async move {
            let _ = out.info("fetching page two").await;
        })
    };
    let source = scripted(vec![
        Step::Row("row one"),
        Step::Pause(info),
        Step::Row("row two"),
    ]);
    let view = rows_view();
    let (rows, after) = tokio::join!(out.render(source, &view), out.print("after rows"));
    rows?;
    after?;
    fixture.mark("written");
    Ok(())
}

#[tokio::test]
async fn two_regions_stack_in_open_order_below_a_lane_line_and_a_debug_line_written_between_their_frames()
 {
    let (fixture, code) = scenario(Term::Tty, &["-v"], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let first = ctx.out.region(RegionOptions::new());
                let second = ctx.out.region(RegionOptions::new());
                first.draw("first frame", &text()).await?;
                second.draw("second frame", &text()).await?;
                ctx.out.info("info line").await?;
                ctx.out.debug("debug line").await?;
                fixture.mark("lines");
                first.draw("first frame\nfirst grown row", &text()).await?;
                fixture.mark("grown");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(
        fixture.screen(Some("lines")),
        ["ℹ info line", "› debug line", "first frame", "second frame"]
    );
    // A frame that grows by a row moves the region below it down.
    assert_eq!(
        fixture.screen(Some("grown")),
        [
            "ℹ info line",
            "› debug line",
            "first frame",
            "first grown row",
            "second frame"
        ]
    );
}

#[tokio::test]
async fn closing_the_top_region_moves_its_last_frame_into_scrollback_and_an_empty_one_leaves_no_row()
 {
    let (fixture, _) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let first = ctx.out.region(RegionOptions::new());
                let second = ctx.out.region(RegionOptions::new());
                let third = ctx.out.region(RegionOptions::new());
                first.draw("first frame", &text()).await?;
                second.draw("second frame", &text()).await?;
                third.draw("third frame", &text()).await?;
                first.end(EndState::Ended, None).await?;
                fixture.mark("top closed");
                third.draw("", &text()).await?;
                third.end(EndState::Ended, None).await?;
                fixture.mark("empty closed");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(
        fixture.screen(Some("top closed")),
        ["first frame", "second frame", "third frame"]
    );
    let writes = fixture.process.transcript();
    let end = fixture.marks.lock().unwrap()[1].1;
    let shown = replay(&writes[..end], 40, false);
    assert_eq!(shown.lines, ["first frame", "second frame"]);
    assert_eq!(shown.cursor, ("second frame".len(), 1));
}

#[tokio::test]
async fn a_partial_line_drawn_before_the_first_region_draws_stays_on_its_own_row_above_the_frame() {
    let (fixture, _) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out.draw("partial", &text()).await?;
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                fixture.mark("drawn");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(fixture.screen(Some("drawn")), ["partial", "frame"]);
}

/// A line printed to stdout while a region is drawn.
async fn printed_scenario(term: Term) -> Fixture {
    scenario(term, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.draw("frame", &text()).await?;
                ctx.out.print("printed").await?;
                region.draw("frame again", &text()).await?;
                fixture.mark("printed");
                Ok(())
            }
        }
    })
    .await
    .0
}

#[tokio::test]
async fn with_stdout_a_terminal_too_a_printed_line_lands_above_the_region() {
    let fixture = printed_scenario(Term::Both).await;
    assert_eq!(fixture.screen(Some("printed")), ["printed", "frame again"]);
}

#[tokio::test]
async fn with_stdout_piped_stdout_holds_the_printed_line_alone_and_the_region_is_untouched() {
    let fixture = printed_scenario(Term::Tty).await;
    assert_eq!(fixture.process.stdout_text(), "printed\n");
    assert_eq!(fixture.screen(Some("printed")), ["frame again"]);
}

#[tokio::test]
async fn with_stdout_a_terminal_too_a_partial_line_rendered_to_stdout_before_the_first_region_draws_stays_on_its_own_row()
 {
    let (fixture, _) = scenario(Term::Both, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out.render("partial", &text()).await?;
                let region = ctx.out.region(RegionOptions::new());
                region.draw("frame one", &text()).await?;
                region.draw("frame two", &text()).await?;
                fixture.mark("drawn");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(fixture.screen(Some("drawn")), ["partial", "frame two"]);
}

#[tokio::test]
async fn with_stdout_a_terminal_too_a_whole_line_printed_after_a_partial_stderr_line_leaves_no_blank_row()
 {
    let (fixture, _) = scenario(Term::Both, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out.draw("partial", &text()).await?;
                ctx.out.print("printed").await?;
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                fixture.mark("drawn");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(fixture.screen(Some("drawn")), ["partialprinted", "frame"]);
}

/// An `on_log` hook that writes each record to its destination's stderr.
fn hooked(app: App) -> App {
    install_log_hook(
        app,
        |event: &loomcli_core::LogEvent, destination: &loomcli_core::LogDestination| {
            if let Some(stderr) = &destination.stderr {
                let record = format!("hook {}\n", event.message);
                drop(stderr.write(record.as_bytes()));
            }
        },
    )
}

#[tokio::test]
async fn an_on_log_hooks_write_to_its_destinations_stderr_lands_above_the_region() {
    let fixture = Fixture::new(Term::Tty, &[]);
    let app = hooked(app({
        let fixture = fixture.clone();
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.draw("frame", &text()).await?;
                ctx.log.info("heard", ());
                region.draw("frame again", &text()).await?;
                fixture.mark("logged");
                Ok(())
            }
        }
    }));
    assert_eq!(fixture.run(&app).await, 0);
    assert_eq!(
        fixture.screen(Some("logged")),
        ["hook heard", "frame again"]
    );
}

#[tokio::test]
async fn records_an_on_log_hook_writes_at_once_land_above_a_lane_line_written_after_them_in_call_order()
 {
    let fixture = Fixture::new(Term::Tty, &[]);
    let app = hooked(app({
        let fixture = fixture.clone();
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.draw("frame", &text()).await?;
                ctx.log.info("one", ());
                ctx.log.info("two", ());
                ctx.log.info("three", ());
                ctx.out.info("lane").await?;
                fixture.mark("logged");
                Ok(())
            }
        }
    }));
    assert_eq!(fixture.run(&app).await, 0);
    assert_eq!(
        fixture.screen(Some("logged")),
        ["hook one", "hook two", "hook three", "ℹ lane", "frame"]
    );
}

#[tokio::test]
async fn an_input_region_holds_the_other_regions_still_and_releases_them_when_it_closes() {
    let (fixture, code) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let ticking = ctx.out.region(RegionOptions::new());
                let closing = ctx.out.region(RegionOptions::new());
                ticking.draw("tick 0", &text()).await?;
                closing.draw("closing frame", &text()).await?;
                let question = ctx.out.region(RegionOptions::new().input());
                question.draw("question", &text()).await?;
                ticking.draw("tick 1", &text()).await?;
                ticking.draw("tick 2", &text()).await?;
                closing.draw("closing last", &text()).await?;
                closing.end(EndState::Ended, None).await?;
                fixture.mark("frozen");
                let second = ctx.out.region(RegionOptions::new().input());
                let opened = Arc::new(AtomicBool::new(false));
                let waiting = {
                    let draw = second.draw("second question", &text());
                    let opened = Arc::clone(&opened);
                    tokio::spawn(async move {
                        let drawn = draw.await;
                        opened.store(true, Ordering::SeqCst);
                        drawn
                    })
                };
                for _ in 0..10 {
                    tokio::task::yield_now().await;
                }
                fixture.note("openedBeforeClose", opened.load(Ordering::SeqCst));
                question.draw("answered", &text()).await?;
                question.end(EndState::Ended, None).await?;
                waiting.await.unwrap()?;
                fixture.note("openedAfterClose", opened.load(Ordering::SeqCst));
                fixture.mark("released");
                second.end(EndState::Ended, None).await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(
        fixture.screen(Some("frozen")),
        ["tick 0", "closing frame", "question"]
    );
    // A region that closed meanwhile is above the input region's last frame, and the others catch
    // up.
    assert_eq!(
        fixture.screen(Some("released")),
        ["closing last", "answered", "tick 2", "second question"]
    );
    // A second input region's first draw resolves only after the first input region closes.
    assert_eq!(
        fixture.notes(),
        json!({ "openedBeforeClose": false, "openedAfterClose": true })
    );
}

#[tokio::test]
async fn end_and_the_actions_return_close_regions_as_end_and_completion() {
    let (fixture, code) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let ended = ctx.out.region(RegionOptions::new());
                fixture.watch("end", &ended, |_| {});
                ended.draw("ending", &text()).await?;
                ended.end(EndState::Ended, None).await?;
                let completed = ctx.out.region(RegionOptions::new());
                fixture.watch("completion", &completed, |region| {
                    drop(region.draw("completed by core", &text()));
                });
                completed.draw("running", &text()).await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(
        fixture.notes(),
        json!({ "completion": "completion", "end": "end" })
    );
    assert_eq!(fixture.screen(None), ["ending", "completed by core"]);
}

#[tokio::test]
async fn a_failure_closes_every_region_before_the_report_which_follows_each_last_frame() {
    let (fixture, code) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let failing = ctx.out.region(RegionOptions::new());
                fixture.watch("failure", &failing, |region| {
                    drop(region.draw("action failed frame", &text()));
                });
                ctx.out
                    .region(RegionOptions::new())
                    .draw("action frame", &text())
                    .await?;
                Err(ctx.out.fatal("It failed."))
            }
        }
    })
    .await;
    assert_eq!(code, 1);
    assert_eq!(fixture.notes(), json!({ "failure": "failure" }));
    assert_eq!(
        fixture.screen(None),
        ["action failed frame", "action frame", "It failed."]
    );
}

#[tokio::test]
async fn cancellation_closes_every_region_a_waiting_input_region_included_and_writes_no_report() {
    let (fixture, code) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let cancelled = ctx.out.region(RegionOptions::new());
                fixture.watch("cancellation", &cancelled, |region| {
                    drop(region.draw("cancelled frame", &text()));
                });
                ctx.out
                    .region(RegionOptions::new().input())
                    .draw("question", &text())
                    .await?;
                let waiting = ctx.out.region(RegionOptions::new().input());
                fixture.watch("waiting", &waiting, |_| {});
                fixture.caller.cancel();
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(code, 130);
    assert_eq!(
        fixture.notes(),
        json!({ "cancellation": "cancellation", "waiting": "cancellation" })
    );
    assert_eq!(fixture.screen(None), ["cancelled frame", "question"]);
}

#[tokio::test]
async fn a_region_opened_after_the_runs_cancellation_closes_with_cancellation_as_it_opens() {
    let (fixture, code) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                fixture.caller.cancel();
                let late = ctx.out.region(RegionOptions::new());
                fixture.note("late", closer(late.closed_by()));
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(code, 130);
    assert_eq!(fixture.notes(), json!({ "late": "cancellation" }));
}

/// Whether a plain and an input region are live, and how many draws reached their view.
async fn live_scenario(term: Term, argv: &[&str]) -> Fixture {
    scenario(term, argv, |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let plain = ctx.out.region(RegionOptions::new());
                let input = ctx.out.region(RegionOptions::new().input());
                let calls = Arc::new(AtomicUsize::new(0));
                let counted = {
                    let calls = Arc::clone(&calls);
                    View::new(move |value: &str, _: &ViewContext| {
                        calls.fetch_add(1, Ordering::SeqCst);
                        value.to_owned()
                    })
                };
                fixture.note("live", plain.live());
                fixture.note("inputLive", input.live());
                plain.draw("plain frame", &counted).await?;
                input.draw("input frame", &counted).await?;
                input.end(EndState::Ended, None).await?;
                fixture.note("calls", calls.load(Ordering::SeqCst));
                Ok(())
            }
        }
    })
    .await
    .0
}

#[tokio::test]
async fn a_region_is_not_live_under_a_stderr_that_is_not_a_terminal_and_its_draw_calls_no_view() {
    let fixture = live_scenario(Term::Pipe, &[]).await;
    assert_eq!(
        fixture.notes(),
        json!({ "calls": 0, "inputLive": false, "live": false })
    );
    assert_eq!(fixture.written(), "");
    assert_eq!(fixture.process.stderr_text(), "");
}

#[tokio::test]
async fn at_verbosity_minus_1_a_region_without_input_is_not_live_and_an_input_region_still_draws() {
    let fixture = live_scenario(Term::Tty, &["-q"]).await;
    assert_eq!(
        fixture.notes(),
        json!({ "calls": 1, "inputLive": true, "live": false })
    );
    assert_eq!(fixture.screen(None), ["input frame"]);
}

#[tokio::test]
async fn on_a_terminal_stderr_each_environment_decides_whether_a_region_is_live() {
    let cases = [
        (("TERM", "dumb"), true, false),
        (("CI", "true"), true, false),
        (("CI", ""), true, true),
        (("CI", "false"), true, true),
    ];
    for ((name, value), input, live) in cases {
        let seen = Arc::new(Mutex::new((false, false)));
        let app: App = Application::new("regions").action({
            let seen = Arc::clone(&seen);
            move |ctx: Context| {
                let seen = Arc::clone(&seen);
                async move {
                    let plain = ctx.out.region(RegionOptions::new()).live();
                    let asked = ctx.out.region(RegionOptions::new().input()).live();
                    *seen.lock().unwrap() = (asked, plain);
                    Ok(())
                }
            }
        });
        let mock = mock_process(
            MockFields::new()
                .env("TERM", "xterm")
                .env(name, value)
                .terminal(MockTerminal::new(40, 24).streams([StreamName::Stderr])),
        );
        let code = app
            .run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await;
        assert_eq!(code.get(), 0);
        assert_eq!(*seen.lock().unwrap(), (input, live), "{name}={value}");
    }
}

#[tokio::test]
async fn on_a_terminal_stderr_out_draw_keeps_its_cursor_movement_only_where_the_terminal_redraws() {
    let cases = [
        (("TERM", "xterm"), "\u{1b}[1Aup"),
        (("TERM", "dumb"), "up"),
        (("CI", "true"), "up"),
    ];
    for ((name, value), expected) in cases {
        let app: App = Application::new("regions").action(|ctx: Context| async move {
            ctx.out
                .draw(
                    &(),
                    &View::new(|(): &(), _: &ViewContext| "\u{1b}[1Aup".to_owned()),
                )
                .await?;
            Ok(())
        });
        let mock = mock_process(
            MockFields::new()
                .env("TERM", "xterm")
                .env(name, value)
                .terminal(MockTerminal::new(40, 24).streams([StreamName::Stderr])),
        );
        let code = app
            .run(RunOptions::new().process(Arc::clone(&mock) as _))
            .await;
        assert_eq!(code.get(), 0);
        assert_eq!(mock.stderr_text(), expected, "{name}={value}");
    }
}

#[tokio::test]
async fn a_frame_drawn_before_a_reflowing_resize_is_erased_whole_by_the_rows_it_takes_at_the_new_width()
 {
    let (fixture, _) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                fixture.process.resize(80, 24);
                let region = ctx.out.region(RegionOptions::new());
                let frame = format!("{}\n{}", "a".repeat(60), "b".repeat(60));
                region.draw(frame.as_str(), &text()).await?;
                fixture.process.resize(40, 24);
                region.draw("after", &text()).await?;
                fixture.mark("redrawn");
                Ok(())
            }
        }
    })
    .await;
    // Each 60-column line takes two rows at 40 columns, so the erase climbs the three rows above
    // the cursor's: the reference's emulator then shows `after` alone.
    let end = fixture.marks.lock().unwrap()[0].1;
    let writes: Vec<String> = fixture.process.transcript()[..end]
        .iter()
        .map(|write| format!("{write:?}"))
        .collect();
    assert_eq!(
        writes,
        [
            format!(
                "Stderr({:?})",
                format!("{}\n{}", "a".repeat(60), "b".repeat(60))
            ),
            format!("Stderr({:?})", "\r\u{1b}[3A\u{1b}[Jafter"),
        ]
    );
}

/// `out.draw` beside an open region, under `argv`.
async fn draw_scenario(argv: &[&str]) -> Fixture {
    scenario(Term::Tty, argv, |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                let count = ctx.out.draw("drawn\nrow", &text()).await?;
                fixture.note("count", count);
                fixture.mark("drawn");
                Ok(())
            }
        }
    })
    .await
    .0
}

#[tokio::test]
async fn out_draw_lands_above_an_open_region_and_keeps_its_count() {
    let fixture = draw_scenario(&[]).await;
    assert_eq!(fixture.notes(), json!({ "count": 1 }));
    assert_eq!(fixture.screen(Some("drawn")), ["drawn", "row", "frame"]);
}

#[tokio::test]
async fn out_draw_draws_at_verbosity_minus_1_where_a_region_without_input_does_not() {
    let fixture = draw_scenario(&["-q"]).await;
    assert_eq!(fixture.notes(), json!({ "count": 1 }));
    assert_eq!(fixture.screen(Some("drawn")), ["drawn", "row"]);
}

#[tokio::test]
async fn a_two_row_out_draw_frame_redrawn_by_its_count_above_an_open_region_leaves_only_its_last_frame()
 {
    let (fixture, _) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("progress line", &text())
                    .await?;
                let mut rows = 0;
                for step in 1..=3 {
                    if step > 1 {
                        let erase = format!("\r\u{1b}[{rows}A\u{1b}[J");
                        ctx.out.draw(erase.as_str(), &text()).await?;
                    }
                    let frame = format!("frame {step} top\nframe {step} bottom");
                    rows = ctx.out.draw(frame.as_str(), &text()).await?;
                }
                fixture.mark("redrawn");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(
        fixture.screen(Some("redrawn")),
        ["frame 3 top", "frame 3 bottom", "progress line"]
    );
}

#[tokio::test]
async fn an_info_line_after_a_partial_out_draw_continues_its_row_above_an_open_region() {
    let (fixture, _) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                ctx.out.draw("partial", &text()).await?;
                ctx.out.info("done").await?;
                fixture.mark("written");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(fixture.screen(Some("written")), ["partialℹ done", "frame"]);
}

#[tokio::test]
async fn an_info_line_after_an_out_draw_that_fills_its_row_starts_on_the_row_below() {
    let (fixture, _) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                ctx.out.draw("x".repeat(40).as_str(), &text()).await?;
                ctx.out.info("done").await?;
                fixture.mark("written");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(
        fixture.screen(Some("written")),
        ["x".repeat(40).as_str(), "ℹ done", "frame"]
    );
}

#[tokio::test]
async fn with_stdout_a_terminal_too_concurrent_print_info_and_print_calls_land_above_the_region_in_call_order()
 {
    let (fixture, _) = scenario(Term::Both, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                let (first, second, third) = tokio::join!(
                    ctx.out.print("first"),
                    ctx.out.info("second"),
                    ctx.out.print("third")
                );
                first?;
                second?;
                third?;
                fixture.mark("written");
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(
        fixture.screen(Some("written")),
        ["first", "ℹ second", "third", "frame"]
    );
}

#[tokio::test]
async fn with_stdout_a_terminal_too_a_print_issued_behind_a_row_sequence_lands_after_its_rows_and_an_info_line_is_not_held()
 {
    let (fixture, _) = scenario(Term::Both, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                let pause = Box::pin(tokio::time::sleep(std::time::Duration::from_millis(5)));
                let source = scripted(vec![
                    Step::Row("row one"),
                    Step::Pause(pause),
                    Step::Row("row two"),
                ]);
                let view = rows_view();
                let (rows, after, noted) = tokio::join!(
                    ctx.out.render(source, &view),
                    ctx.out.print("after rows"),
                    ctx.out.info("noted")
                );
                rows?;
                after?;
                noted?;
                fixture.mark("written");
                Ok(())
            }
        }
    })
    .await;
    // The sequence writes its first row when the join first polls it, so the info line, which no
    // row holds back, lands between the rows; the print waits behind the last row.
    assert_eq!(
        fixture.screen(Some("written")),
        ["row one", "ℹ noted", "row two", "after rows", "frame"]
    );
}

#[tokio::test]
async fn with_stdout_a_terminal_too_a_row_source_that_awaits_an_info_line_ends_while_a_print_waits_behind_its_rows()
 {
    let (fixture, code) = scenario(Term::Both, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move { reported(&ctx.out, &fixture).await }
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(
        fixture.screen(Some("written")),
        ["row one", "ℹ fetching page two", "row two", "after rows"]
    );
}

#[tokio::test]
async fn with_stdout_a_terminal_too_a_row_source_that_awaits_an_info_line_above_an_open_region_ends_while_a_print_waits()
 {
    let (fixture, code) = scenario(Term::Both, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                ctx.out
                    .region(RegionOptions::new())
                    .draw("frame", &text())
                    .await?;
                reported(&ctx.out, &fixture).await
            }
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(
        fixture.screen(Some("written")),
        [
            "row one",
            "ℹ fetching page two",
            "row two",
            "after rows",
            "frame"
        ]
    );
}

#[tokio::test]
async fn draw_end_and_report_on_a_closed_region_do_nothing_and_resolve() {
    let (fixture, _) = scenario(Term::Tty, &[], |fixture| {
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let region = ctx.out.region(RegionOptions::new());
                region.draw("frame", &text()).await?;
                region.end(EndState::Ended, None).await?;
                let calls = Arc::new(AtomicUsize::new(0));
                let counted = {
                    let calls = Arc::clone(&calls);
                    View::new(move |value: &str, _: &ViewContext| {
                        calls.fetch_add(1, Ordering::SeqCst);
                        value.to_owned()
                    })
                };
                region.draw("late", &counted).await?;
                region.end(EndState::Failed, None).await?;
                region.report(loomcli_core::ProgressReport::new().completed(1.0));
                fixture.note("closedBy", closer(region.closed_by()));
                fixture.note("calls", calls.load(Ordering::SeqCst));
                Ok(())
            }
        }
    })
    .await;
    assert_eq!(fixture.notes(), json!({ "calls": 0, "closedBy": "end" }));
    assert_eq!(fixture.screen(None), ["frame"]);
}

#[tokio::test]
async fn a_broken_frame_view_fails_its_draw_and_writes_nothing() {
    let (fixture, code) = scenario(Term::Tty, &[], |_| {
        move |ctx: Context| async move {
            let region = ctx.out.region(RegionOptions::new());
            let broken = View::new(|_: &str, _: &ViewContext| -> Result<String, Error> {
                Err(Error::from_foreign("The frame broke.".into()))
            });
            let drawn = region.draw("frame", &broken).await;
            assert!(drawn.is_err());
            Ok(())
        }
    })
    .await;
    assert_eq!(code, 0);
    assert_eq!(fixture.written(), "");
}

/// Runs `application` with `stderr` standing in for a terminal stderr 40 columns wide, beside a
/// piped stdout, and answers the exit code.
async fn on_scripted_stderr(application: &App, stderr: Arc<ScriptedStream>) -> u8 {
    let mock = mock_process(MockFields::new().env("NO_COLOR", "1").env("TERM", "xterm"));
    let mut handle = Swapped::new(mock);
    handle.stderr = Some(stderr);
    handle.terminal = Some(Arc::new(Facts {
        stdin: false,
        stdout: OutputTerminal::new(false, None, None),
        stderr: OutputTerminal::new(true, Some(40), Some(24)),
        stated: None,
    }));
    application
        .run(RunOptions::new().process(Arc::new(handle)))
        .await
        .get()
}

#[tokio::test]
async fn a_hook_record_and_a_region_close_called_behind_a_waiting_stderr_write_land_after_it() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let app = hooked(app(|ctx: Context| async move {
        let region = ctx.out.region(RegionOptions::new());
        region.draw("frame", &text()).await?;
        // The first line holds stderr's turn while the second waits for it; the hook's record and
        // the region's close are called after both.
        let (first, second, ended) =
            tokio::join!(ctx.out.info("first"), ctx.out.info("second"), async {
                ctx.log.info("heard", ());
                region.end(EndState::Ended, None).await
            },);
        first?;
        second?;
        ended
    }));
    let code = on_scripted_stderr(
        &app,
        ScriptedStream::slow(Duration::from_millis(2), Arc::clone(&seen)),
    )
    .await;
    assert_eq!(code, 0);
    assert_eq!(
        *seen.lock().unwrap(),
        [
            Seen::Wrote("frame".to_owned()),
            Seen::Wrote("\r\u{1b}[Jℹ first\nframe".to_owned()),
            Seen::Wrote("\r\u{1b}[Jℹ second\nframe".to_owned()),
            Seen::Wrote("\r\u{1b}[Jhook heard\nframe".to_owned()),
            Seen::Wrote("\n".to_owned()),
        ]
    );
}

#[tokio::test]
async fn end_rejects_with_stderrs_failure_when_the_close_cannot_be_written() {
    // The close's own write fails, and a close after an earlier write failed is refused unsent.
    for fails_first in [false, true] {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let ended = Arc::new(Mutex::new(None));
        let app = app({
            let ended = Arc::clone(&ended);
            move |ctx: Context| {
                let ended = Arc::clone(&ended);
                async move {
                    let region = ctx.out.region(RegionOptions::new());
                    region.draw("frame", &text()).await?;
                    if fails_first {
                        let _ = ctx.out.info("lost").await;
                    }
                    let result = region.end(EndState::Ended, None).await;
                    *ended.lock().unwrap() = Some(result.map_err(|error| {
                        error.foreign().map(ToString::to_string).unwrap_or_default()
                    }));
                    Ok(())
                }
            }
        });
        let code = on_scripted_stderr(
            &app,
            ScriptedStream::refusing(1, io::ErrorKind::StorageFull, Arc::clone(&seen)),
        )
        .await;
        assert_eq!(code, 1, "fails first: {fails_first}");
        assert_eq!(
            *ended.lock().unwrap(),
            Some(Err("write StorageFull".to_owned())),
            "fails first: {fails_first}"
        );
        let refused = if fails_first {
            "\r\u{1b}[Jℹ lost\nframe"
        } else {
            "\n"
        };
        assert_eq!(
            seen.lock().unwrap()[..2],
            [
                Seen::Wrote("frame".to_owned()),
                Seen::Refused(refused.to_owned()),
            ],
            "fails first: {fails_first}"
        );
    }
}

// Regions a middleware and a configuration source open, regions under an invocation by name, and
// the ending signal's show-cursor bytes.

/// The tag the fixture's source binds, carried by a global option so the source is asked.
const TAG: loomcli_core::Extension<loomcli_core::OptionTarget, String> =
    loomcli_core::Extension::new("@fixture/regions/tag");

/// The fixture's Application under `plugins`, with a tagged global option the source is asked for.
fn plugged<F, Fut>(plugins: Vec<loomcli_core::Plugin>, action: F) -> App
where
    F: Fn(Context) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<(), Error>> + Send + 'static,
{
    Application::new("regions")
        .description("Draw live regions.")
        .plugins(plugins)
        .global_option(
            "verbose",
            Opt::count()
                .description("Show more detail.")
                .short('v')
                .verbose(),
        )
        .global_option(
            "tagged",
            Opt::string().extend([TAG.value("tagged".to_owned())]),
        )
        .action(action)
}

/// A plugin whose source runs `act` over its output handle and answers nothing.
fn region_source(
    act: impl Fn(Out) -> std::pin::Pin<Box<dyn Future<Output = Result<(), Error>> + Send>>
    + Send
    + Sync
    + 'static,
) -> loomcli_core::Plugin {
    let act = Arc::new(act);
    loomcli_core::Plugin::new("@fixture/source")
        .extensions([loomcli_core::AnyExtension::from(TAG)])
        .source(loomcli_core::ConfigurationSource::new(
            &TAG,
            move |context: loomcli_core::SourceContext<NoInputs>| {
                let act = Arc::clone(&act);
                async move {
                    act(context.out.clone()).await?;
                    Ok(std::collections::BTreeMap::new())
                }
            },
        ))
}

#[tokio::test]
async fn a_region_a_middleware_opens_before_next_stays_open_through_the_action_and_closes_once_the_chain_unwinds()
 {
    let fixture = Fixture::new(Term::Tty, &[]);
    let around = loomcli_core::Plugin::new("@fixture/around").middleware(
        loomcli_core::Activation::Always,
        {
            let fixture = fixture.clone();
            move |ctx, next: loomcli_core::Next| {
                let fixture = fixture.clone();
                async move {
                    let before = ctx.out.region(RegionOptions::new());
                    fixture.watch("before", &before, |_| {});
                    let outcome = next.run().await;
                    fixture.note("beforeAfterNext", closer(before.closed_by()));
                    let action = fixture.notes()["action"]
                        .as_str()
                        .unwrap_or("open")
                        .to_owned();
                    fixture.note("actionAfterNext", action);
                    let after = ctx.out.region(RegionOptions::new());
                    fixture.watch("after", &after, |_| {});
                    outcome.map(|_| ())
                }
            }
        },
    );
    let application = plugged(vec![around], {
        let fixture = fixture.clone();
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                fixture.watch("action", &ctx.out.region(RegionOptions::new()), |_| {});
                Ok(())
            }
        }
    });
    assert_eq!(fixture.run(&application).await, 0);
    assert_eq!(
        fixture.notes(),
        json!({
            "action": "completion",
            "actionAfterNext": "completion",
            "after": "completion",
            "before": "completion",
            "beforeAfterNext": "open",
        })
    );
}

#[tokio::test]
async fn a_region_a_configuration_source_opens_closes_with_completion_after_help_takes_over() {
    let fixture = Fixture::new(Term::Tty, &["--help"]);
    let help = loomcli_core::Plugin::new("@fixture/help")
        .option("help", Opt::boolean())
        .middleware(
            loomcli_core::Activation::options(["help"]),
            |ctx, _next: loomcli_core::Next| async move { ctx.out.print("help").await },
        );
    let source = region_source({
        let fixture = fixture.clone();
        move |out: Out| {
            fixture.watch("source", &out.region(RegionOptions::new()), |_| {});
            Box::pin(async { Ok(()) })
        }
    });
    let application = plugged(vec![help, source], |_: Context| async { Ok(()) });
    assert_eq!(fixture.run(&application).await, 0);
    assert_eq!(fixture.notes(), json!({ "source": "completion" }));
}

#[tokio::test]
async fn a_failure_closes_the_regions_of_the_action_a_middleware_and_a_source_before_the_report() {
    let fixture = Fixture::new(Term::Tty, &[]);
    let around = loomcli_core::Plugin::new("@fixture/around").middleware(
        loomcli_core::Activation::Always,
        {
            let fixture = fixture.clone();
            move |ctx, next: loomcli_core::Next| {
                let fixture = fixture.clone();
                async move {
                    let region = ctx.out.region(RegionOptions::new());
                    fixture.watch("middleware", &region, |closing| {
                        drop(closing.draw("middleware failed frame", &text()));
                    });
                    region.draw("middleware frame", &text()).await?;
                    next.run().await.map(|_| ())
                }
            }
        },
    );
    let source = region_source({
        let fixture = fixture.clone();
        move |out: Out| {
            let fixture = fixture.clone();
            Box::pin(async move {
                let region = out.region(RegionOptions::new());
                fixture.watch("source", &region, |closing| {
                    drop(closing.draw("source failed frame", &text()));
                });
                region.draw("source frame", &text()).await
            })
        }
    });
    let application = plugged(vec![around, source], {
        let fixture = fixture.clone();
        move |ctx: Context| {
            let fixture = fixture.clone();
            async move {
                let failing = ctx.out.region(RegionOptions::new());
                fixture.watch("failure", &failing, |region| {
                    drop(region.draw("action failed frame", &text()));
                });
                ctx.out
                    .region(RegionOptions::new())
                    .draw("action frame", &text())
                    .await?;
                Err(ctx.out.fatal("It failed."))
            }
        }
    });
    assert_eq!(fixture.run(&application).await, 1);
    assert_eq!(
        fixture.notes(),
        json!({ "failure": "failure", "middleware": "failure", "source": "failure" })
    );
    assert_eq!(
        fixture.screen(None),
        [
            "action failed frame",
            "action frame",
            "source failed frame",
            "middleware failed frame",
            "It failed.",
        ]
    );
}

/// The live scenario's action, recording into `fixture`.
fn live_action(
    fixture: Fixture,
) -> impl Fn(Context) -> std::pin::Pin<Box<dyn Future<Output = Result<(), Error>> + Send>>
+ Send
+ Sync
+ 'static {
    move |ctx: Context| {
        let fixture = fixture.clone();
        Box::pin(async move {
            let plain = ctx.out.region(RegionOptions::new());
            let input = ctx.out.region(RegionOptions::new().input());
            let calls = Arc::new(AtomicUsize::new(0));
            let counted = {
                let calls = Arc::clone(&calls);
                View::new(move |value: &str, _: &ViewContext| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    value.to_owned()
                })
            };
            fixture.note("live", plain.live());
            fixture.note("inputLive", input.live());
            plain.draw("plain frame", &counted).await?;
            input.draw("input frame", &counted).await?;
            input.end(EndState::Ended, None).await?;
            fixture.note("calls", calls.load(Ordering::SeqCst));
            Ok(())
        })
    }
}

#[tokio::test]
async fn a_region_is_not_live_under_an_invocation_by_name_and_its_draw_calls_no_view() {
    let fixture = Fixture::new(Term::Tty, &[]);
    let application = app(live_action(fixture.clone()));
    let outcome = application
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<Error>::new(),
            Some(Arc::clone(&fixture.process) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Completed { output, messages } = outcome else {
        panic!("the call completes");
    };
    assert_eq!((output.as_str(), messages.as_str()), ("", ""));
    assert_eq!(
        fixture.notes(),
        json!({ "calls": 0, "inputLive": false, "live": false })
    );
    assert_eq!(fixture.written(), "");
}

#[tokio::test]
async fn a_region_is_not_live_under_an_actions_invoke_at_a_terminal_and_its_draw_calls_no_view() {
    let fixture = Fixture::new(Term::Tty, &["nested"]);
    let application = Application::new("regions")
        .command(loomcli_core::Command::new("live").action(live_action(fixture.clone())))
        .command(
            loomcli_core::Command::new("nested").action(|ctx: Context| async move {
                let outcome = ctx
                    .invoke(
                        &["live"],
                        loomcli_core::InvocationValues::new(),
                        loomcli_core::InvokeOptions::<Error>::new(),
                    )
                    .await;
                assert!(matches!(
                    outcome,
                    loomcli_core::InvocationOutcome::Completed { .. }
                ));
                Ok(())
            }),
        );
    let code = application
        .run(RunOptions::new().process(Arc::clone(&fixture.process) as _))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        fixture.notes(),
        json!({ "calls": 0, "inputLive": false, "live": false })
    );
    assert_eq!(fixture.written(), "");
}

#[tokio::test]
async fn a_signal_that_ends_the_run_shows_the_cursor_only_where_controls_are_kept() {
    for ((name, value), preserve, text) in [
        (("TERM", "dumb"), false, "\u{2139} working\n"),
        (("CI", "true"), false, "\u{2139} working\n"),
        (("TERM", "dumb"), true, "\u{2139} working\n\u{1b}[?25h"),
    ] {
        let ready = Arc::new(tokio::sync::Notify::new());
        let policy = if preserve {
            loomcli_core::RenderingPolicy::new()
                .terminal_controls(loomcli_core::TerminalControls::Preserve)
        } else {
            loomcli_core::RenderingPolicy::new()
        };
        let application: App = Application::new("regions").rendering(policy).action({
            let ready = Arc::clone(&ready);
            move |ctx: Context| {
                let ready = Arc::clone(&ready);
                async move {
                    ctx.out.info("working").await?;
                    ready.notify_one();
                    ctx.signal.cancelled().await;
                    Ok(())
                }
            }
        });
        let mock = mock_process(
            MockFields::new()
                .env("TERM", "xterm")
                .env(name, value)
                .terminal(MockTerminal::new(40, 24).streams([StreamName::Stderr])),
        );
        let running = application.run(RunOptions::new().process(Arc::clone(&mock) as _));
        let raise = {
            let mock = Arc::clone(&mock);
            async move {
                ready.notified().await;
                mock.raise(loomcli_core::ProcessSignal::Int);
            }
        };
        let (code, ()) = tokio::join!(running, raise);
        assert_eq!(code.get(), 130, "{name}={value} preserve {preserve}");
        assert_eq!(
            (mock.ended_by(), mock.stderr_text()),
            (Some(loomcli_core::ProcessSignal::Int), text.to_owned()),
            "{name}={value} preserve {preserve}"
        );
    }
}
