/**
 * `completion uninstall`: each shell's recorded script and startup line removed, and its plugin's
 * file deleted. A line in a startup file the plugin cannot change is released and printed for the
 * operator to remove. Every shell is checked before any is changed.
 */
import { dirname, sep } from 'node:path';

import { recordDirectory } from '../application-folders.js';
import { realPath } from '../installation/disk.js';
import {
  adoptDirectories,
  readRecorded,
  recordedDirectories,
  uninstall,
} from '../installation/files.js';
import type { StartupLine, UninstallOutcome } from '../installation/files.js';
import { lines, refusals } from './messages.js';
import {
  hasPluginFile,
  readShell,
  recordName,
  removeNotice,
  reportLines,
  writeNotices,
} from './run.js';
import type { ChildRun, ShellRecord } from './run.js';
import { shells } from './shells.js';
import type { Shell } from './shells.js';
import { judgeStartup, mustRelease } from './startup.js';

/** A shell an uninstall removes, with the recorded lines it releases. */
interface Planned {
  readonly recorded: ShellRecord;
  readonly released: readonly StartupLine[];
}

/** The recorded lines in startup files the plugin cannot change that hold them, which it releases. */
function planShell(run: ChildRun, recorded: ShellRecord): Planned {
  const released = recorded.lines.filter((entry) =>
    mustRelease(judgeStartup(entry.path, entry.line, run.host.platform)),
  );
  return { recorded, released };
}

/** The count of an empty list. */
const none = 0;

/** States each recorded script: removed, left in place because someone changed it, or already gone. */
async function reportScripts(
  run: ChildRun,
  recorded: ShellRecord,
  outcome: Extract<UninstallOutcome, { status: 'uninstalled' }>,
): Promise<void> {
  for (const { path } of recorded.files) {
    if (outcome.removed.includes(path)) {
      await run.info(lines.removed(path));
    } else if (outcome.kept.includes(path)) {
      await run.warn(lines.leftInPlace(run.name, path));
    } else {
      await run.info(lines.gone(path));
    }
  }
}

/** Removes one shell's recorded script and lines through the module, then states each. */
async function removeShell(run: ChildRun, record: string, planned: Planned): Promise<void> {
  const { recorded, released } = planned;
  const outcome = uninstall({
    plugin: recordName(recorded.shell),
    record,
    release: [...new Set(released.map(({ path }) => path))],
    signal: run.signal,
  });
  if (outcome.status === 'refused') {
    const [refused] = outcome.refused;
    throw refusals.record(run.name, refused?.path ?? record, 'uninstall');
  }
  await reportScripts(run, recorded, outcome);
  await reportLines(run, outcome.lines, false);
  await writeNotices(
    run,
    released.map((entry) => removeNotice(run, entry)),
  );
}

/**
 * The shells an uninstall acts on, its argument's or, left out, every one, each whose plugin's file
 * exists, read before any is changed.
 */
function selectedShells(
  run: ChildRun,
  record: string,
  argument: Shell | undefined,
): readonly ShellRecord[] {
  const selected = argument === undefined ? shells : [argument];
  return selected
    .filter((shell) => hasPluginFile(record, shell))
    .map((shell) => readShell(run, { record, shell, verb: 'uninstall' }));
}

/** Whether a shell's plugin's file records anything: a script or a startup line. */
function recordsAnything(recorded: ShellRecord): boolean {
  return recorded.files.length > none || recorded.lines.length > none;
}

/** The scripts another shell's plugin's file records. */
function scriptsOf(record: string, shell: Shell): readonly string[] {
  const read = readRecorded({ plugin: recordName(shell), record });
  return read.status === 'read' ? read.files.map(({ path }) => path) : [];
}

/**
 * Whether a script sits under a folder, both read through every symbolic link, so a script reached
 * through a link to the folder, or to one of its parents, is seen under it.
 * The script's own folder is resolved, through its nearest existing parent when it is gone.
 */
function sitsUnder(script: string, folder: string): boolean {
  const scriptFolder = realPath(dirname(script));
  const realFolder = realPath(folder);
  return scriptFolder === realFolder || scriptFolder.startsWith(`${realFolder}${sep}`);
}

/**
 * Hands each folder a shell's plugin's file records it created to the plugin's file of another
 * installed shell whose script sits under it, before the shell's file is deleted. That folder
 * still holds the other shell's script, or its folders, after this uninstall, and the other
 * shell's uninstall removes it once it is empty.
 */
function handOverFolders(record: string, shell: Shell): void {
  const remaining = new Set(recordedDirectories({ plugin: recordName(shell), record }));
  for (const heir of shells.filter((other) => other !== shell)) {
    const scripts = scriptsOf(record, heir);
    const held = [...remaining].filter((folder) =>
      scripts.some((script) => sitsUnder(script, folder)),
    );
    if (
      held.length > none &&
      adoptDirectories({ directories: held, plugin: recordName(heir), record })
    ) {
      for (const folder of held) {
        remaining.delete(folder);
      }
    }
  }
}

/**
 * `uninstall`: the record's directory and each selected shell's plugin's file read before any is
 * changed, then each shell whose plugin's file exists removed and stated, its shared folders
 * handed first to a shell that outlives it. With nothing recorded, it states there was nothing to
 * remove.
 */
async function uninstallShells(run: ChildRun, argument: Shell | undefined): Promise<void> {
  const record = recordDirectory(run.name, run.host);
  const selected = selectedShells(run, record, argument);
  const planned = selected.map((recorded) => planShell(run, recorded));
  for (const entry of planned) {
    handOverFolders(record, entry.recorded.shell);
    await removeShell(run, record, entry);
  }
  if (!selected.some(recordsAnything)) {
    await run.success(lines.noneToRemove(run.name));
  }
}

export { uninstallShells };
