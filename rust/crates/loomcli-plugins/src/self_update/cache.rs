//! The update notices' cache: `update.json` in the application's cache directory, one line that
//! says when the newest release on a repository's channel was last looked up and what it was.

use std::path::{Path, PathBuf};
use std::{fs, io};

use jiff::Timestamp;
use serde_json::Value;

use super::version::parse_version;
use crate::installation::{InstallationError, ReplaceOptions, replace_file};

/// The cache file's name in the application's cache directory.
pub(crate) const CACHE_FILE: &str = "update.json";

/// The cache format this plugin reads and writes.
const KNOWN_FORMAT: i64 = 1;

/// How long a lookup stays fresh: 24 hours, in milliseconds.
const FRESH_FOR: i64 = 86_400_000;

/// The repository and channel a cache answers for, as the running binary's release facts hold them.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Lookup<'a> {
    pub(crate) repository: &'a str,
    pub(crate) channel: &'a str,
}

/// What the cache says for the running binary's repository and channel: whether it is fresh, and,
/// when it is a cache for them whose only possible fault is its `checked`, the `latest` it names,
/// `Some(None)` for a channel that had none.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CacheReading {
    pub(crate) fresh: bool,
    pub(crate) latest: Option<Option<String>>,
}

/// The reading of a cache that is missing, damaged, or for another repository or channel.
pub(super) const STALE: CacheReading = CacheReading {
    fresh: false,
    latest: None,
};

pub(super) enum CacheFound {
    Missing,
    Ignored,
    Read(CacheReading),
}

/// A time in milliseconds since the epoch, in the `toISOString()` form: UTC, with milliseconds.
pub(crate) fn iso_time(milliseconds: i64) -> Option<String> {
    let time = Timestamp::from_millisecond(milliseconds).ok()?;
    Some(time.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// The milliseconds since the epoch of a value that is a time in the `toISOString()` form, the form
/// the cache writes, or `None` for any other value.
fn time_of(value: &Value) -> Option<i64> {
    let text = value.as_str()?;
    let time: Timestamp = text.parse().ok()?;
    let milliseconds = time.as_millisecond();
    (iso_time(milliseconds)? == text).then_some(milliseconds)
}

/// Whether `checked` is a time less than 24 hours before `now` and not after it.
fn is_fresh(checked: &Value, now: i64) -> bool {
    time_of(checked).is_some_and(|time| time <= now && now - time < FRESH_FOR)
}

/// The `latest` a cache may hold, a version or `null` for a channel with none, or `None` for any
/// other value.
fn latest_of(latest: Option<&Value>) -> Option<Option<String>> {
    match latest? {
        Value::Null => Some(None),
        Value::String(text) if parse_version(text).is_some() => Some(Some(text.clone())),
        _ => None,
    }
}

/// Whether a JSON value is the number 1, as `format === 1` reads it.
fn is_known_format(format: Option<&Value>) -> bool {
    format
        .and_then(Value::as_f64)
        .is_some_and(|number| number == KNOWN_FORMAT as f64)
}

/// Judges a format-1 object for the running binary without interpreting any other members.
fn judge_members(
    members: &serde_json::Map<String, Value>,
    lookup: Lookup<'_>,
    now: i64,
) -> CacheReading {
    if members.get("repository").and_then(Value::as_str) != Some(lookup.repository)
        || members.get("channel").and_then(Value::as_str) != Some(lookup.channel)
    {
        return STALE;
    }
    match latest_of(members.get("latest")) {
        Some(latest) => CacheReading {
            fresh: members
                .get("checked")
                .is_some_and(|checked| is_fresh(checked, now)),
            latest: Some(latest),
        },
        None => STALE,
    }
}

fn cache_contents(content: &str, lookup: Lookup<'_>, now: i64) -> CacheFound {
    match serde_json::from_str::<Value>(content) {
        Ok(Value::Object(members)) if is_known_format(members.get("format")) => {
            CacheFound::Read(judge_members(&members, lookup, now))
        }
        _ => CacheFound::Ignored,
    }
}

/// Distinguishes a missing file from an ignored cache and a recognized format-1 cache.
pub(super) fn read_cache(path: &Path, lookup: Lookup<'_>, now: i64) -> CacheFound {
    fn read_failed(error: io::Error) -> CacheFound {
        match error.kind() {
            io::ErrorKind::NotFound => CacheFound::Missing,
            _ => CacheFound::Ignored,
        }
    }
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => fs::read_to_string(path)
            .map_or_else(read_failed, |content| cache_contents(&content, lookup, now)),
        Ok(_) => CacheFound::Ignored,
        Err(error) => read_failed(error),
    }
}

/// What one cache line records: when it looked, where, and the newest version, if any.
#[derive(Clone, Debug)]
pub(crate) struct CacheEntry<'a> {
    pub(crate) lookup: Lookup<'a>,
    /// Milliseconds since the epoch.
    pub(crate) checked: i64,
    pub(crate) latest: Option<String>,
}

/// A string as `JSON.stringify` writes it.
fn json_string(text: &str) -> String {
    Value::String(text.to_owned()).to_string()
}

/// The cache line, its members in the contract's order, with `null` for no version.
pub(crate) fn cache_line(entry: &CacheEntry<'_>) -> String {
    let version = entry
        .latest
        .as_deref()
        .map_or_else(|| "null".to_owned(), json_string);
    // A time outside the representable range is not one a clock answers.
    let checked = iso_time(entry.checked).unwrap_or_default();
    format!(
        "{{\"format\":{KNOWN_FORMAT},\"checked\":\"{checked}\",\"repository\":{},\"channel\":{},\"latest\":{version}}}\n",
        json_string(entry.lookup.repository),
        json_string(entry.lookup.channel),
    )
}

/// Replaces the cache in `directory` whole, creating the directory and its missing parents, through
/// a staging file in the directory and a rename.
pub(crate) fn write_cache(
    directory: &Path,
    entry: &CacheEntry<'_>,
) -> Result<PathBuf, InstallationError> {
    fs::create_dir_all(directory)?;
    let path = directory.join(CACHE_FILE);
    replace_file(&path, cache_line(entry).as_bytes(), ReplaceOptions::new())?;
    Ok(path)
}

/// The current time in milliseconds since the epoch, as `Date.now()` answers it.
pub(crate) fn now() -> i64 {
    Timestamp::now().as_millisecond()
}

#[cfg(test)]
mod tests {
    //! Ports the cache judgment case of `update-notices.test.ts`.
    #![allow(clippy::unwrap_used)]

    use super::*;

    const LOOKUP: Lookup<'static> = Lookup {
        repository: "acme/notes",
        channel: "stable",
    };

    fn millis(text: &str) -> i64 {
        text.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn line(checked: &str, latest: &str) -> String {
        format!(
            "{{\"format\":1,\"checked\":\"{checked}\",\"repository\":\"acme/notes\",\"channel\":\"stable\",\"latest\":{latest}}}\n"
        )
    }

    fn fresh(fresh: bool) -> CacheReading {
        CacheReading {
            fresh,
            latest: Some(Some("1.5.1".to_owned())),
        }
    }

    fn judge_cache(content: &str, lookup: Lookup<'_>, now: i64) -> CacheReading {
        match cache_contents(content, lookup, now) {
            CacheFound::Read(reading) => reading,
            CacheFound::Missing | CacheFound::Ignored => STALE,
        }
    }

    #[test]
    fn the_cache_is_fresh_from_its_checked_time_until_24_hours_later_and_stale_outside_that_span() {
        let now = millis("2026-10-14T12:00:00.000Z");
        let at = |checked: &str| judge_cache(&line(checked, "\"1.5.1\""), LOOKUP, now);
        assert_eq!(at("2026-10-14T12:00:00.000Z"), fresh(true));
        assert_eq!(at("2026-10-13T12:00:00.001Z"), fresh(true));
        assert_eq!(at("2026-10-13T12:00:00.000Z"), fresh(false));
        assert_eq!(at("2026-10-14T12:00:00.001Z"), fresh(false));
        // A time in another form is not a time the cache holds.
        assert_eq!(at("2026-10-14T11:00:00Z"), fresh(false));
        assert_eq!(
            judge_cache(&line("2026-10-14T12:00:00.000Z", "\"v1.5.1\""), LOOKUP, now),
            CacheReading {
                fresh: false,
                latest: None
            }
        );
    }

    #[test]
    fn a_cache_for_another_lookup_or_format_is_stale_and_names_nothing() {
        let now = millis("2026-10-14T12:00:00.000Z");
        let checked = "2026-10-14T11:00:00.000Z";
        for content in [
            line(checked, "\"1.5.1\"").replace("\"format\":1", "\"format\":2"),
            line(checked, "\"1.5.1\"").replace("acme/notes", "acme/other"),
            line(checked, "\"1.5.1\"").replace("stable", "next"),
            line(checked, "1"),
            "{".to_owned(),
            "[]".to_owned(),
        ] {
            assert_eq!(judge_cache(&content, LOOKUP, now), STALE, "{content}");
        }
        assert_eq!(
            judge_cache(&line(checked, "null"), LOOKUP, now),
            CacheReading {
                fresh: true,
                latest: Some(None)
            }
        );
        let reordered = format!(
            "{{\"latest\":\"1.5.1\",\"note\":\"kept\",\"channel\":\"stable\",\"repository\":\"acme/notes\",\"checked\":\"{checked}\",\"format\":1.0}}"
        );
        assert_eq!(judge_cache(&reordered, LOOKUP, now), fresh(true));
    }

    #[test]
    fn the_line_keeps_the_contract_order_and_writes_null_for_no_version() {
        let entry = CacheEntry {
            lookup: LOOKUP,
            checked: millis("2026-10-14T12:00:00.000Z"),
            latest: None,
        };
        assert_eq!(
            cache_line(&entry),
            "{\"format\":1,\"checked\":\"2026-10-14T12:00:00.000Z\",\"repository\":\"acme/notes\",\"channel\":\"stable\",\"latest\":null}\n"
        );
    }
}
