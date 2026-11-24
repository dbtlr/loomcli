//! The catalog's issue codes, one for each sentence a catalog validator prints. Each code's
//! parameters are that sentence's blanks and hold the rule's settings, never the rejected value.

use serde::{Deserialize, Serialize};

use crate::PathKind;
use crate::calendar::{DAY, format_time_of_day};
use crate::issues::{IssueCode, issue_code};
use crate::js::{js_number, listing};
use crate::span::{format_bytes, format_duration};

/// The parameters of a code whose sentence has no blank: `{}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoParams {}

/// A lower bound.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Min<T> {
    /// The lower bound.
    pub min: T,
}

/// An upper bound.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Max<T> {
    /// The upper bound.
    pub max: T,
}

/// Both bounds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Range<T> {
    /// The upper bound.
    pub max: T,
    /// The lower bound.
    pub min: T,
}

/// An exact length.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Length {
    /// The number of characters.
    pub length: usize,
}

/// The author's own sentence for a `text()` pattern, the code's one blank.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatternMessage {
    /// The sentence, which says what the pattern accepts.
    pub message: String,
}

/// The values a `one_of()` accepts, in the declared order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Values {
    /// The values.
    pub values: Vec<String>,
}

/// The schemes a `url()` accepts, in the declared order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Protocols {
    /// The schemes.
    pub protocols: Vec<String>,
}

/// The distinct written forms a layout validator accepts, the default grammar's first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Forms {
    /// The forms.
    pub forms: Vec<String>,
}

/// The separator a `key_value()` splits at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Separator {
    /// The separator.
    pub separator: String,
}

/// The kind of entry a `path()` requires.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Kind {
    /// The kind.
    pub kind: PathKind,
}

/// A count of characters, reading `character` for a count of 1.
fn characters(count: usize) -> String {
    if count == 1 {
        "1 character".to_owned()
    } else {
        format!("{count} characters")
    }
}

/// A bound printed as JavaScript prints a number.
fn plain(value: f64) -> String {
    js_number(value)
}

macro_rules! code {
    ($(#[$meta:meta])* $name:ident: $params:ty = $code:literal, |$p:pat_param| $message:expr) => {
        $(#[$meta])*
        pub const $name: IssueCode<$params> =
            issue_code(concat!("@loomcli/validators/", $code), |$p: &$params| $message);
    };
    ($(#[$meta:meta])* $name:ident: $params:ty = $code:literal, |$p:pat_param| $message:expr, accepting |$q:pat_param| $check:expr) => {
        $(#[$meta])*
        pub const $name: IssueCode<$params> =
            issue_code(concat!("@loomcli/validators/", $code), |$p: &$params| $message)
                .accepting(|$q: &$params| $check);
    };
}

code!(
    /// `@loomcli/validators/text-nonempty`.
    TEXT_NONEMPTY_ISSUE: NoParams = "text-nonempty", |_| "Expected a nonempty value.".to_owned()
);
code!(
    /// `@loomcli/validators/text-min-length`.
    TEXT_MIN_LENGTH_ISSUE: Min<usize> = "text-min-length",
    |params| format!("Expected at least {}.", characters(params.min))
);
code!(
    /// `@loomcli/validators/text-max-length`.
    TEXT_MAX_LENGTH_ISSUE: Max<usize> = "text-max-length",
    |params| format!("Expected at most {}.", characters(params.max))
);
code!(
    /// `@loomcli/validators/text-exact-length`.
    TEXT_EXACT_LENGTH_ISSUE: Length = "text-exact-length",
    |params| format!("Expected exactly {}.", characters(params.length))
);
code!(
    /// `@loomcli/validators/text-length-range`.
    TEXT_LENGTH_RANGE_ISSUE: Range<usize> = "text-length-range",
    |params| format!("Expected from {} through {}.", params.min, characters(params.max))
);
code!(
    /// `@loomcli/validators/text-pattern`: the author's own sentence.
    TEXT_PATTERN_ISSUE: PatternMessage = "text-pattern",
    |params| params.message.clone(),
    accepting |params| !params.message.is_empty()
);
code!(
    /// `@loomcli/validators/integer`.
    INTEGER_ISSUE: NoParams = "integer", |_| "Expected a whole number.".to_owned()
);
code!(
    /// `@loomcli/validators/integer-range`.
    INTEGER_RANGE_ISSUE: Range<i64> = "integer-range",
    |params| format!("Expected a whole number from {} through {}.", params.min, params.max)
);
code!(
    /// `@loomcli/validators/integer-min`.
    INTEGER_MIN_ISSUE: Min<i64> = "integer-min",
    |params| format!("Expected a whole number of at least {}.", params.min)
);
code!(
    /// `@loomcli/validators/integer-max`.
    INTEGER_MAX_ISSUE: Max<i64> = "integer-max",
    |params| format!("Expected a whole number of at most {}.", params.max)
);
code!(
    /// `@loomcli/validators/number`.
    NUMBER_ISSUE: NoParams = "number", |_| "Expected a number.".to_owned()
);
code!(
    /// `@loomcli/validators/number-range`.
    NUMBER_RANGE_ISSUE: Range<f64> = "number-range",
    |params| format!("Expected a number from {} through {}.", plain(params.min), plain(params.max)),
    accepting |params| params.min.is_finite() && params.max.is_finite()
);
code!(
    /// `@loomcli/validators/number-min`.
    NUMBER_MIN_ISSUE: Min<f64> = "number-min",
    |params| format!("Expected a number of at least {}.", plain(params.min)),
    accepting |params| params.min.is_finite()
);
code!(
    /// `@loomcli/validators/number-max`.
    NUMBER_MAX_ISSUE: Max<f64> = "number-max",
    |params| format!("Expected a number of at most {}.", plain(params.max)),
    accepting |params| params.max.is_finite()
);
code!(
    /// `@loomcli/validators/port`.
    PORT_ISSUE: NoParams = "port", |_| "Expected a port number from 1 through 65535.".to_owned()
);
code!(
    /// `@loomcli/validators/one-of`.
    ONE_OF_ISSUE: Values = "one-of",
    |params| format!("Expected one of: {}.", params.values.join(", ")),
    accepting |params| !params.values.is_empty()
);
code!(
    /// `@loomcli/validators/url`.
    URL_ISSUE: NoParams = "url",
    |_| "Expected an absolute URL, such as https://example.com.".to_owned()
);
code!(
    /// `@loomcli/validators/url-scheme`.
    URL_SCHEME_ISSUE: Protocols = "url-scheme",
    |params| format!("Expected an absolute URL with the scheme {}.", listing(&params.protocols)),
    accepting |params| !params.protocols.is_empty()
);
code!(
    /// `@loomcli/validators/uuid`.
    UUID_ISSUE: NoParams = "uuid",
    |_| "Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000.".to_owned()
);
code!(
    /// `@loomcli/validators/date`.
    DATE_ISSUE: NoParams = "date",
    |_| "Expected a date as YYYY-MM-DD, such as 2026-09-25.".to_owned()
);
code!(
    /// `@loomcli/validators/date-time`.
    DATE_TIME_ISSUE: NoParams = "date-time",
    |_| "Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.".to_owned()
);
code!(
    /// `@loomcli/validators/date-layouts`.
    DATE_LAYOUTS_ISSUE: Forms = "date-layouts",
    |params| format!("Expected a date as {}, such as 2026-09-25.", listing(&params.forms)),
    accepting |params| !params.forms.is_empty()
);
code!(
    /// `@loomcli/validators/date-time-layouts`.
    DATE_TIME_LAYOUTS_ISSUE: Forms = "date-time-layouts",
    |params| format!(
        "Expected a date and time as {}, such as 2026-09-25T14:30:00Z.",
        listing(&params.forms)
    ),
    accepting |params| !params.forms.is_empty()
);
code!(
    /// `@loomcli/validators/time`.
    TIME_ISSUE: NoParams = "time",
    |_| "Expected a time of day, such as 09:30 or 17:45:30.".to_owned()
);
code!(
    /// `@loomcli/validators/time-layouts`.
    TIME_LAYOUTS_ISSUE: Forms = "time-layouts",
    |params| format!("Expected a time of day as {}, such as 09:30.", listing(&params.forms)),
    accepting |params| !params.forms.is_empty()
);
code!(
    /// `@loomcli/validators/time-range`.
    TIME_RANGE_ISSUE: Range<u64> = "time-range",
    |params| format!(
        "Expected a time from {} through {}.",
        format_time_of_day(params.min),
        format_time_of_day(params.max)
    ),
    accepting |params| params.min < DAY && params.max < DAY
);
code!(
    /// `@loomcli/validators/time-min`.
    TIME_MIN_ISSUE: Min<u64> = "time-min",
    |params| format!("Expected a time of at least {}.", format_time_of_day(params.min)),
    accepting |params| params.min < DAY
);
code!(
    /// `@loomcli/validators/time-max`.
    TIME_MAX_ISSUE: Max<u64> = "time-max",
    |params| format!("Expected a time of at most {}.", format_time_of_day(params.max)),
    accepting |params| params.max < DAY
);
code!(
    /// `@loomcli/validators/duration`.
    DURATION_ISSUE: NoParams = "duration",
    |_| "Expected a duration, such as 90s, 2h30m, or 1.5h.".to_owned()
);
code!(
    /// `@loomcli/validators/duration-capital-m`.
    DURATION_CAPITAL_M_ISSUE: NoParams = "duration-capital-m",
    |_| "Expected a duration; write minutes as m or min, because M is ambiguous.".to_owned()
);
code!(
    /// `@loomcli/validators/duration-range`: the bounds are milliseconds.
    DURATION_RANGE_ISSUE: Range<f64> = "duration-range",
    |params| format!(
        "Expected a duration from {} through {}.",
        format_duration(params.min),
        format_duration(params.max)
    ),
    accepting |params| params.min.is_finite() && params.max.is_finite()
);
code!(
    /// `@loomcli/validators/duration-min`: the bound is milliseconds.
    DURATION_MIN_ISSUE: Min<f64> = "duration-min",
    |params| format!("Expected a duration of at least {}.", format_duration(params.min)),
    accepting |params| params.min.is_finite()
);
code!(
    /// `@loomcli/validators/duration-max`: the bound is milliseconds.
    DURATION_MAX_ISSUE: Max<f64> = "duration-max",
    |params| format!("Expected a duration of at most {}.", format_duration(params.max)),
    accepting |params| params.max.is_finite()
);
code!(
    /// `@loomcli/validators/path`.
    PATH_ISSUE: NoParams = "path",
    |_| "Expected a nonempty path with no NUL character.".to_owned()
);

/// What a readable `path()` of this kind reads as in a sentence.
fn readable(kind: PathKind) -> &'static str {
    match kind {
        PathKind::File => "file",
        PathKind::Directory => "directory",
        PathKind::Any => "file or directory",
    }
}

/// What a writable `path()` of this kind reads as in a sentence.
fn writable(kind: PathKind) -> &'static str {
    match kind {
        PathKind::File => "file",
        PathKind::Directory => "directory",
        PathKind::Any => "path",
    }
}

code!(
    /// `@loomcli/validators/path-readable`.
    PATH_READABLE_ISSUE: Kind = "path-readable",
    |params| format!("Expected a readable {} that exists.", readable(params.kind))
);
code!(
    /// `@loomcli/validators/path-writable`.
    PATH_WRITABLE_ISSUE: Kind = "path-writable",
    |params| {
        let noun = writable(params.kind);
        format!("Expected a writable {noun}, or a new {noun} in a writable directory.")
    }
);
code!(
    /// `@loomcli/validators/bytes`.
    BYTES_ISSUE: NoParams = "bytes",
    |_| "Expected a size, such as 512KiB, 10MB, or 1.5GB.".to_owned()
);
code!(
    /// `@loomcli/validators/bytes-range`: the bounds are byte counts.
    BYTES_RANGE_ISSUE: Range<u64> = "bytes-range",
    |params| format!(
        "Expected a size from {} through {}.",
        format_bytes(params.min),
        format_bytes(params.max)
    ),
    accepting |params| params.min <= SAFE_COUNT && params.max <= SAFE_COUNT
);
code!(
    /// `@loomcli/validators/bytes-min`: the bound is a byte count.
    BYTES_MIN_ISSUE: Min<u64> = "bytes-min",
    |params| format!("Expected a size of at least {}.", format_bytes(params.min)),
    accepting |params| params.min <= SAFE_COUNT
);
code!(
    /// `@loomcli/validators/bytes-max`: the bound is a byte count.
    BYTES_MAX_ISSUE: Max<u64> = "bytes-max",
    |params| format!("Expected a size of at most {}.", format_bytes(params.max)),
    accepting |params| params.max <= SAFE_COUNT
);
code!(
    /// `@loomcli/validators/host`.
    HOST_ISSUE: NoParams = "host",
    |_| "Expected a host name, such as example.com.".to_owned()
);
code!(
    /// `@loomcli/validators/host-or-ip`.
    HOST_OR_IP_ISSUE: NoParams = "host-or-ip",
    |_| "Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1]."
        .to_owned()
);
code!(
    /// `@loomcli/validators/ip`.
    IP_ISSUE: NoParams = "ip",
    |_| "Expected an IP address, such as 192.0.2.1 or 2001:db8::1.".to_owned()
);
code!(
    /// `@loomcli/validators/ip-v4`.
    IP_V4_ISSUE: NoParams = "ip-v4", |_| "Expected an IPv4 address, such as 192.0.2.1.".to_owned()
);
code!(
    /// `@loomcli/validators/ip-v6`.
    IP_V6_ISSUE: NoParams = "ip-v6", |_| "Expected an IPv6 address, such as 2001:db8::1.".to_owned()
);
code!(
    /// `@loomcli/validators/cidr`.
    CIDR_ISSUE: NoParams = "cidr",
    |_| "Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32.".to_owned()
);
code!(
    /// `@loomcli/validators/cidr-v4`.
    CIDR_V4_ISSUE: NoParams = "cidr-v4",
    |_| "Expected an IPv4 CIDR block, such as 192.0.2.0/24.".to_owned()
);
code!(
    /// `@loomcli/validators/cidr-v6`.
    CIDR_V6_ISSUE: NoParams = "cidr-v6",
    |_| "Expected an IPv6 CIDR block, such as 2001:db8::/32.".to_owned()
);
code!(
    /// `@loomcli/validators/cidr-host-bits`.
    CIDR_HOST_BITS_ISSUE: NoParams = "cidr-host-bits",
    |_| "Expected a network address with no bits set below the prefix.".to_owned()
);
code!(
    /// `@loomcli/validators/key-value`.
    KEY_VALUE_ISSUE: Separator = "key-value",
    |params| format!("Expected a key and a value as key{}value.", params.separator),
    accepting |params| !params.separator.is_empty()
);
code!(
    /// `@loomcli/validators/email`.
    EMAIL_ISSUE: NoParams = "email",
    |_| "Expected an email address, such as name@example.com.".to_owned()
);

/// The largest count of bytes a safe integer holds.
const SAFE_COUNT: u64 = 9_007_199_254_740_991;
