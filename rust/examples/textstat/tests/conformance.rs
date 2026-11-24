//! The textstat conformance cases run on the mock process.
//! The binary harness checks whether the listed differences still apply.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use conformance_harness::compare::Part;
use conformance_harness::runner::assert_part;
use support::{Case, cases, run_case};

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
}

#[tokio::test]
async fn every_case_matches_the_shared_expectations_outside_listed_parts() {
    let cases = runnable();
    assert!(cases.len() > 150, "the corpus holds the textstat cases");
    for case in cases {
        let run = run_case(&case).await;
        let id = &case.id;
        assert_part(id, Part::Stdout, &run.ran.stdout, &case.expected.stdout);
        assert_part(id, Part::Stderr, &run.ran.stderr, &case.expected.stderr);
        assert_part(id, Part::Exit, &run.ran.status, &case.expected.status);
        assert_part(id, Part::Files, &run.files, &case.files);
    }
}
