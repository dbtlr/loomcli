//! The installed-folder writes of the installed-files module: a folder written whole through a
//! staging folder and renames, removed whole without following a symbolic link, and read for
//! whether it holds exactly a list of files. The skills plugin's project install uses the write
//! with no record.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::InstallationError;
use super::disk::{
    self, Observed, RETIRED_SUFFIX, ReplaceOptions, STAGING_SUFFIX, digest_of, entries_of, exists,
    is_marked_entry, observe, retired_path, staging_path,
};

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
}

impl FolderFile {
    /// The file at the relative path `path` holding `content`, with no mode named.
    pub fn new(path: impl Into<String>, content: impl Into<Vec<u8>>) -> Self {
        Self {
            path: path.into(),
            content: content.into(),
            mode: None,
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
/// beside the folder at `path`, for that folder's own name alone.
pub fn remove_folder_leftovers(path: &Path) -> io::Result<()> {
    let directory = disk::parent_of(path);
    let name = disk::name_of(path);
    for entry in entries_of(&directory)? {
        if is_marked_entry(&entry, &name, STAGING_SUFFIX)
            || is_marked_entry(&entry, &name, RETIRED_SUFFIX)
        {
            remove_whole(&directory.join(entry))?;
        }
    }
    Ok(())
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
pub fn write_folder(path: &Path, files: &[FolderFile]) -> Result<(), InstallationError> {
    remove_folder_leftovers(path)?;
    let staging = staging_path(path);
    disk::make_directory(&staging)?;
    let attempt = fill_folder(&staging, files).and_then(|()| Ok(swap_in(&staging, path)?));
    if attempt.is_err() {
        // The write's own error is the one to report; a later write removes the leftover.
        let _ = remove_whole(&staging);
    }
    attempt
}

/// What a check of a folder expects, by relative path, and the files it found so far.
struct Walk<'a> {
    files: HashMap<&'a str, &'a FolderFile>,
    directories: BTreeSet<String>,
    found: BTreeSet<String>,
}

/// Every directory above a file of the list, as the relative paths the folder holds.
fn expected_directories(files: &[FolderFile]) -> BTreeSet<String> {
    let mut directories = BTreeSet::new();
    for file in files {
        let mut up = file.path.as_str();
        while let Some((above, _)) = up.rsplit_once('/') {
            directories.insert(above.to_owned());
            up = above;
        }
    }
    directories
}

/// Whether the file at `path` is a regular file holding the listed content and, when named, mode.
fn file_matches(path: &Path, file: &FolderFile) -> io::Result<bool> {
    Ok(match observe(path)? {
        Observed::File { digest, mode } => {
            digest == digest_of(&file.content) && file.mode.is_none_or(|named| named == mode)
        }
        _ => false,
    })
}

/// Whether every entry under `directory` is one the list expects, each file matching, recording
/// the files it finds in `walk`. A link, another kind of file, or an unexpected entry fails.
fn entries_match(directory: &Path, relative: &str, walk: &mut Walk<'_>) -> io::Result<bool> {
    for entry in fs::read_dir(directory)? {
        let name = entry?.file_name();
        let path = directory.join(&name);
        let name = name.to_string_lossy();
        let key = if relative.is_empty() {
            name.into_owned()
        } else {
            format!("{relative}/{name}")
        };
        if let Some(file) = walk.files.get(key.as_str()).copied() {
            walk.found.insert(key);
            if !file_matches(&path, file)? {
                return Ok(false);
            }
            continue;
        }
        let is_folder =
            walk.directories.contains(&key) && fs::symlink_metadata(&path)?.file_type().is_dir();
        if !is_folder || !entries_match(&path, &key, walk)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Whether the folder at `path` holds exactly `files`: each file with its content and, when the
/// list names one, its mode, and no other file or folder. Nothing is followed, so a symbolic link
/// at the path or inside the folder, or a path that is not a directory, answers `false`.
pub fn folder_holds_exactly(path: &Path, files: &[FolderFile]) -> io::Result<bool> {
    if !disk::lstat(path)?.is_some_and(|metadata| metadata.is_dir()) {
        return Ok(false);
    }
    let mut walk = Walk {
        files: files
            .iter()
            .map(|file| (file.path.as_str(), file))
            .collect(),
        directories: expected_directories(files),
        found: BTreeSet::new(),
    };
    Ok(entries_match(path, "", &mut walk)? && walk.found.len() == files.len())
}
