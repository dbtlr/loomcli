//! Ports `undescribed.test.ts`: a description is never required, so a development run, an
//! invocation by name, and `check()` all accept a graph whose Command, option, and argument carry
//! none. The `undescribed` lint's Rust form is `loomcli_testing::assert_described`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Build, Command, Context, Error, InvocationOutcome, InvocationValues,
    InvokeOptions, Opt, ProcessHandle, ReleaseFacts, RunOptions,
};
use loomcli_testing::{MockFields, mock_process};

#[tokio::test]
async fn a_development_run_and_invoke_run_an_undescribed_graph_and_check_reports_no_fault() {
    let app = Application::new("store").command(
        Command::new("get")
            .argument("path", Arg::string().required())
            .option("raw", Opt::boolean())
            .action(|ctx: Context| async move {
                let path: Option<String> = ctx.argument("path")?;
                ctx.out.print(&path.unwrap_or_default()).await
            }),
    );
    let development = || MockFields::new().release(ReleaseFacts::new(Build::Development));
    let process = mock_process(development().argv(["get", "name"]));
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
        .await;
    let called = mock_process(development());
    let outcome = app
        .invoke(
            &["get"],
            InvocationValues::new().arg("path", "other"),
            InvokeOptions::<Error>::new(),
            Some(Arc::clone(&called) as Arc<dyn ProcessHandle>),
        )
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(process.stdout_text(), "name\n");
    assert_eq!(process.stderr_text(), "");
    assert!(
        matches!(outcome, InvocationOutcome::Completed { ref output, .. } if output == "other\n")
    );
    assert!(app.check().is_empty());
    assert_eq!(called.stderr_text(), "");
}
