//! The received input an `on_failure` hook reads, ported from `failure-received.test.ts`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Context, Error, InputError, InputIdentity, InputKind, InputProblem,
    InvocationOutcome, InvocationValues, InvokeOptions, Issue, Opt, Plugin, RunOptions,
    SuppliedValue, ValidationContext, Validator,
};
use loomcli_testing::{MockFields, mock_process};

struct Format;

impl Validator for Format {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        match input {
            "json" | "yaml" => Ok(input.to_owned()),
            _ => Err(vec![Issue::new("Expected one of: json, yaml.")]),
        }
    }
}

#[tokio::test]
async fn the_hook_reads_rejected_argv_environment_and_named_values_without_exposing_them() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/received").on_failure({
        let seen = Arc::clone(&seen);
        move |failure, ctx| {
            let input = failure.downcast_ref::<InputError>().unwrap();
            assert!(!format!("{input:?}").contains("jsno"));
            seen.lock()
                .unwrap()
                .push(ctx.received(&input.problems()[0]));
        }
    });
    let app = Application::new("kit")
        .plugins([observer])
        .option("format", Opt::string().env(["KIT_FORMAT"]).validate(Format))
        .action(|_: Context| async { Ok(()) });

    for fields in [
        MockFields::new().argv(["--format", "jsno"]),
        MockFields::new().env("KIT_FORMAT", "jsno"),
    ] {
        let mock = mock_process(fields);
        assert_eq!(
            app.run(RunOptions::new().process(mock.clone())).await.get(),
            2
        );
        assert!(!mock.stderr_text().contains("jsno"));
    }

    let invoked = app
        .invoke(
            &[],
            InvocationValues::new().option("format", "jsno"),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    assert!(matches!(
        invoked,
        InvocationOutcome::Failed { messages, .. } if !messages.contains("jsno")
    ));
    assert_eq!(
        *seen.lock().unwrap(),
        vec![Some(SuppliedValue::One("jsno".to_owned())); 3]
    );
}

#[tokio::test]
async fn missing_and_group_problems_have_no_received_value() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/received").on_failure({
        let observed = Arc::clone(&observed);
        move |failure, ctx| {
            let problems = failure.downcast_ref::<InputError>().unwrap().problems();
            *observed.lock().unwrap() = problems
                .iter()
                .map(|problem| (problem.clone(), ctx.received(problem)))
                .collect();
        }
    });
    let mock = mock_process(MockFields::new().argv(["--json", "--yaml"]));
    let code = Application::new("kit")
        .plugins([observer])
        .option("format", Opt::string().required())
        .option("json", Opt::boolean())
        .option("yaml", Opt::boolean())
        .exclusive(&["json", "yaml"])
        .action(|_: Context| async { Ok(()) })
        .run(RunOptions::new().process(mock))
        .await;
    assert_eq!(code.get(), 2);
    assert!(matches!(
        observed.lock().unwrap().as_slice(),
        [
            (InputProblem::Missing { .. }, None),
            (InputProblem::Group { .. }, None)
        ]
    ));
}

#[tokio::test]
async fn a_hand_built_copy_of_a_problem_has_no_received_value() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/received").on_failure({
        let seen = Arc::clone(&seen);
        move |failure, ctx| {
            let problem = &failure.downcast_ref::<InputError>().unwrap().problems()[0];
            let copy = InputProblem::Invalid {
                input: InputIdentity::new(false, InputKind::Option, "format"),
                spelling: "--format".to_owned(),
                issues: vec![Issue::new("Expected one of: json, yaml.")],
            };
            assert_eq!(*problem, copy);
            seen.lock()
                .unwrap()
                .extend([ctx.received(problem), ctx.received(&copy)]);
        }
    });
    Application::new("kit")
        .plugins([observer])
        .option("format", Opt::string().validate(Format))
        .action(|_: Context| async { Ok(()) })
        .run(RunOptions::new().process(mock_process(MockFields::new().argv(["--format", "jsno"]))))
        .await;
    assert_eq!(
        *seen.lock().unwrap(),
        [Some(SuppliedValue::One("jsno".to_owned())), None]
    );
}

#[tokio::test]
async fn the_reader_returns_a_strict_configuration_fill_and_none_for_a_hand_built_problem() {
    use std::collections::BTreeMap;

    use loomcli_core::__private::{SourceProbe, install_source};
    use loomcli_core::{Extension, OptionTarget, SourceAnswer, SourceValue};

    const CONFIG_KEY: Extension<OptionTarget, String> = Extension::new("fixture/config-key");

    let seen = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/received").on_failure({
        let seen = Arc::clone(&seen);
        move |failure, ctx| {
            let input = failure.downcast_ref::<InputError>().unwrap();
            let mut seen = seen.lock().unwrap();
            seen.extend(input.problems().iter().map(|problem| ctx.received(problem)));
            seen.push(ctx.received(&InputProblem::Invalid {
                input: InputIdentity::new(false, InputKind::Option, "format"),
                spelling: "--format".to_owned(),
                issues: vec![Issue::new("Expected a format.")],
            }));
        }
    });
    let mock = mock_process(MockFields::new());
    let app = install_source(
        Application::new("kit")
            .plugins([observer])
            .option(
                "format",
                Opt::string()
                    .validate(Format)
                    .extend([CONFIG_KEY.value("format".to_owned())]),
            )
            .action(|_: Context| async { Ok(()) }),
        "fixture/config",
        &CONFIG_KEY,
        &[],
        |probe: SourceProbe| {
            let answers: BTreeMap<String, SourceAnswer> = probe
                .requests
                .iter()
                .map(|request| {
                    let answer =
                        SourceAnswer::new(SourceValue::String("jsno".to_owned()), "settings.json");
                    (request.name().to_owned(), answer.strict())
                })
                .collect();
            std::future::ready(Ok::<_, Error>(answers))
        },
    );
    let status = app.run(RunOptions::new().process(mock.clone())).await;
    assert_eq!(status.get(), 2);
    assert_eq!(
        *seen.lock().unwrap(),
        [Some(SuppliedValue::One("jsno".to_owned())), None]
    );
    assert!(!mock.stderr_text().contains("jsno"));
}
#[tokio::test]
async fn the_reader_excludes_a_live_earlier_problem_and_this_failures_missing_problem() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let earlier = Arc::new(Mutex::new(None::<Error>));
    let observer = Plugin::new("fixture/received").on_failure({
        let earlier = Arc::clone(&earlier);
        let seen = Arc::clone(&seen);
        move |failure, ctx| {
            let problems = failure.downcast_ref::<InputError>().unwrap().problems();
            let [
                missing @ InputProblem::Missing { .. },
                invalid @ InputProblem::Invalid { .. },
            ] = problems
            else {
                panic!("expected a missing problem and an invalid problem");
            };
            let mut seen = seen.lock().unwrap();
            seen.extend([ctx.received(invalid), ctx.received(missing)]);
            if let Some(prior) = &*earlier.lock().unwrap() {
                let earlier_problem =
                    &prior.downcast_failure::<InputError>().unwrap().problems()[1];
                seen.push(ctx.received(earlier_problem));
            }
        }
    });
    let app = Application::new("kit")
        .plugins([observer])
        .option("required", Opt::string().required())
        .option("format", Opt::string().validate(Format))
        .action(|_: Context| async { Ok(()) });
    let invoked = app
        .invoke(
            &[],
            InvocationValues::new().option("format", "jsno"),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    let InvocationOutcome::Failed { failure, .. } = invoked else {
        panic!("expected the invocation to fail");
    };
    *earlier.lock().unwrap() = Some(failure);
    app.run(RunOptions::new().process(mock_process(MockFields::new().argv(["--format", "yalm"]))))
        .await;
    assert_eq!(
        *seen.lock().unwrap(),
        [
            Some(SuppliedValue::One("jsno".to_owned())),
            None,
            Some(SuppliedValue::One("yalm".to_owned())),
            None,
            None,
        ]
    );
}

#[tokio::test]
async fn an_environment_value_outside_its_options_grammar_has_no_received_value() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/received").on_failure({
        let seen = Arc::clone(&seen);
        move |failure, ctx| {
            let problem = &failure.downcast_ref::<InputError>().unwrap().problems()[0];
            assert!(matches!(problem, InputProblem::Invalid { .. }));
            seen.lock().unwrap().push(ctx.received(problem));
        }
    });
    let mock = mock_process(MockFields::new().env("KIT_VERBOSE", "maybe"));
    let code = Application::new("kit")
        .plugins([observer])
        .option("verbose", Opt::boolean().env(["KIT_VERBOSE"]))
        .action(|_: Context| async { Ok(()) })
        .run(RunOptions::new().process(mock.clone()))
        .await;
    assert_eq!(code.get(), 2);
    assert_eq!(*seen.lock().unwrap(), [None]);
    assert!(!mock.stderr_text().contains("maybe"));
}
