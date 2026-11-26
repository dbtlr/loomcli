//! The catalog's operator sentences, under the reference's ADR-0164. A sentence repeats a rule's
//! settings and never the rejected value.

use loomcli_core::escape_control_characters;

use crate::PathKind;
use crate::calendar::format_time_of_day;
use crate::js::{js_number, listing};
use crate::span::{format_bytes, format_duration};

/// A count of characters, reading `character` for a count of 1.
fn characters(count: usize) -> String {
    if count == 1 {
        "1 character".to_owned()
    } else {
        format!("{count} characters")
    }
}

/// The declared settings a sentence lists, joined as a sentence lists them and escaped, because an
/// author declares them.
fn listed<S: AsRef<str>>(items: &[S]) -> String {
    escape_control_characters(&listing(items))
}

/// What a readable `path()` of this kind reads as in a sentence.
fn readable_kind(kind: PathKind) -> &'static str {
    match kind {
        PathKind::File => "file",
        PathKind::Directory => "directory",
        PathKind::Any => "file or directory",
    }
}

/// What a writable `path()` of this kind reads as in a sentence.
fn writable_kind(kind: PathKind) -> &'static str {
    match kind {
        PathKind::File => "file",
        PathKind::Directory => "directory",
        PathKind::Any => "path",
    }
}

pub(crate) const EXPECTED_NONEMPTY: &str = "Expected a nonempty value.";

pub(crate) fn expected_min_length(min: usize) -> String {
    format!("Expected at least {}.", characters(min))
}

pub(crate) fn expected_max_length(max: usize) -> String {
    format!("Expected at most {}.", characters(max))
}

pub(crate) fn expected_exact_length(length: usize) -> String {
    format!("Expected exactly {}.", characters(length))
}

pub(crate) fn expected_length_range(min: usize, max: usize) -> String {
    format!("Expected from {min} through {}.", characters(max))
}

pub(crate) const EXPECTED_INTEGER: &str = "Expected a whole number.";

pub(crate) fn expected_integer_range(min: i64, max: i64) -> String {
    format!("Expected a whole number from {min} through {max}.")
}

pub(crate) fn expected_integer_min(min: i64) -> String {
    format!("Expected a whole number of at least {min}.")
}

pub(crate) fn expected_integer_max(max: i64) -> String {
    format!("Expected a whole number of at most {max}.")
}

pub(crate) const EXPECTED_NUMBER: &str = "Expected a number.";

pub(crate) fn expected_number_range(min: f64, max: f64) -> String {
    format!(
        "Expected a number from {} through {}.",
        js_number(min),
        js_number(max)
    )
}

pub(crate) fn expected_number_min(min: f64) -> String {
    format!("Expected a number of at least {}.", js_number(min))
}

pub(crate) fn expected_number_max(max: f64) -> String {
    format!("Expected a number of at most {}.", js_number(max))
}

pub(crate) const EXPECTED_PORT: &str = "Expected a port number from 1 through 65535.";

pub(crate) fn expected_one_of(values: &[String]) -> String {
    format!(
        "Expected one of: {}.",
        escape_control_characters(&values.join(", "))
    )
}

pub(crate) const EXPECTED_URL: &str = "Expected an absolute URL, such as https://example.com.";

pub(crate) fn expected_url_scheme(protocols: &[String]) -> String {
    format!(
        "Expected an absolute URL with the scheme {}.",
        listed(protocols)
    )
}

pub(crate) const EXPECTED_UUID: &str =
    "Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.";

pub(crate) const EXPECTED_DATE: &str = "Expected a date as YYYY-MM-DD, such as 2026-09-25.";

pub(crate) const EXPECTED_DATE_TIME: &str =
    "Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.";

pub(crate) fn expected_date_layouts(forms: &[String]) -> String {
    format!("Expected a date as {}, such as 2026-09-25.", listed(forms))
}

pub(crate) fn expected_date_time_layouts(forms: &[String]) -> String {
    format!(
        "Expected a date and time as {}, such as 2026-09-25T14:30:00Z.",
        listed(forms)
    )
}

pub(crate) const EXPECTED_TIME: &str = "Expected a time of day, such as 09:30 or 17:45:30.";

pub(crate) fn expected_time_layouts(forms: &[String]) -> String {
    format!(
        "Expected a time of day as {}, such as 09:30.",
        listed(forms)
    )
}

pub(crate) fn expected_time_range(min: u64, max: u64) -> String {
    format!(
        "Expected a time from {} through {}.",
        format_time_of_day(min),
        format_time_of_day(max)
    )
}

pub(crate) fn expected_time_min(min: u64) -> String {
    format!("Expected a time of at least {}.", format_time_of_day(min))
}

pub(crate) fn expected_time_max(max: u64) -> String {
    format!("Expected a time of at most {}.", format_time_of_day(max))
}

pub(crate) const EXPECTED_DURATION: &str = "Expected a duration, such as 90s, 2h30m, or 1.5h.";

pub(crate) const EXPECTED_DURATION_MINUTES: &str =
    "Expected a duration; write minutes as m or min, because M is ambiguous.";

pub(crate) fn expected_duration_range(min: f64, max: f64) -> String {
    format!(
        "Expected a duration from {} through {}.",
        format_duration(min),
        format_duration(max)
    )
}

pub(crate) fn expected_duration_min(min: f64) -> String {
    format!("Expected a duration of at least {}.", format_duration(min))
}

pub(crate) fn expected_duration_max(max: f64) -> String {
    format!("Expected a duration of at most {}.", format_duration(max))
}

pub(crate) const EXPECTED_PATH: &str = "Expected a nonempty path with no NUL character.";

pub(crate) fn expected_readable_path(kind: PathKind) -> String {
    format!("Expected a readable {} that exists.", readable_kind(kind))
}

pub(crate) fn expected_writable_path(kind: PathKind) -> String {
    let noun = writable_kind(kind);
    format!("Expected a writable {noun}, or a new {noun} in a writable directory.")
}

pub(crate) const EXPECTED_SIZE: &str = "Expected a size, such as 512KiB, 10MB, or 1.5GB.";

pub(crate) fn expected_size_range(min: u64, max: u64) -> String {
    format!(
        "Expected a size from {} through {}.",
        format_bytes(min),
        format_bytes(max)
    )
}

pub(crate) fn expected_size_min(min: u64) -> String {
    format!("Expected a size of at least {}.", format_bytes(min))
}

pub(crate) fn expected_size_max(max: u64) -> String {
    format!("Expected a size of at most {}.", format_bytes(max))
}

pub(crate) const EXPECTED_HOST: &str = "Expected a host name, such as example.com.";

pub(crate) const EXPECTED_HOST_OR_IP: &str =
    "Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1].";

pub(crate) const EXPECTED_IP: &str = "Expected an IP address, such as 192.0.2.1 or 2001:db8::1.";

pub(crate) const EXPECTED_IP_V4: &str = "Expected an IPv4 address, such as 192.0.2.1.";

pub(crate) const EXPECTED_IP_V6: &str = "Expected an IPv6 address, such as 2001:db8::1.";

pub(crate) const EXPECTED_CIDR: &str =
    "Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.";

pub(crate) const EXPECTED_CIDR_V4: &str = "Expected an IPv4 CIDR block, such as 192.0.2.0/24.";

pub(crate) const EXPECTED_CIDR_V6: &str = "Expected an IPv6 CIDR block, such as 2001:db8::/32.";

pub(crate) const EXPECTED_NETWORK_ADDRESS: &str =
    "Expected a network address with no bits set below the prefix.";

pub(crate) fn expected_key_value(separator: &str) -> String {
    format!(
        "Expected a key and a value as key{}value.",
        escape_control_characters(separator)
    )
}

pub(crate) const EXPECTED_EMAIL: &str = "Expected an email address, such as name@example.com.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declared_settings_a_sentence_repeats_are_escaped() {
        let hostile = "a\u{1b}[31mb".to_owned();
        for sentence in [
            expected_one_of(std::slice::from_ref(&hostile)),
            expected_url_scheme(std::slice::from_ref(&hostile)),
            expected_date_layouts(std::slice::from_ref(&hostile)),
            expected_date_time_layouts(std::slice::from_ref(&hostile)),
            expected_time_layouts(std::slice::from_ref(&hostile)),
            expected_key_value(&hostile),
        ] {
            assert!(!sentence.contains('\u{1b}'), "{sentence:?}");
        }
    }
}
