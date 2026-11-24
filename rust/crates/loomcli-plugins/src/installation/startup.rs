//! The startup-file reads and writes of the installed-files module. A startup file is the
//! operator's, so the module reads it as text in its own encoding, appends a line in place, and
//! replaces or removes only lines equal to a recorded one, keeping every other byte.

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use super::InstallationError;
use super::disk::{self, PERMISSION_BITS, ReplaceOptions};

/// The encodings the module reads: UTF-8 with or without its byte order mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartupEncoding {
    /// UTF-8 with no byte order mark.
    Utf8,
    /// UTF-8 after its byte order mark.
    Utf8Bom,
}

/// A startup file's text, its byte order mark excluded, and the encoding it was read in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct StartupText {
    pub(super) encoding: StartupEncoding,
    pub(super) text: String,
}

/// Why a startup file that is there is not a regular file, followed through a symbolic link.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum NotFile {
    /// A link to nothing.
    Link,
    Directory,
    Special,
}

/// What a startup file is, read through any symbolic link: nothing, not a regular file, a file the
/// process may not read, a file in an encoding the module does not read, or its text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum StartupRead {
    Absent,
    NotFile(NotFile),
    Unreadable,
    UnknownEncoding,
    Text(StartupText),
}

/// UTF-8's byte order mark, which the module reads past and writes back.
const UTF8_MARK: &[u8] = &[0xef, 0xbb, 0xbf];

/// The mode a startup file the module creates takes, whatever the umask.
const CREATED_MODE: u32 = 0o644;

/// A startup file's bytes as UTF-8 text, past its byte order mark when it starts with one, or
/// `None` for bytes that are not valid UTF-8, as a file in another encoding is.
fn decode(bytes: Vec<u8>) -> Option<StartupText> {
    let marked = bytes.starts_with(UTF8_MARK);
    let body = if marked {
        bytes[UTF8_MARK.len()..].to_vec()
    } else {
        bytes
    };
    let text = String::from_utf8(body).ok()?;
    Some(StartupText {
        encoding: if marked {
            StartupEncoding::Utf8Bom
        } else {
            StartupEncoding::Utf8
        },
        text,
    })
}

/// A whole file's text as UTF-8, with the byte order mark first when the file was read with one.
fn encode(text: &str, encoding: StartupEncoding) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(text.len() + UTF8_MARK.len());
    if encoding == StartupEncoding::Utf8Bom {
        bytes.extend_from_slice(UTF8_MARK);
    }
    bytes.extend_from_slice(text.as_bytes());
    bytes
}

/// What `path` is, followed through a symbolic link, without reading its content: `None` for a
/// regular file.
fn startup_kind(path: &Path) -> io::Result<Option<StartupRead>> {
    let Some(own) = disk::lstat(path)? else {
        return Ok(Some(StartupRead::Absent));
    };
    let followed = if own.file_type().is_symlink() {
        match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if disk::is_missing(&error) => {
                return Ok(Some(StartupRead::NotFile(NotFile::Link)));
            }
            Err(error) => return Err(error),
        }
    } else {
        own
    };
    if followed.is_dir() {
        return Ok(Some(StartupRead::NotFile(NotFile::Directory)));
    }
    Ok((!followed.is_file()).then_some(StartupRead::NotFile(NotFile::Special)))
}

/// Reads a startup file through any symbolic link: absent, not a file, one the process may not
/// read, an unknown encoding, or its text.
pub(super) fn read_startup(path: &Path) -> io::Result<StartupRead> {
    if let Some(kind) = startup_kind(path)? {
        return Ok(kind);
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            return Ok(StartupRead::Unreadable);
        }
        Err(error) => return Err(error),
    };
    Ok(decode(bytes).map_or(StartupRead::UnknownEncoding, StartupRead::Text))
}

/// One line of a startup file and the line ending after it, empty for a last line with none.
struct Segment<'a> {
    content: &'a str,
    ending: &'static str,
}

/// The lines of some text, split at each line feed, with a carriage return right before the line
/// feed moved into the line ending.
fn segments_of(text: &str) -> Vec<Segment<'_>> {
    let mut pieces: Vec<&str> = text.split('\n').collect();
    let last = pieces.pop().unwrap_or_default();
    let mut segments: Vec<Segment<'_>> = pieces
        .into_iter()
        .map(|piece| match piece.strip_suffix('\r') {
            Some(content) => Segment {
                content,
                ending: "\r\n",
            },
            None => Segment {
                content: piece,
                ending: "\n",
            },
        })
        .collect();
    if !last.is_empty() {
        segments.push(Segment {
            content: last,
            ending: "",
        });
    }
    segments
}

/// Whether some text holds `line`: one of its lines equals it exactly.
pub(super) fn holds_line(text: &str, line: &str) -> bool {
    segments_of(text)
        .iter()
        .any(|segment| segment.content == line)
}

/// The text's own line ending: its first line break, or a line feed when it has none.
fn line_ending_of(text: &str) -> &'static str {
    segments_of(text)
        .iter()
        .find(|segment| !segment.ending.is_empty())
        .map_or("\n", |segment| segment.ending)
}

/// What appending `line` to some text adds: a line break first when the text does not end with
/// one.
fn appendix(text: &str, line: &str) -> String {
    let ending = line_ending_of(text);
    let separator = if text.is_empty() || text.ends_with('\n') {
        ""
    } else {
        ending
    };
    format!("{separator}{line}{ending}")
}

/// Appends `line` to an existing startup file in place, through any symbolic link, in the file's
/// own line ending, so the file keeps its owner, mode, links, and every other byte.
pub(super) fn append_line(path: &Path, content: &StartupText, line: &str) -> io::Result<()> {
    disk::append(path, appendix(&content.text, line).as_bytes())
}

/// Creates a missing startup file exclusively for appending, holding `line` and a line feed as
/// UTF-8 without a byte order mark, with mode 644 whatever the umask. Answers `false`, writing
/// nothing, when the file exists by the time it is created.
pub(super) fn create_startup_file(path: &Path, line: &str) -> io::Result<bool> {
    disk::create_new(path, format!("{line}\n").as_bytes(), Some(CREATED_MODE))
}

/// A recorded line's text and what takes its place, `None` to remove it with its line ending.
pub(super) struct LineEdit<'a> {
    pub(super) prior: &'a str,
    pub(super) replacement: Option<&'a str>,
}

/// The text with each line equal to the edit's prior text replaced where it stands, or removed.
fn edited(text: &str, edit: &LineEdit<'_>) -> String {
    let mut out = String::with_capacity(text.len());
    for Segment { content, ending } in segments_of(text) {
        if content != edit.prior {
            out.push_str(content);
            out.push_str(ending);
        } else if let Some(replacement) = edit.replacement {
            out.push_str(replacement);
            out.push_str(ending);
        }
    }
    out
}

/// The real path of `path` through every symbolic link, or `path` itself when nothing is there. A
/// file the process may not reach that is not a link resolves through its folder instead.
pub(super) fn real_path_of(path: &Path) -> io::Result<PathBuf> {
    match fs::canonicalize(path) {
        Ok(real) => Ok(real),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(error)
            if error.kind() == io::ErrorKind::PermissionDenied
                && !fs::symlink_metadata(path)?.file_type().is_symlink() =>
        {
            Ok(fs::canonicalize(disk::parent_of(path))?.join(disk::name_of(path)))
        }
        Err(error) => Err(error),
    }
}

/// Replaces or removes each line equal to the recorded text by writing the startup file's real
/// path through a staging file and a rename, keeping every other byte, the byte order mark, and
/// the permission bits, so a symbolic link stays a link.
pub(super) fn rewrite_lines(
    path: &Path,
    content: &StartupText,
    edit: &LineEdit<'_>,
) -> Result<(), InstallationError> {
    let real = real_path_of(path)?;
    let mode = fs::metadata(&real)?.permissions().mode() & PERMISSION_BITS;
    disk::replace_file(
        &real,
        &encode(&edited(&content.text, edit), content.encoding),
        ReplaceOptions::new().mode(mode),
    )
}

/// What a plugin reads of a startup file before it lists a line: whether the module can read it,
/// and whether it holds the line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartupFileState {
    /// Nothing is there.
    Absent,
    /// A directory, another kind of file, or a link to nothing or to one of them.
    NotFile,
    /// A file the process may not read.
    Unreadable,
    /// A file in an encoding the module does not read.
    UnknownEncoding,
    /// A file the module reads.
    Text {
        /// The encoding it was read in.
        encoding: StartupEncoding,
        /// Whether one of its lines equals the line.
        holds: bool,
    },
}

/// Reads a startup file, through any symbolic link, as the module reads it: nothing there, not a
/// regular file, one the process may not read, an encoding the module does not read, or its
/// encoding and whether it holds `line`. The plugin judges from it, with whatever else it checks,
/// whether it may change the file.
pub fn inspect_startup_file(path: &Path, line: &str) -> io::Result<StartupFileState> {
    Ok(match read_startup(path)? {
        StartupRead::Absent => StartupFileState::Absent,
        StartupRead::NotFile(_) => StartupFileState::NotFile,
        StartupRead::Unreadable => StartupFileState::Unreadable,
        StartupRead::UnknownEncoding => StartupFileState::UnknownEncoding,
        StartupRead::Text(content) => StartupFileState::Text {
            encoding: content.encoding,
            holds: holds_line(&content.text, line),
        },
    })
}
