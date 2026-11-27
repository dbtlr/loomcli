//! One-way requirements at the command graph and invocation boundaries.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use loomcli_core::{Application, Context, Opt, Outcome};
use support::{Ran, fields, run_with};

async fn action(ctx: Context) -> Outcome {
    ctx.out.print("action").await
}

#[tokio::test]
async fn a_supplied_option_needs_each_declared_dependency() {
    let app = Application::new("login")
        .option("user", Opt::string())
        .option("password", Opt::string())
        .option("host", Opt::string())
        .requires("password", &["user", "host"])
        .action(action);
    assert_eq!(
        run_with(&app, fields(&["--password", "secret"], &[])).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "login: Option \"--password\" requires options \"--user\" and \"--host\". Supply them as well, or remove \"--password\".\n".to_owned(),
        }
    );
    assert_eq!(
        run_with(&app, fields(&["--user", "ada"], &[])).await,
        Ran {
            status: 0,
            stdout: "action\n".to_owned(),
            stderr: String::new(),
        }
    );
    assert_eq!(
        serde_json::to_string(&app.inspect().unwrap().root.option_groups).unwrap(),
        r#"[{"kind":"requires","option":"password","requires":["user","host"]}]"#
    );
}

use std::collections::BTreeMap;

use loomcli_core::__private::{SourceProbe, install_source};
use loomcli_core::{
    Arg, Command, Error, Extension, FailureView, InputError, InputProblem, NoInputs, NoResult,
    OptionSet, OptionTarget, Plugin, Polarity, SourceAnswer, SourceValue, State, failure,
    override_view,
};
use serde_json::{Value, json};
use support::{validators::OneOf, values};

const KEY: Extension<OptionTarget, String> = Extension::new("@test/login/key");

fn binding(name: &str) -> loomcli_core::ExtensionValue<OptionTarget> {
    KEY.value(name.to_owned())
}

fn sourced<S: State>(
    application: Application<NoInputs, NoResult, S>,
    answers: &[(&str, SourceValue)],
) -> Application<NoInputs, NoResult, S> {
    let answers: BTreeMap<_, _> = answers
        .iter()
        .map(|(name, value)| {
            (
                (*name).to_owned(),
                SourceAnswer::new(value.clone(), format!("{name} in login.json")),
            )
        })
        .collect();
    install_source(
        application,
        "@test/login",
        &KEY,
        &[],
        move |_: SourceProbe| std::future::ready(Ok::<_, Error>(answers.clone())),
    )
}

fn login(answers: &[(&str, SourceValue)]) -> Application {
    sourced(
        Application::new("login")
            .option(
                "user",
                Opt::string().env(["LOGIN_USER"]).extend([binding("user")]),
            )
            .option(
                "password",
                Opt::string()
                    .env(["LOGIN_PASSWORD"])
                    .extend([binding("password")]),
            )
            .option(
                "host",
                Opt::string().default("localhost").extend([binding("host")]),
            )
            .option("port", Opt::string())
            .option("token", Opt::string())
            .option(
                "pretty",
                Opt::boolean()
                    .polarity(Polarity::Both)
                    .extend([binding("pretty")]),
            )
            .option("format", Opt::string())
            .requires("password", &["user", "host"])
            .requires("token", &["user", "host", "port"])
            .requires("pretty", &["format"])
            .action(values),
        answers,
    )
}

#[tokio::test]
async fn dependencies_work_with_or_without_the_trigger_when_supplied() {
    for argv in [
        &[][..],
        &["--user", "ada"],
        &["--user", "ada", "--host", "example.org"],
        &[
            "--user",
            "ada",
            "--password",
            "secret",
            "--host",
            "example.org",
        ],
    ] {
        let ran = run_with(&login(&[]), fields(argv, &[])).await;
        assert_eq!((ran.status, ran.stderr.as_str()), (0, ""), "{argv:?}");
    }
}

#[tokio::test]
async fn the_sentence_lists_only_missing_dependencies_and_defaults_supply_none() {
    let one = run_with(
        &login(&[]),
        fields(&["--password", "secret", "--user", "ada"], &[]),
    )
    .await;
    assert_eq!((one.status, one.stdout.as_str()), (2, ""));
    assert_eq!(
        one.stderr,
        "login: Option \"--password\" requires option \"--host\". Supply it as well, or remove \"--password\".\n"
    );

    let three = run_with(&login(&[]), fields(&["--token", "t"], &[])).await;
    assert_eq!(three.status, 2);
    assert_eq!(
        three.stderr,
        "login: Option \"--token\" requires options \"--user\", \"--host\", and \"--port\". Supply them as well, or remove \"--token\".\n"
    );
}

#[tokio::test]
async fn either_external_source_triggers_a_requirement_and_labels_the_trigger() {
    let environment = run_with(
        &login(&[]),
        fields(&["--user", "ada"], &[("LOGIN_PASSWORD", "secret")]),
    )
    .await;
    assert_eq!(environment.status, 2);
    assert_eq!(
        environment.stderr,
        "login: Option \"--password\" (from LOGIN_PASSWORD) requires option \"--host\". Supply it as well, or remove \"--password\".\n"
    );
    let configured = run_with(
        &login(&[("password", SourceValue::String("secret".to_owned()))]),
        fields(&[], &[]),
    )
    .await;
    assert_eq!(configured.status, 2);
    assert_eq!(
        configured.stderr,
        "login: Option \"--password\" (from password in login.json) requires options \"--user\" and \"--host\". Supply them as well, or remove \"--password\".\n"
    );
}

#[tokio::test]
async fn argv_environment_and_configuration_can_each_supply_a_dependency() {
    let seeded = login(&[
        ("user", SourceValue::String("ada".to_owned())),
        ("host", SourceValue::String("h".to_owned())),
    ]);
    for (app, mock) in [
        (
            login(&[]),
            fields(&["--password", "s", "--user", "ada", "--host", "h"], &[]),
        ),
        (
            login(&[]),
            fields(
                &["--password", "s", "--host", "h"],
                &[("LOGIN_USER", "ada")],
            ),
        ),
        (seeded, fields(&["--password", "s"], &[])),
    ] {
        let ran = run_with(&app, mock).await;
        assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
        let read: Value = serde_json::from_str(&ran.stdout).unwrap();
        assert_eq!(read["options"]["password"], "s");
        assert_eq!(read["options"]["user"], "ada");
    }
}

#[tokio::test]
async fn a_boolean_triggers_only_off_its_polaritys_absent_value() {
    for (app, argv) in [
        (login(&[]), &["--no-pretty"][..]),
        (login(&[("pretty", SourceValue::Bool(false))]), &[]),
    ] {
        let ran = run_with(&app, fields(argv, &[])).await;
        assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
        let read: Value = serde_json::from_str(&ran.stdout).unwrap();
        assert_eq!(read["options"]["pretty"], false);
    }
    let active = run_with(&login(&[]), fields(&["--pretty"], &[])).await;
    assert_eq!(active.status, 2);
    assert_eq!(
        active.stderr,
        "login: Option \"--pretty\" requires option \"--format\". Supply it as well, or remove \"--pretty\".\n"
    );
    let negative = Application::new("fetch")
        .option("cache", Opt::boolean().polarity(Polarity::Negative))
        .option("mirror", Opt::string())
        .requires("cache", &["mirror"])
        .action(action);
    let active = run_with(&negative, fields(&["--no-cache"], &[])).await;
    assert_eq!(active.status, 2);
    assert_eq!(
        active.stderr,
        "fetch: Option \"--no-cache\" requires option \"--mirror\". Supply it as well, or remove \"--no-cache\".\n"
    );
}

#[tokio::test]
async fn a_broken_requirement_adds_one_problem_with_all_members_in_order() {
    let app = Application::new("login")
        .overrides([override_view(failure::<InputError>(), FailureView::new(|error: &InputError, _| {
            let [InputProblem::Group { reason, inputs, spellings, supplied }] = error.problems() else {
                panic!("expected one group problem: {:?}", error.problems());
            };
            json!([{"inputs": inputs, "reason": reason, "spellings": spellings, "supplied": supplied}]).to_string()
        }))])
        .command(Command::new("get")
            .option("user", Opt::string())
            .option("password", Opt::string())
            .option("host", Opt::string())
            .requires("password", &["user", "host"])
            .action(action));
    let ran = run_with(
        &app,
        fields(&["get", "--password", "s", "--host", "h"], &[]),
    )
    .await;
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
    let problems: Value = serde_json::from_str(&ran.stderr).unwrap();
    assert_eq!(
        problems,
        json!([{
            "inputs": [
                {"global": false, "kind": "option", "name": "password"},
                {"global": false, "kind": "option", "name": "user"},
                {"global": false, "kind": "option", "name": "host"},
            ],
            "reason": "requires",
            "spellings": ["--password", "--user", "--host"],
            "supplied": ["--password", "--host"],
        }])
    );
}

#[tokio::test]
async fn an_exclusive_withdrawal_skips_the_entire_requirement() {
    let app = sourced(
        Application::new("login")
            .option("user", Opt::string().extend([binding("user")]))
            .option("token", Opt::string())
            .option("password", Opt::string())
            .option("host", Opt::string())
            .exclusive(&["token", "user"])
            .requires("password", &["user", "host"])
            .requires("user", &["host"])
            .action(values),
        &[("user", SourceValue::String("ada".to_owned()))],
    );
    let ran = run_with(&app, fields(&["--token", "t", "--password", "s"], &[])).await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let read: Value = serde_json::from_str(&ran.stdout).unwrap();
    assert_eq!(read["options"], json!({"token":"t","password":"s"}));
}

#[tokio::test]
async fn unanswered_dependencies_are_left_out_of_the_failure_sentence() {
    for (needed, expected) in [
        (
            &["user", "host"][..],
            "login: Option \"--config\": Use good.\nlogin: Option \"--password\" requires option \"--host\". Supply it as well, or remove \"--password\".\n",
        ),
        (&["user"], "login: Option \"--config\": Use good.\n"),
    ] {
        let app = install_source(
            Application::new("login")
                .global_option(
                    "config",
                    Opt::string().validate(OneOf(&["good"], "Use good.")),
                )
                .option("user", Opt::string().extend([binding("user")]))
                .option("password", Opt::string())
                .option("host", Opt::string())
                .requires("password", needed)
                .action(action),
            "@test/login",
            &KEY,
            &["config"],
            |_: SourceProbe| {
                std::future::ready(Err::<BTreeMap<String, SourceAnswer>, Error>(Error::from(
                    std::io::Error::other("Must not load."),
                )))
            },
        );
        let ran = run_with(&app, fields(&["--config", "bad", "--password", "s"], &[])).await;
        assert_eq!(
            (ran.status, ran.stdout.as_str(), ran.stderr.as_str()),
            (2, "", expected)
        );
    }
}

#[tokio::test]
async fn commands_hooks_and_option_sets_declare_the_same_requirement() {
    let hook = Plugin::new("@test/requires-hook").on_command_attach(|command| {
        if command.name() == Some("hooked") {
            command
                .option("user", Opt::string())?
                .option("password", Opt::string())?
                .requires("password", &["user"])?;
        }
        Ok(())
    });
    let credentials = OptionSet::new()
        .option("password", Opt::string())
        .option("user", Opt::string())
        .requires("password", &["user"]);
    let app = Application::new("login")
        .plugins([hook])
        .command(
            Command::new("own")
                .option("user", Opt::string())
                .option("password", Opt::string())
                .requires("password", &["user"])
                .action(action),
        )
        .command(Command::new("hooked").action(action))
        .command(Command::new("shared").options(&credentials).action(action));
    for command in ["own", "hooked", "shared"] {
        let ran = run_with(&app, fields(&[command, "--password", "s"], &[])).await;
        assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
        assert_eq!(
            ran.stderr,
            "login: Option \"--password\" requires option \"--user\". Supply it as well, or remove \"--password\".\n"
        );
    }
}

fn credentials() -> Command<NoInputs, NoResult, loomcli_core::Fresh> {
    Command::new("login")
        .option("user", Opt::string())
        .option("password", Opt::string())
        .option("token", Opt::string())
}

fn declaration_fault<T>(declare: impl FnOnce() -> T, subject: &str, correction: &str) {
    let fault = std::panic::catch_unwind(std::panic::AssertUnwindSafe(declare))
        .err()
        .unwrap();
    let message = fault.downcast::<String>().unwrap();
    assert!(message.contains("@loomcli/core/option-group"), "{message}");
    assert!(message.lines().any(|line| line == subject), "{message}");
    assert_eq!(message.lines().last(), Some(correction));
}

#[test]
fn requirements_check_each_name_in_order_and_allow_redundancy() {
    for (option, needed, sentence, correction) in [
        (
            "password",
            &["host"][..],
            "names undeclared local option \"host\".",
            "Declare the local option before naming it in a group.",
        ),
        (
            "host",
            &["user"],
            "names undeclared local option \"host\".",
            "Declare the local option before naming it in a group.",
        ),
        (
            "password",
            &["user", "user"],
            "repeats option \"user\".",
            "Name each option once.",
        ),
        (
            "password",
            &["password"],
            "names option \"password\" as its own requirement.",
            "Name only other local options after the first.",
        ),
        (
            "password",
            &["user", "password"],
            "names option \"password\" as its own requirement.",
            "Name only other local options after the first.",
        ),
    ] {
        declaration_fault(
            || credentials().requires(option, needed),
            &format!("Command \"login\" requires {sentence}"),
            correction,
        );
    }
    declaration_fault(
        || credentials().requires("password", &[]),
        "Command \"login\" declares requires with fewer than two options.",
        "Name at least two local options.",
    );
    declaration_fault(
        || {
            credentials()
                .argument("port", Arg::string())
                .requires("password", &["port"])
        },
        "Command \"login\" requires names undeclared local option \"port\".",
        "Declare the local option before naming it in a group.",
    );
    declaration_fault(
        || {
            Application::new("login")
                .global_option("verbose", Opt::boolean())
                .option("password", Opt::string())
                .requires("password", &["verbose"])
        },
        "The root Command requires names undeclared local option \"verbose\".",
        "Declare the local option before naming it in a group.",
    );
    let _declared = credentials()
        .requires("password", &["user"])
        .requires("user", &["password"])
        .requires("password", &["user"]);
}

#[test]
fn exclusivity_conflicts_with_a_requirement_that_shares_any_two_members() {
    let sentence = "Command \"login\" exclusive and requires groups share at least two options.";
    let correction = "Remove one of the conflicting group rules.";
    declaration_fault(
        || {
            credentials()
                .exclusive(&["user", "token"])
                .requires("password", &["user", "token"])
        },
        sentence,
        correction,
    );
    declaration_fault(
        || {
            credentials()
                .requires("password", &["user"])
                .exclusive(&["user", "password"])
        },
        sentence,
        correction,
    );
}

#[test]
fn requirements_on_a_set_check_its_own_names_and_groups() {
    let set = || {
        OptionSet::new()
            .option("password", Opt::string())
            .option("user", Opt::string())
    };
    for (needed, sentence, correction) in [
        (
            &["password"][..],
            "names option \"password\" as its own requirement.",
            "Name only other local options after the first.",
        ),
        (
            &["user", "user"],
            "repeats option \"user\".",
            "Name each option once.",
        ),
        (
            &["host"],
            "names undeclared local option \"host\".",
            "Declare the local option before naming it in a group.",
        ),
    ] {
        declaration_fault(
            || set().requires("password", needed),
            &format!("An option set requires {sentence}"),
            correction,
        );
    }
    declaration_fault(
        || {
            set()
                .exclusive(&["password", "user"])
                .requires("password", &["user"])
        },
        "An option set exclusive and requires groups share at least two options.",
        "Remove one of the conflicting group rules.",
    );
    declaration_fault(
        || set().requires("password", &[]),
        "An option set declares requires with fewer than two options.",
        "Name at least two local options.",
    );
}

#[test]
fn inspection_preserves_group_order_and_both_sides_of_the_requirement() {
    let set = OptionSet::new()
        .option("host", Opt::string())
        .option("password", Opt::string())
        .option("user", Opt::string())
        .requires("password", &["user", "host"]);
    let graph = Application::new("login")
        .option("json", Opt::boolean())
        .option("yaml", Opt::boolean())
        .exclusive(&["json", "yaml"])
        .options(&set)
        .action(action)
        .inspect()
        .unwrap();
    let groups = &graph.root.option_groups;
    assert_eq!(
        serde_json::to_string(groups).unwrap(),
        r#"[{"kind":"exclusive","options":["json","yaml"]},{"kind":"requires","option":"password","requires":["user","host"]}]"#
    );
    let loomcli_core::OptionGroup::Requires {
        option, requires, ..
    } = &groups[1]
    else {
        panic!("expected a requirement");
    };
    assert_eq!(option, "password");
    assert_eq!(requires, &["user", "host"]);
    assert_eq!(
        groups[1].members().collect::<Vec<_>>(),
        ["password", "user", "host"]
    );
}
