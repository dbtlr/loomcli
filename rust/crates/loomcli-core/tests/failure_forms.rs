//! Ports the run-level cases of `failure-form.test.ts` and `failure-codes.test.ts` (`failures.md`,
//! "The failure form" and "Failure codes"): the form `invoke()`'s outcome carries, with the hints
//! of two plugins in installation order, a build fault's form, a broken hook forcing 1 on the
//! outcome while the form keeps its own exit code, and the code each failure core raises, an
//! author's class inherits, or an author fault reads, in both builds.
//!
//! The form builder itself (key order, two problems, plain text, a defect by build) is pinned in
//! `src/failures/tests.rs`; the classes' statics are in `failures.rs`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Build, Command, Context, DeclarationError, EX_DATAERR, Failure, FailureForm,
    FatalError, InternalError, InvocationOutcome, InvocationValues, InvokeOptions, LoomError,
    NoInputs, Plugin, ProcessHandle, ReleaseFacts, ResultViews, SuppliedValue, ValueResult, View,
};
use loomcli_testing::{MockFields, mock_process};
use serde::Serialize;

/// jsonkit's `PathNotFoundError`, which declares a failure code and an exit code.
#[derive(Debug, Failure)]
#[failure(code = "path-not-found", exit_code = EX_DATAERR)]
struct PathNotFoundError {
    #[failure(base)]
    base: FatalError,
}

/// A subclass of `PathNotFoundError` that declares nothing itself.
#[derive(Debug, Failure)]
struct NestedPathError {
    #[failure(base)]
    base: PathNotFoundError,
}

/// A `FatalError` subclass that declares nothing.
#[derive(Debug, Failure)]
struct BareError {
    #[failure(base)]
    base: FatalError,
}

/// A direct `LoomError` subclass that declares nothing.
#[derive(Debug, Failure)]
struct DirectError {
    #[failure(base)]
    base: LoomError,
}

/// An author's `InternalError` subclass, whose own code never reaches a form.
#[derive(Debug, Failure)]
#[failure(code = "oops")]
struct OopsError {
    #[failure(base)]
    base: InternalError,
}

fn process(build: Build) -> Option<Arc<dyn ProcessHandle>> {
    Some(mock_process(MockFields::new().release(ReleaseFacts::new(build))) as _)
}

/// The form a failed outcome carries, as JSON, beside the outcome's exit code.
fn failed_form<M>(outcome: InvocationOutcome<M>) -> (u8, String) {
    let InvocationOutcome::Failed {
        form, exit_code, ..
    } = outcome
    else {
        panic!("the invocation fails");
    };
    (exit_code.get(), serde_json::to_string(&form).unwrap())
}

/// The form one invocation by name resolves with, in `build`.
async fn form_of<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    path: &[&str],
    values: InvocationValues,
    build: Build,
) -> FailureForm {
    let outcome = app
        .invoke(path, values, InvokeOptions::new(), process(build))
        .await;
    let InvocationOutcome::Failed { form, .. } = outcome else {
        panic!("the invocation of {path:?} fails");
    };
    form
}

/// What a fixture's action fails with.
type Raise = fn() -> loomcli_core::Error;

/// An Application named `name` whose root action fails with what `raise` returns.
fn raising(name: &str, plugins: Vec<Plugin>, raise: Raise) -> Application {
    Application::new(name)
        .plugins(plugins)
        .action(move |_: Context| async move { Err(raise()) })
}

// failure-form.test.ts

#[tokio::test]
async fn two_plugins_hints_read_in_installation_order_on_the_outcomes_form() {
    let app = raising(
        "forms",
        vec![
            Plugin::new("@fixture/first").on_failure(|_: &dyn Failure, _| "First hint.".to_owned()),
            Plugin::new("@fixture/second")
                .on_failure(|_: &dyn Failure, _| vec!["Second.".to_owned(), "Third.".to_owned()]),
        ],
        || FatalError::new("Failed.").into(),
    );
    let form = form_of(&app, &[], InvocationValues::new(), Build::Distributed).await;
    assert_eq!(form.hints, ["First hint.", "Second.", "Third."]);
}

#[tokio::test]
async fn a_build_fault_runs_no_hook_so_its_form_holds_no_hint() {
    let app = raising(
        "forms",
        vec![
            Plugin::new("@fixture/judging")
                .on_failure(|_: &dyn Failure, _| "Never.".to_owned())
                .on_graph_built(|_| {
                    Err(DeclarationError::sentence_only("The graph is rejected.").into())
                }),
        ],
        || FatalError::new("Never.").into(),
    );
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            process(Build::Distributed),
        )
        .await;
    assert_eq!(
        failed_form(outcome),
        (
            1,
            r#"{"code":"internal","exitCode":1,"message":"Something went wrong.","hints":[]}"#
                .to_owned()
        )
    );
}

#[tokio::test]
async fn a_broken_hook_forces_1_on_the_outcome_while_the_form_keeps_the_failures_own_exit_code() {
    let app = Application::new("forms")
        .plugins([
            Plugin::new("@fixture/breaking").on_failure(|_: &dyn Failure, _| {
                Err::<Vec<String>, _>(std::io::Error::other("Broken."))
            }),
        ])
        .command(Command::new("get").action(|_: Context| async { Ok(()) }));
    let outcome = app
        .invoke(
            &["nope"],
            InvocationValues::new(),
            InvokeOptions::new(),
            process(Build::Distributed),
        )
        .await;
    assert_eq!(
        failed_form(outcome),
        (
            1,
            r#"{"code":"unknown-command","exitCode":2,"message":"Unknown command \"nope\". Use one of: get.","hints":[]}"#
                .to_owned()
        )
    );
}

// failure-codes.test.ts

#[tokio::test]
async fn a_failure_reaches_its_form_with_the_code_its_class_declares_or_inherits() {
    let cases: [(&str, Raise); 3] = [
        ("fatal", || {
            BareError {
                base: FatalError::new("Failed."),
            }
            .into()
        }),
        ("failure", || {
            DirectError {
                base: LoomError::new("Failed."),
            }
            .into()
        }),
        ("path-not-found", || {
            NestedPathError {
                base: PathNotFoundError {
                    base: FatalError::new("Path not found: \"Failed.\"."),
                },
            }
            .into()
        }),
    ];
    for (code, raise) in cases {
        let form = form_of(
            &raising("codes", Vec::new(), raise),
            &[],
            InvocationValues::new(),
            Build::Distributed,
        )
        .await;
        assert_eq!(form.code, code);
    }
}

#[tokio::test]
async fn a_failure_core_raises_reaches_invokes_form_with_its_classs_code() {
    let app = Application::new("codes")
        .command(
            Command::new("group")
                .command(Command::new("leaf").action(|_: Context| async { Ok(()) })),
        )
        .command(
            Command::new("get")
                .argument("path", Arg::string().required())
                .action(|ctx: Context| async move {
                    match ctx.supplied.args.get("path") {
                        Some(SuppliedValue::One(path)) if path == "fatal" => {
                            Err(FatalError::new("Fatal.").into())
                        }
                        Some(SuppliedValue::One(path)) if path == "declaration" => {
                            Err(DeclarationError::sentence_only("A declaration fault.").into())
                        }
                        _ => Ok(()),
                    }
                }),
        );
    let cases: [(&str, &[&str], InvocationValues); 7] = [
        (
            "internal",
            &["get"],
            InvocationValues::new().arg("path", "declaration"),
        ),
        (
            "fatal",
            &["get"],
            InvocationValues::new().arg("path", "fatal"),
        ),
        ("invalid-input", &["get"], InvocationValues::new()),
        ("missing-subcommand", &["group"], InvocationValues::new()),
        (
            "unexpected-argument",
            &["get"],
            InvocationValues::new().arg("path", "a").arg("pth", "b"),
        ),
        ("unknown-command", &["nope"], InvocationValues::new()),
        (
            "unknown-option",
            &["get"],
            InvocationValues::new()
                .arg("path", "a")
                .option("bogus", true),
        ),
    ];
    for (code, path, values) in cases {
        let form = form_of(&app, path, values, Build::Distributed).await;
        assert_eq!(form.code, code, "{path:?}");
    }
}

#[derive(Clone, Serialize)]
struct Plain;

#[tokio::test]
async fn every_author_fault_reads_internal_in_either_build() {
    for build in [Build::Development, Build::Distributed] {
        let judged = Application::new("codes")
            .plugins([Plugin::new("@fixture/judging").on_graph_built(|_| {
                Err(DeclarationError::sentence_only("The graph is rejected.").into())
            })])
            .action(|_: Context| async { Ok(()) });
        let internal = raising("codes", Vec::new(), || {
            OopsError {
                base: InternalError::message_only("Oops.", std::io::Error::other("Oops.")),
            }
            .into()
        });
        let result = Application::new("codes")
            .result(ResultViews::new().view("plain", View::new(|_: &Plain, _| String::new())))
            .action(|_: Context<NoInputs, ValueResult<Plain>>| async { Ok(()) });
        let foreign = raising("codes", Vec::new(), || {
            std::io::Error::other("Cannot read the value.").into()
        });
        let none = InvocationValues::new;
        let codes = [
            form_of(&judged, &[], none(), build).await.code,
            form_of(&internal, &[], none(), build).await.code,
            form_of(&result, &[], none(), build).await.code,
            form_of(&foreign, &[], none(), build).await.code,
        ];
        assert_eq!(codes, ["internal"; 4], "{build:?}");
    }
}
