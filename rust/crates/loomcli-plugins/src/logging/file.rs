//! The size-rotated log file: one append per record, rotation before a write that would pass the
//! size, and a failed step reported to the author.

use std::fs::OpenOptions;
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};

use loomcli_core::Outcome;

use super::error::{LoggingError, LoggingErrorKind};

/// Where a failed step goes: the author's `on_error`, or nowhere. Its `Err` ends the write.
pub(super) type Report<'a> = &'a dyn Fn(LoggingError) -> Outcome;

/// Renames a file; a test substitutes a rename that loses a race.
pub(super) type Rename<'a> = &'a dyn Fn(&Path, &Path) -> io::Result<()>;

/// The log file, what it keeps, and where a failed step goes.
pub(super) struct FileSink<'a> {
    pub(super) path: &'a Path,
    /// The size past which the file rotates.
    pub(super) max_bytes: u64,
    /// How many rotated copies stay.
    pub(super) keep: usize,
    pub(super) report: Report<'a>,
    pub(super) rename: Rename<'a>,
}

/// The name of the `number`th rotated copy: the number goes before the file's last extension,
/// `collector.1.jsonl`, or after a name that has none, `hub.1`.
fn copy_name(path: &Path, number: usize) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = match path.extension() {
        Some(extension) => format!("{stem}.{number}.{}", extension.to_string_lossy()),
        None => format!("{stem}.{number}"),
    };
    path.with_file_name(name)
}

/// The size of the file now, or 0 when it is not there.
fn size_of(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |metadata| metadata.len())
}

/// Runs a file operation that a missing source does not fail: the file it names is already gone.
fn unless_missing(operation: io::Result<()>) -> io::Result<bool> {
    match operation {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        other => other.map(|()| true),
    }
}

/// Deletes the copy past `keep`, shifts each older copy up one, and renames the file to the first
/// copy. With `keep` 0 the file is deleted, as logrotate's `rotate 0` does. A copy that is not there
/// is skipped, and so is a file that is not there: another process rotated it first, and the record
/// then goes to the file now at the path.
fn rotate(path: &Path, keep: usize, rename: Rename<'_>) -> io::Result<bool> {
    if keep < 1 {
        return unless_missing(std::fs::remove_file(path));
    }
    unless_missing(std::fs::remove_file(copy_name(path, keep)))?;
    for number in (1..keep).rev() {
        unless_missing(rename(
            &copy_name(path, number),
            &copy_name(path, number + 1),
        ))?;
    }
    unless_missing(rename(path, &copy_name(path, 1)))
}

/// Rotates the file when the record would take it past `max_bytes`, reporting a failure.
fn rotate_when_full(sink: &FileSink<'_>, bytes: u64) -> Result<bool, loomcli_core::Error> {
    let size = size_of(sink.path);
    // A file with nothing in it has nothing to rotate, so an oversize record lands whole in it.
    if size == 0 || size.saturating_add(bytes) <= sink.max_bytes {
        return Ok(false);
    }
    match rotate(sink.path, sink.keep, sink.rename) {
        Ok(rotated) => Ok(rotated),
        Err(cause) => {
            (sink.report)(LoggingError::failed(
                LoggingErrorKind::Rotate,
                sink.path.to_path_buf(),
                cause,
            ))?;
            Ok(false)
        }
    }
}

/// Appends the record with one write, creating the file when it is not there.
fn append_once(path: &Path, record: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(record.as_bytes())
}

/// Appends the record, creating a missing directory once. It answers the failure of the step that
/// failed, or `None` when the record was written.
fn append(path: &Path, record: &str) -> Option<LoggingError> {
    let failure = match append_once(path, record) {
        Ok(()) => return None,
        Err(failure) => failure,
    };
    if failure.kind() != ErrorKind::NotFound {
        return Some(LoggingError::failed(
            LoggingErrorKind::Append,
            path.to_path_buf(),
            failure,
        ));
    }
    if let Some(directory) = path.parent() {
        if let Err(cause) = std::fs::create_dir_all(directory) {
            return Some(LoggingError::failed(
                LoggingErrorKind::CreateDirectory,
                directory.to_path_buf(),
                cause,
            ));
        }
    }
    append_once(path, record)
        .err()
        .map(|cause| LoggingError::failed(LoggingErrorKind::Append, path.to_path_buf(), cause))
}

/// What happened when writing one record.
pub(super) struct Written {
    pub(super) rotated: bool,
    pub(super) appended: bool,
}

/// Rotates when needed, appends the record, and returns which operations succeeded.
pub(super) fn write_record(
    sink: &FileSink<'_>,
    record: &str,
) -> Result<Written, loomcli_core::Error> {
    let rotated = rotate_when_full(sink, u64::try_from(record.len()).unwrap_or(u64::MAX))?;
    let failure = append(sink.path, record);
    let appended = failure.is_none();
    if let Some(failure) = failure {
        (sink.report)(failure)?;
    }
    Ok(Written { rotated, appended })
}

#[cfg(test)]
mod tests {
    //! The rotation race, ported from `logging-rotation.test.ts`: a rename that fails because
    //! another process rotated first appends to the file now at the path.
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use std::cell::Cell;
    use std::fs;

    use super::*;

    #[test]
    fn a_rename_that_fails_because_another_process_rotated_first_appends_to_the_file_now_at_the_path()
     {
        let directory =
            std::env::temp_dir().join(format!("loomcli-logging-race-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("collector.jsonl");
        let first_copy = directory.join("collector.1.jsonl");
        fs::write(&path, format!("{}\n", "x".repeat(150))).unwrap();
        let raced = Cell::new(false);
        let reports = Cell::new(0);
        // The other process rotates the file between this process's size check and its rename.
        let rename = |from: &Path, to: &Path| {
            if !raced.replace(true) {
                fs::rename(from, &first_copy)?;
                assert_eq!(to, first_copy);
            }
            fs::rename(from, to)
        };
        let report = |_: LoggingError| {
            reports.set(reports.get() + 1);
            Ok(())
        };
        let sink = FileSink {
            path: &path,
            max_bytes: 200,
            keep: 1,
            report: &report,
            rename: &rename,
        };
        write_record(&sink, &format!("{}\n", "y".repeat(150))).unwrap();
        assert_eq!(reports.get(), 0);
        let mut names: Vec<String> = fs::read_dir(&directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, ["collector.1.jsonl", "collector.jsonl"]);
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            format!("{}\n", "y".repeat(150))
        );
        assert_eq!(
            fs::read_to_string(&first_copy).unwrap(),
            format!("{}\n", "x".repeat(150))
        );
        fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn a_copy_puts_its_number_before_the_last_extension_or_after_a_name_without_one() {
        assert_eq!(
            copy_name(Path::new("/s/collector.jsonl"), 2),
            Path::new("/s/collector.2.jsonl")
        );
        assert_eq!(copy_name(Path::new("/s/hub"), 1), Path::new("/s/hub.1"));
        assert_eq!(
            copy_name(Path::new("/s/a.b.log"), 1),
            Path::new("/s/a.b.1.log")
        );
        assert_eq!(
            copy_name(Path::new("/s/.hidden"), 1),
            Path::new("/s/.hidden.1")
        );
    }
}
