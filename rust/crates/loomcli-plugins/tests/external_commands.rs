//! External commands through the application's public entry points, from external-commands.test.ts.

#![cfg(all(
    feature = "external-commands",
    feature = "help",
    feature = "suggestions"
))]
#![allow(clippy::unwrap_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use loomcli_core::{
    AnyPlugin, Application, Command, Context, GroupApplication, NoInputs, NoResult, Outcome,
    RunOptions,
};
use loomcli_plugins::external_commands::external_commands;
use loomcli_plugins::help::help;
use loomcli_plugins::suggestions::suggestions;
use loomcli_testing::{MockFields, MockProcess, ProgramAnswer, mock_process};

type App = GroupApplication<NoInputs, NoResult>;

async fn noop(_: Context) -> Outcome {
    Ok(())
}

fn notes(plugins: Vec<AnyPlugin>) -> App {
    Application::new("notes")
        .plugins(plugins)
        .global_option("dry-run", loomcli_core::Opt::boolean())
        .command(Command::new("add").action(noop))
        .command(Command::new("list").action(noop))
        .command(Command::new("secret").hidden().action(noop))
}

fn plugins(external: bool) -> Vec<AnyPlugin> {
    let mut plugins = vec![help().into(), suggestions().into()];
    if external {
        plugins.push(external_commands().into());
    }
    plugins
}

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.scratch");
        fs::create_dir_all(&base).unwrap();
        let base = fs::canonicalize(base).unwrap();
        let path = base.join(format!(
            "external-commands-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn folder(&self, name: &str) -> PathBuf {
        let folder = self.0.join(name);
        fs::create_dir(&folder).unwrap();
        folder
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

async fn run(app: &App, fields: MockFields) -> (u8, Arc<MockProcess>) {
    let process = mock_process(fields);
    let code = app
        .run(RunOptions::new().process(Arc::clone(&process) as _))
        .await;
    assert_eq!(process.exit_code(), Some(code));
    (code.get(), process)
}

fn path_text(path: &Path) -> &str {
    path.to_str().unwrap()
}

#[tokio::test]
async fn windows_uses_the_sorted_path_key_and_tries_com_before_exe() {
    let scratch = Scratch::new();
    let bin = scratch.folder("bin");
    let other = scratch.folder("other");
    let program = bin.join("notes-foo.com");
    for file in [
        &program,
        &bin.join("notes-foo.exe"),
        &other.join("notes-foo.com"),
    ] {
        fs::write(file, "").unwrap();
    }
    let (code, process) = run(
        &notes(plugins(true)),
        MockFields::new()
            .argv(["foo"])
            .env("PATH", path_text(&bin))
            .env("Path", path_text(&other))
            .platform("win32")
            .script(path_text(&program), |_| async {
                Ok(ProgramAnswer::new().code(-1_073_741_819))
            }),
    )
    .await;
    assert_eq!(code, 1);
    assert_eq!(process.calls().len(), 1);
    assert_eq!(process.calls()[0].command, path_text(&program));
    assert_eq!(process.stdout_text(), "");
    assert_eq!(process.stderr_text(), "");
}

fn unknown(word: &str) -> String {
    format!(
        "notes: Unknown command \"{word}\". Use one of: add, list.\nRun \"notes --help\" to see the usage.\n"
    )
}

fn assert_run(code: u8, process: &MockProcess, expected: u8, stdout: &str, stderr: &str) {
    assert_eq!(code, expected);
    assert_eq!(process.stdout_text(), stdout);
    assert_eq!(process.stderr_text(), stderr);
}

#[tokio::test]
async fn absent_programs_preserve_unknown_command_reports_with_and_without_the_plugin() {
    use loomcli_core::{InvocationOutcome, InvocationValues, InvokeOptions};

    let unknown_nope = unknown("nope");
    let suggested = "notes: Unknown command \"lsit\". Did you mean \"list\"?\n";
    let help_hint = "Run \"notes --help\" to see the usage.\n";
    let cases: &[(&[&str], &str)] = &[
        (&["nope"], &unknown_nope),
        (&["nope", "--bad"], &unknown_nope),
        (&["--help", "nope"], &unknown_nope),
        (&["nope", "a", "--b"], &unknown_nope),
        (&["lsit"], &format!("{suggested}{help_hint}")),
    ];

    for enabled in [false, true] {
        let app = notes(plugins(enabled));
        for &(argv, expected) in cases {
            let (code, process) = run(&app, MockFields::new().argv(argv.iter().copied())).await;
            assert_run(code, &process, 2, "", expected);
        }
        for (word, expected) in [
            (
                "nope",
                "notes: Unknown command \"nope\". Use one of: add, list.\n",
            ),
            ("lsit", suggested),
        ] {
            let outcome = app
                .invoke(
                    &[word],
                    InvocationValues::new(),
                    InvokeOptions::new(),
                    Some(mock_process(MockFields::new())),
                )
                .await;
            let InvocationOutcome::Failed {
                exit_code,
                form,
                output,
                messages,
                ..
            } = outcome
            else {
                panic!("expected an unknown command: {outcome:?}");
            };
            assert_eq!(exit_code.get(), 2);
            assert_eq!(form.code, "unknown-command");
            assert_eq!(form.exit_code.get(), 2);
            assert!(form.hints.is_empty());
            assert_eq!(output, "");
            assert_eq!(messages, expected);
            if word == "nope" {
                assert_eq!(
                    form.message,
                    r#"Unknown command "nope". Use one of: add, list."#
                );
            }
        }
    }
}

#[cfg(unix)]
mod unix {
    use super::*;

    use std::io;
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::sync::Mutex;

    use loomcli_core::{
        Env, InvocationOutcome, InvocationValues, InvokeOptions, LogLevel, Plugin, ProcessFields,
        process_handle,
    };
    use rustix::io::Errno;
    use serde_json::{Value, json};

    fn file(folder: &Path, name: &str, contents: &str, mode: u32) -> PathBuf {
        let program = folder.join(name);
        fs::write(&program, contents).unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(mode)).unwrap();
        program
    }

    fn program(folder: &Path, name: &str) -> PathBuf {
        file(folder, name, "#!/bin/sh\nexit 0\n", 0o755)
    }

    fn path_list(entries: &[&Path]) -> String {
        std::env::join_paths(entries)
            .unwrap()
            .into_string()
            .unwrap()
    }

    async fn real(fields: ProcessFields) -> u8 {
        notes(plugins(true))
            .run(RunOptions::new().process(process_handle(fields)))
            .await
            .get()
    }

    #[tokio::test]
    async fn a_real_program_receives_separate_arguments_and_returns_its_exit_code() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        let out = scratch.0.join("argv.txt");
        file(
            &bin,
            "notes-foo",
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$OUT\"\nexit 7\n",
            0o755,
        );
        let fields = ProcessFields::new()
            .argv(["foo", "a", "--b", "$HOME", "x y"])
            .cwd(&scratch.0)
            .env(Env::from([
                ("PATH".to_owned(), path_text(&bin).to_owned()),
                ("OUT".to_owned(), path_text(&out).to_owned()),
            ]));
        assert_eq!(real(fields).await, 7);
        assert_eq!(fs::read_to_string(&out).unwrap(), "a\n--b\n$HOME\nx y\n");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn a_real_script_without_a_shebang_receives_its_path_and_separate_arguments() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin with spaces");
        let script = file(
            &bin,
            "notes-foo",
            "printf '%s\\n' \"$0\" \"$@\" > \"$OUT\"\nexit 7\n",
            0o755,
        );
        let fields = ProcessFields::new()
            .argv(["foo", "a", "--b", "--", "$HOME", "x y"])
            .cwd(&scratch.0)
            .home(&scratch.0)
            .env(Env::from([
                ("PATH".to_owned(), path_text(&bin).to_owned()),
                ("OUT".to_owned(), "argv.txt".to_owned()),
            ]));
        assert_eq!(real(fields).await, 7);
        assert_eq!(
            fs::read_to_string(scratch.0.join("argv.txt")).unwrap(),
            format!("{}\na\n--b\n--\n$HOME\nx y\n", path_text(&script)),
        );
    }

    #[tokio::test]
    async fn a_real_signalled_child_exits_with_128_plus_the_signal() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        file(&bin, "notes-foo", "#!/bin/sh\nkill -TERM $$\n", 0o755);
        let fields = ProcessFields::new()
            .argv(["foo"])
            .cwd(&scratch.0)
            .env(Env::from([("PATH".to_owned(), path_text(&bin).to_owned())]));
        assert_eq!(real(fields).await, 143);
    }

    #[tokio::test]
    async fn declared_hidden_and_aliased_commands_win_over_path() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        let file = program(&bin, "notes-foo");
        for command in [
            Command::new("foo"),
            Command::new("foo").hidden(),
            Command::new("sync").alias("foo"),
        ] {
            let app = notes(plugins(true)).command(
                command.action(|ctx: Context| async move { ctx.out.print("declared foo").await }),
            );
            let (code, process) = run(
                &app,
                MockFields::new()
                    .argv(["foo"])
                    .env("PATH", path_text(&bin))
                    .script(path_text(&file), |_| async {
                        Ok(ProgramAnswer::new().code(99))
                    }),
            )
            .await;
            assert_run(code, &process, 0, "declared foo\n", "");
            assert!(process.calls().is_empty());
        }
    }

    #[tokio::test]
    async fn the_child_inherits_streams_and_the_prepared_environment_and_receives_the_unread_tail()
    {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        let program = program(&bin, "notes-foo");
        let path = path_text(&bin).to_owned();
        let env = Plugin::new("@fixture/path").on_environment(move |_| {
            let path = path.clone();
            async move { Ok(Env::from([("PATH".to_owned(), path)])) }
        });
        let mut installed = plugins(true);
        installed.insert(0, env.into());
        let (code, process) = run(
            &notes(installed),
            MockFields::new()
                .argv(["foo", "a", "--b", "--", "c"])
                .cwd(&scratch.0)
                .env("HOME", "/fixture/home")
                .stdin("input\n")
                .script(path_text(&program), |_| async {
                    Ok(ProgramAnswer::new()
                        .code(3)
                        .stdout("child out\n")
                        .stderr("child err\n"))
                }),
        )
        .await;
        assert_run(code, &process, 3, "child out\n", "child err\n");
        let calls = process.calls();
        assert_eq!(calls.len(), 1);
        let call = &calls[0];
        assert_eq!(call.args, ["a", "--b", "--", "c"]);
        assert_eq!(call.cwd, scratch.0);
        assert_eq!(
            call.env,
            Env::from([
                ("HOME".to_owned(), "/fixture/home".to_owned()),
                ("PATH".to_owned(), path_text(&bin).to_owned()),
            ])
        );
        assert_eq!(call.input, "input\n");
        assert!(!call.detached);
    }

    #[tokio::test]
    async fn a_word_outside_the_portable_grammar_never_starts_a_program() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        let matching_dir = scratch.folder("bin/notes-a");
        program(&matching_dir, "b");
        program(&bin, "notes-.hidden");
        for word in ["a/b", ".hidden"] {
            let (code, process) = run(
                &notes(plugins(true)),
                MockFields::new().argv([word]).env("PATH", path_text(&bin)),
            )
            .await;
            assert_run(code, &process, 2, "", &unknown(word));
            assert!(process.calls().is_empty());
        }
    }

    #[tokio::test]
    async fn a_word_after_an_option_never_starts_a_program() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        program(&bin, "notes-foo");
        for before in ["--help", "--dry-run"] {
            let (code, process) = run(
                &notes(plugins(true)),
                MockFields::new()
                    .argv([before, "foo"])
                    .env("PATH", path_text(&bin)),
            )
            .await;
            assert_run(code, &process, 2, "", &unknown("foo"));
            assert!(process.calls().is_empty());
        }
    }

    #[tokio::test]
    async fn a_nested_unknown_word_that_repeats_the_first_word_never_starts_a_program() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        program(&bin, "notes-cache");
        let app = Application::new("notes")
            .plugins([external_commands()])
            .command(Command::new("cache").command(Command::new("clear").action(noop)));
        let (code, process) = run(
            &app,
            MockFields::new()
                .argv(["cache", "cache", "--all"])
                .env("PATH", path_text(&bin)),
        )
        .await;
        assert_run(
            code,
            &process,
            2,
            "",
            "notes: Unknown command \"cache\". Use one of: clear.\n",
        );
        assert!(process.calls().is_empty());
    }

    #[tokio::test]
    async fn lookup_passes_over_a_nonexecutable_and_starts_a_later_executable() {
        let scratch = Scratch::new();
        let first = scratch.folder("first");
        let second = scratch.folder("second");
        file(&first, "notes-foo", "#!/bin/sh\n", 0o644);
        let executable = program(&second, "notes-foo");
        let (code, process) = run(
            &notes(plugins(true)),
            MockFields::new()
                .argv(["foo"])
                .env("PATH", &path_list(&[&first, &second]))
                .script(path_text(&executable), |_| async {
                    Ok(ProgramAnswer::new())
                }),
        )
        .await;
        assert_run(code, &process, 0, "", "");
        assert_eq!(process.calls()[0].command, path_text(&executable));
    }

    #[tokio::test]
    async fn a_nonexecutable_alone_leaves_the_command_unknown() {
        let scratch = Scratch::new();
        file(&scratch.0, "notes-foo", "#!/bin/sh\n", 0o644);
        let (code, process) = run(
            &notes(plugins(true)),
            MockFields::new()
                .argv(["foo"])
                .env("PATH", path_text(&scratch.0)),
        )
        .await;
        assert_run(code, &process, 2, "", &unknown("foo"));
        assert!(process.calls().is_empty());
    }

    #[tokio::test]
    async fn a_directory_dangling_link_and_relative_path_entry_are_skipped() {
        let scratch = Scratch::new();
        let directory = scratch.folder("directory");
        scratch.folder("directory/notes-foo");
        let links = scratch.folder("links");
        symlink(scratch.0.join("missing"), links.join("notes-foo")).unwrap();
        let relative = scratch.folder("relative");
        program(&relative, "notes-foo");
        program(&scratch.0, "notes-foo");
        let (code, process) = run(
            &notes(plugins(true)),
            MockFields::new().cwd(&scratch.0).argv(["foo"]).env(
                "PATH",
                &path_list(&[&directory, &links, Path::new(""), Path::new("relative")]),
            ),
        )
        .await;
        assert_run(code, &process, 2, "", &unknown("foo"));
        assert!(process.calls().is_empty());
    }

    #[tokio::test]
    async fn a_failed_start_reports_the_named_cause_or_the_no_code_sentence() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin\t");
        let program = program(&bin, "notes-foo");
        let shown = path_text(&program).replace('\t', "\\u0009");
        for (platform, errno, reason) in [
            (
                "linux",
                Some(Errno::ACCESS),
                "the system does not allow it to run. Check its permissions and the file system it is on, or remove it from PATH.",
            ),
            (
                "linux",
                Some(Errno::NOENT),
                "the interpreter its first line names, or the file itself, is missing. Install the interpreter, or remove the file from PATH.",
            ),
            (
                "darwin",
                Some(Errno::NOEXEC),
                "this system cannot run it as a program. Replace it with a program for this system, or remove it from PATH.",
            ),
            (
                "linux",
                Some(Errno::TOOBIG),
                "the system refused to start it (E2BIG). Check that it is a program this system can run, or remove it from PATH.",
            ),
            (
                "linux",
                None,
                "the system refused to start it. Check that it is a program this system can run, or remove it from PATH.",
            ),
        ] {
            let (code, process) = run(
                &notes(plugins(true)),
                MockFields::new()
                    .platform(platform)
                    .argv(["foo"])
                    .env("PATH", path_text(&bin))
                    .script(path_text(&program), move |_| async move {
                        Err(errno
                            .map_or_else(|| io::Error::other("mock private message"), Into::into))
                    }),
            )
            .await;
            assert_run(
                code,
                &process,
                1,
                "",
                &format!("notes cannot run {shown}, because {reason}\n"),
            );
            assert_eq!(process.calls().len(), 1);
        }
    }

    #[tokio::test]
    async fn linux_retries_enoexec_with_the_script_path_and_inherited_streams() {
        let scratch = Scratch::new();
        let program = file(&scratch.0, "notes-foo", "exit 7\n", 0o755);
        let (code, process) = run(
            &notes(plugins(true)),
            MockFields::new()
                .platform("linux")
                .argv(["foo", "--", "x y"])
                .cwd(&scratch.0)
                .env("PATH", path_text(&scratch.0))
                .stdin("input\n")
                .script(path_text(&program), |_| async { Err(Errno::NOEXEC.into()) })
                .script("/bin/sh", |_| async {
                    Ok(ProgramAnswer::new()
                        .code(7)
                        .stdout("child out\n")
                        .stderr("child err\n"))
                }),
        )
        .await;
        assert_run(code, &process, 7, "child out\n", "child err\n");
        let calls = process.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].command, path_text(&program));
        assert_eq!(calls[0].args, ["--", "x y"]);
        assert_eq!(calls[1].command, "/bin/sh");
        assert_eq!(calls[1].args, [path_text(&program), "--", "x y"]);
        assert_eq!(calls[1].cwd, scratch.0);
        assert_eq!(calls[1].env, calls[0].env);
        assert_eq!(calls[1].input, "input\n");
        assert!(!calls[1].detached);
    }

    #[tokio::test]
    async fn linux_reports_the_original_enoexec_when_the_shell_cannot_start() {
        let scratch = Scratch::new();
        let program = file(&scratch.0, "notes-foo", "exit 7\n", 0o755);
        let (code, process) = run(
            &notes(plugins(true)),
            MockFields::new()
                .platform("linux")
                .argv(["foo"])
                .env("PATH", path_text(&scratch.0))
                .script(path_text(&program), |_| async { Err(Errno::NOEXEC.into()) })
                .script("/bin/sh", |_| async { Err(Errno::NOENT.into()) }),
        )
        .await;
        assert_run(
            code,
            &process,
            1,
            "",
            &format!(
                "notes cannot run {}, because this system cannot run it as a program. Replace it with a program for this system, or remove it from PATH.\n",
                path_text(&program),
            ),
        );
        assert_eq!(process.calls().len(), 2);
        assert_eq!(process.calls()[1].command, "/bin/sh");
    }

    #[tokio::test]
    async fn an_invocation_by_name_never_starts_an_external_program() {
        let scratch = Scratch::new();
        let program = program(&scratch.0, "notes-foo");
        let process = mock_process(
            MockFields::new()
                .env("PATH", path_text(&scratch.0))
                .script(path_text(&program), |_| async { Ok(ProgramAnswer::new()) }),
        );
        let outcome = notes(plugins(true))
            .invoke(
                &["foo"],
                InvocationValues::new(),
                InvokeOptions::new(),
                Some(Arc::clone(&process) as _),
            )
            .await;
        assert!(
            matches!(outcome, InvocationOutcome::Failed { exit_code, .. } if exit_code.get() == 2)
        );
        assert!(process.calls().is_empty());
    }

    #[tokio::test]
    async fn lookup_and_start_publish_the_reference_log_templates_and_fields() {
        let scratch = Scratch::new();
        let empty = scratch.folder("empty\t");
        let bin = scratch.folder("bin\t");
        let program = program(&bin, "notes-foo");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let observer = Plugin::new("@fixture/observer").on_log({
            let seen = Arc::clone(&seen);
            move |event, _| {
                if event.plugin.as_deref() == Some("@loomcli/plugins/external-commands") {
                    seen.lock().unwrap().push((
                        event.level,
                        event.message.clone(),
                        Value::Object(event.fields.clone()),
                    ));
                }
            }
        });
        let (code, process) = run(
            &notes(vec![observer.into(), external_commands().into()]),
            MockFields::new()
                .argv(["foo"])
                .env("PATH", &path_list(&[&empty, &bin]))
                .script(path_text(&program), |_| async { Ok(ProgramAnswer::new()) }),
        )
        .await;
        assert_run(code, &process, 0, "", "");
        assert_eq!(
            *seen.lock().unwrap(),
            [
                (
                    LogLevel::Trace,
                    "No {program} in {folder}.".to_owned(),
                    json!({"folder": path_text(&empty).replace('\t', "\\u0009"), "program": "notes-foo"}),
                ),
                (
                    LogLevel::Debug,
                    "Running {program}.".to_owned(),
                    json!({"program": path_text(&program).replace('\t', "\\u0009")}),
                ),
            ]
        );
    }

    #[tokio::test]
    async fn lookup_resolves_dot_dot_lexically_before_testing_a_candidate() {
        let scratch = Scratch::new();
        let bin = scratch.folder("bin");
        let executable = program(&bin, "notes-foo");
        let spelling = scratch.0.join("absent").join("..").join("bin");
        let (code, process) = run(
            &notes(plugins(true)),
            MockFields::new()
                .argv(["foo"])
                .env("PATH", path_text(&spelling))
                .script(path_text(&executable), |_| async {
                    Ok(ProgramAnswer::new())
                }),
        )
        .await;
        assert_run(code, &process, 0, "", "");
        assert_eq!(process.calls()[0].command, path_text(&executable));
    }
}
