//! Declaration faults at the call and at attach, and the declaration facts the graph publishes.
//!
//! Ported from the reference's `command-diagnostics.test.ts`, `declaration-calls.test.ts`,
//! `global-option.test.ts`, `option-groups.test.ts` (declaration part), `option-aliases.test.ts`
//! (declaration part), `color-declarations.test.ts`, `verbosity-declarations.test.ts`,
//! `background-declarations.test.ts`, `control-options.test.ts`, `tree.test.ts`, and the input
//! declaration errors of `options.md`. A fault at an author's call panics with the whole Developer
//! Diagnostic as its message, so each case reads the rule, the sentence, and the correction from
//! the message the panic carries.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::panic::{AssertUnwindSafe, catch_unwind};

use loomcli_core::{
    Application, Arg, Command, ConfigurationSource, Context, Extension, NoInputs, Opt,
    OptionTarget, Plugin, Polarity, SourceContext, Stdin, StringOpt, ValidationContext, Validator,
};

async fn act(_context: Context) -> loomcli_core::Outcome {
    Ok(())
}

fn leaf(name: &str) -> Command {
    Command::new(name).action(act)
}

/// The rule, sentence, and correction of the diagnostic a faulty call panics with.
#[derive(Debug, PartialEq)]
struct Parts {
    rule: String,
    sentence: String,
    correction: String,
}

/// The message the call panics with.
fn panic_message(declare: impl FnOnce()) -> String {
    let payload = catch_unwind(AssertUnwindSafe(declare)).expect_err("the call faults");
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
        })
        .expect("the panic carries the diagnostic")
}

/// The parts of a diagnostic: the identity the banner ends with, the sentence below it, and the
/// correction that closes it, each paragraph read with its wrapped lines joined.
fn parts_of(message: &str) -> Parts {
    let paragraphs: Vec<String> = message
        .split("\n\n")
        .map(|paragraph| {
            paragraph
                .lines()
                .map(str::trim_end)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect();
    let identity = paragraphs[0].rsplit(' ').next().unwrap_or_default();
    Parts {
        rule: identity
            .strip_prefix("@loomcli/core/")
            .unwrap_or(identity)
            .to_owned(),
        sentence: paragraphs[1].clone(),
        correction: paragraphs.last().cloned().unwrap_or_default(),
    }
}

fn fault(declare: impl FnOnce()) -> Parts {
    parts_of(&panic_message(declare))
}

fn expected(rule: &str, sentence: &str, correction: &str) -> Parts {
    Parts {
        rule: rule.to_owned(),
        sentence: sentence.to_owned(),
        correction: correction.to_owned(),
    }
}

const PORTABLE: &str = "Use a nonempty name of A-Z, a-z, 0-9, \".\", \"_\", and \"-\" that does not start with \"-\" or \".\".";
const DECLARED: &str = "Use a nonempty name without a leading hyphen, whitespace, or \"=\".";

// command-diagnostics.test.ts

#[test]
fn the_alias_portable_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("keys").alias("ls").alias("bad name");
        }),
        expected(
            "portable-name",
            "Command \"keys\" declares an alias named \"bad name\".",
            PORTABLE
        )
    );
}

#[test]
fn the_application_name_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Application::new("bad name");
        }),
        expected(
            "portable-name",
            "Application name \"bad name\" is invalid.",
            PORTABLE
        )
    );
}

#[test]
fn the_argument_name_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("get").argument("-path", Arg::string());
        }),
        expected(
            "declared-name",
            "Command \"get\" declares an argument named \"-path\".",
            DECLARED
        )
    );
}

#[test]
fn the_argument_twice_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("get")
                .argument("path", Arg::string().required())
                .argument("path", Arg::string());
        }),
        expected(
            "argument-declared-twice",
            "Argument \"path\" is declared more than once on Command \"get\".",
            "Remove or rename the duplicate."
        )
    );
}

#[test]
fn the_child_without_action_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("store").command(Command::new("get"));
        }),
        expected(
            "command-without-action",
            "Command \"get\" has no action.",
            "Register an action."
        )
    );
}

#[test]
fn the_command_name_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("bad name");
        }),
        expected(
            "portable-name",
            "Command name \"bad name\" is invalid.",
            PORTABLE
        )
    );
}

#[test]
fn the_optional_before_required_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("keys")
                .argument("path", Arg::string())
                .argument("name", Arg::string().required());
        }),
        expected(
            "optional-argument-last",
            "Argument \"path\" is optional and precedes required argument \"name\" on Command \"keys\".",
            "Declare optional arguments after required ones."
        )
    );
}

#[test]
fn the_sibling_alias_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("store")
                .command(Command::new("select").alias("ls").action(act))
                .command(Command::new("keys").alias("ls").action(act));
        }),
        expected(
            "sibling-name-taken",
            "Command \"store\" attaches child \"keys\" with alias \"ls\", which is also an alias of child \"select\".",
            "Rename or remove one."
        )
    );
}

#[test]
fn the_sibling_alias_name_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("store")
                .command(leaf("get"))
                .command(Command::new("keys").alias("get").action(act));
        }),
        expected(
            "sibling-name-taken",
            "Command \"store\" attaches child \"keys\" with alias \"get\", which is also the name of child \"get\".",
            "Rename or remove one."
        )
    );
}

#[test]
fn the_sibling_name_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("store")
                .command(leaf("get"))
                .command(leaf("get"));
        }),
        expected(
            "sibling-name-taken",
            "Command \"store\" attaches two children named \"get\".",
            "Rename or remove one."
        )
    );
}

#[test]
fn the_sibling_name_alias_fault_throws_its_rules_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("store")
                .command(Command::new("keys").alias("get").action(act))
                .command(leaf("get"));
        }),
        expected(
            "sibling-name-taken",
            "Command \"store\" attaches child \"keys\" with alias \"get\", which is also the name of child \"get\".",
            "Rename or remove one."
        )
    );
}

#[test]
fn a_sibling_fault_notes_each_child_and_alias_by_the_childs_name() {
    let message = panic_message(|| {
        let _ = Command::new("store")
            .command(leaf("get"))
            .command(leaf("get"));
    });
    assert_eq!(
        message,
        "-- NAME TAKEN BY A SIBLING -------------------- @loomcli/core/sibling-name-taken\n\nCommand \"store\" attaches two children named \"get\".\n\n    // store\n    Command::new(\"store\")\n      .command(Command::new(\"get\"))\n               ^^^^^^^^^^^^^^^^^^^ child \"get\"\n\n    // store\n    Command::new(\"store\")\n      .command(Command::new(\"get\"))\n               ^^^^^^^^^^^^^^^^^^^ child \"get\"\n\nEvery canonical name and alias under one parent routes one token to one child,\nso a name that two siblings share cannot route.\n\nRename or remove one."
    );
    let message = panic_message(|| {
        let _ = Command::new("store")
            .command(Command::new("select").alias("ls").action(act))
            .command(Command::new("keys").alias("ls").action(act));
    });
    assert_eq!(
        message,
        "-- NAME TAKEN BY A SIBLING -------------------- @loomcli/core/sibling-name-taken\n\nCommand \"store\" attaches child \"keys\" with alias \"ls\", which is also an alias of child \"select\".\n\n    // store select\n    Command::new(\"select\")\n      .alias(\"ls\")\n             ^^^^ alias of child \"select\"\n\n    // store keys\n    Command::new(\"keys\")\n      .alias(\"ls\")\n             ^^^^ alias of child \"keys\"\n\nEvery canonical name and alias under one parent routes one token to one child,\nso a name that two siblings share cannot route.\n\nRename or remove one."
    );
}

#[test]
fn a_twin_name_reports_before_an_alias_a_sibling_already_holds() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("store")
                .command(Command::new("a").alias("x").action(act))
                .command(leaf("b"))
                .command(Command::new("b").alias("x").action(act));
        }),
        expected(
            "sibling-name-taken",
            "Command \"store\" attaches two children named \"b\".",
            "Rename or remove one."
        )
    );
}

#[test]
fn an_optional_argument_after_a_variadic_reports_its_diagnostic() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("get")
                .argument("paths", Arg::string().variadic())
                .argument("path", Arg::string());
        }),
        expected(
            "argument-after-variadic",
            "Argument \"path\" is optional and follows variadic argument \"paths\" on Command \"get\".",
            "Declare only required scalar arguments after a variadic argument."
        )
    );
}

#[test]
fn a_conditionally_required_argument_before_a_required_one_is_out_of_order() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("clone")
                .argument("url", Arg::string().required_when_non_interactive())
                .argument("dir", Arg::string().required());
        }),
        expected(
            "optional-argument-last",
            "Argument \"url\" is required only when input is not interactive and precedes required argument \"dir\" on Command \"clone\".",
            "Declare arguments required only when input is not interactive after required ones."
        )
    );
}

#[test]
fn optional_arguments_may_follow_each_other_and_a_required_one_binds_before_them() {
    let application = Application::new("keys")
        .argument("first", Arg::string().required())
        .argument("second", Arg::string())
        .argument("third", Arg::string())
        .action(act);
    assert!(application.inspect().is_ok());
}

#[test]
fn an_alias_that_repeats_the_name_or_an_alias_adds_nothing() {
    let graph = Application::new("store")
        .command(
            Command::new("list")
                .alias("list")
                .alias("ls")
                .alias("ls")
                .action(act),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    assert_eq!(graph.root.children[0].aliases, ["ls"]);
}

// command-diagnostics.test.ts, the rows with a plugin's Commands.

#[test]
fn a_root_group_with_a_plugin_command_cannot_declare_arguments() {
    let app = Application::new("probe")
        .plugins([Plugin::new("@acme/doctor").commands([leaf("check")])])
        .argument("files", Arg::string().variadic());
    let fault = app.inspect().unwrap_err();
    assert_eq!(
        fault.rule().unwrap().identity(),
        "@loomcli/core/command-without-action"
    );
    assert_eq!(
        fault.sentence(),
        "The root Command declares arguments but registers no action to receive them."
    );
}

#[test]
fn two_commands_of_one_plugin_that_share_a_name_are_sibling_name_taken() {
    assert_eq!(
        fault(|| {
            let _ = Plugin::new("@acme/doctor").commands([
                leaf("check"),
                Command::new("probe").alias("check").action(act),
            ]);
        }),
        expected(
            "sibling-name-taken",
            "The root Command attaches child \"probe\" with alias \"check\", which is also the name of child \"check\".",
            "Rename or remove one."
        )
    );
}

// declaration-faults.test.ts and declaration-calls.test.ts

#[test]
fn an_authors_faulty_call_panics_with_the_whole_diagnostic() {
    let message = panic_message(|| {
        let _ = Command::new("list")
            .option("verbose", Opt::boolean().short('v'))
            .option("version", Opt::boolean().short('v'));
    });
    assert!(message.starts_with(
        "-- SPELLING USED TWICE ---------------------------- @loomcli/core/spelling-taken\n\nOption spelling \"-v\" is used by both \"verbose\" and \"version\".\n"
    ));
    assert!(message.ends_with("\nChange one declaration."));
    assert!(!message.contains("Invalid declaration:"));
}

#[test]
fn a_local_option_named_like_a_global_option_reports_the_shared_name_before_its_configs_faults() {
    let application = Application::new("app").global_option("verbose", Opt::boolean());
    assert_eq!(
        fault(move || {
            let _ = application.option("verbose", Opt::boolean().aliases(["-v"]));
        })
        .rule,
        "option-declared-twice"
    );
}

#[test]
fn an_argument_that_claims_stdin_after_an_option_claimed_it_faults_at_the_argument_call() {
    let read = Command::new("read").option("input", Opt::content().stdin());
    assert_eq!(
        fault(move || {
            let _ = read.argument("file", Arg::content().stdin());
        }),
        expected(
            "stdin-claimed-twice",
            "A Command declares more than one stdin target.",
            "Keep one stdin target on the Command."
        )
    );
}

#[test]
fn a_second_standalone_stdin_faults() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("read")
                .stdin(Stdin::new())
                .stdin(Stdin::new().required());
        }),
        expected(
            "stdin-claimed-twice",
            "A Command declares stdin twice.",
            "Keep one stdin declaration."
        )
    );
}

#[test]
fn stdin_on_a_group_is_a_finished_command_fault() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("store").command(
                Command::new("cache")
                    .stdin(Stdin::new())
                    .command(leaf("clear")),
            );
        }),
        expected(
            "command-without-action",
            "Command \"cache\" declares stdin but registers no action to receive it.",
            "Declare stdin on the Command that reads it, or register an action."
        )
    );
}

// global-option.test.ts

#[test]
fn global_option_derives_an_application_without_changing_its_receiver() {
    let base = Application::new("app");
    let derived = base.clone().global_option("quiet", Opt::boolean());
    assert!(base.inspect().is_err());
    let graph = derived.action(act).inspect().expect("the graph builds");
    assert_eq!(graph.globals.len(), 1);
    assert_eq!(
        base.action(act)
            .inspect()
            .expect("the graph builds")
            .globals
            .len(),
        0
    );
}

#[test]
fn a_global_declared_after_a_colliding_root_local_option_faults_at_global_option() {
    assert_eq!(
        fault(|| {
            let _ = Application::new("app")
                .option("quiet", Opt::boolean())
                .global_option("quiet", Opt::boolean());
        }),
        expected(
            "option-declared-twice",
            "Option \"quiet\" is declared as a global option and as a local option on the root Command.",
            "Rename the local option."
        )
    );
}

#[test]
fn an_attached_command_whose_option_repeats_a_global_spelling_faults_at_attach() {
    let application = Application::new("app").global_option("verbose", Opt::count().short('v'));
    assert_eq!(
        fault(move || {
            let _ = application.command(
                Command::new("get")
                    .option("values", Opt::boolean().short('v'))
                    .action(act),
            );
        }),
        expected(
            "spelling-taken",
            "Option spelling \"-v\" is used by the global option \"verbose\" and the local option \"values\" on Command \"get\".",
            "Change one declaration."
        )
    );
}

#[test]
fn an_attached_command_whose_option_repeats_a_global_key_faults_at_attach() {
    let application = Application::new("app").global_option("g", Opt::boolean());
    assert_eq!(
        fault(move || {
            let _ = application.command(Command::new("bad").option("g", Opt::string()).action(act));
        }),
        expected(
            "option-declared-twice",
            "Option \"g\" is declared as a global option and as a local option on Command \"bad\".",
            "Rename the local option."
        )
    );
}

#[test]
fn a_join_that_faults_leaves_the_application_as_it_was() {
    let application = Application::new("app").global_option("g", Opt::boolean());
    let kept = application.clone();
    let _ = panic_message(move || {
        let _ = application.command(Command::new("bad").option("g", Opt::string()).action(act));
    });
    let graph = kept
        .command(Command::new("ok").option("h", Opt::string()).action(act))
        .inspect()
        .expect("the graph builds");
    assert_eq!(graph.root.children.len(), 1);
}

#[test]
fn a_variable_a_global_and_a_local_option_both_bind_faults() {
    let application = Application::new("app").global_option("level", Opt::string().env(["LEVEL"]));
    assert_eq!(
        fault(move || {
            let _ = application.option("depth", Opt::string().env(["LEVEL"]));
        }),
        expected(
            "variable-bound-twice",
            "Variable \"LEVEL\" is bound by global option \"level\" and the root Command option \"depth\".",
            "Bind each variable to one option."
        )
    );
}

// The input declaration errors of options.md.

#[test]
fn an_invalid_option_name_or_alias_faults() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("get").option("dry run", Opt::boolean());
        }),
        expected(
            "declared-name",
            "Option name \"dry run\" is invalid.",
            DECLARED
        )
    );
    assert_eq!(
        fault(|| {
            let _ = Command::new("get").option("depth", Opt::string().aliases(["=d"]));
        }),
        expected(
            "declared-name",
            "Option \"depth\" declares an alias named \"=d\".",
            DECLARED
        )
    );
}

#[test]
fn a_key_declared_twice_in_one_scope_faults() {
    assert_eq!(
        fault(|| {
            let _ = Application::new("app")
                .global_option("file", Opt::string())
                .global_option("file", Opt::boolean());
        }),
        expected(
            "option-declared-twice",
            "Option \"file\" is declared more than once on the global options.",
            "Remove or rename the duplicate."
        )
    );
    assert_eq!(
        fault(|| {
            let _ = Command::new("get")
                .option("file", Opt::string())
                .option("file", Opt::boolean());
        }),
        expected(
            "option-declared-twice",
            "Option \"file\" is declared more than once on Command \"get\".",
            "Remove or rename the duplicate."
        )
    );
}

#[test]
fn a_generated_negative_form_and_an_alias_spelling_count_as_spellings() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("get")
                .option("color", Opt::boolean().polarity(Polarity::Both))
                .option("no-color", Opt::boolean());
        }),
        expected(
            "spelling-taken",
            "Option spelling \"--no-color\" is used by both \"color\" and \"no-color\".",
            "Change one declaration."
        )
    );
    assert_eq!(
        fault(|| {
            let _ = Command::new("get")
                .option("minimum", Opt::string())
                .option("min-bytes", Opt::string().aliases(["minimum"]));
        }),
        expected(
            "spelling-taken",
            "Option spelling \"--minimum\" is used by both \"minimum\" and \"min-bytes\".",
            "Change one declaration."
        )
    );
}

#[test]
fn an_empty_env_delimiter_faults() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("get").option(
                "field",
                Opt::string().multiple().env(["FIELDS"]).env_delimiter(""),
            );
        }),
        expected(
            "env-delimiter",
            "Option \"field\" declares an empty envDelimiter.",
            "Name the string that separates the items, such as \",\"."
        )
    );
}

#[test]
fn a_variable_two_local_options_bind_faults_and_one_named_twice_binds_once() {
    assert_eq!(
        fault(|| {
            let _ = Command::new("get")
                .option("depth", Opt::string().env(["DEPTH", "DEPTH"]))
                .option("level", Opt::string().env(["DEPTH"]));
        }),
        expected(
            "variable-bound-twice",
            "Variable \"DEPTH\" is bound by Command \"get\" option \"depth\" and Command \"get\" option \"level\".",
            "Bind each variable to one option."
        )
    );
}

#[test]
fn a_builder_combination_the_reference_types_reject_is_option_config() {
    let cases: Vec<(StringOpt, &str)> = vec![
        (
            Opt::string().required().default("1"),
            "Option \"depth\" declares a default beside required.",
        ),
        (
            Opt::string().short_only(),
            "Option \"depth\" declares short_only without a short spelling.",
        ),
        (
            Opt::string().multiple().env(["DEPTH"]),
            "Option \"depth\" binds a multiple option to the environment without env_delimiter.",
        ),
    ];
    for (option, sentence) in cases {
        let parts = fault(move || {
            let _ = Command::new("get").option("depth", option);
        });
        assert_eq!(parts.rule, "option-config");
        assert_eq!(parts.sentence, sentence);
    }
    assert_eq!(
        fault(|| {
            let _ = Application::new("app").global_option("depth", Opt::string().required());
        })
        .sentence,
        "Option \"depth\" declares required on a global option, which declares no presence rule."
    );
    assert_eq!(
        fault(|| {
            let _ = Command::new("get").option("paint", Opt::boolean().color());
        })
        .sentence,
        "Option \"paint\" declares color on a local option; only a global option carries a run-wide mark."
    );
}

#[test]
fn a_shutdown_budget_out_of_range_faults() {
    assert_eq!(
        fault(|| {
            let _ = Application::new("app").shutdown_timeout(3_000_000_000);
        }),
        expected(
            "invalid-shutdown-timeout",
            "The Application declares shutdown timeout 3000000000, which is not a whole number of milliseconds from 0 through 2147483647.",
            "Set the shutdown timeout to a whole number of milliseconds from 0 through 2147483647, or leave it out for 500."
        )
    );
    let _ = Application::new("app").shutdown_timeout(2_147_483_647);
}

// option-groups.test.ts, the declaration part.

fn base() -> Command<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Fresh> {
    Command::new("export")
        .option("a", Opt::boolean())
        .option("b", Opt::boolean())
}

/// One faulty declaration, made when called.
type Declare = Box<dyn FnOnce()>;

#[test]
fn rejects_each_option_group_declaration_fault() {
    let cases: Vec<(&str, Declare, &str)> = vec![
        (
            "unknown",
            Box::new(|| {
                let _ = base().exclusive(&["a", "missing"]);
            }),
            "Command \"export\" exclusive names undeclared local option \"missing\".",
        ),
        (
            "argument",
            Box::new(|| {
                let _ = base()
                    .argument("file", Arg::string())
                    .one_required(&["a", "file"]);
            }),
            "Command \"export\" oneRequired names undeclared local option \"file\".",
        ),
        (
            "global",
            Box::new(|| {
                let _ = Application::new("groups")
                    .global_option("global", Opt::boolean())
                    .option("a", Opt::boolean())
                    .one_required(&["a", "global"]);
            }),
            "The root Command oneRequired names undeclared local option \"global\".",
        ),
        (
            "repeat",
            Box::new(|| {
                let _ = base().exclusive(&["a", "a"]);
            }),
            "Command \"export\" exclusive repeats option \"a\".",
        ),
        (
            "short",
            Box::new(|| {
                let _ = base().one_required(&["a"]);
            }),
            "Command \"export\" declares oneRequired with fewer than two options.",
        ),
        (
            "required",
            Box::new(|| {
                let _ = Command::new("export")
                    .option("a", Opt::string().required())
                    .option("b", Opt::boolean())
                    .exclusive(&["a", "b"]);
            }),
            "Command \"export\" exclusive group contains required option \"a\".",
        ),
        (
            "conditional",
            Box::new(|| {
                let _ = Command::new("export")
                    .option("a", Opt::string().required_when_non_interactive())
                    .option("b", Opt::boolean())
                    .exclusive(&["a", "b"]);
            }),
            "Command \"export\" exclusive group contains required option \"a\".",
        ),
        (
            "content",
            Box::new(|| {
                let _ = Command::new("export")
                    .option("a", Opt::content().required().stdin())
                    .option("b", Opt::boolean())
                    .exclusive(&["a", "b"]);
            }),
            "Command \"export\" exclusive group contains required option \"a\".",
        ),
        (
            "minimum",
            Box::new(|| {
                let _ = Command::new("export")
                    .option("a", Opt::content().multiple().min(1))
                    .option("b", Opt::boolean())
                    .exclusive(&["a", "b"]);
            }),
            "Command \"export\" exclusive group contains required option \"a\".",
        ),
        (
            "overlap",
            Box::new(|| {
                let _ = base().exclusive(&["a", "b"]).required_together(&["a", "b"]);
            }),
            "Command \"export\" exclusive and requiredTogether groups share at least two options.",
        ),
        (
            "reverse-overlap",
            Box::new(|| {
                let _ = base().required_together(&["a", "b"]).exclusive(&["a", "b"]);
            }),
            "Command \"export\" exclusive and requiredTogether groups share at least two options.",
        ),
    ];
    for (scenario, declare, sentence) in cases {
        let parts = fault(declare);
        assert_eq!(parts.rule, "option-group", "{scenario}");
        assert_eq!(parts.sentence, sentence, "{scenario}");
    }
}

#[test]
fn redundancy_and_required_members_in_one_required_remain_valid() {
    let _ = Command::new("export")
        .option("a", Opt::string().required())
        .option("b", Opt::boolean())
        .one_required(&["a", "b"])
        .one_required(&["b", "a"]);
}

#[test]
fn inspection_publishes_the_declared_groups_in_order() {
    let graph = Application::new("groups")
        .command(
            base()
                .exclusive(&["a", "b"])
                .one_required(&["a", "b"])
                .action(act),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    assert_eq!(
        serde_json::to_string(&graph.root.children[0].option_groups).expect("serializes"),
        r#"[{"kind":"exclusive","options":["a","b"]},{"kind":"oneRequired","options":["a","b"]}]"#
    );
}

// option-aliases.test.ts, the declaration part.

#[test]
fn an_alias_an_option_already_answers_to_adds_nothing_and_the_option_keeps_every_spelling() {
    let graph = Application::new("aliases")
        .option(
            "min-bytes",
            Opt::string().aliases(["minimum", "minimum", "min-bytes"]),
        )
        .option(
            "color",
            Opt::boolean()
                .aliases(["no-color", "colour"])
                .polarity(Polarity::Both),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    let aliases: Vec<Vec<String>> = graph
        .root
        .options
        .iter()
        .map(|option| {
            serde_json::from_value(
                serde_json::to_value(option.as_ref()).expect("serializes")["aliases"].clone(),
            )
            .expect("a list")
        })
        .collect();
    assert_eq!(aliases, [vec!["minimum"], vec!["no-color", "colour"]]);
    assert_eq!(graph.root.options[1].long(), Some("--color"));
}

// The run-wide marks: color-, verbosity-, and background-declarations.test.ts, and the interaction
// mark, for the application's own global options. The plugin and binding rows follow them.

#[test]
fn two_global_options_with_one_mark_fault() {
    assert_eq!(
        fault(|| {
            let _ = Application::new("app")
                .global_option("paint", Opt::boolean().color())
                .global_option("tint", Opt::boolean().color());
        }),
        expected(
            "color-mark",
            "Global option \"paint\" and global option \"tint\" both declare color.",
            "Mark one option."
        )
    );
    for (mark, option) in [
        ("verbose", Opt::count().verbose()),
        ("quiet", Opt::count().quiet()),
    ] {
        let second = option.clone();
        assert_eq!(
            fault(move || {
                let _ = Application::new("app")
                    .global_option("loud", option)
                    .global_option("louder", second);
            }),
            expected(
                &format!("{mark}-mark"),
                &format!(
                    "Global option \"loud\" and global option \"louder\" both declare {mark}."
                ),
                "Mark one option."
            )
        );
    }
    assert_eq!(
        fault(|| {
            let _ = Application::new("app")
                .global_option("shade", Opt::string().background())
                .global_option("tone", Opt::string().background());
        })
        .rule,
        "background-mark"
    );
    assert_eq!(
        fault(|| {
            let _ = Application::new("app")
                .global_option("no-input", Opt::boolean().interaction())
                .global_option("batch", Opt::boolean().interaction());
        })
        .rule,
        "interaction-mark"
    );
}

#[test]
fn a_marked_global_option_of_each_kind_declares() {
    let graph = Application::new("app")
        .global_option("color", Opt::boolean().color().polarity(Polarity::Both))
        .global_option("verbose", Opt::count().verbose().short('v'))
        .global_option("quiet", Opt::count().quiet())
        .global_option("background", Opt::string().background().aliases(["bg"]))
        .global_option("tint", Opt::string())
        .action(act)
        .inspect()
        .expect("the graph builds");
    let facts: Vec<(
        String,
        serde_json::Value,
        serde_json::Value,
        serde_json::Value,
    )> = graph
        .globals
        .iter()
        .map(|option| {
            let node = serde_json::to_value(option.as_ref()).expect("serializes");
            (
                option.name().to_owned(),
                node["color"].clone(),
                node["verbose"].clone(),
                node["background"].clone(),
            )
        })
        .collect();
    assert_eq!(
        facts,
        [
            (
                "color".to_owned(),
                true.into(),
                serde_json::Value::Null,
                serde_json::Value::Null
            ),
            (
                "verbose".to_owned(),
                serde_json::Value::Null,
                true.into(),
                serde_json::Value::Null
            ),
            (
                "quiet".to_owned(),
                serde_json::Value::Null,
                false.into(),
                serde_json::Value::Null
            ),
            (
                "background".to_owned(),
                serde_json::Value::Null,
                serde_json::Value::Null,
                true.into()
            ),
            (
                "tint".to_owned(),
                serde_json::Value::Null,
                serde_json::Value::Null,
                false.into()
            ),
        ]
    );
}

#[test]
fn a_mark_rejects_the_spellings_and_sources_the_run_cannot_read_first() {
    for (option, setter) in [
        (
            loomcli_core::GlobalOptionDecl::from(Opt::boolean().color().short('c')),
            "a short spelling",
        ),
        (
            Opt::boolean().color().env(["PAINT"]).into(),
            "an environment binding",
        ),
        (
            Opt::count().verbose().env(["LOUD"]).into(),
            "an environment binding",
        ),
        (Opt::string().background().short('b').into(), "short"),
    ] {
        let parts = fault(move || {
            let _ = Application::new("app").global_option("marked", option);
        });
        assert_eq!(parts.rule, "option-config");
        assert!(
            parts.sentence.ends_with(&format!("beside {setter}.")),
            "{}",
            parts.sentence
        );
    }
}

// The plugin and binding rows of color-, verbosity-, and background-declarations.test.ts.

/// The binding the installed configuration source fills by.
const CONFIG_INPUT: Extension<OptionTarget, String> =
    Extension::new("@loomcli/plugins/config/input");

/// A plugin that installs the configuration source bound through `CONFIG_INPUT`.
fn config_plugin() -> Plugin {
    Plugin::new("@loomcli/plugins/config").source(ConfigurationSource::new(
        &CONFIG_INPUT,
        |_: SourceContext<NoInputs>| async { Ok(std::collections::BTreeMap::new()) },
    ))
}

/// One marked option of each mark that the run settles before configuration: the mark, the
/// option's name in the binding rows, the marked option, the reference's plugin of that mark, the
/// fixture plugin, the name its own marked option takes, and what the binding would be a second
/// source for, with the verb the correction uses.
struct MarkRow {
    mark: &'static str,
    name: &'static str,
    /// The marked option, carrying the source's binding when asked.
    option: fn(bool) -> loomcli_core::GlobalOptionDecl,
    marking: &'static str,
    fixture: &'static str,
    own: &'static str,
    settled: &'static str,
}

/// One value of the source's binding.
fn binding() -> [loomcli_core::ExtensionValue<OptionTarget>; 1] {
    [CONFIG_INPUT.value("input".to_owned())]
}

fn mark_rows() -> [MarkRow; 4] {
    [
        MarkRow {
            mark: "color",
            name: "color",
            option: |bound| {
                let option = Opt::boolean().color().polarity(Polarity::Both);
                if bound {
                    option.extend(binding()).into()
                } else {
                    option.into()
                }
            },
            marking: "@loomcli/plugins/color",
            fixture: "@fixture/paint",
            own: "paint",
            settled: "reads its color",
        },
        MarkRow {
            mark: "verbose",
            name: "verbose",
            option: |bound| {
                let option = Opt::count().verbose();
                if bound {
                    option.extend(binding()).into()
                } else {
                    option.into()
                }
            },
            marking: "@loomcli/plugins/verbose",
            fixture: "@fixture/loud",
            own: "loud",
            settled: "settles its verbosity",
        },
        MarkRow {
            mark: "quiet",
            name: "quiet",
            option: |bound| {
                let option = Opt::count().quiet();
                if bound {
                    option.extend(binding()).into()
                } else {
                    option.into()
                }
            },
            marking: "@loomcli/plugins/verbose",
            fixture: "@fixture/loud",
            own: "loud",
            settled: "settles its verbosity",
        },
        MarkRow {
            mark: "background",
            name: "background",
            option: |bound| {
                let option = Opt::string().background();
                if bound {
                    option.extend(binding()).into()
                } else {
                    option.into()
                }
            },
            marking: "@loomcli/plugins/background",
            fixture: "@fixture/shade",
            own: "shade",
            settled: "reads its background",
        },
    ]
}

#[test]
fn a_mark_on_a_plugins_option_meets_the_other_marked_options() {
    for row in mark_rows() {
        let rule = format!("{}-mark", row.mark);
        let marking = row.marking;
        let name = row.name;
        let option = row.option;
        assert_eq!(
            fault(move || {
                let _ = Application::new("app")
                    .plugins([Plugin::new(marking).option(name, option(false))])
                    .global_option(row.own, option(false));
            }),
            expected(
                &rule,
                &format!(
                    "Global option \"{}\" and plugin \"{marking}\" option \"{name}\" both declare {}.",
                    row.own, row.mark
                ),
                "Mark one option."
            ),
            "two-global {}",
            row.mark
        );
        let (fixture, own) = (row.fixture, row.own);
        assert_eq!(
            fault(move || {
                let _ = Application::new("app").plugins([
                    Plugin::new(fixture).option(own, option(false)),
                    Plugin::new(marking).option(name, option(false)),
                ]);
            }),
            expected(
                &rule,
                &format!(
                    "Plugin \"{fixture}\" option \"{own}\" and plugin \"{marking}\" option \"{name}\" both declare {}.",
                    row.mark
                ),
                "Mark one option."
            ),
            "two-plugins {}",
            row.mark
        );
    }
}

#[test]
fn a_marked_option_carrying_the_installed_sources_binding_faults() {
    for row in mark_rows() {
        let rule = format!("{}-mark", row.mark);
        let second = match row.mark {
            "color" => "color",
            "background" => "background",
            _ => "verbosity",
        };
        let sentence = |subject: &str| {
            format!(
                "{subject} declares {} and carries configuration binding \"@loomcli/plugins/config/input\", a second source for the run's {second}.",
                row.mark
            )
        };
        let correction = format!(
            "Remove the binding; the run {} before configuration.",
            row.settled
        );
        let (name, option, fixture) = (row.name, row.option, row.fixture);
        assert_eq!(
            fault(move || {
                let _ = Application::new("app")
                    .plugins([config_plugin()])
                    .global_option(name, option(true));
            }),
            expected(
                &rule,
                &sentence(&format!("Global option \"{name}\"")),
                &correction
            ),
            "binding-global {}",
            row.mark
        );
        assert_eq!(
            fault(move || {
                let _ = Application::new("app").plugins([
                    Plugin::new(fixture).option(name, option(true)),
                    config_plugin(),
                ]);
            }),
            expected(
                &rule,
                &sentence(&format!("Plugin \"{fixture}\" option \"{name}\"")),
                &correction
            ),
            "binding-plugin {}",
            row.mark
        );
    }
}

#[test]
fn a_binding_of_a_source_the_application_does_not_install_is_inert_beside_a_mark() {
    for row in mark_rows() {
        let graph = Application::new("app")
            .plugins([Plugin::new(row.fixture).option("shadow", Opt::boolean())])
            .global_option(row.name, (row.option)(true))
            .action(act)
            .inspect();
        assert!(graph.is_ok(), "binding-inert {}", row.mark);
    }
}

#[test]
fn a_binding_fault_marks_the_extend_setter_of_the_marked_option() {
    let message = panic_message(|| {
        let _ = Application::new("app")
            .plugins([config_plugin()])
            .global_option("color", Opt::boolean().color().extend(binding()));
    });
    assert!(
        message.contains(
            "    Application::new(…)\n      .global_option(\"color\", Opt::boolean().color().extend([…]))\n                                                     ^^^^^^^^^^^\n"
        ),
        "{message}"
    );
}

// control-options.test.ts, the declaration part.

#[test]
fn every_declarer_marks_its_option_and_an_omitted_mark_reads_false() {
    let graph = Application::new("app")
        .global_option("format", Opt::string().control())
        .global_option("verbose", Opt::count())
        .command(
            Command::new("get")
                .option("help", Opt::boolean().control().short('h'))
                .option("raw", Opt::boolean())
                .action(act),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    let control = |option: &loomcli_core::OptionNode| {
        serde_json::to_value(option).expect("serializes")["control"].clone()
    };
    assert_eq!(
        graph
            .globals
            .iter()
            .map(|option| control(option))
            .collect::<Vec<_>>(),
        [
            serde_json::Value::Bool(true),
            serde_json::Value::Bool(false)
        ]
    );
    assert_eq!(
        graph.root.children[0]
            .options
            .iter()
            .map(|option| control(option))
            .collect::<Vec<_>>(),
        [
            serde_json::Value::Bool(true),
            serde_json::Value::Bool(false)
        ]
    );
}

// nested.test.ts, the call and attach faults at depth. The shared-child scenario is unreachable:
// command() moves its child, so one Command value cannot be attached twice.

fn nested_application()
-> Application<loomcli_core::NoInputs, loomcli_core::NoResult, loomcli_core::Fresh> {
    Application::new("nested-graph").global_option("file", Opt::string().short('f'))
}

fn aliased(name: &str, alias: &str) -> Command {
    Command::new(name).alias(alias).action(act)
}

#[test]
fn the_call_or_attach_that_makes_a_nested_graph_wrong_faults_at_its_depth() {
    let invalid_alias = |alias: &'static str| {
        move || {
            let _ = nested_application().command(aliased("keys", alias));
        }
    };
    let cases: Vec<(&str, Declare, Parts)> = vec![
        (
            "leaf-actionless",
            Box::new(|| {
                let _ = nested_application()
                    .command(Command::new("cache").command(Command::new("clear")));
            }),
            expected(
                "command-without-action",
                "Command \"clear\" has no action.",
                "Register an action.",
            ),
        ),
        (
            "duplicate-nested-children",
            Box::new(|| {
                let _ = nested_application().command(
                    Command::new("cache")
                        .command(leaf("clear"))
                        .command(leaf("clear")),
                );
            }),
            expected(
                "sibling-name-taken",
                "Command \"cache\" attaches two children named \"clear\".",
                "Rename or remove one.",
            ),
        ),
        (
            "invalid-nested-child-name",
            Box::new(|| {
                let _ =
                    nested_application().command(Command::new("cache").command(leaf("bad name")));
            }),
            expected(
                "portable-name",
                "Command name \"bad name\" is invalid.",
                PORTABLE,
            ),
        ),
        (
            "nested-shared-option-key",
            Box::new(|| {
                let _ = nested_application().command(
                    Command::new("cache").command(
                        Command::new("clear")
                            .option("file", Opt::boolean())
                            .action(act),
                    ),
                );
            }),
            expected(
                "option-declared-twice",
                "Option \"file\" is declared as a global option and as a local option on Command \"clear\".",
                "Rename the local option.",
            ),
        ),
        (
            "alias-sibling-name",
            Box::new(|| {
                let _ = nested_application()
                    .command(leaf("get"))
                    .command(aliased("keys", "get"));
            }),
            expected(
                "sibling-name-taken",
                "The root Command attaches child \"keys\" with alias \"get\", which is also the name of child \"get\".",
                "Rename or remove one.",
            ),
        ),
        (
            "alias-before-sibling-name",
            Box::new(|| {
                let _ = nested_application()
                    .command(aliased("keys", "get"))
                    .command(leaf("get"));
            }),
            expected(
                "sibling-name-taken",
                "The root Command attaches child \"keys\" with alias \"get\", which is also the name of child \"get\".",
                "Rename or remove one.",
            ),
        ),
        (
            "alias-sibling-alias",
            Box::new(|| {
                let _ = nested_application()
                    .command(aliased("select", "ls"))
                    .command(aliased("keys", "ls"));
            }),
            expected(
                "sibling-name-taken",
                "The root Command attaches child \"keys\" with alias \"ls\", which is also an alias of child \"select\".",
                "Rename or remove one.",
            ),
        ),
        (
            "invalid-alias-name",
            Box::new(invalid_alias("bad name")),
            expected(
                "portable-name",
                "Command \"keys\" declares an alias named \"bad name\".",
                PORTABLE,
            ),
        ),
        (
            "dot-alias-name",
            Box::new(invalid_alias(".ls")),
            expected(
                "portable-name",
                "Command \"keys\" declares an alias named \".ls\".",
                PORTABLE,
            ),
        ),
        (
            "slash-alias-name",
            Box::new(invalid_alias("ls/all")),
            expected(
                "portable-name",
                "Command \"keys\" declares an alias named \"ls/all\".",
                PORTABLE,
            ),
        ),
        (
            "colon-alias-name",
            Box::new(invalid_alias("ls:all")),
            expected(
                "portable-name",
                "Command \"keys\" declares an alias named \"ls:all\".",
                PORTABLE,
            ),
        ),
        (
            "nested-alias-sibling-name",
            Box::new(|| {
                let _ = nested_application().command(
                    Command::new("cache")
                        .command(leaf("clear"))
                        .command(aliased("list", "clear")),
                );
            }),
            expected(
                "sibling-name-taken",
                "Command \"cache\" attaches child \"list\" with alias \"clear\", which is also the name of child \"clear\".",
                "Rename or remove one.",
            ),
        ),
    ];
    for (scenario, declare, parts) in cases {
        assert_eq!(fault(declare), parts, "{scenario}");
    }
}

// tree.test.ts

#[test]
fn same_named_values_under_different_parents_and_separate_applications_all_build() {
    let first = Application::new("one")
        .command(Command::new("cache").command(leaf("clear")))
        .command(Command::new("tmp").command(leaf("clear")))
        .action(act);
    let second = Application::new("two")
        .command(Command::new("cache").command(leaf("clear")))
        .action(act);
    for application in [&first, &first, &second] {
        assert!(application.inspect().is_ok());
    }
}

// The input schema: validation.md's input schema section, input-schema.test.ts and
// schema.test.ts for what core publishes.

#[derive(Clone)]
struct Bounded;

impl Validator for Bounded {
    type Output = String;

    fn validate(
        &self,
        input: &str,
        _context: &ValidationContext,
    ) -> Result<String, Vec<loomcli_core::Issue>> {
        Ok(input.to_owned())
    }

    fn input_schema(&self) -> loomcli_core::InputSchema {
        let mut schema = serde_json::Map::new();
        schema.insert("maxLength".to_owned(), 8.into());
        schema.insert("type".to_owned(), "string".into());
        Some(schema)
    }
}

#[test]
fn an_input_publishes_its_validators_schema_and_a_content_input_a_nonempty_path() {
    let graph = Application::new("schemas")
        .option("name", Opt::string().validate(Bounded))
        .option("file", Opt::content())
        .option("plain", Opt::string())
        .argument("source", Arg::content().variadic().min(1).max(3))
        .action(act)
        .inspect()
        .expect("the graph builds");
    let schemas: Vec<String> = graph
        .root
        .options
        .iter()
        .map(|option| {
            serde_json::to_string(
                &serde_json::to_value(option.as_ref()).expect("serializes")["schema"],
            )
            .expect("serializes")
        })
        .collect();
    assert_eq!(
        schemas,
        [
            r#"{"maxLength":8,"type":"string"}"#,
            r#"{"minLength":1,"type":"string"}"#,
            "null"
        ]
    );
    assert_eq!(
        serde_json::to_string(graph.root.options[1].as_ref()).expect("serializes"),
        r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--file","name":"file","short":null,"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":{"minLength":1,"type":"string"},"validateOmitted":false,"validated":true,"stdin":false,"type":"content"}"#
    );
    assert_eq!(
        serde_json::to_string(graph.root.arguments[0].as_ref()).expect("serializes"),
        r#"{"max":3,"min":1,"stdin":false,"type":"content","extensions":{},"name":"source","required":true,"requiredWhen":null,"schema":{"minLength":1,"type":"string"},"validateOmitted":false,"validated":true,"variadic":true}"#
    );
}

// check.test.ts, for an application with no plugin.

#[test]
fn check_returns_no_fault_for_a_graph_that_builds_and_the_build_fault_alone_otherwise() {
    assert!(leaf_application().check().is_empty());
    let faults = Application::new("empty").check();
    assert_eq!(faults.len(), 1);
    assert_eq!(faults[0].sentence(), "The root Command has no action.");
}

fn leaf_application() -> Application {
    Application::new("app").command(leaf("get")).action(act)
}

// media-types.test.ts, the graph part.

#[test]
fn each_result_keeps_the_media_type_its_view_declared_and_views_replaces_one_in_place() {
    use loomcli_core::{ResultViews, View};
    type Value = serde_json::Value;
    let graph = Application::new("media")
        .command(
            Command::new("show")
                .result(
                    ResultViews::new()
                        .view("text", View::new(|value: &Value, _| value.to_string()))
                        .view(
                            "json",
                            View::new(|value: &Value, _| value.to_string())
                                .media_type("application/json"),
                        ),
                )
                .views(ResultViews::new().view(
                    "text",
                    View::new(|value: &Value, _| value.to_string()).media_type("text/csv"),
                ))
                .action(|_| async { Ok(()) }),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    assert_eq!(
        serde_json::to_string(&graph.root.children[0].result).expect("serializes"),
        r#"{"default":"text","kind":"value","mediaTypes":{"text":"text/csv","json":"application/json"},"views":["text","json"]}"#
    );
}

#[test]
fn each_store_keeps_the_media_type_its_view_declared_a_hook_added_view_included() {
    use loomcli_core::{AttachedViews, ResultViews, RowView, RowViews, View};
    type Value = serde_json::Value;
    let render = || View::new(|value: &Value, _| value.to_string());
    let adding = Plugin::new("@fixture/adding").on_command_attach(|command| {
        if command.name() == Some("rows") {
            command.views(AttachedViews::new().view(
                "hooked",
                View::new(|value: &Value, _| value.to_string()).media_type("application/x-hooked"),
            ))?;
        }
        Ok(())
    });
    let graph = Application::new("probe")
        .plugins([adding])
        .command(
            Command::new("value")
                .result(
                    ResultViews::new()
                        .view("csv", render().media_type("text/csv"))
                        .view("page", render().media_type("text/plain"))
                        .view("plain", render()),
                )
                .views(ResultViews::new().view("added", render().media_type("text/markdown")))
                .action(|_| async { Ok(()) }),
        )
        .command(
            Command::new("rows")
                .rows(
                    RowViews::new()
                        .view(
                            "lines",
                            RowView::new(|row: &Value, _, _| row.to_string())
                                .media_type("application/jsonl"),
                        )
                        .view(
                            "odd",
                            View::new(|rows: &[Value], _| format!("{}", rows.len()))
                                .media_type("nonsense"),
                        ),
                )
                .action(|_| async { Ok(()) }),
        )
        .action(act)
        .inspect()
        .expect("the graph builds");
    let media_types = |node: &loomcli_core::CommandNode| {
        serde_json::to_value(&node.result).expect("serializes")["mediaTypes"].clone()
    };
    let value = graph.command(&["value"]).unwrap();
    let rows = graph.command(&["rows"]).unwrap();
    assert_eq!(media_types(&graph.root), Value::Null);
    assert_eq!(
        serde_json::to_string(&media_types(value)).unwrap(),
        r#"{"csv":"text/csv","page":"text/plain","plain":null,"added":"text/markdown"}"#
    );
    assert_eq!(
        serde_json::to_string(&media_types(rows)).unwrap(),
        r#"{"lines":"application/jsonl","odd":"nonsense","hooked":"application/x-hooked"}"#
    );
}

// input-diagnostics.test.ts, the input declaration errors that need no plugin.

#[test]
fn each_input_declaration_fault_reads_its_rule_sentence_and_correction() {
    const CHANGE_ONE: &str = "Change one declaration.";
    let cases: Vec<(&str, Declare, Parts)> = vec![
        (
            "alias-global-local",
            Box::new(|| {
                let _ = Application::new("probe")
                    .global_option("file", Opt::string().aliases(["input"]))
                    .command(
                        Command::new("get")
                            .option("input", Opt::boolean())
                            .action(act),
                    );
            }),
            expected(
                "spelling-taken",
                "Option spelling \"--input\" is used by the global option \"file\" and the local option \"input\" on Command \"get\".",
                CHANGE_ONE,
            ),
        ),
        (
            "alias-name",
            Box::new(|| {
                let _ =
                    Command::new("get").option("min-bytes", Opt::string().aliases(["bad=name"]));
            }),
            expected(
                "declared-name",
                "Option \"min-bytes\" declares an alias named \"bad=name\".",
                DECLARED,
            ),
        ),
        (
            "alias-negative-spelling",
            Box::new(|| {
                let _ = Command::new("get")
                    .option(
                        "color",
                        Opt::boolean().aliases(["colour"]).polarity(Polarity::Both),
                    )
                    .option("no-colour", Opt::boolean());
            }),
            expected(
                "spelling-taken",
                "Option spelling \"--no-colour\" is used by both \"color\" and \"no-colour\".",
                CHANGE_ONE,
            ),
        ),
        (
            "alias-spelling",
            Box::new(|| {
                let _ = Command::new("get")
                    .option("min-bytes", Opt::string().aliases(["limit"]))
                    .option("limit", Opt::string());
            }),
            expected(
                "spelling-taken",
                "Option spelling \"--limit\" is used by both \"min-bytes\" and \"limit\".",
                CHANGE_ONE,
            ),
        ),
        (
            "global-local-key",
            Box::new(|| {
                let _ = Application::new("probe")
                    .global_option("file", Opt::string())
                    .command(
                        Command::new("get")
                            .option("file", Opt::string())
                            .action(act),
                    );
            }),
            expected(
                "option-declared-twice",
                "Option \"file\" is declared as a global option and as a local option on Command \"get\".",
                "Rename the local option.",
            ),
        ),
        (
            "global-local-spelling",
            Box::new(|| {
                let _ = Application::new("probe")
                    .global_option("file", Opt::string().short('f'))
                    .command(
                        Command::new("get")
                            .option("force", Opt::boolean().short('f'))
                            .action(act),
                    );
            }),
            expected(
                "spelling-taken",
                "Option spelling \"-f\" is used by the global option \"file\" and the local option \"force\" on Command \"get\".",
                CHANGE_ONE,
            ),
        ),
        (
            "negative-spelling",
            Box::new(|| {
                let _ = Command::new("get")
                    .option("color", Opt::boolean().polarity(Polarity::Both))
                    .option("no-color", Opt::boolean());
            }),
            expected(
                "spelling-taken",
                "Option spelling \"--no-color\" is used by both \"color\" and \"no-color\".",
                CHANGE_ONE,
            ),
        ),
        (
            "option-name",
            Box::new(|| {
                let _ = Command::new("get").option("-raw", Opt::boolean());
            }),
            expected(
                "declared-name",
                "Option name \"-raw\" is invalid.",
                DECLARED,
            ),
        ),
        (
            "option-twice",
            Box::new(|| {
                let _ = Command::new("get")
                    .option("raw", Opt::boolean())
                    .option("raw", Opt::string());
            }),
            expected(
                "option-declared-twice",
                "Option \"raw\" is declared more than once on Command \"get\".",
                "Remove or rename the duplicate.",
            ),
        ),
        (
            "short-spelling",
            Box::new(|| {
                let _ = Command::new("get")
                    .option("force", Opt::boolean().short('f'))
                    .option("file", Opt::string().short('f'));
            }),
            expected(
                "spelling-taken",
                "Option spelling \"-f\" is used by both \"force\" and \"file\".",
                CHANGE_ONE,
            ),
        ),
        (
            "variable-twice",
            Box::new(|| {
                let _ = Application::new("probe")
                    .global_option("limit", Opt::string().env(["LIMIT"]))
                    .command(
                        Command::new("count")
                            .option("max", Opt::string().env(["LIMIT"]))
                            .action(act),
                    );
            }),
            expected(
                "variable-bound-twice",
                "Variable \"LIMIT\" is bound by global option \"limit\" and Command \"count\" option \"max\".",
                "Bind each variable to one option.",
            ),
        ),
    ];
    for (scenario, declare, parts) in cases {
        assert_eq!(fault(declare), parts, "{scenario}");
    }
}

// input-diagnostics.test.ts, the rows with a plugin's options.

#[test]
fn each_plugin_option_declaration_fault_reads_its_rule_sentence_and_correction() {
    const CHANGE_ONE: &str = "Change one declaration.";
    let cases: Vec<(&str, Declare, Parts)> = vec![
        (
            "plugin-alias-spelling",
            Box::new(|| {
                let _ = Application::new("probe")
                    .plugins([Plugin::new("@acme/trace")
                        .option("trace", Opt::boolean().aliases(["tail"]))])
                    .command(
                        Command::new("get")
                            .option("tail", Opt::string())
                            .action(act),
                    );
            }),
            expected(
                "spelling-taken",
                "Option spelling \"--tail\" is used by plugin \"@acme/trace\" option \"trace\" and the local option \"tail\" on Command \"get\".",
                CHANGE_ONE,
            ),
        ),
        (
            "plugin-global-key",
            Box::new(|| {
                let _ = Application::new("probe")
                    .plugins([Plugin::new("@acme/trace").option("verbose", Opt::boolean())])
                    .global_option("verbose", Opt::boolean());
            }),
            expected(
                "option-declared-twice",
                "Option \"verbose\" is declared by plugin \"@acme/trace\" and as a global option.",
                "Rename one declaration.",
            ),
        ),
        (
            "plugin-local-spelling",
            Box::new(|| {
                let _ = Application::new("probe")
                    .plugins(
                        [Plugin::new("@acme/trace").option("trace", Opt::boolean().short('t'))],
                    )
                    .command(
                        Command::new("get")
                            .option("tail", Opt::string().short('t'))
                            .action(act),
                    );
            }),
            expected(
                "spelling-taken",
                "Option spelling \"-t\" is used by plugin \"@acme/trace\" option \"trace\" and the local option \"tail\" on Command \"get\".",
                CHANGE_ONE,
            ),
        ),
        (
            "plugins-alias-spelling",
            Box::new(|| {
                let _ = Application::new("probe").plugins([
                    Plugin::new("@acme/log").option("level", Opt::string().aliases(["verbosity"])),
                    Plugin::new("@acme/trace").option("verbosity", Opt::boolean()),
                ]);
            }),
            expected(
                "spelling-taken",
                "Option spelling \"--verbosity\" is used by plugin \"@acme/log\" option \"level\" and plugin \"@acme/trace\" option \"verbosity\".",
                CHANGE_ONE,
            ),
        ),
        (
            "plugins-key",
            Box::new(|| {
                let _ = Application::new("probe").plugins([
                    Plugin::new("@acme/log").option("verbose", Opt::boolean()),
                    Plugin::new("@acme/trace")
                        .option("verbose", Opt::boolean().polarity(Polarity::Both)),
                ]);
            }),
            expected(
                "option-declared-twice",
                "Option \"verbose\" is declared by plugin \"@acme/log\" and plugin \"@acme/trace\".",
                "Install one of them or rename the option.",
            ),
        ),
    ];
    for (scenario, declare, parts) in cases {
        assert_eq!(fault(declare), parts, "{scenario}");
    }
}
