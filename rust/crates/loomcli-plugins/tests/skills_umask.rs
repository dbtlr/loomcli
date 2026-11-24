//! Ports the two umask cases of `skills.test.ts` and the project install's modes under umask 077.
//! The umask is process-wide, so these cases run one after another in one test of a process of
//! their own.

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod skills_support;

use std::fs;

use rustix::fs::Mode;
use rustix::process::umask;
use skills_support::{
    AGENTS, CLAUDE, Scenario, folder_of, holding, mode_of, pinned, project_folder, recorded, run,
    sandbox, tree, written,
};

async fn under_umask(mask: u32) -> skills_support::Ran {
    let box_ = sandbox();
    let previous = umask(Mode::from_raw_mode(mask));
    let result = run(&box_, &["skills", "install"], &Scenario::default()).await;
    umask(previous);
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    assert_eq!(
        pinned(&box_, &result.stderr),
        [
            "Installed notes for claude in HOME/.claude/skills/notes.",
            "Installed notes for agents in HOME/.agents/skills/notes.",
        ]
    );
    for target in [CLAUDE, AGENTS] {
        let folder = folder_of(&box_, target, "notes");
        assert_eq!(tree(&folder), holding(&written()), "umask {mask:o}");
        assert_eq!(mode_of(&folder.join("scripts/run.sh")), 0o755);
        assert_eq!(mode_of(&folder.join("SKILL.md")), 0o644);
        let record = recorded(&box_, target);
        assert_eq!(record.state, "committed");
        assert_eq!(record.folders, [folder.to_string_lossy().into_owned()]);
    }
    result
}

async fn project_under_umask_077() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    let previous = umask(Mode::from_raw_mode(0o077));
    let result = run(
        &box_,
        &["skills", "install", "--project", "--agent", "claude"],
        &Scenario::default(),
    )
    .await;
    umask(previous);
    assert_eq!(result.status, 0, "{}", result.stderr);
    let folder = project_folder(&box_.repo, CLAUDE);
    assert_eq!(mode_of(&folder.join("SKILL.md")), 0o644);
    assert_eq!(mode_of(&folder.join("scripts/run.sh")), 0o755);
}

#[tokio::test]
async fn modes_hold_whatever_the_umask() {
    under_umask(0o002).await;
    under_umask(0o077).await;
    project_under_umask_077().await;
}
