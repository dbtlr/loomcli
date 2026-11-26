//! The host a run captures from its process handle, through `run()` and `invoke`: the run-level
//! cases of `host.test.ts`, `process-handle.test.ts`, and `home-folders.test.ts` (`host.md`).
//! Capture reads each fact once at run entry and keeps that snapshot; a handle reused across runs
//! is read afresh by each; a run writes its code to the handle and an invocation by name writes
//! none; the folders, arch, libc, and uid copy from the handle at either door.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, Arg, BoxFuture, Build, Child, Command, Context, Env, Error, ExitCode,
    FailureFacts, InputStream, InvocationOutcome, InvocationValues, InvokeOptions, Libc,
    LogDestination, LogFields, OutputStream, OutputTerminal, Plugin, ProcessFields, ProcessHandle,
    ProcessTerminal, ReleaseFacts, RunOptions, SignalSource, SpawnRequest, SuppliedValue,
    WorkingDirectoryError, process_handle,
};
use loomcli_testing::{MockFields, MockProcess, mock_process};
use support::streams::{Facts, Scripted, Seen};

type Lines = Arc<Mutex<Vec<String>>>;

/// A stream that keeps what it is given.
#[derive(Default)]
struct Sink(Mutex<Vec<u8>>);

impl Sink {
    fn text(&self) -> String {
        String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
    }
}

impl OutputStream for Sink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(async { Ok(()) })
    }
}

/// How often a handle's facts were read.
#[derive(Default)]
struct Reads {
    argv: AtomicUsize,
    env: AtomicUsize,
    stderr: AtomicUsize,
    terminal: AtomicUsize,
    libc: AtomicUsize,
    time_zone: AtomicUsize,
}

fn count(counter: &AtomicUsize) -> usize {
    counter.fetch_add(1, Ordering::SeqCst)
}

/// A handle over a mock that counts its reads, answers argv and env a caller can change between
/// reads, and can hand out a different stderr after its first read.
struct Counted {
    mock: Arc<MockProcess>,
    reads: Arc<Reads>,
    argv: Mutex<Vec<String>>,
    env: Mutex<Env>,
    stdout: Option<Arc<dyn OutputStream>>,
    stderr: Vec<Arc<dyn OutputStream>>,
}

impl Counted {
    fn new(mock: Arc<MockProcess>, reads: &Arc<Reads>) -> Self {
        Self {
            argv: Mutex::new(mock.argv()),
            env: Mutex::new(mock.env()),
            mock,
            reads: Arc::clone(reads),
            stdout: None,
            stderr: Vec::new(),
        }
    }
}

impl ProcessHandle for Counted {
    fn argv(&self) -> Vec<String> {
        count(&self.reads.argv);
        self.argv.lock().unwrap().clone()
    }
    fn program(&self) -> Vec<String> {
        self.mock.program()
    }
    fn env(&self) -> Env {
        count(&self.reads.env);
        self.env.lock().unwrap().clone()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.mock.cwd()
    }
    fn home(&self) -> PathBuf {
        self.mock.home()
    }
    fn tmpdir(&self) -> PathBuf {
        self.mock.tmpdir()
    }
    fn platform(&self) -> String {
        self.mock.platform()
    }
    fn arch(&self) -> String {
        self.mock.arch()
    }
    fn libc(&self) -> Option<Libc> {
        count(&self.reads.libc);
        self.mock.libc()
    }
    fn uid(&self) -> Option<u32> {
        self.mock.uid()
    }
    fn time_zone(&self) -> String {
        count(&self.reads.time_zone);
        self.mock.time_zone()
    }
    fn release(&self) -> ReleaseFacts {
        self.mock.release()
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        self.mock.stdin()
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        self.stdout.clone().unwrap_or_else(|| self.mock.stdout())
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        let read = count(&self.reads.stderr);
        self.stderr
            .get(read.min(self.stderr.len().saturating_sub(1)))
            .cloned()
            .unwrap_or_else(|| self.mock.stderr())
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        count(&self.reads.terminal);
        self.mock.terminal()
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        self.mock.signals()
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        self.mock.spawn(request)
    }
    fn set_exit_code(&self, code: ExitCode) {
        self.mock.set_exit_code(code);
    }
}

fn distributed(fields: MockFields) -> Arc<MockProcess> {
    mock_process(fields.release(ReleaseFacts::new(Build::Distributed)))
}

// host.test.ts

#[tokio::test]
async fn capture_reads_each_fact_once_and_shares_stderr_with_fallback_reporting() {
    let reads = Arc::new(Reads::default());
    let refused: Arc<Mutex<Vec<Seen>>> = Arc::default();
    let first = Arc::new(Sink::default());
    let second = Arc::new(Sink::default());
    let mut handle = Counted::new(distributed(MockFields::new()), &reads);
    handle.stdout = Some(Scripted::refusing(0, io::ErrorKind::Other, Arc::clone(&refused)) as _);
    handle.stderr = vec![Arc::clone(&first) as _, Arc::clone(&second) as _];
    let saw_first = Arc::new(Mutex::new(false));
    let app = Application::new("host").action({
        let first: Arc<dyn OutputStream> = Arc::clone(&first) as _;
        let saw_first = Arc::clone(&saw_first);
        move |ctx: Context| {
            *saw_first.lock().unwrap() = Arc::ptr_eq(&ctx.host.stderr(), &first);
            async move { ctx.out.print("fail").await }
        }
    });
    let code = app.run(RunOptions::new().process(Arc::new(handle))).await;
    assert_eq!(code.get(), 1);
    assert!(*saw_first.lock().unwrap());
    assert_eq!(first.text(), "host: Something went wrong.\n");
    assert_eq!(second.text(), "");
    assert_eq!(
        *refused.lock().unwrap(),
        [Seen::Refused("fail\n".to_owned())]
    );
    assert_eq!(reads.stderr.load(Ordering::SeqCst), 1);
    assert_eq!(reads.terminal.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn capture_at_run_entry_keeps_argv_and_environment_snapshots() {
    let reads = Arc::new(Reads::default());
    let handle = Arc::new(Counted::new(
        distributed(
            MockFields::new()
                .argv(["before run", "two words"])
                .env("LOOM_CAPTURE_TEST", "at run"),
        ),
        &reads,
    ));
    let changing = Arc::clone(&handle);
    let app = Application::new("host")
        .argument("values", Arg::string().variadic().required())
        .action(move |ctx: Context| {
            let changing_stdout = changing.mock.stdout();
            let changing_stderr = changing.mock.stderr();
            // The handle answers differently once the run has started; the host keeps its copy.
            changing
                .argv
                .lock()
                .unwrap()
                .push("process mutation".to_owned());
            changing
                .env
                .lock()
                .unwrap()
                .insert("LOOM_CAPTURE_TEST".to_owned(), "changed".to_owned());
            async move {
                let terminal = &ctx.host.terminal;
                let streams = Arc::ptr_eq(&ctx.host.stdout(), &changing_stdout)
                    && Arc::ptr_eq(&ctx.host.stderr(), &changing_stderr);
                let line = format!(
                    "{streams} {:?} {:?} {:?} {} {} {}",
                    ctx.host.argv,
                    ctx.host.env.get("LOOM_CAPTURE_TEST"),
                    ctx.supplied.args.get("values").map(|values| match values {
                        SuppliedValue::Many(values) => values.clone(),
                        _ => Vec::new(),
                    }),
                    terminal.stdin().is_tty,
                    terminal.stdout().is_tty,
                    terminal.stderr().is_tty,
                );
                ctx.out.print(&line).await
            }
        });
    let code = app
        .run(RunOptions::new().process(Arc::clone(&handle) as _))
        .await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        handle.mock.stdout_text(),
        "true [\"before run\", \"two words\"] Some(\"at run\") Some([\"before run\", \"two words\"]) false false false\n"
    );
    assert_eq!(handle.mock.stderr_text(), "");
    assert_eq!(reads.argv.load(Ordering::SeqCst), 1);
    assert_eq!(reads.env.load(Ordering::SeqCst), 1);
}

/// A stdin that counts every read.
struct CountingStdin(Arc<AtomicUsize>);

impl InputStream for CountingStdin {
    fn read<'a>(&'a self, _buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        count(&self.0);
        Box::pin(async { Ok(0) })
    }
}

#[tokio::test]
async fn process_handle_fields_replace_fields_and_never_consume_stdin() {
    let reads = Arc::new(AtomicUsize::new(0));
    let stdout = Arc::new(Sink::default());
    let handle = process_handle(
        ProcessFields::new()
            .argv(["original"])
            .cwd("virtual-workspace")
            .env(Env::from([("ONLY".to_owned(), "original".to_owned())]))
            .stdin(Arc::new(CountingStdin(Arc::clone(&reads))))
            .stdout(Arc::clone(&stdout) as _)
            .stderr(Arc::new(Sink::default()))
            .terminal(Arc::new(Facts {
                stdin: true,
                stdout: OutputTerminal::new(true, Some(81), Some(25)),
                stderr: OutputTerminal::new(false, None, None),
                stated: None,
            })),
    );
    let app = Application::new("host")
        .argument("values", Arg::string().variadic().required())
        .action(|ctx: Context| async move {
            let own = std::env::current_dir().unwrap();
            let cwd = ctx
                .host
                .cwd
                .strip_prefix(&own)
                .unwrap()
                .display()
                .to_string();
            let env: Vec<String> = ctx
                .host
                .env
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect();
            let terminal = &ctx.host.terminal;
            let line = format!(
                "{:?} {cwd} {} {} {}:{:?}:{:?} {}",
                ctx.host.argv,
                env.join(","),
                terminal.stdin().is_tty,
                terminal.stdout().is_tty,
                terminal.stdout().columns,
                terminal.stdout().rows,
                terminal.stderr().is_tty,
            );
            ctx.out.print(&line).await
        });
    let code = app.run(RunOptions::new().process(handle)).await;
    assert_eq!(code.get(), 0);
    assert_eq!(
        stdout.text(),
        "[\"original\"] virtual-workspace ONLY=original true true:Some(81):Some(25) false\n"
    );
    assert_eq!(reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn build_diagnostics_use_the_captured_output() {
    let stderr = Arc::new(Sink::default());
    let handle = process_handle(
        ProcessFields::new()
            .argv(Vec::<String>::new())
            .release(ReleaseFacts::new(Build::Distributed))
            .stderr(Arc::clone(&stderr) as _),
    );
    let code = Application::new("bad")
        .run(RunOptions::new().process(handle))
        .await;
    assert_eq!(code.get(), 1);
    assert_eq!(stderr.text(), "bad: Something went wrong.\n");
}

#[tokio::test]
async fn an_application_runs_again_with_new_invocation_inputs() {
    let stdout = Arc::new(Sink::default());
    let app = Application::new("reuse")
        .argument("values", Arg::string().variadic().required())
        .action(|ctx: Context| async move {
            let values = match ctx.supplied.args.get("values") {
                Some(SuppliedValue::Many(values)) => values.join(","),
                _ => String::new(),
            };
            ctx.out.print(&values).await
        });
    for word in ["one", "two"] {
        let handle = process_handle(
            ProcessFields::new()
                .argv([word])
                .stdout(Arc::clone(&stdout) as _),
        );
        assert_eq!(app.run(RunOptions::new().process(handle)).await.get(), 0);
    }
    assert_eq!(stdout.text(), "one\ntwo\n");
}

// process-handle.test.ts

/// The reference's `facts` application: its root prints the host facts its run reads.
fn facts() -> Application {
    Application::new("notes").action(|ctx: Context| async move {
        let env: Vec<String> = ctx
            .host
            .env
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect();
        let line = format!(
            "arch:{} argv:{:?} cwd:{} env:{} libc:{:?} platform:{} release:{} uid:{:?}",
            ctx.host.arch,
            ctx.host.argv,
            ctx.host.cwd.display(),
            env.join(","),
            ctx.host.libc,
            ctx.host.platform,
            serde_json::to_string(&ctx.host.release).unwrap(),
            ctx.host.uid,
        );
        ctx.out.print(&line).await
    })
}

#[tokio::test]
async fn a_cwd_read_that_fails_fails_run_and_app_invoke_with_working_directory_error() {
    let unreadable = || {
        ProcessFields::new()
            .env(Env::new())
            .cwd_with(|| Err(io::Error::new(io::ErrorKind::NotFound, "uv_cwd")))
    };
    let stderr = Arc::new(Sink::default());
    let code = facts()
        .run(
            RunOptions::new().process(process_handle(
                unreadable()
                    .argv(Vec::<String>::new())
                    .stderr(Arc::clone(&stderr) as _),
            )),
        )
        .await;
    assert_eq!(code.get(), 1);
    assert_eq!(
        stderr.text(),
        "notes: The current working directory cannot be read. Change to a directory that exists and run the command again.\n"
    );
    let outcome = facts()
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(process_handle(unreadable())),
        )
        .await;
    let InvocationOutcome::Failed {
        failure, exit_code, ..
    } = outcome
    else {
        panic!("the invocation fails");
    };
    assert_eq!(exit_code.get(), 1);
    let failure = failure
        .downcast_failure::<WorkingDirectoryError>()
        .expect("a WorkingDirectoryError");
    let cause = failure
        .cause()
        .and_then(Error::foreign)
        .map(ToString::to_string);
    assert_eq!(cause.as_deref(), Some("uv_cwd"));
}

#[tokio::test]
async fn a_handle_reused_across_runs_reads_the_facts_afresh_at_each_run() {
    let reads = Arc::new(Reads::default());
    let handle = Arc::new(Counted::new(
        mock_process(
            MockFields::new()
                .argv(["first"])
                .env("LOOM_HANDLE_TEST", "one"),
        ),
        &reads,
    ));
    let app = Application::new("notes")
        .argument("word", Arg::string().required())
        .action(|ctx: Context| async move {
            let word = match ctx.supplied.args.get("word") {
                Some(SuppliedValue::One(word)) => word.clone(),
                _ => String::new(),
            };
            let value = ctx
                .host
                .env
                .get("LOOM_HANDLE_TEST")
                .cloned()
                .unwrap_or_default();
            ctx.out.print(&format!("{word} {value}")).await
        });
    app.run(RunOptions::new().process(Arc::clone(&handle) as _))
        .await;
    *handle.argv.lock().unwrap() = vec!["second".to_owned()];
    handle
        .env
        .lock()
        .unwrap()
        .insert("LOOM_HANDLE_TEST".to_owned(), "two".to_owned());
    app.run(RunOptions::new().process(Arc::clone(&handle) as _))
        .await;
    assert_eq!(handle.mock.stdout_text(), "first one\nsecond two\n");
}

#[tokio::test]
async fn run_writes_its_code_to_the_handle_and_app_invoke_writes_none() {
    let mock = distributed(MockFields::new().argv(["--nope"]));
    let code = facts()
        .run(RunOptions::new().process(Arc::clone(&mock) as _))
        .await;
    assert_eq!(code.get(), 2);
    assert_eq!(mock.exit_code().map(|code| code.get()), Some(2));

    let read = mock_process(
        MockFields::new()
            .cwd("/srv/notes")
            .env("ONLY", "handle")
            .platform("darwin")
            .arch("arm64")
            .libc(Some(Libc::Musl))
            .uid(Some(501))
            .release(ReleaseFacts::new(Build::Development)),
    );
    let outcome = facts()
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(Arc::clone(&read) as _),
        )
        .await;
    let InvocationOutcome::Completed { output, .. } = outcome else {
        panic!("the invocation completes");
    };
    assert_eq!(
        output,
        "arch:arm64 argv:[] cwd:/srv/notes env:ONLY=handle libc:Some(Musl) platform:darwin release:{\"build\":\"development\"} uid:Some(501)\n"
    );
    assert_eq!(read.exit_code(), None);
}

/// Capture copies `libc` and the time zone with the other facts, once per run or invocation by
/// name, whether or not the code reads them (a recorded deviation: the reference defers each to its
/// first read); an action's call reads its run's host and nothing of the handle.
#[tokio::test]
async fn capture_reads_libc_and_the_time_zone_once_per_door_and_an_actions_call_reads_none() {
    let reads = Arc::new(Reads::default());
    let counting = |argv: &[&str]| {
        Arc::new(Counted::new(
            mock_process(
                MockFields::new()
                    .argv(argv.iter().copied())
                    .time_zone("Europe/Paris")
                    .libc(Some(Libc::Glibc)),
            ),
            &reads,
        )) as Arc<dyn ProcessHandle>
    };
    let seen: Lines = Arc::default();
    let inner_seen = Arc::clone(&seen);
    let app = Application::new("notes")
        .command(Command::new("inner").action(move |ctx: Context| {
            inner_seen
                .lock()
                .unwrap()
                .push(format!("{}:{:?}", ctx.host.time_zone, ctx.host.libc));
            async { Ok(()) }
        }))
        .command(Command::new("outer").action(|ctx: Context| async move {
            ctx.invoke(&["inner"], InvocationValues::new(), InvokeOptions::new())
                .await;
            Ok(())
        }));
    let reads_now = || {
        (
            reads.libc.load(Ordering::SeqCst),
            reads.time_zone.load(Ordering::SeqCst),
        )
    };
    app.run(RunOptions::new().process(counting(&["inner"])))
        .await;
    assert_eq!(reads_now(), (1, 1));
    app.run(RunOptions::new().process(counting(&["outer"])))
        .await;
    assert_eq!(reads_now(), (2, 2));
    for path in [["inner"], ["outer"]] {
        app.invoke(
            &path,
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(counting(&[])),
        )
        .await;
    }
    assert_eq!(reads_now(), (4, 4));
    assert_eq!(*seen.lock().unwrap(), ["Europe/Paris:Some(Glibc)"; 4]);
}

#[tokio::test]
async fn the_host_copies_arch_libc_and_uid_from_the_handle_in_run_and_app_invoke_alike() {
    let read: Lines = Arc::default();
    let reading = Arc::clone(&read);
    let app = Application::new("notes").action(move |ctx: Context| {
        reading.lock().unwrap().push(format!(
            "{}:{:?}:{:?}",
            ctx.host.arch, ctx.host.libc, ctx.host.uid
        ));
        async { Ok(()) }
    });
    let handle = || {
        mock_process(
            MockFields::new()
                .arch("riscv64")
                .libc(Some(Libc::Glibc))
                .uid(Some(0)),
        )
    };
    app.run(RunOptions::new().process(handle())).await;
    app.invoke(
        &[],
        InvocationValues::new(),
        InvokeOptions::new(),
        Some(handle()),
    )
    .await;
    let bare = mock_process(MockFields::new().arch("arm64").libc(None).uid(None));
    app.run(RunOptions::new().process(bare)).await;
    assert_eq!(
        *read.lock().unwrap(),
        [
            "riscv64:Some(Glibc):Some(0)",
            "riscv64:Some(Glibc):Some(0)",
            "arm64:None:None"
        ]
    );
}

// home-folders.test.ts

/// An application whose root prints `HOME` and `TMPDIR` as its host reads them, and its folders.
fn folders(plugins: Vec<Plugin>) -> Application {
    Application::new("notes")
        .plugins(plugins)
        .action(|ctx: Context| async move {
            let line = format!(
                "HOME={:?} TMPDIR={:?} home={} tmpdir={}",
                ctx.host.env.get("HOME"),
                ctx.host.env.get("TMPDIR"),
                ctx.host.home.display(),
                ctx.host.tmpdir.display(),
            );
            ctx.out.print(&line).await
        })
}

async fn run_folders(app: &Application, fields: ProcessFields) -> String {
    let stdout = Arc::new(Sink::default());
    let handle = process_handle(
        fields
            .argv(Vec::<String>::new())
            .stdout(Arc::clone(&stdout) as _),
    );
    assert_eq!(app.run(RunOptions::new().process(handle)).await.get(), 0);
    stdout.text()
}

#[tokio::test]
async fn a_run_copies_the_folders_into_its_host() {
    let env = Env::from([
        ("HOME".to_owned(), "/srv/notes".to_owned()),
        ("TMPDIR".to_owned(), "/srv/scratch".to_owned()),
    ]);
    assert_eq!(
        run_folders(&folders(Vec::new()), ProcessFields::new().env(env)).await,
        "HOME=Some(\"/srv/notes\") TMPDIR=Some(\"/srv/scratch\") home=/srv/notes tmpdir=/srv/scratch\n"
    );
}

#[tokio::test]
async fn a_home_and_tmpdir_that_environment_preparation_adds_reach_host_env_and_move_neither_folder()
 {
    let dotenv = Plugin::new("@fixture/dotenv").on_environment(|_| async {
        Ok(Env::from([
            ("HOME".to_owned(), "/moved/home".to_owned()),
            ("TMPDIR".to_owned(), "/moved/tmp".to_owned()),
        ]))
    });
    assert_eq!(
        run_folders(
            &folders(vec![dotenv]),
            ProcessFields::new().env(Env::new()).home("/home/me")
        )
        .await,
        "HOME=Some(\"/moved/home\") TMPDIR=Some(\"/moved/tmp\") home=/home/me tmpdir=/tmp\n"
    );
}

#[tokio::test]
async fn app_invoke_and_an_actions_invoke_read_the_handles_folders() {
    let app = Application::new("notes")
        .command(Command::new("where").action(|ctx: Context| async move {
            let line = format!("{} {}", ctx.host.home.display(), ctx.host.tmpdir.display());
            ctx.out.print(&line).await
        }))
        .command(Command::new("outer").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(&["where"], InvocationValues::new(), InvokeOptions::new())
                .await;
            let line = match outcome {
                InvocationOutcome::Completed { output, .. } => output,
                _ => "not completed".to_owned(),
            };
            ctx.out.print(&line).await
        }));
    let handle = || {
        Some(process_handle(
            ProcessFields::new()
                .cwd("/")
                .env(Env::new())
                .home("/home/me")
                .tmpdir("/var/tmp"),
        ))
    };
    for (path, expected) in [
        ("where", "/home/me /var/tmp\n"),
        ("outer", "/home/me /var/tmp\n"),
    ] {
        let outcome = app
            .invoke(
                &[path],
                InvocationValues::new(),
                InvokeOptions::new(),
                handle(),
            )
            .await;
        let InvocationOutcome::Completed { output, .. } = outcome else {
            panic!("{path} completes");
        };
        assert_eq!(output, expected, "{path}");
    }
}

#[tokio::test]
async fn an_on_log_hooks_destination_carries_the_runs_home_under_run_and_invoke() {
    let homes: Lines = Arc::default();
    let observed = Arc::clone(&homes);
    let observer =
        Plugin::new("@fixture/observer").on_log(move |_event, destination: &LogDestination| {
            observed
                .lock()
                .unwrap()
                .push(destination.home.display().to_string());
        });
    let app = Application::new("notes")
        .plugins([observer])
        .action(|ctx: Context| async move {
            ctx.log.info("hello", LogFields::default());
            Ok(())
        });
    app.run(
        RunOptions::new().process(process_handle(
            ProcessFields::new()
                .argv(Vec::<String>::new())
                .env(Env::from([("HOME".to_owned(), "/ignored".to_owned())]))
                .home("/home/me")
                .stdout(Arc::new(Sink::default()))
                .stderr(Arc::new(Sink::default())),
        )),
    )
    .await;
    app.invoke(
        &[],
        InvocationValues::new(),
        InvokeOptions::new(),
        Some(process_handle(
            ProcessFields::new()
                .cwd("/")
                .env(Env::new())
                .home("/home/you"),
        )),
    )
    .await;
    assert_eq!(*homes.lock().unwrap(), ["/home/me", "/home/you"]);
}
