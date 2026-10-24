/**
 * `completion update`: each shell whose plugin's file records a script gets this version's script
 * at its recorded path, and its recorded line replaced where it stands when this version's line
 * differs. It reads no variable the paths come from and runs no shell, and it checks every shell
 * before it writes any.
 */
import { recordDirectory } from '../application-folders.js';
import { install } from '../installation/files.js';
import type { InstallOutcome, StartupLine } from '../installation/files.js';
import { lines } from './messages.js';
import {
  directoryMode,
  outcomeFailure,
  readShell,
  recordName,
  refuseInTheWay,
  refuseWindows,
  reportWritten,
  scriptFile,
  scriptState,
} from './run.js';
import type { ChildRun, ShellRecord } from './run.js';
import { scriptContent, shells, startupLine } from './shells.js';
import type { Shell } from './shells.js';
import { judgeStartup, placeLine } from './startup.js';
import type { LinePlacement } from './startup.js';

/** The count of an empty list. */
const none = 0;

/** What an update does to one recorded line, and whether the line stays as recorded with no write. */
type LineStep = LinePlacement & { readonly steady: boolean };

/**
 * The step of a line whose startup file is no longer a file: nothing listed or released, so the
 * module drops it and reports the file no longer holds it.
 */
const dropped: LineStep = { lines: [], loaded: [], notices: [], release: [], steady: false };

/**
 * The step of one recorded line, given this version's text of it: written where it stands in a
 * startup file the plugin may change, and released with no line recorded in one it may not, the
 * operator told to replace a line whose text this version changes.
 */
function lineStep(run: ChildRun, recorded: StartupLine, line: string): LineStep {
  const { path } = recorded;
  const judgement = judgeStartup(path, line, run.host.uid);
  if (judgement.kind === 'not-file') {
    return dropped;
  }
  const placed = placeLine(run, { line, path, recorded: recorded.line, update: true }, judgement);
  const steady = placed.lines.length > none && judgement.holds === true && recorded.line === line;
  return { ...placed, steady };
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
  const steps = recorded.lines.map((entry) =>
    shell === 'fish'
      ? dropped
      : lineStep(run, entry, startupLine({ name: run.name, script, shell })),
  );
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
    lines: steps.flatMap((step) => step.lines),
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
    loaded: [],
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
 * `update`: the platform, the record's directory, every shell's plugin's file, every recorded
 * script, and every recorded startup file, each checked for every shell before any is written,
 * then each shell rewritten and its changes stated.
 */
async function updateShells(run: ChildRun): Promise<void> {
  refuseWindows(run);
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
