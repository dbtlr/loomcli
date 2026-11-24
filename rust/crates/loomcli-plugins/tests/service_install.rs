//! Ports the `installing` cases of `service.test.ts`: the pinned unit and plist, the record, the
//! manager calls of `install` in order, the unchanged line, the quoting of odd words, and an
//! install after the label changed.

#![cfg(feature = "service")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod service_support;

use std::fs;

use service_support::{
    Answer, Scenario, agent, committed_record, digest_of, domain, lines, loaded, not_loaded, one,
    run, sandbox, turns,
};

#[tokio::test]
async fn a_distributed_install_on_linux_writes_the_pinned_unit_records_it_and_reloads_enables_and_restarts_and_a_second_is_unchanged()
 {
    let box_ = sandbox();
    let result = run(&box_, &["service", "install"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    let unit = box_.systemd_path("com.acme.notes");
    assert_eq!(
        lines(&result.stderr),
        [
            format!("Wrote {}.", unit.display()),
            "Started com.acme.notes.".to_owned()
        ]
    );
    assert_eq!(fs::read_to_string(&unit).unwrap(), box_.pinned_unit());
    let systemd = box_.config.join("systemd");
    assert_eq!(
        fs::read_to_string(box_.linux_record()).unwrap(),
        committed_record(
            &[&systemd, &systemd.join("user")],
            &unit,
            &box_.pinned_unit()
        )
    );
    assert_eq!(
        box_.calls(),
        [
            "systemctl --user daemon-reload",
            "systemctl --user enable com.acme.notes.service",
            "systemctl --user restart com.acme.notes.service",
        ]
    );
    box_.clear_calls();
    let second = run(&box_, &["service", "install"], &Scenario::default()).await;
    assert_eq!(second.status, 0);
    assert_eq!(second.stdout, "");
    assert_eq!(
        lines(&second.stderr),
        [
            format!("{} is unchanged.", unit.display()),
            "Started com.acme.notes.".to_owned()
        ]
    );
    assert_eq!(
        box_.calls(),
        [
            "systemctl --user enable com.acme.notes.service",
            "systemctl --user restart com.acme.notes.service",
        ]
    );
}

#[tokio::test]
async fn a_distributed_install_on_darwin_writes_the_pinned_plist_enables_and_bootstraps_and_a_second_unloads_waits_and_bootstraps_changed_or_not()
 {
    let box_ = sandbox();
    let plist = box_.launchd_path("com.acme.notes");
    let target = agent("com.acme.notes");
    let first = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(not_loaded()),
    )
    .await;
    assert_eq!(first.status, 0, "{}", first.stderr);
    assert_eq!(first.stdout, "");
    assert_eq!(
        lines(&first.stderr),
        [
            format!("Wrote {}.", plist.display()),
            "Started com.acme.notes.".to_owned()
        ]
    );
    assert_eq!(fs::read_to_string(&plist).unwrap(), box_.pinned_plist());
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(box_.darwin_record()).unwrap()).unwrap();
    assert_eq!(
        record["files"],
        serde_json::json!([{ "digest": digest_of(&box_.pinned_plist()), "path": plist }])
    );
    assert_eq!(
        box_.calls(),
        [
            format!("launchctl enable {target}"),
            format!("launchctl bootout {target}"),
            format!("launchctl print {target}"),
            format!("launchctl bootstrap {} {}", domain(), plist.display()),
        ]
    );

    box_.clear_calls();
    let again = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(turns(
            format!("launchctl print {target}"),
            vec![Answer::exit(0), Answer::exit(113)],
        )),
    )
    .await;
    assert_eq!(again.status, 0, "{}", again.stderr);
    assert_eq!(
        lines(&again.stderr),
        [
            format!("{} is unchanged.", plist.display()),
            "Started com.acme.notes.".to_owned()
        ]
    );
    assert_eq!(
        box_.calls(),
        [
            format!("launchctl enable {target}"),
            format!("launchctl bootout {target}"),
            format!("launchctl print {target}"),
            format!("launchctl print {target}"),
            format!("launchctl bootstrap {} {}", domain(), plist.display()),
        ]
    );

    box_.clear_calls();
    let changed = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().run(&["serve"]).answers(turns(
            format!("launchctl print {target}"),
            vec![Answer::exit(0), Answer::exit(0), Answer::exit(113)],
        )),
    )
    .await;
    assert_eq!(changed.status, 0, "{}", changed.stderr);
    assert_eq!(changed.stdout, "");
    assert_eq!(
        box_.calls(),
        [
            format!("launchctl enable {target}"),
            format!("launchctl bootout {target}"),
            format!("launchctl print {target}"),
            format!("launchctl print {target}"),
            format!("launchctl print {target}"),
            format!("launchctl bootstrap {} {}", domain(), plist.display()),
        ]
    );
    assert!(
        fs::read_to_string(&plist).unwrap().contains(
            "<string>/opt/notes/bin/notes</string>\n    <string>serve</string>\n  </array>"
        )
    );
}

#[tokio::test]
async fn an_interpreter_and_a_script_a_run_word_with_a_space_quote_dollar_and_percent_and_a_description_with_ampersand_and_angle_render_with_the_pinned_quoting()
 {
    let scenario = Scenario::default()
        .description(Some("Notes & <more> at 100%"))
        .program(&["/usr/bin/node", "/srv/my notes/main.js"])
        .run(&["serve", "--port", "a b\"c$d%e"]);
    let linux = sandbox();
    let result = run(&linux, &["service", "install"], &scenario).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        fs::read_to_string(linux.systemd_path("com.acme.notes")).unwrap(),
        format!(
            "[Unit]\nDescription=Notes & <more> at 100%%\nStartLimitIntervalSec=0\n\n[Service]\nExecStart=\"/usr/bin/node\" \"/srv/my notes/main.js\" \"serve\" \"--port\" \"a b\\\"c$$d%%e\"\nWorkingDirectory={}\nRestart=always\nRestartSec=10\nSuccessExitStatus=130 143\n\n[Install]\nWantedBy=default.target\n",
            linux.home.display()
        )
    );
    let darwin = sandbox();
    let scenario = Scenario {
        platform: "darwin".to_owned(),
        answers: not_loaded(),
        ..scenario
    };
    let result = run(&darwin, &["service", "install"], &scenario).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(
        fs::read_to_string(darwin.launchd_path("com.acme.notes"))
            .unwrap()
            .contains("  <array>\n    <string>/usr/bin/node</string>\n    <string>/srv/my notes/main.js</string>\n    <string>serve</string>\n    <string>--port</string>\n    <string>a b&quot;c$d%e</string>\n  </array>")
    );
}

#[tokio::test]
async fn an_install_after_the_label_changed_stops_and_disables_the_earlier_unit_and_removes_its_file()
 {
    let box_ = sandbox();
    let first = run(
        &box_,
        &["service", "install"],
        &Scenario::default().label("com.acme.old"),
    )
    .await;
    assert_eq!(first.status, 0, "{}", first.stderr);
    box_.clear_calls();
    let result = run(&box_, &["service", "install"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    let old = box_.systemd_path("com.acme.old");
    assert_eq!(
        lines(&result.stderr),
        [
            format!("Wrote {}.", box_.systemd_path("com.acme.notes").display()),
            format!("Removed {}.", old.display()),
            "Started com.acme.notes.".to_owned(),
        ]
    );
    assert!(!old.exists());
    assert_eq!(
        box_.calls(),
        [
            "systemctl --user stop com.acme.old.service",
            "systemctl --user disable com.acme.old.service",
            "systemctl --user daemon-reload",
            "systemctl --user enable com.acme.notes.service",
            "systemctl --user restart com.acme.notes.service",
        ]
    );
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(box_.linux_record()).unwrap()).unwrap();
    assert_eq!(
        record["files"],
        serde_json::json!([{
            "digest": digest_of(&box_.pinned_unit()),
            "path": box_.systemd_path("com.acme.notes"),
        }])
    );
}

#[tokio::test]
async fn an_install_after_an_earlier_one_failed_between_its_write_and_bootstrap_prints_the_unchanged_line_and_loads_the_plist_on_disk()
 {
    let box_ = sandbox();
    let plist = box_.launchd_path("com.acme.notes");
    let target = agent("com.acme.notes");
    let first = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(not_loaded()),
    )
    .await;
    assert_eq!(first.status, 0);
    box_.clear_calls();
    let failed = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin()
            .run(&["serve"])
            .answers(service_support::both(
                loaded(),
                one(format!("launchctl enable {target}"), Answer::exit(1)),
            )),
    )
    .await;
    assert_eq!(failed.status, 1);
    assert_eq!(
        lines(&failed.stderr)[0],
        format!("Wrote {}.", plist.display())
    );
    assert_eq!(box_.calls(), [format!("launchctl enable {target}")]);
    box_.clear_calls();
    let rerun = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().run(&["serve"]).answers(turns(
            format!("launchctl print {target}"),
            vec![Answer::exit(0), Answer::exit(113)],
        )),
    )
    .await;
    assert_eq!(rerun.status, 0, "{}", rerun.stderr);
    assert_eq!(
        lines(&rerun.stderr),
        [
            format!("{} is unchanged.", plist.display()),
            "Started com.acme.notes.".to_owned()
        ]
    );
    assert_eq!(
        box_.calls(),
        [
            format!("launchctl enable {target}"),
            format!("launchctl bootout {target}"),
            format!("launchctl print {target}"),
            format!("launchctl print {target}"),
            format!("launchctl bootstrap {} {}", domain(), plist.display()),
        ]
    );
    assert!(!box_.calls().iter().any(|words| words.contains("kickstart")));
}

#[tokio::test]
async fn an_install_on_darwin_after_the_label_changed_unloads_the_earlier_agent_and_removes_its_plist()
 {
    let box_ = sandbox();
    let old = agent("com.acme.old");
    let answers = service_support::both(
        not_loaded(),
        one(format!("launchctl print {old}"), Answer::exit(113)),
    );
    let first = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin()
            .label("com.acme.old")
            .answers(answers.clone()),
    )
    .await;
    assert_eq!(first.status, 0, "{}", first.stderr);
    box_.clear_calls();
    let result = run(
        &box_,
        &["service", "install"],
        &Scenario::darwin().answers(answers),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(!box_.launchd_path("com.acme.old").exists());
    assert_eq!(
        box_.calls()[..2],
        [
            format!("launchctl bootout {old}"),
            format!("launchctl print {old}")
        ]
    );
}

#[tokio::test]
async fn an_application_with_no_description_renders_its_name_as_the_description() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["service", "install"],
        &Scenario::default().description(None),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(
        fs::read_to_string(box_.systemd_path("com.acme.notes"))
            .unwrap()
            .contains("\nDescription=notes\n")
    );
}

#[tokio::test]
async fn a_description_with_a_line_break_installs_with_a_space_in_its_place() {
    for line_break in ["\n", "\r\n"] {
        let box_ = sandbox();
        let result = run(
            &box_,
            &["service", "install"],
            &Scenario::default().description(Some(&format!("Keep notes{line_break}in sync."))),
        )
        .await;
        assert_eq!(result.status, 0, "{}", result.stderr);
        assert!(
            fs::read_to_string(box_.systemd_path("com.acme.notes"))
                .unwrap()
                .contains("\nDescription=Keep notes in sync.\n"),
            "{line_break:?}"
        );
    }
}
