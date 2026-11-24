//! The conformance corpus's textstat cases, run on the mock process. Each case matches the
//! reference byte for byte.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use support::{Case, Ran, cases, run_case};

/// Every textstat case: none has a scripted session.
fn runnable() -> Vec<Case> {
    cases()
}

/// The manifest publishes each option validator's input schema with the `$schema` dialect first,
/// as the reference's converter writes it.
#[tokio::test]
async fn the_manifest_publishes_each_validator_schema_with_the_dialect_first() {
    let case = runnable()
        .into_iter()
        .find(|case| case.id == "textstat-manifest-root")
        .expect("the corpus holds textstat-manifest-root");
    let run = run_case(&case).await;
    assert!(run.ran.stdout.contains(
        "\"schema\": {\n          \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",\n          \"type\": \"integer\",\n          \"minimum\": 0\n        },"
    ));
    assert_eq!(run.ran.stdout, case.expected.stdout);
}

#[tokio::test]
async fn every_case_matches_the_reference_byte_for_byte() {
    let mut differing = Vec::new();
    let mut ran_count = 0;
    for case in runnable() {
        ran_count += 1;
        let run = run_case(&case).await;
        let expected = Ran {
            status: case.expected.status,
            stdout: case.expected.stdout.clone(),
            stderr: case.expected.stderr.clone(),
        };
        if run.ran != expected || run.files != case.files {
            differing.push(format!(
                "{}\n  expected: {expected:?}\n  ran:      {:?}",
                case.id, run.ran
            ));
        }
    }
    assert!(ran_count > 150, "the corpus holds the textstat cases");
    assert!(
        differing.is_empty(),
        "{} cases differ:\n{}",
        differing.len(),
        differing.join("\n")
    );
}
