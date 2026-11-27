//! The public configuration reader settings and their lookup behavior.

#![cfg(feature = "config")]

mod config_support;

use config_support::{HELP_HINT, Settings, Workspace, panics};
use loomcli_plugins::config::{ConfigurationSettings, configuration};
use serde_json::{Map, Value, json};

#[test]
fn a_pattern_names_a_reader_to_pass_for_each_unread_candidate() {
    for (file, extension, constant, module) in [
        (".app.{toml,json}", "toml", "TOML", "toml"),
        (".app.{json,yaml}", "yaml", "YAML", "yaml"),
        (".app.{yml,json}", "yml", "YAML", "yaml"),
        (".app.toml", "toml", "TOML", "toml"),
        ("config/app.yml", "yml", "YAML", "yaml"),
    ] {
        let fault = panics(|| {
            let _ =
                configuration::<Map<String, Value>>(ConfigurationSettings::new(None).file(file));
        });
        let message = fault.as_deref().unwrap_or_default();
        for text in [
            "@loomcli/plugins/config/file-format".to_owned(),
            format!(
                "Plugin \"@loomcli/plugins/config\" file names {extension} files, and formats holds no reader for them."
            ),
            format!(
                "Pass {constant}, from loomcli_plugins::config::{module} with the config-{module} feature, in formats."
            ),
        ] {
            assert!(message.contains(&text), "{file}: {message}");
        }
    }
}

#[test]
fn json_and_literal_other_extensions_build_without_readers() {
    for file in [
        ".app.json",
        ".app.{json,jsonc}",
        ".app.*",
        ".apprc",
        ".app.conf",
    ] {
        let _ = configuration::<Map<String, Value>>(ConfigurationSettings::new(None).file(file));
    }
    let fault = panics(|| {
        let _ = configuration::<Map<String, Value>>(
            ConfigurationSettings::new(None).file(".app.{toml,ini}"),
        );
    });
    let message = fault.as_deref().unwrap_or_default();
    assert!(
        message.contains("@loomcli/plugins/config/file-pattern"),
        "{message}"
    );
    assert!(
        message.contains("file lists an extension the plugin cannot read."),
        "{message}"
    );
}

#[tokio::test]
async fn the_wildcard_uses_json_alone_without_readers() {
    let space = Workspace::new();
    space.write(".app.toml", "title = \"toml\"\n");
    let run = space.run().settings(Settings::file(".app.*"));
    let ran = run.ran().await;
    assert_eq!(
        (
            ran.status,
            ran.stderr.as_str(),
            ran.received()["title"].clone()
        ),
        (0, "", Value::Null)
    );
    space.write(".app.json", r#"{"title":"json"}"#);
    let ran = run.ran().await;
    assert_eq!(
        (
            ran.status,
            ran.stderr.as_str(),
            ran.received()["title"].clone()
        ),
        (0, "", json!("json"))
    );
}

#[tokio::test]
async fn unsupported_explicit_extensions_are_refused_before_the_file_is_read() {
    let space = Workspace::new();
    for (name, format) in [("x.toml", "TOML"), ("x.yaml", "YAML"), ("x.yml", "YAML")] {
        let ran = space.run().arg(&["--config", name]).ran().await;
        assert_eq!((ran.status, ran.stdout.as_str()), (2, ""));
        assert_eq!(
            ran.stderr,
            format!(
                "app: Option \"--config\": File \"{name}\" is {format}, which this application does not read. Supply a JSON file.\n{HELP_HINT}"
            )
        );
    }
    space.write("x.conf", r#"{"title":"conf"}"#);
    let ran = space.run().arg(&["--config", "x.conf"]).ran().await;
    assert_eq!(
        (
            ran.status,
            ran.stderr.as_str(),
            ran.received()["title"].clone()
        ),
        (0, "", json!("conf"))
    );
}

#[tokio::test]
async fn an_unsupported_variable_file_warns_and_ends_the_lookup() {
    let space = Workspace::new();
    space.write("x.toml", "title = \"toml\"\n");
    space.write(".app.json", r#"{"title":"json"}"#);
    let ran = space
        .run()
        .settings(Settings::default().with_env("APP_CONFIG"))
        .env("APP_CONFIG", "x.toml")
        .ran()
        .await;
    assert_eq!(
        (ran.status, ran.received()["title"].clone()),
        (0, Value::Null)
    );
    assert_eq!(
        ran.stderr,
        "⚠ Skipped x.toml: the file is TOML, which this application does not read, so this run reads no configuration. Supply a JSON file.\n"
    );
}

#[cfg(feature = "config-toml")]
#[tokio::test]
async fn a_passed_toml_reader_reads_its_files() {
    use loomcli_plugins::config::toml::TOML;
    let space = Workspace::new();
    space.write(".app.toml", "title = \"toml\"\n");
    let ran = space
        .run()
        .formats(&[TOML])
        .settings(Settings::file(".app.toml"))
        .ran()
        .await;
    assert_eq!(
        (
            ran.status,
            ran.stderr.as_str(),
            ran.received()["title"].clone()
        ),
        (0, "", json!("toml"))
    );
}

#[cfg(feature = "config-yaml")]
#[tokio::test]
async fn a_passed_yaml_reader_reads_both_extensions() {
    use loomcli_plugins::config::yaml::YAML;
    let space = Workspace::new();
    let _ = configuration::<Map<String, Value>>(
        ConfigurationSettings::new(None)
            .file(".app.{yaml,yml}")
            .formats(&[YAML]),
    );
    for name in [".app.yaml", ".app.yml"] {
        space.write(name, "title: yaml\n");
        let ran = space
            .run()
            .formats(&[YAML])
            .settings(Settings::file(name))
            .ran()
            .await;
        assert_eq!(
            (
                ran.status,
                ran.stderr.as_str(),
                ran.received()["title"].clone()
            ),
            (0, "", json!("yaml"))
        );
    }
}

#[cfg(feature = "config-toml")]
#[test]
fn a_passed_reader_does_not_cover_another_formats_candidate() {
    use loomcli_plugins::config::toml::TOML;
    let _ = configuration::<Map<String, Value>>(
        ConfigurationSettings::new(None)
            .file(".app.{toml,json}")
            .formats(&[TOML]),
    );
    let fault = panics(|| {
        let _ = configuration::<Map<String, Value>>(
            ConfigurationSettings::new(None)
                .file(".app.{toml,yaml}")
                .formats(&[TOML]),
        );
    });
    let message = fault.as_deref().unwrap_or_default();
    assert!(
        message.contains("@loomcli/plugins/config/file-format"),
        "{message}"
    );
    assert!(message.contains("Pass YAML, from loomcli_plugins::config::yaml with the config-yaml feature, in formats."), "{message}");
}

#[cfg(all(feature = "config-toml", feature = "config-yaml"))]
#[tokio::test]
async fn the_wildcard_uses_reader_order_and_counts_a_duplicate_once() {
    use loomcli_plugins::config::{toml::TOML, yaml::YAML};
    let space = Workspace::new();
    space.write(".app.toml", "title = \"toml\"\n");
    space.write(".app.yml", "title: yml\n");
    space.write(".app.json", r#"{"title":"json"}"#);
    let run = space.run().settings(Settings::file(".app.*"));
    let ran = run.clone().formats(&[YAML, TOML, YAML]).ran().await;
    assert_eq!(ran.received()["title"], json!("toml"));
    assert_eq!(
        ran.stderr,
        "⚠ Skipped .app.yml, .app.json: .app.toml matches the same pattern first. Keep one of the files, and remove the others.\n"
    );
    assert_eq!(run.formats(&[YAML]).received().await["title"], json!("yml"));
}

#[cfg(all(feature = "config-toml", feature = "config-yaml"))]
#[tokio::test]
async fn both_unread_diagnostics_list_the_formats_the_application_reads() {
    use loomcli_plugins::config::{toml::TOML, yaml::YAML};
    let space = Workspace::new();
    for (reader, choices, name, format) in [
        (TOML, "JSON or TOML", "x.yml", "YAML"),
        (YAML, "JSON or YAML", "x.toml", "TOML"),
    ] {
        let run = space.run().formats(&[reader]);
        let named = run.clone().arg(&["--config", name]).ran().await;
        assert_eq!((named.status, named.stdout.as_str()), (2, ""));
        assert_eq!(
            named.stderr,
            format!(
                "app: Option \"--config\": File \"{name}\" is {format}, which this application does not read. Supply a {choices} file.\n{HELP_HINT}"
            )
        );
        let variable = run
            .settings(Settings::default().with_env("APP_CONFIG"))
            .env("APP_CONFIG", name)
            .ran()
            .await;
        assert_eq!(
            (variable.status, variable.received()["title"].clone()),
            (0, Value::Null)
        );
        assert_eq!(
            variable.stderr,
            format!(
                "⚠ Skipped {name}: the file is {format}, which this application does not read, so this run reads no configuration. Supply a {choices} file.\n"
            )
        );
    }
}
