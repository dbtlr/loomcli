/*
 * `mcp install`: registers this application's server with each selected agent's own CLI, and
 * records each registration in the agent's plugin's file around the call that writes it.
 */
import { holdsControlCharacter } from '../control-character.js';
import {
  deletePluginFile,
  writeCommittedRegistration,
  writePendingRegistration,
} from '../installation/files.js';
import { recordName, selectedAgents } from './agents.js';
import type { Agent, AgentName } from './agents.js';
import { lines, refusals } from './messages.js';
import { callAgent, commandLine } from './registration.js';
import type { Answer } from './registration.js';
import {
  namesOf,
  none,
  readRecords,
  recordOf,
  refuseWindows,
  starts,
  succeeded,
  succeededAt,
  warnOutput,
} from './run.js';
import type { ChildRun, Recorded, Target } from './run.js';

/** What `install` was asked: the agent it is limited to, and whether it replaces a name in the way. */
interface InstallRequest {
  readonly agent: AgentName | undefined;
  readonly force: boolean;
}

/** One agent's registration: its target and the command line it will hold. */
interface Registering extends Target {
  readonly command: readonly string[];
}

/** The code `codex mcp get` answers for a name it does not hold. */
const notHeld = 1;

/** The code an `exited` answer holds, and none for a call that could not start. */
function codeOf(answer: Answer): number | undefined {
  return answer.kind === 'exited' ? answer.code : undefined;
}

/** The agents whose CLI starts, in table order. */
async function startedAmong(run: ChildRun, selected: readonly Agent[]): Promise<readonly Agent[]> {
  const started: Agent[] = [];
  for (const agent of selected) {
    if (await starts(run, agent)) {
      started.push(agent);
    }
  }
  return started;
}

/**
 * The agents whose CLI starts, in table order. An agent that cannot start fails the child when
 * `--agent` named it, and is skipped otherwise, which fails the child when none starts.
 */
async function startedAgents(
  run: ChildRun,
  selected: readonly Agent[],
  named: AgentName | undefined,
): Promise<readonly Agent[]> {
  const started = await startedAmong(run, selected);
  if (started.length === none) {
    throw named === undefined ? refusals.noAgent(run.name) : refusals.agentMissing(run.name, named);
  }
  return started;
}

/**
 * Whether the agent holds the name though the record lists none. Only an agent with a name check
 * is asked; any answer but exit 0 or 1, and a check that cannot start, fails with nothing written.
 */
async function holdsName(run: ChildRun, agent: Agent): Promise<boolean> {
  const names = namesOf(run);
  if (agent.nameCheck === undefined) {
    return false;
  }
  const answer = await callAgent(run, agent.name, agent.nameCheck(names.registration));
  if (answer.kind === 'exited' && (answer.code === succeeded || answer.code === notHeld)) {
    return answer.code === succeeded;
  }
  await warnOutput(run, answer);
  throw refusals.cannotTell(names, agent.name, codeOf(answer));
}

/** The agents, among those that start, that hold a name the record does not list. */
async function agentsInTheWay(
  run: ChildRun,
  started: readonly Agent[],
  recorded: Recorded,
): Promise<ReadonlySet<Agent>> {
  const held = new Set<Agent>();
  for (const agent of started) {
    if (recorded.get(agent) === undefined && (await holdsName(run, agent))) {
      held.add(agent);
    }
  }
  return held;
}

/** Refuses without `--force` when an agent holds a name in the way. */
async function refuseNameInTheWay(
  run: ChildRun,
  held: ReadonlySet<Agent>,
  force: boolean,
): Promise<void> {
  if (force) {
    return;
  }
  for (const agent of held) {
    await run.warn(lines.heldName(namesOf(run), agent.name));
  }
  if (held.size > none) {
    throw refusals.inTheWay(namesOf(run));
  }
}

/**
 * Writes the agent's plugin's file back to what is known to be registered after a failed `add`:
 * the registration recorded before the run, or no file when it recorded none or when `claude`'s
 * `remove` already took it away.
 */
function restoreRecord({ agent, record, recorded }: Registering, removed: boolean): void {
  const plugin = recordName(agent);
  if (recorded === undefined || removed) {
    deletePluginFile({ plugin, record });
    return;
  }
  writeCommittedRegistration({ ...recorded, plugin, record });
}

/** Writes the agent's plugin's file pending: the command line it held, and the one it will hold. */
function recordPending({ agent, command, record, recorded, run }: Registering): void {
  writePendingRegistration({
    intended: command,
    name: namesOf(run).registration,
    plugin: recordName(agent),
    prior: recorded?.command,
    record,
  });
}

/**
 * Runs `claude`'s `remove` before its `add` when the record lists the registration or `--force`
 * replaces one, and says whether it exited 0. A `remove` that fails falls through to `add`. A
 * registration the record did not list that the `remove` took away is reported as replaced.
 */
async function removeFirst(registering: Registering, force: boolean): Promise<boolean> {
  const { agent, recorded, run } = registering;
  if (agent.name !== 'claude' || (recorded === undefined && !force)) {
    return false;
  }
  const names = namesOf(run);
  const removed = succeededAt(await callAgent(run, agent.name, agent.remove(names.registration)));
  if (removed && recorded === undefined) {
    await run.info(lines.replaced(names, agent.name));
  }
  return removed;
}

/** Commits the registration the agent now holds, and says so. */
async function commit({ agent, command, record, run }: Registering): Promise<void> {
  const names = namesOf(run);
  writeCommittedRegistration({
    command,
    name: names.registration,
    plugin: recordName(agent),
    record,
  });
  await run.success(lines.registered(names, agent.name, command));
}

/** Fails a registration whose `add` failed: the agent's output, the record restored, the correction. */
async function failAdd(registering: Registering, answer: Answer, removed: boolean): Promise<never> {
  await warnOutput(registering.run, answer);
  restoreRecord(registering, removed);
  throw refusals.addFailed(namesOf(registering.run), registering.agent.name, codeOf(answer));
}

/** Registers with one agent, or fails with its output and the record restored. */
async function registerWith(registering: Registering, force: boolean): Promise<void> {
  const { agent, command, run } = registering;
  recordPending(registering);
  const removed = await removeFirst(registering, force);
  const answer = await callAgent(run, agent.name, agent.add(namesOf(run).registration, command));
  if (succeededAt(answer)) {
    await commit(registering);
    return;
  }
  await failAdd(registering, answer, removed);
}

/** The build note of a build that is not distributed, none for a distributed one. */
async function noteBuild(run: ChildRun): Promise<void> {
  const { build } = run.host.release;
  if (build === 'distributed') {
    return;
  }
  await run.info(lines.buildNote(run.name, build));
  if (build === 'source') {
    await run.info(lines.runtimeFlags);
  }
}

/** The checks `install` makes, in order, before it starts any program. */
function checkFirst(run: ChildRun, named: AgentName | undefined) {
  refuseWindows(run, 'install');
  const command = commandLine(run.host);
  if (command.some(holdsControlCharacter)) {
    throw refusals.controlCharacter(run.name);
  }
  const record = recordOf(run);
  const agents = selectedAgents(named);
  return {
    agents,
    command,
    record,
    recorded: readRecords(run, { agents, child: 'install', record }),
  };
}

/** Registers with one agent that starts, and says first that it replaces a name in the way. */
async function registerStarted(
  registering: Registering,
  held: ReadonlySet<Agent>,
  force: boolean,
): Promise<void> {
  if (held.has(registering.agent)) {
    await registering.run.info(lines.replaced(namesOf(registering.run), registering.agent.name));
  }
  await registerWith(registering, force);
}

/** `install`: the checks, then each agent in table order registered, or skipped when it cannot start. */
async function installRegistrations(run: ChildRun, request: InstallRequest): Promise<void> {
  const { agents, command, record, recorded } = checkFirst(run, request.agent);
  const started = await startedAgents(run, agents, request.agent);
  const held = await agentsInTheWay(run, started, recorded);
  await refuseNameInTheWay(run, held, request.force);
  for (const agent of agents) {
    await (started.includes(agent)
      ? registerStarted(
          { agent, command, record, recorded: recorded.get(agent), run },
          held,
          request.force,
        )
      : run.info(lines.skipped(agent.name)));
  }
  await noteBuild(run);
}

export { installRegistrations };
export type { InstallRequest };
