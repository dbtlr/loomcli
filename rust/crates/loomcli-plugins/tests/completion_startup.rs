//! Ports `completion-install.test.ts`, part two: a startup file the plugin cannot change, a recorded
//! line in such a file, and `update`.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;
use std::io;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;

use completion_support::install::{
    MARKER, Sandbox, Scenario, bash_line, completion_run, digest, lines, printed, run,
};
use loomcli_plugins::completion::test_support::{denies_write, owned_by_another};
use serde_json::json;

fn chmod(path: &Path, mode: u32) {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

fn text(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn prefix_scenario(home: &Path) -> Scenario {
    Scenario::new().env("HOME", &home.to_string_lossy())
}

// a startup file the plugin cannot change

#[tokio::test]
async fn fails_install_for_a_startup_file_that_is_a_directory_and_writes_nothing() {
    let b = Sandbox::new();
    let startup = b.home.join(".bashrc");
    fs::create_dir(&startup).unwrap();
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "{} is not a file, so jsonkit cannot add its startup line. Remove it, then run jsonkit completion install again.",
            startup.display()
        )]
    );
    assert!(fs::read_dir(&b.data).unwrap().next().is_none());
    assert!(fs::read_dir(&b.state).unwrap().next().is_none());
}

/// Each way a startup file is one the process may not change, set up before the install: the file
/// to read back, and the home the run uses.
fn unchangeable(b: &Sandbox, which: usize) -> (std::path::PathBuf, std::path::PathBuf) {
    match which {
        0 => {
            let startup = b.home.join(".bashrc");
            fs::write(&startup, "set -o vi\n").unwrap();
            chmod(&startup, 0o444);
            (startup, b.home.clone())
        }
        1 => {
            let folder = b.root.join("locked");
            fs::create_dir(&folder).unwrap();
            fs::write(folder.join(".bashrc"), "set -o vi\n").unwrap();
            chmod(&folder, 0o555);
            (folder.join(".bashrc"), folder)
        }
        _ => {
            let startup = b.home.join(".bashrc");
            fs::write(&startup, [0xfe, 0xff, 0x00, 0x73]).unwrap();
            (startup, b.home.clone())
        }
    }
}

#[tokio::test]
async fn installs_the_script_for_a_startup_file_the_process_may_not_change_prints_the_line_to_add_and_records_no_line()
 {
    // A file the process may not write, a file in a folder it may not write, and one in UTF-16BE.
    for which in 0..3 {
        let b = Sandbox::new();
        let (startup, home) = unchangeable(&b, which);
        let before = fs::read(&startup).unwrap();
        let script = b.script("bash");
        let result = run(
            &b,
            &["completion", "install", "bash"],
            prefix_scenario(&home),
        )
        .await;
        assert_eq!(result.status, 0, "{which}: {}", result.stderr);
        assert_eq!(
            lines(&result.stderr),
            [
                format!(
                    "Installed the bash completion script in {}.",
                    script.display()
                ),
                format!(
                    "jsonkit cannot change {}, so add this line to it yourself:",
                    startup.display()
                ),
                "Open a new shell to use it.".to_owned(),
            ],
            "{which}"
        );
        assert_eq!(
            result.stdout,
            format!("{}\n", bash_line(&script)),
            "{which}"
        );
        assert_eq!(fs::read(&startup).unwrap(), before, "{which}");
        assert_eq!(b.recorded("bash")["lines"], json!([]), "{which}");
        assert!(script.exists());
    }
}

#[tokio::test]
async fn installs_the_script_for_a_startup_file_the_process_may_not_read_prints_the_line_to_add_and_records_no_line()
 {
    let b = Sandbox::new();
    let startup = b.home.join(".bashrc");
    fs::write(&startup, "set -o vi\n").unwrap();
    chmod(&startup, 0o000);
    let script = b.script("bash");
    let result = completion_run(&b, &["install", "bash"]).await;
    chmod(&startup, 0o644);
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the bash completion script in {}.",
                script.display()
            ),
            format!(
                "jsonkit cannot change {}, so add this line to it yourself:",
                startup.display()
            ),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(result.stdout, format!("{}\n", bash_line(&script)));
    assert_eq!(text(&startup), "set -o vi\n");
    assert_eq!(b.recorded("bash")["lines"], json!([]));
}

#[tokio::test]
async fn installs_the_script_for_a_missing_startup_file_below_a_folder_it_may_not_write() {
    let b = Sandbox::new();
    let locked = b.root.join("locked");
    fs::create_dir(&locked).unwrap();
    chmod(&locked, 0o555);
    let zdotdir = locked.join("zdot");
    let result = run(
        &b,
        &["completion", "install", "zsh"],
        Scenario::new().env("ZDOTDIR", &zdotdir.to_string_lossy()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr)[1],
        format!(
            "jsonkit cannot change {}, so add this line to it yourself:",
            zdotdir.join(".zshrc").display()
        )
    );
    assert_eq!(
        result.stdout,
        format!(
            "{}\n",
            completion_support::install::zsh_line(&b.script("zsh"))
        )
    );
    assert!(!zdotdir.exists());
}

#[tokio::test]
async fn judges_the_folder_of_the_real_file_a_linked_startup_file_names() {
    let b = Sandbox::new();
    let dotfiles = b.root.join("dotfiles");
    fs::create_dir(&dotfiles).unwrap();
    let real = dotfiles.join("bashrc");
    fs::write(&real, "set -o vi\n").unwrap();
    chmod(&dotfiles, 0o555);
    let startup = b.home.join(".bashrc");
    symlink(&real, &startup).unwrap();
    let script = b.script("bash");
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr)[1],
        format!(
            "jsonkit cannot change {}, so add this line to it yourself:",
            startup.display()
        )
    );
    assert_eq!(result.stdout, format!("{}\n", bash_line(&script)));
    assert_eq!(text(&real), "set -o vi\n");
}

#[tokio::test]
async fn reports_a_line_no_longer_held_in_a_startup_file_it_cannot_change_printing_nothing_to_remove()
 {
    let b = Sandbox::new();
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    fs::write(&startup, "mine\n").unwrap();
    chmod(&startup, 0o444);
    let result = completion_run(&b, &["uninstall"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("Removed {}.", b.script("bash").display()),
            format!(
                "{} no longer holds the line jsonkit completion install added, so it was left as it is.",
                startup.display()
            ),
        ]
    );
    assert_eq!(result.stdout, "");
}

#[test]
fn reads_a_missing_permission_a_forbidden_operation_and_a_read_only_file_system_as_a_startup_file_it_cannot_change()
 {
    // EACCES, EPERM, EROFS, and EIO.
    let answers: Vec<bool> = [13, 1, 30, 5]
        .iter()
        .map(|code| denies_write(&io::Error::from_raw_os_error(*code)))
        .collect();
    assert_eq!(answers, [true, true, true, false]);
}

#[test]
fn judges_a_file_owned_by_another_user_as_one_it_cannot_change() {
    assert!(owned_by_another(0, Some(501)));
    assert!(!owned_by_another(501, Some(501)));
    assert!(!owned_by_another(0, None));
}

#[tokio::test]
async fn uninstalls_after_the_startup_file_becomes_read_only_printing_the_line_to_remove() {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    chmod(&startup, 0o444);
    let result = completion_run(&b, &["uninstall"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("Removed {}.", script.display()),
            format!(
                "jsonkit cannot change {}, so remove this line from it yourself:",
                startup.display()
            ),
        ]
    );
    assert_eq!(result.stdout, format!("{}\n", bash_line(&script)));
    assert_eq!(text(&startup), format!("{}\n", bash_line(&script)));
    assert!(!b.record_path("bash").exists());
    let again = completion_run(&b, &["uninstall"]).await;
    assert_eq!(again.status, 0);
    assert_eq!(
        lines(&again.stderr),
        ["jsonkit has no completion installed, so there is nothing to remove."]
    );
}

#[tokio::test]
async fn adds_the_new_line_under_a_new_zdotdir_and_prints_the_old_line_to_remove_from_a_read_only_zshrc()
 {
    let b = Sandbox::new();
    let script = b.script("zsh");
    let old = b.home.join(".zshrc");
    completion_run(&b, &["install", "zsh"]).await;
    chmod(&old, 0o444);
    let zdotdir = b.root.join("zdot");
    let result = run(
        &b,
        &["completion", "install", "zsh"],
        Scenario::new().env("ZDOTDIR", &zdotdir.to_string_lossy()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!(
                "Added a line to {} that loads it.",
                zdotdir.join(".zshrc").display()
            ),
            format!(
                "jsonkit cannot change {}, so remove this line from it yourself:",
                old.display()
            ),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    let line = completion_support::install::zsh_line(&script);
    assert_eq!(result.stdout, format!("{line}\n"));
    assert_eq!(text(&zdotdir.join(".zshrc")), format!("{line}\n"));
    assert_eq!(
        b.recorded("zsh")["lines"],
        json!([{ "line": line, "path": zdotdir.join(".zshrc") }])
    );
}

// a recorded line in a startup file the plugin cannot change

#[tokio::test]
async fn drops_the_recorded_line_from_a_startup_file_that_became_read_only_which_still_loads_the_script()
 {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    chmod(&startup, 0o444);
    let installing = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(installing.status, 0, "{}", installing.stderr);
    assert_eq!(
        lines(&installing.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!("{} already loads it.", startup.display()),
        ]
    );
    assert_eq!(installing.stdout, "");
    assert_eq!(b.recorded("bash")["lines"], json!([]));
    let removing = completion_run(&b, &["uninstall"]).await;
    assert_eq!(
        lines(&removing.stderr),
        [format!("Removed {}.", script.display())]
    );
    assert_eq!(removing.stdout, "");
    assert_eq!(text(&startup), format!("{}\n", bash_line(&script)));
}

#[tokio::test]
async fn releases_the_old_line_and_prints_the_new_one_in_its_place_when_install_moves_the_script() {
    let b = Sandbox::new();
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    chmod(&startup, 0o444);
    let moved = b.root.join("data2");
    let script = moved.join("jsonkit/completion/jsonkit.bash");
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().env("XDG_DATA_HOME", &moved.to_string_lossy()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the bash completion script in {}.",
                script.display()
            ),
            format!("Removed {}.", b.script("bash").display()),
            format!(
                "jsonkit cannot change {}, so remove this line from it yourself:",
                startup.display()
            ),
            format!("Add this line to {} in its place:", startup.display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(
        result.stdout,
        format!("{}\n{}\n", bash_line(&b.script("bash")), bash_line(&script))
    );
    assert_eq!(
        text(&startup),
        format!("{}\n", bash_line(&b.script("bash")))
    );
    assert_eq!(b.recorded("bash")["lines"], json!([]));
}

#[tokio::test]
async fn records_no_line_the_operator_added_to_a_read_only_file_when_install_moves_the_script_so_uninstall_leaves_it()
 {
    let b = Sandbox::new();
    let old = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    let moved = b.root.join("data2");
    let script = moved.join("jsonkit/completion/jsonkit.bash");
    let content = format!("{}\n{}\n", bash_line(&old), bash_line(&script));
    fs::write(&startup, &content).unwrap();
    chmod(&startup, 0o444);
    let moved_text = moved.to_string_lossy().into_owned();
    let installing = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().env("XDG_DATA_HOME", &moved_text),
    )
    .await;
    assert_eq!(installing.status, 0, "{}", installing.stderr);
    assert_eq!(
        lines(&installing.stderr),
        [
            format!(
                "Installed the bash completion script in {}.",
                script.display()
            ),
            format!("Removed {}.", old.display()),
            format!("{} already loads it.", startup.display()),
            format!(
                "jsonkit cannot change {}, so remove this line from it yourself:",
                startup.display()
            ),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(installing.stdout, format!("{}\n", bash_line(&old)));
    assert_eq!(b.recorded("bash")["lines"], json!([]));
    let removing = run(
        &b,
        &["completion", "uninstall"],
        Scenario::new().env("XDG_DATA_HOME", &moved_text),
    )
    .await;
    assert_eq!(removing.status, 0, "{}", removing.stderr);
    assert_eq!(
        lines(&removing.stderr),
        [format!("Removed {}.", script.display())]
    );
    assert_eq!(removing.stdout, "");
    assert_eq!(text(&startup), content);
}

#[tokio::test]
async fn records_nothing_for_the_new_line_in_a_startup_file_it_cannot_read_when_install_moves_the_script()
 {
    let b = Sandbox::new();
    let old = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    let moved = b.root.join("data2");
    let script = moved.join("jsonkit/completion/jsonkit.bash");
    fs::write(
        &startup,
        format!("{}\n{}\n", bash_line(&old), bash_line(&script)),
    )
    .unwrap();
    chmod(&startup, 0o000);
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().env("XDG_DATA_HOME", &moved.to_string_lossy()),
    )
    .await;
    chmod(&startup, 0o644);
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the bash completion script in {}.",
                script.display()
            ),
            format!("Removed {}.", old.display()),
            format!(
                "jsonkit cannot change {}, so remove this line from it yourself:",
                startup.display()
            ),
            format!("Add this line to {} in its place:", startup.display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(
        result.stdout,
        format!("{}\n{}\n", bash_line(&old), bash_line(&script))
    );
    assert_eq!(b.recorded("bash")["lines"], json!([]));
}

#[tokio::test]
async fn drops_a_line_from_the_record_when_its_file_changes_to_another_encoding_so_install_prints_it_to_add()
 {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    let mut bytes = vec![0xff, 0xfe];
    for unit in bash_line(&script).encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    fs::write(&startup, &bytes).unwrap();
    let updating = completion_run(&b, &["update"]).await;
    assert_eq!(updating.status, 0, "{}", updating.stderr);
    assert_eq!(
        lines(&updating.stderr),
        [format!("{} is unchanged.", script.display())]
    );
    assert_eq!(updating.stdout, "");
    assert_eq!(b.recorded("bash")["lines"], json!([]));
    let installing = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(installing.status, 0, "{}", installing.stderr);
    assert_eq!(
        lines(&installing.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!(
                "jsonkit cannot change {}, so add this line to it yourself:",
                startup.display()
            ),
        ]
    );
    assert_eq!(installing.stdout, format!("{}\n", bash_line(&script)));
    assert_eq!(b.recorded("bash")["lines"], json!([]));
    let removing = completion_run(&b, &["uninstall"]).await;
    assert_eq!(removing.status, 0, "{}", removing.stderr);
    assert_eq!(
        lines(&removing.stderr),
        [format!("Removed {}.", script.display())]
    );
    assert_eq!(removing.stdout, "");
    assert_eq!(fs::read(&startup).unwrap(), bytes);
}

// update

#[tokio::test]
async fn rewrites_each_recorded_script_at_its_recorded_path_even_with_xdg_data_home_changed() {
    let b = Sandbox::new();
    completion_run(&b, &["install", "bash"]).await;
    completion_run(&b, &["install", "fish"]).await;
    // An earlier version wrote other scripts, which its record lists.
    for shell in ["bash", "fish"] {
        let script = b.script(shell);
        fs::write(&script, format!("old {shell}\n")).unwrap();
        b.edit_record(shell, |file| {
            file["files"] =
                json!([{ "digest": digest(&format!("old {shell}\n")), "path": script }]);
        });
    }
    let elsewhere = b.root.join("elsewhere");
    let elsewhere_text = elsewhere.to_string_lossy().into_owned();
    let result = run(
        &b,
        &["completion", "update"],
        Scenario::new()
            .env("XDG_CONFIG_HOME", &elsewhere_text)
            .env("XDG_DATA_HOME", &elsewhere_text),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Updated the bash completion script in {}.",
                b.script("bash").display()
            ),
            format!(
                "Updated the fish completion script in {}.",
                b.script("fish").display()
            ),
        ]
    );
    assert_eq!(text(&b.script("bash")), printed(&b, "bash").await);
    assert_eq!(text(&b.script("fish")), printed(&b, "fish").await);
    assert!(!elsewhere.exists());
}

#[tokio::test]
async fn reports_an_up_to_date_script_unchanged() {
    let b = Sandbox::new();
    completion_run(&b, &["install", "zsh"]).await;
    let result = completion_run(&b, &["update"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [format!("{} is unchanged.", b.script("zsh").display())]
    );
}

#[tokio::test]
async fn replaces_a_line_whose_text_changed_where_it_stands() {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    fs::write(&startup, "first\n").unwrap();
    completion_run(&b, &["install", "bash"]).await;
    fs::write(&startup, format!("first\nold line {MARKER}\nlast\n")).unwrap();
    b.edit_record("bash", |file| {
        file["lines"] = json!([{ "line": format!("old line {MARKER}"), "path": startup }]);
    });
    let result = completion_run(&b, &["update"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!("Updated the line in {}.", startup.display()),
        ]
    );
    assert_eq!(
        text(&startup),
        format!("first\n{}\nlast\n", bash_line(&script))
    );
    assert_eq!(
        b.recorded("bash")["lines"],
        json!([{ "line": bash_line(&script), "path": startup }])
    );
}

#[tokio::test]
async fn adds_no_line_the_operator_removed() {
    let b = Sandbox::new();
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    fs::write(&startup, "mine\n").unwrap();
    let result = completion_run(&b, &["update"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("{} is unchanged.", b.script("bash").display()),
            format!(
                "{} no longer holds the line jsonkit completion install added, so it was left as it is.",
                startup.display()
            ),
        ]
    );
    assert_eq!(text(&startup), "mine\n");
    assert_eq!(b.recorded("bash")["lines"], json!([]));
}

#[tokio::test]
async fn releases_a_changed_line_in_a_read_only_startup_file_printing_the_line_to_remove_and_the_one_to_add()
 {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    fs::write(&script, "old bash\n").unwrap();
    fs::write(&startup, format!("old line {MARKER}\n")).unwrap();
    b.edit_record("bash", |file| {
        file["files"] = json!([{ "digest": digest("old bash\n"), "path": script }]);
        file["lines"] = json!([{ "line": format!("old line {MARKER}"), "path": startup }]);
    });
    chmod(&startup, 0o444);
    let result = completion_run(&b, &["update"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Updated the bash completion script in {}.",
                script.display()
            ),
            format!(
                "jsonkit cannot change {}, so remove this line from it yourself:",
                startup.display()
            ),
            format!("Add this line to {} in its place:", startup.display()),
        ]
    );
    assert_eq!(
        result.stdout,
        format!("old line {MARKER}\n{}\n", bash_line(&script))
    );
    assert_eq!(text(&script), printed(&b, "bash").await);
    assert_eq!(text(&startup), format!("old line {MARKER}\n"));
    assert_eq!(b.recorded("bash")["lines"], json!([]));
}

#[tokio::test]
async fn drops_a_changed_line_from_a_read_only_startup_file_that_already_holds_the_new_one_printing_the_line_to_remove()
 {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    let content = format!("old line {MARKER}\n{}\n", bash_line(&script));
    fs::write(&startup, &content).unwrap();
    b.edit_record("bash", |file| {
        file["lines"] = json!([{ "line": format!("old line {MARKER}"), "path": startup }]);
    });
    chmod(&startup, 0o444);
    let result = completion_run(&b, &["update"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!(
                "jsonkit cannot change {}, so remove this line from it yourself:",
                startup.display()
            ),
        ]
    );
    assert_eq!(result.stdout, format!("old line {MARKER}\n"));
    assert_eq!(text(&startup), content);
    assert_eq!(b.recorded("bash")["lines"], json!([]));
}

#[tokio::test]
async fn prints_the_nothing_to_lines_with_nothing_recorded() {
    let b = Sandbox::new();
    let updating = completion_run(&b, &["update"]).await;
    assert_eq!(updating.status, 0);
    assert_eq!(
        lines(&updating.stderr),
        [
            "jsonkit has no completion installed, so there is nothing to update. Run jsonkit completion install to install it."
        ]
    );
    let removing = completion_run(&b, &["uninstall"]).await;
    assert_eq!(removing.status, 0);
    assert_eq!(
        lines(&removing.stderr),
        ["jsonkit has no completion installed, so there is nothing to remove."]
    );
    let zsh = completion_run(&b, &["uninstall", "zsh"]).await;
    assert_eq!(
        lines(&zsh.stderr),
        ["jsonkit has no completion installed, so there is nothing to remove."]
    );
}

#[tokio::test]
async fn leaves_a_pending_file_from_a_first_install_killed_before_its_script_was_written_for_the_next_install()
 {
    let b = Sandbox::new();
    let script = b.script("bash");
    let record = b.record_path("bash");
    fs::create_dir_all(record.parent().unwrap()).unwrap();
    let pending = format!(
        "{}\n",
        json!({
            "directories": [],
            "files": [{ "intended": digest(&printed(&b, "bash").await), "path": script, "prior": null }],
            "format": 1,
            "lines": [],
            "state": "pending",
        })
    );
    fs::write(&record, &pending).unwrap();
    let updating = completion_run(&b, &["update"]).await;
    assert_eq!(updating.status, 0, "{}", updating.stderr);
    assert_eq!(
        lines(&updating.stderr),
        [
            "jsonkit has no completion installed, so there is nothing to update. Run jsonkit completion install to install it."
        ]
    );
    assert_eq!(text(&record), pending);
    let installing = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(installing.status, 0, "{}", installing.stderr);
    completion_support::install::assert_subset(
        &b.recorded("bash"),
        &json!({ "files": [{ "path": script }], "state": "committed" }),
    );
}
