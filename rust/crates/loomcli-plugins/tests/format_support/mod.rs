//! Mock process helpers for the formatter's integration tests.

#![allow(dead_code)]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{Application, Build, ReleaseFacts, RunOptions, State};
use loomcli_testing::{MockFields, mock_process};

#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

pub fn ran(status: u8, stdout: &str, stderr: &str) -> Ran {
    Ran {
        status,
        stdout: stdout.to_owned(),
        stderr: stderr.to_owned(),
    }
}

pub async fn run<I, R, S: State>(app: &Application<I, R, S>, argv: &[&str]) -> Ran {
    let process = mock_process(
        MockFields::new()
            .argv(argv.iter().copied())
            .release(ReleaseFacts::new(Build::Distributed)),
    );
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    ran(code.get(), &process.stdout_text(), &process.stderr_text())
}

pub fn failure_line(code: &str, exit: u8, message: &str, hints: &[&str]) -> String {
    let message = serde_json::to_string(message).unwrap();
    let hints = serde_json::to_string(hints).unwrap();
    format!(
        "{{\"error\":{{\"code\":\"{code}\",\"exitCode\":{exit},\"message\":{message},\"hints\":{hints}}}}}\n"
    )
}
