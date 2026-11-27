//! Ports the `status` cases of `service.test.ts`: the text and JSON of each state, an unreadable
//! state, the session notes, and the probe.

#![cfg(feature = "service")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod service_support;

use std::fs;

use loomcli_core::nowrap;
use loomcli_plugins::logging;
use loomcli_testing::{ViewValues, view_context};
use serde_json::{Value, json};
use service_support::{
    Answer, Answers, Probe, Scenario, UID, agent, both, domain, invoke_view, not_loaded, one, ran,
    run, sandbox,
};

// A command run strips the view's markup before writing. Compile the private view and its
// messages here to compare the marked text directly.
#[allow(dead_code)]
#[path = "../src/service/messages.rs"]
mod messages;
#[allow(dead_code)]
#[path = "../src/service/status.rs"]
mod status;

mod backend {
    // The view test needs no manager. The status constructor only needs the reported state fields.
    pub(super) use loomcli_plugins::service::ServiceState as Reading;
}

const SHOW: &str = "systemctl --user show com.acme.notes.service --property=ActiveState,MainPID";

async fn read_status(box_: &service_support::Sandbox, scenario: &Scenario) -> Value {
    #[cfg(feature = "format")]
    let output = {
        let report = run(box_, &["service", "status", "--format", "json"], scenario).await;
        assert_eq!(report.status, 0, "{}", report.stderr);
        report.stdout
    };
    #[cfg(not(feature = "format"))]
    let output = invoke_view(box_, &["service", "status"], "json", scenario)
        .await
        .unwrap();
    serde_json::from_str(&output).unwrap()
}

fn linger_read() -> String {
    format!("loginctl show-user {UID} --property=Linger")
}

/// The answers of one systemd show and a lingering user.
fn shown(active: &str, pid: u32) -> Answers {
    both(
        one(
            SHOW,
            Answer::stdout(&format!("ActiveState={active}\nMainPID={pid}\n")),
        ),
        one(linger_read(), Answer::stdout("Linger=yes\n")),
    )
}

async fn installed_linux() -> service_support::Sandbox {
    let box_ = sandbox();
    let installed = run(&box_, &["service", "install"], &Scenario::default()).await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    box_
}

async fn installed_darwin() -> service_support::Sandbox {
    let box_ = sandbox();
    let installed = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(not_loaded()),
    )
    .await;
    assert_eq!(installed.status, 0, "{}", installed.stderr);
    box_
}

#[test]
fn the_text_view_keeps_each_log_row_whole_for_line_breaking() {
    use status::{ServiceFile, ServiceLogs, ServiceStatus, status_text};

    let status = ServiceStatus {
        label: "l.m".to_owned(),
        unit: "/u".to_owned(),
        installed: true,
        running: false,
        state: "inactive".to_owned(),
        pid: None,
        notes: Vec::new(),
        details: Vec::new(),
        output: None,
        logs: Some(ServiceLogs::Files {
            files: vec![
                ServiceFile {
                    path: "/logs/my notes.jsonl".to_owned(),
                    exists: true,
                },
                ServiceFile {
                    path: "/logs/debug.jsonl".to_owned(),
                    exists: false,
                },
            ],
        }),
    };
    assert_eq!(
        status_text(&status, &view_context(ViewValues::new())),
        format!(
            "l.m: inactive\n  unit  {}\n  log   {}\n  log   {}\n",
            nowrap("/u"),
            nowrap("/logs/my notes.jsonl"),
            nowrap("/logs/debug.jsonl (no records yet)")
        )
    );
}

#[tokio::test]
async fn status_still_reports_state_when_a_file_blocks_the_output_folder() {
    let box_ = installed_linux().await;
    fs::write(box_.home.join("logs"), "").unwrap();
    let scenario = Scenario::default()
        .answers(shown("active", 4120))
        .output("logs/console.log");
    let report = read_status(&box_, &scenario).await;
    assert_eq!(
        report["output"],
        json!({"path": box_.home.join("logs/console.log"), "exists": false})
    );
    assert_eq!(report["state"], "active");
    assert_eq!(report["running"], true);
}

#[cfg(feature = "logging")]
#[tokio::test]
async fn status_names_each_log_file_in_order_even_before_the_first_record() {
    for platform in ["linux", "darwin"] {
        let box_ = if platform == "linux" {
            installed_linux().await
        } else {
            installed_darwin().await
        };
        let first = box_.root.join("first.jsonl");
        let second = box_.root.join("second.jsonl");
        fs::write(&first, "a record\n").unwrap();
        let scenario = status_scenario(platform).log_files([&first, &second]);
        let text = run(&box_, &["service", "status"], &scenario).await;
        assert_eq!(text.status, 0, "{}", text.stderr);
        assert!(
            text.stdout.contains(&format!(
                "  log   {}\n  log   {} (no records yet)\n",
                first.display(),
                second.display()
            )),
            "{}",
            text.stdout
        );
        let report = read_status(&box_, &scenario).await;
        assert_eq!(
            report["logs"],
            json!({
                "kind": "files", "files": [
                    {"path": first, "exists": true},
                    {"path": second, "exists": false},
                ],
            })
        );
        assert!(!second.exists());
    }
}

#[cfg(feature = "logging")]
#[tokio::test]
async fn status_names_the_managers_default_console_capture_without_file_destinations() {
    for (platform, capture, line) in [
        (
            "linux",
            "journald",
            "Service console output goes to journald.",
        ),
        (
            "darwin",
            "none",
            "Service console output goes nowhere: launchd discards it.",
        ),
    ] {
        let box_ = if platform == "linux" {
            installed_linux().await
        } else {
            installed_darwin().await
        };
        let scenario = status_scenario(platform).log_to_console();
        let text = run(&box_, &["service", "status"], &scenario).await;
        assert_eq!(text.status, 0, "{}", text.stderr);
        assert!(
            text.stdout.contains(&format!("  log   {line}\n")),
            "{}",
            text.stdout
        );
        let report = read_status(&box_, &scenario).await;
        assert_eq!(
            report["logs"],
            json!({"kind": "manager", "capture": capture})
        );
    }
}

#[cfg(feature = "logging")]
#[tokio::test]
async fn status_separates_redirected_console_output_from_log_files() {
    for platform in ["linux", "darwin"] {
        let box_ = sandbox();
        let path = box_.home.join("console.log");
        let answers = if platform == "linux" {
            shown("inactive", 0)
        } else {
            not_loaded()
        };
        let scenario = Scenario::default()
            .platform(platform)
            .answers(answers)
            .output("console.log")
            .log_to_console();
        let text = run(&box_, &["service", "status"], &scenario).await;
        assert_eq!(
            text,
            ran(
                0,
                &format!(
                    "com.acme.notes: not installed\n  unit    {}\n  output  {} (file missing)\n",
                    box_.unit_path(platform).display(),
                    path.display(),
                ),
                ""
            )
        );
        let missing = read_status(&box_, &scenario).await;
        assert_eq!(missing["output"], json!({"path": path, "exists": false}));
        assert!(!missing.as_object().unwrap().contains_key("logs"));

        fs::create_dir(&path).unwrap();
        let directory = read_status(&box_, &scenario).await;
        assert_eq!(directory["output"], json!({"path": path, "exists": false}));
        fs::remove_dir(&path).unwrap();
        fs::write(&path, "").unwrap();
        let log_path = box_.home.join("records.log");
        let present = read_status(&box_, &scenario.log_files([&log_path])).await;
        assert_eq!(present["output"], json!({"path": path, "exists": true}));
        assert_eq!(
            present["logs"],
            json!({
                "kind": "files", "files": [{"path": log_path, "exists": false}],
            })
        );
    }
}

#[cfg(feature = "logging")]
#[tokio::test]
async fn status_checks_for_log_files_before_its_debug_records_reach_them() {
    for platform in ["linux", "darwin"] {
        let box_ = if platform == "linux" {
            installed_linux().await
        } else {
            installed_darwin().await
        };
        let path = box_.root.join("logs/debug.jsonl");
        let scenario = status_scenario(platform)
            .log_files([&path])
            .with_env("NOTES_LOG_LEVEL", "debug")
            .probe(Probe::Debug);
        let report = read_status(&box_, &scenario).await;
        assert_eq!(
            report["logs"],
            json!({
                "kind": "files", "files": [{"path": path, "exists": false}],
            })
        );
        assert!(
            fs::read_to_string(&path)
                .unwrap()
                .contains("The status probe ran.")
        );
    }
}

#[cfg(feature = "logging")]
#[tokio::test]
async fn status_resolves_the_first_file_override_and_other_files_from_its_own_host() {
    for platform in ["linux", "darwin"] {
        let box_ = sandbox();
        let override_path = box_.root.join("operator.jsonl");
        let other = box_.home.join("other.jsonl");
        let scenario = status_scenario(platform)
            .log_files(["declared.jsonl", "~/other.jsonl"])
            .with_env("NOTES_LOG_FILE", override_path.to_str().unwrap());
        let text = run(&box_, &["service", "status"], &scenario).await;
        assert_eq!(text.status, 0, "{}", text.stderr);
        assert!(
            text.stdout.contains(&format!(
                "  log   {} (no records yet)\n  log   {} (no records yet)\n",
                override_path.display(),
                other.display(),
            )),
            "{}",
            text.stdout
        );
        let report = read_status(&box_, &scenario).await;
        assert_eq!(
            report["logs"],
            json!({
                "kind": "files", "files": [
                    {"path": override_path, "exists": false},
                    {"path": other, "exists": false},
                ],
            })
        );
        assert!(!override_path.exists());
    }
}

#[cfg(feature = "logging")]
#[tokio::test]
async fn status_escapes_controls_in_text_log_paths_and_keeps_them_in_json() {
    let box_ = sandbox();
    let path = box_.root.join("a\nb.jsonl");
    let scenario = status_scenario("linux").log_files([&path]);
    let text = run(&box_, &["service", "status"], &scenario).await;
    assert_eq!(text.status, 0, "{}", text.stderr);
    assert!(
        text.stdout.contains(&format!(
            "  log   {}/a\\u000ab.jsonl (no records yet)\n",
            box_.root.display(),
        )),
        "{}",
        text.stdout
    );
    let report = read_status(&box_, &scenario).await;
    assert_eq!(
        report["logs"]["files"],
        json!([{"path": path, "exists": false}])
    );
}

#[cfg(feature = "logging")]
fn status_scenario(platform: &str) -> Scenario {
    let answers = if platform == "linux" {
        shown("active", 4120)
    } else {
        service_support::loaded()
    };
    Scenario::default().platform(platform).answers(answers)
}

/// The status JSON of an installed unit, its members in the type's order.
fn status_json(unit: &std::path::Path, pid: Option<u32>, running: bool, state: &str) -> String {
    let pid = pid.map_or(String::new(), |pid| format!("  \"pid\": {pid},\n"));
    format!(
        "{{\n  \"label\": \"com.acme.notes\",\n  \"unit\": {},\n  \"installed\": true,\n  \"running\": {running},\n  \"state\": \"{state}\",\n{pid}  \"notes\": [],\n  \"details\": []\n}}\n",
        serde_json::to_string(&unit.to_string_lossy()).unwrap()
    )
}

#[tokio::test]
async fn it_prints_the_same_bytes_on_a_narrow_terminal_as_on_a_pipe_its_unit_path_whole() {
    let box_ = installed_linux().await;
    let scenario = Scenario::default()
        .answers(shown("active", 4120))
        .narrow_terminal();
    let text = run(&box_, &["service", "status"], &scenario).await;
    assert_eq!(
        text,
        ran(
            0,
            &format!(
                "com.acme.notes: running (pid 4120)\n  unit  {}\n",
                box_.systemd_path("com.acme.notes").display()
            ),
            ""
        )
    );
}

#[tokio::test]
async fn each_active_state_gives_the_pinned_text_and_json() {
    let cases = [
        (
            "active",
            4120,
            "running (pid 4120)",
            Some(4120),
            true,
            "active",
        ),
        ("inactive", 0, "inactive", None, false, "inactive"),
        ("failed", 0, "failed", None, false, "failed"),
        (
            "activating",
            77,
            "activating",
            Some(77),
            false,
            "activating",
        ),
    ];
    for (active, pid, summary, json_pid, running, state) in cases {
        let box_ = installed_linux().await;
        let scenario = Scenario::default().answers(shown(active, pid));
        let text = run(&box_, &["service", "status"], &scenario).await;
        let unit = box_.systemd_path("com.acme.notes");
        assert_eq!(
            text,
            ran(
                0,
                &format!("com.acme.notes: {summary}\n  unit  {}\n", unit.display()),
                ""
            ),
            "{active}"
        );
        let json = invoke_view(&box_, &["service", "status"], "json", &scenario)
            .await
            .unwrap();
        assert_eq!(
            json,
            status_json(&unit, json_pid, running, state),
            "{active}"
        );
    }
}

#[tokio::test]
async fn a_launchd_print_gives_the_pinned_text_and_json() {
    let target = agent("com.acme.notes");
    let cases = [
        (
            Answer::stdout(&format!(
                "{target} = {{\n\tstate = running\n\tpid = 4120\n\tendpoints = {{\n\t\tstate = other\n\t}}\n}}\n"
            )),
            "running (pid 4120)",
            Some(4120),
            true,
            "running",
        ),
        (
            Answer::stdout(&format!(
                "{target} = {{\n\tstate = not running\n\t\tpid = 9\n}}\n"
            )),
            "not running",
            None,
            false,
            "not running",
        ),
        (Answer::exit(113), "not loaded", None, false, "not loaded"),
    ];
    for (answer, summary, pid, running, state) in cases {
        let box_ = installed_darwin().await;
        let answers = both(
            one(format!("launchctl print {target}"), answer),
            one(format!("launchctl print {}", domain()), Answer::exit(0)),
        );
        let scenario = Scenario::darwin().answers(answers);
        let text = run(&box_, &["service", "status"], &scenario).await;
        let unit = box_.launchd_path("com.acme.notes");
        assert_eq!(
            text,
            ran(
                0,
                &format!("com.acme.notes: {summary}\n  unit  {}\n", unit.display()),
                ""
            ),
            "{state}"
        );
        let json = invoke_view(&box_, &["service", "status"], "json", &scenario)
            .await
            .unwrap();
        assert_eq!(json, status_json(&unit, pid, running, state), "{state}");
    }
}

#[tokio::test]
async fn a_unit_with_no_file_and_no_loaded_job_reads_not_installed_and_one_whose_job_runs_reads_its_state_and_pid()
 {
    let box_ = sandbox();
    let scenario = Scenario::default().answers(shown("inactive", 0));
    let json = invoke_view(&box_, &["service", "status"], "json", &scenario)
        .await
        .unwrap();
    let document: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(
        document,
        serde_json::json!({
            "details": [],
            "installed": false,
            "label": "com.acme.notes",
            "notes": [],
            "running": false,
            "state": "not installed",
            "unit": box_.systemd_path("com.acme.notes"),
        })
    );
    let darwin = run(
        &box_,
        &["service", "status"],
        &Scenario::darwin().answers(not_loaded()),
    )
    .await;
    assert_eq!(
        darwin,
        ran(
            0,
            &format!(
                "com.acme.notes: not installed\n  unit  {}\n",
                box_.launchd_path("com.acme.notes").display()
            ),
            ""
        )
    );
    let orphan = run(
        &box_,
        &["service", "status"],
        &Scenario::default().answers(shown("active", 31)),
    )
    .await;
    assert_eq!(
        orphan.stdout,
        format!(
            "com.acme.notes: running (pid 31)\n  unit  {}\n",
            box_.systemd_path("com.acme.notes").display()
        )
    );
    // Status asks no session question of a unit that is not installed.
    assert!(
        !box_
            .calls()
            .iter()
            .any(|words| words.starts_with("loginctl"))
    );
}

#[tokio::test]
async fn a_show_that_exits_1_gives_unknown_with_its_note_and_exits_0() {
    let box_ = installed_linux().await;
    let scenario =
        Scenario::default().answers(both(shown("active", 1), one(SHOW, Answer::exit(1))));
    let result = run(&box_, &["service", "status"], &scenario).await;
    assert_eq!(
        result,
        ran(
            0,
            &format!(
                "com.acme.notes: unknown\n  unit  {}\n  note  systemctl --user could not report com.acme.notes.service (exit 1). Run systemctl --user status com.acme.notes.service to see why.\n",
                box_.systemd_path("com.acme.notes").display()
            ),
            ""
        )
    );
    let target = agent("com.acme.notes");
    let darwin = run(
        &box_,
        &["service", "status"],
        &Scenario::darwin().answers(one(format!("launchctl print {target}"), Answer::exit(5))),
    )
    .await;
    assert_eq!(darwin.status, 0);
    assert!(darwin.stdout.contains(&format!(
        "  note  launchctl could not report {target} (exit 5). Run launchctl print {target} to see why.\n"
    )));
    let missing = run(
        &box_,
        &["service", "status"],
        &Scenario::default().missing("systemctl"),
    )
    .await;
    assert_eq!(missing.status, 0);
    assert!(missing.stdout.contains(
        "  note  notes cannot find systemctl. Install systemd, or run the command where it is available.\n"
    ));
}

#[tokio::test]
async fn a_read_that_exits_143_or_137_on_its_own_is_an_exit_and_not_a_read_that_ran_out() {
    let box_ = installed_linux().await;
    for code in [143, 137] {
        let scenario =
            Scenario::default().answers(both(shown("active", 1), one(SHOW, Answer::exit(code))));
        let result = run(&box_, &["service", "status"], &scenario).await;
        assert_eq!(result.status, 0, "{code}");
        assert!(
            result.stdout.contains(&format!(
                "  note  systemctl --user could not report com.acme.notes.service (exit {code}). Run systemctl --user status com.acme.notes.service to see why.\n"
            )),
            "{code}: {}",
            result.stdout
        );
    }
}

#[tokio::test]
async fn linger_no_and_a_print_of_the_domain_that_exits_113_add_their_notes() {
    let box_ = installed_linux().await;
    let answers = both(
        shown("active", 4120),
        one(linger_read(), Answer::stdout("Linger=no\n")),
    );
    let linger = run(
        &box_,
        &["service", "status"],
        &Scenario::default().answers(answers),
    )
    .await;
    assert_eq!(
        linger.stdout,
        format!(
            "com.acme.notes: running (pid 4120)\n  unit  {}\n  note  Lingering is off, so com.acme.notes stops when you log out. Run loginctl enable-linger to keep it running.\n",
            box_.systemd_path("com.acme.notes").display()
        )
    );
    let darwin = installed_darwin().await;
    let answers = both(
        not_loaded(),
        one(format!("launchctl print {}", domain()), Answer::exit(113)),
    );
    let session = run(
        &darwin,
        &["service", "status"],
        &Scenario::darwin().answers(answers),
    )
    .await;
    assert_eq!(
        session.stdout,
        format!(
            "com.acme.notes: not loaded\n  unit  {}\n  note  There is no login session, so com.acme.notes starts when you log in.\n",
            darwin.launchd_path("com.acme.notes").display()
        )
    );
}

#[tokio::test]
async fn a_probes_rows_print_under_unit_and_the_probe_receives_the_state_and_an_invoke_that_runs_the_applications_own_command()
 {
    let box_ = installed_linux().await;
    let answers = both(
        shown("active", 4120),
        one(linger_read(), Answer::stdout("Linger=no\n")),
    );
    let scenario = Scenario::default().answers(answers).probe(Probe::Rows);
    let result = run(&box_, &["service", "status"], &scenario).await;
    let note = "Lingering is off, so com.acme.notes stops when you log out. Run loginctl enable-linger to keep it running.";
    assert_eq!(
        result,
        ran(
            0,
            &format!(
                "com.acme.notes: running (pid 4120)\n  unit    {}\n  health  ok, v1.5.0\n  note    {note}\n",
                box_.systemd_path("com.acme.notes").display()
            ),
            ""
        )
    );
    let log = box_.probe_log.lock().unwrap().clone().unwrap();
    assert!(!log.aborted);
    assert_eq!(log.platform, "linux");
    assert_eq!(
        log.state,
        serde_json::json!({
            "label": "com.acme.notes",
            "unit": box_.systemd_path("com.acme.notes"),
            "installed": true,
            "running": true,
            "state": "active",
            "pid": 4120,
            "notes": [note],
        })
    );
    let json = invoke_view(&box_, &["service", "status"], "json", &scenario)
        .await
        .unwrap();
    let document: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(
        document["details"],
        serde_json::json!([{ "name": "health", "value": "ok, v1.5.0" }])
    );
}

#[tokio::test]
async fn a_probe_is_not_called_for_a_unit_that_is_not_installed_and_a_probe_that_fails_exits_1() {
    let box_ = sandbox();
    let missing = run(
        &box_,
        &["service", "status"],
        &Scenario::default()
            .answers(shown("inactive", 0))
            .probe(Probe::Throw),
    )
    .await;
    assert_eq!(missing.status, 0);
    assert!(box_.probe_log.lock().unwrap().is_none());
    let installed = run(&box_, &["service", "install"], &Scenario::default()).await;
    assert_eq!(installed.status, 0);
    let thrown = run(
        &box_,
        &["service", "status"],
        &Scenario::default()
            .answers(shown("active", 1))
            .probe(Probe::Throw),
    )
    .await;
    assert_eq!(thrown.status, 1);
    assert_eq!(thrown.stdout, "");
    assert!(box_.probe_log.lock().unwrap().is_some());
}

#[cfg(feature = "format")]
#[tokio::test]
async fn the_installed_formatter_selects_json_and_jsonl_for_status() {
    let box_ = installed_linux().await;
    let scenario = Scenario::default().answers(shown("active", 4120));
    let json = run(&box_, &["service", "status", "--format", "json"], &scenario).await;
    assert_eq!(json.status, 0, "{}", json.stderr);
    assert_eq!(
        json.stdout,
        status_json(
            &box_.systemd_path("com.acme.notes"),
            Some(4120),
            true,
            "active"
        )
    );
    let jsonl = run(
        &box_,
        &["service", "status", "--format", "jsonl"],
        &scenario,
    )
    .await;
    assert_eq!(jsonl.status, 0, "{}", jsonl.stderr);
    assert_eq!(
        jsonl.stdout,
        format!(
            "{{\"label\":\"com.acme.notes\",\"unit\":{},\"installed\":true,\"running\":true,\"state\":\"active\",\"pid\":4120,\"notes\":[],\"details\":[]}}\n",
            serde_json::to_string(&box_.systemd_path("com.acme.notes").to_string_lossy()).unwrap()
        )
    );
}
