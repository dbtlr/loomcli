//! Ports `installed-files.test.ts`: the installed-files module's installs, uninstalls, recovery,
//! installed folders, startup lines, and registrations, against a temporary directory per case.
//!
//! The cases that need a process killed between two file-system calls, or another run acting
//! between them, run this test binary again as a child (`child_process_entry`), whose probe
//! ends it with `SIGKILL` or acts at the named step, as the reference's `installation-run.mjs`
//! fixture does by replacing `node:fs` functions. The cases that set the process's umask live in
//! `installation_umask.rs`, a process of their own.

#![cfg(feature = "installation")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod installation_support;

use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use installation_support::{
    Cancelled, DIGEST_ABC, DIGEST_NEW, DIGEST_TEST, HomeBox, LOADER, NEWER, Running, Sandbox,
    committed, committed_folders, committed_lines, folder_of, home_box, installed, listing,
    outside, pending, sandbox, uninstalled, utf8_with_mark,
};
use loomcli_plugins::installation_test_support::{
    CommittedFile, FolderDigest, FolderFile, InstallOutcome, InstallRequest, InstallationError,
    Installed, InstalledFile, InstalledFolder, InstalledLine, PluginRecord, RecordedFolder,
    RecordedRead, RecordedRegistration, Refusal, RefusalReason, RegistrationRead, ReplaceOptions,
    StartupEncoding, StartupFileState, StartupLine, StartupLinesOutcome, Step, UninstallOutcome,
    Uninstalled, UninstalledLines, fill_folder, folder_refusals, inspect_startup_file,
    replace_file, set_probe, target_refusals, write_folder,
};
use serde_json::{Value, json};

/// The outcome of an install that wrote `written` and changed nothing else.
fn wrote(written: &[&Path]) -> InstallOutcome {
    InstallOutcome::Installed(Installed {
        written: written.iter().map(|path| path.to_path_buf()).collect(),
        ..Installed::default()
    })
}

/// The refusal of each path for its reason.
fn refused(entries: &[(&Path, RefusalReason)]) -> InstallOutcome {
    InstallOutcome::Refused(
        entries
            .iter()
            .map(|(path, reason)| Refusal {
                path: path.to_path_buf(),
                file: None,
                reason: *reason,
            })
            .collect(),
    )
}

/// The installed outcome, failing the case for a refusal.
fn installed_of(outcome: InstallOutcome) -> Installed {
    match outcome {
        InstallOutcome::Installed(done) => done,
        InstallOutcome::Refused(refused) => panic!("the install refused: {refused:?}"),
    }
}

/// The uninstalled outcome, failing the case for a refusal.
fn uninstalled_of(outcome: UninstallOutcome) -> Uninstalled {
    match outcome {
        UninstallOutcome::Uninstalled(done) => done,
        UninstallOutcome::Refused(refused) => panic!("the uninstall refused: {refused:?}"),
    }
}

fn paths(entries: &[&Path]) -> Vec<PathBuf> {
    entries.iter().map(|path| path.to_path_buf()).collect()
}

fn text(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn names(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn record(sandbox: &Sandbox) -> PluginRecord {
    PluginRecord::new(&sandbox.record, "skill")
}

// Installing

#[test]
fn installing_two_files_writes_both_and_a_committed_file_with_their_digests_and_the_created_directory()
 {
    let s = sandbox();
    let outcome = installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "test"),
            InstalledFile::new(&s.second, "abc"),
        ],
    );
    assert_eq!(outcome, wrote(&[&s.first, &s.second]));
    assert_eq!(text(&s.first), "test");
    assert_eq!(text(&s.second), "abc");
    assert_eq!(
        text(&s.owner),
        committed(
            &[&s.directory],
            &[(&s.first, DIGEST_TEST), (&s.second, DIGEST_ABC)]
        )
    );
    assert_eq!(names(&s.directory), ["SKILL.md", "reference.md"]);
    assert_eq!(names(&s.record), ["skill.json"]);
}

#[test]
fn each_missing_parent_directory_is_created_and_recorded_outermost_first() {
    let s = sandbox();
    let deep = s.root.join("a/b/c.md");
    installed(&s, vec![InstalledFile::new(&deep, "test")]);
    assert_eq!(
        text(&s.owner),
        committed(
            &[&s.root.join("a"), &s.root.join("a/b")],
            &[(&deep, DIGEST_TEST)]
        )
    );
}

#[test]
fn a_second_install_with_new_content_replaces_both() {
    let s = sandbox();
    installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "test"),
            InstalledFile::new(&s.second, "abc"),
        ],
    );
    let outcome = installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "new"),
            InstalledFile::new(&s.second, "new"),
        ],
    );
    assert_eq!(installed_of(outcome).written, paths(&[&s.first, &s.second]));
    assert_eq!(text(&s.first), "new");
    assert_eq!(text(&s.second), "new");
    assert_eq!(
        text(&s.owner),
        committed(
            &[&s.directory],
            &[(&s.first, DIGEST_NEW), (&s.second, DIGEST_NEW)]
        )
    );
}

#[test]
fn an_install_that_lists_only_the_first_file_removes_the_second() {
    let s = sandbox();
    installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "test"),
            InstalledFile::new(&s.second, "abc"),
        ],
    );
    let outcome = installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    assert_eq!(
        outcome,
        InstallOutcome::Installed(Installed {
            written: paths(&[&s.first]),
            removed: paths(&[&s.second]),
            ..Installed::default()
        })
    );
    assert!(!s.second.exists());
    assert_eq!(
        text(&s.owner),
        committed(&[&s.directory], &[(&s.first, DIGEST_TEST)])
    );
}

#[test]
fn a_recorded_file_the_install_no_longer_lists_is_kept_and_reported_when_it_changed() {
    let s = sandbox();
    installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "test"),
            InstalledFile::new(&s.second, "abc"),
        ],
    );
    fs::write(&s.second, "mine").unwrap();
    let outcome = installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    assert_eq!(
        outcome,
        InstallOutcome::Installed(Installed {
            written: paths(&[&s.first]),
            kept: paths(&[&s.second]),
            ..Installed::default()
        })
    );
    assert_eq!(text(&s.second), "mine");
    assert_eq!(
        text(&s.owner),
        committed(&[&s.directory], &[(&s.first, DIGEST_TEST)])
    );
}

/// An install over what `arrange` put at the second target refuses for `reason`, writes nothing,
/// and reports the path.
fn refuses_over(reason: RefusalReason, arrange: impl FnOnce(&Sandbox)) {
    let s = sandbox();
    arrange(&s);
    let before = fs::read_to_string(&s.owner).ok();
    let first_before = fs::read_to_string(&s.first).ok();
    let outcome = installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "new"),
            InstalledFile::new(&s.second, "new"),
        ],
    );
    assert_eq!(outcome, refused(&[(&s.second, reason)]));
    assert_eq!(fs::read_to_string(&s.owner).ok(), before);
    assert_eq!(fs::read_to_string(&s.first).ok(), first_before);
}

#[test]
fn an_install_over_an_unrecorded_file_refuses_writes_nothing_and_reports_the_path() {
    refuses_over(RefusalReason::Unrecorded, |s| {
        fs::create_dir(&s.directory).unwrap();
        fs::write(&s.second, "theirs").unwrap();
    });
}

#[test]
fn an_install_over_a_recorded_file_changed_since_refuses_writes_nothing_and_reports_the_path() {
    refuses_over(RefusalReason::Changed, |s| {
        installed(
            s,
            vec![
                InstalledFile::new(&s.first, "test"),
                InstalledFile::new(&s.second, "abc"),
            ],
        );
        fs::write(&s.second, "changed").unwrap();
    });
}

#[test]
fn an_install_over_a_symbolic_link_refuses_writes_nothing_and_reports_the_path() {
    refuses_over(RefusalReason::Link, |s| {
        fs::create_dir(&s.directory).unwrap();
        fs::write(s.root.join("elsewhere"), "abc").unwrap();
        symlink(s.root.join("elsewhere"), &s.second).unwrap();
    });
}

#[test]
fn an_install_over_a_directory_refuses_writes_nothing_and_reports_the_path() {
    refuses_over(RefusalReason::Directory, |s| {
        fs::create_dir_all(&s.second).unwrap();
    });
}

#[test]
fn an_install_removes_leftover_staging_files_of_the_plugin_file() {
    let s = sandbox();
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    let leftover = s.record.join(".skill.json.0123456789abcdef.loom-staging");
    fs::write(&leftover, "{\"format\":1,").unwrap();
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    assert_eq!(names(&s.record), ["skill.json"]);
}

#[test]
fn an_install_reports_every_path_it_refuses() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    fs::write(&s.first, "theirs").unwrap();
    fs::write(&s.second, "theirs").unwrap();
    assert_eq!(
        installed(
            &s,
            vec![
                InstalledFile::new(&s.first, "new"),
                InstalledFile::new(&s.second, "new"),
            ]
        ),
        refused(&[
            (&s.first, RefusalReason::Unrecorded),
            (&s.second, RefusalReason::Unrecorded),
        ])
    );
}

/// A plugin file holding `content` refuses the install for `reason`, writes nothing, keeps its
/// staging leftover, and reports its path.
fn plugin_file_refuses(content: &str, reason: RefusalReason) {
    let s = sandbox();
    fs::create_dir(&s.record).unwrap();
    fs::write(&s.owner, content).unwrap();
    let leftover = s.record.join(".skill.json.0123456789abcdef.loom-staging");
    fs::write(&leftover, "{\"format\":1,").unwrap();
    assert_eq!(
        installed(&s, vec![InstalledFile::new(&s.first, "test")]),
        refused(&[(&s.owner, reason)])
    );
    assert_eq!(text(&s.owner), content);
    assert!(leftover.exists());
    assert!(!s.directory.exists());
}

#[test]
fn a_plugin_file_that_is_not_json_refuses_the_install() {
    plugin_file_refuses("{\"format\":1,", RefusalReason::Damaged);
}

#[test]
fn a_plugin_file_that_is_an_array_refuses_the_install() {
    plugin_file_refuses("[]\n", RefusalReason::Damaged);
}

#[test]
fn a_plugin_file_that_is_a_committed_file_with_a_relative_path_refuses_the_install() {
    plugin_file_refuses(
        &committed(&[], &[(Path::new("notes.md"), DIGEST_TEST)]),
        RefusalReason::Damaged,
    );
}

#[test]
fn a_plugin_file_with_an_unknown_state_refuses_the_install() {
    plugin_file_refuses(
        "{\"format\":1,\"state\":\"done\",\"directories\":[],\"files\":[]}\n",
        RefusalReason::Damaged,
    );
}

#[test]
fn a_plugin_file_of_an_unknown_format_refuses_the_install() {
    plugin_file_refuses(
        "{\"format\":3,\"state\":\"committed\",\"directories\":[],\"files\":[]}\n",
        RefusalReason::UnknownFormat,
    );
}

#[test]
fn an_install_reads_the_run_signal_before_it_writes_and_returns_its_cancellation() {
    let s = sandbox();
    let error = record(&s)
        .install(
            &InstallRequest::new().files([InstalledFile::new(&s.first, "test")]),
            &Cancelled,
        )
        .unwrap_err();
    assert!(matches!(error, InstallationError::Cancelled(_)));
    assert!(!s.record.exists());
    assert!(!s.directory.exists());
}

#[test]
fn an_install_over_a_fifo_refuses_writes_nothing_and_reports_the_path() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    assert!(
        Command::new("mkfifo")
            .arg(&s.second)
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(
        installed(
            &s,
            vec![
                InstalledFile::new(&s.first, "new"),
                InstalledFile::new(&s.second, "new"),
            ]
        ),
        refused(&[(&s.second, RefusalReason::Special)])
    );
    assert!(!s.first.exists());
    assert!(!s.owner.exists());
}

// Uninstalling

#[test]
fn an_uninstall_reads_the_run_signal_before_the_first_removal_and_returns_its_cancellation() {
    let s = sandbox();
    installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "test"),
            InstalledFile::new(&s.second, "abc"),
        ],
    );
    let before = text(&s.owner);
    let error = record(&s).uninstall(&[], &Cancelled).unwrap_err();
    assert!(matches!(error, InstallationError::Cancelled(_)));
    assert_eq!(text(&s.first), "test");
    assert_eq!(text(&s.second), "abc");
    assert_eq!(text(&s.owner), before);
}

#[test]
fn uninstall_removes_unchanged_files_and_the_created_directory_and_deletes_the_plugin_file() {
    let s = sandbox();
    installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "test"),
            InstalledFile::new(&s.second, "abc"),
        ],
    );
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled {
            removed: paths(&[&s.first, &s.second]),
            ..Uninstalled::default()
        })
    );
    assert!(!s.directory.exists());
    assert!(s.skills.exists());
    assert!(!s.owner.exists());
}

#[test]
fn uninstall_keeps_and_reports_a_changed_file_which_keeps_its_directory() {
    let s = sandbox();
    installed(
        &s,
        vec![
            InstalledFile::new(&s.first, "test"),
            InstalledFile::new(&s.second, "abc"),
        ],
    );
    fs::write(&s.second, "mine").unwrap();
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled {
            removed: paths(&[&s.first]),
            kept: paths(&[&s.second]),
            lines: None,
        })
    );
    assert_eq!(text(&s.second), "mine");
    assert!(!s.owner.exists());
}

#[test]
fn uninstall_passes_over_a_file_and_a_directory_already_gone() {
    let s = sandbox();
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    fs::remove_dir_all(&s.directory).unwrap();
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled::default())
    );
    assert!(!s.owner.exists());
}

#[test]
fn uninstall_removes_created_directories_deepest_first() {
    let s = sandbox();
    let deep = s.root.join("a/b/c.md");
    installed(&s, vec![InstalledFile::new(&deep, "test")]);
    uninstalled(&s);
    assert!(!s.root.join("a").exists());
}

#[test]
fn uninstall_with_no_plugin_file_records_nothing_and_removes_nothing() {
    let s = sandbox();
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled::default())
    );
    assert!(!s.record.exists());
}

#[test]
fn uninstall_removes_leftover_staging_files_of_the_plugin_file() {
    let s = sandbox();
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    fs::write(
        s.record.join(".skill.json.0123456789abcdef.loom-staging"),
        "{\"format\":1,",
    )
    .unwrap();
    uninstalled(&s);
    assert!(names(&s.record).is_empty());
}

#[test]
fn uninstall_refuses_a_damaged_plugin_file_and_reports_its_path() {
    let s = sandbox();
    fs::create_dir(&s.record).unwrap();
    fs::write(&s.owner, "damaged").unwrap();
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Refused(vec![Refusal {
            path: s.owner.clone(),
            file: None,
            reason: RefusalReason::Damaged,
        }])
    );
    assert_eq!(text(&s.owner), "damaged");
}

// Recovery

#[test]
fn recovery_resolves_each_pending_path_by_its_digest_before_the_install_it_precedes() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    let written = s.directory.join("w.md");
    let unwritten = s.directory.join("u.md");
    let removed = s.directory.join("r.md");
    let changed = s.directory.join("c.md");
    fs::write(&written, "new").unwrap();
    fs::write(&unwritten, "test").unwrap();
    fs::write(&changed, "theirs").unwrap();
    pending(
        &s,
        &[&s.directory, &s.root.join("gone")],
        &[
            (&written, Some(DIGEST_TEST), Some(DIGEST_NEW)),
            (&unwritten, Some(DIGEST_TEST), Some(DIGEST_NEW)),
            (&removed, Some(DIGEST_ABC), None),
            (&changed, None, Some(DIGEST_NEW)),
        ],
    );
    // A directory as a target refuses the install after recovery committed, so the file shows it.
    fs::create_dir(&s.first).unwrap();
    assert!(matches!(
        installed(&s, vec![InstalledFile::new(&s.first, "test")]),
        InstallOutcome::Refused(_)
    ));
    assert_eq!(
        text(&s.owner),
        committed(
            &[&s.directory],
            &[(&written, DIGEST_NEW), (&unwritten, DIGEST_TEST)]
        )
    );
    assert_eq!(text(&changed), "theirs");
}

#[test]
fn a_pending_path_changed_by_hand_before_the_next_run_is_kept_and_no_longer_recorded() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    fs::write(&s.second, "by hand").unwrap();
    pending(
        &s,
        &[&s.directory],
        &[
            (&s.first, None, Some(DIGEST_TEST)),
            (&s.second, None, Some(DIGEST_ABC)),
        ],
    );
    let outcome = installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    assert_eq!(outcome, wrote(&[&s.first]));
    assert_eq!(text(&s.second), "by hand");
    assert_eq!(
        text(&s.owner),
        committed(&[&s.directory], &[(&s.first, DIGEST_TEST)])
    );
}

#[test]
fn recovery_removes_leftover_staging_files_of_each_pending_path_and_nothing_else() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    let leftover = s.directory.join(".SKILL.md.0123456789abcdef.loom-staging");
    let unrelated = s.directory.join(".SKILL.md.notes");
    fs::write(&leftover, "te").unwrap();
    fs::write(&unrelated, "mine").unwrap();
    pending(&s, &[&s.directory], &[(&s.first, None, Some(DIGEST_TEST))]);
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    assert!(!leftover.exists());
    assert_eq!(text(&unrelated), "mine");
    assert_eq!(names(&s.directory), [".SKILL.md.notes", "SKILL.md"]);
}

#[test]
fn recovery_runs_before_an_uninstall_too() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    fs::write(&s.first, "test").unwrap();
    pending(&s, &[&s.directory], &[(&s.first, None, Some(DIGEST_TEST))]);
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled {
            removed: paths(&[&s.first]),
            ..Uninstalled::default()
        })
    );
    assert!(!s.directory.exists());
}

// Recovery from a process that stopped

/// The variable that hands a child run its request.
const CHILD: &str = "LOOM_INSTALLATION_CHILD";

/// The request a child run carries out, as the reference's fixture reads it.
static CHILD_REQUEST: OnceLock<Value> = OnceLock::new();

/// The targets whose staging file's exclusive create removes a staging folder first, for the in-process case of a
/// staging folder another run's recovery removes between two files.
static REMOVE_BEFORE_CREATE: Mutex<Vec<(PathBuf, PathBuf)>> = Mutex::new(Vec::new());

/// Ends this process with `SIGKILL`, as the fixture's traps do.
fn kill_self() -> ! {
    let _ = Command::new("kill")
        .args(["-KILL", &std::process::id().to_string()])
        .status();
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

/// The path a child request names under `name`, if any.
fn trap(name: &str) -> Option<PathBuf> {
    CHILD_REQUEST.get()?.get(name)?.as_str().map(PathBuf::from)
}

/// The `{ path, content }` a child request names under `name`, if any.
fn trap_write(name: &str) -> Option<(PathBuf, String)> {
    let entry = CHILD_REQUEST.get()?.get(name)?;
    Some((
        PathBuf::from(entry["path"].as_str()?),
        entry["content"].as_str()?.to_owned(),
    ))
}

/// Whether `path` is a staging file of `target`: `.<name>.<random>.loom-staging` beside it.
fn stages(path: &Path, target: &Path) -> bool {
    let name = target.file_name().unwrap().to_string_lossy();
    path.parent() == target.parent()
        && path
            .file_name()
            .is_some_and(|own| own.to_string_lossy().starts_with(&format!(".{name}.")))
}

/// The probe of this test binary: a child run's traps, and the in-process removal of a staging
/// folder before a named exclusive create.
fn probe(step: Step<'_>) {
    match step {
        Step::BeforeRename { to, .. } if trap("killBeforeRename").as_deref() == Some(to) => {
            kill_self()
        }
        Step::AfterRename { from, to } => {
            if trap("killAfterRename").as_deref() == Some(to)
                || trap("killAfterMoveAside").as_deref() == Some(from)
            {
                kill_self();
            }
        }
        Step::BeforeCreateDirectory(path) if trap("killBeforeMkdir").as_deref() == Some(path) => {
            kill_self()
        }
        Step::BeforeAppend(path) if trap("killBeforeAppend").as_deref() == Some(path) => {
            kill_self()
        }
        Step::AfterAppend(path) if trap("killAfterAppend").as_deref() == Some(path) => kill_self(),
        Step::BeforeExclusiveCreate(path) => {
            if let Some((created, content)) = trap_write("createBeforeCreate")
                && created == path
            {
                fs::write(&created, content).unwrap();
            }
            let staging = REMOVE_BEFORE_CREATE
                .lock()
                .unwrap()
                .iter()
                .find(|(target, _)| stages(path, target))
                .map(|(_, staging)| staging.clone());
            if let Some(staging) = staging {
                fs::remove_dir_all(staging).unwrap();
            }
        }
        Step::AfterExclusiveCreate(path) => {
            if let Some((created, content)) = trap_write("appendAfterCreate")
                && created == path
            {
                fs::OpenOptions::new()
                    .append(true)
                    .open(&created)
                    .unwrap()
                    .write_all(content.as_bytes())
                    .unwrap();
            }
        }
        _ => {}
    }
}

/// The child run: reads its request, installs the probe, and prints each round's outcome as one
/// `outcome: <json>` line. In the ordinary test run it has no request and does nothing.
#[test]
fn child_process_entry() {
    let Ok(request) = std::env::var(CHILD) else {
        return;
    };
    let request: Value = serde_json::from_str(&request).unwrap();
    CHILD_REQUEST.set(request.clone()).unwrap();
    set_probe(probe);
    let files: Vec<InstalledFile> = request["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            let content = match file["content"].as_str() {
                Some(content) => content.to_owned(),
                None => file["fill"]
                    .as_str()
                    .unwrap()
                    .repeat(usize::try_from(file["size"].as_u64().unwrap()).unwrap()),
            };
            InstalledFile::new(file["path"].as_str().unwrap(), content)
        })
        .collect();
    let folders: Vec<InstalledFolder> = request["folders"]
        .as_array()
        .map(|folders| {
            folders
                .iter()
                .map(|folder| {
                    InstalledFolder::new(
                        folder["path"].as_str().unwrap(),
                        folder["files"].as_array().unwrap().iter().map(|file| {
                            FolderFile::new(
                                file["path"].as_str().unwrap(),
                                file["content"].as_str().unwrap(),
                            )
                        }),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let lines: Vec<InstalledLine> = request["lines"]
        .as_array()
        .map(|lines| {
            lines
                .iter()
                .map(|line| {
                    InstalledLine::new(
                        line["path"].as_str().unwrap(),
                        line["line"].as_str().unwrap(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let plugin = request["plugin"].as_str().unwrap_or("skill");
    let owner = PluginRecord::new(request["record"].as_str().unwrap(), plugin);
    let install = InstallRequest::new()
        .files(files)
        .folders(folders)
        .lines(lines);
    let rounds = request["rounds"].as_u64().unwrap_or(1);
    let mut out = std::io::stdout();
    for _ in 0..rounds {
        let summary = match owner.install(&install, &Running) {
            Ok(InstallOutcome::Refused(_)) => json!({ "status": "refused" }),
            Ok(InstallOutcome::Installed(done)) => {
                let added: Vec<Value> = done
                    .lines
                    .map(|lines| lines.added)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|line| json!({ "line": line.line, "path": line.path }))
                    .collect();
                json!({ "status": "installed", "added": added })
            }
            Err(InstallationError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                json!({ "failed": "ENOENT" })
            }
            Err(error) => json!({ "failed": error.to_string() }),
        };
        writeln!(out, "outcome: {summary}").unwrap();
    }
}

/// How a child run ended: its exit code, `None` when a signal ended it, and its outcomes.
struct ChildRun {
    code: Option<i32>,
    outcomes: Vec<Value>,
}

/// The command that runs this binary again as a child carrying `request`.
fn child_command(request: &Value) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "child_process_entry",
            "--exact",
            "--nocapture",
            "--test-threads=1",
            "--quiet",
        ])
        .env(CHILD, request.to_string());
    command
}

/// The outcome lines a child printed.
fn outcomes_of(stdout: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(stdout)
        .lines()
        .filter_map(|line| line.strip_prefix("outcome: "))
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

/// One run of the module in its own process.
fn in_process(request: &Value) -> ChildRun {
    let output = child_command(request).output().unwrap();
    ChildRun {
        code: output.status.code(),
        outcomes: outcomes_of(&output.stdout),
    }
}

/// Whether a child run was killed before it printed any outcome.
fn killed(run: &ChildRun) -> bool {
    run.code.is_none() && run.outcomes.is_empty()
}

fn owner_json(s: &Sandbox) -> Value {
    serde_json::from_str(&text(&s.owner)).unwrap()
}

#[test]
fn a_process_killed_between_two_targets_leaves_a_pending_file_and_the_next_install_finishes_both() {
    let s = sandbox();
    let files = vec![
        InstalledFile::new(&s.first, "test"),
        InstalledFile::new(&s.second, "abc"),
    ];
    let run = in_process(&json!({
        "files": [{ "content": "test", "path": s.first }, { "content": "abc", "path": s.second }],
        "killAfterRename": s.first,
        "record": s.record,
    }));
    assert!(killed(&run));
    assert_eq!(owner_json(&s)["state"], "pending");
    assert_eq!(text(&s.first), "test");
    assert!(!s.second.exists());
    assert_eq!(installed(&s, files), wrote(&[&s.first, &s.second]));
    assert_eq!(text(&s.second), "abc");
    assert_eq!(
        text(&s.owner),
        committed(
            &[&s.directory],
            &[(&s.first, DIGEST_TEST), (&s.second, DIGEST_ABC)]
        )
    );
}

#[test]
fn a_process_killed_before_it_creates_a_listed_directory_leaves_a_pending_file_whose_next_install_creates_and_records_it()
 {
    let s = sandbox();
    let run = in_process(&json!({
        "files": [{ "content": "test", "path": s.first }],
        "killBeforeMkdir": s.directory,
        "record": s.record,
    }));
    assert!(killed(&run));
    let owner = owner_json(&s);
    assert_eq!(owner["state"], "pending");
    assert_eq!(owner["directories"], json!([s.directory]));
    assert!(!s.directory.exists());
    installed_of(installed(&s, vec![InstalledFile::new(&s.first, "test")]));
    assert_eq!(
        text(&s.owner),
        committed(&[&s.directory], &[(&s.first, DIGEST_TEST)])
    );
}

#[test]
fn two_installs_writing_one_target_at_once_never_rename_one_partial_staging_file_into_place() {
    let s = sandbox();
    let size = 4 * 1024 * 1024;
    let mut children: Vec<std::process::Child> = ["a", "b"]
        .iter()
        .map(|fill| {
            child_command(&json!({
                "files": [{ "fill": fill, "path": s.first, "size": size }],
                "record": s.record,
                "rounds": 15,
            }))
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap()
        })
        .collect();
    let whole = |bytes: &[u8]| {
        !bytes.is_empty() && bytes.iter().all(|byte| *byte == bytes[0]) && bytes.len() == size
    };
    // Each read of the target while both run: whether it held one install's content, whole.
    let mut reads = Vec::new();
    loop {
        let running = children
            .iter_mut()
            .any(|child| child.try_wait().unwrap().is_none());
        if !running {
            break;
        }
        if let Ok(bytes) = fs::read(&s.first) {
            reads.push(whole(&bytes));
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    let completions: Vec<std::process::Output> = children
        .into_iter()
        .map(|child| child.wait_with_output().unwrap())
        .collect();
    assert!(!reads.is_empty());
    assert!(reads.iter().all(|whole| *whole));
    assert_eq!(
        completions
            .iter()
            .map(|output| output.status.code())
            .collect::<Vec<_>>(),
        [Some(0), Some(0)]
    );
    // A run can recover the other's pending file and remove its staging file, so its rename fails.
    let ends: Vec<String> = completions
        .iter()
        .flat_map(|output| outcomes_of(&output.stdout))
        .map(|outcome| {
            outcome
                .get("status")
                .or_else(|| outcome.get("failed"))
                .and_then(Value::as_str)
                .unwrap()
                .to_owned()
        })
        .collect();
    assert_eq!(ends.len(), 30);
    assert!(
        ends.iter()
            .all(|end| ["installed", "refused", "ENOENT"].contains(&end.as_str())),
        "{ends:?}"
    );
    assert!(ends.iter().any(|end| end == "installed"));
    assert!(whole(&fs::read(&s.first).unwrap()));
}

#[test]
fn a_replacement_whose_rename_fails_returns_the_rename_error_and_leaves_no_staging_file() {
    let s = sandbox();
    fs::create_dir_all(&s.first).unwrap();
    let error = replace_file(&s.first, b"test", ReplaceOptions::new()).unwrap_err();
    let InstallationError::Io(error) = error else {
        panic!("not a runtime error: {error:?}");
    };
    assert!(matches!(
        error.kind(),
        std::io::ErrorKind::IsADirectory
            | std::io::ErrorKind::DirectoryNotEmpty
            | std::io::ErrorKind::AlreadyExists
            | std::io::ErrorKind::PermissionDenied
    ));
    assert_eq!(names(&s.directory), ["SKILL.md"]);
}

/// What the skill plugin's file records, read without writing.
fn read(s: &Sandbox) -> RecordedRead {
    record(s).read().unwrap()
}

/// A read with these files, folders, and lines.
fn recorded_read(
    files: Vec<CommittedFile>,
    folders: Vec<RecordedFolder>,
    lines: Vec<StartupLine>,
) -> RecordedRead {
    RecordedRead::Read {
        files,
        folders,
        lines,
    }
}

fn file_entry(path: &Path, digest: &str) -> CommittedFile {
    CommittedFile {
        path: path.to_path_buf(),
        digest: digest.to_owned(),
    }
}

fn folder_entry(path: &Path) -> RecordedFolder {
    RecordedFolder {
        path: path.to_path_buf(),
        files: None,
    }
}

fn line_entry(path: &Path, line: &str) -> StartupLine {
    StartupLine {
        path: path.to_path_buf(),
        line: line.to_owned(),
    }
}

#[test]
fn reading_what_a_plugin_file_records_returns_each_file_and_digest_and_writes_nothing() {
    let s = sandbox();
    assert_eq!(read(&s), recorded_read(vec![], vec![], vec![]));
    assert!(!s.record.exists());
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    let before = text(&s.owner);
    let staging = s.record.join(".skill.json.0123456789abcdef.loom-staging");
    fs::write(&staging, "leftover").unwrap();
    assert_eq!(
        read(&s),
        recorded_read(vec![file_entry(&s.first, DIGEST_TEST)], vec![], vec![])
    );
    assert_eq!(text(&s.owner), before);
    assert!(staging.exists());
}

#[test]
fn reading_a_pending_plugin_file_returns_what_recovery_would_keep_and_writes_nothing() {
    let s = sandbox();
    fs::create_dir(&s.directory).unwrap();
    fs::write(&s.first, "new").unwrap();
    pending(
        &s,
        &[&s.directory],
        &[
            (&s.first, Some(DIGEST_TEST), Some(DIGEST_NEW)),
            (&s.second, None, Some(DIGEST_ABC)),
        ],
    );
    let before = text(&s.owner);
    assert_eq!(
        read(&s),
        recorded_read(vec![file_entry(&s.first, DIGEST_NEW)], vec![], vec![])
    );
    assert_eq!(text(&s.owner), before);
}

fn reading_refuses(reason: RefusalReason, content: &str) {
    let s = sandbox();
    fs::create_dir(&s.record).unwrap();
    fs::write(&s.owner, content).unwrap();
    assert_eq!(
        read(&s),
        RecordedRead::Refused(Refusal {
            path: s.owner.clone(),
            file: None,
            reason,
        })
    );
    assert_eq!(text(&s.owner), content);
}

#[test]
fn reading_a_damaged_plugin_file_refuses_it_and_reports_its_path() {
    reading_refuses(RefusalReason::Damaged, "not json");
}

#[test]
fn reading_an_unknown_format_plugin_file_refuses_it_and_reports_its_path() {
    reading_refuses(
        RefusalReason::UnknownFormat,
        "{\"format\":3,\"state\":\"committed\",\"directories\":[],\"files\":[]}\n",
    );
}

#[test]
fn the_target_refusals_read_without_writing_match_the_ones_an_install_meets() {
    let s = sandbox();
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    let RecordedRead::Read { files, .. } = read(&s) else {
        panic!("The plugin file did not read.");
    };
    let link = s.skills.join("link.md");
    symlink(&s.first, &link).unwrap();
    let unrecorded = s.skills.join("other.md");
    fs::write(&unrecorded, "abc").unwrap();
    let absent = s.skills.join("absent.md");
    let targets: Vec<&Path> = vec![&s.first, &absent, &unrecorded, &link, &s.skills];
    assert_eq!(
        target_refusals(&targets, &files).unwrap(),
        [
            Refusal {
                path: unrecorded.clone(),
                file: None,
                reason: RefusalReason::Unrecorded
            },
            Refusal {
                path: link.clone(),
                file: None,
                reason: RefusalReason::Link
            },
            Refusal {
                path: s.skills.clone(),
                file: None,
                reason: RefusalReason::Directory
            },
        ]
    );
    fs::write(&s.first, "abc").unwrap();
    assert_eq!(
        target_refusals(&[&s.first], &files).unwrap(),
        [Refusal {
            path: s.first.clone(),
            file: None,
            reason: RefusalReason::Changed
        }]
    );
}

// Installed folders

/// One install of `folders` by the skill plugin, with `files` and the force mode.
fn installed_folders(
    s: &Sandbox,
    folders: Vec<InstalledFolder>,
    files: Vec<InstalledFile>,
    force: bool,
) -> InstallOutcome {
    record(s)
        .install(
            &InstallRequest::new()
                .files(files)
                .folders(folders)
                .force(force),
            &Running,
        )
        .unwrap()
}

#[test]
fn installing_a_folder_writes_it_whole_with_its_modes_and_records_its_path_and_created_parents() {
    let s = sandbox();
    let folder = s.skills.join("deep/notes");
    let outcome = installed_folders(
        &s,
        vec![InstalledFolder::new(
            &folder,
            [
                FolderFile::new("SKILL.md", "test"),
                FolderFile::new("agents/run.sh", "abc").mode(0o755),
            ],
        )],
        vec![],
        false,
    );
    assert_eq!(outcome, wrote(&[&folder]));
    assert_eq!(listing(&folder), ["SKILL.md", "agents/", "agents/run.sh"]);
    assert_eq!(text(&folder.join("agents/run.sh")), "abc");
    assert_eq!(
        fs::metadata(folder.join("agents/run.sh")).unwrap().mode() & 0o7777,
        0o755
    );
    assert_eq!(
        text(&s.owner),
        format!(
            "{}\n",
            json!({
                "format": 2, "state": "committed", "directories": [s.skills.join("deep")],
                "files": [],
                "folders": [{
                    "path": folder,
                    "files": [
                        { "path": "SKILL.md", "digest": DIGEST_TEST },
                        { "path": "agents/run.sh", "digest": DIGEST_ABC }
                    ]
                }]
            })
        )
    );
    assert_eq!(
        listing(&s.skills.join("deep")),
        [
            "notes/",
            "notes/SKILL.md",
            "notes/agents/",
            "notes/agents/run.sh"
        ]
    );
}

#[test]
fn a_second_install_leaves_exactly_the_new_files_even_after_edits_and_additions_inside_the_folder()
{
    let s = sandbox();
    installed_folders(
        &s,
        vec![folder_of(
            &s.directory,
            &[("SKILL.md", "test"), ("old.md", "abc")],
        )],
        vec![],
        false,
    );
    fs::write(s.directory.join("SKILL.md"), "edited").unwrap();
    fs::write(s.directory.join("added.md"), "mine").unwrap();
    fs::create_dir(s.directory.join("extra")).unwrap();
    let outcome = installed_folders(
        &s,
        vec![folder_of(
            &s.directory,
            &[("SKILL.md", "new"), ("references/old.md", "abc")],
        )],
        vec![],
        false,
    );
    assert_eq!(outcome, wrote(&[&s.directory]));
    assert_eq!(
        listing(&s.directory),
        ["SKILL.md", "references/", "references/old.md"]
    );
    assert_eq!(text(&s.directory.join("SKILL.md")), "new");
    assert_eq!(
        listing(&s.skills),
        [
            "notes/",
            "notes/SKILL.md",
            "notes/references/",
            "notes/references/old.md"
        ]
    );
    assert_eq!(
        text(&s.owner),
        committed_folders(
            &[],
            &[(
                &s.directory,
                &[("SKILL.md", DIGEST_NEW), ("references/old.md", DIGEST_ABC)]
            )]
        )
    );
}

#[test]
fn an_install_that_no_longer_lists_a_recorded_folder_removes_it_whole_edits_included() {
    let s = sandbox();
    let other = s.skills.join("other");
    installed_folders(
        &s,
        vec![
            folder_of(&s.directory, &[("SKILL.md", "test")]),
            folder_of(&other, &[("a.md", "abc")]),
        ],
        vec![],
        false,
    );
    fs::write(s.directory.join("added.md"), "mine").unwrap();
    let outcome = installed_folders(
        &s,
        vec![folder_of(&other, &[("a.md", "abc")])],
        vec![],
        false,
    );
    assert_eq!(
        outcome,
        InstallOutcome::Installed(Installed {
            written: paths(&[&other]),
            removed: paths(&[&s.directory]),
            ..Installed::default()
        })
    );
    assert_eq!(listing(&s.skills), ["other/", "other/a.md"]);
    assert_eq!(
        text(&s.owner),
        committed_folders(&[], &[(&other, &[("a.md", DIGEST_ABC)])])
    );
}

#[test]
fn files_and_folders_install_together_and_an_uninstall_removes_both() {
    let s = sandbox();
    let folder = s.skills.join("pack");
    installed_folders(
        &s,
        vec![folder_of(&folder, &[("a.md", "abc")])],
        vec![InstalledFile::new(&s.first, "test")],
        false,
    );
    assert_eq!(text(&s.first), "test");
    let owner = owner_json(&s);
    assert_eq!(
        owner["files"],
        json!([{ "path": s.first, "digest": DIGEST_TEST }])
    );
    assert_eq!(
        owner["folders"],
        json!([{ "path": folder, "files": [{"path": "a.md", "digest": DIGEST_ABC}] }])
    );
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled {
            removed: paths(&[&s.first, &folder]),
            ..Uninstalled::default()
        })
    );
    assert!(listing(&s.skills).is_empty());
}

// What is at a listed folder's path

/// What can sit at a listed folder's path, each made at `path`, with the outside directory a link
/// points at.
/// A case's name and what it puts at a path, given the outside directory a link points at.
type Occupant = (&'static str, fn(&Path, &Path));

fn occupants() -> Vec<Occupant> {
    vec![
        ("an unrecorded folder", |path, _| {
            fs::create_dir(path).unwrap();
            fs::write(path.join("mine.md"), "mine").unwrap();
        }),
        ("a regular file", |path, _| fs::write(path, "mine").unwrap()),
        ("a symbolic link to a directory", |path, target| {
            symlink(target, path).unwrap();
        }),
    ]
}

#[test]
fn an_install_over_an_occupant_refuses_and_writes_nothing_files_and_folders_alike() {
    for (name, occupy) in occupants() {
        let s = sandbox();
        let target = outside(&s);
        occupy(&s.directory, &target);
        let before = listing(&s.root);
        let outcome = installed_folders(
            &s,
            vec![folder_of(&s.directory, &[("SKILL.md", "test")])],
            vec![InstalledFile::new(s.skills.join("file.md"), "abc")],
            false,
        );
        assert_eq!(
            outcome,
            refused(&[(&s.directory, RefusalReason::Unrecorded)]),
            "{name}"
        );
        assert_eq!(listing(&s.root), before, "{name}");
        assert_eq!(text(&target.join("keep.txt")), "keep", "{name}");
    }
}

#[test]
fn the_force_mode_replaces_an_occupant_records_the_folder_and_reports_the_takeover() {
    for (name, occupy) in occupants() {
        let s = sandbox();
        let target = outside(&s);
        occupy(&s.directory, &target);
        let outcome = installed_folders(
            &s,
            vec![folder_of(&s.directory, &[("SKILL.md", "test")])],
            vec![],
            true,
        );
        assert_eq!(
            outcome,
            InstallOutcome::Installed(Installed {
                written: paths(&[&s.directory]),
                replaced: Some(paths(&[&s.directory])),
                ..Installed::default()
            }),
            "{name}"
        );
        assert_eq!(listing(&s.directory), ["SKILL.md"], "{name}");
        assert!(
            fs::symlink_metadata(&s.directory).unwrap().is_dir(),
            "{name}"
        );
        assert_eq!(listing(&target), ["keep.txt"], "{name}");
        assert_eq!(text(&target.join("keep.txt")), "keep", "{name}");
        assert_eq!(
            text(&s.owner),
            committed_folders(&[], &[(&s.directory, &[("SKILL.md", DIGEST_TEST)])]),
            "{name}"
        );
        assert_eq!(names(&s.skills), ["notes"], "{name}");
    }
}

#[test]
fn the_force_mode_reports_nothing_replaced_for_an_absent_or_a_recorded_folder() {
    let s = sandbox();
    assert_eq!(
        installed_folders(
            &s,
            vec![folder_of(&s.directory, &[("a.md", "abc")])],
            vec![],
            true
        ),
        wrote(&[&s.directory])
    );
    assert_eq!(
        installed_of(installed_folders(
            &s,
            vec![folder_of(&s.directory, &[("a.md", "abc")])],
            vec![],
            true
        ))
        .replaced,
        None
    );
}

#[test]
fn a_symbolic_link_inside_a_recorded_folder_is_never_followed_when_the_folder_is_replaced_or_removed()
 {
    let s = sandbox();
    let target = outside(&s);
    installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("SKILL.md", "test")])],
        vec![],
        false,
    );
    symlink(&target, s.directory.join("link")).unwrap();
    installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("SKILL.md", "new")])],
        vec![],
        false,
    );
    assert_eq!(listing(&s.directory), ["SKILL.md"]);
    assert_eq!(listing(&target), ["keep.txt"]);
    symlink(&target, s.directory.join("link")).unwrap();
    symlink(target.join("keep.txt"), s.directory.join("file-link")).unwrap();
    assert_eq!(
        uninstalled_of(uninstalled(&s)).removed,
        paths(&[&s.directory])
    );
    assert!(listing(&s.skills).is_empty());
    assert_eq!(listing(&target), ["keep.txt"]);
    assert_eq!(text(&target.join("keep.txt")), "keep");
}

#[test]
fn a_recorded_folder_replaced_by_a_link_or_a_file_is_replaced_without_following_the_link() {
    let s = sandbox();
    let target = outside(&s);
    installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("SKILL.md", "test")])],
        vec![],
        false,
    );
    fs::remove_dir_all(&s.directory).unwrap();
    symlink(&target, &s.directory).unwrap();
    installed_of(installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("SKILL.md", "new")])],
        vec![],
        false,
    ));
    assert_eq!(listing(&s.directory), ["SKILL.md"]);
    assert_eq!(listing(&target), ["keep.txt"]);
    fs::remove_dir_all(&s.directory).unwrap();
    symlink(&target, &s.directory).unwrap();
    assert_eq!(
        uninstalled_of(uninstalled(&s)).removed,
        paths(&[&s.directory])
    );
    assert!(fs::symlink_metadata(&s.directory).is_err());
    assert_eq!(listing(&target), ["keep.txt"]);
}

// Uninstalling folders

#[test]
fn an_uninstall_removes_recorded_folders_whole_passes_over_a_gone_folder_and_removes_empty_created_parents()
 {
    let s = sandbox();
    let parent = s.skills.join("deep");
    let first = parent.join("one");
    let second = parent.join("two");
    installed_folders(
        &s,
        vec![
            folder_of(&first, &[("a.md", "abc")]),
            folder_of(&second, &[("b.md", "abc")]),
        ],
        vec![],
        false,
    );
    fs::write(first.join("edited.md"), "mine").unwrap();
    fs::remove_dir_all(&second).unwrap();
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled {
            removed: paths(&[&first]),
            ..Uninstalled::default()
        })
    );
    assert!(listing(&s.skills).is_empty());
    assert!(!s.owner.exists());
}

#[test]
fn an_uninstall_keeps_a_created_parent_that_holds_something_else() {
    let s = sandbox();
    let parent = s.skills.join("deep");
    let folder = parent.join("one");
    installed_folders(
        &s,
        vec![folder_of(&folder, &[("a.md", "abc")])],
        vec![],
        false,
    );
    fs::write(parent.join("mine.md"), "mine").unwrap();
    uninstalled(&s);
    assert_eq!(listing(&s.skills), ["deep/", "deep/mine.md"]);
}

// Recovery of folders

#[test]
fn a_process_killed_between_moving_the_old_folder_aside_and_renaming_the_new_one_leaves_a_pending_file_the_next_install_recovers()
 {
    let s = sandbox();
    let other = s.skills.join("other");
    installed_folders(
        &s,
        vec![
            folder_of(&s.directory, &[("SKILL.md", "test")]),
            folder_of(&other, &[("a.md", "abc")]),
        ],
        vec![],
        false,
    );
    let run = in_process(&json!({
        "files": [],
        "folders": [
            { "files": [{ "content": "new", "path": "SKILL.md" }, { "content": "abc", "path": "extra.md" }], "path": s.directory },
            { "files": [{ "content": "abc", "path": "a.md" }], "path": other },
        ],
        "killAfterMoveAside": s.directory,
        "record": s.record,
    }));
    assert!(killed(&run));
    let owner = owner_json(&s);
    assert_eq!(owner["state"], "pending");
    assert_eq!(
        owner["folders"],
        json!([
            { "path": s.directory, "prior": [{ "path": "SKILL.md", "digest": DIGEST_TEST }],
              "intended": [{ "path": "SKILL.md", "digest": DIGEST_NEW }, { "path": "extra.md", "digest": DIGEST_ABC }] },
            { "path": other, "prior": [{ "path": "a.md", "digest": DIGEST_ABC }],
              "intended": [{ "path": "a.md", "digest": DIGEST_ABC }] }
        ])
    );
    assert!(!s.directory.exists());
    let leftovers = names(&s.skills)
        .into_iter()
        .filter(|name| name.ends_with(".loom-retired") || name.ends_with(".loom-staging"))
        .count();
    assert!(leftovers > 0);
    let alien = s.skills.join(".other-name.0123456789abcdef.loom-retired");
    let lookalike = s.skills.join(".notes.not-sixteen-hex.loom-staging");
    let longer = s.skills.join(".notes2.0123456789abcdef.loom-staging");
    for path in [&alien, &lookalike, &longer] {
        fs::create_dir(path).unwrap();
    }
    let outcome = installed_folders(
        &s,
        vec![
            folder_of(&s.directory, &[("SKILL.md", "new"), ("extra.md", "abc")]),
            folder_of(&other, &[("a.md", "abc")]),
        ],
        vec![],
        false,
    );
    assert_eq!(outcome, wrote(&[&s.directory, &other]));
    assert_eq!(listing(&s.directory), ["SKILL.md", "extra.md"]);
    assert_eq!(
        names(&s.skills),
        [
            ".notes.not-sixteen-hex.loom-staging",
            ".notes2.0123456789abcdef.loom-staging",
            ".other-name.0123456789abcdef.loom-retired",
            "notes",
            "other",
        ]
    );
    assert_eq!(
        text(&s.owner),
        committed_folders(
            &[],
            &[
                (
                    &s.directory,
                    &[("SKILL.md", DIGEST_NEW), ("extra.md", DIGEST_ABC)]
                ),
                (&other, &[("a.md", DIGEST_ABC)])
            ]
        )
    );
}

#[test]
fn a_pending_file_keeps_a_folder_recorded_whether_or_not_it_is_there_and_an_uninstall_passes_over_a_gone_one()
 {
    let s = sandbox();
    fs::create_dir_all(&s.record).unwrap();
    let retired = s.skills.join(".notes.0123456789abcdef.loom-retired");
    fs::create_dir(&retired).unwrap();
    fs::write(retired.join("old.md"), "old").unwrap();
    fs::write(
        &s.owner,
        format!(
            "{}\n",
            json!({ "format": 1, "state": "pending", "directories": [], "files": [], "folders": [{ "path": s.directory }] })
        ),
    )
    .unwrap();
    assert_eq!(
        read(&s),
        recorded_read(vec![], vec![folder_entry(&s.directory)], vec![])
    );
    assert!(retired.exists());
    assert_eq!(
        uninstalled(&s),
        UninstallOutcome::Uninstalled(Uninstalled::default())
    );
    assert!(!retired.exists());
    assert!(!s.owner.exists());
}

#[test]
fn a_recorded_folder_that_is_gone_is_written_again_by_the_next_install() {
    let s = sandbox();
    installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("a.md", "abc")])],
        vec![],
        false,
    );
    fs::remove_dir_all(&s.directory).unwrap();
    installed_of(installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("a.md", "abc")])],
        vec![],
        false,
    ));
    assert_eq!(listing(&s.directory), ["a.md"]);
}

// Reading folders

#[test]
fn reading_a_plugin_file_returns_its_recorded_folders_and_none_when_it_records_none() {
    let s = sandbox();
    installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("a.md", "abc")])],
        vec![],
        false,
    );
    assert_eq!(
        read(&s),
        recorded_read(
            vec![],
            vec![RecordedFolder {
                files: Some(vec![FolderDigest {
                    path: "a.md".to_owned(),
                    digest: DIGEST_ABC.to_owned(),
                    generated: false,
                }]),
                ..folder_entry(&s.directory)
            }],
            vec![]
        )
    );
    installed_folders(&s, vec![], vec![], false);
    assert_eq!(read(&s), recorded_read(vec![], vec![], vec![]));
}

#[test]
fn a_plugin_file_with_a_folders_member_that_is_not_a_list_of_absolute_paths_is_damaged() {
    let s = sandbox();
    fs::create_dir(&s.record).unwrap();
    for folders in [
        json!("x"),
        json!([{ "path": "relative" }]),
        json!([{ "path": "/a", "digest": "x" }, 1]),
    ] {
        fs::write(
            &s.owner,
            format!(
                "{}\n",
                json!({ "format": 1, "state": "committed", "directories": [], "files": [], "folders": folders })
            ),
        )
        .unwrap();
        assert_eq!(
            read(&s),
            RecordedRead::Refused(Refusal {
                path: s.owner.clone(),
                file: None,
                reason: RefusalReason::Damaged
            })
        );
    }
}

#[test]
fn the_folder_refusals_read_without_writing_match_the_ones_an_install_meets() {
    let s = sandbox();
    installed_folders(
        &s,
        vec![folder_of(&s.directory, &[("a.md", "abc")])],
        vec![],
        false,
    );
    let link = s.skills.join("link");
    symlink(&s.directory, &link).unwrap();
    let file = s.skills.join("file");
    fs::write(&file, "x").unwrap();
    let directory = s.skills.join("dir");
    fs::create_dir(&directory).unwrap();
    let absent = s.skills.join("absent");
    let listed: Vec<&Path> = vec![&s.directory, &absent, &link, &file, &directory];
    assert_eq!(
        folder_refusals(&listed, &[folder_entry(&s.directory)]).unwrap(),
        [&link, &file, &directory].map(|path| Refusal {
            path: path.clone(),
            file: None,
            reason: RefusalReason::Unrecorded
        })
    );
}

// The exact-contents check

fn exact_files() -> Vec<FolderFile> {
    vec![
        FolderFile::new("SKILL.md", "test"),
        FolderFile::new("agents/run.sh", "abc").mode(0o755),
    ]
}

// The folder write without a record

#[test]
fn writing_a_folder_without_a_record_replaces_what_is_there_and_removes_the_leftovers_of_its_own_name_only()
 {
    let s = sandbox();
    let target = outside(&s);
    symlink(&target, &s.directory).unwrap();
    let own = [
        s.skills.join(".notes.0123456789abcdef.loom-staging"),
        s.skills.join(".notes.fedcba9876543210.loom-retired"),
    ];
    let others = [
        s.skills.join(".other.0123456789abcdef.loom-staging"),
        s.skills.join(".notes.0123456789ABCDEF.loom-retired"),
    ];
    for path in own.iter().chain(&others) {
        fs::create_dir(path).unwrap();
        symlink(&target, path.join("link")).unwrap();
    }
    write_folder(&s.directory, &exact_files()).unwrap();
    assert_eq!(text(&s.directory.join("SKILL.md")), "test");
    assert_eq!(text(&s.directory.join("agents/run.sh")), "abc");
    assert!(!own[0].exists());
    assert!(!own[1].exists());
    assert!(others.iter().all(|path| path.exists()));
    assert_eq!(listing(&target), ["keep.txt"]);
    assert!(!s.record.exists());
}

#[test]
fn writing_a_folder_that_fails_leaves_the_old_folder_and_no_staging_folder() {
    let s = sandbox();
    write_folder(&s.directory, &[FolderFile::new("a.md", "test")]).unwrap();
    let error = write_folder(
        &s.directory,
        &[
            FolderFile::new("a.md/b.md", "x"),
            FolderFile::new("a.md", "y"),
        ],
    )
    .unwrap_err();
    assert!(matches!(error, InstallationError::Io(_)), "{error:?}");
    assert_eq!(listing(&s.skills), ["notes/", "notes/a.md"]);
}

#[test]
fn filling_a_staging_folder_that_is_gone_fails_and_does_not_make_it_again() {
    for path in ["a.md", "sub/deep/a.md"] {
        let s = sandbox();
        let staging = s.skills.join(".notes.0123456789abcdef.loom-staging");
        let error = fill_folder(&staging, &[FolderFile::new(path, "abc")]).unwrap_err();
        assert!(
            matches!(&error, InstallationError::Io(error) if error.kind() == std::io::ErrorKind::NotFound),
            "{path}: {error:?}"
        );
        assert!(!staging.exists(), "{path}");
    }
}

#[test]
fn filling_a_staging_folder_that_goes_away_between_two_files_fails_on_the_second_and_does_not_make_it_again()
 {
    let s = sandbox();
    let staging = s.skills.join(".notes.0123456789abcdef.loom-staging");
    fs::create_dir(&staging).unwrap();
    // The second file's create comes after another run's recovery removed the folder.
    REMOVE_BEFORE_CREATE
        .lock()
        .unwrap()
        .push((staging.join("sub/b.md"), staging.clone()));
    set_probe(probe);
    let files = [
        FolderFile::new("sub/a.md", "abc"),
        FolderFile::new("sub/b.md", "abc"),
        FolderFile::new("sub/c.md", "abc"),
    ];
    let error = fill_folder(&staging, &files).unwrap_err();
    assert!(
        matches!(&error, InstallationError::Io(error) if error.kind() == std::io::ErrorKind::NotFound),
        "{error:?}"
    );
    assert!(!staging.exists());
}

// Startup lines

/// One install by the skill plugin of the startup lines and the rest of `request`.
fn installed_lines(
    s: &Sandbox,
    lines: Vec<InstalledLine>,
    request: InstallRequest,
) -> InstallOutcome {
    record(s).install(&request.lines(lines), &Running).unwrap()
}

fn line_of(path: &Path, line: &str) -> InstalledLine {
    InstalledLine::new(path, line)
}

/// One uninstall by the skill plugin, releasing the named startup files' lines.
fn uninstalled_lines(s: &Sandbox, release: &[PathBuf]) -> UninstallOutcome {
    record(s).uninstall(release, &Running).unwrap()
}

/// The startup lines of an install's outcome.
fn lines_of(outcome: InstallOutcome) -> StartupLinesOutcome {
    installed_of(outcome).lines.unwrap()
}

/// Records `line` for `.zshrc` through an install that adds it, then leaves the file holding
/// `content`, because an install records no line it finds already there.
fn recorded_in(h: &HomeBox, content: &[u8], line: &str) {
    let _ = fs::remove_file(&h.rc);
    installed_lines(h, vec![line_of(&h.rc, line)], InstallRequest::new());
    fs::write(&h.rc, content).unwrap();
}

#[test]
fn installing_a_line_into_a_file_that_holds_it_adds_nothing_and_records_it_only_when_the_record_already_held_it()
 {
    let h = home_box();
    let content = format!("export A=1\n{LOADER}\nexport B=2\n");
    fs::write(&h.rc, &content).unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, LOADER)],
            InstallRequest::new()
        )),
        StartupLinesOutcome {
            held: vec![line_entry(&h.rc, LOADER)],
            ..StartupLinesOutcome::default()
        }
    );
    assert_eq!(text(&h.rc), content);
    assert_eq!(
        text(&h.owner),
        "{\"format\":1,\"state\":\"committed\",\"directories\":[],\"files\":[]}\n"
    );
    fs::write(&h.rc, "export A=1\n").unwrap();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, LOADER)],
            InstallRequest::new()
        )),
        StartupLinesOutcome {
            held: vec![line_entry(&h.rc, LOADER)],
            ..StartupLinesOutcome::default()
        }
    );
    assert_eq!(text(&h.owner), committed_lines(&[], &[(&h.rc, LOADER)]));
}

#[test]
fn installing_a_line_appends_it_with_the_files_own_line_ending() {
    let cases = [
        (
            "a file that ends with a line feed",
            "export A=1\n".to_owned(),
            format!("export A=1\n{LOADER}\n"),
        ),
        (
            "a file that does not end with a line break",
            "export A=1".to_owned(),
            format!("export A=1\n{LOADER}\n"),
        ),
        ("an empty file", String::new(), format!("{LOADER}\n")),
        (
            "a file with CRLF endings",
            "a\r\nb\r\n".to_owned(),
            format!("a\r\nb\r\n{LOADER}\r\n"),
        ),
        (
            "a CRLF file that does not end with a line break",
            "a\r\nb".to_owned(),
            format!("a\r\nb\r\n{LOADER}\r\n"),
        ),
        (
            "a file whose first line break is a line feed",
            "a\nb\r\n".to_owned(),
            format!("a\nb\r\n{LOADER}\n"),
        ),
    ];
    for (name, content, appended) in cases {
        let h = home_box();
        fs::write(&h.rc, &content).unwrap();
        assert_eq!(
            lines_of(installed_lines(
                &h,
                vec![line_of(&h.rc, LOADER)],
                InstallRequest::new()
            )),
            StartupLinesOutcome {
                added: vec![line_entry(&h.rc, LOADER)],
                ..StartupLinesOutcome::default()
            },
            "{name}"
        );
        assert_eq!(text(&h.rc), appended, "{name}");
    }
}

#[test]
fn installing_a_line_into_a_utf8_file_with_a_byte_order_mark_appends_it_with_no_second_mark() {
    let h = home_box();
    fs::write(&h.rc, utf8_with_mark("export A=1\n")).unwrap();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    assert_eq!(
        fs::read(&h.rc).unwrap(),
        utf8_with_mark(&format!("export A=1\n{LOADER}\n"))
    );
}

#[test]
fn a_utf8_file_with_a_byte_order_mark_right_before_the_line_holds_it() {
    let h = home_box();
    fs::write(&h.rc, utf8_with_mark(&format!("{LOADER}\n"))).unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, LOADER)],
            InstallRequest::new()
        ))
        .held,
        [line_entry(&h.rc, LOADER)]
    );
    assert_eq!(
        fs::read(&h.rc).unwrap(),
        utf8_with_mark(&format!("{LOADER}\n"))
    );
}

#[test]
fn a_last_line_that_differs_by_a_carriage_return_with_no_line_feed_after_it_does_not_hold_the_line()
{
    let h = home_box();
    fs::write(&h.rc, format!("{LOADER}\r")).unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, LOADER)],
            InstallRequest::new()
        ))
        .added,
        [line_entry(&h.rc, LOADER)]
    );
}

#[test]
fn installing_a_line_into_a_link_appends_to_the_one_file_both_name_keeping_its_inode_owner_and_mode()
 {
    type Linking = (&'static str, fn(&HomeBox, &Path), fn(&HomeBox) -> bool);
    let arrangements: Vec<Linking> = vec![
        (
            "a symbolic link",
            |h, real| symlink(real, &h.rc).unwrap(),
            |h| {
                fs::symlink_metadata(&h.rc)
                    .unwrap()
                    .file_type()
                    .is_symlink()
            },
        ),
        (
            "a second hard link",
            |h, real| fs::hard_link(real, &h.rc).unwrap(),
            |h| fs::symlink_metadata(&h.rc).unwrap().nlink() == 2,
        ),
    ];
    for (name, arrange, still_linked) in arrangements {
        let h = home_box();
        let real = h.root.join("dotfiles-zshrc");
        fs::write(&real, "export A=1\n").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).unwrap();
        let before = fs::metadata(&real).unwrap();
        arrange(&h, &real);
        installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
        let grown = fs::metadata(&real).unwrap();
        assert_eq!(text(&real), format!("export A=1\n{LOADER}\n"), "{name}");
        assert_eq!(text(&h.rc), format!("export A=1\n{LOADER}\n"), "{name}");
        assert_eq!(
            (grown.ino(), grown.uid(), grown.mode() & 0o7777),
            (before.ino(), before.uid(), 0o640),
            "{name}"
        );
        assert!(still_linked(&h), "{name}");
    }
}

#[test]
fn a_startup_file_that_is_not_a_regular_file_refuses_the_install_and_writes_nothing() {
    type Occupying = (&'static str, RefusalReason, fn(&HomeBox));
    let arrangements: Vec<Occupying> = vec![
        ("a link to a missing file", RefusalReason::Link, |h| {
            symlink(h.root.join("missing"), &h.rc).unwrap();
        }),
        ("a directory", RefusalReason::Directory, |h| {
            fs::create_dir(&h.rc).unwrap();
        }),
        ("a link to a directory", RefusalReason::Directory, |h| {
            symlink(&h.skills, &h.rc).unwrap();
        }),
        ("a link to a device", RefusalReason::Special, |h| {
            symlink("/dev/null", &h.rc).unwrap();
        }),
    ];
    for (name, reason, arrange) in arrangements {
        let h = home_box();
        arrange(&h);
        assert_eq!(
            installed_lines(
                &h,
                vec![line_of(&h.rc, LOADER)],
                InstallRequest::new().files([InstalledFile::new(&h.first, "test")])
            ),
            refused(&[(&h.rc, reason)]),
            "{name}"
        );
        assert!(!h.record.exists(), "{name}");
        assert!(!h.directory.exists(), "{name}");
        assert!(!h.root.join("missing").exists(), "{name}");
    }
}

#[test]
fn a_listed_startup_file_in_another_encoding_fails_and_writes_nothing() {
    let cases: [(&str, &[u8]); 4] = [
        ("a UTF-16LE byte order mark", &[0xff, 0xfe, 0x61, 0x00]),
        ("a UTF-16BE byte order mark", &[0xfe, 0xff, 0x00, 0x61]),
        (
            "a UTF-32LE byte order mark",
            &[0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00],
        ),
        ("bytes that are not UTF-8", &[0x61, 0xc3, 0x28, 0x0a]),
    ];
    for (name, bytes) in cases {
        let h = home_box();
        fs::write(&h.rc, bytes).unwrap();
        let error = record(&h)
            .install(
                &InstallRequest::new().lines([line_of(&h.rc, LOADER)]),
                &Running,
            )
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            format!(
                "Startup file \"{}\" is not in an encoding the module reads.",
                h.rc.display()
            ),
            "{name}"
        );
        assert!(!h.record.exists(), "{name}");
        assert_eq!(fs::read(&h.rc).unwrap(), bytes, "{name}");
    }
}

// Replacing and removing startup lines

#[test]
fn an_install_listing_new_text_replaces_the_recorded_line_where_it_stands_through_a_link_keeping_its_mode_and_encoding()
 {
    let h = home_box();
    let real = h.root.join("dotfiles-zshrc");
    fs::write(&real, "a\r\n").unwrap();
    fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).unwrap();
    symlink(&real, &h.rc).unwrap();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    fs::write(
        &real,
        format!("a\r\n{LOADER}\r\nb\r\n{LOADER}\r\n{LOADER} # mine\r\nc"),
    )
    .unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, NEWER)],
            InstallRequest::new()
        )),
        StartupLinesOutcome {
            replaced: vec![line_entry(&h.rc, NEWER)],
            ..StartupLinesOutcome::default()
        }
    );
    assert_eq!(
        text(&real),
        format!("a\r\n{NEWER}\r\nb\r\n{NEWER}\r\n{LOADER} # mine\r\nc")
    );
    assert!(
        fs::symlink_metadata(&h.rc)
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(fs::metadata(&real).unwrap().mode() & 0o7777, 0o640);
    assert!(
        names(&h.root)
            .iter()
            .all(|name| !name.ends_with(".loom-staging"))
    );
    assert_eq!(text(&h.owner), committed_lines(&[], &[(&h.rc, NEWER)]));
}

#[test]
fn an_install_listing_new_text_replaces_the_recorded_line_even_where_the_file_already_holds_the_new_one()
 {
    let h = home_box();
    recorded_in(&h, format!("{LOADER}\n").as_bytes(), LOADER);
    fs::write(&h.rc, format!("{LOADER}\n{NEWER}\n")).unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, NEWER)],
            InstallRequest::new()
        ))
        .replaced,
        [line_entry(&h.rc, NEWER)]
    );
    assert_eq!(text(&h.rc), format!("{NEWER}\n{NEWER}\n"));
}

#[test]
fn replacing_a_line_in_a_utf8_file_with_a_byte_order_mark_keeps_the_mark() {
    let h = home_box();
    recorded_in(
        &h,
        &utf8_with_mark(&format!("export A=1\r\n{LOADER}\r\n")),
        LOADER,
    );
    installed_lines(&h, vec![line_of(&h.rc, NEWER)], InstallRequest::new());
    assert_eq!(
        fs::read(&h.rc).unwrap(),
        utf8_with_mark(&format!("export A=1\r\n{NEWER}\r\n"))
    );
}

#[test]
fn an_install_with_new_text_where_the_file_holds_neither_line_adds_the_new_one_and_an_update_adds_none()
 {
    let h = home_box();
    fs::write(&h.rc, "a\n").unwrap();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    fs::write(&h.rc, "a\n").unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, NEWER)],
            InstallRequest::new().update(true)
        )),
        StartupLinesOutcome {
            no_longer_held: vec![line_entry(&h.rc, LOADER)],
            ..StartupLinesOutcome::default()
        }
    );
    assert_eq!(text(&h.rc), "a\n");
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    fs::write(&h.rc, "a\n").unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, NEWER)],
            InstallRequest::new()
        )),
        StartupLinesOutcome {
            added: vec![line_entry(&h.rc, NEWER)],
            ..StartupLinesOutcome::default()
        }
    );
    assert_eq!(text(&h.rc), format!("a\n{NEWER}\n"));
}

#[test]
fn a_recorded_line_the_file_no_longer_holds_is_added_again_by_an_install_and_an_update_adds_none_and_drops_it()
 {
    let h = home_box();
    fs::write(&h.rc, "a\n").unwrap();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    fs::write(&h.rc, "a\n").unwrap();
    assert_eq!(
        installed_lines(
            &h,
            vec![line_of(&h.rc, LOADER)],
            InstallRequest::new().update(true)
        ),
        InstallOutcome::Installed(Installed {
            lines: Some(StartupLinesOutcome {
                no_longer_held: vec![line_entry(&h.rc, LOADER)],
                ..StartupLinesOutcome::default()
            }),
            ..Installed::default()
        })
    );
    assert_eq!(text(&h.rc), "a\n");
    assert_eq!(
        text(&h.owner),
        "{\"format\":1,\"state\":\"committed\",\"directories\":[],\"files\":[]}\n"
    );
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    fs::write(&h.rc, "a\n").unwrap();
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, LOADER)],
            InstallRequest::new()
        ))
        .added,
        [line_entry(&h.rc, LOADER)]
    );
    assert_eq!(text(&h.rc), format!("a\n{LOADER}\n"));
}

#[test]
fn an_update_replaces_a_recorded_line_whose_text_changed_where_the_file_still_holds_it() {
    let h = home_box();
    recorded_in(&h, format!("a\n{LOADER}\nb\n").as_bytes(), LOADER);
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&h.rc, NEWER)],
            InstallRequest::new().update(true)
        ))
        .replaced,
        [line_entry(&h.rc, NEWER)]
    );
    assert_eq!(text(&h.rc), format!("a\n{NEWER}\nb\n"));
}

#[test]
fn an_install_that_no_longer_lists_a_recorded_line_removes_it_and_moves_it_to_the_startup_file_it_lists()
 {
    let h = home_box();
    let profile = h.home.join(".bash_profile");
    recorded_in(&h, format!("a\n{LOADER}\nb\n").as_bytes(), LOADER);
    assert_eq!(
        lines_of(installed_lines(
            &h,
            vec![line_of(&profile, LOADER)],
            InstallRequest::new()
        )),
        StartupLinesOutcome {
            added: vec![line_entry(&profile, LOADER)],
            removed: vec![line_entry(&h.rc, LOADER)],
            ..StartupLinesOutcome::default()
        }
    );
    assert_eq!(text(&h.rc), "a\nb\n");
    assert_eq!(text(&profile), format!("{LOADER}\n"));
    assert_eq!(text(&h.owner), committed_lines(&[], &[(&profile, LOADER)]));
}

#[test]
fn uninstall_removes_every_line_equal_to_the_recorded_text_and_keeps_every_other_byte_and_the_file()
{
    let h = home_box();
    fs::write(&h.rc, "# top\r\n").unwrap();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    fs::write(
        &h.rc,
        format!(
            "# top\r\n{LOADER}\r\nmiddle\r\n\r\n{LOADER}\r\n {LOADER}\r\n{LOADER} # mine\r\n{LOADER}"
        ),
    )
    .unwrap();
    assert_eq!(
        uninstalled_lines(&h, &[]),
        UninstallOutcome::Uninstalled(Uninstalled {
            lines: Some(UninstalledLines {
                removed: vec![line_entry(&h.rc, LOADER)],
                ..UninstalledLines::default()
            }),
            ..Uninstalled::default()
        })
    );
    assert_eq!(
        text(&h.rc),
        format!("# top\r\nmiddle\r\n\r\n {LOADER}\r\n{LOADER} # mine\r\n")
    );
    assert!(!h.owner.exists());
}

#[test]
fn uninstall_reports_a_startup_file_that_no_longer_holds_the_line_never_removes_a_file_it_created_and_keeps_its_parent()
 {
    let h = home_box();
    let rc = h.home.join("zdot/.zshrc");
    installed_lines(&h, vec![line_of(&rc, LOADER)], InstallRequest::new());
    fs::write(&rc, "mine\n").unwrap();
    assert_eq!(
        uninstalled_lines(&h, &[]),
        UninstallOutcome::Uninstalled(Uninstalled {
            lines: Some(UninstalledLines {
                no_longer_held: vec![line_entry(&rc, LOADER)],
                ..UninstalledLines::default()
            }),
            ..Uninstalled::default()
        })
    );
    assert_eq!(text(&rc), "mine\n");
    installed_lines(&h, vec![line_of(&rc, LOADER)], InstallRequest::new());
    uninstalled_lines(&h, &[]);
    assert_eq!(text(&rc), "mine\n");
}

#[test]
fn an_uninstall_of_a_startup_file_that_is_gone_reports_the_line_no_longer_held() {
    let h = home_box();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    fs::remove_file(&h.rc).unwrap();
    assert_eq!(
        uninstalled_of(uninstalled_lines(&h, &[])).lines,
        Some(UninstalledLines {
            no_longer_held: vec![line_entry(&h.rc, LOADER)],
            ..UninstalledLines::default()
        })
    );
    assert!(!h.rc.exists());
}

/// Whether this process runs as root, which reads any file whatever its mode.
fn is_root() -> bool {
    Command::new("id")
        .arg("-u")
        .output()
        .is_ok_and(|output| output.stdout.trim_ascii() == b"0")
}

#[test]
fn a_released_line_is_dropped_from_the_plugin_file_and_its_startup_file_is_neither_read_nor_written_by_an_install_or_an_uninstall()
 {
    if is_root() {
        return;
    }
    let h = home_box();
    let content = format!("a\n{LOADER}\n");
    recorded_in(&h, content.as_bytes(), LOADER);
    let mtime = |path: &Path| fs::metadata(path).unwrap().modified().unwrap();
    // A file no one may read fails any read, so an outcome proves the module read none.
    fs::set_permissions(&h.rc, fs::Permissions::from_mode(0o000)).unwrap();
    let before = mtime(&h.rc);
    assert_eq!(
        installed_lines(&h, vec![], InstallRequest::new().release([&h.rc])),
        InstallOutcome::Installed(Installed {
            lines: Some(StartupLinesOutcome {
                released: vec![line_entry(&h.rc, LOADER)],
                ..StartupLinesOutcome::default()
            }),
            ..Installed::default()
        })
    );
    assert_eq!(
        text(&h.owner),
        "{\"format\":1,\"state\":\"committed\",\"directories\":[],\"files\":[]}\n"
    );
    assert_eq!(mtime(&h.rc), before);
    fs::set_permissions(&h.rc, fs::Permissions::from_mode(0o644)).unwrap();
    recorded_in(&h, content.as_bytes(), LOADER);
    fs::set_permissions(&h.rc, fs::Permissions::from_mode(0o000)).unwrap();
    let recorded = mtime(&h.rc);
    assert_eq!(
        uninstalled_lines(&h, std::slice::from_ref(&h.rc)),
        UninstallOutcome::Uninstalled(Uninstalled {
            lines: Some(UninstalledLines {
                released: vec![line_entry(&h.rc, LOADER)],
                ..UninstalledLines::default()
            }),
            ..Uninstalled::default()
        })
    );
    assert_eq!(mtime(&h.rc), recorded);
    fs::set_permissions(&h.rc, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(text(&h.rc), content);
    assert!(!h.owner.exists());
}

#[test]
fn an_uninstall_of_a_recorded_startup_file_in_an_encoding_the_module_does_not_read_fails_and_changes_nothing()
 {
    let h = home_box();
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    let before = text(&h.owner);
    fs::write(&h.rc, [0xfe, 0xff, 0x00, 0x61]).unwrap();
    let error = record(&h).uninstall(&[], &Running).unwrap_err();
    assert_eq!(
        error.to_string(),
        format!(
            "Startup file \"{}\" is not in an encoding the module reads.",
            h.rc.display()
        )
    );
    assert_eq!(text(&h.owner), before);
}

// Reading startup lines

#[test]
fn reading_a_plugin_file_returns_its_recorded_startup_lines_and_a_pending_one_what_its_files_hold()
{
    let h = home_box();
    let profile = h.home.join(".profile");
    assert_eq!(read(&h), recorded_read(vec![], vec![], vec![]));
    installed_lines(&h, vec![line_of(&h.rc, LOADER)], InstallRequest::new());
    assert_eq!(
        read(&h),
        recorded_read(vec![], vec![], vec![line_entry(&h.rc, LOADER)])
    );
    fs::write(&h.rc, format!("{NEWER}\n")).unwrap();
    fs::write(&profile, format!("{LOADER}\n")).unwrap();
    fs::create_dir_all(&h.record).unwrap();
    fs::write(
        &h.owner,
        format!(
            "{}\n",
            json!({
                "format": 1,
                "state": "pending",
                "directories": [],
                "files": [],
                "lines": [
                    { "path": h.rc, "prior": LOADER, "intended": NEWER },
                    { "path": profile, "prior": LOADER, "intended": null },
                    { "path": h.home.join(".bashrc"), "prior": null, "intended": LOADER },
                ],
            })
        ),
    )
    .unwrap();
    let before = text(&h.owner);
    assert_eq!(
        read(&h),
        recorded_read(
            vec![],
            vec![],
            vec![line_entry(&h.rc, NEWER), line_entry(&profile, LOADER)]
        )
    );
    assert_eq!(text(&h.owner), before);
}

#[test]
fn a_plugin_file_whose_startup_line_is_malformed_is_damaged() {
    for (name, entry) in [
        (
            "a line with a line break",
            json!({ "path": "/home/me/.zshrc", "line": "a\nb" }),
        ),
        (
            "an empty line",
            json!({ "path": "/home/me/.zshrc", "line": "" }),
        ),
        ("a relative path", json!({ "path": ".zshrc", "line": "a" })),
        ("no text", json!({ "path": "/home/me/.zshrc" })),
    ] {
        let h = home_box();
        fs::create_dir(&h.record).unwrap();
        fs::write(
            &h.owner,
            format!(
                "{}\n",
                json!({ "format": 1, "state": "committed", "directories": [], "files": [], "lines": [entry] })
            ),
        )
        .unwrap();
        let refusal = Refusal {
            path: h.owner.clone(),
            file: None,
            reason: RefusalReason::Damaged,
        };
        assert_eq!(read(&h), RecordedRead::Refused(refusal.clone()), "{name}");
        assert_eq!(
            installed_lines(&h, vec![], InstallRequest::new()),
            InstallOutcome::Refused(vec![refusal]),
            "{name}"
        );
    }
}

#[test]
fn reading_a_startup_file_tells_whether_it_is_there_a_file_in_an_encoding_the_module_reads_and_holding_the_line()
 {
    let h = home_box();
    let inspect = || inspect_startup_file(&h.rc, LOADER).unwrap();
    assert_eq!(inspect(), StartupFileState::Absent);
    symlink(h.root.join("missing"), &h.rc).unwrap();
    assert_eq!(inspect(), StartupFileState::NotFile);
    fs::remove_file(&h.rc).unwrap();
    fs::create_dir(&h.rc).unwrap();
    assert_eq!(inspect(), StartupFileState::NotFile);
    fs::remove_dir(&h.rc).unwrap();
    fs::write(&h.rc, [0xfe, 0xff, 0x00, 0x61]).unwrap();
    assert_eq!(inspect(), StartupFileState::UnknownEncoding);
    fs::write(&h.rc, format!("a\n{LOADER}\r\n")).unwrap();
    assert_eq!(
        inspect(),
        StartupFileState::Text {
            encoding: StartupEncoding::Utf8,
            holds: true
        }
    );
    fs::write(&h.rc, utf8_with_mark("a\n")).unwrap();
    assert_eq!(
        inspect(),
        StartupFileState::Text {
            encoding: StartupEncoding::Utf8Bom,
            holds: false
        }
    );
    let mut utf16 = vec![0xff, 0xfe];
    utf16.extend(LOADER.encode_utf16().flat_map(u16::to_le_bytes));
    fs::write(&h.rc, utf16).unwrap();
    assert_eq!(inspect(), StartupFileState::UnknownEncoding);
}

// Startup lines from a process that stopped

/// The lines the plugin's file records, read as recovery would.
fn recorded_lines(s: &Sandbox) -> Vec<StartupLine> {
    match read(s) {
        RecordedRead::Read { lines, .. } => lines,
        refused @ RecordedRead::Refused(_) => panic!("{refused:?}"),
    }
}

#[test]
fn a_process_killed_after_a_first_line_is_appended_and_before_the_commit_leaves_a_pending_file_whose_next_run_records_the_line()
 {
    let h = home_box();
    fs::write(&h.rc, "a\n").unwrap();
    let run = in_process(&json!({
        "files": [],
        "killAfterAppend": h.rc,
        "lines": [{ "line": LOADER, "path": h.rc }],
        "record": h.record,
    }));
    assert!(killed(&run));
    let owner = owner_json(&h);
    assert_eq!(owner["state"], "pending");
    assert_eq!(
        owner["lines"],
        json!([{ "path": h.rc, "prior": null, "intended": LOADER }])
    );
    assert_eq!(text(&h.rc), format!("a\n{LOADER}\n"));
    assert_eq!(
        uninstalled_of(uninstalled_lines(&h, &[]))
            .lines
            .unwrap()
            .removed,
        [line_entry(&h.rc, LOADER)]
    );
    assert_eq!(text(&h.rc), "a\n");
}

#[test]
fn a_process_killed_before_the_append_leaves_a_pending_file_whose_next_run_records_no_line() {
    let h = home_box();
    fs::write(&h.rc, "a\n").unwrap();
    let run = in_process(&json!({
        "files": [],
        "killBeforeAppend": h.rc,
        "lines": [{ "line": LOADER, "path": h.rc }],
        "record": h.record,
    }));
    assert!(killed(&run));
    assert_eq!(owner_json(&h)["state"], "pending");
    assert_eq!(
        uninstalled_lines(&h, &[]),
        UninstallOutcome::Uninstalled(Uninstalled::default())
    );
    assert_eq!(text(&h.rc), "a\n");
}

#[test]
fn a_process_killed_around_the_rename_that_replaces_a_line_leaves_a_pending_file_whose_next_run_records_the_line_the_file_holds()
 {
    for (trap, kept) in [("killBeforeRename", LOADER), ("killAfterRename", NEWER)] {
        let h = home_box();
        recorded_in(&h, format!("a\n{LOADER}\nb\n").as_bytes(), LOADER);
        let mut request = json!({
            "files": [],
            "lines": [{ "line": NEWER, "path": h.rc }],
            "record": h.record,
        });
        request[trap] = json!(fs::canonicalize(&h.rc).unwrap());
        let run = in_process(&request);
        assert!(killed(&run), "{trap}");
        let owner = owner_json(&h);
        assert_eq!(owner["state"], "pending", "{trap}");
        assert_eq!(
            owner["lines"],
            json!([{ "path": h.rc, "prior": LOADER, "intended": NEWER }]),
            "{trap}"
        );
        assert_eq!(recorded_lines(&h), [line_entry(&h.rc, kept)], "{trap}");
        assert_eq!(
            uninstalled_of(uninstalled_lines(&h, &[]))
                .lines
                .unwrap()
                .removed,
            [line_entry(&h.rc, kept)],
            "{trap}"
        );
        assert_eq!(text(&h.rc), "a\nb\n", "{trap}");
        assert_eq!(names(&h.home), [".zshrc"], "{trap}");
    }
}

#[test]
fn two_installs_appending_different_lines_to_one_startup_file_at_once_leave_both() {
    let h = home_box();
    fs::write(&h.rc, "# mine\n").unwrap();
    let lines: Vec<String> = (0..12).map(|index| format!("{LOADER} {index}")).collect();
    let children: Vec<std::process::Child> = lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            child_command(&json!({
                "files": [],
                "lines": [{ "line": line, "path": h.rc }],
                "plugin": format!("completion{index}"),
                "record": h.record,
            }))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap()
        })
        .collect();
    let codes: Vec<Option<i32>> = children
        .into_iter()
        .map(|child| child.wait_with_output().unwrap().status.code())
        .collect();
    assert_eq!(codes, vec![Some(0); 12]);
    let held = text(&h.rc);
    let held: Vec<&str> = held.split('\n').collect();
    assert_eq!(held[0], "# mine");
    let mut appended: Vec<&str> = held[1..held.len() - 1].to_vec();
    appended.sort_unstable();
    let mut expected: Vec<&str> = lines.iter().map(String::as_str).collect();
    expected.sort_unstable();
    assert_eq!(appended, expected);
}

#[test]
fn a_run_whose_missing_startup_file_another_run_creates_first_appends_its_line_after_the_others() {
    let h = home_box();
    let other = format!("{LOADER} other");
    let run = in_process(&json!({
        "createBeforeCreate": { "content": format!("{other}\n"), "path": h.rc },
        "files": [],
        "lines": [{ "line": LOADER, "path": h.rc }],
        "record": h.record,
    }));
    assert_eq!(run.code, Some(0));
    assert_eq!(
        run.outcomes,
        [json!({ "status": "installed", "added": [{ "line": LOADER, "path": h.rc }] })]
    );
    assert_eq!(text(&h.rc), format!("{other}\n{LOADER}\n"));
    assert_eq!(recorded_lines(&h), [line_entry(&h.rc, LOADER)]);
}

#[test]
fn a_run_whose_missing_startup_file_another_run_creates_first_with_the_same_line_leaves_the_line_there_once()
 {
    let h = home_box();
    let run = in_process(&json!({
        "createBeforeCreate": { "content": format!("{LOADER}\n"), "path": h.rc },
        "files": [],
        "lines": [{ "line": LOADER, "path": h.rc }],
        "record": h.record,
    }));
    assert_eq!(run.code, Some(0));
    assert_eq!(
        run.outcomes,
        [json!({ "status": "installed", "added": [{ "line": LOADER, "path": h.rc }] })]
    );
    assert_eq!(text(&h.rc), format!("{LOADER}\n"));
    assert_eq!(recorded_lines(&h), [line_entry(&h.rc, LOADER)]);
}

#[test]
fn a_line_another_run_appends_to_a_startup_file_this_run_has_just_created_lands_whole_beside_this_runs_own()
 {
    let h = home_box();
    let other = format!("{LOADER} other");
    let run = in_process(&json!({
        "appendAfterCreate": { "content": format!("{other}\n"), "path": h.rc },
        "files": [],
        "lines": [{ "line": LOADER, "path": h.rc }],
        "record": h.record,
    }));
    assert_eq!(run.code, Some(0));
    assert_eq!(text(&h.rc), format!("{other}\n{LOADER}\n"));
    assert_eq!(fs::metadata(&h.rc).unwrap().mode() & 0o777, 0o644);
    assert_eq!(names(&h.home), [".zshrc"]);
}

#[test]
fn a_process_killed_before_the_rename_that_removes_a_line_leaves_a_pending_file_whose_next_run_records_the_line_the_file_still_holds()
 {
    let h = home_box();
    recorded_in(&h, format!("a\n{LOADER}\n").as_bytes(), LOADER);
    let run = in_process(&json!({
        "files": [],
        "killBeforeRename": fs::canonicalize(&h.rc).unwrap(),
        "record": h.record,
    }));
    assert!(killed(&run));
    assert_eq!(text(&h.rc), format!("a\n{LOADER}\n"));
    assert_eq!(recorded_lines(&h), [line_entry(&h.rc, LOADER)]);
}

#[test]
fn a_process_killed_while_it_keeps_a_recorded_line_the_file_holds_leaves_a_pending_file_whose_next_run_records_the_line()
 {
    let h = home_box();
    recorded_in(&h, format!("a\n{LOADER}\n").as_bytes(), LOADER);
    let run = in_process(&json!({
        "files": [{ "content": "test", "path": h.first }],
        "killAfterRename": h.first,
        "lines": [{ "line": LOADER, "path": h.rc }],
        "record": h.record,
    }));
    assert!(killed(&run));
    assert_eq!(owner_json(&h)["state"], "pending");
    assert_eq!(recorded_lines(&h), [line_entry(&h.rc, LOADER)]);
}

#[test]
fn a_process_killed_before_it_creates_a_startup_file_leaves_a_pending_file_whose_next_run_records_no_line()
 {
    let h = home_box();
    let rc = h.home.join("zdot/.zshrc");
    let run = in_process(&json!({
        "files": [],
        "killBeforeMkdir": h.home.join("zdot"),
        "lines": [{ "line": LOADER, "path": rc }],
        "record": h.record,
    }));
    assert!(killed(&run));
    assert_eq!(owner_json(&h)["state"], "pending");
    assert_eq!(
        uninstalled_lines(&h, &[]),
        UninstallOutcome::Uninstalled(Uninstalled::default())
    );
    assert!(!rc.exists());
    assert!(!h.owner.exists());
}

#[test]
fn recovery_removes_the_leftover_staging_files_beside_a_linked_startup_files_real_file() {
    let h = home_box();
    let dotfiles = h.root.join("dotfiles");
    fs::create_dir(&dotfiles).unwrap();
    let real = dotfiles.join("zshrc");
    fs::write(&real, format!("a\n{LOADER}\n")).unwrap();
    symlink(&real, &h.rc).unwrap();
    fs::create_dir_all(&h.record).unwrap();
    fs::write(
        &h.owner,
        format!(
            "{}\n",
            json!({
                "directories": [],
                "files": [],
                "format": 1,
                "lines": [{ "intended": NEWER, "path": h.rc, "prior": LOADER }],
                "state": "pending",
            })
        ),
    )
    .unwrap();
    // A rewrite stages beside the real file, which the link names, so its leftover sits there.
    fs::write(
        dotfiles.join(".zshrc.0123456789abcdef.loom-staging"),
        "partial",
    )
    .unwrap();
    uninstalled_of(uninstalled_lines(&h, &[]));
    assert_eq!(names(&dotfiles), ["zshrc"]);
}

// Registrations

fn mcp_command() -> Vec<String> {
    vec!["/home/me/.local/bin/notes".to_owned(), "mcp".to_owned()]
}

#[test]
fn a_pending_registration_is_written_and_a_committed_one_replaces_it_as_the_contract_spells_them() {
    let s = sandbox();
    let owner = PluginRecord::new(&s.record, "mcp.claude");
    let file = s.record.join("mcp.claude.json");
    owner
        .write_pending_registration("notes", None, Some(&mcp_command()))
        .unwrap();
    assert_eq!(
        text(&file),
        "{\"format\":1,\"state\":\"pending\",\"directories\":[],\"files\":[],\"registrations\":[{\"name\":\"notes\",\"prior\":null,\"intended\":[\"/home/me/.local/bin/notes\",\"mcp\"]}]}\n"
    );
    owner
        .write_committed_registration("notes", &mcp_command())
        .unwrap();
    assert_eq!(
        text(&file),
        "{\"format\":1,\"state\":\"committed\",\"directories\":[],\"files\":[],\"registrations\":[{\"name\":\"notes\",\"command\":[\"/home/me/.local/bin/notes\",\"mcp\"]}]}\n"
    );
    assert_eq!(
        owner.read_registration().unwrap(),
        RegistrationRead::Read(Some(RecordedRegistration {
            name: "notes".to_owned(),
            command: mcp_command(),
        }))
    );
    assert_eq!(names(&s.record), ["mcp.claude.json"]);
}

#[test]
fn a_pending_registration_resolves_to_its_intended_command_line_or_its_prior_one_when_removing() {
    let s = sandbox();
    let owner = PluginRecord::new(&s.record, "mcp.codex");
    let old = vec!["/old".to_owned(), "mcp".to_owned()];
    let command_of = |owner: &PluginRecord| match owner.read_registration().unwrap() {
        RegistrationRead::Read(registration) => registration.map(|entry| entry.command),
        refused @ RegistrationRead::Refused(_) => panic!("{refused:?}"),
    };
    owner
        .write_pending_registration("notes", Some(&old), Some(&mcp_command()))
        .unwrap();
    assert_eq!(command_of(&owner), Some(mcp_command()));
    owner
        .write_pending_registration("notes", Some(&old), None)
        .unwrap();
    assert_eq!(command_of(&owner), Some(old));
    owner
        .write_pending_registration("notes", None, None)
        .unwrap();
    assert_eq!(
        owner.read_registration().unwrap(),
        RegistrationRead::Read(None)
    );
}

#[test]
fn a_missing_plugin_file_lists_no_registration_and_deleting_one_removes_it() {
    let s = sandbox();
    let owner = PluginRecord::new(&s.record, "mcp.codex");
    assert_eq!(
        owner.read_registration().unwrap(),
        RegistrationRead::Read(None)
    );
    owner
        .write_committed_registration("notes", &mcp_command())
        .unwrap();
    owner.delete().unwrap();
    assert!(!s.record.join("mcp.codex.json").exists());
    owner.delete().unwrap();
}

#[test]
fn a_plugin_file_with_a_malformed_registration_refuses_as_damaged() {
    for (name, content) in [
        ("not JSON", "{nope"),
        ("an array", "[]"),
        (
            "an empty command line",
            "{\"format\":1,\"state\":\"committed\",\"directories\":[],\"files\":[],\"registrations\":[{\"name\":\"notes\",\"command\":[]}]}",
        ),
        (
            "a command word that is not text",
            "{\"format\":1,\"state\":\"committed\",\"directories\":[],\"files\":[],\"registrations\":[{\"name\":\"notes\",\"command\":[\"a\",1]}]}",
        ),
        (
            "a pending entry without intended",
            "{\"format\":1,\"state\":\"pending\",\"directories\":[],\"files\":[],\"registrations\":[{\"name\":\"notes\",\"prior\":null}]}",
        ),
    ] {
        let s = sandbox();
        fs::create_dir_all(&s.record).unwrap();
        fs::write(s.record.join("mcp.claude.json"), content).unwrap();
        assert!(
            matches!(
                PluginRecord::new(&s.record, "mcp.claude")
                    .read_registration()
                    .unwrap(),
                RegistrationRead::Refused(Refusal {
                    reason: RefusalReason::Damaged,
                    ..
                })
            ),
            "{name}"
        );
    }
}

#[test]
fn a_plugin_file_of_an_unknown_format_refuses_its_registration() {
    let s = sandbox();
    fs::create_dir_all(&s.record).unwrap();
    fs::write(s.record.join("mcp.claude.json"), "{\"format\":3}").unwrap();
    assert!(matches!(
        PluginRecord::new(&s.record, "mcp.claude")
            .read_registration()
            .unwrap(),
        RegistrationRead::Refused(Refusal {
            reason: RefusalReason::UnknownFormat,
            ..
        })
    ));
}

#[test]
fn a_file_with_no_registrations_member_still_reads_and_an_install_of_files_writes_none() {
    let s = sandbox();
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    assert!(owner_json(&s).get("registrations").is_none());
    assert_eq!(
        record(&s).read_registration().unwrap(),
        RegistrationRead::Read(None)
    );
}

// The worked example of the module's rustdoc

#[test]
fn the_worked_example_from_the_module_rustdoc() {
    let h = home_box();
    let data = h.root.join("data");
    let script = data.join("notes/completion/notes.bash");
    let rc = h.home.join(".bashrc");
    let line = format!(
        ". '{}' # added by notes completion install",
        script.display()
    );
    let bash = PluginRecord::new(&h.record, "completion.bash");
    let request = InstallRequest::new()
        .files([InstalledFile::new(&script, "complete -F _notes notes\n").mode(0o644)])
        .lines([InstalledLine::new(&rc, &line)])
        .directory_mode(0o755);
    let done = installed_of(bash.install(&request, &Running).unwrap());
    assert_eq!(done.written, std::slice::from_ref(&script));
    assert_eq!(done.lines.unwrap().added, [line_entry(&rc, &line)]);
    assert_eq!(
        bash.directories().unwrap(),
        [
            data.clone(),
            data.join("notes"),
            data.join("notes/completion")
        ]
    );
    assert_eq!(text(&rc), format!("{line}\n"));

    let refreshed = request
        .clone()
        .files([InstalledFile::new(&script, "complete -F _notes2 notes\n").mode(0o644)])
        .update(true);
    let done = installed_of(bash.install(&refreshed, &Running).unwrap());
    assert_eq!(done.lines.unwrap().held, [line_entry(&rc, &line)]);
    assert_eq!(text(&script), "complete -F _notes2 notes\n");

    let done = uninstalled_of(bash.uninstall(&[], &Running).unwrap());
    assert_eq!(done.removed, std::slice::from_ref(&script));
    assert_eq!(done.lines.unwrap().removed, [line_entry(&rc, &line)]);
    assert!(!data.exists());
    assert_eq!(text(&rc), "");
    assert!(!h.record.join("completion.bash.json").exists());
}

#[test]
fn format_two_without_folders_is_readable_and_record_writes_format_one_for_files_alone() {
    let s = sandbox();
    fs::create_dir(&s.record).unwrap();
    fs::write(
        &s.owner,
        "{\"format\":2,\"state\":\"committed\",\"directories\":[],\"files\":[]}\n",
    )
    .unwrap();
    assert_eq!(read(&s), recorded_read(vec![], vec![], vec![]));
    installed(&s, vec![InstalledFile::new(&s.first, "test")]);
    assert_eq!(
        text(&s.owner),
        committed(&[&s.directory], &[(&s.first, DIGEST_TEST)])
    );
}

#[test]
fn a_folder_record_cannot_name_a_file_outside_the_folder() {
    let s = sandbox();
    fs::create_dir(&s.record).unwrap();
    for path in [
        "",
        "/",
        "/outside",
        "../outside",
        "here/../outside",
        "here//there",
        "./inside",
    ] {
        let malformed = json!({
            "format": 2, "state": "committed", "directories": [], "files": [], "folders": [{
                "path": s.directory, "files": [{"path": path, "digest": DIGEST_TEST}],
            }],
        })
        .to_string();
        fs::write(&s.owner, &malformed).unwrap();
        assert_eq!(
            read(&s),
            RecordedRead::Refused(Refusal {
                path: s.owner.clone(),
                reason: RefusalReason::Damaged,
                file: None,
            }),
            "{path}"
        );
        assert_eq!(text(&s.owner), malformed);
    }
}

#[test]
fn read_checks_reachability_for_directories_and_folders_before_mutation() {
    let s = sandbox();
    fs::create_dir(&s.record).unwrap();
    let blocker = s.root.join("blocker");
    fs::write(&blocker, "blocking").unwrap();
    let unreachable = blocker.join("child");
    let held = s.skills.join("held");
    fs::create_dir(&held).unwrap();
    for member in ["directories", "folders"] {
        let mut value = json!({
            "format": 2, "state": "committed", "files": [], "directories": [], "folders": [{ "path": held }],
        });
        if member == "folders" {
            value["folders"]
                .as_array_mut()
                .unwrap()
                .push(json!({ "path": unreachable }));
        } else {
            value["directories"] = json!([unreachable]);
        }
        let before = value.to_string();
        fs::write(&s.owner, &before).unwrap();
        let record = record(&s);
        let read = record.read().unwrap_err();
        let uninstall = record.uninstall(&[], &Running).unwrap_err();
        let install = record
            .install(&InstallRequest::new(), &Running)
            .unwrap_err();
        for error in [read, uninstall, install] {
            let sentence = error.to_string();
            assert!(sentence.starts_with("Cannot reach "), "{sentence}");
            assert!(
                sentence.contains(unreachable.to_str().unwrap()),
                "{sentence}"
            );
            assert!(sentence.ends_with("because a file sits where one of its folders is needed. Remove or rename that file, then run the command again."), "{sentence}");
            let loom = loomcli_core::Error::from(error);
            assert!(
                loom.downcast_failure::<loomcli_core::FatalError>()
                    .is_some()
            );
        }
        assert_eq!(text(&s.owner), before);
        assert!(held.is_dir());
    }
}
