//! Ports `editor.test.ts` and `editor-views.test.ts`: the editor question's file, the editor it
//! starts, the answer it reads, its failures, its cancellation, and the frames and answered line
//! its views draw.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::type_complexity,
    missing_docs
)]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use loomcli_core::{
    Application, Context, Error, InvocationOutcome, InvocationValues, InvokeOptions, Issue, Opt,
    Plugin, ProcessSignal, ThemeMapping, ValidationContext, Validator, style,
};
use loomcli_prompts::views::{
    AnsweredLine, EditorFrame, QuestionFrame, QuestionKind, answered_line, question_frame,
};
use loomcli_prompts::{EditorError, EditorSettings, TextSettings, Verbatim, editor, text};
use loomcli_testing::{
    KeyEntry, MockFields, MockProcess, MockTerminal, ProgramAnswer, ProgramCall, StreamName,
    mock_process,
};
use support::{App, entry, reads, run, strip};

/// A private folder for `TMPDIR` in the system temp folder, removed when dropped.
struct Folder(PathBuf);

impl Folder {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "loomcli-prompts-editor-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Folder(path)
    }

    fn path(&self) -> &str {
        self.0.to_str().unwrap()
    }
}

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A mock whose `/bin/sh` runs `script`, on an 80-column keyboard of `keys`, under `env`.
fn editing<F>(env: &[(&str, &str)], keys: Vec<KeyEntry>, script: F) -> Arc<MockProcess>
where
    F: Fn(ProgramCall) -> std::io::Result<ProgramAnswer> + Send + Sync + 'static,
{
    editing_with(MockFields::new(), env, 80, keys, script)
}

fn editing_with<F>(
    fields: MockFields,
    env: &[(&str, &str)],
    columns: u16,
    keys: Vec<KeyEntry>,
    script: F,
) -> Arc<MockProcess>
where
    F: Fn(ProgramCall) -> std::io::Result<ProgramAnswer> + Send + Sync + 'static,
{
    let script = Arc::new(script);
    let mut fields = fields
        .script("/bin/sh", move |call| {
            let script = Arc::clone(&script);
            async move { script(call) }
        })
        .terminal(MockTerminal::new(columns, 24).keys(keys));
    for (name, value) in env {
        fields = fields.env(name, value);
    }
    mock_process(fields)
}

/// The answer file a call names, its last argument.
fn file_of(call: &ProgramCall) -> PathBuf {
    PathBuf::from(call.args.get(3).cloned().unwrap_or_default())
}

fn parent(file: &Path) -> PathBuf {
    file.parent().unwrap().to_path_buf()
}

/// An application whose action asks an editor question with `settings` and keeps the answer.
fn asking(
    name: &str,
    settings: impl Fn() -> EditorSettings + Send + Sync + 'static,
) -> (App, Arc<Mutex<Option<Result<String, String>>>>) {
    let answer = Arc::new(Mutex::new(None));
    let kept = Arc::clone(&answer);
    let settings = Arc::new(settings);
    let app: App = Application::new(name).action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        let settings = Arc::clone(&settings);
        async move {
            let result = editor(&ctx, settings(), Verbatim).await;
            *kept.lock().unwrap() = Some(match &result {
                Ok(value) => Ok(value.clone()),
                Err(error) => Err(error.downcast_failure::<EditorError>().map_or_else(
                    || "other".to_owned(),
                    |e| {
                        format!(
                            "{}|{:?}|{}",
                            e.editor(),
                            e.status(),
                            loomcli_core::FailureFacts::message(e)
                        )
                    },
                )),
            });
            result.map(|_| ())
        }
    });
    (app, answer)
}

fn answered(slot: &Arc<Mutex<Option<Result<String, String>>>>) -> Option<Result<String, String>> {
    slot.lock().unwrap().clone()
}

#[tokio::test]
async fn editor_lends_cooked_stdin_seeds_a_private_file_and_returns_saved_utf8_exactly() {
    let folder = Folder::new();
    let file = Arc::new(Mutex::new(PathBuf::new()));
    let seen = Arc::clone(&file);
    let mock_cell: Arc<OnceLock<Arc<MockProcess>>> = Arc::new(OnceLock::new());
    let cell = Arc::clone(&mock_cell);
    let checks = Arc::new(Mutex::new(Vec::<String>::new()));
    let noted = Arc::clone(&checks);
    let mock = editing(
        &[("TMPDIR", folder.path()), ("VISUAL", "code --wait")],
        vec![entry("\r")],
        move |call| {
            let path = file_of(&call);
            *seen.lock().unwrap() = path.clone();
            let mut checks = noted.lock().unwrap();
            if call.args
                != [
                    "-c".to_owned(),
                    "exec 1>&2; exec code --wait \"$@\"".to_owned(),
                    "code --wait".to_owned(),
                    path.to_string_lossy().into_owned(),
                ]
            {
                checks.push(format!("args {:?}", call.args));
            }
            if !call.input.is_empty() {
                checks.push("input".to_owned());
            }
            if cell.get().is_some_and(|mock| mock.is_raw()) {
                checks.push("raw".to_owned());
            }
            let folder_mode = std::fs::metadata(parent(&path))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            let file_mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            if folder_mode != 0o700 || file_mode != 0o600 {
                checks.push(format!("modes {folder_mode:o} {file_mode:o}"));
            }
            if std::fs::read_to_string(&path).unwrap() != "seed" {
                checks.push("seed".to_owned());
            }
            std::fs::write(&path, "\u{feff}First\nSecond\n").unwrap();
            Ok(ProgramAnswer::new())
        },
    );
    let _ = mock_cell.set(Arc::clone(&mock));
    let (app, answer) = asking("edit", || {
        EditorSettings::new("Notes").default("seed").extension("md")
    });
    assert_eq!(run(app, &mock).await, 0, "{:?}", mock.stderr_text());
    assert!(
        checks.lock().unwrap().is_empty(),
        "{:?}",
        checks.lock().unwrap()
    );
    assert_eq!(
        answered(&answer),
        Some(Ok("\u{feff}First\nSecond\n".to_owned()))
    );
    let file = file.lock().unwrap().clone();
    assert!(file.to_string_lossy().ends_with("/answer.md"));
    assert!(!parent(&file).exists());
    assert!(mock.stderr_text().contains("(+1 line)"));
}

#[tokio::test]
async fn editor_resolution_selects_visual_then_editor_then_vi() {
    let cases: Vec<(Vec<(&str, &str)>, &str)> = vec![
        (
            vec![("EDITOR", "editor"), ("TERM", "dumb"), ("VISUAL", "visual")],
            "visual",
        ),
        (vec![("EDITOR", "editor"), ("VISUAL", " \t")], "editor"),
        (vec![("EDITOR", " "), ("VISUAL", "")], "vi"),
    ];
    for (env, command) in cases {
        let folder = Folder::new();
        let named = Arc::new(Mutex::new(String::new()));
        let seen = Arc::clone(&named);
        let mut env = env.clone();
        env.push(("TMPDIR", folder.path()));
        let mock = editing(&env, vec![entry("\r")], move |call| {
            *seen.lock().unwrap() = call.args[2].clone();
            Ok(ProgramAnswer::new())
        });
        let (app, answer) = asking("edit", || EditorSettings::new("Notes").default("seed"));
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(*named.lock().unwrap(), command);
        assert_eq!(answered(&answer), Some(Ok("seed".to_owned())));
    }
}

#[tokio::test]
async fn editor_exit_has_the_exact_failure_and_cleans_up() {
    for status in [1, 2, 126, 127] {
        let folder = Folder::new();
        let file = Arc::new(Mutex::new(PathBuf::new()));
        let seen = Arc::clone(&file);
        let mock = editing(
            &[("EDITOR", "nano"), ("TMPDIR", folder.path())],
            vec![entry("\r")],
            move |call| {
                *seen.lock().unwrap() = file_of(&call);
                Ok(ProgramAnswer::new().code(status))
            },
        );
        let (app, answer) = asking("edit", || EditorSettings::new("Notes"));
        assert_eq!(run(app, &mock).await, 1);
        let sentence = if status >= 126 {
            "The editor \"nano\" could not start. Set VISUAL or EDITOR to an editor you have installed, then run the command again.".to_owned()
        } else {
            format!(
                "The editor \"nano\" exited with code {status}, so the question has no answer. To answer it, set VISUAL or EDITOR to another editor if you need one, then run the command again."
            )
        };
        assert_eq!(
            answered(&answer),
            Some(Err(format!("nano|Some({status})|{sentence}")))
        );
        assert!(!parent(&file.lock().unwrap()).exists());
    }
}

#[test]
fn the_editor_error_code_is_editor_failed() {
    let error = EditorErrorProbe::probe();
    assert_eq!(error.0, "editor-failed");
    assert_eq!(error.1, 1);
}

/// Reads the class facts of an `EditorError` through a run that fails with one.
struct EditorErrorProbe;

impl EditorErrorProbe {
    fn probe() -> (String, u8) {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let folder = Folder::new();
            let mock = editing(
                &[("EDITOR", "nano"), ("TMPDIR", folder.path())],
                vec![entry("\r")],
                |_| Ok(ProgramAnswer::new().code(1)),
            );
            let outcome = Arc::new(Mutex::new((String::new(), 0)));
            let kept = Arc::clone(&outcome);
            let app: App = Application::new("edit").action(move |ctx: Context| {
                let kept = Arc::clone(&kept);
                async move {
                    let error = editor(&ctx, EditorSettings::new("Notes"), Verbatim)
                        .await
                        .unwrap_err();
                    let failure = error.downcast_failure::<EditorError>().unwrap();
                    *kept.lock().unwrap() = (
                        loomcli_core::FailureFacts::code(failure).to_owned(),
                        loomcli_core::FailureFacts::exit_code(failure).get(),
                    );
                    Ok(())
                }
            });
            assert_eq!(run(app, &mock).await, 0);
            outcome.lock().unwrap().clone()
        })
    }
}

/// A validator that rejects `bad`.
#[derive(Clone, Copy)]
struct NotBad;

impl Validator for NotBad {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if input == "bad" {
            Err(vec![Issue::new("Try again.")])
        } else {
            Ok(input.to_owned())
        }
    }
}

#[tokio::test]
async fn editor_reopens_saved_text_after_a_rejection() {
    for rejection in ["validation", "missing", "utf8"] {
        let folder = Folder::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&calls);
        let reopened = Arc::new(Mutex::new(Vec::new()));
        let kept = Arc::clone(&reopened);
        let mock = editing(
            &[("TMPDIR", folder.path())],
            vec![entry("ignored\r\r"), entry("\r")],
            move |call| {
                let file = file_of(&call);
                if counted.fetch_add(1, Ordering::SeqCst) == 0 {
                    match rejection {
                        "missing" => std::fs::remove_file(&file).unwrap(),
                        "utf8" => std::fs::write(&file, [255]).unwrap(),
                        _ => std::fs::write(&file, "bad").unwrap(),
                    }
                } else {
                    *kept.lock().unwrap() = std::fs::read(&file).unwrap();
                    std::fs::write(&file, "good\n").unwrap();
                }
                Ok(ProgramAnswer::new())
            },
        );
        let answer = Arc::new(Mutex::new(String::new()));
        let held = Arc::clone(&answer);
        let app: App = Application::new("edit").action(move |ctx: Context| {
            let held = Arc::clone(&held);
            async move {
                let value =
                    editor(&ctx, EditorSettings::new("Notes").default("seed"), NotBad).await?;
                *held.lock().unwrap() = value;
                Ok(())
            }
        });
        assert_eq!(run(app, &mock).await, 0, "{rejection}");
        assert_eq!(*answer.lock().unwrap(), "good\n");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let expected: Vec<u8> = match rejection {
            "missing" => b"seed".to_vec(),
            "utf8" => vec![255],
            _ => b"bad".to_vec(),
        };
        assert_eq!(*reopened.lock().unwrap(), expected, "{rejection}");
        let issue = match rejection {
            "missing" => "The editor removed the answer's file.",
            "utf8" => "The saved answer is not UTF-8 text.",
            _ => "Try again.",
        };
        assert!(mock.stderr_text().contains(issue), "{rejection}");
    }
}

#[tokio::test]
async fn editor_cancels_while_waiting_with_ctrl_c_and_ctrl_d() {
    for keys in ["\u{3}", "\u{4}"] {
        let mock =
            mock_process(MockFields::new().terminal(MockTerminal::new(80, 24).keys([entry(keys)])));
        let (app, _) = asking("edit", || EditorSettings::new("Notes"));
        assert_eq!(run(app, &mock).await, 130);
        assert!(!mock.is_raw());
        assert!(mock.stderr_text().contains("cancelled"));
    }
}

#[tokio::test]
async fn editor_never_spawns_with_interaction_off_or_in_invoke() {
    let app: App = Application::new("edit")
        .option("notes", Opt::string())
        .action(|ctx: Context| async move {
            let value =
                editor(&ctx, EditorSettings::new("Notes").option("notes"), Verbatim).await?;
            assert_eq!(value, "supplied");
            Ok(())
        });
    let mock = mock_process(MockFields::new().argv(["--notes", "supplied"]));
    assert_eq!(run(app, &mock).await, 0);
    let app: App = Application::new("edit")
        .option("notes", Opt::string())
        .action(|ctx: Context| async move {
            editor(&ctx, EditorSettings::new("Notes").option("notes"), Verbatim).await?;
            Ok(())
        });
    let invocation = app
        .invoke(
            &[],
            InvocationValues::new().option("notes", "supplied"),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new()) as _),
        )
        .await;
    assert!(matches!(invocation, InvocationOutcome::Completed { .. }));
}

#[tokio::test]
async fn editor_summarizes_saved_text_on_one_answered_row() {
    for (saved, expected) in [
        ("", "? Notes · empty\n"),
        ("\u{feff}\n\u{85}\n", "? Notes · empty\n"),
        ("\nFirst\r\nSecond\r\n", "? Notes · First (+2 lines)\n"),
        ("First\n", "? Notes · First\n"),
    ] {
        let folder = Folder::new();
        let mock = editing(
            &[("NO_COLOR", "1"), ("TMPDIR", folder.path())],
            vec![entry("\r")],
            move |call| {
                std::fs::write(file_of(&call), saved).unwrap();
                Ok(ProgramAnswer::new())
            },
        );
        let (app, answer) = asking("edit", || EditorSettings::new("Notes"));
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(answered(&answer), Some(Ok(saved.to_owned())));
        assert!(strip(&mock.stderr_text()).contains(expected), "{saved:?}");
    }
}

#[tokio::test]
async fn file_creation_failure_names_tmpdir_and_leaves_no_folder() {
    let mock = mock_process(
        MockFields::new()
            .env("TMPDIR", "/loom-missing-editor-test")
            .terminal(MockTerminal::new(80, 24).keys([entry("\r")])),
    );
    let (app, _) = asking("edit", || EditorSettings::new("Notes"));
    assert_eq!(run(app, &mock).await, 1);
    assert!(mock.stderr_text().contains(
        "Cannot write the editor's file in \"/loom-missing-editor-test\" (ENOENT). Set TMPDIR to a folder you can write to, then run the command again."
    ));
}

#[tokio::test]
async fn a_supplied_linked_value_seeds_the_editor_ahead_of_its_question_default() {
    let folder = Folder::new();
    let seeded = Arc::new(Mutex::new(String::new()));
    let seen = Arc::clone(&seeded);
    let mock = editing_with(
        MockFields::new().argv(["--notes", "supplied"]),
        &[("TMPDIR", folder.path())],
        80,
        vec![entry("\r")],
        move |call| {
            *seen.lock().unwrap() = std::fs::read_to_string(file_of(&call)).unwrap();
            Ok(ProgramAnswer::new())
        },
    );
    let app: App = Application::new("edit")
        .option("notes", Opt::string().default("declared"))
        .action(|ctx: Context| async move {
            let value = editor(
                &ctx,
                EditorSettings::new("Notes")
                    .default("question")
                    .option("notes"),
                Verbatim,
            )
            .await?;
            assert_eq!(value, "supplied");
            Ok(())
        });
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(*seeded.lock().unwrap(), "supplied");
}

/// A mock whose `/bin/sh` notes its call through `started` and never exits until its signal ends
/// it, which `act` may do first.
fn hanging(
    folder: &Folder,
    env: &[(&str, &str)],
    act: impl Fn(&ProgramCall) + Send + Sync + 'static,
) -> (
    Arc<MockProcess>,
    tokio::sync::watch::Receiver<Option<ProgramCall>>,
) {
    let (started, ready) = tokio::sync::watch::channel(None);
    let act = Arc::new(act);
    let mut fields = MockFields::new()
        .env("TMPDIR", folder.path())
        .script("/bin/sh", move |call: ProgramCall| {
            let act = Arc::clone(&act);
            started.send_replace(Some(call.clone()));
            async move {
                act(&call);
                call.signal.cancelled().await;
                std::future::pending::<()>().await;
                Ok(ProgramAnswer::new())
            }
        })
        .terminal(MockTerminal::new(80, 24).keys([entry("\r")]));
    for (name, value) in env {
        fields = fields.env(name, value);
    }
    (mock_process(fields), ready)
}

#[tokio::test]
async fn cancellation_while_editing_ends_the_child_and_removes_its_folder() {
    let folder = Folder::new();
    let (mock, mut ready) = hanging(&folder, &[], |_| {});
    let (app, _) = asking("edit", || EditorSettings::new("Notes"));
    let raising = {
        let mock = Arc::clone(&mock);
        async move {
            let call = ready
                .wait_for(Option::is_some)
                .await
                .unwrap()
                .clone()
                .unwrap();
            mock.raise(ProcessSignal::Int);
            call
        }
    };
    let (code, call) = tokio::join!(run(app, &mock), raising);
    assert_eq!(code, 130);
    assert!(call.signal.is_cancelled());
    assert!(!parent(&file_of(&call)).exists());
}

#[tokio::test]
async fn failure_closing_the_input_region_aborts_the_editor_spawn_and_leaves_the_report_last() {
    let folder = Folder::new();
    let (mock, ready) = hanging(&folder, &[], |_| {});
    let watched = ready.clone();
    let app: App = Application::new("edit").action(move |ctx: Context| {
        let mut ready = watched.clone();
        async move {
            let editing = editor(&ctx, EditorSettings::new("Notes"), Verbatim);
            tokio::select! {
                _ = editing => Ok(()),
                _ = ready.wait_for(Option::is_some) => Err(ctx.out.fatal("failed-during-edit")),
            }
        }
    });
    assert_eq!(run(app, &mock).await, 1);
    let call = ready.borrow().clone().unwrap();
    for _ in 0..20 {
        if call.signal.is_cancelled() {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(call.signal.is_cancelled());
    assert!(!parent(&file_of(&call)).exists());
    assert!(
        strip(&mock.stderr_text())
            .trim_end()
            .ends_with("failed-during-edit")
    );
}

#[tokio::test]
async fn a_shutdown_that_cuts_the_run_off_while_the_editor_runs_ends_it_and_removes_its_folder() {
    let folder = Folder::new();
    let removed = Arc::new(Mutex::new(None));
    let noted = Arc::clone(&removed);
    let cell: Arc<OnceLock<Arc<MockProcess>>> = Arc::new(OnceLock::new());
    let held = Arc::clone(&cell);
    let (mock, ready) = hanging(&folder, &[], move |call| {
        if let Some(mock) = held.get() {
            // The first SIGTERM starts the shutdown, and the second ends it at once; its shutdown
            // handlers run inside that raise, before the question's own cleanup.
            mock.raise(ProcessSignal::Term);
            mock.raise(ProcessSignal::Term);
            *noted.lock().unwrap() = Some(!parent(&file_of(call)).exists());
        }
    });
    let _ = cell.set(Arc::clone(&mock));
    let (app, _) = asking("edit", || EditorSettings::new("Notes"));
    let running =
        tokio::spawn(app.run(loomcli_core::RunOptions::new().process(Arc::clone(&mock) as _)));
    for _ in 0..200 {
        if mock.ended_by() == Some(ProcessSignal::Term) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    running.abort();
    assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
    let call = ready.borrow().clone().unwrap();
    assert!(call.signal.is_cancelled());
    assert_eq!(*removed.lock().unwrap(), Some(true));
}

#[tokio::test]
async fn the_cancelled_line_waits_for_the_lend_and_lands_below_what_the_editor_wrote() {
    use loomcli_core::ProcessHandle;
    let folder = Folder::new();
    let cell: Arc<OnceLock<Arc<MockProcess>>> = Arc::new(OnceLock::new());
    let held = Arc::clone(&cell);
    let (mock, _) = hanging(&folder, &[("NO_COLOR", "1")], move |_| {
        if let Some(mock) = held.get() {
            let stderr = mock.stderr();
            let mut writing = std::pin::pin!(stderr.write(b"EDITOR-SCREEN"));
            let mut context = std::task::Context::from_waker(std::task::Waker::noop());
            let _ = writing.as_mut().poll(&mut context);
            mock.raise(ProcessSignal::Int);
        }
    });
    let _ = cell.set(Arc::clone(&mock));
    let (app, _) = asking("edit", || EditorSettings::new("Notes"));
    assert_eq!(run(app, &mock).await, 130);
    let stderr = mock.stderr_text();
    let after = &stderr[stderr.find("EDITOR-SCREEN").unwrap()..];
    assert!(!after.contains("\u{1b}[J"), "{after:?}");
    assert!(!after.contains("\u{1b}[1A"), "{after:?}");
    assert_eq!(strip(after), "EDITOR-SCREEN\n? Notes · cancelled\n");
}

#[tokio::test]
async fn an_unstarted_shell_reports_editor_error_without_an_exit_status_and_cleans_up() {
    let folder = Folder::new();
    let file = Arc::new(Mutex::new(PathBuf::new()));
    let seen = Arc::clone(&file);
    let mock = editing(
        &[("EDITOR", "nano"), ("TMPDIR", folder.path())],
        vec![entry("\r")],
        move |call| {
            *seen.lock().unwrap() = file_of(&call);
            Err(std::io::Error::other("unstarted"))
        },
    );
    let (app, answer) = asking("edit", || EditorSettings::new("Notes"));
    assert_eq!(run(app, &mock).await, 1);
    let caught = answered(&answer).unwrap().unwrap_err();
    assert!(caught.starts_with("nano|None|"), "{caught}");
    assert!(!parent(&file.lock().unwrap()).exists());
}

#[tokio::test]
async fn noninteractive_unsupplied_editor_fails_without_spawning() {
    for linked in [false, true] {
        let make = || -> App {
            Application::new("edit")
                .option("notes", Opt::string())
                .action(move |ctx: Context| async move {
                    let settings = if linked {
                        EditorSettings::new("Notes").option("notes")
                    } else {
                        EditorSettings::new("Notes")
                    };
                    editor(&ctx, settings, Verbatim).await?;
                    Ok(())
                })
        };
        let mock = mock_process(MockFields::new());
        assert_eq!(run(make(), &mock).await, if linked { 2 } else { 1 });
        let invoked = make()
            .invoke(
                &[],
                InvocationValues::new(),
                InvokeOptions::new(),
                Some(mock_process(MockFields::new()) as _),
            )
            .await;
        match invoked {
            InvocationOutcome::Failed { exit_code, .. } => {
                assert_eq!(exit_code.get(), if linked { 2 } else { 1 });
            }
            _ => panic!("the invocation did not fail"),
        }
    }
}

#[tokio::test]
async fn an_editor_asked_at_once_with_a_text_question_discards_the_rest_of_the_read_its_enter_ended()
 {
    let folder = Folder::new();
    let spawned = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&spawned);
    let mock = editing(
        &[("TMPDIR", folder.path())],
        vec![reads(&["42\r\r", "\u{4}"])],
        move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(ProgramAnswer::new())
        },
    );
    let typed = Arc::new(Mutex::new(String::new()));
    let kept = Arc::clone(&typed);
    let app: App = Application::new("edit").action(move |ctx: Context| {
        let kept = Arc::clone(&kept);
        async move {
            let asked = text(&ctx, TextSettings::new("Port"), Verbatim);
            let (first, second) = tokio::join!(
                async {
                    let value = asked.await?;
                    *kept.lock().unwrap() = value;
                    Ok::<(), Error>(())
                },
                editor(&ctx, EditorSettings::new("Notes"), Verbatim)
            );
            first?;
            second?;
            Ok(())
        }
    });
    assert_eq!(run(app, &mock).await, 130);
    assert_eq!(*typed.lock().unwrap(), "42");
    assert_eq!(spawned.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn an_editor_asked_after_a_text_question_discards_the_keys_left_in_the_read_that_answered_it()
{
    let folder = Folder::new();
    let spawned = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&spawned);
    let mock = editing(
        &[("TMPDIR", folder.path())],
        vec![entry("42\r\r"), entry("\u{4}")],
        move |_| {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(ProgramAnswer::new())
        },
    );
    let app: App = Application::new("edit").action(|ctx: Context| async move {
        assert_eq!(text(&ctx, TextSettings::new("Port"), Verbatim).await?, "42");
        editor(&ctx, EditorSettings::new("Notes"), Verbatim).await?;
        Ok(())
    });
    assert_eq!(run(app, &mock).await, 130);
    assert_eq!(spawned.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_removed_file_comes_back_with_the_bytes_it_held_when_that_editor_opened() {
    let folder = Folder::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let reopened = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&reopened);
    let mock = editing(
        &[("TMPDIR", folder.path())],
        vec![entry("\r"), entry("\r"), entry("\r")],
        move |call| {
            let file = file_of(&call);
            match counted.fetch_add(1, Ordering::SeqCst) {
                0 => std::fs::write(&file, [255]).unwrap(),
                1 => std::fs::remove_file(&file).unwrap(),
                _ => {
                    *kept.lock().unwrap() = std::fs::read(&file).unwrap();
                    std::fs::write(&file, "good\n").unwrap();
                }
            }
            Ok(ProgramAnswer::new())
        },
    );
    let (app, answer) = asking("edit", || EditorSettings::new("Notes").default("seed"));
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(answered(&answer), Some(Ok("good\n".to_owned())));
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert_eq!(*reopened.lock().unwrap(), [255]);
}

#[tokio::test]
async fn a_file_the_question_cannot_read_after_the_editor_exits_is_an_issue_and_enter_reopens_what_it_last_held()
 {
    let folder = Folder::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let reopened = Arc::new(Mutex::new((String::new(), 0)));
    let kept = Arc::clone(&reopened);
    let mock = editing_with(
        MockFields::new(),
        &[("NO_COLOR", "1"), ("TMPDIR", folder.path())],
        120,
        vec![entry("\r"), entry("\r")],
        move |call| {
            let file = file_of(&call);
            if counted.fetch_add(1, Ordering::SeqCst) == 0 {
                std::fs::remove_file(&file).unwrap();
                std::fs::create_dir(&file).unwrap();
            } else {
                *kept.lock().unwrap() = (
                    std::fs::read_to_string(&file).unwrap(),
                    std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                );
                std::fs::write(&file, "good\n").unwrap();
            }
            Ok(ProgramAnswer::new())
        },
    );
    let (app, answer) = asking("edit", || EditorSettings::new("Notes").default("seed"));
    assert_eq!(run(app, &mock).await, 0);
    assert_eq!(answered(&answer), Some(Ok("good\n".to_owned())));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(*reopened.lock().unwrap(), ("seed".to_owned(), 0o600));
    assert!(strip(&mock.stderr_text()).contains(
        "The question cannot read the answer's file (EISDIR). Save the answer as a file before you close the editor."
    ));
}

#[tokio::test]
async fn a_suspend_and_resume_while_the_editor_runs_enter_no_raw_mode_hide_no_cursor_and_take_no_entry()
 {
    let folder = Folder::new();
    let start = Arc::new(AtomicUsize::new(0));
    let marked = Arc::clone(&start);
    let cell: Arc<OnceLock<Arc<MockProcess>>> = Arc::new(OnceLock::new());
    let held = Arc::clone(&cell);
    let raw = Arc::new(Mutex::new(false));
    let noted = Arc::clone(&raw);
    let mock = editing(
        &[("TMPDIR", folder.path())],
        vec![entry("\r")],
        move |call| {
            if let Some(mock) = held.get() {
                marked.store(mock.stderr_text().len(), Ordering::SeqCst);
                mock.raise(ProcessSignal::Tstp);
                *noted.lock().unwrap() = mock.is_raw();
            }
            std::fs::write(file_of(&call), "good\n").unwrap();
            Ok(ProgramAnswer::new())
        },
    );
    let _ = cell.set(Arc::clone(&mock));
    let (app, answer) = asking("edit", || EditorSettings::new("Notes"));
    assert_eq!(run(app, &mock).await, 0, "{:?}", mock.stderr_text());
    assert_eq!(answered(&answer), Some(Ok("good\n".to_owned())));
    assert!(!*raw.lock().unwrap());
    assert!(!mock.is_raw());
    let stderr = mock.stderr_text();
    assert!(!stderr[start.load(Ordering::SeqCst)..].contains("\u{1b}[?25l"));
}

#[tokio::test]
async fn the_folder_is_named_for_the_application_and_six_characters_inside_tmpdir() {
    let folder = Folder::new();
    let file = Arc::new(Mutex::new(PathBuf::new()));
    let seen = Arc::clone(&file);
    let mock = editing(
        &[("TMPDIR", folder.path())],
        vec![entry("\r")],
        move |call| {
            *seen.lock().unwrap() = file_of(&call);
            Ok(ProgramAnswer::new())
        },
    );
    let (app, _) = asking("notes-app", || EditorSettings::new("Notes"));
    assert_eq!(run(app, &mock).await, 0);
    let file = file.lock().unwrap().clone();
    let named = parent(&file);
    assert_eq!(named.parent().unwrap(), folder.0.as_path());
    let name = named.file_name().unwrap().to_string_lossy().into_owned();
    let suffix = name.strip_prefix("notes-app-").unwrap();
    assert_eq!(suffix.len(), 6);
    assert!(
        suffix
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    );
}

#[tokio::test]
async fn the_extension_names_the_file() {
    for (extension, name) in [
        (Some(".md"), "answer.md"),
        (Some(""), "answer"),
        (None, "answer"),
    ] {
        let folder = Folder::new();
        let file = Arc::new(Mutex::new(PathBuf::new()));
        let seen = Arc::clone(&file);
        let mock = editing(
            &[("TMPDIR", folder.path())],
            vec![entry("\r")],
            move |call| {
                *seen.lock().unwrap() = file_of(&call);
                Ok(ProgramAnswer::new())
            },
        );
        let (app, _) = asking("edit", move || match extension {
            Some(extension) => EditorSettings::new("Notes").extension(extension),
            None => EditorSettings::new("Notes"),
        });
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(
            file.lock().unwrap().file_name().unwrap().to_string_lossy(),
            name
        );
    }
}

/// What a view draws on a terminal of `columns` with `NO_COLOR`.
async fn drawn_plain<D: Clone + Send + Sync + 'static>(
    columns: u16,
    data: D,
    draw: fn(&Context, D) -> futures_draw::Drawing<'_>,
) -> String {
    let mock = mock_process(
        MockFields::new()
            .env("NO_COLOR", "1")
            .terminal(MockTerminal::new(columns, 24)),
    );
    let app: App = Application::new("draw").action(move |ctx: Context| {
        let data = data.clone();
        async move { draw(&ctx, data).await }
    });
    assert_eq!(run(app, &mock).await, 0);
    mock.stderr_text()
}

mod futures_draw {
    use loomcli_core::{Context, Error};

    pub type Drawing<'a> =
        std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), Error>> + Send + 'a>>;

    pub fn frame(context: &Context, data: super::QuestionFrame) -> Drawing<'_> {
        Box::pin(async move {
            context.out.draw(&data, &super::question_frame()).await?;
            Ok(())
        })
    }

    pub fn answered(context: &Context, data: super::AnsweredLine) -> Drawing<'_> {
        Box::pin(async move {
            context.out.draw(&data, &super::answered_line()).await?;
            Ok(())
        })
    }
}

#[tokio::test]
async fn the_editor_frame_fits_its_columns_with_no_cursor_block() {
    for (columns, editing, expected) in [
        (80, false, "? Notes › Press Enter to open your editor"),
        (
            80,
            true,
            "? Notes › Waiting for your editor to close the file…",
        ),
        (24, false, "? N…s › Press Enter to …"),
        (1, false, ""),
        (2, false, "?"),
        (3, false, "? "),
    ] {
        let frame: QuestionFrame = EditorFrame::new("Notes", editing).into();
        let text = drawn_plain(columns, frame, futures_draw::frame).await;
        assert_eq!(strip(&text), expected, "{columns} {editing}");
        assert!(!text.contains("\u{1b}[7m"));
    }
}

#[tokio::test]
async fn the_editor_answered_line_fits_its_columns() {
    for (columns, expected) in [
        (80, "? Notes · abcdefghijklmnop (+1 line)\n"),
        (24, "? Notes · abc… (+1 line)\n"),
        (12, "? … · …\n"),
        (1, "?\n"),
    ] {
        let line = AnsweredLine::new("Notes", Some("abcdefghijklmnop".to_owned()))
            .kind(QuestionKind::Editor)
            .lines(2);
        let text = drawn_plain(columns, line, futures_draw::answered).await;
        assert_eq!(strip(&text), expected, "{columns}");
    }
}

#[tokio::test]
async fn the_editor_answered_line_keeps_its_styles_as_it_clips() {
    for (columns, answer, expected) in [
        (
            80,
            "abcdefghijklmnop",
            "\u{1b}[2m?\u{1b}[22m Notes \u{1b}[2m·\u{1b}[22m \u{1b}[4mabcdefghijklmnop\u{1b}[24m \u{1b}[2m(+1 line)\u{1b}[22m\n",
        ),
        (
            14,
            "",
            "\u{1b}[2m?\u{1b}[22m Notes \u{1b}[2m·\u{1b}[22m \u{1b}[2memp…\u{1b}[22m\n",
        ),
        (
            5,
            "abcdefghijklmnop",
            "\u{1b}[2m?\u{1b}[22m … \u{1b}[2m·\u{1b}[22m\n",
        ),
        (6, "", "\u{1b}[2m?\u{1b}[22m … \u{1b}[2m·\u{1b}[22m \n"),
        (3, "abcdefghijklmnop", "\u{1b}[2m?\u{1b}[22m …\n"),
    ] {
        let line = AnsweredLine::new("Notes", Some(answer.to_owned()))
            .kind(QuestionKind::Editor)
            .lines(2);
        let app: App = Application::new("draw")
            .plugins([Plugin::new("fixture/theme").theme(
                ThemeMapping::new()
                    .entry("dim", style().faint())
                    .entry("highlight", style().underline()),
            )])
            .action(move |ctx: Context| {
                let line = line.clone();
                async move {
                    ctx.out.draw(&line, &answered_line()).await?;
                    Ok(())
                }
            });
        let mock = mock_process(
            MockFields::new()
                .terminal(MockTerminal::new(columns, 24).streams([StreamName::Stderr])),
        );
        assert_eq!(run(app, &mock).await, 0);
        assert_eq!(mock.stderr_text(), expected, "{columns} {answer:?}");
    }
}
