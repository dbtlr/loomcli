import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { array, boolean, literal, strictObject, string, union } from 'valibot';
import type { InferOutput } from 'valibot';

import { runBun } from './bun.js';
import { parseOrThrow } from './parse-or-throw.js';
import type { RunHost } from './run-host.js';

/** One file of a judged skill: its path relative to the skill's folder, and its executable bit. */
const judgedFile = strictObject({ executable: boolean(), path: string() });

/** One skill the plugin read from the folder and judged. */
const judgedSkill = strictObject({ files: array(judgedFile), name: string() });

/**
 * What the reading process found: no folder named while the module loaded; the folder, absolute,
 * with the skills the plugin judged there; or the failure the build stops with.
 */
const readResult = union([
  strictObject({ kind: literal('none') }),
  strictObject({ folder: string(), kind: literal('read'), skills: array(judgedSkill) }),
  strictObject({ failure: string() }),
]);

/** One read as the reading process writes it, before the build checks its shape. */
type SkillsRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'read'; readonly folder: string; readonly skills: unknown }
  | { readonly failure: string };

/** A skill the build carries: its name and its files' paths and executable bits. */
type JudgedSkill = InferOutput<typeof judgedSkill>;

/**
 * What the build learned of the skills folder: nothing, because it did not load the module; that
 * the module named no folder; or the folder and its judged skills.
 */
type SkillsCarry =
  | { readonly kind: 'unread' }
  | { readonly kind: 'none' }
  | { readonly kind: 'read'; readonly folder: string; readonly skills: readonly JudgedSkill[] };

/**
 * The script the reading process runs. The build writes it into `dist` beside the bundle's
 * modules, this one included. A run of `loom` from its source, as the toolchain's own build makes
 * under Bun, has no built script beside this module, so it runs the script's source.
 */
function readerScript(): string {
  const built = fileURLToPath(new URL('read-skills.js', import.meta.url));
  return existsSync(built) ? built : fileURLToPath(new URL('../read-skills.ts', import.meta.url));
}

/**
 * Whether the package resolves `@loomcli/plugins`: a `node_modules/@loomcli/plugins` at or above
 * its directory, where a bare specifier's lookup finds it.
 */
function resolvesPlugins(directory: string): boolean {
  for (let current = directory; ; current = dirname(current)) {
    if (existsSync(join(current, 'node_modules', '@loomcli', 'plugins', 'package.json'))) {
      return true;
    }
    if (dirname(current) === current) {
      return false;
    }
  }
}

/** The module to load and the entry it must not be, each absolute, and the module as shown. */
interface SkillsModule {
  readonly directory: string;
  readonly entry: string;
  readonly module: string | undefined;
  readonly shown: string;
}

/**
 * Reads the skills folder the application module's `skills()` call names, under Bun, in a process
 * of its own in the package directory, as `loom init` reads the module's exports. A package that
 * does not resolve `@loomcli/plugins`, that has no application module, or whose application module
 * is the entry, which would run the application, is not loaded and reads `unread`. The process
 * writes its result to a file in a scratch folder under the run's temporary folder, removed once
 * read or when a shutdown ends before the run has unwound. A module that throws while it loads, a
 * registry this `loom` cannot read, two folders, and any fault the plugin's judging raises fail
 * the build with the failure's text, before anything is bundled.
 */
async function readSkillsDeclaration(run: RunHost, options: SkillsModule): Promise<SkillsCarry> {
  const { directory, entry, module } = options;
  if (module === undefined || module === entry || !resolvesPlugins(directory)) {
    return { kind: 'unread' };
  }
  const temporary = mkdtempSync(join(run.host.tmpdir, 'loom-build-skills-'));
  const removeTemporary = () => {
    rmSync(temporary, { force: true, recursive: true });
  };
  const removeCleanup = run.onShutdown(removeTemporary);
  try {
    const resultFile = join(temporary, 'result.json');
    const read = await runBun(
      run,
      ['--no-install', readerScript(), resultFile, directory, module, options.shown],
      directory,
    );
    if (read.code !== 0 || !existsSync(resultFile)) {
      throw new Error(`${read.output.trim()}\n\nBun could not read ${options.shown}.`.trim());
    }
    const result = parseOrThrow(readResult, JSON.parse(readFileSync(resultFile, 'utf8')));
    if ('failure' in result) {
      throw new Error(result.failure);
    }
    return result;
  } finally {
    removeCleanup();
    removeTemporary();
  }
}

export type { JudgedSkill, SkillsCarry, SkillsModule, SkillsRead };
export { readSkillsDeclaration };
