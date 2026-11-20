/*
 * What `install` and `uninstall` share: the run a child acts on, the checks made before any
 * program starts, the plugin's files read, each logged at trace, the agent output a failure repeats,
 * and the `Program run.` event of an agent call that changed a registration.
 */
import { escapeControlCharacters, FatalError } from '@loomcli/core';
import type { Host, Log, Phrase } from '@loomcli/core';

import { recordDirectory } from '../application-folders.js';
import { programRun } from '../change-events.js';
import { readRegistration, removeStagingOfPluginFile } from '../installation/files.js';
import { pluginFilePath } from '../installation/record.js';
import type { RecordedRegistration } from '../installation/record.js';
import { recordName } from './agents.js';
import type { Agent } from './agents.js';
import type { Child, Names } from './messages.js';
import { mcpPhrase } from './phrases.js';
import { callAgent, registrationName } from './registration.js';
import type { Answer } from './registration.js';

/** What a child reads from its action: the application, the run, and the lanes it writes. */
interface ChildRun {
  readonly name: string;
  readonly host: Host;
  readonly signal: AbortSignal;
  /** The action's log, which records each file the child writes or removes. */
  readonly log: Log;
  readonly info: (message: string | Phrase) => Promise<void>;
  readonly success: (message: string | Phrase) => Promise<void>;
  readonly warn: (message: string | Phrase) => Promise<void>;
}

/** One agent a child acts on: the run, the agent, its record's directory, and what its file records. */
interface Target {
  readonly run: ChildRun;
  readonly agent: Agent;
  readonly record: string;
  readonly recorded: RecordedRegistration | undefined;
}

/** What each agent's plugin's file records, none for an agent whose file lists no registration. */
type Recorded = ReadonlyMap<Agent, RecordedRegistration | undefined>;

/** The agents a child may read the plugin's file of, and the child that reads them. */
interface Reading {
  readonly record: string;
  readonly agents: readonly Agent[];
  readonly child: Child;
}

/** The code of a call that succeeded, and the count of an empty set. */
const succeeded = 0;
const none = 0;

/** Whether a call exited 0. */
function succeededAt(answer: Answer): boolean {
  return answer.kind === 'exited' && answer.code === succeeded;
}

/** The names a sentence of the run uses. */
function namesOf(run: ChildRun): Names {
  return { app: run.name, registration: registrationName(run.name) };
}

/** Refuses a child on `win32`, before it reads anything. */
function refuseWindows(run: ChildRun, child: Child): void {
  if (run.host.platform === 'win32') {
    throw new FatalError(mcpPhrase('registersNotOnWindows', run.name, child));
  }
}

/** The registration one agent's plugin's file records, logged at trace once read, or its refusal. */
async function readRecord(
  run: ChildRun,
  { child, record }: Reading,
  agent: Agent,
): Promise<RecordedRegistration | undefined> {
  const plugin = recordName(agent);
  const read = readRegistration({ plugin, record });
  if (read.status === 'refused') {
    throw new FatalError(mcpPhrase('recordUnreadable', run.name, read.refused.path, child));
  }
  run.log.trace(mcpPhrase('checkedRecordFile'), { path: pluginFilePath(record, plugin) });
  return read.registration;
}

/**
 * The registration each agent's plugin's file records, or the refusal of one it cannot read. Each
 * file read, there or not, is logged at trace; a refused one is named by its failure. Once every file
 * reads, the staging files a killed write left beside them are removed.
 */
async function readRecords(run: ChildRun, reading: Reading): Promise<Recorded> {
  const { agents, record } = reading;
  const recorded = new Map<Agent, RecordedRegistration | undefined>();
  for (const agent of agents) {
    recorded.set(agent, await readRecord(run, reading, agent));
  }
  for (const agent of agents) {
    removeStagingOfPluginFile({ log: run.log, plugin: recordName(agent), record });
  }
  return recorded;
}

/** The record's directory, or the refusal of an environment that cannot name one. */
function recordOf(run: ChildRun): string {
  return recordDirectory(run.name, run.host);
}

/** Whether the agent's CLI starts, whatever its exit code. */
async function starts(run: ChildRun, agent: Agent): Promise<boolean> {
  const answer = await callAgent(run, agent.name, agent.version);
  return answer.kind === 'exited';
}

/** One agent call that changes a registration: the agent, the words it passed, and its answer. */
interface AgentChange {
  readonly agent: Agent;
  readonly words: readonly string[];
  readonly answer: Answer;
}

/**
 * Records `Program run.` for an agent's `mcp add` or `mcp remove` that exited 0. The words are the
 * registration name and `host.program`, so the event carries no secret.
 */
function recordChange(run: ChildRun, { agent, answer, words }: AgentChange): void {
  if (succeededAt(answer)) {
    programRun(run.log, { arguments: words, code: succeeded, program: agent.name });
  }
}

/**
 * Runs an agent call that changes a registration, records it when it exits 0, and answers it.
 */
async function changeAgent(run: ChildRun, agent: Agent, words: readonly string[]): Promise<Answer> {
  const answer = await callAgent(run, agent.name, words);
  recordChange(run, { agent, answer, words });
  return answer;
}

/** The lines of a call's captured standard error and then its standard output, none of them empty. */
function outputLines(answer: Answer): readonly string[] {
  if (answer.kind === 'unstarted') {
    return [];
  }
  return [answer.stderr, answer.stdout]
    .flatMap((text) => text.split(/\r\n|[\n\r]/u))
    .filter((line) => line.trim() !== '');
}

/** Prints the agent's captured output through `out.warn`, one line each. */
async function warnOutput(run: ChildRun, answer: Answer): Promise<void> {
  for (const line of outputLines(answer)) {
    await run.warn(escapeControlCharacters(line));
  }
}

export type { ChildRun, Recorded, Target };
export {
  namesOf,
  none,
  changeAgent,
  readRecords,
  recordOf,
  refuseWindows,
  starts,
  succeeded,
  succeededAt,
  warnOutput,
};
