//! Redaction and bound fields observed through an installed log hook.

#![allow(clippy::unwrap_used)]

use std::sync::{Arc, Mutex};

use loomcli_core::__private::install_log_hook;
use loomcli_core::{Application, Context, Log, LogEvent, LogFields, RunOptions};
use loomcli_testing::{MockFields, mock_process};
use serde_json::json;

async fn events(paths: &[&str], action: impl Fn(Log) + Send + Sync + 'static) -> Vec<LogEvent> {
    let heard = Arc::new(Mutex::new(Vec::new()));
    let app = install_log_hook(Application::new("ledger").log_redact(paths), {
        let heard = Arc::clone(&heard);
        move |event, _| heard.lock().unwrap().push(event.clone())
    })
    .action(move |ctx: Context| {
        action(ctx.log);
        async { Ok(()) }
    });
    let code = app
        .run(RunOptions::new().process(mock_process(MockFields::new())))
        .await;
    assert_eq!(code.get(), 0);
    heard.lock().unwrap().clone()
}

#[tokio::test]
async fn paths_redact_bound_and_call_fields_before_they_are_merged() {
    let heard = events(&["password", "accounts.secret", "credentials"], |log| {
        let bound = log.with(
            LogFields::new()
                .field("password", "bound secret")
                .field("request", "r1"),
        );
        bound.info("First.", ());
        bound.with(LogFields::new().field("request", "r2")).info(
            "Processed {request}.",
            LogFields::new()
                .field("request", "r3")
                .field("password", "new secret")
                .field(
                    "accounts",
                    json!([{"secret":"x"}, [{"secret":"y"}], "plain"]),
                )
                .field("credentials", json!({"key":"secret"})),
        );
        log.info("Unbound.", ());
    })
    .await;
    assert_eq!(heard[0].fields["password"], "[Redacted]");
    assert_eq!(heard[0].fields["request"], "r1");
    assert_eq!(heard[1].message, "Processed {request}.");
    assert_eq!(heard[1].fields["request"], "r3");
    assert_eq!(heard[1].fields["password"], "[Redacted]");
    assert_eq!(heard[1].fields["credentials"], "[Redacted]");
    assert_eq!(
        heard[1].fields["accounts"],
        json!([{"secret":"[Redacted]"}, [{"secret":"[Redacted]"}], "plain"])
    );
    assert!(heard[2].fields.is_empty());
}

#[test]
fn paths_with_empty_keys_fault_at_the_builder_call() {
    for path in ["", ".password", "password.", "user..token", "."] {
        let fault =
            std::panic::catch_unwind(|| Application::new("ledger").log_redact(&["token", path]));
        let detail = fault.err().unwrap();
        let text = detail.downcast_ref::<String>().unwrap();
        assert!(text.contains("The Application redacts"));
        assert!(text.contains("which is not a dotted path of nonempty keys."));
        assert!(
            text.contains("List dotted paths of nonempty keys, such as password or user.token.")
        );
        assert!(text.contains("@loomcli/core/invalid-redact-path"));
        assert!(text.contains("log_redact"));
    }
}

#[tokio::test]
async fn missing_keys_and_default_redaction_leave_fields_alone() {
    let write = |log: Log| {
        log.info(
            "Loaded.",
            LogFields::new()
                .field("password", "x")
                .field("user", "u")
                .field("token", "t"),
        );
    };
    for paths in [&[][..], &["user.token", "missing", "other.token"]] {
        let heard = events(paths, write).await;
        assert_eq!(heard[0].fields["password"], "x");
        assert_eq!(heard[0].fields["user"], "u");
        assert_eq!(heard[0].fields["token"], "t");
        assert_eq!(heard[0].fields.len(), 3);
    }
    let _ = Application::new("ledger").log_redact(&[
        "password",
        "user.token",
        "a.b.c",
        "with space",
        "user-id",
    ]);
}

#[tokio::test]
async fn a_binding_copies_its_fields_before_the_author_changes_the_value() {
    let heard = events(&[], |log| {
        let mut id = String::from("r1");
        let bound = log.with(LogFields::new().field("request", &id));
        id.push('2');
        bound.info("Before {request}.", ());
        bound
            .with(LogFields::new().field("request", &id))
            .info("After {request}.", ());
    })
    .await;
    assert_eq!(heard[0].fields["request"], "r1");
    assert_eq!(heard[1].fields["request"], "r12");
}

#[tokio::test]
async fn bound_fields_reach_environment_middleware_action_and_failure_hooks() {
    use loomcli_core::{Activation, Plugin};

    let heard = Arc::new(Mutex::new(Vec::new()));
    let plugin = Plugin::new("fixture/reaching")
        .on_environment(|ctx| async move {
            ctx.log
                .with(LogFields::new().field("from", "environment"))
                .info("Bound.", ());
            Ok(Default::default())
        })
        .middleware(Activation::Always, |ctx, next| async move {
            ctx.log
                .with(LogFields::new().field("from", "middleware"))
                .info("Bound.", ());
            next.run().await.map(|_| ())
        })
        .on_failure(|_, ctx| {
            ctx.log
                .with(LogFields::new().field("from", "failure"))
                .info("Bound.", ());
        });
    let app = install_log_hook(
        Application::new("ledger")
            .plugins([plugin])
            .action(|ctx: Context| async move {
                ctx.log
                    .with(LogFields::new().field("from", "action"))
                    .info("Bound.", ());
                Err(ctx.out.fatal("Choose a value."))
            }),
        {
            let heard = Arc::clone(&heard);
            move |event, _| {
                if event.message == "Bound." {
                    heard.lock().unwrap().push(event.fields["from"].clone());
                }
            }
        },
    );
    let mock = mock_process(MockFields::new());
    assert_eq!(app.run(RunOptions::new().process(mock)).await.get(), 1);
    assert_eq!(
        *heard.lock().unwrap(),
        ["environment", "middleware", "action", "failure"]
    );
}
