//! Ports `update-notices.test.ts`: the update notices' middleware and `self-update
//! --refresh-notice` on a mock process at an 80-column terminal, against the fake GitHub of the
//! self-update tests. The refresh program a run spawns runs the same application in-process with
//! the words, directory, and environment of the spawn, once the run that started it has returned,
//! and records when it started, what the cache held then, each request, and its exit.

#![cfg(feature = "self-update")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod self_update_support;

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use jiff::Timestamp;
use loomcli_core::{Build, Installation, Release, ReleaseFacts};
use loomcli_testing::{MockProcess, ProgramAnswer, ProgramCall};
use self_update_support::{
    ASSET, Fixture, GitHub, Hook, Ran, Records, Rule, RunFacts, Sandbox, github_release, lines,
    mock_for, recorded_digest, run_on, sandbox_with, script_facts,
};
use serde_json::{Value, json};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

const BINARY_BYTES: &str = "notes 1.5.0 binary\n";

/// The notice a run of notes 1.5.0 prints for a cache naming 1.5.1 on the stable channel.
const NOTICE: &str =
    "notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.";

/// The same notice as the info lane writes it on the 80-column terminal: wider than the 78 columns
/// right of the gutter, so it wraps, with the gutter on its continuation line.
const NOTICE_LINES: [&str; 2] = [
    "notes 1.5.1 is available on the stable channel. Run notes self-update to",
    "  update from 1.5.0.",
];

const HOUR: i64 = 3_600_000;

fn now_ms() -> i64 {
    Timestamp::now().as_millisecond()
}

fn iso(milliseconds: i64) -> String {
    Timestamp::from_millisecond(milliseconds)
        .unwrap()
        .strftime("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// A time `hours` before now, in the `toISOString()` form, or after now for a negative count.
fn hours_ago(hours: i64) -> String {
    iso(now_ms() - hours * HOUR)
}

fn default_github() -> GitHub {
    GitHub {
        repository: "acme/notes".to_owned(),
        foreign: Vec::new(),
        renamed_from: None,
        latest: Some("v1.5.1".to_owned()),
        feed: vec!["v1.5.1".to_owned(), "v1.5.0".to_owned()],
        releases: BTreeMap::from([github_release("1.5.1"), github_release("1.5.0")]),
    }
}

/// What a cache line holds, each member at its default unless a case names it.
struct CacheFacts {
    checked: String,
    repository: &'static str,
    channel: &'static str,
    latest: Option<&'static str>,
}

impl Default for CacheFacts {
    fn default() -> Self {
        Self {
            checked: hours_ago(1),
            repository: "acme/notes",
            channel: "stable",
            latest: Some("1.5.1"),
        }
    }
}

/// The pinned cache line, its members in the contract's order.
fn cache_line(facts: CacheFacts) -> String {
    format!(
        "{{\"format\":1,\"checked\":{},\"repository\":{},\"channel\":{},\"latest\":{}}}\n",
        json!(facts.checked),
        json!(facts.repository),
        json!(facts.channel),
        json!(facts.latest)
    )
}

/// Writes `update.json` with these bytes, creating the cache directory.
fn write_cache(s: &Sandbox, content: &str) {
    fs::create_dir_all(&s.cache).unwrap();
    fs::write(&s.file, content).unwrap();
}

/// What `update.json` in a directory holds, or `None` when nothing readable is there.
fn cache_in(directory: &Path) -> Option<String> {
    fs::read_to_string(directory.join("update.json")).ok()
}

/// The refresh program a run spawns.
#[derive(Clone)]
enum Program {
    /// Runs the application in-process, as the fixture started again.
    Refresh,
    /// Starts and does nothing.
    Inert,
    /// Names a file that is not there, so it cannot start.
    Missing(PathBuf),
}

#[derive(Clone)]
struct Scenario {
    version: &'static str,
    release: Option<ReleaseFacts>,
    github: GitHub,
    rules: Vec<(String, Rule)>,
    env: Vec<(String, String)>,
    tty: (bool, bool),
    notices: Option<bool>,
    notice_env: Option<&'static str>,
    help: Option<&'static str>,
    restyle: bool,
    program: Program,
    verbose: bool,
}

impl Default for Scenario {
    fn default() -> Self {
        Self {
            version: "1.5.0",
            release: None,
            github: default_github(),
            rules: Vec::new(),
            env: Vec::new(),
            tty: (true, true),
            notices: None,
            notice_env: None,
            help: None,
            restyle: false,
            program: Program::Refresh,
            verbose: false,
        }
    }
}

impl Scenario {
    fn env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_owned(), value.to_owned()));
        self
    }

    fn inert(self) -> Self {
        Self {
            program: Program::Inert,
            ..self
        }
    }
}

/// What a run left: its streams, its mock, and the events and requests of it and its children.
struct Outcome {
    ran: Ran,
    process: Arc<MockProcess>,
    records: Records,
}

impl Outcome {
    fn children(&self) -> Vec<self_update_support::Event> {
        self.records
            .events()
            .into_iter()
            .filter(|event| event.role == "child")
            .collect()
    }

    fn child_starts(&self) -> usize {
        self.children()
            .iter()
            .filter(|event| event.event == "start")
            .count()
    }

    fn child_requests(&self) -> Vec<String> {
        self.children()
            .iter()
            .filter(|event| event.event == "request")
            .map(|event| event.detail["url"].as_str().unwrap().to_owned())
            .collect()
    }

    /// The run's exit event.
    fn run_exit(&self) -> Value {
        self.records
            .events()
            .into_iter()
            .find(|event| event.role == "run" && event.event == "exit")
            .unwrap()
            .detail
    }

    /// Waits until every refresh child that started has exited.
    async fn children_done(&self) -> Vec<self_update_support::Event> {
        for _ in 0..100_000 {
            let children = self.children();
            let started = children
                .iter()
                .filter(|event| event.event == "start")
                .count();
            let exited = children
                .iter()
                .filter(|event| event.event == "exit")
                .count();
            if started > 0 && started == exited {
                return children;
            }
            tokio::task::yield_now().await;
        }
        panic!("No refresh child finished: {:?}", self.records.events());
    }

    /// Lets any child a run started reach its script, then answers whether the run spawned one.
    async fn spawned(&self) -> bool {
        for _ in 0..100 {
            tokio::task::yield_now().await;
        }
        !self.process.calls().is_empty()
    }
}

/// The refresh child: the same application on a mock with the spawn's words, directory, and
/// environment, run once the run that started it has returned.
async fn refresh_child(
    call: ProgramCall,
    fixture: Fixture,
    release: ReleaseFacts,
    cache: PathBuf,
    mut returned: watch::Receiver<bool>,
) -> io::Result<ProgramAnswer> {
    fixture.records.record(
        "start",
        "child",
        json!({ "cache": cache_in(&call.cwd), "cwd": call.cwd.to_string_lossy() }),
    );
    let _ = returned.wait_for(|returned| *returned).await;
    let env: Vec<(String, String)> = call
        .env
        .iter()
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    let process = mock_for(
        &RunFacts {
            argv: call.args.clone(),
            env,
            home: PathBuf::from("/loom-test/home"),
            cwd: Some(call.cwd.clone()),
            release,
            program: None,
            tty: None,
        },
        |fields| fields,
    );
    let child = Fixture {
        controller: CancellationToken::new(),
        ..fixture
    };
    let ran = run_on(&child, "child", &process).await;
    child.records.record(
        "exit",
        "child",
        json!({ "cache": cache_in(&cache), "code": ran.status, "stderr": ran.stderr }),
    );
    Ok(ProgramAnswer::new()
        .code(i32::from(ran.status))
        .stdout(ran.stdout)
        .stderr(ran.stderr))
}

/// Runs `notes ...argv` at an 80-column terminal in the sandbox.
async fn run(s: &Sandbox, argv: &[&str], scenario: &Scenario) -> Outcome {
    let mut env: Vec<(String, String)> = vec![
        ("CI".to_owned(), String::new()),
        ("HOME".to_owned(), s.home.to_string_lossy().into_owned()),
        ("NO_COLOR".to_owned(), "1".to_owned()),
        ("NO_UPDATE_NOTIFIER".to_owned(), String::new()),
        (
            "XDG_CACHE_HOME".to_owned(),
            s.cache_home.to_string_lossy().into_owned(),
        ),
        (
            "XDG_STATE_HOME".to_owned(),
            s.state.to_string_lossy().into_owned(),
        ),
    ];
    for (name, value) in &scenario.env {
        env.retain(|(other, _)| other != name);
        env.push((name.clone(), value.clone()));
    }
    let home = env
        .iter()
        .find(|(name, _)| name == "HOME")
        .map(|(_, value)| PathBuf::from(value))
        .unwrap();
    let release = scenario
        .release
        .clone()
        .unwrap_or_else(|| script_facts(s, scenario.version, BINARY_BYTES));
    let records = Records::default();
    let fixture = Fixture {
        github: scenario.github.clone(),
        rules: scenario.rules.clone(),
        hook: Hook::None,
        notices: scenario.notices,
        notice_env: scenario.notice_env.map(str::to_owned),
        help: scenario.help,
        restyle: scenario.restyle,
        version: release
            .release
            .as_ref()
            .map_or_else(|| "0.0.0".to_owned(), |release| release.version.clone()),
        records: records.clone(),
        controller: CancellationToken::new(),
        locked: None,
        after_replace: None,
        verbose: scenario.verbose,
    };
    let (returned_tx, returned_rx) = watch::channel(false);
    let program = match &scenario.program {
        Program::Missing(path) => vec![path.to_string_lossy().into_owned()],
        Program::Refresh | Program::Inert => vec!["notice-refresh".to_owned()],
    };
    let process = {
        let fixture = fixture.clone();
        let release = release.clone();
        let cache = s.cache.clone();
        let mode = scenario.program.clone();
        mock_for(
            &RunFacts {
                argv: argv.iter().map(|word| (*word).to_owned()).collect(),
                env,
                home,
                cwd: None,
                release: release.clone(),
                program: Some(program),
                tty: Some(scenario.tty),
            },
            move |fields| match mode {
                Program::Missing(path) => {
                    fields.script(&path.to_string_lossy(), |call: ProgramCall| async move {
                        Err(io::Error::new(
                            io::ErrorKind::NotFound,
                            format!("spawn {} ENOENT", call.command),
                        ))
                    })
                }
                Program::Inert => {
                    fields.script("notice-refresh", |_| async { Ok(ProgramAnswer::new()) })
                }
                Program::Refresh => fields.script("notice-refresh", move |call| {
                    refresh_child(
                        call,
                        fixture.clone(),
                        release.clone(),
                        cache.clone(),
                        returned_rx.clone(),
                    )
                }),
            },
        )
    };
    let ran = run_on(&fixture, "run", &process).await;
    records.record(
        "exit",
        "run",
        json!({ "cache": cache_in(&s.cache), "code": ran.status }),
    );
    // A child that waits after the sender is gone reads the closed channel and goes on.
    let _ = returned_tx.send(true);
    Outcome {
        ran,
        process,
        records,
    }
}

fn sandbox() -> Sandbox {
    sandbox_with(BINARY_BYTES)
}

/// The pinned line a refresh writes, with any `checked` between `from` and now.
fn expect_refreshed(
    content: Option<&str>,
    from: i64,
    latest: Option<&'static str>,
    channel: &'static str,
) {
    let content = content.expect("the cache holds a line");
    let parsed: Value = serde_json::from_str(content).unwrap();
    let checked = parsed["checked"].as_str().unwrap().to_owned();
    assert_eq!(
        content,
        cache_line(CacheFacts {
            checked: checked.clone(),
            channel,
            latest,
            ..CacheFacts::default()
        })
    );
    let time = checked.parse::<Timestamp>().unwrap().as_millisecond();
    assert!(time >= from, "{checked} is before the run");
    assert!(time <= now_ms(), "{checked} is after now");
}

#[tokio::test]
async fn a_fresh_cache_naming_a_newer_release_prints_the_notice_after_the_command_line_through_lanes_info_and_starts_no_child()
 {
    let s = sandbox();
    let line = cache_line(CacheFacts::default());
    write_cache(&s, &line);
    let outcome = run(&s, &["add"], &Scenario::default()).await;
    assert_eq!(outcome.ran.status, 0);
    assert_eq!(outcome.ran.stdout, "");
    assert_eq!(
        outcome.ran.stderr,
        format!("✔ Added note 12.\nℹ {}\n", NOTICE_LINES.join("\n"))
    );

    let restyled = sandbox();
    write_cache(&restyled, &line);
    let styled = run(
        &restyled,
        &["add"],
        &Scenario {
            restyle: true,
            ..Scenario::default()
        },
    )
    .await;
    // The override owns the lane, wrapping included, so its notice stays one line.
    assert_eq!(
        styled.ran.stderr,
        format!("✔ Added note 12.\n[info] {NOTICE}\n")
    );

    assert!(!outcome.spawned().await);
    assert_eq!(fs::read_to_string(&s.file).unwrap(), line);
}

#[tokio::test]
async fn a_cache_naming_1_10_0_prints_the_notice_to_a_run_of_1_9_0_by_semver_precedence() {
    let s = sandbox();
    write_cache(
        &s,
        &cache_line(CacheFacts {
            latest: Some("1.10.0"),
            ..CacheFacts::default()
        }),
    );
    let outcome = run(
        &s,
        &["add"],
        &Scenario {
            version: "1.9.0",
            ..Scenario::default().inert()
        },
    )
    .await;
    assert_eq!(
        lines(&outcome.ran.stderr),
        [
            "Added note 12.",
            "notes 1.10.0 is available on the stable channel. Run notes self-update to",
            "  update from 1.9.0.",
        ]
    );
}

#[tokio::test]
async fn a_cache_naming_no_newer_release_on_the_running_lookup_prints_no_notice() {
    for (label, line) in [
        (
            "the running version",
            cache_line(CacheFacts {
                latest: Some("1.5.0"),
                ..CacheFacts::default()
            }),
        ),
        (
            "an older version",
            cache_line(CacheFacts {
                latest: Some("1.4.2"),
                ..CacheFacts::default()
            }),
        ),
        (
            "null",
            cache_line(CacheFacts {
                latest: None,
                ..CacheFacts::default()
            }),
        ),
        (
            "another channel",
            cache_line(CacheFacts {
                channel: "next",
                latest: Some("1.6.0-next.1"),
                ..CacheFacts::default()
            }),
        ),
        (
            "another repository",
            cache_line(CacheFacts {
                repository: "acme/other",
                ..CacheFacts::default()
            }),
        ),
    ] {
        let s = sandbox();
        write_cache(&s, &line);
        let outcome = run(&s, &["add"], &Scenario::default().inert()).await;
        assert_eq!(outcome.ran.status, 0, "{label}");
        assert_eq!(lines(&outcome.ran.stderr), ["Added note 12."], "{label}");
    }
}

#[tokio::test]
async fn a_fresh_cache_with_an_extra_member_and_its_members_reordered_reads_the_same() {
    let s = sandbox();
    let line = format!(
        "{{\"latest\":\"1.5.1\",\"note\":\"kept\",\"channel\":\"stable\",\"repository\":\"acme/notes\",\"checked\":\"{}\",\"format\":1}}\n",
        hours_ago(1)
    );
    write_cache(&s, &line);
    let outcome = run(&s, &["add"], &Scenario::default()).await;
    assert_eq!(
        lines(&outcome.ran.stderr),
        ["Added note 12.", NOTICE_LINES[0], NOTICE_LINES[1]]
    );
    assert!(!outcome.spawned().await);
    assert_eq!(fs::read_to_string(&s.file).unwrap(), line);
}

#[tokio::test]
async fn a_cache_whose_format_is_2_or_whose_checked_is_not_a_time_is_stale_and_starts_a_child() {
    for (label, line, expected) in [
        (
            "format 2",
            cache_line(CacheFacts::default()).replace("\"format\":1", "\"format\":2"),
            vec!["Added note 12."],
        ),
        (
            "checked not a time",
            cache_line(CacheFacts {
                checked: "yesterday".to_owned(),
                ..CacheFacts::default()
            }),
            vec!["Added note 12.", NOTICE_LINES[0], NOTICE_LINES[1]],
        ),
    ] {
        let s = sandbox();
        write_cache(&s, &line);
        let from = now_ms();
        let outcome = run(&s, &["add"], &Scenario::default()).await;
        assert_eq!(lines(&outcome.ran.stderr), expected, "{label}");
        outcome.children_done().await;
        assert_eq!(outcome.child_starts(), 1, "{label}");
        expect_refreshed(
            fs::read_to_string(&s.file).ok().as_deref(),
            from,
            Some("1.5.1"),
            "stable",
        );
    }
}

#[tokio::test]
async fn a_cache_that_is_a_directory_is_stale_so_it_names_no_release() {
    let s = sandbox();
    fs::create_dir_all(&s.file).unwrap();
    let outcome = run(&s, &["add"], &Scenario::default().inert()).await;
    assert_eq!(outcome.ran.status, 0);
    assert_eq!(lines(&outcome.ran.stderr), ["Added note 12."]);
}

#[tokio::test]
async fn a_stale_cache_starts_one_child_which_finds_the_runs_checked_waits_for_the_run_and_writes_the_latest_version()
 {
    let cases: Vec<(&str, Option<String>)> = vec![
        ("missing", None),
        (
            "25 hours old",
            Some(cache_line(CacheFacts {
                checked: hours_ago(25),
                latest: Some("1.5.0"),
                ..CacheFacts::default()
            })),
        ),
        (
            "an hour ahead",
            Some(cache_line(CacheFacts {
                checked: hours_ago(-1),
                latest: Some("1.5.0"),
                ..CacheFacts::default()
            })),
        ),
        (
            "for another channel",
            Some(cache_line(CacheFacts {
                channel: "next",
                latest: None,
                ..CacheFacts::default()
            })),
        ),
        ("holding {", Some("{".to_owned())),
    ];
    for (label, line) in cases {
        let s = sandbox();
        if let Some(line) = &line {
            write_cache(&s, line);
        }
        let from = now_ms();
        let outcome = run(&s, &["add"], &Scenario::default()).await;
        assert_eq!(outcome.ran.status, 0, "{label}");
        assert_eq!(lines(&outcome.ran.stderr), ["Added note 12."], "{label}");

        let children = outcome.children_done().await;
        let run_exit = outcome.run_exit();
        // The run wrote `checked` before it started the child, and kept a latest only from a cache
        // whose one fault is its `checked`.
        let kept = line
            .as_deref()
            .is_some_and(|line| line.contains("\"latest\":\"1.5.0\""))
            .then_some("1.5.0");
        expect_refreshed(run_exit["cache"].as_str(), from, kept, "stable");
        let starts: Vec<&self_update_support::Event> = children
            .iter()
            .filter(|event| event.event == "start")
            .collect();
        assert_eq!(starts.len(), 1, "{label}");
        assert_eq!(
            starts[0].detail,
            json!({ "cache": run_exit["cache"], "cwd": s.cache.to_string_lossy() }),
            "{label}"
        );
        // The run exited before the child's first request.
        let events = outcome.records.events();
        let first_request = events
            .iter()
            .position(|event| event.role == "child" && event.event == "request")
            .unwrap();
        let last_run = events
            .iter()
            .rposition(|event| event.role == "run")
            .unwrap();
        assert!(first_request > last_run, "{label}");
        assert_eq!(children.last().unwrap().detail["code"], 0, "{label}");
        expect_refreshed(
            fs::read_to_string(&s.file).ok().as_deref(),
            from,
            Some("1.5.1"),
            "stable",
        );
        // The child was started detached, in the cache directory, with the run's words.
        let calls = outcome.process.calls();
        assert_eq!(calls.len(), 1, "{label}");
        assert!(calls[0].detached);
        assert_eq!(calls[0].args, ["self-update", "--refresh-notice"]);
    }
}

#[tokio::test]
async fn a_cache_naming_1_5_1_whose_checked_is_at_fault_prints_the_notice_starts_a_child_and_keeps_1_5_1()
 {
    for checked in [hours_ago(25), hours_ago(-1), "not a time".to_owned()] {
        let s = sandbox();
        write_cache(
            &s,
            &cache_line(CacheFacts {
                checked: checked.clone(),
                ..CacheFacts::default()
            }),
        );
        let from = now_ms();
        let outcome = run(
            &s,
            &["add"],
            &Scenario {
                github: GitHub {
                    latest: Some("v1.5.0".to_owned()),
                    ..default_github()
                },
                ..Scenario::default()
            },
        )
        .await;
        assert_eq!(
            lines(&outcome.ran.stderr),
            ["Added note 12.", NOTICE_LINES[0], NOTICE_LINES[1]],
            "{checked}"
        );
        outcome.children_done().await;
        expect_refreshed(
            outcome.run_exit()["cache"].as_str(),
            from,
            Some("1.5.1"),
            "stable",
        );
        // The child then writes what GitHub answered.
        expect_refreshed(
            fs::read_to_string(&s.file).ok().as_deref(),
            from,
            Some("1.5.0"),
            "stable",
        );
    }
}

#[tokio::test]
async fn a_cache_directory_whose_parents_are_missing_is_created_with_them_by_the_run_and_its_child()
{
    let s = sandbox();
    let cache_home = s.root.join("a").join("b");
    let cache = cache_home.join("notes");
    let from = now_ms();
    let outcome = run(
        &s,
        &["add"],
        &Scenario::default().env("XDG_CACHE_HOME", &cache_home.to_string_lossy()),
    )
    .await;
    assert_eq!(
        outcome.ran,
        Ran {
            status: 0,
            stderr: "✔ Added note 12.\n".to_owned(),
            stdout: String::new(),
        }
    );
    let children = outcome.children_done().await;
    let start = children
        .iter()
        .find(|event| event.event == "start")
        .unwrap();
    assert_eq!(start.detail["cwd"], json!(cache.to_string_lossy()));
    // The run wrote `checked` before it started the child.
    expect_refreshed(start.detail["cache"].as_str(), from, None, "stable");
    assert_eq!(children.last().unwrap().detail["code"], 0);
    expect_refreshed(cache_in(&cache).as_deref(), from, Some("1.5.1"), "stable");
}

#[tokio::test]
async fn a_503_makes_the_child_exit_1_and_write_nothing_so_the_runs_checked_stays_and_a_second_run_starts_no_child()
 {
    let s = sandbox();
    let from = now_ms();
    let scenario = Scenario {
        rules: vec![("releases/latest".to_owned(), Rule::Status(503))],
        ..Scenario::default()
    };
    let first = run(&s, &["add"], &scenario).await;
    assert_eq!(
        first.ran,
        Ran {
            status: 0,
            stderr: "✔ Added note 12.\n".to_owned(),
            stdout: String::new(),
        }
    );
    let children = first.children_done().await;
    let exit = children.last().unwrap();
    assert_eq!(exit.detail["code"], 1);
    // The child answered its own failure sentence, which never reaches the run's streams.
    assert_ne!(exit.detail["stderr"], "");
    assert_eq!(first.process.stderr_text(), first.ran.stderr);
    assert_eq!(first.process.stdout_text(), first.ran.stdout);
    let run_cache = first.run_exit()["cache"].as_str().unwrap().to_owned();
    assert_eq!(fs::read_to_string(&s.file).unwrap(), run_cache);
    expect_refreshed(Some(&run_cache), from, None, "stable");

    let second = run(&s, &["add"], &scenario).await;
    assert_eq!(lines(&second.ran.stderr), ["Added note 12."]);
    assert!(!second.spawned().await);
}

#[tokio::test]
async fn refresh_notice_resolves_stable_through_releases_latest_requests_no_asset_writes_the_pinned_line_and_prints_nothing()
 {
    let s = sandbox();
    let from = now_ms();
    let outcome = run(
        &s,
        &["self-update", "--refresh-notice"],
        &Scenario {
            tty: (false, false),
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(
        outcome.ran,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: String::new(),
        }
    );
    assert_eq!(
        outcome.records.requests(),
        ["https://github.com/acme/notes/releases/latest"]
    );
    expect_refreshed(
        fs::read_to_string(&s.file).ok().as_deref(),
        from,
        Some("1.5.1"),
        "stable",
    );
}

#[tokio::test]
async fn refresh_notice_on_next_resolves_through_the_feed_past_a_tag_whose_sha256sums_answers_404()
{
    let s = sandbox();
    let outcome = run(
        &s,
        &["self-update", "--refresh-notice"],
        &Scenario {
            version: "1.6.0-next.1",
            github: GitHub {
                feed: vec![
                    "v1.7.0-next.1".to_owned(),
                    "v1.6.0-next.2".to_owned(),
                    "v1.5.1".to_owned(),
                ],
                releases: BTreeMap::from([github_release("1.6.0-next.2"), github_release("1.5.1")]),
                ..default_github()
            },
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(
        outcome.ran,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: String::new(),
        }
    );
    let requests = outcome.records.requests();
    assert_eq!(
        requests[..3],
        [
            "https://github.com/acme/notes/releases.atom",
            "https://github.com/acme/notes/releases/download/v1.7.0-next.1/SHA256SUMS",
            "https://github.com/acme/notes/releases/download/v1.6.0-next.2/SHA256SUMS",
        ]
    );
    assert_eq!(
        requests.iter().filter(|url| url.ends_with(ASSET)).count(),
        0
    );
    let written: Value = serde_json::from_str(&fs::read_to_string(&s.file).unwrap()).unwrap();
    assert_eq!(written["channel"], "next");
    assert_eq!(written["latest"], "1.6.0-next.2");
}

#[tokio::test]
async fn refresh_notice_writes_null_for_a_channel_with_no_release() {
    let s = sandbox();
    let from = now_ms();
    let outcome = run(
        &s,
        &["self-update", "--refresh-notice"],
        &Scenario {
            github: GitHub {
                latest: None,
                ..default_github()
            },
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(
        outcome.ran,
        Ran {
            status: 0,
            stderr: String::new(),
            stdout: String::new(),
        }
    );
    expect_refreshed(
        fs::read_to_string(&s.file).ok().as_deref(),
        from,
        None,
        "stable",
    );
}

#[tokio::test]
async fn refresh_notice_beside_another_input_is_a_usage_error() {
    for extra in [vec!["1.4.0"], vec!["--channel", "next"], vec!["--check"]] {
        let s = sandbox();
        let mut argv = vec!["self-update", "--refresh-notice"];
        argv.extend(extra.iter().copied());
        let outcome = run(&s, &argv, &Scenario::default()).await;
        assert_eq!(outcome.ran.status, 2, "{extra:?}");
        assert!(
            outcome.ran.stderr.contains(
                "Option \"--refresh-notice\" cannot be given with other inputs. Leave out the other inputs."
            ),
            "{extra:?}: {}",
            outcome.ran.stderr
        );
        assert_eq!(outcome.records.requests(), Vec::<String>::new());
        assert!(!s.cache.exists());
    }
}

#[tokio::test]
async fn refresh_notice_refuses_a_run_with_no_asset_and_a_run_whose_cache_directory_does_not_resolve()
 {
    let s = sandbox();
    let unbuilt = run(
        &s,
        &["self-update", "--refresh-notice"],
        &Scenario {
            release: Some(
                ReleaseFacts::new(Build::Distributed).release(Release::new("1.5.0", "acme/notes")),
            ),
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(unbuilt.ran.status, 1);
    assert_eq!(
        unbuilt.ran.stderr,
        "notes was not built as a release binary, so it cannot update itself. Update it the way you installed it.\n"
    );
    let homeless = run(
        &s,
        &["self-update", "--refresh-notice"],
        &Scenario::default()
            .env("HOME", "home")
            .env("XDG_CACHE_HOME", ""),
    )
    .await;
    assert_eq!(homeless.ran.status, 1);
    assert_eq!(
        homeless.ran.stderr,
        "notes cannot find its cache directory because HOME is not an absolute path. Set HOME to an absolute path.\n"
    );
    assert_eq!(unbuilt.records.requests(), Vec::<String>::new());
    assert_eq!(homeless.records.requests(), Vec::<String>::new());
    assert!(!s.cache.exists());
}

fn is_root() -> bool {
    rustix::process::geteuid().is_root()
}

#[tokio::test]
async fn refresh_notice_exits_1_with_the_write_sentence_when_its_cache_directory_cannot_be_written()
{
    if is_root() {
        return;
    }
    let s = sandbox();
    fs::create_dir_all(&s.cache).unwrap();
    fs::set_permissions(&s.cache, fs::Permissions::from_mode(0o555)).unwrap();
    let outcome = run(
        &s,
        &["self-update", "--refresh-notice"],
        &Scenario {
            tty: (false, false),
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(
        outcome.ran,
        Ran {
            status: 1,
            stderr: format!(
                "notes could not write its update cache to {}. Free space there or check its permissions, then run self-update --refresh-notice again.\n",
                s.cache.display()
            ),
            stdout: String::new(),
        }
    );
    assert_eq!(fs::read_dir(&s.cache).unwrap().count(), 0);
}

/// The runs left out: each label, its words, and the scenario that leaves it out.
fn left_out(s: &Sandbox) -> Vec<(&'static str, Vec<&'static str>, Scenario)> {
    let script = script_facts(s, "1.5.0", BINARY_BYTES);
    let group = Release::new("1.5.0", "acme/notes");
    let installation = script.installation.clone().unwrap();
    vec![
        ("an action that fails", vec!["fail"], Scenario::default()),
        (
            "a run cancelled during its action",
            vec!["cancel"],
            Scenario::default(),
        ),
        (
            "self-update itself",
            vec!["self-update", "--check"],
            Scenario::default(),
        ),
        (
            "stderr that is not a terminal",
            vec!["add"],
            Scenario {
                tty: (true, false),
                ..Scenario::default()
            },
        ),
        (
            "stdout that is not a terminal",
            vec!["add"],
            Scenario {
                tty: (false, true),
                ..Scenario::default()
            },
        ),
        ("CI=1", vec!["add"], Scenario::default().env("CI", "1")),
        (
            "NO_UPDATE_NOTIFIER=1",
            vec!["add"],
            Scenario::default().env("NO_UPDATE_NOTIFIER", "1"),
        ),
        (
            "the author's env set to 1",
            vec!["add"],
            Scenario {
                notice_env: Some("NOTES_NO_UPDATE_NOTICE"),
                ..Scenario::default().env("NOTES_NO_UPDATE_NOTICE", "1")
            },
        ),
        (
            "notices off",
            vec!["add"],
            Scenario {
                notices: Some(false),
                ..Scenario::default()
            },
        ),
        (
            "a source build",
            vec!["add"],
            Scenario {
                release: Some(ReleaseFacts::new(Build::Source)),
                ..Scenario::default()
            },
        ),
        (
            "a release with no asset",
            vec!["add"],
            Scenario {
                release: Some(ReleaseFacts::new(Build::Distributed).release(group.clone())),
                ..Scenario::default()
            },
        ),
        (
            "a script installation whose release names no asset",
            vec!["add"],
            Scenario {
                release: Some(
                    ReleaseFacts::new(Build::Distributed)
                        .release(group)
                        .installation(installation),
                ),
                ..Scenario::default()
            },
        ),
        (
            "the method npm",
            vec!["add"],
            Scenario {
                release: Some(
                    ReleaseFacts::new(Build::Distributed)
                        .release(Release::new("1.5.0", "acme/notes").asset(ASSET))
                        .installation(Installation::new(
                            "npm",
                            s.binary.to_string_lossy(),
                            recorded_digest(BINARY_BYTES),
                        )),
                ),
                ..Scenario::default()
            },
        ),
        (
            "no installation",
            vec!["add"],
            Scenario {
                release: Some(
                    ReleaseFacts::new(Build::Distributed)
                        .release(Release::new("1.5.0", "acme/notes").asset(ASSET)),
                ),
                ..Scenario::default()
            },
        ),
        (
            "a relative HOME with no XDG_CACHE_HOME",
            vec!["add"],
            Scenario::default()
                .env("HOME", "home")
                .env("XDG_CACHE_HOME", ""),
        ),
    ]
}

/// What a left-out run leaves: the cache's files and their bytes, whether a notice printed, and
/// whether a child started.
async fn observe_left_out(s: &Sandbox, line: &str, argv: &[&str], scenario: &Scenario) -> Value {
    write_cache(s, line);
    let outcome = run(s, argv, scenario).await;
    let cache: Vec<Value> = fs::read_dir(&s.cache)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            json!([
                entry.file_name().to_string_lossy(),
                fs::read_to_string(entry.path()).unwrap()
            ])
        })
        .collect();
    json!({
        "cache": cache,
        "notice": format!("{}{}", outcome.ran.stdout, outcome.ran.stderr).contains("is available"),
        "children": outcome.spawned().await,
    })
}

#[tokio::test]
async fn runs_left_out_print_no_notice_write_no_cache_and_start_no_child() {
    // A stale cache naming 1.5.1 would print the notice and start a child, were the run not left
    // out.
    let line = cache_line(CacheFacts {
        checked: hours_ago(25),
        ..CacheFacts::default()
    });
    let expected = json!({ "cache": [["update.json", line]], "notice": false, "children": false });
    let labels = left_out(&sandbox());
    for index in 0..labels.len() {
        let s = sandbox();
        let (label, argv, scenario) = left_out(&s).swap_remove(index);
        let observed = observe_left_out(&s, &line, &argv, &scenario).await;
        assert_eq!(observed, expected, "{label}");
    }
}

#[cfg(feature = "help")]
#[tokio::test]
async fn help_under_the_help_plugin_before_or_after_it_prints_no_notice_and_starts_no_child() {
    let line = cache_line(CacheFacts {
        checked: hours_ago(25),
        ..CacheFacts::default()
    });
    let expected = json!({ "cache": [["update.json", line]], "notice": false, "children": false });
    for place in ["before", "after"] {
        let s = sandbox();
        let scenario = Scenario {
            help: Some(place),
            ..Scenario::default()
        };
        let observed = observe_left_out(&s, &line, &["--help"], &scenario).await;
        assert_eq!(observed, expected, "{place}");
    }
}

#[tokio::test]
async fn a_run_whose_action_returns_once_it_is_cancelled_exits_130_prints_no_notice_writes_no_cache_and_starts_no_child()
 {
    let s = sandbox();
    let line = cache_line(CacheFacts {
        checked: hours_ago(25),
        ..CacheFacts::default()
    });
    write_cache(&s, &line);
    let outcome = run(&s, &["interrupt"], &Scenario::default()).await;
    assert_eq!(outcome.ran.status, 130);
    assert!(!format!("{}{}", outcome.ran.stdout, outcome.ran.stderr).contains("is available"));
    assert!(!outcome.spawned().await);
    assert_eq!(fs::read_dir(&s.cache).unwrap().count(), 1);
    assert_eq!(fs::read_to_string(&s.file).unwrap(), line);
}

#[tokio::test]
async fn no_update_notifier_and_the_authors_env_set_to_the_empty_string_do_not_turn_notices_off() {
    let s = sandbox();
    write_cache(&s, &cache_line(CacheFacts::default()));
    let outcome = run(
        &s,
        &["add"],
        &Scenario {
            notice_env: Some("NOTES_NO_UPDATE_NOTICE"),
            ..Scenario::default()
                .env("NOTES_NO_UPDATE_NOTICE", "")
                .env("NO_UPDATE_NOTIFIER", "")
        },
    )
    .await;
    assert_eq!(
        lines(&outcome.ran.stderr),
        ["Added note 12.", NOTICE_LINES[0], NOTICE_LINES[1]]
    );
}

#[tokio::test]
async fn ci_false_does_not_turn_notices_off_as_ci_info_reads_it() {
    let s = sandbox();
    write_cache(&s, &cache_line(CacheFacts::default()));
    let outcome = run(&s, &["add"], &Scenario::default().env("CI", "false")).await;
    assert_eq!(
        lines(&outcome.ran.stderr),
        ["Added note 12.", NOTICE_LINES[0], NOTICE_LINES[1]]
    );
}

#[tokio::test]
async fn a_cache_directory_that_cannot_be_written_exits_0_with_the_command_line_alone_and_starts_no_child()
 {
    if is_root() {
        return;
    }
    let s = sandbox();
    fs::create_dir_all(&s.cache).unwrap();
    fs::set_permissions(&s.cache, fs::Permissions::from_mode(0o555)).unwrap();
    let outcome = run(&s, &["add"], &Scenario::default()).await;
    assert_eq!(
        outcome.ran,
        Ran {
            status: 0,
            stderr: "✔ Added note 12.\n".to_owned(),
            stdout: String::new(),
        }
    );
    assert!(!outcome.spawned().await);
}

#[tokio::test]
async fn a_program_naming_a_missing_file_exits_0_with_the_command_line_alone() {
    let s = sandbox();
    let outcome = run(
        &s,
        &["add"],
        &Scenario {
            program: Program::Missing(s.root.join("missing-runtime")),
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(
        outcome.ran,
        Ran {
            status: 0,
            stderr: "✔ Added note 12.\n".to_owned(),
            stdout: String::new(),
        }
    );
    // The run still wrote `checked`, so the next run waits a day before it looks again.
    let written: Value = serde_json::from_str(&fs::read_to_string(&s.file).unwrap()).unwrap();
    assert_eq!(written["latest"], Value::Null);
    tokio::task::yield_now().await;
    assert_eq!(outcome.child_requests(), Vec::<String>::new());
}

#[cfg(feature = "verbose")]
#[tokio::test]
async fn under_the_verbose_plugins_q_a_qualifying_run_prints_no_notice_and_still_refreshes_a_stale_cache()
 {
    let s = sandbox();
    write_cache(
        &s,
        &cache_line(CacheFacts {
            checked: hours_ago(25),
            ..CacheFacts::default()
        }),
    );
    let from = now_ms();
    let outcome = run(
        &s,
        &["-q", "add"],
        &Scenario {
            verbose: true,
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(outcome.ran.status, 0);
    assert!(
        !outcome.ran.stderr.contains("is available"),
        "{}",
        outcome.ran.stderr
    );
    outcome.children_done().await;
    assert_eq!(outcome.child_starts(), 1);
    expect_refreshed(
        fs::read_to_string(&s.file).ok().as_deref(),
        from,
        Some("1.5.1"),
        "stable",
    );
}
