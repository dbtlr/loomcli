//! `self-update --refresh-notice`: the lookup the update notices' middleware starts in a detached
//! child, which resolves the newest release on the running binary's channel and writes the cache.

use loomcli_core::{
    ApplicationDirectory, DirectoryFacts, DirectoryLookup, FatalError, Host, application_directory,
};

use super::cache::{CacheEntry, Lookup, now, write_cache};
use super::messages;
use super::request::{Client, Stop};
use super::resolve::latest_release;
use super::update::release_binary;

/// Resolves the newest release on `host.release.channel`, fetching only what resolving the channel
/// needs, and writes the cache with the time it finished. It reads no installation and hashes
/// nothing. A channel with no release writes `null`; a request that fails stops before writing; a
/// write that fails is the cache failure, the runtime's error kept as its cause.
pub(crate) async fn refresh_notice(name: &str, host: &Host, client: &Client) -> Result<(), Stop> {
    let binary = release_binary(host).ok_or_else(|| FatalError::new(messages::not_built(name)))?;
    let directory = match application_directory(
        ApplicationDirectory::Cache,
        name,
        &DirectoryFacts::from(host),
    ) {
        DirectoryLookup::Path(path) => path,
        DirectoryLookup::Variable(variable) => {
            return Err(FatalError::new(messages::cache_unresolved(name, &variable)).into());
        }
        // A lookup core adds later names no directory the cache can be written in.
        _ => return Err(FatalError::new(messages::cache_unresolved(name, "HOME")).into()),
    };
    let found = latest_release(client, &binary.repository, &binary.channel).await?;
    let entry = CacheEntry {
        lookup: Lookup {
            repository: &binary.repository,
            channel: &binary.channel,
        },
        checked: now(),
        latest: found.map(|release| release.version.text),
    };
    write_cache(&directory, &entry).map_err(|error| {
        Stop::from(FatalError::with_cause(
            messages::cache_write(name, &directory.to_string_lossy()),
            error,
        ))
    })
}
