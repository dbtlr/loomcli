//! Ports the two umask cases of `manpage.test.ts`: `generate` and `install` create folders with
//! mode 755 and write pages with mode 644 under umask 077. The umask is process-wide, so these
//! cases run one after another in one test of a process of their own.

#![cfg(all(feature = "manpage", feature = "help"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod manpage_support;

use rustix::fs::Mode;
use rustix::process::umask;

use manpage_support::{
    DEFAULT_SET, Scenario, folder_of, laned, lines, mode_of, names_in, raw_lines, recorded_paths,
    run, sandbox, sorted_set,
};

async fn generate_under_umask_077() {
    let box_ = sandbox();
    let previous = umask(Mode::from_raw_mode(0o077));
    let result = run(
        &box_,
        &["manpage", "generate", "--out", "build/man"],
        &Scenario::default(),
    )
    .await;
    umask(previous);
    let folder = box_.cwd.join("build").join("man");
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(result.stdout, "");
    assert_eq!(
        lines(&result.stderr),
        [format!("Wrote 8 man pages to {}.", folder.display())]
    );
    assert_eq!(mode_of(&box_.cwd.join("build")), 0o755);
    assert_eq!(mode_of(&folder), 0o755);
    assert_eq!(names_in(&folder), sorted_set());
    for file in DEFAULT_SET {
        assert_eq!(mode_of(&folder.join(file)), 0o644, "{file}");
    }
    assert!(!box_.state.join("notes").exists());
}

async fn install_under_umask_077() {
    let box_ = sandbox();
    let folder = folder_of(&box_.home);
    let previous = umask(Mode::from_raw_mode(0o077));
    let result = run(&box_, &["manpage", "install"], &Scenario::default()).await;
    umask(previous);
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        raw_lines(&result.stderr),
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
    for file in DEFAULT_SET {
        assert_eq!(mode_of(&folder.join(file)), 0o644, "{file}");
    }
    assert_eq!(recorded_paths(&box_).len(), 8);
}

#[tokio::test]
async fn modes_hold_whatever_the_umask() {
    generate_under_umask_077().await;
    install_under_umask_077().await;
}
