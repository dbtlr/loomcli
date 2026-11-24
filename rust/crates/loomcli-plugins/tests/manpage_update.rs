//! Moving and changing the set, ported from the `moving and changing the set` group of the
//! reference's `manpage.test.ts`: `install` and `update` after the home or the Commands change.

#![cfg(all(feature = "manpage", feature = "help"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod manpage_support;

use std::fs;

use manpage_support::{
    DEFAULT_SET, Scenario, digest_of, folder_of, laned, lines, names_in, raw_lines, record_path,
    run, sandbox, snapshot, sorted_set,
};

#[tokio::test]
async fn on_linux_after_home_changes_with_xdg_state_home_held_install_moves_the_set_to_the_new_home()
 {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let result = run(
        &box_,
        &["manpage", "install"],
        &Scenario::default().home(box_.other.clone()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    let mut expected = vec![format!(
        "Installed 8 man pages in {}.",
        folder_of(&box_.other).display()
    )];
    expected.extend(
        DEFAULT_SET
            .iter()
            .map(|file| format!("Removed {}.", folder_of(&box_.home).join(file).display())),
    );
    expected.push("Read them with man notes.".to_owned());
    assert_eq!(lines(&result.stderr), expected);
    assert!(names_in(&folder_of(&box_.home)).is_empty());
    assert_eq!(names_in(&folder_of(&box_.other)), sorted_set());
}

/// Rewrites the record to list the first three pages under the other home and the rest under the
/// first, as an install killed while it moved the set leaves it.
fn split_record(box_: &manpage_support::Sandbox) {
    let files: Vec<serde_json::Value> = DEFAULT_SET
        .iter()
        .enumerate()
        .map(|(index, file)| {
            let home = if index < 3 { &box_.other } else { &box_.home };
            let path = folder_of(home).join(file);
            serde_json::json!({
                "digest": digest_of(&fs::read_to_string(&path).unwrap()),
                "path": path,
            })
        })
        .collect();
    fs::write(
        record_path(box_),
        format!(
            "{}\n",
            serde_json::json!({
                "directories": [],
                "files": files,
                "format": 1,
                "state": "committed",
            })
        ),
    )
    .unwrap();
}

#[tokio::test]
async fn a_record_with_pages_in_two_folders_fails_update_and_install_puts_the_set_in_one() {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    run(
        &box_,
        &[
            "manpage",
            "generate",
            "--out",
            &folder_of(&box_.other).to_string_lossy(),
        ],
        &Scenario::default(),
    )
    .await;
    split_record(&box_);
    for file in &DEFAULT_SET[..3] {
        fs::remove_file(folder_of(&box_.home).join(file)).unwrap();
    }
    for file in &DEFAULT_SET[3..] {
        fs::remove_file(folder_of(&box_.other).join(file)).unwrap();
    }
    let before = snapshot(&box_);
    let update = run(&box_, &["manpage", "update"], &Scenario::default()).await;
    assert_eq!(update.status, 1);
    assert!(
        update.stderr.contains(&format!(
            "{} lists man pages in more than one folder, so notes manpage update cannot tell where they belong. Run notes manpage install to put them in one folder.",
            record_path(&box_).display()
        )),
        "{}",
        update.stderr
    );
    assert_eq!(snapshot(&box_), before);
    let install = run(&box_, &["manpage", "install"], &Scenario::default()).await;
    assert_eq!(install.status, 0, "{}", install.stderr);
    assert_eq!(names_in(&folder_of(&box_.home)), sorted_set());
    assert!(names_in(&folder_of(&box_.other)).is_empty());
}

#[tokio::test]
async fn uninstall_removes_the_pages_of_both_folders_with_one_removed_line_for_each_folder() {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    run(
        &box_,
        &[
            "manpage",
            "generate",
            "--out",
            &folder_of(&box_.other).to_string_lossy(),
        ],
        &Scenario::default(),
    )
    .await;
    split_record(&box_);
    let result = run(&box_, &["manpage", "uninstall"], &Scenario::default()).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [
            format!(
                "Removed 3 man pages from {}.",
                folder_of(&box_.other).display()
            ),
            format!(
                "Removed 5 man pages from {}.",
                folder_of(&box_.home).display()
            ),
        ]
    );
    assert!(!record_path(&box_).exists());
}

#[tokio::test]
async fn after_a_command_is_removed_install_and_update_remove_its_unchanged_page_and_keep_an_edited_one()
 {
    for verb in ["install", "update"] {
        let box_ = sandbox();
        run(
            &box_,
            &["manpage", "install"],
            &Scenario::default().commands(&["ping", "sync", "tidy"]),
        )
        .await;
        let folder = folder_of(&box_.home);
        fs::write(folder.join("notes-tidy.1"), "edited\n").unwrap();
        let result = run(
            &box_,
            &["manpage", verb],
            &Scenario::default().commands(&["ping"]),
        )
        .await;
        assert_eq!(result.status, 0, "{verb}: {}", result.stderr);
        let said = raw_lines(&result.stderr);
        let word = if verb == "install" {
            "Installed"
        } else {
            "Updated"
        };
        assert_eq!(
            said[0],
            laned(
                "success",
                &format!("{word} 7 man pages in {}.", folder.display())
            ),
            "{verb}"
        );
        assert!(
            said.contains(&laned(
                "info",
                &format!("Removed {}.", folder.join("notes-sync.1").display())
            )),
            "{verb}: {said:?}"
        );
        assert!(
            said.contains(&laned(
                "warning",
                &format!(
                    "{} changed since notes manpage install wrote it, so it was left in place.",
                    folder.join("notes-tidy.1").display()
                )
            )),
            "{verb}: {said:?}"
        );
        assert!(!folder.join("notes-sync.1").exists(), "{verb}");
        assert_eq!(
            fs::read_to_string(folder.join("notes-tidy.1")).unwrap(),
            "edited\n",
            "{verb}"
        );
    }
}

#[tokio::test]
async fn after_a_command_is_added_update_writes_its_page_into_the_recorded_folder_even_under_a_new_home()
 {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let result = run(
        &box_,
        &["manpage", "update"],
        &Scenario::default()
            .commands(&["ping", "sync", "tidy"])
            .home(box_.other.clone()),
    )
    .await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        lines(&result.stderr),
        [format!(
            "Updated 9 man pages in {}.",
            folder_of(&box_.home).display()
        )]
    );
    assert!(folder_of(&box_.home).join("notes-tidy.1").exists());
    assert!(!box_.other.join(".local").exists());
}

#[tokio::test]
async fn update_rewrites_a_page_to_this_version_and_an_unchanged_set_prints_the_unchanged_line() {
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let page = folder_of(&box_.home).join("notes.1");
    let unchanged = run(&box_, &["manpage", "update"], &Scenario::default()).await;
    assert_eq!(
        lines(&unchanged.stderr),
        [format!(
            "The 8 man pages in {} are unchanged.",
            folder_of(&box_.home).display()
        )]
    );
    run(
        &box_,
        &["manpage", "update"],
        &Scenario::default().version("2.0.0"),
    )
    .await;
    let text = fs::read_to_string(page).unwrap();
    assert_eq!(
        text.split('\n').next().unwrap(),
        ".TH \"NOTES\" \"1\" \"\" \"notes 2.0.0\" \"\""
    );
}

#[tokio::test]
async fn a_set_of_one_page_reads_in_the_singular() {
    // A count of 1 reads `1 man page`; a recorded set of one page reaches it through uninstall.
    let box_ = sandbox();
    run(&box_, &["manpage", "install"], &Scenario::default()).await;
    let folder = folder_of(&box_.home);
    let page = folder.join("notes.1");
    let record = serde_json::json!({
        "directories": [],
        "files": [{
            "digest": digest_of(&fs::read_to_string(&page).unwrap()),
            "path": page,
        }],
        "format": 1,
        "state": "committed",
    });
    fs::write(record_path(&box_), format!("{record}\n")).unwrap();
    let result = run(&box_, &["manpage", "uninstall"], &Scenario::default()).await;
    assert_eq!(
        lines(&result.stderr),
        [format!("Removed 1 man page from {}.", folder.display())]
    );
}
