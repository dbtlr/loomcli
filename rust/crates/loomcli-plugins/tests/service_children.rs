//! Ports the `children` and `managers` cases of `service.test.ts`: `start`, `stop`, `restart`, and
//! `uninstall` on each backend, the manager failures, and the environment the calls run in.

#![cfg(feature = "service")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod service_support;

use std::fs;

use service_support::{
    Answer, Record, Scenario, UID, agent, domain, lines, loaded, not_loaded, one, ran, run,
    sandbox, turns,
};

#[tokio::test]
async fn start_stop_and_restart_call_the_pinned_systemd_commands() {
    let box_ = sandbox();
    let installed = run(&box_, &["service", "install"], &Scenario::default()).await;
    assert_eq!(installed.status, 0);
    for (child, line) in [
        ("start", "Started"),
        ("stop", "Stopped"),
        ("restart", "Restarted"),
    ] {
        box_.clear_calls();
        let result = run(&box_, &["service", child], &Scenario::default()).await;
        assert_eq!(result.status, 0, "{}", result.stderr);
        assert_eq!(result.stdout, "");
        assert_eq!(lines(&result.stderr), [format!("{line} com.acme.notes.")]);
        assert_eq!(
            box_.calls(),
            [format!("systemctl --user {child} com.acme.notes.service")]
        );
    }
}

#[tokio::test]
async fn start_stop_and_restart_call_the_pinned_launchd_commands_and_stop_leaves_the_plist() {
    let box_ = sandbox();
    let target = agent("com.acme.notes");
    let plist = box_.launchd_path("com.acme.notes");
    let installed = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(not_loaded()),
    )
    .await;
    assert_eq!(installed.status, 0);
    let print = format!("launchctl print {target}");
    let bootstrap = format!("launchctl bootstrap {} {}", domain(), plist.display());
    let cases = [
        (
            "start",
            loaded(),
            vec![print.clone(), format!("launchctl kickstart {target}")],
        ),
        (
            "start",
            not_loaded(),
            vec![print.clone(), bootstrap.clone()],
        ),
        (
            "stop",
            turns(print.clone(), vec![Answer::exit(0), Answer::exit(113)]),
            vec![
                format!("launchctl bootout {target}"),
                print.clone(),
                print.clone(),
            ],
        ),
        (
            "restart",
            loaded(),
            vec![print.clone(), format!("launchctl kickstart -k {target}")],
        ),
        ("restart", not_loaded(), vec![print.clone(), bootstrap]),
    ];
    for (child, answers, expected) in cases {
        box_.clear_calls();
        let result = run(
            &box_,
            &["service", child],
            &Scenario::darwin().answers(answers),
        )
        .await;
        assert_eq!(result.status, 0, "{child}: {}", result.stderr);
        assert_eq!(result.stdout, "");
        assert_eq!(box_.calls(), expected, "{child}");
    }
    assert_eq!(fs::read_to_string(&plist).unwrap(), box_.pinned_plist());
}

#[tokio::test]
async fn start_stop_and_restart_exit_1_with_the_not_installed_sentence_when_no_file_is_at_the_path()
{
    for platform in ["linux", "darwin"] {
        let box_ = sandbox();
        for child in ["start", "stop", "restart"] {
            assert_eq!(
                run(
                    &box_,
                    &["service", child],
                    &Scenario::default().platform(platform)
                )
                .await,
                ran(
                    1,
                    "",
                    "com.acme.notes is not installed. Run notes service install first.\n"
                ),
                "{platform} {child}"
            );
        }
        assert!(box_.calls().is_empty());
    }
}

#[tokio::test]
async fn uninstall_on_systemd_stops_disables_removes_reloads_and_clears_the_record() {
    let box_ = sandbox();
    assert_eq!(
        run(&box_, &["service", "install"], &Scenario::default())
            .await
            .status,
        0
    );
    box_.clear_calls();
    let result = run(&box_, &["service", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    let unit = box_.systemd_path("com.acme.notes");
    assert_eq!(
        lines(&result.stderr),
        [format!("Removed {}.", unit.display())]
    );
    assert_eq!(
        box_.calls(),
        [
            "systemctl --user stop com.acme.notes.service",
            "systemctl --user disable com.acme.notes.service",
            "systemctl --user daemon-reload",
        ]
    );
    assert!(!unit.exists());
    assert!(!box_.linux_record().exists());
}

#[tokio::test]
async fn uninstall_on_launchd_unloads_the_agent_and_removes_the_plist() {
    let box_ = sandbox();
    let scenario = Scenario::darwin().answers(not_loaded());
    assert_eq!(
        run(&box_, &["service", "install"], &scenario).await.status,
        0
    );
    box_.clear_calls();
    let result = run(&box_, &["service", "uninstall"], &scenario).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    let target = agent("com.acme.notes");
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Removed {}.",
            box_.launchd_path("com.acme.notes").display()
        )]
    );
    assert_eq!(
        box_.calls(),
        [
            format!("launchctl bootout {target}"),
            format!("launchctl print {target}")
        ]
    );
    assert!(!box_.launchd_path("com.acme.notes").exists());
    assert!(!box_.darwin_record().exists());
}

#[tokio::test]
async fn uninstall_keeps_a_changed_unit_with_the_kept_line() {
    let box_ = sandbox();
    assert_eq!(
        run(&box_, &["service", "install"], &Scenario::default())
            .await
            .status,
        0
    );
    let unit = box_.systemd_path("com.acme.notes");
    fs::write(&unit, "changed by hand\n").unwrap();
    let result = run(&box_, &["service", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Kept {} because it changed since notes service install wrote it. Remove it yourself when it is no longer needed.",
            unit.display()
        )]
    );
    assert_eq!(fs::read_to_string(&unit).unwrap(), "changed by hand\n");
}

#[tokio::test]
async fn uninstall_refuses_an_unrecorded_unit_and_runs_nothing() {
    let box_ = sandbox();
    let unit = box_.systemd_path("com.acme.notes");
    fs::create_dir_all(unit.parent().unwrap()).unwrap();
    fs::write(&unit, "hand written\n").unwrap();
    assert_eq!(
        run(&box_, &["service", "uninstall"], &Scenario::default()).await,
        ran(
            1,
            "",
            &format!(
                "{} was not written by notes service install, so uninstall leaves it alone. Remove it with whatever installed it.\n",
                unit.display()
            )
        )
    );
    assert!(box_.calls().is_empty());
    assert_eq!(fs::read_to_string(&unit).unwrap(), "hand written\n");
}

#[tokio::test]
async fn uninstall_with_nothing_installed_prints_the_nothing_to_remove_line_and_exits_0() {
    let box_ = sandbox();
    let result = run(&box_, &["service", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(result.stdout, "");
    assert_eq!(
        lines(&result.stderr),
        ["com.acme.notes is not installed, so there is nothing to remove."]
    );
    assert!(box_.calls().is_empty());
}

#[tokio::test]
async fn a_recorded_unit_whose_file_is_gone_is_stopped_reads_as_already_gone_and_the_record_clears()
{
    let linux = sandbox();
    assert_eq!(
        run(&linux, &["service", "install"], &Scenario::default())
            .await
            .status,
        0
    );
    let unit = linux.systemd_path("com.acme.notes");
    fs::remove_file(&unit).unwrap();
    linux.clear_calls();
    let result = run(&linux, &["service", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [format!("{} was already gone.", unit.display())]
    );
    assert_eq!(
        linux.calls(),
        [
            "systemctl --user stop com.acme.notes.service",
            "systemctl --user daemon-reload"
        ]
    );
    assert!(!linux.linux_record().exists());

    let darwin = sandbox();
    let scenario = Scenario::darwin().answers(not_loaded());
    assert_eq!(
        run(&darwin, &["service", "install"], &scenario)
            .await
            .status,
        0
    );
    let plist = darwin.launchd_path("com.acme.notes");
    fs::remove_file(&plist).unwrap();
    darwin.clear_calls();
    let result = run(&darwin, &["service", "uninstall"], &scenario).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [format!("{} was already gone.", plist.display())]
    );
    assert_eq!(
        darwin.calls()[0],
        format!("launchctl bootout {}", agent("com.acme.notes"))
    );
    assert!(!darwin.darwin_record().exists());
}

#[tokio::test]
async fn after_the_label_changed_with_no_reinstall_uninstall_stops_the_earlier_unit_removes_its_file_and_clears_the_record()
 {
    let box_ = sandbox();
    assert_eq!(
        run(
            &box_,
            &["service", "install"],
            &Scenario::default().label("com.acme.old")
        )
        .await
        .status,
        0
    );
    box_.clear_calls();
    let result = run(&box_, &["service", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    let old = box_.systemd_path("com.acme.old");
    assert_eq!(
        lines(&result.stderr),
        [format!("Removed {}.", old.display())]
    );
    assert_eq!(
        box_.calls(),
        [
            "systemctl --user stop com.acme.old.service",
            "systemctl --user disable com.acme.old.service",
            "systemctl --user daemon-reload",
        ]
    );
    assert!(!old.exists());
    assert!(!box_.linux_record().exists());
}

#[tokio::test]
async fn a_systemctl_that_exits_1_fails_restart_with_the_pinned_sentence_and_prints_none_of_its_output()
 {
    let box_ = sandbox();
    assert_eq!(
        run(&box_, &["service", "install"], &Scenario::default())
            .await
            .status,
        0
    );
    let scenario = Scenario::default().answers(one(
        "systemctl --user restart com.acme.notes.service",
        Answer {
            exit: 1,
            stdout: Some("secret output\n".to_owned()),
            ..Answer::default()
        },
    ));
    assert_eq!(
        run(&box_, &["service", "restart"], &scenario).await,
        ran(
            1,
            "",
            "systemctl --user restart com.acme.notes.service exited with 1. Run systemctl --user status com.acme.notes.service to see why.\n"
        )
    );
}

#[tokio::test]
async fn a_launchctl_call_that_exits_with_an_unnamed_code_names_the_call_and_points_at_print() {
    let box_ = sandbox();
    let plist = box_.launchd_path("com.acme.notes");
    let answers = service_support::both(
        not_loaded(),
        one(
            format!("launchctl bootstrap {} {}", domain(), plist.display()),
            Answer::exit(5),
        ),
    );
    let result = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(answers),
    )
    .await;
    assert_eq!(result.status, 1);
    let target = agent("com.acme.notes");
    assert_eq!(
        lines(&result.stderr).last().unwrap(),
        &format!(
            "launchctl bootstrap {} {} exited with 5. Run launchctl print {target} to see why.",
            domain(),
            plist.display()
        )
    );
}

#[tokio::test]
async fn a_path_with_no_systemctl_fails_with_the_cannot_find_sentence() {
    let box_ = sandbox();
    assert_eq!(
        run(&box_, &["service", "install"], &Scenario::default())
            .await
            .status,
        0
    );
    assert_eq!(
        run(
            &box_,
            &["service", "stop"],
            &Scenario::default().missing("systemctl")
        )
        .await,
        ran(
            1,
            "",
            "notes cannot find systemctl. Install systemd, or run the command where it is available.\n"
        )
    );
}

#[tokio::test]
async fn a_launchd_bootout_that_exits_3_36_or_113_is_no_failure() {
    for code in [3, 36, 113] {
        let box_ = sandbox();
        assert_eq!(
            run(
                &box_,
                &["service", "install"],
                &Scenario::darwin().answers(not_loaded())
            )
            .await
            .status,
            0
        );
        let answers = service_support::both(
            not_loaded(),
            one(
                format!("launchctl bootout {}", agent("com.acme.notes")),
                Answer::exit(code),
            ),
        );
        let result = run(
            &box_,
            &["service", "stop"],
            &Scenario::darwin().answers(answers),
        )
        .await;
        assert_eq!(result.status, 0, "{code}: {}", result.stderr);
        assert_eq!(lines(&result.stderr), ["Stopped com.acme.notes."]);
    }
}

#[tokio::test]
async fn on_linux_an_environment_with_no_xdg_runtime_dir_passes_run_user_uid_to_every_call_and_a_given_one_passes_as_it_is()
 {
    let box_ = sandbox();
    let without = Scenario::default().without_env("XDG_RUNTIME_DIR");
    assert_eq!(
        run(&box_, &["service", "install"], &without).await.status,
        0
    );
    assert_eq!(run(&box_, &["service", "status"], &without).await.status, 0);
    let absent = box_.records();
    assert!(absent.len() > 4);
    assert!(
        absent
            .iter()
            .all(|call| call.runtime.as_deref() == Some(&format!("/run/user/{UID}")))
    );
    box_.clear_calls();
    assert_eq!(
        run(&box_, &["service", "restart"], &Scenario::default())
            .await
            .status,
        0
    );
    assert_eq!(
        box_.records(),
        [Record {
            words: "systemctl --user restart com.acme.notes.service".to_owned(),
            runtime: Some("/run/user/given".to_owned()),
        }]
    );
}
