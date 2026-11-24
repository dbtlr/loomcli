//! `manpage uninstall`, the nothing-to lines, and the record checks, ported from the `uninstall
//! and the nothing-to lines` and `record and platform checks` groups of the reference's
//! `manpage.test.ts`.

#![cfg(all(feature = "manpage", feature = "help"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod manpage_support;

use std::fs;

use manpage_support::{
    DEFAULT_SET, Scenario, folder_of, laned, lines, names_in, raw_lines, record_path, run, sandbox,
    snapshot,
};

#[tokio::test]
async fn with_nothing_recorded_update_and_uninstall_print_their_nothing_to_lines_and_exit_0() {
    let box_ = sandbox();
    let updated = run(&box_, &["manpage", "update"], &Scenario::default()).await;
    assert_eq!(updated.status, 0);
    assert_eq!(updated.stdout, "");
    assert_eq!(
        lines(&updated.stderr),
        [
            "notes has no man pages installed, so there is nothing to update. Run notes manpage install to install them."
        ]
    );
    let removed = run(&box_, &["manpage", "uninstall"], &Scenario::default()).await;
    assert_eq!(removed.status, 0);
    assert_eq!(
        lines(&removed.stderr),
        ["notes has no man pages installed, so there is nothing to remove."]
    );
}

#[tokio::test]
async fn with_every_recorded_page_deleted_uninstall_prints_the_nothing_to_remove_line_and_deletes_the_record()
 {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    for file in DEFAULT_SET {
        fs::remove_file(folder_of(&box_.home).join(file)).unwrap();
    }
    let result = run(&box_, &["manpage", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        ["notes has no man pages installed, so there is nothing to remove."]
    );
    assert!(!record_path(&box_).exists());
}

#[tokio::test]
async fn uninstall_removes_unchanged_pages_and_empty_created_folders_and_keeps_an_edited_page() {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let folder = folder_of(&box_.home);
    fs::write(folder.join("notes-ping.1"), "edited\n").unwrap();
    let result = run(&box_, &["manpage", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        raw_lines(&result.stderr),
        [
            laned(
                "success",
                &format!("Removed 7 man pages from {}.", folder.display())
            ),
            laned(
                "warning",
                &format!(
                    "{} changed since notes manpage install wrote it, so it was left in place.",
                    folder.join("notes-ping.1").display()
                )
            ),
        ]
    );
    assert_eq!(names_in(&folder), ["notes-ping.1"]);
    assert!(!record_path(&box_).exists());
}

#[tokio::test]
async fn uninstall_removes_every_created_folder_then_empty_and_leaves_a_man1_folder_that_holds_another_file()
 {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let removed = run(&box_, &["manpage", "uninstall"], &Scenario::default()).await;
    assert_eq!(removed.status, 0, "{}", removed.stderr);
    assert!(names_in(&box_.home).is_empty());
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    fs::write(folder_of(&box_.home).join("other.1"), "theirs\n").unwrap();
    run(&box_, &["manpage", "uninstall"], &Scenario::default()).await;
    assert_eq!(names_in(&folder_of(&box_.home)), ["other.1"]);
}

#[tokio::test]
async fn a_damaged_manpage_json_fails_each_child_with_the_pinned_sentence_and_writes_nothing() {
    for (verb, named) in [
        ("install", "install"),
        ("update", "install"),
        ("uninstall", "uninstall"),
    ] {
        let box_ = sandbox();
        fs::create_dir_all(box_.state.join("notes").join("installation")).unwrap();
        fs::write(record_path(&box_), "{\"format\":1,\"state\":").unwrap();
        let before = snapshot(&box_);
        let result = run(&box_, &["manpage", verb], &Scenario::default()).await;
        assert_eq!(result.status, 1, "{verb}");
        assert!(
            result.stderr.contains(&format!(
                "{} cannot be read, so notes will not change the man pages it lists. Remove it and the pages it lists, then run notes manpage {named} again.",
                record_path(&box_).display()
            )),
            "{verb}: {}",
            result.stderr
        );
        assert_eq!(snapshot(&box_), before, "{verb}");
    }
}
