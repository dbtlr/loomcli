//! `mcp uninstall`: removes the registration of each agent whose plugin's file records one,
//! through the agent's own CLI, and deletes the file whatever the agent answers, except a removal
//! the run signal ends, which leaves the file pending.

use std::path::Path;

use loomcli_core::{Error, FatalError};

use super::messages::{self, Child};
use super::registration::{Agent, ChildRun, selected_agents};
use crate::installation::{PluginRecord, RecordedRegistration};

/// Removes one recorded registration, deletes its file, and says what the agent answered.
async fn remove_from(
    run: &ChildRun<'_>,
    record: &Path,
    agent: Agent,
    recorded: &RecordedRegistration,
) -> Result<(), Error> {
    let file = PluginRecord::new(record, agent.record_name()).with_log(run.log);
    file.write_pending_registration(&run.registration, Some(&recorded.command), None)?;
    let answer = run.change(agent, agent.remove(&run.registration)).await?;
    file.delete()?;
    if answer.succeeded() {
        return run
            .out
            .success(&messages::removed(&run.names(), agent.name()))
            .await;
    }
    run.warn_output(&answer).await?;
    run.out
        .info(&messages::no_longer_recorded(&run.names(), agent.name()))
        .await
}

/// `uninstall`: the checks, then each recorded agent removed in table order. A recorded agent that
/// cannot start keeps its file and fails the child once every other agent is done.
pub(super) async fn uninstall_registrations(
    run: &ChildRun<'_>,
    named: Option<Agent>,
) -> Result<(), Error> {
    run.refuse_windows(Child::Uninstall)?;
    let record = run.record_directory()?;
    let selected = selected_agents(named);
    let mut recorded = run.read_records(&record, &selected, Child::Uninstall)?;
    let targets: Vec<(Agent, RecordedRegistration)> = selected
        .iter()
        .filter_map(|agent| {
            recorded
                .remove(agent)
                .flatten()
                .map(|registration| (*agent, registration))
        })
        .collect();
    if targets.is_empty() {
        return run
            .out
            .success(&messages::nothing_to_remove(
                &run.names(),
                named.map(Agent::name),
            ))
            .await;
    }
    let mut unstarted = Vec::new();
    for (agent, registration) in &targets {
        if run.starts(*agent).await? {
            remove_from(run, &record, *agent, registration).await?;
        } else {
            unstarted.push(agent.name());
            run.out
                .warn(&messages::stays_registered(&run.names(), agent.name()))
                .await?;
        }
    }
    if !unstarted.is_empty() {
        return Err(
            FatalError::new(messages::uninstall_incomplete(&run.names(), &unstarted)).into(),
        );
    }
    Ok(())
}
