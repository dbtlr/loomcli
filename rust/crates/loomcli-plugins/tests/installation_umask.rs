//! Ports the cases of `installed-files.test.ts` that set the process's umask: the modes of
//! installed files, created directories, and created startup files whatever the umask. The umask is
//! process-wide, so these cases run one after another in a process of their own.

#![cfg(feature = "installation")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod installation_support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use installation_support::{LOADER, Running, committed_lines, home_box, installed, sandbox};
use loomcli_plugins::installation_test_support::{
    InstallOutcome, InstallRequest, Installed, InstalledFile, InstalledLine, PluginRecord,
    StartupLine, StartupLinesOutcome,
};
use rustix::fs::Mode;
use rustix::process::umask;

/// What `run` answers when the process runs it under the umask `mask`, which is restored after.
fn under_umask<T>(mask: u32, run: impl FnOnce() -> T) -> T {
    let previous = umask(Mode::from_raw_mode(mask));
    let answer = run();
    umask(previous);
    answer
}

fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn a_target_with_a_named_mode_holds_that_mode_under_umask_002_and_one_with_none_follows_the_umask()
{
    let s = sandbox();
    let outcome = under_umask(0o002, || {
        installed(
            &s,
            vec![
                InstalledFile::new(&s.first, "test").mode(0o644),
                InstalledFile::new(&s.second, "abc"),
            ],
        )
    });
    assert!(matches!(outcome, InstallOutcome::Installed(_)));
    assert_eq!(mode_of(&s.first), 0o644);
    assert_eq!(mode_of(&s.second), 0o664);
    // The mode changes neither the content nor what the plugin's file records.
    assert_eq!(fs::read_to_string(&s.first).unwrap(), "test");
    let owner: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&s.owner).unwrap()).unwrap();
    assert_eq!(
        owner["files"],
        serde_json::json!([
            { "path": s.first, "digest": installation_support::DIGEST_TEST },
            { "path": s.second, "digest": installation_support::DIGEST_ABC },
        ])
    );
}

fn a_named_directory_mode_holds_on_each_created_parent_under_umask_077_and_an_existing_parent_keeps_its_own()
 {
    let s = sandbox();
    let deep = s.root.join("a/b/c.md");
    fs::set_permissions(&s.root, fs::Permissions::from_mode(0o700)).unwrap();
    let outcome = under_umask(0o077, || {
        PluginRecord::new(&s.record, "skill")
            .install(
                &InstallRequest::new()
                    .files([InstalledFile::new(&deep, "test").mode(0o644)])
                    .directory_mode(0o755),
                &Running,
            )
            .unwrap()
    });
    assert!(matches!(outcome, InstallOutcome::Installed(_)));
    assert_eq!(mode_of(&s.root.join("a")), 0o755);
    assert_eq!(mode_of(&s.root.join("a/b")), 0o755);
    assert_eq!(mode_of(&deep), 0o644);
    assert_eq!(mode_of(&s.root), 0o700);
}

fn installing_a_line_into_a_missing_startup_file_creates_it_with_mode_644_and_its_parent_with_the_named_mode_and_records_both()
 {
    for mask in [0o002, 0o077] {
        let h = home_box();
        let rc = h.home.join("zdot/.zshrc");
        let outcome = under_umask(mask, || {
            PluginRecord::new(&h.record, "skill")
                .install(
                    &InstallRequest::new()
                        .lines([InstalledLine::new(&rc, LOADER)])
                        .directory_mode(0o755),
                    &Running,
                )
                .unwrap()
        });
        assert_eq!(
            outcome,
            InstallOutcome::Installed(Installed {
                lines: Some(StartupLinesOutcome {
                    added: vec![StartupLine {
                        path: rc.clone(),
                        line: LOADER.to_owned(),
                    }],
                    ..StartupLinesOutcome::default()
                }),
                ..Installed::default()
            }),
            "{mask:o}"
        );
        assert_eq!(
            fs::read_to_string(&rc).unwrap(),
            format!("{LOADER}\n"),
            "{mask:o}"
        );
        assert_eq!(mode_of(&rc), 0o644, "{mask:o}");
        assert_eq!(mode_of(rc.parent().unwrap()), 0o755, "{mask:o}");
        assert_eq!(
            fs::read_to_string(&h.owner).unwrap(),
            committed_lines(&[rc.parent().unwrap()], &[(&rc, LOADER)]),
            "{mask:o}"
        );
    }
}

fn a_created_directory_takes_the_named_mode_whatever_the_umask_and_follows_the_umask_when_none_is_named()
 {
    let s = sandbox();
    let named = s.root.join("named");
    under_umask(0o077, || {
        installed(&s, vec![InstalledFile::new(&s.first, "test")]);
        PluginRecord::new(&s.record, "other")
            .install(
                &InstallRequest::new()
                    .files([InstalledFile::new(named.join("a.md"), "abc")])
                    .directory_mode(0o755),
                &Running,
            )
            .unwrap();
    });
    assert_eq!(mode_of(&s.directory), 0o700);
    assert_eq!(mode_of(&named), 0o755);
}

/// The one test of this process, so no other case creates a file under a umask it set.
#[test]
fn modes_hold_whatever_the_umask() {
    a_target_with_a_named_mode_holds_that_mode_under_umask_002_and_one_with_none_follows_the_umask(
    );
    a_named_directory_mode_holds_on_each_created_parent_under_umask_077_and_an_existing_parent_keeps_its_own();
    installing_a_line_into_a_missing_startup_file_creates_it_with_mode_644_and_its_parent_with_the_named_mode_and_records_both();
    a_created_directory_takes_the_named_mode_whatever_the_umask_and_follows_the_umask_when_none_is_named();
}
