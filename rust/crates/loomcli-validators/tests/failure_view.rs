//! Ports the `serve` cases of `codes.test.ts`: an `InputError` view override reads
//! `INTEGER_RANGE_ISSUE` and rewrites that sentence through a run, and every other issue keeps its
//! catalog sentence.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

use std::sync::Arc;

use loomcli_core::{
    Application, Context, Done, Error, InputError, InputProblem, NoInputs, NoResult, Opt, Outcome,
    RunOptions, failure, issue_path, override_view,
};
use loomcli_testing::{MockFields, mock_process};
use loomcli_validators::codes::INTEGER_RANGE_ISSUE;
use loomcli_validators::{integer, one_of};

type App = Application<NoInputs, NoResult, Done>;

fn render(
    failure: &InputError,
    context: &loomcli_core::FailureViewContext,
) -> Result<String, Error> {
    let mut lines: Vec<String> = Vec::new();
    for problem in failure.problems() {
        match problem {
            InputProblem::Missing { spelling, .. } => {
                lines.push(format!("{spelling} is required. Supply a value."));
            }
            InputProblem::Invalid {
                spelling, issues, ..
            } => {
                for issue in issues {
                    let subject = match issue_path(issue) {
                        None => spelling.clone(),
                        Some(at) => format!("{spelling} at {at}"),
                    };
                    lines.push(match INTEGER_RANGE_ISSUE.read(issue) {
                        None => format!("{subject}: {}", issue.message),
                        Some(range) => {
                            format!(
                                "{subject} takes from {} to {} workers.",
                                range.min, range.max
                            )
                        }
                    });
                }
            }
            _ => {}
        }
    }
    let mut written: Vec<String> = lines
        .into_iter()
        .map(|line| format!("serve: {line}"))
        .collect();
    written.extend(context.hints.iter().cloned());
    Ok(written.iter().map(|line| format!("{line}\n")).collect())
}

fn serve() -> App {
    Application::new("serve")
        .overrides([override_view(
            failure::<InputError>(),
            loomcli_core::FailureView::new(render),
        )])
        .option("workers", Opt::string().validate(integer().max(64).min(1)))
        .option("mode", Opt::string().validate(one_of(["dev", "prod"])))
        .action(|ctx: Context| async move {
            let workers: Option<i64> = ctx.option("workers").unwrap();
            let line = format!("served {}", workers.unwrap_or_default());
            let outcome: Outcome = ctx.out.print(&line).await;
            outcome
        })
}

async fn run(argv: &[&str]) -> (u8, String, String) {
    let process = mock_process(MockFields::new().argv(argv.iter().copied()));
    let code = serve()
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[tokio::test]
async fn a_view_reads_integer_range_and_writes_its_own_sentence() {
    assert_eq!(
        run(&["--workers", "99"]).await,
        (
            2,
            String::new(),
            "serve: --workers takes from 1 to 64 workers.\n".to_owned()
        )
    );
}

#[tokio::test]
async fn every_other_issue_keeps_its_catalog_sentence() {
    assert_eq!(
        run(&["--workers", "many", "--mode", "test"]).await,
        (
            2,
            String::new(),
            "serve: --workers takes from 1 to 64 workers.\nserve: --mode: Expected one of: dev, prod.\n"
                .to_owned()
        )
    );
}

#[tokio::test]
async fn accepted_input_runs_the_action() {
    assert_eq!(
        run(&["--workers", "8"]).await,
        (0, "served 8\n".to_owned(), String::new())
    );
}
