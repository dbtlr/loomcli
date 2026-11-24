//! Ports `layouts.test.ts`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_core::Validator;
use loomcli_validators::{date, date_time, time};
use serde_json::json;
use support::{
    accepted, conforms, context_in, date_l, date_time_l, fault_text, iso, published, rejected_with,
    rejection, time_l, verdict,
};

#[test]
fn date_layouts_read_each_spelling() {
    let cases: Vec<(Vec<&str>, &str, &str)> = vec![
        (vec!["%d/%m/%Y"], "25/09/2026", "2026-09-25"),
        (vec!["%d/%m/%Y"], "25/9/2026", "2026-09-25"),
        (vec!["%d/%m/%Y"], "5/09/2026", "2026-09-05"),
        (vec!["%d/%m/%Y"], "05/9/2026", "2026-09-05"),
        (vec!["%d/%m/%Y"], "29/02/2024", "2024-02-29"),
        (vec!["%d/%m/%Y"], "1/1/0000", "0000-01-01"),
        (vec!["%d/%m/%Y"], "2026-09-25", "2026-09-25"),
        (vec!["%Y%m%d"], "20260304", "2026-03-04"),
        (vec!["%Y%m%d"], "2026034", "2026-03-04"),
        (vec!["%d/%m/%Y", "%m/%d/%Y"], "03/04/2026", "2026-04-03"),
        (vec!["%d/%m/%Y", "%m/%d/%Y"], "03/25/2026", "2026-03-25"),
        (vec!["%m/%d/%Y", "%d/%m/%Y"], "03/04/2026", "2026-03-04"),
        (vec!["%d-%m-%Y"], "25-09-2026", "2026-09-25"),
        (vec!["%Y-%d-%m"], "2026-03-04", "2026-03-04"),
        (vec!["%Y-%d-%m"], "2026-25-09", "2026-09-25"),
        (vec!["%Y%%%m%%%d"], "2026%09%25", "2026-09-25"),
        (vec!["%d.%m.%Y"], "25.09.2026", "2026-09-25"),
        (vec!["(%Y) [%m] {%d}"], "(2026) [09] {25}", "2026-09-25"),
        (vec!["%Y|%m|%d"], "2026|9|25", "2026-09-25"),
        (vec!["%Y+%m*%d?"], "2026+9*25?", "2026-09-25"),
        (vec![r"^%Y$%m\%d"], r"^2026$09\25", "2026-09-25"),
        (vec!["%Y/%m/%d", "%d %m %Y"], "25 09 2026", "2026-09-25"),
        (
            vec!["%Y\u{5e74}%m\u{6708}%d\u{65e5}"],
            "2026\u{5e74}9\u{6708}25\u{65e5}",
            "2026-09-25",
        ),
    ];
    for (layouts, token, value) in cases {
        let validator = date_l(&layouts);
        assert_eq!(accepted(&validator, token), value, "{layouts:?} {token}");
        assert!(conforms(&validator, &json!(token)), "{layouts:?} {token}");
    }
}

#[test]
fn a_date_token_no_layout_reads_is_rejected_with_every_form() {
    let two_forms = "Expected a date as YYYY-MM-DD or DD/MM/YYYY, such as 2026-09-25.";
    for token in [
        "29/02/2026",
        "31/04/2026",
        "25/13/2026",
        "00/09/2026",
        "25/00/2026",
        "025/09/2026",
        "25/09/26",
        "25/09/02026",
        " 25/09/2026",
        "25/09/2026 ",
        "25-09-2026",
        "2026/09/25",
        "25/09/2026T00:00",
        "\u{662}\u{665}/09/2026",
    ] {
        assert_eq!(
            rejection(&date_l(&["%d/%m/%Y"]), token),
            rejected_with(two_forms),
            "{token:?}"
        );
    }
    for (layouts, token) in [
        (vec!["%d.%m.%Y"], "25x09x2026"),
        (vec!["%Y%m%d"], "202634"),
        (vec!["%Y%m%d"], "202613011"),
        (vec!["%Y%%%m%%%d"], "2026%%09%25"),
        (vec!["%d%m%Y"], "1032026"),
    ] {
        let issues = verdict(&date_l(&layouts), token).unwrap_err();
        assert_eq!(issues.len(), 1, "{layouts:?} {token}");
    }
}

#[test]
fn date_layouts_write_their_forms_once_each_in_order() {
    let two_forms = "Expected a date as YYYY-MM-DD or DD/MM/YYYY, such as 2026-09-25.";
    for (layouts, message) in [
        (
            vec!["%Y-%m-%d"],
            "Expected a date as YYYY-MM-DD, such as 2026-09-25.",
        ),
        (
            vec!["%d/%m/%Y", "%Y%m%d"],
            "Expected a date as YYYY-MM-DD, DD/MM/YYYY, or YYYYMMDD, such as 2026-09-25.",
        ),
        (vec!["%d/%m/%Y", "%d/%m/%Y"], two_forms),
        (
            vec!["%d%%%m%%%Y"],
            "Expected a date as YYYY-MM-DD or DD%MM%YYYY, such as 2026-09-25.",
        ),
    ] {
        assert_eq!(
            rejection(&date_l(&layouts), "nope"),
            rejected_with(message),
            "{layouts:?}"
        );
    }
}

#[test]
fn date_layouts_publish_the_date_format_then_a_pattern_for_each() {
    assert_eq!(
        published(&date_l(&["%d/%m/%Y", "%Y%m%d", "%d.%m.%Y", "%Y%%%m-%d"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"date"},{"pattern":"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$"},{"pattern":"^[0-9]{4}[0-9]{2}[0-9]{1,2}$"},{"pattern":"^[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{4}$"},{"pattern":"^[0-9]{4}%[0-9]{1,2}-[0-9]{1,2}$"}]}"#
    );
}

#[test]
fn a_layout_escapes_each_syntax_character_of_a_literal_in_its_pattern() {
    let validator = date_l(&[r"^$\.*+?()[]{}|-%Y%m%d"]);
    assert_eq!(
        published(&validator),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"date"},{"pattern":"^\\^\\$\\\\\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|-[0-9]{4}[0-9]{2}[0-9]{1,2}$"}]}"#
    );
    assert!(conforms(&validator, &json!(r"^$\.*+?()[]{}|-20260925")));
    assert_eq!(
        accepted(&validator, r"^$\.*+?()[]{}|-20260925"),
        "2026-09-25"
    );
}

/// The instant a token reads as, or `None` when the validator rejected it.
fn instant_of(validator: &loomcli_validators::DateTime, token: &str) -> Option<String> {
    verdict(validator, token).ok().map(iso)
}

/// The ISO instant each token reads as in a run on a host in `zone`, or its rejection's messages.
fn read_in(zone: &str, layouts: &[&str], tokens: &[&str]) -> Vec<Result<String, Vec<String>>> {
    let validator = date_time_l(layouts);
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

const STAMP: &str = "%Y%m%dT%H%M%S%z";

#[test]
fn a_date_time_reads_exactly_two_digits_for_a_day_before_an_hour() {
    let validator = date_time_l(&["%Y%m%d%H%M"]).time_zone("UTC");
    assert_eq!(verdict(&validator, "2026092143").unwrap_err().len(), 1);
}

#[test]
fn a_date_time_falls_through_to_the_next_layout_when_an_offset_is_out_of_range() {
    let validator = date_time_l(&["%d/%m/%Y %H:%M%z", "%d/%m/%Y %H:%M-%S"]).time_zone("UTC");
    assert_eq!(
        instant_of(&validator, "25/09/2026 14:30-59").as_deref(),
        Some("2026-09-25T14:30:59.000Z")
    );
}

#[test]
fn date_time_layouts_read_each_offset_spelling() {
    let cases = [
        (vec![STAMP], "20260925T143000Z", "2026-09-25T14:30:00.000Z"),
        (vec![STAMP], "20260925T143000z", "2026-09-25T14:30:00.000Z"),
        (
            vec![STAMP],
            "20260925T143000+0200",
            "2026-09-25T12:30:00.000Z",
        ),
        (
            vec![STAMP],
            "20260925T143000-05:30",
            "2026-09-25T20:00:00.000Z",
        ),
        (
            vec![STAMP],
            "20260925T143000+05",
            "2026-09-25T09:30:00.000Z",
        ),
        (
            vec![STAMP],
            "20260925T143000+23:59",
            "2026-09-24T14:31:00.000Z",
        ),
        (
            vec!["%d/%m/%Y %H:%M %z"],
            "25/9/2026 9:05 +01:00",
            "2026-09-25T08:05:00.000Z",
        ),
        (
            vec!["%d/%m/%Y %H:%M"],
            "2026-09-25T14:30:00Z",
            "2026-09-25T14:30:00.000Z",
        ),
    ];
    for (layouts, token, expected) in cases {
        let validator = date_time_l(&layouts);
        assert_eq!(
            instant_of(&validator, token).as_deref(),
            Some(expected),
            "{layouts:?} {token}"
        );
        assert!(conforms(&validator, &json!(token)), "{token}");
    }
}

#[test]
fn a_layout_without_z_reads_in_the_configured_zone() {
    for (zone, token, expected) in [
        ("UTC", "25/09/2026 14:30", "2026-09-25T14:30:00.000Z"),
        ("Asia/Tokyo", "25/09/2026 14:30", "2026-09-25T05:30:00.000Z"),
        (
            "America/New_York",
            "1/2/2026 9:05",
            "2026-02-01T14:05:00.000Z",
        ),
    ] {
        let validator = date_time_l(&["%d/%m/%Y %H:%M"]).time_zone(zone);
        assert_eq!(
            instant_of(&validator, token).as_deref(),
            Some(expected),
            "{zone}"
        );
        assert!(conforms(&date_time_l(&["%d/%m/%Y %H:%M"]), &json!(token)));
    }
}

#[test]
fn a_layout_without_z_reads_across_a_gap_and_an_overlap_as_the_default_grammar_does() {
    let tokens = [
        "03/08/2026 01:59:00",
        "03/08/2026 02:30:00",
        "03/08/2026 03:00:00",
        "11/01/2026 01:30:00",
        "11/01/2026 02:00:00",
    ];
    let expected: Vec<Result<String, Vec<String>>> = [
        "2026-03-08T06:59:00.000Z",
        "2026-03-08T07:30:00.000Z",
        "2026-03-08T07:00:00.000Z",
        "2026-11-01T05:30:00.000Z",
        "2026-11-01T07:00:00.000Z",
    ]
    .iter()
    .map(|instant| Ok((*instant).to_owned()))
    .collect();
    assert_eq!(
        read_in("America/New_York", &["%m/%d/%Y %H:%M:%S"], &tokens),
        expected
    );
    let iso_tokens: Vec<String> = tokens
        .iter()
        .map(|token| {
            let words: Vec<&str> = token.split(['/', ' ']).collect();
            format!("{}-{}-{}T{}", words[2], words[0], words[1], words[3])
        })
        .collect();
    let iso_refs: Vec<&str> = iso_tokens.iter().map(String::as_str).collect();
    assert_eq!(read_in("America/New_York", &[STAMP], &iso_refs), expected);
}

#[test]
fn a_date_time_token_no_layout_reads_is_rejected_with_every_form() {
    let forms = "Expected a date and time as YYYY-MM-DDThh:mm or YYYYMMDDThhmmss\u{b1}hh:mm, such as 2026-09-25T14:30:00Z.";
    for token in [
        "20260925T143000",
        "20260925t143000Z",
        "20260925T143000+24",
        "20260925T143000+05:60",
        "20260925T143000+5",
        "20260925T143000+05:0",
        "20260925T243000Z",
        "20260925T146000Z",
        "20260925T143060Z",
        "20260229T143000Z",
        "20260925 143000Z",
        "20260925T143000ZZ",
        "20260925T143000UTC",
    ] {
        assert_eq!(
            rejection(&date_time_l(&[STAMP]), token),
            rejected_with(forms),
            "{token:?}"
        );
    }
}

#[test]
fn date_time_layouts_write_their_forms_once_each_in_order() {
    for (layouts, message) in [
        (
            vec!["%d/%m/%Y %H:%M"],
            "Expected a date and time as YYYY-MM-DDThh:mm or DD/MM/YYYY hh:mm, such as 2026-09-25T14:30:00Z.",
        ),
        (
            vec!["%Y-%m-%dT%H:%M"],
            "Expected a date and time as YYYY-MM-DDThh:mm, such as 2026-09-25T14:30:00Z.",
        ),
        (
            vec!["%d/%m/%Y %H:%M", "%d.%m.%Y %H:%M:%S", "%d/%m/%Y %H:%M"],
            "Expected a date and time as YYYY-MM-DDThh:mm, DD/MM/YYYY hh:mm, or DD.MM.YYYY hh:mm:ss, such as 2026-09-25T14:30:00Z.",
        ),
    ] {
        assert_eq!(
            rejection(&date_time_l(&layouts).time_zone("UTC"), "nope"),
            rejected_with(message),
            "{layouts:?}"
        );
    }
}

#[test]
fn date_time_layouts_publish_the_default_pattern_then_a_pattern_for_each() {
    assert_eq!(
        published(&date_time_l(&[STAMP, "%d/%m/%Y %H:%M"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)?$"},{"pattern":"^[0-9]{4}[0-9]{2}[0-9]{1,2}T[0-9]{2}[0-9]{2}[0-9]{1,2}(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)$"},{"pattern":"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4} [0-9]{1,2}:[0-9]{1,2}$"}]}"#
    );
}

const DATE_ONLY: &str = "Use only %Y, %m, and %d, with %% for a percent sign.";
const DATE_TIME_ONLY: &str = "Use only %Y, %m, %d, %H, %M, %S, and %z, with %% for a percent sign.";
const TIME_ONLY: &str = "Use only %H, %I, %M, %S, and %p, with %% for a percent sign.";
const LITERAL_ZONE: &str = "Write %z, which reads Z as UTC and every other offset as that offset.";

#[test]
fn a_layout_the_factory_cannot_read_panics_at_the_call() {
    let cases: Vec<(&str, Box<dyn Fn()>, String)> = vec![
        ("empty date", Box::new(|| { let _ = date().layouts([""]); }), "date() layouts lists an empty layout. Supply a layout such as \"%d/%m/%Y\".".into()),
        ("empty date_time", Box::new(|| { let _ = date_time().layouts(["%d/%m/%Y %H:%M", ""]); }), "date_time() layouts lists an empty layout. Supply a layout such as \"%d/%m/%Y %H:%M\".".into()),
        ("empty time", Box::new(|| { let _ = time().layouts([""]); }), "time() layouts lists an empty layout. Supply a layout such as \"%I:%M%p\".".into()),
        ("%b", Box::new(|| { let _ = date().layouts(["%d/%b/%Y"]); }), format!("date() layout \"%d/%b/%Y\" holds %b, which no layout reads. {DATE_ONLY}")),
        ("%f", Box::new(|| { let _ = date_time().layouts(["%d/%m/%Y %H:%M:%S.%f"]); }), format!("date_time() layout \"%d/%m/%Y %H:%M:%S.%f\" holds %f, which no layout reads. {DATE_TIME_ONLY}")),
        ("%Z", Box::new(|| { let _ = time().layouts(["%H:%M %Z"]); }), format!("time() layout \"%H:%M %Z\" holds %Z, which no layout reads. {TIME_ONLY}")),
        ("%H in date", Box::new(|| { let _ = date().layouts(["%Y-%m-%d %H"]); }), format!("date() layout \"%Y-%m-%d %H\" holds %H, which date() does not read. {DATE_ONLY}")),
        ("%z in date", Box::new(|| { let _ = date().layouts(["%d/%m/%Y%z"]); }), format!("date() layout \"%d/%m/%Y%z\" holds %z, which date() does not read. {DATE_ONLY}")),
        ("%I in date_time", Box::new(|| { let _ = date_time().layouts(["%d/%m/%Y %I:%M%p"]); }), format!("date_time() layout \"%d/%m/%Y %I:%M%p\" holds %I, which date_time() does not read. {DATE_TIME_ONLY}")),
        ("%d in time", Box::new(|| { let _ = time().layouts(["%d %H:%M"]); }), format!("time() layout \"%d %H:%M\" holds %d, which time() does not read. {TIME_ONLY}")),
        ("%z in time", Box::new(|| { let _ = time().layouts(["%H:%M%z"]); }), format!("time() layout \"%H:%M%z\" holds %z, which time() does not read. {TIME_ONLY}")),
        ("lone % date", Box::new(|| { let _ = date().layouts(["%d/%m/%Y%"]); }), "date() layout \"%d/%m/%Y%\" ends with a lone %. Write %% for a percent sign.".into()),
        ("lone % time", Box::new(|| { let _ = time().layouts(["%H:%M %%%"]); }), "time() layout \"%H:%M %%%\" ends with a lone %. Write %% for a percent sign.".into()),
        ("no year", Box::new(|| { let _ = date().layouts(["%d/%m"]); }), "date() layout \"%d/%m\" holds no year. Add %Y.".into()),
        ("no month", Box::new(|| { let _ = date().layouts(["%Y-%d"]); }), "date() layout \"%Y-%d\" holds no month. Add %m.".into()),
        ("no day", Box::new(|| { let _ = date().layouts(["%Y-%m"]); }), "date() layout \"%Y-%m\" holds no day. Add %d.".into()),
        ("escaped percent year", Box::new(|| { let _ = date().layouts(["%%Y-%m-%d"]); }), "date() layout \"%%Y-%m-%d\" holds no year. Add %Y.".into()),
        ("no hour", Box::new(|| { let _ = date_time().layouts(["%d/%m/%Y"]); }), "date_time() layout \"%d/%m/%Y\" holds no hour. Add %H.".into()),
        ("no minute", Box::new(|| { let _ = date_time().layouts(["%d/%m/%Y %H"]); }), "date_time() layout \"%d/%m/%Y %H\" holds no minute. Add %M.".into()),
        ("time no hour", Box::new(|| { let _ = time().layouts(["%M:%S"]); }), "time() layout \"%M:%S\" holds no hour. Add %H, or %I with %p.".into()),
        ("time no minute", Box::new(|| { let _ = time().layouts(["%Hh"]); }), "time() layout \"%Hh\" holds no minute. Add %M.".into()),
        ("day twice", Box::new(|| { let _ = date().layouts(["%d/%m/%Y/%d"]); }), "date() layout \"%d/%m/%Y/%d\" holds the day twice. Write each field once.".into()),
        ("offset twice", Box::new(|| { let _ = date_time().layouts(["%d/%m/%Y %H:%M %z%z"]); }), "date_time() layout \"%d/%m/%Y %H:%M %z%z\" holds the offset twice. Write each field once.".into()),
        ("hour twice", Box::new(|| { let _ = time().layouts(["%H:%M %I%p"]); }), "time() layout \"%H:%M %I%p\" holds the hour twice. Write each field once.".into()),
        ("meridiem twice", Box::new(|| { let _ = time().layouts(["%I:%M%p%p"]); }), "time() layout \"%I:%M%p%p\" holds %p twice. Write each field once.".into()),
        ("year twice", Box::new(|| { let _ = date().layouts(["%Y/%m/%d/%Y"]); }), "date() layout \"%Y/%m/%d/%Y\" holds the year twice. Write each field once.".into()),
        ("month twice", Box::new(|| { let _ = date().layouts(["%m/%d/%Y/%m"]); }), "date() layout \"%m/%d/%Y/%m\" holds the month twice. Write each field once.".into()),
        ("minute twice", Box::new(|| { let _ = time().layouts(["%H:%M:%M"]); }), "time() layout \"%H:%M:%M\" holds the minute twice. Write each field once.".into()),
        ("second twice", Box::new(|| { let _ = time().layouts(["%H:%M:%S:%S"]); }), "time() layout \"%H:%M:%S:%S\" holds the second twice. Write each field once.".into()),
        ("literal Z after fraction", Box::new(|| { let _ = date_time().layouts(["%Y-%m-%dT%H:%M:%S.000Z"]); }), format!("date_time() layout \"%Y-%m-%dT%H:%M:%S.000Z\" holds a literal Z, which would read a UTC time as local time. {LITERAL_ZONE}")),
        ("%I without %p", Box::new(|| { let _ = time().layouts(["%I:%M"]); }), "time() layout \"%I:%M\" holds %I without %p. Add %p, or write %H for an hour from 0 through 23.".into()),
        ("%p without %I", Box::new(|| { let _ = time().layouts(["%H:%M%p"]); }), "time() layout \"%H:%M%p\" holds %p without %I. Write %I for an hour from 1 through 12, or leave out %p.".into()),
        ("literal Z", Box::new(|| { let _ = date_time().layouts(["%Y%m%dT%H%M%SZ"]); }), format!("date_time() layout \"%Y%m%dT%H%M%SZ\" holds a literal Z, which would read a UTC time as local time. {LITERAL_ZONE}")),
        ("literal z", Box::new(|| { let _ = date_time().layouts(["%d/%m/%Y %H:%Mz"]); }), format!("date_time() layout \"%d/%m/%Y %H:%Mz\" holds a literal z, which would read a UTC time as local time. {LITERAL_ZONE}")),
    ];
    for (name, call, message) in cases {
        assert_eq!(fault_text(call), message, "{name}");
    }
}

#[test]
fn a_layout_fault_marks_the_entry_at_fault_under_the_layout_rule() {
    let fault = support::fault_of(|| date().layouts(["%d/%m/%Y", "%d %b %Y"])).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/layout");
    assert!(
        fault.message.contains("date().layouts([\"%d/%m/%Y\", \"%d %b %Y\"])\n                                ^^^^^^^^^^"),
        "{}",
        fault.message
    );
    assert_eq!(
        fault_text(|| date().layouts::<0>([])),
        "date() layouts lists no layout. Supply a layout such as \"%d/%m/%Y\"."
    );
}

#[test]
fn a_layout_its_factory_reads_is_accepted() {
    assert!(support::fault_of(|| date().layouts(["%Y%m%d", "%d %m %Y"])).is_none());
    assert!(support::fault_of(|| date().layouts(["Z%Y%m%dz"])).is_none());
    assert!(support::fault_of(|| date_time().layouts([STAMP])).is_none());
    assert!(support::fault_of(|| time().layouts(["%I:%M:%S%p", "%H%M", "at %H:%M"])).is_none());
    let _ = time_l(&["%H:%M"]);
}
