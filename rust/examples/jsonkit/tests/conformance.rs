//! The conformance corpus's jsonkit cases, run on the mock process. Every case that has no scripted
//! MCP session runs here; the sessions wait on each answer, which a whole piped stdin cannot, so
//! the corpus harness runs them against the binary. Each case matches the reference byte for byte,
//! its produced files included.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use support::{Case, Ran, cases, run_case};

/// The cases this test runs: every one with no scripted session.
fn runnable() -> Vec<Case> {
    cases().into_iter().filter(|case| !case.session).collect()
}

/// `--explain --manifest` writes the manifest, and the manifest publishes a validator's input
/// schema with the `$schema` dialect first, as the reference's converter writes it: `select`'s
/// `--field` is the catalog's `text()`.
#[tokio::test]
async fn the_manifest_publishes_a_validator_schema_with_the_dialect_first() {
    let case = runnable()
        .into_iter()
        .find(|case| case.id == "jsonkit-control-explain-then-manifest")
        .expect("the corpus holds jsonkit-control-explain-then-manifest");
    let run = run_case(&case).await;
    assert!(run.ran.stdout.contains(
        "\"schema\": {\n              \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",\n              \"type\": \"string\",\n              \"minLength\": 1\n            },"
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
                "{}\n  expected: {expected:?}\n  ran:      {:?}\n  files expected: {:?}\n  files ran:      {:?}",
                case.id,
                run.ran,
                case.files.keys().collect::<Vec<_>>(),
                run.files.keys().collect::<Vec<_>>()
            ));
        }
    }
    assert!(ran_count > 400, "the corpus holds the jsonkit cases");
    assert!(
        differing.is_empty(),
        "{} cases differ:\n{}",
        differing.len(),
        differing.join("\n")
    );
}
