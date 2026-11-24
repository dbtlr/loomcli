//! Ports `errors.test.ts`' scenarios run through `run()` in a distributed build: each failure
//! resolves its status with its exact stderr and dispatches nothing after it, and a caught
//! `FatalError` neither fails the run nor prints. The sentences each class carries and the
//! declarations that fault at the call are in `failures.rs` and `declarations.rs`.
//!
//! Not ported: `unknown-throw` (a thrown non-`Error` value has no Rust form; an action fails with an
//! `Error`, and a panic is not converted, a recorded deviation), and the options-object cases (the
//! Rust builder takes no options object).

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, BoxFuture, Build, Context, Error, FatalError, Outcome, ReleaseFacts,
    RunOptions, State,
};
use loomcli_testing::{MockFields, mock_process};

/// What one run wrote and resolved: the status, stdout, and stderr.
async fn ran<I, R, S: State>(app: &Application<I, R, S>, argv: &[&str]) -> (u8, String, String) {
    let mock = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    (code.get(), mock.stdout_text(), mock.stderr_text())
}

/// The fixture's action: it fails with what `fail` returns, or prints `dispatched`.
fn acting(
    fail: Option<fn(&Context) -> Error>,
) -> impl Fn(Context) -> BoxFuture<'static, Outcome> + Send + Sync + 'static {
    move |ctx: Context| {
        Box::pin(async move {
            if let Some(fail) = fail {
                return Err(fail(&ctx));
            }
            ctx.out.print("dispatched").await
        })
    }
}

fn expected(status: u8, stderr: &str) -> (u8, String, String) {
    (status, String::new(), stderr.to_owned())
}

#[tokio::test]
async fn a_required_variadic_argument_fails_with_no_value_and_after_a_bare_double_dash() {
    let app = Application::new("fixture")
        .argument("files", Arg::string().variadic().required())
        .action(acting(None));
    let missing =
        "fixture: Argument \"files\" requires at least one value. Supply a value for \"files\".\n";
    assert_eq!(ran(&app, &[]).await, expected(2, missing));
    assert_eq!(ran(&app, &["--"]).await, expected(2, missing));
    assert_eq!(
        ran(&app, &["-file"]).await,
        expected(
            2,
            "fixture: Unknown option \"-f\". Supply a declared option; prefix a hyphenated path with \"./\".\n"
        )
    );
}

#[tokio::test]
async fn a_root_with_no_action_fails_as_a_defect() {
    let app = Application::new("fixture").argument("files", Arg::string());
    assert_eq!(
        ran(&app, &[]).await,
        expected(1, "fixture: Something went wrong.\n")
    );
}

#[tokio::test]
async fn an_argument_the_root_does_not_declare_fails_as_usage() {
    let app = Application::new("fixture").action(acting(None));
    assert_eq!(
        ran(&app, &["x"]).await,
        expected(
            2,
            "fixture: The root Command accepts no arguments. Remove the supplied values.\n"
        )
    );
}

#[tokio::test]
async fn a_fatal_failure_from_out_fatal_or_returned_prints_its_message_and_exits_1() {
    let fatal = Application::new("fixture").action(acting(Some(|ctx: &Context| {
        ctx.out.fatal("Expected failure.")
    })));
    assert_eq!(ran(&fatal, &[]).await, expected(1, "Expected failure.\n"));
    let returned = Application::new("fixture").action(acting(Some(|_: &Context| {
        FatalError::new("Expected failure.").into()
    })));
    assert_eq!(
        ran(&returned, &[]).await,
        expected(1, "Expected failure.\n")
    );
}

#[tokio::test]
async fn an_unexpected_error_fails_with_the_generic_message() {
    let app = Application::new("fixture").action(acting(Some(|_: &Context| {
        std::io::Error::other("Unexpected failure.").into()
    })));
    assert_eq!(
        ran(&app, &[]).await,
        expected(1, "fixture: Something went wrong.\n")
    );
}

#[tokio::test]
async fn catching_a_fatal_error_prevents_failure_and_printing() {
    let app = Application::new("fixture").action(|ctx: Context| async move {
        let caught: Outcome = Err(ctx.out.fatal("Caught failure."));
        if let Err(error) = caught
            && error.downcast_failure::<FatalError>().is_none()
        {
            return Err(error);
        }
        ctx.out.print("dispatched").await
    });
    assert_eq!(
        ran(&app, &[]).await,
        (0, "dispatched\n".to_owned(), String::new())
    );
}
