//! The configuration plugin's linked values, ported from the reference's `config.test.ts`: what
//! each option type takes, the `-v` line for a value it cannot take, paths, escaping, and the
//! binding's own rule.

#![cfg(feature = "config")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod config_support;

use config_support::*;
use serde_json::json;

#[tokio::test]
async fn a_string_option_with_an_implied_value_takes_a_value_by_the_string_rule() {
    let space = Workspace::new();
    space.write(".app.json", &json_text(&json!({ "backup": "numbered" })));
    assert_eq!(
        space.run().received().await,
        defaults_with(json!({ "backup": "numbered" }))
    );
    assert_eq!(
        space.run().arg(&["--backup"]).received().await,
        defaults_with(json!({ "backup": "simple" }))
    );
    space.write(".app.json", &json_text(&json!({ "backup": true })));
    assert_eq!(
        space.run().arg(&["-L"]).loud().stderr().await,
        read_wrong(
            ".app.json",
            &["Ignored option \"--backup\" from backup in .app.json: Use a string or a number."]
        )
    );
}

#[tokio::test]
async fn a_value_follows_the_option_type_and_one_it_cannot_take_is_ignored_with_one_line_each() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(
            &json!({ "fields": ["a", 2], "limits": { "bytes": 5 }, "quiet": false, "total": true }),
        ),
    );
    assert_eq!(
        space.run().received().await,
        json!({
            "fields": ["a", "2"],
            "help": false,
            "limit": "5",
            "no-config": false,
            "quiet": false,
            "total": true,
            "verbose": 0,
        })
    );
    let lines = async |content: String| {
        space.write(".app.json", &content);
        let ran = space.run().arg(&["-L"]).loud().ran().await;
        assert_eq!(ran.status, 0);
        ran.stderr
    };
    assert_eq!(
        lines(json_text(&json!({ "total": "yes" }))).await,
        read_wrong(
            ".app.json",
            &["Ignored option \"--total\" from total in .app.json: Use true or false."]
        )
    );
    assert_eq!(
        lines(json_text(&json!({ "limits": { "bytes": { "max": 5 } } }))).await,
        read_wrong(
            ".app.json",
            &[
                "Ignored option \"--limit\" from limits.bytes in .app.json: Use a string or a number."
            ]
        )
    );
    assert_eq!(
        lines(json_text(&json!({ "quiet": "no" }))).await,
        read_wrong(
            ".app.json",
            &["Ignored option \"--no-quiet\" from quiet in .app.json: Use true or false."]
        )
    );
    assert_eq!(
        lines(json_text(&json!({ "fields": "a" }))).await,
        read_wrong(
            ".app.json",
            &[
                "Ignored option \"--fields\" from fields in .app.json: Use an array of strings or numbers."
            ]
        )
    );
    assert_eq!(
        lines(json_text(&json!({ "fields": ["a", {}, null] }))).await,
        read_wrong(
            ".app.json",
            &[
                "Ignored option \"--fields\" at 1 from fields in .app.json: Use a string or a number.",
                "Ignored option \"--fields\" at 2 from fields in .app.json: Use a string or a number.",
            ]
        )
    );
    assert_eq!(
        lines(json_text(&json!({ "title": null }))).await,
        read_wrong(
            ".app.json",
            &["Ignored option \"--title\" from title in .app.json: Use a string or a number."]
        )
    );
    // An overflowing literal parses as an infinity, which is no JSON number.
    assert_eq!(
        lines("{\"title\": 1e400, \"fields\": [-0, 1e21, -1e400]}".to_owned()).await,
        read_wrong(
            ".app.json",
            &[
                "Ignored option \"--fields\" at 2 from fields in .app.json: Use a string or a number.",
                "Ignored option \"--title\" from title in .app.json: Use a string or a number.",
            ]
        )
    );
    space.write(".app.json", "{\"fields\": [-0, 1e21]}");
    assert_eq!(
        space.run().received().await["fields"],
        json!(["0", "1e+21"])
    );
}

#[tokio::test]
async fn an_empty_array_fills_a_multiple_option_and_a_value_it_cannot_take_falls_to_its_default() {
    let space = Workspace::new();
    space.write(".app.json", &json_text(&json!({ "fields": [] })));
    assert_eq!(space.run().received().await, defaults());
    space.write(
        ".app.json",
        &json_text(&json!({ "limits": { "bytes": true }, "log": { "level": 7 }, "title": false })),
    );
    let ran = space.run().arg(&["-L"]).loud().ran().await;
    assert_eq!(ran.status, 0);
    let received = ran.received();
    assert_eq!(
        (received["level"].clone(), received["limit"].clone()),
        (json!("7"), json!("10"))
    );
    assert!(received.get("title").is_none());
    assert_eq!(
        ran.stderr,
        read_wrong(
            ".app.json",
            &[
                "Ignored option \"--limit\" from limits.bytes in .app.json: Use a string or a number.",
                "Ignored option \"--title\" from title in .app.json: Use a string or a number.",
            ]
        )
    );
    assert_eq!(
        space
            .run()
            .arg(&["--limit", "1", "--title", "t"])
            .received()
            .await["level"],
        json!("7")
    );
}

#[tokio::test]
async fn a_path_that_meets_a_missing_key_or_a_non_object_leads_to_no_value() {
    let space = Workspace::new();
    space.write(".app.json", &json_text(&json!({ "limits": 5 })));
    assert_eq!(space.run().received().await["limit"], json!("10"));
    space.write(
        ".app.json",
        &json_text(&json!({ "limits": { "size": "1" } })),
    );
    assert_eq!(space.run().received().await["limit"], json!("10"));
}

#[test]
fn a_bad_path_in_the_binding_panics_with_a_declaration_fault_at_the_call() {
    let message = panics(|| {
        application(&Declared {
            limit_path: Some("a..b".to_owned()),
            ..Declared::default()
        })
    })
    .expect("the declaration panics");
    // The panic carries the fault's whole diagnostic: its rule, the reference's sentence, the
    // declaration at fault, the rule's explanation, and the reference's correction.
    assert_eq!(
        message,
        concat!(
            "-- INVALID EXTENSION VALUE --------------- @loomcli/core/invalid-extension-value\n",
            "\n",
            "The root Command option \"limit\" holds an invalid \"@loomcli/plugins/config/input\" value: Supply a dotted path of nonempty keys.\n",
            "\n",
            "    Application::new(…)\n",
            "      .option(\"limit\", Opt::string().default(\"10\").description(\"The limit.\").env([\"FIXTURE_LIMIT\"]).extend([…]).validate(…))\n",
            "                                                                                                            ^ extension \"@loomcli/plugins/config/input\"\n",
            "\n",
            "An extension value passes its descriptor's schema at the call that carries it,\n",
            "synchronously, so every plugin that reads it reads a value the schema accepted.\n",
            "\n",
            "Correct the value.",
        )
    );
}

#[tokio::test]
async fn a_path_with_spaces_in_an_input_failure_prints_whole_on_a_pipe_and_a_narrow_terminal() {
    let space = Workspace::new();
    for columns in [None, Some(20)] {
        let run = |argv: &[&str]| {
            let run = space.run().arg(argv);
            match columns {
                Some(columns) => run.columns(columns),
                None => run,
            }
        };
        assert_eq!(
            run(&["--config", "my configs/missing.json"]).stderr().await,
            named_failure(
                "my configs/missing.json",
                "does not exist. Supply the path of an existing file."
            )
        );
        space.write(
            "my configs/app.json",
            &json_text(&json!({ "limits": { "bytes": "x" } })),
        );
        // The wrong value falls back to the default, so the run prints nothing.
        assert_eq!(run(&["--config", "my configs/app.json"]).stderr().await, "");
        std::fs::remove_dir_all(space.project.join("my configs")).unwrap();
    }
}

#[tokio::test]
async fn a_control_character_in_a_file_path_prints_as_its_escape() {
    let space = Workspace::new();
    assert_eq!(
        space
            .run()
            .arg(&["--config", "esc\u{1b}ape"])
            .stderr()
            .await,
        named_failure(
            "esc\\u001bape",
            "does not exist. Supply the path of an existing file."
        )
    );
}

#[tokio::test]
async fn in_an_invocation_by_name_a_value_the_option_cannot_take_names_its_declared_name() {
    let space = Workspace::new();
    space.write(
        ".app.json",
        &json_text(&json!({ "limits": { "bytes": true } })),
    );
    let (code, _, messages) = space
        .run()
        .loud()
        .invoked(loomcli_core::InvocationValues::new().option("loud", 1))
        .await;
    assert_eq!(code, None);
    assert_eq!(
        messages,
        "› Read configuration from .app.json.\n› Ignored option \"limit\" from limits.bytes in .app.json: Use a string or a number.\n"
    );
}

#[tokio::test]
async fn a_relative_path_resolves_against_the_files_directory_and_provided_keeps_it_as_written() {
    let space = Workspace::new();
    let found = space.write_in(
        &space.root,
        ".app.json",
        &json_text(&json!({ "root": "out/dir" })),
    );
    assert_eq!(found, space.root.join(".app.json"));
    let walked = space.run().shown(SchemaName::Typed).ran().await;
    assert_eq!(
        walked.received()["root"],
        json!(shown(&space.root.join("out").join("dir")))
    );
    assert_eq!(walked.provided()["root"], json!("out/dir"));
    space.write_in(
        &space.elsewhere,
        "named.json",
        &json_text(&json!({ "root": "out/dir" })),
    );
    let named = space
        .run()
        .arg(&["--config", "../elsewhere/named.json"])
        .shown(SchemaName::Typed)
        .ran()
        .await;
    assert_eq!(
        named.received()["root"],
        json!(shown(&space.elsewhere.join("out").join("dir")))
    );
    // An absolute path is the file's own, and the working directory never decides.
    space.write(".app.json", &json_text(&json!({ "root": "/abs/dir" })));
    assert_eq!(
        space.run().shown(SchemaName::Typed).received().await["root"],
        json!("/abs/dir")
    );
}

#[tokio::test]
async fn configuration_fills_arity_groups_and_ignores_a_wrong_shape_as_one_value() {
    use loomcli_core::{Application, Context, Opt, RunOptions};
    use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
    use loomcli_plugins::config::{ConfigurationSettings, configuration};
    use loomcli_testing::{MockFields, mock_process};
    use std::sync::Arc;

    let space = Workspace::new();
    let file = space.write(
        ".app.json",
        r#"{"size":[800,600],"points":[[1,2],["3",4]]}"#,
    );
    let plugin = configuration::<serde_json::Value>(ConfigurationSettings::new(None)).plugin;
    let app = Application::new("app")
        .plugins((plugin, loud()))
        .option(
            "size",
            Opt::string()
                .arity(2)
                .default(["40", "20"])
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("size"))]),
        )
        .option(
            "point",
            Opt::string()
                .arity(2)
                .multiple()
                .extend([CONFIG_INPUT.value(ConfigInputFacts::path("points"))]),
        )
        .action(|ctx: Context| async move {
            let size = ctx.option::<Option<Vec<String>>>("size")?;
            let points = ctx.option::<Vec<Vec<String>>>("point")?;
            ctx.out.print(&json!([size, points]).to_string()).await
        });
    let run = async || {
        let handle = mock_process(MockFields::new().cwd(file.parent().unwrap()).argv(["-L"]));
        let status = app
            .run(RunOptions::new().process(Arc::clone(&handle) as _))
            .await;
        assert_eq!(status.get(), 0, "{}", handle.stderr_text());
        (
            serde_json::from_str::<serde_json::Value>(&handle.stdout_text()).unwrap(),
            handle.stderr_text(),
        )
    };
    assert_eq!(
        run().await,
        (
            json!([["800", "600"], [["1", "2"], ["3", "4"]]]),
            read_line(".app.json")
        )
    );
    space.write(".app.json", r#"{"size":[800],"points":[[1,2],[3,false]]}"#);
    let (value, stderr) = run().await;
    assert_eq!(value, json!([["40", "20"], []]));
    assert_eq!(
        stderr,
        read_wrong(
            ".app.json",
            &[
                "Ignored option \"--size\" from size in .app.json: Use an array of 2 strings or numbers.",
                "Ignored option \"--point\" from points in .app.json: Use an array of arrays, each of 2 strings or numbers.",
            ]
        )
    );
}
