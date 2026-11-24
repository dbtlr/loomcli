//! `RunSignal::throw_if_cancelled`: the cancellation echo a library returns once the run is
//! cancelled, which ends the action silently with the cancellation's code.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;

use loomcli_core::{Application, Context, Done, NoInputs, NoResult, RunOptions};
use loomcli_testing::{MockFields, mock_process};

#[tokio::test]
async fn a_cancelled_run_returns_the_echo_and_ends_silently_with_130() {
    let mock = mock_process(MockFields::new());
    let app: Application<NoInputs, NoResult, Done> =
        Application::new("cancel").action(|ctx: Context| async move {
            ctx.signal.throw_if_cancelled()?;
            ctx.cancel();
            ctx.signal.throw_if_cancelled()?;
            ctx.out.print("unreached").await
        });
    let code = app
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 130);
    assert_eq!(mock.stdout_text(), "");
    assert_eq!(mock.stderr_text(), "");
}
