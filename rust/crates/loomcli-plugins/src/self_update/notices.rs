//! The update notices' middleware: after the action of a run at a terminal, it prints one line when
//! the cache names a newer release on the running binary's channel, and refreshes a stale cache
//! through a detached copy of the application, which the run never waits for.

use std::cmp::Ordering;
use std::path::PathBuf;
use std::pin::pin;
use std::sync::Arc;
use std::task::{Context, Poll, Waker};

use loomcli_core::{
    ApplicationDirectory, ChainOutcome, ChildExit, DetachedSpawnOptions, DirectoryFacts,
    DirectoryLookup, Env, Host, MiddlewareContext, Next, NoOptions, Outcome, application_directory,
};

use super::cache::{
    CACHE_FILE, CacheEntry, CacheFound, CacheReading, Lookup, STALE, read_cache, write_cache,
};
use super::messages::{self, UpdateCheckSkip};
use super::update::{release_binary, script_installation};
use super::version::{Version, compare_versions, parse_version};
use crate::change_events::file_written;

/// The variable any operator sets to turn update notices off.
const OPERATOR_OPT_OUT: &str = "NO_UPDATE_NOTIFIER";

/// The plugin's Command, whose own runs show no notice.
const COMMAND_NAME: &str = "self-update";

/// The words the refresh child runs after `host.program`.
pub(crate) const REFRESH_WORDS: [&str; 2] = [COMMAND_NAME, "--refresh-notice"];

/// Whether a variable is set to something other than the empty string.
fn is_set(env: &Env, name: &str) -> bool {
    env.get(name).is_some_and(|value| !value.is_empty())
}

/// Whether the run is under CI, read as ci-info reads `CI`: set and nonempty, where `CI=false` is
/// an operator saying the run is not CI.
fn under_ci(env: &Env) -> bool {
    env.get("CI")
        .is_some_and(|value| !value.is_empty() && value != "false")
}

/// The first opt-out, terminal, CI, or route condition that skips the update check.
fn ineligibility<'a>(
    host: &Host,
    opt_out: Option<&'a str>,
    routed: &[String],
) -> Option<UpdateCheckSkip<'a>> {
    let env = &host.env;
    if is_set(env, OPERATOR_OPT_OUT) {
        Some(UpdateCheckSkip::OptedOut(OPERATOR_OPT_OUT))
    } else if let Some(variable) = opt_out.filter(|name| is_set(env, name)) {
        Some(UpdateCheckSkip::OptedOut(variable))
    } else if !host.terminal.stdout().is_tty {
        Some(UpdateCheckSkip::Stdout)
    } else if !host.terminal.stderr().is_tty {
        Some(UpdateCheckSkip::Stderr)
    } else if under_ci(env) {
        Some(UpdateCheckSkip::Ci)
    } else if routed.join(" ") == COMMAND_NAME {
        Some(UpdateCheckSkip::SelfUpdate)
    } else {
        None
    }
}

/// A run that may show a notice: the graph's name, the running binary's version and lookup, and
/// the cache directory.
struct Qualified {
    name: String,
    repository: String,
    channel: String,
    running: Version,
    directory: PathBuf,
}

impl Qualified {
    fn lookup(&self) -> Lookup<'_> {
        Lookup {
            repository: &self.repository,
            channel: &self.channel,
        }
    }
}

/// The run's binary and cache directory when conditions 2 to 7 of the contract hold, in its order;
/// the last two are a script-installed release binary and a cache directory that resolves.
fn qualified<'a>(
    host: &Host,
    name: &'a str,
    opt_out: Option<&'a str>,
    routed: &[String],
) -> Result<Qualified, UpdateCheckSkip<'a>> {
    if let Some(reason) = ineligibility(host, opt_out, routed) {
        return Err(reason);
    }
    let binary = release_binary(host).ok_or(UpdateCheckSkip::NotRelease(name))?;
    script_installation(host).ok_or(UpdateCheckSkip::NotScript(name))?;
    let directory = match application_directory(
        ApplicationDirectory::Cache,
        name,
        &DirectoryFacts::from(host),
    ) {
        DirectoryLookup::Path(path) => path,
        DirectoryLookup::Variable(variable) => return Err(UpdateCheckSkip::NotAbsolute(variable)),
        _ => return Err(UpdateCheckSkip::NotAbsolute("HOME".to_owned())),
    };
    Ok(Qualified {
        name: name.to_owned(),
        repository: binary.repository,
        channel: binary.channel,
        running: binary.running,
        directory,
    })
}

/// The cache's newer version, when it names one above the running version.
fn newer_version(reading: &CacheReading, running: &Version) -> Option<Version> {
    let latest = reading.latest.as_ref()?.as_deref()?;
    parse_version(latest).filter(|latest| compare_versions(latest, running) == Ordering::Greater)
}

/// The notice line for a newer release.
fn notice_line(run: &Qualified, newer: &Version) -> String {
    messages::notice_line(&run.name, &newer.text, &run.channel, &run.running.text)
}

/// Starts `[...program, 'self-update', '--refresh-notice']` as a detached child in the cache
/// directory, with the run's environment. Checks for an immediate start failure and releases it.
fn start_refresh(host: &Host, run: &Qualified) -> bool {
    let Some((command, words)) = host.program.split_first() else {
        return false;
    };
    let args = words.iter().map(String::as_str).chain(REFRESH_WORDS);
    let child = host.spawn_detached(
        command,
        args,
        DetachedSpawnOptions::new().cwd(run.directory.clone()),
    );
    // Core returns an immediately ready exit when spawn fails. A pending child outlives the run.
    let mut exit = pin!(child.exited());
    !matches!(
        exit.as_mut().poll(&mut Context::from_waker(Waker::noop())),
        Poll::Ready(ChildExit::Unstarted { .. })
    )
}

/// Prints the notice when the cache names a newer version, then refreshes a stale cache, writing
/// the cached `latest` back when only its `checked` was at fault. Writing `checked` comes first; a
/// `checked` that cannot be written starts no child.
async fn notify(run: &Qualified, context: &MiddlewareContext<NoOptions>, now: i64) {
    let log = &context.log;
    let path = run.directory.join(CACHE_FILE);
    let reading = match read_cache(&path, run.lookup(), now) {
        CacheFound::Read(reading) => {
            let (template, fields) = messages::read_update_check(&path);
            log.debug(template, fields);
            reading
        }
        CacheFound::Ignored => {
            let (template, fields) = messages::ignored_update_cache(&path);
            log.trace(template, fields);
            STALE
        }
        CacheFound::Missing => STALE,
    };
    if let Some(newer) = newer_version(&reading, &run.running) {
        // Core's output contract alone reports a write that fails; the notice lets it go.
        let _ = context.out.info(&notice_line(run, &newer)).await;
    }
    if reading.fresh {
        return;
    }
    let entry = CacheEntry {
        lookup: run.lookup(),
        checked: now,
        latest: reading.latest.flatten(),
    };
    if let Ok(path) = write_cache(&run.directory, &entry) {
        file_written(log, &path);
        if start_refresh(&context.host, run) {
            log.debug(messages::STARTED_REFRESH, ());
        }
    }
}

/// The middleware of one `self_update()` whose notices are on, `opt_out` the author's variable. It
/// calls `next` first and acts only once the action was dispatched and the run not cancelled; a
/// failure of `next` propagates unchanged.
pub(crate) fn notice_middleware(
    opt_out: Option<String>,
    clock: fn() -> i64,
) -> impl Fn(
    MiddlewareContext<NoOptions>,
    Next,
) -> std::pin::Pin<Box<dyn Future<Output = Outcome> + Send>>
+ Send
+ Sync
+ 'static {
    let opt_out: Arc<Option<String>> = Arc::new(opt_out);
    move |context: MiddlewareContext<NoOptions>, next: Next| {
        let opt_out = Arc::clone(&opt_out);
        Box::pin(async move {
            let outcome = next.run().await?;
            if outcome != ChainOutcome::Dispatched || context.signal.is_cancelled() {
                return Ok(());
            }
            match qualified(
                &context.host,
                &context.graph.name,
                opt_out.as_deref(),
                &context.command.path,
            ) {
                Ok(run) => notify(&run, &context, clock()).await,
                Err(reason) => {
                    let (template, fields) = messages::skipped(reason);
                    context.log.trace(template, fields);
                }
            }
            Ok(())
        })
    }
}

#[cfg(all(test, feature = "verbose"))]
#[path = "notices/lines_tests.rs"]
mod lines_tests;
