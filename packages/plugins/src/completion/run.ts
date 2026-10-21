/**
 * What `install`, `update`, and `uninstall` share: the run they act on, each shell's plugin's file
 * in the installation record, and the lines they write about startup lines.
 */
import type { Host } from '@loomcli/core';

import { digestOf, exists } from '../installation/disk.js';
import { hasPendingRecord, readRecorded, targetRefusals } from '../installation/files.js';
import type {
  InstalledFile,
  InstallOutcome,
  RecordedRead,
  Refusal,
  StartupLine,
  StartupLinesOutcome,
} from '../installation/files.js';
import { pluginFilePath } from '../installation/record.js';
import { lines, refusals } from './messages.js';
import type { Shell } from './shells.js';

/** What a child reads from its action: the application, the run, and the lanes it writes. */
interface ChildRun {
  readonly name: string;
  readonly host: Host;
  readonly signal: AbortSignal;
  readonly info: (message: string) => Promise<void>;
  readonly success: (message: string) => Promise<void>;
  readonly warn: (message: string) => Promise<void>;
  readonly print: (message: string) => Promise<void>;
}

/** A recorded file and its digest, as a plugin's file lists it. */
type RecordedFile = Extract<RecordedRead, { status: 'read' }>['files'][number];

/** What a shell's plugin's file records, read as recovery would resolve it, without writing. */
interface ShellRecord {
  readonly shell: Shell;
  readonly files: readonly RecordedFile[];
  readonly lines: readonly StartupLine[];
  readonly pending: boolean;
}

/**
 * Refuses an installing child on `win32`, before it reads anything, naming the print Command of
 * the shell the operator named, and the PowerShell one for `pwsh` or when no shell is named.
 */
function refuseWindows(run: ChildRun, shell?: Shell): void {
  if (run.host.platform === 'win32') {
    const printer = shell === undefined || shell === 'pwsh' ? 'powershell' : shell;
    throw refusals.notOnWindows(run.name, printer);
  }
}

/** The plugin's file in the installation record for a shell, `completion.<shell>.json`. */
function recordName(shell: Shell): string {
  return `completion.${shell}`;
}

/** Whether a shell's plugin's file exists in the record's directory. */
function hasPluginFile(record: string, shell: Shell): boolean {
  return exists(pluginFilePath(record, recordName(shell)));
}

/**
 * What a shell's plugin's file records, or the refusal of one that is damaged or holds an unknown
 * format, which names the Command to run again.
 */
function readShell(
  run: ChildRun,
  {
    record,
    shell,
    verb,
  }: { readonly record: string; readonly shell: Shell; readonly verb: 'install' | 'uninstall' },
): ShellRecord {
  const request = { plugin: recordName(shell), record };
  const read = readRecorded(request);
  if (read.status === 'refused') {
    throw refusals.record(run.name, read.refused.path, verb);
  }
  return {
    files: read.files,
    lines: read.lines ?? [],
    pending: hasPendingRecord(request),
    shell,
  };
}

/** The count of a list that holds one entry. */
const sole = 1;

/** The permission bits of each script, whatever the umask. */
const scriptMode = 0o644;

/** The permission bits of each folder the module creates for a script or a startup file. */
const directoryMode = 0o755;

/** The script file the module writes. */
function scriptFile(path: string, content: string): InstalledFile {
  return { content, mode: scriptMode, path };
}

/**
 * What the record says of a script a run would write: `steady` when the plugin's file is
 * committed, records that script alone with the digest of this content, and the file is there;
 * `same` when the script is there with that digest but the plugin's file records more or is
 * pending; and `changed` otherwise.
 */
function scriptState(
  recorded: ShellRecord,
  script: string,
  content: string,
): 'steady' | 'same' | 'changed' {
  const digest = digestOf(content);
  const same = recorded.files.some((file) => file.path === script && file.digest === digest);
  if (!same || !exists(script)) {
    return 'changed';
  }
  return recorded.pending || recorded.files.length !== sole ? 'same' : 'steady';
}

/** A script a run would write, with the shell and the files its plugin's file records. */
interface Wanted {
  readonly shell: Shell;
  readonly script: string;
  readonly files: readonly RecordedFile[];
}

/**
 * Refuses, before any write, every script something else holds or someone changed since it was
 * written, stating each one; the failure names the first refused shell's install Command.
 */
async function refuseInTheWay(
  run: ChildRun,
  verb: 'install' | 'update',
  wanted: readonly Wanted[],
): Promise<void> {
  const refused = wanted.flatMap(({ files, script, shell }) =>
    targetRefusals([script], files).map((refusal) => ({ refusal, shell })),
  );
  for (const { refusal } of refused) {
    await run.warn(
      refusal.reason === 'changed'
        ? lines.changed(run.name, refusal.path)
        : lines.notInstalled(run.name, refusal.path),
    );
  }
  const [first] = refused;
  if (first !== undefined) {
    throw refusals.inTheWay(run.name, verb, first.shell);
  }
}

/**
 * The failure of an install the module refused although every check passed, as when another run
 * changed the record or a script between the checks and the write.
 */
function outcomeFailure(
  run: ChildRun,
  {
    refused,
    shell,
    verb,
  }: {
    readonly verb: 'install' | 'update';
    readonly shell: Shell;
    readonly refused: readonly Refusal[];
  },
): Error {
  const [first] = refused;
  if (first?.reason === 'damaged' || first?.reason === 'unknown-format') {
    return refusals.record(run.name, first.path, 'install');
  }
  return refusals.inTheWay(run.name, verb, shell);
}

/**
 * A line the operator adds or removes by hand: the sentence that says why through `warn`, then the
 * line itself through `print`, the only thing these children write to stdout.
 */
interface Notice {
  readonly sentence: string;
  readonly line: string;
}

/** Writes each notice: its sentence as a warning, then its line to stdout. */
async function writeNotices(run: ChildRun, notices: readonly Notice[]): Promise<void> {
  for (const notice of notices) {
    await run.warn(notice.sentence);
    await run.print(notice.line);
  }
}

/** The notice of a recorded line the plugin released and the operator removes by hand. */
function removeNotice(run: ChildRun, released: StartupLine): Notice {
  return { line: released.line, sentence: lines.removeYourself(run.name, released.path) };
}

/**
 * States what happened to the startup lines: each removed or no longer held, then each added,
 * replaced, and, when `held` is set, each the file already held. A released line is stated by its
 * notice.
 */
async function reportLines(
  run: ChildRun,
  outcome: Partial<StartupLinesOutcome> | undefined,
  held: boolean,
): Promise<void> {
  for (const { path } of outcome?.removed ?? []) {
    await run.info(lines.removedLine(path));
  }
  for (const { path } of outcome?.noLongerHeld ?? []) {
    await run.info(lines.noLongerHolds(run.name, path));
  }
  for (const { path } of outcome?.added ?? []) {
    await run.success(lines.added(path));
  }
  for (const { path } of outcome?.replaced ?? []) {
    await run.success(lines.updatedLine(path));
  }
  for (const { path } of held ? (outcome?.held ?? []) : []) {
    await run.info(lines.alreadyLoads(path));
  }
}

/** What an install or update wrote, and the lines the operator changes by hand. */
interface Written {
  readonly outcome: Extract<InstallOutcome, { status: 'installed' }>;
  /** Whether a line the startup file already held is stated, as `install` states it. */
  readonly held: boolean;
  /** The startup files the plugin may not change that already load the script, stated with `held`. */
  readonly loaded: readonly string[];
  readonly notices: readonly Notice[];
}

/**
 * States what an install or update did past its script: each recorded script it no longer lists,
 * removed or kept because someone changed it, each startup line, and each line the operator adds
 * or removes by hand.
 */
async function reportWritten(
  run: ChildRun,
  { held, loaded, notices, outcome }: Written,
): Promise<void> {
  for (const path of outcome.removed) {
    await run.info(lines.removed(path));
  }
  for (const path of outcome.kept) {
    await run.warn(lines.leftInPlace(run.name, path));
  }
  await reportLines(run, outcome.lines, held);
  for (const path of held ? loaded : []) {
    await run.info(lines.alreadyLoads(path));
  }
  await writeNotices(run, notices);
}

export type { ChildRun, Notice, RecordedFile, ShellRecord };
export {
  directoryMode,
  hasPluginFile,
  outcomeFailure,
  readShell,
  recordName,
  refuseInTheWay,
  refuseWindows,
  removeNotice,
  reportLines,
  reportWritten,
  scriptFile,
  scriptState,
  writeNotices,
};
