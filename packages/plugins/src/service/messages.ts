/*
 * The operator sentences of the service plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters, nowrap } from '@loomcli/core';

const shown = escapeControlCharacters;

const shownPath = (path: string): string => nowrap(shown(path));

/** A call's words joined by single spaces, each escaped and kept whole. */

type Child = 'install' | 'uninstall';

function serviceFromBuild(name: string, build: string): string {
  return `${shown(name)} is ${build === 'development' ? 'a development build' : 'a source build'}, so it cannot install a service that would outlive it. Build it with loom build, then run the built ${shown(name)} service install.`;
}

function unitChanged(name: string, path: string): string {
  return `${shownPath(path)} changed since ${shown(name)} service install wrote it, so install leaves it alone. Remove it, then run ${shown(name)} service install again.`;
}

function unitHoldsControl(name: string): string {
  return `${shown(name)} cannot write its service unit because a path or its description holds a control character. Install ${shown(name)} where its path has none.`;
}

function unitHomeNotAbsolute(name: string): string {
  return `${shown(name)} cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`;
}

function unitNotRegular(name: string, path: string): string {
  return `${shownPath(path)} is not a regular file, so install leaves it alone. Remove it, then run ${shown(name)} service install again.`;
}

function serviceNotInstalled(name: string, label: string): string {
  return `${shown(label)} is not installed. Run ${shown(name)} service install first.`;
}

function platformUnsupported(name: string, platform: string): string {
  return `${shown(name)} cannot run a service on ${shown(platform)}. Run it on Linux with systemd or macOS with launchd.`;
}

function recordUnreadable(name: string, record: string, child: Child): string {
  return `${shownPath(record)} cannot be read, so ${shown(name)} will not change the files it lists. Remove it and the files it lists, then run ${shown(name)} service ${shown(child)} again.`;
}

function unitUnrecorded(name: string, path: string): string {
  return `${shownPath(path)} was not written by ${shown(name)} service install, so install leaves it alone. Remove it, or uninstall it with whatever installed it, then run ${shown(name)} service install again.`;
}

function unitUnrecordedUninstall(name: string, path: string): string {
  return `${shownPath(path)} was not written by ${shown(name)} service install, so uninstall leaves it alone. Remove it with whatever installed it.`;
}

const packages: Readonly<Record<string, string>> = {
  launchctl: 'launchd',
  loginctl: 'systemd',
  systemctl: 'systemd',
};

function managerMissing(name: string, program: string): string {
  return `${shown(name)} cannot find ${shown(program)}. Install ${shown(packages[program] ?? program)}, or run the command where it is available.`;
}

function managerExited(call: string, code: number, report: string): string {
  return `${shown(call)} exited with ${String(code)}. Run ${shown(report)} to see why.`;
}

function fileGone(path: string): string {
  return `${shownPath(path)} was already gone.`;
}

function fileKept(name: string, path: string): string {
  return `Kept ${shownPath(path)} because it changed since ${shown(name)} service install wrote it. Remove it yourself when it is no longer needed.`;
}

function noServiceToRemove(label: string): string {
  return `${shown(label)} is not installed, so there is nothing to remove.`;
}

function removedFile(path: string): string {
  return `Removed ${shownPath(path)}.`;
}

function restartedService(label: string): string {
  return `Restarted ${shown(label)}.`;
}

function startedService(label: string): string {
  return `Started ${shown(label)}.`;
}

function stoppedService(label: string): string {
  return `Stopped ${shown(label)}.`;
}

function unitUnchanged(path: string): string {
  return `${shownPath(path)} is unchanged.`;
}

function wroteUnit(path: string): string {
  return `Wrote ${shownPath(path)}.`;
}

/** The `debug` log template for one service manager call, the `-v` line once it ends. */
const ranManagerCall = 'Ran {call}.';

interface UnreadableCall {
  /** The service manager the call ran, such as systemctl. */
  readonly manager: string;
  /** The unit or label the call named. */
  readonly target: string;
  /** What the service manager reported. */
  readonly report: string;
}

function lingerNote(label: string): string {
  return `Lingering is off, so ${shown(label)} stops when you log out. Run loginctl enable-linger to keep it running.`;
}

function noSessionNote(label: string): string {
  return `There is no login session, so ${shown(label)} starts when you log in.`;
}

function timedOutNote({ manager, report, target }: UnreadableCall, seconds: number): string {
  return `${shown(manager)} did not report ${shown(target)} within ${String(seconds)} seconds, so status ended the call. Run ${shown(report)} to see why.`;
}

function callUnreadableNote({ manager, report, target }: UnreadableCall, code: number): string {
  return `${shown(manager)} could not report ${shown(target)} (exit ${String(code)}). Run ${shown(report)} to see why.`;
}

/** The log path remains useful before the first record creates the file. */
function logFileRow(path: string, exists: boolean): string {
  return `${shown(path)}${exists ? '' : ' (no records yet)'}`;
}

/** The capture of the unmodified unit's console output. */
function managerLogRow(capture: 'journald' | 'none'): string {
  return capture === 'journald'
    ? 'Service console output goes to journald.'
    : 'Service console output goes nowhere: launchd discards it.';
}

/** The row label of the unit's path in the status text view. */
const unitLabel = 'unit';

/** The row label of a log in the status text view. */
const logLabel = 'log';

/** The row label of a note in the status text view. */
const noteLabel = 'note';

export type { Child, UnreadableCall };
export {
  fileGone,
  logLabel,
  noteLabel,
  unitLabel,
  fileKept,
  lingerNote,
  managerExited,
  managerMissing,
  noServiceToRemove,
  noSessionNote,
  platformUnsupported,
  ranManagerCall,
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
  logFileRow,
  managerLogRow,
  wroteUnit,
};
