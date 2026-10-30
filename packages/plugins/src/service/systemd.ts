import { basename, isAbsolute, join } from 'node:path';

import { observe } from '../installation/disk.js';
import { unknownReading } from './backend.js';
import type { Backend, Reading, Service } from './backend.js';
import { expectCall, readCall, readLimitSeconds, succeeded } from './manager.js';
import type { Call, Read } from './manager.js';
import { notes } from './messages.js';
import { systemdUnit } from './unit.js';

/** `systemctl stop`'s code for a unit that is not loaded. */
const notLoaded = 5;

/** The unit name systemd knows the label's unit by. */
function unitName(label: string): string {
  return `${label}.service`;
}

/** The command whose report a failure about `name` points at. */
function statusCommand(name: string): string {
  return `systemctl --user status ${name}`;
}

/** One `systemctl --user` call, its failure pointing at the status of `name`. */
function systemctl(name: string, ...args: string[]): Call {
  return { args: ['--user', ...args], program: 'systemctl', report: statusCommand(name) };
}

/** Reloads the manager's units, its failure pointing at the label's unit. */
async function reload(service: Service): Promise<void> {
  await expectCall(service.manager, systemctl(unitName(service.label), 'daemon-reload'));
}

/** Runs one `systemctl --user` call about the label's unit. */
async function unitCall(service: Service, verb: string): Promise<void> {
  const name = unitName(service.label);
  await expectCall(service.manager, systemctl(name, verb, name));
}

/** The unit's path: `<config>/systemd/user/<label>.service`. */
function unitPath(label: string, home: string, env: Readonly<Record<string, string | undefined>>) {
  const configured = env.XDG_CONFIG_HOME;
  const config =
    configured !== undefined && isAbsolute(configured) ? configured : join(home, '.config');
  return join(config, 'systemd', 'user', unitName(label));
}

/** The values one `systemctl show` output holds, by property name. */
function shownProperties(stdout: string): ReadonlyMap<string, string> {
  const properties = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const property = /^(?<key>[^=]+)=(?<value>.*)$/u.exec(line)?.groups;
    if (property?.key !== undefined && property.value !== undefined) {
      properties.set(property.key, property.value.trim());
    }
  }
  return properties;
}

/**
 * The state one `show --property=ActiveState,MainPID` output reads: the `ActiveState` value, running
 * when it is `active` with a `MainPID` above 0, and that pid. A unit with no file that is inactive
 * reads not installed.
 */
function readShown(stdout: string, installed: boolean): Omit<Reading, 'notes'> {
  const properties = shownProperties(stdout);
  const active = properties.get('ActiveState') ?? 'unknown';
  const mainPid = properties.get('MainPID') ?? '';
  const pid = /^[1-9]\d*$/u.test(mainPid) ? Number(mainPid) : undefined;
  if (!installed && active === 'inactive') {
    return { running: false, state: 'not installed' };
  }
  const running = active === 'active' && pid !== undefined;
  return pid === undefined ? { running, state: active } : { pid, running, state: active };
}

/** The note `Linger=no` adds, or none for any other answer. */
async function lingerNotes(service: Service): Promise<readonly string[]> {
  const answer = await readCall(service.manager, {
    args: ['show-user', String(service.uid), '--property=Linger'],
    program: 'loginctl',
    report: '',
  });
  const lingering = answer.kind === 'exited' && answer.code === succeeded;
  return lingering && shownProperties(answer.stdout).get('Linger') === 'no'
    ? [notes.linger(service.label)]
    : [];
}

/** The note of a `show` call that could not report the unit. */
function unreadableNote(service: Service, name: string, answer: Read): string {
  if (answer.kind === 'missing') {
    return notes.missing(service.manager.name, 'systemctl');
  }
  const call = { manager: 'systemctl --user', report: statusCommand(name), target: name };
  return answer.kind === 'timedOut'
    ? notes.timedOut(call, readLimitSeconds)
    : notes.unreadable(call, answer.code);
}

/** The manager's state of the label's unit, and the session note for an installed one. */
async function read(service: Service, installed: boolean): Promise<Reading> {
  const name = unitName(service.label);
  const call = systemctl(name, 'show', name, '--property=ActiveState,MainPID');
  const answer = await readCall(service.manager, call);
  const session = installed ? await lingerNotes(service) : [];
  return answer.kind === 'exited' && answer.code === succeeded
    ? { ...readShown(answer.stdout, installed), notes: session }
    : unknownReading(unreadableNote(service, name, answer), session);
}

/** The systemd backend: `systemctl --user` for the unit, and `loginctl` for lingering. */
const systemd: Backend = {
  afterRemoval: reload,
  install: async (service, written) => {
    if (written) {
      await reload(service);
    }
    await unitCall(service, 'enable');
    await unitCall(service, 'restart');
  },
  read,
  render: systemdUnit,
  restart: (service) => unitCall(service, 'restart'),
  retire: async (service, path) => {
    const name = basename(path);
    await expectCall(service.manager, systemctl(name, 'stop', name), [succeeded, notLoaded]);
    if (observe(path).kind !== 'absent') {
      await expectCall(service.manager, systemctl(name, 'disable', name));
    }
  },
  start: (service) => unitCall(service, 'start'),
  stop: (service) => unitCall(service, 'stop'),
  unitPath,
};

export { readShown, systemd };
