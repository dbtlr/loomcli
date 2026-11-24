//! Ports `create.test.ts`, `issue-code.test.ts`, and `pipe.test.ts`: `create_validator`,
//! `issue_code`, and `pipe`. The Standard Schema protocol cases (promises, `~standard`, targets,
//! realms, types) have no counterpart; see the test map.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use loomcli_core::{Issue, PathSegment, ValidationContext, Validator};
use loomcli_validators::{
    IssueCode, create_validator, integer, issue_code, one_of, pipe, text, uuid,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use support::{context, context_in, fault_of, fault_text, published, verdict};

fn lowercase() -> impl Validator<Output = String> {
    create_validator(|raw: &str, _context: &ValidationContext| {
        if !raw.is_empty() && raw.bytes().all(|byte| byte.is_ascii_lowercase()) {
            Ok(raw.to_owned())
        } else {
            Err(vec![Issue::new("Expected lowercase letters.")])
        }
    })
    .input_schema(schema(json!({"pattern": "^[a-z]+$", "type": "string"})))
}

fn schema(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => panic!("a schema is an object"),
    }
}

#[test]
fn parse_decides_the_verdict_for_each_raw_string() {
    let validator = lowercase();
    assert_eq!(verdict(&validator, "abc"), Ok("abc".to_owned()));
    let issues = verdict(&validator, "ABC").unwrap_err();
    assert_eq!(issues, vec![Issue::new("Expected lowercase letters.")]);
}

#[test]
fn an_issue_with_a_code_and_parameters_passes_through_unchanged() {
    #[derive(Serialize, Deserialize)]
    struct Word {
        word: String,
    }
    let shout: IssueCode<Word> = issue_code("@acme/checks/shout", |params| {
        format!("Expected {} in capitals.", params.word)
    });
    let issue = shout.issue(Word {
        word: "NAME".into(),
    });
    let expected = issue.clone();
    let validator = create_validator(move |raw: &str, _context: &ValidationContext| {
        if raw == raw.to_uppercase() {
            Ok(raw.to_owned())
        } else {
            Err(vec![issue.clone()])
        }
    });
    let issues = verdict(&validator, "name").unwrap_err();
    assert_eq!(issues, vec![expected]);
    assert_eq!(issues[0].code.as_deref(), Some("@acme/checks/shout"));
    assert_eq!(issues[0].message, "Expected NAME in capitals.");
    assert_eq!(issues[0].params, Some(json!({"word": "NAME"})));
}

#[test]
fn the_output_is_the_value_parse_returns() {
    let length = create_validator(|raw: &str, _context: &ValidationContext| Ok(raw.len()));
    assert_eq!(verdict(&length, "four"), Ok(4));
}

#[test]
fn a_validator_with_an_input_schema_publishes_it_and_one_without_publishes_nothing() {
    assert_eq!(
        published(&lowercase()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","pattern":"^[a-z]+$","type":"string"}"#
    );
    let plain = create_validator(|raw: &str, _context: &ValidationContext| Ok(raw.to_owned()));
    assert_eq!(Validator::input_schema(&plain), None);
}

#[test]
fn parse_receives_the_validation_context() {
    let cwd = create_validator(|_raw: &str, context: &ValidationContext| {
        Ok(context.host.cwd.to_string_lossy().into_owned())
    });
    assert_eq!(
        cwd.validate("x", &context_in("/work/here", "UTC")),
        Ok("/work/here".to_owned())
    );
}

#[test]
fn an_input_schema_that_declares_its_own_dollar_schema_panics_at_the_call() {
    let text = fault_text(|| {
        create_validator(|raw: &str, _context: &ValidationContext| Ok(raw.len()))
            .input_schema(schema(json!({"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "string"})))
    });
    assert_eq!(
        text,
        "create_validator() input_schema declares its own $schema. Leave out $schema, which the validator publishes itself."
    );
    let fault = fault_of(|| {
        create_validator(|raw: &str, _context: &ValidationContext| Ok(raw.len()))
            .input_schema(schema(json!({"$schema": "x"})))
    })
    .unwrap();
    assert_eq!(fault.identity, "@loomcli/validators/input-schema");
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Bounds {
    max: i64,
    min: i64,
}

const RANGE: IssueCode<Bounds> = issue_code("@acme/checks/range", |params| {
    format!("Expected from {} to {}.", params.min, params.max)
});

#[test]
fn an_issue_code_builds_issues_and_reads_them_back() {
    assert_eq!(RANGE.code(), "@acme/checks/range");
    let issue = RANGE.issue(Bounds { max: 64, min: 1 });
    assert_eq!(issue.code.as_deref(), Some("@acme/checks/range"));
    assert_eq!(issue.message, "Expected from 1 to 64.");
    assert_eq!(issue.params, Some(json!({"max": 64, "min": 1})));
    assert_eq!(RANGE.read(&issue), Some(Bounds { max: 64, min: 1 }));
    // Core copies an issue and keeps every field, a path included.
    let copied = issue.clone().at(PathSegment::Index(0));
    assert_eq!(RANGE.read(&copied), Some(Bounds { max: 64, min: 1 }));
}

#[test]
fn read_answers_none_for_an_issue_it_does_not_declare() {
    let other: IssueCode<Bounds> =
        issue_code("@acme/checks/other", |_| "Expected something else.".into());
    let mut no_params = Issue::new("x");
    no_params.code = Some(RANGE.code().to_owned());
    for issue in [
        other.issue(Bounds { max: 64, min: 1 }),
        Issue::new("Expected from 1 to 64."),
        Issue::new("x").code(RANGE.code(), json!({"min": 1})),
        Issue::new("x").code(RANGE.code(), json!(null)),
        Issue::new("x").code(RANGE.code(), json!("x")),
        no_params,
    ] {
        assert_eq!(RANGE.read(&issue), None, "{issue:?}");
    }
}

#[test]
fn a_code_outside_the_rule_identity_grammar_panics() {
    for code in [
        "range",
        "@acme/checks",
        "@acme/checks/",
        "@acme/range",
        "@acme/checks/Range",
        "@Acme/checks/range",
        "@acme/checks/in--range",
        "@acme/checks/-range",
        "@acme/checks/range-",
        "@acme/checks/in_range",
        "@acme/checks/in range",
        "@acme/checks//range",
        "@acme/checks/Ports/range",
        "@acme/checks/ports/",
    ] {
        assert!(
            fault_of(|| issue_code::<Bounds>(code, |_| "Expected a value.".into())).is_some(),
            "{code}"
        );
    }
    for code in [
        "@loomcli/validators/integer-range",
        "checks/range2",
        "@acme/my.checks/a-1-b",
        "@acme/checks/ports/range",
        "checks/range/min",
    ] {
        assert_eq!(
            issue_code::<Bounds>(code, |_| "Expected a value.".into()).code(),
            code
        );
    }
}

#[test]
fn a_code_with_a_check_faults_on_parameters_the_check_rejects() {
    let positive: IssueCode<Bounds> =
        issue_code("@acme/checks/positive", |_| "Expected positive.".into())
            .accepting(|params| params.min > 0);
    assert!(
        positive
            .read(&Issue::new("x").code(positive.code(), json!({"max": 2, "min": 0})))
            .is_none()
    );
    assert_eq!(
        fault_text(|| positive.issue(Bounds { max: 2, min: 0 })),
        "Issue code \"@acme/checks/positive\" rejects the parameters passed to issue(). Supply parameters its code accepts."
    );
}

// ---- pipe ----

fn pairs() -> impl Validator<Output = i64> {
    pipe(
        integer().min(2),
        |count: i64, _context: &ValidationContext| {
            if count % 2 == 0 {
                Ok(count)
            } else {
                Err(vec![Issue::new("Expected an even number.")])
            }
        },
    )
}

#[test]
fn a_token_passes_first_and_then_the_step_which_reads_the_value_first_accepted() {
    assert_eq!(verdict(&pairs(), "4"), Ok(4));
    assert_eq!(
        verdict(&pairs(), "3").unwrap_err(),
        vec![Issue::new("Expected an even number.")]
    );
}

#[test]
fn firsts_rejection_ends_the_pipe_and_the_step_never_runs() {
    let ran = Arc::new(AtomicBool::new(false));
    let seen = Arc::clone(&ran);
    let watched = pipe(
        integer().min(2),
        move |count: i64, _context: &ValidationContext| {
            seen.store(true, Ordering::SeqCst);
            Ok(count)
        },
    );
    let issues = verdict(&watched, "abc").unwrap_err();
    assert_eq!(
        issues
            .iter()
            .map(|issue| issue.message.as_str())
            .collect::<Vec<_>>(),
        ["Expected a whole number of at least 2."]
    );
    assert!(!ran.load(Ordering::SeqCst));
}

#[test]
fn steps_run_in_order_each_on_the_value_the_stage_before_it_accepted() {
    let tags = pipe(
        text().max_length(200),
        |raw: String, _context: &ValidationContext| {
            Ok(raw.split(',').map(str::to_owned).collect::<Vec<_>>())
        },
    )
    .pipe(|list: Vec<String>, _context: &ValidationContext| Ok(list.len()));
    assert_eq!(verdict(&tags, "a,b,c"), Ok(3));
    assert_eq!(
        published(&tags),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1,"maxLength":200}"#
    );
}

#[test]
fn a_stages_issues_pass_through_unchanged_code_parameters_and_path_included() {
    let issue = Issue::new("Expected x.")
        .code("@acme/x", json!({"n": 1}))
        .at(PathSegment::Key("deep".into()));
    let expected = issue.clone();
    let failing = pipe(text(), move |_raw: String, _context: &ValidationContext| {
        Err::<(), _>(vec![issue.clone()])
    });
    assert_eq!(verdict(&failing, "any").unwrap_err(), vec![expected]);
}

#[test]
fn a_step_receives_the_validation_context() {
    let host_cwd = pipe(text(), |_raw: String, context: &ValidationContext| {
        Ok(context.host.cwd.to_string_lossy().into_owned())
    });
    assert_eq!(
        host_cwd.validate("x", &context_in("/loom/cwd", "UTC")),
        Ok("/loom/cwd".to_owned())
    );
    assert_eq!(
        host_cwd.validate("x", &context()),
        Ok("/loom-test".to_owned())
    );
}

#[test]
fn the_pipe_publishes_firsts_input_schema_and_a_first_that_publishes_nothing_publishes_nothing() {
    assert_eq!(
        published(&pairs()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":2}"#
    );
    let silent = pipe(
        create_validator(|raw: &str, _context: &ValidationContext| Ok(raw.len())),
        |length: usize, _context: &ValidationContext| Ok(length * 2),
    );
    assert_eq!(Validator::input_schema(&silent), None);
    assert_eq!(verdict(&silent, "abc"), Ok(6));
}

#[test]
fn a_pipe_nests_as_first_and_as_a_step() {
    let nested = pipe(pairs(), |count: i64, _context: &ValidationContext| {
        Ok(count + 1)
    });
    assert_eq!(verdict(&nested, "4"), Ok(5));
    assert_eq!(
        verdict(&nested, "3").unwrap_err(),
        vec![Issue::new("Expected an even number.")]
    );
    let inner = pipe(uuid(), |value: String, _context: &ValidationContext| {
        Ok(value.len())
    });
    let outer = pipe(
        one_of(["a", "b"]),
        |value: String, _context: &ValidationContext| Ok(value),
    );
    assert_eq!(
        verdict(&outer, "c").unwrap_err().len(),
        1,
        "a pipe over one_of rejects as one_of does"
    );
    assert!(verdict(&inner, "123e4567-e89b-12d3-a456-426614174000").is_ok());
}

#[test]
fn a_long_chain_of_steps_keeps_running_in_order() {
    let add = |count: i64, _context: &ValidationContext| Ok::<i64, Vec<Issue>>(count + 1);
    let chain = pipe(integer(), add)
        .pipe(add)
        .pipe(add)
        .pipe(add)
        .pipe(add)
        .pipe(add)
        .pipe(add)
        .pipe(add);
    assert_eq!(verdict(&chain, "1"), Ok(9));
    assert_eq!(
        published(&chain),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer"}"#
    );
}
