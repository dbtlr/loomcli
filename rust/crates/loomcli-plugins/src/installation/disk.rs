//! What the installed-files module observes on disk and the writes it makes there, each through a
//! synchronous call whose failure returns the runtime's [`io::Error`].
//!
//! Every rename, directory creation, append, and exclusive create passes a [`Step`] to the probe a
//! test installs with [`set_probe`] before and after it acts, the seams the reference's process
//! fixture reaches by replacing `node:fs` functions. With no probe installed a step costs one
//! atomic load.

use std::collections::hash_map::RandomState;
use std::ffi::OsString;
use std::fs::{self, File, Metadata, OpenOptions};
use std::hash::{BuildHasher, Hasher};
use std::io::{self, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use super::reach::read_failure;
use super::{Cancellation, InstallationError, read_signal};

/// The permission bits of a file mode, without its file type.
pub const PERMISSION_BITS: u32 = 0o7777;

/// The mode a staging file is created with when the caller names none, before the umask applies.
const DEFAULT_MODE: u32 = 0o666;

/// What a path holds, read without following a symbolic link.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Observed {
    /// Nothing.
    Absent,
    /// A regular file, with the digest of its bytes and its permission bits.
    File {
        /// `sha256:` and 64 lowercase hexadecimal digits.
        digest: String,
        /// The permission bits.
        mode: u32,
    },
    /// A symbolic link.
    Link,
    /// A directory.
    Directory,
    /// Any other kind: a FIFO, a socket, or a device.
    Special,
}

/// One file-system call the module is about to make or has just made, which the probe a test
/// installs receives. A path is the one the call names.
#[doc(hidden)]
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub enum Step<'a> {
    /// Before `from` is renamed to `to`.
    BeforeRename {
        /// The path moved.
        from: &'a Path,
        /// Where it goes.
        to: &'a Path,
    },
    /// After `from` was renamed to `to`.
    AfterRename {
        /// The path moved.
        from: &'a Path,
        /// Where it went.
        to: &'a Path,
    },
    /// Before one directory is created.
    BeforeCreateDirectory(&'a Path),
    /// Before a startup file's line is appended.
    BeforeAppend(&'a Path),
    /// After a startup file's line was appended.
    AfterAppend(&'a Path),
    /// Before a file is created exclusively, for writing or for appending.
    BeforeExclusiveCreate(&'a Path),
    /// After a file was created exclusively, before anything is written to it.
    AfterExclusiveCreate(&'a Path),
}

/// The probe a test installed, or none.
static PROBE: OnceLock<for<'a> fn(Step<'a>)> = OnceLock::new();

/// Installs the probe every [`Step`] of this process reaches, once per process: a test's seam for
/// ending a run between two calls, or for acting as another run would between them. Answers
/// whether this call installed it.
#[doc(hidden)]
pub fn set_probe(probe: for<'a> fn(Step<'a>)) -> bool {
    PROBE.set(probe).is_ok()
}

/// Passes `step` to the installed probe, if any.
fn probe(step: Step<'_>) {
    if let Some(probe) = PROBE.get() {
        probe(step);
    }
}

/// The digest of some bytes, as the record spells it: `sha256:` and 64 lowercase hexadecimal
/// digits.
#[must_use]
pub fn digest_of(content: &[u8]) -> String {
    let mut digest = String::from("sha256:");
    for byte in Sha256::digest(content) {
        digest.push_str(&format!("{byte:02x}"));
    }
    digest
}

/// Whether a runtime error says the path, or a part of it, does not exist.
pub(super) fn is_missing(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    )
}

/// The path's own metadata, without following a symbolic link, or `None` when nothing is there.
pub(super) fn lstat(path: &Path) -> io::Result<Option<Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(read_failure(path, error)),
    }
}

/// What `path` holds, read without following a symbolic link.
pub fn observe(path: &Path) -> io::Result<Observed> {
    let Some(metadata) = lstat(path)? else {
        return Ok(Observed::Absent);
    };
    let kind = metadata.file_type();
    if kind.is_symlink() {
        return Ok(Observed::Link);
    }
    if kind.is_dir() {
        return Ok(Observed::Directory);
    }
    if kind.is_file() {
        return Ok(Observed::File {
            digest: digest_of(&fs::read(path).map_err(|error| read_failure(path, error))?),
            mode: metadata.permissions().mode() & PERMISSION_BITS,
        });
    }
    Ok(Observed::Special)
}

/// Whether anything is at `path`, a symbolic link included, without reading it.
pub fn exists(path: &Path) -> io::Result<bool> {
    Ok(lstat(path)?.is_some())
}

/// The suffix that marks a staging file or folder, which recovery removes when a run leaves one.
pub(super) const STAGING_SUFFIX: &str = ".loom-staging";

/// The suffix that marks a folder moved aside during a replacement, which recovery removes.
pub(super) const RETIRED_SUFFIX: &str = ".loom-retired";

/// The directory above `path`, `path` itself for the root, as Node's `dirname` answers.
pub(super) fn parent_of(path: &Path) -> PathBuf {
    path.parent()
        .map_or_else(|| path.to_path_buf(), Path::to_path_buf)
}

/// The last segment of `path`, as Node's `basename` answers, empty for the root.
pub(super) fn name_of(path: &Path) -> OsString {
    path.file_name().map(OsString::from).unwrap_or_default()
}

/// 16 lowercase hexadecimal digits unique to one attempt: the process, a counter, the clock, and
/// the standard library's per-process random hash keys.
fn random_digits() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    hasher.write_u32(std::process::id());
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    hasher.write_u128(nanos);
    format!("{:016x}", hasher.finish())
}

/// A marked path beside `path`, `.<name>.<random><suffix>`, unique to the attempt.
fn marked_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = OsString::from(".");
    name.push(name_of(path));
    name.push(format!(".{}{suffix}", random_digits()));
    parent_of(path).join(name)
}

/// A staging file's path beside `path`, `.<name>.<random>.loom-staging`, unique to the attempt.
#[must_use]
pub fn staging_path(path: &Path) -> PathBuf {
    marked_path(path, STAGING_SUFFIX)
}

/// The path a folder at `path` is moved aside to, `.<name>.<random>.loom-retired`.
#[must_use]
pub fn retired_path(path: &Path) -> PathBuf {
    marked_path(path, RETIRED_SUFFIX)
}

/// How a replacement writes its staging file: the permission bits it takes whatever the umask,
/// whether it is flushed to disk before the rename, and the signal read just before the rename.
#[derive(Clone, Copy, Default)]
pub struct ReplaceOptions<'a> {
    /// The permission bits the file takes whatever the umask; the umask applies to `0o666` when
    /// none is named.
    pub mode: Option<u32>,
    /// Whether the staging file is flushed to disk before the rename.
    pub durable: bool,
    /// The signal read just before the rename.
    pub signal: Option<&'a dyn Cancellation>,
}

impl<'a> ReplaceOptions<'a> {
    /// No mode named, not flushed, and no signal.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Names the permission bits the file takes whatever the umask.
    #[must_use]
    pub fn mode(self, mode: u32) -> Self {
        Self {
            mode: Some(mode),
            ..self
        }
    }

    /// Names the permission bits, or none.
    #[must_use]
    pub fn maybe_mode(self, mode: Option<u32>) -> Self {
        Self { mode, ..self }
    }

    /// Flushes the staging file to disk before the rename.
    #[must_use]
    pub fn durable(self) -> Self {
        Self {
            durable: true,
            ..self
        }
    }

    /// Reads `signal` just before the rename.
    #[must_use]
    pub fn signal(self, signal: &'a dyn Cancellation) -> Self {
        Self {
            signal: Some(signal),
            ..self
        }
    }
}

/// Renames `from` to `to`, passing the steps around the call to the probe.
pub(super) fn rename(from: &Path, to: &Path) -> io::Result<()> {
    probe(Step::BeforeRename { from, to });
    fs::rename(from, to)?;
    probe(Step::AfterRename { from, to });
    Ok(())
}

/// Creates `path` exclusively with `mode` before the umask, for appending or for writing.
fn create_exclusively(path: &Path, mode: u32, append: bool) -> io::Result<File> {
    probe(Step::BeforeExclusiveCreate(path));
    let mut options = OpenOptions::new();
    if append {
        options.append(true);
    } else {
        options.write(true);
    }
    let file = options.create_new(true).mode(mode).open(path)?;
    probe(Step::AfterExclusiveCreate(path));
    Ok(file)
}

/// Fills the open file, sets its mode and flushes it when asked; the file closes as it drops.
fn fill(mut file: File, content: &[u8], options: &ReplaceOptions<'_>) -> io::Result<()> {
    file.write_all(content)?;
    if let Some(mode) = options.mode {
        file.set_permissions(fs::Permissions::from_mode(mode))?;
    }
    if options.durable {
        file.sync_all()?;
    }
    Ok(())
}

/// Replaces `path` whole: the content goes to a staging file created exclusively in its directory,
/// which is then renamed into place, so no reader and no other run sees partial content there. A
/// failed write or rename, or a cancellation read before the rename, removes the staging file and
/// returns the original error or [`InstallationError::Cancelled`] with the signal's error.
pub fn replace_file(
    path: &Path,
    content: &[u8],
    options: ReplaceOptions<'_>,
) -> Result<(), InstallationError> {
    let staging = staging_path(path);
    let attempt = (|| {
        let file = create_exclusively(&staging, options.mode.unwrap_or(DEFAULT_MODE), false)?;
        fill(file, content, &options)?;
        if let Some(signal) = options.signal {
            read_signal(signal)?;
        }
        rename(&staging, path)?;
        Ok(())
    })();
    if attempt.is_err() {
        remove_staging(&staging);
    }
    attempt
}

/// Creates `path` exclusively and appends `content` through it, or answers `false` when something
/// is already there. The descriptor appends, so a line another run appends between the create and
/// this write lands whole before `content` rather than under it.
pub fn create_new(path: &Path, content: &[u8], mode: Option<u32>) -> io::Result<bool> {
    let file = match create_exclusively(path, mode.unwrap_or(DEFAULT_MODE), true) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(false),
        Err(error) => return Err(error),
    };
    fill(
        file,
        content,
        &ReplaceOptions {
            mode,
            durable: false,
            signal: None,
        },
    )?;
    Ok(true)
}

/// Appends `bytes` to the file at `path` in place, through any symbolic link, creating it when it
/// is missing, as Node's `appendFileSync` does.
pub(super) fn append(path: &Path, bytes: &[u8]) -> io::Result<()> {
    probe(Step::BeforeAppend(path));
    OpenOptions::new()
        .append(true)
        .create(true)
        .mode(DEFAULT_MODE)
        .open(path)?
        .write_all(bytes)?;
    probe(Step::AfterAppend(path));
    Ok(())
}

/// Removes a staging file after a replacement, leaving any failure to recovery's next run: the
/// replacement's own error is the one to report.
fn remove_staging(staging: &Path) {
    let _ = remove_file_if_present(staging);
}

/// Removes a file, a gone one being no error, as `rmSync` with `force` does.
pub(super) fn remove_file_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if is_missing(&error) => Ok(()),
        other => other,
    }
}

/// The names in a directory, or none when the directory is gone.
pub(super) fn entries_of(directory: &Path) -> io::Result<Vec<OsString>> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(read_failure(directory, error)),
    };
    entries
        .map(|entry| entry.map(|entry| entry.file_name()))
        .collect()
}

/// Whether `entry` is `.<name>.<random><suffix>`, for the name `name` alone and 16 lowercase
/// hexadecimal digits.
pub(super) fn is_marked_entry(entry: &OsString, name: &OsString, suffix: &str) -> bool {
    let entry = entry.as_bytes();
    let mut prefix = vec![b'.'];
    prefix.extend_from_slice(name.as_bytes());
    prefix.push(b'.');
    let Some(rest) = entry.strip_prefix(prefix.as_slice()) else {
        return false;
    };
    let Some(random) = rest.strip_suffix(suffix.as_bytes()) else {
        return false;
    };
    random.len() == 16
        && random
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

/// Removes every staging file a run left beside `path`, and nothing else in its directory.
pub fn remove_staging_files(path: &Path) -> io::Result<()> {
    let directory = parent_of(path);
    let name = name_of(path);
    for entry in entries_of(&directory)? {
        if is_marked_entry(&entry, &name, STAGING_SUFFIX) {
            remove_file_if_present(&directory.join(entry))?;
        }
    }
    Ok(())
}

/// Creates one directory, with no parent created, passing the step to the probe first.
pub(super) fn make_directory(path: &Path) -> io::Result<()> {
    probe(Step::BeforeCreateDirectory(path));
    fs::create_dir(path)
}

/// Creates one directory whose parent exists, with the permission bits `mode` names whatever the
/// umask, when it names any; one another process created first is no error and keeps its own
/// mode.
pub fn create_directory(path: &Path, mode: Option<u32>) -> io::Result<()> {
    match make_directory(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(error),
    }
    if let Some(mode) = mode {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

/// Removes a directory when it is empty; one that holds anything, or is gone, stays as it is.
pub fn remove_empty_directory(path: &Path) -> io::Result<()> {
    if !lstat(path)?.is_some_and(|metadata| metadata.is_dir()) {
        return Ok(());
    }
    match fs::remove_dir(path) {
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::DirectoryNotEmpty
                    | io::ErrorKind::AlreadyExists
                    | io::ErrorKind::NotFound
            ) =>
        {
            Ok(())
        }
        other => other,
    }
}

/// The real path of `path` through the nearest ancestor that exists: that ancestor is resolved
/// through every link, and the parts below it that do not exist are kept as they are.
pub fn real_path(path: &Path) -> io::Result<PathBuf> {
    let mut below = Vec::new();
    let mut current = path.to_path_buf();
    loop {
        match fs::canonicalize(&current) {
            Ok(resolved) => {
                return Ok(below
                    .iter()
                    .rev()
                    .fold(resolved, |resolved, part: &OsString| resolved.join(part)));
            }
            Err(error) => {
                let parent = parent_of(&current);
                if !is_missing(&error) || parent == current {
                    return Err(read_failure(&current, error));
                }
                below.push(name_of(&current));
                current = parent;
            }
        }
    }
}

/// The missing directories above `path`, outermost first, which writing it needs created.
pub fn missing_parents(path: &Path) -> io::Result<Vec<PathBuf>> {
    let mut missing = Vec::new();
    let mut directory = parent_of(path);
    while !exists(&directory)? {
        missing.insert(0, directory.clone());
        let parent = parent_of(&directory);
        if parent == directory {
            break;
        }
        directory = parent;
    }
    Ok(missing)
}
