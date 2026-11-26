//! Console log records on a real process's piped stderr.

#![cfg(all(unix, feature = "logging"))]
#![allow(clippy::unwrap_used, clippy::panic)]

use std::os::unix::process::ExitStatusExt;
use std::process::{Command, Stdio};

use loomcli_core::{
    Application, Context, LogFields, LogLevel, Opt, ProcessFields, RunOptions, process_handle,
};
use loomcli_plugins::logging::{LogTarget, logging};
use loomcli_prompts::{ProgressSettings, progress};
use rustix::process::{Resource, Rlimit, Signal, getpid, getrlimit, kill_process, setrlimit};
use serde_json::{Value, json};

const CASE: &str = "LOOM_LOGGING_CONSOLE_CASE";
const VERBOSE: &str = "LOOM_LOGGING_CONSOLE_VERBOSE";

#[test]
fn logging_console_child() {
    let Ok(case) = std::env::var(CASE) else {
        return;
    };
    let limit = getrlimit(Resource::Core);
    setrlimit(
        Resource::Core,
        Rlimit {
            current: Some(0),
            maximum: limit.maximum,
        },
    )
    .unwrap();
    std::panic::set_hook(Box::new(|_| {}));
    let app = Application::new("ledger")
        .plugins((logging().target(LogTarget::Stderr).level(LogLevel::Debug),))
        .global_option("verbose", Opt::count().short('v').verbose())
        .shutdown_timeout(20)
        .action(move |ctx: Context| {
            let case = case.clone();
            async move {
                match case.as_str() {
                    "ordered" => {
                        let line = progress(&ctx, ProgressSettings::new("Fetching records"));
                        ctx.log.info(
                            "Fetched {count} records.",
                            LogFields::new().field("count", 3),
                        );
                        ctx.out.warn("The cache is stale.").await?;
                        ctx.log
                            .warn("Retrying {host}.", LogFields::new().field("host", "db"));
                        ctx.log
                            .debug("Skipped {count} rows.", LogFields::new().field("count", 1));
                        line.end_with("Fetched 3 records.").await
                    }
                    "kill" => {
                        ctx.log.info("Before the kill.", ());
                        kill_process(getpid(), Signal::KILL).unwrap();
                        std::future::pending().await
                    }
                    "term" | "quit" => {
                        let log = ctx.log.clone();
                        let _older = ctx.on_shutdown(move |_| log.info("Stopping.", ()));
                        let _newer = ctx.on_shutdown(|_| panic!("Stuck."));
                        let signal = if case == "term" {
                            Signal::TERM
                        } else {
                            Signal::QUIT
                        };
                        kill_process(getpid(), signal).unwrap();
                        std::future::pending().await
                    }
                    _ => panic!("Unknown console logging fixture case."),
                }
            }
        });
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let argv = std::env::var_os(VERBOSE).map(|_| "-v");
    let process = process_handle(ProcessFields::new().argv(argv));
    let status = runtime.block_on(app.run(RunOptions::new().process(process)));
    std::process::exit(i32::from(status.get()));
}

fn child(case: &str, verbose: bool) -> (Option<i32>, Option<i32>, String) {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "logging_console_child", "--nocapture"])
        .env(CASE, case)
        .env_remove(VERBOSE)
        .stdin(Stdio::null())
        .stdout(Stdio::null());
    if verbose {
        command.env(VERBOSE, "1");
    }
    let result = command.output().unwrap();
    (
        result.status.code(),
        result.status.signal(),
        String::from_utf8(result.stderr).unwrap(),
    )
}

fn event(line: &str, level: &str, message: &str, fields: Value) {
    let value: Value = serde_json::from_str(line).unwrap();
    let ordered = [
        "time",
        "level",
        "message",
        "fields",
        "application",
        "run",
        "path",
        "plugin",
    ];
    assert_eq!(
        value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ordered
    );
    assert_eq!(value["level"], level);
    assert_eq!(value["message"], message);
    assert_eq!(value["fields"], fields);
    assert_eq!(
        value["application"],
        json!({"name":"ledger", "version":"0.0.0"})
    );
    assert_eq!(value["run"].as_str().unwrap().len(), 32);
    assert_eq!(value["path"], json!([]));
    assert!(value["plugin"].is_null());
}

#[test]
fn console_records_follow_the_log_lines_and_warnings_on_the_pipe() {
    let (code, signal, stderr) = child("ordered", true);
    assert_eq!((code, signal), (Some(0), None), "{stderr}");
    let lines: Vec<_> = stderr.lines().collect();
    assert_eq!(lines.len(), 9);
    assert_eq!(
        [lines[0], lines[1], lines[3], lines[4], lines[6], lines[8]],
        [
            "ℹ Fetching records",
            "› Fetched 3 records.",
            "⚠ The cache is stale.",
            "› Retrying db.",
            "› Skipped 1 rows.",
            "✔ Fetched 3 records."
        ]
    );
    event(
        lines[2],
        "info",
        "Fetched {count} records.",
        json!({"count":3}),
    );
    event(lines[5], "warn", "Retrying {host}.", json!({"host":"db"}));
    event(
        lines[7],
        "debug",
        "Skipped {count} rows.",
        json!({"count":1}),
    );
}

#[test]
fn an_idle_record_and_its_log_line_survive_an_immediate_kill() {
    for verbose in [false, true] {
        let (code, signal, stderr) = child("kill", verbose);
        assert_eq!(
            (code, signal),
            (None, Some(Signal::KILL.as_raw())),
            "{stderr}"
        );
        let mut lines = stderr.lines();
        if verbose {
            assert_eq!(lines.next(), Some("› Before the kill."));
        }
        event(lines.next().unwrap(), "info", "Before the kill.", json!({}));
        assert_eq!(lines.next(), None);
    }
}

#[test]
fn shutdown_handlers_write_their_records_before_the_signal_is_reraised() {
    for (case, expected) in [("term", Signal::TERM), ("quit", Signal::QUIT)] {
        let (code, signal, stderr) = child(case, false);
        assert_eq!((code, signal), (None, Some(expected.as_raw())), "{stderr}");
        let mut lines = stderr.lines();
        event(
            lines.next().unwrap(),
            "error",
            "A shutdown handler failed.",
            json!({"error":"Stuck."}),
        );
        event(lines.next().unwrap(), "info", "Stopping.", json!({}));
        assert_eq!(lines.next(), None);
    }
}
