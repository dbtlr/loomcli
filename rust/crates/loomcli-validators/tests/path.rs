//! Ports `path.test.ts` and `probe.test.ts`. The outside-a-run cases have no counterpart: a Rust
//! validator always receives its context. A probe that fails any way at all rejects the token.

#![cfg(unix)]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path as FsPath, PathBuf};

use loomcli_core::Validator;
use loomcli_validators::{Path, PathAccess, PathKind, path};
use serde_json::json;
use support::{TempDir, conforms, context_in, published, rejected_with, rejection};

/// What one validation of `token` by `validator` answered over a mock whose cwd is `cwd`.
fn validate(validator: &Path, cwd: &FsPath, token: &str) -> Result<PathBuf, Vec<String>> {
    let context = context_in(&cwd.to_string_lossy(), "UTC");
    validator
        .validate(token, &context)
        .map_err(|issues| issues.into_iter().map(|issue| issue.message).collect())
}

fn refused(message: &str) -> Result<PathBuf, Vec<String>> {
    Err(vec![message.to_owned()])
}

/// Whether the process bypasses permission bits, so an unreadable entry would still read.
fn privileged() -> bool {
    rustix::process::getuid().is_root()
}

#[test]
fn path_publishes_a_nonempty_string_and_nothing_about_the_file_system() {
    let schema = r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1}"#;
    assert_eq!(published(&path()), schema);
    assert_eq!(
        published(&path().access(PathAccess::Read).kind(PathKind::Directory)),
        schema
    );
}

#[test]
fn each_accepted_token_satisfies_the_published_schema() {
    for token in [
        "a",
        ".",
        "/",
        "a/../b/./c",
        "/etc//hosts",
        r"C:\work\a",
        "dir/",
        "\u{1F600}.txt",
        " ",
    ] {
        assert!(
            validate(&path(), FsPath::new("/loom/work"), token).is_ok(),
            "{token:?}"
        );
        assert!(conforms(&path(), &json!(token)), "{token:?}");
    }
}

#[test]
fn the_empty_string_and_a_nul_character_are_rejected_before_anything_is_read() {
    assert_eq!(
        rejection(&path(), ""),
        rejected_with("Expected a nonempty path with no NUL character.")
    );
    assert_eq!(
        rejection(&path().access(PathAccess::Read), "a\0b"),
        rejected_with("Expected a readable file that exists.")
    );
    assert_eq!(
        rejection(&path().access(PathAccess::Read).kind(PathKind::Any), "a\0b"),
        rejected_with("Expected a readable file or directory that exists.")
    );
    assert_eq!(
        rejection(
            &path().access(PathAccess::Write).kind(PathKind::Any),
            "a\0b"
        ),
        rejected_with("Expected a writable path, or a new path in a writable directory.")
    );
}

#[test]
fn with_no_access_a_token_resolves_against_the_host_cwd_and_normalizes() {
    let cwd = FsPath::new("/loom/work");
    assert_eq!(
        validate(&path(), cwd, "a/../b/./c"),
        Ok(PathBuf::from("/loom/work/b/c"))
    );
    assert_eq!(
        validate(&path(), cwd, "/etc//hosts"),
        Ok(PathBuf::from("/etc/hosts"))
    );
    // Nothing on the file system is read.
    assert_eq!(
        validate(&path(), FsPath::new("/loom/missing"), "nowhere"),
        Ok(PathBuf::from("/loom/missing/nowhere"))
    );
    assert_eq!(
        validate(&path(), cwd, ""),
        refused("Expected a nonempty path with no NUL character.")
    );
}

/// A directory of the entries the access tests probe.
struct Fixture {
    root: TempDir,
}

impl Fixture {
    fn new() -> Self {
        let root = TempDir::new("path");
        let at = root.path();
        fs::write(at.join("a.txt"), "a").unwrap();
        fs::create_dir(at.join("sub")).unwrap();
        fs::write(at.join("secret.txt"), "s").unwrap();
        fs::set_permissions(at.join("secret.txt"), fs::Permissions::from_mode(0o000)).unwrap();
        fs::write(at.join("readonly.txt"), "r").unwrap();
        fs::set_permissions(at.join("readonly.txt"), fs::Permissions::from_mode(0o444)).unwrap();
        fs::create_dir(at.join("locked")).unwrap();
        fs::set_permissions(at.join("locked"), fs::Permissions::from_mode(0o555)).unwrap();
        symlink(at.join("a.txt"), at.join("link")).unwrap();
        symlink(at.join("missing"), at.join("dangling")).unwrap();
        symlink(at.join("loop"), at.join("loop")).unwrap();
        Self { root }
    }

    fn at(&self) -> &FsPath {
        self.root.path()
    }

    fn found(&self, name: &str) -> Result<PathBuf, Vec<String>> {
        Ok(self.at().join(name))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::set_permissions(self.at().join("locked"), fs::Permissions::from_mode(0o755));
        let _ = fs::set_permissions(
            self.at().join("secret.txt"),
            fs::Permissions::from_mode(0o644),
        );
    }
}

const READ_FILE: &str = "Expected a readable file that exists.";
const READ_DIRECTORY: &str = "Expected a readable directory that exists.";
const READ_ANY: &str = "Expected a readable file or directory that exists.";
const WRITE_FILE: &str = "Expected a writable file, or a new file in a writable directory.";
const WRITE_DIRECTORY: &str =
    "Expected a writable directory, or a new directory in a writable directory.";
const WRITE_ANY: &str = "Expected a writable path, or a new path in a writable directory.";

fn read() -> Path {
    path().access(PathAccess::Read)
}

fn write() -> Path {
    path().access(PathAccess::Write)
}

#[test]
fn read_accepts_a_readable_file_following_a_symbolic_link() {
    let fixture = Fixture::new();
    assert_eq!(
        validate(&read(), fixture.at(), "a.txt"),
        fixture.found("a.txt")
    );
    assert_eq!(
        validate(&read().kind(PathKind::File), fixture.at(), "link"),
        fixture.found("link")
    );
}

#[test]
fn read_of_a_file_rejects_what_is_not_a_readable_file() {
    let fixture = Fixture::new();
    let long = "n".repeat(300);
    for token in [
        "sub",
        "missing",
        "a.txt/inner",
        "dangling",
        "loop",
        long.as_str(),
    ] {
        assert_eq!(
            validate(&read(), fixture.at(), token),
            refused(READ_FILE),
            "{token}"
        );
    }
    if !privileged() {
        assert_eq!(
            validate(&read(), fixture.at(), "secret.txt"),
            refused(READ_FILE)
        );
    }
}

#[test]
fn read_of_a_directory_and_of_any() {
    let fixture = Fixture::new();
    let directory = read().kind(PathKind::Directory);
    assert_eq!(
        validate(&directory, fixture.at(), "sub"),
        fixture.found("sub")
    );
    assert_eq!(
        validate(&directory, fixture.at(), "a.txt"),
        refused(READ_DIRECTORY)
    );
    let any = read().kind(PathKind::Any);
    assert_eq!(
        validate(&any, fixture.at(), "a.txt"),
        fixture.found("a.txt")
    );
    assert_eq!(validate(&any, fixture.at(), "sub/"), fixture.found("sub"));
    assert_eq!(validate(&any, fixture.at(), "missing"), refused(READ_ANY));
}

#[test]
fn write_accepts_an_existing_file_and_a_new_file_in_a_writable_directory() {
    let fixture = Fixture::new();
    assert_eq!(
        validate(&write(), fixture.at(), "a.txt"),
        fixture.found("a.txt")
    );
    assert_eq!(
        validate(&write(), fixture.at(), "new.txt"),
        fixture.found("new.txt")
    );
    assert_eq!(
        validate(&write(), fixture.at(), "sub/new.txt"),
        Ok(fixture.at().join("sub").join("new.txt"))
    );
}

#[test]
fn write_creates_nothing() {
    let fixture = Fixture::new();
    assert_eq!(
        validate(&write(), fixture.at(), "created.txt"),
        fixture.found("created.txt")
    );
    assert_eq!(
        validate(&read().kind(PathKind::Any), fixture.at(), "."),
        Ok(fixture.at().to_path_buf())
    );
    assert_eq!(
        validate(&read().kind(PathKind::Any), fixture.at(), "created.txt"),
        refused(READ_ANY)
    );
    assert!(!fixture.at().join("created.txt").exists());
}

#[test]
fn write_of_a_file_rejects_a_directory_and_a_path_with_no_writable_parent() {
    let fixture = Fixture::new();
    for token in ["sub", "missing/new.txt", "a.txt/new.txt"] {
        assert_eq!(
            validate(&write(), fixture.at(), token),
            refused(WRITE_FILE),
            "{token}"
        );
    }
    if !privileged() {
        assert_eq!(
            validate(&write(), fixture.at(), "readonly.txt"),
            refused(WRITE_FILE)
        );
        assert_eq!(
            validate(&write(), fixture.at(), "locked/new.txt"),
            refused(WRITE_FILE)
        );
    }
}

#[test]
fn write_of_a_directory_and_of_any() {
    let fixture = Fixture::new();
    let directory = write().kind(PathKind::Directory);
    assert_eq!(
        validate(&directory, fixture.at(), "sub"),
        fixture.found("sub")
    );
    assert_eq!(
        validate(&directory, fixture.at(), "fresh"),
        fixture.found("fresh")
    );
    assert_eq!(
        validate(&directory, fixture.at(), "a.txt"),
        refused(WRITE_DIRECTORY)
    );
    let any = write().kind(PathKind::Any);
    assert_eq!(
        validate(&any, fixture.at(), "a.txt"),
        fixture.found("a.txt")
    );
    assert_eq!(validate(&any, fixture.at(), "sub"), fixture.found("sub"));
    assert_eq!(
        validate(&any, fixture.at(), "fresh"),
        fixture.found("fresh")
    );
    assert_eq!(
        validate(&any, fixture.at(), "missing/fresh"),
        refused(WRITE_ANY)
    );
}
