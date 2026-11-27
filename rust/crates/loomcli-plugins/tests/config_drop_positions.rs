//! Dropped and rejected paths name an array item's position in the original file.

#![cfg(feature = "config")]
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod config_support;

use config_support::{Ran, Workspace, wrong};
use loomcli_core::{
    Application, FailureView, InputError, InputProblem, Opt, failure, override_view,
};
use loomcli_plugins::config::{ConfigurationSettings, Strict, configuration};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const WRONG: &str = "Invalid input: expected string, received number";

#[derive(Deserialize)]
#[allow(dead_code)]
struct Fixtures {
    sessions: Option<Sessions>,
    groups: Option<Vec<Group>>,
    range: Option<[f64; 2]>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Sessions {
    sources: Vec<Source>,
}

#[derive(Deserialize)]
struct Harness {
    harness: String,
}

#[derive(Deserialize)]
#[serde(try_from = "Harness")]
struct Source;

impl TryFrom<Harness> for Source {
    type Error = &'static str;

    fn try_from(harness: Harness) -> Result<Self, Self::Error> {
        if harness.harness == "bad" {
            Err("A bad harness.")
        } else {
            Ok(Self)
        }
    }
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct Group {
    items: Vec<Item>,
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

#[derive(Deserialize)]
#[serde(try_from = "Name")]
struct Item;

impl TryFrom<Name> for Item {
    type Error = &'static str;

    fn try_from(name: Name) -> Result<Self, Self::Error> {
        if name.name == "bad" {
            Err("Bad.")
        } else {
            Ok(Self)
        }
    }
}

async fn run<T: DeserializeOwned + Send + Sync + 'static>(
    contents: &Value,
    strict: Strict,
    problems_only: bool,
) -> Ran {
    let space = Workspace::new();
    space.write(".app.json", &contents.to_string());
    let config = configuration::<T>(ConfigurationSettings::new(None).strict(strict));
    let mut app = Application::new("app")
        .plugins([config.plugin])
        .global_option("loud", Opt::count().short('L').verbose())
        .uses([&config.provider]);
    if problems_only {
        app = app.overrides([override_view(
            failure::<InputError>(),
            FailureView::new(|error: &InputError, _| {
                let [InputProblem::Invalid { issues, .. }] = error.problems() else {
                    return "wrong problem".to_owned();
                };
                json!(
                    issues
                        .iter()
                        .map(|issue| &issue.message)
                        .collect::<Vec<_>>()
                )
                .to_string()
            }),
        )]);
    }
    let app = app.action(|context| async move { context.out.print("ran").await });
    space.run().arg(&["-L"]).ran_with(&app).await
}

fn multiple_rounds() -> Value {
    json!({"sessions":{"sources":[
        {"harness":1}, {"harness":"a"}, {"harness":"bad"}, {"harness":"b"}, {"harness":"bad"}
    ]}})
}

fn strict_lines(ran: Ran, expected: &[&str]) {
    assert_eq!((ran.status, ran.stdout.as_str()), (2, ""), "{}", ran.stderr);
    assert_eq!(
        ran.stderr,
        expected
            .iter()
            .map(|line| format!("app: {line}\n"))
            .collect::<String>()
    );
}

#[tokio::test]
async fn a_later_round_names_dropped_items_by_their_original_positions() {
    let ran = run::<Fixtures>(&multiple_rounds(), Strict::OFF, false).await;
    assert_eq!((ran.status, ran.stdout.as_str()), (0, "ran\n"));
    assert_eq!(
        ran.stderr,
        wrong(&[
            &format!("Ignored sessions.sources[0] in .app.json: {WRONG}"),
            "Ignored sessions.sources[2] in .app.json: A bad harness.",
            "Ignored sessions.sources[4] in .app.json: A bad harness.",
        ])
    );
}

#[tokio::test]
async fn a_strict_failure_keeps_the_original_positions_in_both_text_and_issues() {
    let lines = [
        "Configuration value sessions.sources[0].harness in .app.json: Invalid input: expected string, received number. Correct the value, or remove it.",
        "Configuration value sessions.sources[2] in .app.json: A bad harness. Correct the value, or remove it.",
        "Configuration value sessions.sources[4] in .app.json: A bad harness. Correct the value, or remove it.",
    ];
    let strict = || Strict::paths("sessions.sources", &[]);
    strict_lines(
        run::<Fixtures>(&multiple_rounds(), strict(), false).await,
        &lines,
    );

    let problems = run::<Fixtures>(&multiple_rounds(), strict(), true).await;
    assert_eq!((problems.status, problems.stdout.as_str()), (2, ""));
    assert_eq!(
        serde_json::from_str::<Value>(&problems.stderr).unwrap(),
        json!(lines)
    );
}

#[tokio::test]
async fn nested_arrays_name_each_level_and_drop_the_outer_item() {
    let contents = json!({"groups":[
        {}, {"items":[{"name":"a"},{"name":"bad"}]}, {"items":[{"name":"bad"}]}
    ]});
    let dropped = run::<Fixtures>(&contents, Strict::OFF, false).await;
    assert_eq!(dropped.status, 0);
    assert_eq!(
        dropped.stderr,
        wrong(&[
            "Ignored groups[0] in .app.json: Missing key: \"items\"",
            "Ignored groups[1] in .app.json: Bad.",
            "Ignored groups[2] in .app.json: Bad.",
        ])
    );
    strict_lines(
        run::<Fixtures>(&contents, Strict::ALL, false).await,
        &[
            "Configuration value groups[0].items in .app.json: Missing key: \"items\". Correct the value, or remove it.",
            "Configuration value groups[1].items[1] in .app.json: Bad. Correct the value, or remove it.",
            "Configuration value groups[2].items[0] in .app.json: Bad. Correct the value, or remove it.",
        ],
    );
}

#[tokio::test]
async fn a_missing_tuple_item_after_a_drop_names_the_array() {
    strict_lines(
        run::<Fixtures>(
            &json!({"range":["10",20]}),
            Strict::paths("range", &[]),
            false,
        )
        .await,
        &[
            "Configuration value range[0] in .app.json: Invalid input: expected number, received string. Correct the value, or remove it.",
            "Configuration value range in .app.json: Invalid length: expected an array of length 2. Correct the value, or remove it.",
        ],
    );
}

#[tokio::test]
async fn a_missing_tuple_item_in_an_untouched_array_keeps_its_index() {
    strict_lines(
        run::<Fixtures>(&json!({"range":[10]}), Strict::paths("range", &[]), false).await,
        &[
            "Configuration value range[1] in .app.json: Invalid length: expected an array of length 2. Correct the value, or remove it.",
        ],
    );
}

#[tokio::test]
async fn one_round_and_no_drops_write_their_ordinary_lines() {
    for (items, expected) in [
        (
            json!([{"harness":"a"},{"harness":1}]),
            wrong(&[&format!(
                "Ignored sessions.sources[1] in .app.json: {WRONG}"
            )]),
        ),
        (json!([{"harness":"a"},{"harness":"b"}]), String::new()),
    ] {
        let ran = run::<Fixtures>(&json!({"sessions":{"sources":items}}), Strict::OFF, false).await;
        assert_eq!(
            (ran.status, ran.stdout.as_str(), ran.stderr),
            (0, "ran\n", expected)
        );
    }
}
