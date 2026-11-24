//! The reference's `packages/testing/tests/mock-process.test.ts`: the sealed defaults, supplied
//! fields, folders, child programs, piped stdin, the terminal, recording, signals, and the
//! keyboard, through the handle's own members. The cases that run an Application on the mock
//! belong to the run lifecycle and the prompts library.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use loomcli_core::{
    Background, BoxFuture, Build, ChildExit, ChildOutput, ChildStream, Env, ExitCode,
    FailureExitCode, InputStream, InputTerminal, KillSignal, Libc, OutputStream, OutputTerminal,
    ProcessHandle, ProcessSignal, ReleaseFacts, SignalEvent, SpawnOptions, SpawnRequest,
};
use loomcli_testing::{
    KeyEntry, MockFields, MockProcess, MockTerminal, ProgramAnswer, ProgramCall, StreamName, Write,
    mock_process,
};
use tokio_util::sync::CancellationToken;

/// Everything a stream yields before it ends.
async fn drained(stream: &Arc<dyn InputStream>) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        let count = stream.read(&mut buffer).await.unwrap();
        if count == 0 {
            return bytes;
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}

/// One read of a stream, with a generous deadline.
async fn read_once(stream: &Arc<dyn InputStream>) -> io::Result<String> {
    let mut buffer = [0_u8; 1024];
    let count = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer))
        .await
        .expect("the read answers")?;
    Ok(String::from_utf8_lossy(&buffer[..count]).into_owned())
}

/// Writes text to a stream, as a run does.
async fn write(stream: &Arc<dyn OutputStream>, bytes: &[u8]) {
    stream.write(bytes).await.unwrap();
}

fn code(number: u8) -> ExitCode {
    ExitCode::from(FailureExitCode::new(number))
}

mod the_sealed_defaults {
    use super::*;

    #[test]
    fn every_fact_has_a_fixed_default() {
        let mock = mock_process(MockFields::new());
        assert_eq!(mock.argv(), Vec::<String>::new());
        assert_eq!(mock.env(), Env::new());
        assert_eq!(mock.cwd().unwrap(), PathBuf::from("/loom-test"));
        assert_eq!(mock.home(), PathBuf::from("/loom-test/home"));
        assert_eq!(mock.tmpdir(), PathBuf::from("/loom-test/tmp"));
        assert_eq!(mock.platform(), "linux");
        assert_eq!(mock.arch(), "x64");
        assert_eq!(mock.libc(), Some(Libc::Glibc));
        assert_eq!(mock.uid(), Some(1000));
        assert_eq!(mock.time_zone(), "UTC");
        assert_eq!(mock.program(), ["/loom-test/runtime", "/loom-test/app.js"]);
        assert_eq!(mock.release(), ReleaseFacts::new(Build::Source));
        assert_eq!(mock.read_source("a.rs", "/"), None);
        assert_eq!(mock.exit_code(), None);
        assert!(mock.signals().terminal().is_none());
        assert_eq!(mock.ended_by(), None);
        assert_eq!(mock.transcript(), []);
        assert_eq!(mock.stdout_text(), "");
        assert_eq!(mock.stderr_text(), "");
        let terminal = mock.terminal();
        assert_eq!(terminal.stdin(), InputTerminal::new(false));
        assert_eq!(terminal.stdout(), OutputTerminal::new(false, None, None));
        assert_eq!(terminal.stderr(), OutputTerminal::new(false, None, None));
        assert_eq!(terminal.background(), None);
        assert!(!mock.is_raw());
    }

    #[test]
    fn the_mock_publishes_nothing() {
        let mock = mock_process(MockFields::new());
        mock.publish_env("ADDED", "value");
        assert_eq!(mock.env(), Env::new());
    }

    #[tokio::test]
    async fn stdin_is_empty_and_ends() {
        let mock = mock_process(MockFields::new());
        assert_eq!(drained(&mock.stdin()).await, b"");
    }

    #[test]
    fn libc_is_none_when_the_platform_is_not_linux() {
        assert_eq!(
            mock_process(MockFields::new().platform("darwin")).libc(),
            None
        );
        let given = MockFields::new().libc(Some(Libc::Musl)).platform("darwin");
        assert_eq!(mock_process(given).libc(), Some(Libc::Musl));
        assert_eq!(mock_process(MockFields::new().libc(None)).libc(), None);
    }

    #[test]
    fn reads_nothing_from_the_process_the_test_runs_in() {
        let mock = mock_process(MockFields::new());
        assert!(mock.env().is_empty());
        assert_ne!(mock.cwd().unwrap(), std::env::current_dir().unwrap());
    }
}

mod supplied_fields {
    use super::*;

    #[test]
    fn replace_their_defaults_whole() {
        let release = ReleaseFacts::new(Build::Distributed);
        let mock = mock_process(
            MockFields::new()
                .arch("arm64")
                .argv(["a", "b"])
                .cwd("/work")
                .env("HOME", "/h")
                .platform("darwin")
                .program(["x"])
                .release(release.clone())
                .time_zone("Asia/Tokyo")
                .uid(None),
        );
        assert_eq!(mock.arch(), "arm64");
        assert_eq!(mock.argv(), ["a", "b"]);
        assert_eq!(mock.cwd().unwrap(), PathBuf::from("/work"));
        assert_eq!(
            mock.env(),
            Env::from([("HOME".to_owned(), "/h".to_owned())])
        );
        assert_eq!(mock.platform(), "darwin");
        assert_eq!(mock.program(), ["x"]);
        assert_eq!(
            (mock.release(), mock.time_zone(), mock.uid()),
            (release, "Asia/Tokyo".to_owned(), None)
        );
    }

    #[test]
    fn a_supplied_read_source_is_the_reader() {
        let mock = mock_process(
            MockFields::new().read_source(|path, _| Some(format!("source of {path}"))),
        );
        assert_eq!(
            mock.read_source("a.rs", "/").as_deref(),
            Some("source of a.rs")
        );
    }

    #[test]
    fn a_cwd_read_stands_in_for_the_read_and_may_fail() {
        let failing = mock_process(MockFields::new().cwd_with(|| Err(io::Error::other("ENOENT"))));
        assert_eq!(failing.cwd().unwrap_err().to_string(), "ENOENT");
        let live = mock_process(MockFields::new().cwd_with(|| Ok(PathBuf::from("/live"))));
        assert_eq!(live.cwd().unwrap(), PathBuf::from("/live"));
    }
}

mod folders {
    use super::*;

    #[test]
    fn home_and_tmpdir_follow_an_absolute_home_and_tmpdir_in_env() {
        let mock = mock_process(
            MockFields::new()
                .env("HOME", "/srv/home")
                .env("TMPDIR", "/srv/tmp"),
        );
        assert_eq!(
            (mock.home(), mock.tmpdir()),
            (PathBuf::from("/srv/home"), PathBuf::from("/srv/tmp"))
        );
    }

    #[test]
    fn a_home_and_tmpdir_that_are_empty_or_relative_fall_back_to_the_fixed_folders() {
        for value in ["", "notes"] {
            let mock = mock_process(
                MockFields::new()
                    .env("HOME", value)
                    .env("TMP", "/srv/tmp")
                    .env("TMPDIR", value),
            );
            assert_eq!(
                (mock.home(), mock.tmpdir()),
                (
                    PathBuf::from("/loom-test/home"),
                    PathBuf::from("/loom-test/tmp")
                ),
                "{value:?}"
            );
        }
    }

    #[test]
    fn a_supplied_home_and_tmpdir_win_over_env() {
        let mock = mock_process(
            MockFields::new()
                .env("HOME", "/srv/home")
                .env("TMPDIR", "/srv/tmp")
                .home("/home/me")
                .tmpdir("/var/tmp"),
        );
        assert_eq!(
            (mock.home(), mock.tmpdir()),
            (PathBuf::from("/home/me"), PathBuf::from("/var/tmp"))
        );
    }
}

mod child_programs {
    use super::*;

    /// A spawn of `command` with the place filled, as core calls the handle.
    fn spawned(
        mock: &Arc<MockProcess>,
        command: &str,
        options: SpawnOptions,
    ) -> loomcli_core::Child {
        mock.spawn(SpawnRequest::attached(
            command,
            ["status"],
            "/work/notes",
            Env::from([("PATH".to_owned(), "/bin".to_owned())]),
            options,
        ))
    }

    /// How the child ended, as the reference's fixture prints it.
    async fn ended(child: &loomcli_core::Child) -> String {
        match child.exited().await {
            ChildExit::Exited {
                code,
                stdout,
                stderr,
            } => format!("{code} [{}] [{}]", stdout.text, stderr.text),
            ChildExit::Unstarted { error } => format!("unstarted: {error}"),
            _ => "unknown".to_owned(),
        }
    }

    #[tokio::test]
    async fn a_script_answers_the_code_and_the_captured_output_from_the_call() {
        let calls = Arc::new(Mutex::new(Vec::<ProgramCall>::new()));
        let seen = Arc::clone(&calls);
        let mock = mock_process(MockFields::new().script("git", move |call| {
            seen.lock().unwrap().push(call);
            async {
                Ok(ProgramAnswer::new()
                    .code(3)
                    .stderr("warned".as_bytes().to_vec())
                    .stdout("answer"))
            }
        }));
        let child = spawned(&mock, "git", SpawnOptions::new().input("typed"));
        assert_eq!(ended(&child).await, "3 [answer] [warned]");
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        let call = &calls[0];
        assert_eq!(
            (
                call.command.as_str(),
                call.args.as_slice(),
                call.cwd.as_path()
            ),
            (
                "git",
                ["status".to_owned()].as_slice(),
                PathBuf::from("/work/notes").as_path()
            )
        );
        assert_eq!(call.env.get("PATH").map(String::as_str), Some("/bin"));
        assert_eq!((call.input.as_str(), call.detached), ("typed", false));
        assert!(!call.signal.is_cancelled());
        assert_eq!(mock.calls().len(), 1);
    }

    #[tokio::test]
    async fn an_answer_that_omits_its_members_exits_0_with_no_output() {
        let mock =
            mock_process(MockFields::new().script("git", |_| async { Ok(ProgramAnswer::new()) }));
        assert_eq!(
            ended(&spawned(&mock, "git", SpawnOptions::new())).await,
            "0 [] []"
        );
    }

    /// A stream that keeps what it is given.
    #[derive(Default)]
    struct Received(Mutex<Vec<String>>);

    impl OutputStream for Received {
        fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
            self.0
                .lock()
                .unwrap()
                .push(String::from_utf8_lossy(bytes).into_owned());
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn an_inherited_stream_writes_to_the_mocks_own_stream_a_stream_receives_and_ignore_drops()
    {
        let received = Arc::new(Received::default());
        let mock = mock_process(MockFields::new().script("git", |_| async {
            Ok(ProgramAnswer::new()
                .stderr("to-writable")
                .stdout("to-stdout"))
        }));
        let options = SpawnOptions::new()
            .stderr(ChildStream::Stream(
                Arc::clone(&received) as Arc<dyn OutputStream>
            ))
            .stdout(ChildStream::Inherit);
        assert_eq!(ended(&spawned(&mock, "git", options)).await, "0 [] []");
        assert_eq!(mock.transcript()[0], Write::Stdout("to-stdout".to_owned()));
        assert_eq!(*received.0.lock().unwrap(), ["to-writable"]);
        let ignoring = mock_process(MockFields::new().script("git", |_| async {
            Ok(ProgramAnswer::new().stderr("e").stdout("o"))
        }));
        let options = SpawnOptions::new()
            .stderr(ChildStream::Ignore)
            .stdout(ChildStream::Ignore);
        assert_eq!(ended(&spawned(&ignoring, "git", options)).await, "0 [] []");
        assert_eq!(ignoring.transcript(), []);
    }

    fn recording_cat(inputs: &Arc<Mutex<Vec<String>>>, fields: MockFields) -> Arc<MockProcess> {
        let seen = Arc::clone(inputs);
        mock_process(fields.script("cat", move |call| {
            seen.lock().unwrap().push(call.input);
            async { Ok(ProgramAnswer::new()) }
        }))
    }

    #[tokio::test]
    async fn under_an_inherited_stdin_the_calls_input_is_the_mock_stdin_text() {
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let mock = recording_cat(&inputs, MockFields::new().stdin("piped"));
        let _ = ended(&spawned(&mock, "cat", SpawnOptions::new().inherit_stdin())).await;
        let _ = ended(&spawned(&mock, "cat", SpawnOptions::new())).await;
        assert_eq!(*inputs.lock().unwrap(), ["piped", ""]);
    }

    #[tokio::test]
    async fn under_an_inherited_stdin_byte_stdin_is_the_calls_input_decoded_as_utf8() {
        let inputs = Arc::new(Mutex::new(Vec::new()));
        let mock = recording_cat(
            &inputs,
            MockFields::new().stdin("caf\u{e9}".as_bytes().to_vec()),
        );
        let _ = ended(&spawned(&mock, "cat", SpawnOptions::new().inherit_stdin())).await;
        assert_eq!(*inputs.lock().unwrap(), ["caf\u{e9}"]);
    }

    #[tokio::test]
    #[should_panic(
        expected = "mockProcess has no program for \"git\". Add a \"git\" entry to programs."
    )]
    async fn a_command_with_no_script_panics_from_spawn_naming_the_command() {
        let mock = mock_process(
            MockFields::new().script("/usr/bin/git", |_| async { Ok(ProgramAnswer::new()) }),
        );
        let _ = spawned(&mock, "git", SpawnOptions::new());
    }

    #[tokio::test]
    async fn a_script_that_fails_is_a_program_that_could_not_start() {
        let mock = mock_process(MockFields::new().script("git", |_| async {
            Err(io::Error::new(io::ErrorKind::NotFound, "spawn git ENOENT"))
        }));
        let child = spawned(&mock, "git", SpawnOptions::new());
        assert_eq!(ended(&child).await, "unstarted: spawn git ENOENT");
    }

    #[tokio::test]
    async fn exited_resolves_after_the_script_answers_never_before_spawn_returns() {
        let order = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&order);
        let mock = mock_process(MockFields::new().script("git", move |_| {
            seen.lock().unwrap().push("script");
            async { Ok(ProgramAnswer::new()) }
        }));
        let child = spawned(&mock, "git", SpawnOptions::new());
        order.lock().unwrap().push("returned");
        let _ = child.exited().await;
        assert_eq!(*order.lock().unwrap(), ["returned", "script"]);
    }

    /// A program that never answers, keeping the call it received.
    fn sleeping(seen: &Arc<Mutex<Option<ProgramCall>>>) -> Arc<MockProcess> {
        let seen = Arc::clone(seen);
        mock_process(MockFields::new().script("sleep", move |call| {
            *seen.lock().unwrap() = Some(call);
            std::future::pending()
        }))
    }

    #[tokio::test]
    async fn a_cancellation_of_the_spawn_signal_ends_the_child_with_sigterm_and_the_call_signal_cancels()
     {
        let seen = Arc::new(Mutex::new(None));
        let mock = sleeping(&seen);
        let signal = CancellationToken::new();
        let child = spawned(&mock, "sleep", SpawnOptions::new().signal(signal.clone()));
        while seen.lock().unwrap().is_none() {
            tokio::task::yield_now().await;
        }
        signal.cancel();
        assert_eq!(ended(&child).await, "143 [] []");
        assert!(seen.lock().unwrap().as_ref().unwrap().signal.is_cancelled());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn an_already_cancelled_spawn_signal_ends_the_child_with_143_on_any_worker() {
        let mock = mock_process(
            MockFields::new().script("git", |_| async { Ok(ProgramAnswer::new().stdout("ran")) }),
        );
        let signal = CancellationToken::new();
        signal.cancel();
        for _ in 0..2000 {
            let child = spawned(&mock, "git", SpawnOptions::new().signal(signal.clone()));
            assert_eq!(ended(&child).await, "143 [] []");
        }
    }

    #[tokio::test]
    async fn a_kill_of_an_ending_signal_ends_the_child_with_128_plus_its_number_whatever_the_script_answers_later()
     {
        let ended_codes = [
            (KillSignal::Signal(ProcessSignal::Hup), 129),
            (KillSignal::Signal(ProcessSignal::Int), 130),
            (KillSignal::Kill, 137),
            (KillSignal::Signal(ProcessSignal::Quit), 131),
            (KillSignal::Signal(ProcessSignal::Term), 143),
        ];
        let answers = Arc::new(Mutex::new(
            Vec::<tokio::sync::oneshot::Sender<ProgramAnswer>>::new(),
        ));
        let held = Arc::clone(&answers);
        let mock = mock_process(MockFields::new().script("sleep", move |_| {
            let (answer, answered) = tokio::sync::oneshot::channel();
            held.lock().unwrap().push(answer);
            async move { Ok(answered.await.unwrap_or_default()) }
        }));
        for (signal, code) in ended_codes {
            let child = spawned(&mock, "sleep", SpawnOptions::new());
            tokio::task::yield_now().await;
            child.kill(signal);
            if let Some(answer) = answers.lock().unwrap().pop() {
                let _ = answer.send(ProgramAnswer::new().stdout("late"));
            }
            match child.exited().await {
                ChildExit::Exited {
                    code: ended,
                    stdout,
                    stderr,
                } => {
                    assert_eq!(ended, code);
                    assert_eq!((stdout.bytes, stderr.bytes), (Vec::new(), Vec::new()));
                }
                _ => panic!("the child exited"),
            }
        }
    }

    #[tokio::test]
    async fn a_kill_of_sigtstp_or_sigcont_cancels_nothing_and_does_not_end_the_child() {
        let seen = Arc::new(Mutex::new(None));
        let held = Arc::clone(&seen);
        let mock = mock_process(MockFields::new().script("sleep", move |call| {
            *held.lock().unwrap() = Some(call);
            async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok(ProgramAnswer::new().stdout("done"))
            }
        }));
        let child = spawned(&mock, "sleep", SpawnOptions::new());
        child.kill(KillSignal::Signal(ProcessSignal::Tstp));
        child.kill(KillSignal::Signal(ProcessSignal::Cont));
        assert_eq!(ended(&child).await, "0 [done] []");
        assert!(!seen.lock().unwrap().as_ref().unwrap().signal.is_cancelled());
    }

    #[tokio::test]
    async fn a_kill_once_the_child_has_exited_does_nothing() {
        let mock =
            mock_process(MockFields::new().script("git", |_| async { Ok(ProgramAnswer::new()) }));
        let child = spawned(&mock, "git", SpawnOptions::new());
        let _ = child.exited().await;
        child.kill(KillSignal::Signal(ProcessSignal::Term));
        assert_eq!(ended(&child).await, "0 [] []");
    }

    #[tokio::test]
    async fn a_detached_child_is_a_call_with_detached_set_and_no_input_and_its_output_is_ignored() {
        let calls = Arc::new(Mutex::new(Vec::<ProgramCall>::new()));
        let seen = Arc::clone(&calls);
        let mock = mock_process(
            MockFields::new()
                .script("notes", move |call| {
                    seen.lock().unwrap().push(call);
                    async { Ok(ProgramAnswer::new().stdout("lost")) }
                })
                .stdin("unread"),
        );
        let child = mock.spawn(SpawnRequest::detached(
            "notes",
            ["refresh"],
            "/cache",
            Env::new(),
        ));
        assert_eq!(ended(&child).await, "0 [] []");
        let calls = calls.lock().unwrap();
        assert_eq!(calls[0].args, ["refresh"]);
        assert_eq!(calls[0].cwd, PathBuf::from("/cache"));
        assert_eq!((calls[0].detached, calls[0].input.as_str()), (true, ""));
        assert_eq!(mock.transcript(), []);
    }

    #[test]
    fn child_output_decodes_its_bytes() {
        assert_eq!(ChildOutput::new(vec![0x68, 0xff]).text, "h\u{fffd}");
    }
}

mod piped_stdin {
    use super::*;

    #[tokio::test]
    async fn yields_bytes_that_are_not_valid_utf8_exactly_as_given_as_one_chunk() {
        let bytes = vec![0xff, 0xfe, 0x00, 0xc3, 0x28];
        let mock = mock_process(MockFields::new().stdin(bytes.clone()));
        let stdin = mock.stdin();
        let mut buffer = [0_u8; 64];
        let count = stdin.read(&mut buffer).await.unwrap();
        assert_eq!(&buffer[..count], bytes.as_slice());
        assert_eq!(stdin.read(&mut buffer).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn yields_nothing_for_empty_bytes() {
        let mock = mock_process(MockFields::new().stdin(Vec::new()));
        assert_eq!(drained(&mock.stdin()).await, b"");
    }

    #[tokio::test]
    async fn yields_the_text_once_over_the_mock_life_then_ends() {
        let mock = mock_process(MockFields::new().stdin("hello\n"));
        assert_eq!(drained(&mock.stdin()).await, b"hello\n");
        assert_eq!(drained(&mock.stdin()).await, b"");
    }

    #[tokio::test]
    async fn bytes_pushed_back_come_before_the_bytes_not_yet_read() {
        let mock = mock_process(MockFields::new().stdin("cd"));
        let stdin = mock.stdin();
        let mut first = [0_u8; 1];
        assert_eq!(stdin.read(&mut first).await.unwrap(), 1);
        assert_eq!(&first, b"c");
        stdin.unshift(b"ab");
        assert_eq!(drained(&stdin).await, b"abd");
    }

    #[test]
    fn is_never_a_terminal_even_beside_a_terminal() {
        let mock = mock_process(
            MockFields::new()
                .stdin("x")
                .terminal(MockTerminal::new(80, 24)),
        );
        assert_eq!(mock.terminal().stdin(), InputTerminal::new(false));
        assert!(mock.stdin().set_raw_mode(true).is_err());
    }

    #[test]
    #[should_panic(expected = "mockProcess takes piped stdin or a terminal's keys, not both")]
    fn piped_stdin_and_keys_are_exclusive() {
        let terminal = MockTerminal::new(80, 24).keys(Vec::<KeyEntry>::new());
        let _ = mock_process(MockFields::new().stdin("x").terminal(terminal));
    }
}

mod the_terminal {
    use super::*;

    #[test]
    fn puts_stdout_and_stderr_on_a_terminal_with_the_given_size_by_default() {
        let terminal =
            mock_process(MockFields::new().terminal(MockTerminal::new(80, 24))).terminal();
        assert_eq!(
            terminal.stdout(),
            OutputTerminal::new(true, Some(80), Some(24))
        );
        assert_eq!(
            terminal.stderr(),
            OutputTerminal::new(true, Some(80), Some(24))
        );
    }

    #[test]
    fn puts_only_the_named_streams_on_the_terminal() {
        let named = MockTerminal::new(80, 24).streams([StreamName::Stderr]);
        let terminal = mock_process(MockFields::new().terminal(named)).terminal();
        assert_eq!(terminal.stdout(), OutputTerminal::new(false, None, None));
        assert!(terminal.stderr().is_tty);
    }

    #[test]
    fn resize_changes_what_the_next_read_returns() {
        let mock = mock_process(MockFields::new().terminal(MockTerminal::new(80, 24)));
        let before = mock.terminal().stdout().columns;
        mock.resize(40, 10);
        let terminal = mock.terminal();
        assert_eq!(
            [before, terminal.stdout().columns, terminal.stderr().rows],
            [Some(80), Some(40), Some(10)]
        );
    }

    #[test]
    fn resize_reports_no_size_on_a_mock_without_a_terminal() {
        let mock = mock_process(MockFields::new());
        mock.resize(40, 10);
        assert_eq!(mock.terminal().stdout().columns, None);
    }

    #[test]
    fn a_stated_background_is_on_the_terminal() {
        let terminal = MockTerminal::new(1, 1).background(Background::Dark);
        let mock = mock_process(MockFields::new().terminal(terminal));
        assert_eq!(mock.terminal().background(), Some(Background::Dark));
    }
}

mod recording {
    use super::*;

    #[tokio::test]
    async fn decodes_utf8_split_across_writes() {
        let mock = mock_process(MockFields::new());
        let bytes = "\u{e9}".as_bytes();
        write(&mock.stdout(), &bytes[..1]).await;
        write(&mock.stdout(), &bytes[1..]).await;
        assert_eq!(mock.stdout_text(), "\u{e9}");
    }

    #[tokio::test]
    async fn end_flushes_a_character_the_last_write_left_incomplete() {
        let mock = mock_process(MockFields::new());
        let bytes = "a\u{e9}".as_bytes();
        write(&mock.stdout(), &bytes[..2]).await;
        assert_eq!(mock.stdout_text(), "a");
        mock.end_output();
        assert_eq!(mock.stdout_text(), "a\u{fffd}");
        assert_eq!(
            mock.transcript(),
            [
                Write::Stdout("a".to_owned()),
                Write::Stdout("\u{fffd}".to_owned())
            ]
        );
    }

    #[tokio::test]
    async fn keeps_each_write_in_order_tagged_by_stream() {
        let mock = mock_process(MockFields::new());
        write(&mock.stdout(), b"a").await;
        write(&mock.stderr(), b"b").await;
        write(&mock.stdout(), b"c").await;
        assert_eq!(
            mock.transcript(),
            [
                Write::Stdout("a".to_owned()),
                Write::Stderr("b".to_owned()),
                Write::Stdout("c".to_owned())
            ]
        );
        assert_eq!(
            (mock.stdout_text(), mock.stderr_text()),
            ("ac".to_owned(), "b".to_owned())
        );
    }

    #[test]
    fn records_the_exit_code_written_to_it() {
        let mock = mock_process(MockFields::new());
        mock.set_exit_code(code(2));
        assert_eq!(mock.exit_code(), Some(code(2)));
    }
}

mod signals {
    use super::*;

    const LISTENABLE: [ProcessSignal; 6] = [
        ProcessSignal::Hup,
        ProcessSignal::Int,
        ProcessSignal::Quit,
        ProcessSignal::Term,
        ProcessSignal::Tstp,
        ProcessSignal::Cont,
    ];

    /// A listener that records `name` in `heard`.
    fn hearing(heard: &Arc<Mutex<Vec<String>>>, name: &str) -> loomcli_core::SignalListener {
        let heard = Arc::clone(heard);
        let name = name.to_owned();
        Arc::new(move |_| heard.lock().unwrap().push(name.clone()))
    }

    #[test]
    fn a_raise_reaches_its_listener_synchronously_and_only_its_own() {
        for signal in LISTENABLE {
            let mock = mock_process(MockFields::new());
            let heard = Arc::new(Mutex::new(Vec::new()));
            for other in LISTENABLE {
                let _ = mock.signals().on(
                    SignalEvent::Signal(other),
                    hearing(&heard, &format!("{other:?}")),
                );
            }
            mock.signals().raise(signal);
            assert_eq!(*heard.lock().unwrap(), [format!("{signal:?}")]);
            assert_eq!(mock.ended_by(), None);
        }
    }

    #[test]
    fn a_listener_added_during_a_raise_runs_on_the_next_raise_not_this_one() {
        let mock = mock_process(MockFields::new());
        let heard = Arc::new(Mutex::new(Vec::new()));
        let signals = mock.signals();
        let adding = {
            let heard = Arc::clone(&heard);
            let signals = Arc::clone(&signals);
            Arc::new(move |_: Option<i32>| {
                heard.lock().unwrap().push("first".to_owned());
                let _ = signals.on(
                    SignalEvent::Signal(ProcessSignal::Int),
                    hearing(&heard, "added"),
                );
            })
        };
        let _ = signals.on(SignalEvent::Signal(ProcessSignal::Int), adding);
        signals.raise(ProcessSignal::Int);
        assert_eq!(*heard.lock().unwrap(), ["first"]);
        signals.raise(ProcessSignal::Int);
        assert_eq!(*heard.lock().unwrap(), ["first", "first", "added"]);
    }

    #[test]
    fn off_removes_a_listener_so_the_signal_then_finds_none() {
        let mock = mock_process(MockFields::new());
        let heard = Arc::new(Mutex::new(Vec::new()));
        let id = mock.signals().on(
            SignalEvent::Signal(ProcessSignal::Term),
            hearing(&heard, "1"),
        );
        mock.signals().off(id);
        mock.signals().raise(ProcessSignal::Term);
        assert!(heard.lock().unwrap().is_empty());
        assert_eq!(mock.ended_by(), Some(ProcessSignal::Term));
    }

    #[test]
    fn accepts_exit_listeners_without_calling_them_on_a_signal() {
        let mock = mock_process(MockFields::new());
        let heard = Arc::new(Mutex::new(Vec::new()));
        let id = mock
            .signals()
            .on(SignalEvent::Exit, hearing(&heard, "exit"));
        let _ = mock
            .signals()
            .on(SignalEvent::Signal(ProcessSignal::Int), Arc::new(|_| {}));
        mock.signals().raise(ProcessSignal::Int);
        mock.signals().off(id);
        assert!(heard.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_unheard_ending_signal_ends_the_mock_and_nothing_later_is_delivered_or_recorded() {
        for signal in [
            ProcessSignal::Hup,
            ProcessSignal::Int,
            ProcessSignal::Quit,
            ProcessSignal::Term,
        ] {
            let mock = mock_process(MockFields::new());
            write(&mock.stdout(), b"before").await;
            mock.set_exit_code(ExitCode::SUCCESS);
            mock.signals().raise(signal);
            let heard = Arc::new(Mutex::new(Vec::new()));
            let _ = mock.signals().on(
                SignalEvent::Signal(ProcessSignal::Term),
                hearing(&heard, "late"),
            );
            mock.signals().raise(ProcessSignal::Term);
            write(&mock.stdout(), b"after").await;
            write(&mock.stderr(), b"after").await;
            mock.set_exit_code(code(1));
            assert_eq!(mock.ended_by(), Some(signal));
            assert!(heard.lock().unwrap().is_empty());
            assert_eq!(
                (mock.stdout_text(), mock.stderr_text(), mock.exit_code()),
                ("before".to_owned(), String::new(), Some(ExitCode::SUCCESS))
            );
            assert_eq!(mock.transcript(), [Write::Stdout("before".to_owned())]);
        }
    }

    #[tokio::test]
    async fn an_unheard_sigtstp_or_sigcont_does_nothing() {
        for signal in [ProcessSignal::Tstp, ProcessSignal::Cont] {
            let mock = mock_process(MockFields::new());
            mock.raise(signal);
            write(&mock.stdout(), b"still").await;
            assert_eq!(
                (mock.ended_by(), mock.stdout_text()),
                (None, "still".to_owned())
            );
        }
    }

    #[test]
    fn two_mocks_share_no_signals() {
        let one = mock_process(MockFields::new());
        let two = mock_process(MockFields::new());
        let heard = Arc::new(Mutex::new(Vec::new()));
        let _ = one.signals().on(
            SignalEvent::Signal(ProcessSignal::Int),
            hearing(&heard, "one"),
        );
        two.signals().raise(ProcessSignal::Int);
        assert!(heard.lock().unwrap().is_empty());
        assert_eq!(two.ended_by(), Some(ProcessSignal::Int));
    }
}

mod the_keyboard {
    use super::*;

    const NO_KEYS_LEFT: &str =
        "mockProcess has no keys left for this read. Add an entry to terminal.keys.";

    fn keyboard(keys: impl IntoIterator<Item = KeyEntry>) -> Arc<MockProcess> {
        mock_process(MockFields::new().terminal(MockTerminal::new(80, 24).keys(keys)))
    }

    #[test]
    fn keys_make_stdin_a_terminal_and_the_signal_sources_terminal() {
        let mock = keyboard([]);
        assert_eq!(mock.terminal().stdin(), InputTerminal::new(true));
        let terminal = mock
            .signals()
            .terminal()
            .expect("the keyboard is the source's terminal");
        assert!(std::ptr::addr_eq(
            Arc::as_ptr(&terminal),
            Arc::as_ptr(&mock.stdin())
        ));
    }

    #[test]
    fn a_terminal_whose_keys_are_absent_leaves_stdin_piped() {
        let mock = mock_process(MockFields::new().terminal(MockTerminal::new(80, 24)));
        assert_eq!(mock.terminal().stdin(), InputTerminal::new(false));
        assert!(mock.signals().terminal().is_none());
    }

    #[tokio::test]
    async fn each_switch_into_raw_mode_hands_over_the_next_entry() {
        let mock = keyboard(["8080\r".into(), "ann\r".into()]);
        let stdin = mock.stdin();
        assert!(!mock.is_raw());
        stdin.set_raw_mode(true).unwrap();
        assert!(mock.is_raw());
        assert_eq!(read_once(&stdin).await.unwrap(), "8080\r");
        stdin.set_raw_mode(false).unwrap();
        assert!(!mock.is_raw());
        stdin.set_raw_mode(true).unwrap();
        assert_eq!(read_once(&stdin).await.unwrap(), "ann\r");
        stdin.set_raw_mode(false).unwrap();
    }

    #[tokio::test]
    async fn a_switch_into_raw_mode_with_no_entry_left_fails_the_read() {
        let mock = keyboard(["8080\r".into()]);
        let stdin = mock.stdin();
        stdin.set_raw_mode(true).unwrap();
        assert_eq!(read_once(&stdin).await.unwrap(), "8080\r");
        stdin.set_raw_mode(false).unwrap();
        stdin.set_raw_mode(true).unwrap();
        assert_eq!(
            read_once(&stdin).await.unwrap_err().to_string(),
            NO_KEYS_LEFT
        );
    }

    #[tokio::test]
    async fn answers_the_background_query_at_once_with_no_answer_and_uses_no_entry() {
        let mock = mock_process(
            MockFields::new()
                .env("TERM", "xterm-256color")
                .terminal(MockTerminal::new(80, 24).keys(["8080\r"])),
        );
        let stdin = mock.stdin();
        let started = Instant::now();
        stdin.set_raw_mode(true).unwrap();
        write(
            &mock.stderr(),
            "\u{1b}]11;?\u{1b}\\\u{1b}[?996n\u{1b}[c".as_bytes(),
        )
        .await;
        assert_eq!(read_once(&stdin).await.unwrap(), "\u{1b}[?1;2c");
        stdin.set_raw_mode(false).unwrap();
        assert!(started.elapsed() < Duration::from_secs(1));
        stdin.set_raw_mode(true).unwrap();
        assert_eq!(read_once(&stdin).await.unwrap(), "8080\r");
    }

    #[tokio::test]
    async fn typeahead_pushed_back_after_the_query_reaches_the_next_read_before_the_next_entry() {
        let mock = mock_process(
            MockFields::new()
                .env("TERM", "xterm-256color")
                .terminal(MockTerminal::new(80, 24).keys(["8080\r"])),
        );
        let stdin = mock.stdin();
        stdin.set_raw_mode(true).unwrap();
        write(
            &mock.stderr(),
            "\u{1b}]11;?\u{1b}\\\u{1b}[?996n\u{1b}[c".as_bytes(),
        )
        .await;
        assert_eq!(read_once(&stdin).await.unwrap(), "\u{1b}[?1;2c");
        stdin.set_raw_mode(false).unwrap();
        stdin.unshift(b"q");
        assert_eq!(read_once(&stdin).await.unwrap(), "q");
        stdin.set_raw_mode(true).unwrap();
        assert_eq!(read_once(&stdin).await.unwrap(), "8080\r");
    }

    #[tokio::test]
    async fn an_array_entry_hands_each_later_read_100_ms_after_the_one_before() {
        let mock = keyboard([KeyEntry::reads(["ab", "cd"])]);
        let stdin = mock.stdin();
        let started = Instant::now();
        stdin.set_raw_mode(true).unwrap();
        assert_eq!(read_once(&stdin).await.unwrap(), "ab");
        assert_eq!(read_once(&stdin).await.unwrap(), "cd");
        assert!(started.elapsed() >= Duration::from_millis(99));
    }

    #[tokio::test]
    async fn an_array_entry_holds_each_later_read_for_a_reader_that_comes_late() {
        let mock = keyboard([["ab", "cd", "ef"].into()]);
        let stdin = mock.stdin();
        stdin.set_raw_mode(true).unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        let mut reads = Vec::new();
        for _ in 0..3 {
            reads.push(read_once(&stdin).await.unwrap());
        }
        assert_eq!(reads, ["ab", "cd", "ef"]);
    }

    #[tokio::test]
    async fn a_switch_out_of_raw_mode_ends_an_array_entry_so_its_later_reads_are_never_handed_over()
    {
        let mock = keyboard([["ab", "cd"].into()]);
        let stdin = mock.stdin();
        stdin.set_raw_mode(true).unwrap();
        assert_eq!(read_once(&stdin).await.unwrap(), "ab");
        stdin.set_raw_mode(false).unwrap();
        let mut buffer = [0_u8; 8];
        let later = tokio::time::timeout(Duration::from_millis(150), stdin.read(&mut buffer)).await;
        assert!(later.is_err(), "no later read arrives");
    }

    #[tokio::test]
    async fn a_reader_holds_the_keyboard_in_raw_mode_until_it_lets_go() {
        let mock = keyboard(["8080\r".into()]);
        let stdin = mock.stdin();
        let mut seen = vec![mock.is_raw()];
        stdin.set_raw_mode(true).unwrap();
        let _ = read_once(&stdin).await.unwrap();
        seen.push(mock.is_raw());
        stdin.set_raw_mode(false).unwrap();
        seen.push(mock.is_raw());
        assert_eq!(seen, [false, true, false]);
    }

    #[tokio::test]
    async fn the_keyboard_hears_only_the_streams_on_its_terminal() {
        let mock = mock_process(
            MockFields::new().terminal(
                MockTerminal::new(80, 24)
                    .streams([StreamName::Stdout])
                    .keys(["typed"]),
            ),
        );
        let stdin = mock.stdin();
        stdin.set_raw_mode(true).unwrap();
        // The query goes to stderr, which is not on the terminal, so the keyboard hands over its entry.
        write(&mock.stderr(), b"\x1b]11;?").await;
        assert_eq!(read_once(&stdin).await.unwrap(), "typed");
    }
}
