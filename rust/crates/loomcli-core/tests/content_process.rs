//! Ports the real-process transports of `content.test.ts`: a content input named by a path that is
//! the process's own stdin, a file redirected to stdin, an unrelated FIFO and device, a closed
//! stdin, and argv paths through a pipe and a process substitution.
//!
//! Each case starts this test binary again through a shell that wires its real stdin, as the
//! reference's fixture starts itself under `sh -c`. The child runs `content_process_child` alone,
//! which acts only when `LOOM_CONTENT_CHILD` names a scenario, and prints one `RESULT:` line of JSON
//! the parent reads.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Read;
use std::path::PathBuf;
use std::process::Command as Process;
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, BoxFuture, Content, ContentKind, Context, Done, InputProblem,
    InvocationOutcome, InvocationValues, InvokeOptions, NoInputs, NoResult, Opt, OutputStream,
    ProcessFields, RunOptions, process_handle,
};
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

const SCENARIO: &str = "LOOM_CONTENT_CHILD";
const PATH: &str = "LOOM_CONTENT_PATH";

/// A fresh directory for one case.
fn directory(name: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("content-process-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
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
            let Some(file) = file else {
                return Ok(());
            };
            let path = match &file.kind {
                ContentKind::File { path } => json!(path),
                _ => Value::Null,
            };
            let line = json!({
                "kind": "file",
                "name": file.name,
                "path": path,
                "text": file.text().await?,
            });
            ctx.out.print(&line.to_string()).await
        })
}

/// `scalarApplication`: one required content option that may read stdin, printed as text.
fn scalar_application() -> App {
    Application::new("content")
        .description("Read one source.")
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

/// A stream that keeps what it is given.
#[derive(Default)]
struct Sink(Mutex<Vec<u8>>);

impl OutputStream for Sink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, std::io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(async { Ok(()) })
    }
}

/// The child's side: runs the scenario `LOOM_CONTENT_CHILD` names on the real process, and prints
/// what it saw as one `RESULT:` line. With no scenario it does nothing.
#[tokio::test]
async fn content_process_child() {
    let Ok(scenario) = std::env::var(SCENARIO) else {
        return;
    };
    let path = std::env::var(PATH).ok();
    let report = match scenario.as_str() {
        "named" => {
            let values = InvocationValues::new().arg("file", path.unwrap_or_default());
            let outcome = file_application()
                .invoke(
                    &[],
                    values,
                    InvokeOptions::<loomcli_core::Error>::new(),
                    None,
                )
                .await;
            let outcome = match outcome {
                InvocationOutcome::Completed { output, .. } => {
                    json!({ "status": "completed", "output": output })
                }
                InvocationOutcome::Failed {
                    failure,
                    exit_code,
                    output,
                    ..
                } => {
                    let issues: Vec<String> = failure
                        .downcast_failure::<loomcli_core::InputError>()
                        .map(|input| {
                            input
                                .problems()
                                .iter()
                                .flat_map(|problem| match problem {
                                    InputProblem::Invalid { issues, .. } => {
                                        issues.iter().map(|issue| issue.message.clone()).collect()
                                    }
                                    _ => Vec::new(),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    json!({
                        "status": "failed",
                        "exitCode": exit_code.get(),
                        "issues": issues,
                        "output": output,
                    })
                }
                _ => json!({ "status": "cancelled" }),
            };
            let mut remaining = String::new();
            let _ = std::io::stdin().read_to_string(&mut remaining);
            json!({ "outcome": outcome, "remaining": remaining })
        }
        "scalar" => {
            let sink = Arc::new(Sink::default());
            let mut argv = vec!["--file".to_owned()];
            argv.extend(path);
            let handle = process_handle(
                ProcessFields::new()
                    .argv(argv)
                    .stdout(Arc::clone(&sink) as Arc<dyn OutputStream>),
            );
            let code = scalar_application()
                .run(RunOptions::new().process(handle))
                .await;
            let stdout = String::from_utf8_lossy(&sink.0.lock().unwrap()).into_owned();
            json!({ "code": code.get(), "stdout": stdout })
        }
        _ => json!({ "unknown": scenario }),
    };
    println!("RESULT:{report}");
}

/// Starts this test binary's child through `shell -c script`, with the child's own words after
/// the script's `$@`, and answers the child's report.
fn child(shell: &str, script: &str, scenario: &str, leading: &[&str], path: Option<&str>) -> Value {
    let exe = std::env::current_exe().unwrap();
    let mut command = Process::new(shell);
    command
        .arg("-c")
        .arg(script)
        .arg("content-input")
        .args(leading)
        .arg(&exe)
        .args([
            "--exact",
            "content_process_child",
            "--nocapture",
            "--test-threads",
            "1",
        ])
        .env(SCENARIO, scenario);
    match path {
        Some(path) => command.env(PATH, path),
        None => command.env_remove(PATH),
    };
    let output = command.output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find_map(|line| line.split_once("RESULT:").map(|(_, report)| report))
        .unwrap_or_else(|| {
            panic!(
                "the child reports: {stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            )
        });
    serde_json::from_str(line).unwrap()
}

const PIPED: &str = r#"printf "transport sentinel\n" | "$@""#;

#[test]
fn a_named_content_path_cannot_read_process_stdin_through_its_own_descriptor() {
    for path in ["/dev/stdin", "/dev/fd/0", "/proc/self/fd/0"] {
        let report = child("sh", PIPED, "named", &[], Some(path));
        assert_eq!(
            report,
            json!({
                "outcome": {
                    "status": "failed",
                    "exitCode": 2,
                    "issues": ["Expected a readable file that exists."],
                    "output": "",
                },
                "remaining": "transport sentinel\n",
            }),
            "{path}"
        );
    }
}

#[test]
fn a_named_content_path_cannot_read_process_stdin_through_a_symlink() {
    let root = directory("stdin-link");
    let link = root.join("input");
    std::os::unix::fs::symlink("/dev/stdin", &link).unwrap();
    let report = child("sh", PIPED, "named", &[], Some(&link.to_string_lossy()));
    assert_eq!(report["outcome"]["status"], json!("failed"));
    assert_eq!(report["outcome"]["exitCode"], json!(2));
    assert_eq!(report["outcome"]["output"], json!(""));
    assert_eq!(report["remaining"], json!("transport sentinel\n"));
}

#[test]
fn a_named_regular_file_opens_independently_when_the_same_file_is_redirected_to_stdin() {
    let root = directory("redirected");
    let path = root.join("input.txt");
    std::fs::write(&path, "source sentinel\n").unwrap();
    let path = path.to_string_lossy().into_owned();
    let report = child(
        "sh",
        r#"source=$1; shift; exec "$@" < "$source""#,
        "named",
        &[path.as_str()],
        Some(&path),
    );
    assert_eq!(report["outcome"]["status"], json!("completed"));
    let output: Value =
        serde_json::from_str(report["outcome"]["output"].as_str().unwrap()).unwrap();
    assert_eq!(
        output,
        json!({ "kind": "file", "name": path, "path": path, "text": "source sentinel\n" })
    );
    assert_eq!(report["remaining"], json!("source sentinel\n"));
}

#[test]
fn a_named_content_input_accepts_an_unrelated_fifo() {
    let root = directory("fifo");
    let path = root.join("input").to_string_lossy().into_owned();
    let report = child(
        "sh",
        r#"mkfifo "$1"; fifo=$1; shift; printf "source sentinel\n" > "$fifo" & exec "$@""#,
        "named",
        &[path.as_str()],
        Some(&path),
    );
    assert_eq!(report["outcome"]["status"], json!("completed"));
    let output: Value =
        serde_json::from_str(report["outcome"]["output"].as_str().unwrap()).unwrap();
    assert_eq!(
        output,
        json!({ "kind": "file", "name": path, "path": path, "text": "source sentinel\n" })
    );
}

#[test]
fn a_named_content_input_accepts_an_unrelated_device() {
    let report = child("sh", PIPED, "named", &[], Some("/dev/null"));
    assert_eq!(report["outcome"]["status"], json!("completed"));
    let output: Value =
        serde_json::from_str(report["outcome"]["output"].as_str().unwrap()).unwrap();
    assert_eq!(output["text"], json!(""));
    assert_eq!(report["remaining"], json!("transport sentinel\n"));
}

/// A process started with descriptor 0 closed has it reopened on `/dev/null` by Rust's runtime
/// before `main`, so there `/dev/null` is the process's own stdin (a recorded deviation), and the
/// unrelated source this case names is a regular file.
#[test]
fn closed_process_stdin_leaves_unrelated_named_sources_usable() {
    let root = directory("closed-stdin");
    let path = root.join("input.txt");
    std::fs::write(&path, "").unwrap();
    let closed = r#"exec "$@" <&-"#;
    let report = child("sh", closed, "named", &[], Some(&path.to_string_lossy()));
    assert_eq!(report["outcome"]["status"], json!("completed"));
    let output: Value =
        serde_json::from_str(report["outcome"]["output"].as_str().unwrap()).unwrap();
    assert_eq!(output["text"], json!(""));
    let null = child("sh", closed, "named", &[], Some("/dev/null"));
    assert_eq!(null["outcome"]["exitCode"], json!(2));
}

#[test]
fn argv_content_paths_can_still_name_process_stdin() {
    let report = child("sh", PIPED, "scalar", &[], Some("/dev/stdin"));
    assert_eq!(
        report,
        json!({ "code": 0, "stdout": "transport sentinel\n" })
    );
}

#[test]
fn argv_content_paths_accept_process_substitution() {
    let report = child(
        "bash",
        r#"exec env LOOM_CONTENT_PATH=<(printf "source sentinel\n") "$@""#,
        "scalar",
        &[],
        None,
    );
    assert_eq!(report, json!({ "code": 0, "stdout": "source sentinel\n" }));
}
