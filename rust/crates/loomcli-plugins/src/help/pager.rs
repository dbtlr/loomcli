//! Help paging and the one function that prints a page, which the help option's middleware and the
//! help Command's action share, so `--help` and `help <command>` cannot drift apart.
//!
//! The pager is the operator's `PAGER` command line, run through `/bin/sh -c` behind `exec`, so for
//! a `PAGER` that names one command the shell replaces itself with the pager's program, and ending
//! the child ends the pager. A pipelined `PAGER` keeps the shell as the pipeline's parent, so ending
//! the child ends the shell alone, the limit the reference accepts.

use std::sync::Arc;

use loomcli_core::{
    ChildExit, ChildStream, Host, KillSignal, Out, Outcome, ProcessSignal, Registration, RunSignal,
    ShutdownEvent, SpawnOptions,
};

use super::views::{HelpPage, help_page};

/// The pager when `PAGER` is unset.
const DEFAULT_PAGER: &str = "less";

/// `LESS` when the environment holds none: pass color, quit on a page that fits, keep the page.
const DEFAULT_LESS: &str = "FRX";

/// The shell's statuses for a command it found but could not run, and one it could not find.
const COULD_NOT_START: [i32; 2] = [126, 127];

/// A shutdown handler as the run's `on_shutdown` takes it.
pub(super) type ShutdownHandler = Box<dyn FnOnce(ShutdownEvent) + Send>;

/// What printing a page reads of a run: the host, the output, the run's signal, and its shutdown
/// registration, from a middleware's context or an action's.
pub(super) struct Show<'a, F> {
    pub(super) host: &'a Arc<Host>,
    pub(super) out: &'a Out,
    pub(super) signal: &'a RunSignal,
    pub(super) on_shutdown: F,
}

/// Whether the run is under CI: `CI` set, nonempty, and not `false`.
fn under_ci(host: &Host) -> bool {
    host.env
        .get("CI")
        .is_some_and(|ci| !ci.is_empty() && ci != "false")
}

/// The pager's command line when this run may page: stdout a terminal, a `TERM` that draws, not
/// CI, and a `PAGER` that does not turn paging off. An empty or blank `PAGER`, or `cat`, is the
/// operator's standard off switch.
fn pager_of(host: &Host) -> Option<String> {
    let term = host.env.get("TERM").map_or("", String::as_str);
    if !host.terminal.stdout().is_tty || term.is_empty() || term == "dumb" || under_ci(host) {
        return None;
    }
    let pager = host.env.get("PAGER").map_or(DEFAULT_PAGER, String::as_str);
    let command = pager.trim_matches(|character: char| {
        (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
    });
    (!command.is_empty() && command != "cat").then(|| pager.to_owned())
}

/// Whether a page holds at least as many lines as the terminal has rows, which must be known.
fn outgrows_screen(host: &Host, page: &str) -> bool {
    host.terminal
        .stdout()
        .rows
        .is_some_and(|rows| page.matches('\n').count() >= usize::from(rows))
}

/// Shows the page in the pager and answers whether help is done with it: true once the pager ran
/// or the run was cancelled, and false when the pager could not start, so the caller prints the
/// page itself. The run's signal ends the pager, and so does a shutdown that cuts the run off; both
/// send `SIGTERM`, on which less restores the terminal.
async fn show_in_pager<F>(show: &Show<'_, F>, pager: &str, page: &str) -> bool
where
    F: Fn(ShutdownHandler) -> Registration,
{
    let mut env = show.host.env.clone();
    env.entry("LESS".to_owned())
        .or_insert_with(|| DEFAULT_LESS.to_owned());
    let child = Arc::new(
        show.host.spawn(
            "/bin/sh",
            ["-c".to_owned(), format!("exec {pager}")],
            SpawnOptions::new()
                .env(env)
                .input(page.as_bytes())
                .signal(show.signal.token())
                .stdout(ChildStream::Inherit)
                .stderr(ChildStream::Inherit),
        ),
    );
    let ending = Arc::clone(&child);
    let registration = (show.on_shutdown)(Box::new(move |_event| {
        ending.kill(KillSignal::Signal(ProcessSignal::Term));
    }));
    let exit = child.exited().await;
    registration.remove();
    show.signal.is_cancelled()
        || matches!(exit, ChildExit::Exited { code, .. } if !COULD_NOT_START.contains(&code))
}

/// Prints one help page through the declared `help_page` view. With paging on, a page that
/// outgrows the terminal goes to the operator's pager instead, and prints as before when the pager
/// cannot start.
pub(super) async fn show_page<F>(show: Show<'_, F>, page: HelpPage, paging: bool) -> Outcome
where
    F: Fn(ShutdownHandler) -> Registration,
{
    let view = help_page();
    if let Some(pager) = paging.then(|| pager_of(show.host)).flatten() {
        let text = show.out.text(&page, &view)?;
        if outgrows_screen(show.host, &text) && show_in_pager(&show, &pager, &text).await {
            return Ok(());
        }
    }
    show.out.render(&page, &view).await
}
