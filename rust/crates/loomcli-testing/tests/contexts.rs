//! Ports `action-context.test.ts`, `middleware-context.test.ts`, `failure-hook-context.test.ts`,
//! `provider-context.test.ts`, `view-context.test.ts`, and the cases of `unstated-members.test.ts`
//! a Rust context has: one author function called with a context the testing crate builds, with no
//! Application and no run.
//!
//! A built Rust context writes through core's own output onto its process handle, so where the
//! reference states an `out` member and reads its calls, these tests state a mock and read its
//! streams.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Application, ChainOutcome, Context, EndState, Error, Failure, FailureFacts, FailureHookContext,
    FatalError, InputIdentity, InputKind, InputProblem, InputValues, Inputs, InvocationOutcome,
    InvocationValues, InvokeOptions, InvokedBy, Issue, LogDestination, LogEvent, LogFields,
    MiddlewareContext, Next, Outcome, Persistent, Plugin, Provider, ProviderContext, RegionOptions,
    RowsResult, RunOptions, SuppliedValue, UnknownCommandError, ValueResult, View, ViewContext,
};
use loomcli_testing::{
    ActionValues, FailureHookValues, MiddlewareValues, MockFields, MockProcess, ProviderValues,
    ViewValues, action_context, failure_hook_context, middleware_context, mock_process,
    provider_context, view_context,
};
use serde::Serialize;

/// `get`'s inputs: a required path argument and a counted option.
#[derive(Inputs)]
struct GetInputs {
    /// The path to read.
    #[argument]
    path: String,
    /// How much to say.
    #[option(count)]
    verbose: u8,
}

/// An extracted handler, as an author writes one to unit-test it.
async fn get_value(ctx: Context<GetInputs>) -> Outcome {
    ctx.out.print(&ctx.inputs.path).await
}

fn mock() -> Arc<MockProcess> {
    mock_process(MockFields::new())
}

fn values(path: &str) -> ActionValues<GetInputs> {
    ActionValues::new(GetInputs {
        path: path.to_owned(),
        verbose: 2,
    })
}

#[tokio::test]
async fn the_handler_reads_the_inputs_the_test_stated_as_it_stated_them() {
    let process = mock();
    let ctx: Context<GetInputs> = action_context(values("name").process(process.clone() as _));
    assert_eq!(ctx.inputs.verbose, 2);
    assert_eq!(
        ctx.argument::<Option<String>>("path").unwrap().as_deref(),
        Some("name")
    );
    assert_eq!(ctx.option::<u8>("verbose").unwrap(), 2);
    get_value(ctx).await.unwrap();
    assert_eq!(process.stdout_text(), "name\n");
    assert_eq!(process.stderr_text(), "");
}

/// A Command that reads its required standalone stdin.
#[derive(Inputs)]
struct ReadInputs {
    #[stdin(description = "The text to echo.")]
    input: loomcli_core::Content,
}

#[tokio::test]
async fn a_required_stdin_is_the_content_the_test_gave() {
    let process = mock();
    let ctx: Context<ReadInputs> = action_context(
        ActionValues::new(ReadInputs {
            input: loomcli_testing::piped_content("{}"),
        })
        .process(process.clone() as _),
    );
    assert_eq!(ctx.inputs.input.name, "stdin");
    let text = ctx.inputs.input.text().await.unwrap();
    ctx.out.print(&text).await.unwrap();
    assert_eq!(process.stdout_text(), "{}\n");
}

/// Global options the test states beside the inputs.
#[derive(Inputs)]
struct Globals {
    /// The profile.
    #[option(default = "default")]
    profile: String,
}

#[tokio::test]
async fn the_globals_and_the_passthrough_read_back_as_stated() {
    let ctx: Context<GetInputs> = action_context(
        values("name")
            .globals(Globals {
                profile: "work".to_owned(),
            })
            .passthrough(&["--", "rest"])
            .interactive(),
    );
    assert_eq!(ctx.globals::<Globals>().unwrap().profile, "work");
    assert_eq!(
        ctx.option::<Option<String>>("profile").unwrap().as_deref(),
        Some("work")
    );
    assert_eq!(ctx.passthrough, ["--", "rest"]);
    assert!(ctx.interactive);
}

#[tokio::test]
async fn a_context_passes_no_input_through_but_the_ones_the_test_stated() {
    let ctx: Context<GetInputs> = action_context(values("name"));
    assert!(ctx.supplied.args.is_empty() && ctx.supplied.options.is_empty());
    assert!(ctx.passthrough.is_empty());
    assert!(!ctx.interactive);
    assert!(ctx.stdin.is_none());
    assert!(ctx.option::<Option<String>>("profile").is_err());
    // The default graph is one root Command named after the default application.
    assert_eq!(ctx.graph.name, "app");
    assert!(ctx.command.path.is_empty());
}

#[tokio::test]
async fn the_host_holds_the_stated_process_facts() {
    let process = mock_process(MockFields::new().cwd("/work").env("HOME", "/home/me"));
    let ctx: Context<GetInputs> = action_context(values("name").process(process as _));
    assert_eq!(ctx.host.cwd, std::path::PathBuf::from("/work"));
    assert_eq!(ctx.host.home, std::path::PathBuf::from("/home/me"));
}

#[tokio::test]
async fn cancel_cancels_the_contexts_own_signal() {
    let ctx: Context<GetInputs> = action_context(values("name"));
    assert!(!ctx.signal.is_cancelled());
    ctx.cancel();
    assert!(ctx.signal.is_cancelled());
}

#[tokio::test]
async fn an_unstated_invoke_resolves_cancelled_with_130() {
    let ctx: Context<GetInputs> = action_context(values("name"));
    let outcome = ctx
        .invoke(
            &["remote", "sync"],
            InvocationValues::new(),
            InvokeOptions::<Error>::new(),
        )
        .await;
    assert!(matches!(
        outcome,
        InvocationOutcome::Cancelled { exit_code } if exit_code.get() == 130
    ));
}

#[tokio::test]
async fn a_handler_may_assign_the_passthrough_and_the_host() {
    let hosts = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = Arc::clone(&hosts);
    Application::new("app")
        .action(move |ctx: Context| {
            seen.lock().unwrap().push(Arc::clone(&ctx.host));
            async { Ok(()) }
        })
        .run(RunOptions::new().process(mock() as _))
        .await;
    let host = hosts.lock().unwrap().remove(0);
    let mut ctx: Context<GetInputs> = action_context(values("name"));
    ctx.passthrough = vec!["--".to_owned(), "rest".to_owned()];
    ctx.host = Arc::clone(&host);
    assert_eq!(ctx.passthrough, ["--", "rest"]);
    assert!(Arc::ptr_eq(&ctx.host, &host));
}

#[tokio::test]
async fn a_stated_provider_value_is_what_the_handler_reads() {
    let pool: Provider<String, Persistent> =
        Provider::persistent("pool", |_ctx: ProviderContext| async {
            Ok("postgres://loom-test".to_owned())
        });
    let ctx: Context<GetInputs> =
        action_context(values("name").provide(&pool, "postgres://stated".to_owned()));
    assert_eq!(*ctx.provided(&pool).unwrap(), "postgres://stated");
    let other: Provider<u8> = Provider::new("other", |_ctx: ProviderContext| async { Ok(1) });
    assert!(ctx.provided(&other).is_err());
}

#[derive(Clone, Serialize)]
struct Row {
    key: String,
}

#[tokio::test]
async fn out_results_writes_a_value_as_one_json_line_and_rows_as_json_lines() {
    let process = mock();
    let ctx: Context<GetInputs, ValueResult<Row>> =
        action_context(values("name").process(process.clone() as _));
    ctx.out
        .results(Row {
            key: "a".to_owned(),
        })
        .await
        .unwrap();
    // A Command with a result writes its print to stderr, as a run's action does.
    ctx.out.print("note").await.unwrap();
    assert_eq!(process.stdout_text(), "{\"key\":\"a\"}\n");
    assert_eq!(process.stderr_text(), "note\n");
    let process = mock();
    let ctx: Context<GetInputs, RowsResult<Row>> =
        action_context(values("name").process(process.clone() as _));
    ctx.out
        .results(vec![
            Row {
                key: "a".to_owned(),
            },
            Row {
                key: "b".to_owned(),
            },
        ])
        .await
        .unwrap();
    assert_eq!(process.stdout_text(), "{\"key\":\"a\"}\n{\"key\":\"b\"}\n");
}

#[tokio::test]
async fn out_fatal_returns_the_fatal_error_with_the_message() {
    let ctx: Context<GetInputs> = action_context(values("name"));
    let error = ctx.out.fatal("Stop.");
    let failure = error.failure().unwrap();
    assert!(failure.is::<FatalError>());
    assert_eq!(failure.message(), "Stop.");
}

#[tokio::test]
async fn out_text_answers_the_text_render_would_write() {
    let ctx: Context<GetInputs> = action_context(values("name"));
    let view: View<str> = View::new(|text: &str, _ctx: &ViewContext| format!("[{text}]\n"));
    assert_eq!(ctx.out.text("page", &view).unwrap(), "[page]\n");
}

#[tokio::test]
async fn a_region_on_a_piped_stderr_is_not_live_and_writes_nothing() {
    let process = mock();
    let ctx: Context<GetInputs> = action_context(values("name").process(process.clone() as _));
    let region = ctx.out.region(RegionOptions::new());
    assert!(!region.live());
    region.end(EndState::Ended, None).await.unwrap();
    assert_eq!(process.transcript(), []);
}

#[tokio::test]
async fn lend_terminal_calls_the_work_and_returns_its_answer() {
    let ctx: Context<GetInputs> = action_context(values("name"));
    assert_eq!(ctx.out.lend_terminal(|| async { 5 }).await, 5);
}

#[tokio::test]
async fn a_handler_registered_on_a_built_context_is_never_called() {
    let ctx: Context<GetInputs> = action_context(values("name"));
    let registration = ctx.on_shutdown(|_event| panic!("a built context's handler ran"));
    registration.remove();
    let _held = ctx.on_suspend(|| panic!("a built context's handler ran"));
    ctx.log.info("Logged.", ());
}

/// The events a log hook observed, each as its JSON with the time and the run id, which vary,
/// written as `T` and `R`.
#[derive(Clone, Default)]
struct Recorded(Arc<std::sync::Mutex<Vec<String>>>);

impl Recorded {
    fn hook(&self) -> impl Fn(&LogEvent, &LogDestination) + Send + Sync + 'static {
        let recorded = self.clone();
        move |event, destination| {
            assert!(destination.stderr.is_none());
            let mut json = serde_json::to_value(event).unwrap();
            assert_eq!(json["run"].as_str().unwrap().len(), 32);
            json["time"] = "T".into();
            json["run"] = "R".into();
            recorded.0.lock().unwrap().push(json.to_string());
        }
    }

    fn events(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
}

#[tokio::test]
async fn an_actions_log_calls_reach_the_hooks_the_test_attached_in_order() {
    let first = Recorded::default();
    let second = Recorded::default();
    let application = Application::new("notes")
        .command(loomcli_core::Command::new("list").action(|_ctx: Context| async { Ok(()) }));
    let graph = application.inspect().unwrap();
    let ctx: Context<GetInputs> = action_context(
        values("name")
            .graph(graph)
            .command(&["list"])
            .on_log(first.hook())
            .on_log(second.hook()),
    );
    ctx.log
        .info("Read the note.", LogFields::new().field("bytes", 12));
    ctx.log.warn("Stale.", ());
    let expected = [
        r#"{"time":"T","level":"info","message":"Read the note.","fields":{"bytes":12},"application":{"name":"notes","version":"0.0.0"},"run":"R","path":["list"],"plugin":null}"#,
        r#"{"time":"T","level":"warn","message":"Stale.","fields":{},"application":{"name":"notes","version":"0.0.0"},"run":"R","path":["list"],"plugin":null}"#,
    ];
    assert_eq!(first.events(), expected);
    assert_eq!(second.events(), expected);
}

#[tokio::test]
async fn a_middlewares_log_names_its_plugin_and_a_hooks_err_reaches_no_caller() {
    let recorded = Recorded::default();
    let hook = recorded.hook();
    let (ctx, _next) = middleware_context(options(false).plugin("@fixture/dry-run").on_log(
        move |event: &LogEvent, destination: &LogDestination| -> Outcome {
            hook(event, destination);
            Err(FatalError::new("The hook failed.").into())
        },
    ));
    ctx.log.debug("Checked the flag.", ());
    assert_eq!(
        recorded.events(),
        [
            r#"{"time":"T","level":"debug","message":"Checked the flag.","fields":{},"application":{"name":"app","version":"0.0.0"},"run":"R","path":[],"plugin":"@fixture/dry-run"}"#
        ]
    );
}

#[tokio::test]
async fn a_failure_hooks_and_an_openers_log_reach_their_hooks() {
    let recorded = Recorded::default();
    let ctx =
        failure_hook_context(FailureHookValues::new("notes", &["list"]).on_log(recorded.hook()));
    ctx.log.error("Reported.", ());
    let ctx = provider_context(ProviderValues::new(NoGlobals {}).on_log(recorded.hook()));
    ctx.log.trace("Opened.", ());
    assert_eq!(
        recorded.events(),
        [
            r#"{"time":"T","level":"error","message":"Reported.","fields":{},"application":{"name":"notes","version":"0.0.0"},"run":"R","path":["list"],"plugin":null}"#,
            r#"{"time":"T","level":"trace","message":"Opened.","fields":{},"application":{"name":"app","version":"0.0.0"},"run":"R","path":[],"plugin":null}"#,
        ]
    );
}

/// No global options.
#[derive(Inputs)]
struct NoGlobals {}

/// A plugin's options: `--dry-run`.
#[derive(Inputs)]
struct DryRunOptions {
    /// Print what would change.
    #[option]
    dry_run: bool,
}

/// Takes over before the action when --dry-run is set, and selects `json` and continues otherwise.
async fn dry_run(ctx: MiddlewareContext<DryRunOptions>, next: Next) -> Outcome {
    if ctx.own_options.option::<bool>("dry-run")? {
        return ctx.out.info("Dry run: nothing was changed.").await;
    }
    ctx.select_view("json");
    next.run().await?;
    Ok(())
}

fn options(dry_run: bool) -> MiddlewareValues<DryRunOptions> {
    MiddlewareValues::new(Some(DryRunOptions { dry_run }))
}

#[tokio::test]
async fn a_middleware_that_takes_over_runs_no_next() {
    let process = mock();
    let (ctx, next) = middleware_context(
        options(true)
            .spelling("dry-run", "--dry-run")
            .outcome(ChainOutcome::Dispatched)
            .process(process.clone() as _),
    );
    assert_eq!(ctx.spellings.get("dry-run"), Some("--dry-run"));
    assert!(ctx.options.as_ref().unwrap().dry_run);
    dry_run(ctx, next).await.unwrap();
    assert_eq!(process.stderr_text(), "ℹ Dry run: nothing was changed.\n");
}

#[tokio::test]
async fn the_context_keeps_the_last_view_the_middleware_selects() {
    let (ctx, next) = middleware_context(
        options(false)
            .view("table")
            .outcome(ChainOutcome::Dispatched),
    );
    assert_eq!(ctx.view().as_deref(), Some("table"));
    ctx.select_view("json");
    assert_eq!(ctx.view().as_deref(), Some("json"));
    assert_eq!(next.run().await.unwrap(), ChainOutcome::Dispatched);
}

#[tokio::test]
async fn an_unstated_outcome_makes_next_fail_with_a_sentence_that_shows_a_stated_one() {
    let (ctx, next) = middleware_context(options(false));
    let error = dry_run(ctx, next).await.unwrap_err();
    assert_eq!(
        error.foreign().unwrap().to_string(),
        "middleware_context has no outcome for this middleware's next to resolve. Add one to its values, such as .outcome(ChainOutcome::Dispatched)."
    );
}

#[tokio::test]
async fn the_request_the_own_options_and_a_held_fault_read_as_stated() {
    let (ctx, _next) = middleware_context(
        MiddlewareValues::<DryRunOptions>::new(None)
            .own_options(InputValues::new().with_option("dry-run", true))
            .request(InputValues::new().with_argument("path", Some("name".to_owned()))),
    );
    assert!(ctx.options.is_none());
    assert!(ctx.own_options.option::<bool>("dry-run").unwrap());
    assert!(ctx.own_options.validated("dry-run"));
    let request = ctx.request.as_ref().unwrap();
    assert_eq!(
        request.values.argument::<Option<String>>("path").unwrap(),
        Some("name".to_owned())
    );
    assert!(ctx.view().is_none());
    // While the options are `None`, every global option reads as absent.
    assert!(ctx.option::<bool>("dry-run").is_err());
}

#[tokio::test]
async fn a_middleware_context_reads_the_stated_graph_at_the_stated_command() {
    let application = Application::new("app")
        .plugins((Plugin::new("@fixture/dry-run").options::<DryRunOptions>(),))
        .command(loomcli_core::Command::new("sync").action(|_ctx: Context| async { Ok(()) }));
    let graph = application.inspect().unwrap();
    let (ctx, _next) = middleware_context(options(false).graph(graph).command(&["sync"]));
    assert_eq!(ctx.command.path, ["sync"]);
    assert_eq!(ctx.graph.globals[0].name(), "dry-run");
}

/// Points an operator at help when a command they typed is unknown.
fn hints(failure: &dyn Failure, ctx: &FailureHookContext) -> Option<String> {
    (failure.is::<UnknownCommandError>() && ctx.invoked_by == InvokedBy::Argv)
        .then(|| format!("Run {} --help to list the commands.", ctx.application))
}

#[test]
fn the_hook_reads_the_facts_the_test_stated_and_is_called_with_its_own_failure() {
    let ctx = failure_hook_context(FailureHookValues::new("notes", &[]));
    let failure = UnknownCommandError::new("lsit", vec!["list".to_owned()]);
    assert_eq!(
        hints(&failure, &ctx).as_deref(),
        Some("Run notes --help to list the commands.")
    );
    assert!(ctx.path.is_empty());
    assert_eq!(ctx.view, None);
}

#[test]
fn an_invocation_by_name_gets_no_hint() {
    let ctx = failure_hook_context(
        FailureHookValues::new("notes", &["list"])
            .invoked_by(InvokedBy::Name)
            .view("json", Some("application/json")),
    );
    let failure = UnknownCommandError::new("lsit", vec!["list".to_owned()]);
    assert_eq!(hints(&failure, &ctx), None);
    assert_eq!(ctx.media_type.as_deref(), Some("application/json"));
    assert_eq!(ctx.path, ["list"]);
}

#[test]
fn received_defaults_to_absence_and_accepts_the_reader_a_test_states() {
    let input = InputIdentity::new(false, InputKind::Option, "format");
    let problem = InputProblem::Invalid {
        input: input.clone(),
        spelling: "--format".to_owned(),
        issues: vec![Issue::new("Expected JSON.")],
    };
    let default = failure_hook_context(FailureHookValues::new("notes", &[]));
    assert_eq!(default.received(&problem), None);

    let stated = failure_hook_context(FailureHookValues::new("notes", &[]).received(
        move |problem| {
            matches!(problem, InputProblem::Invalid { input: found, .. } if *found == input)
                .then(|| SuppliedValue::One("jsno".to_owned()))
        },
    ));
    assert_eq!(
        stated.received(&problem),
        Some(SuppliedValue::One("jsno".to_owned()))
    );
}

#[test]
fn a_failure_hook_context_reads_the_node_at_its_path_or_the_root() {
    let application = Application::new("notes")
        .command(loomcli_core::Command::new("list").action(|_ctx: Context| async { Ok(()) }));
    let graph = application.inspect().unwrap();
    let routed =
        failure_hook_context(FailureHookValues::new("notes", &["list"]).graph(graph.clone()));
    assert_eq!(routed.command.path, ["list"]);
    let partial = failure_hook_context(FailureHookValues::new("notes", &["lsit"]).graph(graph));
    assert!(partial.command.path.is_empty());
    partial.log.warn("Logged.", ());
}

/// The global option a session reads.
#[derive(Inputs)]
struct SessionOptions {
    /// The token.
    #[option]
    token: Option<String>,
}

struct Pool {
    url: String,
}

struct Session {
    url: String,
    token: Option<String>,
}

fn pool() -> Provider<Pool, Persistent> {
    Provider::persistent("pool", |_ctx: ProviderContext| async {
        Ok(Pool {
            url: "postgres://loom-test".to_owned(),
        })
    })
}

/// Starts a session on the pool with the token option.
async fn open(ctx: ProviderContext) -> Result<Session, Error> {
    let pool = ctx.provided(&pool())?;
    let options = ctx.globals::<SessionOptions>()?;
    Ok(Session {
        url: pool.url.clone(),
        token: options.token,
    })
}

#[tokio::test]
async fn the_opener_reads_the_options_and_provided_values_the_test_stated() {
    let ctx = provider_context(
        ProviderValues::new(SessionOptions {
            token: Some("t0k3n".to_owned()),
        })
        .provide(
            &pool(),
            Pool {
                url: "postgres://stated".to_owned(),
            },
        ),
    );
    let session = open(ctx).await.unwrap();
    assert_eq!(session.url, "postgres://stated");
    assert_eq!(session.token.as_deref(), Some("t0k3n"));
}

#[tokio::test]
async fn a_provider_context_writes_to_its_process_and_never_cancels() {
    let process = mock();
    let ctx = provider_context(
        ProviderValues::new(SessionOptions { token: None }).process(process.clone() as _),
    );
    ctx.out.warn("Loud.").await.unwrap();
    // Verbosity 0 hides a debug line, as in a run.
    ctx.out.debug("Quiet.").await.unwrap();
    assert_eq!(process.stderr_text(), "⚠ Loud.\n");
    assert!(!ctx.signal.is_cancelled());
    let registration = ctx.on_shutdown(|_event| panic!("a built context's handler ran"));
    registration.remove();
    assert_eq!(ctx.invoked_by, InvokedBy::Argv);
    assert!(ctx.provided(&pool()).is_err());
}

/// A heading ruled to the destination's width, or 40 columns off a terminal.
fn heading(title: &str, ctx: &ViewContext) -> String {
    let columns = usize::from(ctx.columns.unwrap_or(40));
    format!(
        "{title} {}\n",
        "-".repeat(columns.saturating_sub(ctx.width(title) + 1))
    )
}

#[test]
fn the_view_measures_at_the_stated_width() {
    let ctx = view_context(ViewValues::new().columns(20));
    assert_eq!(
        heading("Notes", &ctx),
        format!("Notes {}\n", "-".repeat(14))
    );
}

#[test]
fn no_stated_width_is_a_destination_that_is_not_a_terminal() {
    let ctx = view_context(ViewValues::new());
    assert_eq!(ctx.columns, None);
    assert_eq!(
        heading("Notes", &ctx),
        format!("Notes {}\n", "-".repeat(34))
    );
}

#[test]
fn a_row_view_is_called_with_the_context_one_function_at_a_time() {
    let ctx = view_context(ViewValues::new().color());
    let head = format!("{}\n", ctx.style.bold().apply("Lines"));
    assert_eq!(ctx.plain(&head), "Lines\n");
    assert_eq!(ctx.width("Lines"), 5);
    assert_eq!(ctx.wrap("one two three", Some(7)), "one two\nthree");
    assert_eq!(ctx.expand_tabs("a\tb"), "a       b");
}

#[test]
fn a_stated_background_is_what_the_view_reads() {
    let ctx = view_context(ViewValues::new().background(loomcli_core::Background::Dark));
    assert_eq!(ctx.background, Some(loomcli_core::Background::Dark));
}

#[test]
fn a_view_renders_its_own_function_with_the_built_context() {
    let ctx = view_context(ViewValues::new().columns(20));
    let view = loomcli_core::View::new(|title: &str, ctx: &ViewContext| heading(title, ctx));
    assert_eq!(
        view.render("Notes", &ctx).unwrap(),
        format!("Notes {}\n", "-".repeat(14))
    );
    let failing = loomcli_core::View::new(|_: &str, _: &ViewContext| {
        Err::<String, _>(std::io::Error::other("no notes"))
    });
    assert_eq!(
        failing
            .render("Notes", &ctx)
            .unwrap_err()
            .foreign()
            .unwrap()
            .to_string(),
        "no notes"
    );
}

#[test]
fn a_declared_view_renders_its_declared_function_and_reads_no_registry() {
    let ctx = view_context(ViewValues::new().columns(20));
    let declared = loomcli_core::view(
        "@fixture/notes/heading",
        loomcli_core::View::new(|title: &str, ctx: &ViewContext| heading(title, ctx)),
    );
    assert_eq!(
        declared.render("Notes", &ctx).unwrap(),
        format!("Notes {}\n", "-".repeat(14))
    );
}

#[test]
fn a_row_view_renders_its_head_each_row_and_its_tail() {
    let ctx = view_context(ViewValues::new().columns(20));
    let rows = loomcli_core::RowView::new(|line: &String, index, _: &ViewContext| {
        format!("{index}:{line}\n")
    })
    .head(|ctx: &ViewContext| format!("{}\n", "=".repeat(usize::from(ctx.columns.unwrap_or(0)))))
    .tail(|count, _: &ViewContext| format!("{count} lines\n"));
    assert_eq!(
        rows.render_head(&ctx).unwrap(),
        format!("{}\n", "=".repeat(20))
    );
    assert_eq!(
        rows.render_row(&"one".to_owned(), 0, &ctx).unwrap(),
        "0:one\n"
    );
    assert_eq!(rows.render_tail(1, &ctx).unwrap(), "1 lines\n");
    let bare = loomcli_core::RowView::new(|line: &String, _, _: &ViewContext| line.clone());
    assert_eq!(bare.render_head(&ctx).unwrap(), "");
    assert_eq!(bare.render_tail(3, &ctx).unwrap(), "");
    let declared = loomcli_core::view("@fixture/notes/lines", rows);
    assert_eq!(
        declared.render_row(&"two".to_owned(), 1, &ctx).unwrap(),
        "1:two\n"
    );
    assert_eq!(
        declared.render_head(&ctx).unwrap(),
        format!("{}\n", "=".repeat(20))
    );
    assert_eq!(declared.render_tail(2, &ctx).unwrap(), "2 lines\n");
}
