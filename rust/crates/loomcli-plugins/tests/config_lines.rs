//! The configuration lookup's operator lines and their order.

#![cfg(all(feature = "config", feature = "verbose"))]
#![allow(clippy::unwrap_used)]

mod config_support;

use std::path::{Path, PathBuf};

use config_support::{Typed, Workspace, project};
use loomcli_core::{
    Application, Context, Done, InvocationOutcome, InvocationValues, InvokeOptions, NoInputs,
    NoResult, Opt, RunOptions,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::config::{ConfigurationSettings, configuration};
use loomcli_plugins::verbose::verbose;
use loomcli_testing::{MockFields, mock_process};

type Settings = ConfigurationSettings<Typed>;

struct Tree {
    space: Workspace,
    work: PathBuf,
    cwd: PathBuf,
}

impl Tree {
    fn new() -> Self {
        let space = Workspace::new();
        let work = space.nest(&space.home, &["work"]);
        let cwd = space.nest(&work, &["project"]);
        Self { space, work, cwd }
    }

    fn write(&self, directory: &Path, name: &str, value: &str) -> PathBuf {
        self.space.write_in(directory, name, value)
    }

    fn fields(&self) -> MockFields {
        MockFields::new()
            .cwd(&self.cwd)
            .home(&self.space.home)
            .ceiling(&self.space.home)
    }
}

fn app(settings: Settings) -> Application<NoInputs, NoResult, Done> {
    let configuration = configuration(settings);
    Application::new("app")
        .plugins((configuration.plugin, verbose()))
        .option(
            "title",
            Opt::string()
                .description("The title.")
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("title"))]),
        )
        .action(|_: Context| async { Ok(()) })
}

async fn stderr(fields: MockFields, argv: &[&str], settings: Settings) -> String {
    let mock = mock_process(fields.argv(argv.iter().copied()));
    assert_eq!(
        app(settings)
            .run(RunOptions::new().process(mock.clone()))
            .await
            .get(),
        0
    );
    mock.stderr_text()
}

fn read(file: impl std::fmt::Display) -> String {
    format!("› Read configuration from {file}.\n")
}

fn looked(file: impl std::fmt::Display) -> String {
    format!("  ┆ Looked for {file}: not found.\n")
}

const NONE: &str = "› Found no configuration file.\n";

#[tokio::test]
async fn default_verbosity_says_nothing_for_a_file_or_none() {
    let tree = Tree::new();
    assert_eq!(stderr(tree.fields(), &[], Settings::new(None)).await, "");
    tree.write(&tree.cwd, ".app.json", r#"{"title":"x"}"#);
    assert_eq!(stderr(tree.fields(), &[], Settings::new(None)).await, "");
}

#[tokio::test]
async fn verbose_names_the_file_as_its_label_shows_it() {
    let tree = Tree::new();
    let parent = tree.write(&tree.work, ".app.json", r#"{"title":"x"}"#);
    assert_eq!(
        stderr(tree.fields(), &["-v"], Settings::new(None)).await,
        read(parent.display())
    );
    tree.write(&tree.cwd, ".app.json", r#"{"title":"x"}"#);
    assert_eq!(
        stderr(tree.fields(), &["-v"], Settings::new(None)).await,
        read(".app.json")
    );
}

#[tokio::test]
async fn a_named_file_uses_the_operators_spelling() {
    let tree = Tree::new();
    tree.write(&tree.work, "named.json", r#"{"title":"x"}"#);
    assert_eq!(
        stderr(
            tree.fields(),
            &["-vv", "--config", "../named.json"],
            Settings::new(None)
        )
        .await,
        read("../named.json")
    );
}

#[tokio::test]
async fn the_read_line_precedes_dropped_values() {
    let tree = Tree::new();
    tree.write(&tree.cwd, ".app.json", r#"{"title":5}"#);
    assert_eq!(
        stderr(tree.fields(), &["-v"], Settings::new(None)).await,
        format!(
            "{}› Ignored title in .app.json: Invalid input: expected string, received number\n",
            read(".app.json")
        ),
    );
}

#[tokio::test]
async fn trace_lists_each_miss_in_lookup_order() {
    let tree = Tree::new();
    let home = &tree.space.home;
    let project = looked(".app.json") + &looked(tree.work.join(".app.json").display());
    assert_eq!(
        stderr(tree.fields(), &["-vv"], Settings::new(None)).await,
        project.clone()
            + &looked(home.join(".app.json").display())
            + &looked(home.join(".config/app/config.json").display())
            + NONE,
    );
    let found = tree.write(home, ".app.json", r#"{"title":"x"}"#);
    assert_eq!(
        stderr(tree.fields(), &["-vv"], Settings::new(None)).await,
        project + &read(found.display())
    );
}

#[cfg(all(feature = "config-toml", feature = "config-yaml"))]
#[tokio::test]
async fn trace_names_only_the_misses_before_the_file_in_its_directory() {
    use loomcli_plugins::config::{toml::TOML, yaml::YAML};

    let tree = Tree::new();
    tree.write(&tree.cwd, ".app.json", r#"{"title":"x"}"#);
    let settings = Settings::new(None)
        .file(".app.{toml,json,yaml}")
        .formats(&[TOML, YAML]);
    assert_eq!(
        stderr(tree.fields(), &["-vv"], settings).await,
        looked(".app.toml") + &read(".app.json")
    );
}

#[tokio::test]
async fn a_missing_variable_file_is_traced_without_the_notice() {
    let tree = Tree::new();
    assert_eq!(
        stderr(
            tree.fields().env("APP_CONFIG", "missing.json"),
            &["-vv"],
            Settings::new(None).env("APP_CONFIG").notice()
        )
        .await,
        looked("missing.json") + NONE,
    );
}

#[tokio::test]
async fn the_notice_replaces_the_debug_line_when_it_has_a_candidate() {
    let tree = Tree::new();
    assert_eq!(
        stderr(tree.fields(), &["-v"], Settings::new(None).notice()).await,
        "ℹ Found no configuration file. Create .app.json to configure app.\n",
    );
    assert_eq!(
        stderr(
            tree.fields().cwd(&tree.space.home),
            &["-v"],
            Settings::new(None).notice().scopes(&[project(&[])])
        )
        .await,
        NONE,
    );
}

#[tokio::test]
async fn no_config_says_nothing_and_a_broken_file_ends_with_its_warning() {
    let tree = Tree::new();
    assert_eq!(
        stderr(tree.fields(), &["-vv", "--no-config"], Settings::new(None)).await,
        ""
    );
    let broken = tree.write(&tree.work, ".app.json", "{");
    assert_eq!(
        stderr(tree.fields(), &["-vv"], Settings::new(None)).await,
        format!(
            "{}⚠ Skipped {}: the file is not valid JSON at line 1, column 2, so this run reads no configuration. Correct its syntax, or remove it.\n",
            looked(".app.json"),
            broken.display()
        ),
    );
}

#[tokio::test]
async fn quiet_subtracts_one_verbosity_step() {
    let tree = Tree::new();
    assert_eq!(
        stderr(tree.fields(), &["-v", "-q"], Settings::new(None)).await,
        ""
    );
    assert_eq!(
        stderr(tree.fields(), &["-vv", "-q"], Settings::new(None)).await,
        NONE
    );
}

#[tokio::test]
async fn a_named_invocation_captures_its_verbose_line() {
    let tree = Tree::new();
    tree.write(&tree.cwd, ".app.json", r#"{"title":"x"}"#);
    let app = app(Settings::new(None));
    for (verbosity, expected) in [(0, String::new()), (1, read(".app.json"))] {
        let outcome = app
            .invoke(
                &[],
                InvocationValues::new().option("verbose", verbosity),
                InvokeOptions::new(),
                Some(mock_process(tree.fields())),
            )
            .await;
        assert!(
            matches!(outcome, InvocationOutcome::Completed { messages, .. } if messages == expected)
        );
    }
}

#[tokio::test]
async fn a_control_character_in_a_file_name_is_escaped() {
    let tree = Tree::new();
    assert_eq!(
        stderr(
            tree.fields().env("APP_CONFIG", "bell\u{0007}.json"),
            &["-vv"],
            Settings::new(None).env("APP_CONFIG")
        )
        .await,
        looked(r"bell\u0007.json") + NONE,
    );
}
