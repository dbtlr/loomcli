//! Asking PowerShell 7 for its profile: the program found on an absolute `PATH` entry, run from the
//! home folder with the pinned words, and its answer, the profile's path in Base64 of its UTF-8
//! bytes, decoded and judged.

use std::path::{Path, PathBuf};

use loomcli_core::{ChildExit, ChildStream, Error, FatalError, Host, RunSignal, SpawnOptions};

use super::messages::{self, ProfileFault};
use super::paths::{join, normalize};
use super::startup::may_execute;

/// The program the profile query runs, and the shell its failures name.
const SHELL: &str = "pwsh";

/// The words the shell runs with: no logo, no profile, no prompt, and one command.
const WORDS: [&str; 5] = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PROFILE))",
];

/// Whether a regular file is at the path, and `false` when the process cannot inspect it, as in a
/// folder it may not search.
fn is_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
}

/// The shell's program: the first file named `pwsh` in an absolute entry of `PATH` that the process
/// may execute, as a shell runs one, so a program in the working directory or under a relative
/// entry never runs. A path the process cannot inspect is no program, so the lookup goes on to the
/// next entry. None when no entry holds one.
fn program_of(host: &Host) -> Option<PathBuf> {
    host.env
        .get("PATH")
        .map(String::as_str)
        .unwrap_or_default()
        .split(':')
        .filter(|entry| entry.starts_with('/'))
        .map(|entry| PathBuf::from(join(&[entry, SHELL])))
        .find(|path| is_file(path) && may_execute(path))
}

/// The value of one Base64 digit.
fn digit(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// An answer's shape: Base64 digits alone, then at most two `=`.
fn has_answer_shape(answer: &str) -> bool {
    let digits = answer.trim_end_matches('=');
    let padding = answer.len() - digits.len();
    !digits.is_empty() && padding <= 2 && digits.bytes().all(|byte| digit(byte).is_some())
}

/// The bytes of some Base64 text whose length is a whole number of blocks of four, or none.
/// Padding may stand only at the end, as Node's decoder reads it; a block that ends in padding
/// leaves the bits past it as they are.
fn decoded_bytes(encoded: &str) -> Option<Vec<u8>> {
    if encoded.len() % 4 != 0 {
        return None;
    }
    let digits = encoded.trim_end_matches('=');
    let mut bytes = Vec::with_capacity(encoded.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut held: u32 = 0;
    for byte in digits.bytes() {
        buffer = (buffer << 6) | u32::from(digit(byte)?);
        held += 6;
        if held >= 8 {
            held -= 8;
            bytes.push(u8::try_from((buffer >> held) & 0xff).ok()?);
        }
    }
    Some(bytes)
}

/// The absolute profile path an answer reports, or none for an answer of any other shape.
fn profile_of(answer: &str) -> Option<String> {
    if !has_answer_shape(answer) {
        return None;
    }
    let path = String::from_utf8(decoded_bytes(answer)?).ok()?;
    path.starts_with('/').then_some(path)
}

/// What a profile query reads: the application, the run, and the home folder it runs from.
pub(super) struct ProfileRequest<'a> {
    pub name: &'a str,
    pub host: &'a Host,
    pub home: &'a Path,
    pub signal: &'a RunSignal,
}

/// Runs the program through `host.spawn` with the pinned words, `host.env` as its environment, the
/// home folder as its working directory, no shell, and no input, its standard error piped into the
/// host's, and answers its standard output with the trailing line break removed. A program that
/// cannot start, and one that exits with any code but 0, are the pinned failure; the run signal
/// ends it with SIGTERM and then aborts the run.
async fn answer_of(request: &ProfileRequest<'_>, program: &Path) -> Result<String, Error> {
    let ProfileRequest {
        host,
        home,
        name,
        signal,
    } = request;
    let options = SpawnOptions::new()
        .cwd(*home)
        .signal(signal.token())
        .stderr(ChildStream::Stream(host.stderr()));
    let exit = host
        .spawn(&program.to_string_lossy(), WORDS, options)
        .exited()
        .await;
    signal.throw_if_cancelled()?;
    match exit {
        ChildExit::Exited {
            code: 0, stdout, ..
        } => {
            let text = stdout.text;
            // Only a line feed, or a carriage return followed by one, ends the answer.
            Ok(match text.strip_suffix('\n') {
                Some(rest) => rest.strip_suffix('\r').unwrap_or(rest).to_owned(),
                None => text,
            })
        }
        ChildExit::Exited { code, .. } => Err(FatalError::new(messages::profile_not_found(
            name,
            SHELL,
            &ProfileFault::Exited(code),
        ))
        .into()),
        _ => Err(FatalError::new(messages::profile_not_found(
            name,
            SHELL,
            &ProfileFault::NotStarted,
        ))
        .into()),
    }
}

/// Asks PowerShell 7 for its profile. A shell not found on `PATH`, one that cannot start or exits
/// with any code but 0, and an answer of any other shape each are the pinned failure.
pub(super) async fn ask_profile(request: &ProfileRequest<'_>) -> Result<PathBuf, Error> {
    let Some(program) = program_of(request.host) else {
        return Err(FatalError::new(messages::profile_not_found(
            request.name,
            SHELL,
            &ProfileFault::NotStarted,
        ))
        .into());
    };
    let answer = answer_of(request, &program).await?;
    match profile_of(&answer) {
        Some(profile) => Ok(PathBuf::from(normalize(&profile))),
        None => Err(FatalError::new(messages::profile_not_found(
            request.name,
            SHELL,
            &ProfileFault::Reported(answer),
        ))
        .into()),
    }
}
