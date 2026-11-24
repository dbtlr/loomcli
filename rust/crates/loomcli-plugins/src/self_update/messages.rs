//! Every sentence the self-update Command and the update notices write, as the reference pins them.
//! Each path, URL, and version a sentence repeats passes through the control-character escape, and
//! a path or URL is kept whole when the message wraps.

use std::io;

use loomcli_core::{Error, FatalError, escape_control_characters, nowrap};

use super::request::{NOT_FOUND, RequestError};

/// A value a sentence repeats, escaped as a failure message quotes text.
pub(crate) fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// A path or URL, escaped and kept whole when a message wraps.
fn shown_place(place: &str) -> String {
    nowrap(&shown(place))
}

/// A failure with no cause.
fn fatal(sentence: String) -> FatalError {
    FatalError::new(sentence)
}

/// A failure that keeps the runtime's error as its cause, never printed.
fn fatal_with(sentence: String, cause: impl Into<Error>) -> FatalError {
    FatalError::with_cause(sentence, cause)
}

/// `<name> was not built as a release binary, ...`
pub(crate) fn not_built(name: &str) -> FatalError {
    fatal(format!(
        "{name} was not built as a release binary, so it cannot update itself. Update it the way you installed it."
    ))
}

/// The installation record's directory cannot be resolved because of `variable`.
pub(crate) fn record_unresolved(name: &str, variable: &str) -> FatalError {
    fatal(format!(
        "{name} cannot find its installation record because {variable} is not an absolute path. Set {variable} to an absolute path, then run self-update again."
    ))
}

/// The cache directory cannot be resolved because of `variable`.
pub(crate) fn cache_unresolved(name: &str, variable: &str) -> FatalError {
    fatal(format!(
        "{name} cannot find its cache directory because {variable} is not an absolute path. Set {variable} to an absolute path."
    ))
}

/// No installation, or one another installer owns.
pub(crate) fn other_installer(name: &str) -> FatalError {
    fatal(format!(
        "{name} was installed some other way, so self-update cannot replace it. Update it the way you installed it."
    ))
}

/// Nothing at the recorded path, or something other than a regular file or a symbolic link.
pub(crate) fn missing(name: &str, path: &str) -> FatalError {
    fatal(format!(
        "{name} cannot find its binary at {}. Install it again with install.sh.",
        shown_place(path)
    ))
}

/// A symbolic link at the recorded path.
pub(crate) fn link(name: &str, path: &str) -> FatalError {
    fatal(format!(
        "{name} at {} is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.",
        shown_place(path)
    ))
}

/// A binary whose digest changed since it was recorded.
pub(crate) fn changed(name: &str, path: &str) -> FatalError {
    fatal(format!(
        "{name} at {} changed since it was installed, so self-update will not replace it. Install it again with install.sh.",
        shown_place(path)
    ))
}

/// A directory the process cannot write to.
pub(crate) fn unwritable(name: &str, directory: &str, cause: io::Error) -> FatalError {
    fatal_with(
        format!(
            "{name} cannot write to {}. Run self-update as the user who installed {name}.",
            shown_place(directory)
        ),
        cause,
    )
}

/// The sentence for a request that failed, with the correction a named version's `404` reads.
pub(crate) fn request_failed(name: &str, failure: RequestError, named: Option<&str>) -> FatalError {
    let url = shown_place(failure.url());
    match failure {
        RequestError::Insecure { .. } => fatal(format!(
            "{name} was redirected away from HTTPS while downloading {url}. Run self-update again later."
        )),
        RequestError::TooMany { .. } => fatal(format!(
            "{name} was redirected too many times while downloading {url}. Run self-update again later."
        )),
        RequestError::Status { status, .. } => {
            let correction = match (named, status) {
                (Some(named), Some(NOT_FOUND)) => format!(
                    "Check that release v{} exists, then run self-update again.",
                    shown(named)
                ),
                _ => "Run self-update again later.".to_owned(),
            };
            let status = status.map_or_else(|| "no response".to_owned(), |code| code.to_string());
            fatal(format!(
                "{name} could not download {url} ({status}). {correction}"
            ))
        }
        RequestError::NoResponse { cause, .. } => fatal_with(
            format!("{name} could not download {url} (no response). Run self-update again later."),
            cause,
        ),
    }
}

/// The cache could not be written.
pub(crate) fn cache_write(name: &str, directory: &str, cause: impl Into<Error>) -> FatalError {
    fatal_with(
        format!(
            "{name} could not write its update cache to {}. Free space there or check its permissions, then run self-update --refresh-notice again.",
            shown_place(directory)
        ),
        cause,
    )
}

/// `SHA256SUMS` lists the asset twice with different digests.
pub(crate) fn conflict(asset: &str, tag: &str, repository: &str) -> FatalError {
    fatal(format!(
        "Release {} of {} lists {} twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.",
        shown(tag),
        shown(repository),
        shown(asset)
    ))
}

/// A download whose digest differs from the listed one.
pub(crate) fn mismatch(asset: &str, tag: &str, repository: &str) -> FatalError {
    fatal(format!(
        "{} from {} of {} does not match its SHA256SUMS digest. Run self-update again later.",
        shown(asset),
        shown(tag),
        shown(repository)
    ))
}

/// A channel with no release.
pub(crate) fn no_release(name: &str, channel: &str, repository: &str) -> FatalError {
    fatal(format!(
        "{name} found no release on the {} channel of {}. Name a version to install, such as {name} self-update 1.4.0.",
        shown(channel),
        shown(repository)
    ))
}

/// `SHA256SUMS` lists no line for the asset.
pub(crate) fn not_listed(asset: &str, tag: &str, repository: &str) -> FatalError {
    fatal(format!(
        "Release {} of {} has no {} in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.",
        shown(tag),
        shown(repository),
        shown(asset)
    ))
}

/// The record could not be written after the binary was replaced.
pub(crate) fn record_write(name: &str, version: &str, cause: impl Into<Error>) -> FatalError {
    fatal_with(
        format!(
            "{name} was updated to {}, but its installation record could not be written. Install it again with install.sh.",
            shown(version)
        ),
        cause,
    )
}

/// The staging write or the rename failed.
pub(crate) fn binary_write(name: &str, directory: &str, cause: impl Into<Error>) -> FatalError {
    fatal_with(
        format!(
            "{name} could not write the new binary to {}. Free space there or check its permissions, then run self-update again.",
            shown_place(directory)
        ),
        cause,
    )
}
