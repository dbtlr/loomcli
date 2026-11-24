//! `manpage generate`, ported from the `generate` group of the reference's `manpage.test.ts`. The
//! umask case lives in `manpage_umask.rs`, because the umask is process-wide.

#![cfg(all(feature = "manpage", feature = "help"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod manpage_support;

use std::fs;
use std::os::unix::fs::symlink;

use manpage_support::{
    DEFAULT_SET, Scenario, folder_of, lines, mode_of, names_in, run, sandbox, sorted_set, tree,
};

#[tokio::test]
async fn generate_creates_a_missing_folder_and_writes_every_page() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["manpage", "generate", "--out", "build/man"],
        &Scenario::default(),
    )
    .await;
    let folder = box_.cwd.join("build").join("man");
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    assert_eq!(
        lines(&result.stderr),
        [format!("Wrote 8 man pages to {}.", folder.display())]
    );
    assert_eq!(names_in(&folder), sorted_set());
    assert!(!box_.state.join("notes").exists());
}

#[tokio::test]
async fn generate_replaces_a_page_and_a_symbolic_link_of_the_same_name_and_leaves_every_other_file()
{
    let box_ = sandbox();
    let folder = box_.root.join("out");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("notes.1"), "old page\n").unwrap();
    fs::write(box_.root.join("target"), "kept\n").unwrap();
    symlink(box_.root.join("target"), folder.join("notes-ping.1")).unwrap();
    fs::write(folder.join("README"), "mine\n").unwrap();
    let result = run(
        &box_,
        &["manpage", "generate", "--out", &folder.to_string_lossy()],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert!(
        fs::read_to_string(folder.join("notes.1"))
            .unwrap()
            .starts_with(".TH \"NOTES\" \"1\" \"\"")
    );
    assert!(
        fs::symlink_metadata(folder.join("notes-ping.1"))
            .unwrap()
            .is_file()
    );
    assert_eq!(
        fs::read_to_string(box_.root.join("target")).unwrap(),
        "kept\n"
    );
    assert_eq!(fs::read_to_string(folder.join("README")).unwrap(), "mine\n");
    assert!(
        names_in(&folder).iter().all(|name| !name.starts_with('.')),
        "a staging file was left behind"
    );
}

#[tokio::test]
async fn two_runs_under_another_home_term_columns_and_locale_write_the_same_bytes() {
    let box_ = sandbox();
    let first = box_.root.join("first");
    let second = box_.root.join("second");
    let one = run(
        &box_,
        &["manpage", "generate", "--out", &first.to_string_lossy()],
        &Scenario::default(),
    )
    .await;
    assert_eq!(one.status, 0, "{}", one.stderr);
    let other = Scenario::default()
        .env("COLUMNS", "40")
        .env("LANG", "de_DE.UTF-8")
        .env("LC_ALL", "de_DE.UTF-8")
        .env("TERM", "dumb")
        .home(box_.other.clone());
    let two = run(
        &box_,
        &["manpage", "generate", "--out", &second.to_string_lossy()],
        &other,
    )
    .await;
    assert_eq!(two.status, 0, "{}", two.stderr);
    assert_eq!(tree(&second), tree(&first));
}

#[tokio::test]
async fn generate_and_install_write_identical_pages() {
    let box_ = sandbox();
    let out = box_.root.join("out");
    run(
        &box_,
        &["manpage", "generate", "--out", &out.to_string_lossy()],
        &Scenario::default(),
    )
    .await;
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    for file in DEFAULT_SET {
        assert_eq!(
            fs::read_to_string(folder_of(&box_.home).join(file)).unwrap(),
            fs::read_to_string(out.join(file)).unwrap(),
            "{file}"
        );
    }
}

#[tokio::test]
async fn an_out_that_names_a_file_fails_with_the_pinned_sentence_and_writes_nothing() {
    let box_ = sandbox();
    let file = box_.cwd.join("man");
    fs::write(&file, "a file\n").unwrap();
    let result = run(
        &box_,
        &["manpage", "generate", "--out", "man"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 1);
    assert!(
        result.stderr.contains(&format!(
            "{} is not a folder. Name a folder, or a path where notes can create one.",
            file.display()
        )),
        "{}",
        result.stderr
    );
    assert_eq!(names_in(&box_.cwd), ["man"]);
    assert_eq!(fs::read_to_string(&file).unwrap(), "a file\n");
}

#[tokio::test]
async fn an_out_under_a_file_fails_with_the_pinned_sentence_and_writes_nothing() {
    for out in ["man/sub", "man/sub/deeper"] {
        let box_ = sandbox();
        let file = box_.cwd.join("man");
        fs::write(&file, "a file\n").unwrap();
        let result = run(
            &box_,
            &["manpage", "generate", "--out", out],
            &Scenario::default(),
        )
        .await;
        assert_eq!(result.status, 1, "{out}");
        assert!(
            result.stderr.contains(&format!(
                "{} is not a folder. Name a folder, or a path where notes can create one.",
                box_.cwd.join(out).display()
            )),
            "{out}: {}",
            result.stderr
        );
        assert_eq!(names_in(&box_.cwd), ["man"], "{out}");
        assert_eq!(fs::read_to_string(&file).unwrap(), "a file\n");
    }
}

#[tokio::test]
async fn an_out_under_a_symbolic_link_whose_target_is_missing_fails_with_the_pinned_sentence() {
    let box_ = sandbox();
    symlink(box_.cwd.join("missing"), box_.cwd.join("man")).unwrap();
    let result = run(
        &box_,
        &["manpage", "generate", "--out", "man/sub"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 1);
    assert!(
        result.stderr.contains(&format!(
            "{} is not a folder. Name a folder, or a path where notes can create one.",
            box_.cwd.join("man/sub").display()
        )),
        "{}",
        result.stderr
    );
    assert_eq!(names_in(&box_.cwd), ["man"]);
}

#[tokio::test]
async fn a_run_without_out_is_a_usage_error_with_exit_2() {
    let box_ = sandbox();
    let result = run(&box_, &["manpage", "generate"], &Scenario::default()).await;
    assert_eq!(result.status, 2);
}

#[tokio::test]
async fn an_out_folder_is_resolved_against_the_working_directory_without_dot_parts() {
    let box_ = sandbox();
    let result = run(
        &box_,
        &["manpage", "generate", "--out", "./build/../man/"],
        &Scenario::default(),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Wrote 8 man pages to {}.",
            box_.cwd.join("man").display()
        )]
    );
    assert_eq!(mode_of(&box_.cwd.join("man").join("notes.1")), 0o644);
}
