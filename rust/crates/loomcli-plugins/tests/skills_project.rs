//! Ports the `project installs` cases of `skills.test.ts`: `install --project` from a repository,
//! the never-the-global-folder guard, replacement of what is at a project folder, and the
//! `--directory` option. The two cases that need no `.git` above the sandbox run only where no
//! stray `.git` sits above the system's temporary folder, as the reference's process fixture
//! traps `lstat` at its ceiling.

#![cfg(feature = "skills")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod skills_support;

use std::fs;
use std::os::unix::fs::symlink;

use skills_support::{
    AGENTS, CLAUDE, Scenario, entry, file, folder_of, git_above, holding, lines, loaded, mode_of,
    project_folder, run, sandbox, tree, written,
};

fn guard(path: &std::path::Path) -> String {
    format!(
        "notes skills install --project would write to {}, the folder notes skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.",
        path.display()
    )
}

fn written_tree() -> std::collections::BTreeMap<String, String> {
    holding(&written())
}

#[tokio::test]
async fn writes_to_the_root_that_holds_a_git_directory_from_a_subdirectory() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    let start = box_.repo.join("packages").join("app");
    fs::create_dir_all(&start).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--project"],
        &Scenario::default().cwd(&start),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Installed notes for claude in {}.",
                project_folder(&box_.repo, CLAUDE).display()
            ),
            format!(
                "Installed notes for agents in {}.",
                project_folder(&box_.repo, AGENTS).display()
            ),
        ]
    );
    assert_eq!(tree(&project_folder(&box_.repo, CLAUDE)), written_tree());
    assert_eq!(
        mode_of(&project_folder(&box_.repo, AGENTS).join("scripts/run.sh")),
        0o755
    );
    assert!(!box_.state.join("notes").exists());
}

#[tokio::test]
async fn treats_a_git_file_as_the_root_marker() {
    let box_ = sandbox();
    fs::write(box_.repo.join(".git"), "gitdir: elsewhere\n").unwrap();
    let start = box_.repo.join("sub");
    fs::create_dir(&start).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--project", "--agent", "agents"],
        &Scenario::default().cwd(&start),
    )
    .await;
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Installed notes for agents in {}.",
            project_folder(&box_.repo, AGENTS).display()
        )]
    );
}

#[tokio::test]
async fn writes_to_the_start_when_no_git_is_above_it() {
    let box_ = sandbox();
    if git_above(&box_) {
        eprintln!("skipped: a .git entry sits above the temporary folder");
        return;
    }
    let start = box_.repo.join("sub");
    fs::create_dir(&start).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--project", "--agent", "claude"],
        &Scenario::default().cwd(&start),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(tree(&project_folder(&start, CLAUDE)), written_tree());
}

#[tokio::test]
async fn starts_the_walk_at_the_directory_c_names() {
    let box_ = sandbox();
    let other = box_.root.join("other");
    fs::create_dir_all(other.join(".git")).unwrap();
    fs::create_dir(other.join("deep")).unwrap();
    let deep = other.join("deep").to_string_lossy().into_owned();
    let result = run(
        &box_,
        &[
            "skills",
            "install",
            "--project",
            "-C",
            &deep,
            "--agent",
            "claude",
        ],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(tree(&project_folder(&other, CLAUDE)), written_tree());
    let relative = run(
        &box_,
        &[
            "skills",
            "install",
            "--project",
            "--directory",
            "../other",
            "--agent",
            "claude",
        ],
        &Scenario::default(),
    )
    .await;
    assert_eq!(relative.status, 0);
    assert_eq!(
        lines(&relative.stderr),
        [format!(
            "Installed notes for claude in {}, replacing the copy that was there.",
            project_folder(&other, CLAUDE).display()
        )]
    );
}

#[tokio::test]
async fn exits_2_for_a_c_directory_that_is_missing_or_is_a_file() {
    let box_ = sandbox();
    let missing = box_.root.join("missing");
    let result = run(
        &box_,
        &[
            "skills",
            "install",
            "--project",
            "-C",
            &missing.to_string_lossy(),
        ],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 2);
    assert_eq!(
        lines(&result.stderr)[0],
        format!(
            "notes: Option \"--directory\" names {}, which is not a directory. Name a directory that exists.",
            missing.display()
        )
    );
    assert!(loaded(&box_).is_empty());
    let plain = box_.root.join("file");
    fs::write(&plain, "x").unwrap();
    let result = run(
        &box_,
        &[
            "skills",
            "install",
            "--project",
            "-C",
            &plain.to_string_lossy(),
        ],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 2);
}

#[tokio::test]
async fn exits_2_for_c_without_project() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["skills", "install", "-C", &box_.repo.to_string_lossy()],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 2);
    assert_eq!(
        lines(&result.stderr)[0],
        "notes: Option \"--directory\" needs --project. Add --project, or leave out --directory."
    );
    assert!(loaded(&box_).is_empty());
}

#[tokio::test]
async fn refuses_from_a_home_folder_that_holds_git_and_writes_nothing() {
    let box_ = sandbox();
    fs::create_dir(box_.home.join(".git")).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--project"],
        &Scenario::default().cwd(&box_.home),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [guard(&folder_of(&box_, CLAUDE, "notes"))]
    );
    assert!(!box_.home.join(".claude").exists());
    assert!(loaded(&box_).is_empty());
}

#[tokio::test]
async fn refuses_from_a_home_folder_with_no_git_above_it() {
    let box_ = sandbox();
    if git_above(&box_) {
        eprintln!("skipped: a .git entry sits above the temporary folder");
        return;
    }
    let result = run(
        &box_,
        &["skills", "install", "--project", "--agent", "agents"],
        &Scenario::default().cwd(&box_.home),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [guard(&folder_of(&box_, AGENTS, "notes"))]
    );
}

#[tokio::test]
async fn refuses_a_repository_whose_claude_links_to_the_home_folders_claude() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    run(&box_, &["skills", "install"], &Scenario::default()).await;
    let before = tree(&box_.home.join(".claude"));
    symlink(box_.home.join(".claude"), box_.repo.join(".claude")).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--project"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 1);
    assert_eq!(
        lines(&result.stderr),
        [guard(&folder_of(&box_, CLAUDE, "notes"))]
    );
    assert_eq!(tree(&box_.home.join(".claude")), before);
}

#[tokio::test]
async fn refuses_a_repository_reached_through_a_linked_root() {
    let box_ = sandbox();
    fs::create_dir(box_.home.join(".git")).unwrap();
    let alias = box_.root.join("alias");
    symlink(&box_.home, &alias).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--project", "--agent", "claude"],
        &Scenario::default().cwd(&alias),
    )
    .await;
    assert_eq!(result.status, 1);
    assert!(!box_.home.join(".claude").exists());
}

#[tokio::test]
async fn removes_a_link_inside_the_folder_as_a_link_and_leaves_the_directory_it_pointed_at() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    let argv = ["skills", "install", "--project", "--agent", "claude"];
    run(&box_, &argv, &Scenario::default()).await;
    fs::write(box_.elsewhere.join("keep.md"), "keep").unwrap();
    let before = tree(&box_.elsewhere);
    symlink(
        &box_.elsewhere,
        project_folder(&box_.repo, CLAUDE).join("link"),
    )
    .unwrap();
    let result = run(&box_, &argv, &Scenario::default()).await;
    assert_eq!(result.status, 0);
    assert_eq!(tree(&box_.elsewhere), before);
    assert_eq!(tree(&project_folder(&box_.repo, CLAUDE)), written_tree());
}

#[tokio::test]
async fn removes_a_dropped_file_and_an_added_one_and_prints_the_replacing_line() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    let argv = ["skills", "install", "--project", "--agent", "claude"];
    run(&box_, &argv, &Scenario::default()).await;
    fs::write(project_folder(&box_.repo, CLAUDE).join("mine.md"), "mine").unwrap();
    let next = Scenario::default().skills(vec![entry("notes", vec![file("SKILL.md", "v2\n")])]);
    let result = run(&box_, &argv, &next).await;
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Installed notes for claude in {}, replacing the copy that was there.",
            project_folder(&box_.repo, CLAUDE).display()
        )]
    );
    assert_eq!(
        tree(&project_folder(&box_.repo, CLAUDE)),
        holding(&[("SKILL.md", "file 644 v2\n")])
    );
    let names: Vec<_> = fs::read_dir(box_.repo.join(".claude").join("skills"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, ["notes"]);
}

#[tokio::test]
async fn replaces_a_symbolic_link_at_the_folder_without_touching_its_target() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    fs::write(box_.elsewhere.join("keep.md"), "keep").unwrap();
    let before = tree(&box_.elsewhere);
    fs::create_dir_all(box_.repo.join(".claude").join("skills")).unwrap();
    symlink(&box_.elsewhere, project_folder(&box_.repo, CLAUDE)).unwrap();
    let result = run(
        &box_,
        &["skills", "install", "--project", "--agent", "claude"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Installed notes for claude in {}, replacing the copy that was there.",
            project_folder(&box_.repo, CLAUDE).display()
        )]
    );
    assert_eq!(tree(&box_.elsewhere), before);
    assert_eq!(tree(&project_folder(&box_.repo, CLAUDE)), written_tree());
}

#[tokio::test]
async fn writes_nothing_to_the_installation_record() {
    let box_ = sandbox();
    fs::create_dir(box_.repo.join(".git")).unwrap();
    run(
        &box_,
        &["skills", "install", "--project"],
        &Scenario::default(),
    )
    .await;
    assert!(!box_.state.join("notes").exists());
}
