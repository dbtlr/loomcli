//! The configuration plugin's formats through a run, ported from the reference's `config.test.ts`:
//! the extension chooses the parser, a pattern's candidates, JSON with comments, TOML and YAML
//! values, a YAML file's validity, aliases, and a byte order mark. The parsers' own cases, from
//! `config-formats.test.ts`, are unit tests beside each parser in `src/config`.

#![cfg(all(feature = "config-toml", feature = "config-yaml"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod config_support;

use config_support::*;
use loomcli_plugins::config::{toml::TOML, yaml::YAML};
use serde_json::json;

#[tokio::test]
async fn the_extension_chooses_the_parser_as_written_for_a_discovered_and_a_named_file() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let values = json_text(&json!({ "limits": { "bytes": "5" }, "total": true }));
    let filled = defaults_with(json!({ "limit": "5", "total": true }));
    for (file, content) in [
        (
            ".app.toml",
            "total = true\n[limits]\nbytes = \"5\"\n".to_owned(),
        ),
        (
            ".app.yaml",
            "total: true\nlimits:\n  bytes: \"5\"\n".to_owned(),
        ),
        (
            ".app.yml",
            "total: true\nlimits: { bytes: \"5\" }\n".to_owned(),
        ),
        (".apprc", values.clone()),
        (".app.conf", values.clone()),
        ("config.cfg", values.clone()),
    ] {
        space.write(file, &content);
        let discovered = space.run().settings(Settings::file(file)).ran().await;
        assert_eq!(
            (discovered.status, discovered.stderr.as_str()),
            (0, ""),
            "{file}"
        );
        assert_eq!(discovered.received(), filled, "{file}");
        let mut named = filled.clone();
        named["config"] = json!(file);
        assert_eq!(
            space.run().arg(&["--config", file]).received().await,
            named,
            "{file}"
        );
    }
    // An extension compares as written, so .TOML reads as JSON.
    space.write(".app.TOML", "total = true\n");
    assert_eq!(
        space
            .run()
            .settings(Settings::file(".app.TOML"))
            .stderr()
            .await,
        skipped(".app.TOML", &invalid_json("line 1, column 1"))
    );
    // A leading dot starts the name, so .toml is a name with no extension and reads as JSON.
    space.write(".toml", "total = true\n");
    assert_eq!(
        space.run().settings(Settings::file(".toml")).stderr().await,
        skipped(".toml", &invalid_json("line 1, column 1"))
    );
}

#[tokio::test]
async fn the_first_present_candidate_is_read_and_every_later_one_is_skipped_with_one_warning() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let any = Settings::file(".app.*");
    space.write(".app.json", &json_text(&json!({ "title": "json" })));
    let ran = space.run().settings(any.clone()).ran().await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    space.write(".app.yml", "title: yml\n");
    let yml = space.run().settings(any.clone()).ran().await;
    assert_eq!(yml.stderr, several(".app.json", ".app.yml"));
    assert_eq!(yml.received()["title"], json!("yml"));
    // A skipped candidate is never read, so a broken one adds no warning of its own.
    space.write(".app.json", "{");
    space.write(".app.yaml", "title: [");
    space.write(".app.toml", "title = \"toml\"\n");
    let toml = space.run().settings(any.clone()).ran().await;
    assert_eq!(
        toml.stderr,
        several(".app.yaml, .app.yml, .app.json", ".app.toml")
    );
    assert_eq!(toml.received()["title"], json!("toml"));
    // A broken first candidate is never replaced by a later one, and no later location answers.
    space.write(".app.toml", "title = ");
    space.write_in(
        &space.home,
        ".app.json",
        &json_text(&json!({ "title": "home" })),
    );
    let broken = space.run().settings(any).ran().await;
    assert_eq!(
        broken.stderr,
        format!(
            "{}{}",
            several(".app.yaml, .app.yml, .app.json", ".app.toml"),
            skipped(".app.toml", &invalid_toml("line 1, column 9"))
        )
    );
    assert_eq!(broken.received(), defaults());
}

#[tokio::test]
async fn a_brace_list_orders_its_candidates_as_listed_a_repeat_at_its_first_position() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    space.write(".app.toml", "title = \"toml\"\n");
    space.write(".app.json", &json_text(&json!({ "title": "json" })));
    let listed = space
        .run()
        .settings(Settings::file(".app.{json,toml,json}"))
        .ran()
        .await;
    assert_eq!(listed.stderr, several(".app.toml", ".app.json"));
    assert_eq!(listed.received()["title"], json!("json"));
    let literal = space
        .run()
        .settings(Settings::file(".app.toml"))
        .ran()
        .await;
    assert_eq!((literal.status, literal.stderr.as_str()), (0, ""));
    assert_eq!(literal.received()["title"], json!("toml"));
}

#[tokio::test]
async fn a_pattern_may_list_jsonc_and_star_tries_jsonc_after_json() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    space.write(".app.jsonc", &json_text(&json!({ "title": "jsonc" })));
    for file in [".app.{toml,jsonc}", ".app.*"] {
        let ran = space.run().settings(Settings::file(file)).ran().await;
        assert_eq!(ran.stderr, "", "{file}");
        assert_eq!(ran.received()["title"], json!("jsonc"), "{file}");
    }
    space.write(".app.json", &json_text(&json!({ "title": "json" })));
    let both = space.run().settings(Settings::file(".app.*")).ran().await;
    assert_eq!(both.stderr, several(".app.jsonc", ".app.json"));
    assert_eq!(both.received()["title"], json!("json"));
}

#[tokio::test]
async fn a_toml_integer_beyond_the_safe_range_fills_its_exact_digits_and_a_count_its_nearest() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    space.write(
        ".app.toml",
        "title = \"kept\"\nverbose = 123456789012345678\n[limits]\nbytes = 123456789012345678\n",
    );
    let ran = space
        .run()
        .settings(Settings::file(".app.toml"))
        .ran()
        .await;
    assert_eq!(ran.stderr, "");
    // A count above the largest the run holds reads as that largest count.
    assert_eq!(
        ran.received(),
        defaults_with(json!({
            "limit": "123456789012345678",
            "title": "kept",
            "verbose": u32::MAX,
        }))
    );
}

#[tokio::test]
async fn a_toml_number_fills_as_json_writes_it_and_a_date_or_time_as_written() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let toml = Settings::file(".app.toml");
    space.write(
        ".app.toml",
        &[
            "title = 1979-05-27T07:32:00-08:00",
            "fields = [1979-05-27 07:32:00, 1979-05-27, 07:32:00.5, 1979-05-27t07:32:00.999999z, 5_000, 0x1F, 1.0]",
            "[limits]",
            "bytes = 9_007_199_254_740_991",
            "",
        ]
        .join("\n"),
    );
    assert_eq!(
        space.run().settings(toml.clone()).received().await,
        defaults_with(json!({
            "fields": [
                "1979-05-27 07:32:00",
                "1979-05-27",
                "07:32:00.5",
                "1979-05-27t07:32:00.999999z",
                "5000",
                "31",
                "1",
            ],
            "limit": "9007199254740991",
            "title": "1979-05-27T07:32:00-08:00",
        }))
    );
    // Date text in a string, a comment, or a key stays what it is.
    space.write(
        ".app.toml",
        &[
            "title = \"1979-05-27 07:32:00\" # 07:32:00",
            r#"fields = ['''x 1979-05-27''', """a 07:32:00"""", "b \" 07:32:00", """c \""" 07:32:00""", 07:32:00]"#,
            "[1979-05-27]",
            "bytes = 5",
            "",
        ]
        .join("\n"),
    );
    assert_eq!(
        space
            .run()
            .settings(toml)
            .limit_path("1979-05-27.bytes")
            .received()
            .await,
        defaults_with(json!({
            "fields": ["x 1979-05-27", "a 07:32:00\"", "b \" 07:32:00", "c \"\"\" 07:32:00", "07:32:00"],
            "limit": "5",
            "title": "1979-05-27 07:32:00",
        }))
    );
}

#[tokio::test]
async fn a_toml_value_the_option_cannot_take_is_ignored_and_an_invalid_date_is_invalid_toml() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let toml = Settings::file(".app.toml");
    for (content, line) in [
        (
            "total = 1979-05-27\n",
            "Ignored option \"--total\" from total in .app.toml: Use true or false.",
        ),
        (
            "title = inf\n",
            "Ignored option \"--title\" from title in .app.toml: Use a string or a number.",
        ),
        (
            "title = nan\n",
            "Ignored option \"--title\" from title in .app.toml: Use a string or a number.",
        ),
        (
            "[title]\n",
            "Ignored option \"--title\" from title in .app.toml: Use a string or a number.",
        ),
        (
            "fields = [1, -inf]\n",
            "Ignored option \"--fields\" at 1 from fields in .app.toml: Use a string or a number.",
        ),
    ] {
        space.write(".app.toml", content);
        let ran = space
            .run()
            .arg(&["-L"])
            .settings(toml.clone())
            .loud()
            .ran()
            .await;
        assert_eq!(
            (ran.status, ran.stderr),
            (0, read_wrong(".app.toml", &[line])),
            "{content:?}"
        );
    }
    space.write(".app.toml", "");
    let empty = space.run().settings(toml.clone()).ran().await;
    assert_eq!((empty.status, empty.stderr.as_str()), (0, ""));
    assert_eq!(empty.received(), defaults());
    for (content, at) in [
        ("title = 1979-13-45\n", "line 1, column 9"),
        ("title = \"open\n", "line 1, column 14"),
        ("a = 1\na = 2\n", "line 2, column 1"),
    ] {
        space.write(".app.toml", content);
        assert_eq!(
            space.run().settings(toml.clone()).stderr().await,
            skipped(".app.toml", &invalid_toml(at)),
            "{content:?}"
        );
        assert_eq!(
            space.run().arg(&["--config", ".app.toml"]).stderr().await,
            named_failure(
                ".app.toml",
                &format!("is not valid TOML at {at}. Correct its syntax, or supply another file.")
            ),
            "{content:?}"
        );
    }
}

#[tokio::test]
async fn a_counted_option_takes_a_whole_number_of_0_or_more_and_any_other_value_is_ignored() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    space.write(".app.json", &json_text(&json!({ "verbose": 3 })));
    assert_eq!(
        space.run().received().await,
        defaults_with(json!({ "verbose": 3 }))
    );
    space.write(".app.json", &json_text(&json!({ "verbose": 0 })));
    assert_eq!(space.run().received().await, defaults());
    assert_eq!(
        space.run().arg(&["-v"]).received().await,
        defaults_with(json!({ "verbose": 1 }))
    );
    for value in [json!("3"), json!(-1), json!(1.5), json!(true)] {
        space.write(".app.json", &json_text(&json!({ "verbose": value })));
        let ran = space.run().arg(&["-L"]).loud().ran().await;
        assert_eq!(
            (ran.status, ran.stderr),
            (
                0,
                read_wrong(
                    ".app.json",
                    &[
                        "Ignored option \"--verbose\" from verbose in .app.json: Use a whole number of 0 or more."
                    ]
                )
            ),
            "{value}"
        );
    }
    let toml = Settings::file(".app.toml");
    space.write(".app.toml", "verbose = 1_0\n");
    assert_eq!(
        space.run().settings(toml.clone()).received().await,
        defaults_with(json!({ "verbose": 10 }))
    );
    space.write(".app.toml", "verbose = 3.0\n");
    assert_eq!(
        space.run().settings(toml).received().await,
        defaults_with(json!({ "verbose": 3 }))
    );
    space.write(".app.yaml", "verbose: 0x3\n");
    assert_eq!(
        space
            .run()
            .settings(Settings::file(".app.yaml"))
            .received()
            .await,
        defaults_with(json!({ "verbose": 3 }))
    );
}

#[tokio::test]
async fn a_yaml_file_reads_under_the_core_schema_with_aliases_resolved() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    space.write(
        ".app.yaml",
        &[
            "total: True",
            "quiet: FALSE",
            "title: 2001-12-14",
            "log: { level: &level debug }",
            "fields: [*level, 0x1F, 1.0, no]",
            "",
        ]
        .join("\n"),
    );
    assert_eq!(
        space
            .run()
            .settings(Settings::file(".app.yaml"))
            .received()
            .await,
        json!({
            "fields": ["debug", "31", "1", "no"],
            "help": false,
            "level": "debug",
            "limit": "10",
            "no-config": false,
            "quiet": false,
            "title": "2001-12-14",
            "total": true,
            "verbose": 0,
        })
    );
}

#[tokio::test]
async fn a_yaml_file_that_reuses_one_profile_across_many_environments_reads_every_alias() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let mut lines = vec![
        "limits: &limits { bytes: 7 }".to_owned(),
        "profile: &profile".to_owned(),
        "  fetch: *limits".to_owned(),
        "  store: *limits".to_owned(),
        "  index: *limits".to_owned(),
        "environments:".to_owned(),
    ];
    lines.extend((0..30).map(|index| format!("  env{index}: *profile")));
    lines.push(String::new());
    space.write(".app.yaml", &lines.join("\n"));
    let ran = space
        .run()
        .settings(Settings::file(".app.yaml"))
        .limit_path("environments.env29.index.bytes")
        .ran()
        .await;
    assert_eq!(ran.stderr, "");
    assert_eq!(ran.received()["limit"], json!("7"));
}

#[tokio::test]
async fn a_yaml_value_the_option_cannot_take_is_ignored_with_a_v_line() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let yaml = Settings::file(".app.yaml");
    let title = "Ignored option \"--title\" from title in .app.yaml: Use a string or a number.";
    let total = "Ignored option \"--total\" from total in .app.yaml: Use true or false.";
    for (content, line) in [
        ("total: no\n", total),
        ("total: on\n", total),
        ("title: null\n", title),
        ("title: ~\n", title),
        ("title:\n", title),
        ("title: .inf\n", title),
        ("title: .nan\n", title),
        ("title: { a: 1 }\n", title),
    ] {
        space.write(".app.yaml", content);
        let ran = space
            .run()
            .arg(&["-L"])
            .settings(yaml.clone())
            .loud()
            .ran()
            .await;
        assert_eq!(
            (ran.status, ran.stderr),
            (0, read_wrong(".app.yaml", &[line])),
            "{content:?}"
        );
    }
}

#[tokio::test]
async fn a_yaml_file_outside_one_core_schema_document_with_unique_keys_is_not_valid_yaml() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let yaml = Settings::file(".app.yaml");
    for (content, at) in [
        ("title: a\n---\ntitle: b\n", "line 2, column 1"),
        ("title: a\ntitle: b\n", "line 2, column 1"),
        ("title: !!binary aGVsbG8=\n", "line 1, column 8"),
        ("title: !!timestamp 2001-12-14\n", "line 1, column 8"),
        ("title: !local value\n", "line 1, column 8"),
        ("title: !!set { a }\n", "line 1, column 8"),
        ("title: [\n", "line 2, column 1"),
    ] {
        space.write(".app.yaml", content);
        let ran = space.run().settings(yaml.clone()).ran().await;
        assert_eq!(
            (ran.status, ran.stderr),
            (0, skipped(".app.yaml", &invalid_yaml(at))),
            "{content:?}"
        );
        assert_eq!(
            space.run().arg(&["--config", ".app.yaml"]).stderr().await,
            named_failure(
                ".app.yaml",
                &format!("is not valid YAML at {at}. Correct its syntax, or supply another file.")
            ),
            "{content:?}"
        );
    }
    for content in ["", "# only a comment\n", "---\n", "- a\n", "hello\n"] {
        space.write(".app.yaml", content);
        let ran = space.run().settings(yaml.clone()).ran().await;
        assert_eq!(
            (ran.status, ran.stderr),
            (0, skipped(".app.yaml", NOT_MAPPING)),
            "{content:?}"
        );
        assert_eq!(
            space.run().arg(&["--config", ".app.yaml"]).stderr().await,
            named_failure(
                ".app.yaml",
                "does not hold a YAML mapping. Write its settings as one YAML mapping."
            ),
            "{content:?}"
        );
    }
}

#[tokio::test]
async fn a_yaml_syntax_mistake_breaks_at_the_place_the_reference_names() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let yaml = Settings::file(".app.yaml");
    for (content, at) in [
        ("total: true\n\ttitle: a\n", "line 2, column 1"),
        ("title: \"unterminated\n", "line 2, column 1"),
        ("title: a\n  total: true\n", "line 1, column 8"),
        ("title: a\ntotal\n", "line 2, column 1"),
        ("list:\n  - name: x\n   bad: 2\n", "line 3, column 1"),
        ("title: \"a\\qb\"\n", "line 1, column 10"),
        ("title: !!float 5\n", "line 1, column 8"),
    ] {
        space.write(".app.yaml", content);
        let ran = space.run().settings(yaml.clone()).ran().await;
        assert_eq!(
            (ran.status, ran.stderr),
            (0, skipped(".app.yaml", &invalid_yaml(at))),
            "{content:?}"
        );
        assert_eq!(
            space.run().arg(&["--config", ".app.yaml"]).stderr().await,
            named_failure(
                ".app.yaml",
                &format!("is not valid YAML at {at}. Correct its syntax, or supply another file.")
            ),
            "{content:?}"
        );
    }
}

#[tokio::test]
async fn a_yaml_non_specific_tag_an_alias_key_and_a_tab_after_a_colon_read_as_the_reference_reads_them()
 {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    for (content, title) in [
        ("title: ! 5\n", "5"),
        ("&key title: first\n*key : second\n", "second"),
        ("title:\tvalue\n", "value"),
    ] {
        space.write(".app.yaml", content);
        let ran = space
            .run()
            .settings(Settings::file(".app.yaml"))
            .ran()
            .await;
        assert_eq!((ran.status, ran.stderr.as_str()), (0, ""), "{content:?}");
        assert_eq!(ran.received()["title"], json!(title), "{content:?}");
    }
}

#[tokio::test]
async fn an_alias_that_names_no_preceding_anchor_is_not_valid_yaml_at_the_alias() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let yaml = Settings::file(".app.yaml");
    space.write_in(&space.home, ".app.yaml", "title: home\n");
    for (content, at) in [
        (
            "defaults: &defaults 5\ntitle: *defualts\n",
            "line 2, column 8",
        ),
        ("title: *later\nlater: &later 1\n", "line 1, column 8"),
        ("*nope : 1\ntitle: own\n", "line 1, column 1"),
    ] {
        space.write(".app.yaml", content);
        let discovered = space.run().settings(yaml.clone()).ran().await;
        assert_eq!(
            (discovered.status, discovered.stderr.clone()),
            (0, skipped(".app.yaml", &invalid_yaml(at))),
            "{content:?}"
        );
        assert_eq!(discovered.received(), defaults());
        let named = space.run().arg(&["--config", ".app.yaml"]).ran().await;
        assert_eq!(
            (named.status, named.stderr),
            (
                2,
                named_failure(
                    ".app.yaml",
                    &format!(
                        "is not valid YAML at {at}. Correct its syntax, or supply another file."
                    )
                )
            ),
            "{content:?}"
        );
    }
}

#[tokio::test]
async fn a_yaml_anchor_that_refers_to_itself_is_not_valid_yaml_at_the_alias() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    space.write(
        ".app.yaml",
        "tree: &t\n  name: root\n  child: *t\nretries: many\n",
    );
    let ran = space
        .run()
        .arg(&["-L"])
        .settings(Settings::file(".app.yaml"))
        .schema(SchemaName::Typed)
        .loud()
        .ran()
        .await;
    assert_eq!(ran.status, 0);
    assert_eq!(ran.received()["limit"], json!("10"));
    assert_eq!(
        ran.stderr,
        skipped(".app.yaml", &invalid_yaml("line 3, column 10"))
    );
}

#[tokio::test]
async fn a_leading_byte_order_mark_reads_in_every_format_and_an_empty_named_file_is_not_json() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    for (file, content) in [
        (".app.json", json_text(&json!({ "title": "bom" }))),
        (".app.toml", "title = \"bom\"\n".to_owned()),
        (".app.yaml", "title: bom\n".to_owned()),
    ] {
        space.write(file, &format!("\u{feff}{content}"));
        assert_eq!(
            space.run().settings(Settings::file(file)).received().await["title"],
            json!("bom"),
            "{file}"
        );
    }
    space.write("empty.json", "");
    assert_eq!(
        space.run().arg(&["--config", "empty.json"]).stderr().await,
        named_failure(
            "empty.json",
            "is not valid JSON at line 1, column 1. Correct its syntax, or supply another file."
        )
    );
}

#[tokio::test]
async fn a_json_file_holds_comments_and_trailing_commas_and_a_broken_one_names_where_it_breaks() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    let commented = [
        "{",
        "  // The byte threshold, raised for the archive.",
        "  \"limits\": { \"bytes\": 5, },",
        "  /* The title shows in reports. */",
        "  \"title\": \"noted\",",
        "}",
    ]
    .join("\n");
    for file in [".app.json", ".app.jsonc", ".apprc"] {
        space.write(file, &commented);
        assert_eq!(
            space.run().settings(Settings::file(file)).received().await,
            defaults_with(json!({ "limit": "5", "title": "noted" })),
            "{file}"
        );
    }
    space.write(".app.json", "{\n  \"title\": \"a\",\n  \"total\": tru\n}");
    assert_eq!(
        space.run().stderr().await,
        skipped(".app.json", &invalid_json("line 3, column 12"))
    );
    assert_eq!(
        space.run().arg(&["--config", ".app.json"]).stderr().await,
        named_failure(
            ".app.json",
            "is not valid JSON at line 3, column 12. Correct its syntax, or supply another file."
        )
    );
}

#[tokio::test]
async fn a_segment_named_after_an_object_prototype_member_answers_only_from_an_own_key() {
    let space = Workspace::new().with_formats(&[TOML, YAML]);
    space.write(
        ".app.json",
        &json_text(&json!({ "limits": { "bytes": "1" } })),
    );
    assert!(space.run().received().await.get("owner").is_none());
    for (file, content) in [
        (".app.json", json_text(&json!({ "constructor": "own" }))),
        (".app.toml", "constructor = \"own\"\n".to_owned()),
        (".app.yaml", "constructor: own\n".to_owned()),
    ] {
        space.write(file, &content);
        assert_eq!(
            space.run().settings(Settings::file(file)).received().await["owner"],
            json!("own"),
            "{file}"
        );
    }
    // A YAML __proto__ key is an own key, which a request path reaches like any other.
    space.write(".app.yaml", "__proto__:\n  bytes: 7\n");
    assert_eq!(
        space
            .run()
            .settings(Settings::file(".app.yaml"))
            .limit_path("__proto__.bytes")
            .received()
            .await["limit"],
        json!("7")
    );
}
