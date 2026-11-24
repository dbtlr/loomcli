//! `manpage install`, ported from the `install`, `advice when man will not find the pages`, and
//! `files the record does not list` groups of the reference's `manpage.test.ts`. The umask case
//! lives in `manpage_umask.rs`, because the umask is process-wide.

#![cfg(all(feature = "manpage", feature = "help"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod manpage_support;

use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::process::Command as Program;

use manpage_support::{
    DEFAULT_SET, Scenario, digest_of, folder_of, laned, lines, mode_of, names_in, raw_lines,
    record_path, recorded_paths, run, sandbox, snapshot, sorted_set,
};

#[tokio::test]
async fn install_writes_the_set_records_it_and_a_second_install_changes_no_byte() {
    let box_ = sandbox();
    let folder = folder_of(&box_.home);
    let first = run(&box_, &["manpage", "install"], &Scenario::default()).await;
    assert_eq!(first.status, 0, "{}", first.stderr);
    assert_eq!(first.stdout, "");
    assert_eq!(
        raw_lines(&first.stderr),
        [
            laned(
                "success",
                &format!("Installed 8 man pages in {}.", folder.display())
            ),
            laned("info", "Read them with man notes."),
        ]
    );
    for directory in [
        ".local",
        ".local/share",
        ".local/share/man",
        ".local/share/man/man1",
    ] {
        assert_eq!(mode_of(&box_.home.join(directory)), 0o755, "{directory}");
    }
    assert_eq!(names_in(&folder), sorted_set());
    for file in DEFAULT_SET {
        assert_eq!(mode_of(&folder.join(file)), 0o644, "{file}");
    }
    assert_eq!(
        recorded_paths(&box_),
        DEFAULT_SET
            .iter()
            .map(|file| folder.join(file).to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    );
    let before = snapshot(&box_);
    let second = run(&box_, &["manpage", "install"], &Scenario::default()).await;
    assert_eq!(second.status, 0, "{}", second.stderr);
    assert_eq!(
        raw_lines(&second.stderr),
        [
            laned(
                "info",
                &format!("The 8 man pages in {} are unchanged.", folder.display())
            ),
            laned("info", "Read them with man notes."),
        ]
    );
    assert_eq!(snapshot(&box_), before);
}

#[tokio::test]
async fn man_finds_an_installed_page_with_manpath_unset_and_the_home_bin_folder_on_path() {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let path = std::env::var("PATH").unwrap_or_default();
    let found = Program::new("man")
        .args(["-w", "notes-ping"])
        .env_clear()
        .env("HOME", &box_.home)
        .env(
            "PATH",
            format!("{}:{path}", box_.home.join(".local").join("bin").display()),
        )
        .output();
    let Ok(found) = found else {
        return; // No man program here, so the case is skipped as the reference's is.
    };
    assert!(found.status.success(), "man -w failed: {found:?}");
    assert_eq!(
        String::from_utf8_lossy(&found.stdout).trim(),
        folder_of(&box_.home).join("notes-ping.1").to_string_lossy()
    );
}

#[tokio::test]
async fn after_an_installed_page_is_deleted_install_writes_it_again() {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    fs::remove_file(folder_of(&box_.home).join("notes-ping.1")).unwrap();
    let result = run(&box_, &["manpage", "install"], &Scenario::default()).await;
    assert_eq!(
        lines(&result.stderr)[0],
        format!(
            "Installed 8 man pages in {}.",
            folder_of(&box_.home).display()
        )
    );
    assert!(folder_of(&box_.home).join("notes-ping.1").exists());
}

#[tokio::test]
async fn after_an_install_killed_once_every_page_was_written_the_next_install_recovers_the_record()
{
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let folder = folder_of(&box_.home);
    // A kill after the last rename and before the commit leaves every page and a pending record.
    let files: Vec<serde_json::Value> = DEFAULT_SET
        .iter()
        .map(|file| {
            serde_json::json!({
                "intended": digest_of(&fs::read_to_string(folder.join(file)).unwrap()),
                "path": folder.join(file),
                "prior": null,
            })
        })
        .collect();
    fs::write(
        record_path(&box_),
        format!(
            "{}\n",
            serde_json::json!({
                "directories": [],
                "files": files,
                "format": 1,
                "state": "pending",
            })
        ),
    )
    .unwrap();
    let result = run(&box_, &["manpage", "install"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr)[0],
        format!("Installed 8 man pages in {}.", folder.display())
    );
    let record: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(record_path(&box_)).unwrap()).unwrap();
    assert_eq!(record["state"], "committed");
    assert_eq!(
        recorded_paths(&box_),
        DEFAULT_SET
            .iter()
            .map(|file| folder.join(file).to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn a_home_that_is_not_an_absolute_path_fails_with_the_pinned_sentence() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["manpage", "install"],
        &Scenario::default().home("relative"),
    )
    .await;
    assert_eq!(result.status, 1);
    assert!(
        result.stderr.contains("notes cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again."),
        "{}",
        result.stderr
    );
}

/// The advice line for a home whose man folder man will not find.
fn advice(home: &Path) -> String {
    format!(
        "man will not find these pages until MANPATH lists {}. Add this line to your shell's startup file:",
        home.join(".local").join("share").join("man").display()
    )
}

/// Runs the printed line under `bash -u` and returns what it leaves in `MANPATH`.
fn bash_manpath(line: &str, manpath: Option<&str>) -> String {
    let mut program = Program::new("bash");
    program
        .args(["-u", "-c", &format!("{line}printf %s \"$MANPATH\"")])
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default());
    if let Some(manpath) = manpath {
        program.env("MANPATH", manpath);
    }
    String::from_utf8(program.output().unwrap().stdout).unwrap()
}

#[tokio::test]
async fn man_will_not_find_the_pages_so_the_advice_and_the_export_line_follow() {
    let cases: [(&str, &[(&str, &str)]); 4] = [
        ("PATH lacks the home bin folder", &[("PATH", "/usr/bin")]),
        (
            "PATH holds the bare home .local folder alone",
            &[("PATH", "HOME/.local:/usr/bin")],
        ),
        (
            "MANPATH lists neither the folder nor an empty entry",
            &[("MANPATH", "/usr/share/man")],
        ),
        (
            "MANPATH holds an empty entry while PATH lacks the home bin folder",
            &[("MANPATH", ":/usr/share/man"), ("PATH", "/usr/bin")],
        ),
    ];
    for (name, env) in cases {
        let box_ = sandbox();
        let mut scenario = Scenario::default();
        for (variable, value) in env {
            scenario = scenario.env(
                variable,
                value.replace("HOME", &box_.home.to_string_lossy()),
            );
        }
        let result = run(&box_, &["manpage", "install"], &scenario).await;
        let man_folder = box_.home.join(".local").join("share").join("man");
        assert_eq!(result.status, 0, "{name}: {}", result.stderr);
        assert_eq!(
            raw_lines(&result.stderr),
            [
                laned(
                    "success",
                    &format!(
                        "Installed 8 man pages in {}.",
                        folder_of(&box_.home).display()
                    )
                ),
                laned("warning", &advice(&box_.home)),
            ],
            "{name}"
        );
        assert_eq!(
            result.stdout,
            format!(
                "export MANPATH=\"{}:${{MANPATH-}}\"\n",
                man_folder.display()
            ),
            "{name}"
        );
        for manpath in [None, Some("/usr/share/man")] {
            assert_eq!(
                bash_manpath(&result.stdout, manpath),
                format!("{}:{}", man_folder.display(), manpath.unwrap_or("")),
                "{name}"
            );
        }
    }
}

#[tokio::test]
async fn a_home_holding_shell_characters_is_escaped_in_the_export_line() {
    let box_ = sandbox();
    let home = box_.root.join("a\"b$c`d\\e");
    fs::create_dir(&home).unwrap();
    let result = run(
        &box_,
        &["manpage", "install"],
        &Scenario::default()
            .env("PATH", "/usr/bin")
            .home(home.clone()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    let man_folder = home.join(".local").join("share").join("man");
    assert_eq!(
        bash_manpath(&result.stdout, None),
        format!("{}:", man_folder.display())
    );
}

#[tokio::test]
async fn a_shell_ending_in_fish_gets_the_fish_line() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["manpage", "install"],
        &Scenario::default()
            .env("PATH", "/usr/bin")
            .env("SHELL", "/usr/local/bin/fish"),
    )
    .await;
    let man_folder = box_.home.join(".local").join("share").join("man");
    assert_eq!(
        result.stdout,
        format!("set -gx MANPATH '{}' \"$MANPATH\"\n", man_folder.display())
    );
}

#[tokio::test]
async fn a_real_fish_runs_the_fish_line_to_the_same_manpath() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["manpage", "install"],
        &Scenario::default()
            .env("PATH", "/usr/bin")
            .env("SHELL", "/usr/local/bin/fish"),
    )
    .await;
    let man_folder = box_.home.join(".local").join("share").join("man");
    for manpath in [None, Some("/usr/share/man")] {
        let mut program = Program::new("fish");
        program
            .args([
                "--no-config",
                "-c",
                &format!("{}printf %s \"$MANPATH\"", result.stdout),
            ])
            .env_clear()
            .env("HOME", &box_.home)
            .env("PATH", std::env::var("PATH").unwrap_or_default());
        if let Some(manpath) = manpath {
            program.env("MANPATH", manpath);
        }
        let Ok(output) = program.output() else {
            return; // No Fish here, so the case is skipped as the reference's is.
        };
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            format!("{}:{}", man_folder.display(), manpath.unwrap_or(""))
        );
    }
}

#[tokio::test]
async fn man_finds_the_pages_so_the_run_prints_read_them() {
    let cases: [(&str, &[(&str, &str)]); 4] = [
        (
            "MANPATH ending in a colon, with the home bin folder on PATH",
            &[("MANPATH", "/usr/share/man:")],
        ),
        (
            "MANPATH listing the folder, with PATH lacking the home bin folder",
            &[("MANPATH", "HOME/.local/share/man"), ("PATH", "/usr/bin")],
        ),
        (
            "MANPATH listing the folder with a trailing slash, with PATH lacking the home bin folder",
            &[("MANPATH", "HOME/.local/share/man/"), ("PATH", "/usr/bin")],
        ),
        (
            "MANPATH unset, with the home bin folder on PATH with a trailing slash",
            &[("PATH", "HOME/.local/bin/:/usr/bin")],
        ),
    ];
    for (name, env) in cases {
        let box_ = sandbox();
        let mut scenario = Scenario::default();
        for (variable, value) in env {
            scenario = scenario.env(
                variable,
                value.replace("HOME", &box_.home.to_string_lossy()),
            );
        }
        let result = run(&box_, &["manpage", "install"], &scenario).await;
        assert_eq!(result.stdout, "", "{name}");
        assert_eq!(
            lines(&result.stderr).last().unwrap(),
            "Read them with man notes.",
            "{name}"
        );
    }
}

#[tokio::test]
async fn a_file_the_record_does_not_list_refuses_install_and_update_and_changes_no_byte() {
    let rows = [
        (
            "a page generate wrote into the folder",
            "install",
            "generate",
        ),
        (
            "a page generate wrote into the folder",
            "update",
            "generate",
        ),
        ("a symbolic link at a page path", "install", "link"),
        ("a symbolic link at a page path", "update", "link"),
    ];
    for (name, verb, kind) in rows {
        let box_ = sandbox();
        let folder = folder_of(&box_.home);
        // Update acts on an installed set, so the file sits at the page of a Command added since.
        let scenario = if verb == "update" {
            Scenario::default().commands(&["ping", "sync", "tidy"])
        } else {
            Scenario::default()
        };
        let page = folder.join(if verb == "update" {
            "notes-tidy.1"
        } else {
            "notes-ping.1"
        });
        if verb == "update" {
            run(&box_, &["manpage", "install"], &Scenario::default()).await;
        }
        if kind == "generate" {
            run(
                &box_,
                &["manpage", "generate", "--out", &folder.to_string_lossy()],
                &scenario,
            )
            .await;
        } else {
            fs::create_dir_all(&folder).unwrap();
            symlink(box_.root.join("elsewhere"), &page).unwrap();
        }
        let before = snapshot(&box_);
        let result = run(&box_, &["manpage", verb], &scenario).await;
        assert_eq!(result.status, 1, "{name} {verb}");
        assert!(
            raw_lines(&result.stderr).contains(&laned(
                "warning",
                &format!(
                    "{} was not installed by notes manpage install.",
                    page.display()
                )
            )),
            "{name} {verb}: {}",
            result.stderr
        );
        assert!(
            result.stderr.contains(&format!(
                "notes manpage {verb} changed nothing, because files it did not install are in the way. Remove them, then run notes manpage install again."
            )),
            "{name} {verb}: {}",
            result.stderr
        );
        assert_eq!(snapshot(&box_), before, "{name} {verb}");
    }
}

#[tokio::test]
async fn a_recorded_page_edited_since_refuses_install_and_update() {
    for verb in ["install", "update"] {
        let box_ = sandbox();
        run(&box_, &["manpage", "install"], &Scenario::default()).await;
        let page = folder_of(&box_.home).join("notes-ping.1");
        fs::write(&page, "edited\n").unwrap();
        let before = snapshot(&box_);
        let result = run(
            &box_,
            &["manpage", verb],
            &Scenario::default().version("2.0.0"),
        )
        .await;
        assert_eq!(result.status, 1, "{verb}");
        assert_eq!(
            lines(&result.stderr)[0],
            format!(
                "{} changed since notes manpage install wrote it.",
                page.display()
            ),
            "{verb}"
        );
        assert!(
            result.stderr.contains(&format!(
                "notes manpage {verb} changed nothing, because files it did not install are in the way. Remove them, then run notes manpage install again."
            )),
            "{verb}: {}",
            result.stderr
        );
        assert_eq!(snapshot(&box_), before, "{verb}");
    }
}

#[tokio::test]
async fn a_page_holding_the_bytes_this_run_would_write_whose_record_holds_an_older_digest_refuses()
{
    for verb in ["install", "update"] {
        let box_ = sandbox();
        run(&box_, &["manpage", "install"], &Scenario::default()).await;
        let page = folder_of(&box_.home).join("notes-ping.1");
        let mut record: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(record_path(&box_)).unwrap()).unwrap();
        for file in record["files"].as_array_mut().unwrap() {
            if file["path"].as_str() == Some(&page.to_string_lossy()) {
                file["digest"] = digest_of("an older page\n").into();
            }
        }
        fs::write(record_path(&box_), format!("{record}\n")).unwrap();
        let before = snapshot(&box_);
        let result = run(&box_, &["manpage", verb], &Scenario::default()).await;
        assert_eq!(result.status, 1, "{verb}");
        assert_eq!(
            lines(&result.stderr)[0],
            format!(
                "{} changed since notes manpage install wrote it.",
                page.display()
            ),
            "{verb}"
        );
        assert!(!result.stderr.contains("unchanged"), "{verb}");
        assert_eq!(snapshot(&box_), before, "{verb}");
    }
}

#[tokio::test]
async fn a_home_with_repeated_separators_installs_under_the_folded_folder() {
    let box_ = sandbox();
    let folded = box_.root.join("h").join("me");
    let home = format!("{}//h/./me", box_.root.display());
    let bin = format!("{}:/usr/bin", folded.join(".local").join("bin").display());
    let scenario = Scenario::default().home(home).env("PATH", bin);
    let first = run(&box_, &["manpage", "install"], &scenario).await;
    assert_eq!(first.status, 0, "{}", first.stderr);
    let folder = folder_of(&folded);
    assert_eq!(
        raw_lines(&first.stderr),
        [
            laned(
                "success",
                &format!("Installed 8 man pages in {}.", folder.display())
            ),
            laned("info", "Read them with man notes."),
        ]
    );
    assert_eq!(
        recorded_paths(&box_),
        DEFAULT_SET
            .iter()
            .map(|file| folder.join(file).to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    );
}
