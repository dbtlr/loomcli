//! Ports the cases of `completion-install.test.ts` that run under a umask: the modes of the
//! installed script and the created folders and the startup file whatever the umask. The umask is
//! process-wide, so these cases run one after another in a process of their own, as the one test of
//! this file.

#![cfg(feature = "completion")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod completion_support;

use std::fs;

use completion_support::install::{
    Sandbox, assert_subset, bash_line, completion_run, lines, mode_of, printed, tree, zsh_line,
};
use loomcli_plugins::completion::test_support::zsh_installed_script;
use rustix::fs::Mode;
use rustix::process::umask;
use serde_json::json;

async fn bash_under(mask: rustix::fs::RawMode) {
    let b = Sandbox::new();
    let script = b.script("bash");
    let startup = b.home.join(".bashrc");
    let previous = umask(Mode::from_raw_mode(mask));
    let result = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(result.status, 0, "{mask:o}: {}", result.stderr);
    assert_eq!(result.stdout, "");
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the bash completion script in {}.",
                script.display()
            ),
            format!("Added a line to {} that loads it.", startup.display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(
        fs::read_to_string(&script).unwrap(),
        printed(&b, "bash").await
    );
    assert_eq!(mode_of(&script), 0o644);
    assert_eq!(mode_of(script.parent().unwrap()), 0o755);
    assert_eq!(mode_of(&b.data.join("jsonkit")), 0o755);
    assert_eq!(
        fs::read_to_string(&startup).unwrap(),
        format!("{}\n", bash_line(&script))
    );
    assert_eq!(mode_of(&startup), 0o644);
    assert_subset(
        &b.recorded("bash"),
        &json!({
            "directories": [b.data.join("jsonkit"), script.parent().unwrap()],
            "files": [{ "path": script }],
            "lines": [{ "line": bash_line(&script), "path": startup }],
            "state": "committed",
        }),
    );
    let before = b.trees();
    let again = completion_run(&b, &["install", "bash"]).await;
    assert_eq!(again.status, 0, "{}", again.stderr);
    assert_eq!(
        lines(&again.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!("{} already loads it.", startup.display()),
        ]
    );
    assert_eq!(b.trees(), before);
    umask(previous);
}

async fn zsh_under(mask: rustix::fs::RawMode) {
    let b = Sandbox::new();
    let script = b.script("zsh");
    let startup = b.home.join(".zshrc");
    fs::write(&startup, "autoload -Uz compinit\ncompinit").unwrap();
    let previous = umask(Mode::from_raw_mode(mask));
    let result = completion_run(&b, &["install", "zsh"]).await;
    assert_eq!(result.status, 0, "{mask:o}: {}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed the zsh completion script in {}.",
                script.display()
            ),
            format!("Added a line to {} that loads it.", startup.display()),
            "Open a new shell to use it.".to_owned(),
        ]
    );
    assert_eq!(
        fs::read_to_string(&script).unwrap(),
        zsh_installed_script("jsonkit")
    );
    assert_eq!(mode_of(&script), 0o644);
    assert_eq!(mode_of(script.parent().unwrap()), 0o755);
    assert_eq!(mode_of(script.parent().unwrap().parent().unwrap()), 0o755);
    assert_eq!(
        fs::read_to_string(&startup).unwrap(),
        format!("autoload -Uz compinit\ncompinit\n{}\n", zsh_line(&script))
    );
    assert_eq!(
        b.recorded("zsh")["lines"],
        json!([{ "line": zsh_line(&script), "path": startup }])
    );
    let before = (tree(&b.home), tree(&b.data));
    let again = completion_run(&b, &["install", "zsh"]).await;
    assert_eq!(
        lines(&again.stderr),
        [
            format!("{} is unchanged.", script.display()),
            format!("{} already loads it.", startup.display()),
        ]
    );
    assert_eq!((tree(&b.home), tree(&b.data)), before);
    umask(previous);
}

/// The one test of this process, so no other case creates a file under a umask it set.
#[test]
fn modes_hold_whatever_the_umask() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    for mask in [0o002, 0o077] {
        runtime.block_on(bash_under(mask));
        runtime.block_on(zsh_under(mask));
    }
}
