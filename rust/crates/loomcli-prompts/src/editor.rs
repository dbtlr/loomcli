//! The editor question: Enter opens the operator's editor on a private temporary file, and the
//! text the file holds when the editor exits is the answer.

use crate::messages;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use loomcli_core::{
    ChildExit, ChildStream, Context, Error, Failure, FatalError, KillSignal, ProcessSignal,
    SpawnOptions, ValidationContext, ValueLink, question_validation_context,
};
use tokio_util::sync::CancellationToken;

use crate::controls::{PASTE_OFF, SHOW_CURSOR, controls};
use crate::question::{Begun, Shown, region_closed, stopped};
use crate::reader::Key;
use crate::views::{EditorFrame, QuestionFrame};

/// The operator's editor failed: it could not start, it exited with an error, or its file could not
/// be written. Exit 1.
#[derive(Debug, Failure)]
#[failure(code = "editor-failed")]
pub struct EditorError {
    #[failure(base)]
    base: FatalError,
    editor: String,
    status: Option<i32>,
}

impl EditorError {
    fn new(message: String, editor: &str, status: Option<i32>) -> Self {
        Self {
            base: FatalError::new(message),
            editor: editor.to_owned(),
            status,
        }
    }

    /// The command line the question ran.
    #[must_use]
    pub fn editor(&self) -> &str {
        &self.editor
    }

    /// The code the shell or the editor exited with; `None` when nothing exited.
    #[must_use]
    pub fn status(&self) -> Option<i32> {
        self.status
    }
}

/// The system error's code, such as `ENOENT`, or `unknown`.
fn system_code(error: &io::Error) -> &'static str {
    match error.raw_os_error() {
        Some(1) => "EPERM",
        Some(2) => "ENOENT",
        Some(13) => "EACCES",
        Some(17) => "EEXIST",
        Some(20) => "ENOTDIR",
        Some(21) => "EISDIR",
        Some(24) => "EMFILE",
        Some(28) => "ENOSPC",
        Some(30) => "EROFS",
        #[cfg(target_os = "linux")]
        Some(36) => "ENAMETOOLONG",
        #[cfg(target_os = "linux")]
        Some(40) => "ELOOP",
        #[cfg(target_os = "macos")]
        Some(62) => "ELOOP",
        #[cfg(target_os = "macos")]
        Some(63) => "ENAMETOOLONG",
        _ => match error.kind() {
            io::ErrorKind::NotFound => "ENOENT",
            io::ErrorKind::PermissionDenied => "EACCES",
            io::ErrorKind::AlreadyExists => "EEXIST",
            io::ErrorKind::IsADirectory => "EISDIR",
            io::ErrorKind::NotADirectory => "ENOTDIR",
            _ => "unknown",
        },
    }
}

/// Six characters for a temporary folder's name, from the standard library's random hash keys.
fn random_suffix() -> String {
    use std::hash::{BuildHasher, Hasher};
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos()),
    );
    let mut bits = hasher.finish();
    (0..6)
        .map(|_| {
            let index = (bits % ALPHABET.len() as u64) as usize;
            bits /= ALPHABET.len() as u64;
            char::from(ALPHABET[index])
        })
        .collect()
}

/// Creates a folder readable and writable by the operator's user alone.
fn private_folder(parent: &Path, prefix: &str) -> io::Result<PathBuf> {
    loop {
        let folder = parent.join(format!("{prefix}-{}", random_suffix()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        match builder.create(&folder) {
            Ok(()) => return Ok(folder),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
}

/// Writes `bytes` into a new file only the operator's user reads.
fn write_new(file: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(file)?.write_all(bytes)
}

/// Removes `path` and what it holds, file or folder, ignoring a failure.
fn remove(path: &Path) {
    if std::fs::remove_dir_all(path).is_err() {
        let _ = std::fs::remove_file(path);
    }
}

/// Removes the question's folder when the question ends, by any path, a drop included.
struct FolderGuard(Arc<Mutex<Option<PathBuf>>>);

impl Drop for FolderGuard {
    fn drop(&mut self) {
        if let Some(folder) = self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
        {
            remove(folder);
        }
    }
}

/// What the editor question asks.
pub(crate) struct EditorQuestion<'a> {
    pub(crate) message: &'a str,
    pub(crate) hint: Option<String>,
    pub(crate) extension: Option<&'a str>,
    pub(crate) link: Option<&'a ValueLink>,
}

/// An answer's lines: its text split at each line break, a final one ending the last line.
fn lines_of(saved: &str) -> Vec<&str> {
    if saved.is_empty() {
        return Vec::new();
    }
    let trimmed = saved
        .strip_suffix("\r\n")
        .or_else(|| saved.strip_suffix('\n'))
        .unwrap_or(saved);
    trimmed
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

/// Asks an editor question: `judge` checks the saved text.
#[allow(clippy::too_many_lines)]
pub(crate) async fn ask_editor<I, R: 'static, T>(
    context: &Context<I, R>,
    question: EditorQuestion<'_>,
    begun: Begun,
    judge: impl Fn(&str, &ValidationContext) -> Result<T, String>,
) -> Result<T, Error> {
    let command = [
        context.host.env.get("VISUAL"),
        context.host.env.get("EDITOR"),
    ]
    .into_iter()
    .flatten()
    .find(|value| !value.trim().is_empty())
    .cloned()
    .unwrap_or_else(|| "vi".to_owned());
    let Begun {
        mut reader,
        mut draw,
    } = begun;
    let region = draw.signal();
    let folder: Arc<Mutex<Option<PathBuf>>> = Arc::new(Mutex::new(None));
    let cleanup = {
        let folder = Arc::clone(&folder);
        move || {
            if let Some(folder) = folder
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .as_ref()
            {
                remove(folder);
            }
        }
    };
    // A question dropped before it settles still removes its folder.
    let _guard = FolderGuard(Arc::clone(&folder));
    let unshutdown = {
        let cleanup = cleanup.clone();
        context.on_shutdown(move |_| cleanup())
    };
    let validation = question_validation_context(context, question.link, question.message);
    let mut answered: Option<Shown> = None;
    let frame = |editing: bool, issue: &Option<String>| {
        let mut frame = EditorFrame::new(question.message, editing);
        frame.issue = issue.clone();
        QuestionFrame::Editor(frame)
    };
    let outcome: Result<T, Error> = async {
        let mut file = PathBuf::new();
        let mut held: Vec<u8> = question.hint.clone().unwrap_or_default().into_bytes();
        let mut lost = false;
        let mut issue: Option<String> = None;
        reader.start(context).await?;
        draw.frame(context, frame(false, &issue)).await?;
        // The question shows now, so keys left from the reads an earlier question took are not its
        // own.
        reader.discard_taken();
        loop {
            let key = reader
                .read(context, &region)
                .await
                .map_err(|stop| stopped(context, stop))?;
            if key == Key::Eof {
                context.cancel();
                context.signal.throw_if_cancelled()?;
            }
            if key != Key::Enter {
                continue;
            }
            issue = None;
            let created = (|| -> io::Result<()> {
                let existing = folder
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone();
                match existing {
                    None => {
                        let made = private_folder(&context.host.tmpdir, &context.graph.name)?;
                        *folder.lock().unwrap_or_else(PoisonError::into_inner) = Some(made.clone());
                        let extension = question.extension.unwrap_or_default();
                        let name = if extension.is_empty() || extension.starts_with('.') {
                            format!("answer{extension}")
                        } else {
                            format!("answer.{extension}")
                        };
                        file = made.join(name);
                        write_new(&file, &held)
                    }
                    Some(_) if lost => {
                        remove(&file);
                        write_new(&file, &held)?;
                        lost = false;
                        Ok(())
                    }
                    Some(_) => Ok(()),
                }
            })();
            if let Err(error) = created {
                return Err(EditorError::new(
                    messages::editor_file_unwritable(
                        &context.host.tmpdir.to_string_lossy(),
                        system_code(&error),
                    ),
                    &command,
                    None,
                )
                .into());
            }
            draw.frame(context, frame(true, &issue)).await?;
            reader.pause();
            draw.lend(true);
            let lent: Result<Option<ChildExit>, Error> = async {
                context
                    .out
                    .draw(format!("{PASTE_OFF}{SHOW_CURSOR}").as_str(), &controls())
                    .await?;
                let token = CancellationToken::new();
                let watcher = {
                    let token = token.clone();
                    let run = context.signal.token();
                    let region = region.clone();
                    tokio::spawn(async move {
                        let run = run.cancelled();
                        let closed = region.cancelled();
                        let mut run = std::pin::pin!(run);
                        let mut closed = std::pin::pin!(closed);
                        std::future::poll_fn(|cx| {
                            if run.as_mut().poll(cx).is_ready()
                                || closed.as_mut().poll(cx).is_ready()
                            {
                                std::task::Poll::Ready(())
                            } else {
                                std::task::Poll::Pending
                            }
                        })
                        .await;
                        token.cancel();
                    })
                };
                let path = file.to_string_lossy().into_owned();
                let script = format!("exec 1>&2; exec {command} \"$@\"");
                let running: Arc<Mutex<Option<Arc<loomcli_core::Child>>>> =
                    Arc::new(Mutex::new(None));
                let registration = {
                    let running = Arc::clone(&running);
                    let cleanup = cleanup.clone();
                    context.on_shutdown(move |_| {
                        if let Some(child) = running
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .as_ref()
                        {
                            child.kill(KillSignal::Signal(ProcessSignal::Term));
                        }
                        cleanup();
                    })
                };
                let host = Arc::clone(&context.host);
                let spawned = Arc::clone(&running);
                let options = SpawnOptions::new()
                    .signal(token.clone())
                    .stderr(ChildStream::Inherit)
                    .stdout(ChildStream::Ignore)
                    .inherit_stdin();
                let arguments = ["-c".to_owned(), script, command.clone(), path];
                let exit = context
                    .out
                    .lend_terminal(move || async move {
                        let child = Arc::new(host.spawn("/bin/sh", arguments, options));
                        *spawned.lock().unwrap_or_else(PoisonError::into_inner) =
                            Some(Arc::clone(&child));
                        child.exited().await
                    })
                    .await;
                registration.remove();
                watcher.abort();
                Ok(Some(exit))
            }
            .await;
            draw.lend(false);
            let exit = lent?;
            context.signal.throw_if_cancelled()?;
            if region.is_cancelled() {
                return Err(region_closed());
            }
            let status = match exit {
                Some(ChildExit::Exited { code, .. }) => Some(code),
                _ => None,
            };
            match status {
                None | Some(126 | 127) => {
                    return Err(EditorError::new(
                        messages::editor_not_started(&command),
                        &command,
                        status,
                    )
                    .into());
                }
                Some(0) => {}
                Some(code) => {
                    return Err(EditorError::new(
                        messages::editor_exited(&command, code),
                        &command,
                        status,
                    )
                    .into());
                }
            }
            let mut saved = String::new();
            match std::fs::read(&file) {
                Err(error) => {
                    lost = true;
                    let code = system_code(&error);
                    issue = Some(if code == "ENOENT" {
                        messages::ANSWER_FILE_REMOVED.to_owned()
                    } else {
                        messages::answer_file_unreadable(code)
                    });
                }
                Ok(bytes) => {
                    held.clone_from(&bytes);
                    match String::from_utf8(bytes) {
                        Ok(text) => saved = text,
                        Err(_) => {
                            issue = Some(messages::ANSWER_NOT_UTF8.to_owned());
                        }
                    }
                }
            }
            if issue.is_none() {
                let judged = judge(&saved, &validation);
                context.signal.throw_if_cancelled()?;
                match judged {
                    Ok(value) => {
                        let lines = lines_of(&saved);
                        let first = lines
                            .iter()
                            .find(|line| {
                                line.chars().any(|c| !c.is_whitespace() && c != '\u{feff}')
                            })
                            .map_or_else(String::new, |line| (*line).to_owned());
                        answered = Some(Shown {
                            value: Some(first),
                            lines: Some(lines.len()),
                        });
                        return Ok(value);
                    }
                    Err(message) => issue = Some(message),
                }
            }
            reader.resume(context).await;
            draw.frame(context, frame(false, &issue)).await?;
        }
    }
    .await;
    unshutdown.remove();
    cleanup();
    let released = reader.close();
    if !released {
        reader.resume(context).await;
    }
    let finished = draw.finish(context, answered, released).await;
    let value = outcome?;
    finished?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::lines_of;

    #[test]
    fn a_final_line_break_ends_the_last_line_and_starts_none() {
        assert_eq!(lines_of("Fix the parser.\n"), ["Fix the parser."]);
        assert_eq!(
            lines_of("## Changes\r\n\r\n- Fix.\r\n"),
            ["## Changes", "", "- Fix."]
        );
        assert!(lines_of("").is_empty());
    }
}
