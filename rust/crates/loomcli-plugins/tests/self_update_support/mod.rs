//! The fixture of the self-update tests, ported from the reference's `fixtures/self-update-app.ts`
//! and `fixtures/self-update-mock.ts`: an application `notes` that installs `self_update()` with a
//! fake GitHub as its transport, run on a mock process in a temporary sandbox. The fake serves
//! fixture releases, redirects each download to another HTTPS host as GitHub does, applies the
//! scenario's rules, and records each URL it answers.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use loomcli_core::{
    Application, BoxFuture, Build, Command, Context, Error, FatalError, Group, Installation,
    NoInputs, NoResult, ProcessHandle, Release, ReleaseFacts, RunOptions, View, ViewContext, lanes,
    override_view,
};
use loomcli_plugins::self_update::{SelfUpdate, Transport, TransportResponse, self_update};
use loomcli_testing::{MockFields, MockProcess, MockTerminal, StreamName, mock_process};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;
use url::Url;

pub type App = Application<NoInputs, NoResult, Group>;

pub const ASSET: &str = "notes-linux-x64";
pub const ASSET_HOST: &str = "https://release-assets.example";

/// The SHA-256 digest of some text, as 64 lowercase hexadecimal digits.
pub fn digest_of(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// One release the fake GitHub serves: its assets' bytes and its `SHA256SUMS`, `None` for a
/// release that publishes none.
#[derive(Clone, Debug)]
pub struct FakeRelease {
    pub sums: Option<String>,
    pub assets: BTreeMap<String, String>,
}

/// The release `v<version>` whose asset holds `bytes` and whose `SHA256SUMS` lists them.
pub fn github_release_with(version: &str, bytes: &str) -> (String, FakeRelease) {
    (
        format!("v{version}"),
        FakeRelease {
            sums: Some(format!("{}  {ASSET}\n", digest_of(bytes))),
            assets: BTreeMap::from([(ASSET.to_owned(), bytes.to_owned())]),
        },
    )
}

/// The release `v<version>` whose asset holds `notes <version> binary\n`.
pub fn github_release(version: &str) -> (String, FakeRelease) {
    github_release_with(version, &format!("notes {version} binary\n"))
}

/// What the fake GitHub serves.
#[derive(Clone, Debug)]
pub struct GitHub {
    pub repository: String,
    /// Feed entries that link another repository's tag pages: the owner path and the tag.
    pub foreign: Vec<(String, String)>,
    pub renamed_from: Option<String>,
    pub latest: Option<String>,
    pub feed: Vec<String>,
    pub releases: BTreeMap<String, FakeRelease>,
}

/// One rule the scenario sets for URLs that contain a fragment, applied before GitHub answers.
#[derive(Clone, Debug)]
pub enum Rule {
    /// Answers this status.
    Status(u16),
    /// Redirects the URL back to itself until it has been redirected this many times.
    Hops(usize),
    /// Redirects to the same URL over `http:`.
    Insecure,
    /// Redirects to the same URL with a new query, forever.
    Loop,
    /// Answers no response.
    NoResponse,
    /// Turns the install directory read-only, then lets GitHub answer.
    Lock,
    /// Answers 200 with a body that ends partway through.
    Cut,
    /// Cancels the run, then lets GitHub answer.
    LateAbort,
    /// Redirects off github.com.
    Offsite,
    /// Cancels the run during the request.
    Abort,
}

/// One event a run or a refresh child recorded.
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub event: &'static str,
    pub role: &'static str,
    pub detail: Value,
}

/// What the fake GitHub and the hook record, shared by a run and its refresh children.
#[derive(Clone, Default)]
pub struct Records {
    pub requests: Arc<Mutex<Vec<String>>>,
    pub events: Arc<Mutex<Vec<Event>>>,
    pub hook_calls: Arc<Mutex<Vec<Value>>>,
}

impl Records {
    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }

    pub fn events(&self) -> Vec<Event> {
        self.events.lock().unwrap().clone()
    }

    pub fn hook_calls(&self) -> Vec<Value> {
        self.hook_calls.lock().unwrap().clone()
    }

    pub fn record(&self, event: &'static str, role: &'static str, detail: Value) {
        self.events.lock().unwrap().push(Event {
            event,
            role,
            detail,
        });
    }
}

/// The fake GitHub as the plugin's transport.
#[derive(Clone)]
pub struct FakeGitHub {
    pub github: GitHub,
    pub rules: Vec<(String, Rule)>,
    pub controller: CancellationToken,
    pub records: Records,
    /// Whose requests these are: `run` or `child`.
    pub role: &'static str,
    /// The installation path whose directory `Rule::Lock` turns read-only.
    pub locked: Option<PathBuf>,
}

fn redirect(status: u16, location: &str) -> TransportResponse {
    TransportResponse::redirect(status, location)
}

fn text(status: u16, body: &str) -> TransportResponse {
    TransportResponse::new(status).body(body.as_bytes().to_vec())
}

impl FakeGitHub {
    /// The canonical repository a path names, and whether GitHub moved it, or `None` for one
    /// GitHub does not know.
    fn canonical(&self, owner: &str, name: &str) -> Option<(bool, String)> {
        let named = format!("{owner}/{name}").to_lowercase();
        if named == self.github.repository.to_lowercase() {
            return Some((false, self.github.repository.clone()));
        }
        if self
            .github
            .renamed_from
            .as_ref()
            .is_some_and(|old| named == old.to_lowercase())
        {
            return Some((true, self.github.repository.clone()));
        }
        None
    }

    /// The Atom feed GitHub serves: one entry per tag, newest first, each linking its tag page.
    fn feed(&self, repository: &str) -> String {
        let foreign: String = self
            .github
            .foreign
            .iter()
            .map(|(owner, tag)| {
                format!(
                    r#"<entry><link rel="alternate" type="text/html" href="https://github.com/{owner}/releases/tag/{tag}"/></entry>"#
                )
            })
            .collect();
        let entries: String = self
            .github
            .feed
            .iter()
            .map(|tag| {
                format!(
                    r#"<entry><id>tag:github.com,2008:Repository/1/{tag}</id><link rel="alternate" type="text/html" href="https://github.com/{repository}/releases/tag/{tag}"/><title>{tag}</title><content type="html">&lt;a href=&quot;https://github.com/{repository}/releases/tag/v99.0.0&quot;&gt;notes&lt;/a&gt;</content></entry>"#
                )
            })
            .collect();
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><link type="text/html" rel="alternate" href="https://github.com/{repository}/releases"/><link type="application/atom+xml" rel="self" href="https://github.com/{repository}/releases.atom"/>{foreign}{entries}</feed>"#
        )
    }

    /// What GitHub answers for one URL on github.com.
    fn answer_github(&self, url: &Url) -> TransportResponse {
        let path = url.path().strip_prefix('/').unwrap_or(url.path());
        let mut parts = path.split('/');
        let owner = parts.next().unwrap_or_default();
        let name = parts.next().unwrap_or_default();
        let rest: Vec<&str> = parts.collect();
        let Some((moved, repository)) = self.canonical(owner, name) else {
            return text(404, "Not Found");
        };
        let rest = rest.join("/");
        if moved {
            return redirect(301, &format!("https://github.com/{repository}/{rest}"));
        }
        if rest == "releases/latest" {
            return match &self.github.latest {
                None => redirect(302, &format!("https://github.com/{repository}/releases")),
                Some(tag) => redirect(
                    302,
                    &format!("https://github.com/{repository}/releases/tag/{tag}"),
                ),
            };
        }
        if rest == "releases" || rest.starts_with("releases/tag/") {
            return text(200, "<html></html>");
        }
        if rest == "releases.atom" {
            return text(200, &self.feed(&repository));
        }
        let download: Vec<&str> = rest.split('/').collect();
        if let ["releases", "download", tag, file] = download.as_slice()
            && let Some(release) = self.github.releases.get(*tag)
        {
            let found = if *file == "SHA256SUMS" {
                release.sums.clone()
            } else {
                release.assets.get(*file).cloned()
            };
            if found.is_some() {
                return redirect(302, &format!("{ASSET_HOST}/{tag}/{file}"));
            }
        }
        text(404, "Not Found")
    }

    /// What the asset host answers: the file's bytes.
    fn answer_assets(&self, url: &Url) -> TransportResponse {
        let path = url.path().strip_prefix('/').unwrap_or(url.path());
        let (tag, file) = path.split_once('/').unwrap_or((path, ""));
        let release = self.github.releases.get(tag);
        let body = if file == "SHA256SUMS" {
            release.and_then(|release| release.sums.clone())
        } else {
            release.and_then(|release| release.assets.get(file).cloned())
        };
        text(200, &body.unwrap_or_default())
    }

    /// What one rule answers for a URL, or `None` when the request goes on to GitHub.
    fn answer_rule(&self, rule: &Rule, text_url: &str) -> Option<io::Result<TransportResponse>> {
        match rule {
            Rule::Insecure => Some(Ok(redirect(302, &text_url.replacen("https:", "http:", 1)))),
            Rule::Loop => {
                static AGAIN: AtomicU64 = AtomicU64::new(0);
                let base = text_url.split('?').next().unwrap_or(text_url);
                let again = AGAIN.fetch_add(1, Ordering::Relaxed);
                Some(Ok(redirect(302, &format!("{base}?again={again}"))))
            }
            Rule::NoResponse => Some(Err(io::Error::other("fetch failed"))),
            Rule::Lock => {
                let path = self.locked.as_ref().expect("the scenario records a path");
                let directory = path.parent().unwrap();
                fs::set_permissions(directory, fs::Permissions::from_mode(0o555)).unwrap();
                None
            }
            Rule::Cut => Some(Ok(TransportResponse::new(200)
                .body_with(async { Err(io::Error::other("terminated")) }))),
            Rule::LateAbort => {
                self.controller.cancel();
                None
            }
            Rule::Offsite => Some(Ok(redirect(302, "https://example.com/elsewhere"))),
            Rule::Hops(hops) => {
                let mut url = Url::parse(text_url).unwrap();
                let done: usize = url
                    .query_pairs()
                    .find(|(key, _)| key == "hop")
                    .and_then(|(_, value)| value.parse().ok())
                    .unwrap_or(0);
                if done >= *hops {
                    return None;
                }
                let others: Vec<(String, String)> = url
                    .query_pairs()
                    .filter(|(key, _)| key != "hop")
                    .map(|(key, value)| (key.into_owned(), value.into_owned()))
                    .collect();
                url.query_pairs_mut()
                    .clear()
                    .extend_pairs(others)
                    .append_pair("hop", &(done + 1).to_string());
                Some(Ok(redirect(302, url.as_str())))
            }
            Rule::Abort => {
                self.controller.cancel();
                Some(Err(io::Error::other("This operation was aborted")))
            }
            Rule::Status(status) => Some(Ok(text(*status, "Unavailable"))),
        }
    }

    fn answer(&self, text_url: &str) -> io::Result<TransportResponse> {
        for (fragment, rule) in &self.rules {
            if text_url.contains(fragment.as_str())
                && let Some(answer) = self.answer_rule(rule, text_url)
            {
                return answer;
            }
        }
        let url = Url::parse(text_url).unwrap();
        let origin = url.origin().ascii_serialization();
        if origin == "https://github.com" {
            return Ok(self.answer_github(&url));
        }
        if origin == ASSET_HOST {
            return Ok(self.answer_assets(&url));
        }
        Err(io::Error::other(format!(
            "The fake GitHub does not serve {text_url}."
        )))
    }
}

impl Transport for FakeGitHub {
    fn get(&self, url: &str) -> BoxFuture<'static, io::Result<TransportResponse>> {
        self.records.requests.lock().unwrap().push(url.to_owned());
        self.records
            .record("request", self.role, json!({ "url": url }));
        let answer = self.answer(url);
        Box::pin(async move { answer })
    }
}

/// A temporary sandbox: the home, the state and cache directories, and the install directory
/// holding the binary. It is removed, read-only directories included, when it drops.
pub struct Sandbox {
    pub root: PathBuf,
    pub home: PathBuf,
    pub state: PathBuf,
    pub cache_home: PathBuf,
    pub bin: PathBuf,
    pub binary: PathBuf,
    pub record: PathBuf,
    /// The application's cache directory, `$XDG_CACHE_HOME/notes`.
    pub cache: PathBuf,
    /// `update.json` in the cache directory.
    pub file: PathBuf,
}

/// Makes every directory under `root` writable again, so a case that made one read-only cleans up.
fn writable_tree(root: &Path) {
    let Ok(metadata) = fs::symlink_metadata(root) else {
        return;
    };
    if metadata.is_dir() {
        let _ = fs::set_permissions(root, fs::Permissions::from_mode(0o755));
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                writable_tree(&entry.path());
            }
        }
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        writable_tree(&self.root);
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// A fresh, empty directory under the system's temporary folder, named through no link.
pub fn temporary_root(prefix: &str) -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}-{nanos}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).unwrap();
    fs::canonicalize(root).unwrap()
}

/// The line the installation record holds for a binary at `path` with these bytes.
pub fn record_line(path: &Path, bytes: &str) -> String {
    format!(
        "{{\"format\":1,\"method\":\"script\",\"path\":{},\"digest\":\"sha256:{}\"}}\n",
        json!(path.to_string_lossy()),
        digest_of(bytes)
    )
}

/// A sandbox whose binary holds `bytes`, mode 755, and whose record names it.
pub fn sandbox_with(bytes: &str) -> Sandbox {
    let root = temporary_root("loom-self-update");
    let home = root.join("home");
    let state = root.join("state");
    let cache_home = root.join("cache");
    let bin = root.join("bin");
    for directory in [
        &home,
        &state,
        &cache_home,
        &bin,
        &state.join("notes").join("installation"),
    ] {
        fs::create_dir_all(directory).unwrap();
    }
    let binary = bin.join("notes");
    fs::write(&binary, bytes).unwrap();
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
    let record = state
        .join("notes")
        .join("installation")
        .join("install.json");
    fs::write(&record, record_line(&binary, bytes)).unwrap();
    let cache = cache_home.join("notes");
    Sandbox {
        file: cache.join("update.json"),
        cache,
        root,
        home,
        state,
        cache_home,
        bin,
        binary,
        record,
    }
}

/// The digest the record holds for `bytes`.
pub fn recorded_digest(bytes: &str) -> String {
    format!("sha256:{}", digest_of(bytes))
}

/// The release facts of a script-installed binary at `version`, recorded at the sandbox's binary
/// with the digest of `bytes`.
pub fn script_facts(sandbox: &Sandbox, version: &str, bytes: &str) -> ReleaseFacts {
    ReleaseFacts::new(Build::Distributed)
        .release(Release::new(version, "acme/notes").asset(ASSET))
        .installation(Installation::new(
            "script",
            sandbox.binary.to_string_lossy(),
            recorded_digest(bytes),
        ))
}

/// What the author's hook does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hook {
    None,
    Record,
    Throw,
}

/// The application a scenario runs.
#[derive(Clone)]
pub struct Fixture {
    pub github: GitHub,
    pub rules: Vec<(String, Rule)>,
    pub hook: Hook,
    /// `None` keeps notices at their default; `Some(false)` turns them off.
    pub notices: Option<bool>,
    pub notice_env: Option<String>,
    pub help: Option<&'static str>,
    pub restyle: bool,
    pub version: String,
    pub records: Records,
    pub controller: CancellationToken,
    pub locked: Option<PathBuf>,
    /// The author's refresh hook in place of the recording one.
    pub after_replace: Option<AfterReplaceHook>,
    /// Installs the verbose plugin before `self_update()`, for `-q`.
    pub verbose: bool,
}

/// A refresh `after_replace` the fixture installs in place of the recording hook.
pub type AfterReplaceHook = Arc<
    dyn Fn(
            loomcli_plugins::self_update::AfterReplaceContext,
        ) -> BoxFuture<'static, Result<(), Error>>
        + Send
        + Sync,
>;

impl Fixture {
    /// The transport this fixture's runs use, recording as `role`.
    pub fn transport(&self, role: &'static str) -> FakeGitHub {
        FakeGitHub {
            github: self.github.clone(),
            rules: self.rules.clone(),
            controller: self.controller.clone(),
            records: self.records.clone(),
            role,
            locked: self.locked.clone(),
        }
    }

    /// The plugin's settings for this fixture.
    fn settings(&self, role: &'static str) -> SelfUpdate {
        let mut settings = self_update().transport(self.transport(role));
        if let Some(hook) = &self.after_replace {
            let hook = Arc::clone(hook);
            settings = settings.after_replace(move |context| hook(context));
        } else if self.hook != Hook::None {
            let calls = Arc::clone(&self.records.hook_calls);
            let throws = self.hook == Hook::Throw;
            settings = settings.after_replace(move |context| {
                let calls = Arc::clone(&calls);
                async move {
                    calls.lock().unwrap().push(json!({
                        "aborted": context.signal.is_cancelled(),
                        "current": context.current,
                        "host": context.host.release.release.as_ref().map(|release| release.version.clone()),
                        "path": context.path,
                        "previous": context.previous,
                    }));
                    if throws {
                        return Err(FatalError::new("The service did not restart.").into());
                    }
                    Ok(())
                }
            });
        }
        if let Some(on) = self.notices {
            settings = settings.notices(on);
        }
        if let Some(variable) = &self.notice_env {
            settings = settings.notice_env(variable);
        }
        settings
    }

    /// `notes`, installing `self_update()` and the help plugin where the fixture names, with the
    /// Commands a notices scenario runs: one that succeeds, one that fails, and two cancelled.
    pub fn application(&self, role: &'static str) -> App {
        let update = self.settings(role).plugin();
        let base = Application::new("notes")
            .description("A fixture application.")
            .version(self.version.clone());
        let mut application = match (self.help, self.verbose) {
            #[cfg(feature = "help")]
            (Some("before"), _) => base.plugins((loomcli_plugins::help::help(), update)),
            #[cfg(feature = "help")]
            (Some("after"), _) => base.plugins((update, loomcli_plugins::help::help())),
            #[cfg(feature = "verbose")]
            (_, true) => base.plugins((loomcli_plugins::verbose::verbose(), update)),
            _ => base.plugins((update,)),
        };
        if self.restyle {
            application = application.overrides([override_view(
                lanes::info(),
                View::new(|message: &str, _: &ViewContext| format!("[info] {message}")),
            )]);
        }
        let cancel = self.controller.clone();
        let interrupt = self.controller.clone();
        application
            .command(
                Command::new("add")
                    .description("Add a note.")
                    .action(|ctx: Context| async move { ctx.out.success("Added note 12.").await }),
            )
            .command(
                Command::new("fail")
                    .description("Fail.")
                    .action(|_: Context| async move {
                        Err(FatalError::new("The note could not be added.").into())
                    }),
            )
            .command(
                Command::new("cancel")
                    .description("Cancel the run during the action.")
                    .action(move |ctx: Context| {
                        let cancel = cancel.clone();
                        async move {
                            cancel.cancel();
                            ctx.signal.throw_if_cancelled()
                        }
                    }),
            )
            .command(
                Command::new("interrupt")
                    .description("Return once the run is cancelled.")
                    .action(move |ctx: Context| {
                        let interrupt = interrupt.clone();
                        async move {
                            interrupt.cancel();
                            ctx.signal.cancelled().await;
                            Ok(())
                        }
                    }),
            )
    }
}

/// The default fake GitHub of the update tests.
pub fn default_github() -> GitHub {
    GitHub {
        repository: "acme/notes".to_owned(),
        foreign: Vec::new(),
        renamed_from: None,
        latest: Some("v1.5.0".to_owned()),
        feed: vec!["v1.5.0".to_owned(), "v1.4.2".to_owned()],
        releases: BTreeMap::from([
            github_release("1.5.0"),
            github_release_with("1.4.2", OLD_BYTES),
            github_release("1.4.0"),
        ]),
    }
}

/// The bytes of the binary the update tests start from, at 1.4.2.
pub const OLD_BYTES: &str = "notes 1.4.2 binary\n";

/// What one run left.
#[derive(Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

/// The facts of one mock run besides the fixture.
pub struct RunFacts {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    pub home: PathBuf,
    pub cwd: Option<PathBuf>,
    pub release: ReleaseFacts,
    pub program: Option<Vec<String>>,
    pub tty: Option<(bool, bool)>,
}

/// Builds the mock for one run; `scripts` adds the programs it may spawn.
pub fn mock_for(
    facts: &RunFacts,
    scripts: impl FnOnce(MockFields) -> MockFields,
) -> Arc<MockProcess> {
    let mut fields = MockFields::new()
        .argv(facts.argv.iter().cloned())
        .platform("linux")
        .home(facts.home.clone())
        .release(facts.release.clone());
    if let Some(cwd) = &facts.cwd {
        fields = fields.cwd(cwd.clone());
    }
    for (name, value) in &facts.env {
        fields = fields.env(name, value);
    }
    if let Some(program) = &facts.program {
        fields = fields.program(program.iter().cloned());
    }
    if let Some((stdout, stderr)) = facts.tty {
        let mut streams = Vec::new();
        if stdout {
            streams.push(StreamName::Stdout);
        }
        if stderr {
            streams.push(StreamName::Stderr);
        }
        if !streams.is_empty() {
            fields = fields.terminal(MockTerminal::new(80, 24).streams(streams));
        }
    }
    mock_process(scripts(fields))
}

/// Runs the fixture's application on `process`, its signal the fixture's controller.
pub async fn run_on(fixture: &Fixture, role: &'static str, process: &Arc<MockProcess>) -> Ran {
    let application = fixture.application(role);
    let code = application
        .run(
            RunOptions::new()
                .process(Arc::clone(process) as Arc<dyn ProcessHandle>)
                .signal(fixture.controller.clone()),
        )
        .await;
    Ran {
        status: code.get(),
        stdout: process.stdout_text(),
        stderr: process.stderr_text(),
    }
}

/// The lines a run wrote to stderr, each with any lane glyph and the space after it removed.
pub fn lines(stderr: &str) -> Vec<String> {
    stderr
        .trim()
        .split('\n')
        .map(|line| {
            let mut characters = line.chars();
            match (characters.next(), characters.next()) {
                (Some(first), Some(' ')) if !first.is_ascii() => characters.as_str().to_owned(),
                _ => line.to_owned(),
            }
        })
        .collect()
}

/// The names of the staging files in `directory`.
pub fn staging_files(directory: &Path) -> Vec<String> {
    fs::read_dir(directory)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".loom-staging"))
        .collect()
}

/// The mode bits of a path.
pub fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}
