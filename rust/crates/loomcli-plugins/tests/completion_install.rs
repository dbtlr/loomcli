//! Ports `completion-install.test.ts`, part one: installing Bash, Zsh, and Fish, the record against
//! the disk, the startup line, the checks that run before a write, and the files the record does
//! not list. The umask cases are in `completion_umask.rs`; startup files the plugin cannot change
//! and `update` in `completion_startup.rs`; `uninstall` in `completion_uninstall.rs`; PowerShell in
//! `completion_pwsh.rs`.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;

use completion_support::install::{
    Sandbox, Scenario, assert_subset, bash_line, completion_run, digest, inode_of, lines, mode_of,
    names_in, printed, run, tree, zsh_line,
};
use loomcli_plugins::completion::test_support::{Shell, startup_line, zsh_installed_script};
use serde_json::json;

fn in_the_way(verb: &str, shell: &str) -> String {
    format!(
        "jsonkit completion {verb} changed nothing, because files it did not install are in the way. Remove them, then run jsonkit completion install {shell} again."
    )
}

// installing Bash and Zsh

#[tokio::test]
async fn keeps_a_startup_file_whose_path_holds_spaces_on_one_line_at_a_narrow_width() {
    let b = Sandbox::new();
    let home = b.root.join("Application Support/home");
    fs::create_dir_all(&home).unwrap();
    let startup = home.join(".bashrc");
    let home_text = home.to_string_lossy().into_owned();
    let narrow = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().columns(40).env("HOME", &home_text),
    )
    .await;
    assert_eq!(narrow.status, 0, "{}", narrow.stderr);
    assert!(
        narrow
            .stderr
            .split('\n')
            .any(|line| line == format!("  {}", startup.display())),
        "{}",
        narrow.stderr
    );
    assert!(
        lines(&narrow.stderr).contains(&"Added a line to".to_owned()),
        "{}",
        narrow.stderr
    );
    fs::remove_dir_all(b.data.join("jsonkit")).unwrap();
    fs::remove_dir_all(b.state.join("jsonkit")).unwrap();
    fs::remove_file(&startup).unwrap();
    let piped = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().env("HOME", &home_text),
    )
    .await;
    assert!(
        lines(&piped.stderr).contains(&format!(
            "Added a line to {} that loads it.",
            startup.display()
        )),
        "{}",
        piped.stderr
    );
}

#[tokio::test]
async fn writes_fishs_script_under_the_configuration_folder_touches_no_startup_file_and_reports_it_unchanged_next_time()
 {
    let b = Sandbox::new();
    let script = b.script("fish");
    let result = completion_run(&b, &["install", "fish"]).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the fish completion script in {}.",
                script.display()
            ),
            "Open a new shell to use it.".to_owned()
        ]
    );
    assert_eq!(
        fs::read_to_string(&script).unwrap(),
        printed(&b, "fish").await
    );
    assert_subset(
        &b.recorded("fish"),
        &json!({ "files": [{ "path": script }], "lines": [] }),
    );
    assert!(names_in(&b.home).is_empty());
    let again = completion_run(&b, &["install", "fish"]).await;
    assert_eq!(
        lines(&again.stderr),
        [format!("{} is unchanged.", script.display())]
    );
}

#[tokio::test]
async fn follows_shell_when_the_shell_is_left_out() {
    let b = Sandbox::new();
    let result = run(
        &b,
        &["completion", "install"],
        Scenario::new().env("SHELL", "/usr/bin/zsh"),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(b.script("zsh").exists());
    assert!(b.record_path("zsh").exists());
}

#[tokio::test]
async fn exits_2_for_an_unknown_or_unset_shell_with_the_pinned_sentence_and_writes_nothing() {
    for (shell, shown) in [
        (Some("/bin/sh"), "/bin/sh"),
        (None, "(unset)"),
        (Some(""), "(unset)"),
    ] {
        let b = Sandbox::new();
        let scenario = match shell {
            Some(value) => Scenario::new().env("SHELL", value),
            None => Scenario::new().unset("SHELL"),
        };
        let result = run(&b, &["completion", "install"], scenario).await;
        assert_eq!(result.status, 2, "{shell:?}");
        assert_eq!(
            lines(&result.stderr)[0],
            format!(
                "jsonkit: jsonkit cannot tell your shell from SHELL ({shown}). Name it: jsonkit completion install bash, zsh, fish, or pwsh."
            ),
            "{shell:?}"
        );
        assert!(names_in(&b.data).is_empty());
        assert!(names_in(&b.state).is_empty());
    }
}

#[tokio::test]
async fn exits_2_for_a_shell_argument_outside_the_four_with_the_one_of_sentence() {
    let b = Sandbox::new();
    for shell in ["tcsh", "powershell"] {
        for verb in ["install", "uninstall"] {
            let result = completion_run(&b, &[verb, shell]).await;
            assert_eq!(result.status, 2, "{verb} {shell}");
            assert_eq!(result.stdout, "", "{verb} {shell}");
            assert_eq!(
                lines(&result.stderr)[0],
                "jsonkit: Argument \"shell\": Expected one of: bash, zsh, fish, pwsh.",
                "{verb} {shell}"
            );
        }
    }
    assert!(names_in(&b.data).is_empty());
}

#[tokio::test]
async fn puts_bashs_line_in_an_existing_profile_on_darwin_when_neither_bash_profile_nor_bash_login_exists()
 {
    let b = Sandbox::new();
    let profile = b.home.join(".profile");
    fs::write(&profile, "export PATH\n").unwrap();
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().platform("darwin"),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        fs::read_to_string(&profile).unwrap(),
        format!("export PATH\n{}\n", bash_line(&b.script("bash")))
    );
    assert!(!b.home.join(".bash_profile").exists());
    assert!(!b.home.join(".bashrc").exists());
}

#[tokio::test]
async fn puts_bashs_line_in_bash_login_on_darwin_before_profile_when_bash_profile_does_not_exist() {
    let b = Sandbox::new();
    let login = b.home.join(".bash_login");
    fs::write(&login, "").unwrap();
    fs::write(b.home.join(".profile"), "export PATH\n").unwrap();
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().platform("darwin"),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        fs::read_to_string(&login).unwrap(),
        format!("{}\n", bash_line(&b.script("bash")))
    );
    assert_eq!(
        fs::read_to_string(b.home.join(".profile")).unwrap(),
        "export PATH\n"
    );
}

#[tokio::test]
async fn creates_bash_profile_on_darwin_when_no_login_file_exists() {
    let b = Sandbox::new();
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().platform("darwin"),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        fs::read_to_string(b.home.join(".bash_profile")).unwrap(),
        format!("{}\n", bash_line(&b.script("bash")))
    );
}

#[tokio::test]
async fn moves_the_zsh_line_under_an_absolute_zdotdir_creating_the_folder() {
    let b = Sandbox::new();
    let zdotdir = b.root.join("zdot/inner");
    let zdotdir_text = zdotdir.to_string_lossy().into_owned();
    let result = run(
        &b,
        &["completion", "install", "zsh"],
        Scenario::new().env("ZDOTDIR", &zdotdir_text),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        fs::read_to_string(zdotdir.join(".zshrc")).unwrap(),
        format!("{}\n", zsh_line(&b.script("zsh")))
    );
    assert_eq!(mode_of(&zdotdir), 0o755);
    assert!(!b.home.join(".zshrc").exists());
    run(
        &b,
        &["completion", "uninstall", "zsh"],
        Scenario::new().env("ZDOTDIR", &zdotdir_text),
    )
    .await;
    assert!(zdotdir.join(".zshrc").exists());
}

#[tokio::test]
async fn leaves_an_unchanged_script_in_place_when_only_the_line_moves() {
    let b = Sandbox::new();
    let script = b.script("zsh");
    completion_run(&b, &["install", "zsh"]).await;
    let before = inode_of(&script);
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
            format!("Removed the line from {}.", b.home.join(".zshrc").display()),
            format!(
                "Added a line to {} that loads it.",
                zdotdir.join(".zshrc").display()
            ),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(inode_of(&script), before);
}

#[tokio::test]
async fn moves_the_script_and_its_line_after_xdg_data_home_changes() {
    let b = Sandbox::new();
    let old = b.script("zsh");
    let startup = b.home.join(".zshrc");
    completion_run(&b, &["install", "zsh"]).await;
    let moved = b.root.join("data2");
    let script = moved.join("jsonkit/completion/zsh/_loom_jsonkit");
    let result = run(
        &b,
        &["completion", "install", "zsh"],
        Scenario::new().env("XDG_DATA_HOME", &moved.to_string_lossy()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the zsh completion script in {}.",
                script.display()
            ),
            format!("Removed {}.", old.display()),
            format!("Updated the line in {}.", startup.display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert!(!old.exists());
    assert_eq!(
        fs::read_to_string(&script).unwrap(),
        zsh_installed_script("jsonkit")
    );
    assert_eq!(
        fs::read_to_string(&startup).unwrap(),
        format!("{}\n", zsh_line(&script))
    );
    assert_eq!(
        b.recorded("zsh")["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| file["path"].clone())
            .collect::<Vec<_>>(),
        [json!(script)]
    );
}

// the record against the disk

#[tokio::test]
async fn rewrites_a_recorded_script_someone_deleted() {
    let b = Sandbox::new();
    let script = b.script("bash");
    completion_run(&b, &["install", "bash"]).await;
    fs::remove_file(&script).unwrap();
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the bash completion script in {}.",
                script.display()
            ),
            format!("{} already loads it.", b.home.join(".bashrc").display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(
        fs::read_to_string(&script).unwrap(),
        printed(&b, "bash").await
    );
}

#[tokio::test]
async fn resolves_a_pending_plugins_file_whose_script_and_line_are_in_place_through_the_module() {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    let printed_script = printed(&b, "bash").await;
    b.edit_record("bash", |file| {
        file["state"] = json!("pending");
        file["files"] =
            json!([{ "intended": digest(&printed_script), "path": script, "prior": null }]);
        file["lines"] = json!([{ "intended": bash_line(&script), "path": startup, "prior": null }]);
    });
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!("{} already loads it.", startup.display()),
        ]
    );
    assert_subset(
        &b.recorded("bash"),
        &json!({
            "files": [{ "path": script }],
            "lines": [{ "line": bash_line(&script), "path": startup }],
            "state": "committed",
        }),
    );
}

#[tokio::test]
async fn warns_that_a_moved_script_someone_changed_was_left_in_place() {
    let b = Sandbox::new();
    let old = b.script("bash");
    completion_run(&b, &["install", "bash"]).await;
    fs::write(&old, "edited\n").unwrap();
    let moved = b.root.join("data2");
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().env("XDG_DATA_HOME", &moved.to_string_lossy()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    let left = format!(
        "{} changed since jsonkit completion install wrote it, so it was left in place.",
        old.display()
    );
    assert!(lines(&result.stderr).contains(&left), "{}", result.stderr);
    let marked = result
        .stderr
        .split('\n')
        .find(|line| line.ends_with(&left))
        .unwrap();
    let first = marked.chars().next().unwrap();
    assert!(first == '\u{26a0}' || first == '\u{203c}', "{marked}");
    assert_eq!(marked.chars().nth(1), Some(' '));
    assert_eq!(fs::read_to_string(&old).unwrap(), "edited\n");
}

// the startup line

#[test]
fn quotes_a_script_path_holding_single_quotes_in_each_shells_single_quotes() {
    let curly = ['\u{2018}', '\u{2019}', '\u{201a}', '\u{201b}'];
    let doubled: String = curly
        .iter()
        .map(|quote| format!("{quote}{quote}"))
        .collect();
    let plain: String = curly.iter().collect();
    let script = format!("/home/o'neil/{plain}/jsonkit.ps1");
    let quoted = format!("'/home/o''neil/{doubled}/jsonkit.ps1'");
    let marker = completion_support::install::MARKER;
    assert_eq!(
        startup_line(Shell::Pwsh, "jsonkit", std::path::Path::new(&script)),
        format!("if (Test-Path -LiteralPath {quoted}) {{ . {quoted} }} {marker}")
    );
    assert_eq!(
        startup_line(Shell::Bash, "jsonkit", std::path::Path::new("/o'n/x.bash")),
        format!(
            "if [ -n \"${{BASH_VERSION-}}\" ] && [ -f '/o'\\''n/x.bash' ]; then . '/o'\\''n/x.bash'; fi {marker}"
        )
    );
    assert_eq!(
        startup_line(Shell::Zsh, "jsonkit", std::path::Path::new("/o'n/z/_x")),
        format!(
            "fpath=('/o'\\''n/z' $fpath); if [ -f '/o'\\''n/z/_x' ]; then . '/o'\\''n/z/_x'; fi {marker}"
        )
    );
}

// checks

const HOME_SENTENCE: &str = "jsonkit cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.";

#[tokio::test]
async fn names_home_when_the_paths_need_it_and_it_is_not_absolute() {
    let b = Sandbox::new();
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new().env("HOME", "relative"),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(lines(&result.stderr), [HOME_SENTENCE]);
}

#[tokio::test]
async fn names_home_before_the_installation_record_when_both_need_it() {
    let b = Sandbox::new();
    let result = run(
        &b,
        &["completion", "install", "bash"],
        Scenario::new()
            .env("HOME", "relative")
            .unset("XDG_STATE_HOME"),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(lines(&result.stderr), [HOME_SENTENCE]);
}

#[tokio::test]
async fn refuses_a_file_in_the_way_before_it_asks_powershell_for_its_profile() {
    let b = Sandbox::new();
    let script = b.script("pwsh");
    fs::create_dir_all(script.parent().unwrap()).unwrap();
    fs::write(&script, "mine\n").unwrap();
    let empty = b.root.join("empty");
    fs::create_dir(&empty).unwrap();
    let result = run(
        &b,
        &["completion", "install", "pwsh"],
        Scenario::new().env("PATH", &empty.to_string_lossy()),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "{} was not installed by jsonkit completion install.",
                script.display()
            ),
            in_the_way("install", "pwsh"),
        ]
    );
}

#[tokio::test]
async fn refuses_a_file_in_the_way_before_it_judges_the_startup_file() {
    let b = Sandbox::new();
    let script = b.script("bash");
    fs::create_dir_all(script.parent().unwrap()).unwrap();
    fs::write(&script, "mine\n").unwrap();
    fs::create_dir(b.home.join(".bashrc")).unwrap();
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "{} was not installed by jsonkit completion install.",
                script.display()
            ),
            in_the_way("install", "bash"),
        ]
    );
}

#[tokio::test]
async fn needs_no_home_when_absolute_variables_name_every_path() {
    let b = Sandbox::new();
    let zdotdir = b.root.join("zdot");
    let result = run(
        &b,
        &["completion", "install", "zsh"],
        Scenario::new()
            .env("HOME", "relative")
            .env("ZDOTDIR", &zdotdir.to_string_lossy()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(zdotdir.join(".zshrc").exists());
}

#[tokio::test]
async fn refuses_completion_on_win32_with_exit_1_naming_the_print_command() {
    let cases: [(&[&str], &str); 6] = [
        (&["install", "zsh"], "zsh"),
        (&["install", "pwsh"], "powershell"),
        (&["install"], "powershell"),
        (&["update"], "powershell"),
        (&["uninstall", "bash"], "bash"),
        (&["uninstall"], "powershell"),
    ];
    for (words, printer) in cases {
        let b = Sandbox::new();
        let mut argv = vec!["completion"];
        argv.extend_from_slice(words);
        let result = run(&b, &argv, Scenario::new().unset("SHELL").platform("win32")).await;
        assert_eq!(result.status, 1, "{words:?}");
        assert_eq!(result.stdout, "", "{words:?}");
        assert_eq!(
            lines(&result.stderr),
            [format!(
                "jsonkit completion installs bash, zsh, fish, and pwsh completion on Linux and macOS. Print the script with jsonkit completion {printer} and load it yourself."
            )],
            "{words:?}"
        );
        assert!(names_in(&b.data).is_empty() && names_in(&b.state).is_empty());
        assert!(names_in(&b.home).is_empty());
    }
}

#[tokio::test]
async fn prints_the_powershell_script_on_win32() {
    let b = Sandbox::new();
    let result = run(
        &b,
        &["completion", "powershell"],
        Scenario::new().platform("win32"),
    )
    .await;
    assert_eq!((result.status, result.stderr.as_str()), (0, ""));
    assert_eq!(result.stdout, printed(&b, "powershell").await);
}

#[tokio::test]
async fn refuses_a_damaged_plugins_file_on_install_naming_install() {
    let b = Sandbox::new();
    let record = b.record_path("bash");
    fs::create_dir_all(record.parent().unwrap()).unwrap();
    fs::write(&record, "not json").unwrap();
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "{} cannot be read, so jsonkit will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run jsonkit completion install again.",
            record.display()
        )]
    );
    assert!(names_in(&b.data).is_empty());
}

// files the record does not list

#[tokio::test]
async fn refuses_an_unrecorded_file_at_the_scripts_path_for_install_and_changes_nothing() {
    let b = Sandbox::new();
    let script = b.script("bash");
    fs::create_dir_all(script.parent().unwrap()).unwrap();
    fs::write(&script, "mine\n").unwrap();
    fs::write(b.home.join(".bashrc"), "set -o vi\n").unwrap();
    let before = (tree(&b.home), tree(&b.data));
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "{} was not installed by jsonkit completion install.",
                script.display()
            ),
            in_the_way("install", "bash"),
        ]
    );
    assert_eq!((tree(&b.home), tree(&b.data)), before);
}

#[tokio::test]
async fn refuses_a_recorded_script_changed_since_for_install_and_update_and_changes_nothing() {
    let b = Sandbox::new();
    let script = b.script("bash");
    completion_run(&b, &["install", "bash"]).await;
    fs::write(&script, "edited\n").unwrap();
    let before = b.trees();
    let installing = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(installing.status, 1);
    assert_eq!(
        lines(&installing.stderr),
        [
            format!(
                "{} changed since jsonkit completion install wrote it.",
                script.display()
            ),
            in_the_way("install", "bash"),
        ]
    );
    let updating = completion_run(&b, &["update"]).await;
    assert_eq!(updating.status, 1);
    assert_eq!(
        lines(&updating.stderr),
        [
            format!(
                "{} changed since jsonkit completion install wrote it.",
                script.display()
            ),
            in_the_way("update", "bash"),
        ]
    );
    assert_eq!(b.trees(), before);
}

#[tokio::test]
async fn fails_update_for_every_shell_when_one_shells_script_was_edited() {
    let b = Sandbox::new();
    completion_run(&b, &["install", "bash"]).await;
    completion_run(&b, &["install", "zsh"]).await;
    fs::write(b.script("zsh"), "edited\n").unwrap();
    // An older script in Bash's file, so an update would otherwise rewrite it.
    fs::write(b.script("bash"), "old bash\n").unwrap();
    let bash = b.script("bash");
    b.edit_record("bash", |file| {
        file["files"] = json!([{ "digest": digest("old bash\n"), "path": bash }]);
    });
    let before = b.trees();
    let result = completion_run(&b, &["update"]).await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "{} changed since jsonkit completion install wrote it.",
                b.script("zsh").display()
            ),
            in_the_way("update", "zsh"),
        ]
    );
    assert_eq!(b.trees(), before);
}
