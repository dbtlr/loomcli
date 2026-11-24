//! The sandboxes and expected bytes the installation tests share, as `installed-files.test.ts`
//! builds them.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use loomcli_plugins::installation_test_support::{
    Cancellation, FolderFile, InstallOutcome, InstallRequest, InstalledFile, InstalledFolder,
    PluginRecord, UninstallOutcome,
};
use serde_json::json;

/// The SHA-256 digests of the bytes `test`, `abc`, and `new`, from independent sources.
pub const DIGEST_ABC: &str =
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
pub const DIGEST_NEW: &str =
    "sha256:11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437";
pub const DIGEST_TEST: &str =
    "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/// The line the tests add to a startup file, and the text that replaces it.
pub const LOADER: &str = "if [ -f '/data/notes/_loom_notes' ]; then . '/data/notes/_loom_notes'; fi # added by notes completion install";
pub const NEWER: &str =
    "fpath=('/data/notes' $fpath); . '/data/notes/_loom_notes' # added by notes completion install";

/// A run that is not cancelled.
pub struct Running;

impl Cancellation for Running {
    fn throw_if_cancelled(&self) -> Result<(), loomcli_core::Error> {
        Ok(())
    }
}

/// A run already cancelled.
pub struct Cancelled;

impl Cancellation for Cancelled {
    fn throw_if_cancelled(&self) -> Result<(), loomcli_core::Error> {
        Err(std::io::Error::other("cancelled").into())
    }
}

/// A temporary root with a record directory and a target directory, `skills`, that exists, and the
/// two targets the tests install into `skills/notes`, which does not. The root is removed when the
/// sandbox drops.
pub struct Sandbox {
    pub root: PathBuf,
    pub record: PathBuf,
    pub skills: PathBuf,
    pub directory: PathBuf,
    pub first: PathBuf,
    pub second: PathBuf,
    pub owner: PathBuf,
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A fresh, empty directory under the system's temporary folder, as the reference's `mkdtemp`
/// under `tmpdir()`: a folder with no default ACL, so the process's umask decides the modes the
/// umask cases read.
pub fn temporary_root(prefix: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}-{nanos}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).unwrap();
    // The record's paths are compared as text, so the root is named through no link.
    fs::canonicalize(root).unwrap()
}

pub fn sandbox() -> Sandbox {
    let root = temporary_root("loom-installed");
    let skills = root.join("skills");
    fs::create_dir(&skills).unwrap();
    let directory = skills.join("notes");
    Sandbox {
        first: directory.join("SKILL.md"),
        second: directory.join("reference.md"),
        owner: root.join("record").join("skill.json"),
        record: root.join("record"),
        directory,
        skills,
        root,
    }
}

/// A sandbox with a home directory that exists and the startup file `.zshrc` in it, which does
/// not.
pub struct HomeBox {
    pub sandbox: Sandbox,
    pub home: PathBuf,
    pub rc: PathBuf,
}

impl Deref for HomeBox {
    type Target = Sandbox;

    fn deref(&self) -> &Sandbox {
        &self.sandbox
    }
}

pub fn home_box() -> HomeBox {
    let sandbox = sandbox();
    let home = sandbox.root.join("home");
    fs::create_dir(&home).unwrap();
    HomeBox {
        rc: home.join(".zshrc"),
        home,
        sandbox,
    }
}

/// One install of `files` by the skill plugin, with a signal no one cancels.
pub fn installed(sandbox: &Sandbox, files: Vec<InstalledFile>) -> InstallOutcome {
    PluginRecord::new(&sandbox.record, "skill")
        .install(&InstallRequest::new().files(files), &Running)
        .unwrap()
}

/// One uninstall by the skill plugin.
pub fn uninstalled(sandbox: &Sandbox) -> UninstallOutcome {
    PluginRecord::new(&sandbox.record, "skill")
        .uninstall(&[], &Running)
        .unwrap()
}

/// A committed plugin's file's bytes, as the contract spells them.
pub fn committed(directories: &[&Path], files: &[(&Path, &str)]) -> String {
    let files: Vec<_> = files
        .iter()
        .map(|(path, digest)| json!({ "path": path, "digest": digest }))
        .collect();
    format!(
        "{}\n",
        json!({ "format": 1, "state": "committed", "directories": directories, "files": files })
    )
}

/// A committed plugin's file's bytes with the folders it records and no files.
pub fn committed_folders(directories: &[&Path], folders: &[&Path]) -> String {
    let folders: Vec<_> = folders.iter().map(|path| json!({ "path": path })).collect();
    format!(
        "{}\n",
        json!({ "format": 1, "state": "committed", "directories": directories, "files": [], "folders": folders })
    )
}

/// A committed plugin's file's bytes with the directories and startup lines it records and no
/// files.
pub fn committed_lines(directories: &[&Path], lines: &[(&Path, &str)]) -> String {
    let lines: Vec<_> = lines
        .iter()
        .map(|(path, line)| json!({ "path": path, "line": line }))
        .collect();
    format!(
        "{}\n",
        json!({ "format": 1, "state": "committed", "directories": directories, "files": [], "lines": lines })
    )
}

/// Writes a pending plugin's file by hand, as a killed install leaves one.
pub fn pending(
    sandbox: &Sandbox,
    directories: &[&Path],
    files: &[(&Path, Option<&str>, Option<&str>)],
) {
    let files: Vec<_> = files
        .iter()
        .map(
            |(path, prior, intended)| json!({ "path": path, "prior": prior, "intended": intended }),
        )
        .collect();
    fs::create_dir_all(&sandbox.record).unwrap();
    fs::write(
        &sandbox.owner,
        format!(
            "{}\n",
            json!({ "format": 1, "state": "pending", "directories": directories, "files": files })
        ),
    )
    .unwrap();
}

/// A folder of the skill plugin at `path` holding the named files, each with its content.
pub fn folder_of(path: &Path, files: &[(&str, &str)]) -> InstalledFolder {
    InstalledFolder::new(
        path,
        files
            .iter()
            .map(|(name, content)| FolderFile::new(*name, *content)),
    )
}

/// Every entry under `directory` as `name`, `name/`, or `name -> target`, sorted, without
/// following links.
pub fn listing(directory: &Path) -> Vec<String> {
    fn walk(directory: &Path, prefix: &str, lines: &mut Vec<String>) {
        let mut names: Vec<String> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        for name in names {
            let path = directory.join(&name);
            let metadata = fs::symlink_metadata(&path).unwrap();
            if metadata.file_type().is_symlink() {
                lines.push(format!(
                    "{prefix}{name} -> {}",
                    fs::read_link(&path).unwrap().display()
                ));
            } else if metadata.is_dir() {
                lines.push(format!("{prefix}{name}/"));
                walk(&path, &format!("{prefix}{name}/"), lines);
            } else {
                lines.push(format!("{prefix}{name}"));
            }
        }
    }
    let mut lines = Vec::new();
    walk(directory, "", &mut lines);
    lines
}

/// An outside directory with a file in it, which a link inside an installed folder points at.
pub fn outside(sandbox: &Sandbox) -> PathBuf {
    let directory = sandbox.root.join("outside");
    fs::create_dir(&directory).unwrap();
    fs::write(directory.join("keep.txt"), "keep").unwrap();
    directory
}

/// UTF-8 bytes of some text, after the byte order mark `EF BB BF`.
pub fn utf8_with_mark(text: &str) -> Vec<u8> {
    let mut bytes = vec![0xef, 0xbb, 0xbf];
    bytes.extend_from_slice(text.as_bytes());
    bytes
}
