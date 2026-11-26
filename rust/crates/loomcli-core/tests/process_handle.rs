//! The real process's handle, under `host.md`: the reference's `process-handle.test.ts`,
//! `home-folders.test.ts`, and `development-builds.test.ts` cases that concern the handle itself.
//! Each supplied field replaces its whole field; a fact not given reads the process.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    BoxFuture, Build, DirectoryFacts, Env, InputTerminal, Libc, OutputStream, OutputTerminal,
    ProcessFields, ProcessTerminal, Release, ReleaseFacts, process_handle,
};

fn env(pairs: &[(&str, &str)]) -> Env {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect()
}

/// A fresh directory under the target's scratch directory for one case.
fn scratch(name: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("handle-{name}"));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn a_supplied_environment_replaces_the_process_environment_rather_than_merging_into_it() {
    let handle = process_handle(ProcessFields::new().env(env(&[("ONLY", "supplied")])));
    assert_eq!(handle.env(), env(&[("ONLY", "supplied")]));
}

#[test]
fn an_absolute_cwd_is_the_working_directory_read_with_no_failure() {
    let handle = process_handle(ProcessFields::new().cwd("/srv/notes"));
    assert_eq!(handle.cwd().unwrap(), PathBuf::from("/srv/notes"));
}

#[test]
fn a_relative_cwd_resolves_against_the_process_working_directory_at_each_read() {
    let handle = process_handle(ProcessFields::new().cwd("project"));
    let own = std::env::current_dir().unwrap();
    assert_eq!(handle.cwd().unwrap(), own.join("project"));
}

#[test]
fn a_cwd_read_that_fails_fails_the_read_with_its_error() {
    let handle = process_handle(
        ProcessFields::new().cwd_with(|| Err(io::Error::new(io::ErrorKind::NotFound, "uv_cwd"))),
    );
    assert_eq!(handle.cwd().unwrap_err().kind(), io::ErrorKind::NotFound);
    let live = process_handle(ProcessFields::new().cwd_with(|| Ok(PathBuf::from("/live"))));
    assert_eq!(live.cwd().unwrap(), PathBuf::from("/live"));
}

#[test]
fn the_handle_reports_the_baked_target_triple_unless_given_a_runtime_fact() {
    let handle = process_handle(ProcessFields::new());
    assert_eq!(handle.runtime().as_deref(), Some(env!("LOOM_BUILD_TARGET")));

    let supplied = "aarch64-apple-darwin".to_owned();
    let handle = process_handle(ProcessFields::new().runtime(Some(supplied.clone())));
    assert_eq!(handle.runtime(), Some(supplied));
    let handle = process_handle(ProcessFields::new().runtime(None));
    assert_eq!(handle.runtime(), None);
}

#[test]
fn the_handle_reads_the_processs_own_architecture_and_user_unless_given_them() {
    let handle = process_handle(ProcessFields::new());
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    assert_eq!(handle.arch(), arch);
    assert_eq!(handle.uid(), Some(rustix::process::getuid().as_raw()));
    assert!(matches!(
        handle.libc(),
        Some(Libc::Glibc | Libc::Musl) | None
    ));
    if cfg!(all(target_os = "linux", target_env = "gnu")) {
        assert_eq!(handle.libc(), Some(Libc::Glibc));
    }
    let given = process_handle(
        ProcessFields::new()
            .arch("arm64")
            .uid(None)
            .libc(Some(Libc::Musl)),
    );
    assert_eq!(
        (given.arch(), given.uid(), given.libc()),
        ("arm64".to_owned(), None, Some(Libc::Musl))
    );
}

#[test]
fn supplied_words_platform_time_zone_and_release_replace_their_fields() {
    let release = ReleaseFacts::new(Build::Development);
    let handle = process_handle(
        ProcessFields::new()
            .argv(["original"])
            .program(["/bin/notes"])
            .platform("darwin")
            .time_zone("Pacific/Auckland")
            .release(release.clone()),
    );
    assert_eq!(handle.argv(), ["original"]);
    assert_eq!(handle.program(), ["/bin/notes"]);
    assert_eq!(handle.platform(), "darwin");
    assert_eq!(handle.time_zone(), "Pacific/Auckland");
    assert_eq!(handle.release(), release);
}

#[test]
fn a_supplied_release_is_taken_as_given_and_reads_no_installation_record() {
    let compiled = ReleaseFacts::new(Build::Distributed)
        .release(Release::new("1.0.0", "acme/notes").asset("notes-linux-x64"));
    let handle = process_handle(ProcessFields::new().release(compiled.clone()));
    let facts = DirectoryFacts::new(Env::new(), "/loom-test/home", "linux");
    assert_eq!(handle.release_for("notes", &facts), compiled);
    let baked = process_handle(ProcessFields::new());
    assert_eq!(baked.release_for("notes", &facts), ReleaseFacts::baked());
}

#[test]
fn every_handle_shares_the_real_processs_one_signal_source() {
    let first = process_handle(ProcessFields::new()).signals();
    let second = process_handle(ProcessFields::new().argv(["other"])).signals();
    assert!(std::ptr::addr_eq(Arc::as_ptr(&first), Arc::as_ptr(&second)));
}

#[test]
fn a_handle_publishes_only_when_it_was_given_neither_env_nor_cwd() {
    let name = format!("LOOM_HANDLE_TEST_PUBLISHED_{}", std::process::id());
    process_handle(ProcessFields::new().env(Env::new())).publish_env(&name, "env");
    process_handle(ProcessFields::new().cwd("/work")).publish_env(&name, "cwd");
    assert_eq!(process_handle(ProcessFields::new()).env().get(&name), None);
    process_handle(ProcessFields::new().argv(["x"])).publish_env(&name, "published");
    process_handle(ProcessFields::new()).publish_env(&name, "later");
    assert_eq!(
        process_handle(ProcessFields::new())
            .env()
            .get(&name)
            .map(String::as_str),
        Some("published")
    );
}

#[test]
fn an_absolute_home_and_tmpdir_in_the_supplied_env_are_the_folders() {
    let handle = process_handle(
        ProcessFields::new().env(env(&[("HOME", "/srv/notes"), ("TMPDIR", "/srv/scratch")])),
    );
    assert_eq!(handle.home(), PathBuf::from("/srv/notes"));
    assert_eq!(handle.tmpdir(), PathBuf::from("/srv/scratch"));
}

#[test]
fn a_home_that_is_unset_empty_or_relative_gives_the_user_database_home() {
    for home in [None, Some(""), Some("notes/home")] {
        let supplied = home.map_or_else(Env::new, |home| env(&[("HOME", home)]));
        let handle = process_handle(ProcessFields::new().env(supplied));
        let found = handle.home();
        assert!(
            found.as_os_str().is_empty() || found.is_absolute(),
            "{home:?}"
        );
        assert_ne!(found, PathBuf::from("notes/home"));
    }
}

#[test]
fn a_tmpdir_that_is_unset_empty_or_relative_gives_tmp_whatever_tmp_and_temp_hold() {
    for tmpdir in [None, Some(""), Some("scratch")] {
        let mut supplied = env(&[("TEMP", "/srv/temp"), ("TMP", "/srv/tmp")]);
        if let Some(tmpdir) = tmpdir {
            supplied.insert("TMPDIR".to_owned(), tmpdir.to_owned());
        }
        let handle = process_handle(ProcessFields::new().env(supplied));
        assert_eq!(handle.tmpdir(), PathBuf::from("/tmp"), "{tmpdir:?}");
    }
}

#[test]
fn a_supplied_home_and_tmpdir_win_over_the_environment_even_when_not_absolute() {
    let handle = process_handle(
        ProcessFields::new()
            .env(env(&[("HOME", "/srv/notes"), ("TMPDIR", "/srv/scratch")]))
            .home("/home/me")
            .tmpdir("/var/tmp"),
    );
    assert_eq!(
        (handle.home(), handle.tmpdir()),
        (PathBuf::from("/home/me"), PathBuf::from("/var/tmp"))
    );
    let empty = process_handle(
        ProcessFields::new()
            .env(env(&[("HOME", "/srv/notes")]))
            .home(""),
    );
    assert_eq!(empty.home(), PathBuf::new());
}

/// Terminal facts with fixed numbers.
struct Panel;

impl ProcessTerminal for Panel {
    fn stdin(&self) -> InputTerminal {
        InputTerminal::new(true)
    }
    fn stdout(&self) -> OutputTerminal {
        OutputTerminal::new(true, Some(81), Some(25))
    }
    fn stderr(&self) -> OutputTerminal {
        OutputTerminal::new(false, None, None)
    }
}

/// A stream that keeps what it is given.
#[derive(Default)]
struct Sink(Mutex<Vec<u8>>);

impl OutputStream for Sink {
    fn write<'a>(&'a self, bytes: &'a [u8]) -> BoxFuture<'a, io::Result<()>> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Box::pin(async { Ok(()) })
    }
}

#[test]
fn supplied_terminal_facts_stay_independent_of_the_supplied_streams() {
    let sink: Arc<dyn OutputStream> = Arc::new(Sink::default());
    let handle = process_handle(
        ProcessFields::new()
            .stdout(Arc::clone(&sink))
            .terminal(Arc::new(Panel)),
    );
    assert!(std::ptr::addr_eq(
        Arc::as_ptr(&handle.stdout()),
        Arc::as_ptr(&sink)
    ));
    let terminal = handle.terminal();
    assert_eq!(
        terminal.stdout(),
        OutputTerminal::new(true, Some(81), Some(25))
    );
    assert_eq!(terminal.stdin(), InputTerminal::new(true));
}

#[test]
fn a_zero_terminal_reading_is_unavailable() {
    assert_eq!(
        OutputTerminal::new(true, Some(0), Some(0)),
        OutputTerminal::new(true, None, None)
    );
}

#[test]
fn the_captured_reader_refuses_a_link_that_leaves_the_working_directory_a_path_that_is_not_a_file_and_a_file_over_one_mebibyte()
 {
    let root = scratch("reader");
    let cwd = root.join("project");
    std::fs::create_dir_all(&cwd).unwrap();
    std::fs::write(cwd.join("own.rs"), "panic!(\"own\");\n").unwrap();
    std::fs::write(root.join("outside.rs"), "outside").unwrap();
    std::fs::write(cwd.join("large.rs"), "x".repeat(1024 * 1024 + 1)).unwrap();
    std::fs::create_dir_all(cwd.join("folder")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(root.join("outside.rs"), cwd.join("escape.rs")).unwrap();
    let handle = process_handle(ProcessFields::new());
    let read = |path: &Path| handle.read_source(&path.to_string_lossy(), &cwd.to_string_lossy());
    assert_eq!(
        read(&cwd.join("own.rs")).as_deref(),
        Some("panic!(\"own\");\n")
    );
    assert_eq!(read(&root.join("outside.rs")), None);
    assert_eq!(read(&cwd.join("escape.rs")), None);
    assert_eq!(read(&cwd.join("large.rs")), None);
    assert_eq!(read(&cwd.join("folder")), None);
    assert_eq!(read(&cwd.join("missing.rs")), None);
    assert_eq!(read(&cwd), None);
}

/// Runs `read` on its own thread and answers what it read, or panics when it is still blocked
/// after five seconds, so a read that would wait for good fails the case instead of hanging it.
fn promptly<T: Send + 'static>(read: impl FnOnce() -> T + Send + 'static) -> T {
    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(read());
    });
    finished
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("the read answers without waiting for a writer")
}

#[cfg(unix)]
#[test]
fn the_captured_reader_answers_none_for_a_fifo_at_once_with_no_writer() {
    let cwd = scratch("reader-fifo");
    let fifo = cwd.join("excerpt.rs");
    // The mkfifo program, because rustix offers no mkfifo on Apple targets.
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );
    let handle = process_handle(ProcessFields::new());
    let (path, root) = (
        fifo.to_string_lossy().into_owned(),
        cwd.to_string_lossy().into_owned(),
    );
    assert_eq!(promptly(move || handle.read_source(&path, &root)), None);
}

#[test]
fn the_captured_reader_decodes_an_invalid_byte_as_a_replacement_character() {
    let cwd = scratch("reader-lossy");
    std::fs::write(cwd.join("odd.rs"), b"let a = \"\xff\";\n").unwrap();
    let handle = process_handle(ProcessFields::new());
    assert_eq!(
        handle
            .read_source(
                &cwd.join("odd.rs").to_string_lossy(),
                &cwd.to_string_lossy()
            )
            .as_deref(),
        Some("let a = \"\u{fffd}\";\n")
    );
}

#[test]
fn a_supplied_source_reader_replaces_the_real_one() {
    let handle = process_handle(
        ProcessFields::new().read_source(|path, _cwd| Some(format!("source of {path}"))),
    );
    assert_eq!(
        handle.read_source("a.rs", "/").as_deref(),
        Some("source of a.rs")
    );
}

#[cfg(unix)]
#[test]
fn the_real_source_delivers_a_raised_signal_to_its_listener_and_off_removes_it() {
    use loomcli_core::{ProcessSignal, SignalEvent};
    let signals = process_handle(ProcessFields::new()).signals();
    let (heard, hearing) = std::sync::mpsc::channel();
    let id = signals.on(
        SignalEvent::Signal(ProcessSignal::Cont),
        Arc::new(move |status| {
            let _ = heard.send(status);
        }),
    );
    signals.raise(ProcessSignal::Cont);
    assert_eq!(
        hearing.recv_timeout(std::time::Duration::from_secs(10)),
        Ok(None)
    );
    signals.off(id);
    // `SIGCONT` that nothing hears takes its default action, which leaves the process running.
    signals.raise(ProcessSignal::Cont);
    assert!(
        hearing
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_err()
    );
}

// environment-hooks.test.ts: what preparation publishes to the real process.

/// An application whose one environment hook imports `variable`, and whose action prints the value
/// its host reads, so a case reads both the run's view and the process's.
fn importing(variable: &'static str) -> loomcli_core::Application {
    loomcli_core::Application::new("app")
        .plugins([
            loomcli_core::Plugin::new("fixture/first").on_environment(move |_| async move {
                Ok(std::collections::BTreeMap::from([(
                    variable.to_owned(),
                    "imported".to_owned(),
                )]))
            }),
        ])
        .action(move |ctx: loomcli_core::Context| async move {
            let value = ctx.host.env.get(variable).cloned().unwrap_or_default();
            ctx.out.print(&value).await
        })
}

/// The value every later real handle reads for `variable`.
fn published(variable: &str) -> Option<String> {
    process_handle(ProcessFields::new())
        .env()
        .get(variable)
        .cloned()
}

/// A real handle over `fields` whose output a test keeps.
fn quiet(fields: ProcessFields) -> (Arc<dyn loomcli_core::ProcessHandle>, Arc<Sink>) {
    let sink = Arc::new(Sink::default());
    let handle = process_handle(
        fields
            .stdout(Arc::clone(&sink) as Arc<dyn OutputStream>)
            .stderr(Arc::new(Sink::default())),
    );
    (handle, sink)
}

#[tokio::test]
async fn only_an_argv_run_without_cwd_or_env_overrides_publishes_additions() {
    let cases: [(&str, ProcessFields, Option<&str>); 3] = [
        (
            "LOOM_PUBLISH_PROCESS_ARGV",
            ProcessFields::new().argv(Vec::<String>::new()),
            Some("imported"),
        ),
        (
            "LOOM_PUBLISH_PROCESS_ENV",
            ProcessFields::new()
                .argv(Vec::<String>::new())
                .env(Env::new()),
            None,
        ),
        (
            "LOOM_PUBLISH_PROCESS_CWD",
            ProcessFields::new()
                .argv(Vec::<String>::new())
                .cwd(std::env::current_dir().unwrap()),
            None,
        ),
    ];
    for (variable, fields, expected) in cases {
        assert_eq!(published(variable), None, "{variable}");
        let (handle, stdout) = quiet(fields);
        let code = importing(variable)
            .run(loomcli_core::RunOptions::new().process(handle))
            .await;
        assert_eq!(code.get(), 0, "{variable}");
        assert_eq!(*stdout.0.lock().unwrap(), b"imported\n", "{variable}");
        assert_eq!(published(variable).as_deref(), expected, "{variable}");
    }
}

#[tokio::test]
async fn an_invocation_by_name_publishes_nothing() {
    let variable = "LOOM_PUBLISH_PROCESS_NAME";
    let outcome = importing(variable)
        .invoke(
            &[],
            loomcli_core::InvocationValues::new(),
            loomcli_core::InvokeOptions::<loomcli_core::Error>::new(),
            None,
        )
        .await;
    match outcome {
        loomcli_core::InvocationOutcome::Completed { output, .. } => {
            assert_eq!(output, "imported\n");
        }
        _ => panic!("the invocation completes"),
    }
    assert_eq!(published(variable), None);
}
