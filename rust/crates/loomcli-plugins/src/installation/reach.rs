//! Maps a blocked installation path to a failure at the path the caller named.

use std::fmt;
use std::io::{self, ErrorKind};
use std::path::Path;

use super::messages;

#[derive(Debug)]
pub(super) struct ReachFailure(String);

impl fmt::Display for ReachFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ReachFailure {}

fn with_sentence(error: io::Error, sentence: String) -> io::Error {
    io::Error::new(error.kind(), ReachFailure(sentence))
}

pub(super) fn read_failure(path: &Path, error: io::Error) -> io::Error {
    let sentence = match error.kind() {
        ErrorKind::NotADirectory => messages::path_blocked(path),
        ErrorKind::PermissionDenied => messages::read_unreadable(path),
        _ => return error,
    };
    with_sentence(error, sentence)
}

pub(super) fn write_failure(path: &Path, error: io::Error) -> io::Error {
    let sentence = match error.kind() {
        ErrorKind::NotADirectory | ErrorKind::AlreadyExists => messages::path_blocked(path),
        ErrorKind::PermissionDenied => messages::write_unwritable(path, false),
        ErrorKind::ReadOnlyFilesystem => messages::write_unwritable(path, true),
        _ => return error,
    };
    with_sentence(error, sentence)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::installation::InstallationError;
    use loomcli_core::{Error, FailureFacts, FatalError, nowrap};

    fn failure(error: io::Error) -> String {
        let error = Error::from(InstallationError::from(error));
        let Some(failure) = error.downcast_failure::<FatalError>() else {
            panic!("expected a fatal failure, got {error:?}");
        };
        failure.message().to_owned()
    }

    #[test]
    fn a_blocked_path_names_the_path_for_reads_and_writes() {
        let path = Path::new("/sandbox/blocked/notes");
        let shown = nowrap("/sandbox/blocked/notes");
        let expected = format!(
            "Cannot reach {shown} because a file sits where one of its folders is needed. Remove or rename that file, then run the command again."
        );
        assert_eq!(
            failure(read_failure(path, ErrorKind::NotADirectory.into())),
            expected
        );
        for kind in [ErrorKind::NotADirectory, ErrorKind::AlreadyExists] {
            assert_eq!(failure(write_failure(path, kind.into())), expected);
        }
    }

    #[test]
    fn permissions_and_read_only_writes_have_distinct_corrections() {
        let path = Path::new("/sandbox/no access");
        let shown = nowrap("/sandbox/no access");
        assert_eq!(
            failure(read_failure(path, ErrorKind::PermissionDenied.into())),
            format!(
                "Cannot read {shown} because you do not have permission to reach or read it. Make it readable, then run the command again.",
            )
        );
        assert_eq!(
            failure(write_failure(path, ErrorKind::PermissionDenied.into())),
            format!(
                "Cannot write {shown} because you do not have permission to write there. Make the location writable, then run the command again.",
            )
        );
        assert_eq!(
            failure(write_failure(path, ErrorKind::ReadOnlyFilesystem.into())),
            format!(
                "Cannot write {shown} because the file system is read-only. Make the location writable, then run the command again.",
            )
        );
    }

    #[test]
    fn unrelated_errors_keep_their_kind_and_message() {
        let path = Path::new("/sandbox/notes");
        for kind in [
            ErrorKind::NotFound,
            ErrorKind::AlreadyExists,
            ErrorKind::ReadOnlyFilesystem,
        ] {
            let error = read_failure(path, io::Error::new(kind, "the original error"));
            assert_eq!(error.kind(), kind);
            assert_eq!(error.to_string(), "the original error");
        }
        let error = write_failure(path, io::Error::other("the original error"));
        assert_eq!(error.kind(), ErrorKind::Other);
        assert_eq!(error.to_string(), "the original error");
    }
}
