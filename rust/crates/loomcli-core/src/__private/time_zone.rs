//! Time zone lookup shared by core and the validators crate.

use jiff::tz::{TimeZone, TimeZoneDatabase};

/// Looks up an IANA time zone and its rules.
#[must_use]
pub fn lookup(name: &str) -> Option<TimeZone> {
    if name.is_empty() || name.trim() != name || name.starts_with(['+', '-', '\u{2212}']) {
        return None;
    }
    // Zoneinfo can include a placeholder and files for host configuration.
    if ["Factory", "localtime", "posixrules"]
        .iter()
        .any(|reserved| name.eq_ignore_ascii_case(reserved))
    {
        return None;
    }
    TimeZone::get(name)
        .or_else(|_| TimeZoneDatabase::bundled().get(name))
        .ok()
        .filter(|zone| zone.iana_name().is_some())
}
