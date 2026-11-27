//! The logging plugin's own lines and the redacted event each reader gets.

#![cfg(feature = "logging")]
#![allow(clippy::unwrap_used)]

mod logging_support;

use std::fs;
use std::sync::{Arc, Mutex};

use logging_support::{Sandbox, lines};
use loomcli_core::{Application, Context, LogFields, LogLevel, Opt, Plugin, RunOptions};
use loomcli_plugins::logging::{ConsoleDestination, FileDestination, logging};
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
async fn one_installation_writes_debug_to_a_file_and_identical_warn_bytes_to_stderr() {
    let sandbox = Sandbox::new();
    let file = sandbox.root.join("notes.jsonl");
    let app = Application::new("notes")
        .plugins((logging().destinations((
            FileDestination::new()
                .file(file.to_string_lossy())
                .level(LogLevel::Debug),
            ConsoleDestination::new().level(LogLevel::Warn),
        )),))
        .action(|ctx: Context| async move {
            ctx.log
                .debug("Read {file}.", LogFields::new().field("file", "notes.json"));
            ctx.log
                .warn("Retry {attempt}.", LogFields::new().field("attempt", 2));
            Ok(())
        });
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let records = lines(&file);
    assert_eq!(records.len(), 2);
    for (record, (level, message)) in records
        .iter()
        .zip([("debug", "Read {file}."), ("warn", "Retry {attempt}.")])
    {
        let event: Value = serde_json::from_str(record).unwrap();
        assert_eq!(event["level"], level);
        assert_eq!(event["message"], message);
    }
    let raw = fs::read_to_string(&file).unwrap();
    assert_eq!(
        mock.stderr_text(),
        format!("{}\n", raw.lines().nth(1).unwrap())
    );
    assert_eq!(mock.stdout_text(), "");
}

#[tokio::test]
async fn two_files_filter_independently_and_each_names_its_first_append_and_rotations() {
    let sandbox = Sandbox::new();
    let debug = sandbox.root.join("debug.jsonl");
    let warn = sandbox.root.join("warn.jsonl");
    let old = format!("{}\n", "x".repeat(500));
    for file in [&debug, &warn] {
        fs::write(file, &old).unwrap();
    }
    let app = Application::new("notes")
        .plugins((logging().destinations((
            FileDestination::new()
                .file(debug.to_string_lossy())
                .keep(1)
                .level(LogLevel::Debug)
                .max_bytes(600),
            FileDestination::new()
                .file(warn.to_string_lossy())
                .keep(0)
                .level(LogLevel::Warn)
                .max_bytes(600),
        )),))
        .global_option("verbose", Opt::count().short('v').verbose())
        .action(|ctx: Context| async move {
            ctx.log.debug("Read.", ());
            ctx.log.warn("Retry.", ());
            Ok(())
        });
    let mock = mock_process(MockFields::new().argv(["-vv"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    let debug_path = debug.display();
    let warn_path = warn.display();
    assert_eq!(
        mock.stderr_text(),
        format!(
            "› Read.\n  ┆ Rotated {debug_path}.\n› Logging to {debug_path}.\n› Retry.\n  ┆ Rotated {warn_path}.\n› Logging to {warn_path}.\n"
        )
    );
    let records = lines(&debug);
    assert_eq!(records.len(), 2);
    assert_eq!(lines(&warn), [records[1].clone()]);
    assert_eq!(
        fs::read_to_string(debug.with_file_name("debug.1.jsonl")).unwrap(),
        old
    );
    let mock = mock_process(MockFields::new().argv(["-v"]));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        mock.stderr_text(),
        format!("› Read.\n› Logging to {debug_path}.\n› Retry.\n› Logging to {warn_path}.\n")
    );
}

#[tokio::test]
async fn file_failures_call_their_own_callbacks_in_declaration_order_and_console_still_writes() {
    let sandbox = Sandbox::new();
    let blocked = sandbox.root.join("blocked");
    fs::write(&blocked, "").unwrap();
    let failures = Arc::new(Mutex::new(Vec::new()));
    let file = |name: &'static str| {
        FileDestination::new()
            .file(blocked.join(format!("{name}.jsonl")).to_string_lossy())
            .on_error({
                let failures = Arc::clone(&failures);
                move |error| failures.lock().unwrap().push((name, error.kind.as_str()))
            })
    };
    let app = Application::new("notes")
        .plugins((logging().destinations((
            file("first"),
            file("second"),
            ConsoleDestination::new(),
        )),))
        .action(|ctx: Context| async move {
            ctx.log.warn("Recorded despite file failures.", ());
            Ok(())
        });
    let mock = mock_process(MockFields::new());
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    assert_eq!(
        *failures.lock().unwrap(),
        [("first", "append"), ("second", "append")]
    );
    let event: Value = serde_json::from_str(&mock.stderr_text()).unwrap();
    assert_eq!(event["level"], "warn");
    assert_eq!(event["message"], "Recorded despite file failures.");
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

async fn file_lines(path: &std::path::Path, argv: &[&str]) -> String {
    let app = Application::new("notes")
        .plugins((logging().file(path.to_string_lossy()),))
        .global_option("verbose", Opt::count().short('v').verbose())
        .global_option("quiet", Opt::count().short('q').quiet())
        .action(|ctx: Context| async move {
            ctx.log.info("Indexed.", ());
            ctx.log.info("Synced.", ());
            Ok(())
        });
    let mock = mock_process(MockFields::new().argv(argv.iter().copied()));
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0
    );
    mock.stderr_text()
}

#[tokio::test]
async fn default_and_offset_verbosity_keep_file_announcements_off_stderr() {
    let sandbox = Sandbox::new();
    assert_eq!(file_lines(&sandbox.file, &[]).await, "");
    assert_eq!(lines(&sandbox.file).len(), 2);
    assert_eq!(file_lines(&sandbox.file, &["-v", "-q"]).await, "");
    assert_eq!(lines(&sandbox.file).len(), 4);
}

#[tokio::test]
async fn a_control_character_in_the_log_path_is_escaped() {
    let sandbox = Sandbox::new();
    let path = sandbox.root.join("no\u{7}tes.jsonl");
    assert_eq!(
        file_lines(&path, &["-v"]).await,
        format!(
            "› Indexed.\n› Logging to {}/no\\u0007tes.jsonl.\n› Synced.\n",
            sandbox.root.display()
        ),
    );
    assert_eq!(lines(&path).len(), 2);
}

#[tokio::test]
async fn a_console_only_destination_prints_its_record_and_no_file_lines() {
    let app = Application::new("notes")
        .plugins((logging().destinations([ConsoleDestination::new()]),))
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
    let stderr = mock.stderr_text();
    let record = stderr
        .strip_prefix("› Indexed.\n")
        .unwrap()
        .strip_suffix('\n')
        .unwrap();
    assert!(!record.contains('\n'));
    let record: Value = serde_json::from_str(record).unwrap();
    assert_eq!(record["message"], "Indexed.");
    assert_eq!(record["level"], "info");
}
