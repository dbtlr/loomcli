import { escapeControlCharacters, FatalError, nowrap } from '@loomcli/core';

/** Every path, label, and program name a sentence repeats, escaped as a failure message quotes text. */
const shown = escapeControlCharacters;

/** A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps. */
const shownPath = (path: string): string => nowrap(shown(path));

/** One failure a child reports, which exits 1. */
function fatal(sentence: string, cause?: unknown): FatalError {
  return new FatalError(sentence, cause === undefined ? undefined : { cause });
}

/** The child whose refusal a sentence names. */
type Child = 'install' | 'uninstall';

const refusals = {
  build: (name: string, build: string) =>
    fatal(
      `${name} is ${build === 'development' ? 'a development build' : 'a source build'}, so it cannot install a service that would outlive it. Build it with loom build, then run the built ${name} service install.`,
    ),
  changed: (name: string, path: string) =>
    fatal(
      `${shownPath(path)} changed since ${name} service install wrote it, so install leaves it alone. Remove it, then run ${name} service install again.`,
    ),
  controlCharacter: (name: string) =>
    fatal(
      `${name} cannot write its service unit because a path or its description holds a control character. Install ${name} where its path has none.`,
    ),
  home: (name: string) =>
    fatal(
      `${name} cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.`,
    ),
  irregular: (name: string, path: string) =>
    fatal(
      `${shownPath(path)} is not a regular file, so install leaves it alone. Remove it, then run ${name} service install again.`,
    ),
  notInstalled: (name: string, label: string) =>
    fatal(`${shown(label)} is not installed. Run ${name} service install first.`),
  platform: (name: string, platform: string) =>
    fatal(
      `${name} cannot run a service on ${shown(platform)}. Run it on Linux with systemd or macOS with launchd.`,
    ),
  record: (name: string, record: string, child: Child) =>
    fatal(
      `${shownPath(record)} cannot be read, so ${name} will not change the files it lists. Remove it and the files it lists, then run ${name} service ${child} again.`,
    ),
  unrecorded: (name: string, path: string) =>
    fatal(
      `${shownPath(path)} was not written by ${name} service install, so install leaves it alone. Remove it, or uninstall it with whatever installed it, then run ${name} service install again.`,
    ),
  unrecordedUninstall: (name: string, path: string) =>
    fatal(
      `${shownPath(path)} was not written by ${name} service install, so uninstall leaves it alone. Remove it with whatever installed it.`,
    ),
};

/** The package each manager program comes with, which a sentence tells the operator to install. */
const packages: Readonly<Record<string, string>> = {
  launchctl: 'launchd',
  loginctl: 'systemd',
  systemctl: 'systemd',
};

/** The sentence for a manager program that cannot be started. */
function missingSentence(name: string, program: string): string {
  return `${name} cannot find ${shown(program)}. Install ${packages[program] ?? program}, or run the command where it is available.`;
}

const failures = {
  exited: (call: string, code: number, report: string) =>
    fatal(`${shown(call)} exited with ${code}. Run ${shown(report)} to see why.`),
  missing: (name: string, program: string, cause: unknown) =>
    fatal(missingSentence(name, program), cause),
};

/** The lines each child writes about its work. */
const lines = {
  gone: (path: string) => `${shownPath(path)} was already gone.`,
  kept: (name: string, path: string) =>
    `Kept ${shownPath(path)} because it changed since ${name} service install wrote it. Remove it yourself when it is no longer needed.`,
  nothingToRemove: (label: string) =>
    `${shown(label)} is not installed, so there is nothing to remove.`,
  removed: (path: string) => `Removed ${shownPath(path)}.`,
  restarted: (label: string) => `Restarted ${shown(label)}.`,
  started: (label: string) => `Started ${shown(label)}.`,
  stopped: (label: string) => `Stopped ${shown(label)}.`,
  unchanged: (path: string) => `${shownPath(path)} is unchanged.`,
  wrote: (path: string) => `Wrote ${shownPath(path)}.`,
};

/** The call a status note names: the manager, what it was asked about, and its own report. */
interface UnreadableCall {
  readonly manager: string;
  readonly target: string;
  readonly report: string;
}

/** The notes status adds about an unreadable state and the user's session. */
const notes = {
  linger: (label: string) =>
    `Lingering is off, so ${label} stops when you log out. Run loginctl enable-linger to keep it running.`,
  missing: missingSentence,
  noSession: (label: string) => `There is no login session, so ${label} starts when you log in.`,
  unreadable: (call: UnreadableCall, code: number) =>
    `${call.manager} could not report ${call.target} (exit ${code}). Run ${call.report} to see why.`,
};

export type { Child };
export { failures, lines, notes, refusals, shown };
