//! Reusable local option declarations, their groups, and their diagnostics.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{Application, Command, Context, Opt, OptionSet, Outcome};
use support::{fields, run_with};

fn output() -> OptionSet {
    OptionSet::new()
        .option("json", Opt::boolean())
        .option("yaml", Opt::boolean())
        .exclusive(&["json", "yaml"])
}

async fn format(ctx: Context) -> Outcome {
    let yaml = ctx.option::<bool>("yaml")?;
    ctx.out.print(if yaml { "yaml" } else { "json" }).await
}

#[tokio::test]
async fn a_set_applies_to_each_command_with_its_group_and_values() {
    let set = output();
    let app = Application::new("out")
        .command(Command::new("list").options(&set).action(format))
        .command(Command::new("show").options(&set).action(format));
    let explicit = Application::new("out")
        .command(
            Command::new("list")
                .option("json", Opt::boolean())
                .option("yaml", Opt::boolean())
                .exclusive(&["json", "yaml"])
                .action(format),
        )
        .command(
            Command::new("show")
                .option("json", Opt::boolean())
                .option("yaml", Opt::boolean())
                .exclusive(&["json", "yaml"])
                .action(format),
        );
    assert_eq!(
        serde_json::to_string(&*app.inspect().unwrap()).unwrap(),
        serde_json::to_string(&*explicit.inspect().unwrap()).unwrap()
    );
    for command in ["list", "show"] {
        let valid = run_with(&app, fields(&[command, "--yaml"], &[])).await;
        assert_eq!(
            (valid.status, valid.stdout.as_str(), valid.stderr.as_str()),
            (0, "yaml\n", "")
        );
        let invalid = run_with(&app, fields(&[command, "--json", "--yaml"], &[])).await;
        assert_eq!(invalid.status, 2);
        assert_eq!(invalid.stdout, "");
        assert_eq!(
            invalid.stderr,
            "out: Options \"--json\" and \"--yaml\" cannot be used together. Supply only one of them.\n"
        );
    }
}

#[derive(loomcli_core::Inputs)]
#[inputs(option_set, requires("password", "user-name"))]
struct Credentials {
    #[option]
    user_name: Option<String>,
    #[option]
    password: Option<String>,
}

#[derive(loomcli_core::Inputs)]
#[inputs(requires("remember", "user-name"))]
struct LoginInputs {
    #[option]
    agent: bool,
    #[inputs(flatten)]
    credentials: Credentials,
    #[option]
    remember: bool,
}

async fn login(ctx: Context<LoginInputs>) -> Outcome {
    ctx.out
        .print(
            ctx.inputs
                .credentials
                .user_name
                .as_deref()
                .unwrap_or("anonymous"),
        )
        .await
}

#[tokio::test]
async fn a_flattened_set_declares_its_groups_and_reads_typed_fields() {
    use loomcli_core::Inputs;

    let app = Application::new("login")
        .inputs::<LoginInputs>()
        .action(login);
    let graph = app.inspect().unwrap();
    let names: Vec<_> = graph
        .root
        .options
        .iter()
        .map(|option| option.name())
        .collect();
    assert_eq!(names, ["agent", "user-name", "password", "remember"]);
    let result = run_with(&app, fields(&["--password", "secret"], &[])).await;
    assert_eq!(result.status, 2);
    assert!(result.stderr.contains("requires option \"--user-name\"."));
    let result = run_with(&app, fields(&["--remember", "--user-name", "ada"], &[])).await;
    assert_eq!((result.status, result.stdout.as_str()), (0, "ada\n"));
    let values = LoginInputs {
        agent: true,
        credentials: Credentials {
            user_name: Some("ada".to_owned()),
            password: None,
        },
        remember: true,
    }
    .into_values();
    let round_trip = LoginInputs::extract(&values).unwrap();
    assert!(round_trip.agent && round_trip.remember);
    assert_eq!(round_trip.credentials.user_name.as_deref(), Some("ada"));
}

use loomcli_core::{Extension, Issue, OptionDecl, OptionTarget, ValidationContext, Validator};
use serde_json::{Value, json};
use support::{validators::OneOf, values};

struct NumberLevel;

impl Validator for NumberLevel {
    type Output = i64;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<i64, Vec<Issue>> {
        input.parse().map_err(|_| vec![Issue::new("Use a number.")])
    }
}

async fn read_layout(ctx: Context) -> Outcome {
    let level = ctx.option::<Option<i64>>("level")?;
    let tag = ctx.option::<Vec<String>>("tag")?;
    let verbose = ctx.option::<u32>("verbose")?;
    let json = ctx.option::<bool>("json")?;
    let yaml = ctx.option::<bool>("yaml")?;
    ctx.out
        .print(
            &json!({ "json": json, "level": level, "tag": tag, "verbose": verbose, "yaml": yaml })
                .to_string(),
        )
        .await
}

fn rich_output() -> OptionSet {
    OptionSet::new()
        .option("json", Opt::boolean().description("Print JSON."))
        .option(
            "level",
            Opt::string().default("1").short('l').validate(NumberLevel),
        )
        .option("tag", Opt::string().multiple())
        .option("verbose", Opt::count().short('v'))
        .option("yaml", Opt::boolean().description("Print YAML."))
        .exclusive(&["json", "yaml"])
}

#[tokio::test]
async fn set_actions_read_the_same_validated_values_as_individual_declarations() {
    let set = rich_output();
    let with_set =
        Application::new("app").command(Command::new("list").options(&set).action(read_layout));
    let individual = Application::new("app").command(
        Command::new("list")
            .option("json", Opt::boolean().description("Print JSON."))
            .option(
                "level",
                Opt::string().default("1").short('l').validate(NumberLevel),
            )
            .option("tag", Opt::string().multiple())
            .option("verbose", Opt::count().short('v'))
            .option("yaml", Opt::boolean().description("Print YAML."))
            .exclusive(&["json", "yaml"])
            .action(read_layout),
    );
    assert_eq!(
        serde_json::to_string(&*with_set.inspect().unwrap()).unwrap(),
        serde_json::to_string(&*individual.inspect().unwrap()).unwrap()
    );
    let argv = [
        "list", "--json", "-vv", "--tag", "a", "--tag", "b", "-l", "3",
    ];
    let ran = run_with(&with_set, fields(&argv, &[])).await;
    assert_eq!(ran, run_with(&individual, fields(&argv, &[])).await);
    assert_eq!(
        (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
        (
            0,
            "{\"json\":true,\"level\":3,\"tag\":[\"a\",\"b\"],\"verbose\":2,\"yaml\":false}\n",
            ""
        )
    );
}

#[tokio::test]
async fn root_sets_keep_declaration_order_and_mix_with_local_options() {
    let with_set = Application::new("app")
        .option("wide", Opt::boolean())
        .options(&output())
        .exclusive(&["json", "wide"])
        .action(values);
    let explicit = Application::new("app")
        .option("wide", Opt::boolean())
        .option("json", Opt::boolean())
        .option("yaml", Opt::boolean())
        .exclusive(&["json", "yaml"])
        .exclusive(&["json", "wide"])
        .action(values);
    assert_eq!(
        serde_json::to_string(&*with_set.inspect().unwrap()).unwrap(),
        serde_json::to_string(&*explicit.inspect().unwrap()).unwrap()
    );
    let ran = run_with(&with_set, fields(&[], &[])).await;
    assert_eq!(
        ran.stdout,
        "{\"args\":{},\"options\":{\"wide\":false,\"json\":false,\"yaml\":false}}\n"
    );
    let ran = run_with(&with_set, fields(&["--json", "--wide"], &[])).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert_eq!(
        ran.stderr,
        "app: Options \"--json\" and \"--wide\" cannot be used together. Supply only one of them.\n"
    );
}

#[test]
fn sets_publish_their_groups_in_call_order() {
    let set = OptionSet::new()
        .option("json", Opt::boolean())
        .option("password", Opt::string())
        .option("user", Opt::string())
        .option("yaml", Opt::boolean())
        .exclusive(&["json", "yaml"])
        .required_together(&["user", "password"])
        .one_required(&["json", "yaml"]);
    let app = Application::new("app").options(&set).action(values);
    assert_eq!(
        serde_json::to_string(&app.inspect().unwrap().root.option_groups).unwrap(),
        r#"[{"kind":"exclusive","options":["json","yaml"]},{"kind":"requiredTogether","options":["user","password"]},{"kind":"oneRequired","options":["json","yaml"]}]"#
    );
}

#[tokio::test]
async fn a_cloned_set_keeps_the_original_options_and_groups() {
    let plain = OptionSet::new()
        .option("json", Opt::boolean())
        .option("yaml", Opt::boolean());
    let grouped = plain
        .clone()
        .required_together(&["json", "yaml"])
        .option("wide", Opt::boolean());
    let app = Application::new("app")
        .command(Command::new("plain").options(&plain).action(values))
        .command(Command::new("grouped").options(&grouped).action(values));
    let plain = run_with(&app, fields(&["plain", "--json"], &[])).await;
    assert_eq!((plain.status, plain.stderr.as_str()), (0, ""));
    assert_eq!(
        plain.stdout,
        "{\"args\":{},\"options\":{\"json\":true,\"yaml\":false}}\n"
    );
    let grouped = run_with(&app, fields(&["grouped", "--json"], &[])).await;
    assert_eq!(grouped.status, 2);
    assert!(grouped.stderr.contains("must be supplied together"));
}

#[test]
fn an_empty_set_keeps_the_graph_and_snapshots_own_their_settings() {
    let empty = Application::new("app")
        .options(&OptionSet::new())
        .action(values);
    let plain = Application::new("app").action(values);
    assert_eq!(
        serde_json::to_string(&*empty.inspect().unwrap()).unwrap(),
        serde_json::to_string(&*plain.inspect().unwrap()).unwrap(),
    );

    let settings = Opt::boolean();
    let set = OptionSet::new().option("json", settings.clone());
    let more = set.clone().option("yaml", settings.short('y'));
    let first = Application::new("app").options(&set).action(values);
    let second = Application::new("app").options(&more).action(values);
    let first = first.inspect().unwrap();
    assert_eq!(first.root.options.len(), 1);
    assert!(first.root.options[0].short().is_none());
    assert_eq!(
        second.inspect().unwrap().root.options[1].short(),
        Some("-y")
    );
}

#[tokio::test]
async fn a_parent_set_is_local_to_the_parent() {
    let parent = Command::new("parent")
        .options(&output())
        .command(Command::new("child").action(values))
        .action(values);
    let app = Application::new("app").command(parent);
    let ran = run_with(&app, fields(&["parent", "child"], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let value: Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(value["options"], json!({}));
    let ran = run_with(&app, fields(&["parent", "child", "--json"], &[])).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    assert!(ran.stderr.contains("--json"));
}

fn fault<T>(declare: impl FnOnce() -> T, rule: &str) -> String {
    let error = std::panic::catch_unwind(std::panic::AssertUnwindSafe(declare))
        .err()
        .unwrap();
    let message = *error.downcast::<String>().unwrap();
    assert!(
        message.contains(&format!("@loomcli/core/{rule}")),
        "{message}"
    );
    message
}

#[test]
fn set_entries_report_spelling_collisions_with_each_entries_findings() {
    for (first, second, left, right, spelling) in [
        (
            "all",
            "any",
            Opt::boolean().short('a'),
            Opt::boolean().short('a'),
            "-a",
        ),
        (
            "all",
            "every",
            Opt::boolean(),
            Opt::boolean().aliases(["all"]),
            "--all",
        ),
        (
            "color",
            "no-color",
            Opt::boolean().polarity(loomcli_core::Polarity::Both),
            Opt::boolean(),
            "--no-color",
        ),
    ] {
        let message = fault(
            || OptionSet::new().option(first, left).option(second, right),
            "spelling-taken",
        );
        assert!(
            message.contains(&format!(
                "Option spelling \"{spelling}\" is used by both \"{first}\" and \"{second}\"."
            )),
            "{message}"
        );
        for name in [first, second] {
            assert!(
                message.contains(&format!("OptionSet::new().option(\"{name}\"")),
                "{message}"
            );
        }
    }
}

#[test]
fn every_entry_is_checked_in_order_and_its_name_precedes_its_settings() {
    let message = fault(
        || {
            OptionSet::new()
                .option("alpha", Opt::boolean().short('q'))
                .option("beta", Opt::boolean().short('q'))
                .option("zed=raw", Opt::boolean())
        },
        "spelling-taken",
    );
    assert!(message.contains("Option spelling \"-q\" is used by both \"alpha\" and \"beta\"."));

    for decl in [
        OptionDecl::from(Opt::string().arity(1)),
        Opt::boolean().aliases(["a b"]).into(),
    ] {
        let message = fault(|| OptionSet::new().option("-raw", decl), "declared-name");
        assert!(
            message.contains("Option name \"-raw\" is invalid."),
            "{message}"
        );
        assert!(
            message.contains("OptionSet::new().option(\"-raw\", …)"),
            "{message}"
        );
    }
}

#[test]
fn an_option_set_checks_settings_like_local_options() {
    let cases: [(&str, OptionDecl, &str, &str); 3] = [
        (
            "all",
            Opt::boolean().aliases(["a b"]).into(),
            "declared-name",
            "Option \"all\" declares an alias named \"a b\".",
        ),
        (
            "tag",
            Opt::string()
                .env(["TAGS"])
                .env_delimiter("")
                .multiple()
                .into(),
            "env-delimiter",
            "Option \"tag\" declares an empty envDelimiter.",
        ),
        (
            "point",
            Opt::string().arity(1).into(),
            "option-arity",
            "Option \"point\" declares arity 1.",
        ),
    ];
    for (name, builder, rule, sentence) in cases {
        let message = fault(|| OptionSet::new().option(name, builder), rule);
        assert!(message.lines().any(|line| line == sentence), "{message}");
        assert!(
            message.contains(&format!("OptionSet::new().option(\"{name}\"")),
            "{message}"
        );
    }
    let message = fault(
        || {
            OptionSet::new()
                .option("from", Opt::string().env(["AT"]))
                .option("to", Opt::string().env(["AT"]))
        },
        "variable-bound-twice",
    );
    assert!(message.contains("Variable \"AT\" is bound by an option set option \"from\" and an option set option \"to\"."), "{message}");
    let message = fault(
        || {
            OptionSet::new()
                .option("from", Opt::content().stdin())
                .option("to", Opt::content().stdin())
        },
        "stdin-claimed-twice",
    );
    assert!(
        message.contains("An option set declares more than one stdin target."),
        "{message}"
    );
    assert_eq!(message.matches("claims stdin").count(), 2);
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
struct Label(String);

fn nonempty_label(label: &Label) -> Result<(), Vec<Issue>> {
    if label.0.is_empty() {
        Err(vec![Issue::new("Use a nonempty label.")])
    } else {
        Ok(())
    }
}

const LABEL: Extension<OptionTarget, Label> = Extension::new("@acme/label").check(nonempty_label);
const OTHER_LABEL: Extension<OptionTarget, u32> = Extension::new("@acme/label");

#[test]
fn extension_values_and_descriptor_collisions_are_checked_where_they_meet() {
    let message = fault(
        || {
            OptionSet::new().option(
                "all",
                Opt::boolean().extend([LABEL.value(Label(String::new()))]),
            )
        },
        "invalid-extension-value",
    );
    assert!(message.contains("An option set option \"all\" holds an invalid \"@acme/label\" value: Use a nonempty label."), "{message}");
    assert!(
        message.contains("OptionSet::new().option(\"all\", Opt::boolean().extend("),
        "{message}"
    );

    let message = fault(
        || {
            OptionSet::new()
                .option(
                    "all",
                    Opt::boolean().extend([LABEL.value(Label("a".to_owned()))]),
                )
                .option("any", Opt::boolean().extend([OTHER_LABEL.value(2)]))
        },
        "two-package-copies",
    );
    assert!(
        message.contains("OptionSet::new().option(\"any\""),
        "{message}"
    );

    let set = OptionSet::new().option("any", Opt::boolean().extend([OTHER_LABEL.value(2)]));
    let message = fault(
        || {
            Command::new("list")
                .option(
                    "all",
                    Opt::boolean().extend([LABEL.value(Label("a".to_owned()))]),
                )
                .options(&set)
        },
        "two-package-copies",
    );
    assert!(
        message.contains(".options(&OptionSet::new().option(\"any\""),
        "{message}"
    );
}

#[test]
fn set_groups_report_repeats_and_both_orders_of_conflict() {
    let set = || {
        OptionSet::new()
            .option("from", Opt::boolean())
            .option("to", Opt::boolean())
    };
    let repeated = fault(|| set().exclusive(&["from", "from"]), "option-group");
    assert!(
        repeated.contains("An option set exclusive repeats option \"from\"."),
        "{repeated}"
    );
    assert_eq!(repeated.lines().last(), Some("Name each option once."));
    let required = fault(
        || {
            OptionSet::new()
                .option("from", Opt::string().required())
                .option("to", Opt::string())
                .exclusive(&["from", "to"])
        },
        "option-group",
    );
    assert!(
        required.contains("An option set exclusive group contains required option \"from\"."),
        "{required}"
    );
    assert_eq!(
        required.lines().last(),
        Some("Remove the presence requirement or remove the exclusive group.")
    );
    for message in [
        fault(
            || {
                set()
                    .exclusive(&["from", "to"])
                    .required_together(&["from", "to"])
            },
            "option-group",
        ),
        fault(
            || {
                set()
                    .required_together(&["from", "to"])
                    .exclusive(&["from", "to"])
            },
            "option-group",
        ),
    ] {
        assert!(
            message.contains(
                "An option set exclusive and requiredTogether groups share at least two options."
            ),
            "{message}"
        );
        assert_eq!(
            message.lines().last(),
            Some("Remove one of the conflicting group rules.")
        );
    }
    assert!(
        fault(|| set().exclusive(&["from", "other"]), "option-group")
            .contains("undeclared local option \"other\".")
    );
    assert!(
        fault(|| set().one_required(&["from"]), "option-group").contains("fewer than two options.")
    );
}

#[test]
fn normal_group_checks_report_the_first_faulting_member() {
    for (names, expected) in [
        (&["x", "x"][..], "names undeclared local option \"x\"."),
        (&["z", "a", "a"], "names undeclared local option \"z\"."),
        (&["a", "a", "z"], "repeats option \"a\"."),
    ] {
        let message = fault(
            || {
                Command::new("get")
                    .option("a", Opt::boolean())
                    .exclusive(names)
            },
            "option-group",
        );
        assert!(
            message.contains(&format!("Command \"get\" exclusive {expected}")),
            "{message}"
        );
    }
}

#[test]
fn application_checks_set_names_spellings_and_stdin_against_its_receiver() {
    let jobs = OptionSet::new().option("jobs", Opt::string().short('j'));
    let local = fault(
        || {
            Command::new("list")
                .option("json", Opt::boolean().short('j'))
                .options(&jobs)
        },
        "spelling-taken",
    );
    assert!(
        local.contains(".option(\"json\", Opt::boolean().short('j'))"),
        "{local}"
    );
    assert!(
        local.contains(".options(&OptionSet::new().option(\"jobs\", Opt::string().short('j')))"),
        "{local}"
    );

    let before = fault(
        || {
            Command::new("list")
                .option("jobs", Opt::string())
                .options(&jobs)
        },
        "option-declared-twice",
    );
    let after = fault(
        || {
            Command::new("list")
                .options(&jobs)
                .option("jobs", Opt::string())
        },
        "option-declared-twice",
    );
    assert!(
        before.find(".option(\"jobs\", Opt::string())").unwrap()
            < before.find(".options(&OptionSet").unwrap()
    );
    assert!(
        after.find(".options(&OptionSet").unwrap()
            < after.find(".option(\"jobs\", Opt::string())").unwrap()
    );
    let global = fault(
        || {
            Application::new("app")
                .global_option("jobs", Opt::string())
                .options(&jobs)
        },
        "option-declared-twice",
    );
    assert!(global.contains("as a global option"), "{global}");
    let global_spelling = fault(
        || {
            Application::new("app")
                .global_option("json", Opt::boolean().short('j'))
                .options(&jobs)
        },
        "spelling-taken",
    );
    assert!(
        global_spelling.contains("Option spelling \"-j\""),
        "{global_spelling}"
    );
    assert!(
        global_spelling.contains(".options(&OptionSet"),
        "{global_spelling}"
    );
    let attached = fault(
        || {
            Application::new("app")
                .global_option("jobs", Opt::boolean())
                .command(Command::new("list").options(&jobs).action(values))
        },
        "option-declared-twice",
    );
    assert!(attached.contains(".options(&OptionSet"), "{attached}");

    let files = OptionSet::new().option("other", Opt::content().stdin());
    let stdin = fault(
        || {
            Command::new("list")
                .option("file", Opt::content().stdin())
                .options(&files)
        },
        "stdin-claimed-twice",
    );
    assert!(
        stdin.contains(".option(\"file\", Opt::content().stdin())"),
        "{stdin}"
    );
    assert!(
        stdin.contains(".options(&OptionSet::new().option(\"other\", Opt::content().stdin()))"),
        "{stdin}"
    );
}

#[tokio::test]
async fn a_rejected_default_names_the_command_that_applied_the_entry() {
    let set = OptionSet::new().option(
        "level",
        Opt::string()
            .default("high")
            .validate(OneOf(&["low"], "Use low.")),
    );
    let root = Application::new("app").options(&set).action(values);
    let ran = run_with(&root, fields(&[], &[])).await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr.contains("@loomcli/core/invalid-default"),
        "{}",
        ran.stderr
    );
    assert!(
        ran.stderr
            .contains(".options(&OptionSet::new().option(\"level\""),
        "{}",
        ran.stderr
    );
    let app = Application::new("app")
        .command(Command::new("alpha").options(&set).action(values))
        .command(Command::new("beta").options(&set).action(values));
    let ran = run_with(&app, fields(&["alpha"], &[])).await;
    assert_eq!(ran.status, 1);
    assert!(
        ran.stderr
            .contains("// app alpha\n    Command::new(\"alpha\")\n      .options(&OptionSet"),
        "{}",
        ran.stderr
    );
}

#[derive(loomcli_core::Inputs)]
#[inputs(option_set)]
struct Profile {
    #[option]
    profile: Option<String>,
}

#[derive(loomcli_core::Inputs)]
#[inputs(requires("token", "profile"))]
struct DeployInputs {
    #[option(name = "deploy-profile")]
    profile: Option<String>,
    #[inputs(flatten)]
    credentials: Profile,
    #[option]
    token: Option<String>,
}

#[test]
fn a_group_names_a_flattened_option_that_a_renamed_field_spells() {
    let app = Application::new("deploy")
        .inputs::<DeployInputs>()
        .action(|_: Context<DeployInputs>| async { Ok(()) });
    let graph = app.inspect().unwrap();
    let names: Vec<_> = graph
        .root
        .options
        .iter()
        .map(|option| option.name())
        .collect();
    assert_eq!(names, ["deploy-profile", "profile", "token"]);
    let members: Vec<_> = graph.root.option_groups[0].members().collect();
    assert_eq!(members, ["token", "profile"]);
}
