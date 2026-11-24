//! Accepted values, ported from the reference's `help-accepted.test.ts`: a row derives `One of: …`
//! from a closed set of strings in its input's published schema, or prints its authored `accepts`.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use std::collections::BTreeMap;

use help_support::{noop, run};
use loomcli_core::{
    Application, Arg, Command, InputSchema, Issue, Opt, ValidationContext, Validator,
};
use loomcli_plugins::help::extension::{
    HELP_ARGUMENT, HELP_INPUT, HelpArgumentFacts, HelpInputFacts,
};
use loomcli_plugins::help::help;
use serde_json::{Value, json};

/// A validator that publishes the schema exactly as supplied and accepts every value.
struct Shaped(Value);

impl Validator for Shaped {
    type Output = String;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> InputSchema {
        self.0.as_object().cloned()
    }
}

fn one(schema: Value) -> loomcli_core::StringOpt {
    Opt::string().validate(Shaped(schema))
}

fn many(schema: Value) -> loomcli_core::StringOpt {
    Opt::string().multiple().validate(Shaped(schema))
}

fn accepts(text: &str) -> loomcli_core::ExtensionValue<loomcli_core::OptionTarget> {
    HELP_INPUT.value(HelpInputFacts::new().accepts(text))
}

fn shapes() -> Command {
    let nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    Command::new("shapes")
        .description("Every derivation rule.")
        .option(
            "enum-typed",
            one(json!({ "enum": ["a", "b"], "type": "string" })),
        )
        .option(
            "enum-annotated",
            one(json!({ "default": "a", "enum": ["a", "b"] })),
        )
        .option(
            "enum-pattern",
            one(json!({ "enum": ["a", "b"], "pattern": "^a", "type": "string" })),
        )
        .option(
            "const-typed",
            one(json!({ "const": "only", "type": "string" })),
        )
        .option(
            "const-annotated",
            one(json!({ "const": "only", "description": "x" })),
        )
        .option(
            "const-min-length",
            one(json!({ "const": "only", "minLength": 2 })),
        )
        .option(
            "any-consts",
            one(json!({ "anyOf": [
                { "const": "a", "type": "string" },
                { "const": "b", "type": "string" },
            ] })),
        )
        .option(
            "any-mixed",
            one(json!({ "anyOf": [{ "enum": ["a", "b"] }, { "const": "b" }, { "const": "c" }] })),
        )
        .option(
            "any-annotated",
            one(json!({ "anyOf": [{ "const": "a", "default": "a" }, { "const": "b" }] })),
        )
        .option(
            "any-pattern",
            one(json!({ "anyOf": [{ "const": "a", "pattern": "x" }, { "const": "b" }] })),
        )
        .option(
            "any-typed",
            one(json!({ "anyOf": [{ "const": "a" }, { "const": "b" }], "type": "string" })),
        )
        .option(
            "any-nested",
            one(json!({ "anyOf": [{ "anyOf": [{ "const": "a" }] }] })),
        )
        .option("beside-const", one(json!({ "const": "a", "enum": ["a"] })))
        .option(
            "beside-any",
            one(json!({ "anyOf": [{ "const": "a" }], "enum": ["a"] })),
        )
        .option("repeated", one(json!({ "enum": ["a", "a", "b"] })))
        .option("empty", one(json!({ "enum": [] })))
        .option(
            "nullable",
            one(json!({ "anyOf": [{ "enum": ["a"] }, { "type": "null" }] })),
        )
        .option("eight", one(json!({ "enum": nine[..8] })))
        .option("nine", one(json!({ "enum": nine })))
        .option("number", one(json!({ "enum": ["a", 1] })))
        .option(
            "pattern-only",
            one(json!({ "pattern": "^x", "type": "string" })),
        )
        .option(
            "quoted",
            one(json!({ "enum": ["", "a b", "c,d", "e\"f", "g\u{2028}h", "plain"] })),
        )
        .option("marked", one(json!({ "enum": ["m\u{e000}n"] })))
        .option(
            "described",
            one(json!({ "enum": ["a", "b"] })).description("Pick one."),
        )
        .option(
            "faceted",
            one(json!({ "enum": ["a", "b"] }))
                .default("a")
                .description("Pick one."),
        )
        .option(
            "many-enum",
            many(json!({ "enum": ["x", "y"], "type": "string" })),
        )
        .option(
            "many-annotated",
            many(json!({ "anyOf": [{ "const": "x" }, { "const": "y" }], "description": "d" })),
        )
        .option(
            "many-pattern",
            many(json!({ "enum": ["x"], "pattern": "x" })),
        )
        .option(
            "many-array",
            many(json!({ "items": { "enum": ["x"] }, "type": "array" })),
        )
        .option(
            "authored-over-enum",
            one(json!({ "enum": ["a"] })).extend([accepts("Custom words.")]),
        )
        .option(
            "authored-open",
            Opt::string().extend([accepts("Anything at all.")]),
        )
        .option(
            "authored-pattern",
            one(json!({ "pattern": "^x", "type": "string" })).extend([accepts("An x.")]),
        )
        .option("flag", Opt::boolean().extend([accepts("Never shown.")]))
        .option(
            "all-annotations",
            one(json!({
                "$comment": "c",
                "$id": "i",
                "$schema": "s",
                "default": "a",
                "deprecated": false,
                "description": "d",
                "enum": ["a"],
                "examples": ["a"],
                "readOnly": true,
                "title": "t",
                "writeOnly": false,
            })),
        )
        .option(
            "number-typed",
            one(json!({ "enum": ["a"], "type": "number" })),
        )
        .option("number-const", one(json!({ "const": 1 })))
        .option(
            "any-top-annotated",
            one(json!({ "anyOf": [{ "const": "a" }], "description": "d" })),
        )
        .option(
            "any-top-pattern",
            one(json!({ "anyOf": [{ "const": "a" }], "pattern": "x" })),
        )
        .option(
            "any-enum-typed",
            one(json!({ "anyOf": [{ "enum": ["a"], "type": "string" }, { "const": "b" }] })),
        )
        .option(
            "any-enum-annotated",
            one(json!({ "anyOf": [{ "enum": ["a"], "title": "t" }] })),
        )
        .option(
            "any-enum-narrow",
            one(json!({ "anyOf": [{ "enum": ["a"], "minLength": 1 }] })),
        )
        .option("repeated-late", one(json!({ "enum": ["b", "a", "b"] })))
        .option(
            "nine-repeating",
            one(json!({ "enum": ["a", "b", "c", "d", "e", "f", "g", "h", "a"] })),
        )
        .option(
            "scalar-array",
            one(json!({ "items": { "enum": ["x"] }, "type": "array" })),
        )
        .option(
            "quoted-controls",
            one(json!({ "enum": ["b\u{8}c", "d\u{7f}e", "f\u{9b}g"] })),
        )
        .option(
            "quoted-more",
            one(json!({ "enum": ["i\u{85}j", "k\tl", "m\u{a0}n"] })),
        )
        .action(noop)
}

fn pick() -> Command {
    Command::new("pick")
        .description("Pick items.")
        .argument(
            "mode",
            Arg::string()
                .description("The mode.")
                .required()
                .validate(Shaped(
                    json!({ "enum": ["fast", "slow"], "type": "string" }),
                )),
        )
        .argument(
            "size",
            Arg::string()
                .extend([HELP_ARGUMENT.value(HelpArgumentFacts::accepts("A whole number."))])
                .required()
                .validate(Shaped(json!({ "pattern": "^[0-9]+$", "type": "string" }))),
        )
        .argument(
            "names",
            Arg::string()
                .validate(Shaped(json!({ "enum": ["x", "y"] })))
                .variadic(),
        )
        .action(noop)
}

fn variadic(name: &str, schema: Value) -> Command {
    Command::new(name)
        .argument("values", Arg::string().validate(Shaped(schema)).variadic())
        .action(noop)
}

fn app() -> loomcli_core::GroupApplication<loomcli_core::NoInputs, loomcli_core::NoResult> {
    Application::new("app")
        .plugins((help(),))
        .command(shapes())
        .command(pick())
        .command(variadic("v-const", json!({ "const": "x" })))
        .command(variadic(
            "v-any",
            json!({ "anyOf": [{ "const": "x" }, { "enum": ["y"] }] }),
        ))
        .command(variadic(
            "v-typed",
            json!({ "enum": ["x"], "type": "string" }),
        ))
        .command(variadic(
            "v-annotated",
            json!({ "description": "d", "enum": ["x"] }),
        ))
        .command(variadic(
            "v-narrow",
            json!({ "enum": ["x"], "pattern": "x" }),
        ))
        .command(variadic(
            "v-array",
            json!({ "items": { "enum": ["x"] }, "type": "array" }),
        ))
}

/// The lines of one section of a page, from its title to the next blank line.
fn section(page: &str, title: &str) -> Vec<String> {
    let lines: Vec<&str> = page.split('\n').collect();
    let start = lines.iter().position(|line| *line == title).unwrap();
    lines[start + 1..]
        .iter()
        .take_while(|line| !line.is_empty())
        .map(|line| (*line).to_owned())
        .collect()
}

/// Each option row's right cell, keyed by the long spelling, or `None` for a row with none.
fn option_cells(page: &str) -> BTreeMap<String, Option<String>> {
    let mut cells = BTreeMap::new();
    for line in section(page, "OPTIONS") {
        let Some(rest) = line.strip_prefix("  ") else {
            continue;
        };
        let rest = if rest.len() > 4 && rest.as_bytes()[0] == b'-' && &rest[2..4] == ", " {
            &rest[4..]
        } else if let Some(rest) = rest.strip_prefix("    ") {
            rest
        } else {
            continue;
        };
        if !rest.starts_with("--") {
            continue;
        }
        let long_end = rest
            .find(|character: char| !(character.is_alphanumeric() || character == '-'))
            .unwrap_or(rest.len());
        let long = &rest[..long_end];
        let mut tail = &rest[long_end..];
        if let Some(after) = tail.strip_prefix(" <") {
            let close = after.find('>').unwrap();
            tail = &after[close + 1..];
        }
        let right = tail.trim_start_matches(' ');
        cells.insert(
            long.to_owned(),
            (!right.is_empty()).then(|| right.to_owned()),
        );
    }
    cells
}

async fn page_of(argv: &[&str]) -> String {
    let outcome = run(&app(), argv).await;
    assert_eq!((outcome.status, outcome.stderr.as_str()), (0, ""));
    outcome.stdout
}

#[tokio::test]
async fn a_row_derives_its_accepted_values_from_a_closed_set_of_strings_at_every_level() {
    let some = |text: &str| Some(text.to_owned());
    let expected: BTreeMap<String, Option<String>> = [
        ("--all-annotations", some("One of: a.")),
        ("--any-annotated", some("One of: a, b.")),
        ("--any-consts", some("One of: a, b.")),
        ("--any-enum-annotated", some("One of: a.")),
        ("--any-enum-narrow", None),
        ("--any-enum-typed", some("One of: a, b.")),
        ("--any-mixed", some("One of: a, b, c.")),
        ("--any-nested", None),
        ("--any-pattern", None),
        ("--any-top-annotated", some("One of: a.")),
        ("--any-top-pattern", None),
        ("--any-typed", some("One of: a, b.")),
        ("--authored-open", some("Anything at all.")),
        ("--authored-over-enum", some("Custom words.")),
        ("--authored-pattern", some("An x.")),
        ("--beside-any", None),
        ("--beside-const", None),
        ("--const-annotated", some("One of: only.")),
        ("--const-min-length", None),
        ("--const-typed", some("One of: only.")),
        ("--described", some("Pick one. One of: a, b.")),
        ("--eight", some("One of: a, b, c, d, e, f, g, h.")),
        ("--empty", None),
        ("--enum-annotated", some("One of: a, b.")),
        ("--enum-pattern", None),
        ("--enum-typed", some("One of: a, b.")),
        ("--faceted", some("Pick one. One of: a, b.  (default: a)")),
        ("--flag", None),
        ("--many-annotated", some("One of: x, y.  (repeatable)")),
        ("--many-array", some("(repeatable)")),
        ("--many-enum", some("One of: x, y.  (repeatable)")),
        ("--many-pattern", some("(repeatable)")),
        ("--marked", some("One of: m\u{e000}n.")),
        ("--nine", None),
        ("--nine-repeating", some("One of: a, b, c, d, e, f, g, h.")),
        ("--nullable", None),
        ("--number", None),
        ("--number-const", None),
        ("--number-typed", None),
        ("--pattern-only", None),
        (
            "--quoted",
            some("One of: \"\", \"a b\", \"c,d\", \"e\\\"f\", \"g\\u2028h\", plain."),
        ),
        (
            "--quoted-controls",
            some(r#"One of: "b\bc", "d\u007fe", "f\u009bg"."#),
        ),
        (
            "--quoted-more",
            some("One of: \"i\\u0085j\", \"k\\tl\", \"m\u{a0}n\"."),
        ),
        ("--repeated", some("One of: a, b.")),
        ("--repeated-late", some("One of: b, a.")),
        ("--scalar-array", None),
    ]
    .into_iter()
    .map(|(long, right)| (long.to_owned(), right))
    .collect();
    assert_eq!(
        option_cells(&page_of(&["shapes", "--help"]).await),
        expected
    );
}

#[tokio::test]
async fn an_argument_row_derives_from_its_schema_and_prints_an_authored_help_argument_sentence() {
    assert_eq!(
        section(&page_of(&["pick", "--help"]).await, "ARGUMENTS"),
        [
            "  mode   The mode. One of: fast, slow.",
            "  size   A whole number.",
            "  names  One of: x, y.",
        ]
    );
}

#[tokio::test]
async fn a_variadic_argument_derives_from_the_top_of_its_schema_under_the_same_keyword_rules() {
    for (name, row) in [
        ("v-const", "  values  One of: x."),
        ("v-any", "  values  One of: x, y."),
        ("v-typed", "  values  One of: x."),
        ("v-annotated", "  values  One of: x."),
        ("v-narrow", "  values"),
        ("v-array", "  values"),
    ] {
        assert_eq!(
            section(&page_of(&[name, "--help"]).await, "ARGUMENTS"),
            [row],
            "{name}"
        );
    }
}
