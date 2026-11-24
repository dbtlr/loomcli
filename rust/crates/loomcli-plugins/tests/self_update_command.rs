//! Ports `self-update.test.ts`: the `self-update` Command on a mock process against a fake GitHub,
//! in a temporary sandbox whose binary and installation record the release facts name. Each case
//! asserts exact stderr lines, the binary's and the record's bytes, the staging files, the requests
//! the fake answered, the hook's calls, and the exit code. The umask case and the abort after the
//! rename run in processes of their own (`self_update_umask.rs`, `self_update_abort.rs`).

#![cfg(feature = "self-update")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod self_update_support;

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use loomcli_core::{Build, Installation, Release, ReleaseFacts};
use self_update_support::{
    ASSET, FakeRelease, Fixture, GitHub, Hook, OLD_BYTES, Ran, Records, Rule, RunFacts, Sandbox,
    default_github, digest_of, github_release, github_release_with, lines, mock_for, record_line,
    recorded_digest, run_on, sandbox_with, staging_files,
};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

/// One scenario: the running version, the release facts' overrides, what GitHub serves and its
/// rules, the hook, and the environment.
#[derive(Clone)]
struct Scenario {
    version: String,
    /// `Some(None)` leaves the release group out; `Some(Some(release))` replaces it.
    release: Option<Option<Release>>,
    /// `Some(None)` leaves the installation out; `Some(Some(installation))` replaces it.
    installation: Option<Option<Installation>>,
    github: GitHub,
    rules: Vec<(String, Rule)>,
    hook: Hook,
    env: Vec<(String, String)>,
}

impl Default for Scenario {
    fn default() -> Self {
        Self {
            version: "1.4.2".to_owned(),
            release: None,
            installation: None,
            github: default_github(),
            rules: Vec::new(),
            hook: Hook::Record,
            env: Vec::new(),
        }
    }
}

impl Scenario {
    fn version(self, version: &str) -> Self {
        Self {
            version: version.to_owned(),
            ..self
        }
    }

    fn rule(mut self, fragment: &str, rule: Rule) -> Self {
        self.rules.push((fragment.to_owned(), rule));
        self
    }

    fn github(self, github: GitHub) -> Self {
        Self { github, ..self }
    }

    fn env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_owned(), value.to_owned()));
        self
    }
}

/// What a run left beside its streams.
struct Outcome {
    ran: Ran,
    records: Records,
}

/// The release facts a binary at the scenario's version reads, recorded at the sandbox's binary.
fn facts(sandbox: &Sandbox, scenario: &Scenario) -> ReleaseFacts {
    let mut facts = ReleaseFacts::new(Build::Distributed);
    let release = scenario
        .release
        .clone()
        .unwrap_or_else(|| Some(Release::new(&scenario.version, "acme/notes").asset(ASSET)));
    if let Some(release) = release {
        facts = facts.release(release);
    }
    let installation = scenario.installation.clone().unwrap_or_else(|| {
        Some(Installation::new(
            "script",
            sandbox.binary.to_string_lossy(),
            recorded_digest(OLD_BYTES),
        ))
    });
    if let Some(installation) = installation {
        facts = facts.installation(installation);
    }
    facts
}

/// Runs `notes self-update ...argv` in the sandbox against the scenario's fake GitHub.
async fn run(sandbox: &Sandbox, argv: &[&str], scenario: &Scenario) -> Outcome {
    let mut env = vec![
        (
            "HOME".to_owned(),
            sandbox.home.to_string_lossy().into_owned(),
        ),
        (
            "XDG_STATE_HOME".to_owned(),
            sandbox.state.to_string_lossy().into_owned(),
        ),
    ];
    env.extend(scenario.env.iter().cloned());
    let home = env
        .iter()
        .rev()
        .find(|(name, _)| name == "HOME")
        .map(|(_, value)| PathBuf::from(value))
        .unwrap();
    let release = facts(sandbox, scenario);
    let fixture = Fixture {
        github: scenario.github.clone(),
        rules: scenario.rules.clone(),
        hook: scenario.hook,
        notices: None,
        notice_env: None,
        help: None,
        restyle: false,
        version: release
            .release
            .as_ref()
            .map_or_else(|| "0.0.0".to_owned(), |release| release.version.clone()),
        records: Records::default(),
        controller: CancellationToken::new(),
        locked: Some(sandbox.binary.clone()),
        after_replace: None,
        verbose: false,
    };
    let mut argv_words = vec!["self-update".to_owned()];
    argv_words.extend(argv.iter().map(|word| (*word).to_owned()));
    let process = mock_for(
        &RunFacts {
            argv: argv_words,
            env,
            home,
            cwd: None,
            release,
            program: None,
            tty: None,
        },
        |fields| fields,
    );
    let ran = run_on(&fixture, "run", &process).await;
    Outcome {
        ran,
        records: fixture.records,
    }
}

fn sandbox() -> Sandbox {
    sandbox_with(OLD_BYTES)
}

/// The binary and the record, read back to show a run left them alone.
fn untouched(sandbox: &Sandbox) {
    assert_eq!(fs::read_to_string(&sandbox.binary).unwrap(), OLD_BYTES);
    assert_eq!(
        fs::read_to_string(&sandbox.record).unwrap(),
        record_line(&sandbox.binary, OLD_BYTES)
    );
    assert_eq!(staging_files(&sandbox.bin), Vec::<String>::new());
}

fn hook_call(aborted: bool, current: &str, sandbox: &Sandbox) -> Value {
    json!({
        "aborted": aborted,
        "current": current,
        "host": "1.4.2",
        "path": sandbox.binary.to_string_lossy(),
        "previous": "1.4.2",
    })
}

fn releases(list: Vec<(String, FakeRelease)>) -> BTreeMap<String, FakeRelease> {
    list.into_iter().collect()
}

fn tags(tags: &[&str]) -> Vec<String> {
    tags.iter().map(|tag| (*tag).to_owned()).collect()
}

/// The fake GitHub of the channel cases.
fn channel_github() -> GitHub {
    GitHub {
        feed: tags(&[
            "v1.7.0-next.1",
            "v1.6.0-beta.1",
            "nightly",
            "v1.6.0",
            "v1.6.0-next.2",
            "v1.5.0",
        ]),
        latest: Some("v1.5.0".to_owned()),
        releases: releases(vec![
            github_release("1.6.0"),
            github_release("1.6.0-next.2"),
            github_release("1.6.0-beta.1"),
            github_release("1.5.0"),
        ]),
        ..default_github()
    }
}

#[tokio::test]
async fn a_stable_binary_updates_to_the_latest_release_rewrites_the_record_and_calls_the_hook() {
    let s = sandbox();
    let leftover = s.bin.join(".notes.0123456789abcdef.loom-staging");
    fs::write(&leftover, "leftover").unwrap();
    let record_staging = s
        .state
        .join("notes/installation/.install.json.0123456789abcdef.loom-staging");
    fs::write(&record_staging, "leftover").unwrap();
    let outcome = run(&s, &[], &Scenario::default()).await;
    assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
    assert_eq!(
        lines(&outcome.ran.stderr),
        [
            "Downloading notes-linux-x64 from v1.5.0 of acme/notes.",
            "Updated notes from 1.4.2 to 1.5.0.",
        ]
    );
    assert_eq!(outcome.ran.stdout, "");
    assert_eq!(
        fs::read_to_string(&s.binary).unwrap(),
        "notes 1.5.0 binary\n"
    );
    assert_eq!(
        fs::metadata(&s.binary).unwrap().permissions().mode() & 0o777,
        0o755
    );
    assert_eq!(
        fs::read_to_string(&s.record).unwrap(),
        record_line(&s.binary, "notes 1.5.0 binary\n")
    );
    assert!(!record_staging.exists());
    assert_eq!(
        fs::metadata(&s.record).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(staging_files(&s.bin), Vec::<String>::new());
    assert_eq!(
        outcome.records.hook_calls(),
        [hook_call(false, "1.5.0", &s)]
    );
    assert_eq!(
        outcome.records.requests(),
        [
            "https://github.com/acme/notes/releases/latest",
            "https://github.com/acme/notes/releases/download/v1.5.0/SHA256SUMS",
            "https://release-assets.example/v1.5.0/SHA256SUMS",
            "https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64",
            "https://release-assets.example/v1.5.0/notes-linux-x64",
        ]
    );
}

#[tokio::test]
async fn a_prerelease_binary_follows_its_channel_past_a_tag_with_no_release_onto_a_stable_release_that_outranks_it()
 {
    let s = sandbox();
    let scenario = Scenario::default()
        .github(channel_github())
        .version("1.6.0-next.1");
    let outcome = run(&s, &[], &scenario).await;
    assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
    assert_eq!(
        lines(&outcome.ran.stderr).last().unwrap(),
        "Updated notes from 1.6.0-next.1 to 1.6.0."
    );
    assert_eq!(
        fs::read_to_string(&s.binary).unwrap(),
        "notes 1.6.0 binary\n"
    );
    assert_eq!(
        outcome.records.requests()[..3],
        [
            "https://github.com/acme/notes/releases.atom",
            "https://github.com/acme/notes/releases/download/v1.7.0-next.1/SHA256SUMS",
            "https://github.com/acme/notes/releases/download/v1.6.0/SHA256SUMS",
        ]
    );
}

#[tokio::test]
async fn channel_next_moves_a_stable_binary_onto_the_newest_next_release() {
    let s = sandbox();
    let scenario = Scenario::default().github(GitHub {
        feed: tags(&["v1.6.0-next.2", "v1.5.0"]),
        ..channel_github()
    });
    let outcome = run(&s, &["--channel", "next"], &scenario).await;
    assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
    assert_eq!(
        lines(&outcome.ran.stderr).last().unwrap(),
        "Updated notes from 1.4.2 to 1.6.0-next.2."
    );
}

#[tokio::test]
async fn channel_stable_from_a_newer_prerelease_replaces_nothing_and_names_the_older_version() {
    let s = sandbox();
    let outcome = run(
        &s,
        &["--channel", "stable"],
        &Scenario::default().version("1.6.0-next.1"),
    )
    .await;
    assert_eq!(outcome.ran.status, 0);
    assert_eq!(
        lines(&outcome.ran.stderr),
        [
            "notes 1.6.0-next.1 is newer than the newest release on the stable channel, 1.5.0. Name that version to install it: notes self-update 1.5.0."
        ]
    );
    untouched(&s);
    assert_eq!(outcome.records.hook_calls(), Vec::<Value>::new());
}

#[tokio::test]
async fn a_repository_named_in_another_case_matches_the_feed_and_a_renamed_one_resolves_and_downloads_from_its_new_name()
 {
    let cased = sandbox();
    let scenario = Scenario {
        release: Some(Some(
            Release::new("1.6.0-next.1", "Acme/Notes").asset(ASSET),
        )),
        ..Scenario::default().github(GitHub {
            feed: tags(&["v1.6.0-next.2"]),
            ..channel_github()
        })
    };
    let outcome = run(&cased, &[], &scenario).await;
    assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
    assert_eq!(
        fs::read_to_string(&cased.binary).unwrap(),
        "notes 1.6.0-next.2 binary\n"
    );

    for version in ["1.4.2", "1.6.0-next.1"] {
        let s = sandbox();
        let scenario = Scenario::default().version(version).github(GitHub {
            feed: tags(&["v1.6.0-next.2", "v1.5.0"]),
            renamed_from: Some("acme/notes".to_owned()),
            repository: "acme/notes2".to_owned(),
            ..channel_github()
        });
        let moved = run(&s, &[], &scenario).await;
        assert_eq!(moved.ran.status, 0, "{}", moved.ran.stderr);
        assert!(
            lines(&moved.ran.stderr)[0].ends_with(" of acme/notes2."),
            "{}",
            moved.ran.stderr
        );
        // Only the first request names the old repository; every later one uses the name GitHub gave.
        let requests = moved.records.requests();
        assert!(requests[0].starts_with("https://github.com/acme/notes/"));
        assert_eq!(
            requests[1..]
                .iter()
                .filter(|url| url.starts_with("https://github.com/acme/notes/"))
                .count(),
            0,
            "{requests:?}"
        );
    }
}

#[tokio::test]
async fn a_repository_with_no_stable_release_and_a_channel_with_none_in_the_feed_fail_with_the_no_release_sentence()
 {
    let s = sandbox();
    let stable = run(
        &s,
        &[],
        &Scenario::default().github(GitHub {
            latest: None,
            ..default_github()
        }),
    )
    .await;
    assert_eq!(stable.ran.status, 1);
    assert_eq!(
        stable.ran.stderr,
        "notes found no release on the stable channel of acme/notes. Name a version to install, such as notes self-update 1.4.0.\n"
    );
    // A prerelease channel also takes stable releases, so the feed holds neither.
    let next = run(
        &s,
        &["--channel", "rc"],
        &Scenario::default().github(GitHub {
            feed: tags(&["v1.6.0-beta.1"]),
            ..default_github()
        }),
    )
    .await;
    assert_eq!(next.ran.status, 1);
    assert_eq!(
        next.ran.stderr,
        "notes found no release on the rc channel of acme/notes. Name a version to install, such as notes self-update 1.4.0.\n"
    );
    untouched(&s);
}

#[tokio::test]
async fn a_named_version_installs_in_either_direction_with_or_without_its_v() {
    for named in ["1.4.0", "v1.4.0"] {
        let s = sandbox();
        let outcome = run(&s, &[named], &Scenario::default()).await;
        assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
        assert_eq!(
            lines(&outcome.ran.stderr).last().unwrap(),
            "Updated notes from 1.4.2 to 1.4.0."
        );
        assert_eq!(
            fs::read_to_string(&s.binary).unwrap(),
            "notes 1.4.0 binary\n"
        );
        assert_eq!(
            outcome.records.requests()[0],
            "https://github.com/acme/notes/releases/download/v1.4.0/SHA256SUMS"
        );
    }
}

#[tokio::test]
async fn the_running_version_newest_or_named_replaces_nothing_and_calls_no_hook() {
    let s = sandbox();
    let newest = run(
        &s,
        &[],
        &Scenario::default().github(GitHub {
            latest: Some("v1.4.2".to_owned()),
            ..default_github()
        }),
    )
    .await;
    assert_eq!(newest.ran.status, 0);
    assert_eq!(
        lines(&newest.ran.stderr),
        ["notes 1.4.2 is the newest release on the stable channel."]
    );
    let named = run(&s, &["1.4.2"], &Scenario::default()).await;
    assert_eq!(named.ran.status, 0);
    assert_eq!(
        lines(&named.ran.stderr),
        ["notes 1.4.2 is already installed."]
    );
    // The running version named asks GitHub nothing.
    assert_eq!(named.records.requests(), Vec::<String>::new());
    untouched(&s);
    assert_eq!(newest.records.hook_calls(), Vec::<Value>::new());
    assert_eq!(named.records.hook_calls(), Vec::<Value>::new());
}

#[tokio::test]
async fn check_reports_what_an_update_would_do_requests_sha256sums_and_no_binary_and_writes_nothing()
 {
    let s = sandbox();
    let channel = run(&s, &["--check"], &Scenario::default()).await;
    assert_eq!(channel.ran.status, 0);
    assert_eq!(
        lines(&channel.ran.stderr),
        ["notes can update from 1.4.2 to 1.5.0 on the stable channel."]
    );
    let named = run(&s, &["--check", "1.4.0"], &Scenario::default()).await;
    assert_eq!(
        lines(&named.ran.stderr),
        ["notes can install 1.4.0 in place of 1.4.2."]
    );
    let running = run(&s, &["--check", "1.4.2"], &Scenario::default()).await;
    assert_eq!(
        lines(&running.ran.stderr),
        ["notes 1.4.2 is already installed."]
    );
    let requests: Vec<String> = [&channel, &named, &running]
        .iter()
        .flat_map(|outcome| outcome.records.requests())
        .collect();
    assert!(
        requests.contains(
            &"https://github.com/acme/notes/releases/download/v1.4.2/SHA256SUMS".to_owned()
        )
    );
    assert!(
        requests.contains(
            &"https://github.com/acme/notes/releases/download/v1.5.0/SHA256SUMS".to_owned()
        )
    );
    assert_eq!(
        requests.iter().filter(|url| url.ends_with(ASSET)).count(),
        0
    );
    untouched(&s);
    for outcome in [&channel, &named, &running] {
        assert_eq!(outcome.records.hook_calls(), Vec::<Value>::new());
    }
}

#[tokio::test]
async fn check_names_the_newer_only_line_for_a_release_that_is_not_newer() {
    let s = sandbox();
    let outcome = run(
        &s,
        &["--check"],
        &Scenario::default().github(GitHub {
            latest: Some("v1.4.2".to_owned()),
            ..default_github()
        }),
    )
    .await;
    assert_eq!(outcome.ran.status, 0);
    assert_eq!(
        lines(&outcome.ran.stderr),
        ["notes 1.4.2 is the newest release on the stable channel."]
    );
    // --check resolves and verifies the release first.
    assert_eq!(
        outcome.records.requests().last().unwrap(),
        "https://release-assets.example/v1.4.2/SHA256SUMS"
    );
}

#[tokio::test]
async fn conflicting_or_malformed_inputs_are_usage_errors() {
    for (argv, fragment) in [
        (
            vec!["--channel", "next", "1.4.0"],
            "Option \"--channel\" cannot be given with a version. Leave out --channel, or the version.",
        ),
        (vec!["1.x"], "version"),
        (vec!["--channel", "01"], "channel"),
    ] {
        let s = sandbox();
        let outcome = run(&s, &argv, &Scenario::default()).await;
        assert_eq!(outcome.ran.status, 2, "{argv:?}: {}", outcome.ran.stderr);
        assert!(
            outcome.ran.stderr.contains(fragment),
            "{argv:?}: {}",
            outcome.ran.stderr
        );
        assert_eq!(outcome.records.requests(), Vec::<String>::new());
    }
}

#[tokio::test]
async fn the_validators_say_what_to_supply() {
    let s = sandbox();
    let version = run(&s, &["1.x"], &Scenario::default()).await;
    assert!(
        version
            .ran
            .stderr
            .contains("Supply a semantic version, such as 1.4.0."),
        "{}",
        version.ran.stderr
    );
    let channel = run(&s, &["--channel", "01"], &Scenario::default()).await;
    assert!(
        channel
            .ran
            .stderr
            .contains("Supply stable or a prerelease identifier, such as next."),
        "{}",
        channel.ran.stderr
    );
}

#[tokio::test]
async fn channel_1_follows_the_channel_a_version_such_as_2_0_0_1_derives() {
    let s = sandbox();
    let scenario = Scenario::default().github(GitHub {
        feed: tags(&["v2.0.0-1"]),
        releases: releases(vec![github_release("2.0.0-1")]),
        ..default_github()
    });
    let outcome = run(&s, &["--channel", "1"], &scenario).await;
    assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
    assert_eq!(
        fs::read_to_string(&s.binary).unwrap(),
        "notes 2.0.0-1 binary\n"
    );
}

const NOT_BUILT: &str = "notes was not built as a release binary, so it cannot update itself. Update it the way you installed it.";
const OTHER_INSTALLER: &str = "notes was installed some other way, so self-update cannot replace it. Update it the way you installed it.";
const RELATIVE_HOME: &str = "notes cannot find its installation record because HOME is not an absolute path. Set HOME to an absolute path, then run self-update again.";

/// The scenario a case builds from its sandbox.
type ScenarioOf = Box<dyn Fn(&Sandbox) -> Scenario>;

#[tokio::test]
async fn a_run_refuses_before_any_request() {
    let cases: Vec<(&str, ScenarioOf, &str)> = vec![
        (
            "no release group",
            Box::new(|_| Scenario {
                release: Some(None),
                ..Scenario::default()
            }),
            NOT_BUILT,
        ),
        (
            "no asset",
            Box::new(|_| Scenario {
                release: Some(Some(Release::new("1.4.2", "acme/notes"))),
                ..Scenario::default()
            }),
            NOT_BUILT,
        ),
        (
            "a relative HOME",
            Box::new(|_| {
                Scenario::default()
                    .env("HOME", "home")
                    .env("XDG_STATE_HOME", "")
            }),
            RELATIVE_HOME,
        ),
        (
            "no installation",
            Box::new(|_| Scenario {
                installation: Some(None),
                ..Scenario::default()
            }),
            OTHER_INSTALLER,
        ),
        (
            "the method npm",
            Box::new(|s: &Sandbox| Scenario {
                installation: Some(Some(Installation::new(
                    "npm",
                    s.binary.to_string_lossy(),
                    recorded_digest(OLD_BYTES),
                ))),
                ..Scenario::default()
            }),
            OTHER_INSTALLER,
        ),
    ];
    for (label, scenario, sentence) in cases {
        let s = sandbox();
        let outcome = run(&s, &[], &scenario(&s)).await;
        assert_eq!(outcome.ran.status, 1, "{label}");
        assert_eq!(outcome.ran.stderr, format!("{sentence}\n"), "{label}");
        assert_eq!(outcome.records.requests(), Vec::<String>::new(), "{label}");
        untouched(&s);
    }
}

#[tokio::test]
async fn a_missing_binary_a_symbolic_link_and_a_changed_binary_refuse_before_any_request() {
    let missing = sandbox();
    fs::remove_file(&missing.binary).unwrap();
    let gone = run(&missing, &[], &Scenario::default()).await;
    assert_eq!(gone.ran.status, 1);
    assert_eq!(
        gone.ran.stderr,
        format!(
            "notes cannot find its binary at {}. Install it again with install.sh.\n",
            missing.binary.display()
        )
    );

    let linked = sandbox();
    let target = linked.root.join("store-notes");
    fs::write(&target, OLD_BYTES).unwrap();
    fs::remove_file(&linked.binary).unwrap();
    std::os::unix::fs::symlink(&target, &linked.binary).unwrap();
    let link = run(&linked, &[], &Scenario::default()).await;
    assert_eq!(link.ran.status, 1);
    assert_eq!(
        link.ran.stderr,
        format!(
            "notes at {} is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.\n",
            linked.binary.display()
        )
    );
    assert_eq!(fs::read_to_string(&target).unwrap(), OLD_BYTES);

    let changed = sandbox();
    fs::write(&changed.binary, "patched by hand\n").unwrap();
    let edited = run(&changed, &[], &Scenario::default()).await;
    assert_eq!(edited.ran.status, 1);
    assert_eq!(
        edited.ran.stderr,
        format!(
            "notes at {} changed since it was installed, so self-update will not replace it. Install it again with install.sh.\n",
            changed.binary.display()
        )
    );
    for (s, outcome) in [(&missing, &gone), (&linked, &link), (&changed, &edited)] {
        assert_eq!(outcome.records.requests(), Vec::<String>::new());
        assert_eq!(
            fs::read_to_string(&s.record).unwrap(),
            record_line(&s.binary, OLD_BYTES)
        );
    }
}

/// Whether the process runs as root, which writes to a read-only directory.
fn is_root() -> bool {
    rustix::process::geteuid().is_root()
}

#[tokio::test]
async fn a_read_only_install_directory_refuses_before_any_request() {
    if is_root() {
        return;
    }
    let s = sandbox();
    fs::set_permissions(&s.bin, fs::Permissions::from_mode(0o555)).unwrap();
    let outcome = run(&s, &[], &Scenario::default()).await;
    assert_eq!(outcome.ran.status, 1);
    assert_eq!(
        outcome.ran.stderr,
        format!(
            "notes cannot write to {}. Run self-update as the user who installed notes.\n",
            s.bin.display()
        )
    );
    assert_eq!(outcome.records.requests(), Vec::<String>::new());
    fs::set_permissions(&s.bin, fs::Permissions::from_mode(0o755)).unwrap();
    untouched(&s);
}

const CORRUPT: &str = "not the release bytes\n";

/// A release `v1.5.0` whose asset is corrupt and whose `SHA256SUMS` reads `sums`.
fn corrupt_release(sums: String) -> GitHub {
    GitHub {
        releases: releases(vec![(
            "v1.5.0".to_owned(),
            FakeRelease {
                sums: Some(sums),
                assets: BTreeMap::from([(ASSET.to_owned(), CORRUPT.to_owned())]),
            },
        )]),
        ..default_github()
    }
}

#[tokio::test]
async fn each_download_failure_fails_leaving_the_binary_the_record_and_no_staging_file() {
    let asset_path = format!("/releases/download/v1.5.0/{ASSET}");
    let asset_host = format!("release-assets.example/v1.5.0/{ASSET}");
    let cases: Vec<(&str, Vec<&str>, Scenario, String)> = vec![
        (
            "a digest mismatch",
            vec![],
            Scenario::default().github(corrupt_release(format!(
                "{}  {ASSET}\n",
                digest_of("x")
            ))),
            "notes-linux-x64 from v1.5.0 of acme/notes does not match its SHA256SUMS digest. Run self-update again later.".to_owned(),
        ),
        (
            "no SHA256SUMS line",
            vec![],
            Scenario::default().github(corrupt_release(format!("{}  other\n", digest_of("x")))),
            "Release v1.5.0 of acme/notes has no notes-linux-x64 in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.".to_owned(),
        ),
        (
            "two different lines",
            vec![],
            Scenario::default().github(corrupt_release(format!(
                "{}  {ASSET}\n{} *{ASSET}\n",
                digest_of(CORRUPT),
                digest_of("x")
            ))),
            "Release v1.5.0 of acme/notes lists notes-linux-x64 twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.".to_owned(),
        ),
        (
            "a 404 for a named version",
            vec!["9.9.9"],
            Scenario::default(),
            "notes could not download https://github.com/acme/notes/releases/download/v9.9.9/SHA256SUMS (404). Check that release v9.9.9 exists, then run self-update again.".to_owned(),
        ),
        (
            "a 503 for a named version",
            vec!["1.4.0"],
            Scenario::default().rule("/v1.4.0/SHA256SUMS", Rule::Status(503)),
            "notes could not download https://github.com/acme/notes/releases/download/v1.4.0/SHA256SUMS (503). Run self-update again later.".to_owned(),
        ),
        (
            "a 21st redirect on the way to the asset",
            vec![],
            Scenario::default().rule(&asset_path, Rule::Hops(20)),
            "notes was redirected too many times while downloading https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64. Run self-update again later.".to_owned(),
        ),
        (
            "a SHA256SUMS cut off",
            vec![],
            Scenario::default().rule("release-assets.example/v1.5.0/SHA256SUMS", Rule::Cut),
            "notes could not download https://github.com/acme/notes/releases/download/v1.5.0/SHA256SUMS (no response). Run self-update again later.".to_owned(),
        ),
        (
            "a feed cut off",
            vec!["--channel", "next"],
            Scenario::default().rule("releases.atom", Rule::Cut),
            "notes could not download https://github.com/acme/notes/releases.atom (no response). Run self-update again later.".to_owned(),
        ),
        (
            "a 21st redirect that reaches the tag page",
            vec![],
            Scenario::default().rule("releases/latest", Rule::Hops(20)),
            "notes was redirected too many times while downloading https://github.com/acme/notes/releases/latest. Run self-update again later.".to_owned(),
        ),
        (
            "a 503 for a feed candidate",
            vec!["--channel", "next"],
            Scenario::default()
                .github(GitHub {
                    feed: tags(&["v1.7.0-next.1", "v1.6.0"]),
                    ..channel_github()
                })
                .rule("/v1.7.0-next.1/SHA256SUMS", Rule::Status(503)),
            "notes could not download https://github.com/acme/notes/releases/download/v1.7.0-next.1/SHA256SUMS (503). Run self-update again later.".to_owned(),
        ),
        (
            "--check on a release that does not list the asset",
            vec!["--check"],
            Scenario::default().github(corrupt_release(format!("{}  other\n", digest_of("x")))),
            "Release v1.5.0 of acme/notes has no notes-linux-x64 in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.".to_owned(),
        ),
        (
            "a 503",
            vec![],
            Scenario::default().rule(&format!("/v1.5.0/{ASSET}"), Rule::Status(503)),
            "notes could not download https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64 (503). Run self-update again later.".to_owned(),
        ),
        (
            "a redirect to http",
            vec![],
            Scenario::default().rule(&asset_host, Rule::Insecure),
            "notes was redirected away from HTTPS while downloading https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64. Run self-update again later.".to_owned(),
        ),
        (
            "a 21st redirect",
            vec![],
            Scenario::default().rule(&asset_host, Rule::Loop),
            "notes was redirected too many times while downloading https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64. Run self-update again later.".to_owned(),
        ),
        (
            "a download cut off",
            vec![],
            Scenario::default().rule(&asset_host, Rule::Cut),
            "notes could not download https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64 (no response). Run self-update again later.".to_owned(),
        ),
        (
            "no response",
            vec![],
            Scenario::default().rule("releases/latest", Rule::NoResponse),
            "notes could not download https://github.com/acme/notes/releases/latest (no response). Run self-update again later.".to_owned(),
        ),
    ];
    for (label, argv, scenario, sentence) in cases {
        let s = sandbox();
        let outcome = run(&s, &argv, &scenario).await;
        assert_eq!(outcome.ran.status, 1, "{label}: {}", outcome.ran.stderr);
        assert_eq!(
            lines(&outcome.ran.stderr).last().unwrap(),
            &sentence,
            "{label}"
        );
        untouched(&s);
        assert_eq!(outcome.records.hook_calls(), Vec::<Value>::new(), "{label}");
    }
}

#[tokio::test]
async fn a_staging_write_that_fails_reports_the_write_sentence_and_leaves_the_binary() {
    if is_root() {
        return;
    }
    let s = sandbox();
    let scenario = Scenario::default().rule(
        &format!("release-assets.example/v1.5.0/{ASSET}"),
        Rule::Lock,
    );
    let outcome = run(&s, &[], &scenario).await;
    assert_eq!(outcome.ran.status, 1);
    assert_eq!(
        lines(&outcome.ran.stderr).last().unwrap(),
        &format!(
            "notes could not write the new binary to {}. Free space there or check its permissions, then run self-update again.",
            s.bin.display()
        )
    );
    fs::set_permissions(&s.bin, fs::Permissions::from_mode(0o755)).unwrap();
    untouched(&s);
}

#[tokio::test]
async fn a_run_aborted_during_the_download_exits_130_with_no_failure_sentence_and_leaves_everything()
 {
    let s = sandbox();
    let scenario = Scenario::default().rule(
        &format!("release-assets.example/v1.5.0/{ASSET}"),
        Rule::Abort,
    );
    let outcome = run(&s, &[], &scenario).await;
    assert_eq!(outcome.ran.status, 130);
    assert_eq!(
        lines(&outcome.ran.stderr),
        ["Downloading notes-linux-x64 from v1.5.0 of acme/notes."]
    );
    untouched(&s);
    assert_eq!(outcome.records.hook_calls(), Vec::<Value>::new());
}

#[tokio::test]
async fn a_throwing_hook_fails_the_run_after_the_update_line_and_the_new_binary_and_record_stay() {
    let s = sandbox();
    let outcome = run(
        &s,
        &[],
        &Scenario {
            hook: Hook::Throw,
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(outcome.ran.status, 1);
    assert_eq!(
        lines(&outcome.ran.stderr)[1],
        "Updated notes from 1.4.2 to 1.5.0."
    );
    assert_eq!(
        lines(&outcome.ran.stderr).last().unwrap(),
        "The service did not restart."
    );
    assert_eq!(
        fs::read_to_string(&s.binary).unwrap(),
        "notes 1.5.0 binary\n"
    );
    assert_eq!(
        fs::read_to_string(&s.record).unwrap(),
        record_line(&s.binary, "notes 1.5.0 binary\n")
    );
    // The hook read the run's host, whose release facts still describe the replaced binary.
    assert_eq!(
        outcome.records.hook_calls(),
        [hook_call(false, "1.5.0", &s)]
    );
}

#[tokio::test]
async fn twenty_redirects_on_the_way_to_the_asset_are_followed() {
    let s = sandbox();
    // Nineteen hops on github.com, then GitHub's own redirect to the asset host.
    let scenario = Scenario::default().rule(
        &format!("/releases/download/v1.5.0/{ASSET}"),
        Rule::Hops(19),
    );
    let outcome = run(&s, &[], &scenario).await;
    assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
    assert_eq!(
        fs::read_to_string(&s.binary).unwrap(),
        "notes 1.5.0 binary\n"
    );
}

#[tokio::test]
async fn a_run_cancelled_after_the_download_and_before_the_rename_exits_130_and_leaves_everything()
{
    let s = sandbox();
    let scenario = Scenario::default().rule(
        &format!("release-assets.example/v1.5.0/{ASSET}"),
        Rule::LateAbort,
    );
    let outcome = run(&s, &[], &scenario).await;
    assert_eq!(outcome.ran.status, 130);
    untouched(&s);
    assert_eq!(outcome.records.hook_calls(), Vec::<Value>::new());
}

#[tokio::test]
async fn the_refusals_keep_their_order() {
    let unresolved = sandbox();
    let first = run(
        &unresolved,
        &[],
        &Scenario {
            installation: Some(Some(Installation::new(
                "npm",
                unresolved.binary.to_string_lossy(),
                recorded_digest(OLD_BYTES),
            ))),
            ..Scenario::default()
                .env("HOME", "home")
                .env("XDG_STATE_HOME", "")
        },
    )
    .await;
    assert_eq!(first.ran.stderr, format!("{RELATIVE_HOME}\n"));
    let directory = sandbox();
    fs::remove_file(&directory.binary).unwrap();
    fs::create_dir(&directory.binary).unwrap();
    let second = run(&directory, &[], &Scenario::default()).await;
    assert_eq!(
        second.ran.stderr,
        format!(
            "notes cannot find its binary at {}. Install it again with install.sh.\n",
            directory.binary.display()
        )
    );
}

#[tokio::test]
async fn a_changed_binary_refuses_before_an_unwritable_directory() {
    if is_root() {
        return;
    }
    let s = sandbox();
    fs::write(&s.binary, "patched by hand\n").unwrap();
    fs::set_permissions(&s.bin, fs::Permissions::from_mode(0o555)).unwrap();
    let outcome = run(&s, &[], &Scenario::default()).await;
    assert_eq!(
        outcome.ran.stderr,
        format!(
            "notes at {} changed since it was installed, so self-update will not replace it. Install it again with install.sh.\n",
            s.binary.display()
        )
    );
}

#[tokio::test]
async fn the_feed_passes_over_another_repository_and_another_channel_and_stable_passes_over_a_prerelease_or_offsite_answer()
 {
    let s = sandbox();
    let feed = run(
        &s,
        &[],
        &Scenario::default().version("1.6.0-next.1").github(GitHub {
            feed: tags(&["v1.8.0-beta.1", "v1.6.0-next.2"]),
            foreign: vec![("other/repo".to_owned(), "v9.0.0".to_owned())],
            releases: releases(vec![
                github_release("1.8.0-beta.1"),
                github_release("1.6.0-next.2"),
            ]),
            ..channel_github()
        }),
    )
    .await;
    assert_eq!(feed.ran.status, 0, "{}", feed.ran.stderr);
    assert_eq!(
        fs::read_to_string(&s.binary).unwrap(),
        "notes 1.6.0-next.2 binary\n"
    );
    // Another repository's tag is never a candidate, so nothing asks for its version.
    assert_eq!(
        feed.records
            .requests()
            .iter()
            .filter(|url| url.contains("v9.0.0"))
            .count(),
        0
    );

    let no_release = "notes found no release on the stable channel of acme/notes. Name a version to install, such as notes self-update 1.4.0.\n";
    let prerelease = sandbox();
    let prerelease_outcome = run(
        &prerelease,
        &[],
        &Scenario::default().github(GitHub {
            latest: Some("v1.6.0-next.2".to_owned()),
            ..default_github()
        }),
    )
    .await;
    assert_eq!(prerelease_outcome.ran.stderr, no_release);
    let offsite = sandbox();
    let offsite_outcome = run(
        &offsite,
        &[],
        &Scenario::default().rule("releases/latest", Rule::Offsite),
    )
    .await;
    assert_eq!(offsite_outcome.ran.stderr, no_release);
}

#[tokio::test]
async fn a_sha256sums_already_fetched_while_resolving_the_feed_is_not_fetched_again() {
    let s = sandbox();
    let outcome = run(
        &s,
        &["--channel", "next"],
        &Scenario::default().github(GitHub {
            feed: tags(&["v1.6.0-next.2"]),
            ..channel_github()
        }),
    )
    .await;
    assert_eq!(outcome.ran.status, 0, "{}", outcome.ran.stderr);
    assert_eq!(
        outcome.records.requests(),
        [
            "https://github.com/acme/notes/releases.atom",
            "https://github.com/acme/notes/releases/download/v1.6.0-next.2/SHA256SUMS",
            "https://release-assets.example/v1.6.0-next.2/SHA256SUMS",
            "https://github.com/acme/notes/releases/download/v1.6.0-next.2/notes-linux-x64",
            "https://release-assets.example/v1.6.0-next.2/notes-linux-x64",
        ]
    );
}

#[tokio::test]
async fn a_path_and_a_version_a_sentence_repeats_pass_through_the_control_character_escape() {
    let s = sandbox();
    let odd = s.bin.join("no\u{1b}tes");
    fs::rename(&s.binary, &odd).unwrap();
    let outcome = run(
        &s,
        &[],
        &Scenario {
            installation: Some(Some(Installation::new(
                "script",
                odd.to_string_lossy(),
                recorded_digest("other"),
            ))),
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(outcome.ran.status, 1);
    assert!(
        outcome.ran.stderr.contains("no\\u001btes"),
        "{:?}",
        outcome.ran.stderr
    );
    assert!(!outcome.ran.stderr.contains('\u{1b}'));
}

#[tokio::test]
async fn a_digest_the_record_holds_is_compared_with_the_bytes_at_the_path() {
    // The default sandbox's record matches its bytes, so a script installation that says otherwise
    // is a changed binary.
    let s = sandbox();
    let facts_digest = format!("sha256:{}", digest_of("another binary\n"));
    let outcome = run(
        &s,
        &[],
        &Scenario {
            installation: Some(Some(Installation::new(
                "script",
                s.binary.to_string_lossy(),
                facts_digest,
            ))),
            ..Scenario::default()
        },
    )
    .await;
    assert_eq!(outcome.ran.status, 1);
    assert!(
        outcome
            .ran
            .stderr
            .contains("changed since it was installed")
    );
    // A version with build metadata reads its channel and compares without it.
    let built = sandbox();
    let same = run(
        &built,
        &[],
        &Scenario::default().github(GitHub {
            latest: Some("v1.4.2+linux".to_owned()),
            releases: releases(vec![github_release_with("1.4.2+linux", OLD_BYTES)]),
            ..default_github()
        }),
    )
    .await;
    assert_eq!(
        lines(&same.ran.stderr),
        ["notes 1.4.2 is the newest release on the stable channel."]
    );
}
