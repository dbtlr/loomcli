//! Ports `assert-assembles.test.ts`, and the Rust form of the reference's `undescribed` lint,
//! `assert_described`, over the lint's own cases.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_core::{
    Application, Arg, Command, Context, DeclarationError, DiagnosticParts, DiagnosticRule,
    FailureFacts, Opt, Plugin, State, Stdin, diagnostic_rule,
};
use loomcli_testing::{assert_assembles, assert_described};

const DESCRIPTION: &str = "Assemble the probe.";

const SHARED_NAME: DiagnosticRule = diagnostic_rule(
    "@fixture/testing/shared-name",
    "Shared name",
    "Each Command answers to a name of its own.",
);

/// A plugin whose graph hook rejects the graph with a fault of its own sentence.
fn rejecting(identity: &str, sentence: &'static str) -> Plugin {
    Plugin::new(identity).on_graph_built(move |_graph| {
        Err(DeclarationError::new(SHARED_NAME, DiagnosticParts::new(sentence)).into())
    })
}

/// The message the assertion panicked with, failing the test when it returned.
fn panicked(assert: impl FnOnce()) -> String {
    match catch_unwind(AssertUnwindSafe(assert)) {
        Ok(()) => panic!("the assertion returned"),
        Err(payload) => payload
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| {
                payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
            })
            .expect("a panic message"),
    }
}

fn assembly<I, R, S: State>(application: &Application<I, R, S>) -> String {
    panicked(|| assert_assembles(application))
}

fn messages(faults: &[DeclarationError]) -> Vec<String> {
    faults
        .iter()
        .map(|fault| fault.message().to_owned())
        .collect()
}

#[test]
fn an_application_that_assembles_returns() {
    let application = Application::new("probe")
        .description(DESCRIPTION)
        .action(|ctx: Context| async move { ctx.out.print("ran").await });
    assert_assembles(&application);
}

#[test]
fn a_build_rule_fault_panics_with_its_diagnostic() {
    // A root with neither children nor an action ends the build.
    let application = Application::new("probe").description(DESCRIPTION);
    let faults = application.check();
    assert_eq!(faults.len(), 1);
    assert_eq!(
        assembly(&application),
        format!(
            "The application does not assemble: 1 fault.\n\n{}",
            faults[0].message()
        )
    );
}

#[test]
fn two_collected_faults_panic_with_both_diagnostics_in_order() {
    let application = Application::new("probe")
        .plugins((
            rejecting("@fixture/first", "The first hook rejects the graph."),
            rejecting("@fixture/second", "The second hook rejects the graph."),
        ))
        .description(DESCRIPTION)
        .action(|ctx: Context| async move { ctx.out.print("ran").await });
    let faults = application.check();
    assert_eq!(faults.len(), 2);
    let message = assembly(&application);
    assert_eq!(
        message,
        format!(
            "The application does not assemble: 2 faults.\n\n{}",
            messages(&faults).join("\n\n")
        )
    );
    assert!(message.find("The first hook") < message.find("The second hook"));
}

#[test]
fn the_first_line_counts_the_faults_in_one_sentence() {
    let one = Application::new("probe")
        .plugins((rejecting(
            "@fixture/first",
            "The first hook rejects the graph.",
        ),))
        .description(DESCRIPTION)
        .action(|ctx: Context| async move { ctx.out.print("ran").await });
    assert_eq!(
        assembly(&one).lines().next(),
        Some("The application does not assemble: 1 fault.")
    );
    let two = Application::new("probe")
        .plugins((
            rejecting("@fixture/first", "The first hook rejects the graph."),
            rejecting("@fixture/second", "The second hook rejects the graph."),
        ))
        .description(DESCRIPTION)
        .action(|ctx: Context| async move { ctx.out.print("ran").await });
    assert_eq!(
        assembly(&two).lines().next(),
        Some("The application does not assemble: 2 faults.")
    );
}

#[test]
fn a_described_application_passes() {
    let application = Application::new("tool")
        .description("Manage the tool.")
        .global_option("verbose", Opt::count().description("Say more."))
        .command(
            Command::new("build")
                .description("Build the project.")
                .argument("target", Arg::string().description("The target to build."))
                .option("release", Opt::boolean().description("Build for release."))
                .stdin(Stdin::new().description("The build script."))
                .action(|_ctx: Context| async { Ok(()) }),
        );
    assert_described(&application);
}

#[test]
fn each_declaration_without_a_description_is_named_in_one_panic() {
    let application = Application::new("tool")
        .plugins((Plugin::new("@fixture/plugin").option("trace", Opt::boolean()),))
        .global_option("verbose", Opt::count())
        .option("root-flag", Opt::boolean())
        .command(
            Command::new("remote").command(
                Command::new("add")
                    .argument("url", Arg::string())
                    .option("force", Opt::boolean())
                    .stdin(Stdin::new())
                    .action(|_ctx: Context| async { Ok(()) }),
            ),
        )
        .action(|_ctx: Context| async { Ok(()) });
    assert_eq!(
        panicked(|| assert_described(&application)),
        "The application has 9 declarations with no description.\n\n\
         Application \"tool\" has no description.\n\
         Global option \"verbose\" has no description.\n\
         Global option \"trace\" has no description.\n\
         Option \"root-flag\" of Application \"tool\" has no description.\n\
         Command \"remote\" has no description.\n\
         Command \"remote add\" has no description.\n\
         Option \"force\" of Command \"remote add\" has no description.\n\
         Argument \"url\" of Command \"remote add\" has no description.\n\
         Stdin of Command \"remote add\" has no description.\n\n\
         Give each a description of one line, which help, agents, MCP tools, and the manifest read."
    );
}

#[test]
fn one_undescribed_declaration_reads_in_the_singular() {
    let application = Application::new("tool")
        .description("Manage the tool.")
        .command(Command::new("build").action(|_ctx: Context| async { Ok(()) }));
    assert_eq!(
        panicked(|| assert_described(&application)),
        "The application has 1 declaration with no description.\n\n\
         Command \"build\" has no description.\n\n\
         Give each a description of one line, which help, agents, MCP tools, and the manifest read."
    );
}

#[test]
fn an_application_that_does_not_assemble_panics_as_assert_assembles_does() {
    let application = Application::new("tool").description("Manage the tool.");
    let faults = application.check();
    assert_eq!(
        panicked(|| assert_described(&application)),
        format!(
            "The application does not assemble: 1 fault.\n\n{}",
            faults[0].message()
        )
    );
    let two = Application::new("probe")
        .plugins((
            rejecting("@fixture/first", "The first hook rejects the graph."),
            rejecting("@fixture/second", "The second hook rejects the graph."),
        ))
        .description(DESCRIPTION)
        .action(|ctx: Context| async move { ctx.out.print("ran").await });
    let faults = two.check();
    assert_eq!(faults.len(), 2);
    assert_eq!(
        panicked(|| assert_described(&two)),
        format!(
            "The application does not assemble: 2 faults.\n\n{}",
            messages(&faults).join("\n\n")
        )
    );
}
