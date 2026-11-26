//! Ports the run cases of `nested.test.ts` and `hidden.test.ts`, the run-time default text of
//! `failures.test.ts`, the action part of `exit-codes.test.ts`, and the authoring receivers of
//! `commands.test.ts`: routing at depth and through aliases, hidden and deprecated Commands, the
//! routing failures' candidates, and the failure path a run writes, end to end through
//! `Application::run` on the mock process.

mod support;

use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Build, Command, Context, Done, EX_UNAVAILABLE, Failure, FatalError, Group,
    LoomError, NoInputs, NoResult, Opt, Outcome, ReleaseFacts, RunOptions,
};
use loomcli_testing::{MockFields, mock_process};
use serde_json::json;
use support::{Ran, assert_matches, dispatched, report, run, usage};

type App = Application<NoInputs, NoResult, Done>;

/// `nested.test.ts`' graph: a `cache` group (alias `c`) of `clear` and `list` (aliases `ls`, `l`),
/// and a `store` with an action and a child `put` that spends `ls` in its own namespace.
fn nested() -> App {
    let clear = Command::new("clear")
        .option("force", Opt::boolean().short('F'))
        .action(report);
    let list = Command::new("list").alias("ls").alias("l").action(report);
    let cache = Command::new("cache")
        .alias("c")
        .command(clear)
        .command(list);
    let put = Command::new("put").alias("ls").action(report);
    let store = Command::new("store")
        .option("pretty", Opt::boolean().short('p'))
        .command(put)
        .action(report);
    Application::new("nested")
        .global_option("file", Opt::string().short('f'))
        .command(cache)
        .command(store)
        .action(report)
}

#[tokio::test]
async fn routes_each_nested_invocation_to_its_command() {
    let app = nested();
    for (argv, command, options) in [
        (
            &["cache", "clear"][..],
            json!(["cache", "clear"]),
            json!({}),
        ),
        (
            &["cache", "clear", "--force"],
            json!(["cache", "clear"]),
            json!({ "force": true }),
        ),
        (
            &["cache", "clear", "-F"],
            json!(["cache", "clear"]),
            json!({ "force": true }),
        ),
        (&["cache", "list"], json!(["cache", "list"]), json!({})),
        (&["store", "put"], json!(["store", "put"]), json!({})),
        // An alias routes like the canonical name, and the path reports that name alone.
        (&["cache", "ls"], json!(["cache", "list"]), json!({})),
        (&["cache", "l"], json!(["cache", "list"]), json!({})),
        (&["c", "list"], json!(["cache", "list"]), json!({})),
        (&["c", "ls"], json!(["cache", "list"]), json!({})),
        (
            &["c", "clear", "--force"],
            json!(["cache", "clear"]),
            json!({ "force": true }),
        ),
        // One alias namespace belongs to one parent, so two parents each spend "ls" on a child.
        (&["store", "ls"], json!(["store", "put"]), json!({})),
        // The action of the Command the words select runs, children and all.
        (&[], json!([]), json!({})),
        (&["store"], json!(["store"]), json!({})),
        (
            &["store", "--pretty"],
            json!(["store"]),
            json!({ "pretty": true }),
        ),
    ] {
        let mut words = vec!["--file", "data.json"];
        words.extend(argv);
        let mut expected = json!({ "file": "data.json" });
        if let (Some(expected), Some(options)) = (expected.as_object_mut(), options.as_object()) {
            expected.extend(options.clone());
        }
        assert_eq!(
            dispatched(&app, &words).await,
            json!({ "args": {}, "command": command, "options": expected, "passthrough": [] }),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn rejects_each_nested_invocation_that_cannot_dispatch() {
    let app = nested();
    let unknown = "Supply a declared option; prefix a hyphenated path with \"./\".";
    for (argv, reason) in [
        (
            &["c"][..],
            "Command \"cache\" requires a subcommand. Use one of: clear, list.".to_owned(),
        ),
        (
            &["cache"],
            "Command \"cache\" requires a subcommand. Use one of: clear, list.".to_owned(),
        ),
        (
            &["cache", "nope"],
            "Unknown command \"nope\". Use one of: clear, list.".to_owned(),
        ),
        (
            &["c", "nope"],
            "Unknown command \"nope\". Use one of: clear, list.".to_owned(),
        ),
        (
            &["cache", "ls", "extra"],
            "Command \"list\" accepts no arguments. Remove the supplied values.".to_owned(),
        ),
        // A structural fault ranks ahead of the missing subcommand.
        (
            &["cache", "--verbose"],
            format!("Unknown option \"--verbose\". {unknown}"),
        ),
        (
            &["cache", "-v"],
            format!("Unknown option \"-v\". {unknown}"),
        ),
        (
            &["cache", "list", "--force"],
            format!("Unknown option \"--force\". {unknown}"),
        ),
        (
            &["cache", "clear", "extra"],
            "Command \"clear\" accepts no arguments. Remove the supplied values.".to_owned(),
        ),
    ] {
        assert_eq!(
            run(&app, argv).await,
            usage(&format!("nested: {reason}")),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_command_three_levels_below_the_root_routes_and_runs() {
    let app = Application::new("deep").command(
        Command::new("one")
            .command(Command::new("two").command(Command::new("three").action(report))),
    );
    assert_eq!(
        dispatched(&app, &["one", "two", "three"]).await["command"],
        json!(["one", "two", "three"])
    );
}

/// A root group: no action of its own, with `get` and `keys` below it.
fn nested_root() -> Application<NoInputs, NoResult, Group> {
    Application::new("nested-root")
        .global_option("file", Opt::string().short('f'))
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .action(report),
        )
        .command(Command::new("keys").action(report))
}

#[tokio::test]
async fn a_root_group_dispatches_the_child_a_bare_token_selects() {
    assert_eq!(
        dispatched(&nested_root(), &["--file", "data.json", "get", "a.b"]).await,
        json!({
            "args": { "path": "a.b" },
            "command": ["get"],
            "options": { "file": "data.json" },
            "passthrough": [],
        })
    );
}

#[tokio::test]
async fn rejects_each_root_group_invocation_that_names_no_command() {
    let app = nested_root();
    for (argv, reason) in [
        (&[][..], "A command is required. Use one of: get, keys."),
        (
            &["--verbose"],
            "Unknown option \"--verbose\". Supply a declared option; prefix a hyphenated path with \"./\".",
        ),
        (
            &["--file", "data.json"],
            "A command is required. Use one of: get, keys.",
        ),
    ] {
        assert_eq!(
            run(&app, argv).await,
            usage(&format!("nested-root: {reason}")),
            "{argv:?}"
        );
    }
}

/// Prints the routed Command's name alone.
async fn name(ctx: Context) -> Outcome {
    let name = ctx.command.name.clone().unwrap_or_default();
    ctx.out.print(&name).await
}

/// `hidden.test.ts`' graph: hidden and deprecated Commands at the root and below, and a group whose
/// children are all hidden or deprecated.
fn hidden() -> App {
    let cache = Command::new("cache")
        .command(Command::new("clear").action(name))
        .command(Command::new("trace").hidden().action(name))
        .command(
            Command::new("purge")
                .deprecated("Use clear instead.")
                .action(name),
        );
    let secrets = Command::new("secrets")
        .command(Command::new("dump").hidden().action(name))
        .command(
            Command::new("leak")
                .deprecated("Use dump instead.")
                .action(name),
        );
    Application::new("hidden")
        .global_option("file", Opt::string().short('f'))
        .command(cache)
        .command(
            Command::new("legacy")
                .deprecated("Use cache instead.")
                .action(name),
        )
        .command(secrets)
        .command(Command::new("debug").hidden().action(name))
        .action(name)
}

#[tokio::test]
async fn a_hidden_or_deprecated_command_routes_and_runs_like_any_other() {
    let app = hidden();
    for (argv, printed) in [
        (&["debug"][..], "debug"),
        (&["cache", "trace"], "trace"),
        (&["secrets", "dump"], "dump"),
        (&["legacy"], "legacy"),
        (&["cache", "purge"], "purge"),
        (&["secrets", "leak"], "leak"),
    ] {
        assert_eq!(
            run(&app, argv).await,
            Ran {
                status: 0,
                stdout: format!("{printed}\n"),
                stderr: String::new(),
            },
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn a_routing_failure_offers_the_visible_current_children_alone() {
    let app = hidden();
    assert_eq!(
        run(&app, &["nope"]).await,
        usage("hidden: Unknown command \"nope\". Use one of: cache, secrets.")
    );
    assert_eq!(
        run(&app, &["cache"]).await,
        usage("hidden: Command \"cache\" requires a subcommand. Use one of: clear.")
    );
    // A group whose children are all hidden or deprecated offers none and names the fix.
    assert_eq!(
        run(&app, &["secrets"]).await,
        usage(
            "hidden: Command \"secrets\" requires a subcommand. Supply the name of a declared subcommand."
        )
    );
    assert_eq!(
        run(&app, &["secrets", "nope"]).await,
        usage("hidden: Unknown command \"nope\". Supply the name of a declared command.")
    );
}

#[tokio::test]
async fn a_root_group_says_a_command_is_required() {
    let current = Application::new("hidden")
        .global_option("file", Opt::string().short('f'))
        .command(Command::new("get").action(name))
        .command(Command::new("debug").hidden().action(name));
    assert_eq!(
        run(&current, &[]).await,
        usage("hidden: A command is required. Use one of: get.")
    );
    let root = Application::new("hidden")
        .global_option("file", Opt::string().short('f'))
        .command(Command::new("debug").hidden().action(name))
        .command(
            Command::new("legacy")
                .deprecated("Use debug instead.")
                .action(name),
        );
    assert_eq!(
        run(&root, &[]).await,
        usage("hidden: A command is required. Supply the name of a declared command.")
    );
}

/// `failures.test.ts`' graph: global `-f` and `-q`, a `get` with an argument and a string `-m`, and
/// a `cache` group of `keys`.
fn failures_app() -> App {
    Application::new("failures")
        .global_option("file", Opt::string().short('f'))
        .global_option("quiet", Opt::boolean().short('q'))
        .command(
            Command::new("get")
                .argument("path", Arg::string())
                .option("mode", Opt::string().short('m'))
                .action(report),
        )
        .command(Command::new("cache").command(Command::new("keys").action(report)))
        .action(report)
}

#[tokio::test]
async fn the_default_text_opens_a_usage_failure_with_the_application_name() {
    let app = failures_app();
    let unknown = "Supply a declared option; prefix a hyphenated path with \"./\".";
    for (argv, reason) in [
        (&["-f", "x", "nope"][..], "Unknown command \"nope\". Use one of: get, cache.".to_owned()),
        (
            &["-f", "x", "cache"],
            "Command \"cache\" requires a subcommand. Use one of: keys.".to_owned(),
        ),
        (
            &["-f", "x", "get", "a", "b"],
            "Command \"get\" accepts 1 argument. Remove the extra values.".to_owned(),
        ),
        (&["-f", "x", "--nope"], format!("Unknown option \"--nope\". {unknown}")),
        (
            &["-f"],
            "Option \"-f\" requires a value. Supply a value after \"-f\".".to_owned(),
        ),
        (
            &["-f", "x", "--quiet=1"],
            "Boolean option \"--quiet\" does not accept a value. Supply the flag alone.".to_owned(),
        ),
        (
            &["-f", "x", "-f", "y"],
            "Option \"-f\" can be supplied only once. Remove the repeated option.".to_owned(),
        ),
        (
            &["-f", "--quiet", "get", "a"],
            "Option \"-f\" requires a value. Supply a value after \"-f\", or attach one that starts with a hyphen as \"-f=<value>\".".to_owned(),
        ),
        (&["-qZ", "-f", "x"], format!("Unknown option \"-Z\". {unknown}")),
        (
            &["-qmhunter2", "-f", "x"],
            "Option \"-m\" belongs to command \"get\". Supply it after \"get\".".to_owned(),
        ),
    ] {
        assert_eq!(
            run(&app, argv).await,
            usage(&format!("failures: {reason}")),
            "{argv:?}"
        );
    }
}

#[tokio::test]
async fn the_default_text_escapes_a_right_to_left_override() {
    let app = failures_app();
    let unknown = "Supply a declared option; prefix a hyphenated path with \"./\".";
    assert_eq!(
        run(&app, &["a\u{202e}b"]).await,
        usage("failures: Unknown command \"a\\u202eb\". Use one of: get, cache.")
    );
    assert_eq!(
        run(&app, &["get", "x", "--a\u{202e}b"]).await,
        usage(
            "failures: Unknown option \"--a\\u202eb\". Supply a declared option, or pass it as an argument after \"--\"."
        )
    );
    assert_eq!(
        run(&app, &["-q\u{202e}"]).await,
        usage(&format!("failures: Unknown option \"-\\u202e\". {unknown}"))
    );
}

#[tokio::test]
async fn the_default_text_keeps_a_zero_width_joiner_inside_an_emoji_as_it_is() {
    let developer = "\u{1f469}\u{200d}\u{1f4bb}";
    assert_eq!(
        run(&failures_app(), &[developer]).await,
        usage(&format!(
            "failures: Unknown command \"{developer}\". Use one of: get, cache."
        ))
    );
}

/// A fatal failure that declares `EX_UNAVAILABLE`.
#[derive(Debug, Failure)]
#[failure(code = "registry-unavailable", exit_code = EX_UNAVAILABLE)]
struct RegistryError {
    #[failure(base)]
    base: FatalError,
}

/// A subclass of `RegistryError` that declares nothing.
#[derive(Debug, Failure)]
struct RegistryTimeoutError {
    #[failure(base)]
    base: RegistryError,
}

/// A `FatalError` subclass that declares nothing.
#[derive(Debug, Failure)]
struct ConfigError {
    #[failure(base)]
    base: FatalError,
}

/// A failure outside `UsageError` that declares 2.
#[derive(Debug, Failure)]
#[failure(code = "strict", exit_code = 2)]
struct StrictError {
    #[failure(base)]
    base: LoomError,
}

#[tokio::test]
async fn an_action_failure_exits_with_its_declared_code_and_writes_its_message() {
    let registry = Application::new("exits").action(|_: Context| async {
        Err(RegistryError {
            base: FatalError::new("The registry answered 503."),
        }
        .into())
    });
    assert_eq!(
        run(&registry, &[]).await,
        Ran {
            status: 69,
            stdout: String::new(),
            stderr: "The registry answered 503.\n".to_owned(),
        }
    );
    // A subclass that declares nothing exits with the nearest declared code.
    let inherited = Application::new("exits").action(|_: Context| async {
        Err(RegistryTimeoutError {
            base: RegistryError {
                base: FatalError::new("The registry answered 504."),
            },
        }
        .into())
    });
    assert_eq!(
        run(&inherited, &[]).await,
        Ran {
            status: 69,
            stdout: String::new(),
            stderr: "The registry answered 504.\n".to_owned(),
        }
    );
    // A FatalError subclass that declares nothing exits 1.
    let undeclared = Application::new("exits").action(|_: Context| async {
        Err(ConfigError {
            base: FatalError::new("Config is unreadable."),
        }
        .into())
    });
    assert_eq!(
        run(&undeclared, &[]).await,
        Ran {
            status: 1,
            stdout: String::new(),
            stderr: "Config is unreadable.\n".to_owned(),
        }
    );
    // A class that declares 2 outside UsageError takes no usage prefix.
    let strict = Application::new("exits").action(|_: Context| async {
        Err(StrictError {
            base: LoomError::new("Strict mode refused the value."),
        }
        .into())
    });
    assert_eq!(
        run(&strict, &[]).await,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "Strict mode refused the value.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn the_run_hands_the_resolved_exit_code_to_the_process_handle() {
    let process = mock_process(MockFields::new().argv(["nope"]));
    let code = failures_app()
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(code.get(), 2);
    assert_eq!(process.exit_code(), Some(code));
}

#[tokio::test]
async fn a_build_fault_exits_1_with_the_generic_message_in_a_distributed_build() {
    // A root with neither an action nor a child faults at build.
    let app = Application::new("broken").option("depth", Opt::string());
    let process = mock_process(MockFields::new().release(ReleaseFacts::new(Build::Distributed)));
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(code.get(), 1);
    assert_eq!(process.stdout_text(), "");
    assert_eq!(process.stderr_text(), "broken: Something went wrong.\n");
}

#[tokio::test]
async fn a_build_fault_shows_its_developer_diagnostic_in_a_development_build() {
    let app = Application::new("broken").option("depth", Opt::string());
    let ran = run(&app, &[]).await;
    assert_eq!(ran.status, 1);
    assert_eq!(ran.stdout, "");
    assert!(
        ran.stderr.contains("@loomcli/core/command-without-action"),
        "{}",
        ran.stderr
    );
}

#[tokio::test]
async fn an_unreadable_working_directory_fails_the_run_before_any_word_is_read() {
    let app = Application::new("cwd").action(report);
    let process = mock_process(
        MockFields::new()
            .argv(["nope"])
            .cwd_with(|| Err(std::io::Error::from(std::io::ErrorKind::NotFound))),
    );
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(code.get(), 1);
    assert_eq!(process.stdout_text(), "");
    assert_eq!(
        process.stderr_text(),
        "cwd: The current working directory cannot be read. Change to a directory that exists and run the command again.\n"
    );
}

/// `commands.test.ts`' authoring receivers: a later declaration on a copy leaves the receiver as
/// it was, and an alias routes like the canonical name.
#[tokio::test]
async fn a_receiver_keeps_only_the_declarations_made_on_it() {
    let base = Application::new("copies").global_option("quiet", Opt::boolean());
    let root = base.clone().action(report);
    assert_matches(
        &dispatched(&root, &["--quiet"]).await,
        &json!({ "args": {}, "command": [], "options": { "quiet": true } }),
    );
    assert_eq!(
        run(&root, &["get"]).await,
        usage("copies: The root Command accepts no arguments. Remove the supplied values.")
    );
    let forked = base
        .clone()
        .global_option("verbose", Opt::boolean())
        .action(report);
    assert_matches(
        &dispatched(&forked, &["--verbose"]).await,
        &json!({ "command": [], "options": { "verbose": true } }),
    );
    assert_eq!(
        run(&root, &["--verbose"]).await,
        usage(
            "copies: Unknown option \"--verbose\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
    let composed = base
        .command(
            Command::new("get")
                .argument("path", Arg::string().required())
                .action(report),
        )
        .action(report);
    assert_matches(
        &dispatched(&composed, &["get", "a.b"]).await,
        &json!({ "args": { "path": "a.b" }, "command": ["get"], "options": {} }),
    );
    assert_matches(
        &dispatched(&composed, &["--quiet"]).await,
        &json!({ "args": {}, "command": [], "options": { "quiet": true } }),
    );
    assert_eq!(
        run(&composed, &["--verbose"]).await,
        usage(
            "copies: Unknown option \"--verbose\". Supply a declared option; prefix a hyphenated path with \"./\"."
        )
    );
    let shared = Application::new("empty")
        .command(Command::new("leaf").action(report))
        .action(report);
    assert_matches(
        &dispatched(&shared, &[]).await,
        &json!({ "args": {}, "command": [], "options": {} }),
    );
    assert_matches(
        &dispatched(&shared, &["leaf"]).await,
        &json!({ "args": {}, "command": ["leaf"], "options": {} }),
    );
    let aliased = Application::new("aliased")
        .command(Command::new("keys").alias("ls").action(report))
        .action(report);
    assert_matches(
        &dispatched(&aliased, &["ls"]).await,
        &json!({ "args": {}, "command": ["keys"], "options": {} }),
    );
    let plain = Application::new("plain")
        .command(Command::new("keys").action(report))
        .action(report);
    assert_eq!(
        run(&plain, &["ls"]).await,
        usage("plain: Unknown command \"ls\". Use one of: keys.")
    );
}

/// The structural shape of the conformance corpus' `jsonkit`: global help, verbosity, and format
/// options, a root with an action and its own `--file`, and leaves and a nested group that each
/// declare `--file`. The plugins' Commands and hints belong to a later stage.
fn jsonkit() -> App {
    let leaf = |name: &str| Command::new(name).option("file", Opt::string().short('f'));
    Application::new("jsonkit")
        .global_option("help", Opt::boolean().short('h'))
        .global_option("verbose", Opt::count().short('v'))
        .global_option("format", Opt::string().short('o'))
        .option("file", Opt::string().short('f'))
        .command(
            leaf("get")
                .argument("path", Arg::string().required())
                .action(report),
        )
        .command(leaf("keys").argument("path", Arg::string()).action(report))
        .command(
            leaf("select")
                .option("field", Opt::string().multiple().required().short('F'))
                .action(report),
        )
        .command(
            Command::new("stats")
                .command(Command::new("depth").command(leaf("max").action(report))),
        )
        .action(report)
}

#[tokio::test]
async fn mirrors_the_first_line_of_the_jsonkit_usage_corpus() {
    let app = jsonkit();
    let unknown = "Supply a declared option; prefix a hyphenated path with \"./\".";
    let argument_correction = "Supply a declared option, or pass it as an argument after \"--\".";
    let cases: &[(&[&str], String)] = &[
        (&["typo"], "Unknown command \"typo\". Use one of: get, keys, select, stats.".into()),
        (
            &["get", "name", "x", "-f", "doc.json"],
            "Command \"get\" accepts 1 argument. Remove the extra values.".into(),
        ),
        (&["--bogus"], format!("Unknown option \"--bogus\". {unknown}")),
        (&["-x"], format!("Unknown option \"-x\". {unknown}")),
        (
            &["get", "name", "--json", "-f", "doc.json"],
            format!("Unknown option \"--json\". {argument_correction}"),
        ),
        (
            &["get", "--file"],
            "Option \"--file\" requires a value. Supply a value after \"--file\".".into(),
        ),
        (
            &["get", "name", "-f"],
            "Option \"-f\" requires a value. Supply a value after \"-f\".".into(),
        ),
        (
            &["get", "name", "-f", "--verbose"],
            "Option \"-f\" requires a value. Supply a value after \"-f\", or attach one that starts with a hyphen as \"-f=<value>\".".into(),
        ),
        (
            &["-f", "doc.json", "--format"],
            "Option \"--format\" requires a value. Supply a value after \"--format\".".into(),
        ),
        (
            &["-f", "doc.json", "--verbose=3"],
            "Counted option \"--verbose\" does not accept a value. Repeat \"--verbose\" to raise its count.".into(),
        ),
        (
            &["--help=yes"],
            "Boolean option \"--help\" does not accept a value. Supply the flag alone.".into(),
        ),
        (
            &["get", "name", "--file", "doc.json", "--file", "doc.json"],
            "Option \"--file\" can be supplied only once. Remove the repeated option.".into(),
        ),
        (
            &["get", "-f", "doc.json", "-f", "array.json", "name"],
            "Option \"-f\" can be supplied only once. Remove the repeated option.".into(),
        ),
        (
            &["-f", "doc.json", "-o", "json", "-o", "jsonl"],
            "Option \"-o\" can be supplied only once. Remove the repeated option.".into(),
        ),
        (
            &["stats", "--file", "doc.json", "depth", "max"],
            "Option \"--file\" belongs to command \"stats depth max\". Supply it after \"stats depth max\".".into(),
        ),
        (
            &["get", "a", "b", "-f", "doc.json"],
            "Command \"get\" accepts 1 argument. Remove the extra values.".into(),
        ),
        (
            &["extra", "-f", "doc.json"],
            "Unknown command \"extra\". Use one of: get, keys, select, stats.".into(),
        ),
        (
            &["-f", "doc.json", "get", "name", "extra"],
            "Command \"get\" accepts 1 argument. Remove the extra values.".into(),
        ),
        (
            &["keys", "a", "b", "-f", "doc.json"],
            "Command \"keys\" accepts 1 argument. Remove the extra values.".into(),
        ),
        (
            &["select", "-f", "doc.json", "--field"],
            "Option \"--field\" requires a value. Supply a value after \"--field\".".into(),
        ),
        (
            &["stats"],
            "Command \"stats\" requires a subcommand. Use one of: depth.".into(),
        ),
        (
            &["stats", "depth"],
            "Command \"depth\" requires a subcommand. Use one of: max.".into(),
        ),
        (
            &["stats", "-f", "doc.json"],
            "Option \"-f\" belongs to command \"stats depth max\". Supply it after \"stats depth max\".".into(),
        ),
        (
            &["get", "--bogus", "a", "b"],
            format!("Unknown option \"--bogus\". {argument_correction}"),
        ),
        (
            &["get", "name", "-vz", "-f", "doc.json"],
            format!("Unknown option \"-z\". {argument_correction}"),
        ),
    ];
    for (argv, line) in cases {
        let ran = run(&app, argv).await;
        assert_eq!(ran.status, 2, "{argv:?}");
        assert_eq!(ran.stdout, "", "{argv:?}");
        assert_eq!(
            ran.stderr.lines().next(),
            Some(format!("jsonkit: {line}").as_str()),
            "{argv:?}"
        );
    }
    assert_eq!(
        dispatched(&app, &["keys", "-f", "doc.json", "--", "--format"]).await["args"],
        json!({"path": "--format"})
    );
}

// automatic-globals.test.ts

#[tokio::test]
async fn an_independently_declared_command_receives_the_application_globals_and_their_outputs() {
    let read = Command::new("read")
        .argument("path", Arg::string().required())
        .option("raw", Opt::boolean())
        .action(support::values);
    let application = Application::new("example")
        .global_option("quiet", Opt::boolean())
        .global_option(
            "limit",
            Opt::string().validate(support::validators::Number("Supply a number.")),
        )
        .command(read);
    assert_eq!(
        run(
            &application,
            &["read", "document", "--raw", "--quiet", "--limit", "12"]
        )
        .await,
        Ran {
            status: 0,
            stdout: "{\"args\":{\"path\":\"document\"},\"options\":{\"quiet\":true,\"limit\":12,\"raw\":true}}\n"
                .to_owned(),
            stderr: String::new(),
        }
    );
}
