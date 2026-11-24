//! Ports `date-time.test.ts`. The outside-a-run case has no counterpart: a Rust validator always
//! receives its context. The run case is in `catalog_run.rs`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_core::Validator;
use loomcli_validators::date_time;
use serde_json::json;
use support::{
    accepted, conforms, context_in, fault_text, iso, published, rejected_with, rejection, verdict,
};

const SENTENCE: &str =
    "Expected a date and time, such as 2026-09-25T14:30:00Z or 2026-09-25 14:30.";

fn instant_of(validator: &loomcli_validators::DateTime, token: &str) -> Option<String> {
    verdict(validator, token).ok().map(iso)
}

/// The ISO instant each token reads as in a run on a host in `zone`, or its rejection's messages.
fn read_in(zone: &str, tokens: &[&str], pinned: Option<&str>) -> Vec<Result<String, Vec<String>>> {
    let validator = match pinned {
        Some(pinned) => date_time().time_zone(pinned),
        None => date_time(),
    };
    let context = context_in("/loom-test", zone);
    tokens
        .iter()
        .map(|token| {
            validator
                .validate(token, &context)
                .map(iso)
                .map_err(|issues| issues.into_iter().map(|issue| issue.message).collect())
        })
        .collect()
}

fn instants(values: &[&str]) -> Vec<Result<String, Vec<String>>> {
    values.iter().map(|value| Ok((*value).to_owned())).collect()
}

#[test]
fn a_token_that_names_its_offset_is_that_instant() {
    for (token, expected) in [
        ("2026-09-25T14:30:00Z", "2026-09-25T14:30:00.000Z"),
        ("2026-09-25t14:30:00z", "2026-09-25T14:30:00.000Z"),
        ("2026-09-25 14:30:00Z", "2026-09-25T14:30:00.000Z"),
        ("2026-09-25T14:30Z", "2026-09-25T14:30:00.000Z"),
        ("2026-09-25T14:30:00+02:00", "2026-09-25T12:30:00.000Z"),
        ("2026-09-25 14:30-05:00", "2026-09-25T19:30:00.000Z"),
        ("2026-09-25T14:30:00+0530", "2026-09-25T09:00:00.000Z"),
        ("2026-10-13T14:00:00+05", "2026-10-13T09:00:00.000Z"),
        ("2026-10-13T14:00:00-08", "2026-10-13T22:00:00.000Z"),
        ("2026-10-13T14:00:00+00", "2026-10-13T14:00:00.000Z"),
        ("2026-10-13 14:00+0500", "2026-10-13T09:00:00.000Z"),
        ("2026-10-13 14:00-0430", "2026-10-13T18:30:00.000Z"),
        ("2026-10-13 14:00-04:30", "2026-10-13T18:30:00.000Z"),
        ("2026-09-25T14:30:00.5Z", "2026-09-25T14:30:00.500Z"),
        ("2026-09-25T14:30:00.123Z", "2026-09-25T14:30:00.123Z"),
        ("2026-09-25T14:30:00.123999Z", "2026-09-25T14:30:00.123Z"),
        (
            "2026-09-25T14:30:00.9999999999Z",
            "2026-09-25T14:30:00.999Z",
        ),
        ("2024-02-29T23:59:59Z", "2024-02-29T23:59:59.000Z"),
        ("0000-01-01T00:00:00Z", "0000-01-01T00:00:00.000Z"),
        ("0099-12-31T23:59:59Z", "0099-12-31T23:59:59.000Z"),
        ("2026-01-01T00:00:00+14:00", "2025-12-31T10:00:00.000Z"),
    ] {
        assert_eq!(
            instant_of(&date_time(), token).as_deref(),
            Some(expected),
            "{token}"
        );
        assert!(conforms(&date_time(), &json!(token)), "{token}");
    }
}

#[test]
fn an_instant_beyond_the_range_of_a_timestamp_is_rejected() {
    // The reference reads `9999-12-31T23:59:59.999Z`; `jiff::Timestamp` ends at 9999-12-30T22:00Z.
    assert_eq!(
        instant_of(&date_time(), "9999-12-30T21:59:59.999Z").as_deref(),
        Some("9999-12-30T21:59:59.999Z")
    );
    assert_eq!(
        rejection(&date_time(), "9999-12-31T23:59:59.999Z"),
        rejected_with(SENTENCE)
    );
}

#[test]
fn a_token_that_is_not_a_date_and_time_is_rejected_with_one_sentence() {
    for token in [
        "",
        "2026-09-25",
        "2026-09-25T",
        "2026-09-25T14",
        "2026-09-25T14:3",
        "2026-09-25T24:00:00Z",
        "2026-09-25T14:60:00Z",
        "2026-09-25T14:30:60Z",
        "2026-02-29T10:00:00Z",
        "2026-13-01T10:00:00Z",
        "2026-00-10T10:00:00Z",
        "2026-04-31T10:00:00Z",
        "2026-09-25T14:30:00+24:00",
        "2026-09-25T14:30:00+05:60",
        "2026-09-25T14:30:00+5",
        "2026-09-25T14:30:00+005",
        "2026-09-25T14:30:00+05:0",
        "2026-09-25T14:30:00+05:",
        "2026-09-25T14:30:00+24",
        "2026-09-25T14:30:00+0560",
        "2026-09-25T14:30:00.Z",
        "2026-09-25T14:30.5Z",
        "2026-09-25  14:30:00Z",
        " 2026-09-25T14:30:00Z",
        "2026-09-25T14:30:00Z ",
        "26-09-25T14:30:00Z",
        "20260925T143000Z",
        "2026-09-25T14:30:00 Z",
        "2026-09-25T14:30:00ZZ",
        "2026-09-25T14:30:00UTC",
        "now",
        "now+2h",
        "tomorrow",
    ] {
        // The sentence's own examples may contain a short token, so only the messages are compared.
        let validator = date_time().time_zone("UTC");
        assert_eq!(
            rejection(&validator, token).0,
            vec![SENTENCE.to_owned()],
            "{token:?}"
        );
    }
}

#[test]
fn a_token_with_no_offset_is_read_in_the_pinned_zone() {
    for (zone, token, expected) in [
        ("UTC", "2026-09-25T14:30:00", "2026-09-25T14:30:00.000Z"),
        ("Asia/Tokyo", "2026-09-25 14:30", "2026-09-25T05:30:00.000Z"),
        (
            "America/New_York",
            "2026-09-25T14:30:00",
            "2026-09-25T18:30:00.000Z",
        ),
        (
            "America/New_York",
            "2026-01-15T14:30:00.987654",
            "2026-01-15T19:30:00.987Z",
        ),
        (
            "Asia/Kolkata",
            "2026-09-25T14:30:00",
            "2026-09-25T09:00:00.000Z",
        ),
        (
            "Pacific/Chatham",
            "2026-01-15T14:30:00",
            "2026-01-15T00:45:00.000Z",
        ),
        ("UTC", "0001-01-01T00:00:00", "0001-01-01T00:00:00.000Z"),
    ] {
        assert_eq!(
            instant_of(&date_time().time_zone(zone), token).as_deref(),
            Some(expected),
            "{zone} {token}"
        );
    }
    assert_eq!(
        instant_of(&date_time().time_zone("Asia/Tokyo"), "2026-09-25T14:30:00Z").as_deref(),
        Some("2026-09-25T14:30:00.000Z")
    );
}

#[test]
fn a_token_with_no_offset_in_a_run_is_read_in_the_host_time_zone() {
    assert_eq!(
        read_in("America/New_York", &["2026-09-25T14:30:00"], None),
        instants(&["2026-09-25T18:30:00.000Z"])
    );
    assert_eq!(
        read_in("Asia/Tokyo", &["2026-09-25T14:30:00"], None),
        instants(&["2026-09-25T05:30:00.000Z"])
    );
    assert_eq!(
        read_in(
            "Asia/Tokyo",
            &["2026-09-25T14:30:00"],
            Some("America/New_York")
        ),
        instants(&["2026-09-25T18:30:00.000Z"])
    );
    // A test reads it in the mock time zone with a context built over a mock process.
    let context = context_in("/loom-test", "Europe/Paris");
    let read = date_time().validate("2026-06-01 09:00", &context).unwrap();
    assert_eq!(iso(read), "2026-06-01T07:00:00.000Z");
    assert_eq!(
        read_in("Asia/Tokyo", &["2026-09-25T14:30:00+02:00"], None),
        instants(&["2026-09-25T12:30:00.000Z"])
    );
}

#[test]
fn a_time_in_a_gap_resolves_forward_and_an_overlap_to_the_earlier_instant() {
    assert_eq!(
        read_in(
            "America/New_York",
            &[
                "2026-03-08T01:59:00",
                "2026-03-08T02:00:00",
                "2026-03-08T02:30:00",
                "2026-03-08T02:59:59",
                "2026-03-08T03:00:00",
                "2026-11-01T00:59:00",
                "2026-11-01T01:00:00",
                "2026-11-01T01:30:00",
                "2026-11-01T01:59:59",
                "2026-11-01T02:00:00",
            ],
            None
        ),
        instants(&[
            "2026-03-08T06:59:00.000Z",
            "2026-03-08T07:00:00.000Z",
            "2026-03-08T07:30:00.000Z",
            "2026-03-08T07:59:59.000Z",
            "2026-03-08T07:00:00.000Z",
            "2026-11-01T04:59:00.000Z",
            "2026-11-01T05:00:00.000Z",
            "2026-11-01T05:30:00.000Z",
            "2026-11-01T05:59:59.000Z",
            "2026-11-01T07:00:00.000Z",
        ])
    );
    assert_eq!(
        read_in(
            "Australia/Sydney",
            &["2026-10-04T02:30:00", "2026-04-05T02:30:00"],
            None
        ),
        instants(&["2026-10-03T16:30:00.000Z", "2026-04-04T15:30:00.000Z"])
    );
    assert_eq!(
        read_in(
            "Europe/London",
            &["2026-03-29T01:30:00", "2026-10-25T01:30:00"],
            None
        ),
        instants(&["2026-03-29T01:30:00.000Z", "2026-10-25T00:30:00.000Z"])
    );
}

#[test]
fn a_bad_token_is_rejected_with_the_sentence_and_without_the_token() {
    assert_eq!(
        read_in("UTC", &["2026-02-30T10:00:00"], None),
        vec![Err(vec![SENTENCE.to_owned()])]
    );
}

#[test]
fn the_host_zone_is_read_only_for_a_token_with_no_offset_and_no_pinned_zone() {
    assert_eq!(
        iso(accepted(&date_time(), "2026-09-25T14:30:00Z")),
        "2026-09-25T14:30:00.000Z"
    );
}

#[test]
fn a_time_zone_the_database_does_not_know_panics_at_the_call() {
    for zone in ["Mars/Olympus", "", "America/Nowhere", "not a zone"] {
        assert_eq!(
            fault_text(|| date_time().time_zone(zone)),
            "date_time() time_zone is not an IANA time zone name. Supply a name such as America/New_York.",
            "{zone:?}"
        );
    }
    let fault = support::fault_of(|| date_time().time_zone("Mars/Olympus")).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/time-zone");
}

#[test]
fn the_published_schema_admits_both_forms_through_a_pattern_never_format_date_time() {
    let schema = r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)?$"}"#;
    assert_eq!(published(&date_time()), schema);
    assert_eq!(published(&date_time().time_zone("Asia/Tokyo")), schema);
    for token in [
        "2026-09-25T14:30",
        "2026-09-25 14:30:00",
        "2026-09-25T14:30:00.5",
        "2026-09-25T14:30:00Z",
        "2026-09-25t14:30:00z",
        "2026-09-25T14:30:00-0500",
        "2026-09-25T14:30:00+05:30",
        "2026-09-25T14:30:00+05",
        "2026-09-25T14:30:00-08",
        "2026-09-25T14:30:00+0530",
    ] {
        assert!(conforms(&date_time(), &json!(token)), "{token}");
        assert!(
            instant_of(&date_time().time_zone("UTC"), token).is_some(),
            "{token}"
        );
    }
}
