//! Ports `results.test.ts`, `result-views.test.ts`, `rows.test.ts`, `incomplete.test.ts`, and the
//! rendering case of `media-types.test.ts`: declared results and their emission, row views and
//! whole views over a sequence, back-pressure, the result contract, and the incomplete-result line
//! a sequence that stops early writes, end to end through `Application::run` on the mock process.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::VecDeque;
use std::io;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::Poll;
use std::time::Duration;

use loomcli_core::{
    Activation, Application, Build, Command, Context, Error, FailureFacts, FailureView, FatalError,
    InputError, InternalError, NoInputs, NoResult, Plugin, ReleaseFacts, ResultError, ResultFault,
    ResultViews, RowSource, RowView, RowViews, RowsResult, RunOptions, ValueResult, View,
    ViewContext, ViewOverride, failure, incomplete_result, override_view,
};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use serde::Serialize;
use support::Ran;
use support::streams::{Scripted, Seen, Swapped};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
struct Entry {
    source: &'static str,
}

fn entries() -> Vec<Entry> {
    vec![
        Entry { source: "one.txt" },
        Entry {
            source: "two words.txt",
        },
    ]
}

/// The row view every rows declaration names: one head, one line per row, one tail.
fn list() -> RowView<Entry> {
    RowView::new(|row: &Entry, index, _: &ViewContext| format!("{index}: {}\n", row.source))
        .head(|_: &ViewContext| "PATHS\n".to_owned())
        .tail(|_, _: &ViewContext| "END\n".to_owned())
}

/// The whole view over the collected rows.
fn collected() -> View<[Entry]> {
    View::new(|rows: &[Entry], _: &ViewContext| format!("{} rows\n", rows.len()))
}

const SEQUENCE: &str = "PATHS\n0: one.txt\n1: two words.txt\nEND\n";

/// One step of a scripted asynchronous source.
enum Step {
    Row(Entry),
    Fail(Box<dyn FnOnce() -> Error + Send>),
    /// Cancels the token, then goes on.
    Cancel(CancellationToken),
    /// Yields this row forever.
    Endless(Entry),
}

/// An asynchronous source that waits one turn before each step.
struct Steps {
    steps: VecDeque<Step>,
    waited: bool,
}

impl futures_core::Stream for Steps {
    type Item = Result<Entry, Error>;

    fn poll_next(
        mut self: Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        if !self.waited {
            self.waited = true;
            context.waker().wake_by_ref();
            return Poll::Pending;
        }
        self.waited = false;
        loop {
            match self.steps.pop_front() {
                None => return Poll::Ready(None),
                Some(Step::Row(row)) => return Poll::Ready(Some(Ok(row))),
                Some(Step::Fail(error)) => return Poll::Ready(Some(Err(error()))),
                Some(Step::Cancel(token)) => token.cancel(),
                Some(Step::Endless(row)) => {
                    self.steps.push_front(Step::Endless(row.clone()));
                    return Poll::Ready(Some(Ok(row)));
                }
            }
        }
    }
}

fn steps(steps: Vec<Step>) -> RowSource<Entry> {
    RowSource::stream(Steps {
        steps: steps.into(),
        waited: false,
    })
}

fn streamed() -> RowSource<Entry> {
    steps(entries().into_iter().map(Step::Row).collect())
}

fn fatal(message: &'static str) -> Step {
    Step::Fail(Box::new(move || FatalError::new(message).into()))
}

/// A source that fails after its first row.
fn failing(failure: Step) -> RowSource<Entry> {
    steps(vec![Step::Row(entries()[0].clone()), failure])
}

/// The incomplete-result line.
fn line(subject: &str, yielded: usize, written: usize) -> String {
    format!("Output is incomplete: {subject} stopped after {yielded} rows, {written} written.\n")
}

const PARTIAL: &str = "PATHS\n0: one.txt\n";

/// How one run went: the mock, the caller's token, the release, and replaced streams.
struct Setup {
    fields: MockFields,
    token: Option<CancellationToken>,
    stdout: Option<Arc<Scripted>>,
    stderr: Option<Arc<Scripted>>,
}

impl Setup {
    fn new(argv: &[&str]) -> Self {
        Self {
            fields: MockFields::new()
                .argv(argv.iter().copied())
                .release(ReleaseFacts::new(Build::Distributed)),
            token: None,
            stdout: None,
            stderr: None,
        }
    }
}

async fn ran<I, R, S: loomcli_core::State>(app: &Application<I, R, S>, setup: Setup) -> Ran {
    let mock: Arc<MockProcess> = mock_process(setup.fields);
    let mut handle = Swapped::new(Arc::clone(&mock));
    handle.stdout = setup.stdout.map(|stream| stream as _);
    handle.stderr = setup.stderr.map(|stream| stream as _);
    let mut options = RunOptions::new().process(Arc::new(handle));
    if let Some(token) = setup.token {
        options = options.signal(token);
    }
    let code = app.run(options).await;
    Ran {
        status: code.get(),
        stdout: mock.stdout_text(),
        stderr: mock.stderr_text(),
    }
}

/// An application whose `count` Command declares rows through `views` and whose action is `act`.
fn counting<F, Fut>(
    views: RowViews<Entry>,
    act: F,
) -> Application<NoInputs, NoResult, loomcli_core::Group>
where
    F: Fn(Context<NoInputs, RowsResult<Entry>>) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = loomcli_core::Outcome> + Send + 'static,
{
    Application::new("incomplete").command(Command::new("count").rows(views).action(act))
}

fn listed() -> RowViews<Entry> {
    RowViews::new().view("list", list())
}

fn tabled() -> RowViews<Entry> {
    RowViews::new().view("table", collected())
}

// results.test.ts

#[derive(Serialize)]
struct Total {
    total: u32,
}

fn total() -> View<Total> {
    View::new(|value: &Total, _: &ViewContext| format!("total {}\n", value.total))
}

/// The facts every results scenario runs under: a Linux console on stderr alone.
fn results_setup(argv: &[&str], development: bool) -> Setup {
    let build = if development {
        Build::Development
    } else {
        Build::Distributed
    };
    let mut setup = Setup::new(argv);
    setup.fields = setup
        .fields
        .env("TERM", "linux")
        .platform("linux")
        .release(ReleaseFacts::new(build))
        .terminal(MockTerminal::new(80, 24).streams([StreamName::Stderr]));
    setup
}

#[tokio::test]
async fn a_value_result_renders_its_default_view_to_stdout() {
    let app = Application::new("results").command(
        Command::new("count")
            .result(ResultViews::new().view("table", total()))
            .action(|ctx: Context<NoInputs, ValueResult<Total>>| async move {
                ctx.out.results(Total { total: 3 }).await
            }),
    );
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 0,
            stdout: "total 3\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_rows_result_under_a_row_view_writes_every_row_of_each_source() {
    for source in [
        || RowSource::from(entries()),
        || RowSource::Iter(Box::new(entries().into_iter())),
        streamed,
    ] {
        let app = counting(listed(), move |ctx| async move {
            ctx.out.results(source()).await
        });
        assert_eq!(
            ran(&app, results_setup(&["count"], false)).await,
            Ran {
                status: 0,
                stdout: SEQUENCE.to_owned(),
                stderr: String::new(),
            }
        );
    }
}

#[tokio::test]
async fn a_whole_view_collects_every_row_and_renders_once() {
    let app = counting(
        tabled(),
        |ctx| async move { ctx.out.results(streamed()).await },
    );
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await.stdout,
        "2 rows\n"
    );
    let empty = counting(
        tabled(),
        |ctx| async move { ctx.out.results(Vec::new()).await },
    );
    assert_eq!(
        ran(&empty, results_setup(&["count"], false)).await.stdout,
        "0 rows\n"
    );
}

#[tokio::test]
async fn an_empty_sequence_still_writes_head_and_tail() {
    let app = counting(
        listed(),
        |ctx| async move { ctx.out.results(Vec::new()).await },
    );
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await.stdout,
        "PATHS\nEND\n"
    );
}

#[tokio::test]
async fn a_row_view_tail_receives_the_rows_written() {
    let counted =
        RowView::new(|row: &Entry, index, _: &ViewContext| format!("{index}: {}\n", row.source))
            .tail(|count, _: &ViewContext| format!("COUNT:{count}\n"));
    let app = counting(RowViews::new().view("counted", counted), |ctx| async move {
        ctx.out.results(entries()).await
    });
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await.stdout,
        "0: one.txt\n1: two words.txt\nCOUNT:2\n"
    );
}

#[tokio::test]
async fn the_emitted_result_orders_what_the_action_writes_next() {
    let app = counting(listed(), |ctx| async move {
        ctx.out.results(entries()).await?;
        ctx.out.info("done").await
    });
    let setup = results_setup(&["count"], false);
    let mock = mock_process(setup.fields);
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 0);
    let written: Vec<String> = mock
        .transcript()
        .into_iter()
        .map(|write| match write {
            loomcli_testing::Write::Stdout(text) | loomcli_testing::Write::Stderr(text) => text,
            _ => String::new(),
        })
        .collect();
    assert_eq!(
        written,
        [
            "PATHS\n",
            "0: one.txt\n",
            "1: two words.txt\n",
            "END\n",
            "i done\n"
        ]
    );
}

/// Everything an action writes beside its result.
async fn beside<R>(out: &loomcli_core::Out<R>) -> loomcli_core::Outcome {
    out.print(&loomcli_core::style().red().apply("plain"))
        .await?;
    out.render(
        "rendered\n",
        &View::new(|text: &str, _: &ViewContext| text.to_owned()),
    )
    .await?;
    out.render(entries(), &list()).await?;
    out.render("laned\n", &loomcli_core::lanes::print()).await
}

#[tokio::test]
async fn on_a_result_command_the_action_writes_everything_but_the_result_to_stderr() {
    let app = Application::new("results").command(
        Command::new("count")
            .result(ResultViews::new().view("table", total()))
            .action(|ctx: Context<NoInputs, ValueResult<Total>>| async move {
                beside(&ctx.out).await?;
                ctx.out.results(Total { total: 1 }).await
            }),
    );
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 0,
            stdout: "total 1\n".to_owned(),
            stderr: format!("\u{1b}[31mplain\u{1b}[39m\nrendered\n{SEQUENCE}laned\n"),
        }
    );
}

#[tokio::test]
async fn on_a_command_with_no_result_every_method_keeps_its_destination() {
    let app = Application::new("results").command(
        Command::new("plain")
            .description("The plain command.")
            .action(|ctx: Context| async move { beside(&ctx.out).await }),
    );
    assert_eq!(
        ran(&app, results_setup(&["plain"], false)).await,
        Ran {
            status: 0,
            stdout: format!("plain\nrendered\n{SEQUENCE}laned\n"),
            stderr: String::new(),
        }
    );
}

/// The sentence a development build's diagnostic states for a results-lane fault.
async fn stated<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    argv: &[&str],
    sentence: &str,
) {
    let development = ran(app, results_setup(argv, true)).await;
    assert!(
        development.stderr.contains(&format!("\n\n{sentence}\n")),
        "{}",
        development.stderr
    );
}

const GENERIC: &str = "results: Something went wrong.\n";

#[tokio::test]
async fn an_action_that_returns_without_emitting_fails_with_the_missing_fault() {
    let app = Application::new("results").command(
        Command::new("count")
            .result(ResultViews::new().view("table", total()))
            .action(|_: Context<NoInputs, ValueResult<Total>>| async { Ok(()) }),
    );
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: GENERIC.to_owned(),
        }
    );
    stated(
        &app,
        &["count"],
        "Command \"count\" declares a result and its action returned without emitting one. Call out.results() once.",
    )
    .await;
    let root = Application::new("results")
        .result(ResultViews::new().view("table", total()))
        .action(|_: Context<NoInputs, ValueResult<Total>>| async { Ok(()) });
    assert_eq!(ran(&root, results_setup(&[], false)).await.stderr, GENERIC);
    stated(
        &root,
        &[],
        "The root Command declares a result and its action returned without emitting one. Call out.results() once.",
    )
    .await;
}

/// An application whose `count` Command declares a value result and whose action emits it when
/// `emit` says so, under `plugins` and `overrides`.
fn result_command(
    emit: bool,
    plugins: Vec<Plugin>,
    overrides: Vec<ViewOverride>,
) -> Application<NoInputs, NoResult, loomcli_core::Group> {
    Application::new("results")
        .plugins(plugins)
        .overrides(overrides)
        .command(
            Command::new("count")
                .result(ResultViews::new().view("table", total()))
                .action(
                    move |ctx: Context<NoInputs, ValueResult<Total>>| async move {
                        if emit {
                            ctx.out.results(Total { total: 1 }).await?;
                        }
                        Ok(())
                    },
                ),
        )
}

/// The always-on middleware the fixture installs: it prints around the dispatch, or never
/// dispatches.
fn wrapper(dispatch: bool) -> Plugin {
    Plugin::new("@fixture/wrapper").middleware(Activation::Always, move |ctx, next| async move {
        if !dispatch {
            return Ok(());
        }
        ctx.out.print("before").await?;
        next.run().await?;
        ctx.out.print("after").await
    })
}

#[tokio::test]
async fn a_middlewares_print_keeps_stdout_on_a_result_command_before_and_after_next() {
    let app = result_command(true, vec![wrapper(true)], Vec::new());
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 0,
            stdout: "before\ntotal 1\nafter\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_middleware_that_never_dispatches_raises_no_missing_result_fault() {
    let app = result_command(false, vec![wrapper(false)], Vec::new());
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 0,
            stdout: String::new(),
            stderr: String::new(),
        }
    );
}

/// The override that brands every `InternalError`.
fn branded() -> ViewOverride {
    override_view(
        failure::<InternalError>(),
        FailureView::new(|failure: &InternalError, _| format!("branded:{}\n", failure.message())),
    )
}

/// The override keyed by `ResultError`, which prints its kind, its path, and its cause.
fn result_override() -> ViewOverride {
    override_view(
        failure::<ResultError>(),
        FailureView::new(|failure: &ResultError, _| {
            let kind = match failure.kind() {
                ResultFault::Missing => "missing",
                ResultFault::Repeated => "repeated",
            };
            let cause = if failure.cause().is_some() {
                "a cause"
            } else {
                "undefined"
            };
            format!("result:{kind}:{}:{cause}\n", failure.path().join(" "))
        }),
    )
}

#[tokio::test]
async fn an_override_of_internal_error_brands_a_result_error() {
    let app = result_command(false, Vec::new(), vec![branded()]);
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "branded:Command \"count\" declares a result and its action returned without emitting one. Call out.results() once.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn an_override_keyed_by_result_error_reaches_it_with_its_path_its_kind_and_no_cause() {
    let app = result_command(false, Vec::new(), vec![branded(), result_override()]);
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "result:missing:count:undefined\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn that_override_reaches_the_results_lane_alone_and_every_other_internal_error_is_branded() {
    let app = Application::new("results")
        .overrides([branded(), result_override()])
        .command(
            Command::new("count")
                .action(|_: Context| async { Err(io::Error::other("the action failed").into()) }),
        );
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "branded:the action failed\n".to_owned(),
        }
    );
}

fn emitting_twice(catch: bool) -> Application<NoInputs, NoResult, loomcli_core::Group> {
    Application::new("results").command(
        Command::new("count")
            .result(ResultViews::new().view("table", total()))
            .action(
                move |ctx: Context<NoInputs, ValueResult<Total>>| async move {
                    ctx.out.results(Total { total: 1 }).await?;
                    match ctx.out.results(Total { total: 2 }).await {
                        Err(_) if catch => ctx.out.print("caught").await,
                        other => other,
                    }
                },
            ),
    )
}

#[tokio::test]
async fn a_second_emission_fails_and_an_action_that_catches_it_decides() {
    assert_eq!(
        ran(&emitting_twice(false), results_setup(&["count"], false)).await,
        Ran {
            status: 1,
            stdout: "total 1\n".to_owned(),
            stderr: GENERIC.to_owned(),
        }
    );
    stated(
        &emitting_twice(false),
        &["count"],
        "Command \"count\" emitted its result twice. Call out.results() once.",
    )
    .await;
    assert_eq!(
        ran(&emitting_twice(true), results_setup(&["count"], false)).await,
        Ran {
            status: 0,
            stdout: "total 1\n".to_owned(),
            stderr: "caught\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_failure_raised_before_the_call_is_that_failure() {
    let app = Application::new("results").command(
        Command::new("count")
            .result(ResultViews::new().view("table", total()))
            .action(|_: Context<NoInputs, ValueResult<Total>>| async {
                Err(FatalError::new("The failure came first.").into())
            }),
    );
    assert_eq!(
        ran(&app, results_setup(&["count"], false)).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "The failure came first.\n".to_owned(),
        }
    );
}

// result-views.test.ts

fn relisted() -> RowView<Entry> {
    RowView::new(|row: &Entry, _, _: &ViewContext| format!("- {}\n", row.source))
}

fn wide() -> View<[Entry]> {
    View::new(|rows: &[Entry], _: &ViewContext| format!("wide {}\n", rows.len()))
}

fn narrow() -> View<[Entry]> {
    View::new(|rows: &[Entry], _: &ViewContext| format!("narrow {}\n", rows.len()))
}

async fn paths_act(ctx: Context<NoInputs, RowsResult<Entry>>) -> loomcli_core::Outcome {
    ctx.out.results(entries()).await
}

fn imported() -> Command<NoInputs, RowsResult<Entry>> {
    Command::new("paths")
        .rows(
            RowViews::new()
                .view("list", list())
                .view("table", collected()),
        )
        .action(paths_act)
}

/// The fact and the bytes one reshaped declaration publishes and writes.
async fn reshaped<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    root: bool,
) -> (serde_json::Value, String) {
    let graph = app.inspect().expect("the graph builds");
    let node = if root {
        &graph.root
    } else {
        &graph.root.children[0]
    };
    let fact = serde_json::to_value(&node.result).expect("the fact serializes");
    let argv: &[&str] = if root { &[] } else { &["paths"] };
    let ran = support::run(app, argv).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    (fact, ran.stdout)
}

#[tokio::test]
async fn a_views_call_replaces_appends_and_moves_the_default() {
    use serde_json::json;
    let replace = Application::new("reshaped")
        .command(imported().views(RowViews::new().view("list", relisted())));
    assert_eq!(
        reshaped(&replace, false).await,
        (
            json!({"default":"list","kind":"rows","mediaTypes":{"list":null,"table":null},"views":["list","table"]}),
            "- one.txt\n- two words.txt\n".to_owned()
        )
    );
    let append = Application::new("reshaped")
        .command(imported().views(RowViews::new().view("wide", wide())));
    assert_eq!(
        reshaped(&append, false).await,
        (
            json!({"default":"list","kind":"rows","mediaTypes":{"list":null,"table":null,"wide":null},"views":["list","table","wide"]}),
            SEQUENCE.to_owned()
        )
    );
    let moved = Application::new("reshaped")
        .command(imported().views(RowViews::new().view("wide", wide()).default_view("wide")));
    assert_eq!(reshaped(&moved, false).await.1, "wide 2\n");
    let persisted = Application::new("reshaped").command(
        imported()
            .views(RowViews::new().view("wide", wide()).default_view("wide"))
            .views(RowViews::new().view("narrow", narrow())),
    );
    assert_eq!(
        reshaped(&persisted, false).await,
        (
            json!({"default":"wide","kind":"rows","mediaTypes":{"list":null,"table":null,"wide":null,"narrow":null},"views":["list","table","wide","narrow"]}),
            "wide 2\n".to_owned()
        )
    );
    let root = Application::new("reshaped")
        .rows(
            RowViews::new()
                .view("list", list())
                .view("table", collected()),
        )
        .views(RowViews::new().view("wide", wide()).default_view("wide"))
        .action(paths_act);
    assert_eq!(reshaped(&root, true).await.1, "wide 2\n");
    let before = Application::new("reshaped").command(
        Command::new("paths")
            .rows(
                RowViews::new()
                    .view("list", list())
                    .view("table", collected()),
            )
            .views(RowViews::new().view("wide", wide()))
            .action(paths_act),
    );
    assert_eq!(reshaped(&before, false).await.1, SEQUENCE);
}

// media-types.test.ts

#[tokio::test]
async fn core_never_checks_a_media_type_against_the_text_its_view_writes() {
    let app = Application::new("media").command(
        Command::new("show")
            .result(
                ResultViews::new().view(
                    "json",
                    View::new(|_: &String, _: &ViewContext| "not json\n".to_owned())
                        .media_type("application/json"),
                ),
            )
            .action(|ctx: Context<NoInputs, ValueResult<String>>| async move {
                ctx.out.results("value".to_owned()).await
            }),
    );
    let ran = support::run(&app, &["show"]).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "not json\n"));
}

// rows.test.ts

/// One `out.render` of `source` through `view` on Command `count`.
fn rendering<F>(
    source: F,
    view: RowView<Entry>,
) -> Application<NoInputs, NoResult, loomcli_core::Group>
where
    F: Fn() -> RowSource<Entry> + Send + Sync + 'static,
{
    let source = Arc::new(source);
    Application::new("rows").command(Command::new("count").action(move |ctx: Context| {
        let source = Arc::clone(&source);
        let view = view.clone();
        async move { ctx.out.render(source(), &view).await }
    }))
}

#[tokio::test]
async fn a_row_view_writes_head_each_row_and_tail_from_either_source() {
    for source in [|| RowSource::from(entries()), streamed] {
        assert_eq!(
            ran(&rendering(source, list()), Setup::new(&["count"])).await,
            Ran {
                status: 0,
                stdout: SEQUENCE.to_owned(),
                stderr: String::new(),
            }
        );
    }
    let empty = rendering(|| RowSource::from(Vec::new()), list());
    assert_eq!(
        ran(&empty, Setup::new(&["count"])).await.stdout,
        "PATHS\nEND\n"
    );
}

#[tokio::test]
async fn core_requests_no_row_until_the_previous_piece_was_written() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let pulls = Arc::clone(&log);
    let app = rendering(
        move || {
            let pulls = Arc::clone(&pulls);
            let mut rows = entries().into_iter();
            RowSource::Iter(Box::new(std::iter::from_fn(move || {
                let next = rows.next();
                let pulled = next.as_ref().map_or("end", |row| row.source);
                pulls
                    .lock()
                    .unwrap()
                    .push(Seen::Wrote(format!("pull:{pulled}")));
                next
            })))
        },
        list(),
    );
    let mut setup = Setup::new(&["count"]);
    setup.stdout = Some(Scripted::slow(Duration::from_millis(5), Arc::clone(&log)));
    assert_eq!(ran(&app, setup).await.status, 0);
    let seen: Vec<String> = log
        .lock()
        .unwrap()
        .iter()
        .map(|seen| match seen {
            Seen::Wrote(text) if text.starts_with("pull:") => text.clone(),
            Seen::Wrote(text) | Seen::Refused(text) => format!("wrote:{text}"),
        })
        .collect();
    assert_eq!(
        seen,
        [
            "wrote:PATHS\n",
            "pull:one.txt",
            "wrote:0: one.txt\n",
            "pull:two words.txt",
            "wrote:1: two words.txt\n",
            "pull:end",
            "wrote:END\n",
        ]
    );
}

#[tokio::test]
async fn a_source_that_fails_reports_the_incomplete_line_first() {
    let app = rendering(|| failing(fatal("The source failed.")), list());
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await,
        Ran {
            status: 1,
            stdout: PARTIAL.to_owned(),
            stderr: format!("{}The source failed.\n", line("Command \"count\"", 1, 1)),
        }
    );
    let root = Application::new("rows").action(|ctx: Context| async move {
        ctx.out
            .render(failing(fatal("The source failed.")), &list())
            .await
    });
    assert_eq!(
        ran(&root, Setup::new(&[])).await.stderr,
        format!("{}The source failed.\n", line("the root Command", 1, 1))
    );
}

fn breaking() -> RowView<Entry> {
    RowView::new(|row: &Entry, index, _: &ViewContext| {
        if index == 1 {
            Err(io::Error::other("Cannot render the row."))
        } else {
            Ok(format!("{index}: {}\n", row.source))
        }
    })
    .head(|_: &ViewContext| "PATHS\n".to_owned())
}

#[tokio::test]
async fn a_row_view_that_fails_mid_sequence_leaves_the_rows_before_it() {
    let app = rendering(|| RowSource::from(entries()), breaking());
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await,
        Ran {
            status: 1,
            stdout: PARTIAL.to_owned(),
            stderr: format!(
                "{}rows: Something went wrong.\n",
                line("Command \"count\"", 2, 1)
            ),
        }
    );
}

#[tokio::test]
async fn a_failed_write_stops_the_sequence_and_counts_the_rows_written() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let app = rendering(|| RowSource::from(entries()), list());
    let mut setup = Setup::new(&["count"]);
    setup.stdout = Some(Scripted::refusing(
        2,
        io::ErrorKind::Other,
        Arc::clone(&log),
    ));
    assert_eq!(
        ran(&app, setup).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!(
                "{}rows: Something went wrong.\n",
                line("Command \"count\"", 2, 1)
            ),
        }
    );
    let wrote: Vec<Seen> = log.lock().unwrap().iter().take(2).cloned().collect();
    assert_eq!(
        wrote,
        [
            Seen::Wrote("PATHS\n".to_owned()),
            Seen::Wrote("0: one.txt\n".to_owned())
        ]
    );
}

#[tokio::test]
async fn a_cancelled_run_whose_source_then_ends_writes_the_line_alone() {
    let token = CancellationToken::new();
    let cancel = token.clone();
    let app = rendering(
        move || {
            steps(vec![
                Step::Row(entries()[0].clone()),
                Step::Cancel(cancel.clone()),
            ])
        },
        list(),
    );
    let mut setup = Setup::new(&["count"]);
    setup.token = Some(token);
    assert_eq!(
        ran(&app, setup).await,
        Ran {
            status: 130,
            stdout: PARTIAL.to_owned(),
            stderr: line("Command \"count\"", 1, 1),
        }
    );
}

#[tokio::test]
async fn an_override_of_incomplete_result_silences_or_breaks_the_line() {
    for replacement in [
        View::new(|_: &loomcli_core::IncompleteResult, _: &ViewContext| String::new()),
        View::new(
            |_: &loomcli_core::IncompleteResult, _: &ViewContext| -> Result<String, io::Error> {
                Err(io::Error::other("Cannot render the line."))
            },
        ),
    ] {
        let app = Application::new("rows")
            .overrides([override_view(incomplete_result(), replacement)])
            .command(Command::new("count").action(|ctx: Context| async move {
                ctx.out
                    .render(failing(fatal("The source failed.")), &list())
                    .await
            }));
        assert_eq!(
            ran(&app, Setup::new(&["count"])).await,
            Ran {
                status: 1,
                stdout: PARTIAL.to_owned(),
                stderr: "The source failed.\n".to_owned(),
            }
        );
    }
}

// incomplete.test.ts

#[tokio::test]
async fn a_source_failure_reports_its_own_code_and_text() {
    let app = counting(listed(), |ctx| async move {
        ctx.out
            .results(failing(Step::Fail(Box::new(|| {
                InputError::new("The source failed.", Vec::new()).into()
            }))))
            .await
    });
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await,
        Ran {
            status: 2,
            stdout: PARTIAL.to_owned(),
            stderr: format!(
                "{}incomplete: The source failed.\n",
                line("Command \"count\"", 1, 1)
            ),
        }
    );
    let root = Application::new("incomplete").rows(listed()).action(
        |ctx: Context<NoInputs, RowsResult<Entry>>| async move {
            ctx.out.results(failing(fatal("The source failed."))).await
        },
    );
    assert_eq!(
        ran(&root, Setup::new(&[])).await.stderr,
        format!("{}The source failed.\n", line("the root Command", 1, 1))
    );
}

#[tokio::test]
async fn a_rows_result_takes_any_iterator_of_rows() {
    // The reference's `Iterable<Row>`: an adapter chain converts as a Vec does.
    let app = counting(listed(), |ctx| async move {
        ctx.out
            .results(
                entries()
                    .into_iter()
                    .chain([Entry { source: "skipped" }])
                    .filter(|entry| entry.source != "skipped"),
            )
            .await
    });
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await,
        Ran {
            status: 0,
            stdout: SEQUENCE.to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn an_iterator_of_result_rows_stops_at_its_first_err_with_the_incomplete_line() {
    // A synchronous source that throws in the reference stops the sequence the same way.
    let app = counting(listed(), |ctx| async move {
        let rows: Vec<Result<Entry, Error>> = vec![
            Ok(entries()[0].clone()),
            Err(FatalError::new("The source failed.").into()),
            Ok(entries()[1].clone()),
        ];
        ctx.out.results(RowSource::try_iter(rows)).await
    });
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await,
        Ran {
            status: 1,
            stdout: PARTIAL.to_owned(),
            stderr: format!("{}The source failed.\n", line("Command \"count\"", 1, 1)),
        }
    );
    let whole = counting(listed(), |ctx| async move {
        let rows: Vec<Result<Entry, Error>> = entries().into_iter().map(Ok).collect();
        ctx.out.results(RowSource::try_iter(rows)).await
    });
    assert_eq!(ran(&whole, Setup::new(&["count"])).await.stdout, SEQUENCE);
}

#[tokio::test]
async fn the_line_prints_for_zero_rows_too() {
    let app = counting(listed(), |ctx| async move {
        ctx.out
            .results(steps(vec![fatal("The source failed.")]))
            .await
    });
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await,
        Ran {
            status: 1,
            stdout: "PATHS\n".to_owned(),
            stderr: format!("{}The source failed.\n", line("Command \"count\"", 0, 0)),
        }
    );
}

#[tokio::test]
async fn a_view_failure_keeps_its_class_code() {
    let generic = counting(RowViews::new().view("list", breaking()), |ctx| async move {
        ctx.out.results(entries()).await
    });
    assert_eq!(
        ran(&generic, Setup::new(&["count"])).await.stderr,
        format!(
            "{}incomplete: Something went wrong.\n",
            line("Command \"count\"", 2, 1)
        )
    );
    let refusing = RowView::new(|row: &Entry, index, _: &ViewContext| {
        if index == 1 {
            Err(InputError::new("The view refused.", Vec::new()))
        } else {
            Ok(format!("{index}: {}\n", row.source))
        }
    })
    .head(|_: &ViewContext| "PATHS\n".to_owned());
    let classed = counting(RowViews::new().view("list", refusing), |ctx| async move {
        ctx.out.results(entries()).await
    });
    assert_eq!(
        ran(&classed, Setup::new(&["count"])).await,
        Ran {
            status: 2,
            stdout: PARTIAL.to_owned(),
            stderr: format!(
                "{}incomplete: The view refused.\n",
                line("Command \"count\"", 2, 1)
            ),
        }
    );
}

#[tokio::test]
async fn a_whole_view_writes_nothing_of_a_sequence_that_stops() {
    let broken = View::new(
        |_: &[Entry], _: &ViewContext| -> Result<String, io::Error> {
            Err(io::Error::other("Cannot render the table."))
        },
    );
    let view_fails = counting(RowViews::new().view("table", broken), |ctx| async move {
        ctx.out.results(entries()).await
    });
    assert_eq!(
        ran(&view_fails, Setup::new(&["count"])).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!(
                "{}incomplete: Something went wrong.\n",
                line("Command \"count\"", 2, 0)
            ),
        }
    );
    let source_fails = counting(tabled(), |ctx| async move {
        ctx.out.results(failing(fatal("The source failed."))).await
    });
    assert_eq!(
        ran(&source_fails, Setup::new(&["count"])).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: format!("{}The source failed.\n", line("Command \"count\"", 1, 0)),
        }
    );
}

#[tokio::test]
async fn a_stderr_that_failed_takes_the_line_through_the_plain_fallback_and_no_further() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let app = counting(listed(), |ctx| async move {
        let _ = ctx.out.print("first").await;
        ctx.out.results(failing(fatal("The source failed."))).await
    });
    let mut setup = Setup::new(&["count"]);
    setup.stderr = Some(Scripted::refusing(
        0,
        io::ErrorKind::Other,
        Arc::clone(&log),
    ));
    let ran = ran(&app, setup).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (1, PARTIAL));
    assert_eq!(
        *log.lock().unwrap(),
        [
            Seen::Refused("first\n".to_owned()),
            Seen::Refused(line("Command \"count\"", 1, 1)),
            Seen::Refused("incomplete: Something went wrong.\n".to_owned()),
        ]
    );
}

/// A run of `count` whose source is `source`, built with the run's caller token.
async fn cancelled(
    views: RowViews<Entry>,
    source: fn(CancellationToken) -> RowSource<Entry>,
    overrides: Vec<loomcli_core::ViewOverride>,
) -> Ran {
    let token = CancellationToken::new();
    let cancel = token.clone();
    let app = Application::new("incomplete").overrides(overrides).command(
        Command::new("count").rows(views).action(
            move |ctx: Context<NoInputs, RowsResult<Entry>>| {
                let cancel = cancel.clone();
                async move { ctx.out.results(source(cancel)).await }
            },
        ),
    );
    let mut setup = Setup::new(&["count"]);
    setup.token = Some(token);
    ran(&app, setup).await
}

fn cancelling(token: CancellationToken) -> RowSource<Entry> {
    steps(vec![Step::Row(entries()[0].clone()), Step::Cancel(token)])
}

#[tokio::test]
async fn a_cancelled_run_keeps_the_signal_code_and_writes_the_line() {
    assert_eq!(
        cancelled(listed(), cancelling, vec![]).await,
        Ran {
            status: 130,
            stdout: PARTIAL.to_owned(),
            stderr: line("Command \"count\"", 1, 1),
        }
    );
    let faulting = |token| {
        steps(vec![
            Step::Row(entries()[0].clone()),
            Step::Cancel(token),
            fatal("The source failed after the signal."),
        ])
    };
    assert_eq!(
        cancelled(listed(), faulting, vec![]).await,
        Ran {
            status: 130,
            stdout: PARTIAL.to_owned(),
            stderr: format!(
                "{}The source failed after the signal.\n",
                line("Command \"count\"", 1, 1)
            ),
        }
    );
    assert_eq!(
        cancelled(tabled(), cancelling, vec![]).await,
        Ran {
            status: 130,
            stdout: String::new(),
            stderr: line("Command \"count\"", 1, 0),
        }
    );
}

#[tokio::test]
async fn a_broken_line_override_is_reported_where_nothing_else_is_primary() {
    let broken = View::new(
        |_: &loomcli_core::IncompleteResult, _: &ViewContext| -> Result<String, io::Error> {
            Err(io::Error::other("Cannot render the line."))
        },
    );
    assert_eq!(
        cancelled(
            listed(),
            cancelling,
            vec![override_view(incomplete_result(), broken)]
        )
        .await,
        Ran {
            status: 130,
            stdout: PARTIAL.to_owned(),
            stderr: "incomplete: Something went wrong.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn a_cancelled_sequence_stops_asking_an_endless_source() {
    let endless = |token| {
        steps(vec![
            Step::Row(entries()[0].clone()),
            Step::Cancel(token),
            Step::Endless(entries()[1].clone()),
        ])
    };
    assert_eq!(
        cancelled(listed(), endless, vec![]).await,
        Ran {
            status: 130,
            stdout: PARTIAL.to_owned(),
            stderr: line("Command \"count\"", 2, 1),
        }
    );
    assert_eq!(
        cancelled(tabled(), endless, vec![]).await,
        Ran {
            status: 130,
            stdout: String::new(),
            stderr: line("Command \"count\"", 2, 0),
        }
    );
}

#[tokio::test]
async fn a_source_failure_the_action_wraps_is_reported_once() {
    let app = counting(listed(), |ctx| async move {
        match ctx.out.results(failing(fatal("The source failed."))).await {
            Ok(()) => Ok(()),
            Err(_) => Err(io::Error::other("The action could not finish.").into()),
        }
    });
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await.stderr,
        format!(
            "{}incomplete: Something went wrong.\n",
            line("Command \"count\"", 1, 1)
        )
    );
}

#[tokio::test]
async fn a_failure_after_the_result_resolved_is_ordinary() {
    let app = counting(listed(), |ctx| async move {
        ctx.out.results(entries()).await?;
        Err(FatalError::new("The action failed.").into())
    });
    assert_eq!(
        ran(&app, Setup::new(&["count"])).await,
        Ran {
            status: 1,
            stdout: SEQUENCE.to_owned(),
            stderr: "The action failed.\n".to_owned(),
        }
    );
}
