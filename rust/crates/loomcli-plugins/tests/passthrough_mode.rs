//! Ports the passthrough projections and service cases at v0.20.0.

#![cfg(all(
    feature = "completion",
    feature = "help",
    feature = "manifest",
    feature = "manpage",
    feature = "service"
))]
#![allow(clippy::unwrap_used, clippy::panic)]

use loomcli_core::{
    Application, Arg, Command, Context, InvocationOutcome, InvocationValues, InvokeOptions,
    Passthrough, locate,
};
use loomcli_plugins::{
    completion::test_support::answer, help::help, manifest::manifest,
    manpage::test_support::man_pages, service::service,
};
use loomcli_testing::{MockFields, mock_process};
use loomcli_validators::one_of;
use serde_json::{Value, json};

async fn project(enabled: bool, arguments: bool) {
    let mut app =
        Application::new(if arguments { "copy" } else { "forward" }).plugins((help(), manifest()));
    if arguments {
        app = app
            .argument("src", Arg::string().required().variadic())
            .argument("dest", Arg::string().required());
    }
    if enabled {
        let mode = if arguments {
            Passthrough::new().description("Words for the tool.")
        } else {
            Passthrough::new()
        };
        app = app.passthrough(mode);
    }
    let app = app.action(|_: Context| async { Ok(()) });
    let inspect = app.inspect().unwrap();
    let process = mock_process(MockFields::new());
    let help = app
        .invoke(
            &[],
            InvocationValues::new().option("help", true),
            InvokeOptions::new(),
            Some(process.clone()),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = help else {
        panic!("help failed: {help:?}");
    };
    if arguments {
        let usage = if enabled {
            "copy <src...> <dest> [options] [-- <args>...]"
        } else {
            "copy <src...> <dest> [options]"
        };
        assert!(output.contains(usage), "{output}");
        assert_eq!(output.contains("Words for the tool."), enabled);
    } else {
        assert_eq!(output.contains("ARGUMENTS\n  -- <args>..."), enabled);
    }
    assert_eq!(output.contains("[-- <args>...]"), enabled);

    let manifest = app
        .invoke(
            &[],
            InvocationValues::new().option("manifest", true),
            InvokeOptions::new(),
            Some(process),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = manifest else {
        panic!("manifest failed: {manifest:?}");
    };
    let document: Value = serde_json::from_str(&output).unwrap();
    let mode = if enabled && arguments {
        json!({"description": "Words for the tool."})
    } else if enabled {
        json!({"description": null})
    } else {
        Value::Null
    };
    assert_eq!(document["command"].get("passthrough"), Some(&mode));

    let pages = man_pages(&inspect).unwrap();
    let text = &pages[0].text;
    assert_eq!(text.contains(r"[\-\- <args>...]"), enabled);
    assert_eq!(text.contains(r"\-\- \fIargs\fR..."), enabled);
    assert_eq!(text.contains("Words for the tool."), enabled && arguments);
    assert_eq!(text.contains(".SH \"ARGUMENTS\""), enabled || arguments);
    if arguments {
        assert!(text.contains(r"\fBcopy\fR <src...> <dest> [options]"));
    }
}

#[tokio::test]
async fn help_man_pages_and_manifest_project_the_mode_with_arguments() {
    for enabled in [false, true] {
        project(enabled, true).await;
    }
}

#[tokio::test]
async fn help_man_pages_and_manifest_project_the_mode_without_arguments() {
    for enabled in [false, true] {
        project(enabled, false).await;
    }
}

#[test]
fn completion_after_the_delimiter_offers_argument_values() {
    let graph = Application::new("choose")
        .argument("name", Arg::string().validate(one_of(["alpha", "beta"])))
        .action(|_: Context| async { Ok(()) })
        .inspect()
        .unwrap();
    assert_eq!(answer(&graph, &locate(&graph, &["--", "a"])), "alpha\n:4\n");
}

#[test]
fn service_judges_every_run_word_after_the_delimiter() {
    for (words, valid) in [
        (&["convert", "--", "-in.txt"][..], true),
        (&["convert", "--", "-in.txt", "extra"][..], false),
        (&["forward", "--", "-in.txt", "extra"][..], true),
    ] {
        let app = Application::new("tool")
            .plugins((service("com.acme.tool", words.iter().copied()),))
            .command(
                Command::new("convert")
                    .argument("file", Arg::string())
                    .action(|_: Context| async { Ok(()) }),
            )
            .command(
                Command::new("forward")
                    .passthrough(Passthrough::new())
                    .action(|_: Context| async { Ok(()) }),
            );
        assert_eq!(app.check().is_empty(), valid, "{words:?}");
    }
}

async fn noop(_: Context) -> loomcli_core::Outcome {
    Ok(())
}

fn child(hidden: bool) -> loomcli_core::GroupCommand {
    let command = Command::new("completion").description("Print a script.");
    let command = if hidden { command.hidden() } else { command };
    command.command(Command::new("bash").action(noop))
}

#[test]
fn completion_can_offer_a_child_and_the_first_argument() {
    let reader = Application::new("textstat");
    let open = reader
        .clone()
        .argument("files", Arg::string().variadic())
        .command(child(false))
        .action(noop)
        .inspect()
        .unwrap();
    let closed = reader
        .argument(
            "files",
            Arg::string()
                .variadic()
                .validate(one_of(["codes", "notes"])),
        )
        .command(child(false))
        .action(noop)
        .inspect()
        .unwrap();
    for (graph, words, expected) in [
        (&open, &["co"][..], "completion\tPrint a script.\n:0\n"),
        (&open, &["a"][..], ":0\n"),
        (&open, &[""][..], "completion\tPrint a script.\n:0\n"),
        (&open, &["a.txt", "co"][..], ":0\n"),
        (&open, &["--", "co"][..], ":0\n"),
        (
            &closed,
            &["co"][..],
            "completion\tPrint a script.\ncodes\n:4\n",
        ),
        (&closed, &["n"][..], "notes\n:4\n"),
        (&closed, &["x"][..], ":4\n"),
    ] {
        assert_eq!(answer(graph, &locate(graph, words)), expected, "{words:?}");
    }
}

async fn help_of<I, R, S: loomcli_core::State>(
    app: &Application<I, R, S>,
    path: &[&str],
) -> String {
    let outcome = app
        .invoke(
            path,
            InvocationValues::new().option("help", true),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new())),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = outcome else {
        panic!("help failed: {outcome:?}");
    };
    output
}

#[tokio::test]
async fn help_and_man_pages_show_the_child_name_escape_only_when_applicable() {
    let root = Application::new("textstat").plugins((help(),)).argument(
        "files",
        Arg::string().variadic().description("The files to count."),
    );
    let visible = root.clone().command(child(false)).action(noop);
    let output = help_of(&visible, &[]).await;
    assert!(output.contains("  textstat [files...] [options]\n  textstat <command> [options]"));
    assert!(output.contains("ARGUMENTS\n  files  The files to count.\n  --     Read every later word as an argument, even a command name."));
    assert!(
        !help_of(&visible, &["completion"])
            .await
            .contains("even a command name")
    );
    let passing = root
        .clone()
        .passthrough(Passthrough::new())
        .command(child(false))
        .action(noop);
    let output = help_of(&passing, &[]).await;
    assert!(output.contains("-- <args>..."));
    assert!(!output.contains("even a command name"));
    let hidden = root.clone().command(child(true)).action(noop);
    let childless = root.action(noop);
    for app in [&hidden, &childless] {
        let output = help_of(app, &[]).await;
        assert!(output.contains("  files  The files to count."));
        assert!(!output.contains("even a command name"));
    }
    let visible_pages = man_pages(&visible.inspect().unwrap()).unwrap();
    assert!(visible_pages[0].text.contains(
        ".SH \"ARGUMENTS\"\n.TP\n\\fIfiles\\fR\nThe files to count.\n.TP\n\\-\\-\nRead every later word as an argument, even a command name."
    ));
    let hidden_pages = man_pages(&hidden.inspect().unwrap()).unwrap();
    assert!(!hidden_pages[0].text.contains("even a command name"));
}

#[test]
fn service_routes_a_root_that_accepts_both_arguments_and_children() {
    for (words, valid) in [
        (&["notes.txt"][..], true),
        (&["--", "cache"][..], true),
        (&["cache", "clear"][..], true),
        (&["cache"][..], false),
    ] {
        let app = Application::new("kit")
            .plugins((service("com.acme.kit", words.iter().copied()),))
            .argument("file", Arg::string())
            .command(Command::new("cache").command(Command::new("clear").action(noop)))
            .action(noop);
        assert_eq!(app.check().is_empty(), valid, "{words:?}");
    }
}

#[tokio::test]
async fn help_and_manifest_answer_for_a_terminal_command_without_a_terminal() {
    let app = Application::new("monitor")
        .plugins((help(), manifest()))
        .command(
            Command::new("top")
                .description("Show a live view.")
                .needs_terminal()
                .action(noop),
        )
        .action(noop);
    let help = help_of(&app, &["top"]).await;
    assert_eq!(
        help,
        "monitor top · Show a live view.\n  Needs a terminal: stdin and stderr, outside CI.\n\nUSAGE\n  monitor top [options]\n\nGLOBAL OPTIONS\n  -h, --help      Show this help.\n      --manifest  Print this command's manifest as JSON.\n"
    );
    for (path, terminal) in [(&[][..], false), (&["top"][..], true)] {
        let outcome = app
            .invoke(
                path,
                InvocationValues::new().option("manifest", true),
                InvokeOptions::new(),
                Some(mock_process(MockFields::new())),
            )
            .await;
        let InvocationOutcome::Completed { output, .. } = outcome else {
            panic!("manifest failed: {outcome:?}");
        };
        let doc: Value = serde_json::from_str(&output).unwrap();
        assert_eq!(doc["command"]["needsTerminal"], terminal);
    }
}

#[test]
fn man_pages_place_terminal_need_before_deprecation_and_details() {
    use loomcli_plugins::help::extension::{HELP_COMMAND, HelpCommandFacts};

    let app = Application::new("kit")
        .needs_terminal()
        .command(
            Command::new("top")
                .deprecated("Use dashboard.")
                .extend([
                    HELP_COMMAND.value(HelpCommandFacts::new().details("Shows live activity."))
                ])
                .needs_terminal()
                .action(noop),
        )
        .command(Command::new("list").action(noop))
        .action(noop);
    let pages = man_pages(&app.inspect().unwrap()).unwrap();
    let page = |file| {
        pages
            .iter()
            .find(|page| page.file == file)
            .unwrap()
            .text
            .as_str()
    };
    assert!(
        page("kit.1")
            .contains(".SH \"DESCRIPTION\"\nNeeds a terminal: stdin and stderr, outside CI.")
    );
    assert!(page("kit-top.1").contains(".SH \"DESCRIPTION\"\nNeeds a terminal: stdin and stderr, outside CI.\n.PP\nDeprecated: Use dashboard.\n.PP\nShows live activity."));
    assert!(!page("kit-list.1").contains("Needs a terminal"));
}
