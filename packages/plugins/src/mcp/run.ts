/*
 * What `install` and `uninstall` share: the run a child acts on, the checks made before any
 * program starts, the plugin's files read, and the agent output a failure repeats.
 */
import type { Host } from '@loomcli/core';

import { recordDirectory } from '../application-folders.js';
import { readRegistration } from '../installation/files.js';
import type { RecordedRegistration } from '../installation/record.js';
import { recordName } from './agents.js';
import type { Agent } from './agents.js';
import { refusals, shown } from './messages.js';
import type { Child, Names } from './messages.js';
import { callAgent, registrationName } from './registration.js';
import type { Answer } from './registration.js';

/** What a child reads from its action: the application, the run, and the lanes it writes. */
interface ChildRun {
  readonly name: string;
  readonly host: Host;
  readonly signal: AbortSignal;
  readonly info: (message: string) => Promise<void>;
  readonly success: (message: string) => Promise<void>;
  readonly warn: (message: string) => Promise<void>;
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

/** The names a sentence of the run uses. */
function namesOf(run: ChildRun): Names {
  return { app: run.name, registration: registrationName(run.name) };
}

/** Refuses a child on `win32`, before it reads anything. */
function refuseWindows(run: ChildRun, child: Child): void {
  if (run.host.platform === 'win32') {
    throw refusals.notOnWindows(run.name, child);
  }
}

/** The registration each agent's plugin's file records, or the refusal of one it cannot read. */
function readRecords(run: ChildRun, { agents, child, record }: Reading): Recorded {
  const recorded = new Map<Agent, RecordedRegistration | undefined>();
  for (const agent of agents) {
    const read = readRegistration({ plugin: recordName(agent), record });
    if (read.status === 'refused') {
      throw refusals.record(run.name, read.refused.path, child);
    }
    recorded.set(agent, read.registration);
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
    await run.warn(shown(line));
  }
}

export type { ChildRun, Recorded, Target };
export { namesOf, readRecords, recordOf, refuseWindows, starts, warnOutput };
