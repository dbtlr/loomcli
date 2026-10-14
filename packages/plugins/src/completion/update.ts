/**
 * `completion update`: each shell whose plugin's file records a script gets this version's script
 * at its recorded path, and its recorded line replaced where it stands when this version's line
 * differs. It reads no variable the paths come from and runs no shell, and it checks every shell
 * before it writes any.
 */
import { recordDirectory } from '../application-folders.js';
import { install } from '../installation/files.js';
import type { InstalledLine, InstallOutcome, StartupLine } from '../installation/files.js';
import { lines } from './messages.js';
import {
  directoryMode,
  outcomeFailure,
  readShell,
  recordName,
  refuseInTheWay,
  removeNotice,
  reportWritten,
  scriptFile,
  scriptState,
} from './run.js';
import type { ChildRun, Notice, ShellRecord } from './run.js';
import { scriptContent, shells, startupLine } from './shells.js';
import type { Shell } from './shells.js';
import { judgeStartup, mustRelease } from './startup.js';

/** The count of an empty list. */
const none = 0;

/** What an update does to one recorded line. */
interface LineStep {
  readonly listed: readonly InstalledLine[];
  readonly release: readonly string[];
  readonly keep: readonly string[];
  readonly notices: readonly Notice[];
  /** Whether the line stays as recorded with no write. */
  readonly steady: boolean;
}

/** The step of a line an update drops, as one whose startup file is no longer a file. */
const dropped: LineStep = { keep: [], listed: [], notices: [], release: [], steady: false };

/**
 * The step of a line whose text this version keeps: listed, so the module records it while the
 * file holds it, or kept as recorded in a file the plugin cannot read to tell.
 */
function keptLine(recorded: StartupLine, platform: string): LineStep {
  const judgement = judgeStartup(recorded.path, recorded.line, platform);
  if (judgement.kind === 'not-file') {
    return dropped;
  }
  if (judgement.holds === undefined) {
    return { keep: [recorded.path], listed: [], notices: [], release: [], steady: true };
  }
  return { keep: [], listed: [recorded], notices: [], release: [], steady: judgement.holds };
}

/**
 * The step of a line whose text this version changes: replaced where it stands, or, in a file the
 * plugin cannot change that holds it, released with the line to remove and the line to add.
 */
function changedLine(run: ChildRun, recorded: StartupLine, line: string): LineStep {
  const judgement = judgeStartup(recorded.path, recorded.line, run.host.platform);
  if (judgement.kind === 'not-file') {
    return dropped;
  }
  if (mustRelease(judgement)) {
    const notices = [
      removeNotice(run, recorded),
      { line, sentence: lines.addInPlace(recorded.path) },
    ];
    return { ...dropped, notices, release: [recorded.path] };
  }
  return { ...dropped, listed: [{ line, path: recorded.path }] };
}

/** A shell an update writes: its record, the recorded script, and what it does to each line. */
interface Planned {
  readonly recorded: ShellRecord;
  readonly script: string;
  readonly steps: readonly LineStep[];
}

/** What an update does to each recorded line of a shell, given the recorded script's path. */
function planShell(run: ChildRun, recorded: ShellRecord, script: string): Planned {
  const { shell } = recorded;
  const steps = recorded.lines.map((entry) => {
    if (shell === 'fish') {
      return dropped;
    }
    const line = startupLine({ name: run.name, platform: run.host.platform, script, shell });
    return entry.line === line ? keptLine(entry, run.host.platform) : changedLine(run, entry, line);
  });
  return { recorded, script, steps };
}

/** Rewrites the script and lines through the module, or throws the failure of a refusal. */
function rewrite(
  run: ChildRun,
  {
    content,
    planned,
    record,
  }: { readonly record: string; readonly planned: Planned; readonly content: string },
): Extract<InstallOutcome, { status: 'installed' }> {
  const { recorded, script, steps } = planned;
  const outcome = install({
    directoryMode,
    files: [scriptFile(script, content)],
    keep: steps.flatMap((step) => step.keep),
    lines: steps.flatMap((step) => step.listed),
    plugin: recordName(recorded.shell),
    record,
    release: steps.flatMap((step) => step.release),
    signal: run.signal,
    update: true,
  });
  if (outcome.status === 'refused') {
    throw outcomeFailure(run, { refused: outcome.refused, shell: recorded.shell, verb: 'update' });
  }
  return outcome;
}

/** Rewrites one shell's script and lines, or states them unchanged, then states each change. */
async function updateShell(run: ChildRun, record: string, planned: Planned): Promise<void> {
  const { recorded, script, steps } = planned;
  const content = scriptContent(recorded.shell, run.name);
  const state = scriptState(recorded, script, content);
  if (state === 'steady' && steps.every((step) => step.steady)) {
    await run.info(lines.unchanged(script));
    return;
  }
  const outcome = rewrite(run, { content, planned, record });
  await (state === 'changed'
    ? run.success(lines.updated(recorded.shell, script))
    : run.info(lines.unchanged(script)));
  await reportWritten(run, {
    held: false,
    notices: steps.flatMap((step) => step.notices),
    outcome,
  });
}

/** The shells whose plugin's file records a script, each with the first script it records. */
function recordedShells(
  run: ChildRun,
  record: string,
): readonly { readonly recorded: ShellRecord; readonly script: string }[] {
  return shells.flatMap((shell: Shell) => {
    const recorded = readShell(run, { record, shell, verb: 'install' });
    const [file] = recorded.files;
    return file === undefined ? [] : [{ recorded, script: file.path }];
  });
}

/**
 * `update`: the record's directory, every shell's plugin's file, every recorded script, and every
 * recorded startup file, each checked for every shell before any is written, then each shell
 * rewritten and its changes stated.
 */
async function updateShells(run: ChildRun): Promise<void> {
  const record = recordDirectory(run.name, run.host);
  const found = recordedShells(run, record);
  if (found.length === none) {
    await run.success(lines.noneToUpdate(run.name));
    return;
  }
  await refuseInTheWay(
    run,
    'update',
    found.map(({ recorded, script }) => ({ files: recorded.files, script, shell: recorded.shell })),
  );
  const planned = found.map(({ recorded, script }) => planShell(run, recorded, script));
  for (const entry of planned) {
    await updateShell(run, record, entry);
  }
}

export { updateShells };
