//! Ports the `waiting` cases of `service.test.ts` and the read cases of `service-reads.test.ts`: a
//! run cancelled while launchd's unload is polled, during a manager call, and during a status read
//! exits 130, and a status read that runs out ends at the 5-second limit with `SIGKILL` and reads
//! `unknown`. A manager that ignores `SIGTERM` is a child of `service_support::deaf`, which wraps
//! the mock process, because the mock ends a child at once on any ending signal.

#![cfg(feature = "service")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod service_support;

use std::fs;

use service_support::{
    Answer, Answers, Scenario, UID, agent, both, committed_record, domain, lines, loaded,
    not_loaded, one, ran, run, sandbox, turns,
};

#[tokio::test]
async fn a_run_cancelled_while_the_launchd_unload_is_polled_exits_130_and_leaves_the_record() {
    let box_ = sandbox();
    let installed = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(not_loaded()),
    )
    .await;
    assert_eq!(installed.status, 0);
    let before = fs::read_to_string(box_.darwin_record()).unwrap();
    let scenario = Scenario::darwin().answers(turns(
        format!("launchctl print {}", agent("com.acme.notes")),
        vec![Answer::exit(0), Answer::exit(0).abort()],
    ));
    let result = run(&box_, &["service", "stop"], &scenario).await;
    assert_eq!(result.status, 130, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    assert!(!lines(&result.stderr).join("\n").contains("Stopped"));
    assert_eq!(fs::read_to_string(box_.darwin_record()).unwrap(), before);
    assert_eq!(
        fs::read_to_string(box_.launchd_path("com.acme.notes")).unwrap(),
        box_.pinned_plist()
    );
}

#[tokio::test]
async fn a_run_cancelled_during_a_manager_call_ends_the_call_and_exits_130_with_the_record_the_module_left()
 {
    let box_ = sandbox();
    let scenario = Scenario::default().answers(one(
        "systemctl --user restart com.acme.notes.service",
        Answer::hang().abort(),
    ));
    let result = run(&box_, &["service", "install"], &scenario).await;
    assert_eq!(result.status, 130, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    let systemd = box_.config.join("systemd");
    assert_eq!(
        fs::read_to_string(box_.linux_record()).unwrap(),
        committed_record(
            &[&systemd, &systemd.join("user")],
            &box_.systemd_path("com.acme.notes"),
            &box_.pinned_unit()
        )
    );
}

const SHOW: &str = "systemctl --user show com.acme.notes.service --property=ActiveState,MainPID";

fn shown(active: &str, pid: u32) -> Answers {
    both(
        one(
            SHOW,
            Answer::stdout(&format!("ActiveState={active}\nMainPID={pid}\n")),
        ),
        one(
            format!("loginctl show-user {UID} --property=Linger"),
            Answer::stdout("Linger=yes\n"),
        ),
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

#[tokio::test]
async fn a_state_read_that_never_exits_ends_at_5_seconds_reads_unknown_with_the_note_and_exits_0() {
    let box_ = installed_linux().await;
    let started = std::time::Instant::now();
    let result = run(
        &box_,
        &["service", "status"],
        &Scenario::default().answers(both(shown("active", 1), one(SHOW, Answer::hang()))),
    )
    .await;
    assert!(started.elapsed() >= std::time::Duration::from_secs(5));
    assert_eq!(
        result,
        ran(
            0,
            &format!(
                "com.acme.notes: unknown\n  unit  {}\n  note  systemctl --user did not report com.acme.notes.service within 5 seconds, so status ended the call. Run systemctl --user status com.acme.notes.service to see why.\n",
                box_.systemd_path("com.acme.notes").display()
            ),
            ""
        )
    );
}

#[tokio::test]
async fn a_session_read_that_never_exits_adds_no_note() {
    let box_ = installed_linux().await;
    let answers = both(
        shown("active", 7),
        one(
            format!("loginctl show-user {UID} --property=Linger"),
            Answer::hang(),
        ),
    );
    let result = run(
        &box_,
        &["service", "status"],
        &Scenario::default().answers(answers),
    )
    .await;
    assert_eq!(
        result,
        ran(
            0,
            &format!(
                "com.acme.notes: running (pid 7)\n  unit  {}\n",
                box_.systemd_path("com.acme.notes").display()
            ),
            ""
        )
    );
}

#[tokio::test]
async fn a_launchd_state_read_that_never_exits_reads_unknown_with_the_note_and_exits_0() {
    let box_ = installed_darwin().await;
    let target = agent("com.acme.notes");
    let result = run(
        &box_,
        &["service", "status"],
        &Scenario::darwin().answers(one(format!("launchctl print {target}"), Answer::hang())),
    )
    .await;
    assert_eq!(
        result,
        ran(
            0,
            &format!(
                "com.acme.notes: unknown\n  unit  {}\n  note  launchctl did not report {target} within 5 seconds, so status ended the call. Run launchctl print {target} to see why.\n",
                box_.launchd_path("com.acme.notes").display()
            ),
            ""
        )
    );
}

#[tokio::test]
async fn a_launchd_session_read_that_never_exits_adds_no_note() {
    let box_ = installed_darwin().await;
    let answers = both(
        loaded(),
        one(format!("launchctl print {}", domain()), Answer::hang()),
    );
    let result = run(
        &box_,
        &["service", "status"],
        &Scenario::darwin().answers(answers),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        result.stdout,
        format!(
            "com.acme.notes: unknown\n  unit  {}\n",
            box_.launchd_path("com.acme.notes").display()
        )
    );
}

#[tokio::test]
async fn a_run_cancelled_during_the_read_exits_130_with_no_note() {
    let box_ = installed_linux().await;
    let result = run(
        &box_,
        &["service", "status"],
        &Scenario::default().answers(both(shown("active", 1), one(SHOW, Answer::hang().abort()))),
    )
    .await;
    assert_eq!(result.status, 130, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    assert!(!result.stderr.contains("did not report"));
}

#[tokio::test]
async fn a_state_read_that_ignores_sigterm_ends_at_5_seconds_with_sigkill_and_reads_unknown() {
    let box_ = installed_linux().await;
    let result = run(
        &box_,
        &["service", "status"],
        &Scenario::default()
            .answers(shown("active", 1))
            .deaf(SHOW, false),
    )
    .await;
    assert_eq!(
        result,
        ran(
            0,
            &format!(
                "com.acme.notes: unknown\n  unit  {}\n  note  systemctl --user did not report com.acme.notes.service within 5 seconds, so status ended the call. Run systemctl --user status com.acme.notes.service to see why.\n",
                box_.systemd_path("com.acme.notes").display()
            ),
            ""
        )
    );
    assert_eq!(
        *box_.kills.lock().unwrap(),
        [loomcli_core::KillSignal::Kill]
    );
}

#[tokio::test]
async fn a_shutdown_while_a_read_ignores_sigterm_kills_it_with_sigkill_before_the_limit() {
    let box_ = installed_linux().await;
    let started = std::time::Instant::now();
    let result = run(
        &box_,
        &["service", "status"],
        &Scenario::default()
            .answers(shown("active", 1))
            .deaf(SHOW, true),
    )
    .await;
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    assert_eq!(result.status, 143, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    assert!(!result.stderr.contains("did not report"));
    assert!(
        box_.kills
            .lock()
            .unwrap()
            .contains(&loomcli_core::KillSignal::Kill)
    );
}
