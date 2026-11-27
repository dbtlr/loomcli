//! The `self-update` run, in the contract's order: the refusals before any request, resolving the
//! release, the reports that replace nothing, `--check`, then downloading, verifying, placing, and
//! recording the release, and the author's `after_replace`.

use std::cmp::Ordering;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use loomcli_core::{
    ApplicationDirectory, DirectoryFacts, DirectoryLookup, Error, FatalError, Host, Installation,
    Log, Out, RunSignal, application_directory,
};

use super::messages;
use super::request::{Client, Stop};
use super::resolve::{Release, download_url, fetch_sums, latest_release};
use super::sums::{Listing, listing_of};
use super::version::{Version, compare_versions, parse_version};
use super::{AfterReplace, AfterReplaceContext};
use crate::change_events::{binary_replaced, file_written};
use crate::installation::{
    InstallationError, Observed, ReplaceOptions, digest_of, observe, remove_staging_files,
    replace_file,
};

/// The installation record's file in its directory.
const RECORD_FILE: &str = "install.json";

/// The mode of the installation record, as the installer script's `mktemp` leaves it.
const RECORD_MODE: u32 = 0o600;

/// The installer method of a binary the installer script placed.
const SCRIPT: &str = "script";

/// The running binary as its release facts describe it: the asset it was built as, where its
/// releases are, its channel, and its version.
#[derive(Clone, Debug)]
pub(crate) struct ReleaseBinary {
    pub(crate) asset: String,
    pub(crate) repository: String,
    pub(crate) channel: String,
    pub(crate) running: Version,
}

/// The running binary, when its release group names an asset and a version that parses, or `None`
/// for any other run.
pub(crate) fn release_binary(host: &Host) -> Option<ReleaseBinary> {
    let release = host.release.release.as_ref()?;
    let asset = release.asset.clone()?;
    let running = parse_version(&release.version)?;
    Some(ReleaseBinary {
        asset,
        repository: release.repository.clone(),
        channel: release.channel.clone(),
        running,
    })
}

/// The installation, when the installer script placed the binary.
pub(crate) fn script_installation(host: &Host) -> Option<&Installation> {
    host.release
        .installation
        .as_ref()
        .filter(|installation| installation.method == SCRIPT)
}

/// What a run checked before any request: the binary to replace and where its record lives.
struct Checked {
    binary: ReleaseBinary,
    path: String,
    mode: u32,
    record: PathBuf,
}

/// The directory that holds `path`, as POSIX `path.join(path, '..')` names it: the joined path,
/// normalized lexically, so `.` segments drop out and a `..` removes the segment before it.
pub(crate) fn directory_of(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/').chain(std::iter::once("..")) {
        match segment {
            "" | "." => {}
            ".." if segments.last().is_some_and(|last| *last != "..") => {
                segments.pop();
            }
            ".." if absolute => {}
            other => segments.push(other),
        }
    }
    let joined = segments.join("/");
    match (absolute, joined.is_empty()) {
        (true, _) => format!("/{joined}"),
        (false, true) => ".".to_owned(),
        (false, false) => joined,
    }
}

/// The first directory the process cannot write to, with the runtime's error, or none.
fn unwritable(directories: &[&Path]) -> Option<(String, io::Error)> {
    directories.iter().find_map(|directory| {
        rustix::fs::access(*directory, rustix::fs::Access::WRITE_OK)
            .err()
            .map(|error| {
                (
                    directory.to_string_lossy().into_owned(),
                    io::Error::from(error),
                )
            })
    })
}

/// The refusals, in the contract's order, before any request: a run that is not a release binary,
/// a record directory that cannot be resolved, an installation another installer owns, a recorded
/// path that holds no regular file, a binary changed since it was recorded, and a directory the
/// process cannot write to.
fn check(name: &str, host: &Host) -> Result<Checked, Error> {
    let binary = release_binary(host).ok_or_else(|| FatalError::new(messages::not_built(name)))?;
    let record = match application_directory(
        ApplicationDirectory::Installation,
        name,
        &DirectoryFacts::from(host),
    ) {
        DirectoryLookup::Path(path) => path,
        DirectoryLookup::Variable(variable) => {
            return Err(FatalError::new(messages::record_unresolved(name, &variable)).into());
        }
        // A lookup core adds later names no directory the record can be found in.
        _ => return Err(FatalError::new(messages::record_unresolved(name, "HOME")).into()),
    };
    let installation = script_installation(host)
        .ok_or_else(|| FatalError::new(messages::other_installer(name)))?;
    let path = installation.path.clone();
    let mode = match observe(Path::new(&path))? {
        Observed::Link => return Err(FatalError::new(messages::link(name, &path)).into()),
        Observed::File { digest, mode } => {
            if digest != installation.digest {
                return Err(FatalError::new(messages::changed(name, &path)).into());
            }
            mode
        }
        _ => return Err(FatalError::new(messages::missing(name, &path)).into()),
    };
    let directory = directory_of(&path);
    if let Some((blocked, cause)) = unwritable(&[Path::new(&directory), &record]) {
        return Err(FatalError::with_cause(messages::unwritable(name, &blocked), cause).into());
    }
    Ok(Checked {
        binary,
        path,
        mode,
        record,
    })
}

/// What one `self-update` run reads: its inputs, the run's facts, and the author's hook.
pub(crate) struct Request {
    pub(crate) name: String,
    pub(crate) host: Arc<Host>,
    pub(crate) signal: RunSignal,
    pub(crate) log: Log,
    pub(crate) out: Out,
    pub(crate) client: Client,
    pub(crate) named: Option<Version>,
    pub(crate) channel: Option<String>,
    pub(crate) check_only: bool,
}

impl Request {
    /// The channel a run follows: the one the operator named, or the running binary's own.
    fn channel_for<'a>(&'a self, checked: &'a Checked) -> &'a str {
        self.channel
            .as_deref()
            .unwrap_or(checked.binary.channel.as_str())
    }

    /// Whether the operator named the version that is running.
    fn names_running(&self, checked: &Checked) -> bool {
        self.named.as_ref().is_some_and(|named| {
            compare_versions(named, &checked.binary.running) == Ordering::Equal
        })
    }

    /// The line a run that named the running version prints, which replaces nothing.
    fn installed_line(&self, checked: &Checked) -> String {
        messages::installed_line(&self.name, &checked.binary.running.text)
    }
}

/// The line a resolved release that is not newer prints, which replaces nothing.
fn not_newer_line(name: &str, running: &Version, found: &Version, channel: &str) -> String {
    if compare_versions(found, running) == Ordering::Equal {
        messages::newest_line(name, &running.text, channel)
    } else {
        messages::newer_than_newest_line(name, &running.text, &found.text, channel)
    }
}

/// Whether `found` has the precedence of `running` or lower.
fn is_not_newer(found: &Version, running: &Version) -> bool {
    compare_versions(found, running) != Ordering::Greater
}

/// The release a run resolved, its `SHA256SUMS`, and the digest it lists for the asset.
struct Resolved {
    release: Release,
    digest: String,
}

/// The release a run installs: the named version, or the newest on the channel.
async fn target(request: &Request, checked: &Checked) -> Result<Release, Stop> {
    if let Some(named) = &request.named {
        let (repository, sums) =
            fetch_sums(&request.client, &checked.binary.repository, named).await?;
        return Ok(Release {
            repository,
            version: named.clone(),
            sums: Some(sums),
        });
    }
    let channel = request.channel_for(checked);
    latest_release(&request.client, &checked.binary.repository, channel)
        .await?
        .ok_or_else(|| {
            Stop::from(FatalError::new(messages::no_release(
                &request.name,
                channel,
                &checked.binary.repository,
            )))
        })
}

/// The release's `SHA256SUMS`, downloaded now unless finding the release already did.
async fn with_sums(client: &Client, release: Release) -> Result<(Release, String), Stop> {
    if let Some(sums) = release.sums.clone() {
        return Ok((release, sums));
    }
    let (repository, sums) = fetch_sums(client, &release.repository, &release.version).await?;
    Ok((
        Release {
            repository,
            sums: Some(sums.clone()),
            ..release
        },
        sums,
    ))
}

/// The asset's digest from the release's `SHA256SUMS`, or the failure its listing is.
fn listed_digest(asset: &str, release: &Release, sums: &str) -> Result<String, Error> {
    let tag = format!("v{}", release.version.text);
    match listing_of(sums, asset) {
        Listing::Digest(digest) => Ok(digest),
        Listing::Missing => {
            Err(FatalError::new(messages::not_listed(asset, &tag, &release.repository)).into())
        }
        Listing::Conflict => {
            Err(FatalError::new(messages::conflict(asset, &tag, &release.repository)).into())
        }
    }
}

/// The refusals and reports that end a run before any download, or the release it goes on with.
async fn resolve(request: &Request, checked: &Checked) -> Result<Option<Resolved>, Stop> {
    if !request.check_only && request.names_running(checked) {
        request
            .out
            .success(&request.installed_line(checked))
            .await?;
        return Ok(None);
    }
    let found = target(request, checked).await?;
    if request.named.is_none()
        && !request.check_only
        && is_not_newer(&found.version, &checked.binary.running)
    {
        let line = not_newer_line(
            &request.name,
            &checked.binary.running,
            &found.version,
            request.channel_for(checked),
        );
        request.out.success(&line).await?;
        return Ok(None);
    }
    if request.named.is_none() && !request.check_only {
        let (template, fields) =
            messages::resolved(&found.version.text, request.channel_for(checked));
        request.log.debug(template, fields);
    }
    let (release, sums) = with_sums(&request.client, found).await?;
    let digest = listed_digest(&checked.binary.asset, &release, &sums)?;
    Ok(Some(Resolved { release, digest }))
}

/// The line a `--check` run prints for the release it resolved.
fn check_line(request: &Request, checked: &Checked, found: &Version) -> String {
    let running = &checked.binary.running;
    if request.names_running(checked) {
        return request.installed_line(checked);
    }
    if let Some(named) = &request.named {
        return messages::can_install_line(&request.name, &named.text, &running.text);
    }
    let channel = request.channel_for(checked);
    if is_not_newer(found, running) {
        return not_newer_line(&request.name, running, found, channel);
    }
    messages::can_update_line(&request.name, &running.text, &found.text, channel)
}

/// Downloads the asset and returns its bytes once their digest matches the listed one.
async fn download(
    request: &Request,
    checked: &Checked,
    resolved: &Resolved,
) -> Result<Vec<u8>, Stop> {
    let release = &resolved.release;
    let url = download_url(&release.repository, &release.version, &checked.binary.asset)?;
    let bytes = request.client.fetch_bytes(&url).await?;
    if digest_of(&bytes) != format!("sha256:{}", resolved.digest) {
        return Err(FatalError::new(messages::mismatch(
            &checked.binary.asset,
            &format!("v{}", release.version.text),
            &release.repository,
        ))
        .into());
    }
    let (template, fields) = messages::verified(&checked.binary.asset);
    request.log.debug(template, fields);
    Ok(bytes)
}

/// The `install.json` line for the binary now at `path`, in the installation record's format.
fn record_line(path: &str, digest: &str) -> String {
    let path = serde_json::Value::String(path.to_owned()).to_string();
    format!("{{\"format\":1,\"method\":\"script\",\"path\":{path},\"digest\":\"{digest}\"}}\n")
}

/// Places the verified bytes over the binary, removing leftover staging files first. A cancellation
/// read before the rename propagates as it is.
fn place_binary(request: &Request, checked: &Checked, bytes: &[u8]) -> Result<(), Error> {
    let path = Path::new(&checked.path);
    let attempt = remove_staging_files(path, Some(&request.log))
        .map_err(InstallationError::from)
        .and_then(|()| {
            replace_file(
                path,
                bytes,
                ReplaceOptions::new()
                    .durable()
                    .mode(checked.mode)
                    .signal(&request.signal),
            )
        });
    match attempt {
        Ok(()) => Ok(()),
        Err(InstallationError::Cancelled(echo)) => Err(echo),
        Err(_) if request.signal.is_cancelled() => Err(request
            .signal
            .throw_if_cancelled()
            .err()
            .unwrap_or_else(|| Error::from(io::Error::other(super::messages::RUN_CANCELLED)))),
        Err(error) => Err(FatalError::with_cause(
            messages::binary_write(&request.name, &directory_of(&checked.path)),
            Error::from(error),
        )
        .into()),
    }
}

/// Rewrites the installation record for the binary now at the recorded path. It reads no signal.
fn write_record(
    request: &Request,
    checked: &Checked,
    version: &Version,
    bytes: &[u8],
) -> Result<(), Error> {
    let record = checked.record.join(RECORD_FILE);
    let line = record_line(&checked.path, &digest_of(bytes));
    remove_staging_files(&record, Some(&request.log))
        .map_err(InstallationError::from)
        .and_then(|()| {
            replace_file(
                &record,
                line.as_bytes(),
                ReplaceOptions::new().durable().mode(RECORD_MODE),
            )
        })
        .map_err(|error| {
            FatalError::with_cause(messages::record_write(&request.name, &version.text), error)
        })?;
    file_written(&request.log, &record);
    Ok(())
}

/// Downloads the resolved release, places it, rewrites the record, and reports the update. From
/// the rename to the record no signal is read: both are synchronous calls with nothing awaited
/// between them.
async fn install(request: &Request, checked: &Checked, resolved: &Resolved) -> Result<(), Stop> {
    let release = &resolved.release;
    request
        .out
        .info(&messages::downloading_line(
            &checked.binary.asset,
            &release.version.text,
            &release.repository,
        ))
        .await?;
    let bytes = download(request, checked, resolved).await?;
    place_binary(request, checked, &bytes)?;
    binary_replaced(
        &request.log,
        Path::new(&checked.path),
        &checked.binary.running.text,
        &release.version.text,
    );
    write_record(request, checked, &release.version, &bytes)?;
    request
        .out
        .success(&messages::updated_line(
            &request.name,
            &checked.binary.running.text,
            &release.version.text,
        ))
        .await?;
    Ok(())
}

/// The Command's run, in the contract's order: refusals, resolving, `--check`, replacing, then the
/// author's hook.
pub(crate) async fn update(
    request: &Request,
    after_replace: Option<&AfterReplace>,
) -> Result<(), Stop> {
    let checked = check(&request.name, &request.host)?;
    let Some(resolved) = resolve(request, &checked).await? else {
        return Ok(());
    };
    if request.check_only {
        let line = check_line(request, &checked, &resolved.release.version);
        request.out.success(&line).await?;
        return Ok(());
    }
    install(request, &checked, &resolved).await?;
    if let Some(hook) = after_replace {
        hook(AfterReplaceContext {
            name: request.name.clone(),
            previous: checked.binary.running.text.clone(),
            current: resolved.release.version.text.clone(),
            path: checked.path.clone(),
            host: Arc::clone(&request.host),
            signal: request.signal.clone(),
            log: request.log.clone(),
        })
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::directory_of;

    #[test]
    fn the_directory_of_a_path_is_its_lexical_parent() {
        for (path, directory) in [
            ("/home/me/.local/bin/notes", "/home/me/.local/bin"),
            ("/home/me/./bin//notes", "/home/me/bin"),
            ("/opt/a/../notes", "/opt"),
            ("/notes", "/"),
            ("notes", "."),
            ("bin/notes", "bin"),
            ("../notes", ".."),
        ] {
            assert_eq!(directory_of(path), directory, "{path}");
        }
    }
}
