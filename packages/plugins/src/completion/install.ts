/**
 * `completion install`: one shell's script written to a file and, for every shell but Fish, one
 * startup line that loads it, both recorded in the shell's plugin's file. Every check runs before
 * anything is written, and a startup file the plugin cannot change gets the line printed instead.
 */
import { normalize } from 'node:path';

import { recordDirectory, requiredHome } from '../application-folders.js';
import { install } from '../installation/files.js';
import type { InstalledLine, InstallOutcome, StartupLine } from '../installation/files.js';
import { lines, refusals } from './messages.js';
import { askProfile, blocksProfile } from './profile.js';
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
  writeNotices,
} from './run.js';
import type { ChildRun, Notice, ShellRecord } from './run.js';
import {
  holdsControlCharacter,
  isPowershell,
  scriptContent,
  scriptPath,
  selectedShell,
  startupLine,
  startupPath,
} from './shells.js';
import type { Shell } from './shells.js';
import { judgeStartup, mustRelease } from './startup.js';
import type { StartupJudgement } from './startup.js';

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
      readonly shell: 'powershell' | 'pwsh';
      readonly script: string;
      readonly home: string;
    };

/** The place of a shell other than PowerShell's, which only Linux and macOS install. */
function filePlace(run: ChildRun, shell: 'bash' | 'zsh' | 'fish'): Place {
  const { host, name } = run;
  if (host.platform === 'win32') {
    throw refusals.notOnWindows(name, shell);
  }
  const script = scriptPath(shell, name, host);
  if (shell === 'fish') {
    return { kind: 'fish', script, shell };
  }
  return { kind: 'file', script, shell, startup: startupPath(shell, name, host) };
}

/** The place of PowerShell's script, which runs from the home folder to report its profile. */
function profilePlace(run: ChildRun, shell: 'powershell' | 'pwsh'): Place {
  const { host, name } = run;
  const home = requiredHome(name, host);
  return { home, kind: 'profile', script: scriptPath(shell, name, host), shell };
}

/**
 * The place of the shell: the `win32` refusal of any shell but PowerShell, the folders it needs
 * from the host's environment, and the refusal of a script path a startup line cannot carry.
 */
function placeOf(run: ChildRun, shell: Shell): Place {
  const place = isPowershell(shell) ? profilePlace(run, shell) : filePlace(run, shell);
  if (place.kind !== 'fish' && holdsControlCharacter(place.script)) {
    throw refusals.controlCharacter(run.name, place.script);
  }
  return place;
}

/**
 * The startup file and the line it would hold: the file the plugin computes, or the profile
 * PowerShell reports with the policy that keeps the line from loading, when it is one.
 */
interface Startup {
  readonly path: string;
  readonly line: string;
  readonly byteOrderMark: boolean;
  readonly policy: string | undefined;
}

/** The startup file of the place, asking PowerShell for its profile; none for Fish. */
async function startupOf(run: ChildRun, place: Place): Promise<Startup | undefined> {
  const { host, name, signal } = run;
  if (place.kind === 'fish') {
    return undefined;
  }
  const line = startupLine({
    name,
    platform: host.platform,
    script: place.script,
    shell: place.shell,
  });
  if (place.kind === 'file') {
    return { byteOrderMark: false, line, path: place.startup, policy: undefined };
  }
  const profile = await askProfile({ home: place.home, host, name, shell: place.shell, signal });
  return {
    byteOrderMark: host.platform === 'win32',
    line,
    path: normalize(profile.path),
    policy: blocksProfile(profile.policy) ? profile.policy : undefined,
  };
}

/**
 * What an install does to startup lines: the line it lists, the startup files whose recorded lines
 * it releases or keeps, the lines the operator changes by hand, and whether the lines stay as
 * recorded.
 */
interface LinePlan {
  readonly lines: readonly InstalledLine[];
  readonly release: readonly string[];
  readonly keep: readonly string[];
  readonly notices: readonly Notice[];
  readonly steady: boolean;
}

/** The count of an empty list. */
const none = 0;

/** The count of a list that holds one entry. */
const sole = 1;

/** The new startup file, judged for its line, and whether a recorded line there was released. */
interface Target {
  readonly startup: Startup;
  readonly judgement: Exclude<StartupJudgement, { kind: 'not-file' }>;
  readonly releasedHere: boolean;
}

/** Whether the new line is listed, and what the operator is told to add by hand when it is not. */
function placeLine(
  run: ChildRun,
  { judgement, releasedHere, startup }: Target,
): { readonly listed: boolean; readonly notices: readonly Notice[] } {
  const { line, path, policy } = startup;
  if (releasedHere) {
    return {
      listed: false,
      notices: judgement.holds === true ? [] : [{ line, sentence: lines.addInPlace(path) }],
    };
  }
  if (judgement.holds === true) {
    return { listed: true, notices: [] };
  }
  if (policy !== undefined) {
    return { listed: false, notices: [{ line, sentence: lines.policy(run.name, policy, path) }] };
  }
  if (judgement.kind === 'unchangeable') {
    return { listed: false, notices: [{ line, sentence: lines.addYourself(run.name, path) }] };
  }
  return { listed: true, notices: [] };
}

/** Whether a recorded line is the one the install lists. */
function isListed(entry: StartupLine, startup: Startup | undefined): boolean {
  return entry.path === startup?.path && entry.line === startup.line;
}

/**
 * Each recorded line the install would replace or remove in a startup file it cannot change, which
 * it releases, with the notice of the line the operator removes by hand.
 */
function releasedLines(
  run: ChildRun,
  startup: Startup | undefined,
  recorded: readonly StartupLine[],
): { readonly release: Set<string>; readonly removals: readonly Notice[] } {
  const released = recorded.filter(
    (entry) =>
      !isListed(entry, startup) &&
      mustRelease(judgeStartup(entry.path, entry.line, run.host.platform)),
  );
  return {
    release: new Set(released.map(({ path }) => path)),
    removals: released.map((entry) => removeNotice(run, entry)),
  };
}

/**
 * The plan for a new startup line: listed, or printed for the operator to add. A recorded line in
 * a startup file the install cannot change and lists no line for is released, so the module never
 * reads or writes that file. The recorded line equal to the one it would list, in a file it cannot
 * read, is kept as recorded, with nothing printed for it.
 */
function planNewLine(
  run: ChildRun,
  {
    judgement,
    recorded,
    startup,
  }: Omit<Target, 'releasedHere'> & { readonly recorded: readonly StartupLine[] },
): LinePlan {
  const { release, removals } = releasedLines(run, startup, recorded);
  if (judgement.holds === undefined && recorded.some((entry) => isListed(entry, startup))) {
    return {
      keep: [startup.path],
      lines: [],
      notices: removals,
      release: [...release],
      steady: recorded.length === sole,
    };
  }
  const placed = placeLine(run, { judgement, releasedHere: release.has(startup.path), startup });
  const recordedHere = recorded.some(({ path }) => path === startup.path);
  if (!placed.listed && judgement.kind === 'unchangeable' && recordedHere) {
    release.add(startup.path);
  }
  const steady = placed.listed
    ? judgement.holds === true &&
      recorded.length === sole &&
      recorded.every((entry) => isListed(entry, startup))
    : recorded.length === none;
  return {
    keep: [],
    lines: placed.listed ? [installedLine(startup)] : [],
    notices: [...removals, ...placed.notices],
    release: [...release],
    steady,
  };
}

/**
 * The plan for the startup lines: the new startup file judged first, which fails as not a file,
 * then each recorded line the install would replace or remove, released with the line to remove
 * when its file cannot be changed, then the new line. Fish lists none.
 */
function planLines(
  run: ChildRun,
  startup: Startup | undefined,
  recorded: readonly StartupLine[],
): LinePlan {
  if (startup === undefined) {
    const { release, removals } = releasedLines(run, startup, recorded);
    return {
      keep: [],
      lines: [],
      notices: removals,
      release: [...release],
      steady: recorded.length === none,
    };
  }
  const judgement = judgeStartup(startup.path, startup.line, run.host.platform);
  if (judgement.kind === 'not-file') {
    throw refusals.notAFile(run.name, startup.path);
  }
  return planNewLine(run, { judgement, recorded, startup });
}

/** The line the module lists for a startup file. */
function installedLine(startup: Startup): InstalledLine {
  const { byteOrderMark, line, path } = startup;
  return byteOrderMark ? { byteOrderMark, line, path } : { line, path };
}

/** What an install writes for one shell, after every check. */
interface Writing {
  readonly record: string;
  readonly recorded: ShellRecord;
  readonly place: Place;
  readonly content: string;
  readonly plan: LinePlan;
}

/** States a script and line that are already in place, and the lines the operator adds by hand. */
async function reportSteady(run: ChildRun, writing: Writing): Promise<void> {
  await run.info(lines.unchanged(writing.place.script));
  for (const { path } of writing.plan.lines) {
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
    keep: plan.keep,
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
  await reportWritten(run, { held: true, notices: plan.notices, outcome });
  if (changedAnything(scriptChanged, outcome)) {
    await run.info(lines.openShell);
  }
}

/** Writes the script and lines through the module, then states each change. */
async function write(run: ChildRun, writing: Writing): Promise<void> {
  const { content, place, plan, recorded } = writing;
  const state = scriptState(recorded, place.script, content);
  if (state === 'steady' && plan.steady && plan.release.length === none) {
    await reportSteady(run, writing);
    return;
  }
  const outcome = installThrough(run, writing);
  await reportInstalled(run, { outcome, scriptChanged: state === 'changed', writing });
}

/**
 * `install`: the shell, the folders and the script's path, the record's directory, the shell's
 * plugin's file, the script, PowerShell's profile, and the startup files, each checked in that
 * order, then the script and line written and each change stated.
 */
async function installShell(run: ChildRun, argument: Shell | undefined): Promise<void> {
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
