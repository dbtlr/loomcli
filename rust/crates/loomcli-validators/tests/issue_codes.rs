//! Ports `codes.test.ts`: each of the catalog's 51 codes, its parameters, its sentence, and what
//! `read` answers for every other code.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_core::Issue;
use loomcli_validators::codes::*;
use loomcli_validators::{
    IpVersion, PathAccess, PathKind, bytes, cidr, date, date_time, duration, email, host, integer,
    ip, key_value, number, one_of, path, port, text, time, url, uuid,
};
use serde_json::{Value, json};
use support::issue_of;

const PREFIX: &str = "@loomcli/validators/";

/// One catalog code: the issue a rejected token earns, what it carries, and how to read it back.
struct Row {
    code: &'static str,
    token: &'static str,
    issue: Issue,
    params: Value,
    message: &'static str,
    reads: Box<dyn Fn(&Issue) -> Option<Value>>,
}

/// The same JSON with each number compared as a float, as JavaScript compares them.
fn same(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, x)| b.get(key).is_some_and(|y| same(x, y)))
        }
        _ => left == right,
    }
}

macro_rules! row {
    ($rows:ident, $code:literal, $descriptor:expr, $validator:expr, $token:expr, $params:expr, $message:expr) => {
        $rows.push(Row {
            code: $code,
            token: $token,
            issue: issue_of(&$validator, $token),
            params: $params,
            message: $message,
            reads: Box::new(|issue: &Issue| {
                $descriptor
                    .read(issue)
                    .map(|read| serde_json::to_value(read).unwrap())
            }),
        });
    };
}

fn rows() -> Vec<Row> {
    let mut rows = Vec::new();
    row!(
        rows,
        "text-nonempty",
        TEXT_NONEMPTY_ISSUE,
        text(),
        "",
        json!({}),
        "Expected a nonempty value."
    );
    row!(
        rows,
        "text-min-length",
        TEXT_MIN_LENGTH_ISSUE,
        text().min_length(2),
        "z",
        json!({"min": 2}),
        "Expected at least 2 characters."
    );
    row!(
        rows,
        "text-max-length",
        TEXT_MAX_LENGTH_ISSUE,
        text().min_length(0).max_length(3),
        "abcd",
        json!({"max": 3}),
        "Expected at most 3 characters."
    );
    row!(
        rows,
        "text-exact-length",
        TEXT_EXACT_LENGTH_ISSUE,
        text().length(8),
        "short",
        json!({"length": 8}),
        "Expected exactly 8 characters."
    );
    row!(
        rows,
        "text-length-range",
        TEXT_LENGTH_RANGE_ISSUE,
        text().max_length(32),
        "",
        json!({"max": 32, "min": 1}),
        "Expected from 1 through 32 characters."
    );
    row!(
        rows,
        "text-pattern",
        TEXT_PATTERN_ISSUE,
        text().pattern("^[a-z]+$", "Expected lowercase letters."),
        "ABC",
        json!({"message": "Expected lowercase letters."}),
        "Expected lowercase letters."
    );
    row!(
        rows,
        "integer",
        INTEGER_ISSUE,
        integer(),
        "abc",
        json!({}),
        "Expected a whole number."
    );
    row!(
        rows,
        "integer-range",
        INTEGER_RANGE_ISSUE,
        integer().min(1).max(64),
        "99",
        json!({"max": 64, "min": 1}),
        "Expected a whole number from 1 through 64."
    );
    row!(
        rows,
        "integer-min",
        INTEGER_MIN_ISSUE,
        integer().min(1),
        "0",
        json!({"min": 1}),
        "Expected a whole number of at least 1."
    );
    row!(
        rows,
        "integer-max",
        INTEGER_MAX_ISSUE,
        integer().max(10),
        "11",
        json!({"max": 10}),
        "Expected a whole number of at most 10."
    );
    row!(
        rows,
        "number",
        NUMBER_ISSUE,
        number(),
        "NaN",
        json!({}),
        "Expected a number."
    );
    row!(
        rows,
        "number-range",
        NUMBER_RANGE_ISSUE,
        number().min(0.0).max(1.0),
        "2",
        json!({"max": 1, "min": 0}),
        "Expected a number from 0 through 1."
    );
    row!(
        rows,
        "number-min",
        NUMBER_MIN_ISSUE,
        number().min(0.5),
        "0.25",
        json!({"min": 0.5}),
        "Expected a number of at least 0.5."
    );
    row!(
        rows,
        "number-max",
        NUMBER_MAX_ISSUE,
        number().max(1e21),
        "2e21",
        json!({"max": 1e21}),
        "Expected a number of at most 1e+21."
    );
    row!(
        rows,
        "port",
        PORT_ISSUE,
        port(),
        "0",
        json!({}),
        "Expected a port number from 1 through 65535."
    );
    row!(
        rows,
        "one-of",
        ONE_OF_ISSUE,
        one_of(["bytes", "words", "lines"]),
        "chars",
        json!({"values": ["bytes", "words", "lines"]}),
        "Expected one of: bytes, words, lines."
    );
    row!(
        rows,
        "url",
        URL_ISSUE,
        url(),
        "not a url",
        json!({}),
        "Expected an absolute URL, such as https://example.com."
    );
    row!(
        rows,
        "url-scheme",
        URL_SCHEME_ISSUE,
        url().protocols(["https", "http"]),
        "ftp://example.org",
        json!({"protocols": ["https", "http"]}),
        "Expected an absolute URL with the scheme https or http."
    );
    row!(
        rows,
        "uuid",
        UUID_ISSUE,
        uuid(),
        "nope",
        json!({}),
        "Expected a UUID, such as 123e4567-e89b-12d3-a456-426614174000."
    );
    row!(
        rows,
        "date",
        DATE_ISSUE,
        date(),
        "2026-02-29",
        json!({}),
        "Expected a date as YYYY-MM-DD, such as 2026-09-25."
    );
    row!(
        rows,
        "date-time",
        DATE_TIME_ISSUE,
        date_time().time_zone("UTC"),
        "nope",
        json!({}),
        "Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30."
    );
    row!(
        rows,
        "date-layouts",
        DATE_LAYOUTS_ISSUE,
        date().layouts(["%d/%m/%Y"]),
        "31/04/2026",
        json!({"forms": ["YYYY-MM-DD", "DD/MM/YYYY"]}),
        "Expected a date as YYYY-MM-DD or DD/MM/YYYY, such as 2026-09-25."
    );
    row!(
        rows,
        "date-time-layouts",
        DATE_TIME_LAYOUTS_ISSUE,
        date_time().layouts(["%d/%m/%Y %H:%M"]).time_zone("UTC"),
        "25/09/2026 24:00",
        json!({"forms": ["YYYY-MM-DDThh:mm", "DD/MM/YYYY hh:mm"]}),
        "Expected a date and time as YYYY-MM-DDThh:mm or DD/MM/YYYY hh:mm, such as 2026-09-25T14:30:00Z."
    );
    row!(
        rows,
        "time",
        TIME_ISSUE,
        time(),
        "24:00",
        json!({}),
        "Expected a time of day, such as 09:30 or 17:45:30."
    );
    row!(
        rows,
        "time-layouts",
        TIME_LAYOUTS_ISSUE,
        time().layouts(["%I:%M%p"]),
        "13:00pm",
        json!({"forms": ["hh:mm", "hh:mmAM"]}),
        "Expected a time of day as hh:mm or hh:mmAM, such as 09:30."
    );
    row!(
        rows,
        "time-range",
        TIME_RANGE_ISSUE,
        time().layouts(["%I:%M%p"]).min("09:00").max("17:00"),
        "8:00am",
        json!({"max": 61_200_000, "min": 32_400_000}),
        "Expected a time from 09:00 through 17:00."
    );
    row!(
        rows,
        "time-min",
        TIME_MIN_ISSUE,
        time().min("09:00:00.50"),
        "08:00",
        json!({"min": 32_400_500}),
        "Expected a time of at least 09:00:00.5."
    );
    row!(
        rows,
        "time-max",
        TIME_MAX_ISSUE,
        time().max("17:00:30"),
        "18:00",
        json!({"max": 61_230_000}),
        "Expected a time of at most 17:00:30."
    );
    row!(
        rows,
        "duration",
        DURATION_ISSUE,
        duration(),
        "abc",
        json!({}),
        "Expected a duration, such as 90s, 2h30m, or 1.5h."
    );
    row!(
        rows,
        "duration-capital-m",
        DURATION_CAPITAL_M_ISSUE,
        duration(),
        "5M",
        json!({}),
        "Expected a duration; write minutes as m or min, because M is ambiguous."
    );
    row!(
        rows,
        "duration-range",
        DURATION_RANGE_ISSUE,
        duration().min("30").max("24h"),
        "25h",
        json!({"max": 86_400_000, "min": 30_000}),
        "Expected a duration from 30s through 1d."
    );
    row!(
        rows,
        "duration-min",
        DURATION_MIN_ISSUE,
        duration().min("1h30m"),
        "1h",
        json!({"min": 5_400_000}),
        "Expected a duration of at least 1h30m."
    );
    row!(
        rows,
        "duration-max",
        DURATION_MAX_ISSUE,
        duration().max("250ms"),
        "1s",
        json!({"max": 250}),
        "Expected a duration of at most 250ms."
    );
    row!(
        rows,
        "path",
        PATH_ISSUE,
        path(),
        "",
        json!({}),
        "Expected a nonempty path with no NUL character."
    );
    row!(
        rows,
        "path-readable",
        PATH_READABLE_ISSUE,
        path().access(PathAccess::Read).kind(PathKind::Any),
        "a\0b",
        json!({"kind": "any"}),
        "Expected a readable file or directory that exists."
    );
    row!(
        rows,
        "path-writable",
        PATH_WRITABLE_ISSUE,
        path().access(PathAccess::Write).kind(PathKind::Any),
        "a\0b",
        json!({"kind": "any"}),
        "Expected a writable path, or a new path in a writable directory."
    );
    row!(
        rows,
        "bytes",
        BYTES_ISSUE,
        bytes(),
        "abc",
        json!({}),
        "Expected a size, such as 512KiB, 10MB, or 1.5GB."
    );
    row!(
        rows,
        "bytes-range",
        BYTES_RANGE_ISSUE,
        bytes().min("1MB").max("10GiB"),
        "1kB",
        json!({"max": 10_737_418_240_u64, "min": 1_000_000}),
        "Expected a size from 1MB through 10GiB."
    );
    row!(
        rows,
        "bytes-min",
        BYTES_MIN_ISSUE,
        bytes().min("1MB"),
        "1kB",
        json!({"min": 1_000_000}),
        "Expected a size of at least 1MB."
    );
    row!(
        rows,
        "bytes-max",
        BYTES_MAX_ISSUE,
        bytes().max("10GiB"),
        "11GiB",
        json!({"max": 10_737_418_240_u64}),
        "Expected a size of at most 10GiB."
    );
    row!(
        rows,
        "host",
        HOST_ISSUE,
        host(),
        "exa_mple.org",
        json!({}),
        "Expected a host name, such as example.com."
    );
    row!(
        rows,
        "host-or-ip",
        HOST_OR_IP_ISSUE,
        host().or_ip(),
        "2001:db8::2",
        json!({}),
        "Expected a host name or an IP address, such as example.com, 192.0.2.1, or [2001:db8::1]."
    );
    row!(
        rows,
        "ip",
        IP_ISSUE,
        ip(),
        "192.0.2.01",
        json!({}),
        "Expected an IP address, such as 192.0.2.1 or 2001:db8::1."
    );
    row!(
        rows,
        "ip-v4",
        IP_V4_ISSUE,
        ip().version(IpVersion::V4),
        "2001:db8::2",
        json!({}),
        "Expected an IPv4 address, such as 192.0.2.1."
    );
    row!(
        rows,
        "ip-v6",
        IP_V6_ISSUE,
        ip().version(IpVersion::V6),
        "192.0.2.10",
        json!({}),
        "Expected an IPv6 address, such as 2001:db8::1."
    );
    row!(
        rows,
        "cidr",
        CIDR_ISSUE,
        cidr(),
        "10.0.0.0/33",
        json!({}),
        "Expected a CIDR block, such as 192.0.2.0/24 or 2001:db8::/32."
    );
    row!(
        rows,
        "cidr-v4",
        CIDR_V4_ISSUE,
        cidr().version(IpVersion::V4),
        "2001:db8::/48",
        json!({}),
        "Expected an IPv4 CIDR block, such as 192.0.2.0/24."
    );
    row!(
        rows,
        "cidr-v6",
        CIDR_V6_ISSUE,
        cidr().version(IpVersion::V6),
        "10.0.0.0/8",
        json!({}),
        "Expected an IPv6 CIDR block, such as 2001:db8::/32."
    );
    row!(
        rows,
        "cidr-host-bits",
        CIDR_HOST_BITS_ISSUE,
        cidr(),
        "10.0.0.1/8",
        json!({}),
        "Expected a network address with no bits set below the prefix."
    );
    row!(
        rows,
        "key-value",
        KEY_VALUE_ISSUE,
        key_value(),
        "env",
        json!({"separator": "="}),
        "Expected a key and a value as key=value."
    );
    row!(
        rows,
        "email",
        EMAIL_ISSUE,
        email(),
        "ops",
        json!({}),
        "Expected an email address, such as name@example.com."
    );
    rows
}

#[test]
fn the_catalog_declares_51_codes_each_under_its_export() {
    let rows = rows();
    assert_eq!(rows.len(), 51);
    let mut codes: Vec<&str> = rows.iter().map(|row| row.code).collect();
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(codes.len(), 51);
    for row in &rows {
        assert_eq!(
            row.issue.code.as_deref(),
            Some(format!("{PREFIX}{}", row.code).as_str())
        );
    }
    assert_eq!(
        INTEGER_RANGE_ISSUE.code(),
        "@loomcli/validators/integer-range"
    );
}

#[test]
fn each_rejection_carries_its_code_and_the_rule_settings_as_parameters() {
    for row in rows() {
        assert_eq!(row.issue.message, row.message, "{}", row.code);
        let params = row.issue.params.clone().unwrap();
        assert!(
            same(&params, &row.params),
            "{}: {params} against {}",
            row.code,
            row.params
        );
        let read = (row.reads)(&row.issue).unwrap_or_else(|| panic!("{} reads itself", row.code));
        assert!(same(&read, &row.params), "{}", row.code);
        assert!(row.issue.path.is_empty());
    }
}

#[test]
fn a_whole_number_bound_prints_as_a_json_integer() {
    let issue = issue_of(&number().min(0.0).max(1.0), "2");
    assert_eq!(
        serde_json::to_string(&issue.params).unwrap(),
        r#"{"max":1,"min":0}"#
    );
}

#[test]
fn every_other_code_reads_the_issue_as_none() {
    // Each row's reader is tried on every row's issue; only its own issue reads.
    let rows = rows();
    for row in &rows {
        for other in &rows {
            let read = (other.reads)(&row.issue);
            if row.code == other.code {
                assert!(read.is_some(), "{} reads itself", row.code);
            } else {
                assert!(read.is_none(), "{} read {}'s issue", other.code, row.code);
            }
        }
    }
}

#[test]
fn no_parameter_holds_the_rejected_token() {
    for row in rows() {
        // The empty token is inside every string, so only a nonempty token can be repeated.
        let params = row.issue.params.as_ref().unwrap().to_string();
        assert!(
            row.token.is_empty() || !params.contains(row.token),
            "{}",
            row.code
        );
    }
}

fn foreign(code: &str, params: Option<Value>) -> Issue {
    let issue = Issue::new("x");
    match params {
        Some(params) => issue.code(code, params),
        None => {
            let mut issue = issue;
            issue.code = Some(code.to_owned());
            issue
        }
    }
}

#[test]
fn a_catalog_code_rejects_parameters_of_another_shape() {
    let code = INTEGER_RANGE_ISSUE.code();
    assert!(
        INTEGER_RANGE_ISSUE
            .read(&foreign(code, Some(json!({"min": 1}))))
            .is_none()
    );
    assert!(
        INTEGER_RANGE_ISSUE
            .read(&foreign(code, Some(json!({"max": 1, "min": "0"}))))
            .is_none()
    );
    assert!(
        INTEGER_ISSUE
            .read(&foreign(INTEGER_ISSUE.code(), None))
            .is_none()
    );
    assert!(
        INTEGER_RANGE_ISSUE
            .read(&foreign(
                code,
                Some(json!({"extra": 0, "max": 2, "min": 1}))
            ))
            .is_none()
    );
    assert!(
        INTEGER_RANGE_ISSUE
            .read(&foreign(code, Some(json!({"max": 2, "min": 1}))))
            .is_some()
    );
    assert!(INTEGER_RANGE_ISSUE.read(&Issue::new("x")).is_none());
    assert!(
        INTEGER_RANGE_ISSUE
            .read(&foreign(code, Some(Value::Null)))
            .is_none()
    );
}

#[test]
fn a_catalog_code_checks_the_parameters_it_issues() {
    let fault = support::fault_of(|| TIME_MIN_ISSUE.issue(Min { min: 86_400_000 })).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/issue-parameters");
    assert_eq!(
        format!("{} {}", fault.sentence, fault.correction),
        "Issue code \"@loomcli/validators/time-min\" rejects the parameters passed to issue(). Supply parameters its code accepts."
    );
}

#[test]
fn a_count_of_1_reads_character() {
    assert_eq!(
        TEXT_MIN_LENGTH_ISSUE.issue(Min { min: 1 }).message,
        "Expected at least 1 character."
    );
    assert_eq!(
        TEXT_MAX_LENGTH_ISSUE.issue(Max { max: 1 }).message,
        "Expected at most 1 character."
    );
    assert_eq!(
        TEXT_EXACT_LENGTH_ISSUE.issue(Length { length: 1 }).message,
        "Expected exactly 1 character."
    );
}

#[test]
fn a_bytes_code_prints_each_count_as_the_bytes_message_states() {
    assert_eq!(
        BYTES_MIN_ISSUE.issue(Min { min: 1_048_576 }).message,
        "Expected a size of at least 1MiB."
    );
    assert_eq!(
        BYTES_MAX_ISSUE.issue(Max { max: 1500 }).message,
        "Expected a size of at most 1500B."
    );
    assert_eq!(
        BYTES_RANGE_ISSUE.issue(Range { max: 1000, min: 0 }).message,
        "Expected a size from 0B through 1kB."
    );
    let two_53 = 1_u64 << 53;
    for (code, params) in [
        (BYTES_MIN_ISSUE.code(), json!({"min": -1})),
        (BYTES_MIN_ISSUE.code(), json!({"min": two_53})),
        (BYTES_MAX_ISSUE.code(), json!({"max": -1})),
        (BYTES_MAX_ISSUE.code(), json!({"max": two_53})),
        (BYTES_RANGE_ISSUE.code(), json!({"max": -1, "min": 0})),
        (BYTES_RANGE_ISSUE.code(), json!({"max": two_53, "min": 0})),
        (BYTES_MIN_ISSUE.code(), json!({"min": 1.5})),
    ] {
        let issue = foreign(code, Some(params));
        assert!(BYTES_MIN_ISSUE.read(&issue).is_none());
        assert!(BYTES_MAX_ISSUE.read(&issue).is_none());
        assert!(BYTES_RANGE_ISSUE.read(&issue).is_none());
    }
}

#[test]
fn a_time_code_prints_each_time_of_day_as_the_time_message_states() {
    assert_eq!(
        TIME_MIN_ISSUE.issue(Min { min: 0 }).message,
        "Expected a time of at least 00:00."
    );
    assert_eq!(
        TIME_MAX_ISSUE.issue(Max { max: 86_399_999 }).message,
        "Expected a time of at most 23:59:59.999."
    );
    assert_eq!(
        TIME_MAX_ISSUE.issue(Max { max: 34_200_010 }).message,
        "Expected a time of at most 09:30:00.01."
    );
    assert_eq!(
        TIME_RANGE_ISSUE
            .issue(Range {
                max: 61_200_000,
                min: 32_401_000
            })
            .message,
        "Expected a time from 09:00:01 through 17:00."
    );
    for (code, params) in [
        (TIME_MIN_ISSUE.code(), json!({"min": -1})),
        (TIME_MIN_ISSUE.code(), json!({"min": 86_400_000})),
        (TIME_MAX_ISSUE.code(), json!({"max": 0.5})),
        (
            TIME_RANGE_ISSUE.code(),
            json!({"max": 86_400_000, "min": 0}),
        ),
    ] {
        let issue = foreign(code, Some(params));
        assert!(TIME_MIN_ISSUE.read(&issue).is_none());
        assert!(TIME_MAX_ISSUE.read(&issue).is_none());
        assert!(TIME_RANGE_ISSUE.read(&issue).is_none());
    }
    for code in [
        DATE_LAYOUTS_ISSUE.code(),
        DATE_TIME_LAYOUTS_ISSUE.code(),
        TIME_LAYOUTS_ISSUE.code(),
    ] {
        let issue = foreign(code, Some(json!({"forms": []})));
        assert!(DATE_LAYOUTS_ISSUE.read(&issue).is_none());
        assert!(DATE_TIME_LAYOUTS_ISSUE.read(&issue).is_none());
        assert!(TIME_LAYOUTS_ISSUE.read(&issue).is_none());
    }
    assert_eq!(
        TIME_LAYOUTS_ISSUE
            .issue(Forms {
                forms: vec!["hh:mm".into(), "hh.mm".into(), "hhmm".into()]
            })
            .message,
        "Expected a time of day as hh:mm, hh.mm, or hhmm, such as 09:30."
    );
}

#[test]
fn a_key_value_code_names_its_separator() {
    let issue = KEY_VALUE_ISSUE.issue(Separator {
        separator: "=>".into(),
    });
    assert_eq!(issue.code.as_deref(), Some("@loomcli/validators/key-value"));
    assert_eq!(issue.message, "Expected a key and a value as key=>value.");
    assert_eq!(issue.params, Some(json!({"separator": "=>"})));
    assert!(
        KEY_VALUE_ISSUE
            .read(&foreign(
                KEY_VALUE_ISSUE.code(),
                Some(json!({"separator": ""}))
            ))
            .is_none()
    );
}

#[test]
fn each_path_kind_reads_its_own_words() {
    for (kind, readable, writable) in [
        (
            PathKind::File,
            "Expected a readable file that exists.",
            "Expected a writable file, or a new file in a writable directory.",
        ),
        (
            PathKind::Directory,
            "Expected a readable directory that exists.",
            "Expected a writable directory, or a new directory in a writable directory.",
        ),
        (
            PathKind::Any,
            "Expected a readable file or directory that exists.",
            "Expected a writable path, or a new path in a writable directory.",
        ),
    ] {
        assert_eq!(PATH_READABLE_ISSUE.issue(Kind { kind }).message, readable);
        assert_eq!(PATH_WRITABLE_ISSUE.issue(Kind { kind }).message, writable);
    }
}

#[test]
fn read_types_the_parameters_a_failure_view_receives() {
    let issues = [
        INTEGER_RANGE_ISSUE.issue(Range { max: 64, min: 1 }),
        Issue::new("Other."),
    ];
    let lines: Vec<String> = issues
        .iter()
        .map(|issue| match INTEGER_RANGE_ISSUE.read(issue) {
            Some(range) => format!("{}-{}", range.min, range.max),
            None => issue.message.clone(),
        })
        .collect();
    assert_eq!(lines, ["1-64", "Other."]);
}

#[test]
fn a_catalog_code_reads_parameters_given_as_an_array_as_none() {
    let code = INTEGER_RANGE_ISSUE.code();
    assert!(
        INTEGER_RANGE_ISSUE
            .read(&foreign(code, Some(json!([64, 1]))))
            .is_none()
    );
    assert!(
        INTEGER_ISSUE
            .read(&foreign(INTEGER_ISSUE.code(), Some(json!([]))))
            .is_none()
    );
}

#[test]
fn a_whole_number_bound_up_to_the_unsigned_range_prints_as_digits() {
    let issue = issue_of(&number().min(0.0).max(1e18), "2e18");
    assert_eq!(
        serde_json::to_string(&issue.params).unwrap(),
        r#"{"max":1000000000000000000,"min":0}"#
    );
    let issue = issue_of(&number().min(0.0).max(1.0e19), "2e19");
    assert_eq!(
        serde_json::to_string(&issue.params).unwrap(),
        r#"{"max":10000000000000000000,"min":0}"#
    );
    assert_eq!(
        support::published(&number().max(1e18)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number","maximum":1000000000000000000}"#
    );
}
