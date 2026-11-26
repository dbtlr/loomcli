//! The update notices' middleware: after the action of a run at a terminal, it prints one line when
//! the cache names a newer release on the running binary's channel, and refreshes a stale cache
//! through a detached copy of the application, which the run never waits for.

use std::cmp::Ordering;
use std::path::PathBuf;
use std::sync::Arc;

use loomcli_core::{
    ApplicationDirectory, ChainOutcome, DetachedSpawnOptions, DirectoryFacts, DirectoryLookup, Env,
    Host, MiddlewareContext, Next, NoOptions, Out, Outcome, application_directory,
};

use super::cache::{CacheEntry, CacheReading, Lookup, now, read_cache, write_cache};
use super::messages;
use super::update::{release_binary, script_installation};
use super::version::{Version, compare_versions, parse_version};

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

/// Whether conditions 2 to 5 of the contract hold, in its order: no opt-out variable, both output
/// streams at a terminal, not CI, and not `self-update` itself.
fn is_eligible(host: &Host, opt_out: Option<&str>, routed: &[String]) -> bool {
    let env = &host.env;
    !(is_set(env, OPERATOR_OPT_OUT)
        || opt_out.is_some_and(|name| is_set(env, name))
        || !host.terminal.stdout().is_tty
        || !host.terminal.stderr().is_tty
        || under_ci(env)
        || routed.join(" ") == COMMAND_NAME)
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
fn qualified(
    host: &Host,
    name: &str,
    opt_out: Option<&str>,
    routed: &[String],
) -> Option<Qualified> {
    if !is_eligible(host, opt_out, routed) {
        return None;
    }
    let binary = release_binary(host)?;
    script_installation(host)?;
    let DirectoryLookup::Path(directory) = application_directory(
        ApplicationDirectory::Cache,
        name,
        &DirectoryFacts::from(host),
    ) else {
        return None;
    };
    Some(Qualified {
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
/// directory, with the run's environment, and releases it. A child that cannot start answers so
/// through its exit, which nothing reads.
fn start_refresh(host: &Host, run: &Qualified) {
    let Some((command, words)) = host.program.split_first() else {
        return;
    };
    let args = words.iter().map(String::as_str).chain(REFRESH_WORDS);
    // The run never waits for the refresh, so its child handle is released at once.
    drop(host.spawn_detached(
        command,
        args,
        DetachedSpawnOptions::new().cwd(run.directory.clone()),
    ));
}

/// Prints the notice when the cache names a newer version, then refreshes a stale cache, writing
/// the cached `latest` back when only its `checked` was at fault. Writing `checked` comes first; a
/// `checked` that cannot be written starts no child.
async fn notify(host: &Host, run: &Qualified, out: &Out) {
    let now = now();
    let reading = read_cache(&run.directory, run.lookup(), now);
    if let Some(newer) = newer_version(&reading, &run.running) {
        // Core's output contract alone reports a write that fails; the notice lets it go.
        let _ = out.info(&notice_line(run, &newer)).await;
    }
    if reading.fresh {
        return;
    }
    let entry = CacheEntry {
        lookup: run.lookup(),
        checked: now,
        latest: reading.latest.flatten(),
    };
    if write_cache(&run.directory, &entry).is_ok() {
        start_refresh(host, run);
    }
}

/// The middleware of one `self_update()` whose notices are on, `opt_out` the author's variable. It
/// calls `next` first and acts only once the action was dispatched and the run not cancelled; a
/// failure of `next` propagates unchanged.
pub(crate) fn notice_middleware(
    opt_out: Option<String>,
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
            let host = &context.host;
            if let Some(run) = qualified(
                host,
                &context.graph.name,
                opt_out.as_deref(),
                &context.command.path,
            ) {
                notify(host, &run, &context.out).await;
            }
            Ok(())
        })
    }
}
