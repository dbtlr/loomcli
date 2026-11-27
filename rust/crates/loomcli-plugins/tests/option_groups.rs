//! The help, manifest, completion, and runtime cases of the reference's option-groups test.

#![cfg(all(feature = "help", feature = "manifest", feature = "completion"))]
#![allow(clippy::expect_used)]

mod help_support;

use help_support::{dispatch, run};
use loomcli_core::{Application, Command, Opt, OptionSet, Polarity};
use loomcli_plugins::{completion::completion, help::help, manifest::manifest};
use serde_json::{Value, json};

fn application() -> Application {
    Application::new("groups")
        .plugins((help(), manifest(), completion()))
        .option(
            "json",
            Opt::boolean().aliases(["js"]).polarity(Polarity::Both),
        )
        .option(
            "yaml",
            Opt::boolean()
                .description("YAML output.")
                .polarity(Polarity::Both),
        )
        .option("user", Opt::string().description("User name."))
        .option("password", Opt::string())
        .option("secret", Opt::boolean().hidden())
        .option("other", Opt::boolean())
        .exclusive(&["json", "yaml"])
        .one_required(&["json", "yaml"])
        .required_together(&["user", "password"])
        .exclusive(&["secret", "other"])
        .command(
            Command::new("negated")
                .option("cache", Opt::boolean().polarity(Polarity::Negative))
                .option("json", Opt::boolean())
                .option("yaml", Opt::boolean())
                .exclusive(&["cache", "json", "yaml"])
                .action(dispatch),
        )
        .action(dispatch)
}

#[tokio::test]
async fn help_and_manifest_list_the_same_visible_groups() {
    let app = application();
    let help = run(&app, &["--help"]).await;
    assert_eq!((help.status, help.stderr.as_str()), (0, ""));
    assert!(!help.stdout.contains("--secret"));
    for sentence in [
        "Use at most one of --json and --yaml.",
        "Supply at least one of --json and --yaml.",
        "Use --user and --password together.",
    ] {
        assert!(help.stdout.contains(sentence));
    }
    let manifest = run(&app, &["--manifest"]).await;
    assert_eq!((manifest.status, manifest.stderr.as_str()), (0, ""));
    let document: Value = serde_json::from_str(&manifest.stdout).expect("the manifest is JSON");
    assert_eq!(
        document["command"]["optionGroups"],
        json!([
            {"kind":"exclusive","options":["json","yaml"]},
            {"kind":"oneRequired","options":["json","yaml"]},
            {"kind":"requiredTogether","options":["user","password"]},
        ])
    );
}

#[tokio::test]
async fn help_lists_a_sets_groups_in_group_call_order() {
    let set = OptionSet::new()
        .option("json", Opt::boolean())
        .option("password", Opt::string())
        .option("user", Opt::string())
        .option("yaml", Opt::boolean())
        .exclusive(&["json", "yaml"])
        .required_together(&["user", "password"]);
    let with_set = Application::new("app")
        .plugins([help()])
        .command(Command::new("login").options(&set).action(dispatch));
    let explicit = Application::new("app").plugins([help()]).command(
        Command::new("login")
            .option("json", Opt::boolean())
            .option("password", Opt::string())
            .option("user", Opt::string())
            .option("yaml", Opt::boolean())
            .exclusive(&["json", "yaml"])
            .required_together(&["user", "password"])
            .action(dispatch),
    );
    let from_set = run(&with_set, &["login", "--help"]).await;
    let individually = run(&explicit, &["login", "--help"]).await;
    assert_eq!((from_set.status, from_set.stderr.as_str()), (0, ""));
    assert_eq!(from_set.stdout, individually.stdout);
    assert_eq!(
        from_set
            .stdout
            .lines()
            .filter(|line| line.starts_with("  Use "))
            .collect::<Vec<_>>(),
        [
            "  Use at most one of --json and --yaml.",
            "  Use --user and --password together.",
        ]
    );
}

#[tokio::test]
async fn completion_suppresses_exclusive_siblings_after_a_claiming_spelling_or_alias() {
    for spelling in ["--json", "--js"] {
        let ran = run(
            &application(),
            &["completion", "__complete", "--", spelling, "--"],
        )
        .await;
        assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
        assert!(!ran.stdout.contains("--yaml"), "{}", ran.stdout);
        assert!(ran.stdout.contains("--user\t"), "{}", ran.stdout);
    }
}

#[tokio::test]
async fn completion_keeps_siblings_after_an_absent_value() {
    let ran = run(
        &application(),
        &["completion", "__complete", "--", "--no-json", "--"],
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert!(ran.stdout.contains("--yaml\t"), "{}", ran.stdout);
}

#[tokio::test]
async fn completion_suppresses_siblings_after_a_negative_only_boolean() {
    let ran = run(
        &application(),
        &[
            "completion",
            "__complete",
            "--",
            "negated",
            "--no-cache",
            "--",
        ],
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert!(!ran.stdout.contains("--json"), "{}", ran.stdout);
    assert!(!ran.stdout.contains("--yaml"), "{}", ran.stdout);
}

#[tokio::test]
async fn a_boolean_at_its_absent_value_does_not_conflict_and_aliases_report_canonical_spellings() {
    let app = application();
    let absent = run(&app, &["--no-json", "--yaml"]).await;
    assert_eq!(
        (
            absent.status,
            absent.stdout.as_str(),
            absent.stderr.as_str()
        ),
        (0, "dispatched\n", "")
    );
    let alias = run(&app, &["--js", "--yaml"]).await;
    assert_eq!((alias.status, alias.stdout.as_str()), (2, ""));
    assert!(alias.stderr.starts_with("groups: Options \"--json\" and \"--yaml\" cannot be used together. Supply only one of them.\n"), "{}", alias.stderr);
}
