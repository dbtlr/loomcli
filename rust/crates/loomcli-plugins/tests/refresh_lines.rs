//! The installing plugins' post-update refresh decisions and change events.

#![cfg(all(
    feature = "completion",
    feature = "manpage",
    feature = "skills",
    feature = "verbose"
))]
#![allow(clippy::unwrap_used)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, BoxFuture, Build, Command, Context, Error, LogEvent, LogLevel, Plugin,
    ReleaseFacts, RunOptions,
};
use loomcli_plugins::{
    completion::{RefreshContext, completion, refresh_completion},
    manpage::{manpage, refresh_manpages},
    skills::{Skill, SkillFile, refresh_skills, skills},
    verbose::verbose,
};
use loomcli_testing::{MockFields, ProgramAnswer, mock_process};
use serde_json::json;

const BINARY: &str = "/loom-test/bin/notes";

type RefreshFn = for<'a> fn(RefreshContext<'a>) -> BoxFuture<'a, Result<(), Error>>;

struct Kind {
    words: &'static [&'static str],
    record: &'static str,
    skipped: &'static str,
    warning: &'static str,
    refresh: RefreshFn,
    plugin: fn() -> Plugin,
    install: &'static [&'static str],
}

const KINDS: &[Kind] = &[
    Kind {
        words: &["completion", "update"],
        record: "completion.fish.json",
        skipped: "Skipped the completion refresh: nothing is installed.",
        warning: "Completion was not refreshed after the update.",
        refresh: |ctx| Box::pin(refresh_completion(ctx)),
        plugin: completion,
        install: &["completion", "install", "bash"],
    },
    Kind {
        words: &["manpage", "update"],
        record: "manpage.json",
        skipped: "Skipped the man page refresh: nothing is installed.",
        warning: "Man pages were not refreshed after the update.",
        refresh: |ctx| Box::pin(refresh_manpages(ctx)),
        plugin: manpage,
        install: &["manpage", "install"],
    },
    Kind {
        words: &["skills", "update"],
        record: "skills.agents.json",
        skipped: "Skipped the skills refresh: nothing is installed.",
        warning: "Skills were not refreshed after the update.",
        refresh: |ctx| Box::pin(refresh_skills(ctx)),
        plugin: || {
            skills(vec![Skill::loaded("notes", || {
                Ok(vec![SkillFile::new("SKILL.md", "# Notes\n")])
            })])
            .plugin()
        },
        install: &["skills", "install", "--agent", "agents"],
    },
];

struct State {
    root: PathBuf,
    record: PathBuf,
    home: PathBuf,
}

impl State {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!(
            "loom-refresh-lines-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let record = root.join("notes/installation");
        let home = root.join("home");
        fs::create_dir_all(&record).unwrap();
        fs::create_dir_all(&home).unwrap();
        Self { root, record, home }
    }
}

impl Drop for State {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct Ran {
    stderr: String,
    calls: Vec<Vec<String>>,
    events: Vec<LogEvent>,
}

async fn run(kind: &Kind, argv: &[&str], state: Option<&State>, named: bool, code: i32) -> Ran {
    let events = Arc::new(Mutex::new(Vec::new()));
    let observer = Plugin::new("fixture/observer").on_log({
        let events = Arc::clone(&events);
        move |event, _| events.lock().unwrap().push(event.clone())
    });
    let refresh = kind.refresh;
    let app = Application::new("notes")
        .description("Keep notes.")
        .plugins((verbose(), observer, (kind.plugin)()))
        .command(Command::new("refresh").description("Refresh.").action(
            move |ctx: Context| async move {
                let mut context =
                    RefreshContext::new(Path::new(BINARY), &ctx.host, &ctx.signal, &ctx.log);
                if named {
                    context = context.name(&ctx.graph.name);
                }
                refresh(context).await
            },
        ));
    let mut fields = MockFields::new()
        .argv(argv.iter().copied())
        .platform("linux")
        .uid(Some(rustix::process::geteuid().as_raw()))
        .release(ReleaseFacts::new(Build::Distributed))
        .script(BINARY, move |_| async move {
            Ok(ProgramAnswer::new().code(code))
        });
    fields = match state {
        Some(state) => fields
            .cwd(&state.root)
            .home(&state.home)
            .env("HOME", state.home.to_str().unwrap())
            .env("XDG_STATE_HOME", state.root.to_str().unwrap())
            .env("XDG_DATA_HOME", state.root.join("data").to_str().unwrap()),
        None => fields.home("relative"),
    };
    let mock = mock_process(fields);
    assert_eq!(
        app.run(RunOptions::new().process(mock.clone())).await.get(),
        0,
        "{}",
        mock.stderr_text()
    );
    let events = events.lock().unwrap().clone();
    Ran {
        stderr: mock.stderr_text(),
        calls: mock.calls().into_iter().map(|call| call.args).collect(),
        events,
    }
}

fn ran_line(kind: &Kind) -> String {
    format!(
        "› Program run. arguments={} code=0 program={BINARY}\n",
        serde_json::to_string(kind.words).unwrap()
    )
}

#[tokio::test]
async fn a_successful_refresh_records_the_run_and_shows_it_at_verbose() {
    for kind in KINDS {
        let state = State::new();
        fs::write(state.record.join(kind.record), "{}\n").unwrap();
        let plain = run(kind, &["refresh"], Some(&state), true, 0).await;
        assert_eq!(plain.stderr, "");
        assert_eq!(plain.calls, [kind.words]);
        let verbose = run(kind, &["-v", "refresh"], Some(&state), true, 0).await;
        assert_eq!(verbose.stderr, ran_line(kind));
        assert_eq!(verbose.calls, [kind.words]);
        assert_eq!(verbose.events.len(), 1);
        let event = &verbose.events[0];
        assert_eq!(event.level, LogLevel::Info);
        assert_eq!(event.message, "Program run.");
        assert_eq!(
            json!(event.fields),
            json!({"arguments": kind.words, "code": 0, "program": BINARY})
        );
    }
}

#[tokio::test]
async fn a_resolved_record_without_installed_files_skips_the_child() {
    for kind in KINDS {
        let state = State::new();
        for (flag, expected) in [
            ("-v", String::new()),
            ("-vv", format!("  ┆ {}\n", kind.skipped)),
        ] {
            let ran = run(kind, &[flag, "refresh"], Some(&state), true, 0).await;
            assert_eq!(ran.stderr, expected);
            assert!(ran.calls.is_empty());
            assert_eq!(ran.events.len(), 1);
            assert_eq!(ran.events[0].level, LogLevel::Trace);
            assert_eq!(ran.events[0].message, kind.skipped);
        }
    }
}

#[tokio::test]
async fn an_unnamed_or_unresolved_record_still_runs_the_child() {
    for kind in KINDS {
        let state = State::new();
        for (state, named) in [(Some(&state), false), (None, true)] {
            let ran = run(kind, &["-v", "refresh"], state, named, 0).await;
            assert_eq!(ran.stderr, ran_line(kind));
            assert_eq!(ran.calls, [kind.words]);
        }
    }
}

#[tokio::test]
async fn a_record_directory_that_cannot_be_searched_still_runs_the_child() {
    if rustix::process::geteuid().is_root() {
        return;
    }
    for kind in KINDS {
        let state = State::new();
        fs::set_permissions(&state.record, fs::Permissions::from_mode(0o000)).unwrap();
        let ran = run(kind, &["-v", "refresh"], Some(&state), true, 0).await;
        fs::set_permissions(&state.record, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(ran.stderr, ran_line(kind));
        assert_eq!(ran.calls, [kind.words]);
    }
}

#[tokio::test]
async fn a_failed_child_records_its_warning_without_a_change_event() {
    for kind in KINDS {
        let state = State::new();
        fs::write(state.record.join(kind.record), "not JSON").unwrap();
        let ran = run(kind, &["-v", "refresh"], Some(&state), true, 1).await;
        assert_eq!(
            ran.stderr,
            format!("› {} code=1 path={BINARY}\n", kind.warning)
        );
        assert_eq!(ran.calls, [kind.words]);
        assert_eq!(ran.events.len(), 1);
        assert_eq!(ran.events[0].level, LogLevel::Warn);
    }
}

#[tokio::test]
async fn records_written_by_the_install_commands_enable_their_refreshes() {
    for kind in KINDS {
        let state = State::new();
        run(kind, kind.install, Some(&state), true, 0).await;
        let ran = run(kind, &["-vv", "refresh"], Some(&state), true, 0).await;
        assert_eq!(ran.stderr, ran_line(kind));
        assert_eq!(ran.calls, [kind.words]);
    }
}
