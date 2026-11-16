/*
 * The operator sentences of the service plugin, under ADR-0164: the failures its children raise,
 * the lines they write about their work, and the notes `service status` adds about a state it
 * could not read or the user's session. Each is a function of the values it repeats, or a constant,
 * and the code that raises the failure or writes the line calls it. `tests/message-voice.test.ts`
 * holds this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

/** Every path, label, and program name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/**
 * The child whose refusal a sentence names.
 *
 * @example
 * ```ts
 * const child: Child = 'uninstall';
 * ```
 */
type Child = 'install' | 'uninstall';

/**
 * The failure of an install from a build that would not outlive the service.
 *
 * @example
 * ```ts
 * serviceFromBuild('notes', 'development');
 * ```
 */
function serviceFromBuild(name: string, build: string): string {
  return `${shown(name)} is ${build === 'development' ? 'a development build' : 'a source build'}, so it cannot install a service that would outlive it. Build it with loom build, then run the built ${shown(name)} service install.`;
}

/**
 * The failure of an install over a unit someone changed since install wrote it.
 *
 * @example
 * ```ts
 * unitChanged('notes', '/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function unitChanged(name: string, path: string): string {
  return `${shownPath(path)} changed since ${shown(name)} service install wrote it, so install leaves it alone. Remove it, then run ${shown(name)} service install again.`;
}

/**
 * The failure of an install whose path or description holds a control character.
 *
 * @example
 * ```ts
 * unitHoldsControl('notes');
 * ```
 */
function unitHoldsControl(name: string): string {
  return `${shown(name)} cannot write its service unit because a path or its description holds a control character. Install ${shown(name)} where its path has none.`;
}

/**
 * The failure of a `HOME` that is not an absolute path.
 *
 * @example
 * ```ts
 * unitHomeNotAbsolute('notes');
 * ```
 */
function unitHomeNotAbsolute(name: string): string {
  return `${shown(name)} cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`;
}

/**
 * The failure of an install over a unit path that is not a regular file.
 *
 * @example
 * ```ts
 * unitNotRegular('notes', '/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function unitNotRegular(name: string, path: string): string {
  return `${shownPath(path)} is not a regular file, so install leaves it alone. Remove it, then run ${shown(name)} service install again.`;
}

/**
 * The failure of a control child for a service that is not installed.
 *
 * @example
 * ```ts
 * serviceNotInstalled('notes', 'com.acme.notes');
 * // 'com.acme.notes is not installed. Run notes service install first.'
 * ```
 */
function serviceNotInstalled(name: string, label: string): string {
  return `${shown(label)} is not installed. Run ${shown(name)} service install first.`;
}

/**
 * The failure of a platform with no service manager the plugin drives.
 *
 * @example
 * ```ts
 * platformUnsupported('notes', 'win32');
 * ```
 */
function platformUnsupported(name: string, platform: string): string {
  return `${shown(name)} cannot run a service on ${shown(platform)}. Run it on Linux with systemd or macOS with launchd.`;
}

/**
 * The failure of an installation record that cannot be read.
 *
 * @example
 * ```ts
 * recordUnreadable('notes', '/home/ada/.local/state/notes/service.json', 'install');
 * ```
 */
function recordUnreadable(name: string, record: string, child: Child): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the files it lists. Remove it and the files it lists, then run ${shown(name)} service ${shown(child)} again.`;
}

/**
 * The failure of an install over a unit install did not write.
 *
 * @example
 * ```ts
 * unitUnrecorded('notes', '/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function unitUnrecorded(name: string, path: string): string {
  return `${shownPath(path)} was not written by ${shown(name)} service install, so install leaves it alone. Remove it, or uninstall it with whatever installed it, then run ${shown(name)} service install again.`;
}

/**
 * The failure of an uninstall of a unit install did not write.
 *
 * @example
 * ```ts
 * unitUnrecordedUninstall('notes', '/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function unitUnrecordedUninstall(name: string, path: string): string {
  return `${shownPath(path)} was not written by ${shown(name)} service install, so uninstall leaves it alone. Remove it with whatever installed it.`;
}

/** The package each manager program comes with, which a sentence tells the operator to install. */
const packages: Readonly<Record<string, string>> = {
  launchctl: 'launchd',
  loginctl: 'systemd',
  systemctl: 'systemd',
};

/**
 * The failure, and the status note, of a manager program that cannot be started.
 *
 * @example
 * ```ts
 * managerMissing('notes', 'systemctl');
 * // 'notes cannot find systemctl. Install systemd, or run the command where it is available.'
 * ```
 */
function managerMissing(name: string, program: string): string {
  return `${shown(name)} cannot find ${shown(program)}. Install ${shown(packages[program] ?? program)}, or run the command where it is available.`;
}

/**
 * The failure of a manager call that exited with a code it does not accept.
 *
 * @example
 * ```ts
 * managerExited('systemctl --user start notes.service', 1, 'systemctl --user status notes.service');
 * ```
 */
function managerExited(call: string, code: number, report: string): string {
  return `${shown(call)} exited with ${String(code)}. Run ${shown(report)} to see why.`;
}

/**
 * The line of a recorded file that was already gone.
 *
 * @example
 * ```ts
 * fileGone('/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function fileGone(path: string): string {
  return `${shownPath(path)} was already gone.`;
}

/**
 * The line of a changed file uninstall kept.
 *
 * @example
 * ```ts
 * fileKept('notes', '/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function fileKept(name: string, path: string): string {
  return `Kept ${shownPath(path)} because it changed since ${shown(name)} service install wrote it. Remove it yourself when it is no longer needed.`;
}

/**
 * The confirmation of an uninstall of a service that is not installed.
 *
 * @example
 * ```ts
 * noServiceToRemove('com.acme.notes');
 * ```
 */
function noServiceToRemove(label: string): string {
  return `${shown(label)} is not installed, so there is nothing to remove.`;
}

/**
 * The line of a removed file.
 *
 * @example
 * ```ts
 * removedFile('/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function removedFile(path: string): string {
  return `Removed ${shownPath(path)}.`;
}

/**
 * The confirmation of a restarted service.
 *
 * @example
 * ```ts
 * restartedService('com.acme.notes'); // 'Restarted com.acme.notes.'
 * ```
 */
function restartedService(label: string): string {
  return `Restarted ${shown(label)}.`;
}

/**
 * The confirmation of a started service.
 *
 * @example
 * ```ts
 * startedService('com.acme.notes'); // 'Started com.acme.notes.'
 * ```
 */
function startedService(label: string): string {
  return `Started ${shown(label)}.`;
}

/**
 * The confirmation of a stopped service.
 *
 * @example
 * ```ts
 * stoppedService('com.acme.notes'); // 'Stopped com.acme.notes.'
 * ```
 */
function stoppedService(label: string): string {
  return `Stopped ${shown(label)}.`;
}

/**
 * The line of a unit that is already current.
 *
 * @example
 * ```ts
 * unitUnchanged('/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function unitUnchanged(path: string): string {
  return `${shownPath(path)} is unchanged.`;
}

/**
 * The line of a written unit.
 *
 * @example
 * ```ts
 * wroteUnit('/home/ada/.config/systemd/user/notes.service');
 * ```
 */
function wroteUnit(path: string): string {
  return `Wrote ${shownPath(path)}.`;
}

/**
 * The call a status note names: the manager, what it was asked about, and its own report.
 *
 * @example
 * ```ts
 * const call: UnreadableCall = { manager: 'launchctl', report: 'launchctl print gui/501/com.acme.notes', target: 'com.acme.notes' };
 * ```
 */
interface UnreadableCall {
  readonly manager: string;
  readonly target: string;
  readonly report: string;
}

/**
 * The note of a service that stops when the user logs out.
 *
 * @example
 * ```ts
 * lingerNote('com.acme.notes');
 * ```
 */
function lingerNote(label: string): string {
  return `Lingering is off, so ${shown(label)} stops when you log out. Run loginctl enable-linger to keep it running.`;
}

/**
 * The note of a service that starts when the user logs in.
 *
 * @example
 * ```ts
 * noSessionNote('com.acme.notes');
 * ```
 */
function noSessionNote(label: string): string {
  return `There is no login session, so ${shown(label)} starts when you log in.`;
}

/**
 * The note of a manager call status ended after its time limit.
 *
 * @example
 * ```ts
 * timedOutNote({ manager: 'systemctl --user', report: 'systemctl --user status notes.service', target: 'notes.service' }, 5);
 * ```
 */
function timedOutNote({ manager, report, target }: UnreadableCall, seconds: number): string {
  return `${shown(manager)} did not report ${shown(target)} within ${String(seconds)} seconds, so status ended the call. Run ${shown(report)} to see why.`;
}

/**
 * The note of a manager call that could not report the unit.
 *
 * @example
 * ```ts
 * callUnreadableNote({ manager: 'systemctl --user', report: 'systemctl --user status notes.service', target: 'notes.service' }, 1);
 * ```
 */
function callUnreadableNote({ manager, report, target }: UnreadableCall, code: number): string {
  return `${shown(manager)} could not report ${shown(target)} (exit ${String(code)}). Run ${shown(report)} to see why.`;
}

export type { Child, UnreadableCall };
export {
  fileGone,
  fileKept,
  lingerNote,
  managerExited,
  managerMissing,
  noServiceToRemove,
  noSessionNote,
  platformUnsupported,
  recordUnreadable,
  removedFile,
  restartedService,
  serviceFromBuild,
  serviceNotInstalled,
  startedService,
  stoppedService,
  timedOutNote,
  unitChanged,
  unitHoldsControl,
  unitHomeNotAbsolute,
  unitNotRegular,
  unitUnchanged,
  unitUnrecorded,
  unitUnrecordedUninstall,
  callUnreadableNote,
  wroteUnit,
};
