import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { object, safeParse, string } from 'valibot';

import {
  highestKind,
  insertSection,
  landedFragments,
  renderSection,
  requireNarrative,
} from './changelog.js';
import type { ChangelogFiles } from './changelog.js';
import {
  chooseVersion,
  fragmentMinimum,
  lastRelease,
  requireReleaseSection,
} from './cut-version.js';
import { parseManifest, withVersion } from './manifest.js';
import { isRepository, isShallow, readWorkingFile } from './repository.js';
import type { Checkout } from './repository.js';
import { sharedManifests } from './shared-version.js';
import { parseSemVer } from './version.js';

/** One file a cut replaces: its absolute path and its new contents. */
interface Replacement {
  readonly contents: string;
  readonly path: string;
}

function manifestVersion(source: string, path: string) {
  const parsed = safeParse(object({ version: string() }), parseManifest(source, path));
  if (!parsed.success) {
    throw new Error('package.json: expected a version string.');
  }
  return parsed.output.version;
}

/** The package's version as `package.json` holds it, or the failure for a form a cut cannot read. */
export function packageVersion(source: string, path: string) {
  const text = manifestVersion(source, path);
  const version = parseSemVer(text);
  if (version === undefined) {
    throw new Error(
      `package.json version ${JSON.stringify(text)} is not MAJOR.MINOR.PATCH with an optional prerelease part, so set a version such as 1.2.0 or 1.2.0-rc.1.`,
    );
  }
  return version;
}

/**
 * Notes and write order fragments by the commits that added them, so both read the full history of
 * a repository. `command` names the one that needs it.
 */
export async function requireHistory(checkout: Checkout, command: string) {
  if (!(await isRepository(checkout))) {
    throw new Error(
      `loom changelog ${command} orders fragments by the commits that added them, so run it inside a git repository with the fragments committed.`,
    );
  }
  if (await isShallow(checkout)) {
    throw new Error(
      `loom changelog ${command} needs full git history to order the fragments, so fetch it with git fetch --unshallow and run it again.`,
    );
  }
}

/** What a package cut is given beyond its fragments. */
export interface CutOptions {
  date: string;
  narrative: string | undefined;
  /** The raw `sharedVersion` value of the configuration file, checked by the cut. */
  sharedVersion: unknown;
  /** The version `--target` names, in the form the cut checks. */
  target: string | undefined;
}

/**
 * A package's next cut, prepared without writing. `replacements` holds the new contents of the
 * changelog, when the cut writes one, `package.json`, and each `sharedVersion` manifest; `consumed`
 * holds the fragments a stable cut deletes. A prerelease cut writes no section and leaves its
 * `pending` fragments in place. `files` names the changelog and the fragment folder relative to
 * the package directory, and either may leave it.
 */
export async function preparePackageCut(
  checkout: Checkout,
  options: CutOptions,
  files: ChangelogFiles,
) {
  const directory = checkout.root;
  const manifestPath = join(directory, 'package.json');
  const manifest = readWorkingFile(directory, 'package.json');
  const current = packageVersion(manifest, manifestPath);
  const shared = sharedManifests(directory, options.sharedVersion, manifestPath, current.text);
  await requireHistory(checkout, 'write');
  const { fragments } = await landedFragments(checkout, undefined, files.changes);
  if (fragments.length === 0) {
    throw new Error(`No fragments to release, so add a fragment to ${files.changes}/ first.`);
  }
  const existing = existsSync(join(directory, files.changelog))
    ? readWorkingFile(directory, files.changelog)
    : undefined;
  const minimum = fragmentMinimum(lastRelease(current, existing), highestKind(fragments));
  const next = chooseVersion(current, minimum, options.target);
  const version = next.text;
  const replacements: Replacement[] = [
    { contents: withVersion(manifest, version), path: manifestPath },
    ...shared.map(({ path, source }) => ({ contents: withVersion(source, version), path })),
  ];
  if (next.prerelease.length > 0) {
    if (options.narrative !== undefined) {
      requireNarrative(options.narrative);
    }
    requireReleaseSection(current, existing, files.changelog);
    return {
      consumed: [],
      files,
      kind: 'prerelease' as const,
      pending: fragments.length,
      release: next.release.text,
      replacements,
      section: undefined,
      version,
    };
  }
  const section = renderSection({
    date: options.date,
    fragments,
    narrative: options.narrative,
    version,
  });
  const changelog = insertSection(existing ?? '# Changelog\n', section, version, files);
  return {
    consumed: fragments,
    files,
    kind: 'release' as const,
    pending: 0,
    release: version,
    replacements: [
      { contents: changelog, path: join(directory, files.changelog) },
      ...replacements,
    ],
    section,
    version,
  };
}

/** A package's next cut, prepared without writing. */
export type PackageCut = Awaited<ReturnType<typeof preparePackageCut>>;

/**
 * Installs a prepared cut. The new files are staged in a temporary directory in the package
 * directory, so a failure while staging changes nothing. The replacement then moves each original and each
 * consumed fragment into that directory and the staged files into place, and a failure undoes every
 * move made so far. Only when the undo itself fails does the directory stay, holding the originals.
 */
export function writePackageCut(directory: string, cut: PackageCut) {
  const stage = mkdtempSync(join(directory, '.loom-changelog-'));
  const moves: { from: string; to: string }[] = [];
  const move = (from: string, to: string) => {
    renameSync(from, to);
    moves.push({ from, to });
  };
  // The first folder made for a changelog whose folder is missing, which a failed cut removes again.
  let created: string | undefined = undefined;
  let keep = false;
  try {
    // Each file is staged under its own name behind its position, so two manifests never collide.
    const staged = cut.replacements.map(({ contents, path }, index) => ({
      contents,
      old: join(stage, `old.${index}.${basename(path)}`),
      path,
      staged: join(stage, `new.${index}.${basename(path)}`),
    }));
    for (const { contents, path, staged: file } of staged) {
      writeFileSync(file, contents);
      if (existsSync(path)) {
        chmodSync(file, statSync(path).mode);
      }
    }
    for (const { old, path, staged: file } of staged) {
      if (existsSync(path)) {
        move(path, old);
      }
      created ??= mkdirSync(dirname(path), { recursive: true });
      move(file, path);
    }
    for (const fragment of cut.consumed) {
      move(
        join(directory, cut.files.changes, fragment.name),
        join(stage, `fragment.${fragment.name}`),
      );
    }
  } catch (error) {
    const failed: string[] = [];
    for (const { from, to } of moves.toReversed()) {
      try {
        renameSync(to, from);
      } catch {
        failed.push(from);
      }
    }
    if (failed.length > 0) {
      keep = true;
      throw new Error(
        `Restoring ${failed.join(', ')} failed, so copy the originals back from ${stage}.`,
        { cause: error },
      );
    }
    if (created !== undefined) {
      rmSync(created, { force: true, recursive: true });
    }
    throw error;
  } finally {
    if (!keep) {
      rmSync(stage, { force: true, recursive: true });
    }
  }
}
