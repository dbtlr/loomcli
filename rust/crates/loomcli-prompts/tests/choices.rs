//! Ports `choices.test.ts`: choice values, separators and disabled choices, navigation and search,
//! a multiselect's selection order, `min` and `max`, a source's calls and their cancellation, a
//! linked list's validator, its prefill and lookups, and the computed choices' declaration faults.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{Application, Context, Error, Issue, Opt, ValidationContext, Validator};
use loomcli_prompts::{
    Choice, ChoiceEntry, MultiselectSettings, SelectSettings, multiselect, multiselect_as, select,
};
use loomcli_testing::{
    KeyEntry, MockFields, MockProcess, MockTerminal, StreamName, key, mock_process,
};
use support::{App, entry, reads, run};
use tokio_util::sync::CancellationToken;

/// A mock with a keyboard on an 80-column terminal holding stderr.
fn terminal(keys: Vec<KeyEntry>) -> Arc<MockProcess> {
    terminal_with(MockFields::new(), 80, keys)
}

fn terminal_with(fields: MockFields, columns: u16, keys: Vec<KeyEntry>) -> Arc<MockProcess> {
    mock_process(
        fields.terminal(
            MockTerminal::new(columns, 24)
                .streams([StreamName::Stderr])
                .keys(keys),
        ),
    )
}

/// A choice value of either shape, as the reference's `'a'` beside `{ id: 2 }`.
#[derive(Clone, Debug, PartialEq)]
enum Value {
    Text(&'static str),
    Id(u32),
}

#[tokio::test]
async fn select_returns_an_object_value_and_skips_disabled_choices_and_separators() {
    let answer = Arc::new(Mutex::new(None));
    let kept = Arc::clone(&answer);
    let mock = terminal(vec![entry(&format!("{}{}", key::DOWN, key::ENTER))]);
    let app: App = Application::new("choices").action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let value = select(
                &ctx,
                SelectSettings::new("Pick", vec![Choice::new(Value::Text("a"), "a")])
                    .separator("Group")
                    .choice(Choice::new(Value::Text("b"), "b").disabled(""))
                    .choice(Choice::new(Value::Id(2), "Two")),
            )
            .await?;
            *kept.lock().unwrap() = Some(value);
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), Some(Value::Id(2)));
}

#[tokio::test]
async fn multiselect_submits_in_selection_order_while_searching() {
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal(vec![entry(&format!(
        "{}{}{}{}{}",
        key::DOWN,
        key::TAB,
        key::UP,
        key::TAB,
        key::ENTER
    ))]);
    let app: App = Application::new("choices").action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let value = multiselect(
                &ctx,
                MultiselectSettings::new("Pick", vec![Choice::text("a"), Choice::text("b")])
                    .search(),
            )
            .await?;
            *kept.lock().unwrap() = value;
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), ["b", "a"]);
}

/// What `choose` asks: search, `min`, and `max`.
#[derive(Clone, Copy, Default)]
struct Extra {
    search: bool,
    min: Option<usize>,
    max: Option<usize>,
}

fn pick_choices() -> Vec<ChoiceEntry<String>> {
    vec![
        Choice::text("alpha").into(),
        ChoiceEntry::separator("Group"),
        Choice::text("blocked").disabled("").into(),
        Choice::new("beta".to_owned(), "Beta").hint("Second").into(),
        Choice::text("gamma").into(),
    ]
}

/// The answer, the code, and stderr of the five-entry question asked with `keys`.
async fn choose(keys: KeyEntry, multiple: bool, extra: Extra) -> (Vec<String>, u8, String) {
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal(vec![keys]);
    let app: App = Application::new("choices").action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let values = if multiple {
                let mut settings = MultiselectSettings::new("Pick", vec![]);
                for entry in pick_choices() {
                    settings = match entry {
                        ChoiceEntry::Choice(choice) => settings.choice(choice),
                        ChoiceEntry::Separator(text) => settings.separator(text),
                        _ => settings,
                    };
                }
                if extra.search {
                    settings = settings.search();
                }
                if let Some(min) = extra.min {
                    settings = settings.min(min);
                }
                if let Some(max) = extra.max {
                    settings = settings.max(max);
                }
                multiselect(&ctx, settings).await?
            } else {
                let mut settings = SelectSettings::new("Pick", vec![]);
                for entry in pick_choices() {
                    settings = match entry {
                        ChoiceEntry::Choice(choice) => settings.choice(choice),
                        ChoiceEntry::Separator(text) => settings.separator(text),
                        _ => settings,
                    };
                }
                if extra.search {
                    settings = settings.search();
                }
                vec![select(&ctx, settings).await?]
            };
            *kept.lock().unwrap() = values;
            Ok(())
        }
    });
    let code = run(app, &mock).await;
    let answer = answer.lock().unwrap().clone();
    (answer, code, mock.stderr_text())
}

#[tokio::test]
async fn list_navigation_and_search() {
    let cases: Vec<(String, &str)> = vec![
        (format!("{}{}", key::ctrl('n'), key::ENTER), "beta"),
        (format!("{}{}{}", key::END, key::UP, key::ENTER), "beta"),
        (
            format!("{}{}{}{}", key::END, key::HOME, key::UP, key::ENTER),
            "alpha",
        ),
        (format!("{}{}{}", key::END, key::DOWN, key::ENTER), "gamma"),
        (
            format!("{}{}{}", key::DOWN, key::ctrl('p'), key::ENTER),
            "alpha",
        ),
        (format!("BE{}", key::ENTER), "beta"),
        (
            format!(
                "bXeta{}{}{}{}",
                key::HOME,
                key::RIGHT,
                key::ctrl('d'),
                key::ENTER
            ),
            "beta",
        ),
        (
            format!("bad{}{}gam{}", key::ENTER, key::ctrl('u'), key::ENTER),
            "gamma",
        ),
        (
            format!(
                "betx{}{}{}{}{}",
                key::BACKSPACE,
                key::HOME,
                key::RIGHT,
                key::END,
                key::ENTER
            ),
            "beta",
        ),
    ];
    for (keys, expected) in cases {
        let search = keys.starts_with('B') || keys.starts_with('b');
        let (answer, code, _) = choose(
            entry(&keys),
            false,
            Extra {
                search,
                ..Extra::default()
            },
        )
        .await;
        assert_eq!((answer, code), (vec![expected.to_owned()], 0), "{keys:?}");
    }
}

#[tokio::test]
async fn a_standalone_escape_clears_the_search_term() {
    let (answer, code, _) = choose(
        reads(&["bet", key::ESCAPE, key::ENTER]),
        false,
        Extra {
            search: true,
            ..Extra::default()
        },
    )
    .await;
    assert_eq!((answer, code), (vec!["alpha".to_owned()], 0));
}

#[tokio::test]
async fn selection_order_toggling_out_and_in_min_max_and_an_empty_answer() {
    let (answer, code, _) = choose(
        entry(&format!(
            "{}{}{}{}{}{}{}",
            key::SPACE,
            key::DOWN,
            key::TAB,
            key::UP,
            key::SPACE,
            key::SPACE,
            key::ENTER
        )),
        true,
        Extra::default(),
    )
    .await;
    assert_eq!(
        (answer, code),
        (vec!["beta".to_owned(), "alpha".to_owned()], 0)
    );
    let (answer, code, output) = choose(
        entry(&format!("{}{}{}", key::ENTER, key::SPACE, key::ENTER)),
        true,
        Extra {
            min: Some(1),
            ..Extra::default()
        },
    )
    .await;
    assert_eq!((answer, code), (vec!["alpha".to_owned()], 0));
    assert!(output.contains("Choose at least 1."));
    let (answer, code, _) = choose(
        entry(&format!(
            "{}{}{}{}",
            key::SPACE,
            key::DOWN,
            key::SPACE,
            key::ENTER
        )),
        true,
        Extra {
            max: Some(1),
            ..Extra::default()
        },
    )
    .await;
    assert_eq!((answer, code), (vec!["alpha".to_owned()], 0));
    let (answer, code, output) = choose(entry(key::ENTER), true, Extra::default()).await;
    assert_eq!((answer, code), (Vec::<String>::new(), 0));
    assert!(output.contains("none"));
}

#[tokio::test]
async fn space_enters_the_search_while_tab_toggles_and_hidden_selections_survive() {
    let (answer, code, _) = choose(
        entry(&format!("{}Beta {}", key::TAB, key::ENTER)),
        true,
        Extra {
            search: true,
            ..Extra::default()
        },
    )
    .await;
    assert_eq!((answer, code), (vec!["alpha".to_owned()], 0));
}

/// The terms a source was called with and the tokens it was handed.
type Calls = Arc<Mutex<Vec<(String, CancellationToken)>>>;

#[tokio::test]
async fn a_source_aborts_on_each_changed_term_drops_stale_rejection_waits_for_keys_and_aborts_at_answer()
 {
    let calls: Calls = Arc::default();
    let seen = Arc::clone(&calls);
    let answer = Arc::new(Mutex::new(String::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal(vec![entry(&format!("uni{}{}", key::DOWN, key::ENTER))]);
    let app: App = Application::new("source").action(move |ctx: Context| {
        let seen = Arc::clone(&seen);
        let kept = Arc::clone(&kept);
        async move {
            let value = select(
                &ctx,
                SelectSettings::from_source(
                    "Country",
                    move |term: String, token: CancellationToken| {
                        seen.lock().unwrap().push((term.clone(), token.clone()));
                        Box::pin(async move {
                            if term != "uni" {
                                token.cancelled().await;
                                return Err(Error::from_foreign("stale".into()));
                            }
                            Ok(vec![
                                Choice::text("United Kingdom").into(),
                                Choice::text("United States").into(),
                            ])
                        })
                    },
                ),
            )
            .await?;
            *kept.lock().unwrap() = value;
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), "United States");
    let calls = calls.lock().unwrap();
    assert_eq!(
        calls
            .iter()
            .map(|(term, _)| term.as_str())
            .collect::<Vec<_>>(),
        ["", "u", "un", "uni"]
    );
    assert!(calls.iter().all(|(_, token)| token.is_cancelled()));
}

#[tokio::test]
async fn the_latest_source_rejection_follows_the_ordinary_failure_path() {
    let mock = terminal(vec![entry(key::ENTER)]);
    let app: App = Application::new("source").action(|ctx: Context| async move {
        select::<_, _, String, _>(
            &ctx,
            SelectSettings::from_source("Country", |_, _| {
                Box::pin(async { Err(Error::from_foreign("Source failed.".into())) })
            }),
        )
        .await?;
        Ok(())
    });
    assert_eq!(run(app, &mock).await, 1);
    assert!(mock.stderr_text().contains("Source failed."));
    assert!(mock.stderr_text().contains("cancelled"));
}

/// A port validator that rejects `bad`.
#[derive(Clone, Copy)]
struct Port;

impl Validator for Port {
    type Output = f64;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<f64, Vec<Issue>> {
        if input == "bad" {
            return Err(vec![Issue::new("Use a port.")]);
        }
        input.parse().map_err(|_| vec![Issue::new("Use a port.")])
    }
}

#[tokio::test]
async fn linked_answers_run_their_input_validator_keep_rejected_selections_and_return_outputs() {
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal(vec![entry(&format!(
        "{}{}{}{}{}{}",
        key::TAB,
        key::DOWN,
        key::TAB,
        key::ENTER,
        key::TAB,
        key::ENTER
    ))]);
    let app: App = Application::new("linked")
        .option("port", Opt::string().multiple().validate(Port))
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value: Vec<f64> = multiselect_as(
                    &ctx,
                    MultiselectSettings::new(
                        "Ports",
                        vec![Choice::text("80"), Choice::new("bad".to_owned(), "Invalid")],
                    )
                    .option("port"),
                )
                .await?;
                *kept.lock().unwrap() = value;
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), [80.0]);
    assert!(mock.stderr_text().contains("Invalid: Use a port."));
}

#[tokio::test]
async fn supplied_source_values_get_one_lookup_each_in_supplied_order_and_duplicate_tokens_select_once()
 {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&calls);
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal_with(
        MockFields::new().argv(["--tag", "b", "--tag", "b", "--tag", "c"]),
        80,
        vec![entry(key::ENTER)],
    );
    let app: App = Application::new("linked")
        .option("tag", Opt::string().multiple())
        .action(move |ctx: Context| {
            let seen = Arc::clone(&seen);
            let kept = Arc::clone(&kept);
            async move {
                let value = multiselect(
                    &ctx,
                    MultiselectSettings::from_source("Tags", move |term: String, _| {
                        seen.lock().unwrap().push(term.clone());
                        let found = if term.is_empty() {
                            "a".to_owned()
                        } else {
                            term
                        };
                        Box::pin(async move { Ok(vec![Choice::text(found).into()]) })
                    })
                    .option("tag"),
                )
                .await?;
                *kept.lock().unwrap() = value;
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), ["b", "c"]);
    assert_eq!(*calls.lock().unwrap(), ["", "b", "c"]);
}

#[tokio::test]
async fn an_omitted_collected_input_falls_through_to_the_question_default() {
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal(vec![entry(key::ENTER)]);
    let app: App = Application::new("linked")
        .option(
            "tag",
            Opt::string().multiple().default(vec!["a".to_owned()]),
        )
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value = multiselect(
                    &ctx,
                    MultiselectSettings::new("Tags", vec![Choice::text("a"), Choice::text("b")])
                        .default(vec!["b".to_owned()])
                        .option("tag")
                        .skip_if_supplied(),
                )
                .await?;
                *kept.lock().unwrap() = value;
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), ["b"]);
}

#[tokio::test]
async fn unselectable_supplied_values_are_named_in_order() {
    let cases: Vec<(Vec<&str>, &str)> = vec![
        (
            vec!["missing", "blocked", "b", "c", "d"],
            "Cannot select \"missing\", \"blocked\". Choose from the list. Cannot select \"c\", \"d\": at most 1 can be selected. Deselect a choice to select one.",
        ),
        (
            vec!["b", "c"],
            "Cannot select \"c\": at most 1 can be selected. Deselect a choice to select it.",
        ),
    ];
    for (tokens, sentence) in cases {
        let argv: Vec<&str> = tokens.iter().flat_map(|value| ["--tag", value]).collect();
        let answer = Arc::new(Mutex::new(Vec::new()));
        let kept = Arc::clone(&answer);
        let mock = terminal_with(MockFields::new().argv(argv), 120, vec![entry(key::ENTER)]);
        let app: App = Application::new("linked")
            .option("tag", Opt::string().multiple())
            .action(move |ctx: Context| {
                let kept = Arc::clone(&kept);
                async move {
                    let value = multiselect(
                        &ctx,
                        MultiselectSettings::new(
                            "Tags",
                            vec![
                                Choice::text("b"),
                                Choice::text("c"),
                                Choice::text("d"),
                                Choice::text("blocked").disabled(""),
                            ],
                        )
                        .max(1)
                        .option("tag"),
                    )
                    .await?;
                    *kept.lock().unwrap() = value;
                    Ok(())
                }
            });
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(*answer.lock().unwrap(), ["b"]);
        assert!(
            mock.stderr_text().contains(sentence),
            "{:?}",
            mock.stderr_text()
        );
    }
}

#[tokio::test]
async fn non_interactive_supplied_lists_skip_the_source_and_selection_limits() {
    let called = Arc::new(Mutex::new(false));
    let seen = Arc::clone(&called);
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let app: App = Application::new("linked")
        .option("tag", Opt::string().multiple())
        .action(move |ctx: Context| {
            let seen = Arc::clone(&seen);
            let kept = Arc::clone(&kept);
            async move {
                let value = multiselect(
                    &ctx,
                    MultiselectSettings::from_source("Tags", move |_, _| {
                        *seen.lock().unwrap() = true;
                        Box::pin(async { Ok(Vec::<ChoiceEntry<String>>::new()) })
                    })
                    .max(1)
                    .option("tag"),
                )
                .await?;
                *kept.lock().unwrap() = value;
                Ok(())
            }
        });
    let mock = mock_process(MockFields::new().argv(["--tag", "a", "--tag", "b"]));
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), ["a", "b"]);
    assert!(!*called.lock().unwrap());
}

#[tokio::test]
async fn computed_choices_report_the_exact_declaration_sentence() {
    let cases: Vec<(MultiselectSettings<String>, &str)> = vec![
        (
            MultiselectSettings::new("Tags", vec![Choice::text("a")])
                .max(1)
                .min(2),
            "The multiselect question \"Tags\" has min 2 above max 1.",
        ),
        (
            MultiselectSettings::new("Tags", vec![Choice::text("a")]).min(2),
            "The multiselect question \"Tags\" has min 2 and 1 choices that are not disabled.",
        ),
        (
            MultiselectSettings::new("Tags", vec![Choice::text("a").disabled("")]),
            "The multiselect question \"Tags\" has no choice that is not disabled.",
        ),
    ];
    for (settings, sentence) in cases {
        let settings = Arc::new(Mutex::new(Some(settings)));
        let app: App = Application::new("linked").action(move |ctx: Context| {
            let settings = settings.lock().unwrap().take().unwrap();
            async move {
                multiselect(&ctx, settings).await?;
                Ok(())
            }
        });
        let mock = mock_process(MockFields::new());
        assert_eq!(run(app, &mock).await, 1);
        assert!(
            mock.stderr_text().contains(sentence),
            "{:?}",
            mock.stderr_text()
        );
    }
}

#[tokio::test]
async fn source_cancellation_interrupts_a_pending_list_operation_without_waiting_for_the_source() {
    let tokens = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&tokens);
    let mock = terminal(vec![entry(&format!("{}{}", key::ENTER, key::ctrl('c')))]);
    let app: App = Application::new("source").action(move |ctx: Context| {
        let seen = Arc::clone(&seen);
        async move {
            select::<_, _, String, _>(
                &ctx,
                SelectSettings::from_source("Country", move |_, token: CancellationToken| {
                    seen.lock().unwrap().push(token);
                    Box::pin(std::future::pending())
                }),
            )
            .await?;
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 130);
    assert!(tokens.lock().unwrap()[0].is_cancelled());
}

#[tokio::test]
async fn a_supplied_select_missing_from_the_first_source_page_opens_its_lookup_list_and_term() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&calls);
    let answer = Arc::new(Mutex::new(String::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal_with(
        MockFields::new().argv(["--country", "uk"]),
        80,
        vec![entry(key::ENTER)],
    );
    let app: App = Application::new("source")
        .option("country", Opt::string())
        .action(move |ctx: Context| {
            let seen = Arc::clone(&seen);
            let kept = Arc::clone(&kept);
            async move {
                let value = select(
                    &ctx,
                    SelectSettings::from_source("Country", move |term: String, _| {
                        seen.lock().unwrap().push(term.clone());
                        let found: Vec<ChoiceEntry<String>> = if term.is_empty() {
                            vec![Choice::text("fr").into()]
                        } else {
                            vec![Choice::new("uk".to_owned(), "United Kingdom").into()]
                        };
                        Box::pin(async move { Ok(found) })
                    })
                    .option("country"),
                )
                .await?;
                *kept.lock().unwrap() = value;
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), "uk");
    assert_eq!(*calls.lock().unwrap(), ["", "uk"]);
    assert!(mock.stderr_text().contains("United Kingdom"));
}
