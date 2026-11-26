//! Ports the argv cases of `content.test.ts`: lazy file and stdin handles, the stdin target's `-`,
//! source counts with appended stdin, a standalone stdin declaration, and the path rules (a
//! trailing slash, `..` after a symlink). Files are written under Cargo's per-target temporary
//! directory, and the mock's working directory points there.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::path::PathBuf;
use std::sync::Arc;

use loomcli_core::{
    Application, Arg, Content, ContentKind, Context, Done, NoInputs, NoResult, Opt, ProcessHandle,
    Stdin,
};
use loomcli_testing::{MockFields, MockTerminal, StreamName, mock_process};
use serde_json::{Value, json};
use support::{Ran, run_with};

type App = Application<NoInputs, NoResult, Done>;

/// A fresh directory for one test.
fn directory(name: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("content-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("the directory is created");
    root
}

/// One handle as the reference's fixture prints it.
async fn described(content: &Content, with_path: bool) -> Value {
    let kind = match &content.kind {
        ContentKind::File { .. } => "file",
        ContentKind::Stdin => "stdin",
        _ => "other",
    };
    let text = content.text().await.unwrap_or_default();
    let mut record = json!({ "kind": kind, "name": content.name });
    if with_path && let ContentKind::File { path } = &content.kind {
        record["path"] = json!(path);
    }
    record["text"] = json!(text);
    record
}

/// `fileApplication`: one required content argument, printed with its path and text.
fn file_application() -> App {
    Application::new("content")
        .argument(
            "file",
            Arg::content().description("The source to read.").required(),
        )
        .action(|ctx: Context| async move {
            let file: Option<Content> = ctx.argument("file")?;
            let line = match file {
                Some(file) => described(&file, true).await,
                None => Value::Null,
            };
            ctx.out.print(&line.to_string()).await
        })
}

#[tokio::test]
async fn a_content_argument_checks_a_path_and_hands_its_action_a_lazy_file_handle() {
    let root = directory("lazy");
    let path = root.join("input.txt");
    std::fs::write(&path, "hello\n").expect("the file is written");
    let path = path.to_string_lossy().into_owned();
    let ran = run_with(&file_application(), MockFields::new().argv([path.as_str()])).await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: format!(
                "{}\n",
                json!({ "kind": "file", "name": path, "path": path, "text": "hello\n" })
            ),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn file_content_can_stop_after_a_header_and_reopen_its_sources() {
    let root = directory("header");
    let size = 2 * 1024 * 1024;
    let paths: Vec<String> = ["a.txt", "b.txt", "c.txt", "d.txt"]
        .iter()
        .map(|name| {
            let path = root.join(name);
            std::fs::write(&path, "x".repeat(size)).expect("the file is written");
            path.to_string_lossy().into_owned()
        })
        .collect();
    let app = Application::new("content")
        .argument("files", Arg::content().variadic().required())
        .action(|ctx: Context| async move {
            let files: Vec<Content> = ctx.argument("files")?;
            let mut lengths = Vec::new();
            for _ in 0..10 {
                let mut round = Vec::new();
                for file in &files {
                    // Read a header from one stream, then drop it and read the file whole afresh.
                    let mut header = [0_u8; 16];
                    let read = file.stream().read(&mut header).await?;
                    assert_eq!(read, 16);
                    round.push(file.bytes().await?.len());
                }
                lengths.push(round);
            }
            ctx.out.print(&json!(lengths).to_string()).await
        });
    let ran = run_with(
        &app,
        MockFields::new().argv(paths.iter().map(String::as_str)),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    let lengths: Vec<Vec<usize>> = serde_json::from_str(ran.stdout.trim()).unwrap_or_default();
    assert_eq!(lengths.len(), 10);
    for round in lengths {
        assert_eq!(round, [size, size, size, size]);
    }
}

#[tokio::test]
async fn a_stdin_only_declaration_hands_the_action_a_lazy_stdin_handle() {
    let app = Application::new("content")
        .stdin(Stdin::new().description("The event stream.").required())
        .action(|ctx: Context| async move {
            let text = match &ctx.stdin {
                Some(stdin) => stdin.text().await?,
                None => String::new(),
            };
            ctx.out.print(&text).await
        });
    assert_eq!(
        run_with(&app, MockFields::new().stdin("events\n")).await,
        Ran {
            status: 0,
            stdout: "events\n".to_owned(),
            stderr: String::new(),
        }
    );
}

/// A keyboard on stdin with nothing typed, and both output streams piped.
fn keyboard() -> MockTerminal {
    MockTerminal::new(80, 24)
        .streams(Vec::<StreamName>::new())
        .keys(Vec::<&str>::new())
}

#[tokio::test]
async fn missing_stdin_joins_other_missing_inputs_in_one_failure() {
    let app = Application::new("content")
        .stdin(Stdin::new().description("The event stream.").required())
        .option("name", Opt::string().description("The name.").required())
        .action(|_: Context| async { Ok(()) });
    let ran = run_with(&app, MockFields::new().terminal(keyboard())).await;
    assert_eq!(
        ran,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "content: Stdin: Expected at least 1 readable source.\n\
                     content: Option \"--name\" is required. Supply a value.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn stdin_problems_retain_their_declaration_position_among_other_input_problems() {
    let app = Application::new("content")
        .option(
            "first",
            Opt::string()
                .description("Declared before stdin.")
                .required(),
        )
        .option(
            "unused",
            Opt::boolean().description("An input that reports no problem."),
        )
        .stdin(Stdin::new().description("The input stream.").required())
        .option("name", Opt::string().description("The name.").required())
        .action(|_: Context| async { Ok(()) });
    let ran = run_with(&app, MockFields::new().terminal(keyboard())).await;
    assert_eq!(
        ran.stderr,
        "content: Option \"--first\" is required. Supply a value.\n\
         content: Stdin: Expected at least 1 readable source.\n\
         content: Option \"--name\" is required. Supply a value.\n"
    );
}

/// The collection application: a required variadic content argument that claims stdin.
fn collection(max: Option<usize>) -> App {
    let files = Arg::content()
        .description("The sources to read.")
        .required()
        .stdin()
        .variadic();
    let files = match max {
        Some(max) => files.max(max),
        None => files,
    };
    Application::new("content")
        .argument("files", files)
        .action(|ctx: Context| async move {
            let files: Vec<Content> = ctx.argument("files")?;
            let mut sources = Vec::new();
            for file in &files {
                sources.push(described(file, false).await);
            }
            ctx.out.print(&json!(sources).to_string()).await
        })
}

#[tokio::test]
async fn repeated_dash_entries_read_the_same_stdin_at_its_current_position() {
    let ran = run_with(
        &collection(None),
        MockFields::new().argv(["-", "-"]).stdin("one\n"),
    )
    .await;
    assert_eq!((ran.status, ran.stderr.as_str()), (0, ""));
    assert_eq!(
        serde_json::from_str::<Value>(ran.stdout.trim()).unwrap_or(Value::Null),
        json!([
            { "kind": "stdin", "name": "stdin", "text": "one\n" },
            { "kind": "stdin", "name": "stdin", "text": "" },
        ])
    );
}

#[tokio::test]
async fn a_content_collection_appends_piped_stdin_after_the_supplied_files() {
    let root = directory("collection");
    let path = root.join("input.txt");
    std::fs::write(&path, "file\n").expect("the file is written");
    let path = path.to_string_lossy().into_owned();
    let ran = run_with(
        &collection(None),
        MockFields::new().argv([path.as_str()]).stdin("pipe\n"),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: format!(
                "{}\n",
                json!([
                    { "kind": "file", "name": path, "text": "file\n" },
                    { "kind": "stdin", "name": "stdin", "text": "pipe\n" },
                ])
            ),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_collection_maximum_includes_automatically_appended_stdin() {
    let root = directory("maximum");
    let path = root.join("input.txt");
    std::fs::write(&path, "file").expect("the file is written");
    let path = path.to_string_lossy().into_owned();
    let ran = run_with(
        &collection(Some(1)),
        MockFields::new().argv([path.as_str()]).stdin("pipe"),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "content: Argument \"files\": Expected at most 1 readable source.\n".to_owned(),
        }
    );
}

#[tokio::test]
async fn an_explicit_dash_at_a_terminal_is_an_input_error() {
    let ran = run_with(
        &collection(None),
        MockFields::new().argv(["-"]).terminal(keyboard()),
    )
    .await;
    assert_eq!(ran.status, 2);
    assert_eq!(
        ran.stderr,
        "content: Argument \"files\" at 0: Expected piped or redirected stdin.\n"
    );
}

#[tokio::test]
async fn only_the_stdin_target_accepts_a_dash() {
    let app = Application::new("content")
        .argument("files", Arg::content().variadic())
        .action(|_: Context| async { Ok(()) });
    let ran = run_with(&app, MockFields::new().argv(["-"]).stdin("pipe")).await;
    assert_eq!(
        ran.stderr,
        "content: Argument \"files\" at 0: This input accepts file paths only. Use ./- for a file named -.\n"
    );
}

/// `scalarApplication`: one required content option that claims stdin, printing its text.
fn scalar() -> App {
    Application::new("content")
        .option(
            "file",
            Opt::content().description("The source.").required().stdin(),
        )
        .action(|ctx: Context| async move {
            let file: Option<Content> = ctx.option("file")?;
            let text = match file {
                Some(file) => file.text().await?,
                None => String::new(),
            };
            ctx.out.print(&text).await
        })
}

#[tokio::test]
async fn a_scalar_content_option_uses_its_supplied_file_and_leaves_piped_stdin_unread() {
    let root = directory("scalar");
    std::fs::write(root.join("input.txt"), "file").expect("the file is written");
    let ran = run_with(
        &scalar(),
        MockFields::new()
            .argv(["--file", "input.txt"])
            .cwd(&root)
            .stdin("pipe"),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: "file\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn content_reads_dot_dot_after_following_a_directory_symlink() {
    let root = directory("symlink");
    std::fs::create_dir_all(root.join("real").join("child")).expect("the directory is created");
    std::fs::write(root.join("real").join("target.txt"), "followed").expect("written");
    std::fs::write(root.join("target.txt"), "lexical").expect("written");
    std::os::unix::fs::symlink(root.join("real").join("child"), root.join("link"))
        .expect("the link is made");
    let ran = run_with(
        &scalar(),
        MockFields::new()
            .argv(["--file", "link/../target.txt"])
            .cwd(&root),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 0,
            stdout: "followed\n".to_owned(),
            stderr: String::new(),
        }
    );
}

#[tokio::test]
async fn a_trailing_slash_cannot_turn_a_file_operand_into_another_source() {
    let root = directory("slash");
    std::fs::write(root.join("file.txt"), "file").expect("the file is written");
    let ran = run_with(
        &scalar(),
        MockFields::new().argv(["--file", "file.txt/"]).cwd(&root),
    )
    .await;
    assert_eq!(
        ran,
        Ran {
            status: 2,
            stdout: String::new(),
            stderr: "content: Option \"--file\": Expected a readable file that exists.\n"
                .to_owned(),
        }
    );
}

#[tokio::test]
async fn content_preparation_leaves_an_open_stdin_unread_when_another_input_fails() {
    let app = Application::new("content")
        .argument(
            "files",
            Arg::content()
                .description("The sources.")
                .required()
                .stdin()
                .variadic(),
        )
        .option("name", Opt::string().description("The name.").required())
        .action(|_: Context| async { Ok(()) });
    let process = mock_process(MockFields::new().stdin("unread"));
    let code = app
        .run(loomcli_core::RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(code.get(), 2);
    assert!(
        process
            .stderr_text()
            .contains("Option \"--name\" is required.")
    );
    // Preparation probed stdin without reading it, so every byte is still there.
    let mut buffer = [0_u8; 16];
    let read = process.stdin().read(&mut buffer).await.unwrap_or(0);
    assert_eq!(&buffer[..read], b"unread");
}

#[tokio::test]
async fn an_omitted_optional_content_input_reads_absent_or_empty() {
    let app = Application::new("content")
        .option("file", Opt::content())
        .option("more", Opt::content().multiple())
        .action(|ctx: Context| async move {
            let file: Option<Content> = ctx.option("file")?;
            let more: Vec<Content> = ctx.option("more")?;
            ctx.out
                .print(&json!({ "file": file.is_some(), "more": more.len() }).to_string())
                .await
        });
    let ran = run_with(&app, MockFields::new()).await;
    assert_eq!(ran.stdout, "{\"file\":false,\"more\":0}\n");
}

// content.test.ts: the invocations by name.

#[tokio::test]
async fn a_named_content_argument_checks_a_path_and_hands_its_action_a_lazy_file_handle() {
    let root = directory("by-name-file");
    let path = root.join("input.txt");
    std::fs::write(&path, "hello\n").unwrap();
    let path = path.to_string_lossy().into_owned();
    let outcome = file_application()
        .invoke(
            &[],
            loomcli_core::InvocationValues::new().arg("file", path.as_str()),
            loomcli_core::InvokeOptions::<loomcli_core::Error>::new(),
            Some(mock_process(MockFields::new().cwd(&root)) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Completed { output, messages } = outcome else {
        panic!("the call completes");
    };
    assert_eq!(messages, "");
    assert_eq!(
        output,
        format!(
            "{}\n",
            json!({ "kind": "file", "name": path, "path": path, "text": "hello\n" })
        )
    );
}

#[tokio::test]
async fn stdin_problems_retain_their_declaration_position_among_other_input_problems_by_name() {
    let app: App = Application::new("content")
        .description("Report input problems in order.")
        .option(
            "unused",
            Opt::boolean().description("An input that reports no problem."),
        )
        .stdin(Stdin::new().description("The input stream.").required())
        .option("name", Opt::string().description("The name.").required())
        .action(|_: Context| async { Ok(()) });
    let outcome = app
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::new().failure(
                |failure: &dyn loomcli_core::Failure, _: &loomcli_core::InvokeFailure| {
                    failure
                        .downcast_ref::<loomcli_core::InputError>()
                        .map(|input| {
                            input
                                .problems()
                                .iter()
                                .map(|problem| match problem {
                                    loomcli_core::InputProblem::Missing { input, spelling } => {
                                        json!({ "input": input, "reason": "missing", "spelling": spelling })
                                    }
                                    _ => Value::Null,
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default()
                },
            ),
            Some(mock_process(MockFields::new()) as _),
        )
        .await;
    let loomcli_core::InvocationOutcome::Failed { failure, .. } = outcome else {
        panic!("the call fails");
    };
    assert_eq!(
        Value::Array(failure),
        json!([
            {
                "input": { "global": false, "kind": "stdin", "name": "stdin" },
                "reason": "missing",
                "spelling": "stdin",
            },
            { "input": { "global": false, "kind": "option", "name": "name" }, "reason": "missing", "spelling": "name" },
        ])
    );
}
