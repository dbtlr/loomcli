//! Ports `duration.test.ts`. A duration reads as a `std::time::Duration`; the reference's
//! milliseconds are compared through `nanos`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::{Duration, duration};
use serde_json::json;
use support::{accepted, conforms, fault_text, published, rejection, verdict};

const SENTENCE: &str = "Expected a duration, such as 90s, 2h30m, or 1.5h.";
const CAPITAL_M: &str = "Expected a duration; write minutes as m or min, because M is ambiguous.";

const SECOND: u128 = 1000;
const MINUTE: u128 = 60 * SECOND;
const HOUR: u128 = 60 * MINUTE;
const DAY: u128 = 24 * HOUR;
const WEEK: u128 = 7 * DAY;

/// Nanoseconds in a count of milliseconds, which may hold half a millisecond.
fn nanos(milliseconds: f64) -> u128 {
    (milliseconds * 1e6).round() as u128
}

fn messages_of(validator: &Duration, token: &str) -> Vec<String> {
    rejection(validator, token).0
}

fn reads(validator: &Duration, token: &str) -> u128 {
    accepted(validator, token).as_nanos()
}

#[test]
fn a_duration_token_is_milliseconds() {
    let cases: [(&str, f64); 23] = [
        ("90s", 90_000.0),
        ("2h30m", 9_000_000.0),
        ("1.5h", 5_400_000.0),
        ("7d", 604_800_000.0),
        ("1w", 604_800_000.0),
        ("500ms", 500.0),
        ("0s", 0.0),
        ("0", 0.0),
        ("30", 30_000.0),
        ("1.5", 1500.0),
        (".5", 500.0),
        (".5s", 500.0),
        ("1.s", 1000.0),
        ("0.1s", 100.0),
        ("1.1s", 1100.0),
        ("2.3h", 8_280_000.0),
        ("0.5ms", 0.5),
        ("30m2h", 9_000_000.0),
        ("1h1h", 7_200_000.0),
        ("1m1s1ms", 61_001.0),
        ("1w2d3h4m5s6ms", 788_645_006.0),
        ("0001s", 1000.0),
        ("007", 7000.0),
    ];
    for (token, milliseconds) in cases {
        assert_eq!(reads(&duration(), token), nanos(milliseconds), "{token}");
        assert!(conforms(&duration(), &json!(token)), "{token}");
    }
}

#[test]
fn systemd_spellings_and_spacing() {
    let cases: [(&str, u128); 29] = [
        ("250msec", 250),
        ("5 sec", 5 * SECOND),
        ("90 sec", 90 * SECOND),
        ("1 second", SECOND),
        ("2 seconds", 2 * SECOND),
        ("3min", 3 * MINUTE),
        ("3 minute", 3 * MINUTE),
        ("4 minutes", 4 * MINUTE),
        ("1hr", HOUR),
        ("1 hour", HOUR),
        ("2 hours", 2 * HOUR),
        ("2hr", 2 * HOUR),
        ("1day", DAY),
        ("1 day", DAY),
        ("3 days", 3 * DAY),
        ("1week", WEEK),
        ("2 weeks", 2 * WEEK),
        ("1h 30m", HOUR + 30 * MINUTE),
        ("1 hour 30 min", HOUR + 30 * MINUTE),
        ("1h  30m", HOUR + 30 * MINUTE),
        ("1.5 hours", HOUR + 30 * MINUTE),
        ("30m 2h", 2 * HOUR + 30 * MINUTE),
        ("1 d 2 h", DAY + 2 * HOUR),
        ("1 \t h", HOUR),
        (" 1h", HOUR),
        ("1h ", HOUR),
        ("  1 hour 30 min  ", HOUR + 30 * MINUTE),
        (" 30 ", 30 * SECOND),
        ("1 ms", 1),
    ];
    for (token, milliseconds) in cases {
        assert_eq!(
            reads(&duration(), token),
            milliseconds * 1_000_000,
            "{token:?}"
        );
        assert!(conforms(&duration(), &json!(token)), "{token:?}");
    }
}

#[test]
fn a_capital_m_is_rejected_as_ambiguous_naming_m_and_min() {
    for token in ["5M", "1 M", "1h 5M", "2h30M", " 5M ", "1.5M"] {
        assert_eq!(
            messages_of(&duration(), token),
            vec![CAPITAL_M.to_owned()],
            "{token:?}"
        );
        assert_eq!(
            messages_of(&duration().min("1s").max("1h"), token),
            vec![CAPITAL_M.to_owned()],
            "{token:?}"
        );
    }
    for token in ["M", "5Ms", "5MS", "5 Min", "5Month", "5M5", "5M x"] {
        assert_eq!(
            messages_of(&duration(), token),
            vec![SENTENCE.to_owned()],
            "{token:?}"
        );
    }
}

#[test]
fn a_token_that_is_not_a_duration_is_rejected_with_one_sentence() {
    let long = "9".repeat(400);
    let mut tokens: Vec<&str> = vec![
        "",
        "-1s",
        "+1s",
        "1 2h",
        "1h 30",
        "1 h 30",
        "1h, 30m",
        "1h and 30m",
        "5 mon",
        "1 month",
        "2 months",
        "1 year",
        "2 years",
        "1 y",
        "1 Hour",
        "1 Day",
        "1 Sec",
        "1 hours30",
        "1 hr.",
        "5 minuts",
        "- 1s",
        "1H",
        "1S",
        "1MS",
        "2x",
        "h",
        "s",
        ".",
        "1.5.2s",
        "1h30",
        "1h30m5",
        "abc",
        "1e3s",
        "1_0s",
        "1,5h",
        "PT1H",
        "1mo",
        "1y",
        "1month",
        "1year",
        "1\u{b5}s",
        "1ns",
        "9999999999999999999w",
    ];
    tokens.push(&long);
    for token in tokens {
        assert_eq!(
            messages_of(&duration(), token),
            vec![SENTENCE.to_owned()],
            "{token:?}"
        );
    }
}

#[test]
fn the_bounds_are_inclusive_and_read_in_the_grammar() {
    let validator = duration().min("30").max("24h");
    for (token, milliseconds) in [
        ("30", 30 * SECOND),
        ("30s", 30 * SECOND),
        ("1h", HOUR),
        ("24h", DAY),
        ("1d", DAY),
    ] {
        assert_eq!(
            reads(&validator, token),
            milliseconds * 1_000_000,
            "{token}"
        );
    }
    let long = duration().min("30 seconds").max("1 day");
    assert_eq!(reads(&long, "30s"), 30 * SECOND * 1_000_000);
    assert_eq!(reads(&long, "24 hours"), DAY * 1_000_000);
    let range = vec!["Expected a duration from 30s through 1d.".to_owned()];
    assert_eq!(messages_of(&long, "29 sec"), range);
    assert_eq!(messages_of(&long, "1 day 1 ms"), range);
    assert_eq!(
        reads(&duration().max("1 hour 30 min"), "90m"),
        90 * MINUTE * 1_000_000
    );
    for token in ["29s", "29999ms", "24h1ms", "25h", "abc"] {
        assert_eq!(messages_of(&validator, token), range, "{token}");
    }
    assert_eq!(
        messages_of(&duration().min("1h30m"), "1h"),
        vec!["Expected a duration of at least 1h30m.".to_owned()]
    );
    assert_eq!(
        messages_of(&duration().max("250ms"), "1s"),
        vec!["Expected a duration of at most 250ms.".to_owned()]
    );
    assert_eq!(reads(&duration().min("0"), "0"), 0);
    let unordered = duration().min("30m2h");
    assert_eq!(
        reads(&unordered, "2h30m"),
        (2 * HOUR + 30 * MINUTE) * 1_000_000
    );
    assert!(verdict(&unordered, "2h29m").is_err());
}

#[test]
fn a_bound_outside_the_grammar_panics_at_the_call() {
    let long = "9".repeat(400);
    let cases: Vec<(&str, &str)> = vec![
        ("abc", "min"),
        ("", "min"),
        ("-1s", "min"),
        ("1 H", "min"),
        ("1H", "min"),
        ("5M", "min"),
        ("1 month", "max"),
        (&long, "min"),
        ("abc", "max"),
        ("1h30", "max"),
    ];
    for (bound, name) in cases {
        let text = if name == "min" {
            fault_text(|| duration().min(bound))
        } else {
            fault_text(|| duration().max(bound))
        };
        assert_eq!(
            text,
            format!(
                "duration() {name} is not a duration. Supply a duration such as \"30s\" or \"2h30m\"."
            ),
            "{name} {bound:?}"
        );
    }
    assert_eq!(
        fault_text(|| duration().max("30s").min("1h")),
        "duration() min 1h is above max 30s. Supply a min at or below max."
    );
    assert!(support::fault_of(|| duration().max("1h").min("1h")).is_none());
    let fault = support::fault_of(|| duration().min("abc")).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/bound-value");
}

#[test]
fn the_published_schema_is_a_pattern_for_the_grammar_with_or_without_bounds() {
    let number = r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)";
    let unit = "(?:minutes|seconds|minute|second|hours|weeks|days|hour|msec|week|day|min|sec|hr|ms|d|h|m|s|w)";
    let pattern = format!(r"^\s*{number}(?:\s*{unit}(?:\s*{number}\s*{unit})*)?\s*$");
    let expected = serde_json::to_string(&json!({ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "string", "pattern": pattern })).unwrap();
    assert_eq!(published(&duration()), expected);
    assert_eq!(published(&duration().min("30").max("24h")), expected);
    for token in [
        "30",
        ".5",
        "1.",
        "90s",
        "1ms",
        "1m1s",
        "2h30m",
        "1w2d3h4m5s6ms",
        "1 hour 30 min",
        " 2 weeks ",
        "250msec",
    ] {
        assert!(conforms(&duration(), &json!(token)), "admits {token:?}");
    }
    for token in [
        "",
        "-1s",
        "1H",
        "1h30",
        "s",
        "1y",
        "1 month",
        "5M",
        "1 2h",
        "1h and 30m",
    ] {
        assert!(!conforms(&duration(), &json!(token)), "refuses {token:?}");
    }
}
