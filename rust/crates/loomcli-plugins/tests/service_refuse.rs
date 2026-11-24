//! Ports the `refusing` cases of `service.test.ts`: a build that is not distributed, a file the
//! record does not list or that changed, a link or a directory at the unit's path, an unsupported
//! platform, a relative home, a control character, and a record the module cannot read.

#![cfg(feature = "service")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod service_support;

use std::fs;
use std::os::unix::fs::symlink;

use loomcli_core::Build;
use service_support::{Scenario, not_loaded, ran, run, sandbox};

#[tokio::test]
async fn a_source_or_development_build_exits_1_with_the_pinned_sentence_and_calls_nothing() {
    for (build, phrase) in [
        (Build::Source, "a source build"),
        (Build::Development, "a development build"),
    ] {
        let box_ = sandbox();
        let result = run(
            &box_,
            &["service", "install"],
            &Scenario::default().build(build),
        )
        .await;
        assert_eq!(
            result,
            ran(
                1,
                "",
                &format!(
                    "notes is {phrase}, so it cannot install a service that would outlive it. Build it with cargo loom build, then run the built notes service install.\n"
                )
            )
        );
        assert!(box_.calls().is_empty());
        assert!(!box_.systemd_path("com.acme.notes").exists());
    }
}

/// Puts something at the unit's path that the plugin's file does not list as it is.
fn occupy(kind: &str, box_: &service_support::Sandbox, path: &std::path::Path) -> String {
    match kind {
        "an unrecorded file" => {
            fs::write(path, "hand written\n").unwrap();
            format!(
                "{} was not written by notes service install, so install leaves it alone. Remove it, or uninstall it with whatever installed it, then run notes service install again.",
                path.display()
            )
        }
        "a symbolic link" => {
            symlink(box_.root.join("elsewhere"), path).unwrap();
            not_regular(path)
        }
        _ => {
            fs::create_dir(path).unwrap();
            not_regular(path)
        }
    }
}

fn not_regular(path: &std::path::Path) -> String {
    format!(
        "{} is not a regular file, so install leaves it alone. Remove it, then run notes service install again.",
        path.display()
    )
}

#[tokio::test]
async fn an_occupant_at_the_unit_path_exits_1_writes_nothing_and_calls_nothing() {
    for platform in ["linux", "darwin"] {
        for kind in ["an unrecorded file", "a symbolic link", "a directory"] {
            let box_ = sandbox();
            let path = box_.unit_path(platform);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let sentence = occupy(kind, &box_, &path);
            let scenario = Scenario::default().platform(platform).answers(not_loaded());
            let result = run(&box_, &["service", "install"], &scenario).await;
            assert_eq!(
                result,
                ran(1, "", &format!("{sentence}\n")),
                "{platform} {kind}"
            );
            assert!(box_.calls().is_empty(), "{platform} {kind}");
            assert!(!box_.record_path(platform).exists(), "{platform} {kind}");
        }
    }
}

#[tokio::test]
async fn a_recorded_file_changed_since_exits_1_keeps_the_change_and_calls_nothing() {
    for platform in ["linux", "darwin"] {
        let box_ = sandbox();
        let scenario = Scenario::default().platform(platform).answers(not_loaded());
        let first = run(&box_, &["service", "install"], &scenario).await;
        assert_eq!(first.status, 0, "{}", first.stderr);
        let path = box_.unit_path(platform);
        fs::write(&path, "changed by hand\n").unwrap();
        box_.clear_calls();
        let result = run(&box_, &["service", "install"], &scenario).await;
        assert_eq!(
            result,
            ran(
                1,
                "",
                &format!(
                    "{} changed since notes service install wrote it, so install leaves it alone. Remove it, then run notes service install again.\n",
                    path.display()
                )
            ),
            "{platform}"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed by hand\n");
        assert!(box_.calls().is_empty(), "{platform}");
    }
}

#[tokio::test]
async fn a_file_with_the_rendered_text_that_service_json_does_not_list_refuses_as_unrecorded() {
    for platform in ["linux", "darwin"] {
        let box_ = sandbox();
        let path = box_.unit_path(platform);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, box_.pinned(platform)).unwrap();
        let scenario = Scenario::default().platform(platform).answers(not_loaded());
        let result = run(&box_, &["service", "install"], &scenario).await;
        assert_eq!(result.status, 1);
        assert!(
            result.stderr.contains(&format!(
                "{} was not written by notes service install",
                path.display()
            )),
            "{}",
            result.stderr
        );
        assert!(box_.calls().is_empty());
    }
}

#[tokio::test]
async fn win32_and_a_relative_home_exit_1_from_every_child() {
    let box_ = sandbox();
    for child in ["install", "uninstall", "start", "stop", "restart", "status"] {
        assert_eq!(
            run(
                &box_,
                &["service", child],
                &Scenario::default().platform("win32")
            )
            .await,
            ran(
                1,
                "",
                "notes cannot run a service on win32. Run it on Linux with systemd or macOS with launchd.\n"
            ),
            "{child}"
        );
        for platform in ["linux", "darwin"] {
            assert_eq!(
                run(
                    &box_,
                    &["service", child],
                    &Scenario::default().platform(platform).home("home")
                )
                .await,
                ran(
                    1,
                    "",
                    "notes cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.\n"
                ),
                "{child} {platform}"
            );
        }
    }
    assert!(box_.calls().is_empty());
}

#[tokio::test]
async fn a_program_word_holding_a_newline_exits_1_with_nothing_written() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["service", "install"],
        &Scenario::default().program(&["/opt/notes\n/bin/notes"]),
    )
    .await;
    assert_eq!(
        result,
        ran(
            1,
            "",
            "notes cannot write its service unit because a path or its description holds a control character. Install notes where its path has none.\n"
        )
    );
    assert!(!box_.systemd_path("com.acme.notes").exists());
    assert!(!box_.linux_record().exists());
    assert!(box_.calls().is_empty());
}

#[tokio::test]
async fn a_damaged_or_unknown_format_service_json_fails_install_and_uninstall_and_calls_nothing() {
    for text in [
        "not json",
        "{\"format\":2,\"state\":\"committed\",\"directories\":[],\"files\":[]}\n",
    ] {
        let box_ = sandbox();
        let record = box_.linux_record();
        fs::create_dir_all(record.parent().unwrap()).unwrap();
        fs::write(&record, text).unwrap();
        for child in ["install", "uninstall"] {
            assert_eq!(
                run(&box_, &["service", child], &Scenario::default()).await,
                ran(
                    1,
                    "",
                    &format!(
                        "{} cannot be read, so notes will not change the files it lists. Remove it and the files it lists, then run notes service {child} again.\n",
                        record.display()
                    )
                ),
                "{child} {text}"
            );
        }
        assert!(box_.calls().is_empty());
        assert_eq!(fs::read_to_string(&record).unwrap(), text);
    }
}

#[tokio::test]
async fn a_control_character_in_the_description_or_the_home_refuses_and_other_characters_do_not() {
    let sentence = "notes cannot write its service unit because a path or its description holds a control character. Install notes where its path has none.\n";
    for control in ['\u{0}', '\u{1f}', '\u{7f}', '\u{9f}'] {
        let box_ = sandbox();
        let scenario = Scenario::default().description(Some(&format!("Keep a{control}b")));
        assert_eq!(
            run(&box_, &["service", "install"], &scenario).await,
            ran(1, "", sentence),
            "{control:?}"
        );
        assert!(box_.calls().is_empty());
    }
    // A line break reads as a space before the control character test, and these are no controls.
    for plain in ['\u{a0}', '\u{2028}', '\u{85}', ' '] {
        let box_ = sandbox();
        let scenario = Scenario::default().description(Some(&format!("Keep a{plain}b")));
        let result = run(&box_, &["service", "install"], &scenario).await;
        assert_eq!(result.status, 0, "{plain:?}: {}", result.stderr);
    }
}
