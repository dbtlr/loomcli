//! Ports `escaped-input-subjects.test.ts`: an input's subject escapes the name it repeats
//! (`docs/core/failures.md#failure-message-voice`, rule 5). A rejected or missing input's line
//! names the input by its spelling and, for a value an input source filled, by that source, and a
//! control character or a bidirectional control in either prints as its `\uXXXX` escape, so it
//! cannot reorder or break the line.
//!
//! Every case runs an Application end to end on the mock process.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{Application, Context, Done, NoInputs, NoResult, Opt, Outcome};
use support::{fields, run_with};

type App = Application<NoInputs, NoResult, Done>;

async fn nothing(_ctx: Context) -> Outcome {
    Ok(())
}

#[tokio::test]
async fn a_rejected_inputs_line_escapes_its_spelling_and_the_variable_that_filled_it() {
    let app: App = Application::new("app")
        .option("lev\u{202e}el", Opt::count().env(["APP_\u{202e}LEVEL"]))
        .action(nothing);
    let ran = run_with(&app, fields(&[], &[("APP_\u{202e}LEVEL", "loud")])).await;
    assert_eq!(
        (ran.status, ran.stderr.as_str()),
        (
            2,
            "app: Option \"--lev\\u202eel\" (from APP_\\u202eLEVEL): Use a whole number of 0 or more.\n"
        )
    );
}
