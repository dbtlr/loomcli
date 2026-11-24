//! Ports the run cases of `option-groups.test.ts`: each group kind checked against the supplied
//! members, defaults that satisfy no group, group problems beside value problems in declaration
//! order, the tiers an exclusive group decides by, and a configuration member a skipped source
//! leaves unanswered. The configuration tier runs through `__private::install_source`, the slot a
//! plugin's source claims.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use loomcli_core::__private::{SourceProbe, install_source};
use loomcli_core::{
    Application, Command, Context, Done, Error, Extension, NoInputs, NoResult, Opt, OptionTarget,
    Polarity, SourceAnswer, SourceValue,
};
use loomcli_testing::MockFields;
use serde_json::{Value, json};
use support::validators::{Digits, Echo, OneOf, calls, seen};
use support::{Ran, fields, record_json, run_with, values_json};

type App = Application<NoInputs, NoResult, Done>;

async fn action(ctx: Context) -> loomcli_core::Outcome {
    ctx.out.print("action").await
}

/// `fixtures/option-groups.mjs`: an `export` Command whose two Boolean options form one group.
fn grouped(kind: &str) -> Application<NoInputs, NoResult, loomcli_core::Group> {
    let command = Command::new("export")
        .description("Export a document.")
        .option("json", Opt::boolean().description("JSON output."))
        .option("yaml", Opt::boolean().description("YAML output."));
    let command = match kind {
        "exclusive" => command.exclusive(&["json", "yaml"]),
        "oneRequired" => command.one_required(&["json", "yaml"]),
        _ => command.required_together(&["json", "yaml"]),
    };
    Application::new("groups")
        .description("Group probe.")
        .command(command.action(action))
}

#[tokio::test]
async fn exclusive_supplied_options_fail_before_the_action_with_one_group_problem() {
    assert_eq!(
        run_with(&grouped("exclusive"), fields(&["export", "--json", "--yaml"], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "groups: Options \"--json\" and \"--yaml\" cannot be used together. Supply only one of them.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn each_group_kind_checks_its_supplied_members() {
    for (kind, words, code) in [
        ("exclusive", &[][..], 0),
        ("exclusive", &["--json"], 0),
        ("oneRequired", &[], 2),
        ("oneRequired", &["--yaml"], 0),
        ("oneRequired", &["--json", "--yaml"], 0),
        ("requiredTogether", &[], 0),
        ("requiredTogether", &["--json"], 2),
        ("requiredTogether", &["--json", "--yaml"], 0),
    ] {
        let argv: Vec<&str> = std::iter::once("export")
            .chain(words.iter().copied())
            .collect();
        let ran = run_with(&grouped(kind), fields(&argv, &[])).await;
        assert_eq!(ran.status, code, "{kind} {words:?}: {}", ran.stderr);
        assert_eq!(
            ran.stdout,
            if code == 0 { "action\n" } else { "" },
            "{kind} {words:?}"
        );
    }
    let ran = run_with(&grouped("oneRequired"), fields(&["export"], &[])).await;
    assert_eq!(
        ran.stderr,
        "groups: One of options \"--json\" and \"--yaml\" is required. Supply at least one of them.\n"
    );
    let ran = run_with(
        &grouped("requiredTogether"),
        fields(&["export", "--json"], &[]),
    )
    .await;
    assert_eq!(
        ran.stderr,
        "groups: Options \"--json\" and \"--yaml\" must be supplied together. Supply all of them, or none.\n"
    );
}

#[tokio::test]
async fn defaults_do_not_satisfy_groups_and_combined_groups_express_exactly_one() {
    let app = Application::new("groups")
        .option("first", Opt::string().default("default"))
        .option("second", Opt::string())
        .exclusive(&["first", "second"])
        .one_required(&["first", "second"])
        .action(action);
    let absent = run_with(&app, fields(&[], &[])).await;
    assert_eq!(absent.status, 2);
    assert!(absent.stderr.contains("Supply at least one of them."));
    assert_eq!(
        run_with(&app, fields(&["--first", "chosen"], &[]))
            .await
            .status,
        0
    );
    assert_eq!(
        run_with(
            &app,
            fields(&["--first", "chosen", "--second", "other"], &[])
        )
        .await
        .status,
        2
    );
}

#[tokio::test]
async fn invalid_values_and_group_problems_report_together_in_declaration_order() {
    let app = Application::new("groups")
        .option("first", Opt::string().validate(Digits("Supply digits.")))
        .option("second", Opt::string())
        .option("c", Opt::string())
        .exclusive(&["first", "second"])
        .required_together(&["first", "c"])
        .action(action);
    assert_eq!(
        run_with(&app, fields(&["--first", "bad", "--second", "2"], &[]))
            .await
            .stderr,
        "groups: Option \"--first\": Supply digits.\n\
         groups: Options \"--first\" and \"--second\" cannot be used together. Supply only one of them.\n\
         groups: Options \"--first\" and \"--c\" must be supplied together. Supply all of them, or none.\n"
    );
}

#[tokio::test]
async fn environment_values_satisfy_required_groups_and_lose_to_a_typed_sibling() {
    let app = Application::new("groups")
        .option("first", Opt::string().env(["GROUP_FIRST"]))
        .option("second", Opt::string())
        .one_required(&["first", "second"])
        .exclusive(&["first", "second"])
        .action(action);
    let env = [("GROUP_FIRST", "configured")];
    assert_eq!(run_with(&app, fields(&[], &env)).await.status, 0);
    assert_eq!(
        run_with(&app, fields(&["--second", "typed"], &env))
            .await
            .status,
        0
    );
}

#[tokio::test]
async fn a_source_filled_false_zero_or_empty_member_never_fails_beside_a_typed_sibling() {
    let bound = || TIERS_KEY.value("first".to_owned());
    let cases: Vec<(&str, loomcli_core::OptionDecl, SourceValue)> = vec![
        (
            "false",
            Opt::boolean().extend([bound()]).into(),
            SourceValue::Bool(false),
        ),
        (
            "0",
            Opt::count().extend([bound()]).into(),
            SourceValue::Number(0.0),
        ),
        (
            "[]",
            Opt::string().multiple().extend([bound()]).into(),
            SourceValue::List(Vec::new()),
        ),
    ];
    for (label, first, value) in cases {
        let app = tiers_source(
            Application::new("groups")
                .option("first", first)
                .option("second", Opt::string())
                .exclusive(&["first", "second"])
                .action(action),
            vec![("first", value)],
            None,
        );
        assert_eq!(
            run_with(&app, fields(&["--second", "typed"], &[])).await,
            Ran {
                status: 0,
                stdout: "action\n".to_owned(),
                stderr: String::new(),
            },
            "{label}"
        );
    }
}

#[tokio::test]
async fn piped_stdin_attaches_content_but_is_not_a_supplied_option_for_a_group() {
    let content = |kind: &str| {
        let app = Application::new("groups")
            .option(
                "file",
                Opt::content().description("Read a file or stdin.").stdin(),
            )
            .option("url", Opt::string().description("Read a URL."));
        let app = match kind {
            "exclusive" => app.exclusive(&["file", "url"]),
            "oneRequired" => app.one_required(&["file", "url"]),
            _ => app.required_together(&["file", "url"]),
        };
        app.action(|ctx: Context| async move {
            let file: Option<loomcli_core::Content> = ctx.option("file")?;
            let kind = match file.map(|file| file.kind) {
                Some(loomcli_core::ContentKind::Stdin) => "stdin",
                Some(_) => "file",
                None => "absent",
            };
            ctx.out.print(kind).await
        })
    };
    let piped = |argv: &[&str]| MockFields::new().argv(argv.iter().copied()).stdin("piped");
    assert_eq!(
        run_with(&content("oneRequired"), piped(&[])).await.status,
        2
    );
    assert_eq!(
        run_with(
            &content("exclusive"),
            piped(&["--url", "https://example.test"])
        )
        .await,
        Ran {
            status: 0,
            stdout: "stdin\n".to_owned(),
            stderr: String::new(),
        }
    );
    assert_eq!(
        run_with(
            &content("requiredTogether"),
            piped(&["--url", "https://example.test"])
        )
        .await
        .status,
        2
    );
    let manifest = env!("CARGO_MANIFEST_PATH");
    assert_eq!(
        run_with(&content("oneRequired"), fields(&["--file", manifest], &[]))
            .await
            .status,
        0
    );
}

#[tokio::test]
async fn a_withdrawn_member_is_never_validated() {
    let validated = calls();
    let app = Application::new("export")
        .option(
            "file",
            Opt::string()
                .description("Write to a file.")
                .env(["EXPORT_FILE"])
                .validate(Echo {
                    label: "file",
                    calls: Arc::clone(&validated),
                }),
        )
        .option("yaml", Opt::boolean().description("Write YAML."))
        .exclusive(&["file", "yaml"])
        .action(action);
    let ran = run_with(&app, fields(&["--yaml"], &[("EXPORT_FILE", "out.txt")])).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    assert!(seen(&validated).is_empty());
}

// The tiered application: three Boolean options with polarity both, two bound to variables and
// all three to a configuration key, under the groups each case declares.

const TIERS_KEY: Extension<OptionTarget, String> = Extension::new("@test/tiers/key");

/// One group over the tiered application's options.
type Rule = (&'static str, &'static [&'static str]);

const JSON_OR_YAML: &[Rule] = &[("exclusive", &["json", "yaml"])];

/// What one run of the tiered application saw: its status, its stderr, and what the action read.
struct Tiered {
    status: u8,
    stderr: String,
    seen: Vec<Value>,
}

/// A configuration source that answers `answers`, each labeled as a key in `tiers.json`, from the
/// directory a case names.
fn tiers_source<S: loomcli_core::State>(
    application: Application<NoInputs, NoResult, S>,
    answers: Vec<(&'static str, SourceValue)>,
    directory: Option<&'static str>,
) -> Application<NoInputs, NoResult, S> {
    install_source(
        application,
        "@test/tiers",
        &TIERS_KEY,
        &[],
        move |_probe: SourceProbe| {
            let answers: BTreeMap<String, SourceAnswer> = answers
                .iter()
                .map(|(name, value)| {
                    let answer = SourceAnswer::new(value.clone(), format!("{name} in tiers.json"));
                    let answer = match directory {
                        Some(directory) => answer.directory(directory),
                        None => answer,
                    };
                    ((*name).to_owned(), answer)
                })
                .collect();
            std::future::ready(Ok::<_, Error>(answers))
        },
    )
}

fn tiered_application(
    answers: &[(&'static str, bool)],
    rules: &[Rule],
    seen: &Arc<Mutex<Vec<Value>>>,
) -> App {
    let bound = |name: &str, env: Option<&str>| {
        let option = Opt::boolean()
            .polarity(Polarity::Both)
            .extend([TIERS_KEY.value(name.to_owned())]);
        match env {
            Some(env) => option.env([env]),
            None => option,
        }
    };
    let mut app = Application::new("export")
        .option(
            "json",
            bound("json", Some("EXPORT_JSON")).description("Write JSON."),
        )
        .option(
            "yaml",
            bound("yaml", Some("EXPORT_YAML")).description("Write YAML."),
        )
        .option(
            "plain",
            bound("plain", None).description("Write plain text."),
        );
    for (kind, members) in rules {
        app = match *kind {
            "exclusive" => app.exclusive(members),
            "oneRequired" => app.one_required(members),
            _ => app.required_together(members),
        };
    }
    let recorded = Arc::clone(seen);
    let app = app.action(move |ctx: Context| {
        if let Ok(mut seen) = recorded.lock() {
            seen.push(json!({
                "options": values_json(&ctx)["options"],
                "supplied": record_json(&ctx.supplied.options),
            }));
        }
        async { Ok(()) }
    });
    tiers_source(
        app,
        answers
            .iter()
            .map(|(name, value)| (*name, SourceValue::Bool(*value)))
            .collect(),
        None,
    )
}

async fn tiered(
    argv: &[&str],
    env: &[(&str, &str)],
    answers: &[(&'static str, bool)],
    rules: &[Rule],
) -> Tiered {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let ran = run_with(
        &tiered_application(answers, rules, &seen),
        fields(argv, env),
    )
    .await;
    let seen = seen.lock().map(|seen| seen.clone()).unwrap_or_default();
    Tiered {
        status: ran.status,
        stderr: ran.stderr,
        seen,
    }
}

fn options(result: &Tiered) -> &Value {
    &result.seen[0]["options"]
}

#[tokio::test]
async fn a_typed_member_wins_over_a_configured_sibling_which_reads_unsupplied() {
    let result = tiered(&["--yaml"], &[], &[("json", true)], JSON_OR_YAML).await;
    assert_eq!(result.status, 0, "{}", result.stderr);
    assert_eq!(
        json!([options(&result)["json"], options(&result)["yaml"]]),
        json!([false, true])
    );
    assert_eq!(result.seen[0]["supplied"], json!({ "yaml": true }));
}

#[tokio::test]
async fn a_typed_member_wins_over_a_bound_variable_of_a_sibling() {
    let result = tiered(&["--yaml"], &[("EXPORT_JSON", "1")], &[], JSON_OR_YAML).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        json!([options(&result)["json"], options(&result)["yaml"]]),
        json!([false, true])
    );
}

#[tokio::test]
async fn an_environment_member_wins_over_a_configured_sibling() {
    let result = tiered(
        &[],
        &[("EXPORT_JSON", "1")],
        &[("yaml", true)],
        JSON_OR_YAML,
    )
    .await;
    assert_eq!(result.status, 0);
    assert_eq!(
        json!([options(&result)["json"], options(&result)["yaml"]]),
        json!([true, false])
    );
    assert!(result.seen[0]["supplied"].get("yaml").is_none());
}

#[tokio::test]
async fn members_one_tier_supplied_still_conflict_and_the_diagnostic_names_each_source() {
    let typed = tiered(&["--json", "--yaml"], &[], &[], JSON_OR_YAML).await;
    assert_eq!(typed.status, 2);
    assert!(typed.stderr.contains("cannot be used together"));
    let bound = tiered(
        &[],
        &[("EXPORT_JSON", "1"), ("EXPORT_YAML", "1")],
        &[],
        JSON_OR_YAML,
    )
    .await;
    assert_eq!(bound.status, 2);
    assert!(
        bound
            .stderr
            .contains("\"--json\" (from EXPORT_JSON) and \"--yaml\" (from EXPORT_YAML)")
    );
    let configured = tiered(&[], &[], &[("json", true), ("yaml", true)], JSON_OR_YAML).await;
    assert_eq!(configured.status, 2);
    assert!(
        configured
            .stderr
            .contains("\"--json\" (from json in tiers.json)")
    );
    assert!(
        configured
            .stderr
            .contains("\"--yaml\" (from yaml in tiers.json)")
    );
}

#[tokio::test]
async fn one_required_is_satisfied_by_a_configured_member() {
    let rules: &[Rule] = &[("oneRequired", &["json", "yaml"])];
    assert_eq!(tiered(&[], &[], &[("json", true)], rules).await.status, 0);
    assert_eq!(tiered(&[], &[], &[], rules).await.status, 2);
}

#[tokio::test]
async fn a_required_together_group_that_holds_a_withdrawn_member_is_not_checked() {
    let rules: &[Rule] = &[
        ("exclusive", &["json", "yaml"]),
        ("requiredTogether", &["json", "plain"]),
    ];
    let both = tiered(&["--yaml", "--plain"], &[], &[("json", true)], rules).await;
    assert_eq!(both.status, 0);
    assert_eq!(
        json!([
            options(&both)["json"],
            options(&both)["plain"],
            options(&both)["yaml"]
        ]),
        json!([false, true, true])
    );
    let alone = tiered(&["--yaml"], &[], &[("json", true)], rules).await;
    assert_eq!(alone.status, 0);
    assert_eq!(
        json!([
            options(&alone)["json"],
            options(&alone)["plain"],
            options(&alone)["yaml"]
        ]),
        json!([false, false, true])
    );
    let together = tiered(&["--yaml"], &[], &[("json", true), ("plain", true)], rules).await;
    assert_eq!(together.status, 0);
    assert_eq!(together.seen[0]["supplied"]["plain"], json!(true));
    // With no withdrawn member the group is still checked.
    let checked = tiered(&[], &[], &[("json", true)], rules).await;
    assert_eq!(checked.status, 2);
    assert!(
        checked
            .stderr
            .contains("\"--json\" (from json in tiers.json) and \"--plain\" must be")
    );
}

#[tokio::test]
async fn a_member_in_two_exclusive_groups_withdraws_when_either_holds_a_higher_tier() {
    let forward: &[Rule] = &[
        ("exclusive", &["json", "yaml"]),
        ("exclusive", &["yaml", "plain"]),
    ];
    let backward: &[Rule] = &[
        ("exclusive", &["yaml", "plain"]),
        ("exclusive", &["json", "yaml"]),
    ];
    for rules in [forward, backward] {
        let result = tiered(
            &["--json"],
            &[("EXPORT_YAML", "1")],
            &[("plain", true)],
            rules,
        )
        .await;
        assert_eq!(result.status, 0, "{}", result.stderr);
        assert_eq!(
            json!([
                options(&result)["json"],
                options(&result)["plain"],
                options(&result)["yaml"]
            ]),
            json!([true, false, false])
        );
    }
}

#[tokio::test]
async fn a_variable_outside_the_grammar_beside_a_typed_sibling_is_not_reported() {
    let result = tiered(&["--yaml"], &[("EXPORT_JSON", "maybe")], &[], JSON_OR_YAML).await;
    assert_eq!(result.status, 0);
    let bound = tiered(
        &[],
        &[("EXPORT_JSON", "maybe"), ("EXPORT_YAML", "1")],
        &[],
        JSON_OR_YAML,
    )
    .await;
    assert_eq!(bound.status, 2);
    assert!(bound.stderr.contains("EXPORT_JSON"));
    // Beside a false typed sibling, which claims nothing, it is still reported.
    let false_sibling = tiered(
        &["--no-yaml"],
        &[("EXPORT_JSON", "maybe")],
        &[],
        JSON_OR_YAML,
    )
    .await;
    assert_eq!(false_sibling.status, 2);
    assert!(false_sibling.stderr.contains("EXPORT_JSON"));
    // It satisfies no other group.
    let rules: &[Rule] = &[
        ("exclusive", &["json", "yaml"]),
        ("oneRequired", &["json", "plain"]),
    ];
    let other = tiered(&["--yaml"], &[("EXPORT_JSON", "maybe")], &[], rules).await;
    assert_eq!(other.status, 2);
    assert!(
        other
            .stderr
            .contains("One of options \"--json\" and \"--plain\" is required.")
    );
}

#[tokio::test]
async fn one_required_is_satisfied_by_a_member_the_exclusive_group_withdrew() {
    let rules: &[Rule] = &[
        ("exclusive", &["json", "yaml"]),
        ("oneRequired", &["json", "plain"]),
    ];
    let result = tiered(&["--yaml"], &[], &[("json", true)], rules).await;
    assert_eq!(result.status, 0);
    assert_eq!(
        json!([
            options(&result)["json"],
            options(&result)["plain"],
            options(&result)["yaml"]
        ]),
        json!([false, false, true])
    );
}

#[tokio::test]
async fn a_false_boolean_member_neither_wins_an_exclusive_group_nor_conflicts() {
    for (argv, env, answers) in [
        (&["--no-yaml"][..], &[][..], &[("json", true)][..]),
        (&[], &[("EXPORT_YAML", "0")], &[("json", true)]),
        (&["--json", "--no-yaml"], &[], &[]),
        (&["--json"], &[], &[("yaml", false)]),
    ] {
        let result = tiered(argv, env, answers, JSON_OR_YAML).await;
        assert_eq!(result.status, 0, "{argv:?} {env:?}: {}", result.stderr);
        assert_eq!(
            json!([options(&result)["json"], options(&result)["yaml"]]),
            json!([true, false])
        );
        assert_eq!(
            json!([
                result.seen[0]["supplied"]["json"],
                result.seen[0]["supplied"]["yaml"]
            ]),
            json!([true, false])
        );
    }
}

#[tokio::test]
async fn a_false_boolean_member_still_counts_for_one_required_and_required_together() {
    assert_eq!(
        tiered(
            &["--no-json"],
            &[],
            &[],
            &[("oneRequired", &["json", "yaml"])]
        )
        .await
        .status,
        0
    );
    let together = tiered(
        &["--no-json"],
        &[],
        &[],
        &[("requiredTogether", &["json", "yaml"])],
    )
    .await;
    assert_eq!(together.status, 2);
    assert!(together.stderr.contains("must be supplied together"));
}

/// An application whose exclusive group holds a negative Boolean beside a positive one.
async fn negated(argv: &[&str], env: &[(&str, &str)]) -> Tiered {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&seen);
    let app = Application::new("export")
        .option(
            "cache",
            Opt::boolean()
                .description("Skip the cache.")
                .env(["EXPORT_CACHE"])
                .polarity(Polarity::Negative),
        )
        .option("json", Opt::boolean().description("Write JSON."))
        .exclusive(&["cache", "json"])
        .action(move |ctx: Context| {
            if let Ok(mut seen) = recorded.lock() {
                seen.push(json!({
                    "options": values_json(&ctx)["options"],
                    "supplied": record_json(&ctx.supplied.options),
                }));
            }
            async { Ok(()) }
        });
    let ran = run_with(&app, fields(argv, env)).await;
    let seen = seen.lock().map(|seen| seen.clone()).unwrap_or_default();
    Tiered {
        status: ran.status,
        stderr: ran.stderr,
        seen,
    }
}

#[tokio::test]
async fn a_typed_negative_boolean_member_claims_its_group_and_conflicts_with_a_typed_sibling() {
    let typed = negated(&["--no-cache", "--json"], &[]).await;
    assert_eq!(typed.status, 2);
    assert!(
        typed
            .stderr
            .contains("\"--no-cache\" and \"--json\" cannot be used together")
    );
    let alone = negated(&["--no-cache"], &[]).await;
    assert_eq!(alone.status, 0);
    assert_eq!(options(&alone), &json!({ "cache": false, "json": false }));
}

#[tokio::test]
async fn a_negative_boolean_at_its_absent_value_claims_nothing_and_one_off_it_loses() {
    let absent = negated(&["--json"], &[("EXPORT_CACHE", "1")]).await;
    assert_eq!(absent.status, 0);
    assert_eq!(
        absent.seen[0]["supplied"],
        json!({ "cache": true, "json": true })
    );
    let claimed = negated(&["--json"], &[("EXPORT_CACHE", "0")]).await;
    assert_eq!(claimed.status, 0);
    assert_eq!(options(&claimed), &json!({ "cache": true, "json": true }));
    assert_eq!(claimed.seen[0]["supplied"], json!({ "json": true }));
}

#[tokio::test]
async fn a_withdrawn_configured_members_omission_reads_the_runs_working_directory() {
    let directories = calls();
    let app = tiers_source(
        Application::new("export")
            .option(
                "file",
                Opt::string()
                    .description("Write to a file.")
                    .extend([TIERS_KEY.value("file".to_owned())])
                    .validate_omitted(Directory {
                        calls: Arc::clone(&directories),
                    }),
            )
            .option("yaml", Opt::boolean().description("Write YAML."))
            .exclusive(&["file", "yaml"])
            .action(action),
        vec![("file", SourceValue::String("out.txt".to_owned()))],
        Some("/srv/project"),
    );
    let ran = run_with(&app, fields(&["--yaml"], &[])).await;
    assert_eq!(ran.status, 0, "{}", ran.stderr);
    // The withdrawn member reads as omitted, so its omission call, the one call, reads the run's
    // own working directory rather than the answer's.
    assert_eq!(seen(&directories), [json!("/loom-test")]);
}

/// Accepts every value and its omission, recording the working directory each call reads.
#[derive(Clone)]
struct Directory {
    calls: support::validators::Calls,
}

impl Directory {
    fn record(&self, context: &loomcli_core::ValidationContext) {
        if let Ok(mut calls) = self.calls.lock() {
            calls.push(json!(context.host.cwd));
        }
    }
}

impl loomcli_core::Validator for Directory {
    type Output = Option<String>;

    fn validate(
        &self,
        input: &str,
        context: &loomcli_core::ValidationContext,
    ) -> Result<Option<String>, Vec<loomcli_core::Issue>> {
        self.record(context);
        Ok(Some(input.to_owned()))
    }
}

impl loomcli_core::OmissionValidator for Directory {
    fn validate_omission(
        &self,
        context: &loomcli_core::ValidationContext,
    ) -> Result<Option<String>, Vec<loomcli_core::Issue>> {
        self.record(context);
        Ok(None)
    }
}

#[tokio::test]
async fn unanswered_configuration_members_suppress_only_unproven_group_failures() {
    const KEY: Extension<OptionTarget, String> = Extension::new("@fixture/group-source/key");
    let probe = |kind: &str| {
        let app = Application::new("groups")
            .global_option(
                "config",
                Opt::string()
                    .description("Configuration.")
                    .validate(OneOf(&["good"], "Use good.")),
            )
            .option(
                "first",
                Opt::string()
                    .description("Unknown choice.")
                    .extend([KEY.value("first".to_owned())]),
            )
            .option("second", Opt::string().description("Known choice."))
            .option("third", Opt::string().description("Other choice."));
        let app = match kind {
            "together" => app.required_together(&["first", "second", "third"]),
            "exclusive" => app.exclusive(&["second", "third"]),
            _ => app.one_required(&["first", "third"]),
        };
        install_source(
            app.action(action),
            "@fixture/group-source",
            &KEY,
            &["config"],
            |_probe: SourceProbe| {
                std::future::ready(Err::<BTreeMap<String, SourceAnswer>, Error>(Error::from(
                    std::io::Error::other("Must not load."),
                )))
            },
        )
    };
    let argv = |kind: &str| {
        let mut argv = vec!["--config", "bad", "--second", "given"];
        if kind == "exclusive" {
            argv.extend(["--third", "given"]);
        }
        argv
    };
    let unknown = run_with(&probe("one"), fields(&argv("one"), &[])).await;
    assert_eq!(unknown.status, 2);
    assert!(unknown.stderr.contains("Use good."));
    assert!(!unknown.stderr.contains("Supply at least one"));
    let together = run_with(&probe("together"), fields(&argv("together"), &[])).await;
    assert_eq!(together.status, 2);
    assert!(together.stderr.contains("must be supplied together"));
    let exclusive = run_with(&probe("exclusive"), fields(&argv("exclusive"), &[])).await;
    assert_eq!(exclusive.status, 2);
    assert!(exclusive.stderr.contains("cannot be used together"));
}
