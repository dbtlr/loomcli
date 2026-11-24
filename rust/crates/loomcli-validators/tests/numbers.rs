//! Ports `numbers.test.ts` and `one-of.test.ts`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::{integer, number, one_of, port};
use serde_json::json;
use support::{accepted, conforms, fault_text, published, rejected_with, rejection};

#[test]
fn integer_accepts_each_whole_number_spelling() {
    let cases: Vec<(&str, loomcli_validators::Integer, &str, i64)> = vec![
        ("zero", integer(), "0", 0),
        ("a positive number", integer(), "42", 42),
        ("a negative number", integer(), "-5", -5),
        ("negative zero reads as zero", integer(), "-0", 0),
        ("leading zeros", integer(), "007", 7),
        (
            "a negative number with leading zeros",
            integer(),
            "-007",
            -7,
        ),
        (
            "the largest safe integer",
            integer(),
            "9007199254740991",
            9_007_199_254_740_991,
        ),
        (
            "the smallest safe integer",
            integer(),
            "-9007199254740991",
            -9_007_199_254_740_991,
        ),
        (
            "the largest safe integer with leading zeros",
            integer(),
            "0009007199254740991",
            9_007_199_254_740_991,
        ),
        ("the lower bound", integer().min(1).max(10), "1", 1),
        ("the upper bound", integer().min(1).max(10), "10", 10),
        (
            "a bound with a leading zero",
            integer().min(1).max(10),
            "01",
            1,
        ),
        ("a negative lower bound", integer().min(-5), "-5", -5),
        (
            "negative zero at a lower bound of zero",
            integer().min(0),
            "-0",
            0,
        ),
    ];
    for (name, validator, token, value) in cases {
        assert_eq!(accepted(&validator, token), value, "{name}");
        assert!(conforms(&validator, &json!(value)), "{name}");
    }
}

#[test]
fn integer_rejects_everything_else_with_the_one_sentence() {
    for token in [
        "abc",
        "",
        " 1",
        "1 ",
        "+1",
        "1_000",
        "3.0",
        "1e3",
        "0x10",
        "0o7",
        "0b1",
        "9007199254740992",
        "-9007199254740992",
        "\u{661}\u{662}",
        "--1",
        "-",
    ] {
        assert_eq!(
            rejection(&integer(), token),
            rejected_with("Expected a whole number."),
            "{token:?}"
        );
    }
    for token in ["1", "10", "-3", "abc"] {
        assert_eq!(
            rejection(&integer().min(2).max(9), token),
            rejected_with("Expected a whole number from 2 through 9."),
            "{token:?}"
        );
    }
    assert_eq!(
        rejection(&integer().min(1), "0"),
        rejected_with("Expected a whole number of at least 1.")
    );
    assert_eq!(
        rejection(&integer().max(10), "11"),
        rejected_with("Expected a whole number of at most 10.")
    );
}

#[test]
fn integer_publishes_the_type_and_each_bound() {
    assert_eq!(
        published(&integer()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer"}"#
    );
    assert_eq!(
        published(&integer().min(1).max(10)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":1,"maximum":10}"#
    );
}

#[test]
fn integer_panics_at_the_call_for_min_above_max() {
    assert_eq!(
        fault_text(|| integer().max(1).min(5)),
        "integer() min 5 is above max 1. Supply a min at or below max."
    );
    let fault = support::fault_of(|| integer().max(1).min(5)).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/bounds-order");
    assert!(
        fault.message.contains("integer().min(5)"),
        "{}",
        fault.message
    );
}

#[test]
fn number_accepts_each_decimal_spelling() {
    let cases: Vec<(&str, loomcli_validators::Number, &str, f64)> = vec![
        ("a whole number", number(), "1", 1.0),
        ("a negative fraction", number(), "-2.5", -2.5),
        ("a fraction below one", number(), "0.5", 0.5),
        ("an exponent", number(), "1e3", 1000.0),
        ("an uppercase exponent", number(), "1E3", 1000.0),
        ("a negative exponent", number(), "1e-3", 0.001),
        ("a signed exponent", number(), "1e+3", 1000.0),
        ("negative zero reads as zero", number(), "-0", 0.0),
        (
            "negative zero with a fraction reads as zero",
            number(),
            "-0.0",
            0.0,
        ),
        ("leading zeros", number(), "007.5", 7.5),
        (
            "the largest finite number",
            number(),
            "1.7976931348623157e308",
            f64::MAX,
        ),
        ("the smallest positive number", number(), "5e-324", 5e-324),
        (
            "beyond the safe integers",
            number(),
            "9007199254740993",
            9_007_199_254_740_992.0,
        ),
        ("the lower bound", number().min(0.0).max(1.0), "0", 0.0),
        ("the upper bound", number().min(0.0).max(1.0), "1", 1.0),
        (
            "a value inside the bounds",
            number().min(0.0).max(1.0),
            "0.5",
            0.5,
        ),
        (
            "negative zero at a lower bound of zero",
            number().min(0.0).max(1.0),
            "-0",
            0.0,
        ),
    ];
    for (name, validator, token, value) in cases {
        let read = accepted(&validator, token);
        assert_eq!(read, value, "{name}");
        assert!(
            !(read == 0.0 && read.is_sign_negative()),
            "{name} is not negative zero"
        );
        assert!(conforms(&validator, &json!(read)), "{name}");
    }
}

#[test]
fn number_rejects_everything_else_with_the_one_sentence() {
    for token in [
        ".5",
        "5.",
        "Infinity",
        "-Infinity",
        "NaN",
        " 1",
        "1 ",
        "+1",
        "1_0",
        "0x1",
        "",
        "1e",
        "e3",
        "1e999",
        "-",
    ] {
        assert_eq!(
            rejection(&number(), token),
            rejected_with("Expected a number."),
            "{token:?}"
        );
    }
    for token in ["2", "-0.5", "1.5"] {
        assert_eq!(
            rejection(&number().min(0.0).max(1.0), token),
            rejected_with("Expected a number from 0 through 1."),
            "{token:?}"
        );
    }
    assert_eq!(
        rejection(&number().min(0.0), "-3"),
        rejected_with("Expected a number of at least 0.")
    );
    assert_eq!(
        rejection(&number().max(1.0), "2"),
        rejected_with("Expected a number of at most 1.")
    );
    assert_eq!(
        rejection(&number().min(0.5), "0.25"),
        rejected_with("Expected a number of at least 0.5.")
    );
    assert_eq!(
        rejection(&number().max(1e21), "2e21"),
        rejected_with("Expected a number of at most 1e+21.")
    );
}

#[test]
fn number_publishes_the_type_and_each_bound() {
    assert_eq!(
        published(&number()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number"}"#
    );
    assert_eq!(
        published(&number().min(0.0).max(1.0)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number","minimum":0,"maximum":1}"#
    );
    assert_eq!(
        published(&number().min(0.5)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number","minimum":0.5}"#
    );
}

#[test]
fn number_panics_at_the_call_for_a_bad_bound() {
    assert_eq!(
        fault_text(|| number().max(f64::INFINITY)),
        "number() max is not a finite number. Supply a finite number."
    );
    assert_eq!(
        fault_text(|| number().min(f64::NAN)),
        "number() min is not a finite number. Supply a finite number."
    );
    assert_eq!(
        fault_text(|| number().max(0.0).min(1.0)),
        "number() min 1 is above max 0. Supply a min at or below max."
    );
    let fault = support::fault_of(|| number().min(f64::NEG_INFINITY)).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/bound-value");
}

#[test]
fn port_accepts_1_through_65535() {
    for (token, value) in [
        ("1", 1u16),
        ("65535", 65_535),
        ("8080", 8080),
        ("08080", 8080),
    ] {
        assert_eq!(accepted(&port(), token), value);
        assert!(conforms(&port(), &json!(value)));
    }
    for token in ["0", "65536", "-1", "abc", "80.0", ""] {
        assert_eq!(
            rejection(&port(), token),
            rejected_with("Expected a port number from 1 through 65535."),
            "{token:?}"
        );
    }
    assert_eq!(
        published(&port()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":1,"maximum":65535}"#
    );
}

#[test]
fn one_of_accepts_each_declared_value_and_nothing_else() {
    let metric = one_of(["bytes", "words", "lines"]);
    for token in ["bytes", "words", "lines"] {
        assert_eq!(accepted(&metric, token), token);
        assert!(conforms(&metric, &json!(token)));
    }
    assert_eq!(accepted(&one_of(["only"]), "only"), "only");
    for token in ["Bytes", "BYTES", "", "chars", "bytes "] {
        assert_eq!(
            rejection(&metric, token),
            rejected_with("Expected one of: bytes, words, lines."),
            "{token:?}"
        );
    }
    assert_eq!(
        rejection(&one_of(["only"]), "other"),
        rejected_with("Expected one of: only.")
    );
}

#[test]
fn one_of_publishes_the_values_as_an_enum_in_the_declared_order() {
    assert_eq!(
        published(&one_of(["bytes", "words", "lines"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["bytes","words","lines"]}"#
    );
    assert_eq!(
        published(&one_of(["b", "a"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["b","a"]}"#
    );
}

#[test]
fn one_of_panics_at_the_call_for_a_value_listed_twice() {
    assert_eq!(
        fault_text(|| one_of(["dev", "prod", "dev"])),
        "one_of() lists \"dev\" twice. List each value once."
    );
    let fault = support::fault_of(|| one_of(["dev", "prod", "dev"])).unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/one-of-values");
    assert!(fault.message.contains("the first") && fault.message.contains("the second"));
    assert_eq!(
        fault_text(|| one_of::<0>([])),
        "one_of() lists no values. List at least one value."
    );
}
