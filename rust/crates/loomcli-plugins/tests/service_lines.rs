//! Ports the output folder case of `service-lines.test.ts`.

#![cfg(all(feature = "service", feature = "verbose"))]
#![allow(clippy::unwrap_used)]

mod service_support;

use service_support::{OutputFolderWatch, Scenario, run, sandbox};

#[tokio::test]
async fn install_creates_the_output_folder_before_manager_calls_without_logging_the_folder() {
    let box_ = sandbox();
    let folder = OutputFolderWatch::new(box_.home.join("logs/nested"));
    let mut scenario = Scenario::default().output("logs/nested/console.log");
    scenario.output_folder_watch = Some(folder.clone());

    let installed = run(&box_, &["-v", "service", "install"], &scenario).await;

    assert_eq!(installed.status, 0, "{}", installed.stderr);
    assert_eq!(*folder.at_manager_calls.lock().unwrap(), [true, true, true]);
    let path = folder.path.to_str().unwrap();
    assert!(!installed.stderr.contains(path), "{}", installed.stderr);
    assert!(
        folder.log_events.lock().unwrap().iter().all(|event| event
            .fields
            .get("path")
            .and_then(serde_json::Value::as_str)
            != Some(path))
    );
}

use std::path::Path;
use std::sync::{Arc, Mutex};

use loomcli_core::{LogEvent, LogLevel};
use serde_json::{Value, json};
use service_support::{Answer, Ran, Sandbox, UID, both, one};

const LABEL: &str = "com.acme.notes";
const UNIT: &str = "com.acme.notes.service";
const RELOAD: &[&str] = &["--user", "daemon-reload"];
const ENABLE: &[&str] = &["--user", "enable", UNIT];
const RESTART: &[&str] = &["--user", "restart", UNIT];
const STOP: &[&str] = &["--user", "stop", UNIT];
const SHOW: &str = "systemctl --user show com.acme.notes.service --property=ActiveState,MainPID";
const SECRET: &str = "fixture-secret-0123456789";

async fn observed(box_: &Sandbox, argv: &[&str], mut scenario: Scenario) -> (Ran, Vec<LogEvent>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    scenario.log_events = Some(Arc::clone(&events));
    let ran = run(box_, argv, &scenario.with_env("API_TOKEN", SECRET)).await;
    let events = events.lock().unwrap().clone();
    (ran, events)
}

fn changes(events: &[LogEvent]) -> Vec<(&str, Value)> {
    events
        .iter()
        .filter(|event| event.level == LogLevel::Info)
        .map(|event| {
            assert_eq!(event.plugin.as_deref(), Some("@loomcli/plugins/service"));
            (event.message.as_str(), Value::Object(event.fields.clone()))
        })
        .collect()
}

fn file(message: &'static str, path: &Path) -> (&'static str, Value) {
    (message, json!({"path": path}))
}

fn program(program: &str, arguments: &[&str], code: i32) -> (&'static str, Value) {
    (
        "Program run.",
        json!({"arguments": arguments, "code": code, "program": program}),
    )
}

fn called(program: &str, arguments: &[&str], code: i32) -> String {
    format!(
        "› Program run. arguments={} code={code} program={program}\n",
        serde_json::to_string(arguments).unwrap()
    )
}

fn file_line(message: &str, path: &Path) -> String {
    let path = path.to_str().unwrap();
    let path = if path.contains(' ') {
        serde_json::to_string(path).unwrap()
    } else {
        path.to_owned()
    };
    format!("› {message} path={path}\n")
}

fn ran_call(call: &str) -> String {
    format!("› Ran {call}.\n")
}

fn written(box_: &Sandbox, platform: &str) -> String {
    let record = box_.record_path(platform);
    let unit = box_.unit_path(platform);
    file_line("File written.", &record)
        + &file_line("File written.", &unit)
        + &file_line("File written.", &record)
        + &format!("ℹ Wrote {}.\n", unit.display())
}

#[tokio::test]
async fn systemd_install_shows_changes_at_verbose_and_adds_nothing_at_trace() {
    let plain = sandbox();
    let (normal, _) = observed(&plain, &["service", "install"], Scenario::default()).await;
    assert_eq!(normal.status, 0);
    assert_eq!(
        normal.stderr,
        format!(
            "ℹ Wrote {}.\n✔ Started {LABEL}.\n",
            plain.unit_path("linux").display()
        )
    );
    for flag in ["-v", "-vv"] {
        let box_ = sandbox();
        let (installed, _) =
            observed(&box_, &[flag, "service", "install"], Scenario::default()).await;
        assert_eq!(installed.status, 0);
        assert_eq!(
            installed.stderr,
            written(&box_, "linux")
                + &called("systemctl", RELOAD, 0)
                + &called("systemctl", ENABLE, 0)
                + &called("systemctl", RESTART, 0)
                + "✔ Started com.acme.notes.\n"
        );
    }
}

#[tokio::test]
async fn systemd_install_records_the_unit_the_record_and_every_change() {
    let box_ = sandbox();
    let (_, events) = observed(&box_, &["service", "install"], Scenario::default()).await;
    let record = box_.linux_record();
    assert_eq!(
        changes(&events),
        [
            file("File written.", &record),
            file("File written.", &box_.unit_path("linux")),
            file("File written.", &record),
            program("systemctl", RELOAD, 0),
            program("systemctl", ENABLE, 0),
            program("systemctl", RESTART, 0),
        ]
    );
}

#[tokio::test]
async fn systemd_uninstall_records_the_accepted_exit_code_and_removals() {
    let box_ = sandbox();
    observed(&box_, &["service", "install"], Scenario::default()).await;
    let scenario = Scenario::default().answers(one(
        format!("systemctl --user stop {UNIT}"),
        Answer::exit(5),
    ));
    let (run, events) = observed(&box_, &["-v", "service", "uninstall"], scenario).await;
    let unit = box_.unit_path("linux");
    let record = box_.linux_record();
    let disable = &["--user", "disable", UNIT];
    assert_eq!(run.status, 0);
    assert_eq!(
        run.stderr,
        called("systemctl", STOP, 5)
            + &called("systemctl", disable, 0)
            + &file_line("File removed.", &unit)
            + &file_line("File removed.", &record)
            + &called("systemctl", RELOAD, 0)
            + &format!("ℹ Removed {}.\n", unit.display())
    );
    assert_eq!(
        changes(&events),
        [
            program("systemctl", STOP, 5),
            program("systemctl", disable, 0),
            file("File removed.", &unit),
            file("File removed.", &record),
            program("systemctl", RELOAD, 0),
        ]
    );
}

#[tokio::test]
async fn control_records_a_change_and_status_names_both_reads() {
    let box_ = sandbox();
    observed(&box_, &["service", "install"], Scenario::default()).await;
    let (stop, events) = observed(&box_, &["-v", "service", "stop"], Scenario::default()).await;
    assert_eq!(stop.status, 0);
    assert_eq!(
        stop.stderr,
        called("systemctl", STOP, 0) + "✔ Stopped com.acme.notes.\n"
    );
    assert_eq!(changes(&events), [program("systemctl", STOP, 0)]);
    let (status, events) = observed(
        &box_,
        &["-v", "service", "status"],
        Scenario::default().answers(one(SHOW, Answer::exit(1))),
    )
    .await;
    assert_eq!(status.status, 0);
    assert_eq!(
        status.stderr,
        ran_call(SHOW) + &ran_call(&format!("loginctl show-user {UID} --property=Linger"))
    );
    assert_eq!(changes(&events), []);
}

#[tokio::test]
async fn a_manager_call_ended_by_cancellation_produces_no_line_or_event() {
    let box_ = sandbox();
    let reload = "systemctl --user daemon-reload";
    let scenario = Scenario::default().answers(one(reload, Answer::hang().abort()));
    let (install, events) = observed(&box_, &["-v", "service", "install"], scenario).await;
    assert_eq!(install.status, 130);
    assert_eq!(install.stderr, written(&box_, "linux"));
    assert_eq!(box_.calls(), [reload]);
    assert!(
        events
            .iter()
            .all(|event| event.message != "Program run." && event.message != "Ran {call}.")
    );
    box_.clear_calls();
    let scenario = Scenario::default().answers(one(SHOW, Answer::hang().abort()));
    let (status, events) = observed(&box_, &["-v", "service", "status"], scenario).await;
    assert_eq!(status.status, 130);
    assert_eq!(status.stderr, "");
    assert_eq!(box_.calls(), [SHOW]);
    assert_eq!(changes(&events), []);
}

#[tokio::test]
async fn a_refused_exit_is_named_without_a_change_event() {
    let box_ = sandbox();
    observed(&box_, &["service", "install"], Scenario::default()).await;
    let call = format!("systemctl --user restart {UNIT}");
    let scenario = Scenario::default().answers(one(&call, Answer::exit(1)));
    let (failed, events) = observed(&box_, &["-v", "service", "restart"], scenario).await;
    assert_eq!(failed.status, 1);
    assert_eq!(
        failed.stderr,
        ran_call(&call)
            + &format!("{call} exited with 1. Run systemctl --user status {UNIT} to see why.\n")
    );
    assert_eq!(changes(&events), []);
}

#[tokio::test]
async fn a_manager_that_cannot_start_produces_no_line_or_event() {
    let box_ = sandbox();
    observed(&box_, &["service", "install"], Scenario::default()).await;
    let (failed, events) = observed(
        &box_,
        &["-v", "service", "start"],
        Scenario::default().missing("systemctl"),
    )
    .await;
    assert_eq!(failed.status, 1);
    assert_eq!(
        failed.stderr,
        "notes cannot find systemctl. Install systemd, or run the command where it is available.\n"
    );
    assert_eq!(changes(&events), []);
}

#[tokio::test]
async fn launchd_install_records_changes_and_names_the_unload_poll() {
    let box_ = sandbox();
    let target = format!("gui/{UID}/{LABEL}");
    let domain = format!("gui/{UID}");
    let path = box_.unit_path("darwin");
    let record = box_.record_path("darwin");
    let enable = &["enable", &target];
    let bootout = &["bootout", &target];
    let bootstrap = &["bootstrap", &domain, path.to_str().unwrap()];
    let scenario = Scenario::default().platform("darwin").answers(both(
        one(format!("launchctl print {target}"), Answer::exit(113)),
        one(format!("launchctl bootout {target}"), Answer::exit(113)),
    ));
    let (run, events) = observed(&box_, &["-v", "service", "install"], scenario).await;
    assert_eq!(run.status, 0);
    assert_eq!(
        run.stderr,
        written(&box_, "darwin")
            + &called("launchctl", enable, 0)
            + &called("launchctl", bootout, 113)
            + &ran_call(&format!("launchctl print {target}"))
            + &called("launchctl", bootstrap, 0)
            + "✔ Started com.acme.notes.\n"
    );
    assert_eq!(
        changes(&events),
        [
            file("File written.", &record),
            file("File written.", &path),
            file("File written.", &record),
            program("launchctl", enable, 0),
            program("launchctl", bootout, 113),
            program("launchctl", bootstrap, 0),
        ]
    );
}

#[tokio::test]
async fn launchd_restart_names_the_read_and_records_the_kickstart() {
    let box_ = sandbox();
    let target = format!("gui/{UID}/{LABEL}");
    let print = format!("launchctl print {target}");
    let scenario = Scenario::default().platform("darwin");
    observed(
        &box_,
        &["service", "install"],
        scenario.clone().answers(one(&print, Answer::exit(113))),
    )
    .await;
    let kickstart = &["kickstart", "-k", &target];
    let (restarted, events) = observed(&box_, &["-v", "service", "restart"], scenario).await;
    assert_eq!(restarted.status, 0);
    assert_eq!(
        restarted.stderr,
        ran_call(&print) + &called("launchctl", kickstart, 0) + "✔ Restarted com.acme.notes.\n"
    );
    assert_eq!(changes(&events), [program("launchctl", kickstart, 0)]);
}

#[tokio::test]
async fn service_manager_events_contain_no_environment_values() {
    let box_ = sandbox();
    let (_, installed) = observed(&box_, &["service", "install"], Scenario::default()).await;
    let (_, removed) = observed(&box_, &["service", "uninstall"], Scenario::default()).await;
    let records = serde_json::to_string(&[installed, removed]).unwrap();
    assert!(records.contains("Program run."));
    assert!(!records.contains(SECRET));
}
