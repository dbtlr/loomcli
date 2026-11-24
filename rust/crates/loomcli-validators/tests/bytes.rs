//! Ports `bytes.test.ts`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::bytes;
use serde_json::json;
use support::{accepted, conforms, fault_text, published, rejected_with, rejection};

const SENTENCE: &str = "Expected a size, such as 512KiB, 10MB, or 1.5GB.";

#[test]
fn a_size_token_reads_as_a_whole_number_of_bytes() {
    let no_break_space = "\u{a0}";
    let byte_order_mark = "\u{feff}";
    let em_space = "\u{2003}";
    let cases: Vec<(String, u64)> = vec![
        ("512".into(), 512),
        ("0".into(), 0),
        ("007".into(), 7),
        ("0B".into(), 0),
        ("1B".into(), 1),
        ("1.000B".into(), 1),
        ("1kB".into(), 1000),
        ("1KB".into(), 1000),
        ("10MB".into(), 10_000_000),
        ("1.5GB".into(), 1_500_000_000),
        ("1.5 GB".into(), 1_500_000_000),
        ("2.01kB".into(), 2010),
        ("0.001kB".into(), 1),
        ("1TB".into(), 1_000_000_000_000),
        ("1PB".into(), 1_000_000_000_000_000),
        ("1KiB".into(), 1024),
        ("1Ki".into(), 1024),
        (".5KiB".into(), 512),
        ("0.5KiB".into(), 512),
        ("1.KiB".into(), 1024),
        ("1.25KiB".into(), 1280),
        ("512Mi".into(), 536_870_912),
        ("512MiB".into(), 536_870_912),
        ("1GiB".into(), 1_073_741_824),
        ("1Gi".into(), 1_073_741_824),
        ("1TiB".into(), 1_099_511_627_776),
        ("1Ti".into(), 1_099_511_627_776),
        ("1PiB".into(), 1_125_899_906_842_624),
        ("1Pi".into(), 1_125_899_906_842_624),
        ("7PiB".into(), 7_881_299_347_898_368),
        ("9007199254740991".into(), 9_007_199_254_740_991),
        (" 10MB ".into(), 10_000_000),
        ("10 MB".into(), 10_000_000),
        ("10\tMB".into(), 10_000_000),
        ("\n10MB\r\n".into(), 10_000_000),
        (format!("{no_break_space}10MB{no_break_space}"), 10_000_000),
        (format!("{byte_order_mark}10MB"), 10_000_000),
        (format!("10 {em_space} MB"), 10_000_000),
    ];
    for (token, count) in cases {
        assert_eq!(accepted(&bytes(), &token), count, "{token:?}");
        assert!(conforms(&bytes(), &json!(token)), "{token:?}");
    }
}

#[test]
fn a_token_that_is_not_a_size_is_rejected_with_one_sentence_that_never_repeats_it() {
    let mut tokens: Vec<String> = [
        "",
        "abc",
        "10K",
        "10k",
        "10G",
        "1kiB",
        "1KIB",
        "1mb",
        "1Mb",
        "1kb",
        "1gB",
        "1b",
        "1iB",
        "1Bi",
        "1EB",
        "1EiB",
        "1GB 500MB",
        "1GB500MB",
        "1 0MB",
        "-1",
        "+1",
        "-1MB",
        "2.5B",
        "0.1KiB",
        "0.0001kB",
        "8PiB",
        "9PiB",
        "9007199254740992",
        "1e3",
        "1_000",
        "1,5GB",
        ".MB",
        "1..5MB",
        "1.5.2MB",
        "1 kB B",
        "1 B B",
        "0x10",
        "\u{ff11}MB",
        "10MB\nx",
        "1.5B",
    ]
    .iter()
    .map(|token| (*token).to_owned())
    .collect();
    tokens.push("9".repeat(400));
    for token in tokens {
        assert_eq!(
            rejection(&bytes(), &token),
            rejected_with(SENTENCE),
            "{token:?}"
        );
    }
    // A token the sentence's own examples contain is rejected with the same sentence.
    for token in [" ", ".", ".5", "B", "KiB", "MB", "10M", "1.5"] {
        assert_eq!(
            rejection(&bytes(), token).0,
            vec![SENTENCE.to_owned()],
            "{token:?}"
        );
    }
}

#[test]
fn the_bounds_are_inclusive_in_any_spelling() {
    let validator = bytes().min("1MB").max("10GiB");
    for (token, count) in [
        ("1MB", 1_000_000),
        ("1000kB", 1_000_000),
        ("1000000", 1_000_000),
        ("10GiB", 10_737_418_240),
        ("10240Mi", 10_737_418_240),
    ] {
        assert_eq!(accepted(&validator, token), count, "{token}");
    }
    let range = rejected_with("Expected a size from 1MB through 10GiB.");
    for token in ["999999", "10737418241", "11GiB", "abc", "10M"] {
        assert_eq!(rejection(&validator, token), range, "{token}");
    }
    assert_eq!(
        rejection(&bytes().min("1MB"), "1kB"),
        rejected_with("Expected a size of at least 1MB.")
    );
    assert_eq!(
        rejection(&bytes().max("10GiB"), "11GiB"),
        rejected_with("Expected a size of at most 10GiB.")
    );
    assert_eq!(accepted(&bytes().min("0"), "0"), 0);
}

#[test]
fn a_bound_prints_as_the_whole_number_spelling_with_the_fewest_digits() {
    for (bound, printed) in [
        ("1048576", "1MiB"),
        ("1MiB", "1MiB"),
        ("1000000", "1MB"),
        ("1000", "1kB"),
        ("1KB", "1kB"),
        ("1500", "1500B"),
        ("1.5KiB", "1536B"),
        ("2KiB", "2KiB"),
        ("1024000", "1024kB"),
        ("1000KiB", "1024kB"),
        ("1.5GB", "1500MB"),
        ("7PiB", "7PiB"),
        ("1PB", "1PB"),
        ("9007199254740991", "9007199254740991B"),
    ] {
        assert_eq!(
            rejection(&bytes().max(bound), "8PiB"),
            rejected_with(&format!("Expected a size of at most {printed}.")),
            "{bound}"
        );
    }
    assert_eq!(
        rejection(&bytes().max("0KiB"), "1"),
        rejected_with("Expected a size of at most 0B.")
    );
}

#[test]
fn a_bound_the_grammar_rejects_panics_at_the_call() {
    for (bound, name) in [
        ("10M", "min"),
        ("1.5B", "min"),
        ("9PiB", "max"),
        ("8PiB", "max"),
        ("abc", "min"),
        ("", "max"),
        ("-1", "min"),
        ("1kiB", "max"),
        ("1GB 500MB", "max"),
    ] {
        let text = if name == "min" {
            fault_text(|| bytes().min(bound))
        } else {
            fault_text(|| bytes().max(bound))
        };
        assert_eq!(
            text,
            format!("bytes() {name} is not a size. Supply a size such as \"1MB\" or \"10GiB\"."),
            "{name} {bound:?}"
        );
    }
    assert_eq!(
        fault_text(|| bytes().max("1MB").min("10GiB")),
        "bytes() min 10GiB is above max 1MB. Supply a min at or below max."
    );
    assert!(support::fault_of(|| bytes().max("1000kB").min("1MB")).is_none());
    let fault = support::fault_of(|| bytes().max("10M")).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/bound-value");
    assert!(
        fault.message.contains("bytes().max(\"10M\")\n"),
        "{}",
        fault.message
    );
}

#[test]
fn the_published_schema_is_a_pattern_for_the_grammar_with_or_without_bounds() {
    let number = r"(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)";
    let unit = "(?:KiB|MiB|GiB|TiB|PiB|Ki|Mi|Gi|Ti|Pi|[kK]B|MB|GB|TB|PB|B)";
    let pattern = format!(r"^\s*{number}\s*{unit}?\s*$");
    let expected = serde_json::to_string(&json!({ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "string", "pattern": pattern })).unwrap();
    assert_eq!(published(&bytes()), expected);
    assert_eq!(published(&bytes().min("1MB").max("10GiB")), expected);
    for token in ["", "10M", "1kiB", "1mb", "-1", "1GB 500MB", "abc", "1e3"] {
        assert!(!conforms(&bytes(), &json!(token)), "refuses {token:?}");
    }
}
