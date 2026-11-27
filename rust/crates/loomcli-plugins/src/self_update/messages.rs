//! The sentences of the self-update plugin.

use std::path::Path;

use loomcli_core::{LogFields, escape_control_characters, nowrap};
use url::Url;

use super::request::{NOT_FOUND, RequestError};

pub(super) fn requested(url: &Url) -> (&'static str, LogFields) {
    let address = format!("{}{}", url.origin().ascii_serialization(), url.path());
    ("Requested {url}.", LogFields::new().field("url", address))
}

pub(super) fn resolved(version: &str, channel: &str) -> (&'static str, LogFields) {
    (
        "Resolved v{version} on the {channel} channel.",
        LogFields::new()
            .field("channel", channel)
            .field("version", version),
    )
}

pub(super) fn verified(asset: &str) -> (&'static str, LogFields) {
    (
        "Verified {asset} against SHA256SUMS.",
        LogFields::new().field("asset", asset),
    )
}

pub(super) enum UpdateCheckSkip<'a> {
    OptedOut(&'a str),
    Stdout,
    Stderr,
    Ci,
    SelfUpdate,
    NotRelease(&'a str),
    NotScript(&'a str),
    NotAbsolute(String),
}

pub(super) fn skipped(reason: UpdateCheckSkip<'_>) -> (&'static str, LogFields) {
    let fields = LogFields::new();
    match reason {
        UpdateCheckSkip::OptedOut(variable) => (
            "Skipped the update check: {variable} is set.",
            fields.field("variable", variable),
        ),
        UpdateCheckSkip::Stdout => (
            "Skipped the update check: stdout is not a terminal.",
            fields,
        ),
        UpdateCheckSkip::Stderr => (
            "Skipped the update check: stderr is not a terminal.",
            fields,
        ),
        UpdateCheckSkip::Ci => ("Skipped the update check: CI is set.", fields),
        UpdateCheckSkip::SelfUpdate => {
            ("Skipped the update check: self-update is running.", fields)
        }
        UpdateCheckSkip::NotRelease(name) => (
            "Skipped the update check: {name} is not a release build.",
            fields.field("name", name),
        ),
        UpdateCheckSkip::NotScript(name) => (
            "Skipped the update check: {name} was not installed by install.sh.",
            fields.field("name", name),
        ),
        UpdateCheckSkip::NotAbsolute(variable) => (
            "Skipped the update check: {variable} is not an absolute path.",
            fields.field("variable", variable),
        ),
    }
}

pub(super) fn read_update_check(path: &Path) -> (&'static str, LogFields) {
    (
        "Read the update check from {path}.",
        LogFields::new().field("path", path.to_string_lossy()),
    )
}

pub(super) fn ignored_update_cache(path: &Path) -> (&'static str, LogFields) {
    (
        "Ignored {path}: it is not an update cache this version reads.",
        LogFields::new().field("path", path.to_string_lossy()),
    )
}

pub(super) const STARTED_REFRESH: &str = "Started a refresh of the update check.";

/// A value a sentence repeats, escaped as a failure message quotes text.
fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// A path or URL, escaped and kept whole when a message wraps.
fn shown_place(place: &str) -> String {
    nowrap(&shown(place))
}

/// The sentence of a binary that was not built as a release binary.
pub(super) fn not_built(name: &str) -> String {
    format!(
        "{} was not built as a release binary, so it cannot update itself. Update it the way you installed it.",
        shown(name)
    )
}

/// The installation record's directory cannot be resolved because of `variable`.
pub(super) fn record_unresolved(name: &str, variable: &str) -> String {
    let variable = shown(variable);
    format!(
        "{} cannot find its installation record because {variable} is not an absolute path. Set {variable} to an absolute path, then run self-update again.",
        shown(name)
    )
}

/// The cache directory cannot be resolved because of `variable`.
pub(super) fn cache_unresolved(name: &str, variable: &str) -> String {
    let variable = shown(variable);
    format!(
        "{} cannot find its cache directory because {variable} is not an absolute path. Set {variable} to an absolute path.",
        shown(name)
    )
}

/// No installation, or one another installer owns.
pub(super) fn other_installer(name: &str) -> String {
    format!(
        "{} was installed some other way, so self-update cannot replace it. Update it the way you installed it.",
        shown(name)
    )
}

/// Nothing at the recorded path, or something other than a regular file or a symbolic link.
pub(super) fn missing(name: &str, path: &str) -> String {
    format!(
        "{} cannot find its binary at {}. Install it again with install.sh.",
        shown(name),
        shown_place(path)
    )
}

/// A symbolic link at the recorded path.
pub(super) fn link(name: &str, path: &str) -> String {
    format!(
        "{} at {} is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.",
        shown(name),
        shown_place(path)
    )
}

/// A binary whose digest changed since it was recorded.
pub(super) fn changed(name: &str, path: &str) -> String {
    format!(
        "{} at {} changed since it was installed, so self-update will not replace it. Install it again with install.sh.",
        shown(name),
        shown_place(path)
    )
}

/// A directory the process cannot write to.
pub(super) fn unwritable(name: &str, directory: &str) -> String {
    format!(
        "{name} cannot write to {}. Run self-update as the user who installed {name}.",
        shown_place(directory),
        name = shown(name)
    )
}

/// The sentence for a request that failed, with the correction a named version's `404` reads.
pub(super) fn request_failed(name: &str, failure: &RequestError, named: Option<&str>) -> String {
    let name = shown(name);
    let url = shown_place(failure.url());
    match failure {
        RequestError::Insecure { .. } => format!(
            "{name} was redirected away from HTTPS while downloading {url}. Run self-update again later."
        ),
        RequestError::TooMany { .. } => format!(
            "{name} was redirected too many times while downloading {url}. Run self-update again later."
        ),
        RequestError::Status { status, .. } => {
            let correction = match (named, status) {
                (Some(named), Some(NOT_FOUND)) => format!(
                    "Check that release v{} exists, then run self-update again.",
                    shown(named)
                ),
                _ => "Run self-update again later.".to_owned(),
            };
            let status = status.map_or_else(|| "no response".to_owned(), |code| code.to_string());
            format!("{name} could not download {url} ({status}). {correction}")
        }
        RequestError::NoResponse { .. } => {
            format!("{name} could not download {url} (no response). Run self-update again later.")
        }
    }
}

/// The cache could not be written.
pub(super) fn cache_write(name: &str, directory: &str) -> String {
    format!(
        "{} could not write its update cache to {}. Free space there or check its permissions, then run self-update --refresh-notice again.",
        shown(name),
        shown_place(directory)
    )
}

/// `SHA256SUMS` lists the asset twice with different digests.
pub(super) fn conflict(asset: &str, tag: &str, repository: &str) -> String {
    format!(
        "Release {} of {} lists {} twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.",
        shown(tag),
        shown(repository),
        shown(asset)
    )
}

/// A download whose digest differs from the listed one.
pub(super) fn mismatch(asset: &str, tag: &str, repository: &str) -> String {
    format!(
        "{} from {} of {} does not match its SHA256SUMS digest. Run self-update again later.",
        shown(asset),
        shown(tag),
        shown(repository)
    )
}

/// A channel with no release.
pub(super) fn no_release(name: &str, channel: &str, repository: &str) -> String {
    format!(
        "{name} found no release on the {} channel of {}. Name a version to install, such as {name} self-update 1.4.0.",
        shown(channel),
        shown(repository),
        name = shown(name)
    )
}

/// `SHA256SUMS` lists no line for the asset.
pub(super) fn not_listed(asset: &str, tag: &str, repository: &str) -> String {
    format!(
        "Release {} of {} has no {} in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.",
        shown(tag),
        shown(repository),
        shown(asset)
    )
}

/// The record could not be written after the binary was replaced.
pub(super) fn record_write(name: &str, version: &str) -> String {
    format!(
        "{} was updated to {}, but its installation record could not be written. Install it again with install.sh.",
        shown(name),
        shown(version)
    )
}

/// The staging write or the rename failed.
pub(super) fn binary_write(name: &str, directory: &str) -> String {
    format!(
        "{} could not write the new binary to {}. Free space there or check its permissions, then run self-update again.",
        shown(name),
        shown_place(directory)
    )
}

/// The line a run that named the running version prints, which replaces nothing.
pub(super) fn installed_line(name: &str, running: &str) -> String {
    format!("{} {} is already installed.", shown(name), shown(running))
}

/// The line of a run whose version is the newest release on the channel.
pub(super) fn newest_line(name: &str, running: &str, channel: &str) -> String {
    format!(
        "{} {} is the newest release on the {} channel.",
        shown(name),
        shown(running),
        shown(channel)
    )
}

/// The line of a run whose version is newer than the newest release on the channel.
pub(super) fn newer_than_newest_line(
    name: &str,
    running: &str,
    found: &str,
    channel: &str,
) -> String {
    format!(
        "{name} {} is newer than the newest release on the {} channel, {}. Name that version to install it: {name} self-update {}.",
        shown(running),
        shown(channel),
        shown(found),
        shown(found),
        name = shown(name)
    )
}

/// The `--check` line for a named version, which would replace the running one.
pub(super) fn can_install_line(name: &str, named: &str, running: &str) -> String {
    format!(
        "{} can install {} in place of {}.",
        shown(name),
        shown(named),
        shown(running)
    )
}

/// The `--check` line for a newer release on the channel.
pub(super) fn can_update_line(name: &str, running: &str, found: &str, channel: &str) -> String {
    format!(
        "{} can update from {} to {} on the {} channel.",
        shown(name),
        shown(running),
        shown(found),
        shown(channel)
    )
}

/// The line before the download starts.
pub(super) fn downloading_line(asset: &str, version: &str, repository: &str) -> String {
    format!(
        "Downloading {} from v{} of {}.",
        shown(asset),
        shown(version),
        shown(repository)
    )
}

/// The line after the binary was replaced.
pub(super) fn updated_line(name: &str, from: &str, to: &str) -> String {
    format!(
        "Updated {} from {} to {}.",
        shown(name),
        shown(from),
        shown(to)
    )
}

/// The notice that a newer release is available.
pub(super) fn notice_line(name: &str, newer: &str, channel: &str, running: &str) -> String {
    format!(
        "{} {} is available on the {} channel. Run {} self-update to update from {}.",
        shown(name),
        shown(newer),
        shown(channel),
        shown(name),
        shown(running)
    )
}

/// The cancellation's text when the run's signal cannot say it.
pub(super) const RUN_CANCELLED: &str = "The run was cancelled.";

pub(super) const VERSION_ISSUE: &str = "Supply a semantic version, such as 1.4.0.";

pub(super) const CHANNEL_ISSUE: &str = "Supply stable or a prerelease identifier, such as next.";

pub(super) const REFRESH_NOTICE_CONFLICT: &str =
    "Option \"--refresh-notice\" cannot be given with other inputs. Leave out the other inputs.";

pub(super) const REFRESH_NOTICE_CONFLICT_ISSUE: &str = "Leave out the other inputs.";

pub(super) const CHANNEL_CONFLICT: &str =
    "Option \"--channel\" cannot be given with a version. Leave out --channel, or the version.";

pub(super) const CHANNEL_CONFLICT_ISSUE: &str = "Leave out --channel, or the version.";
