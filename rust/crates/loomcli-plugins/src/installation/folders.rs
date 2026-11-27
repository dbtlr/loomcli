//! The installed-folder writes of the installed-files module: a folder written whole through a
//! staging folder and renames, removed whole without following a symbolic link, and read against
//! recorded per-file digests. The skills plugin's project install uses the write with no record.

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use loomcli_core::Log;

use crate::change_events::{file_written, record_leftovers};

use super::InstallationError;
use super::disk::{
    self, Observed, RETIRED_SUFFIX, ReplaceOptions, STAGING_SUFFIX, digest_of, entries_of, exists,
    is_marked_entry, observe, retired_path, staging_path,
};

use super::reach::write_failure;
use super::record::{FolderDigest, FolderPrior, PendingFolder, RecordedFolder};

/// One file of an installed folder: its relative POSIX path inside the folder, such as
/// `agents/run.sh`, its content, and the permission bits it is written with whatever the umask,
/// when the plugin names any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FolderFile {
    /// The relative path, its segments joined by `/`.
    pub path: String,
    /// The bytes it holds.
    pub content: Vec<u8>,
    /// The permission bits, or `None` to follow the umask.
    pub mode: Option<u32>,
    /// Whether this file is a generated command reference.
    pub generated: bool,
}

impl FolderFile {
    /// The file at the relative path `path` holding `content`, with no mode named.
    pub fn new(path: impl Into<String>, content: impl Into<Vec<u8>>) -> Self {
        Self {
            path: path.into(),
            content: content.into(),
            mode: None,
            generated: false,
        }
    }

    /// Names the permission bits the file takes whatever the umask.
    #[must_use]
    pub fn mode(self, mode: u32) -> Self {
        Self {
            mode: Some(mode),
            ..self
        }
    }
}

/// Removes whatever is at `path` whole and reports whether anything was there. A symbolic link at
/// the path, or inside a folder, is removed as a link and never followed.
pub fn remove_whole(path: &Path) -> io::Result<bool> {
    let Some(metadata) = disk::lstat(path)? else {
        return Ok(false);
    };
    let removed = if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match removed {
        Err(error) if disk::is_missing(&error) => Ok(true),
        Err(error) => Err(error),
        Ok(()) => Ok(true),
    }
}

/// Removes each leftover `.<name>.<random>.loom-staging` and `.<name>.<random>.loom-retired`
/// beside the folder at `path` and returns the removed paths.
pub fn remove_folder_leftovers(path: &Path) -> io::Result<Vec<PathBuf>> {
    let directory = disk::parent_of(path);
    let name = disk::name_of(path);
    let mut removed = Vec::new();
    for entry in entries_of(&directory)? {
        if is_marked_entry(&entry, &name, STAGING_SUFFIX)
            || is_marked_entry(&entry, &name, RETIRED_SUFFIX)
        {
            let leftover = directory.join(entry);
            if remove_whole(&leftover)? {
                removed.push(leftover);
            }
        }
    }
    Ok(removed)
}

/// The path of a folder file under `root`, one segment at a time.
fn joined(root: &Path, relative: &str) -> PathBuf {
    relative
        .split('/')
        .fold(root.to_path_buf(), |path, segment| path.join(segment))
}

/// Creates each subfolder above a file one level at a time, never recursively, so a staging folder
/// that another run's recovery removed makes the create fail and is never made again.
fn create_subfolders(staging: &Path, path: &str, made: &mut BTreeSet<PathBuf>) -> io::Result<()> {
    let mut segments: Vec<&str> = path.split('/').collect();
    segments.pop();
    let mut directory = staging.to_path_buf();
    for segment in segments {
        directory = directory.join(segment);
        if !made.contains(&directory) {
            disk::make_directory(&directory)?;
            made.insert(directory.clone());
        }
    }
    Ok(())
}

/// Writes each file under the staging folder, creating the subfolders it needs. It never creates
/// the staging folder itself: when the folder is gone, the write fails and nothing is published
/// short.
pub fn fill_folder(staging: &Path, files: &[FolderFile]) -> Result<(), InstallationError> {
    let mut made = BTreeSet::new();
    for file in files {
        create_subfolders(staging, &file.path, &mut made)?;
        disk::replace_file(
            &joined(staging, &file.path),
            &file.content,
            ReplaceOptions::new().maybe_mode(file.mode),
        )?;
    }
    Ok(())
}

/// Moves whatever is at `path` aside, a link as a link, and answers where it went, if anything
/// was there.
fn move_aside(path: &Path) -> io::Result<Option<PathBuf>> {
    if !exists(path)? {
        return Ok(None);
    }
    let retired = retired_path(path);
    disk::rename(path, &retired)?;
    Ok(Some(retired))
}

/// Moves what is at `path` aside, renames the staging folder into place, and removes what was
/// moved.
fn swap_in(staging: &Path, path: &Path) -> io::Result<()> {
    let retired = move_aside(path)?;
    disk::rename(staging, path)?;
    if let Some(retired) = retired {
        remove_whole(&retired)?;
    }
    Ok(())
}

/// Writes the folder at `path` whole: it removes the leftovers of the folder's own name, builds
/// the folder in a staging folder created exclusively beside it, moves whatever is at the path
/// aside, renames the staging folder into place, and removes the retired one whole. The directory
/// above the path exists. A failure removes the staging folder and returns the runtime's error;
/// one between the two renames can leave the path empty and a retired folder beside it, which the
/// next write of that folder removes.
pub fn write_folder(
    path: &Path,
    files: &[FolderFile],
    log: Option<&Log>,
) -> Result<(), InstallationError> {
    let leftovers = remove_folder_leftovers(path)?;
    let staging = staging_path(path);
    disk::make_directory(&staging).map_err(|error| write_failure(path, error))?;
    let attempt = fill_folder(&staging, files).and_then(|()| Ok(swap_in(&staging, path)?));
    if attempt.is_err() {
        // The write's own error is the one to report; a later write removes the leftover.
        let _ = remove_whole(&staging);
    } else {
        record_leftovers(log, leftovers);
        if let Some(log) = log {
            file_written(log, path);
        }
    }
    attempt
}

/// Reads a relative file through real directories only. A link at the file itself is observed.
fn observe_in(folder: &Path, file: &str) -> io::Result<Observed> {
    let mut parent = folder.to_path_buf();
    if !disk::lstat(&parent)?.is_some_and(|metadata| metadata.is_dir()) {
        return Ok(Observed::Absent);
    }
    if let Some((directory, _)) = file.rsplit_once('/') {
        for segment in directory.split('/') {
            parent.push(segment);
            if !disk::lstat(&parent)?.is_some_and(|metadata| metadata.is_dir()) {
                return Ok(Observed::Absent);
            }
        }
    }
    observe(&joined(folder, file))
}

pub(super) fn folder_digests(files: &[FolderFile]) -> Vec<FolderDigest> {
    files
        .iter()
        .map(|file| FolderDigest {
            path: file.path.clone(),
            digest: digest_of(&file.content),
            generated: file.generated,
        })
        .collect()
}

/// Lists generated references that exist with changed content or kind, in record order.
pub(crate) fn changed_references(folder: &RecordedFolder) -> io::Result<Vec<String>> {
    let mut changed = Vec::new();
    for file in folder.files.iter().flatten().filter(|file| file.generated) {
        match observe_in(&folder.path, &file.path)? {
            Observed::Absent => {}
            Observed::File { digest, .. } if digest == file.digest => {}
            _ => changed.push(file.path.clone()),
        }
    }
    Ok(changed)
}

#[cfg(feature = "skills")]
const EXECUTE_BITS: u32 = 0o111;

/// Lists missing or differing wanted files and obsolete recorded files still held by the folder,
/// in Unicode code-point order.
#[cfg(feature = "skills")]
pub(crate) fn stale_files(
    path: &Path,
    files: &[FolderFile],
    recorded: &[FolderDigest],
) -> io::Result<Vec<String>> {
    let mut changed = BTreeSet::new();
    for file in files {
        let matches = match observe_in(path, &file.path)? {
            Observed::File { digest, mode } => {
                digest == digest_of(&file.content)
                    && file.mode.is_none_or(|wanted| {
                        (wanted & EXECUTE_BITS != 0) == (mode & EXECUTE_BITS != 0)
                    })
            }
            _ => false,
        };
        if !matches {
            changed.insert(file.path.clone());
        }
    }
    for file in recorded {
        if !files.iter().any(|wanted| wanted.path == file.path)
            && observe_in(path, &file.path)? != Observed::Absent
        {
            changed.insert(file.path.clone());
        }
    }
    Ok(changed.into_iter().collect())
}

fn intended_matches(folder: &Path, files: &[FolderDigest]) -> io::Result<bool> {
    for file in files {
        if !matches!(observe_in(folder, &file.path)?, Observed::File { digest, .. } if digest == file.digest)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Keeps the intended digests after a completed swap, or the ownership that survives a stopped
/// swap. A missing target keeps its intended record so the next update can finish writing it.
pub(super) fn recovered_folder(
    folder: &PendingFolder,
) -> Result<Option<RecordedFolder>, InstallationError> {
    let files = match (&folder.prior, &folder.intended) {
        (None, _) => None,
        (_, Some(intended)) if intended_matches(&folder.path, intended)? => Some(intended.clone()),
        (Some(prior), _) if exists(&folder.path)? => match prior {
            FolderPrior::Unrecorded => return Ok(None),
            FolderPrior::Path => None,
            FolderPrior::Files(files) => Some(files.clone()),
        },
        (_, Some(intended)) => Some(intended.clone()),
        (_, None) => return Ok(None),
    };
    Ok(Some(RecordedFolder {
        path: folder.path.clone(),
        files,
    }))
}
