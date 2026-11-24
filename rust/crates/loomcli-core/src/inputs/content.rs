//! Content inputs and the standalone stdin declaration: the lazy handles an action reads, and the
//! preparation that checks each source's count, existence, and readability without reading it.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::failures::Error;
use crate::host::{Host, InputStream};
use crate::support::BoxFuture;

use super::Issue;

/// Where a content input reads from.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum ContentKind {
    /// A file, at the operand joined to the run's working directory without normalizing, so its
    /// dot segments and trailing separators reach the file system as written.
    File {
        /// The absolute path.
        path: String,
    },
    /// Piped stdin.
    Stdin,
}

/// What a content handle reads: the run's stdin, or a file opened afresh on every read.
#[derive(Clone)]
pub(crate) enum ContentSource {
    Stdin(Arc<dyn InputStream>),
    File(PathBuf),
}

/// A source an action reads: a file or piped stdin. Reading is deferred to the action, so a run
/// that never reads it opens nothing.
#[derive(Clone)]
#[non_exhaustive]
pub struct Content {
    /// Where it reads from.
    pub kind: ContentKind,
    /// The name a message prints: the operand as the operator supplied it, or `stdin`.
    pub name: String,
    pub(crate) source: ContentSource,
}

impl Content {
    /// Reads the rest of the source as UTF-8 text; an invalid sequence reads as U+FFFD, as a
    /// `TextDecoder` reads it. A file opens afresh; stdin reads on from where it stands, so a
    /// second read of a stdin that reached its end is empty.
    pub async fn text(&self) -> Result<String, Error> {
        // Valid UTF-8, the ordinary case, becomes the text without a second copy.
        Ok(match String::from_utf8(self.bytes().await?) {
            Ok(text) => text,
            Err(invalid) => String::from_utf8_lossy(invalid.as_bytes()).into_owned(),
        })
    }

    /// Reads the rest of the source as bytes, under the rules [`Content::text`] states.
    pub async fn bytes(&self) -> Result<Vec<u8>, Error> {
        // A file is read in one call sized from its length, not a chunk at a time.
        if let ContentSource::File(path) = &self.source {
            return tokio::fs::read(path).await.map_err(Error::from);
        }
        let stream = self.stream();
        let mut contents = Vec::new();
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let read = stream.read(&mut buffer).await.map_err(Error::from)?;
            if read == 0 {
                return Ok(contents);
            }
            contents.extend_from_slice(&buffer[..read]);
        }
    }

    /// The source as a stream, for a reader that handles it in chunks. A file's stream opens the
    /// file at its first read, afresh for every call; stdin's is the run's own stream, borrowed,
    /// neither buffered for a replay nor closed.
    #[must_use]
    pub fn stream(&self) -> Arc<dyn InputStream> {
        match &self.source {
            ContentSource::Stdin(stream) => Arc::clone(stream),
            ContentSource::File(path) => Arc::new(FileStream {
                path: path.clone(),
                file: tokio::sync::Mutex::new(None),
            }),
        }
    }
}

impl std::fmt::Debug for Content {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Content")
            .field("kind", &self.kind)
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

/// A file read in chunks, opened at its first read.
struct FileStream {
    path: PathBuf,
    file: tokio::sync::Mutex<Option<tokio::fs::File>>,
}

impl InputStream for FileStream {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            use tokio::io::AsyncReadExt;
            let mut file = self.file.lock().await;
            if file.is_none() {
                *file = Some(tokio::fs::File::open(&self.path).await?);
            }
            match file.as_mut() {
                Some(file) => file.read(buffer).await,
                None => Ok(0),
            }
        })
    }
}

/// A standalone stdin declaration: the Command reads piped stdin as a whole, under `ctx.stdin`.
#[derive(Clone, Debug, Default)]
#[must_use]
pub struct Stdin {
    pub(crate) description: Option<String>,
    pub(crate) required: bool,
}

impl Stdin {
    /// An optional stdin declaration.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the description every projection reads.
    pub fn description(mut self, text: impl Into<String>) -> Self {
        self.description = Some(text.into());
        self
    }

    /// Requires piped stdin.
    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }

    /// The call a finding prints: `stdin(Stdin::new()…)`.
    pub(crate) fn literal(&self) -> crate::diagnostics::Literal {
        let mut literal = crate::diagnostics::Literal::builder("Stdin::new()");
        if let Some(description) = &self.description {
            literal = literal.call("description", vec![description.as_str().into()]);
        }
        if self.required {
            literal = literal.call("required", Vec::new());
        }
        literal
    }
}

/// What one content declaration takes: whether it claims stdin, and its source count bounds.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ContentSettings {
    pub(crate) stdin: bool,
    pub(crate) required: bool,
    pub(crate) min: Option<usize>,
    pub(crate) max: Option<usize>,
}

/// Where one content input is prepared: the host whose working directory a relative path reads
/// against, whether the run is an invocation by name, and whether the input collects a list.
pub(crate) struct ContentScope<'a> {
    pub(crate) host: &'a Host,
    pub(crate) named: bool,
    pub(crate) collected: bool,
    pub(crate) cancelled: &'a dyn Fn() -> bool,
}

/// One content input's prepared value: one handle, a list, or none.
#[derive(Clone, Debug)]
pub(crate) enum Prepared {
    One(Option<Content>),
    Many(Vec<Content>),
}

/// The outcome of one preparation. `missing` marks a rejection that is an omission: no source
/// was named and the input needs at least one.
pub(crate) enum PreparedContent {
    Ready(Prepared),
    Rejected { issues: Vec<Issue>, missing: bool },
}

/// Requiredness and an explicit lower bound describe one effective source minimum.
fn minimum_sources(settings: &ContentSettings) -> usize {
    let required = usize::from(settings.required);
    settings.min.map_or(required, |min| min.max(required))
}

/// A stdin handle borrows the run's stream, so repeated handles share its current position.
fn stdin_content(host: &Host) -> Content {
    Content {
        kind: ContentKind::Stdin,
        name: "stdin".to_owned(),
        source: ContentSource::Stdin(host.stdin()),
    }
}

/// The operand as a path under the run's working directory, joined to it without normalizing, so
/// its dot segments and trailing separators reach file system resolution.
fn absolute_source(name: &str, host: &Host) -> PathBuf {
    if Path::new(name).is_absolute() {
        return PathBuf::from(name);
    }
    let mut path = OsString::from(host.cwd.as_os_str());
    if !host
        .cwd
        .as_os_str()
        .to_string_lossy()
        .ends_with(std::path::MAIN_SEPARATOR)
    {
        path.push(std::path::MAIN_SEPARATOR_STR);
    }
    path.push(name);
    PathBuf::from(path)
}

/// Whether a probe's error is a verdict on the path, which rejects it, rather than a failure of
/// the probe itself.
#[cfg(unix)]
fn is_verdict(error: &io::Error) -> bool {
    use rustix::io::Errno;
    let errno = Errno::from_io_error(error);
    [
        Errno::NOENT,
        Errno::NOTDIR,
        Errno::ACCESS,
        Errno::PERM,
        Errno::LOOP,
        Errno::NAMETOOLONG,
        Errno::INVAL,
    ]
    .into_iter()
    .any(|verdict| errno == Some(verdict))
}

#[cfg(not(unix))]
fn is_verdict(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied | io::ErrorKind::InvalidInput
    )
}

/// Whether a source is one a content input reads: a file, or a pipe or a device that is not, in an
/// invocation by name, the process's own stdin reached through a file system alias. The path
/// reaches the real file system, whatever the run's process handle.
#[cfg(unix)]
fn accepts_source(metadata: &std::fs::Metadata, named: bool) -> bool {
    use std::os::unix::fs::FileTypeExt;
    let kind = metadata.file_type();
    kind.is_file()
        || ((kind.is_fifo() || kind.is_char_device() || kind.is_block_device())
            && !(named && aliases_process_stdin(metadata)))
}

#[cfg(not(unix))]
fn accepts_source(metadata: &std::fs::Metadata, _named: bool) -> bool {
    metadata.file_type().is_file()
}

/// Whether a source is the process's own stdin: the same device and inode as descriptor 0. A
/// process with no descriptor 0 has no stdin to alias.
#[cfg(unix)]
fn aliases_process_stdin(metadata: &std::fs::Metadata) -> bool {
    use std::os::fd::AsFd;
    use std::os::unix::fs::MetadataExt;
    let stdin = io::stdin();
    // Std's metadata, read through a duplicate of descriptor 0, because the raw `st_dev` differs
    // in type between platforms (`i32` on Darwin) while `MetadataExt::dev` is `u64` on every Unix.
    let descriptor = stdin
        .as_fd()
        .try_clone_to_owned()
        .and_then(|own| std::fs::File::from(own).metadata())
        .is_ok_and(|own| own.dev() == metadata.dev() && own.ino() == metadata.ino());
    // Darwin's file-descriptor path can report a pipe's inode apart from the descriptor's own.
    let darwin = cfg!(target_os = "macos")
        && std::fs::metadata("/dev/fd/0")
            .is_ok_and(|own| own.dev() == metadata.dev() && own.ino() == metadata.ino());
    descriptor || darwin
}

/// Whether the path may be read: a metadata and access probe, which never opens a pipe or consumes
/// a stream. An error that is no verdict on the path is the probe's own failure.
fn readable_source(path: &Path, named: bool) -> Result<bool, Error> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if is_verdict(&error) => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !accepts_source(&metadata, named) {
        return Ok(false);
    }
    readable(path)
}

#[cfg(unix)]
fn readable(path: &Path) -> Result<bool, Error> {
    match rustix::fs::access(path, rustix::fs::Access::READ_OK) {
        Ok(()) => Ok(true),
        Err(errno) => {
            let error = io::Error::from(errno);
            if is_verdict(&error) {
                Ok(false)
            } else {
                Err(error.into())
            }
        }
    }
}

#[cfg(not(unix))]
fn readable(path: &Path) -> Result<bool, Error> {
    match std::fs::File::open(path) {
        Ok(_) => Ok(true),
        Err(error) if is_verdict(&error) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

/// The issue of a file operand core cannot read.
const UNREADABLE: &str = "Expected a readable file that exists.";

/// A successful probe leaves opening the file to the action's first read.
fn file_content(name: &str, scope: &ContentScope<'_>) -> Result<Result<Content, Issue>, Error> {
    if name.is_empty() || name.contains('\0') {
        return Ok(Err(Issue::new(UNREADABLE)));
    }
    let path = absolute_source(name, scope.host);
    if !readable_source(&path, scope.named)? {
        return Ok(Err(Issue::new(UNREADABLE)));
    }
    Ok(Ok(Content {
        kind: ContentKind::File {
            path: path.to_string_lossy().into_owned(),
        },
        name: name.to_owned(),
        source: ContentSource::File(path),
    }))
}

/// The operands one input names, with `-` appended when the input claims stdin, the run is an
/// argv run whose stdin is no terminal, and a collection or an input with no operand reads it.
fn source_tokens(
    raw: &[String],
    settings: &ContentSettings,
    scope: &ContentScope<'_>,
) -> Vec<String> {
    let mut tokens = raw.to_vec();
    if settings.stdin
        && !scope.named
        && !scope.host.terminal.stdin().is_tty
        && !tokens.iter().any(|token| token == "-")
        && (scope.collected || tokens.is_empty())
    {
        tokens.push("-".to_owned());
    }
    tokens
}

/// One operand's source: a file, or stdin for `-` on the input that claims it.
fn source_content(
    token: &str,
    settings: &ContentSettings,
    scope: &ContentScope<'_>,
) -> Result<Result<Content, Issue>, Error> {
    if token != "-" {
        return file_content(token, scope);
    }
    if !settings.stdin {
        return Ok(Err(Issue::new(
            "This input accepts file paths only. Use ./- for a file named -.",
        )));
    }
    if scope.named || scope.host.terminal.stdin().is_tty {
        return Ok(Err(Issue::new("Expected piped or redirected stdin.")));
    }
    Ok(Ok(stdin_content(scope.host)))
}

/// The count issues of one collection: below its minimum, above its maximum.
fn count_issues(count: usize, settings: &ContentSettings) -> Vec<Issue> {
    let sources = |n: usize| if n == 1 { "source" } else { "sources" };
    let mut issues = Vec::new();
    let minimum = minimum_sources(settings);
    if count < minimum {
        issues.push(Issue::new(format!(
            "Expected at least {minimum} readable {}.",
            sources(minimum)
        )));
    }
    if let Some(max) = settings.max
        && count > max
    {
        issues.push(Issue::new(format!(
            "Expected at most {max} readable {}.",
            sources(max)
        )));
    }
    issues
}

/// Prepares one content input from its raw operands: source assembly, then the count checks, and
/// never a read of stdin or of a file's contents. A probe that fails for a reason other than a
/// verdict on the path is the run's failure.
pub(crate) fn prepare_content(
    raw: &[String],
    settings: &ContentSettings,
    scope: &ContentScope<'_>,
) -> Result<PreparedContent, Error> {
    let tokens = source_tokens(raw, settings, scope);
    let mut sources = Vec::new();
    let mut issues = Vec::new();
    for (index, token) in tokens.iter().enumerate() {
        if (scope.cancelled)() {
            break;
        }
        match source_content(token, settings, scope)? {
            Ok(content) => sources.push(content),
            Err(issue) if scope.collected => {
                issues.push(issue.at(super::PathSegment::Index(index)));
            }
            Err(issue) => issues.push(issue),
        }
    }
    let mut found = count_issues(tokens.len(), settings);
    found.append(&mut issues);
    if !found.is_empty() {
        return Ok(PreparedContent::Rejected {
            issues: found,
            missing: tokens.is_empty() && minimum_sources(settings) > 0,
        });
    }
    Ok(PreparedContent::Ready(if scope.collected {
        Prepared::Many(sources)
    } else {
        Prepared::One(sources.into_iter().next())
    }))
}
