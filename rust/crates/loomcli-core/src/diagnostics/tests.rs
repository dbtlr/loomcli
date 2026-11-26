//! Unit tests of core's rule registry and of the Developer Diagnostic layout of core's own rules.
//! Ported from the reference's `rule-registry.test.ts`, the layout goldens of
//! `developer-diagnostics.test.ts`, and `rule-source.test.ts`'s check that the registry holds
//! every rule with its prose.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeSet;

use super::defect::SourceAccess;
use super::developer::{AuthorFault, DeveloperScene, developer_plain_text, developer_text};
use super::rules;
use super::{DiagnosticParts, Finding, Literal};
use crate::failures::messages::foreign_failure;
use crate::style::{Capabilities, Palette, Renderer, style};
use crate::{DeclarationError, Error, FailureFacts, InternalError};

/// Whether a headline is one line with no closing period: `^\S[^\n]*[^.\s]$`.
fn is_headline(text: &str) -> bool {
    let first = text.chars().next();
    let last = text.chars().last();
    text.chars().count() >= 2
        && first.is_some_and(|c| !c.is_whitespace())
        && last.is_some_and(|c| c != '.' && !c.is_whitespace())
        && !text.contains('\n')
}

/// Whether an explanation is whole sentences on one line: `^\S(?:[^\n ]| (?! ))*\.$`.
fn is_explanation(text: &str) -> bool {
    text.chars().next().is_some_and(|c| !c.is_whitespace())
        && text.ends_with('.')
        && !text.contains('\n')
        && !text.contains("  ")
        && !text.ends_with(" .")
}

#[test]
fn every_rule_core_declares_has_one_declaration_a_one_line_headline_and_an_explanation_of_whole_sentences()
 {
    let identities: Vec<&str> = rules::ALL.iter().map(|rule| rule.identity()).collect();
    let unique: BTreeSet<&str> = identities.iter().copied().collect();
    assert_eq!(unique.len(), identities.len());
    assert!(identities.contains(&"@loomcli/core/declared-name"));
    for rule in rules::ALL {
        assert!(
            rule.identity().starts_with("@loomcli/core/"),
            "{}",
            rule.identity()
        );
        assert!(is_headline(rule.headline()), "{}", rule.identity());
        assert!(is_explanation(rule.explanation()), "{}", rule.identity());
        assert_eq!(rule.docs_url(), None);
    }
}

#[test]
fn the_registry_holds_forty_nine_shared_rules_and_seven_rust_rules() {
    assert_eq!(rules::ALL.len(), 56);
    let ports: Vec<&str> = rules::ALL[49..]
        .iter()
        .map(|rule| rule.identity())
        .collect();
    assert_eq!(
        ports,
        [
            "@loomcli/core/passthrough-declared-twice",
            "@loomcli/core/terminal-need-declared-twice",
            "@loomcli/core/option-config",
            "@loomcli/core/plugin-option-name",
            "@loomcli/core/input-read",
            "@loomcli/core/handler-registered-twice",
            "@loomcli/core/entry-point",
        ]
    );
    assert_eq!(
        rules::INVALID_RELEASE_FACTS.explanation(),
        "The build bakes the release facts into __LOOM_RELEASE__: a build of source, development, or distributed, and an optional release group with a semantic version, a repository as owner/name, and an optional asset name. A malformed value leaves the build unknown, so core shows the author this diagnostic in every build."
    );
}

/// Markdown text with each backslash escape of ASCII punctuation resolved: `\\_` reads `_`.
fn unescaped(markdown: &str) -> String {
    let mut text = String::with_capacity(markdown.len());
    let mut characters = markdown.chars().peekable();
    while let Some(character) = characters.next() {
        match characters.peek() {
            Some(next) if character == '\\' && next.is_ascii_punctuation() => {}
            _ => text.push(character),
        }
    }
    text
}

/// The reference's rules, as `(identity, headline, explanation)`, read from the checked-in copy of
/// its diagnostics reference, where each entry reads `### identity` then `**Headline.** Explanation`.
fn reference_rules() -> Vec<(String, String, String)> {
    let mut rules = Vec::new();
    let mut identity = None;
    for line in include_str!("reference_rules.md").lines() {
        if let Some(name) = line.strip_prefix("### ") {
            identity = Some(name.to_owned());
        } else if let Some(entry) = line.strip_prefix("**") {
            let (headline, explanation) = entry.split_once(".** ").unwrap();
            rules.push((
                identity.take().unwrap(),
                unescaped(headline),
                unescaped(explanation),
            ));
        }
    }
    rules
}

#[test]
fn shared_rules_keep_their_pinned_headlines_and_explanations() {
    let reference = reference_rules();
    assert_eq!(reference.len(), 53);
    // Explanations adapted under a recorded deviation (docs/deviations.md, Plugins and Providers).
    let adapted = [
        (
            "@loomcli/core/broken-attach-hook",
            "on_command_attach receives each Command's declaration at graph build and edits it in place, synchronously, returning Ok(()). Core builds the Command the hook leaves, so an Err other than a DeclarationError leaves it nothing to build.",
        ),
        (
            "@loomcli/core/broken-graph-hook",
            "on_graph_built receives the graph once per build and judges it: it returns Ok(()), and it rejects the graph only by returning a DeclarationError. Any other Err is a defect in the hook.",
        ),
        (
            "@loomcli/core/provider-name-taken",
            "An action reads each provided value under its provider's name, so two different providers with one name among the providers a uses list reaches would leave one name for two values. A provider is its name, its value type, and its opener's type, so two calls of one factory function name one provider; core rejects two providers with one name and another value type or opener where the list is declared.",
        ),
        (
            "@loomcli/core/two-package-copies",
            "Core keys each extension and each declared view by its identity and compares its value type. Two value types under one identity mean two copies of the crate that defines it are linked, and a value one copy made cannot be read through the other.",
        ),
    ];
    // Keep the wording for the features Rust currently supports until the corresponding ports land.
    let pending = [
        (
            "@loomcli/core/env-delimiter",
            "A multiple option's variable splits at each occurrence of its envDelimiter into the option's list, and an empty string occurs between every two characters, so it separates no item.",
        ),
        (
            "@loomcli/core/failure-encoder-taken",
            "A failed run writes its failure through the one encoder registered for the media type its selected view declares. Two encoders for one media type leave core no way to choose between them.",
        ),
        (
            "@loomcli/core/foreign-value",
            "Core reads a plugin, an extension value, a declared view, a view override, a translation, a failure encoding, and a provider through facts the copy of @loomcli/core that built it recorded. When two copies of @loomcli/core are installed, a value one copy built carries no facts the other copy can read.",
        ),
        (
            "@loomcli/core/source-answers",
            "A configuration source answers with a record that maps each option core requested to { value, label }, where the value has the raw type the option takes and the label is one line of prose, and an answer may add a directory, the absolute path of the folder holding the file the value came from. Core fills no option from any other answer.",
        ),
        (
            "@loomcli/core/view-selection",
            "A middleware, or the caller of invoke(), selects one of the views the routed Command's result declares, by name, before the action runs. A Command that declares no result has no view to select, and a name its result does not declare has no view to render.",
        ),
    ];
    let mut missing = Vec::new();
    for (identity, headline, explanation) in &reference {
        let Some(rule) = rules::ALL.iter().find(|rule| rule.identity() == identity) else {
            missing.push(identity.as_str());
            continue;
        };
        assert_eq!(rule.headline(), headline, "{identity}");
        let expected = adapted
            .iter()
            .chain(&pending)
            .find(|(expected, _)| expected == identity)
            .map_or(explanation.as_str(), |(_, text)| *text);
        assert_eq!(rule.explanation(), expected, "{identity}");
    }
    assert_eq!(
        missing,
        [
            "@loomcli/core/invalid-redact-path",
            "@loomcli/core/option-arity",
            "@loomcli/core/phrasebook-language",
            "@loomcli/core/plain-mark",
        ]
    );
    let shared: BTreeSet<&str> = reference
        .iter()
        .map(|(identity, _, _)| identity.as_str())
        .collect();
    let own: Vec<&str> = rules::ALL
        .iter()
        .map(|rule| rule.identity())
        .filter(|identity| !shared.contains(identity))
        .collect();
    assert_eq!(
        own,
        [
            "@loomcli/core/passthrough-declared-twice",
            "@loomcli/core/terminal-need-declared-twice",
            "@loomcli/core/option-config",
            "@loomcli/core/plugin-option-name",
            "@loomcli/core/input-read",
            "@loomcli/core/handler-registered-twice",
            "@loomcli/core/entry-point",
        ]
    );
}

#[test]
fn a_core_declaration_fault_between_two_calls_prints_a_finding_for_each_then_the_rules_explanation_and_correction()
 {
    let declaration = |arguments: Literal, note: &str| {
        Finding::new("argument", vec!["path".into(), arguments])
            .path(vec!["get".to_owned()])
            .mark("0")
            .note(note)
    };
    let fault = DeclarationError::new(
        rules::ARGUMENT_DECLARED_TWICE,
        DiagnosticParts::new("Argument \"path\" is declared more than once on Command \"get\".")
            .finding(declaration(
                Literal::builder("Arg::string()").call("required", Vec::new()),
                "the first declaration",
            ))
            .finding(declaration(
                Literal::builder("Arg::string()"),
                "the second declaration",
            ))
            .correction("Remove or rename the duplicate."),
    );
    assert_eq!(
        fault.message(),
        [
            "-- ARGUMENT DECLARED TWICE --------------- @loomcli/core/argument-declared-twice",
            "",
            "Argument \"path\" is declared more than once on Command \"get\".",
            "",
            "    // get",
            "    Command::new(\"get\")",
            "      .argument(\"path\", Arg::string().required())",
            "                ^^^^^^ the first declaration",
            "",
            "    // get",
            "    Command::new(\"get\")",
            "      .argument(\"path\", Arg::string())",
            "                ^^^^^^ the second declaration",
            "",
            "An action reads each argument under its name, so two arguments with one name",
            "leave one of them unreadable.",
            "",
            "Remove or rename the duplicate.",
        ]
        .join("\n")
    );
}

/// A development scene on an 80-column stderr that reads no source.
fn scene(application: &str) -> DeveloperScene<'_> {
    DeveloperScene {
        application,
        columns: None,
        source: SourceAccess::none(),
    }
}

#[test]
fn a_core_declaration_fault_no_call_declared_reports_from_run_with_no_finding() {
    let fault = DeclarationError::new(
        rules::COMMAND_WITHOUT_ACTION,
        DiagnosticParts::new("The root Command has no action.").correction("Register an action."),
    );
    assert_eq!(
        developer_plain_text(AuthorFault::Declaration(&fault), &scene("fixture")),
        [
            "-- NOTHING TO RUN ------------------------- @loomcli/core/command-without-action",
            "",
            "The root Command has no action.",
            "",
            "Routing ends at a Command that runs its action, or passes on to one of a group's",
            "children. A Command with neither leaves an invocation that reaches it nothing to",
            "run. A group that declares an argument, stdin, the passthrough mode, or that it",
            "needs a terminal has the same fault, because those declarations reach no action.",
            "",
            "Register an action.",
            "",
        ]
        .join("\n")
    );
}

#[test]
fn run_opens_a_findings_path_with_the_application_name() {
    let fault = DeclarationError::new(
        rules::DECLARED_NAME,
        DiagnosticParts::new("Option name \"-v\" starts with a hyphen.").finding(
            Finding::new(
                "option",
                vec!["-v".into(), Literal::builder("Opt::boolean()")],
            )
            .path(vec!["get".to_owned()])
            .mark("0"),
        ),
    );
    let text = developer_plain_text(AuthorFault::Declaration(&fault), &scene("jsonkit"));
    assert!(text.contains("\n    // jsonkit get\n    Command::new(\"get\")\n"));
    let root = DeclarationError::new(
        rules::DECLARED_NAME,
        DiagnosticParts::new("Option name \"-v\" starts with a hyphen.").finding(
            Finding::new("option", vec!["-v".into()])
                .path(Vec::new())
                .mark("0"),
        ),
    );
    let text = developer_plain_text(AuthorFault::Declaration(&root), &scene("jsonkit"));
    assert!(
        text.contains(
            "\n    // jsonkit\n    Application::new(\"jsonkit\")\n      .option(\"-v\")\n"
        )
    );
}

#[test]
fn a_defect_prints_its_sentence_its_cause_chain_then_the_rules_explanation_and_correction() {
    let defect = foreign_failure(Error::from(std::io::Error::other("The translator failed.")));
    let text = developer_plain_text(AuthorFault::Defect(&defect), &scene("fixture"));
    // A process that enables backtraces adds the source location and the frames between the
    // sentence and the chain's heading, so the test reads the parts around them.
    assert!(
        text.starts_with(
            &[
                "-- UNHANDLED EXCEPTION ----------------------------- @loomcli/core/foreign-throw",
                "",
                "The translator failed.",
                "",
            ]
            .join("\n")
        )
    );
    assert!(text.contains(&format!(
        "\n{}: The translator failed.\n",
        std::any::type_name::<std::io::Error>()
    )));
    assert!(text.ends_with(
        &[
            "Core reports a value that an action, a middleware, a configuration source, a",
            "view, a translator, or a plugin's hook threw, and that no translator answered,",
            "as a defect, because only the author knows what it means. A distributed build",
            "shows the operator one generic message in its place.",
            "",
            "Catch the error where it is thrown and throw a failure class, such as FatalError, with a sentence the operator can act on.",
            "",
        ]
        .join("\n")
    ));
}

#[test]
fn a_defect_with_no_rule_reads_the_defect_banner_and_keeps_its_sentence_on_one_line() {
    let defect = InternalError::message_only("Broke\nhere.", crate::FatalError::new("The cause."));
    assert_eq!(
        developer_plain_text(AuthorFault::Defect(&defect), &scene("fixture")),
        [
            "-- DEFECT ----------------------------------------------------------------------",
            "",
            "Broke\\u000ahere.",
            "",
            "FatalError: The cause.",
            "",
        ]
        .join("\n")
    );
}

#[test]
fn the_developer_text_styles_the_banner_and_prints_the_hints_after_one_blank_line() {
    let fault = DeclarationError::sentence_only("One sentence.");
    let hints = vec!["Run with --explain.".to_owned()];
    let text = developer_text(
        AuthorFault::Declaration(&fault),
        &scene("fixture"),
        &hints,
        &style(),
    );
    let resolved = Renderer::new(Capabilities::PLAIN, Palette::new()).plain(&text);
    assert_eq!(
        resolved,
        format!(
            "-- INVALID DECLARATION {}\n\nOne sentence.\n\nRun with --explain.\n",
            "-".repeat(57)
        )
    );
}

#[test]
fn an_author_fault_is_read_from_a_failure_by_its_class() {
    let fault = DeclarationError::sentence_only("x");
    assert!(matches!(
        AuthorFault::of(&fault),
        Some(AuthorFault::Declaration(_))
    ));
    let result = crate::ResultError::new(crate::ResultFault::Missing, Vec::new());
    assert!(matches!(
        AuthorFault::of(&result),
        Some(AuthorFault::Defect(_))
    ));
    assert!(AuthorFault::of(&crate::FatalError::new("x")).is_none());
}

#[test]
fn the_diagnostic_fills_the_columns_a_scene_reports() {
    let fault = DeclarationError::new(
        rules::COMMAND_WITHOUT_ACTION,
        DiagnosticParts::new("The root Command has no action."),
    );
    let wide = DeveloperScene {
        columns: Some(100),
        ..scene("fixture")
    };
    let text = developer_plain_text(AuthorFault::Declaration(&fault), &wide);
    assert_eq!(
        text.split('\n').next().map(|line| line.chars().count()),
        Some(100)
    );
}
