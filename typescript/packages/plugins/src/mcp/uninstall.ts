/*
 * `mcp uninstall`: removes the registration of each agent whose plugin's file records one, through
 * the agent's own CLI, and deletes the file whatever the agent answers, except a removal the run
 * signal ends, which leaves the file pending.
 */
import { FatalError } from '@loomcli/core';

import { deletePluginFile, writePendingRegistration } from '../installation/files.js';
import type { RecordedRegistration } from '../installation/record.js';
import { recordName, selectedAgents } from './agents.js';
import type { Agent, AgentName } from './agents.js';
import { mcpPhrase } from './phrases.js';
import {
  namesOf,
  none,
  changeAgent,
  readRecords,
  recordOf,
  refuseWindows,
  starts,
  succeededAt,
  warnOutput,
} from './run.js';
import type { ChildRun, Target } from './run.js';

/** An agent whose file records a registration. */
interface RecordedTarget extends Target {
  readonly recorded: RecordedRegistration;
}

/** Removes one recorded registration, deletes its file, and says what the agent answered. */
async function removeFrom({ agent, record, recorded, run }: RecordedTarget): Promise<void> {
  const names = namesOf(run);
  const plugin = recordName(agent);
  writePendingRegistration({
    intended: undefined,
    log: run.log,
    name: names.registration,
    plugin,
    prior: recorded.command,
    record,
  });
  const answer = await changeAgent(run, agent, agent.remove(names.registration));
  deletePluginFile({ log: run.log, plugin, record });
  if (succeededAt(answer)) {
    await run.success(mcpPhrase('removedRegistration', names, agent.name));
    return;
  }
  await warnOutput(run, answer);
  await run.info(mcpPhrase('noLongerRecorded', names, agent.name));
}

/** The agents whose plugin's file records a registration, in table order. */
async function recordedTargets(
  run: ChildRun,
  record: string,
  selected: readonly Agent[],
): Promise<readonly RecordedTarget[]> {
  const recorded = await readRecords(run, { agents: selected, child: 'uninstall', record });
  return selected.flatMap((agent) => {
    const registration = recorded.get(agent);
    return registration === undefined ? [] : [{ agent, record, recorded: registration, run }];
  });
}

/** Removes each target whose CLI starts and answers the names of those that do not. */
async function removeEach(
  run: ChildRun,
  targets: readonly RecordedTarget[],
): Promise<readonly string[]> {
  const unstarted: string[] = [];
  for (const target of targets) {
    if (await starts(run, target.agent)) {
      await removeFrom(target);
    } else {
      unstarted.push(target.agent.name);
      await run.warn(mcpPhrase('staysRegistered', namesOf(run), target.agent.name));
    }
  }
  return unstarted;
}

/** `uninstall`: the checks, then each recorded agent removed in table order. */
async function uninstallRegistrations(run: ChildRun, named: AgentName | undefined): Promise<void> {
  refuseWindows(run, 'uninstall');
  const targets = await recordedTargets(run, recordOf(run), selectedAgents(named));
  if (targets.length === none) {
    await run.success(mcpPhrase('nothingToRemove', namesOf(run), named));
    return;
  }
  const unstarted = await removeEach(run, targets);
  if (unstarted.length > none) {
    throw new FatalError(mcpPhrase('uninstallIncomplete', namesOf(run), unstarted));
  }
}

export { uninstallRegistrations };
