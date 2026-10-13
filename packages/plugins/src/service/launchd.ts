import { basename, join } from 'node:path';

import { unknownReading } from './backend.js';
import type { Backend, Reading, Service } from './backend.js';
import { expectCall, pause, run, succeeded } from './manager.js';
import type { Answer, Call } from './manager.js';
import { notes } from './messages.js';
import { launchdPlist } from './unit.js';

/** `launchctl`'s code for a service or domain that is not loaded. */
const notLoaded = 113;

/** `bootout`'s code for a service with no such process, which is not loaded. */
const noSuchProcess = 3;

/** `bootout`'s code for an unload already in progress. */
const inProgress = 36;

/** `bootout`'s codes that are no failure: not loaded, and an unload already in progress. */
const unloaded = [succeeded, noSuchProcess, inProgress, notLoaded];

/** How long the unload wait pauses between two `print` calls, with no deadline. */
const pollInterval = 250;

/** The plist's file extension. */
const extension = '.plist';

/** The user's launchd domain. */
function domain(service: Service): string {
  return `gui/${service.uid}`;
}

/** The launchd service target of one label in the user's domain. */
function target(service: Service, label: string): string {
  return `${domain(service)}/${label}`;
}

/** One `launchctl` call about `label`, its failure pointing at that service's own report. */
function launchctl(service: Service, label: string, ...args: string[]): Call {
  return { args, program: 'launchctl', report: `launchctl print ${target(service, label)}` };
}

/** Whether `label`'s agent is loaded: `print` exits 0 when it is and 113 when it is not. */
async function isLoaded(service: Service, label: string): Promise<boolean> {
  const call = launchctl(service, label, 'print', target(service, label));
  const { code } = await expectCall(service.manager, call, [succeeded, notLoaded]);
  return code === succeeded;
}

/**
 * Unloads `label`'s agent, then polls `print` every 250 milliseconds until it is not loaded, with no
 * deadline; the run signal ends the wait.
 */
async function unload(service: Service, label: string): Promise<void> {
  const call = launchctl(service, label, 'bootout', target(service, label));
  await expectCall(service.manager, call, unloaded);
  while (await isLoaded(service, label)) {
    await pause(pollInterval, service.manager.signal);
  }
}

/** Loads the plist at the unit's path into the user's domain. */
async function bootstrap(service: Service): Promise<void> {
  const call = launchctl(service, service.label, 'bootstrap', domain(service), service.unit);
  await expectCall(service.manager, call);
}

/** Runs `kickstart` on the label's agent, with `-k` to kill a running process first. */
async function kickstart(service: Service, ...flags: string[]): Promise<void> {
  const call = launchctl(
    service,
    service.label,
    'kickstart',
    ...flags,
    target(service, service.label),
  );
  await expectCall(service.manager, call);
}

/** Kickstarts a loaded agent with `flags`, or bootstraps one that is not loaded. */
async function kickstartOrBootstrap(service: Service, ...flags: string[]): Promise<void> {
  await ((await isLoaded(service, service.label))
    ? kickstart(service, ...flags)
    : bootstrap(service));
}

/** The members of `print`'s top level, one tab in, by name. */
function topLevel(stdout: string): ReadonlyMap<string, string> {
  const members = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const member = /^\t(?<name>[^\t=]+?) = (?<value>.*)$/u.exec(line)?.groups;
    if (member?.name !== undefined && member.value !== undefined && !members.has(member.name)) {
      members.set(member.name, member.value.trim());
    }
  }
  return members;
}

/**
 * The state of a loaded agent from `print`'s top level: its `state` line, running when that state
 * is `running` or a `pid` line of digits is there, and that pid.
 */
function readPrinted(stdout: string): Omit<Reading, 'notes'> {
  const members = topLevel(stdout);
  const state = members.get('state') ?? 'unknown';
  const digits = members.get('pid');
  const pid = digits !== undefined && /^\d+$/u.test(digits) ? Number(digits) : undefined;
  const running = state === 'running' || pid !== undefined;
  return pid === undefined ? { running, state } : { pid, running, state };
}

/** The note a domain with no login session adds, or none for any other answer. */
async function sessionNotes(service: Service): Promise<readonly string[]> {
  const answer = await run(service.manager, {
    args: ['print', domain(service)],
    program: 'launchctl',
    report: '',
  });
  return answer.kind === 'exited' && answer.code === notLoaded
    ? [notes.noSession(service.label)]
    : [];
}

/** The note of a `print` call that could not report the agent. */
function unreadableNote(service: Service, name: string, answer: Answer): string {
  if (answer.kind === 'missing') {
    return notes.missing(service.manager.name, 'launchctl');
  }
  const call = { manager: 'launchctl', report: `launchctl print ${name}`, target: name };
  return notes.unreadable(call, answer.code);
}

/** The state `print` reports for the label's agent, and the session note for an installed one. */
async function read(service: Service, installed: boolean): Promise<Reading> {
  const name = target(service, service.label);
  const answer = await run(service.manager, launchctl(service, service.label, 'print', name));
  const session = installed ? await sessionNotes(service) : [];
  if (answer.kind === 'exited' && answer.code === notLoaded) {
    return { notes: session, running: false, state: installed ? 'not loaded' : 'not installed' };
  }
  return answer.kind === 'exited' && answer.code === succeeded
    ? { ...readPrinted(answer.stdout), notes: session }
    : unknownReading(unreadableNote(service, name, answer), session);
}

/** The launchd backend: `launchctl` in the user's `gui/<uid>` domain. */
const launchd: Backend = {
  afterRemoval: async () => {},
  install: async (service, written) => {
    const call = launchctl(service, service.label, 'enable', target(service, service.label));
    await expectCall(service.manager, call);
    if (written) {
      await unload(service, service.label);
      await bootstrap(service);
    } else {
      await kickstartOrBootstrap(service, '-k');
    }
  },
  read,
  render: launchdPlist,
  restart: (service) => kickstartOrBootstrap(service, '-k'),
  retire: (service, path) => unload(service, basename(path, extension)),
  start: (service) => kickstartOrBootstrap(service),
  stop: (service) => unload(service, service.label),
  unitPath: (label, home) => join(home, 'Library', 'LaunchAgents', `${label}${extension}`),
};

export { launchd, readPrinted };
