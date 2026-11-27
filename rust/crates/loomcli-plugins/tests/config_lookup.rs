//! The configuration plugin's lookup, ported from the reference's `config.test.ts`: the walk, the
//! home file and the user file, `--config`, `--no-config`, the variable, the directory option, the
//! notice, the scopes, the root marker, and how a found or broken file shows.

#![cfg(feature = "config")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod config_support;

use config_support::*;
use serde_json::json;

fn write_json(space: &Workspace, base: &std::path::Path, relative: &str, value: serde_json::Value) {
    space.write_in(base, relative, &json_text(&value));
}

#[tokio::test]
async fn with_no_settings_the_plugin_reads_app_json_in_the_working_directory_then_home() {
    let space = Workspace::new();
    let silent = space.run().ran().await;
    assert_eq!((silent.status, silent.stderr.as_str()), (0, ""));
    assert_eq!(silent.received(), defaults());
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(
        space.run().received().await,
        defaults_with(json!({ "title": "home" }))
    );
    // A file in the working directory hides the home file entirely.
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "limits": { "bytes": "1" } }),
    );
    assert_eq!(
        space.run().received().await,
        defaults_with(json!({ "limit": "1" }))
    );
}

// The reference spawns a process whose own working directory holds a file; in process, the run
// reads the mock's working directory alone.
#[tokio::test]
async fn the_lookup_never_reads_the_process_working_directory() {
    let space = Workspace::new();
    write_json(
        &space,
        &space.elsewhere,
        ".app.json",
        json!({ "title": "process" }),
    );
    assert_eq!(space.run().home(None).received().await, defaults());
}

#[tokio::test]
async fn the_walk_reads_a_parent_directory_and_no_lookup_expands_a_tilde_path() {
    let space = Workspace::new();
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "parent" }),
    );
    let nested = space.nest(&space.project, &["nested"]);
    assert_eq!(
        space.run().cwd(&nested).home(None).received().await,
        defaults_with(json!({ "title": "parent" }))
    );
    let ran = space.run().arg(&["--config", "~/.app.json"]).ran().await;
    assert_eq!(ran.status, 2);
    assert_eq!(
        ran.stderr,
        named_failure(
            "~/.app.json",
            "does not exist. Supply the path of an existing file."
        )
    );
}

#[tokio::test]
async fn the_home_directory_is_host_home_and_an_empty_or_relative_one_is_none() {
    let space = Workspace::new();
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(space.run().received().await["title"], json!("home"));
    // A relative home names a directory under the working directory, which the plugin never reads.
    write_json(
        &space,
        &space.project,
        "home/.app.json",
        json!({ "title": "relative" }),
    );
    for home in [None, Some(std::path::Path::new("home"))] {
        assert_eq!(space.run().home(home).received().await, defaults());
    }
}

#[tokio::test]
async fn a_broken_file_in_the_working_directory_warns_and_no_later_location_answers() {
    let space = Workspace::new();
    space.write(".app.json", "{");
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    let ran = space.run().ran().await;
    assert_eq!(ran.status, 0);
    assert_eq!(
        ran.stderr,
        skipped(".app.json", &invalid_json("line 1, column 2"))
    );
    assert_eq!(ran.received(), defaults());
    // A home that is the working directory is read once.
    let trailing = std::path::PathBuf::from(format!("{}/", shown(&space.project)));
    for home in [space.project.clone(), trailing] {
        let once = space.run().home(Some(&home)).ran().await;
        assert_eq!(once.status, 0);
        assert_eq!(
            once.stderr,
            skipped(".app.json", &invalid_json("line 1, column 2"))
        );
        assert_eq!(once.received(), defaults());
    }
}

#[tokio::test]
async fn config_names_the_one_file_a_run_reads_and_a_bad_named_file_fails_the_run() {
    let space = Workspace::new();
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "limits": { "bytes": "2" } }),
    );
    write_json(&space, &space.home, ".app.json", json!({ "total": true }));
    write_json(
        &space,
        &space.project,
        "pinned.json",
        json!({ "title": "pinned" }),
    );
    assert_eq!(
        space
            .run()
            .arg(&["--config", "pinned.json"])
            .received()
            .await,
        defaults_with(json!({ "config": "pinned.json", "title": "pinned" }))
    );
    // The named path is no pattern, so its braces are part of the name, and it reads as JSON.
    write_json(
        &space,
        &space.project,
        ".app.{toml,json}",
        json!({ "title": "braces" }),
    );
    assert_eq!(
        space
            .run()
            .arg(&["--config", ".app.{toml,json}"])
            .received()
            .await["title"],
        json!("braces")
    );
    let missing = space.run().arg(&["--config", "missing.json"]).ran().await;
    assert_eq!(
        missing,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: named_failure(
                "missing.json",
                "does not exist. Supply the path of an existing file."
            ),
        }
    );
    space.write("broken.json", "{");
    let broken = space.run().arg(&["--config", "broken.json"]).ran().await;
    assert_eq!(
        broken,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: named_failure(
                "broken.json",
                "is not valid JSON at line 1, column 2. Correct its syntax, or supply another file."
            ),
        }
    );
    space.write("list.json", "[]");
    let list = space.run().arg(&["--config", "list.json"]).ran().await;
    assert_eq!(
        list,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: named_failure(
                "list.json",
                "does not hold a JSON object. Write its settings as one JSON object."
            ),
        }
    );
    std::fs::create_dir(space.project.join("dir.json")).unwrap();
    assert_eq!(
        space.run().arg(&["--config", "dir.json"]).stderr().await,
        named_failure(
            "dir.json",
            "could not be read. Supply a file this process can read."
        )
    );
    // The takeover reports nothing, and a run that needs no value reads no file.
    let help = space
        .run()
        .arg(&["--config", "missing.json", "--help"])
        .ran()
        .await;
    assert_eq!((help.status, help.stderr.as_str()), (0, ""));
    let filled = space
        .run()
        .arg(&[
            "--config",
            "missing.json",
            "--level",
            "x",
            "--limit",
            "1",
            "--total",
            "--no-quiet",
            "--fields",
            "a",
            "--title",
            "t",
            "--owner",
            "o",
            "-v",
            "--backup",
            "--root",
            "/r",
        ])
        .ran()
        .await;
    assert_eq!((filled.status, filled.stderr.as_str()), (0, ""));
    assert_eq!(
        filled.received(),
        json!({
            "backup": "simple",
            "config": "missing.json",
            "fields": ["a"],
            "help": false,
            "level": "x",
            "limit": "1",
            "no-config": false,
            "owner": "o",
            "quiet": false,
            "root": "/r",
            "title": "t",
            "total": true,
            "verbose": 1,
        })
    );
}

#[tokio::test]
async fn short_gives_config_a_short_spelling_and_with_none_config_has_none() {
    let space = Workspace::new();
    write_json(
        &space,
        &space.project,
        "pinned.json",
        json!({ "title": "pinned" }),
    );
    let short = Settings::default().with_short('c');
    assert_eq!(
        space
            .run()
            .arg(&["-c", "pinned.json"])
            .settings(short.clone())
            .received()
            .await,
        defaults_with(json!({ "config": "pinned.json", "title": "pinned" }))
    );
    assert_eq!(
        space
            .run()
            .arg(&["-c", "missing.json"])
            .settings(short)
            .stderr()
            .await,
        named_failure(
            "missing.json",
            "does not exist. Supply the path of an existing file."
        )
    );
    assert_eq!(
        space.run().arg(&["-c", "pinned.json"]).ran().await.status,
        2
    );
}

#[tokio::test]
async fn a_discovered_file_that_is_missing_is_silent_and_one_that_is_broken_warns_once() {
    let space = Workspace::new();
    std::fs::create_dir(space.project.join(".app.json")).unwrap();
    let directory = space.run().ran().await;
    assert_eq!(directory.status, 0);
    assert_eq!(
        directory.stderr,
        skipped(
            ".app.json",
            "could not be read, so this run reads no configuration. Make it readable, or remove it."
        )
    );
    assert_eq!(directory.received(), defaults());
    std::fs::remove_dir(space.project.join(".app.json")).unwrap();
    for (content, clause) in [
        ("", invalid_json("line 1, column 1")),
        ("{\"limits\": ", invalid_json("line 1, column 12")),
        ("[1]", NOT_OBJECT.to_owned()),
    ] {
        space.write(".app.json", content);
        let ran = space.run().ran().await;
        assert_eq!(
            (ran.status, ran.stderr),
            (0, skipped(".app.json", &clause)),
            "{content:?}"
        );
    }
    std::fs::remove_file(space.project.join(".app.json")).unwrap();
    let home = space.write_in(&space.home, ".app.json", "true");
    let help = space.run().arg(&["--help"]).ran().await;
    assert_eq!(help.status, 0);
    assert_eq!(help.stderr, skipped(&shown(&home), NOT_OBJECT));
    assert!(help.stdout.starts_with("app"));
    std::fs::remove_file(&home).unwrap();
    // A file under a missing directory, or under a file in place of a directory, is silent.
    assert_eq!(
        space
            .run()
            .settings(Settings::file("absent/.app.json"))
            .stderr()
            .await,
        ""
    );
    space.write("plain", "a file, not a directory");
    assert_eq!(
        space
            .run()
            .settings(Settings::file("plain/.app.json"))
            .stderr()
            .await,
        ""
    );
}

#[cfg(feature = "config-yaml")]
#[tokio::test]
async fn a_file_in_the_working_directory_shows_as_file_names_it_and_one_in_home_as_its_path() {
    let space = Workspace::new().with_formats(&[loomcli_plugins::config::yaml::YAML]);
    let nested = Settings::file(".app/config.{yaml,json}");
    space.write(".app/config.yaml", "limits: { bytes: many }\n");
    // A wrong value in the file falls back to the default, and only -v names the drop.
    assert_eq!(space.run().settings(nested.clone()).stderr().await, "");
    std::fs::remove_dir_all(space.project.join(".app")).unwrap();
    let yaml = space.write_in(&space.home, ".app/config.yaml", "limits: { bytes: many }\n");
    let json5 = space.write_in(&space.home, ".app/config.json", "{}");
    assert_eq!(
        space.run().settings(nested).stderr().await,
        several(&shown(&json5), &shown(&yaml))
    );
}

#[tokio::test]
async fn the_walk_ends_below_home_when_the_start_is_inside_home_and_the_home_file_answers_after() {
    let space = Workspace::new();
    let start = space.nest(&space.home, &["work", "deep"]);
    // A file above home is never read.
    write_json(
        &space,
        &space.root,
        ".app.json",
        json!({ "title": "above" }),
    );
    let ran = space.run().cwd(&start).ran().await;
    assert_eq!(ran.stderr, "");
    assert_eq!(ran.received(), defaults());
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(
        space.run().cwd(&start).received().await,
        defaults_with(json!({ "title": "home" }))
    );
    write_json(
        &space,
        &space.home.join("work"),
        ".app.json",
        json!({ "title": "work" }),
    );
    assert_eq!(
        space.run().cwd(&start).received().await,
        defaults_with(json!({ "title": "work" }))
    );
    // Nothing merges: the nearer file's missing keys stay at their defaults.
    write_json(&space, &space.home, ".app.json", json!({ "total": true }));
    assert_eq!(
        space.run().cwd(&start).received().await,
        defaults_with(json!({ "title": "work" }))
    );
}

#[tokio::test]
async fn the_walk_ends_at_the_root_when_the_start_is_outside_home_and_the_home_file_answers_after()
{
    let space = Workspace::new();
    let start = space.nest(&space.project, &["a", "b"]);
    write_json(
        &space,
        &space.root,
        ".app.json",
        json!({ "title": "ancestor" }),
    );
    assert_eq!(
        space.run().cwd(&start).received().await,
        defaults_with(json!({ "title": "ancestor" }))
    );
    std::fs::remove_file(space.root.join(".app.json")).unwrap();
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(
        space.run().cwd(&start).received().await,
        defaults_with(json!({ "title": "home" }))
    );
    // A home that is empty or relative is no home directory, so the walk is all there is.
    for home in [None, Some(std::path::Path::new("home"))] {
        assert_eq!(
            space.run().cwd(&start).home(home).received().await,
            defaults()
        );
    }
}

#[tokio::test]
async fn a_file_found_in_an_ancestor_shows_as_its_full_path() {
    let space = Workspace::new();
    let start = space.nest(&space.project, &["a"]);
    let found = space.write(
        ".app.json",
        &json_text(&json!({ "limits": { "bytes": {} } })),
    );
    assert_eq!(
        space.run().arg(&["-L"]).loud().cwd(&start).stderr().await,
        wrong(&[&format!(
            "Ignored option \"--limit\" from limits.bytes in {}: Use a string or a number.",
            shown(&found)
        )])
    );
    space.write_in(
        &start,
        ".app.json",
        &json_text(&json!({ "limits": { "bytes": {} } })),
    );
    assert_eq!(
        space.run().arg(&["-L"]).loud().cwd(&start).stderr().await,
        wrong(&[
            "Ignored option \"--limit\" from limits.bytes in .app.json: Use a string or a number."
        ])
    );
}

#[tokio::test]
async fn a_broken_file_in_an_ancestor_home_or_the_user_folder_warns_once() {
    let space = Workspace::new();
    let start = space.nest(&space.project, &["a"]);
    let broken = space.write(".app.json", "{");
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    write_json(
        &space,
        &space.home,
        ".config/app/config.json",
        json!({ "title": "user" }),
    );
    let ancestor = space.run().cwd(&start).ran().await;
    assert_eq!(
        ancestor.stderr,
        skipped(&shown(&broken), &invalid_json("line 1, column 2"))
    );
    assert_eq!(ancestor.received(), defaults());
    std::fs::remove_file(&broken).unwrap();
    let home_file = space.write_in(&space.home, ".app.json", "true");
    let home = space.run().cwd(&start).ran().await;
    assert_eq!(home.stderr, skipped(&shown(&home_file), NOT_OBJECT));
    assert_eq!(home.received(), defaults());
    std::fs::remove_file(&home_file).unwrap();
    let user = space.write_in(&space.home, ".config/app/config.json", "[");
    let last = space.run().cwd(&start).ran().await;
    assert_eq!(
        last.stderr,
        skipped(&shown(&user), &invalid_json("line 1, column 2"))
    );
    assert_eq!(last.received(), defaults());
}

#[tokio::test]
async fn the_user_file_shows_as_its_full_path_when_host_cwd_is_the_user_folder() {
    let space = Workspace::new();
    let user = space.write_in(&space.home, ".config/app/config.json", "[");
    let ran = space
        .run()
        .cwd(&space.home.join(".config").join("app"))
        .ran()
        .await;
    assert_eq!(
        ran.stderr,
        skipped(&shown(&user), &invalid_json("line 1, column 2"))
    );
}

#[tokio::test]
async fn the_user_file_is_under_xdg_config_home_or_under_dot_config() {
    let space = Workspace::new();
    let xdg = space.root.join("xdg");
    write_json(&space, &xdg, "app/config.json", json!({ "title": "xdg" }));
    write_json(
        &space,
        &space.home,
        ".config/app/config.json",
        json!({ "title": "dot-config" }),
    );
    assert_eq!(
        space
            .run()
            .env("XDG_CONFIG_HOME", &shown(&xdg))
            .received()
            .await,
        defaults_with(json!({ "title": "xdg" }))
    );
    for value in [None, Some(""), Some("xdg")] {
        let mut run = space.run();
        if let Some(value) = value {
            run = run.env("XDG_CONFIG_HOME", value);
        }
        assert_eq!(
            run.received().await,
            defaults_with(json!({ "title": "dot-config" })),
            "{value:?}"
        );
    }
    // With neither XDG_CONFIG_HOME nor a home directory there is no user file.
    assert_eq!(space.run().home(None).received().await, defaults());
    // The walk and the home file come before the user file.
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(
        space
            .run()
            .env("XDG_CONFIG_HOME", &shown(&xdg))
            .received()
            .await["title"],
        json!("home")
    );
}

#[cfg(all(feature = "config-toml", feature = "config-yaml"))]
#[tokio::test]
async fn each_candidate_names_one_user_file_extension_and_one_named_twice_counts_once() {
    let space = Workspace::new().with_formats(&[
        loomcli_plugins::config::toml::TOML,
        loomcli_plugins::config::yaml::YAML,
    ]);
    let xdg = shown(&space.root);
    for (file, user) in [
        (".app.toml", "config.toml"),
        (".app.yaml", "config.yaml"),
        (".app.yml", "config.yml"),
        (".app.json", "config.json"),
        (".app.jsonc", "config.jsonc"),
        (".apprc", "config.json"),
        (".app.conf", "config.json"),
    ] {
        let content = if user.contains(".json") {
            "{\"title\":\"u\"}"
        } else {
            "title: u\n"
        };
        let path = space.write_in(&space.root, &format!("app/{user}"), content);
        let ran = space
            .run()
            .settings(Settings::file(file))
            .env("XDG_CONFIG_HOME", &xdg)
            .ran()
            .await;
        // YAML text is not TOML, so a TOML candidate that was read warns instead of answering.
        if user.ends_with("toml") {
            assert_eq!(
                (ran.stderr.clone(), ran.received()),
                (
                    skipped(&shown(&path), &invalid_toml("line 1, column 8")),
                    defaults()
                ),
                "{file}"
            );
        } else {
            assert_eq!(
                (ran.stderr.clone(), ran.received()),
                (String::new(), defaults_with(json!({ "title": "u" }))),
                "{file}"
            );
        }
        std::fs::remove_file(&path).unwrap();
    }
    let toml = space.write_in(&space.root, "app/config.toml", "title = \"t\"\n");
    let json5 = space.write_in(&space.root, "app/config.json", "{\"title\":\"j\"}");
    let both = space
        .run()
        .settings(Settings::file(".app.{toml,json,toml}"))
        .env("XDG_CONFIG_HOME", &xdg)
        .ran()
        .await;
    assert_eq!(both.stderr, several(&shown(&json5), &shown(&toml)));
    assert_eq!(both.received()["title"], json!("t"));
}

#[cfg(feature = "config-toml")]
#[tokio::test]
async fn env_names_the_one_file_a_run_reads_from_the_environment_with_no_search() {
    let space = Workspace::new().with_formats(&[loomcli_plugins::config::toml::TOML]);
    let named = Settings::default().with_env("APP_CONFIG");
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "walk" }),
    );
    write_json(
        &space,
        &space.project,
        "chosen.json",
        json!({ "title": "chosen" }),
    );
    let set = space
        .run()
        .settings(named.clone())
        .env("APP_CONFIG", "chosen.json")
        .ran()
        .await;
    assert_eq!(set.stderr, "");
    assert_eq!(set.received(), defaults_with(json!({ "title": "chosen" })));
    // The value is no pattern, and its extension chooses the parser.
    write_json(
        &space,
        &space.project,
        "weird.{toml,json}",
        json!({ "title": "braces" }),
    );
    assert_eq!(
        space
            .run()
            .settings(named.clone())
            .env("APP_CONFIG", "weird.{toml,json}")
            .received()
            .await["title"],
        json!("braces")
    );
    space.write("chosen.toml", "title = \"toml\"\n");
    assert_eq!(
        space
            .run()
            .settings(named.clone())
            .env("APP_CONFIG", "chosen.toml")
            .received()
            .await["title"],
        json!("toml")
    );
    // --config comes first.
    write_json(
        &space,
        &space.project,
        "flag.json",
        json!({ "title": "flag" }),
    );
    assert_eq!(
        space
            .run()
            .arg(&["--config", "flag.json"])
            .settings(named.clone())
            .env("APP_CONFIG", "chosen.json")
            .received()
            .await["title"],
        json!("flag")
    );
    // An empty or unset variable is skipped.
    assert_eq!(
        space.run().settings(named.clone()).received().await["title"],
        json!("walk")
    );
    assert_eq!(
        space
            .run()
            .settings(named)
            .env("APP_CONFIG", "")
            .received()
            .await["title"],
        json!("walk")
    );
    // Without the setting the variable means nothing.
    assert_eq!(
        space
            .run()
            .env("APP_CONFIG", "chosen.json")
            .received()
            .await["title"],
        json!("walk")
    );
}

#[cfg(feature = "config-toml")]
#[tokio::test]
async fn a_variable_naming_a_missing_file_is_silent_and_one_naming_a_broken_file_warns_once() {
    let space = Workspace::new().with_formats(&[loomcli_plugins::config::toml::TOML]);
    let named = Settings::default().with_env("APP_CONFIG").with_notice();
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "walk" }),
    );
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    let missing = space
        .run()
        .settings(named.clone())
        .env("APP_CONFIG", "missing.json")
        .ran()
        .await;
    assert_eq!(missing.stderr, "");
    assert_eq!(missing.received(), defaults());
    std::fs::create_dir(space.project.join("missing")).unwrap();
    let beneath = space
        .run()
        .settings(named.clone())
        .env("APP_CONFIG", "missing/none.json")
        .ran()
        .await;
    assert_eq!(beneath.stderr, "");
    assert_eq!(beneath.received(), defaults());
    space.write("broken.toml", "title = ");
    let broken = space
        .run()
        .settings(named)
        .env("APP_CONFIG", "broken.toml")
        .ran()
        .await;
    assert_eq!(
        broken.stderr,
        skipped("broken.toml", &invalid_toml("line 1, column 9"))
    );
    assert_eq!(broken.received(), defaults());
}

#[tokio::test]
async fn the_directory_option_starts_the_walk_there_and_yields_to_config_and_the_variable() {
    let space = Workspace::new();
    let other = space.nest(&space.root, &["other", "deep"]);
    write_json(
        &space,
        &space.root.join("other"),
        ".app.json",
        json!({ "title": "other" }),
    );
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "cwd" }),
    );
    let named = Settings::default().with_directory("project");
    let absolute = space
        .run()
        .arg(&["--project", &shown(&other)])
        .settings(named.clone())
        .received()
        .await;
    assert_eq!(
        absolute,
        defaults_with(json!({ "project": shown(&other), "title": "other" }))
    );
    // A relative value resolves against host.cwd, and the walk climbs from it.
    assert_eq!(
        space
            .run()
            .arg(&["--project", "../other/deep"])
            .settings(named.clone())
            .received()
            .await["title"],
        json!("other")
    );
    // A directory that does not exist starts the walk there and goes on through its ancestors.
    let absent = space
        .run()
        .arg(&["--project", &shown(&other.join("nowhere").join("deeper"))])
        .settings(named.clone())
        .ran()
        .await;
    assert_eq!(absent.stderr, "");
    assert_eq!(absent.received()["title"], json!("other"));
    // Host.cwd is unchanged: a relative --config still resolves against it.
    write_json(
        &space,
        &space.project,
        "flag.json",
        json!({ "title": "flag" }),
    );
    assert_eq!(
        space
            .run()
            .arg(&["--project", &shown(&other), "--config", "flag.json"])
            .settings(named.clone())
            .received()
            .await["title"],
        json!("flag")
    );
    write_json(
        &space,
        &space.project,
        "var.json",
        json!({ "title": "var" }),
    );
    assert_eq!(
        space
            .run()
            .arg(&["--project", &shown(&other)])
            .settings(named.clone().with_env("APP_CONFIG"))
            .env("APP_CONFIG", "var.json")
            .received()
            .await["title"],
        json!("var")
    );
    // Without the operator giving it, the start is host.cwd.
    assert_eq!(
        space.run().settings(named).received().await["title"],
        json!("cwd")
    );
}

#[cfg(feature = "config-yaml")]
#[tokio::test]
async fn notice_writes_one_info_line_naming_the_first_candidate_in_the_start_directory() {
    let space = Workspace::new().with_formats(&[loomcli_plugins::config::yaml::YAML]);
    let on = Settings::default().with_notice();
    assert_eq!(
        space.run().settings(on.clone()).stderr().await,
        notice(".app.json")
    );
    // Off by default.
    assert_eq!(space.run().stderr().await, "");
    // The first candidate of the pattern, and the full path when the start is not host.cwd.
    assert_eq!(
        space
            .run()
            .settings(Settings::file(".app.{yaml,json}").with_notice())
            .stderr()
            .await,
        notice(".app.yaml")
    );
    let other = space.nest(&space.root, &["other"]);
    assert_eq!(
        space
            .run()
            .arg(&["--project", &shown(&other)])
            .settings(Settings::default().with_directory("project").with_notice())
            .stderr()
            .await,
        notice(&shown(&other.join(".app.json")))
    );
    // A file found, a broken file, and a variable naming a missing file write none.
    space.write(".app.json", "{");
    assert_eq!(
        space.run().settings(on.clone()).stderr().await,
        skipped(".app.json", &invalid_json("line 1, column 2"))
    );
    std::fs::remove_file(space.project.join(".app.json")).unwrap();
    space.write_in(&space.home, ".app.json", "{}");
    assert_eq!(space.run().settings(on.clone()).stderr().await, "");
    assert_eq!(
        space
            .run()
            .settings(Settings::default().with_env("APP_CONFIG").with_notice())
            .env("APP_CONFIG", "nope.json")
            .stderr()
            .await,
        ""
    );
    // A missing --config fails and writes no notice.
    assert_eq!(
        space
            .run()
            .arg(&["--config", "nope.json"])
            .settings(on)
            .stderr()
            .await,
        named_failure(
            "nope.json",
            "does not exist. Supply the path of an existing file."
        )
    );
}

#[tokio::test]
async fn a_directory_that_holds_dot_git_above_the_project_changes_no_result() {
    let space = Workspace::new();
    std::fs::create_dir(space.root.join(".git")).unwrap();
    let start = space.nest(&space.project, &["a"]);
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "project" }),
    );
    assert_eq!(
        space.run().cwd(&start).received().await,
        defaults_with(json!({ "title": "project" }))
    );
}

#[tokio::test]
async fn the_project_scope_alone_reads_the_walk_and_never_the_home_or_user_file() {
    let space = Workspace::new();
    let only = Settings::default().with_scopes(vec![project(&[])]);
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    write_json(
        &space,
        &space.home,
        ".config/app/config.json",
        json!({ "title": "user" }),
    );
    assert_eq!(
        space.run().settings(only.clone()).received().await,
        defaults()
    );
    // A start inside home walks to the directory below home and never looks in home itself.
    let start = space.nest(&space.home, &["work"]);
    assert_eq!(
        space
            .run()
            .settings(only.clone())
            .cwd(&start)
            .received()
            .await,
        defaults()
    );
    assert_eq!(
        space
            .run()
            .settings(only.clone())
            .cwd(&space.home)
            .received()
            .await,
        defaults()
    );
    write_json(&space, &start, ".app.json", json!({ "title": "work" }));
    assert_eq!(
        space
            .run()
            .settings(only.clone())
            .cwd(&start)
            .received()
            .await,
        defaults_with(json!({ "title": "work" }))
    );
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "project" }),
    );
    assert_eq!(
        space.run().settings(only).received().await,
        defaults_with(json!({ "title": "project" }))
    );
}

#[tokio::test]
async fn the_user_scope_alone_reads_the_home_file_then_the_user_file_and_never_the_walk() {
    let space = Workspace::new();
    let user = Settings::default().with_scopes(vec![loomcli_plugins::config::Scope::User]);
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "project" }),
    );
    assert_eq!(
        space.run().settings(user.clone()).received().await,
        defaults()
    );
    write_json(
        &space,
        &space.home,
        ".config/app/config.json",
        json!({ "title": "user" }),
    );
    assert_eq!(
        space.run().settings(user.clone()).received().await,
        defaults_with(json!({ "title": "user" }))
    );
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(
        space.run().settings(user.clone()).received().await,
        defaults_with(json!({ "title": "home" }))
    );
    // A start inside home reads the home file, and no directory between.
    let start = space.nest(&space.home, &["work"]);
    write_json(&space, &start, ".app.json", json!({ "title": "work" }));
    assert_eq!(
        space.run().settings(user).cwd(&start).received().await,
        defaults_with(json!({ "title": "home" }))
    );
}

#[tokio::test]
async fn the_project_scope_is_read_first_whatever_the_order_and_a_scope_listed_twice_counts_once() {
    use loomcli_plugins::config::Scope;
    let space = Workspace::new();
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "project" }),
    );
    for scopes in [
        vec![Scope::User, project(&[])],
        vec![project(&[]), Scope::User],
        vec![Scope::User, project(&[]), Scope::User],
    ] {
        assert_eq!(
            space
                .run()
                .settings(Settings::default().with_scopes(scopes))
                .received()
                .await,
            defaults_with(json!({ "title": "project" }))
        );
    }
    assert_eq!(
        space
            .run()
            .settings(Settings::default().with_scopes(vec![Scope::User, Scope::User]))
            .received()
            .await,
        defaults_with(json!({ "title": "home" }))
    );
}

#[tokio::test]
async fn config_and_the_variable_name_their_file_under_every_choice_of_scopes() {
    use loomcli_plugins::config::Scope;
    let space = Workspace::new();
    write_json(
        &space,
        &space.project,
        "named.json",
        json!({ "title": "named" }),
    );
    write_json(
        &space,
        &space.project,
        "variable.json",
        json!({ "title": "variable" }),
    );
    for scopes in [vec![project(&[])], vec![Scope::User]] {
        let chosen = Settings::default().with_scopes(scopes);
        assert_eq!(
            space
                .run()
                .arg(&["--config", "named.json"])
                .settings(chosen.clone())
                .received()
                .await,
            defaults_with(json!({ "config": "named.json", "title": "named" }))
        );
        assert_eq!(
            space
                .run()
                .settings(chosen.with_env("APP_CONFIG"))
                .env("APP_CONFIG", "variable.json")
                .received()
                .await,
            defaults_with(json!({ "title": "variable" }))
        );
    }
}

#[tokio::test]
async fn the_root_marker_ends_the_walk_after_the_directory_that_holds_it() {
    use loomcli_plugins::config::Scope;
    let space = Workspace::new();
    let rooted = Settings::default().with_scopes(vec![project(&["package.json"]), Scope::User]);
    let start = space.nest(&space.project, &["packages", "cli", "src"]);
    let cli = space.project.join("packages").join("cli");
    space.write_in(&cli, "package.json", "{}");
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "monorepo" }),
    );
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    // The monorepo's file above the marker is never read, and the home file answers instead.
    assert_eq!(
        space
            .run()
            .settings(rooted.clone())
            .cwd(&start)
            .received()
            .await,
        defaults_with(json!({ "title": "home" }))
    );
    // The directory that holds the marker is looked in, and a nearer file answers first.
    write_json(&space, &cli, ".app.json", json!({ "title": "cli" }));
    assert_eq!(
        space
            .run()
            .settings(rooted.clone())
            .cwd(&start)
            .received()
            .await,
        defaults_with(json!({ "title": "cli" }))
    );
    write_json(&space, &start, ".app.json", json!({ "title": "src" }));
    assert_eq!(
        space.run().settings(rooted).cwd(&start).received().await,
        defaults_with(json!({ "title": "src" }))
    );
    // With no marker the walk climbs to the monorepo's file.
    std::fs::remove_file(start.join(".app.json")).unwrap();
    std::fs::remove_file(cli.join(".app.json")).unwrap();
    for unrooted in [
        Settings::default(),
        Settings::default().with_scopes(vec![project(&[]), Scope::User]),
    ] {
        assert_eq!(
            space.run().settings(unrooted).cwd(&start).received().await,
            defaults_with(json!({ "title": "monorepo" }))
        );
    }
}

#[tokio::test]
async fn a_root_marker_is_any_entry_of_a_listed_name_a_dangling_link_included() {
    let space = Workspace::new();
    let start = space.nest(&space.project, &["a"]);
    write_json(
        &space,
        &space.root,
        ".app.json",
        json!({ "title": "above" }),
    );
    let marked = |root: &[&str]| {
        space
            .run()
            .settings(Settings::default().with_scopes(vec![project(root)]))
            .cwd(&start)
    };
    assert_eq!(
        marked(&[".git", "package.json"]).received().await,
        defaults_with(json!({ "title": "above" }))
    );
    std::fs::create_dir(space.project.join(".git")).unwrap();
    assert_eq!(
        marked(&["package.json", ".git"]).received().await,
        defaults()
    );
    assert_eq!(marked(&[".git"]).received().await, defaults());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(space.root.join("missing"), start.join("deno.json")).unwrap();
        assert_eq!(marked(&["deno.json"]).received().await, defaults());
    }
    // A marker the walk never meets leaves the walk to climb.
    assert_eq!(
        marked(&["Cargo.toml"]).received().await,
        defaults_with(json!({ "title": "above" }))
    );
}

#[tokio::test]
async fn the_walk_under_a_root_marker_still_ends_below_home_when_it_meets_no_marker() {
    use loomcli_plugins::config::Scope;
    let space = Workspace::new();
    let start = space.nest(&space.home, &["work"]);
    space.write_in(&space.root, "package.json", "{}");
    write_json(
        &space,
        &space.root,
        ".app.json",
        json!({ "title": "above" }),
    );
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(
        space
            .run()
            .settings(
                Settings::default().with_scopes(vec![project(&["package.json"]), Scope::User])
            )
            .cwd(&start)
            .received()
            .await,
        defaults_with(json!({ "title": "home" }))
    );
}

#[tokio::test]
async fn notice_names_the_home_file_when_the_scopes_do_not_list_project() {
    use loomcli_plugins::config::Scope;
    let space = Workspace::new();
    let user = Settings::default()
        .with_notice()
        .with_scopes(vec![Scope::User]);
    assert_eq!(
        space.run().settings(user.clone()).stderr().await,
        notice(&shown(&space.home.join(".app.json")))
    );
    assert_eq!(
        space.run().settings(user).cwd(&space.home).stderr().await,
        notice(".app.json")
    );
    assert_eq!(
        space
            .run()
            .settings(
                Settings::default()
                    .with_notice()
                    .with_scopes(vec![project(&[])])
            )
            .stderr()
            .await,
        notice(".app.json")
    );
}

#[tokio::test]
async fn notice_names_the_first_directory_the_lookup_looks_in_and_none_when_it_looks_nowhere() {
    let space = Workspace::new();
    // A walk from home looks nowhere, so the notice names the home file the user scope reads.
    assert_eq!(
        space
            .run()
            .settings(Settings::default().with_notice())
            .cwd(&space.home)
            .stderr()
            .await,
        notice(".app.json")
    );
    // With the project scope alone, no step reads a file there, so no line names one.
    assert_eq!(
        space
            .run()
            .settings(
                Settings::default()
                    .with_notice()
                    .with_scopes(vec![project(&[])])
            )
            .cwd(&space.home)
            .stderr()
            .await,
        ""
    );
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    assert_eq!(
        space
            .run()
            .settings(Settings::default().with_scopes(vec![project(&[])]))
            .cwd(&space.home)
            .received()
            .await,
        defaults()
    );
}

#[tokio::test]
async fn the_home_file_shows_as_its_full_path_when_host_cwd_is_home_and_the_walk_starts_outside() {
    let space = Workspace::new();
    let home = space.write_in(&space.home, ".app.json", "{");
    let ran = space
        .run()
        .arg(&["--project", &shown(&space.project)])
        .settings(Settings::default().with_directory("project"))
        .cwd(&space.home)
        .ran()
        .await;
    assert_eq!(
        ran.stderr,
        skipped(&shown(&home), &invalid_json("line 1, column 2"))
    );
}

#[tokio::test]
async fn no_config_reads_no_file_and_writes_no_notice() {
    let space = Workspace::new();
    let named = Settings::default().with_env("APP_CONFIG").with_notice();
    write_json(
        &space,
        &space.project,
        "pinned.json",
        json!({ "title": "variable" }),
    );
    write_json(
        &space,
        &space.project,
        ".app.json",
        json!({ "title": "walk" }),
    );
    write_json(&space, &space.home, ".app.json", json!({ "title": "home" }));
    write_json(
        &space,
        &space.home,
        ".config/app/config.json",
        json!({ "title": "user" }),
    );
    let variable = space
        .run()
        .arg(&["--no-config"])
        .settings(named.clone())
        .env("APP_CONFIG", "pinned.json")
        .ran()
        .await;
    assert_eq!((variable.status, variable.stderr.as_str()), (0, ""));
    assert_eq!(
        variable.received(),
        defaults_with(json!({ "no-config": true }))
    );
    for location in [&space.project, &space.home] {
        let ignored = space
            .run()
            .arg(&["--no-config"])
            .settings(named.clone())
            .cwd(location)
            .ran()
            .await;
        assert_eq!((ignored.status, ignored.stderr.as_str()), (0, ""));
        assert_eq!(
            ignored.received(),
            defaults_with(json!({ "no-config": true }))
        );
    }
    std::fs::remove_file(space.project.join(".app.json")).unwrap();
    std::fs::remove_file(space.home.join(".app.json")).unwrap();
    std::fs::remove_dir_all(space.home.join(".config")).unwrap();
    assert_eq!(
        space
            .run()
            .arg(&["--no-config"])
            .settings(named)
            .stderr()
            .await,
        ""
    );
}

#[tokio::test]
async fn no_config_beside_config_fails_with_code_2_as_an_exclusive_group_does() {
    let space = Workspace::new();
    write_json(
        &space,
        &space.project,
        "pinned.json",
        json!({ "title": "pinned" }),
    );
    for argv in [
        ["--no-config", "--config", "pinned.json"],
        ["--config", "missing.json", "--no-config"],
    ] {
        assert_eq!(
            space.run().arg(&argv).ran().await,
            Ran {
                status: 2,
                stdout: String::new(),
                stderr: format!(
                    "app: Options \"--config\" and \"--no-config\" cannot be used together. Supply only one of them.\n{HELP_HINT}"
                ),
            }
        );
    }
    let (code, output, messages) = space
        .run()
        .view_input()
        .invoked(
            loomcli_core::InvocationValues::new()
                .option("config", "pinned.json")
                .option("no-config", true),
        )
        .await;
    assert_eq!(code, Some(2));
    assert_eq!(output, "");
    assert_eq!(
        messages,
        format!(
            "{}\n",
            json!([{
                "inputs": [
                    { "global": true, "kind": "option", "name": "config" },
                    { "global": true, "kind": "option", "name": "no-config" }
                ],
                "reason": "exclusive",
                "spellings": ["config", "no-config"],
                "supplied": ["config", "no-config"]
            }])
        )
    );
}

#[tokio::test]
async fn in_an_invocation_by_name_a_named_file_that_cannot_be_used_names_config_by_its_name() {
    let space = Workspace::new();
    let (code, output, messages) = space
        .run()
        .view_input()
        .invoked(loomcli_core::InvocationValues::new().option("config", "missing.json"))
        .await;
    assert_eq!((code, output.as_str()), (Some(2), ""));
    assert_eq!(
        messages,
        format!(
            "{}\n",
            json!([{
                "input": { "global": true, "kind": "option", "name": "config" },
                "issues": [{ "message": "File \"missing.json\" does not exist. Supply the path of an existing file." }],
                "reason": "invalid",
                "spelling": "config"
            }])
        )
    );
}

#[tokio::test]
async fn a_local_structure_fault_outranks_the_input_error_a_missing_config_file_would_raise() {
    let space = Workspace::new();
    let ran = space
        .run()
        .arg(&["--config", "missing.json", "--limit"])
        .ran()
        .await;
    assert_eq!(ran.status, 2);
    assert!(
        ran.stderr.contains("Option \"--limit\" requires a value."),
        "{}",
        ran.stderr
    );
}
