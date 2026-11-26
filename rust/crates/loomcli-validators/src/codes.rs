//! The catalog's issue codes, one for each sentence a catalog validator prints. Each code's
//! parameters are that sentence's blanks and hold the rule's settings, never the rejected value.

use serde::{Deserialize, Serialize};

use crate::PathKind;
use crate::calendar::DAY;
use crate::issues::{IssueCode, issue_code};
use crate::messages;

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
    TEXT_NONEMPTY_ISSUE: NoParams = "text-nonempty", |_| messages::EXPECTED_NONEMPTY.to_owned()
);
code!(
    /// `@loomcli/validators/text-min-length`.
    TEXT_MIN_LENGTH_ISSUE: Min<usize> = "text-min-length",
    |params| messages::expected_min_length(params.min)
);
code!(
    /// `@loomcli/validators/text-max-length`.
    TEXT_MAX_LENGTH_ISSUE: Max<usize> = "text-max-length",
    |params| messages::expected_max_length(params.max)
);
code!(
    /// `@loomcli/validators/text-exact-length`.
    TEXT_EXACT_LENGTH_ISSUE: Length = "text-exact-length",
    |params| messages::expected_exact_length(params.length)
);
code!(
    /// `@loomcli/validators/text-length-range`.
    TEXT_LENGTH_RANGE_ISSUE: Range<usize> = "text-length-range",
    |params| messages::expected_length_range(params.min, params.max)
);
code!(
    /// `@loomcli/validators/text-pattern`: the author's own sentence.
    TEXT_PATTERN_ISSUE: PatternMessage = "text-pattern",
    |params| params.message.clone(),
    accepting |params| !params.message.is_empty()
);
code!(
    /// `@loomcli/validators/integer`.
    INTEGER_ISSUE: NoParams = "integer", |_| messages::EXPECTED_INTEGER.to_owned()
);
code!(
    /// `@loomcli/validators/integer-range`.
    INTEGER_RANGE_ISSUE: Range<i64> = "integer-range",
    |params| messages::expected_integer_range(params.min, params.max)
);
code!(
    /// `@loomcli/validators/integer-min`.
    INTEGER_MIN_ISSUE: Min<i64> = "integer-min",
    |params| messages::expected_integer_min(params.min)
);
code!(
    /// `@loomcli/validators/integer-max`.
    INTEGER_MAX_ISSUE: Max<i64> = "integer-max",
    |params| messages::expected_integer_max(params.max)
);
code!(
    /// `@loomcli/validators/number`.
    NUMBER_ISSUE: NoParams = "number", |_| messages::EXPECTED_NUMBER.to_owned()
);
code!(
    /// `@loomcli/validators/number-range`.
    NUMBER_RANGE_ISSUE: Range<f64> = "number-range",
    |params| messages::expected_number_range(params.min, params.max),
    accepting |params| params.min.is_finite() && params.max.is_finite()
);
code!(
    /// `@loomcli/validators/number-min`.
    NUMBER_MIN_ISSUE: Min<f64> = "number-min",
    |params| messages::expected_number_min(params.min),
    accepting |params| params.min.is_finite()
);
code!(
    /// `@loomcli/validators/number-max`.
    NUMBER_MAX_ISSUE: Max<f64> = "number-max",
    |params| messages::expected_number_max(params.max),
    accepting |params| params.max.is_finite()
);
code!(
    /// `@loomcli/validators/port`.
    PORT_ISSUE: NoParams = "port", |_| messages::EXPECTED_PORT.to_owned()
);
code!(
    /// `@loomcli/validators/one-of`.
    ONE_OF_ISSUE: Values = "one-of",
    |params| messages::expected_one_of(&params.values),
    accepting |params| !params.values.is_empty()
);
code!(
    /// `@loomcli/validators/url`.
    URL_ISSUE: NoParams = "url", |_| messages::EXPECTED_URL.to_owned()
);
code!(
    /// `@loomcli/validators/url-scheme`.
    URL_SCHEME_ISSUE: Protocols = "url-scheme",
    |params| messages::expected_url_scheme(&params.protocols),
    accepting |params| !params.protocols.is_empty()
);
code!(
    /// `@loomcli/validators/uuid`.
    UUID_ISSUE: NoParams = "uuid", |_| messages::EXPECTED_UUID.to_owned()
);
code!(
    /// `@loomcli/validators/date`.
    DATE_ISSUE: NoParams = "date", |_| messages::EXPECTED_DATE.to_owned()
);
code!(
    /// `@loomcli/validators/date-time`.
    DATE_TIME_ISSUE: NoParams = "date-time", |_| messages::EXPECTED_DATE_TIME.to_owned()
);
code!(
    /// `@loomcli/validators/date-layouts`.
    DATE_LAYOUTS_ISSUE: Forms = "date-layouts",
    |params| messages::expected_date_layouts(&params.forms),
    accepting |params| !params.forms.is_empty()
);
code!(
    /// `@loomcli/validators/date-time-layouts`.
    DATE_TIME_LAYOUTS_ISSUE: Forms = "date-time-layouts",
    |params| messages::expected_date_time_layouts(&params.forms),
    accepting |params| !params.forms.is_empty()
);
code!(
    /// `@loomcli/validators/time`.
    TIME_ISSUE: NoParams = "time", |_| messages::EXPECTED_TIME.to_owned()
);
code!(
    /// `@loomcli/validators/time-layouts`.
    TIME_LAYOUTS_ISSUE: Forms = "time-layouts",
    |params| messages::expected_time_layouts(&params.forms),
    accepting |params| !params.forms.is_empty()
);
code!(
    /// `@loomcli/validators/time-range`.
    TIME_RANGE_ISSUE: Range<u64> = "time-range",
    |params| messages::expected_time_range(params.min, params.max),
    accepting |params| params.min < DAY && params.max < DAY
);
code!(
    /// `@loomcli/validators/time-min`.
    TIME_MIN_ISSUE: Min<u64> = "time-min",
    |params| messages::expected_time_min(params.min),
    accepting |params| params.min < DAY
);
code!(
    /// `@loomcli/validators/time-max`.
    TIME_MAX_ISSUE: Max<u64> = "time-max",
    |params| messages::expected_time_max(params.max),
    accepting |params| params.max < DAY
);
code!(
    /// `@loomcli/validators/duration`.
    DURATION_ISSUE: NoParams = "duration", |_| messages::EXPECTED_DURATION.to_owned()
);
code!(
    /// `@loomcli/validators/duration-capital-m`.
    DURATION_CAPITAL_M_ISSUE: NoParams = "duration-capital-m",
    |_| messages::EXPECTED_DURATION_MINUTES.to_owned()
);
code!(
    /// `@loomcli/validators/duration-range`: the bounds are milliseconds.
    DURATION_RANGE_ISSUE: Range<f64> = "duration-range",
    |params| messages::expected_duration_range(params.min, params.max),
    accepting |params| params.min.is_finite() && params.max.is_finite()
);
code!(
    /// `@loomcli/validators/duration-min`: the bound is milliseconds.
    DURATION_MIN_ISSUE: Min<f64> = "duration-min",
    |params| messages::expected_duration_min(params.min),
    accepting |params| params.min.is_finite()
);
code!(
    /// `@loomcli/validators/duration-max`: the bound is milliseconds.
    DURATION_MAX_ISSUE: Max<f64> = "duration-max",
    |params| messages::expected_duration_max(params.max),
    accepting |params| params.max.is_finite()
);
code!(
    /// `@loomcli/validators/path`.
    PATH_ISSUE: NoParams = "path", |_| messages::EXPECTED_PATH.to_owned()
);
code!(
    /// `@loomcli/validators/path-readable`.
    PATH_READABLE_ISSUE: Kind = "path-readable",
    |params| messages::expected_readable_path(params.kind)
);
code!(
    /// `@loomcli/validators/path-writable`.
    PATH_WRITABLE_ISSUE: Kind = "path-writable",
    |params| messages::expected_writable_path(params.kind)
);
code!(
    /// `@loomcli/validators/bytes`.
    BYTES_ISSUE: NoParams = "bytes", |_| messages::EXPECTED_SIZE.to_owned()
);
code!(
    /// `@loomcli/validators/bytes-range`: the bounds are byte counts.
    BYTES_RANGE_ISSUE: Range<u64> = "bytes-range",
    |params| messages::expected_size_range(params.min, params.max),
    accepting |params| params.min <= SAFE_COUNT && params.max <= SAFE_COUNT
);
code!(
    /// `@loomcli/validators/bytes-min`: the bound is a byte count.
    BYTES_MIN_ISSUE: Min<u64> = "bytes-min",
    |params| messages::expected_size_min(params.min),
    accepting |params| params.min <= SAFE_COUNT
);
code!(
    /// `@loomcli/validators/bytes-max`: the bound is a byte count.
    BYTES_MAX_ISSUE: Max<u64> = "bytes-max",
    |params| messages::expected_size_max(params.max),
    accepting |params| params.max <= SAFE_COUNT
);
code!(
    /// `@loomcli/validators/host`.
    HOST_ISSUE: NoParams = "host", |_| messages::EXPECTED_HOST.to_owned()
);
code!(
    /// `@loomcli/validators/host-or-ip`.
    HOST_OR_IP_ISSUE: NoParams = "host-or-ip", |_| messages::EXPECTED_HOST_OR_IP.to_owned()
);
code!(
    /// `@loomcli/validators/ip`.
    IP_ISSUE: NoParams = "ip", |_| messages::EXPECTED_IP.to_owned()
);
code!(
    /// `@loomcli/validators/ip-v4`.
    IP_V4_ISSUE: NoParams = "ip-v4", |_| messages::EXPECTED_IP_V4.to_owned()
);
code!(
    /// `@loomcli/validators/ip-v6`.
    IP_V6_ISSUE: NoParams = "ip-v6", |_| messages::EXPECTED_IP_V6.to_owned()
);
code!(
    /// `@loomcli/validators/cidr`.
    CIDR_ISSUE: NoParams = "cidr", |_| messages::EXPECTED_CIDR.to_owned()
);
code!(
    /// `@loomcli/validators/cidr-v4`.
    CIDR_V4_ISSUE: NoParams = "cidr-v4", |_| messages::EXPECTED_CIDR_V4.to_owned()
);
code!(
    /// `@loomcli/validators/cidr-v6`.
    CIDR_V6_ISSUE: NoParams = "cidr-v6", |_| messages::EXPECTED_CIDR_V6.to_owned()
);
code!(
    /// `@loomcli/validators/cidr-host-bits`.
    CIDR_HOST_BITS_ISSUE: NoParams = "cidr-host-bits", |_| messages::EXPECTED_NETWORK_ADDRESS.to_owned()
);
code!(
    /// `@loomcli/validators/key-value`.
    KEY_VALUE_ISSUE: Separator = "key-value",
    |params| messages::expected_key_value(&params.separator),
    accepting |params| !params.separator.is_empty()
);
code!(
    /// `@loomcli/validators/email`.
    EMAIL_ISSUE: NoParams = "email", |_| messages::EXPECTED_EMAIL.to_owned()
);

/// The largest count of bytes a safe integer holds.
const SAFE_COUNT: u64 = 9_007_199_254_740_991;
