/**
 * The startup lines of the installed-files module: what an install or uninstall does to each
 * startup file's line, decided from the recorded lines and what each startup file holds, and the
 * writes that carry it out. A released line is decided without reading its startup file.
 */
import { missingParents, removeStagingFiles } from './disk.js';
import type { PendingLine, StartupLine } from './record.js';
import {
  appendLine,
  createStartupFile,
  holdsLine,
  readStartup,
  realPathOf,
  rewriteLines,
} from './startup.js';
import type { StartupText } from './startup.js';

/** One startup line an install lists: its startup file's absolute path and its text. */
interface InstalledLine {
  readonly path: string;
  readonly line: string;
}

/** What a run does to one startup file's line, with the text recorded before, `null` for none. */
type LineAction =
  | {
      readonly kind: 'add';
      readonly listed: InstalledLine;
      readonly prior: string | null;
      /** The file's text, or `undefined` for a file the module creates. */
      readonly found: StartupText | undefined;
    }
  | { readonly kind: 'hold'; readonly listed: InstalledLine; readonly prior: string | null }
  | {
      readonly kind: 'replace';
      readonly listed: InstalledLine;
      readonly prior: string;
      readonly found: StartupText;
    }
  | {
      readonly kind: 'remove';
      readonly path: string;
      readonly prior: string;
      readonly found: StartupText;
    }
  | { readonly kind: 'not-held'; readonly path: string; readonly prior: string }
  | { readonly kind: 'release'; readonly path: string; readonly prior: string };

/**
 * What happened to the startup lines, each by its startup file's path and text: the new text for
 * a line added, already held, or replaced, and the recorded text for one removed, no longer held,
 * or released.
 */
interface StartupLinesOutcome {
  readonly added: readonly StartupLine[];
  readonly held: readonly StartupLine[];
  readonly replaced: readonly StartupLine[];
  readonly removed: readonly StartupLine[];
  readonly noLongerHeld: readonly StartupLine[];
  readonly released: readonly StartupLine[];
}

/** Why a listed startup file refuses an install: it resolves to something other than a regular file or nothing. */
interface LineRefusal {
  readonly path: string;
  readonly reason: 'link' | 'directory' | 'special';
}

/**
 * The startup lines a run lists, the startup files whose recorded lines it releases because the
 * plugin may not change them, and whether it is an update.
 */
interface LineListing {
  readonly lines: readonly InstalledLine[];
  readonly release: ReadonlySet<string>;
  readonly update: boolean;
}

/**
 * A startup file the module would change but cannot read, in an encoding it does not read or one
 * the process may not read: a first-party plugin's bug, since the plugin judges the file first.
 */
function unreadable(path: string, kind: 'unknown-encoding' | 'unreadable'): TypeError {
  return new TypeError(
    kind === 'unreadable'
      ? `Startup file "${path}" is one the process may not read.`
      : `Startup file "${path}" is not in an encoding the module reads.`,
  );
}

/** The text of a startup file the module would change, `undefined` when it is absent, or its refusal. */
function foundText(path: string): StartupText | undefined | LineRefusal {
  const read = readStartup(path);
  switch (read.kind) {
    case 'absent': {
      return undefined;
    }
    case 'not-file': {
      return { path, reason: read.reason };
    }
    case 'unknown-encoding':
    case 'unreadable': {
      throw unreadable(path, read.kind);
    }
    default: {
      return read.content;
    }
  }
}

/** Whether a read startup file is a refusal rather than text or nothing. */
function isRefusal(found: StartupText | undefined | LineRefusal): found is LineRefusal {
  return found !== undefined && 'reason' in found;
}

/** A listed line with the text recorded for its file, `null` for none, and the file's text. */
interface ListedRead {
  readonly listed: InstalledLine;
  readonly prior: string | null;
  readonly found: StartupText | undefined;
}

/**
 * What an install does to a listed line, given the text recorded for its file and the file's text:
 * a recorded line whose text changed replaces each line equal to the old text where it stands, a
 * line the file holds is recorded, an update adds no line where the file no longer holds the
 * recorded one, and every other line is added.
 */
function listedAction({ listed, prior, found }: ListedRead, update: boolean): LineAction {
  const holds = (text: string) => found !== undefined && holdsLine(found.text, text);
  if (prior !== null && prior !== listed.line && found !== undefined && holds(prior)) {
    return { found, kind: 'replace', listed, prior };
  }
  if (holds(listed.line)) {
    return { kind: 'hold', listed, prior };
  }
  if (prior !== null && update) {
    return { kind: 'not-held', path: listed.path, prior };
  }
  return { found, kind: 'add', listed, prior };
}

/** What a run does to a recorded line it does not list: release it, remove it, or report it gone. */
function unlistedAction(recorded: StartupLine, release: ReadonlySet<string>): LineAction {
  const { line: prior, path } = recorded;
  if (release.has(path)) {
    return { kind: 'release', path, prior };
  }
  const read = readStartup(path);
  if (read.kind === 'unknown-encoding' || read.kind === 'unreadable') {
    throw unreadable(path, read.kind);
  }
  if (read.kind === 'text' && holdsLine(read.content.text, prior)) {
    return { found: read.content, kind: 'remove', path, prior };
  }
  return { kind: 'not-held', path, prior };
}

/** What a run plans for the lines it names, and the refusals of their startup files. */
interface NamedPlan {
  readonly refused: readonly LineRefusal[];
  readonly actions: readonly LineAction[];
}

/**
 * What a run does to every startup line it lists or the plugin's file records, and the refusal of
 * each listed startup file that is not a regular file or nothing, which refuses the whole install.
 * It reads each startup file it would change and none it releases, and throws a TypeError for one
 * in an encoding it does not read. Each listed line is planned with the text recorded for its file,
 * `null` for none.
 */
function planLines(listing: LineListing, recorded: readonly StartupLine[]): NamedPlan {
  const priors = new Map(recorded.map(({ line, path }) => [path, line]));
  const reads = listing.lines.map((listed) => ({ found: foundText(listed.path), listed }));
  const named = new Set(listing.lines.map(({ path }) => path));
  const unlisted = recorded.filter(({ path }) => !named.has(path));
  const listed = reads.flatMap(({ found, listed: line }) =>
    isRefusal(found)
      ? []
      : [
          listedAction(
            { found, listed: line, prior: priors.get(line.path) ?? null },
            listing.update,
          ),
        ],
  );
  return {
    actions: [...listed, ...unlistedActions(unlisted, listing.release)],
    refused: reads.flatMap(({ found }) => (isRefusal(found) ? [found] : [])),
  };
}

/**
 * What a run does to recorded lines it does not list, as an uninstall does to every recorded line:
 * release each the plugin releases, without reading its file, and remove or report each other one.
 */
function unlistedActions(
  recorded: readonly StartupLine[],
  release: ReadonlySet<string>,
): LineAction[] {
  return recorded.map((entry) => unlistedAction(entry, release));
}

/** The startup file's path an action touches. */
function pathOf(action: LineAction): string {
  return 'listed' in action ? action.listed.path : action.path;
}

/** The pending entry of an action; a released line has none, so recovery never reads its file. */
function pendingOf(action: LineAction): PendingLine[] {
  const path = pathOf(action);
  switch (action.kind) {
    case 'add':
    case 'hold':
    case 'replace': {
      return [{ intended: action.listed.line, path, prior: action.prior }];
    }
    case 'remove':
    case 'not-held': {
      return [{ intended: null, path, prior: action.prior }];
    }
    default: {
      return [];
    }
  }
}

/** The line an action leaves recorded, if any. */
function committedOf(action: LineAction): StartupLine[] {
  return action.kind === 'add' || action.kind === 'hold' || action.kind === 'replace'
    ? [{ line: action.listed.line, path: action.listed.path }]
    : [];
}

/** The missing directories above a startup file the action creates. */
function createdParentsOf(action: LineAction): string[] {
  return action.kind === 'add' && action.found === undefined
    ? missingParents(action.listed.path)
    : [];
}

/**
 * Adds a listed line: appends it to the file it read, or creates the file when there was none. A
 * file another run created since it was read, as when two applications add their lines at once,
 * is read again and gets the line appended unless it already holds it.
 */
function addLine(listed: InstalledLine, found: StartupText | undefined): void {
  if (found !== undefined) {
    appendLine(listed.path, found, listed.line);
    return;
  }
  if (createStartupFile(listed.path, listed.line)) {
    return;
  }
  const created = foundText(listed.path);
  if (created === undefined || isRefusal(created)) {
    throw new Error(`Startup file "${listed.path}" changed while its line was added.`);
  }
  if (!holdsLine(created.text, listed.line)) {
    appendLine(listed.path, created, listed.line);
  }
}

/**
 * Carries out one action: an append or a created file for an added line, and a rewrite for a
 * replaced or removed one. A held, no longer held, or released line changes no startup file.
 */
function applyLine(action: LineAction): void {
  if (action.kind === 'add') {
    addLine(action.listed, action.found);
  } else if (action.kind === 'replace') {
    rewriteLines(action.listed.path, action.found, {
      prior: action.prior,
      replacement: action.listed.line,
    });
  } else if (action.kind === 'remove') {
    rewriteLines(action.path, action.found, { prior: action.prior, replacement: null });
  }
}

/** The outcome list each action reports in. */
const outcomeList: Readonly<Record<LineAction['kind'], keyof StartupLinesOutcome>> = {
  add: 'added',
  hold: 'held',
  'not-held': 'noLongerHeld',
  release: 'released',
  remove: 'removed',
  replace: 'replaced',
};

/** What happened to the startup lines, each action under its own list. */
function outcomeOf(actions: readonly LineAction[]): StartupLinesOutcome {
  const lists: Record<keyof StartupLinesOutcome, StartupLine[]> = {
    added: [],
    held: [],
    noLongerHeld: [],
    released: [],
    removed: [],
    replaced: [],
  };
  for (const action of actions) {
    const line = 'listed' in action ? action.listed.line : action.prior;
    lists[outcomeList[action.kind]].push({ line, path: pathOf(action) });
  }
  return lists;
}

/**
 * The line a pending startup line resolves to, read from its file without writing: the intended
 * text when the file holds it, else the prior text when it holds that, else no line.
 */
function heldLine(entry: PendingLine): StartupLine[] {
  const read = readStartup(entry.path);
  if (read.kind !== 'text') {
    return [];
  }
  const candidates = [entry.intended, entry.prior].filter((text) => text !== null);
  const held = candidates.find((text) => holdsLine(read.content.text, text));
  return held === undefined ? [] : [{ line: held, path: entry.path }];
}

/**
 * Resolves a pending startup line as `heldLine` reads it, after removing the leftover staging files
 * beside its startup file's real path.
 */
function recoveredLine(entry: PendingLine): StartupLine[] {
  removeStagingFiles(realPathOf(entry.path));
  return heldLine(entry);
}

export type { InstalledLine, LineAction, LineListing, LineRefusal, StartupLinesOutcome };
export {
  applyLine,
  committedOf,
  createdParentsOf,
  heldLine,
  outcomeOf,
  pendingOf,
  planLines,
  recoveredLine,
  unlistedActions,
};
