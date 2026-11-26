//! Host capture and the host's own members, over a hand-built handle, as the reference's
//! `host.test.ts`, `process-handle.test.ts`, and `spawn.test.ts` build theirs. The run-level forms
//! of these cases, through `run()` and `invoke`, belong to the run lifecycle.
#![allow(clippy::expect_used, clippy::unwrap_used, clippy::panic)]

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::*;
use crate::shipping::{Build, Release};
use crate::style::BACKGROUND_QUERY;

/// A stream that keeps what it is given.
#[derive(Default)]
struct Sink(Mutex<Vec<u8>>);

impl OutputStream for Sink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(async { Ok(()) })
    }
}

/// A stdin that has ended.
struct Ended;

impl InputStream for Ended {
    fn read<'a>(&'a self, _buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async { Ok(0) })
    }
}

/// Terminal facts whose width each read takes from a shared cell.
struct Facts {
    columns: Mutex<Option<u16>>,
}

impl ProcessTerminal for Facts {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::new(true)
    }
    fn stdout(&self) -> OutputTerminal {
        OutputTerminal::new(true, *self.columns.lock().unwrap(), Some(25))
    }
    fn stderr(&self) -> OutputTerminal {
        OutputTerminal::new(false, Some(0), None)
    }
    fn background(&self) -> Option<Background> {
        Some(Background::Light)
    }
}

/// A signal source of the test's own, recording what it raises.
struct Source {
    terminal: Option<Arc<dyn InputStream>>,
    raised: Mutex<Vec<ProcessSignal>>,
}

impl SignalSource for Source {
    fn on(&self, _event: SignalEvent, _listener: SignalListener) -> u64 {
        0
    }
    fn off(&self, _id: u64) {}
    fn raise(&self, signal: ProcessSignal) {
        self.raised.lock().unwrap().push(signal);
    }
    fn terminal(&self) -> Option<Arc<dyn InputStream>> {
        self.terminal.clone()
    }
}

/// A handle built by hand, reading nothing from the process, recording each spawn.
struct HandBuilt {
    cwd: Result<PathBuf, io::ErrorKind>,
    env: Env,
    stdin: Arc<dyn InputStream>,
    stdout: Arc<dyn OutputStream>,
    stderr: Arc<dyn OutputStream>,
    terminal: Arc<Facts>,
    signals: Arc<Source>,
    spawned: Mutex<Vec<SpawnRequest>>,
}

impl HandBuilt {
    fn new() -> Self {
        Self {
            cwd: Ok(PathBuf::from("/work")),
            env: Env::from([("PATH".to_owned(), "/bin".to_owned())]),
            stdin: Arc::new(Ended),
            stdout: Arc::new(Sink::default()),
            stderr: Arc::new(Sink::default()),
            terminal: Arc::new(Facts {
                columns: Mutex::new(Some(81)),
            }),
            signals: Arc::new(Source {
                terminal: None,
                raised: Mutex::new(Vec::new()),
            }),
            spawned: Mutex::new(Vec::new()),
        }
    }
}

impl ProcessHandle for HandBuilt {
    fn argv(&self) -> Vec<String> {
        vec!["original".to_owned()]
    }
    fn program(&self) -> Vec<String> {
        vec!["/bin/notes".to_owned()]
    }
    fn env(&self) -> Env {
        self.env.clone()
    }
    fn cwd(&self) -> io::Result<PathBuf> {
        self.cwd.clone().map_err(io::Error::from)
    }
    fn home(&self) -> PathBuf {
        PathBuf::from("/home/notes")
    }
    fn tmpdir(&self) -> PathBuf {
        PathBuf::from("/tmp")
    }
    fn platform(&self) -> String {
        "linux".to_owned()
    }
    fn arch(&self) -> String {
        "riscv64".to_owned()
    }
    fn libc(&self) -> Option<Libc> {
        Some(Libc::Musl)
    }
    fn uid(&self) -> Option<u32> {
        Some(0)
    }
    fn time_zone(&self) -> String {
        "Europe/Paris".to_owned()
    }
    fn release(&self) -> ReleaseFacts {
        ReleaseFacts::new(Build::Distributed)
    }
    fn read_source(&self, path: &str, cwd: &str) -> Option<String> {
        Some(format!("{path} in {cwd}"))
    }
    fn stdin(&self) -> Arc<dyn InputStream> {
        Arc::clone(&self.stdin)
    }
    fn stdout(&self) -> Arc<dyn OutputStream> {
        Arc::clone(&self.stdout)
    }
    fn stderr(&self) -> Arc<dyn OutputStream> {
        Arc::clone(&self.stderr)
    }
    fn terminal(&self) -> Arc<dyn ProcessTerminal> {
        Arc::clone(&self.terminal) as Arc<dyn ProcessTerminal>
    }
    fn signals(&self) -> Arc<dyn SignalSource> {
        Arc::clone(&self.signals) as Arc<dyn SignalSource>
    }
    fn spawn(&self, request: SpawnRequest) -> Child {
        self.spawned.lock().unwrap().push(request);
        Child::unstarted(io::Error::other("recorded"))
    }
    fn set_exit_code(&self, _code: ExitCode) {}
}

fn captured(handle: &Arc<HandBuilt>) -> HostCapture {
    capture_host("notes", Arc::clone(handle) as Arc<dyn ProcessHandle>)
}

#[test]
fn capture_copies_each_fact_from_the_handle() {
    let handle = Arc::new(HandBuilt::new());
    let HostCapture {
        host,
        unreadable_cwd,
    } = captured(&handle);
    assert!(unreadable_cwd.is_none());
    assert_eq!(host.argv, ["original"]);
    assert_eq!(host.program, ["/bin/notes"]);
    assert_eq!(host.cwd, PathBuf::from("/work"));
    assert_eq!(host.env.get("PATH").map(String::as_str), Some("/bin"));
    assert_eq!(
        (host.home.as_path(), host.tmpdir.as_path()),
        (Path::new("/home/notes"), Path::new("/tmp"))
    );
    assert_eq!(
        (
            host.platform.as_str(),
            host.arch.as_str(),
            host.libc,
            host.uid
        ),
        ("linux", "riscv64", Some(Libc::Musl), Some(0))
    );
    assert_eq!(host.time_zone(), "Europe/Paris");
    assert_eq!(host.release, ReleaseFacts::new(Build::Distributed));
    assert_eq!(host.read_source("a.rs").as_deref(), Some("a.rs in /work"));
}

#[test]
fn a_hand_built_handles_release_is_taken_as_given_and_reads_no_record() {
    let facts = DirectoryFacts::new(Env::new(), "/loom-test/home", "linux");
    assert_eq!(
        HandBuilt::new().release_for("notes", &facts),
        ReleaseFacts::new(Build::Distributed)
    );
    let release = Release::new("1.1.0-next.3", "acme/notes").asset("notes-linux-x64");
    assert_eq!(release.channel, "next");
}

#[test]
fn an_unreadable_working_directory_is_captured_as_its_error() {
    let mut handle = HandBuilt::new();
    handle.cwd = Err(io::ErrorKind::NotFound);
    let handle = Arc::new(handle);
    let HostCapture {
        host,
        unreadable_cwd,
    } = captured(&handle);
    assert_eq!(
        unreadable_cwd.map(|error| error.kind()),
        Some(io::ErrorKind::NotFound)
    );
    assert_eq!(host.cwd, PathBuf::new());
    // The report host still holds the other facts, with the background unsettled though the handle
    // states one, and a child of such a run never starts.
    assert_eq!(host.argv, ["original"]);
    assert_eq!(host.terminal.background, None);
    assert_eq!(host.terminal.stated_background(), Some(Background::Light));
    let child = host.spawn("git", ["status"], SpawnOptions::new());
    assert!(handle.spawned.lock().unwrap().is_empty());
    let exit = futures_block_on(child.exited());
    assert!(matches!(exit, ChildExit::Unstarted { .. }));
}

#[test]
fn the_terminal_copies_each_kind_once_and_reads_width_and_height_live() {
    let handle = Arc::new(HandBuilt::new());
    let host = captured(&handle).host;
    assert_eq!(host.terminal.stdin(), InputTerminal::new(true));
    assert_eq!(
        host.terminal.stdout(),
        OutputTerminal::new(true, Some(81), Some(25))
    );
    *handle.terminal.columns.lock().unwrap() = Some(60);
    assert_eq!(host.terminal.stdout().columns, Some(60));
    // A zero reading is unavailable.
    assert_eq!(
        host.terminal.stderr(),
        OutputTerminal::new(false, None, None)
    );
    // The background reads unsettled until the run settles it, even when the handle states one.
    assert_eq!(host.terminal.background, None);
    assert_eq!(host.terminal.stated_background(), Some(Background::Light));
}

#[test]
fn raise_answers_false_and_raises_nothing_when_stdin_is_not_the_sources_terminal() {
    let mut handle = HandBuilt::new();
    handle.signals = Arc::new(Source {
        terminal: Some(Arc::new(Ended)),
        raised: Mutex::new(Vec::new()),
    });
    let handle = Arc::new(handle);
    let host = captured(&handle).host;
    assert_eq!(
        [
            host.raise(InterruptSignal::Int),
            host.raise(InterruptSignal::Tstp)
        ],
        [false, false]
    );
    assert!(handle.signals.raised.lock().unwrap().is_empty());
}

#[test]
fn raise_raises_on_the_source_and_answers_true_when_stdin_is_its_terminal() {
    let stdin: Arc<dyn InputStream> = Arc::new(Ended);
    let mut handle = HandBuilt::new();
    handle.stdin = Arc::clone(&stdin);
    handle.signals = Arc::new(Source {
        terminal: Some(stdin),
        raised: Mutex::new(Vec::new()),
    });
    let handle = Arc::new(handle);
    let host = captured(&handle).host;
    assert_eq!(
        [
            host.raise(InterruptSignal::Int),
            host.raise(InterruptSignal::Tstp)
        ],
        [true, true]
    );
    assert_eq!(
        *handle.signals.raised.lock().unwrap(),
        [ProcessSignal::Int, ProcessSignal::Tstp]
    );
    let cancels = Mutex::new(0);
    let keys = raise_interrupt_keys(&host, &|| *cancels.lock().unwrap() += 1, "a\u{3}b");
    assert_eq!(keys.raised, Some(InterruptRaised::Ending));
    assert_eq!(*cancels.lock().unwrap(), 0);
}

#[test]
fn core_fills_cwd_and_env_from_the_run_resolving_a_relative_cwd_against_host_cwd() {
    let handle = Arc::new(HandBuilt::new());
    let host = captured(&handle).host;
    let _ = host.spawn("git", Vec::<String>::new(), SpawnOptions::new());
    let _ = host.spawn("git", ["status"], SpawnOptions::new().cwd("notes"));
    let _ = host.spawn(
        "git",
        ["status"],
        SpawnOptions::new().cwd("notes/../other/."),
    );
    let given = Env::from([("ONLY".to_owned(), "given".to_owned())]);
    let _ = host.spawn(
        "git",
        ["status"],
        SpawnOptions::new().cwd("/srv").env(given.clone()),
    );
    let spawned = handle.spawned.lock().unwrap();
    let places: Vec<(PathBuf, Env)> = spawned
        .iter()
        .map(|request| (request.cwd.clone(), request.env.clone()))
        .collect();
    let path = Env::from([("PATH".to_owned(), "/bin".to_owned())]);
    assert_eq!(
        places,
        [
            (PathBuf::from("/work"), path.clone()),
            (PathBuf::from("/work/notes"), path.clone()),
            (PathBuf::from("/work/other"), path),
            (PathBuf::from("/srv"), given),
        ]
    );
    assert_eq!(spawned[1].args, ["status"]);
}

#[test]
fn a_child_directory_above_the_root_stays_at_the_root_as_path_resolve_keeps_it() {
    let handle = Arc::new(HandBuilt::new());
    let host = captured(&handle).host;
    let _ = host.spawn("git", ["status"], SpawnOptions::new().cwd("/../srv//x/.."));
    let _ = host.spawn("git", ["status"], SpawnOptions::new().cwd("../../../up"));
    let spawned = handle.spawned.lock().unwrap();
    assert_eq!(spawned[0].cwd, PathBuf::from("/srv"));
    assert_eq!(spawned[1].cwd, PathBuf::from("/up"));
}

#[test]
fn normalizing_keeps_a_leading_parent_of_a_relative_path() {
    assert_eq!(
        normalized(Path::new("../a/../../b/.")),
        PathBuf::from("../../b")
    );
    assert_eq!(normalized(Path::new("a/b/../..")), PathBuf::new());
}

#[test]
fn an_argv_run_passes_inherit_for_each_stream_that_is_the_handles_own() {
    let handle = Arc::new(HandBuilt::new());
    let host = captured(&handle).host;
    let options = SpawnOptions::new()
        .stdout(ChildStream::Inherit)
        .stderr(ChildStream::Inherit)
        .inherit_stdin();
    let _ = host.spawn("git", ["status"], options);
    let spawned = handle.spawned.lock().unwrap();
    let options = spawned[0].attached.as_ref().expect("attached");
    assert!(matches!(options.stdout_stream(), ChildStream::Inherit));
    assert!(matches!(options.stderr_stream(), ChildStream::Inherit));
    assert!(options.inherits_stdin());
}

#[test]
fn a_run_on_capture_sinks_passes_them_in_place_of_inherit_and_no_stdin() {
    let handle = Arc::new(HandBuilt::new());
    let sink: Arc<dyn OutputStream> = Arc::new(Sink::default());
    let streams = RunStreams {
        stdin: Arc::new(Ended),
        stdout: Arc::clone(&sink),
        stderr: Arc::clone(&sink),
    };
    let host = capture_parts(
        "notes",
        Arc::clone(&handle) as Arc<dyn ProcessHandle>,
        Vec::new(),
        streams,
        OwnStreams::default(),
    )
    .host;
    let options = SpawnOptions::new()
        .stdout(ChildStream::Inherit)
        .stderr(ChildStream::Inherit)
        .inherit_stdin();
    let _ = host.spawn("git", Vec::<String>::new(), options);
    let spawned = handle.spawned.lock().unwrap();
    let options = spawned[0].attached.as_ref().expect("attached");
    for stream in [options.stdout_stream(), options.stderr_stream()] {
        match stream {
            ChildStream::Stream(stream) => assert!(same_stream(stream, &sink)),
            _ => panic!("the capture sink reaches the handle in place of inherit"),
        }
    }
    assert!(!options.inherits_stdin());
    assert_eq!(options.stdin_input(), None);
}

#[test]
fn a_detached_spawn_reaches_the_handle_with_its_place_and_nothing_else() {
    let handle = Arc::new(HandBuilt::new());
    let host = captured(&handle).host;
    let _ = host.spawn_detached("notes", ["refresh"], DetachedSpawnOptions::new());
    let spawned = handle.spawned.lock().unwrap();
    assert_eq!(spawned[0].cwd, PathBuf::from("/work"));
    assert!(spawned[0].attached.is_none());
}

#[test]
fn the_host_streams_are_the_runs() {
    let handle = Arc::new(HandBuilt::new());
    let host = captured(&handle).host;
    assert!(same_stream(&host.stdout(), &handle.stdout));
    assert!(same_stream(&host.stderr(), &handle.stderr));
    assert!(same_stream(&host.stdin(), &handle.stdin));
}

#[test]
fn directory_facts_come_from_the_host() {
    let host = captured(&Arc::new(HandBuilt::new())).host;
    assert_eq!(
        crate::application_directory(
            crate::ApplicationDirectory::Cache,
            "notes",
            &DirectoryFacts::from(&host)
        ),
        crate::DirectoryLookup::Path(PathBuf::from("/home/notes/.cache/notes"))
    );
}

/// Drives a future that never waits to its end, with no runtime.
fn futures_block_on<F: std::future::Future>(future: F) -> F::Output {
    let waker = std::task::Waker::noop();
    let mut context = std::task::Context::from_waker(waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let std::task::Poll::Ready(output) = future.as_mut().poll(&mut context) {
            return output;
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn host_spawn_starts_a_real_child_through_the_real_handle_in_the_captured_place() {
    let cwd = std::fs::canonicalize(env!("CARGO_MANIFEST_DIR")).unwrap();
    let only = Env::from([("ONLY".to_owned(), "given".to_owned())]);
    let handle = process_handle(ProcessFields::new().cwd(&cwd).env(only));
    let host = capture_host("notes", handle).host;
    let child = host.spawn(
        "/bin/sh",
        ["-c", r#"printf '%s %s %s' "$PWD" "$ONLY" "${HOME-unset}""#],
        SpawnOptions::new(),
    );
    match child.exited().await {
        ChildExit::Exited {
            code,
            stdout,
            stderr,
        } => {
            assert_eq!(code, 0);
            assert_eq!(stdout.text, format!("{} given unset", cwd.display()));
            assert_eq!(stderr.bytes, b"");
        }
        ChildExit::Unstarted { error } => panic!("the child started: {error}"),
        ChildExit::Abandoned { .. } => panic!("the child was not abandoned"),
    }
}

// The background query through the handle, under `background.md`'s terminal query and the
// reference's `background-terminal.test.ts`, whose pseudo-terminal cases these state at the host.

/// A terminal stdin a test scripts: it answers its chunks in order, then waits for good or ends,
/// and records each raw-mode switch and what is pushed back.
#[derive(Default)]
struct Keys {
    raw: Mutex<bool>,
    switches: Mutex<Vec<bool>>,
    chunks: Mutex<VecDeque<Vec<u8>>>,
    pushed: Mutex<Vec<u8>>,
    ends: bool,
    refuses_raw: bool,
    background_job: bool,
}

impl Keys {
    fn typing(chunks: &[&[u8]]) -> Self {
        Self {
            chunks: Mutex::new(chunks.iter().map(|chunk| chunk.to_vec()).collect()),
            ..Self::default()
        }
    }
}

impl InputStream for Keys {
    fn read<'a>(&'a self, buffer: &'a mut [u8]) -> BoxFuture<'a, io::Result<usize>> {
        Box::pin(async move {
            let chunk = self.chunks.lock().unwrap().pop_front();
            match chunk {
                Some(chunk) => {
                    buffer[..chunk.len()].copy_from_slice(&chunk);
                    Ok(chunk.len())
                }
                None if self.ends => Ok(0),
                None => std::future::pending().await,
            }
        })
    }
    fn set_raw_mode(&self, on: bool) -> io::Result<()> {
        if self.refuses_raw {
            return Err(io::Error::from(io::ErrorKind::Unsupported));
        }
        *self.raw.lock().unwrap() = on;
        self.switches.lock().unwrap().push(on);
        Ok(())
    }
    fn is_raw(&self) -> bool {
        *self.raw.lock().unwrap()
    }
    fn in_background_job(&self) -> bool {
        self.background_job
    }
    fn unshift(&self, bytes: &[u8]) {
        self.pushed
            .lock()
            .unwrap()
            .splice(0..0, bytes.iter().copied());
    }
}

/// What one query did: its answer, the bytes written to stderr, the raw-mode switches, the bytes
/// pushed back, the signals raised, the cancels, and the shutdown handlers registered and removed.
#[derive(Debug, PartialEq)]
struct Asked {
    answer: Option<Background>,
    stderr: Vec<u8>,
    switches: Vec<bool>,
    pushed: Vec<u8>,
    raised: Vec<ProcessSignal>,
    cancels: usize,
    shutdown: (usize, usize),
}

/// Asks the terminal through a host over `keys`, with `TERM` set to `term`. When `own` is true,
/// stdin is the signal source's own terminal. `signal` is the run's.
async fn ask(keys: Keys, term: &str, own: bool, signal: &CancellationToken) -> Asked {
    let keys = Arc::new(keys);
    let stdin: Arc<dyn InputStream> = Arc::clone(&keys) as Arc<dyn InputStream>;
    let stderr = Arc::new(Sink::default());
    let mut handle = HandBuilt::new();
    handle.env = Env::from([("TERM".to_owned(), term.to_owned())]);
    handle.stdin = Arc::clone(&stdin);
    handle.stderr = Arc::clone(&stderr) as Arc<dyn OutputStream>;
    handle.signals = Arc::new(Source {
        terminal: own.then(|| Arc::clone(&stdin)),
        raised: Mutex::new(Vec::new()),
    });
    let handle = Arc::new(handle);
    let host = captured(&handle).host;
    let cancels = Mutex::new(0);
    let registered = Arc::new(Mutex::new((0, 0)));
    let on_shutdown = |_handler: Box<dyn FnOnce() + Send>| -> Box<dyn FnOnce() + Send> {
        registered.lock().unwrap().0 += 1;
        let removed = Arc::clone(&registered);
        Box::new(move || removed.lock().unwrap().1 += 1)
    };
    let answer = ask_terminal(
        &host,
        QueryRun {
            cancel: &|| *cancels.lock().unwrap() += 1,
            on_shutdown: &on_shutdown,
            signal,
        },
    )
    .await;
    Asked {
        answer,
        stderr: stderr.0.lock().unwrap().clone(),
        switches: keys.switches.lock().unwrap().clone(),
        pushed: keys.pushed.lock().unwrap().clone(),
        raised: handle.signals.raised.lock().unwrap().clone(),
        cancels: *cancels.lock().unwrap(),
        shutdown: *registered.lock().unwrap(),
    }
}

const WHITE: &[u8] = b"\x1b]11;rgb:ffff/ffff/ffff\x07";
const DA1: &[u8] = b"\x1b[?62c";

#[tokio::test]
async fn a_foreground_query_reads_the_answer_and_pushes_typeahead_back_to_stdin() {
    let typed = [b"q".as_slice(), WHITE, DA1].concat();
    let asked = ask(
        Keys::typing(&[&typed]),
        "xterm-256color",
        true,
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(
        asked,
        Asked {
            answer: Some(Background::Light),
            stderr: BACKGROUND_QUERY.as_bytes().to_vec(),
            switches: vec![true, false],
            pushed: b"q".to_vec(),
            raised: Vec::new(),
            cancels: 0,
            shutdown: (1, 1),
        }
    );
    assert_eq!(
        BACKGROUND_QUERY.as_bytes(),
        b"\x1b]11;?\x1b\\\x1b[?996n\x1b[c"
    );
}

#[tokio::test]
async fn replies_split_across_reads_answer_with_nothing_pushed_back() {
    let asked = ask(
        Keys::typing(&[b"\x1b]11;rgb:0000/", b"0000/0000\x1b\\", DA1]),
        "xterm-256color",
        true,
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(
        (asked.answer, asked.pushed, asked.switches),
        (Some(Background::Dark), Vec::new(), vec![true, false])
    );
}

#[tokio::test]
async fn ctrl_c_during_the_wait_raises_sigint_ends_the_wait_and_pushes_nothing_back() {
    let typed = [b"a\x03".as_slice(), WHITE].concat();
    let asked = ask(
        Keys::typing(&[&typed, DA1]),
        "xterm-256color",
        true,
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(
        (asked.raised, asked.cancels, asked.pushed, asked.switches),
        (vec![ProcessSignal::Int], 0, Vec::new(), vec![true, false])
    );
}

#[tokio::test]
async fn ctrl_c_on_a_stdin_that_is_not_the_sources_terminal_cancels_and_pushes_the_rest_back() {
    let asked = ask(
        Keys::typing(&[b"a\x03b"]),
        "xterm-256color",
        false,
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(
        (asked.raised, asked.cancels, asked.pushed, asked.answer),
        (Vec::new(), 1, b"ab".to_vec(), None)
    );
}

#[tokio::test]
async fn a_background_job_a_refused_raw_mode_a_forbidding_env_or_a_cancelled_run_asks_nothing() {
    let nothing = |asked: &Asked| {
        (
            asked.answer,
            asked.stderr.clone(),
            asked.switches.clone(),
            asked.shutdown,
        )
    };
    let none = (None, Vec::new(), Vec::new(), (0, 0));
    let job = Keys {
        background_job: true,
        ..Keys::typing(&[DA1])
    };
    let live = CancellationToken::new();
    assert_eq!(nothing(&ask(job, "xterm", true, &live).await), none);
    let pipe = Keys {
        refuses_raw: true,
        ..Keys::typing(&[DA1])
    };
    assert_eq!(nothing(&ask(pipe, "xterm", true, &live).await), none);
    for term in ["dumb", ""] {
        let asked = ask(Keys::typing(&[DA1]), term, true, &live).await;
        assert_eq!(nothing(&asked), none, "TERM={term:?}");
    }
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let asked = ask(Keys::typing(&[DA1]), "xterm", true, &cancelled).await;
    assert_eq!(nothing(&asked), none);
}

#[tokio::test]
async fn a_terminal_that_never_answers_ends_the_wait_at_the_one_second_deadline() {
    let started = Instant::now();
    let asked = ask(
        Keys::typing(&[b"k"]),
        "xterm",
        true,
        &CancellationToken::new(),
    )
    .await;
    let waited = started.elapsed();
    assert!(waited >= Duration::from_millis(1000), "waited {waited:?}");
    assert_eq!(
        (asked.answer, asked.pushed, asked.switches, asked.shutdown),
        (None, b"k".to_vec(), vec![true, false], (1, 1))
    );
}

#[tokio::test]
async fn a_cancellation_during_the_wait_ends_it_at_once() {
    let signal = CancellationToken::new();
    let cancelling = signal.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(20)).await;
        cancelling.cancel();
    });
    let started = Instant::now();
    let asked = ask(Keys::typing(&[]), "xterm", true, &signal).await;
    assert!(started.elapsed() < Duration::from_millis(1000));
    assert_eq!((asked.answer, asked.switches), (None, vec![true, false]));
}

#[tokio::test]
async fn stdin_that_ends_ends_the_wait_and_takes_nothing_back() {
    let keys = Keys {
        ends: true,
        ..Keys::typing(&[b"x"])
    };
    let asked = ask(keys, "xterm", true, &CancellationToken::new()).await;
    assert_eq!((asked.answer, asked.pushed), (None, Vec::new()));
}

#[tokio::test]
async fn a_stdin_already_in_raw_mode_is_left_in_raw_mode() {
    let keys = Keys {
        raw: Mutex::new(true),
        ..Keys::typing(&[DA1])
    };
    let asked = ask(keys, "xterm", true, &CancellationToken::new()).await;
    assert_eq!(asked.switches, [true, true]);
}
