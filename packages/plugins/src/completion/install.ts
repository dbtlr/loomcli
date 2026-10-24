/**
 * `completion install`: one shell's script written to a file and, for every shell but Fish, one
 * startup line that loads it, both recorded in the shell's plugin's file. Every check runs before
 * anything is written, and a startup file the plugin cannot change gets the line printed instead.
 */
import { normalize } from 'node:path';

import { recordDirectory, requiredHome } from '../application-folders.js';
import { install } from '../installation/files.js';
import type { InstallOutcome, StartupLine } from '../installation/files.js';
import { lines, refusals } from './messages.js';
import { askProfile } from './profile.js';
import {
  directoryMode,
  outcomeFailure,
  readShell,
  recordName,
  refuseInTheWay,
  refuseWindows,
  removeNotice,
  reportWritten,
  scriptFile,
  scriptState,
  writeNotices,
} from './run.js';
import type { ChildRun, ShellRecord } from './run.js';
import { scriptContent, scriptPath, selectedShell, startupLine, startupPath } from './shells.js';
import type { Shell } from './shells.js';
import { judgeStartup, mustRelease, placeLine } from './startup.js';
import type { LinePlacement, StartupJudgement } from './startup.js';

/** Where a shell's script goes, and how its startup file is found. */
type Place =
  | { readonly kind: 'fish'; readonly shell: 'fish'; readonly script: string }
  | {
      readonly kind: 'file';
      readonly shell: 'bash' | 'zsh';
      readonly script: string;
      readonly startup: string;
    }
  | {
      readonly kind: 'profile';
      readonly shell: 'pwsh';
      readonly script: string;
      readonly home: string;
    };

/**
 * The place of the shell, from the folders it needs from the host's environment. PowerShell runs
 * from the home folder to report its profile.
 */
function placeOf(run: ChildRun, shell: Shell): Place {
  const { host, name } = run;
  switch (shell) {
    case 'fish': {
      return { kind: 'fish', script: scriptPath(shell, name, host), shell };
    }
    case 'pwsh': {
      const home = requiredHome(name, host);
      return { home, kind: 'profile', script: scriptPath(shell, name, host), shell };
    }
    default: {
      const script = scriptPath(shell, name, host);
      return { kind: 'file', script, shell, startup: startupPath(shell, name, host) };
    }
  }
}

/** The startup file the plugin computes or PowerShell reports, and the line it would hold. */
interface Startup {
  readonly path: string;
  readonly line: string;
}

/** The startup file of the place, asking PowerShell for its profile; none for Fish. */
async function startupOf(run: ChildRun, place: Place): Promise<Startup | undefined> {
  const { host, name, signal } = run;
  if (place.kind === 'fish') {
    return undefined;
  }
  const line = startupLine({ name, script: place.script, shell: place.shell });
  if (place.kind === 'file') {
    return { line, path: place.startup };
  }
  const profile = await askProfile({ home: place.home, host, name, signal });
  return { line, path: normalize(profile) };
}

/** What an install does to startup lines, and whether the lines stay as recorded with no write. */
type LinePlan = LinePlacement & { readonly steady: boolean };

/** The count of an empty list. */
const none = 0;

/**
 * Each recorded line in another startup file than the install's, which it no longer lists: in a
 * file the plugin cannot change that holds it, or may hold it, released with the line the operator
 * removes by hand, and in any other the module's to remove.
 */
function otherLines(run: ChildRun, others: readonly StartupLine[]): LinePlacement {
  const released = others.filter((entry) =>
    mustRelease(judgeStartup(entry.path, entry.line, run.host.uid)),
  );
  return {
    lines: [],
    loaded: [],
    notices: released.map((entry) => removeNotice(run, entry)),
    release: released.map(({ path }) => path),
  };
}

/**
 * The plan for the startup lines: the new startup file judged first, which fails as not a file,
 * then each recorded line in another file, then the new line, written and recorded in a file the
 * plugin may change, and printed with no line recorded in one it may not. Fish lists none.
 */
function planLines(
  run: ChildRun,
  startup: Startup | undefined,
  recorded: readonly StartupLine[],
): LinePlan {
  if (startup === undefined) {
    return { ...otherLines(run, recorded), steady: recorded.length === none };
  }
  const judgement = judgeStartup(startup.path, startup.line, run.host.uid);
  if (judgement.kind === 'not-file') {
    throw refusals.notAFile(run.name, startup.path);
  }
  const others = recorded.filter(({ path }) => path !== startup.path);
  const before = otherLines(run, others);
  const placed = newLine(run, { judgement, recorded, startup });
  return {
    lines: placed.lines,
    loaded: placed.loaded,
    notices: [...before.notices, ...placed.notices],
    release: [...before.release, ...placed.release],
    steady: others.length === none && placed.steady,
  };
}

/**
 * The new line placed in its startup file, steady when the file it may change already holds the
 * line recorded, or when it lists no line where none is recorded.
 */
function newLine(
  run: ChildRun,
  {
    judgement,
    recorded,
    startup,
  }: {
    readonly startup: Startup;
    readonly judgement: Exclude<StartupJudgement, { kind: 'not-file' }>;
    readonly recorded: readonly StartupLine[];
  },
): LinePlan {
  const here = recorded.find(({ path }) => path === startup.path)?.line;
  const placed = placeLine(run, { ...startup, recorded: here, update: false }, judgement);
  const steady =
    placed.lines.length === none
      ? here === undefined
      : judgement.holds === true && here === startup.line;
  return { ...placed, steady };
}

/** What an install writes for one shell, after every check. */
interface Writing {
  readonly record: string;
  readonly recorded: ShellRecord;
  readonly place: Place;
  readonly content: string;
  readonly plan: LinePlan;
}

/** States a script and line that are already in place, and the line the operator adds by hand. */
async function reportSteady(run: ChildRun, writing: Writing): Promise<void> {
  await run.info(lines.unchanged(writing.place.script));
  for (const path of [...writing.plan.lines.map((entry) => entry.path), ...writing.plan.loaded]) {
    await run.info(lines.alreadyLoads(path));
  }
  await writeNotices(run, writing.plan.notices);
}

/** Installs the script and lines through the module, or throws the failure of a refusal. */
function installThrough(
  run: ChildRun,
  writing: Writing,
): Extract<InstallOutcome, { status: 'installed' }> {
  const { content, place, plan, record } = writing;
  const outcome = install({
    directoryMode,
    files: [scriptFile(place.script, content)],
    lines: plan.lines,
    plugin: recordName(place.shell),
    record,
    release: plan.release,
    signal: run.signal,
  });
  if (outcome.status === 'refused') {
    throw outcomeFailure(run, { refused: outcome.refused, shell: place.shell, verb: 'install' });
  }
  return outcome;
}

/**
 * Whether an install changed anything: the script or a startup line. A recorded script it removes
 * sits at another path than the one it writes, so the script changed too.
 */
function changedAnything(
  scriptChanged: boolean,
  outcome: Extract<InstallOutcome, { status: 'installed' }>,
): boolean {
  const lineChanges = [
    ...(outcome.lines?.added ?? []),
    ...(outcome.lines?.replaced ?? []),
    ...(outcome.lines?.removed ?? []),
  ];
  return scriptChanged || lineChanges.length > none;
}

/**
 * States the script, by what the record said of it before the write, everything else the install
 * did, and, when anything changed, to open a new shell.
 */
async function reportInstalled(
  run: ChildRun,
  {
    outcome,
    scriptChanged,
    writing,
  }: {
    readonly writing: Writing;
    readonly scriptChanged: boolean;
    readonly outcome: Extract<InstallOutcome, { status: 'installed' }>;
  },
): Promise<void> {
  const { place, plan } = writing;
  await (scriptChanged
    ? run.success(lines.installed(place.shell, place.script))
    : run.info(lines.unchanged(place.script)));
  await reportWritten(run, { held: true, loaded: plan.loaded, notices: plan.notices, outcome });
  if (changedAnything(scriptChanged, outcome)) {
    await run.info(lines.openShell);
  }
}

/** Writes the script and lines through the module, then states each change. */
async function write(run: ChildRun, writing: Writing): Promise<void> {
  const { content, place, plan, recorded } = writing;
  const state = scriptState(recorded, place.script, content);
  if (state === 'steady' && plan.steady) {
    await reportSteady(run, writing);
    return;
  }
  const outcome = installThrough(run, writing);
  await reportInstalled(run, { outcome, scriptChanged: state === 'changed', writing });
}

/**
 * `install`: the platform, the shell, the folders and the script's path, the record's directory,
 * the shell's plugin's file, the script, PowerShell's profile, and the startup files, each checked
 * in that order, then the script and line written and each change stated.
 */
async function installShell(run: ChildRun, argument: Shell | undefined): Promise<void> {
  refuseWindows(run, argument);
  const shell = selectedShell(run.name, run.host, argument);
  const place = placeOf(run, shell);
  const record = recordDirectory(run.name, run.host);
  const recorded = readShell(run, { record, shell, verb: 'install' });
  await refuseInTheWay(run, 'install', [{ files: recorded.files, script: place.script, shell }]);
  const startup = await startupOf(run, place);
  const plan = planLines(run, startup, recorded.lines);
  await write(run, {
    content: scriptContent(shell, run.name),
    place,
    plan,
    record,
    recorded,
  });
}

export { installShell };
