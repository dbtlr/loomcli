//! Ports `parse.test.ts`, `spellings.test.ts`, `rebind-classes.test.ts`, and the routing cases of
//! `commands.test.ts`: routing on global options, a parent's own options, short groups, held faults
//! and their precedence, and the usage failure text, end to end through `Application::run` on the
//! mock process.
//!
//! The reference's actions print the values validation produced; core's validation is a later
//! stage, so these actions print what the words supplied (`ctx.supplied`), which leaves out an
//! omitted Boolean's `false`. The reference reads a held fault's facts through a failure view; the
//! facts are asserted in `src/invocation/tests.rs`, and the bytes the default view writes here.

mod support;

use loomcli_core::{Application, Arg, Command, Done, NoInputs, NoResult, Opt, Polarity};
use serde_json::json;
use support::{Ran, assert_matches, dispatched, report, run, usage};

type App = Application<NoInputs, NoResult, Done>;

/// The contract's graph: global `--file`, `-f` and `--quiet`, `-q`, the help stand-in's global
/// `--help`, `-h`, a `get` with Boolean `-p` and `-r` and a string `-d`, a `keys` that shares `-r`,
/// a `cache` group whose `clear` declares `--force`, and a hidden and a deprecated Command whose
/// letters no listing shows.
fn kit() -> App {
    let get = Command::new("get")
        .argument("path", Arg::string().required())
        .option("pretty", Opt::boolean().short('p'))
        .option("raw", Opt::boolean().short('r'))
        .option("depth", Opt::string().short('d'))
        .action(report);
    let keys = Command::new("keys")
        .argument("path", Arg::string())
        .option("raw", Opt::boolean().short('r'))
        .action(report);
    let cache = Command::new("cache")
        .command(
            Command::new("clear")
                .option("force", Opt::boolean())
                .action(report),
        )
        .command(Command::new("list").action(report));
    let debug = Command::new("debug")
        .hidden()
        .option("xray", Opt::boolean().short('x'))
        .action(report);
    let fetch = Command::new("fetch")
        .deprecated("Use get instead.")
        .option("yank", Opt::boolean().short('y'))
        .action(report);
    let old = Command::new("old")
        .deprecated("Use cache instead.")
        .command(
            Command::new("sub")
                .option("xenon", Opt::boolean().short('x'))
                .action(report),
        );
    Application::new("kit")
        .global_option("help", Opt::boolean().short('h'))
        .global_option("file", Opt::string().short('f'))
        .global_option("quiet", Opt::boolean().short('q'))
        .command(get)
        .command(keys)
        .command(cache)
        .command(debug)
        .command(fetch)
        .command(old)
        .action(report)
}

/// A root with an action and children, and its own Boolean `-p`, root-only `--verbose`, and string
/// `-n`. Its child `get` declares `-p` alike, `-n` as a Boolean, and its own `-r`. The child `cache`
/// has an action and a child `list`, and both declare `--deep`; `list` declares `-p` too.
fn rooted() -> App {
    let get = Command::new("get")
        .argument("path", Arg::string())
        .option("pretty", Opt::boolean().short('p'))
        .option("raw", Opt::boolean().short('r'))
        .option("numbered", Opt::boolean().short('n'))
        .option("level", Opt::string())
        .option("dry", Opt::boolean())
        .action(report);
    let list = Command::new("list")
        .option("deep", Opt::boolean())
        .option("plain", Opt::boolean().short('p'))
        .action(report);
    let cache = Command::new("cache")
        .option("deep", Opt::boolean())
        .command(list)
        .action(report);
    Application::new("rooted")
        .global_option("help", Opt::boolean().short('h'))
        .global_option("quiet", Opt::boolean().short('q'))
        .option("pretty", Opt::boolean().short('p'))
        .option("verbose", Opt::boolean())
        .option("name", Opt::string().short('n'))
        .option("level", Opt::boolean())
        .option("dry", Opt::string())
        .command(get)
        .command(cache)
        .action(report)
}

const UNKNOWN: &str = "Supply a declared option; prefix a hyphenated path with \"./\".";

fn unknown(application: &str, spelling: &str) -> Ran {
    usage(&format!(
        "{application}: Unknown option \"{spelling}\". {UNKNOWN}"
    ))
}

#[tokio::test]
async fn a_short_group_mixes_a_global_letter_with_a_letter_of_the_routed_command() {
    let app = kit();
    assert_eq!(
        dispatched(&app, &["-f", "data.json", "get", "a.b", "-qp"]).await,
        json!({
            "args": { "path": "a.b" },
            "command": ["get"],
            "options": { "file": "data.json", "pretty": true, "quiet": true },
            "passthrough": [],
        })
    );
    assert_matches(
        &dispatched(&app, &["get", "-pq", "a.b"]).await,
        &json!({ "options": { "pretty": true, "quiet": true } }),
    );
}

#[tokio::test]
async fn routing_reads_global_options_between_command_names_and_a_value_wins_over_a_name() {
    let app = kit();
    assert_matches(
        &dispatched(&app, &["--file", "keys", "get", "name"]).await,
        &json!({ "args": { "path": "name" }, "command": ["get"], "options": { "file": "keys" } }),
    );
    assert_matches(
        &dispatched(&app, &["-q", "cache", "-f", "x", "clear", "--force"]).await,
        &json!({
            "command": ["cache", "clear"],
            "options": { "file": "x", "force": true, "quiet": true },
        }),
    );
}

#[tokio::test]
async fn a_global_value_letter_takes_the_rest_of_its_group_under_routing() {
    let app = kit();
    let fp = dispatched(&app, &["-fp", "get", "a.b"]).await;
    assert_eq!(fp["command"], json!(["get"]));
    assert_eq!(fp["options"], json!({ "file": "p" }));
    assert_matches(
        &dispatched(&app, &["-qf=data.json", "get", "a.b"]).await,
        &json!({ "options": { "file": "data.json", "quiet": true } }),
    );
}

#[tokio::test]
async fn words_after_the_first_bare_delimiter_are_never_read() {
    assert_eq!(
        dispatched(&kit(), &["get", "a.b", "--", "-qp", "--file", "x"]).await,
        json!({
            "args": { "path": "a.b" },
            "command": ["get"],
            "options": {},
            "passthrough": ["-qp", "--file", "x"],
        })
    );
}

#[tokio::test]
async fn an_option_word_that_stops_routing_names_the_commands_below_that_declare_it() {
    let app = kit();
    assert_eq!(
        run(&app, &["-qp", "--file", "data.json", "get", "a.b"]).await,
        usage("kit: Option \"-p\" belongs to command \"get\". Supply it after \"get\".")
    );
    assert_eq!(
        run(&app, &["-r", "get", "a.b"]).await,
        usage(
            "kit: Option \"-r\" belongs to commands get, keys. Supply it after the command name."
        )
    );
    assert_eq!(
        run(&app, &["cache", "--force", "clear"]).await,
        usage(
            "kit: Option \"--force\" belongs to command \"cache clear\". Supply it after \"cache clear\"."
        )
    );
}

#[tokio::test]
async fn an_option_no_visible_command_below_declares_is_unknown() {
    let app = kit();
    for (argv, spelling) in [
        (&["-x", "debug"][..], "-x"),
        (&["-y", "fetch"], "-y"),
        (&["-z", "get", "a.b"], "-z"),
        (&["cache", "--verbose"], "--verbose"),
        (&["get", "a.b", "-pz"], "-z"),
        (&["get", "a.b", "-pé"], "-é"),
    ] {
        assert_eq!(run(&app, argv).await, unknown("kit", spelling), "{argv:?}");
    }
}

#[tokio::test]
async fn routing_reads_a_parents_own_option_and_carries_on_to_the_child_which_receives_it() {
    let app = rooted();
    assert_eq!(
        dispatched(&app, &["-p", "get", "a.b"]).await,
        json!({
            "args": { "path": "a.b" },
            "command": ["get"],
            "options": { "pretty": true },
            "passthrough": [],
        })
    );
    assert_matches(
        &dispatched(&app, &["-p"]).await,
        &json!({ "command": [], "options": { "pretty": true } }),
    );
    assert_matches(
        &dispatched(&app, &["-pq", "get", "-r"]).await,
        &json!({ "command": ["get"], "options": { "pretty": true, "quiet": true, "raw": true } }),
    );
}

#[tokio::test]
async fn a_parents_own_option_reaches_the_command_routing_reaches_at_every_depth() {
    let app = rooted();
    assert_matches(
        &dispatched(&app, &["-p", "cache", "--deep", "list"]).await,
        &json!({ "command": ["cache", "list"], "options": { "deep": true, "plain": true } }),
    );
    assert_matches(
        &dispatched(&app, &["cache", "--deep"]).await,
        &json!({ "command": ["cache"], "options": { "deep": true } }),
    );
}

#[tokio::test]
async fn a_parents_own_option_the_routed_command_does_not_declare_is_an_unknown_option() {
    let app = rooted();
    assert_eq!(
        run(&app, &["--verbose", "get", "a.b"]).await,
        unknown("rooted", "--verbose")
    );
    // The parent's option precedes the later global fault in word order, so it is the one held.
    assert_eq!(
        run(&app, &["--verbose", "--quiet=1", "get", "a.b"]).await,
        unknown("rooted", "--verbose")
    );
}

#[tokio::test]
async fn a_value_class_the_routed_command_declares_differently_is_misplaced() {
    let misplaced = |spelling: &str| {
        usage(&format!(
            "rooted: Option \"{spelling}\" belongs to command \"get\". Supply it after \"get\"."
        ))
    };
    let app = rooted();
    assert_eq!(run(&app, &["-n", "x", "get", "a.b"]).await, misplaced("-n"));
    // A parent's own option that faulted under its declaration is misplaced when the routed
    // Command declares another class.
    assert_eq!(
        run(&app, &["--level=3", "get", "a.b"]).await,
        misplaced("--level")
    );
    assert_eq!(
        run(&app, &["--dry", "-q", "get", "a.b"]).await,
        misplaced("--dry")
    );
    assert_eq!(
        run(&app, &["--dry", "-q", "--quiet=1", "get", "a.b"]).await,
        misplaced("--dry")
    );
    // The same class keeps the fault the parent's declaration found.
    assert_eq!(
        run(&app, &["--pretty=1", "get", "a.b"]).await,
        usage(
            "rooted: Boolean option \"--pretty\" does not accept a value. Supply the flag alone."
        )
    );
    assert_eq!(
        run(&app, &["--verbose=1", "get", "a.b"]).await,
        unknown("rooted", "--verbose")
    );
}

#[tokio::test]
async fn a_plain_word_after_a_parents_own_option_that_names_no_child_is_the_unknown_command() {
    assert_eq!(
        run(&rooted(), &["-p", "nope"]).await,
        usage("rooted: Unknown command \"nope\". Use one of: get, cache.")
    );
}

#[tokio::test]
async fn an_option_word_the_routed_commands_table_lacks_is_misplaced_wherever_routing_stopped() {
    assert_eq!(
        run(&rooted(), &["-p", "-r", "get"]).await,
        usage("rooted: Option \"-r\" belongs to command \"get\". Supply it after \"get\".")
    );
}

#[tokio::test]
async fn a_deprecated_group_hides_the_letters_below_it_until_routing_reaches_it() {
    let app = kit();
    assert_eq!(run(&app, &["-x", "old", "sub"]).await, unknown("kit", "-x"));
    assert_eq!(
        run(&app, &["old", "-x", "sub"]).await,
        usage("kit: Option \"-x\" belongs to command \"old sub\". Supply it after \"old sub\".")
    );
}

#[tokio::test]
async fn a_repeated_letter_ends_its_walk_so_routing_never_reads_the_letters_after_it() {
    let app = kit();
    let repeated = |spelling: &str| {
        usage(&format!(
            "kit: Option \"{spelling}\" can be supplied only once. Remove the repeated option."
        ))
    };
    assert_eq!(
        run(&app, &["-q", "-qp", "get", "a.b"]).await,
        repeated("-q")
    );
    assert_eq!(run(&app, &["-qqp", "get", "a.b"]).await, repeated("-q"));
    assert_eq!(
        run(&app, &["get", "a.b", "-p", "-ph"]).await,
        repeated("-p")
    );
}

#[tokio::test]
async fn an_unknown_command_is_raised_before_the_chain() {
    let app = kit();
    assert_eq!(
        run(&app, &["nope", "--help"]).await,
        usage("kit: Unknown command \"nope\". Use one of: get, keys, cache.")
    );
    assert_eq!(
        run(&app, &["cache", "nope", "-h"]).await,
        usage("kit: Unknown command \"nope\". Use one of: clear, list.")
    );
}

#[tokio::test]
async fn a_structural_fault_on_a_global_option_is_held_and_routing_continues_past_it() {
    let app = kit();
    assert_eq!(
        run(&app, &["--file"]).await,
        usage("kit: Option \"--file\" requires a value. Supply a value after \"--file\".")
    );
    assert_eq!(
        run(&app, &["--file", "-q", "get", "a.b"]).await,
        usage(
            "kit: Option \"--file\" requires a value. Supply a value after \"--file\", or attach one that starts with a hyphen as \"--file=<value>\"."
        )
    );
    assert_eq!(
        run(&app, &["get", "a.b", "-f", "--"]).await,
        usage(
            "kit: Option \"-f\" requires a value. Supply a value after \"-f\", or attach one that starts with a hyphen as \"-f=<value>\"."
        )
    );
    assert_eq!(
        run(&app, &["--quiet=1", "get", "a.b"]).await,
        usage("kit: Boolean option \"--quiet\" does not accept a value. Supply the flag alone.")
    );
    assert_eq!(
        run(
            &app,
            &["--file", "one.json", "get", "a.b", "-f", "two.json"]
        )
        .await,
        usage("kit: Option \"-f\" can be supplied only once. Remove the repeated option.")
    );
}

#[tokio::test]
async fn a_faulted_occurrence_supplies_nothing_and_the_letters_after_a_faulted_letter_are_not_read()
{
    let app = kit();
    assert_eq!(
        run(&app, &["--help=x"]).await,
        usage("kit: Boolean option \"--help\" does not accept a value. Supply the flag alone.")
    );
    assert_eq!(run(&app, &["-xh"]).await, unknown("kit", "-x"));
    assert_eq!(
        run(&app, &["get", "a.b", "-ph=1"]).await,
        usage("kit: Boolean option \"-h\" does not accept a value. Supply the flag alone.")
    );
}

#[tokio::test]
async fn the_first_structural_fault_in_word_order_is_held() {
    let app = kit();
    assert_eq!(
        run(&app, &["get", "a.b", "extra", "--nope"]).await,
        usage("kit: Command \"get\" accepts 1 argument. Remove the extra values.")
    );
    assert_eq!(
        run(&app, &["get", "a.b", "--nope", "extra"]).await,
        unknown("kit", "--nope")
    );
    assert_eq!(
        run(&app, &["get", "--nope"]).await,
        unknown("kit", "--nope")
    );
}

#[tokio::test]
async fn a_groups_missing_subcommand_ranks_after_every_structural_fault() {
    let app = kit();
    let missing = usage("kit: Command \"cache\" requires a subcommand. Use one of: clear, list.");
    assert_eq!(run(&app, &["cache"]).await, missing);
    assert_eq!(run(&app, &["cache", "-q"]).await, missing);
    assert_eq!(
        run(&app, &["cache", "--verbose"]).await,
        unknown("kit", "--verbose")
    );
}

/// `spellings.test.ts`: one spelling per Command, each reading its own value shape.
fn spellings() -> App {
    Application::new("spellings")
        .global_option("file", Opt::string().short('f'))
        .command(
            Command::new("select")
                .option("field", Opt::string().multiple().short('F'))
                .action(report),
        )
        .command(
            Command::new("count")
                .option("field", Opt::boolean().polarity(Polarity::Both).short('F'))
                .action(report),
        )
        .command(
            Command::new("cache").command(
                Command::new("set")
                    .option("field", Opt::string().short('F'))
                    .action(report),
            ),
        )
        .action(report)
}

#[tokio::test]
async fn one_spelling_reads_its_own_value_shape() {
    let app = spellings();
    for (argv, command, options) in [
        (
            &["select", "--field", "a", "-F", "b"][..],
            json!(["select"]),
            json!({ "field": ["a", "b"] }),
        ),
        // The supplied record holds the omitted multiple option as an empty list.
        (&["select"], json!(["select"]), json!({ "field": [] })),
        (
            &["count", "--field"],
            json!(["count"]),
            json!({ "field": true }),
        ),
        (
            &["count", "--no-field"],
            json!(["count"]),
            json!({ "field": false }),
        ),
        (&["count", "-F"], json!(["count"]), json!({ "field": true })),
        (&["count"], json!(["count"]), json!({})),
        (
            &["cache", "set", "-F", "x"],
            json!(["cache", "set"]),
            json!({ "field": "x" }),
        ),
        (&["cache", "set"], json!(["cache", "set"]), json!({})),
    ] {
        assert_eq!(
            dispatched(&app, argv).await,
            json!({ "args": {}, "command": command, "options": options, "passthrough": [] }),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn the_global_alias_and_a_local_alias_of_the_same_letter_case_stay_separate() {
    let app = spellings();
    assert_eq!(
        dispatched(&app, &["select", "-F", "a", "-f", "doc.json", "-F", "b"]).await["options"],
        json!({ "file": "doc.json", "field": ["a", "b"] })
    );
    assert_eq!(
        dispatched(&app, &["-f", "doc.json", "cache", "set", "--field=x"]).await["options"],
        json!({ "file": "doc.json", "field": "x" })
    );
}

#[tokio::test]
async fn an_option_word_no_global_option_declares_ends_routing_and_names_the_commands_that_declare_it()
 {
    let app = spellings();
    assert_eq!(
        run(&app, &["count", "--field", "select"]).await,
        usage("spellings: Command \"count\" accepts no arguments. Remove the supplied values.")
    );
    assert_eq!(
        run(&app, &["--field", "name", "select"]).await,
        usage(
            "spellings: Option \"--field\" belongs to commands select, count, cache set. Supply it after the command name."
        )
    );
    assert_eq!(
        run(&app, &["cache", "--field", "x"]).await,
        usage(
            "spellings: Option \"--field\" belongs to command \"cache set\". Supply it after \"cache set\"."
        )
    );
}

#[tokio::test]
async fn a_sibling_shape_never_accepts_another_commands_spelling() {
    let app = spellings();
    for (argv, spelling) in [
        (&["select", "--no-field"][..], "\"--no-field\""),
        (&["count", "--field=true"], "\"--field\""),
        (&["cache", "set", "--no-field"], "\"--no-field\""),
        (&["select", "-F"], "\"-F\""),
    ] {
        let ran = run(&app, argv).await;
        assert_eq!(ran.status, 2, "{argv:?}");
        assert_eq!(ran.stdout, "");
        assert!(ran.stderr.contains(spelling), "{argv:?}: {}", ran.stderr);
    }
}

/// `rebind-classes.test.ts`: a root that declares one option of each value class, and a child of
/// each class that declares every spelling as that class.
fn rebind() -> App {
    #[derive(Clone, Copy)]
    enum Class {
        Boolean,
        Count,
        Implied,
        Separate,
    }
    fn declare(name: &str, class: Class, implied: &str) -> loomcli_core::OptionDecl {
        let short = name.chars().next().unwrap_or('x');
        match class {
            Class::Boolean => Opt::boolean().short(short).into(),
            Class::Count => Opt::count().short(short).into(),
            Class::Implied => Opt::string().implied(implied).short(short).into(),
            Class::Separate => Opt::string().short(short).into(),
        }
    }
    let classes = [
        ("boolean", Class::Boolean),
        ("count", Class::Count),
        ("implied", Class::Implied),
        ("separate", Class::Separate),
    ];
    let child = |kind: &str, class: Class| {
        classes
            .iter()
            .fold(
                Command::new(kind).argument("path", Arg::string()),
                |child, (name, _)| child.option(name, declare(name, class, "child")),
            )
            .action(report)
    };
    let root = Application::new("rebind")
        .option("boolean", declare("boolean", Class::Boolean, "parent"))
        .option("count", declare("count", Class::Count, "parent"))
        .option("implied", declare("implied", Class::Implied, "parent"))
        .option("separate", declare("separate", Class::Separate, "parent"));
    let mut app = root.command(child("boolean", Class::Boolean));
    for (kind, class) in &classes[1..] {
        app = app.command(child(kind, *class));
    }
    app.action(report)
}

/// The words that supply the root's own option of one class before a child's name.
fn supplied(kind: &str) -> Vec<String> {
    if kind == "separate" {
        vec!["--separate".to_owned(), "x".to_owned()]
    } else {
        vec![format!("--{kind}")]
    }
}

#[tokio::test]
async fn a_parents_own_option_rebinds_to_the_childs_option_of_the_same_value_class() {
    let app = rebind();
    for (kind, bound) in [
        ("boolean", json!(true)),
        ("count", json!(1)),
        // A rebound bare spelling supplies the implied value of the option it binds.
        ("implied", json!("child")),
        ("separate", json!("x")),
    ] {
        let mut argv = supplied(kind);
        argv.extend([kind.to_owned(), "a".to_owned()]);
        let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
        assert_matches(
            &dispatched(&app, &argv).await,
            &json!({ "args": { "path": "a" }, "command": [kind], "options": { kind: bound } }),
        );
    }
}

#[tokio::test]
async fn a_parents_own_option_is_misplaced_before_a_child_that_declares_another_value_class() {
    let app = rebind();
    let kinds = ["boolean", "count", "implied", "separate"];
    for parent in kinds {
        for child in kinds.into_iter().filter(|child| *child != parent) {
            let mut argv = supplied(parent);
            argv.extend([child.to_owned(), "a".to_owned()]);
            let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
            assert_eq!(
                run(&app, &argv).await,
                usage(&format!(
                    "rebind: Option \"--{parent}\" belongs to command \"{child}\". Supply it after \"{child}\"."
                )),
                "{argv:?}"
            );
        }
    }
}

/// `commands.test.ts`' graph: global `--file`, `-f` and `--quiet`, `-q`, the root's own `-p`, a
/// `get` with a required argument and `-r`, and a `keys` with neither.
fn jsonkit() -> App {
    Application::new("jsonkit")
        .global_option("file", Opt::string().short('f'))
        .global_option("quiet", Opt::boolean().short('q'))
        .option("pretty", Opt::boolean().short('p'))
        .command(
            Command::new("get")
                .argument("path", Arg::string().required())
                .option("raw", Opt::boolean().short('r'))
                .action(report),
        )
        .command(Command::new("keys").action(report))
        .action(report)
}

#[tokio::test]
async fn routes_each_invocation_to_its_command_with_the_global_and_local_values() {
    let app = jsonkit();
    for (argv, command, args, options) in [
        (
            &["--file", "data.json"][..],
            json!([]),
            json!({}),
            json!({ "file": "data.json" }),
        ),
        (
            &["--file", "data.json", "get", "a.b"],
            json!(["get"]),
            json!({ "path": "a.b" }),
            json!({ "file": "data.json" }),
        ),
        (
            &["--file", "data.json", "keys"],
            json!(["keys"]),
            json!({}),
            json!({ "file": "data.json" }),
        ),
    ] {
        assert_eq!(
            dispatched(&app, argv).await,
            json!({ "args": args, "command": command, "options": options, "passthrough": [] })
        );
    }
}

#[tokio::test]
async fn accepts_a_global_before_between_or_after_routing() {
    let app = jsonkit();
    for argv in [
        &["--file", "data.json", "get", "a.b"][..],
        &["get", "--file", "data.json", "a.b"],
        &["get", "a.b", "--file", "data.json"],
        &["get", "a.b", "--file=data.json"],
        &["-f", "data.json", "get", "a.b"],
    ] {
        assert_eq!(
            dispatched(&app, argv).await,
            json!({
                "args": { "path": "a.b" },
                "command": ["get"],
                "options": { "file": "data.json" },
                "passthrough": [],
            }),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn consumes_an_all_global_short_group_and_leaves_local_letters_to_the_command() {
    let app = jsonkit();
    let expected = json!({
        "args": { "path": "a.b" },
        "command": ["get"],
        "options": { "file": "data.json", "quiet": true, "raw": true },
        "passthrough": [],
    });
    assert_eq!(
        dispatched(&app, &["-qf", "data.json", "get", "-r", "a.b"]).await,
        expected
    );
    // A local option is accepted strictly after its own argument.
    assert_eq!(
        dispatched(&app, &["-qf", "data.json", "get", "a.b", "-r"]).await,
        expected
    );
}

#[tokio::test]
async fn a_local_option_on_a_root_with_children_commits_to_the_root_action() {
    assert_eq!(
        dispatched(&jsonkit(), &["--file", "data.json", "--pretty"]).await,
        json!({
            "args": {},
            "command": [],
            "options": { "file": "data.json", "pretty": true },
            "passthrough": [],
        })
    );
}

#[tokio::test]
async fn a_global_value_wins_over_a_token_that_also_names_a_child() {
    assert_eq!(
        dispatched(&jsonkit(), &["--file", "keys", "get", "name"]).await,
        json!({
            "args": { "path": "name" },
            "command": ["get"],
            "options": { "file": "keys" },
            "passthrough": [],
        })
    );
}

#[tokio::test]
async fn words_after_the_first_bare_delimiter_are_never_read_as_global_options() {
    assert_eq!(
        dispatched(
            &jsonkit(),
            &[
                "--file",
                "data.json",
                "get",
                "a.b",
                "--",
                "--file",
                "other",
                "-qf"
            ]
        )
        .await,
        json!({
            "args": { "path": "a.b" },
            "command": ["get"],
            "options": { "file": "data.json" },
            "passthrough": ["--file", "other", "-qf"],
        })
    );
}

#[tokio::test]
async fn rejects_each_structural_fault_without_dispatch() {
    let app = jsonkit();
    for (argv, reason) in [
        (
            &["--file", "data.json", "nope"][..],
            "Unknown command \"nope\". Use one of: get, keys.".to_owned(),
        ),
        (
            &["--file", "data.json", "-r", "get", "a.b"],
            "Option \"-r\" belongs to command \"get\". Supply it after \"get\".".to_owned(),
        ),
        // The root's own -p carries routing on to get, which does not declare it.
        (
            &["--file", "data.json", "-p", "get", "a.b"],
            format!("Unknown option \"-p\". {UNKNOWN}"),
        ),
        (
            &["--file", "data.json", "get", "a.b", "c.d"],
            "Command \"get\" accepts 1 argument. Remove the extra values.".to_owned(),
        ),
        (
            &["--file", "data.json", "keys", "extra"],
            "Command \"keys\" accepts no arguments. Remove the supplied values.".to_owned(),
        ),
        (
            &["--file", "one.json", "get", "a.b", "-f", "two.json"],
            "Option \"-f\" can be supplied only once. Remove the repeated option.".to_owned(),
        ),
        (
            &["-qp", "--file", "data.json", "get", "a.b"],
            format!("Unknown option \"-p\". {UNKNOWN}"),
        ),
        (
            &["-qZ", "--file", "data.json", "get", "a.b"],
            format!("Unknown option \"-Z\". {UNKNOWN}"),
        ),
        (
            &["--file", "data.json", "get", "--pretty", "a.b"],
            format!("Unknown option \"--pretty\". {UNKNOWN}"),
        ),
        (
            &["--file"],
            "Option \"--file\" requires a value. Supply a value after \"--file\".".to_owned(),
        ),
        // The missing value is held, and routing continues to the unknown command, which ranks
        // first.
        (
            &["--file", "--quiet", "nope"],
            "Unknown command \"nope\". Use one of: get, keys.".to_owned(),
        ),
    ] {
        assert_eq!(
            run(&app, argv).await,
            usage(&format!("jsonkit: {reason}")),
            "{argv:?}"
        );
    }
}
