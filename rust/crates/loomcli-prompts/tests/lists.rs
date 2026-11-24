//! Ports `lists.test.ts`: select and multiselect behavior through the public surface, reading the
//! answer, the exit code, and the frames the question drew through a recording override.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, Context, Error, Issue, Opt, ValidationContext, Validator, View, ViewContext,
    ViewOverride, override_view,
};
use loomcli_prompts::views::{ListFrame, ListRow, QuestionFrame, question_frame};
use loomcli_prompts::{
    Choice, ChoiceEntry, MultiselectSettings, SelectSettings, TextSettings, Verbatim, multiselect,
    multiselect_as, select, select_as, text,
};
use loomcli_testing::{
    KeyEntry, MockFields, MockProcess, MockTerminal, StreamName, key, mock_process,
};
use support::{App, entry, run, strip};
use tokio_util::sync::CancellationToken;

/// The frames a question draws, recorded through an override that draws each as the default.
#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<QuestionFrame>>>);

impl Recorder {
    fn view(&self) -> ViewOverride {
        let frames = Arc::clone(&self.0);
        override_view(
            question_frame(),
            View::new(move |data: &QuestionFrame, context: &ViewContext| {
                frames.lock().unwrap().push(data.clone());
                question_frame().render(data, context)
            }),
        )
    }

    /// The list frames among the recorded ones.
    fn lists(&self) -> Vec<ListFrame> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|frame| match frame {
                QuestionFrame::List(list) => Some(list.clone()),
                _ => None,
            })
            .collect()
    }
}

/// The label of each visible row of a list frame.
fn labels(frame: &ListFrame) -> Vec<String> {
    frame
        .choices
        .iter()
        .map(|row| match row {
            ListRow::Choice(choice) => choice.label.clone(),
            ListRow::Separator(label) => label.clone(),
            _ => String::new(),
        })
        .collect()
}

fn terminal(fields: MockFields, keys: Vec<KeyEntry>) -> Arc<MockProcess> {
    mock_process(
        fields.terminal(
            MockTerminal::new(80, 24)
                .streams([StreamName::Stderr])
                .keys(keys),
        ),
    )
}

fn regions(term: &str) -> Vec<ChoiceEntry<String>> {
    if term.is_empty() {
        vec![
            Choice::text("us-east").into(),
            Choice::text("eu-west").into(),
        ]
    } else {
        Vec::new()
    }
}

/// A slot for one answer.
fn answer_slot<T>() -> Arc<Mutex<Option<T>>> {
    Arc::new(Mutex::new(None))
}

#[tokio::test]
async fn a_supplied_value_whose_lookup_finds_it_disabled_keeps_the_first_list() {
    let lookups: Vec<Vec<ChoiceEntry<String>>> = vec![
        vec![
            Choice::text("ap-south").disabled("needs an account").into(),
            Choice::text("ap-north").into(),
        ],
        vec![
            ChoiceEntry::separator("Asia"),
            Choice::text("ap-south").disabled("").into(),
        ],
    ];
    for lookup in lookups {
        let answer = answer_slot::<String>();
        let kept = Arc::clone(&answer);
        let mock = terminal(
            MockFields::new().argv(["--pick", "ap-south"]),
            vec![entry(key::ENTER)],
        );
        let app: App = Application::new("regions")
            .option("pick", Opt::string())
            .action(move |ctx: Context| {
                let kept = Arc::clone(&kept);
                let lookup = lookup.clone();
                async move {
                    let value = select(
                        &ctx,
                        SelectSettings::from_source("Region", move |term: String, _| {
                            let found = if term == "ap-south" {
                                lookup.clone()
                            } else {
                                regions(&term)
                            };
                            Box::pin(async move { Ok(found) })
                        })
                        .option("pick"),
                    )
                    .await?;
                    *kept.lock().unwrap() = Some(value);
                    Ok(())
                }
            });
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(answer.lock().unwrap().as_deref(), Some("us-east"));
        assert!(
            strip(&mock.stderr_text())
                .contains("Cannot select \"ap-south\". Choose from the list.")
        );
    }
}

/// A future that settles only after the runtime has turned once, so it is not ready at once.
async fn later<T>(value: T) -> T {
    tokio::task::yield_now().await;
    value
}

#[tokio::test]
async fn a_supplied_value_draws_the_loading_frame_before_its_slow_first_call_and_lookup_settle() {
    let recorder = Recorder::default();
    let answer = answer_slot::<String>();
    let kept = Arc::clone(&answer);
    let mock = terminal(
        MockFields::new().argv(["--pick", "ap-south"]),
        vec![entry(key::ENTER)],
    );
    let app: App = Application::new("regions")
        .overrides([recorder.view()])
        .option("pick", Opt::string())
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value = select(
                    &ctx,
                    SelectSettings::from_source("Region", |term: String, _| {
                        let found = if term == "ap-south" {
                            vec![
                                Choice::text("ap-south").into(),
                                Choice::text("ap-north").into(),
                            ]
                        } else {
                            regions(&term)
                        };
                        Box::pin(later(Ok(found)))
                    })
                    .option("pick"),
                )
                .await?;
                *kept.lock().unwrap() = Some(value);
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(answer.lock().unwrap().as_deref(), Some("ap-south"));
    let drawn = recorder.lists();
    assert!(drawn[0].choices.is_empty());
    assert_eq!(drawn[0].highlighted, None);
    assert!(drawn[0].loading);
    let last = drawn.last().unwrap();
    assert_eq!(last.highlighted, Some(0));
    assert!(!last.loading);
    assert_eq!(last.term.as_deref(), Some("ap-south"));
    assert_eq!(labels(last), ["ap-south", "ap-north"]);
    let output = strip(&mock.stderr_text());
    let searching = output.find("Searching…").unwrap();
    assert!(searching < output.find("❯ ap-south").unwrap());
}

#[tokio::test]
async fn a_lookup_a_first_call_settled_at_once_draws_a_loading_frame_over_the_first_list() {
    let recorder = Recorder::default();
    let answer = answer_slot::<String>();
    let kept = Arc::clone(&answer);
    let mock = terminal(
        MockFields::new().argv(["--pick", "ap-south"]),
        vec![entry(key::ENTER)],
    );
    let app: App = Application::new("regions")
        .overrides([recorder.view()])
        .option("pick", Opt::string())
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value = select(
                    &ctx,
                    SelectSettings::from_source("Region", |term: String, _| {
                        if term.is_empty() {
                            let found = regions(&term);
                            Box::pin(async move { Ok(found) })
                        } else {
                            Box::pin(later(Ok(vec![Choice::text("ap-south").into()])))
                        }
                    })
                    .option("pick"),
                )
                .await?;
                *kept.lock().unwrap() = Some(value);
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(answer.lock().unwrap().as_deref(), Some("ap-south"));
    let drawn = recorder.lists();
    assert!(drawn[0].loading);
    assert_eq!(labels(&drawn[0]), ["us-east", "eu-west"]);
    let last = drawn.last().unwrap();
    assert!(!last.loading);
    assert_eq!(last.term.as_deref(), Some("ap-south"));
}

#[tokio::test]
async fn a_hanging_lookup_still_draws_the_loading_frame_and_ctrl_c_cancels_it() {
    let recorder = Recorder::default();
    let tokens = Arc::new(Mutex::new(Vec::<CancellationToken>::new()));
    let seen = Arc::clone(&tokens);
    let mock = terminal(
        MockFields::new().argv(["--pick", "ap-south"]),
        vec![entry(&key::ctrl('c'))],
    );
    let app: App = Application::new("regions")
        .overrides([recorder.view()])
        .option("pick", Opt::string())
        .action(move |ctx: Context| {
            let seen = Arc::clone(&seen);
            async move {
                select(
                    &ctx,
                    SelectSettings::from_source("Region", move |term: String, token| {
                        seen.lock().unwrap().push(token);
                        if term.is_empty() {
                            let found = regions(&term);
                            Box::pin(async move { Ok(found) })
                        } else {
                            Box::pin(std::future::pending())
                        }
                    })
                    .option("pick"),
                )
                .await?;
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 130);
    assert!(recorder.lists()[0].loading);
    assert!(strip(&mock.stderr_text()).contains("Searching…"));
    let tokens = tokens.lock().unwrap();
    assert_eq!(tokens.len(), 2);
    assert!(tokens.iter().all(CancellationToken::is_cancelled));
}

#[tokio::test]
async fn a_none_default_opens_on_the_choice_whose_value_is_none() {
    let answer = answer_slot::<Option<i32>>();
    let kept = Arc::clone(&answer);
    let mock = terminal(MockFields::new(), vec![entry(key::ENTER)]);
    let app: App = Application::new("nullable").action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let value = select(
                &ctx,
                SelectSettings::new(
                    "Count",
                    vec![Choice::new(Some(1), "One"), Choice::new(None, "None")],
                )
                .default(None),
            )
            .await?;
            *kept.lock().unwrap() = Some(value);
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), Some(None));
}

#[tokio::test]
async fn without_a_default_the_first_choice_is_highlighted_whatever_the_values() {
    let answer = answer_slot::<Option<i32>>();
    let kept = Arc::clone(&answer);
    let mock = terminal(MockFields::new(), vec![entry(key::ENTER)]);
    let app: App = Application::new("optional").action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let value = select(
                &ctx,
                SelectSettings::new(
                    "Pick",
                    vec![Choice::new(Some(1), "First"), Choice::new(None, "Skip")],
                ),
            )
            .await?;
            *kept.lock().unwrap() = Some(value);
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), Some(Some(1)));
}

#[tokio::test]
async fn an_empty_answer_draws_as_the_empty_string_for_text_and_as_a_dim_none_for_a_multiselect() {
    let mock = terminal(
        MockFields::new(),
        vec![entry(key::ENTER), entry(key::ENTER)],
    );
    let app: App = Application::new("empty").action(|ctx: Context| async move {
        text(&ctx, TextSettings::new("Name"), Verbatim).await?;
        multiselect(
            &ctx,
            MultiselectSettings::new("Tags", vec![Choice::text("a")]),
        )
        .await?;
        Ok(())
    });
    assert_eq!(run(app, &mock).await, 0);
    let output = strip(&mock.stderr_text());
    assert!(output.contains("? Name · \n"), "{output:?}");
    assert!(output.contains("? Tags · none\n"), "{output:?}");
}

#[tokio::test]
async fn a_stale_first_call_that_settles_after_a_later_call_never_replaces_its_list() {
    let answer = answer_slot::<String>();
    let kept = Arc::clone(&answer);
    let mock = terminal(MockFields::new(), vec![entry(&format!("u{}", key::ENTER))]);
    let app: App = Application::new("stale").action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let (send, receive) = tokio::sync::oneshot::channel::<Vec<ChoiceEntry<String>>>();
            let first = Arc::new(Mutex::new(Some(receive)));
            let sender = Arc::new(Mutex::new(Some(send)));
            let value = select(
                &ctx,
                SelectSettings::from_source("Country", move |term: String, _| {
                    if term.is_empty() {
                        let receive = first.lock().unwrap().take();
                        return Box::pin(async move {
                            match receive {
                                Some(receive) => Ok(receive.await.unwrap_or_default()),
                                None => Ok(Vec::new()),
                            }
                        });
                    }
                    // The first call settles while the later call's own settle is under way.
                    if let Some(send) = sender.lock().unwrap().take() {
                        let _ = send.send(vec![Choice::text("stale").into()]);
                    }
                    Box::pin(async { Ok(vec![Choice::text("fresh").into()]) })
                }),
            )
            .await?;
            *kept.lock().unwrap() = Some(value);
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(answer.lock().unwrap().as_deref(), Some("fresh"));
}

/// The answer, the code, the list frames, and stderr of a multiselect over `choices` asked with
/// `keys`, shaped by `shape`.
async fn selecting(
    keys: &str,
    shape: impl Fn(MultiselectSettings<String>) -> MultiselectSettings<String> + Send + Sync + 'static,
    choices: Vec<ChoiceEntry<String>>,
) -> (Vec<String>, u8, Vec<ListFrame>, String) {
    let recorder = Recorder::default();
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let shape = Arc::new(shape);
    let mock = terminal(MockFields::new(), vec![entry(keys)]);
    let app: App = Application::new("toggles")
        .overrides([recorder.view()])
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            let shape = Arc::clone(&shape);
            let choices = choices.clone();
            async move {
                let mut settings = MultiselectSettings::new("Pick", vec![]);
                for choice in choices {
                    settings = match choice {
                        ChoiceEntry::Choice(choice) => settings.choice(choice),
                        ChoiceEntry::Separator(text) => settings.separator(text),
                        _ => settings,
                    };
                }
                let value = multiselect(&ctx, shape(settings)).await?;
                *kept.lock().unwrap() = value;
                Ok(())
            }
        });
    let code = run(app, &mock).await;
    let answer = answer.lock().unwrap().clone();
    (answer, code, recorder.lists(), mock.stderr_text())
}

fn greek() -> Vec<ChoiceEntry<String>> {
    ["alpha", "beta", "gamma"]
        .into_iter()
        .map(|value| Choice::text(value).into())
        .collect()
}

fn issues(frames: &[ListFrame]) -> Vec<Option<String>> {
    frames.iter().map(|frame| frame.issue.clone()).collect()
}

#[tokio::test]
async fn a_toggle_in_clears_the_issue_that_min_drew() {
    let (answer, _, frames, _) = selecting(
        &format!("{}{}{}", key::ENTER, key::SPACE, key::ENTER),
        |settings| settings.min(1),
        greek(),
    )
    .await;
    assert_eq!(answer, ["alpha"]);
    assert_eq!(
        issues(&frames),
        [None, Some("Choose at least 1.".to_owned()), None]
    );
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
async fn a_toggle_out_clears_the_issue_that_a_rejected_choice_drew() {
    let recorder = Recorder::default();
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal(
        MockFields::new(),
        vec![entry(&format!(
            "{}{}{}{}{}{}",
            key::TAB,
            key::ENTER,
            key::TAB,
            key::DOWN,
            key::TAB,
            key::ENTER
        ))],
    );
    let app: App = Application::new("linked")
        .overrides([recorder.view()])
        .option("port", Opt::string().multiple().validate(Port))
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value: Vec<f64> = multiselect_as(
                    &ctx,
                    MultiselectSettings::new(
                        "Ports",
                        vec![Choice::new("bad".to_owned(), "Invalid"), Choice::text("80")],
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
    assert_eq!(
        issues(&recorder.lists()),
        [
            None,
            None,
            Some("Invalid: Use a port.".to_owned()),
            None,
            None,
            None
        ]
    );
}

#[tokio::test]
async fn a_linked_select_draws_its_validator_issue_without_a_label() {
    let recorder = Recorder::default();
    let answer = answer_slot::<f64>();
    let kept = Arc::clone(&answer);
    let mock = terminal(
        MockFields::new(),
        vec![entry(&format!("{}{}{}", key::ENTER, key::DOWN, key::ENTER))],
    );
    let app: App = Application::new("linked")
        .overrides([recorder.view()])
        .option("port", Opt::string().validate(Port))
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value: f64 = select_as(
                    &ctx,
                    SelectSettings::new(
                        "Port",
                        vec![Choice::new("bad".to_owned(), "Invalid"), Choice::text("80")],
                    )
                    .option("port"),
                )
                .await?;
                *kept.lock().unwrap() = Some(value);
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*answer.lock().unwrap(), Some(80.0));
    assert_eq!(recorder.lists()[1].issue.as_deref(), Some("Use a port."));
}

#[tokio::test]
async fn a_search_with_no_choice_to_highlight_draws_no_matches_and_enter_draws_an_issue_the_next_term_change_clears()
 {
    let recorder = Recorder::default();
    let answer = answer_slot::<String>();
    let kept = Arc::clone(&answer);
    let mock = terminal(
        MockFields::new(),
        vec![entry(&format!(
            "zz{}{}{}",
            key::ENTER,
            key::ctrl('u'),
            key::ENTER
        ))],
    );
    let app: App = Application::new("search")
        .overrides([recorder.view()])
        .action(move |ctx: Context| {
            let kept = Arc::clone(&kept);
            async move {
                let value = select(
                    &ctx,
                    SelectSettings::new("Pick", vec![Choice::text("alpha"), Choice::text("beta")])
                        .search(),
                )
                .await?;
                *kept.lock().unwrap() = Some(value);
                Ok(())
            }
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(answer.lock().unwrap().as_deref(), Some("alpha"));
    let drawn: Vec<(Option<String>, Option<String>)> = recorder
        .lists()
        .iter()
        .map(|frame| (frame.term.clone(), frame.issue.clone()))
        .collect();
    let owned = |term: &str, issue: Option<&str>| (Some(term.to_owned()), issue.map(str::to_owned));
    assert_eq!(
        drawn,
        [
            owned("", None),
            owned("z", None),
            owned("zz", None),
            owned("zz", Some("No choice can be selected. Change the search.")),
            owned("", None),
        ]
    );
    assert!(strip(&mock.stderr_text()).contains(
        "? Pick › zz \n  No matches\n↑↓ move · type to search · Enter select\n  ✘ No choice can be selected. Change the search."
    ));
}

#[tokio::test]
async fn a_static_search_highlights_its_first_match_again_when_the_term_changes() {
    let (answer, ..) = selecting(
        &format!("{}{}a{}{}", key::DOWN, key::DOWN, key::TAB, key::ENTER),
        MultiselectSettings::search,
        greek(),
    )
    .await;
    assert_eq!(answer, ["alpha"]);
}

fn numbered(count: usize) -> Vec<ChoiceEntry<String>> {
    (1..=count)
        .map(|index| Choice::text(format!("c{index}")).into())
        .collect()
}

#[tokio::test]
async fn the_window_ends_at_the_lists_last_row_when_the_highlight_reaches_the_last_choice() {
    let mut choices = numbered(8);
    choices.push(Choice::text("c9").disabled("").into());
    let (_, _, frames, _) = selecting(&format!("{}{}", key::END, key::ENTER), |s| s, choices).await;
    assert_eq!((frames[1].above, frames[1].below), (2, 0));
    assert_eq!(labels(&frames[1]).last().map(String::as_str), Some("c9"));
}

#[tokio::test]
async fn the_window_starts_at_the_lists_first_row_when_the_highlight_returns_to_the_first_choice() {
    let mut choices = vec![ChoiceEntry::separator("Top")];
    choices.extend(numbered(8));
    let (_, _, frames, _) = selecting(
        &format!("{}{}{}", key::END, key::HOME, key::ENTER),
        |s| s,
        choices,
    )
    .await;
    assert_eq!((frames[2].above, frames[2].below), (0, 2));
    assert_eq!(labels(&frames[2])[0], "Top");
}

#[tokio::test]
async fn a_disabled_choice_with_an_empty_reason_draws_disabled() {
    let (_, _, _, output) = selecting(
        key::ENTER,
        |s| s,
        vec![
            Choice::text("alpha").into(),
            Choice::text("blocked").disabled("").into(),
        ],
    )
    .await;
    assert!(strip(&output).contains("  ◯ blocked (disabled)\n"));
}

#[tokio::test]
async fn ctrl_d_cancels_at_an_empty_term_and_at_a_list_that_does_not_search() {
    for search in [true, false] {
        let (_, code, _, output) = selecting(
            &key::ctrl('d'),
            move |settings| if search { settings.search() } else { settings },
            greek(),
        )
        .await;
        assert_eq!(code, 130);
        assert!(strip(&output).contains("? Pick · cancelled"));
    }
}

#[tokio::test]
async fn ctrl_d_at_the_end_of_a_term_that_is_not_empty_deletes_nothing_and_does_not_cancel() {
    let (answer, code, _, _) = selecting(
        &format!("ga{}{}{}", key::ctrl('d'), key::TAB, key::ENTER),
        MultiselectSettings::search,
        greek(),
    )
    .await;
    assert_eq!(code, 0);
    assert_eq!(answer, ["gamma"]);
}

#[tokio::test]
async fn the_end_of_the_question_aborts_each_lookup() {
    let tokens = Arc::new(Mutex::new(Vec::<CancellationToken>::new()));
    let seen = Arc::clone(&tokens);
    let answer = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&answer);
    let mock = terminal(
        MockFields::new().argv(["--tag", "b"]),
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
                    MultiselectSettings::from_source("Tags", move |term: String, token| {
                        seen.lock().unwrap().push(token);
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
    assert_eq!(*answer.lock().unwrap(), ["b"]);
    let tokens = tokens.lock().unwrap();
    assert_eq!(tokens.len(), 2);
    assert!(tokens.iter().all(CancellationToken::is_cancelled));
}

#[tokio::test]
async fn a_default_that_selects_nothing_draws_no_issue_under_choices_and_a_source() {
    for source in [false, true] {
        let recorder = Recorder::default();
        let answer = Arc::new(Mutex::new(vec!["unanswered".to_owned()]));
        let kept = Arc::clone(&answer);
        let mock = terminal(MockFields::new(), vec![entry(key::ENTER)]);
        let app: App = Application::new("defaults")
            .overrides([recorder.view()])
            .action(move |ctx: Context| {
                let kept = Arc::clone(&kept);
                async move {
                    let default = vec!["zzz".to_owned()];
                    let value = if source {
                        let settings = MultiselectSettings::from_source("Tags", |_, _| {
                            Box::pin(async {
                                Ok(vec![Choice::text("a").into(), Choice::text("b").into()])
                            })
                        });
                        multiselect(&ctx, settings.default(default)).await?
                    } else {
                        let settings = MultiselectSettings::new(
                            "Tags",
                            vec![Choice::text("a"), Choice::text("b")],
                        );
                        multiselect(&ctx, settings.default(default)).await?
                    };
                    *kept.lock().unwrap() = value;
                    Ok(())
                }
            });
        assert_eq!(run(app, &mock).await, 0);
        assert!(answer.lock().unwrap().is_empty());
        let frames = recorder.lists();
        assert!(!frames.is_empty());
        assert!(frames.iter().all(|frame| frame.issue.is_none()));
    }
}

#[tokio::test]
async fn a_multiselect_that_links_an_option_that_takes_one_value_reports_its_link_kind() {
    let app: App = Application::new("link")
        .option("feature", Opt::string())
        .action(|ctx: Context| async move {
            multiselect(
                &ctx,
                MultiselectSettings::new("Features", vec![Choice::text("a")]).option("feature"),
            )
            .await?;
            Ok(())
        });
    let mock = terminal(MockFields::new(), vec![]);
    assert_eq!(run(app, &mock).await, 1);
    let stderr = mock.stderr_text();
    assert!(stderr.contains(
        "The question \"Features\" links option \"feature\", which is not a multiple string option."
    ));
    assert!(stderr.contains("Link a multiple string option or a variadic string argument."));
}

#[tokio::test]
async fn a_multiselect_that_links_an_argument_that_takes_one_value_reports_its_link_kind() {
    let app: App = Application::new("link")
        .argument("file", Arg::string())
        .action(|ctx: Context| async move {
            multiselect(
                &ctx,
                MultiselectSettings::new("Features", vec![Choice::text("a")]).argument("file"),
            )
            .await?;
            Ok(())
        });
    let mock = terminal(MockFields::new(), vec![]);
    assert_eq!(run(app, &mock).await, 1);
    let stderr = mock.stderr_text();
    assert!(stderr.contains(
        "The question \"Features\" links argument \"file\", which is not a variadic string argument."
    ));
    assert!(stderr.contains("Link a multiple string option or a variadic string argument."));
}

#[tokio::test]
async fn a_non_interactive_multiselect_over_an_omitted_list_input_reports_the_missing_input() {
    for (option, sentence) in [
        (
            true,
            "Option \"--feature\" is required when input is not interactive. Supply at least one value.",
        ),
        (
            false,
            "Argument \"files\" requires at least one value when input is not interactive.",
        ),
    ] {
        let app: App = Application::new("missing")
            .option("feature", Opt::string().multiple())
            .argument("files", Arg::string().variadic())
            .action(move |ctx: Context| async move {
                let settings = if option {
                    MultiselectSettings::new("Features", vec![Choice::text("a")]).option("feature")
                } else {
                    MultiselectSettings::new("Files", vec![Choice::text("a")]).argument("files")
                };
                multiselect(&ctx, settings).await?;
                Ok::<(), Error>(())
            });
        let mock = mock_process(MockFields::new());
        assert_eq!(run(app, &mock).await, 2);
        assert!(
            mock.stderr_text().contains(sentence),
            "{:?}",
            mock.stderr_text()
        );
    }
}
