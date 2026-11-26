//! The derives' compile errors: each message, and the source text its span covers, so an author's
//! editor underlines the fact at fault.

#![allow(clippy::expect_used, clippy::panic)]

use proc_macro2::Span;
use syn::DeriveInput;

/// The text of `source` that `span` covers.
fn covered(source: &str, span: Span) -> String {
    let offset = |line: usize, column: usize| -> usize {
        let before: usize = source
            .split_inclusive('\n')
            .take(line - 1)
            .map(|text| text.chars().count())
            .sum();
        before + column
    };
    let (start, end) = (span.start(), span.end());
    source
        .chars()
        .skip(offset(start.line, start.column))
        .take(offset(end.line, end.column) - offset(start.line, start.column))
        .collect()
}

/// Each compile error the expansion of `source` reports, as its message and the text it points at.
fn faults(
    expand: fn(&DeriveInput) -> syn::Result<proc_macro2::TokenStream>,
    source: &str,
) -> Vec<(String, String)> {
    let input: DeriveInput = syn::parse_str(source).expect("the source is a struct");
    match expand(&input) {
        Ok(tokens) => panic!("the expansion succeeded: {tokens}"),
        Err(errors) => errors
            .into_iter()
            .map(|error| (error.to_string(), covered(source, error.span())))
            .collect(),
    }
}

fn inputs_fault(source: &str) -> (String, String) {
    let mut found = faults(crate::inputs::expand, source);
    assert_eq!(found.len(), 1, "one fault: {found:?}");
    found.remove(0)
}

fn failure_fault(source: &str) -> (String, String) {
    let mut found = faults(crate::failure::expand, source);
    assert_eq!(found.len(), 1, "one fault: {found:?}");
    found.remove(0)
}

fn pair(message: &str, at: &str) -> (String, String) {
    (message.to_owned(), at.to_owned())
}

#[test]
fn a_fact_of_another_kind_points_at_its_key() {
    assert_eq!(
        inputs_fault("struct I { #[option(polarity = \"both\")] name: String }"),
        pair(
            "`polarity` is not a fact of a string option: it is a fact of a Boolean option",
            "polarity",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(verbose)] debug: bool }"),
        pair(
            "`verbose` is not a fact of a Boolean option: it is a fact of a counted option",
            "verbose",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[argument(short = 'p')] path: String }"),
        pair(
            "`short` is not a fact of a string argument: it is a fact of an option",
            "short",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(validate = text())] file: Content }"),
        pair(
            "`validate` is not a fact of a content option: it is a fact of a string input",
            "validate",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[stdin(name = \"input\")] input: Content }"),
        pair(
            "`name` is not a fact of the standalone stdin: it is a fact of an option or an argument",
            "name",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[argument(implied = \"x\")] path: Option<String> }"),
        pair(
            "`implied` is not a fact of a string argument: it is a fact of a string option",
            "implied",
        )
    );
}

#[test]
fn the_field_type_states_presence_so_a_second_statement_is_an_error() {
    assert_eq!(
        inputs_fault("struct I { #[option(required)] name: String }"),
        pair(
            "a field that is not an `Option` or a `Vec` is already required; drop `required`",
            "required",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[argument(required)] name: Option<String> }"),
        pair(
            "an `Option` field is optional; drop the `Option` to require it",
            "required",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(default = \"8080\")] port: Option<String> }"),
        pair(
            "a declared default makes the value present; drop the `Option`",
            "default",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(non_interactive)] name: String }"),
        pair(
            "an input required only when the run cannot ask reads as `Option<T>`",
            "non_interactive",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[argument(min = 1)] file: Content }"),
        pair(
            "`min` and `max` bound how many sources a `Vec` field collects",
            "min",
        )
    );
}

#[test]
fn a_type_no_kind_reads_points_at_the_type() {
    assert_eq!(
        inputs_fault("struct I { #[option] force: Option<bool> }"),
        pair(
            "a Boolean option is never absent and never repeated: its field is a plain `bool`",
            "bool",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(count)] verbose: i32 }"),
        pair(
            "a counted option's field is an unsigned integer: u8, u16, u32, u64, or usize",
            "i32",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(count)] verbose: bool }"),
        pair(
            "a `bool` field is a Boolean option; `count` makes an unsigned integer field a counted option",
            "count",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[argument] force: bool }"),
        pair(
            "an argument reads a string or content; a `bool` field is a Boolean option",
            "bool",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[stdin] input: Vec<Content> }"),
        pair(
            "a #[stdin] field reads one stdin: `Content` or `Option<Content>`",
            "Content",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[stdin] input: String }"),
        pair(
            "a #[stdin] field reads one stdin: `Content` or `Option<Content>`",
            "String",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[stdin] input: Option<String> }"),
        pair(
            "a #[stdin] field reads one stdin: `Content` or `Option<Content>`",
            "String",
        )
    );
}

#[test]
fn a_passthrough_field_requires_a_vector_of_strings() {
    let message = "a #[passthrough] field reads the tail as `Vec<String>`";
    assert_eq!(
        inputs_fault("struct I { #[passthrough] tail: String }"),
        pair(message, "String")
    );
    assert_eq!(
        inputs_fault("struct I { #[passthrough] tail: Vec<bool> }"),
        pair(message, "bool")
    );
}

#[test]
fn a_passthrough_field_rejects_facts_other_than_description_at_the_key() {
    assert_eq!(
        inputs_fault("struct I { #[passthrough(name = \"tail\")] tail: Vec<String> }"),
        pair(
            "`name` is not a fact of the passthrough mode: it is a fact of an option or an argument",
            "name",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[passthrough(unknown)] tail: Vec<String> }"),
        pair(
            "unknown input fact `unknown`; the facts are `name`, `description`, `short`, \
             `short_only`, `aliases`, `hidden`, `deprecated`, `control`, `count`, `polarity`, \
             `validate`, `validate_omitted`, `default`, `implied`, `required`, `non_interactive`, \
             `env`, `env_delimiter`, `env_allow_empty`, `extensions`, `stdin`, `min`, `max`, \
             `interaction`, `color`, `verbose`, `quiet`, `background`, `builder`",
            "unknown",
        )
    );
}

#[test]
fn a_passthrough_field_rejects_a_second_input_attribute_at_that_attribute() {
    let message =
        "a field is one input: one of #[option], #[argument], #[stdin], or #[passthrough]";
    assert_eq!(
        inputs_fault("struct I { #[passthrough] #[argument] tail: Vec<String> }"),
        pair(message, "#[argument]")
    );
    assert_eq!(
        inputs_fault("struct I { #[passthrough] #[passthrough()] tail: Vec<String> }"),
        pair(message, "#[passthrough()]")
    );
}

#[test]
fn the_option_config_rules_are_compile_errors_at_the_second_fact() {
    assert_eq!(
        inputs_fault("struct I { #[option(short = 'n', short_only, aliases = [\"x\"])] n: bool }"),
        pair(
            "a short-only option has no long spelling for an alias to stand beside; drop `aliases` or `short_only`",
            "aliases",
        )
    );
    assert_eq!(
        inputs_fault(
            "struct I { #[option(short = 'n', short_only, polarity = \"both\")] n: bool }"
        ),
        pair(
            "polarity \"both\" needs the long spelling its negation forms; drop `short_only`",
            "short_only",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(color, short = 'c')] color: bool }"),
        pair("a color option takes no short spelling", "short")
    );
    assert_eq!(
        inputs_fault("struct I { #[option(color, env = \"PAINT\")] color: bool }"),
        pair(
            "a color option takes no environment binding: NO_COLOR and FORCE_COLOR already decide",
            "env",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(count, verbose, env = \"LOUD\")] verbose: u8 }"),
        pair(
            "a verbose or quiet option takes no environment binding",
            "env",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(env = \"TAGS\")] tag: Vec<String> }"),
        pair(
            "a multiple option's environment binding needs `env_delimiter` to split the variable's value",
            "env",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(validate_omitted)] port: String }"),
        pair(
            "`validate_omitted` needs `validate`, the validator that receives the omission",
            "validate_omitted",
        )
    );
    assert_eq!(
        inputs_fault(
            "struct I { #[option(validate = port(), validate_omitted, default = \"80\")] port: u16 }"
        ),
        pair(
            "a validator that receives the omission answers in place of a default; drop `default`",
            "default",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(required, default = [\"a\"])] tag: Vec<String> }"),
        pair(
            "a required input takes no default; drop `default` or `required`",
            "default",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(polarity = \"sideways\")] force: bool }"),
        pair(
            "polarity is \"positive\", \"negative\", or \"both\"",
            "\"sideways\"",
        )
    );
}

#[test]
fn the_single_field_option_config_rules_are_compile_errors() {
    let cases = [
        (
            "struct I { #[option(short_only)] flag: bool }",
            "`short_only` needs `short`, the one spelling a short-only option keeps",
            "short_only",
        ),
        (
            "struct I { #[option(short = '1')] flag: bool }",
            "a short spelling is one ASCII letter, such as 'f'",
            "'1'",
        ),
        (
            "struct I { #[option(env = \"X\", env_delimiter = \",\")] name: Option<String> }",
            "`env_delimiter` splits the variable's value into several, so it sits on a `Vec` field",
            "env_delimiter",
        ),
        (
            "struct I { #[option(env_delimiter = \",\")] names: Vec<String> }",
            "`env_delimiter` splits an environment binding's value; add `env`",
            "env_delimiter",
        ),
        (
            "struct I { #[option(env_delimiter = \",\")] files: Vec<Content> }",
            "`env_delimiter` splits an environment binding's value; add `env`",
            "env_delimiter",
        ),
        (
            "struct I { #[option(env_allow_empty)] v: Option<String> }",
            "`env_allow_empty` needs `env`, the binding whose empty value it keeps",
            "env_allow_empty",
        ),
        (
            "struct I { #[option(env = \"V\", env_delimiter = \",\", env_allow_empty)] v: Vec<String> }",
            "`env_allow_empty` keeps one value's empty binding; a `Vec` field's binding splits its value",
            "env_allow_empty",
        ),
        (
            "struct I { #[option(required, non_interactive)] names: Vec<String> }",
            "a required input is required whether or not the run can ask; drop `non_interactive` or `required`",
            "non_interactive",
        ),
        (
            "struct I { #[argument(required, non_interactive)] names: Vec<String> }",
            "a required input is required whether or not the run can ask; drop `non_interactive` or `required`",
            "non_interactive",
        ),
        (
            "struct I { #[option(non_interactive, default = [\"a\"])] names: Vec<String> }",
            "an input required when the run cannot ask takes no default; drop `default` or `non_interactive`",
            "default",
        ),
        (
            "struct I { #[option(default = [\"a\", \"b\"])] name: String }",
            "a list default fills a `Vec` field; give one value, such as `default = \"a\"`",
            "default",
        ),
        (
            "struct I { #[argument(default = [\"a\"])] path: String }",
            "a list default fills a `Vec` field; give one value, such as `default = \"a\"`",
            "default",
        ),
        (
            "struct I { #[option(count, verbose, quiet)] level: u8 }",
            "an option is verbose or quiet, not both; drop one",
            "quiet",
        ),
        (
            "struct I { #[option(background, short = 'b')] background: Option<String> }",
            "a background option takes no `short`: core fills it from the terminal",
            "short",
        ),
        (
            "struct I { #[option(background, env = \"BG\")] background: Option<String> }",
            "a background option takes no `env`: core fills it from the terminal",
            "env",
        ),
        (
            "struct I { #[option(background, default = \"dark\")] background: String }",
            "a background option takes no `default`: core fills it from the terminal",
            "default",
        ),
        (
            "struct I { #[option(background, implied = \"dark\")] background: Option<String> }",
            "a background option takes no `implied`: core fills it from the terminal",
            "implied",
        ),
        (
            "struct I { #[option(background)] background: Vec<String> }",
            "a background option holds one value; its field is not a `Vec`",
            "background",
        ),
    ];
    for (source, message, at) in cases {
        assert_eq!(inputs_fault(source), pair(message, at), "{source}");
    }
}

#[test]
fn a_name_outside_the_declared_name_grammar_points_at_the_name() {
    assert_eq!(
        inputs_fault("struct I { #[option(name = \"--file\")] file: bool }"),
        pair(
            "\"--file\" is not a declared name: a declared name is nonempty, with no leading hyphen, no whitespace, and no `=`",
            "\"--file\"",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[argument(name = \"a b\")] path: String }"),
        pair(
            "\"a b\" is not a declared name: a declared name is nonempty, with no leading hyphen, no whitespace, and no `=`",
            "\"a b\"",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(aliases = [\"ok\", \"x=y\"])] file: bool }"),
        pair(
            "the alias \"x=y\" is not a declared name: a declared name is nonempty, with no leading hyphen, no whitespace, and no `=`",
            "\"x=y\"",
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option] _private: bool }"),
        pair(
            "the field name declares the name \"-private\", which is not a declared name: a declared name is nonempty, with no leading hyphen, no whitespace, and no `=`; give one with `name = \"…\"`",
            "_private",
        )
    );
}

#[test]
fn a_shared_builder_holds_every_option_fact_so_a_fact_beside_it_is_an_error() {
    for fact in [
        "short = 'x'",
        "description = \"Mine.\"",
        "hidden",
        "stdin",
        "env = \"DOC\"",
        "aliases = [\"doc\"]",
        "deprecated = \"Gone.\"",
        "control",
        "extensions = []",
    ] {
        let key = fact.split(' ').next().unwrap_or(fact);
        assert_eq!(
            inputs_fault(&format!(
                "struct I {{ #[option(builder = shared(), {fact})] file: Content }}"
            )),
            pair(
                &format!(
                    "`{key}` is a fact of the shared builder: set it in the builder or drop `builder`"
                ),
                key,
            ),
            "{fact}"
        );
    }
    let expanded = |source: &str| {
        let input: DeriveInput = syn::parse_str(source).expect("a struct");
        crate::inputs::expand(&input)
            .expect("the expansion succeeds")
            .to_string()
    };
    // The name and the `Vec` field's presence facts sit beside the builder, and the field's doc
    // comment documents the field, not the option.
    let declared = expanded(
        "struct I { /// The documents. \n #[option(builder = shared(), name = \"doc\", required, min = 1, max = 3)] files: Vec<Content> }",
    );
    assert!(
        declared.contains(
            "declarations . option (\"doc\" , (shared ()) . multiple () . required () . min (1) . max (3))"
        ),
        "{declared}"
    );
    assert!(!declared.contains("The documents."), "{declared}");
}

#[test]
fn the_attribute_grammar_points_at_the_word_at_fault() {
    assert_eq!(
        inputs_fault("struct I { #[option(shrot = 'f')] file: String }").1,
        "shrot"
    );
    assert!(
        inputs_fault("struct I { #[option(shrot = 'f')] file: String }")
            .0
            .starts_with("unknown input fact `shrot`; the facts are `name`, `description`,")
    );
    assert_eq!(
        inputs_fault("struct I { #[option(hidden, hidden)] file: String }"),
        pair("`hidden` is declared twice", "hidden")
    );
    assert_eq!(
        inputs_fault("struct I { #[option(hidden = true)] file: String }"),
        pair(
            "`hidden` is a flag: write it alone, with no value",
            "hidden"
        )
    );
    assert_eq!(
        inputs_fault("struct I { #[option(short)] file: String }"),
        pair("`short` takes a value: write `short = …`", "short")
    );
    assert_eq!(
        inputs_fault("struct I { #[option] #[argument] file: String }"),
        pair(
            "a field is one input: one of #[option], #[argument], #[stdin], or #[passthrough]",
            "#[argument]",
        )
    );
    assert_eq!(
        inputs_fault("struct I { file: String }"),
        pair(
            "each field of an Inputs struct carries #[option], #[argument], #[stdin], or #[passthrough]",
            "file",
        )
    );
    assert_eq!(
        inputs_fault("struct I(String);"),
        pair(
            "#[derive(Inputs)] reads each field by its name, so the struct has named fields",
            "I",
        )
    );
    assert_eq!(
        inputs_fault("enum I { A }"),
        pair(
            "#[derive(Inputs)] applies to a struct whose fields are inputs",
            "I",
        )
    );
    assert_eq!(
        inputs_fault("#[inputs(alone(\"a\", \"b\"))] struct I { #[option] a: bool }"),
        pair(
            "expected `exclusive`, `one_required`, or `required_together`",
            "alone",
        )
    );
}

#[test]
fn every_field_at_fault_reports_at_once() {
    let found = faults(
        crate::inputs::expand,
        "struct I { #[option(required)] a: String, #[option] b: bool, #[option(count)] c: i8 }",
    );
    assert_eq!(
        found.iter().map(|(_, at)| at.as_str()).collect::<Vec<_>>(),
        ["required", "i8"]
    );
}

#[test]
fn global_inputs_is_implemented_only_for_structs_every_global_may_hold() {
    let expanded = |source: &str| {
        let input: DeriveInput = syn::parse_str(source).expect("a struct");
        crate::inputs::expand(&input)
            .expect("the expansion succeeds")
            .to_string()
    };
    let global = |source: &str| expanded(source).contains("GlobalInputs for");
    assert!(global(
        "struct G { #[option(count, verbose)] v: u8, #[option] dry_run: bool, #[option(default = \"x\")] mode: String, #[option] tag: Vec<String>, #[option] name: Option<String> }"
    ));
    assert!(!global("struct G { #[option] name: String }"));
    assert!(!global(
        "struct G { #[option(non_interactive)] name: Option<String> }"
    ));
    assert!(!global("struct G { #[option(required)] tag: Vec<String> }"));
    assert!(!global("struct G { #[option] file: Option<Content> }"));
    assert!(!global("struct G { #[argument] path: Option<String> }"));
    assert!(!global("struct G { #[stdin] input: Option<Content> }"));
    assert!(!global(
        "#[inputs(exclusive(\"a\", \"b\"))] struct G { #[option] a: bool, #[option] b: bool }"
    ));
    assert!(!global("struct G { #[passthrough] tail: Vec<String> }"));
}

#[test]
fn a_failure_class_faults_at_the_word_at_fault() {
    assert_eq!(
        failure_fault("struct E { base: FatalError }"),
        pair(
            "a failure class holds its parent class's value in a `#[failure(base)]` field, such as `base: FatalError`",
            "E",
        )
    );
    assert_eq!(
        failure_fault(
            "struct E { #[failure(base)] a: FatalError, #[failure(base)] b: FatalError }"
        ),
        pair("a failure class has one `#[failure(base)]` field", "base")
    );
    assert_eq!(
        failure_fault(
            "#[failure(code = \"Path Not Found\")] struct E { #[failure(base)] base: FatalError }"
        ),
        pair(
            "a failure code is lowercase words of letters and digits joined by single hyphens, such as \"path-not-found\"",
            "\"Path Not Found\"",
        )
    );
    for (literal, at) in [("0", "0"), ("126", "126"), ("-1", "-1")] {
        assert_eq!(
            failure_fault(&format!(
                "#[failure(exit_code = {literal})] struct E {{ #[failure(base)] base: FatalError }}"
            )),
            pair(
                "a failure class declares an exit code from 1 through 125, such as `EX_DATAERR` or `65`",
                at,
            )
        );
    }
    assert_eq!(
        failure_fault(
            "#[failure(code = \"a\", code = \"b\")] struct E { #[failure(base)] base: FatalError }"
        ),
        pair("`code` is declared twice", "code")
    );
    assert_eq!(
        failure_fault("#[failure(exit = 65)] struct E { #[failure(base)] base: FatalError }"),
        pair("expected `code`, `exit_code`, or `abstract`", "exit")
    );
    assert_eq!(
        failure_fault("struct E { #[failure(parent)] base: FatalError }"),
        pair(
            "a field's failure attribute is `#[failure(base)]`, on the field that holds the parent class's value",
            "parent",
        )
    );
    assert_eq!(
        failure_fault("struct E<T> { #[failure(base)] base: FatalError, value: T }"),
        pair(
            "a failure class has one static class value, so it takes no generic parameters",
            "<T>",
        )
    );
    assert_eq!(
        failure_fault("enum E { A }"),
        pair(
            "#[derive(Failure)] applies to a struct with named fields, one of them the `#[failure(base)]` parent",
            "E",
        )
    );
}

#[test]
fn a_group_member_that_names_a_field_identifier_points_at_the_member() {
    assert_eq!(
        inputs_fault(
            r#"#[inputs(exclusive("dry_run", "force"))]
            struct DeployInputs {
                #[option]
                dry_run: bool,
                #[option]
                force: bool,
            }"#
        ),
        pair(
            "`dry_run` is the field; a group names the declared name \"dry-run\"",
            "\"dry_run\""
        )
    );
    assert_eq!(
        inputs_fault(
            r#"#[inputs(one_required("target", "dry_run"))]
            struct DeployInputs {
                #[option(name = "simulate")]
                dry_run: bool,
                #[option]
                target: Option<String>,
            }"#
        ),
        pair(
            "`dry_run` is the field; a group names the declared name \"simulate\"",
            "\"dry_run\""
        )
    );
}

#[test]
fn a_group_member_that_names_a_declared_name_or_no_field_expands() {
    for source in [
        r#"#[inputs(exclusive("dry-run", "force"))]
        struct DeployInputs {
            #[option]
            dry_run: bool,
            #[option]
            force: bool,
        }"#,
        // A member that names no field may be an option declared before `inputs::<I>()`.
        r#"#[inputs(exclusive("earlier", "force"))]
        struct DeployInputs {
            #[option]
            force: bool,
        }"#,
        // A field whose declared name is its identifier is named either way.
        r#"#[inputs(exclusive("force", "quiet"))]
        struct DeployInputs {
            #[option]
            force: bool,
            #[option]
            quiet: bool,
        }"#,
    ] {
        let input: DeriveInput = syn::parse_str(source).expect("the source is a struct");
        assert!(crate::inputs::expand(&input).is_ok(), "{source}");
    }
}
