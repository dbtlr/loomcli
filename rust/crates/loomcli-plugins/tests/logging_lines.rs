//! The logging plugin's own lines and the redacted event each reader gets.

#![cfg(feature = "logging")]
#![allow(clippy::unwrap_used)]

mod logging_support;

use std::sync::{Arc, Mutex};

use logging_support::{Sandbox, lines};
use loomcli_core::{Application, Context, LogFields, LogLevel, Opt, Plugin, RunOptions};
use loomcli_plugins::logging::logging;
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};

#[tokio::test]
async fn log_plugin_lines_reach_the_screen_and_other_hooks_without_recursing() {
    let sandbox = Sandbox::new();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let collector = Plugin::new("fixture/collector").on_log({
        let seen = Arc::clone(&seen);
        move |event, _| seen.lock().unwrap().push(event.clone())
    });
    let app = Application::new("ledger")
        .plugins((
            logging()
                .file(sandbox.file.to_string_lossy())
                .level(LogLevel::Trace)
                .max_bytes(200),
            collector,
        ))
        .global_option("verbose", Opt::count().short('v').verbose())
        .log_redact(&["password"])
        .action(|ctx: Context| async move {
            ctx.log.debug(
                "Signed in {user} with {password}.",
                LogFields::new()
                    .field("password", "hunter2")
                    .field("user", "u"),
            );
            ctx.log.debug("Second.", ());
            Ok(())
        });
    let mock = mock_process(MockFields::new().argv(["-vv"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        format!(
            "› Signed in u with [Redacted].\n› Logging to {}.\n› Second.\n  ┆ Rotated {}.\n",
            sandbox.file.display(),
            sandbox.file.display()
        )
    );
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 4);
    assert_eq!(seen[0].message, "Logging to {path}.");
    assert_eq!(seen[0].plugin.as_deref(), Some("@loomcli/plugins/logging"));
    assert_eq!(seen[1].fields["password"], "[Redacted]");
    assert_eq!(seen[2].message, "Rotated {path}.");
    let rotated = lines(&sandbox.file.with_file_name("heimdall.1.jsonl"));
    assert_eq!(rotated.len(), 1);
    let event: Value = serde_json::from_str(&rotated[0]).unwrap();
    assert_eq!(
        event["fields"],
        json!({"password": "[Redacted]", "user": "u"})
    );
    assert!(!rotated[0].contains("hunter2"));
    assert_eq!(lines(&sandbox.file).len(), 1);
}

#[tokio::test]
async fn the_first_append_announces_once_per_outermost_run_even_when_nested() {
    use loomcli_core::{Command, InvocationOutcome, InvocationValues, InvokeOptions};

    let sandbox = Sandbox::new();
    let app = Application::new("ledger")
        .plugins((logging().file(sandbox.file.to_string_lossy()),))
        .global_option("verbose", Opt::count().short('v').verbose())
        .command(Command::new("inner").action(|ctx: Context| async move {
            ctx.log.info("Nested.", ());
            Ok(())
        }))
        .command(Command::new("outer").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(&["inner"], InvocationValues::new(), InvokeOptions::new())
                .await;
            assert!(matches!(outcome, InvocationOutcome::Completed { messages, .. } if messages.is_empty()));
            ctx.log.info("After.", ());
            Ok(())
        }));
    let expected = format!(
        "› Nested.\n› Logging to {}.\n› After.\n",
        sandbox.file.display()
    );
    for _ in 0..2 {
        let mock = mock_process(MockFields::new().argv(["-v", "outer"]));
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stderr_text(), expected);
    }
    let outcome = app
        .invoke(
            &["outer"],
            InvocationValues::new().option("verbose", 1),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    assert!(
        matches!(outcome, InvocationOutcome::Completed { messages, .. } if messages == expected)
    );
}

#[tokio::test]
async fn no_written_record_means_no_file_announcement() {
    let sandbox = Sandbox::new();
    let taken = sandbox.work.join("taken");
    std::fs::write(&taken, "").unwrap();
    for (path, floor) in [
        (&sandbox.file, LogLevel::Warn),
        (&taken.join("notes.jsonl"), LogLevel::Info),
    ] {
        let app = Application::new("ledger")
            .plugins((logging().file(path.to_string_lossy()).level(floor),))
            .global_option("verbose", Opt::count().short('v').verbose())
            .action(|ctx: Context| async move {
                ctx.log.info("Indexed.", ());
                Ok(())
            });
        let mock = mock_process(MockFields::new().argv(["-vv"]));
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            0
        );
        assert_eq!(mock.stderr_text(), "› Indexed.\n");
    }
}
