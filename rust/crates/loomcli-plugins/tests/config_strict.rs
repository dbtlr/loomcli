//! Strict configuration through its provider and the core input-source stage.

#![cfg(feature = "config")]
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod config_support;

use config_support::{App, HELP_HINT, Settings, Workspace, panics, read_line, read_wrong};
use loomcli_core::{Application, FailureFacts, Opt};
use loomcli_plugins::config::{ConfigurationSettings, Strict, configuration};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

fn provider<T: DeserializeOwned + Send + Sync + 'static>(
    settings: ConfigurationSettings<T>,
) -> App {
    provider_with_view(settings, None)
}

fn provider_with_view<T: DeserializeOwned + Send + Sync + 'static>(
    settings: ConfigurationSettings<T>,
    view: Option<loomcli_core::ViewOverride>,
) -> App {
    let config = configuration(settings);
    let app = Application::new("app")
        .plugins([config.plugin])
        .global_option("loud", Opt::count().short('L').verbose())
        .uses([&config.provider]);
    let app = match view {
        Some(view) => app.overrides([view]),
        None => app,
    };
    app.action(|context| async move { context.out.print("ran").await })
}

fn shape() -> Value {
    json!({"properties":{
        "delivery": {"properties": {
            "retries":{"type":"integer"}, "webhook":{"type":"string"},
            "targets":{"type":"array", "items":{"properties":{"root":{"type":"string"}}}}
        }},
        "stateDir":{"type":"string"},
        "cosmetic":{"type":"string"}
    }})
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Config {
    delivery: Option<Delivery>,
    cosmetic: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Delivery {
    retries: Option<i64>,
    webhook: Option<String>,
    targets: Option<Vec<Target>>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Target {
    root: String,
    name: Option<String>,
}

async fn read<T: DeserializeOwned + Send + Sync + 'static>(
    document: &Value,
    schema: Value,
    strict: Strict,
) -> config_support::Ran {
    let space = Workspace::new();
    space.write(".app.json", &document.to_string());
    let app = provider::<T>(ConfigurationSettings::new(schema.as_object().cloned()).strict(strict));
    space.run().arg(&["-L"]).ran_with(&app).await
}

fn assert_failure(ran: config_support::Ran, lines: &[&str]) {
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""), "{}", ran.stderr);
    let expected: String = lines.iter().map(|line| format!("app: {line}\n")).collect();
    assert_eq!(ran.stderr, expected);
}

fn assert_verbose_failure(mut ran: config_support::Ran, lines: &[&str]) {
    ran.stderr = ran
        .stderr
        .strip_prefix(&read_line(".app.json"))
        .unwrap()
        .to_owned();
    assert_failure(ran, lines);
}

#[tokio::test]
async fn strict_all_reports_each_rejection_before_the_unknown_keys() {
    assert_verbose_failure(
        read::<Config>(
            &json!({"state_dir":1,"delivery":{"retries":"many","webhok":"x"}}),
            shape(),
            Strict::ALL,
        )
        .await,
        &[
            "Configuration value delivery.retries in .app.json: Invalid input: expected int, received string. Correct the value, or remove it.",
            "Unknown key state_dir in .app.json. Check its spelling, or remove it.",
            "Unknown key delivery.webhok in .app.json. Check its spelling, or remove it.",
        ],
    );
}

#[tokio::test]
async fn explicit_off_preserves_fallback_and_verbose_drop_lines() {
    let space = Workspace::new();
    space.write(".app.json", r#"{"delivery":{"retries":"many"}}"#);
    let base = || ConfigurationSettings::<Config>::new(shape().as_object().cloned());
    let default = space.run().arg(&["-L"]).ran_with(&provider(base())).await;
    let off = space
        .run()
        .arg(&["-L"])
        .ran_with(&provider(base().strict(Strict::OFF)))
        .await;
    assert_eq!((default.status, default.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        default.stderr,
        read_wrong(
            ".app.json",
            &[
                "Ignored delivery.retries in .app.json: Invalid input: expected int, received string"
            ]
        )
    );
    assert_eq!(
        (off.status, off.stdout, off.stderr),
        (default.status, default.stdout, default.stderr)
    );
}

#[tokio::test]
async fn strict_paths_match_whole_keys_and_continue_reporting_uncovered_keys_and_values() {
    let ran = read::<Config>(
        &json!({"state_dir":"x","cosmetic":2,"delivery":{"webhok":"y","retries":"many"},"deliveryMode":4,"delivery.webhook":8}),
        shape(),
        Strict::paths("delivery", &[]),
    ).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        concat!(
            "› Read configuration from .app.json.\n",
            "› Ignored cosmetic in .app.json: Invalid input: expected string, received number\n",
            "› Ignored state_dir in .app.json: Unknown key. Check its spelling, or remove it.\n",
            "› Ignored deliveryMode in .app.json: Unknown key. Check its spelling, or remove it.\n",
            "› Ignored delivery.webhook in .app.json: Unknown key. Check its spelling, or remove it.\n",
            "app: Configuration value delivery.retries in .app.json: Invalid input: expected int, received string. Correct the value, or remove it.\n",
            "app: Unknown key delivery.webhok in .app.json. Check its spelling, or remove it.\n",
        )
    );
}

#[tokio::test]
async fn strict_uses_the_issue_path_inside_a_removed_array_item() {
    assert_verbose_failure(
        read::<Config>(
            &json!({"delivery":{"targets":[{"root":"valid"},{"root":5,"name":"keep"}]}}),
            shape(),
            Strict::paths("delivery.targets", &[]),
        )
        .await,
        &[
            "Configuration value delivery.targets[1].root in .app.json: Invalid input: expected string, received number. Correct the value, or remove it.",
        ],
    );
    let ran = read::<Config>(
        &json!({"delivery":{"targets":[{"root":"valid"},{"root":5,"name":"keep"}]}}),
        shape(),
        Strict::OFF,
    )
    .await;
    assert_eq!(ran.status, 0);
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &[
                "Ignored delivery.targets[1] in .app.json: Invalid input: expected string, received number"
            ]
        )
    );
}

#[tokio::test]
async fn without_json_schema_strict_still_reports_rejections_but_it_does_not_judge_unknown_keys() {
    assert_verbose_failure(
        read::<Config>(
            &json!({"unknown":5,"delivery":{"retries":"many"}}),
            Value::Null,
            Strict::paths("delivery", &["unpublished.missing"]),
        )
        .await,
        &[
            "Configuration value delivery.retries in .app.json: Invalid input: expected int, received string. Correct the value, or remove it.",
        ],
    );
    let ran = read::<Config>(&json!({"unknown":5}), Value::Null, Strict::ALL).await;
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (0, "ran\n", read_line(".app.json").as_str())
    );
}

#[tokio::test]
async fn strict_unknown_key_issues_use_segment_quoting_and_core_control_escapes() {
    assert_verbose_failure(
        read::<Config>(
            &json!({"state\u{200b}Dir":"x","state\nDir":"x","delivery":{" webhok":"x"}}),
            shape(),
            Strict::ALL,
        )
        .await,
        &[
            r#"Unknown key "stateU+200BDir" in .app.json. Check its spelling, or remove it."#,
            r"Unknown key state\u000aDir in .app.json. Check its spelling, or remove it.",
            r#"Unknown key delivery."U+0020webhok" in .app.json. Check its spelling, or remove it."#,
        ],
    );
}

#[test]
fn malformed_paths_fail_at_the_setter() {
    for path in ["a..b", "", ".a", "delivery."] {
        let fault = panics(|| {
            let _ = ConfigurationSettings::<Config>::new(None)
                .strict(Strict::paths("delivery", &[path]));
        })
        .unwrap();
        assert!(
            fault.contains("@loomcli/plugins/config/strict-path"),
            "{fault}"
        );
        assert!(
            fault.contains("strict lists a path that is not a dotted path of nonempty keys."),
            "{fault}"
        );
        assert!(
            fault.contains(
                "List dotted paths of nonempty keys, such as delivery or delivery.webhook."
            ),
            "{fault}"
        );
    }
}

#[test]
fn strict_schema_paths_build_through_object_union_members_and_open_shapes() {
    for (schema, path) in [
        (shape(), "delivery.webhook"),
        (
            json!({"properties":{"x":{"anyOf":[{"type":"array"},{"properties":{"a":{}}}]}}}),
            "x.a",
        ),
        (
            json!({"properties":{"x":{"anyOf":[{"type":"array"},{"additionalProperties":{}}]}}}),
            "x.some.id",
        ),
        (
            json!({"properties":{"x":{"oneOf":[{"type":"array"},{"properties":{"a":{}}},{"patternProperties":{}}]}}}),
            "x.any",
        ),
        (shape(), "delivery.targets"),
        (Value::Null, "unpublished.path"),
    ] {
        assert!(
            provider::<Config>(
                ConfigurationSettings::new(schema.as_object().cloned())
                    .strict(Strict::paths(path, &[]))
            )
            .inspect()
            .is_ok(),
            "{path}"
        );
    }
}

#[test]
fn strict_schema_paths_fail_on_missing_keys_and_paths_that_can_only_enter_arrays() {
    let missing = provider::<Config>(
        ConfigurationSettings::new(shape().as_object().cloned())
            .strict(Strict::paths("delivry", &[])),
    )
    .inspect()
    .unwrap_err();
    assert!(
        missing
            .message()
            .contains("strict lists delivry, which the configuration schema does not hold.")
    );

    for schema in [
        shape(),
        json!({"properties":{"delivery":{"properties":{"targets":{"anyOf":[
            {"type":"array"}, {"properties":{"other":{}}}
        ]}}}}}),
    ] {
        let fault = provider::<Config>(
            ConfigurationSettings::new(schema.as_object().cloned())
                .strict(Strict::paths("delivery.targets.root", &[])),
        )
        .inspect()
        .unwrap_err();
        let text = fault.message();
        assert!(text.contains("strict lists delivery.targets.root, which passes through the array at delivery.targets."), "{text}");
    }
}

#[tokio::test]
async fn a_provider_read_fails_on_an_unusable_discovered_file_under_any_strict_setting() {
    for strict in [Strict::ALL, Strict::paths("delivery", &[])] {
        let space = Workspace::new();
        space.write(".app.json", "{,}");
        let app = provider::<Config>(
            ConfigurationSettings::new(shape().as_object().cloned()).strict(strict),
        );
        assert_failure(
            space.run().ran_with(&app).await,
            &[
                "Configuration file .app.json is not valid JSON at line 1, column 2. Correct its syntax, or remove it.",
            ],
        );
    }
}

#[tokio::test]
async fn an_unread_variable_file_is_a_strict_failure_and_names_the_available_formats() {
    let space = Workspace::new();
    let opts = || {
        ConfigurationSettings::<Config>::new(None)
            .strict(Strict::ALL)
            .env("APP_CONFIG")
    };
    let run = space.run().env("APP_CONFIG", "unread.yml");
    assert_failure(
        run.ran_with(&provider(opts())).await,
        &[
            "Configuration file unread.yml is YAML, which this application does not read. Supply a JSON file.",
        ],
    );
    #[cfg(feature = "config-toml")]
    assert_failure(
        run.ran_with(&provider(
            opts().formats(&[loomcli_plugins::config::toml::TOML]),
        ))
        .await,
        &[
            "Configuration file unread.yml is YAML, which this application does not read. Supply a JSON or TOML file.",
        ],
    );
}

#[tokio::test]
async fn a_linked_value_that_a_validator_rejects_fails_through_core() {
    let space = Workspace::new();
    space.write(".app.json", r#"{"limits":{"bytes":"many"}}"#);
    let ran = space
        .run()
        .settings(Settings::default().with_strict(Strict::paths("limits", &[])))
        .loud()
        .arg(&["-L"])
        .ran()
        .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        format!(
            "› Read configuration from .app.json.\napp: Option \"--limit\" (from limits.bytes in .app.json): Supply a whole number.\n{HELP_HINT}"
        )
    );
}

#[tokio::test]
async fn a_covered_multiple_option_reports_each_wrong_item_without_debug_lines() {
    let space = Workspace::new();
    space.write(".app.json", r#"{"fields":["a",false,"c",{}]}"#);
    let ran = space
        .run()
        .settings(Settings::default().with_strict(Strict::ALL))
        .loud()
        .arg(&["-L"])
        .ran()
        .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        format!(
            concat!(
                "› Read configuration from .app.json.\n",
                "app: Option \"--fields\" (from fields in .app.json) at 1: Use a string or a number.\n",
                "app: Option \"--fields\" (from fields in .app.json) at 3: Use a string or a number.\n",
                "{}"
            ),
            HELP_HINT
        )
    );
}

#[tokio::test]
async fn a_shape_problem_replaces_core_problems_collected_for_other_options() {
    let space = Workspace::new();
    space.write(".app.json", r#"{"total":"yes","limits":{"bytes":"many"}}"#);
    let ran = space
        .run()
        .settings(Settings::default().with_strict(Strict::ALL))
        .ran()
        .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        format!(
            "app: Option \"--total\" (from total in .app.json): Use true or false.\n{HELP_HINT}"
        )
    );
}

#[tokio::test]
async fn later_candidates_warn_before_the_strict_file_failure() {
    let space = Workspace::new();
    space.write(".app.json", "{,}");
    space.write(".app.jsonc", "{}");
    let ran = space
        .run()
        .ran_with(&provider::<Map<String, Value>>(
            ConfigurationSettings::new(None)
                .file(".app.*")
                .strict(Strict::ALL),
        ))
        .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        concat!(
            "⚠ Skipped .app.jsonc: .app.json matches the same pattern first. Keep one of the files, and remove the others.\n",
            "app: Configuration file .app.json is not valid JSON at line 1, column 2. Correct its syntax, or remove it.\n",
        )
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Required {
    delivery: Option<RequiredDelivery>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct RequiredDelivery {
    webhook: String,
}

#[tokio::test]
async fn a_missing_key_at_a_strict_path_fails_even_when_its_section_is_removed() {
    assert_verbose_failure(
        read::<Required>(
            &json!({"delivery":{}}),
            shape(),
            Strict::paths("delivery.webhook", &[]),
        )
        .await,
        &[
            "Configuration value delivery.webhook in .app.json: Missing key: \"webhook\". Correct the value, or remove it.",
        ],
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct WithDelivery<D> {
    delivery: Option<D>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct BothRequired {
    webhook: String,
    retries: i64,
}

const MISSING_WEBHOOK: &str = "Configuration value delivery.webhook in .app.json: Missing key: \"webhook\". Correct the value, or remove it.";
const MISSING_RETRIES: &str = "Configuration value delivery.retries in .app.json: Missing key: \"retries\". Correct the value, or remove it.";

fn delivery_shape(required: &[&str]) -> Value {
    json!({"properties":{"delivery":{"properties":{
        "webhook":{"type":"string"}, "retries":{"type":"integer"}, "note":{"type":"string"},
        "backoff":{"type":"integer"}
    },"required":required}}})
}

#[tokio::test]
async fn probe_strict_listed_required_key_behind_an_earlier_missing_key() {
    assert_verbose_failure(
        read::<WithDelivery<BothRequired>>(
            &json!({"delivery":{"note":"x"}}),
            delivery_shape(&["webhook", "retries"]),
            Strict::paths("delivery.retries", &[]),
        )
        .await,
        &[MISSING_WEBHOOK],
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct RetriesFirst {
    retries: i64,
    webhook: String,
}

#[tokio::test]
async fn a_listed_required_key_also_fails_when_it_is_reported_first() {
    assert_verbose_failure(
        read::<WithDelivery<RetriesFirst>>(
            &json!({"delivery":{"note":"x"}}),
            delivery_shape(&["retries", "webhook"]),
            Strict::paths("delivery.retries", &[]),
        )
        .await,
        &[MISSING_RETRIES],
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct OptionalRetries {
    webhook: String,
    retries: Option<i64>,
}

#[tokio::test]
async fn an_absent_optional_key_does_not_make_a_sibling_removal_strict() {
    let ran = read::<WithDelivery<OptionalRetries>>(
        &json!({"delivery":{"note":"x"}}),
        delivery_shape(&["webhook"]),
        Strict::paths("delivery.retries", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored delivery in .app.json: Missing key: \"webhook\""]
        )
    );
}

#[tokio::test]
async fn an_optional_key_in_the_only_object_branch_can_be_absent() {
    let schema = json!({
        "properties":{"delivery":{"anyOf":[{"$ref":"#/$defs/Delivery"},{"type":"null"}]}},
        "$defs":{"Delivery":{
            "type":"object","required":["webhook"], "properties":{
                "webhook":{"type":"string"}, "retries":{"type":"integer"}, "note":{"type":"string"}
            }
        }}
    });
    let ran = read::<WithDelivery<OptionalRetries>>(
        &json!({"delivery":{"note":"x"}}),
        schema,
        Strict::paths("delivery.retries", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored delivery in .app.json: Missing key: \"webhook\""]
        )
    );
}

#[tokio::test]
async fn without_json_schema_an_absent_optional_key_fails_when_its_parent_is_removed() {
    assert_verbose_failure(
        read::<WithDelivery<OptionalRetries>>(
            &json!({"delivery":{"note":"x"}}),
            Value::Null,
            Strict::paths("delivery.retries", &[]),
        )
        .await,
        &[MISSING_WEBHOOK],
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct ThreeRequired {
    webhook: String,
    backoff: i64,
    retries: i64,
}

#[tokio::test]
async fn the_third_missing_required_key_covers_the_removal() {
    assert_verbose_failure(
        read::<WithDelivery<ThreeRequired>>(
            &json!({"delivery":{}}),
            delivery_shape(&["webhook", "backoff", "retries"]),
            Strict::paths("delivery.retries", &[]),
        )
        .await,
        &[MISSING_WEBHOOK],
    );
}

/// Published shapes that state a requirement beside a reference, or in one of two object
/// branches, leave it uncertain whether the listed key is optional, so the removal is covered.
#[tokio::test]
async fn a_published_shape_that_leaves_optionality_uncertain_still_covers_the_removal() {
    let section = json!({"properties":{
        "webhook":{"type":"string"}, "retries":{"type":"integer"}, "note":{"type":"string"}
    }});
    let beside_a_reference = json!({"$defs":{"D":section},"properties":{"delivery":{
        "$ref":"#/$defs/D", "required":["retries"]
    }}});
    let beside_an_all_of = json!({"$defs":{"D":section},"properties":{"delivery":{
        "allOf":[{"$ref":"#/$defs/D"}], "required":["retries"]
    }}});
    let two_object_branches = json!({"properties":{"delivery":{"oneOf":[
        {"type":"object","properties":section["properties"]},
        {"type":"object","properties":section["properties"],"required":["webhook","retries"]}
    ]}}});
    for published in [beside_a_reference, beside_an_all_of, two_object_branches] {
        assert_verbose_failure(
            read::<WithDelivery<BothRequired>>(
                &json!({"delivery":{"note":"x"}}),
                published,
                Strict::paths("delivery.retries", &[]),
            )
            .await,
            &[MISSING_WEBHOOK],
        );
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct NestedRequired {
    webhook: String,
    // serde checks the ordinary field before it deserializes the flattened fields.
    #[serde(flatten)]
    rest: TransportSection,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct TransportSection {
    transport: Option<Transport>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Transport {
    retries: i64,
}

#[tokio::test]
async fn a_missing_key_can_cover_a_removal_two_levels_above_it() {
    let schema = json!({"properties":{"delivery":{"required":["webhook"], "properties":{
        "webhook":{"type":"string"},
        "transport":{"required":["retries"], "properties":{"retries":{"type":"integer"}}}
    }}}});
    assert_verbose_failure(
        read::<WithDelivery<NestedRequired>>(
            &json!({"delivery":{"transport":{}}}),
            schema.clone(),
            Strict::paths("delivery.transport.retries", &[]),
        )
        .await,
        &[MISSING_WEBHOOK],
    );
    let ran = read::<WithDelivery<NestedRequired>>(
        &json!({"delivery":{}}),
        schema,
        Strict::paths("delivery.transport.retries", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored delivery in .app.json: Missing key: \"webhook\""]
        )
    );
}

#[tokio::test]
async fn without_json_schema_a_missing_key_covers_a_removal_two_levels_above_it() {
    assert_verbose_failure(
        read::<WithDelivery<NestedRequired>>(
            &json!({"delivery":{"transport":{}}}),
            Value::Null,
            Strict::paths("delivery.transport.retries", &[]),
        )
        .await,
        &[MISSING_WEBHOOK],
    );
}

#[tokio::test]
async fn an_absent_required_parent_does_not_cover_a_listed_child() {
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct RequiredTransport {
        transport: Transport,
    }

    let schema = json!({"type":"object", "properties":{"delivery":{
        "type":"object", "required":["transport"], "properties":{
            "transport":{"type":"object", "required":["retries"], "properties":{
                "retries":{"type":"integer"}
            }}
        }
    }}});
    let ran = read::<WithDelivery<RequiredTransport>>(
        &json!({"delivery":{}}),
        schema,
        Strict::paths("delivery.transport.retries", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored delivery in .app.json: Missing key: \"transport\""]
        )
    );
}

#[tokio::test]
async fn a_non_object_parent_does_not_cover_a_listed_child() {
    let ran = read::<WithDelivery<BothRequired>>(
        &json!({"delivery":false}),
        delivery_shape(&["webhook", "retries"]),
        Strict::paths("delivery.retries", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored delivery in .app.json: Invalid input: expected object, received boolean"]
        )
    );
}

#[tokio::test]
async fn without_json_schema_a_listed_key_hidden_behind_a_missing_sibling_fails() {
    let file = json!({"delivery":{"note":"x"}});
    assert_verbose_failure(
        read::<WithDelivery<BothRequired>>(
            &file,
            Value::Null,
            Strict::paths("delivery.retries", &[]),
        )
        .await,
        &[MISSING_WEBHOOK],
    );
    assert_verbose_failure(
        read::<WithDelivery<BothRequired>>(&file, Value::Null, Strict::ALL).await,
        &[MISSING_WEBHOOK],
    );
}

#[tokio::test]
async fn whole_file_strict_fails_on_the_first_of_two_missing_keys() {
    assert_verbose_failure(
        read::<WithDelivery<BothRequired>>(
            &json!({"delivery":{"note":"x"}}),
            delivery_shape(&["webhook", "retries"]),
            Strict::ALL,
        )
        .await,
        &[MISSING_WEBHOOK],
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct RequiredRetries {
    webhook: Option<String>,
    retries: i64,
}

#[tokio::test]
async fn a_listed_missing_key_still_fails_after_an_optional_sibling_is_rejected() {
    let ran = read::<WithDelivery<RequiredRetries>>(
        &json!({"delivery":{"webhook":false}}),
        delivery_shape(&["retries"]),
        Strict::paths("delivery.retries", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        format!(
            "› Read configuration from .app.json.\n› Ignored delivery.webhook in .app.json: Invalid input: expected string, received boolean\napp: {MISSING_RETRIES}\n"
        )
    );
}

#[tokio::test]
async fn a_rejected_required_sibling_reports_its_original_issue_under_listed_strict() {
    let file = json!({"delivery":{"webhook":false}});
    let schema = delivery_shape(&["webhook", "retries"]);
    for published in [schema.clone(), Value::Null] {
        assert_verbose_failure(
            read::<WithDelivery<BothRequired>>(
                &file,
                published,
                Strict::paths("delivery.retries", &[]),
            )
            .await,
            &[
                "Configuration value delivery.webhook in .app.json: Invalid input: expected string, received boolean. Correct the value, or remove it.",
            ],
        );
    }
    assert_verbose_failure(
        read::<WithDelivery<BothRequired>>(&file, schema, Strict::ALL).await,
        &[
            "Configuration value delivery.webhook in .app.json: Invalid input: expected string, received boolean. Correct the value, or remove it.",
            MISSING_WEBHOOK,
        ],
    );
}

#[tokio::test]
async fn a_dropped_listed_value_keeps_its_original_issue() {
    let ran = read::<WithDelivery<BothRequired>>(
        &json!({"delivery":{"retries":"many"}}),
        delivery_shape(&["webhook", "retries"]),
        Strict::paths("delivery.retries", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        concat!(
            "› Read configuration from .app.json.\n",
            "› Ignored delivery in .app.json: Missing key: \"webhook\"\n",
            "app: Configuration value delivery.retries in .app.json: Invalid input: expected int, received string. Correct the value, or remove it.\n",
        )
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Refined {
    delivery: Option<RefinedDelivery>,
}

#[derive(Deserialize)]
#[serde(try_from = "Map<String, Value>")]
struct RefinedDelivery;

impl TryFrom<Map<String, Value>> for RefinedDelivery {
    type Error = &'static str;

    fn try_from(fields: Map<String, Value>) -> Result<Self, Self::Error> {
        if fields.contains_key("retries") {
            Err("Supply backoff for retries.\nTry again.")
        } else {
            Ok(Self)
        }
    }
}

#[tokio::test]
async fn an_ancestor_removal_fails_only_when_it_discards_the_listed_value() {
    let strict = || Strict::paths("delivery.webhook", &[]);
    assert_verbose_failure(
        read::<Refined>(
            &json!({"delivery":{"retries":3,"webhook":"keep"}}),
            shape(),
            strict(),
        )
        .await,
        &[
            r"Configuration value delivery in .app.json: Supply backoff for retries.\u000aTry again. Correct the value, or remove it.",
        ],
    );
    for (value, issue) in [
        (
            json!({"retries":3}),
            r"Supply backoff for retries.\u000aTry again.",
        ),
        (json!(5), "Invalid input: expected object, received number"),
    ] {
        let ran = read::<Refined>(&json!({"delivery":value}), shape(), strict()).await;
        assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
        assert_eq!(
            ran.stderr,
            read_wrong(
                ".app.json",
                &[&format!("Ignored delivery in .app.json: {issue}")]
            )
        );
    }
}

#[derive(Deserialize)]
#[serde(try_from = "Map<String, Value>")]
struct RefinedFile<const STOP: char = '.'>;

impl<const STOP: char> TryFrom<Map<String, Value>> for RefinedFile<STOP> {
    type Error = String;

    fn try_from(fields: Map<String, Value>) -> Result<Self, Self::Error> {
        if fields.contains_key("delivery") {
            Err(format!("Check the delivery settings{STOP}"))
        } else {
            Ok(Self)
        }
    }
}

#[tokio::test]
async fn a_top_level_refinement_names_the_file_and_does_not_add_a_second_period() {
    for strict in [Strict::ALL, Strict::paths("delivery.webhook", &[])] {
        assert_verbose_failure(
            read::<RefinedFile>(&json!({"delivery":{"webhook":"keep"}}), shape(), strict).await,
            &[
                "Configuration file .app.json: Check the delivery settings. Correct the file, or remove it.",
            ],
        );
    }
    let ran = read::<RefinedFile>(
        &json!({"delivery":{"retries":3}}),
        shape(),
        Strict::paths("delivery.webhook", &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &["Ignored every key in .app.json: Check the delivery settings."]
        )
    );
}

#[tokio::test]
async fn strict_failure_keeps_a_final_exclamation_mark() {
    let file = json!({"delivery":{"webhook":"keep"}});
    assert_verbose_failure(
        read::<RefinedFile<'!'>>(&file, shape(), Strict::ALL).await,
        &[
            "Configuration file .app.json: Check the delivery settings! Correct the file, or remove it.",
        ],
    );
}

#[tokio::test]
async fn strict_failure_keeps_a_final_question_mark() {
    let file = json!({"delivery":{"webhook":"keep"}});
    assert_verbose_failure(
        read::<RefinedFile<'?'>>(&file, shape(), Strict::ALL).await,
        &[
            "Configuration file .app.json: Check the delivery settings? Correct the file, or remove it.",
        ],
    );
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Owner {
    id: String,
}

#[tokio::test]
async fn strict_holds_rejections_found_only_after_an_earlier_removal() {
    // Use an optional owner table so the type still accepts an empty file.
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct OwnerFile {
        owners: Option<std::collections::BTreeMap<String, Owner>>,
    }
    assert_verbose_failure(
        read::<OwnerFile>(
            &json!({"owners":{"alpha":{"id":5}}}),
            Value::Null,
            Strict::ALL,
        )
        .await,
        &[
            "Configuration value owners.alpha.id in .app.json: Invalid input: expected string, received number. Correct the value, or remove it.",
            "Configuration value owners.alpha.id in .app.json: Missing key: \"id\". Correct the value, or remove it.",
        ],
    );
}

fn problems_view() -> loomcli_core::ViewOverride {
    use loomcli_core::{FailureView, InputError, InputProblem, failure, override_view};

    override_view(
        failure::<InputError>(),
        FailureView::new(|error: &InputError, _| {
            let problems: Vec<Value> = error
                .problems()
                .iter()
                .map(|problem| {
                    if let InputProblem::Invalid {
                        input,
                        spelling,
                        issues,
                    } = problem
                    {
                        json!({
                            "input": input,
                            "reason": "invalid",
                            "spelling": spelling,
                            "issues": issues.iter().map(|issue| if issue.path.is_empty() {
                                json!({"message": issue.message})
                            } else {
                                json!({"message": issue.message, "path": issue.path})
                            }).collect::<Vec<_>>(),
                        })
                    } else {
                        Value::Null
                    }
                })
                .collect();
            json!({"message": error.message(),"problems":problems}).to_string()
        }),
    )
}

fn file_problem(spelling: &str, lines: &[&str]) -> Value {
    json!({
        "input": {"global":true,"kind":"option","name":"config"},
        "reason":"invalid","spelling":spelling,
        "issues":lines.iter().map(|message| json!({"message":message})).collect::<Vec<_>>(),
    })
}

#[tokio::test]
async fn a_source_failure_puts_the_file_before_the_linked_global_problem() {
    use loomcli_core::InvocationValues;
    use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};

    let space = Workspace::new();
    space.write(
        ".app.json",
        r#"{"delivery":{"retries":"many"},"flag":"yes"}"#,
    );
    let schema = json!({"properties":{"delivery":{"properties":{"retries":{"type":"integer"}}},"flag":{"type":"boolean"}}});
    let config = configuration::<Config>(
        ConfigurationSettings::new(schema.as_object().cloned()).strict(Strict::ALL),
    );
    let app = Application::new("app")
        .plugins([config.plugin])
        .global_option(
            "flag",
            Opt::boolean().extend([CONFIG_INPUT.value(ConfigInputFacts::path("flag"))]),
        )
        .overrides([problems_view()])
        .action(|_| async { Ok(()) });

    let expected_file = "Configuration value delivery.retries in .app.json: Invalid input: expected int, received string. Correct the value, or remove it.";
    let ran = space.run().ran_with(&app).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    let parsed: Value = serde_json::from_str(&ran.stderr).unwrap();
    assert_eq!(
        parsed,
        json!({
            "message":format!("{expected_file}\nOption \"--flag\" (from flag in .app.json): Use true or false."),
            "problems":[
                file_problem("--config", &[expected_file]),
                {"input":{"global":true,"kind":"option","name":"flag"},"reason":"invalid","spelling":"--flag","issues":[{"message":"Use true or false."}]},
            ],
        })
    );

    let (status, output, text) = space
        .run()
        .invoked_with(&app, InvocationValues::new())
        .await;
    assert_eq!((status, output.as_str()), (Some(2), ""));
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        parsed["problems"][0],
        file_problem("config", &[expected_file])
    );
    assert_eq!(parsed["problems"][1]["spelling"], "flag");
}

#[tokio::test]
async fn a_provider_file_failure_has_one_file_problem_with_escaped_issues() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        r#"{"state\u001bDir":1,"state\u200bDir":2,"delivery":{"retries":"many"}}"#,
    );
    let app = provider_with_view::<Config>(
        ConfigurationSettings::new(shape().as_object().cloned()).strict(Strict::ALL),
        Some(problems_view()),
    );
    let ran = space.run().ran_with(&app).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    let lines = [
        "Configuration value delivery.retries in .app.json: Invalid input: expected int, received string. Correct the value, or remove it.",
        r"Unknown key state\u001bDir in .app.json. Check its spelling, or remove it.",
        r#"Unknown key "stateU+200BDir" in .app.json. Check its spelling, or remove it."#,
    ];
    assert_eq!(
        serde_json::from_str::<Value>(&ran.stderr).unwrap(),
        json!({
            "message":lines.join("\n"), "problems":[file_problem("--config", &lines)],
        })
    );
}

#[tokio::test]
async fn a_linked_arity_option_rejects_a_wrong_length_under_strict() {
    use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
    let space = Workspace::new();
    space.write(".app.json", r#"{"size":[10]}"#);
    let config = configuration::<Map<String, Value>>(
        ConfigurationSettings::new(None).strict(Strict::paths("size", &[])),
    );
    let app = Application::new("app")
        .plugins([config.plugin])
        .option(
            "size",
            Opt::string()
                .arity(2)
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("size"))]),
        )
        .action(|_| async { Ok(()) });
    assert_failure(
        space.run().ran_with(&app).await,
        &["Option \"--size\" (from size in .app.json): Use an array of 2 strings or numbers."],
    );
}

#[tokio::test]
async fn a_global_link_is_strict_on_a_child_and_higher_tiers_win() {
    use loomcli_core::Command;
    use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
    let space = Workspace::new();
    space.write(".app.json", r#"{"limits":{"bytes":"many"}}"#);
    let config =
        configuration::<Map<String, Value>>(ConfigurationSettings::new(None).strict(Strict::ALL));
    let app = Application::new("app")
        .plugins([config.plugin])
        .global_option(
            "limit",
            Opt::string()
                .env(["APP_LIMIT"])
                .validate(config_support::Digits)
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("limits.bytes"))]),
        )
        .command(
            Command::new("sources")
                .action(|context| async move { context.out.print("sources").await }),
        )
        .action(|_| async { Ok(()) });
    assert_failure(
        space.run().arg(&["sources"]).ran_with(&app).await,
        &["Option \"--limit\" (from limits.bytes in .app.json): Supply a whole number."],
    );
    for ran in [
        space
            .run()
            .arg(&["--limit", "3", "sources"])
            .ran_with(&app)
            .await,
        space
            .run()
            .arg(&["sources"])
            .env("APP_LIMIT", "3")
            .ran_with(&app)
            .await,
    ] {
        assert_eq!(
            (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
            (0, "sources\n", "")
        );
    }
}

#[tokio::test]
async fn discovered_wrong_top_level_and_unreadable_paths_have_their_own_fixes() {
    let space = Workspace::new();
    let app = provider::<Config>(ConfigurationSettings::new(None).strict(Strict::ALL));
    space.write(".app.json", "[]");
    assert_failure(
        space.run().ran_with(&app).await,
        &[
            "Configuration file .app.json does not hold a JSON object. Write its settings as one JSON object, or remove it.",
        ],
    );
    let directory = space.project.join(".app.json");
    std::fs::remove_file(&directory).unwrap();
    std::fs::create_dir(&directory).unwrap();
    assert_failure(
        space.run().ran_with(&app).await,
        &["Configuration file .app.json could not be read. Make it readable, or remove it."],
    );
}

#[tokio::test]
async fn a_broken_variable_file_fails_while_a_missing_variable_file_stays_silent() {
    let space = Workspace::new();
    space.write("bad.json", "{,}");
    let app = provider::<Config>(
        ConfigurationSettings::new(None)
            .strict(Strict::ALL)
            .env("APP_CONFIG"),
    );
    assert_failure(
        space
            .run()
            .env("APP_CONFIG", "bad.json")
            .ran_with(&app)
            .await,
        &[
            "Configuration file bad.json is not valid JSON at line 1, column 2. Correct its syntax, or remove it.",
        ],
    );
    let absent = space
        .run()
        .env("APP_CONFIG", "missing.json")
        .ran_with(&app)
        .await;
    assert_eq!(
        (
            absent.status,
            absent.stdout.as_str(),
            absent.stderr.as_str()
        ),
        (0, "ran\n", "")
    );
}

#[tokio::test]
async fn absent_and_disabled_configuration_are_allowed_with_strict() {
    let space = Workspace::new();
    let app = provider::<Config>(ConfigurationSettings::new(None).strict(Strict::ALL));
    let missing = space.run().ran_with(&app).await;
    assert_eq!(
        (
            missing.status,
            missing.stdout.as_str(),
            missing.stderr.as_str()
        ),
        (0, "ran\n", "")
    );
    space.write(".app.json", "{,}");
    let disabled = space.run().arg(&["--no-config"]).ran_with(&app).await;
    assert_eq!(
        (
            disabled.status,
            disabled.stdout.as_str(),
            disabled.stderr.as_str()
        ),
        (0, "ran\n", "")
    );
}

#[tokio::test]
async fn a_broken_discovered_file_warns_with_strict_off_and_a_named_file_fails_as_usual() {
    let space = Workspace::new();
    space.write(".app.json", "{,}");
    let off = space
        .run()
        .ran_with(&provider::<Config>(ConfigurationSettings::new(None)))
        .await;
    assert_eq!((off.status, off.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        off.stderr,
        "⚠ Skipped .app.json: the file is not valid JSON at line 1, column 2, so this run reads no configuration. Correct its syntax, or remove it.\n"
    );
    let app = provider::<Config>(ConfigurationSettings::new(None).strict(Strict::ALL));
    assert_failure(
        space
            .run()
            .arg(&["--config", ".app.json"])
            .ran_with(&app)
            .await,
        &[
            "Option \"--config\": File \".app.json\" is not valid JSON at line 1, column 2. Correct its syntax, or supply another file.",
        ],
    );
    assert_failure(
        space
            .run()
            .arg(&["--config", "absent.json"])
            .ran_with(&app)
            .await,
        &[
            "Option \"--config\": File \"absent.json\" does not exist. Supply the path of an existing file.",
        ],
    );
}

#[cfg(feature = "config-toml")]
#[tokio::test]
async fn a_broken_toml_file_keeps_its_format_position_and_fix_under_strict() {
    let space = Workspace::new();
    space.write(".app.toml", "title = ");
    let settings = ConfigurationSettings::<Config>::new(None)
        .strict(Strict::ALL)
        .file(".app.toml")
        .formats(&[loomcli_plugins::config::toml::TOML]);
    assert_failure(
        space.run().ran_with(&provider(settings)).await,
        &[
            "Configuration file .app.toml is not valid TOML at line 1, column 9. Correct its syntax, or remove it.",
        ],
    );
}

#[cfg(feature = "config-yaml")]
#[tokio::test]
async fn a_broken_yaml_file_in_the_user_folder_fails_as_a_yaml_file() {
    let space = Workspace::new();
    let file = space.write_in(&space.home, ".config/app/config.yaml", "- just\n- items\n");
    let settings = ConfigurationSettings::<Config>::new(None)
        .strict(Strict::paths("delivery", &[]))
        .file(".app.yaml")
        .formats(&[loomcli_plugins::config::yaml::YAML]);
    let expected = format!(
        "Configuration file {} does not hold a YAML mapping. Write its settings as one YAML mapping, or remove it.",
        file.display()
    );
    assert_failure(
        space.run().ran_with(&provider(settings)).await,
        &[&expected],
    );
}

#[tokio::test]
async fn a_rejected_key_with_a_newline_keeps_the_failure_on_one_line() {
    type Numeric = std::collections::BTreeMap<String, f64>;
    assert_verbose_failure(
        read::<Numeric>(&json!({"a\nb":"x"}), Value::Null, Strict::ALL).await,
        &[
            r"Configuration value a\u000ab in .app.json: Invalid input: expected number, received string. Correct the value, or remove it.",
        ],
    );
}

#[tokio::test]
async fn an_object_branch_of_an_array_or_object_schema_admits_and_covers_a_path() {
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct UnionFile {
        x: Option<Section>,
    }
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Section {
        a: Option<i64>,
    }
    let schema = json!({"properties":{"x":{"anyOf":[
        {"type":"array"}, {"properties":{"a":{"type":"integer"}}}
    ]}}});
    assert_verbose_failure(
        read::<UnionFile>(&json!({"x":{"a":"bad"}}), schema, Strict::paths("x.a", &[])).await,
        &[
            "Configuration value x.a in .app.json: Invalid input: expected int, received string. Correct the value, or remove it.",
        ],
    );
}

#[tokio::test]
async fn a_broken_file_has_one_issue_and_uses_the_config_name_in_named_invocations() {
    use loomcli_core::InvocationValues;
    let space = Workspace::new();
    space.write(".app.json", "{,}");
    let app = provider_with_view::<Config>(
        ConfigurationSettings::new(None).strict(Strict::ALL),
        Some(problems_view()),
    );
    let (status, output, messages) = space
        .run()
        .invoked_with(&app, InvocationValues::new())
        .await;
    assert_eq!((status, output.as_str()), (Some(2), ""));
    let parsed: Value = serde_json::from_str(&messages).unwrap();
    let line = "Configuration file .app.json is not valid JSON at line 1, column 2. Correct its syntax, or remove it.";
    assert_eq!(
        parsed,
        json!({"message":line,"problems":[file_problem("config", &[line])]})
    );
}
