//! `mcp install`: registers this application's server with each selected agent's own CLI, and
//! records each registration in the agent's plugin's file around the call that writes it.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use loomcli_core::{Build, Error};

use super::messages::{self, BuildNote, Child};
use super::registration::{Agent, Answer, ChildRun, command_line, selected_agents};
use crate::installation::{PluginRecord, RecordedRegistration};

/// What `install` was asked: the agent it is limited to, and whether it replaces a name in the
/// way.
pub(super) struct InstallRequest {
    pub(super) agent: Option<Agent>,
    pub(super) force: bool,
}

/// The code `codex mcp get` answers for a name it does not hold.
const NOT_HELD: i32 = 1;

/// One agent's registration: its record, what its file records, and the command line it will
/// hold.
struct Registering<'a> {
    agent: Agent,
    record: &'a PathBuf,
    recorded: Option<&'a RecordedRegistration>,
    command: &'a [String],
}

impl Registering<'_> {
    fn file(&self) -> PluginRecord {
        PluginRecord::new(self.record, self.agent.record_name())
    }
}

/// The agents whose CLI starts, in table order. An agent that cannot start fails the child when
/// `--agent` named it, and is skipped otherwise, which fails the child when none starts.
async fn started_agents(
    run: &ChildRun<'_>,
    selected: &[Agent],
    named: Option<Agent>,
) -> Result<Vec<Agent>, Error> {
    let mut started = Vec::new();
    for agent in selected {
        if run.starts(*agent).await? {
            started.push(*agent);
        }
    }
    if started.is_empty() {
        return Err(match named {
            None => messages::no_agent(run.name),
            Some(agent) => messages::agent_missing(run.name, agent.name()),
        });
    }
    Ok(started)
}

/// Whether the agent holds the name though the record lists none. Only an agent with a name check
/// is asked; any answer but exit 0 or 1, and a check that cannot start, fails with nothing
/// written.
async fn holds_name(run: &ChildRun<'_>, agent: Agent) -> Result<bool, Error> {
    let Some(check) = agent.name_check(&run.registration) else {
        return Ok(false);
    };
    let answer = run.call(agent, check).await?;
    match answer.code() {
        Some(0) => Ok(true),
        Some(NOT_HELD) => Ok(false),
        code => {
            run.warn_output(&answer).await?;
            Err(messages::cannot_tell(&run.names(), agent.name(), code))
        }
    }
}

/// The agents, among those that start, that hold a name the record does not list.
async fn agents_in_the_way(
    run: &ChildRun<'_>,
    started: &[Agent],
    recorded: &HashMap<Agent, Option<RecordedRegistration>>,
) -> Result<HashSet<Agent>, Error> {
    let mut held = HashSet::new();
    for agent in started {
        let unrecorded = recorded.get(agent).is_none_or(Option::is_none);
        if unrecorded && holds_name(run, *agent).await? {
            held.insert(*agent);
        }
    }
    Ok(held)
}

/// Refuses without `--force` when an agent holds a name in the way.
async fn refuse_name_in_the_way(
    run: &ChildRun<'_>,
    started: &[Agent],
    held: &HashSet<Agent>,
    force: bool,
) -> Result<(), Error> {
    if force {
        return Ok(());
    }
    for agent in started.iter().filter(|agent| held.contains(agent)) {
        run.out
            .warn(&messages::held_name(&run.names(), agent.name()))
            .await?;
    }
    if !held.is_empty() {
        return Err(messages::in_the_way(&run.names()));
    }
    Ok(())
}

/// Writes the agent's plugin's file back to what is known to be registered after a failed `add`:
/// the registration recorded before the run, or no file when it recorded none or when `claude`'s
/// `remove` already took it away.
fn restore_record(registering: &Registering<'_>, removed: bool) -> Result<(), Error> {
    let file = registering.file();
    match registering.recorded {
        Some(recorded) if !removed => {
            file.write_committed_registration(&recorded.name, &recorded.command)?;
        }
        _ => file.delete()?,
    }
    Ok(())
}

/// Runs `claude`'s `remove` before its `add` when the record lists the registration or `--force`
/// replaces one, and says whether it exited 0. A `remove` that fails falls through to `add`. A
/// registration the record did not list that the `remove` took away is reported as replaced.
async fn remove_first(
    run: &ChildRun<'_>,
    registering: &Registering<'_>,
    force: bool,
) -> Result<bool, Error> {
    let agent = registering.agent;
    if agent != Agent::Claude || (registering.recorded.is_none() && !force) {
        return Ok(false);
    }
    let removed = run
        .call(agent, agent.remove(&run.registration))
        .await?
        .succeeded();
    if removed && registering.recorded.is_none() {
        run.out
            .info(&messages::replaced(&run.names(), agent.name()))
            .await?;
    }
    Ok(removed)
}

/// Registers with one agent, or fails with its output and the record restored.
async fn register_with(
    run: &ChildRun<'_>,
    registering: &Registering<'_>,
    force: bool,
) -> Result<(), Error> {
    let agent = registering.agent;
    let file = registering.file();
    file.write_pending_registration(
        &run.registration,
        registering
            .recorded
            .map(|recorded| recorded.command.as_slice()),
        Some(registering.command),
    )?;
    let removed = remove_first(run, registering, force).await?;
    let answer: Answer = run
        .call(agent, agent.add(&run.registration, registering.command))
        .await?;
    if answer.succeeded() {
        file.write_committed_registration(&run.registration, registering.command)?;
        return run
            .out
            .success(&messages::registered(
                &run.names(),
                agent.name(),
                registering.command,
            ))
            .await;
    }
    run.warn_output(&answer).await?;
    restore_record(registering, removed)?;
    Err(messages::add_failed(
        &run.names(),
        agent.name(),
        answer.code(),
    ))
}

/// The build note of a build that is not distributed, none for a distributed one.
async fn note_build(run: &ChildRun<'_>) -> Result<(), Error> {
    let note = match run.host.release.build {
        Build::Distributed => return Ok(()),
        Build::Development => BuildNote::Development,
        Build::Source => BuildNote::Source,
    };
    // A Rust source build is a compiled binary, so the reference's runtime-flags note has no
    // flags to warn about.
    run.out.info(&messages::build_note(run.name, note)).await?;
    Ok(())
}

/// `install`: the checks, in order, before any program starts, then each agent in table order
/// registered, or skipped when it cannot start, then the build note.
pub(super) async fn install_registrations(
    run: &ChildRun<'_>,
    request: &InstallRequest,
) -> Result<(), Error> {
    run.refuse_windows(Child::Install)?;
    let command = command_line(run.host);
    if command
        .iter()
        .any(|word| word.chars().any(char::is_control))
    {
        return Err(messages::control_character(run.name));
    }
    let record = run.record_directory()?;
    let agents = selected_agents(request.agent);
    let recorded = run.read_records(&record, &agents, Child::Install)?;
    let started = started_agents(run, &agents, request.agent).await?;
    let held = agents_in_the_way(run, &started, &recorded).await?;
    refuse_name_in_the_way(run, &started, &held, request.force).await?;
    for agent in &agents {
        if !started.contains(agent) {
            run.out.info(&messages::skipped(agent.name())).await?;
            continue;
        }
        if held.contains(agent) {
            run.out
                .info(&messages::replaced(&run.names(), agent.name()))
                .await?;
        }
        let registering = Registering {
            agent: *agent,
            record: &record,
            recorded: recorded.get(agent).and_then(Option::as_ref),
            command: &command,
        };
        register_with(run, &registering, request.force).await?;
    }
    note_build(run).await
}
