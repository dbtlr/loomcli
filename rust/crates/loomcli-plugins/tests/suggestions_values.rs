//! The rejected closed-set value cases of `suggestions.test.ts`.

#![cfg(feature = "suggestions")]

use loomcli_core::{
    Application, Arg, Context, Done, InputSchema, InvocationOutcome, InvocationValues,
    InvokeOptions, Issue, NoInputs, NoResult, Opt, RunOptions, ValidationContext, Validator,
    escape_control_characters,
};
use loomcli_plugins::suggestions::suggestions;
use loomcli_testing::{MockFields, mock_process};
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

struct Choices {
    values: &'static [&'static str],
    schema: Value,
}

fn choices(values: &'static [&'static str]) -> Choices {
    Choices {
        values,
        schema: json!({"type": "string", "enum": values}),
    }
}

impl Validator for Choices {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if self.values.contains(&input) {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new(format!(
                "Expected one of: {}.",
                escape_control_characters(&self.values.join(", "))
            ))])
        }
    }

    fn input_schema(&self) -> InputSchema {
        self.schema.as_object().cloned()
    }
}

struct Checked {
    schema: Value,
    accepts: fn(&str) -> bool,
    issue: &'static str,
}

impl Validator for Checked {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if (self.accepts)(input) {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new(self.issue)])
        }
    }

    fn input_schema(&self) -> InputSchema {
        self.schema.as_object().cloned()
    }
}

fn plugins(installed: bool) -> Vec<loomcli_core::Plugin> {
    installed.then(suggestions).into_iter().collect()
}

fn value_kit(installed: bool) -> App {
    Application::new("kit")
        .plugins(plugins(installed))
        .global_option(
            "mode",
            Opt::string()
                .env(["KIT_MODE"])
                .validate(choices(&["quiet", "loud"])),
        )
        .option(
            "format",
            Opt::string()
                .aliases(["fmt"])
                .short('f')
                .validate(choices(&["json", "yaml", "text"])),
        )
        .option(
            "rank",
            Opt::string().validate(choices(&["tap", "tip", "top", "tup"])),
        )
        .option(
            "secret",
            Opt::string().hidden().validate(choices(&["json"])),
        )
        .option(
            "old",
            Opt::string()
                .deprecated("Use format.")
                .validate(choices(&["json"])),
        )
        .option(
            "length",
            Opt::string().validate(Checked {
                schema: json!({"type": "string", "minLength": 8}),
                accepts: |text| text.chars().count() >= 8,
                issue: "Supply at least eight characters.",
            }),
        )
        .option(
            "checked",
            Opt::string().validate(Checked {
                schema: json!({"type": "string", "enum": ["json", "yaml"]}),
                accepts: |text| text == "yaml",
                issue: "Choose YAML for this operation.",
            }),
        )
        .option(
            "tag",
            Opt::string()
                .multiple()
                .validate(choices(&["json", "yaml"])),
        )
        .option("left", Opt::boolean())
        .option("right", Opt::boolean())
        .exclusive(&["left", "right"])
        .argument("target", Arg::string().validate(choices(&["json", "yaml"])))
        .action(|_: Context| async { Ok(()) })
}

async fn value_output(app: &App, fields: MockFields) -> (u8, String) {
    let mock = mock_process(fields);
    let code = app.run(RunOptions::new().process(mock.clone())).await;
    (code.get(), mock.stderr_text())
}

async fn rejected(app: &App, argv: &[&str]) -> String {
    let (code, text) = value_output(app, MockFields::new().argv(argv.iter().copied())).await;
    assert_eq!(code, 2);
    text
}

#[tokio::test]
async fn a_suggestion_replaces_the_issue_without_echoing_the_received_value_or_adding_a_line() {
    let result = value_output(
        &value_kit(true),
        MockFields::new().argv(["--format", "jsno"]),
    )
    .await;
    assert_eq!(
        result,
        (
            2,
            "kit: Option \"--format\": Did you mean \"json\"?\n".to_owned()
        )
    );
}

#[tokio::test]
async fn matches_rank_by_distance_then_schema_order_and_stop_at_three() {
    assert_eq!(
        rejected(&value_kit(true), &["--rank", "TUP"]).await,
        "kit: Option \"--rank\": Did you mean one of these: tup, tap, tip?\n"
    );
}

#[tokio::test]
async fn every_membership_miss_changes_and_other_problems_and_groups_keep_their_text() {
    let argv = [
        "--format", "jsno", "--mode", "quie", "--length", "tiny", "--left", "--right", "yaml",
    ];
    let core = rejected(&value_kit(false), &argv).await;
    let installed = rejected(&value_kit(true), &argv).await;
    assert!(core.contains("Expected one of: quiet, loud."));
    assert!(core.contains("Expected one of: json, yaml, text."));
    assert!(core.contains("Supply at least eight characters."));
    assert_eq!(
        installed,
        core.replace("Expected one of: quiet, loud.", "Did you mean \"quiet\"?")
            .replace(
                "Expected one of: json, yaml, text.",
                "Did you mean \"json\"?"
            )
    );
}

#[tokio::test]
async fn an_ineligible_value_keeps_cores_bytes() {
    let core = value_kit(false);
    let installed = value_kit(true);
    for argv in [
        ["--format", "zzzzzz"],
        ["--format", "x"],
        ["--length", "json"],
        ["--checked", "json"],
        ["--secret", "jsno"],
        ["--old", "jsno"],
    ] {
        assert_eq!(
            rejected(&installed, &argv).await,
            rejected(&core, &argv).await,
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn long_alias_and_short_spellings_resolve_to_the_same_schema() {
    let app = value_kit(true);
    for spelling in ["--format", "--fmt", "-f"] {
        assert_eq!(
            rejected(&app, &[spelling, "jsno"]).await,
            "kit: Option \"--format\": Did you mean \"json\"?\n"
        );
    }
}

#[tokio::test]
async fn a_named_invocation_suggests_values_for_global_options_local_options_and_arguments() {
    let app = value_kit(true);
    let invoked = app
        .invoke(
            &[],
            InvocationValues::new()
                .arg("target", "jsno")
                .option("format", "jsno")
                .option("mode", "quie"),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    assert!(matches!(
        invoked,
        InvocationOutcome::Failed { messages, .. } if messages == concat!(
            "kit: Option \"mode\": Did you mean \"quiet\"?\n",
            "kit: Option \"format\": Did you mean \"json\"?\n",
            "kit: Argument \"target\": Did you mean \"json\"?\n"
        )
    ));
    assert_eq!(
        rejected(&app, &["jsno"]).await,
        "kit: Argument \"target\": Did you mean \"json\"?\n"
    );
}

#[tokio::test]
async fn an_environment_value_keeps_its_source_label() {
    let result = value_output(&value_kit(true), MockFields::new().env("KIT_MODE", "quie")).await;
    assert_eq!(
        result,
        (
            2,
            "kit: Option \"--mode\" (from KIT_MODE): Did you mean \"quiet\"?\n".to_owned()
        )
    );
}

#[tokio::test]
async fn each_rejected_element_of_a_collected_input_gets_its_own_suggestion() {
    assert_eq!(
        rejected(&value_kit(true), &["--tag", "jsno", "--tag", "yalm"]).await,
        concat!(
            "kit: Option \"--tag\" at 0: Did you mean \"json\"?\n",
            "kit: Option \"--tag\" at 1: Did you mean \"yaml\"?\n"
        )
    );
}

#[tokio::test]
async fn accepted_candidates_come_from_const_and_any_of_schemas() {
    for (schema, values) in [
        (json!({"const": "json"}), &["json"][..]),
        (
            json!({"anyOf": [{"const": "json"}, {"const": "yaml"}]}),
            &["json", "yaml"][..],
        ),
    ] {
        let app = Application::new("kit")
            .plugins([suggestions()])
            .option("format", Opt::string().validate(Choices { values, schema }))
            .action(|_: Context| async { Ok(()) });
        assert_eq!(
            rejected(&app, &["--format", "jsno"]).await,
            "kit: Option \"--format\": Did you mean \"json\"?\n"
        );
    }
}

#[tokio::test]
async fn an_accepted_value_is_escaped_and_the_received_value_is_absent() {
    let app = Application::new("kit")
        .plugins([suggestions()])
        .option("format", Opt::string().validate(choices(&["js\non"])))
        .action(|_: Context| async { Ok(()) });
    assert_eq!(
        rejected(&app, &["--format", "json"]).await,
        "kit: Option \"--format\": Did you mean \"js\\u000aon\"?\n"
    );
}

fn alignment_kit(installed: bool, multiline: bool) -> App {
    let x = if multiline {
        Opt::string().validate(Checked {
            schema: json!({"type": "string", "enum": ["json", "yaml"]}),
            accepts: |text| matches!(text, "json" | "yaml"),
            issue: "Line one.\nLine two.",
        })
    } else {
        Opt::string().validate(choices(&["json", "yaml"]))
    };
    Application::new("kit")
        .plugins(plugins(installed))
        .option("x", x.required())
        .option("y", Opt::string().validate(choices(&["json", "yaml"])))
        .action(|_: Context| async { Ok(()) })
}

#[tokio::test]
async fn a_missing_problem_stays_ahead_of_a_closed_set_miss() {
    let argv = ["--y", "yalm"];
    let core = rejected(&alignment_kit(false, false), &argv).await;
    assert!(core.starts_with("kit: Option \"--x\" is required."));
    assert!(core.contains("Expected one of: json, yaml."));
    assert_eq!(
        rejected(&alignment_kit(true, false), &argv).await,
        core.replace("Expected one of: json, yaml.", "Did you mean \"yaml\"?")
    );
}

#[tokio::test]
async fn a_multiline_closed_set_issue_keeps_cores_bytes() {
    let argv = ["--x", "jsno"];
    let core = rejected(&alignment_kit(false, true), &argv).await;
    assert!(core.contains("Line one.\nkit: Line two."));
    assert_eq!(rejected(&alignment_kit(true, true), &argv).await, core);
}

#[tokio::test]
async fn a_closed_set_miss_after_a_multiline_issue_still_gets_a_suggestion() {
    let argv = ["--x", "jsno", "--y", "yalm"];
    let core = rejected(&alignment_kit(false, true), &argv).await;
    assert!(core.contains("Line one.\nkit: Line two."));
    assert!(core.contains("Expected one of: json, yaml."));
    assert_eq!(
        rejected(&alignment_kit(true, true), &argv).await,
        core.replace("Expected one of: json, yaml.", "Did you mean \"yaml\"?")
    );
}
