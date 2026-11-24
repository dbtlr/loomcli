//! Ports `completion-install.test.ts`, part three: `uninstall`.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;
use std::os::unix::fs::symlink;

use completion_support::install::{
    Sandbox, Scenario, answer_of, bash_line, completion_run, digest, fake_pwsh, lines, names_in,
    printed, run, tree, zsh_line,
};
use serde_json::json;

fn text(path: &std::path::Path) -> String {
    fs::read_to_string(path).unwrap()
}

#[tokio::test]
async fn removes_the_script_the_line_and_each_created_folder_leaving_the_startup_file_as_it_was() {
    let b = Sandbox::new();
    let startup = b.home.join(".zshrc");
    fs::write(&startup, "setopt autocd\n").unwrap();
    completion_run(&b, &["install", "zsh"]).await;
    let result = completion_run(&b, &["uninstall", "zsh"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!("Removed {}.", b.script("zsh").display()),
            format!("Removed the line from {}.", startup.display()),
        ]
    );
    assert_eq!(text(&startup), "setopt autocd\n");
    assert!(names_in(&b.data).is_empty());
    assert!(!b.record_path("zsh").exists());
}

#[tokio::test]
async fn never_records_or_removes_a_line_the_operator_added_by_hand_to_a_file_it_may_change() {
    let b = Sandbox::new();
    let script = b.script("zsh");
    let startup = b.home.join(".zshrc");
    let content = format!("setopt autocd\n{}\n", zsh_line(&script));
    fs::write(&startup, &content).unwrap();
    let installing = completion_run(&b, &["install", "zsh"]).await;
    assert_eq!(installing.status, 0, "{}", installing.stderr);
    assert_eq!(
        lines(&installing.stderr),
        [
            format!(
                "Installed the zsh completion script in {}.",
                script.display()
            ),
            format!("{} already loads it.", startup.display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(b.recorded("zsh")["lines"], json!([]));
    let removing = completion_run(&b, &["uninstall", "zsh"]).await;
    assert_eq!(removing.status, 0, "{}", removing.stderr);
    assert_eq!(
        lines(&removing.stderr),
        [format!("Removed {}.", script.display())]
    );
    assert_eq!(text(&startup), content);
}

#[tokio::test]
async fn leaves_an_edited_line_and_an_edited_script_stating_each() {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    completion_run(&b, &["install", "bash"]).await;
    fs::write(&startup, format!("{} # mine\n", bash_line(&script))).unwrap();
    fs::write(&script, "edited\n").unwrap();
    let result = completion_run(&b, &["uninstall", "bash"]).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "{} changed since jsonkit completion install wrote it, so it was left in place.",
                script.display()
            ),
            format!(
                "{} no longer holds the line jsonkit completion install added, so it was left as it is.",
                startup.display()
            ),
        ]
    );
    assert_eq!(text(&script), "edited\n");
    assert_eq!(text(&startup), format!("{} # mine\n", bash_line(&script)));
}

#[tokio::test]
async fn states_a_script_already_gone() {
    let b = Sandbox::new();
    completion_run(&b, &["install", "fish"]).await;
    fs::remove_file(b.script("fish")).unwrap();
    let result = completion_run(&b, &["uninstall"]).await;
    assert_eq!(
        lines(&result.stderr),
        [format!("{} was already gone.", b.script("fish").display())]
    );
}

#[tokio::test]
async fn removes_every_installed_shell_with_no_shell_and_only_the_named_one_otherwise() {
    let b = Sandbox::new();
    completion_run(&b, &["install", "bash"]).await;
    completion_run(&b, &["install", "zsh"]).await;
    let one = completion_run(&b, &["uninstall", "zsh"]).await;
    assert_eq!(one.status, 0, "{}", one.stderr);
    assert!(!b.script("zsh").exists());
    assert!(b.script("bash").exists());
    assert_eq!(
        text(&b.home.join(".bashrc")),
        format!("{}\n", bash_line(&b.script("bash")))
    );
    completion_run(&b, &["install", "zsh"]).await;
    let every = completion_run(&b, &["uninstall"]).await;
    assert_eq!(every.status, 0, "{}", every.stderr);
    assert_eq!(
        lines(&every.stderr),
        [
            format!("Removed {}.", b.script("bash").display()),
            format!(
                "Removed the line from {}.",
                b.home.join(".bashrc").display()
            ),
            format!("Removed {}.", b.script("zsh").display()),
            format!("Removed the line from {}.", b.home.join(".zshrc").display()),
        ]
    );
    assert!(names_in(&b.data).is_empty());
}

#[tokio::test]
async fn after_installing_two_shells_uninstalling_them_in_either_order_leaves_no_folder_either_created()
 {
    let orders: [[&str; 4]; 6] = [
        ["zsh", "bash", "zsh", "bash"],
        ["zsh", "bash", "bash", "zsh"],
        ["bash", "zsh", "bash", "zsh"],
        ["bash", "zsh", "zsh", "bash"],
        ["bash", "pwsh", "pwsh", "bash"],
        ["pwsh", "bash", "pwsh", "bash"],
    ];
    for order in orders {
        let b = Sandbox::new();
        let bin = b.root.join("bin");
        let profile = b.home.join("profile.ps1");
        let (_, fake) = fake_pwsh(&bin, &answer_of(&profile.to_string_lossy()), 0, false);
        for (index, shell) in order.iter().enumerate() {
            let verb = if index < 2 { "install" } else { "uninstall" };
            let scenario = Scenario::new().pwsh_env(&b, &bin).program(fake.clone());
            let result = run(&b, &["completion", verb, shell], scenario).await;
            assert_eq!(
                result.status, 0,
                "{order:?} {verb} {shell}: {}",
                result.stderr
            );
        }
        assert!(names_in(&b.data).is_empty(), "{order:?}");
    }
}

#[tokio::test]
async fn hands_a_folder_to_a_shell_whose_script_reaches_it_through_a_symbolic_link_so_uninstalling_both_leaves_no_folder()
 {
    let b = Sandbox::new();
    let alias = b.root.join("alias");
    symlink(&b.data, &alias).unwrap();
    let through_link = || Scenario::new().env("XDG_DATA_HOME", &alias.to_string_lossy());
    assert_eq!(completion_run(&b, &["install", "zsh"]).await.status, 0);
    assert_eq!(
        run(&b, &["completion", "install", "bash"], through_link())
            .await
            .status,
        0
    );
    assert_eq!(completion_run(&b, &["uninstall", "zsh"]).await.status, 0);
    assert_eq!(
        run(&b, &["completion", "uninstall", "bash"], through_link())
            .await
            .status,
        0
    );
    assert!(names_in(&b.data).is_empty());
}

#[tokio::test]
async fn deletes_a_pending_file_that_records_nothing_and_the_empty_folders_it_created() {
    for words in [&["uninstall"][..], &["uninstall", "bash"][..]] {
        let b = Sandbox::new();
        let script = b.script("bash");
        let record = b.record_path("bash");
        let created = [
            b.data.join("jsonkit"),
            script.parent().unwrap().to_path_buf(),
        ];
        for directory in &created {
            fs::create_dir(directory).unwrap();
        }
        fs::create_dir_all(record.parent().unwrap()).unwrap();
        fs::write(
            &record,
            format!(
                "{}\n",
                json!({
                    "directories": created,
                    "files": [{ "intended": digest(&printed(&b, "bash").await), "path": script, "prior": null }],
                    "format": 1,
                    "lines": [{ "intended": bash_line(&script), "path": b.home.join(".bashrc"), "prior": null }],
                    "state": "pending",
                })
            ),
        )
        .unwrap();
        let result = completion_run(&b, words).await;
        assert_eq!(result.status, 0, "{words:?}: {}", result.stderr);
        assert_eq!(
            lines(&result.stderr),
            ["jsonkit has no completion installed, so there is nothing to remove."],
            "{words:?}"
        );
        assert!(!record.exists(), "{words:?}");
        assert!(names_in(&b.data).is_empty(), "{words:?}");
    }
}

#[tokio::test]
async fn fails_with_no_shell_and_changes_nothing_when_one_shells_plugins_file_is_damaged() {
    let b = Sandbox::new();
    completion_run(&b, &["install", "bash"]).await;
    completion_run(&b, &["install", "zsh"]).await;
    fs::write(b.record_path("bash"), "{\"format\":1").unwrap();
    let before = (tree(&b.home), tree(&b.data), tree(&b.state));
    let result = completion_run(&b, &["uninstall"]).await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "{} cannot be read, so jsonkit will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run jsonkit completion uninstall again.",
            b.record_path("bash").display()
        )]
    );
    assert_eq!((tree(&b.home), tree(&b.data), tree(&b.state)), before);
}
