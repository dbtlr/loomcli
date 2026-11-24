//! Ports `time.test.ts`. A time reads as a `jiff::civil::Time`; the reference's milliseconds since
//! midnight are compared through `millis`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use jiff::civil;
use loomcli_validators::{Time, time};
use serde_json::json;
use support::{accepted, conforms, fault_text, published, rejection, time_l, verdict};

const SENTENCE: &str = "Expected a time of day, such as 09:30 or 17:45:30.";

/// The milliseconds since midnight a time stands for, the reference's unit.
fn millis(value: civil::Time) -> i64 {
    ((i64::from(value.hour()) * 60 + i64::from(value.minute())) * 60 + i64::from(value.second()))
        * 1000
        + i64::from(value.subsec_nanosecond()) / 1_000_000
}

fn messages_of(validator: &Time, token: &str) -> Vec<String> {
    rejection(validator, token).0
}

#[test]
fn a_time_of_day_in_the_default_grammar_is_milliseconds_since_midnight() {
    for (token, value) in [
        ("00:00", 0),
        ("09:30", 34_200_000),
        ("17:45:30", 63_930_000),
        ("23:59", 86_340_000),
        ("23:59:59", 86_399_000),
        ("23:59:59.5", 86_399_500),
        ("23:59:59.9999", 86_399_999),
        ("12:00:00.123", 43_200_123),
        ("00:00:00.000999", 0),
        ("08:05:07.04", 29_107_040),
    ] {
        assert_eq!(millis(accepted(&time(), token)), value, "{token}");
        assert!(conforms(&time(), &json!(token)), "{token}");
    }
}

#[test]
fn what_the_default_grammar_does_not_read_is_rejected_with_one_sentence() {
    for token in [
        "",
        "9:30",
        "09:3",
        "0930",
        "09",
        "24:00",
        "24:00:00",
        "23:60",
        "23:59:60",
        "09:30Z",
        "09:30+02:00",
        "09:30:00Z",
        "09:30.5",
        "09:30:00.",
        "09:30:",
        " 09:30",
        "09:30 ",
        "9:30pm",
        "09:30:5",
        "09:3045",
        "\u{661}\u{662}:30",
        "noon",
    ] {
        assert_eq!(
            messages_of(&time(), token),
            vec![SENTENCE.to_owned()],
            "{token:?}"
        );
    }
    assert_eq!(
        published(&time()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]+)?)?$"}"#
    );
}

#[test]
fn a_bounded_time_with_layouts_answers_the_bounds_sentence_alone() {
    assert_eq!(
        messages_of(&time_l(&["%I:%M%p"]).max("17:00"), "6:00pm"),
        vec!["Expected a time of at most 17:00.".to_owned()]
    );
}

#[test]
fn bounds_are_inclusive() {
    let cases: Vec<(Time, &str, i64)> = vec![
        (time().min("09:00").max("17:00"), "09:00", 32_400_000),
        (time().min("09:00").max("17:00"), "17:00", 61_200_000),
        (time().min("09:00").max("17:00"), "12:30:15.25", 45_015_250),
        (time().min("09:00"), "23:59:59.999", 86_399_999),
        (time().max("17:00"), "00:00", 0),
        (
            time().min("09:00:00.5").max("09:00:00.5"),
            "09:00:00.5000",
            32_400_500,
        ),
    ];
    for (validator, token, value) in cases {
        assert_eq!(millis(accepted(&validator, token)), value, "{token}");
    }
}

#[test]
fn a_token_outside_the_bounds_is_rejected_with_the_bounds_sentence() {
    let range = "Expected a time from 09:00 through 17:00.";
    let cases: Vec<(Time, &str, &str)> = vec![
        (time().min("09:00").max("17:00"), "08:59:59.999", range),
        (time().min("09:00").max("17:00"), "17:00:00.001", range),
        (time().min("09:00").max("17:00"), "nope", range),
        (
            time().min("09:00"),
            "08:00",
            "Expected a time of at least 09:00.",
        ),
        (
            time().max("17:00"),
            "18:00",
            "Expected a time of at most 17:00.",
        ),
        (
            time().max("17:00"),
            "24:00",
            "Expected a time of at most 17:00.",
        ),
        (
            time().min("09:00:30"),
            "09:00",
            "Expected a time of at least 09:00:30.",
        ),
        (
            time().min("09:00:00.50"),
            "09:00",
            "Expected a time of at least 09:00:00.5.",
        ),
        (
            time().min("09:00:00.012"),
            "09:00",
            "Expected a time of at least 09:00:00.012.",
        ),
        (
            time().min("00:00:00.0000"),
            "24:00",
            "Expected a time of at least 00:00.",
        ),
        (
            time().max("23:59:59.9999"),
            "9:30",
            "Expected a time of at most 23:59:59.999.",
        ),
    ];
    for (validator, token, message) in cases {
        assert_eq!(
            messages_of(&validator, token),
            vec![message.to_owned()],
            "{token}"
        );
    }
}

#[test]
fn a_bound_outside_the_default_grammar_panics_at_the_call() {
    for (name, bound) in [
        ("min", "9:00"),
        ("max", "24:00"),
        ("min", "09:00Z"),
        ("max", ""),
        ("min", "9am"),
    ] {
        let message = format!(
            "time() {name} is not a time of day. Supply a time of day such as \"09:00\" or \"17:30\"."
        );
        let text = if name == "min" {
            fault_text(|| time().min(bound))
        } else {
            fault_text(|| time().max(bound))
        };
        assert_eq!(text, message, "{name} {bound:?}");
    }
    let fault = support::fault_of(|| time().max("24:00")).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/bound-value");
    assert!(
        fault.message.contains("time().max(\"24:00\")"),
        "{}",
        fault.message
    );
}

#[test]
fn a_min_above_max_panics_and_equal_bounds_are_accepted() {
    assert_eq!(
        fault_text(|| time().max("09:00").min("17:00:30")),
        "time() min 17:00:30 is above max 09:00. Supply a min at or below max."
    );
    assert!(support::fault_of(|| time().max("09:00").min("09:00")).is_none());
    assert_eq!(
        support::fault_of(|| time().min("17:00").max("09:00"))
            .unwrap()
            .identity,
        "@loomcli/validators/bounds-order"
    );
}

#[test]
fn bounds_leave_the_published_pattern_as_it_is() {
    assert_eq!(
        published(&time().min("09:00").max("17:00")),
        published(&time())
    );
}

#[test]
fn time_layouts_read_each_spelling() {
    let twelve = ["%I:%M%p"];
    let cases: Vec<(Vec<&str>, &str, i64)> = vec![
        (twelve.to_vec(), "9:30pm", 77_400_000),
        (twelve.to_vec(), "9:30PM", 77_400_000),
        (twelve.to_vec(), "09:30Pm", 77_400_000),
        (twelve.to_vec(), "9:30aM", 34_200_000),
        (twelve.to_vec(), "12:00AM", 0),
        (twelve.to_vec(), "12:30am", 1_800_000),
        (twelve.to_vec(), "12:00PM", 43_200_000),
        (twelve.to_vec(), "11:59pm", 86_340_000),
        (twelve.to_vec(), "1:5am", 3_900_000),
        (twelve.to_vec(), "09:30", 34_200_000),
        (vec!["%I:%M:%S %p"], "11:59:59 PM", 86_399_000),
        (vec!["%H%M"], "0930", 34_200_000),
        (vec!["%H%M%S"], "093015", 34_215_000),
        (vec!["%H%M%S"], "09305", 34_205_000),
        (vec!["%H.%M.%S"], "9.30.15", 34_215_000),
        (vec!["%Hh%M"], "9h30", 34_200_000),
        (vec!["%H-%M"], "23-59", 86_340_000),
        (vec!["%H%%%M"], "9%30", 34_200_000),
    ];
    for (layouts, token, value) in cases {
        let validator = time_l(&layouts);
        assert_eq!(
            millis(accepted(&validator, token)),
            value,
            "{layouts:?} {token}"
        );
        assert!(conforms(&validator, &json!(token)), "{layouts:?} {token}");
    }
}

#[test]
fn a_token_no_layout_reads_is_rejected_with_every_form() {
    let sentence = "Expected a time of day as hh:mm or hh:mmAM, such as 09:30.".to_owned();
    for token in [
        "13:00PM", "0:30AM", "00:30am", "9:30", "9:60pm", "9:30 pm", "9:30p", "9:30pmZ",
        "9:30a.m.", "930pm",
    ] {
        assert_eq!(
            messages_of(&time_l(&["%I:%M%p"]), token),
            vec![sentence.clone()],
            "{token:?}"
        );
    }
}

#[test]
fn time_layouts_write_their_forms_once_each_in_order() {
    for (layouts, message) in [
        (
            vec!["%H:%M"],
            "Expected a time of day as hh:mm, such as 09:30.",
        ),
        (
            vec!["%I:%M%p", "%H.%M"],
            "Expected a time of day as hh:mm, hh:mmAM, or hh.mm, such as 09:30.",
        ),
        (
            vec!["%I:%M %p", "%H:%M:%S"],
            "Expected a time of day as hh:mm, hh:mm AM, or hh:mm:ss, such as 09:30.",
        ),
    ] {
        assert_eq!(
            messages_of(&time_l(&layouts), "nope"),
            vec![message.to_owned()],
            "{layouts:?}"
        );
    }
    for token in ["930", "09305", "2400"] {
        assert_eq!(
            messages_of(&time_l(&["%H%M"]), token),
            vec!["Expected a time of day as hh:mm or hhmm, such as 09:30.".to_owned()],
            "{token}"
        );
    }
}

#[test]
fn bounds_answer_alone_whatever_the_layouts_and_bound_a_layout_reading() {
    let office = time_l(&["%I:%M%p"]).min("09:00").max("17:00");
    assert_eq!(millis(accepted(&office, "9:00am")), 32_400_000);
    assert_eq!(millis(accepted(&office, "5:00PM")), 61_200_000);
    assert_eq!(
        messages_of(&office, "8:59am"),
        vec!["Expected a time from 09:00 through 17:00.".to_owned()]
    );
    assert_eq!(
        messages_of(&office, "nope"),
        vec!["Expected a time from 09:00 through 17:00.".to_owned()]
    );
    assert_eq!(
        messages_of(&time_l(&["%I:%M%p"]).min("09:00"), "5:00am"),
        vec!["Expected a time of at least 09:00.".to_owned()]
    );
    assert!(verdict(&office, "9:00am").is_ok());
}

#[test]
fn time_layouts_publish_the_default_pattern_then_a_pattern_for_each() {
    assert_eq!(
        published(&time_l(&["%I:%M%p", "%H%M%S", "%H.%M"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"pattern":"^(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]+)?)?$"},{"pattern":"^[0-9]{1,2}:[0-9]{1,2}[AaPp][Mm]$"},{"pattern":"^[0-9]{2}[0-9]{2}[0-9]{1,2}$"},{"pattern":"^[0-9]{1,2}\\.[0-9]{1,2}$"}]}"#
    );
}
